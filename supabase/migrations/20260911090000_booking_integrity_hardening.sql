-- MiniPort production hardening: server-side driver wallet gate + booking state machine.
-- This migration is intentionally idempotent and does not alter existing booking data.

-- 1) Enforce the driver's minimum cash wallet balance on the server.
CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.profiles;
  v_booking public.bookings;
  v_cash_balance numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;

  SELECT * INTO v_driver
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT FOUND OR v_driver.is_online IS NOT TRUE OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be online and verified';
  END IF;

  SELECT COALESCE(w.cash_balance, 0)
    INTO v_cash_balance
  FROM public.wallet_accounts w
  WHERE w.user_id = auth.uid();

  IF v_cash_balance < 100 THEN
    RAISE EXCEPTION 'Minimum wallet balance of INR 100 is required to accept rides';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found or no longer available';
  END IF;

  IF v_booking.driver_id IS NOT NULL OR v_booking.status <> 'pending'::public.booking_status
     OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;

  IF v_booking.service_zone IS DISTINCT FROM v_driver.service_zone THEN
    RAISE EXCEPTION 'Ride is outside your service zone';
  END IF;

  UPDATE public.bookings
  SET driver_id = auth.uid(), status = 'accepted'::public.booking_status
  WHERE id = _booking_id
    AND driver_id IS NULL
    AND status = 'pending'::public.booking_status
    AND cancelled_at IS NULL
  RETURNING * INTO v_booking;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;

  RETURN v_booking;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_booking(uuid) TO authenticated, service_role;

-- 2) Lock the booking lifecycle to valid server-side transitions.
-- Admin/service-role/internal jobs remain able to perform operational corrections.
CREATE OR REPLACE FUNCTION public.enforce_booking_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean := false;
BEGIN
  IF uid IS NULL OR public.has_role(uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Terminal states cannot be changed by normal client sessions.
  IF OLD.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    RAISE EXCEPTION 'Booking is already closed';
  END IF;

  -- Driver acceptance: only the authenticated driver may claim a pending booking,
  -- and the same server-side eligibility checks as accept_booking are required.
  IF OLD.status = 'pending'::public.booking_status
     AND NEW.status = 'accepted'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'Only the accepting driver can claim this booking';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = uid
        AND p.is_online IS TRUE
        AND p.kyc_status = 'approved'::public.kyc_status
        AND p.service_zone IS NOT DISTINCT FROM NEW.service_zone
    ) THEN
      RAISE EXCEPTION 'Driver is not eligible to accept this booking';
    END IF;

    RETURN NEW;
  END IF;

  -- Pickup verification is the only normal way to start an accepted ride.
  IF OLD.status = 'accepted'::public.booking_status
     AND NEW.status = 'in_progress'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'Only the assigned driver can start this trip';
    END IF;
    IF NEW.pickup_verified_at IS NULL THEN
      RAISE EXCEPTION 'Pickup OTP verification is required before starting the trip';
    END IF;
    RETURN NEW;
  END IF;

  -- Drop verification is required before completion. POD is evidence, not a replacement.
  -- The existing client records the verification timestamp when it accepts the drop OTP.
  IF OLD.status = 'in_progress'::public.booking_status
     AND NEW.status = 'completed'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'Only the assigned driver can complete this trip';
    END IF;
    IF NEW.drop_verified_at IS NULL THEN
      RAISE EXCEPTION 'Drop OTP verification is required before completing the trip';
    END IF;
    RETURN NEW;
  END IF;

  -- Customer may cancel before completion; driver may cancel an accepted job.
  IF NEW.status = 'cancelled'::public.booking_status THEN
    IF NEW.customer_id = uid AND OLD.status IN ('pending'::public.booking_status, 'accepted'::public.booking_status) THEN
      RETURN NEW;
    END IF;
    IF NEW.driver_id = uid AND OLD.status = 'accepted'::public.booking_status THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'This booking cannot be cancelled by this user at its current stage';
  END IF;

  RAISE EXCEPTION 'Invalid booking status transition: % -> %', OLD.status, NEW.status;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bookings_state_machine ON public.bookings;
CREATE TRIGGER trg_bookings_state_machine
BEFORE UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_booking_state_machine();

REVOKE ALL ON FUNCTION public.enforce_booking_state_machine() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_booking_state_machine() TO authenticated, service_role;

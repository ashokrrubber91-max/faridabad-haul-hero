-- Serialize ride acceptance per driver.
-- This closes a race where two requests for different bookings could both pass
-- the active-trip count before either booking was assigned.
-- No wallet, fare, payment, eligibility, or booking-status rules are changed.

CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.profiles%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_balance numeric := 0;
  v_active integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;

  -- Per-driver mutex: requests accepting different bookings must wait here.
  -- The second request then sees the first request's committed active trip.
  SELECT *
    INTO v_driver
    FROM public.profiles
   WHERE id = auth.uid()
   FOR UPDATE;

  IF NOT FOUND
     OR v_driver.is_online IS NOT TRUE
     OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be online and verified';
  END IF;

  SELECT COALESCE(cash_balance, 0)
    INTO v_balance
    FROM public.wallet_accounts
   WHERE user_id = auth.uid();

  IF v_balance < 100 THEN
    RAISE EXCEPTION 'Minimum wallet balance of INR 100 is required to accept rides';
  END IF;

  SELECT count(*)
    INTO v_active
    FROM public.bookings
   WHERE driver_id = auth.uid()
     AND status IN ('accepted', 'in_progress')
     AND cancelled_at IS NULL;

  IF v_active > 0 THEN
    RAISE EXCEPTION 'Finish your current trip before accepting a new one';
  END IF;

  SELECT *
    INTO v_booking
    FROM public.bookings
   WHERE id = _booking_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_booking.driver_id IS NOT NULL
     OR v_booking.status <> 'pending'
     OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;

  IF v_booking.service_zone IS DISTINCT FROM v_driver.service_zone THEN
    RAISE EXCEPTION 'Ride is outside your service zone';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.booking_dispatch_offers o
     WHERE o.booking_id = _booking_id
       AND o.driver_id = auth.uid()
       AND o.status = 'offered'
       AND o.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'This ride is not currently offered to you or the 20-second timer has expired';
  END IF;

  UPDATE public.bookings
     SET driver_id = auth.uid(),
         status = 'accepted',
         updated_at = now()
   WHERE id = _booking_id
     AND driver_id IS NULL
     AND status = 'pending'
     AND cancelled_at IS NULL
  RETURNING * INTO v_booking;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;

  UPDATE public.booking_dispatch_offers
     SET status = 'accepted',
         responded_at = now()
   WHERE booking_id = _booking_id
     AND driver_id = auth.uid()
     AND status = 'offered';

  UPDATE public.booking_dispatch_offers
     SET status = 'skipped',
         responded_at = now()
   WHERE booking_id = _booking_id
     AND status = 'offered'
     AND driver_id <> auth.uid();

  v_booking.pickup_otp := NULL;
  v_booking.drop_otp := NULL;
  RETURN v_booking;
END;
$function$;

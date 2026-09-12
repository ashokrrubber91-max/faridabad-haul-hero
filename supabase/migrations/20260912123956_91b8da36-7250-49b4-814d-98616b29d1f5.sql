CREATE OR REPLACE FUNCTION public.enforce_booking_state_machine()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); trusted boolean := public.is_trusted_booking_write(); v_bal numeric; v_active int;
BEGIN
  IF uid IS NULL OR public.has_role(uid, 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    RAISE EXCEPTION 'Booking is already closed';
  END IF;
  IF OLD.status = 'pending'::public.booking_status AND NEW.status = 'accepted'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the accepting driver can claim this booking'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = uid AND p.is_online IS TRUE AND p.kyc_status = 'approved'::public.kyc_status AND p.service_zone IS NOT DISTINCT FROM NEW.service_zone) THEN
      RAISE EXCEPTION 'Driver is not eligible to accept this booking';
    END IF;
    SELECT COALESCE(w.cash_balance, 0) INTO v_bal FROM public.wallet_accounts w WHERE w.user_id = uid;
    IF COALESCE(v_bal, 0) < 100 THEN
      RAISE EXCEPTION 'Minimum wallet balance of INR 100 is required to accept rides';
    END IF;
    SELECT count(*) INTO v_active FROM public.bookings b
      WHERE b.driver_id = uid
        AND b.id <> NEW.id
        AND b.status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
        AND b.cancelled_at IS NULL;
    IF v_active > 0 THEN
      RAISE EXCEPTION 'Finish your current trip before accepting a new one';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'accepted'::public.booking_status AND NEW.status = 'in_progress'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the assigned driver can start this trip'; END IF;
    IF NEW.pickup_verified_at IS NULL OR (OLD.pickup_verified_at IS NULL AND NOT trusted) THEN
      RAISE EXCEPTION 'Pickup OTP verification is required before starting the trip';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'in_progress'::public.booking_status AND NEW.status = 'completed'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the assigned driver can complete this trip'; END IF;
    IF NEW.drop_verified_at IS NULL OR (OLD.drop_verified_at IS NULL AND NOT trusted) THEN
      RAISE EXCEPTION 'Drop OTP verification is required before completing this trip';
    END IF;
    IF NEW.pod_photo_url IS NULL OR btrim(NEW.pod_photo_url) = '' THEN
      RAISE EXCEPTION 'Proof of delivery photo is required before completing this trip';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'cancelled'::public.booking_status THEN
    IF NEW.customer_id = uid AND OLD.status IN ('pending'::public.booking_status, 'accepted'::public.booking_status, 'in_progress'::public.booking_status) THEN RETURN NEW; END IF;
    IF NEW.driver_id = uid AND OLD.status = 'accepted'::public.booking_status THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'This booking cannot be cancelled by this user at its current stage';
  END IF;
  RAISE EXCEPTION 'Invalid booking status transition: % -> %', OLD.status, NEW.status;
END $function$;
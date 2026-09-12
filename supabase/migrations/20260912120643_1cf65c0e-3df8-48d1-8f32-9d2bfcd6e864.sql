-- 1) Trusted-write marker helper
CREATE OR REPLACE FUNCTION public.is_trusted_booking_write()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('miniport.trusted_write', true), '') = 'on'
$$;

-- 2) Freeze verification-critical columns for ordinary authenticated writers
CREATE OR REPLACE FUNCTION public.bookings_protect_financials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  NEW.fare := OLD.fare;
  NEW.coupon_code := OLD.coupon_code;
  NEW.coupon_discount := OLD.coupon_discount;
  NEW.coins_redeemed := OLD.coins_redeemed;
  NEW.commission_rate := OLD.commission_rate;
  NEW.commission_amount := OLD.commission_amount;
  NEW.driver_net_earning := OLD.driver_net_earning;
  NEW.payment_status := OLD.payment_status;
  NEW.payment_method := OLD.payment_method;
  NEW.distance_km := OLD.distance_km;
  NEW.customer_id := OLD.customer_id;

  -- Verification integrity: only the server-side verification/photo functions
  -- (which set the trusted marker) may touch these.
  IF NOT public.is_trusted_booking_write() THEN
    NEW.pickup_otp := OLD.pickup_otp;
    NEW.drop_otp := OLD.drop_otp;
    NEW.pickup_verified_at := OLD.pickup_verified_at;
    NEW.drop_verified_at := OLD.drop_verified_at;
    NEW.pod_photo_url := OLD.pod_photo_url;
    NEW.service_zone := OLD.service_zone;
    NEW.expires_at := OLD.expires_at;
  END IF;

  RETURN NEW;
END $$;

-- 3) State machine: verification must already be persisted, or be part of a trusted write
CREATE OR REPLACE FUNCTION public.enforce_booking_state_machine()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); trusted boolean := public.is_trusted_booking_write();
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
    IF NEW.customer_id = uid AND OLD.status IN ('pending'::public.booking_status, 'accepted'::public.booking_status) THEN RETURN NEW; END IF;
    IF NEW.driver_id = uid AND OLD.status = 'accepted'::public.booking_status THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'This booking cannot be cancelled by this user at its current stage';
  END IF;
  RAISE EXCEPTION 'Invalid booking status transition: % -> %', OLD.status, NEW.status;
END $$;

-- 4) Delivery photo function marks its write as trusted
CREATE OR REPLACE FUNCTION public.attach_delivery_photo(_booking_id uuid, _pod_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.bookings; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF _pod_path IS NULL OR btrim(_pod_path) = '' OR length(_pod_path) > 400 THEN
    RAISE EXCEPTION 'Invalid photo reference';
  END IF;
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.driver_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the assigned driver can add a delivery photo'; END IF;
  IF b.status NOT IN ('in_progress'::public.booking_status, 'completed'::public.booking_status) THEN
    RAISE EXCEPTION 'Delivery photos can only be added on an ongoing or completed trip';
  END IF;
  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings SET pod_photo_url = _pod_path WHERE id = _booking_id;
  PERFORM set_config('miniport.trusted_write', 'off', true);
  RETURN true;
END $$;

-- 5) OTP verification: brute-force counter must survive a wrong code, so return a
--    result instead of raising for recoverable outcomes.
DROP FUNCTION IF EXISTS public.verify_booking_otp(uuid, text, text);

CREATE FUNCTION public.verify_booking_otp(_booking_id uuid, _stage text, _otp text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.bookings;
  att public.booking_otp_attempts;
  expected text;
  uid uuid := auth.uid();
  clean text := regexp_replace(COALESCE(_otp, ''), '[^0-9]', '', 'g');
  tries int;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Please sign in again'); END IF;
  IF _stage NOT IN ('pickup', 'drop') THEN RETURN jsonb_build_object('ok', false, 'message', 'Invalid verification step'); END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'message', 'Trip not found'); END IF;
  IF b.driver_id IS DISTINCT FROM uid THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only the assigned driver can verify this trip');
  END IF;
  IF b.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This trip was cancelled');
  END IF;

  SELECT * INTO att FROM public.booking_otp_attempts
    WHERE booking_id = _booking_id AND stage = _stage FOR UPDATE;
  IF att.locked_until IS NOT NULL AND att.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'locked', true, 'message', 'Too many wrong codes. Try again in a few minutes.');
  END IF;

  IF _stage = 'pickup' THEN
    IF b.status <> 'accepted'::public.booking_status THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Trip is not awaiting pickup');
    END IF;
    expected := b.pickup_otp;
  ELSE
    IF b.status <> 'in_progress'::public.booking_status THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Start the trip before confirming delivery');
    END IF;
    IF b.pod_photo_url IS NULL OR btrim(b.pod_photo_url) = '' THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Upload the delivery photo before confirming delivery');
    END IF;
    expected := b.drop_otp;
  END IF;

  IF expected IS NULL OR clean <> expected THEN
    INSERT INTO public.booking_otp_attempts(booking_id, stage, attempts, updated_at)
      VALUES (_booking_id, _stage, 1, now())
      ON CONFLICT (booking_id, stage) DO UPDATE
        SET attempts = public.booking_otp_attempts.attempts + 1,
            updated_at = now(),
            locked_until = CASE WHEN public.booking_otp_attempts.attempts + 1 >= 5
                                THEN now() + interval '10 minutes' ELSE NULL END
      RETURNING attempts INTO tries;
    RETURN jsonb_build_object(
      'ok', false,
      'locked', tries >= 5,
      'attempts', tries,
      'message', CASE WHEN tries >= 5
        THEN 'Too many wrong codes. Try again in a few minutes.'
        ELSE 'Incorrect code. Please re-check with the customer.' END);
  END IF;

  DELETE FROM public.booking_otp_attempts WHERE booking_id = _booking_id AND stage = _stage;

  PERFORM set_config('miniport.trusted_write', 'on', true);
  IF _stage = 'pickup' THEN
    UPDATE public.bookings
      SET pickup_verified_at = now(),
          status = 'in_progress'::public.booking_status,
          loading_stopped_at = COALESCE(loading_stopped_at, now())
      WHERE id = _booking_id RETURNING * INTO b;
  ELSE
    UPDATE public.bookings
      SET drop_verified_at = now(),
          status = 'completed'::public.booking_status,
          unloading_stopped_at = COALESCE(unloading_stopped_at, now())
      WHERE id = _booking_id RETURNING * INTO b;
  END IF;
  PERFORM set_config('miniport.trusted_write', 'off', true);

  RETURN jsonb_build_object('ok', true, 'stage', _stage, 'status', b.status::text, 'booking_id', b.id);
END $$;

REVOKE ALL ON FUNCTION public.verify_booking_otp(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_booking_otp(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trusted_booking_write() TO authenticated, service_role;
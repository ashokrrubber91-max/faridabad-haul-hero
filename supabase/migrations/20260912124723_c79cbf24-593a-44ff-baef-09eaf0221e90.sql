CREATE TABLE IF NOT EXISTS private.booking_otps (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  pickup_otp text NOT NULL,
  drop_otp text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.booking_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.booking_otps FROM anon, authenticated;

INSERT INTO private.booking_otps (booking_id, pickup_otp, drop_otp)
SELECT id,
       COALESCE(pickup_otp, lpad((floor(random()*10000))::int::text, 4, '0')),
       COALESCE(drop_otp, lpad((floor(random()*10000))::int::text, 4, '0'))
FROM public.bookings
ON CONFLICT (booking_id) DO NOTHING;

DROP TRIGGER IF EXISTS bookings_generate_otps ON public.bookings;

CREATE OR REPLACE FUNCTION public.bookings_generate_otps()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
BEGIN
  INSERT INTO private.booking_otps (booking_id, pickup_otp, drop_otp)
  VALUES (NEW.id,
          lpad((floor(random()*10000))::int::text, 4, '0'),
          lpad((floor(random()*10000))::int::text, 4, '0'))
  ON CONFLICT (booking_id) DO NOTHING;
  RETURN NEW;
END $function$;

CREATE TRIGGER a_bookings_generate_otps
AFTER INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_generate_otps();

CREATE OR REPLACE FUNCTION public.get_booking_otps(_booking_id uuid)
 RETURNS TABLE(pickup_otp text, drop_otp text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE b public.bookings; o private.booking_otps;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF b.customer_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF b.status NOT IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status) THEN
    RETURN;
  END IF;
  SELECT * INTO o FROM private.booking_otps WHERE booking_id = _booking_id;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT
    CASE WHEN b.pickup_verified_at IS NULL THEN o.pickup_otp ELSE NULL END,
    CASE WHEN b.pickup_verified_at IS NOT NULL AND b.drop_verified_at IS NULL THEN o.drop_otp ELSE NULL END;
END $function$;

CREATE OR REPLACE FUNCTION public.verify_booking_otp(_booking_id uuid, _stage text, _otp text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
    SELECT o.pickup_otp INTO expected FROM private.booking_otps o WHERE o.booking_id = _booking_id;
  ELSE
    IF b.status <> 'in_progress'::public.booking_status THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Start the trip before confirming delivery');
    END IF;
    IF b.pod_photo_url IS NULL OR btrim(b.pod_photo_url) = '' THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Upload the delivery photo before confirming delivery');
    END IF;
    SELECT o.drop_otp INTO expected FROM private.booking_otps o WHERE o.booking_id = _booking_id;
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
END $function$;

CREATE OR REPLACE FUNCTION public.bookings_protect_financials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR public.has_role(uid, 'admin'::app_role) THEN
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

  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     AND NOT public.is_trusted_booking_write()
     AND NOT (
       OLD.driver_id IS NULL
       AND NEW.driver_id = uid
       AND public.has_role(uid, 'driver'::app_role)
     )
  THEN
    NEW.driver_id := OLD.driver_id;
  END IF;

  IF NOT public.is_trusted_booking_write() THEN
    NEW.pickup_verified_at := OLD.pickup_verified_at;
    NEW.drop_verified_at := OLD.drop_verified_at;
    NEW.pod_photo_url := OLD.pod_photo_url;
    NEW.service_zone := OLD.service_zone;
    NEW.expires_at := OLD.expires_at;
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.profiles;
  v_booking public.bookings;
  v_cash_balance numeric := 0;
  v_active int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;
  SELECT * INTO v_driver FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND OR v_driver.is_online IS NOT TRUE OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be online and verified';
  END IF;
  SELECT COALESCE(w.cash_balance, 0) INTO v_cash_balance FROM public.wallet_accounts w WHERE w.user_id = auth.uid();
  IF v_cash_balance < 100 THEN
    RAISE EXCEPTION 'Minimum wallet balance of INR 100 is required to accept rides';
  END IF;
  SELECT count(*) INTO v_active FROM public.bookings
    WHERE driver_id = auth.uid()
      AND status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
      AND cancelled_at IS NULL;
  IF v_active > 0 THEN
    RAISE EXCEPTION 'Finish your current trip before accepting a new one';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found or no longer available'; END IF;
  IF v_booking.driver_id IS NOT NULL OR v_booking.status <> 'pending'::public.booking_status OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;
  IF v_booking.service_zone IS DISTINCT FROM v_driver.service_zone THEN
    RAISE EXCEPTION 'Ride is outside your service zone';
  END IF;
  UPDATE public.bookings SET driver_id = auth.uid(), status = 'accepted'::public.booking_status
  WHERE id = _booking_id AND driver_id IS NULL AND status = 'pending'::public.booking_status AND cancelled_at IS NULL
  RETURNING * INTO v_booking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride already accepted or closed'; END IF;
  RETURN v_booking;
END;
$function$;

ALTER TABLE public.bookings DROP COLUMN pickup_otp;
ALTER TABLE public.bookings DROP COLUMN drop_otp;
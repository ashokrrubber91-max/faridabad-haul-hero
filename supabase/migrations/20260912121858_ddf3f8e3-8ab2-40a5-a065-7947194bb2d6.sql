-- 1) Ride request validity window + coupon redemption accounting on booking insert
CREATE OR REPLACE FUNCTION public.bookings_enforce_insert_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  base numeric; per_km numeric; gross numeric; disc numeric := 0; cpn record;
  coin_cap numeric; bal numeric; pending_count int; hour_count int; c public.coupons%ROWTYPE;
BEGIN
  -- Every request gets a validity window so expire_stale_bookings() can retire it.
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := now() + interval '30 minutes';
  END IF;

  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only book for your own account';
  END IF;

  SELECT count(*) INTO pending_count FROM public.bookings
    WHERE customer_id = auth.uid() AND status = 'pending'::booking_status AND cancelled_at IS NULL;
  IF pending_count >= 3 THEN
    RAISE EXCEPTION 'You already have 3 requests waiting for a driver. Please wait or cancel one.';
  END IF;
  SELECT count(*) INTO hour_count FROM public.bookings
    WHERE customer_id = auth.uid() AND created_at > now() - interval '1 hour';
  IF hour_count >= 15 THEN
    RAISE EXCEPTION 'Too many booking attempts. Please try again later.';
  END IF;

  NEW.status := 'pending'::booking_status;
  NEW.payment_status := 'pending'::payment_status;
  NEW.commission_rate := 0.10;
  NEW.commission_amount := 0;
  NEW.driver_net_earning := 0;
  NEW.driver_id := NULL;
  NEW.pickup_verified_at := NULL;
  NEW.drop_verified_at := NULL;
  NEW.rating := NULL;
  NEW.review := NULL;
  NEW.pod_photo_url := NULL;

  SELECT r.base, r.per_km INTO base, per_km FROM (
    VALUES
      ('tata_ace'::vehicle_type, 150::numeric, 22::numeric),
      ('pickup_8ft'::vehicle_type, 220::numeric, 28::numeric),
      ('tata_407'::vehicle_type, 350::numeric, 38::numeric)
  ) AS r(vt, base, per_km) WHERE r.vt = NEW.vehicle_type;

  NEW.distance_km := GREATEST(COALESCE(NEW.distance_km, 0), 0);
  gross := round(base + per_km * NEW.distance_km);

  IF NEW.coupon_code IS NOT NULL AND btrim(NEW.coupon_code) <> '' THEN
    -- Lock the coupon row so concurrent bookings cannot exceed max_uses.
    SELECT * INTO c FROM public.coupons
      WHERE upper(code) = upper(btrim(NEW.coupon_code)) AND active = true
      FOR UPDATE;
    IF FOUND THEN
      SELECT * INTO cpn FROM public.validate_coupon(c.code, gross, NEW.customer_id);
    END IF;
    IF FOUND AND cpn.message = 'ok' AND cpn.discount > 0 THEN
      NEW.coupon_code := cpn.code;
      NEW.coupon_discount := cpn.discount;
    ELSE
      NEW.coupon_code := NULL;
      NEW.coupon_discount := 0;
    END IF;
  ELSE
    NEW.coupon_code := NULL;
    NEW.coupon_discount := 0;
  END IF;

  SELECT coins_balance INTO bal FROM public.wallet_accounts WHERE user_id = NEW.customer_id;
  coin_cap := LEAST(floor(gross * 0.5), COALESCE(bal, 0));
  NEW.coins_redeemed := GREATEST(LEAST(COALESCE(NEW.coins_redeemed, 0), coin_cap), 0);

  disc := NEW.coupon_discount + NEW.coins_redeemed;
  NEW.fare := GREATEST(gross - disc, 0);

  RETURN NEW;
END $function$;

-- Record the redemption after the row exists (booking_id is a FK to bookings).
CREATE OR REPLACE FUNCTION public.bookings_record_coupon_redemption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.coupon_code IS NULL OR COALESCE(NEW.coupon_discount, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.coupon_redemptions (coupon_code, user_id, booking_id, discount)
  VALUES (NEW.coupon_code, NEW.customer_id, NEW.id, NEW.coupon_discount);
  UPDATE public.coupons SET uses = uses + 1 WHERE upper(code) = upper(NEW.coupon_code);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS zzzz_bookings_record_coupon_redemption ON public.bookings;
CREATE TRIGGER zzzz_bookings_record_coupon_redemption
AFTER INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_record_coupon_redemption();

-- 2) Customers may cancel a trip that has already started (25% charge in-app).
CREATE OR REPLACE FUNCTION public.enforce_booking_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    IF NEW.customer_id = uid AND OLD.status IN ('pending'::public.booking_status, 'accepted'::public.booking_status, 'in_progress'::public.booking_status) THEN RETURN NEW; END IF;
    IF NEW.driver_id = uid AND OLD.status = 'accepted'::public.booking_status THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'This booking cannot be cancelled by this user at its current stage';
  END IF;
  RAISE EXCEPTION 'Invalid booking status transition: % -> %', OLD.status, NEW.status;
END $function$;

-- 3) Backfill a validity window for existing waiting requests.
UPDATE public.bookings
   SET expires_at = created_at + interval '30 minutes'
 WHERE expires_at IS NULL AND status = 'pending'::booking_status;
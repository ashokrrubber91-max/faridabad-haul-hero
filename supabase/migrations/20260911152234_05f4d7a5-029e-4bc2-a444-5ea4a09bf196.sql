-- ============ 1. Coupon per-customer limits ============
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS max_uses_per_user integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code text NOT NULL,
  user_id uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  discount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);
GRANT SELECT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Coupon redemptions: read own" ON public.coupon_redemptions;
CREATE POLICY "Coupon redemptions: read own" ON public.coupon_redemptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user ON public.coupon_redemptions (user_id, coupon_code);

CREATE OR REPLACE FUNCTION public.validate_coupon(_code text, _fare numeric, _user_id uuid)
 RETURNS TABLE(code text, discount numeric, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE c public.coupons%ROWTYPE; d numeric; used int;
BEGIN
  SELECT * INTO c FROM public.coupons WHERE upper(coupons.code) = upper(_code) AND active = true;
  IF NOT FOUND THEN RETURN QUERY SELECT _code, 0::numeric, 'Invalid code'; RETURN; END IF;
  IF c.expires_at IS NOT NULL AND c.expires_at < now() THEN RETURN QUERY SELECT _code, 0::numeric, 'Expired'; RETURN; END IF;
  IF c.max_uses IS NOT NULL AND c.uses >= c.max_uses THEN RETURN QUERY SELECT _code, 0::numeric, 'Fully redeemed'; RETURN; END IF;
  IF _user_id IS NOT NULL AND c.max_uses_per_user IS NOT NULL THEN
    SELECT count(*) INTO used FROM public.coupon_redemptions r
      WHERE r.user_id = _user_id AND upper(r.coupon_code) = upper(c.code);
    IF used >= c.max_uses_per_user THEN
      RETURN QUERY SELECT _code, 0::numeric, 'You have already used this code'; RETURN;
    END IF;
  END IF;
  IF _fare < c.min_fare THEN RETURN QUERY SELECT _code, 0::numeric, format('Min fare ₹%s', c.min_fare); RETURN; END IF;
  d := CASE WHEN c.kind = 'flat' THEN c.value ELSE round(_fare * c.value / 100.0) END;
  IF c.max_discount IS NOT NULL THEN d := LEAST(d, c.max_discount); END IF;
  d := LEAST(d, _fare);
  RETURN QUERY SELECT c.code, d, 'ok';
END $fn$;

CREATE OR REPLACE FUNCTION public.validate_coupon(_code text, _fare numeric)
 RETURNS TABLE(code text, discount numeric, message text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT * FROM public.validate_coupon(_code, _fare, auth.uid())
$fn$;

-- fare/coupon enforcement must use the per-customer aware check
CREATE OR REPLACE FUNCTION public.bookings_enforce_insert_financials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  base numeric; per_km numeric; gross numeric; disc numeric := 0; cpn record;
  coin_cap numeric; bal numeric; pending_count int; hour_count int;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only book for your own account';
  END IF;

  -- Abuse controls
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
    SELECT * INTO cpn FROM public.validate_coupon(NEW.coupon_code, gross, NEW.customer_id);
    IF cpn.message = 'ok' THEN
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
END $fn$;

-- record redemption atomically on completion
CREATE OR REPLACE FUNCTION public.bookings_award_coins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE award numeric; commission numeric; net numeric;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    award := round(NEW.fare * 0.02);
    INSERT INTO public.wallet_accounts(user_id, coins_balance) VALUES (NEW.customer_id, award)
      ON CONFLICT (user_id) DO UPDATE SET coins_balance = wallet_accounts.coins_balance + award, updated_at = now();
    INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
      VALUES (NEW.customer_id, NEW.id, award, 'Earned on trip');
    IF NEW.coins_redeemed > 0 THEN
      INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
        VALUES (NEW.customer_id, NEW.id, -NEW.coins_redeemed, 'Redeemed on trip');
    END IF;
    IF NEW.coupon_code IS NOT NULL THEN
      UPDATE public.coupons SET uses = uses + 1
        WHERE upper(code) = upper(NEW.coupon_code)
          AND active = true
          AND (max_uses IS NULL OR uses < max_uses);
      IF NOT FOUND THEN RAISE EXCEPTION 'Coupon is no longer available'; END IF;
      INSERT INTO public.coupon_redemptions(coupon_code, user_id, booking_id, discount)
        VALUES (upper(NEW.coupon_code), NEW.customer_id, NEW.id, COALESCE(NEW.coupon_discount, 0))
        ON CONFLICT (booking_id) DO NOTHING;
    END IF;
    IF NEW.driver_id IS NOT NULL THEN
      commission := round(NEW.fare * COALESCE(NEW.commission_rate, 0.10));
      net := NEW.fare - commission;
      NEW.commission_amount := commission;
      NEW.driver_net_earning := net;
      INSERT INTO public.wallet_accounts(user_id, coins_balance) VALUES (NEW.driver_id, 0)
        ON CONFLICT (user_id) DO NOTHING;
      IF NEW.payment_method = 'cod' THEN
        UPDATE public.wallet_accounts SET cash_balance = cash_balance - commission, updated_at = now() WHERE user_id = NEW.driver_id;
        INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
          VALUES (NEW.driver_id, NEW.id, -commission, 'Miniport commission (cash trip)');
      ELSE
        UPDATE public.wallet_accounts SET cash_balance = cash_balance + net, updated_at = now() WHERE user_id = NEW.driver_id;
        INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
          VALUES (NEW.driver_id, NEW.id, net, 'Trip earning (online payment)');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

-- ============ 2. One active ride per driver ============
CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
 RETURNS public.bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
  v_booking.pickup_otp := NULL;
  v_booking.drop_otp := NULL;
  RETURN v_booking;
END;
$fn$;

-- ============ 3. GPS sanity bounds (India) ============
CREATE OR REPLACE FUNCTION public.driver_locations_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.driver_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only report your own location';
  END IF;
  IF NEW.latitude IS NULL OR NEW.longitude IS NULL
     OR NEW.latitude < -90 OR NEW.latitude > 90
     OR NEW.longitude < -180 OR NEW.longitude > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;
  IF NEW.latitude < 6 OR NEW.latitude > 37.5 OR NEW.longitude < 68 OR NEW.longitude > 97.5 THEN
    RAISE EXCEPTION 'Location outside the service country';
  END IF;
  IF NEW.accuracy_m IS NOT NULL AND (NEW.accuracy_m < 0 OR NEW.accuracy_m > 5000) THEN
    NEW.accuracy_m := NULL;
  END IF;
  IF NEW.speed_mps IS NOT NULL AND (NEW.speed_mps < 0 OR NEW.speed_mps > 70) THEN
    NEW.speed_mps := NULL;
  END IF;
  IF NEW.heading_deg IS NOT NULL AND (NEW.heading_deg < 0 OR NEW.heading_deg > 360) THEN
    NEW.heading_deg := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

-- ============ 4. Payment webhook event de-duplication ============
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Webhook events: admin read" ON public.webhook_events;
CREATE POLICY "Webhook events: admin read" ON public.webhook_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
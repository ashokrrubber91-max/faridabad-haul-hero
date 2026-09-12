-- ============================================================
-- 1. Vehicle catalogue
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vehicle_types (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{3,40}$'),
  label text NOT NULL CHECK (btrim(label) <> ''),
  capacity_label text NOT NULL DEFAULT '',
  weight_limit_kg integer CHECK (weight_limit_kg IS NULL OR weight_limit_kg > 0),
  load_area text NOT NULL DEFAULT '',
  good_for text[] NOT NULL DEFAULT '{}',
  image_url text,
  base_fare numeric NOT NULL DEFAULT 0 CHECK (base_fare >= 0 AND base_fare <= 100000),
  per_km_fare numeric NOT NULL DEFAULT 0 CHECK (per_km_fare >= 0 AND per_km_fare <= 10000),
  free_loading_minutes integer NOT NULL DEFAULT 60 CHECK (free_loading_minutes >= 0 AND free_loading_minutes <= 480),
  free_unloading_minutes integer NOT NULL DEFAULT 30 CHECK (free_unloading_minutes >= 0 AND free_unloading_minutes <= 480),
  overtime_rate_per_min numeric NOT NULL DEFAULT 2 CHECK (overtime_rate_per_min >= 0 AND overtime_rate_per_min <= 100),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.vehicle_types TO authenticated;
GRANT SELECT ON public.vehicle_types TO anon;
GRANT ALL ON public.vehicle_types TO service_role;
ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vehicle catalogue is readable" ON public.vehicle_types;
CREATE POLICY "Vehicle catalogue is readable" ON public.vehicle_types FOR SELECT USING (true);

DROP TRIGGER IF EXISTS vehicle_types_touch ON public.vehicle_types;
CREATE TRIGGER vehicle_types_touch BEFORE UPDATE ON public.vehicle_types
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed with the exact rates and copy that are live in the app today.
INSERT INTO public.vehicle_types
  (id, label, capacity_label, weight_limit_kg, load_area, good_for, base_fare, per_km_fare,
   free_loading_minutes, free_unloading_minutes, overtime_rate_per_min, active, sort_order)
VALUES
  ('tata_ace', 'Tata Ace (Chhota Hathi)', '750 kg', 750, '6.5 x 4.5 ft open bed',
   ARRAY['Small household shifting','Boxes & cartons','Appliances'], 150, 22, 90, 45, 2, true, 10),
  ('pickup_8ft', 'Pickup 8ft', '1.2 ton', 1200, '8 x 5 ft open bed',
   ARRAY['Furniture','Construction material','Multi-room shifting'], 220, 28, 60, 30, 2, true, 20),
  ('tata_407', 'Tata 407', '2.5 ton', 2500, '9 x 5.5 ft closed body',
   ARRAY['Bulk goods','Commercial cargo','Office relocation'], 350, 38, 60, 30, 2, true, 30),
  ('bike_delivery', 'Bike Delivery', '20 kg', 20, 'Rear carrier + delivery bag',
   ARRAY['Documents','Food & parcels','Small urgent items'], 40, 9, 15, 10, 1, false, 5)
ON CONFLICT (id) DO NOTHING;

-- Bookings/driver vehicle fields become catalogue references so new vehicle
-- types need no code change. The old enum type is left in place untouched.
ALTER TABLE public.bookings ALTER COLUMN vehicle_type TYPE text USING vehicle_type::text;
ALTER TABLE public.driver_profiles ALTER COLUMN vehicle_type TYPE text USING vehicle_type::text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_vehicle_type_fkey') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_vehicle_type_fkey
      FOREIGN KEY (vehicle_type) REFERENCES public.vehicle_types(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vehicle_types_active_sort_idx ON public.vehicle_types (active, sort_order);

DROP TRIGGER IF EXISTS vehicle_types_audit ON public.vehicle_types;
CREATE TRIGGER vehicle_types_audit AFTER INSERT OR UPDATE ON public.vehicle_types
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row();

-- ============================================================
-- 2. Platform settings (commission)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  commission_rate numeric NOT NULL DEFAULT 0.10 CHECK (commission_rate >= 0 AND commission_rate <= 0.50),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Settings readable by signed-in users" ON public.platform_settings;
CREATE POLICY "Settings readable by signed-in users" ON public.platform_settings
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.platform_settings (id, commission_rate) VALUES (true, 0.10)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS platform_settings_touch ON public.platform_settings;
CREATE TRIGGER platform_settings_touch BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS platform_settings_audit ON public.platform_settings;
CREATE TRIGGER platform_settings_audit AFTER UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row();

-- ============================================================
-- 3. Loading / unloading overtime columns
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS loading_overtime_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unloading_overtime_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_fare numeric;

-- Timestamps for the loading workflow are no longer client-writable: they are
-- set only by set_booking_stage() / OTP verification on the server.
REVOKE UPDATE (loading_started_at, loading_stopped_at, unloading_started_at, unloading_stopped_at)
  ON public.bookings FROM authenticated;

-- ============================================================
-- 4. Fare configuration now drives insert pricing
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookings_enforce_insert_financials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  base numeric; per_km numeric; gross numeric; disc numeric := 0; cpn record;
  coin_cap numeric; bal numeric; pending_count int; hour_count int; c public.coupons%ROWTYPE;
  v_rate numeric;
BEGIN
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
  SELECT s.commission_rate INTO v_rate FROM public.platform_settings s WHERE s.id;
  NEW.commission_rate := COALESCE(v_rate, 0.10);
  NEW.commission_amount := 0;
  NEW.driver_net_earning := 0;
  NEW.driver_id := NULL;
  NEW.pickup_verified_at := NULL;
  NEW.drop_verified_at := NULL;
  NEW.rating := NULL;
  NEW.review := NULL;
  NEW.pod_photo_url := NULL;
  NEW.loading_started_at := NULL;
  NEW.loading_stopped_at := NULL;
  NEW.unloading_started_at := NULL;
  NEW.unloading_stopped_at := NULL;
  NEW.loading_overtime_minutes := 0;
  NEW.unloading_overtime_minutes := 0;
  NEW.overtime_charge := 0;
  NEW.final_fare := NULL;

  -- Only a vehicle that is currently offered can be booked; pricing always comes
  -- from the catalogue, never from the browser.
  SELECT v.base_fare, v.per_km_fare INTO base, per_km
    FROM public.vehicle_types v WHERE v.id = NEW.vehicle_type AND v.active;
  IF base IS NULL THEN
    RAISE EXCEPTION 'This vehicle is not available for booking';
  END IF;

  NEW.distance_km := GREATEST(COALESCE(NEW.distance_km, 0), 0);
  gross := round(base + per_km * NEW.distance_km);

  IF NEW.coupon_code IS NOT NULL AND btrim(NEW.coupon_code) <> '' THEN
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

-- ============================================================
-- 5. Financial protection covers the new columns
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookings_protect_financials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); trusted boolean := public.is_trusted_booking_write();
BEGIN
  IF uid IS NULL OR public.has_role(uid, 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Settlement values may only change through trusted server routines.
  IF NOT trusted THEN
    NEW.fare := OLD.fare;
    NEW.loading_overtime_minutes := OLD.loading_overtime_minutes;
    NEW.unloading_overtime_minutes := OLD.unloading_overtime_minutes;
    NEW.overtime_charge := OLD.overtime_charge;
    NEW.final_fare := OLD.final_fare;
    NEW.loading_started_at := OLD.loading_started_at;
    NEW.loading_stopped_at := OLD.loading_stopped_at;
    NEW.unloading_started_at := OLD.unloading_started_at;
    NEW.unloading_stopped_at := OLD.unloading_stopped_at;
    NEW.pickup_verified_at := OLD.pickup_verified_at;
    NEW.drop_verified_at := OLD.drop_verified_at;
    NEW.pod_photo_url := OLD.pod_photo_url;
    NEW.service_zone := OLD.service_zone;
    NEW.expires_at := OLD.expires_at;
  END IF;

  NEW.coupon_code := OLD.coupon_code;
  NEW.coupon_discount := OLD.coupon_discount;
  NEW.coins_redeemed := OLD.coins_redeemed;
  NEW.commission_rate := OLD.commission_rate;
  NEW.payment_method := OLD.payment_method;
  NEW.distance_km := OLD.distance_km;
  NEW.customer_id := OLD.customer_id;
  NEW.vehicle_type := OLD.vehicle_type;

  IF NOT trusted THEN
    NEW.commission_amount := OLD.commission_amount;
    NEW.driver_net_earning := OLD.driver_net_earning;
    NEW.payment_status := OLD.payment_status;
  END IF;

  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     AND NOT trusted
     AND NOT (
       OLD.driver_id IS NULL
       AND NEW.driver_id = uid
       AND public.has_role(uid, 'driver'::app_role)
     )
  THEN
    NEW.driver_id := OLD.driver_id;
  END IF;

  RETURN NEW;
END $function$;

-- ============================================================
-- 6. Loading / unloading workflow
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_booking_stage(_booking_id uuid, _action text)
 RETURNS public.bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b public.bookings; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF _action NOT IN ('start_loading','stop_loading','start_unloading','stop_unloading') THEN
    RAISE EXCEPTION 'Unknown action';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.driver_id IS DISTINCT FROM uid AND NOT public.has_role(uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the assigned driver can update this trip';
  END IF;
  IF b.cancelled_at IS NOT NULL OR b.status IN ('completed'::booking_status,'cancelled'::booking_status,'expired'::booking_status) THEN
    RAISE EXCEPTION 'Trip is already closed';
  END IF;

  PERFORM set_config('miniport.trusted_write', 'on', true);

  IF _action = 'start_loading' THEN
    IF b.status <> 'accepted'::booking_status THEN RAISE EXCEPTION 'Loading can only start before pickup verification'; END IF;
    IF b.loading_started_at IS NOT NULL THEN RETURN b; END IF;
    UPDATE public.bookings SET loading_started_at = now() WHERE id = _booking_id RETURNING * INTO b;
  ELSIF _action = 'stop_loading' THEN
    IF b.loading_started_at IS NULL THEN RAISE EXCEPTION 'Start loading first'; END IF;
    IF b.loading_stopped_at IS NOT NULL THEN RETURN b; END IF;
    UPDATE public.bookings SET loading_stopped_at = now() WHERE id = _booking_id RETURNING * INTO b;
  ELSIF _action = 'start_unloading' THEN
    IF b.status <> 'in_progress'::booking_status THEN RAISE EXCEPTION 'Unloading can only start after the trip has started'; END IF;
    IF b.unloading_started_at IS NOT NULL THEN RETURN b; END IF;
    UPDATE public.bookings SET unloading_started_at = now() WHERE id = _booking_id RETURNING * INTO b;
  ELSE
    IF b.unloading_started_at IS NULL THEN RAISE EXCEPTION 'Start unloading first'; END IF;
    IF b.unloading_stopped_at IS NOT NULL THEN RETURN b; END IF;
    UPDATE public.bookings SET unloading_stopped_at = now() WHERE id = _booking_id RETURNING * INTO b;
  END IF;

  PERFORM set_config('miniport.trusted_write', 'off', true);
  RETURN b;
END $function$;

REVOKE ALL ON FUNCTION public.set_booking_stage(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_booking_stage(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_booking_stage(uuid, text) TO authenticated;

-- Overtime is calculated on the server from the recorded stage timestamps and
-- the vehicle's own free allowances. Driving time is never included.
CREATE OR REPLACE FUNCTION public.booking_overtime(_booking public.bookings)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE fl int; fu int; rate numeric; l_min int := 0; u_min int := 0; l_ot int := 0; u_ot int := 0;
BEGIN
  SELECT free_loading_minutes, free_unloading_minutes, overtime_rate_per_min
    INTO fl, fu, rate FROM public.vehicle_types WHERE id = _booking.vehicle_type;
  fl := COALESCE(fl, 60); fu := COALESCE(fu, 30); rate := COALESCE(rate, 2);

  IF _booking.loading_started_at IS NOT NULL THEN
    l_min := GREATEST(0, ceil(extract(epoch FROM (COALESCE(_booking.loading_stopped_at, now()) - _booking.loading_started_at)) / 60.0)::int);
    l_ot := GREATEST(0, l_min - fl);
  END IF;
  IF _booking.unloading_started_at IS NOT NULL THEN
    u_min := GREATEST(0, ceil(extract(epoch FROM (COALESCE(_booking.unloading_stopped_at, now()) - _booking.unloading_started_at)) / 60.0)::int);
    u_ot := GREATEST(0, u_min - fu);
  END IF;

  RETURN jsonb_build_object(
    'free_loading_minutes', fl, 'free_unloading_minutes', fu, 'rate_per_min', rate,
    'loading_minutes', l_min, 'unloading_minutes', u_min,
    'loading_overtime_minutes', l_ot, 'unloading_overtime_minutes', u_ot,
    'overtime_charge', round((l_ot + u_ot) * rate));
END $function$;

REVOKE ALL ON FUNCTION public.booking_overtime(public.bookings) FROM PUBLIC;

-- ============================================================
-- 7. OTP verification settles overtime exactly once
-- ============================================================
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
  ot jsonb;
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
    -- Stop the unloading clock, then settle the waiting charge once.
    UPDATE public.bookings
      SET unloading_stopped_at = COALESCE(unloading_stopped_at, now())
      WHERE id = _booking_id RETURNING * INTO b;

    ot := public.booking_overtime(b);

    UPDATE public.bookings
      SET drop_verified_at = now(),
          status = 'completed'::public.booking_status,
          loading_overtime_minutes = (ot->>'loading_overtime_minutes')::int,
          unloading_overtime_minutes = (ot->>'unloading_overtime_minutes')::int,
          overtime_charge = (ot->>'overtime_charge')::numeric,
          fare = fare + (ot->>'overtime_charge')::numeric,
          final_fare = fare + (ot->>'overtime_charge')::numeric
      WHERE id = _booking_id AND drop_verified_at IS NULL
      RETURNING * INTO b;
    IF NOT FOUND THEN
      SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
    END IF;
  END IF;
  PERFORM set_config('miniport.trusted_write', 'off', true);

  RETURN jsonb_build_object('ok', true, 'stage', _stage, 'status', b.status::text, 'booking_id', b.id,
                            'overtime_charge', COALESCE(b.overtime_charge, 0), 'final_fare', COALESCE(b.final_fare, b.fare));
END $function$;

-- ============================================================
-- 8. Admin configuration routines
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle_type(
  _id text, _label text, _capacity_label text, _weight_limit_kg integer, _load_area text,
  _good_for text[], _base_fare numeric, _per_km_fare numeric,
  _free_loading_minutes integer, _free_unloading_minutes integer,
  _overtime_rate_per_min numeric, _active boolean, _sort_order integer, _image_url text DEFAULT NULL)
 RETURNS public.vehicle_types
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.vehicle_types; clean_id text := lower(btrim(COALESCE(_id, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change the vehicle catalogue';
  END IF;
  IF clean_id !~ '^[a-z0-9_]{3,40}$' THEN
    RAISE EXCEPTION 'Vehicle id must be 3-40 lowercase letters, numbers or underscores';
  END IF;
  IF btrim(COALESCE(_label, '')) = '' THEN RAISE EXCEPTION 'Vehicle name is required'; END IF;

  INSERT INTO public.vehicle_types AS t (id, label, capacity_label, weight_limit_kg, load_area, good_for,
      base_fare, per_km_fare, free_loading_minutes, free_unloading_minutes,
      overtime_rate_per_min, active, sort_order, image_url)
  VALUES (clean_id, btrim(_label), COALESCE(btrim(_capacity_label), ''), _weight_limit_kg,
      COALESCE(btrim(_load_area), ''), COALESCE(_good_for, '{}'), COALESCE(_base_fare, 0), COALESCE(_per_km_fare, 0),
      COALESCE(_free_loading_minutes, 60), COALESCE(_free_unloading_minutes, 30),
      COALESCE(_overtime_rate_per_min, 2), COALESCE(_active, true), COALESCE(_sort_order, 100),
      NULLIF(btrim(COALESCE(_image_url, '')), ''))
  ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      capacity_label = EXCLUDED.capacity_label,
      weight_limit_kg = EXCLUDED.weight_limit_kg,
      load_area = EXCLUDED.load_area,
      good_for = EXCLUDED.good_for,
      base_fare = EXCLUDED.base_fare,
      per_km_fare = EXCLUDED.per_km_fare,
      free_loading_minutes = EXCLUDED.free_loading_minutes,
      free_unloading_minutes = EXCLUDED.free_unloading_minutes,
      overtime_rate_per_min = EXCLUDED.overtime_rate_per_min,
      active = EXCLUDED.active,
      sort_order = EXCLUDED.sort_order,
      image_url = COALESCE(EXCLUDED.image_url, t.image_url)
  RETURNING * INTO v;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.admin_upsert_vehicle_type(text,text,text,integer,text,text[],numeric,numeric,integer,integer,numeric,boolean,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_vehicle_type(text,text,text,integer,text,text[],numeric,numeric,integer,integer,numeric,boolean,integer,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle_type(text,text,text,integer,text,text[],numeric,numeric,integer,integer,numeric,boolean,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_vehicle_active(_id text, _active boolean)
 RETURNS public.vehicle_types
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.vehicle_types;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change the vehicle catalogue';
  END IF;
  UPDATE public.vehicle_types SET active = COALESCE(_active, true) WHERE id = _id RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.admin_set_vehicle_active(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_vehicle_active(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_vehicle_active(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_commission_rate(_rate numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change the commission rate';
  END IF;
  IF _rate IS NULL OR _rate < 0 OR _rate > 0.5 THEN
    RAISE EXCEPTION 'Commission must be between 0 and 50 percent';
  END IF;
  UPDATE public.platform_settings SET commission_rate = _rate, updated_by = auth.uid() WHERE id
    RETURNING commission_rate INTO v;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.admin_set_commission_rate(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_commission_rate(numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_commission_rate(numeric) TO authenticated;

-- ============================================================
-- 9. In-app notifications and broadcasts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('customer','driver','all')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text NOT NULL CHECK (btrim(body) <> ''),
  recipient_count integer NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT 'in_app',
  sms_status text NOT NULL DEFAULT 'not_configured' CHECK (sms_status IN ('not_configured','queued','sent','failed')),
  idempotency_key text UNIQUE,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.broadcasts TO authenticated;
GRANT ALL ON public.broadcasts TO service_role;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read broadcasts" ON public.broadcasts;
CREATE POLICY "Admins read broadcasts" ON public.broadcasts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broadcast_id uuid REFERENCES public.broadcasts(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL DEFAULT 'broadcast',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "People read their own notifications" ON public.notifications;
CREATE POLICY "People read their own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "People mark their own notifications read" ON public.notifications;
CREATE POLICY "People mark their own notifications read" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications (user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_broadcast_idx ON public.notifications (broadcast_id);

CREATE OR REPLACE FUNCTION public.admin_send_broadcast(
  _audience text, _title text, _body text, _idempotency_key text DEFAULT NULL)
 RETURNS public.broadcasts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE bc public.broadcasts; n int := 0; key text := NULLIF(btrim(COALESCE(_idempotency_key, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can send broadcasts';
  END IF;
  IF _audience NOT IN ('customer','driver','all') THEN RAISE EXCEPTION 'Choose a valid audience'; END IF;
  IF btrim(COALESCE(_title, '')) = '' OR btrim(COALESCE(_body, '')) = '' THEN
    RAISE EXCEPTION 'Title and message are both required';
  END IF;

  IF key IS NOT NULL THEN
    SELECT * INTO bc FROM public.broadcasts WHERE idempotency_key = key;
    IF FOUND THEN RETURN bc; END IF;
  END IF;

  INSERT INTO public.broadcasts (audience, title, body, idempotency_key, created_by)
  VALUES (_audience, left(btrim(_title), 120), left(btrim(_body), 1000), key, auth.uid())
  RETURNING * INTO bc;

  WITH targets AS (
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
    WHERE (_audience = 'all' AND ur.role IN ('customer'::app_role, 'driver'::app_role))
       OR (_audience = 'customer' AND ur.role = 'customer'::app_role)
       OR (_audience = 'driver' AND ur.role = 'driver'::app_role)
  ), inserted AS (
    INSERT INTO public.notifications (user_id, broadcast_id, title, body, kind)
    SELECT t.user_id, bc.id, bc.title, bc.body, 'broadcast' FROM targets t
    RETURNING 1
  )
  SELECT count(*) INTO n FROM inserted;

  UPDATE public.broadcasts SET recipient_count = n WHERE id = bc.id RETURNING * INTO bc;
  RETURN bc;
END $function$;

REVOKE ALL ON FUNCTION public.admin_send_broadcast(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_send_broadcast(text,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast(text,text,text,text) TO authenticated;

-- ============================================================
-- 10. Vehicle photo storage rules (bucket created separately)
-- ============================================================
DROP POLICY IF EXISTS "Vehicle photos are publicly readable" ON storage.objects;
CREATE POLICY "Vehicle photos are publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'vehicle-images');

DROP POLICY IF EXISTS "Admins upload vehicle photos" ON storage.objects;
CREATE POLICY "Admins upload vehicle photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vehicle-images' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins replace vehicle photos" ON storage.objects;
CREATE POLICY "Admins replace vehicle photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vehicle-images' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'vehicle-images' AND public.has_role(auth.uid(), 'admin'::app_role));
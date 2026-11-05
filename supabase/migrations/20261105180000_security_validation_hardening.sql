-- Prepared security and business-rule hardening. This migration has NOT been applied.
-- It changes schema/functions/policies only; it does not rewrite existing customer,
-- booking, payment, wallet, referral or dispatch records.
BEGIN;

-- Repair a helper already referenced by live booking protection triggers.
CREATE OR REPLACE FUNCTION public.is_trusted_booking_write()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(current_setting('miniport.trusted_write', true), '') = 'on';
$$;
REVOKE ALL ON FUNCTION public.is_trusted_booking_write() FROM PUBLIC, anon, authenticated;

-- OTP attempt state is private to server-side verification functions.
CREATE TABLE IF NOT EXISTS public.booking_otp_attempts (
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('pickup', 'drop')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, stage)
);
ALTER TABLE public.booking_otp_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_otp_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.booking_otp_attempts TO service_role;

-- Customer-only OTP retrieval. Drivers can submit a code but cannot read it.
CREATE OR REPLACE FUNCTION public.get_booking_otps(_booking_id uuid)
RETURNS TABLE (pickup_otp text, drop_otp text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.bookings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF b.customer_id IS DISTINCT FROM v_uid
     AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorized to view trip codes' USING ERRCODE = '42501';
  END IF;
  IF b.status NOT IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status) THEN
    RETURN QUERY SELECT ''::text, ''::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT
    COALESCE(CASE WHEN b.pickup_verified_at IS NULL THEN b.pickup_otp END, ''),
    COALESCE(CASE WHEN b.pickup_verified_at IS NOT NULL AND b.drop_verified_at IS NULL THEN b.drop_otp END, '');
END;
$$;
REVOKE ALL ON FUNCTION public.get_booking_otps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_otps(uuid) TO authenticated;

-- Contact details are available only to the customer or the assigned driver.
CREATE OR REPLACE FUNCTION public.booking_contacts(_booking_ids uuid[])
RETURNS TABLE (booking_id uuid, counterpart_id uuid, name text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.id,
         CASE WHEN b.customer_id = auth.uid() THEN b.driver_id ELSE b.customer_id END,
         CASE WHEN b.customer_id = auth.uid() THEN COALESCE(d.name, '') ELSE COALESCE(c.name, '') END,
         CASE WHEN b.customer_id = auth.uid() THEN COALESCE(d.phone, '') ELSE COALESCE(c.phone, '') END
  FROM public.bookings b
  LEFT JOIN public.profiles c ON c.id = b.customer_id
  LEFT JOIN public.profiles d ON d.id = b.driver_id
  WHERE b.id = ANY(_booking_ids)
    AND auth.uid() IS NOT NULL
    AND (
      b.customer_id = auth.uid()
      OR b.driver_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
    AND (b.driver_id IS NOT NULL OR b.customer_id <> auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));
$$;
REVOKE ALL ON FUNCTION public.booking_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_contacts(uuid[]) TO authenticated;

-- Contact details are scoped to the customer, assigned driver or admin only.
CREATE OR REPLACE FUNCTION public.booking_contacts(_booking_ids uuid[])
RETURNS TABLE (booking_id uuid, counterpart_id uuid, name text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $
  SELECT b.id,
         CASE WHEN b.customer_id = auth.uid() THEN b.driver_id ELSE b.customer_id END,
         CASE WHEN b.customer_id = auth.uid() THEN COALESCE(d.name, '') ELSE COALESCE(c.name, '') END,
         CASE WHEN b.customer_id = auth.uid() THEN COALESCE(d.phone, '') ELSE COALESCE(c.phone, '') END
  FROM public.bookings b
  LEFT JOIN public.profiles c ON c.id = b.customer_id
  LEFT JOIN public.profiles d ON d.id = b.driver_id
  WHERE b.id = ANY(_booking_ids)
    AND auth.uid() IS NOT NULL
    AND (
      b.customer_id = auth.uid()
      OR b.driver_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
    AND (b.driver_id IS NOT NULL OR b.customer_id <> auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));
$;
REVOKE ALL ON FUNCTION public.booking_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_contacts(uuid[]) TO authenticated;

-- Server-side OTP verification with a five-attempt / ten-minute lockout.
CREATE OR REPLACE FUNCTION public.verify_booking_otp(_booking_id uuid, _stage text, _otp text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.bookings%ROWTYPE;
  v_expected text;
  v_clean text := regexp_replace(COALESCE(_otp, ''), '[^0-9]', '', 'g');
  v_attempts integer := 0;
  v_locked_until timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'driver'::public.app_role)
     OR NOT public.is_kyc_approved(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only an approved driver can verify trip codes');
  END IF;
  IF _stage NOT IN ('pickup', 'drop') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Invalid verification stage');
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND OR b.driver_id IS DISTINCT FROM v_uid OR b.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Trip is not assigned to this driver');
  END IF;

  IF _stage = 'pickup' THEN
    IF b.status <> 'accepted'::public.booking_status OR b.pickup_verified_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Pickup verification is not available');
    END IF;
    v_expected := b.pickup_otp;
  ELSE
    IF b.status <> 'in_progress'::public.booking_status OR b.drop_verified_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Drop verification is not available');
    END IF;
    IF NULLIF(b.pod_photo_url, '') IS NULL OR NULLIF(b.pod_signature_url, '') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'message', 'Upload delivery photo and receiver signature first');
    END IF;
    v_expected := b.drop_otp;
  END IF;

  SELECT locked_until INTO v_locked_until
  FROM public.booking_otp_attempts
  WHERE booking_id = _booking_id AND stage = _stage
  FOR UPDATE;
  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Too many incorrect codes. Try again later');
  END IF;

  IF length(v_clean) <> 4 OR v_expected IS NULL OR v_clean <> v_expected THEN
    INSERT INTO public.booking_otp_attempts (booking_id, stage, attempts, locked_until, updated_at)
    VALUES (_booking_id, _stage, 1, NULL, now())
    ON CONFLICT (booking_id, stage) DO UPDATE
      SET attempts = public.booking_otp_attempts.attempts + 1,
          locked_until = CASE
            WHEN public.booking_otp_attempts.attempts + 1 >= 5 THEN now() + interval '10 minutes'
            ELSE NULL
          END,
          updated_at = now()
    RETURNING attempts, locked_until INTO v_attempts, v_locked_until;
    RETURN jsonb_build_object(
      'ok', false,
      'message', CASE WHEN v_attempts >= 5 THEN 'Too many incorrect codes. Try again in 10 minutes' ELSE 'Incorrect code. Please check with the customer' END,
      'attempts_remaining', GREATEST(5 - v_attempts, 0)
    );
  END IF;

  DELETE FROM public.booking_otp_attempts WHERE booking_id = _booking_id AND stage = _stage;
  PERFORM set_config('miniport.trusted_write', 'on', true);
  IF _stage = 'pickup' THEN
    UPDATE public.bookings
       SET pickup_verified_at = now(),
           pickup_otp = NULL,
           status = 'in_progress'::public.booking_status,
           loading_stopped_at = COALESCE(loading_stopped_at, now()),
           updated_at = now()
     WHERE id = _booking_id;
  ELSE
    UPDATE public.bookings
       SET drop_verified_at = now(),
           drop_otp = NULL,
           status = 'completed'::public.booking_status,
           unloading_stopped_at = COALESCE(unloading_stopped_at, now()),
           updated_at = now()
     WHERE id = _booking_id;
  END IF;
  PERFORM set_config('miniport.trusted_write', 'off', true);
  RETURN jsonb_build_object('ok', true, 'stage', _stage, 'booking_id', _booking_id);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_booking_otp(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_booking_otp(uuid, text, text) TO authenticated;

-- Restore the trusted write marker required by existing financial/status guards.
CREATE OR REPLACE FUNCTION public.enforce_booking_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_vehicle_id text;
  v_weight_limit numeric;
BEGIN
  IF v_uid IS NULL OR public.has_role(v_uid, 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF OLD.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    RAISE EXCEPTION 'Closed trips cannot change status' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'pending'::public.booking_status AND NEW.status = 'accepted'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM v_uid
       OR NOT public.has_role(v_uid, 'driver'::public.app_role)
       OR NOT public.is_kyc_approved(v_uid) THEN
      RAISE EXCEPTION 'Only an approved driver can accept this trip' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
    IF NOT FOUND OR v_profile.is_online IS NOT TRUE
       OR v_profile.kyc_status <> 'approved'::public.kyc_status
       OR (v_profile.service_zone IS NOT NULL AND v_profile.service_zone IS DISTINCT FROM NEW.service_zone) THEN
      RAISE EXCEPTION 'Driver must be online, verified and in the service zone' USING ERRCODE = '42501';
    END IF;
    SELECT dk.vehicle_id INTO v_vehicle_id
    FROM public.driver_kyc dk
    WHERE dk.driver_id = v_uid AND dk.status = 'approved'::public.kyc_status;
    IF v_vehicle_id IS DISTINCT FROM NEW.vehicle_type::text THEN
      RAISE EXCEPTION 'Driver vehicle type does not match this booking' USING ERRCODE = '42501';
    END IF;
    SELECT vt.weight_limit_kg INTO v_weight_limit
    FROM public.vehicle_types vt
    WHERE vt.id::text = v_vehicle_id AND vt.active IS TRUE;
    IF NOT FOUND OR (NEW.cargo_weight_kg IS NOT NULL AND
       (v_weight_limit IS NULL OR NEW.cargo_weight_kg > v_weight_limit)) THEN
      RAISE EXCEPTION 'Driver vehicle cannot carry this cargo weight' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.driver_locations dl
      WHERE dl.driver_id = v_uid AND dl.updated_at >= now() - interval '90 seconds'
    ) THEN
      RAISE EXCEPTION 'Fresh driver location is required to accept this trip' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.bookings active
      WHERE active.driver_id = v_uid
        AND active.status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
        AND active.cancelled_at IS NULL AND active.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Finish your current trip before accepting another' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.booking_dispatch_offers o
      WHERE o.booking_id = NEW.id AND o.driver_id = v_uid
        AND o.status = 'offered' AND o.expires_at > now()
    ) THEN
      RAISE EXCEPTION 'An active dispatch offer is required' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'accepted'::public.booking_status AND NEW.status = 'in_progress'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM v_uid
       OR OLD.pickup_verified_at IS NOT NULL
       OR NEW.pickup_verified_at IS NULL
       OR NOT public.is_trusted_booking_write() THEN
      RAISE EXCEPTION 'Pickup OTP verification is required to start a trip' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_progress'::public.booking_status AND NEW.status = 'completed'::public.booking_status THEN
    IF NEW.driver_id IS DISTINCT FROM v_uid
       OR OLD.drop_verified_at IS NOT NULL
       OR NEW.drop_verified_at IS NULL
       OR NOT public.is_trusted_booking_write()
       OR NULLIF(NEW.pod_photo_url, '') IS NULL
       OR NULLIF(NEW.pod_signature_url, '') IS NULL THEN
      RAISE EXCEPTION 'Drop OTP, delivery photo and receiver signature are required' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled'::public.booking_status THEN
    IF length(btrim(COALESCE(NEW.cancellation_reason, ''))) < 3
       OR NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL THEN
      RAISE EXCEPTION 'A cancellation reason is required' USING ERRCODE = '22023';
    END IF;
    IF NEW.customer_id = v_uid
       AND OLD.status IN ('pending'::public.booking_status, 'scheduled'::public.booking_status, 'accepted'::public.booking_status, 'in_progress'::public.booking_status)
       AND NEW.cancelled_by = 'customer'::public.cancel_actor
       AND NEW.cancellation_category = 'customer_cancelled'::public.cancellation_category THEN
      RETURN NEW;
    END IF;
    IF OLD.driver_id = v_uid
       AND OLD.status = 'accepted'::public.booking_status
       AND NEW.cancelled_by = 'driver'::public.cancel_actor
       AND NEW.cancellation_category = 'driver_cancelled'::public.cancellation_category THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Invalid trip status transition: % to %', OLD.status, NEW.status USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_booking_state_machine() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_booking_state_machine ON public.bookings;
CREATE TRIGGER enforce_booking_state_machine
BEFORE UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_state_machine();

-- Purge OTP values and failed-attempt state when a trip is closed.
CREATE OR REPLACE FUNCTION public.purge_closed_booking_otps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    NEW.pickup_otp := NULL;
    NEW.drop_otp := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_closed_booking_otps() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zzzz_purge_closed_booking_otps ON public.bookings;
CREATE TRIGGER zzzz_purge_closed_booking_otps
BEFORE UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.purge_closed_booking_otps();

CREATE OR REPLACE FUNCTION public.purge_closed_booking_otp_attempts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    DELETE FROM public.booking_otp_attempts WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_closed_booking_otp_attempts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purge_closed_booking_otp_attempts ON public.bookings;
CREATE TRIGGER purge_closed_booking_otp_attempts
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.purge_closed_booking_otp_attempts();

-- Enforce a single offered ride per driver and fail migration safely if legacy duplicates exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.booking_dispatch_offers
    WHERE status = 'offered'
    GROUP BY driver_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple offered dispatch rows exist for a driver. Resolve those offers before applying this migration.';
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS booking_dispatch_offers_one_offered_per_driver_uidx
ON public.booking_dispatch_offers (driver_id)
WHERE status = 'offered';

CREATE OR REPLACE FUNCTION public.sync_booking_dispatch_offer_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'accepted'::public.booking_status THEN
    UPDATE public.booking_dispatch_offers
       SET status = CASE WHEN driver_id = NEW.driver_id THEN 'accepted' ELSE 'skipped' END,
           responded_at = COALESCE(responded_at, now())
     WHERE booking_id = NEW.id AND status = 'offered';
  ELSIF NEW.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    UPDATE public.booking_dispatch_offers
       SET status = 'skipped', responded_at = COALESCE(responded_at, now())
     WHERE booking_id = NEW.id AND status = 'offered';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_booking_dispatch_offer_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sync_booking_dispatch_offer_status ON public.bookings;
CREATE TRIGGER sync_booking_dispatch_offer_status
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_booking_dispatch_offer_status();

-- The booking insert trigger is the authoritative fare and scheduling boundary.
CREATE OR REPLACE FUNCTION public.bookings_enforce_insert_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  base numeric;
  per_km numeric;
  gross numeric;
  disc numeric := 0;
  cpn record;
  coin_cap numeric;
  bal numeric;
  v_weight_limit numeric;
  helper_count_safe smallint;
  helper_fee_safe numeric;
  stop_fee numeric;
  stop_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    IF auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'Only authenticated server booking creation is allowed' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
        AND NEW.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only book for your own account' USING ERRCODE = '42501';
  END IF;

  IF NEW.customer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.customer_id) THEN
    RAISE EXCEPTION 'Customer profile not found';
  END IF;
  IF NULLIF(btrim(NEW.pickup_address), '') IS NULL OR NULLIF(btrim(NEW.drop_address), '') IS NULL THEN
    RAISE EXCEPTION 'Pickup and drop locations are required';
  END IF;
  IF NEW.payment_method IS NULL THEN NEW.payment_method := 'cod'::public.payment_method; END IF;
  IF NEW.payment_method::text NOT IN ('cod', 'upi', 'card', 'netbanking', 'wallet') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF NEW.scheduled_for IS NOT NULL THEN
    IF NEW.scheduled_for < now() + interval '31 minutes'
       OR NEW.scheduled_for > now() + interval '30 days' THEN
      RAISE EXCEPTION 'Scheduled pickup must be at least 31 minutes and no more than 30 days ahead';
    END IF;
    NEW.status := 'scheduled'::public.booking_status;
    NEW.expires_at := NEW.scheduled_for + interval '30 minutes';
  ELSE
    NEW.status := 'pending'::public.booking_status;
    NEW.expires_at := now() + interval '30 minutes';
  END IF;

  NEW.payment_status := 'pending'::public.payment_status;
  SELECT s.commission_rate INTO NEW.commission_rate FROM public.platform_settings s WHERE s.id;
  NEW.commission_rate := COALESCE(NEW.commission_rate, 0.10);
  NEW.commission_amount := 0;
  NEW.driver_net_earning := 0;
  NEW.driver_id := NULL;
  NEW.pickup_verified_at := NULL;
  NEW.drop_verified_at := NULL;
  NEW.pickup_otp := NULL;
  NEW.drop_otp := NULL;
  NEW.customer_phone := (SELECT p.phone FROM public.profiles p WHERE p.id = NEW.customer_id);
  NEW.rating := NULL;
  NEW.review := NULL;
  NEW.pod_photo_url := NULL;
  NEW.pod_signature_url := NULL;
  NEW.pod_receipt_url := NULL;
  NEW.cancelled_at := NULL;
  NEW.cancelled_by := NULL;
  NEW.cancellation_reason := NULL;
  NEW.cancellation_category := NULL;
  NEW.wallet_deducted_amount := 0;

  SELECT v.base_fare, v.per_km_fare, v.weight_limit_kg
    INTO base, per_km, v_weight_limit
  FROM public.vehicle_types v
  WHERE v.id::text = NEW.vehicle_type::text AND v.active IS TRUE;
  IF base IS NULL THEN RAISE EXCEPTION 'This vehicle is not available for booking'; END IF;
  IF NEW.cargo_weight_kg IS NOT NULL
     AND (NEW.cargo_weight_kg <= 0 OR v_weight_limit IS NULL OR NEW.cargo_weight_kg > v_weight_limit) THEN
    RAISE EXCEPTION 'Cargo weight exceeds this vehicle capacity';
  END IF;

  helper_count_safe := GREATEST(LEAST(COALESCE(NEW.helper_count, 0), 2), 0)::smallint;
  IF COALESCE(v_weight_limit, 0) <= 20 THEN helper_count_safe := 0; END IF;
  helper_fee_safe := helper_count_safe * 250;
  NEW.helper_count := helper_count_safe;
  NEW.helper_fee := helper_fee_safe;

  NEW.distance_km := GREATEST(COALESCE(NEW.distance_km, 0), 0);
  stop_count := GREATEST(LEAST(COALESCE(NEW.total_stops, 1), 4), 1);
  NEW.total_stops := stop_count;
  NEW.is_multi_stop := stop_count > 1;
  stop_fee := GREATEST(stop_count - 1, 0) * 50;
  gross := round(base + per_km * NEW.distance_km + helper_fee_safe + stop_fee);

  NEW.coupon_discount := 0;
  IF NEW.coupon_code IS NOT NULL AND btrim(NEW.coupon_code) <> '' THEN
    SELECT * INTO cpn FROM public.validate_coupon(NEW.coupon_code, gross);
    IF cpn.message = 'ok' AND cpn.discount > 0 THEN
      NEW.coupon_code := cpn.code;
      NEW.coupon_discount := cpn.discount;
    ELSE
      NEW.coupon_code := NULL;
    END IF;
  ELSE
    NEW.coupon_code := NULL;
  END IF;

  SELECT coins_balance INTO bal FROM public.wallet_accounts WHERE user_id = NEW.customer_id;
  coin_cap := LEAST(GREATEST(gross - COALESCE(NEW.coupon_discount, 0), 0), COALESCE(bal, 0));
  NEW.coins_redeemed := GREATEST(LEAST(COALESCE(NEW.coins_redeemed, 0), coin_cap), 0);
  disc := COALESCE(NEW.coupon_discount, 0) + COALESCE(NEW.coins_redeemed, 0);
  NEW.fare := GREATEST(gross - disc, 0);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bookings_enforce_insert_financials() FROM PUBLIC, anon, authenticated;

-- Protect POD, phone and provider identifiers from direct row updates.
CREATE OR REPLACE FUNCTION public.guard_booking_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_is_admin boolean := COALESCE(public.has_role((SELECT auth.uid()), 'admin'::public.app_role), false);
  v_is_service boolean := current_user IN ('service_role', 'postgres', 'supabase_admin');
BEGIN
  IF v_is_admin OR v_is_service THEN RETURN NEW; END IF;

  IF ROW(
    NEW.fare, NEW.distance_km, NEW.coupon_code, NEW.coupon_discount,
    NEW.coins_redeemed, NEW.payment_method, NEW.payment_status,
    NEW.commission_rate, NEW.commission_amount, NEW.driver_net_earning,
    NEW.pickup_otp, NEW.drop_otp, NEW.pickup_verified_at, NEW.drop_verified_at,
    NEW.insurance_opted, NEW.insurance_fee, NEW.insurance_limit, NEW.cargo_value,
    NEW.gstin_id, NEW.eway_bill_number, NEW.business_account_id,
    NEW.fare_boost, NEW.helper_charge, NEW.overtime_charge, NEW.final_fare,
    NEW.wallet_deducted_amount, NEW.final_payable_amount,
    NEW.customer_phone, NEW.whatsapp_message_id, NEW.pod_signature_url, NEW.pod_receipt_url
  ) IS DISTINCT FROM ROW(
    OLD.fare, OLD.distance_km, OLD.coupon_code, OLD.coupon_discount,
    OLD.coins_redeemed, OLD.payment_method, OLD.payment_status,
    OLD.commission_rate, OLD.commission_amount, OLD.driver_net_earning,
    OLD.pickup_otp, OLD.drop_otp, OLD.pickup_verified_at, OLD.drop_verified_at,
    OLD.insurance_opted, OLD.insurance_fee, OLD.insurance_limit, OLD.cargo_value,
    OLD.gstin_id, OLD.eway_bill_number, OLD.business_account_id,
    OLD.fare_boost, OLD.helper_charge, OLD.overtime_charge, OLD.final_fare,
    OLD.wallet_deducted_amount, OLD.final_payable_amount,
    OLD.customer_phone, OLD.whatsapp_message_id, OLD.pod_signature_url, OLD.pod_receipt_url
  ) THEN
    RAISE EXCEPTION 'Protected booking fields can only be changed by trusted server operations or an admin'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Booking customer cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    IF NOT (
      OLD.driver_id IS NULL
      AND NEW.driver_id = (SELECT auth.uid())
      AND OLD.status = 'pending'::public.booking_status
      AND NEW.status = 'accepted'::public.booking_status
      AND COALESCE(public.has_role((SELECT auth.uid()), 'driver'::public.app_role), false)
      AND COALESCE(public.is_kyc_approved((SELECT auth.uid())), false)
    ) THEN
      RAISE EXCEPTION 'Driver assignment must use the verified driver claim flow'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_booking_sensitive_updates() FROM PUBLIC, anon, authenticated;

-- Atomic, eligibility-checked sequential driver dispatch.
CREATE OR REPLACE FUNCTION public.dispatch_next_driver(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  next_driver uuid;
  next_seq integer;
  dist numeric;
  v_inserted integer := 0;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'pending'::public.booking_status
     OR b.driver_id IS NOT NULL OR b.cancelled_at IS NOT NULL
     OR (b.payment_method::text <> 'cod' AND b.payment_status <> 'paid'::public.payment_status)
     OR b.pickup_lat IS NULL OR b.pickup_lng IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(MAX(sequence_no), 0) + 1 INTO next_seq
  FROM public.booking_dispatch_offers WHERE booking_id = _booking_id;

  SELECT dl.driver_id,
         round((ST_Distance(dl.location_geog, ST_SetSRID(ST_MakePoint(b.pickup_lng, b.pickup_lat), 4326)::geography) / 1000.0)::numeric, 3)
    INTO next_driver, dist
  FROM public.driver_locations dl
  JOIN public.profiles p ON p.id = dl.driver_id
  JOIN public.user_roles ur ON ur.user_id = dl.driver_id AND ur.role = 'driver'::public.app_role
  JOIN public.driver_kyc dk ON dk.driver_id = dl.driver_id AND dk.status = 'approved'::public.kyc_status
  JOIN public.vehicle_types vt ON vt.id::text = dk.vehicle_id AND vt.active IS TRUE
  WHERE p.is_online IS TRUE
    AND p.kyc_status = 'approved'::public.kyc_status
    AND (p.service_zone IS NULL OR p.service_zone = b.service_zone)
    AND dk.vehicle_id = b.vehicle_type::text
    AND (b.cargo_weight_kg IS NULL OR (vt.weight_limit_kg IS NOT NULL AND b.cargo_weight_kg <= vt.weight_limit_kg))
    AND dl.updated_at >= now() - interval '90 seconds'
    AND ST_DWithin(dl.location_geog, ST_SetSRID(ST_MakePoint(b.pickup_lng, b.pickup_lat), 4326)::geography, 7000)
    AND NOT EXISTS (
      SELECT 1 FROM public.driver_booking_passes x
      WHERE x.booking_id = _booking_id AND x.driver_id = dl.driver_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.booking_dispatch_offers x
      WHERE x.driver_id = dl.driver_id AND x.status = 'offered' AND x.expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings active
      WHERE active.driver_id = dl.driver_id
        AND active.status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
        AND active.cancelled_at IS NULL
    )
  ORDER BY
    ST_Distance(dl.location_geog, ST_SetSRID(ST_MakePoint(b.pickup_lng, b.pickup_lat), 4326)::geography) ASC,
    (SELECT count(*) FROM public.bookings done WHERE done.driver_id = dl.driver_id AND done.status = 'completed'::public.booking_status) DESC,
    dl.updated_at DESC
  LIMIT 1
  FOR UPDATE OF p SKIP LOCKED;

  IF next_driver IS NULL THEN RETURN NULL; END IF;

  UPDATE public.booking_dispatch_offers
     SET status = 'expired', responded_at = COALESCE(responded_at, now())
   WHERE driver_id = next_driver AND status = 'offered' AND expires_at <= now();

  INSERT INTO public.booking_dispatch_offers (booking_id, driver_id, sequence_no, status, offered_at, expires_at, distance_km)
  VALUES (_booking_id, next_driver, next_seq, 'offered', now(), now() + interval '20 seconds', dist)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN NULL; END IF;

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (next_driver, 'New MiniPort ride request',
          'You have 20 seconds to accept a nearby ride. Pickup: ' || b.pickup_address ||
          ' → Drop: ' || b.drop_address || '. Fare ₹' || round(b.fare)::text,
          'driver_ride_offer');
  RETURN next_driver;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_next_driver(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_next_driver(uuid) TO service_role;

-- Driver feed is offer-only, fresh-location, KYC, vehicle and capacity checked.
CREATE OR REPLACE FUNCTION public.get_open_driver_bookings()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT to_jsonb(b) - ARRAY['pickup_otp','drop_otp','customer_phone','whatsapp_message_id',
    'gstin_id','eway_bill_number','business_account_id','cargo_value','insurance_opted',
    'insurance_fee','insurance_limit','pod_signature_url','pod_receipt_url']::text[]
  FROM public.bookings b
  JOIN public.booking_dispatch_offers o
    ON o.booking_id = b.id AND o.driver_id = auth.uid()
   AND o.status = 'offered' AND o.expires_at > now()
  JOIN public.profiles p ON p.id = auth.uid()
  JOIN public.driver_kyc dk ON dk.driver_id = auth.uid() AND dk.status = 'approved'::public.kyc_status
  JOIN public.vehicle_types vt ON vt.id::text = dk.vehicle_id AND vt.active IS TRUE
  WHERE auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'driver'::public.app_role)
    AND public.is_kyc_approved(auth.uid())
    AND p.is_online IS TRUE
    AND p.kyc_status = 'approved'::public.kyc_status
    AND (p.service_zone IS NULL OR p.service_zone = b.service_zone)
    AND dk.vehicle_id = b.vehicle_type::text
    AND (b.cargo_weight_kg IS NULL OR (vt.weight_limit_kg IS NOT NULL AND b.cargo_weight_kg <= vt.weight_limit_kg))
    AND EXISTS (
      SELECT 1 FROM public.driver_locations dl
      WHERE dl.driver_id = auth.uid() AND dl.updated_at >= now() - interval '90 seconds'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings active
      WHERE active.driver_id = auth.uid()
        AND active.status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
        AND active.cancelled_at IS NULL
    )
    AND b.status = 'pending'::public.booking_status
    AND b.driver_id IS NULL AND b.cancelled_at IS NULL
    AND (b.expires_at IS NULL OR b.expires_at > now())
  ORDER BY o.offered_at DESC
  LIMIT 60;
$$;
REVOKE ALL ON FUNCTION public.get_open_driver_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_driver_bookings() TO authenticated;

-- Atomic driver acceptance: booking lock first, then profile lock, then wallet lock.
CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver public.profiles%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_balance numeric := 0;
  v_active integer := 0;
  v_vehicle_id text;
  v_weight_limit numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.driver_id IS NOT NULL OR v_booking.status <> 'pending'::public.booking_status
     OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;

  SELECT * INTO v_driver FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_driver.is_online IS NOT TRUE OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be online and verified';
  END IF;
  IF v_booking.service_zone IS DISTINCT FROM v_driver.service_zone THEN
    RAISE EXCEPTION 'Ride is outside your service zone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.driver_locations dl WHERE dl.driver_id = auth.uid() AND dl.updated_at >= now() - interval '90 seconds') THEN
    RAISE EXCEPTION 'Fresh driver location is required to accept rides';
  END IF;

  SELECT dk.vehicle_id INTO v_vehicle_id
  FROM public.driver_kyc dk
  WHERE dk.driver_id = auth.uid() AND dk.status = 'approved'::public.kyc_status;
  IF v_vehicle_id IS DISTINCT FROM v_booking.vehicle_type::text THEN
    RAISE EXCEPTION 'Your verified vehicle type does not match this ride';
  END IF;
  SELECT vt.weight_limit_kg INTO v_weight_limit
  FROM public.vehicle_types vt
  WHERE vt.id::text = v_vehicle_id AND vt.active IS TRUE;
  IF NOT FOUND OR (v_booking.cargo_weight_kg IS NOT NULL AND
     (v_weight_limit IS NULL OR v_booking.cargo_weight_kg > v_weight_limit)) THEN
    RAISE EXCEPTION 'Your verified vehicle cannot carry this cargo weight';
  END IF;

  UPDATE public.booking_dispatch_offers
     SET status = 'expired', responded_at = COALESCE(responded_at, now())
   WHERE driver_id = auth.uid() AND status = 'offered' AND expires_at <= now();

  IF EXISTS (
    SELECT 1 FROM public.booking_dispatch_offers o
    WHERE o.driver_id = auth.uid() AND o.status = 'offered' AND o.expires_at > now()
      AND o.booking_id <> _booking_id
  ) THEN
    RAISE EXCEPTION 'You already have another active ride offer';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.booking_dispatch_offers o
    WHERE o.booking_id = _booking_id AND o.driver_id = auth.uid()
      AND o.status = 'offered' AND o.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'This ride is not currently offered to you or the 20-second timer has expired';
  END IF;

  SELECT COALESCE(cash_balance, 0) INTO v_balance
  FROM public.wallet_accounts WHERE user_id = auth.uid() FOR UPDATE;
  IF COALESCE(v_balance, 0) < 100 THEN
    RAISE EXCEPTION 'Minimum wallet balance of INR 100 is required to accept rides';
  END IF;
  SELECT count(*) INTO v_active
  FROM public.bookings
  WHERE driver_id = auth.uid()
    AND status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
    AND cancelled_at IS NULL AND id <> _booking_id;
  IF v_active > 0 THEN RAISE EXCEPTION 'Finish your current trip before accepting a new one'; END IF;

  UPDATE public.bookings
     SET driver_id = auth.uid(), status = 'accepted'::public.booking_status, updated_at = now()
   WHERE id = _booking_id AND driver_id IS NULL AND status = 'pending'::public.booking_status AND cancelled_at IS NULL
   RETURNING * INTO v_booking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride already accepted or closed'; END IF;

  UPDATE public.booking_dispatch_offers
     SET status = CASE WHEN driver_id = auth.uid() THEN 'accepted' ELSE 'skipped' END,
         responded_at = now()
   WHERE booking_id = _booking_id AND status = 'offered';

  v_booking.pickup_otp := NULL;
  v_booking.drop_otp := NULL;
  v_booking.customer_phone := NULL;
  v_booking.whatsapp_message_id := NULL;
  RETURN v_booking;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_booking(uuid) TO authenticated;

-- Admin assignment uses the same eligibility checks and lock order.
CREATE OR REPLACE FUNCTION public.admin_assign_driver(_booking_id uuid, _driver_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_driver public.profiles%ROWTYPE;
  v_vehicle_id text;
  v_weight_limit numeric;
  v_active integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only the operations team can assign drivers';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.status <> 'pending'::public.booking_status OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Trip is no longer searching for a driver';
  END IF;
  SELECT * INTO v_driver FROM public.profiles WHERE id = _driver_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_role(_driver_id, 'driver'::public.app_role)
     OR v_driver.kyc_status <> 'approved'::public.kyc_status OR v_driver.is_online IS NOT TRUE THEN
    RAISE EXCEPTION 'Driver must be online and approved to take trips';
  END IF;
  IF v_booking.service_zone IS DISTINCT FROM v_driver.service_zone THEN
    RAISE EXCEPTION 'Driver is outside the trip service zone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.driver_locations dl WHERE dl.driver_id = _driver_id AND dl.updated_at >= now() - interval '90 seconds') THEN
    RAISE EXCEPTION 'Driver location is stale';
  END IF;
  SELECT dk.vehicle_id INTO v_vehicle_id
  FROM public.driver_kyc dk
  WHERE dk.driver_id = _driver_id AND dk.status = 'approved'::public.kyc_status;
  IF v_vehicle_id IS DISTINCT FROM v_booking.vehicle_type::text THEN
    RAISE EXCEPTION 'Driver vehicle type does not match this trip';
  END IF;
  SELECT vt.weight_limit_kg INTO v_weight_limit
  FROM public.vehicle_types vt
  WHERE vt.id::text = v_vehicle_id AND vt.active IS TRUE;
  IF NOT FOUND OR (v_booking.cargo_weight_kg IS NOT NULL AND
     (v_weight_limit IS NULL OR v_booking.cargo_weight_kg > v_weight_limit)) THEN
    RAISE EXCEPTION 'Driver vehicle cannot carry this cargo weight';
  END IF;

  UPDATE public.booking_dispatch_offers
     SET status = 'expired', responded_at = COALESCE(responded_at, now())
   WHERE driver_id = _driver_id AND status = 'offered' AND expires_at <= now();
  IF EXISTS (
    SELECT 1 FROM public.booking_dispatch_offers o
    WHERE o.driver_id = _driver_id AND o.status = 'offered' AND o.expires_at > now()
      AND o.booking_id <> _booking_id
  ) THEN
    RAISE EXCEPTION 'Driver already has another active offer';
  END IF;
  SELECT count(*) INTO v_active
  FROM public.bookings b
  WHERE b.driver_id = _driver_id
    AND b.status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
    AND b.cancelled_at IS NULL AND b.id <> _booking_id;
  IF v_active > 0 THEN RAISE EXCEPTION 'That driver is already on a trip'; END IF;

  UPDATE public.bookings
     SET driver_id = _driver_id, status = 'accepted'::public.booking_status, updated_at = now()
   WHERE id = _booking_id
   RETURNING * INTO v_booking;
  UPDATE public.booking_dispatch_offers
     SET status = 'skipped', responded_at = COALESCE(responded_at, now())
   WHERE booking_id = _booking_id AND status = 'offered';

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_assign_driver', 'bookings', _booking_id, jsonb_build_object('driver_id', _driver_id));

  v_booking.pickup_otp := NULL;
  v_booking.drop_otp := NULL;
  v_booking.customer_phone := NULL;
  v_booking.whatsapp_message_id := NULL;
  RETURN v_booking;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_assign_driver(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_driver(uuid, uuid) TO authenticated;

-- Cancellation remains server-authorized and now supports scheduled bookings.
CREATE OR REPLACE FUNCTION public.cancel_booking(_booking_id uuid, _reason text, _note text DEFAULT NULL)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  uid uuid := auth.uid();
  clean_reason text;
  next_notes text;
  actor public.cancel_actor;
  category public.cancellation_category;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  clean_reason := left(btrim(COALESCE(_reason, '')), 300);
  IF length(clean_reason) < 3 THEN RAISE EXCEPTION 'Add a cancellation reason'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND OR b.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    RAISE EXCEPTION 'Trip is already closed';
  END IF;
  IF b.customer_id = uid THEN
    IF b.status NOT IN ('pending'::public.booking_status, 'scheduled'::public.booking_status, 'accepted'::public.booking_status, 'in_progress'::public.booking_status) THEN
      RAISE EXCEPTION 'This trip can no longer be cancelled';
    END IF;
    actor := 'customer'::public.cancel_actor;
    category := 'customer_cancelled'::public.cancellation_category;
  ELSIF b.driver_id = uid THEN
    IF b.status <> 'accepted'::public.booking_status THEN
      RAISE EXCEPTION 'You can only drop a trip before pickup verification';
    END IF;
    actor := 'driver'::public.cancel_actor;
    category := 'driver_cancelled'::public.cancellation_category;
  ELSE
    RAISE EXCEPTION 'Only the customer or assigned driver can cancel this trip';
  END IF;
  next_notes := CASE
    WHEN _note IS NULL OR btrim(_note) = '' THEN b.notes
    WHEN b.notes IS NULL OR btrim(b.notes) = '' THEN left(btrim(_note), 500)
    ELSE left(b.notes || ' · ' || btrim(_note), 1000)
  END;
  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings
     SET status = 'cancelled'::public.booking_status,
         cancelled_at = now(),
         cancellation_reason = clean_reason,
         cancelled_by = actor,
         cancellation_category = category,
         notes = next_notes,
         payment_status = CASE WHEN b.payment_status = 'pending'::public.payment_status THEN 'failed'::public.payment_status ELSE b.payment_status END
   WHERE id = _booking_id
  RETURNING * INTO b;
  PERFORM set_config('miniport.trusted_write', 'off', true);
  UPDATE public.booking_dispatch_offers SET status = 'skipped', responded_at = COALESCE(responded_at, now())
   WHERE booking_id = _booking_id AND status = 'offered';
  b.pickup_otp := NULL;
  b.drop_otp := NULL;
  b.customer_phone := NULL;
  b.whatsapp_message_id := NULL;
  RETURN b;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO authenticated;

-- Keep scheduled trips queued until 30 minutes before pickup. COD is eligible too.
CREATE OR REPLACE FUNCTION public.process_scheduled_booking_automation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
  reminder_count integer := 0;
  assigned_driver_reminder_count integer := 0;
  dispatch_count integer := 0;
  dispatch_notification_count integer := 0;
  expired_ids uuid[] := ARRAY[]::uuid[];
  dispatched_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR r IN
    SELECT s.id, s.booking_id, s.customer_id, b.driver_id, s.scheduled_for,
           b.pickup_address, b.drop_address
    FROM public.scheduled_booking_reminders s
    JOIN public.bookings b ON b.id = s.booking_id
    WHERE s.status = 'queued' AND s.reminder_at <= now()
      AND b.status = 'scheduled'
      AND (b.payment_method::text = 'cod' OR b.payment_status = 'paid'::public.payment_status)
      AND b.scheduled_for > now()
    ORDER BY s.reminder_at
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (r.customer_id, 'Upcoming scheduled trip — 24-hour reminder',
      'Your MiniPort pickup is scheduled for ' ||
      to_char(r.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') ||
      '. Your trip will be sent to eligible drivers 30 minutes before pickup.',
      'scheduled_reminder');
    IF r.driver_id IS NOT NULL AND r.driver_id <> r.customer_id THEN
      INSERT INTO public.notifications (user_id, title, body, kind)
      VALUES (r.driver_id, 'Assigned scheduled trip — 24-hour reminder',
        'You are assigned to a MiniPort pickup scheduled for ' ||
        to_char(r.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') ||
        '. Pickup: ' || r.pickup_address || '. Drop: ' || r.drop_address ||
        '. Please keep your availability updated.',
        'scheduled_reminder');
      assigned_driver_reminder_count := assigned_driver_reminder_count + 1;
    END IF;
    UPDATE public.scheduled_booking_reminders
       SET status = 'sent', sent_at = now(), updated_at = now()
     WHERE id = r.id AND status = 'queued';
    reminder_count := reminder_count + 1;
  END LOOP;

  WITH dispatched AS (
    UPDATE public.bookings b
       SET status = 'pending'::public.booking_status, updated_at = now()
     WHERE b.status = 'scheduled'::public.booking_status
       AND b.scheduled_for IS NOT NULL
       AND b.scheduled_for <= now() + interval '30 minutes'
       AND COALESCE(b.expires_at, b.scheduled_for + interval '30 minutes') > now()
       AND (b.payment_method::text = 'cod' OR b.payment_status = 'paid'::public.payment_status)
    RETURNING b.id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO dispatched_ids FROM dispatched;
  dispatch_count := COALESCE(array_length(dispatched_ids, 1), 0);
  IF dispatch_count > 0 THEN
    SELECT count(*) INTO dispatch_notification_count
    FROM public.booking_dispatch_offers o
    WHERE o.booking_id = ANY(dispatched_ids)
      AND o.status = 'offered'
      AND o.offered_at >= transaction_timestamp();
  END IF;

  WITH expired AS (
    UPDATE public.bookings b
       SET status = 'expired'::public.booking_status, updated_at = now()
     WHERE b.status = 'scheduled'::public.booking_status
       AND b.scheduled_for IS NOT NULL
       AND COALESCE(b.expires_at, b.scheduled_for + interval '30 minutes') <= now()
    RETURNING b.id, b.customer_id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO expired_ids FROM expired;
  IF COALESCE(array_length(expired_ids, 1), 0) > 0 THEN
    INSERT INTO public.notifications (user_id, title, body, kind)
    SELECT b.customer_id, 'Scheduled trip expired',
           'Your scheduled pickup window has passed. Please create a new booking or contact support.',
           'scheduled_expired'
    FROM public.bookings b WHERE b.id = ANY(expired_ids);
  END IF;

  UPDATE public.scheduled_booking_reminders s
     SET status = 'cancelled', updated_at = now()
    FROM public.bookings b
   WHERE s.booking_id = b.id AND s.status = 'queued'
     AND (b.status <> 'scheduled'::public.booking_status OR b.scheduled_for <= now());

  RETURN jsonb_build_object(
    'reminders_sent', reminder_count,
    'assigned_driver_reminders_sent', assigned_driver_reminder_count,
    'bookings_dispatched', dispatch_count,
    'driver_offers_created', dispatch_notification_count,
    'bookings_expired', COALESCE(array_length(expired_ids, 1), 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.process_scheduled_booking_automation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_scheduled_booking_automation() TO service_role;

-- Keep cargo-weight compatibility trigger on an immutable search path.
CREATE OR REPLACE FUNCTION public.sync_booking_cargo_weight_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.cargo_weight IS DISTINCT FROM OLD.cargo_weight
     AND NEW.cargo_weight_kg IS NOT DISTINCT FROM OLD.cargo_weight_kg THEN
    NEW.cargo_weight_kg := NEW.cargo_weight;
  ELSIF NEW.cargo_weight_kg IS DISTINCT FROM OLD.cargo_weight_kg
     AND NEW.cargo_weight IS NOT DISTINCT FROM OLD.cargo_weight THEN
    NEW.cargo_weight := NEW.cargo_weight_kg;
  ELSIF NEW.cargo_weight IS NOT NULL AND NEW.cargo_weight_kg IS NULL THEN
    NEW.cargo_weight_kg := NEW.cargo_weight;
  ELSIF NEW.cargo_weight_kg IS NOT NULL AND NEW.cargo_weight IS NULL THEN
    NEW.cargo_weight := NEW.cargo_weight_kg;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_booking_cargo_weight_columns() FROM PUBLIC, anon, authenticated;

-- Remove duplicate trigger executions that can debit coins, award earnings or send SMS twice.
DROP TRIGGER IF EXISTS trg_bookings_debit_coins ON public.bookings;
DROP TRIGGER IF EXISTS zz_bookings_award_coins ON public.bookings;
DROP TRIGGER IF EXISTS zzz_bookings_enqueue_sms ON public.bookings;
DROP TRIGGER IF EXISTS bookings_touch_updated_at ON public.bookings;
DROP TRIGGER IF EXISTS trg_bookings_generate_otps ON public.bookings;
DROP TRIGGER IF EXISTS zz_driver_kyc_sync_profile ON public.driver_kyc;

-- No raw pending-booking reads and no direct booking INSERTs from authenticated clients.
DROP POLICY IF EXISTS "Drivers can view searching rides" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: customer insert own" ON public.bookings;
REVOKE INSERT ON TABLE public.bookings FROM authenticated;
REVOKE SELECT ON TABLE public.bookings FROM authenticated;
GRANT SELECT (id, customer_id, driver_id, pickup_address, drop_address, vehicle_type, distance_km, fare, fare_boost, helper_count, helper_fee, status, notes, created_at, updated_at, coupon_code, coupon_discount, coins_redeemed, payment_method, payment_status, commission_rate, commission_amount, driver_net_earning, pickup_verified_at, drop_verified_at, rating, review, pod_photo_url, cancellation_reason, pickup_lat, pickup_lng, drop_lat, drop_lng, loading_started_at, loading_stopped_at, unloading_started_at, unloading_stopped_at, service_zone, scheduled_for, cargo_weight_kg, cancelled_at, expires_at, booking_source, loading_overtime_minutes, unloading_overtime_minutes, overtime_charge, final_fare, cancelled_by, cancellation_category, stops, is_multi_stop, total_stops, final_payable_amount, wallet_deducted_amount) ON TABLE public.bookings TO authenticated;

-- Disable unused legacy booking RPCs that accept client-controlled fare/distance.
REVOKE ALL ON FUNCTION public.create_booking_secure(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_booking_secure(text, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_secure_booking(text, text, numeric, text) FROM PUBLIC, anon, authenticated;

-- Financial records are read-only to authenticated clients; all writes remain server/RPC-only.
REVOKE ALL ON TABLE public.payments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payments FROM authenticated;
GRANT SELECT ON TABLE public.payments TO authenticated;
REVOKE ALL ON TABLE public.wallet_transactions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.wallet_transactions FROM authenticated;
GRANT SELECT ON TABLE public.wallet_transactions TO authenticated;
REVOKE ALL ON TABLE public.booking_dispatch_offers FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.booking_dispatch_offers FROM authenticated;
GRANT SELECT ON TABLE public.booking_dispatch_offers TO authenticated;
REVOKE ALL ON TABLE public.driver_wallets FROM anon, authenticated;
REVOKE ALL ON TABLE public.scheduled_booking_reminders FROM anon, authenticated;

-- Trigger-only functions must not be callable as public RPCs.
REVOKE ALL ON FUNCTION public.bookings_generate_otps() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_protect_fare_boost() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_enforce_insert_financials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_protect_financials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_debit_coins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_award_coins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_debit_wallet_cash() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_apply_enterprise_fare() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_schedule_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_driver_dispatch_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_sms_for_booking() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_profile_kyc_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_delivery_pod() FROM PUBLIC, anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

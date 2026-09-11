-- 1. OTP privacy: drivers must never read the codes -------------------------
REVOKE SELECT ON public.bookings FROM authenticated;
GRANT SELECT (
  id, customer_id, driver_id, pickup_address, drop_address, vehicle_type,
  distance_km, fare, status, notes, created_at, updated_at, coupon_code,
  coupon_discount, coins_redeemed, payment_method, payment_status,
  commission_rate, commission_amount, driver_net_earning,
  pickup_verified_at, drop_verified_at, rating, review, pod_photo_url,
  cancellation_reason, pickup_lat, pickup_lng, drop_lat, drop_lng,
  loading_started_at, loading_stopped_at, unloading_started_at,
  unloading_stopped_at, service_zone, cancelled_at, expires_at
) ON public.bookings TO authenticated;

CREATE TABLE IF NOT EXISTS public.booking_otp_attempts (
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  stage text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, stage)
);
REVOKE ALL ON public.booking_otp_attempts FROM anon, authenticated;
GRANT ALL ON public.booking_otp_attempts TO service_role;
ALTER TABLE public.booking_otp_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can review OTP attempts" ON public.booking_otp_attempts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Customer-only reveal of their own codes.
CREATE OR REPLACE FUNCTION public.get_booking_otps(_booking_id uuid)
RETURNS TABLE(pickup_otp text, drop_otp text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE b public.bookings;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF b.customer_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF b.status NOT IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT
    CASE WHEN b.pickup_verified_at IS NULL THEN b.pickup_otp ELSE NULL END,
    CASE WHEN b.pickup_verified_at IS NOT NULL AND b.drop_verified_at IS NULL THEN b.drop_otp ELSE NULL END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_booking_otps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_otps(uuid) TO authenticated;

-- Server-side verification with attempt limits; no client bypass possible.
CREATE OR REPLACE FUNCTION public.verify_booking_otp(_booking_id uuid, _stage text, _otp text)
RETURNS public.bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  b public.bookings;
  att public.booking_otp_attempts;
  expected text;
  uid uuid := auth.uid();
  clean text := regexp_replace(COALESCE(_otp, ''), '[^0-9]', '', 'g');
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF _stage NOT IN ('pickup', 'drop') THEN RAISE EXCEPTION 'Invalid verification step'; END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.driver_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the assigned driver can verify this trip'; END IF;
  IF b.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'This trip was cancelled'; END IF;

  SELECT * INTO att FROM public.booking_otp_attempts
    WHERE booking_id = _booking_id AND stage = _stage FOR UPDATE;
  IF att.locked_until IS NOT NULL AND att.locked_until > now() THEN
    RAISE EXCEPTION 'Too many wrong codes. Try again in a few minutes.';
  END IF;

  IF _stage = 'pickup' THEN
    IF b.status <> 'accepted'::public.booking_status THEN RAISE EXCEPTION 'Trip is not awaiting pickup'; END IF;
    expected := b.pickup_otp;
  ELSE
    IF b.status <> 'in_progress'::public.booking_status THEN RAISE EXCEPTION 'Start the trip before confirming delivery'; END IF;
    expected := b.drop_otp;
  END IF;

  IF expected IS NULL OR clean <> expected THEN
    INSERT INTO public.booking_otp_attempts(booking_id, stage, attempts, updated_at)
      VALUES (_booking_id, _stage, 1, now())
      ON CONFLICT (booking_id, stage) DO UPDATE
        SET attempts = public.booking_otp_attempts.attempts + 1,
            updated_at = now(),
            locked_until = CASE WHEN public.booking_otp_attempts.attempts + 1 >= 5
                                THEN now() + interval '10 minutes' ELSE NULL END;
    RAISE EXCEPTION 'Incorrect code. Please re-check with the customer.';
  END IF;

  DELETE FROM public.booking_otp_attempts WHERE booking_id = _booking_id AND stage = _stage;

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

  b.pickup_otp := NULL;
  b.drop_otp := NULL;
  RETURN b;
END;
$fn$;
REVOKE ALL ON FUNCTION public.verify_booking_otp(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_booking_otp(uuid, text, text) TO authenticated;

-- Photo proof of delivery as a controlled action.
CREATE OR REPLACE FUNCTION public.complete_booking_with_pod(_booking_id uuid, _pod_path text)
RETURNS public.bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE b public.bookings; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF _pod_path IS NULL OR btrim(_pod_path) = '' THEN RAISE EXCEPTION 'Attach a delivery photo first'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.driver_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the assigned driver can complete this trip'; END IF;
  IF b.status <> 'in_progress'::public.booking_status THEN RAISE EXCEPTION 'Trip is not in progress'; END IF;
  UPDATE public.bookings
    SET drop_verified_at = now(),
        status = 'completed'::public.booking_status,
        pod_photo_url = _pod_path,
        unloading_stopped_at = COALESCE(unloading_stopped_at, now())
    WHERE id = _booking_id RETURNING * INTO b;
  b.pickup_otp := NULL; b.drop_otp := NULL;
  RETURN b;
END;
$fn$;
REVOKE ALL ON FUNCTION public.complete_booking_with_pod(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_booking_with_pod(uuid, text) TO authenticated;

-- 2. Withdrawals: server-enforced limits + balance hold -----------------------
CREATE OR REPLACE FUNCTION public.withdrawals_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE bal numeric; open_count int; day_count int;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.driver_id <> auth.uid() THEN RAISE EXCEPTION 'You can only withdraw your own earnings'; END IF;
  IF NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN RAISE EXCEPTION 'Only driver partners can withdraw'; END IF;

  NEW.status := 'requested'::public.withdrawal_status;
  NEW.amount := round(COALESCE(NEW.amount, 0)::numeric, 2);
  IF NEW.amount < 100 THEN RAISE EXCEPTION 'Minimum withdrawal is INR 100'; END IF;
  IF NEW.amount > 100000 THEN RAISE EXCEPTION 'Maximum withdrawal is INR 100000 per request'; END IF;

  SELECT count(*) INTO open_count FROM public.withdrawal_requests
    WHERE driver_id = NEW.driver_id AND status = 'requested'::public.withdrawal_status;
  IF open_count > 0 THEN RAISE EXCEPTION 'You already have a withdrawal being processed'; END IF;

  SELECT count(*) INTO day_count FROM public.withdrawal_requests
    WHERE driver_id = NEW.driver_id AND created_at > now() - interval '24 hours';
  IF day_count >= 3 THEN RAISE EXCEPTION 'Withdrawal limit reached. Try again after 24 hours.'; END IF;

  SELECT cash_balance INTO bal FROM public.wallet_accounts WHERE user_id = NEW.driver_id FOR UPDATE;
  IF bal IS NULL OR bal < NEW.amount THEN RAISE EXCEPTION 'Amount exceeds your available balance'; END IF;

  UPDATE public.wallet_accounts SET cash_balance = cash_balance - NEW.amount, updated_at = now()
    WHERE user_id = NEW.driver_id;
  INSERT INTO public.wallet_transactions(user_id, delta, reason)
    VALUES (NEW.driver_id, -NEW.amount, 'Withdrawal requested');
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS withdrawals_validate ON public.withdrawal_requests;
CREATE TRIGGER withdrawals_validate BEFORE INSERT ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.withdrawals_validate();

CREATE OR REPLACE FUNCTION public.withdrawals_settle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only the MiniPort team can update a withdrawal';
  END IF;
  IF OLD.status = 'requested'::public.withdrawal_status
     AND NEW.status = 'rejected'::public.withdrawal_status THEN
    UPDATE public.wallet_accounts SET cash_balance = cash_balance + OLD.amount, updated_at = now()
      WHERE user_id = OLD.driver_id;
    INSERT INTO public.wallet_transactions(user_id, delta, reason)
      VALUES (OLD.driver_id, OLD.amount, 'Withdrawal rejected - amount returned');
  END IF;
  NEW.driver_id := OLD.driver_id;
  NEW.amount := OLD.amount;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS withdrawals_settle ON public.withdrawal_requests;
CREATE TRIGGER withdrawals_settle BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.withdrawals_settle();

-- 3. Payout-method abuse limits ---------------------------------------------
CREATE OR REPLACE FUNCTION public.bank_accounts_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE total int; recent int;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.driver_id <> auth.uid() THEN RAISE EXCEPTION 'You can only manage your own payout methods'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO total FROM public.driver_bank_accounts WHERE driver_id = NEW.driver_id;
    IF total >= 5 THEN RAISE EXCEPTION 'You can save up to 5 payout methods'; END IF;
    SELECT count(*) INTO recent FROM public.driver_bank_accounts
      WHERE driver_id = NEW.driver_id AND created_at > now() - interval '24 hours';
    IF recent >= 3 THEN RAISE EXCEPTION 'Too many payout-method changes today. Try again tomorrow.'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.withdrawal_requests
             WHERE driver_id = NEW.driver_id AND status = 'requested'::public.withdrawal_status) THEN
    RAISE EXCEPTION 'Payout methods cannot change while a withdrawal is being processed';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS bank_accounts_guard ON public.driver_bank_accounts;
CREATE TRIGGER bank_accounts_guard BEFORE INSERT OR UPDATE ON public.driver_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.bank_accounts_guard();

-- 4. Security-sensitive audit coverage --------------------------------------
CREATE OR REPLACE FUNCTION public.audit_sensitive_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.audit_logs(actor_id, action, table_name, row_id, old_data, new_data)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE (to_jsonb(NEW)->>'id')::uuid END,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END;
$fn$;
DROP TRIGGER IF EXISTS audit_user_roles ON public.user_roles;
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row();
DROP TRIGGER IF EXISTS audit_withdrawals ON public.withdrawal_requests;
CREATE TRIGGER audit_withdrawals AFTER INSERT OR UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row();
DROP TRIGGER IF EXISTS audit_bank_accounts ON public.driver_bank_accounts;
CREATE TRIGGER audit_bank_accounts AFTER INSERT OR UPDATE ON public.driver_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row();

-- 5. Driver GPS sanity checks ----------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_locations_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
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
DROP TRIGGER IF EXISTS driver_locations_validate ON public.driver_locations;
CREATE TRIGGER driver_locations_validate BEFORE INSERT OR UPDATE ON public.driver_locations
  FOR EACH ROW EXECUTE FUNCTION public.driver_locations_validate();

-- 6. Payment idempotency + indexes -----------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_order_id_key
  ON public.payments (provider_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_id_key
  ON public.payments (provider_payment_id) WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bookings_customer_created_idx
  ON public.bookings (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_driver_created_idx
  ON public.bookings (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_live_queue_idx
  ON public.bookings (service_zone, status, created_at DESC) WHERE driver_id IS NULL;
CREATE INDEX IF NOT EXISTS wallet_transactions_user_created_idx
  ON public.wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS withdrawal_requests_driver_created_idx
  ON public.withdrawal_requests (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_logs_booking_idx ON public.sms_logs (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS driver_booking_passes_driver_idx
  ON public.driver_booking_passes (driver_id, booking_id);
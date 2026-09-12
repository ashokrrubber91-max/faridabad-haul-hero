-- ============================================================
-- MiniPort domain-based schema cleanup (additive, idempotent)
-- ============================================================

-- 1. Application lifecycle status -----------------------------
DO $$ BEGIN
  CREATE TYPE public.driver_application_status AS ENUM ('submitted','approved','rejected','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.booking_stop_kind AS ENUM ('pickup','stop','drop');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. CUSTOMER DOMAIN: customer_profiles ----------------------
CREATE TABLE IF NOT EXISTS public.customer_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  default_gstin_id uuid REFERENCES public.customer_gstins(id) ON DELETE SET NULL,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.customer_profiles TO authenticated;
GRANT ALL ON public.customer_profiles TO service_role;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_profiles_own_select" ON public.customer_profiles;
CREATE POLICY "customer_profiles_own_select" ON public.customer_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "customer_profiles_own_insert" ON public.customer_profiles;
CREATE POLICY "customer_profiles_own_insert" ON public.customer_profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "customer_profiles_own_update" ON public.customer_profiles;
CREATE POLICY "customer_profiles_own_update" ON public.customer_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS customer_profiles_touch ON public.customer_profiles;
CREATE TRIGGER customer_profiles_touch BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- A customer may only point at a GSTIN they own.
CREATE OR REPLACE FUNCTION public.customer_profiles_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.default_gstin_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customer_gstins g
     WHERE g.id = NEW.default_gstin_id AND g.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Default GSTIN must belong to the same customer';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS customer_profiles_validate ON public.customer_profiles;
CREATE TRIGGER customer_profiles_validate BEFORE INSERT OR UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.customer_profiles_validate();

INSERT INTO public.customer_profiles(user_id)
SELECT p.id FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

-- 3. DRIVER DOMAIN: driver_profiles --------------------------
CREATE TABLE IF NOT EXISTS public.driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  vehicle_type public.vehicle_type,
  vehicle_number text,
  payout_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_profiles_vehicle_number_len CHECK (vehicle_number IS NULL OR length(btrim(vehicle_number)) BETWEEN 4 AND 20)
);

GRANT SELECT, UPDATE ON public.driver_profiles TO authenticated;
GRANT ALL ON public.driver_profiles TO service_role;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_profiles_own_select" ON public.driver_profiles;
CREATE POLICY "driver_profiles_own_select" ON public.driver_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "driver_profiles_own_update" ON public.driver_profiles;
CREATE POLICY "driver_profiles_own_update" ON public.driver_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- payout_hold is an ops-only lever; drivers may not clear it themselves.
CREATE OR REPLACE FUNCTION public.driver_profiles_protect()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payout_hold IS DISTINCT FROM OLD.payout_hold
     AND NOT public.has_role(auth.uid(),'admin')
     AND auth.uid() IS NOT NULL THEN
    NEW.payout_hold := OLD.payout_hold;
  END IF;
  NEW.user_id := OLD.user_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS driver_profiles_protect ON public.driver_profiles;
CREATE TRIGGER driver_profiles_protect BEFORE UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.driver_profiles_protect();

DROP TRIGGER IF EXISTS driver_profiles_touch ON public.driver_profiles;
CREATE TRIGGER driver_profiles_touch BEFORE UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.driver_profiles(user_id, vehicle_number)
SELECT k.driver_id, NULLIF(btrim(COALESCE(k.vehicle_number,'')),'')
  FROM public.driver_kyc k
ON CONFLICT (user_id) DO NOTHING;

-- 4. DRIVER DOMAIN: driver_applications ----------------------
CREATE TABLE IF NOT EXISTS public.driver_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.driver_application_status NOT NULL DEFAULT 'submitted',
  decision_note text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_applications_user_unique UNIQUE (user_id)
);

GRANT SELECT, INSERT ON public.driver_applications TO authenticated;
GRANT ALL ON public.driver_applications TO service_role;
ALTER TABLE public.driver_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_applications_own_select" ON public.driver_applications;
CREATE POLICY "driver_applications_own_select" ON public.driver_applications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "driver_applications_own_insert" ON public.driver_applications;
CREATE POLICY "driver_applications_own_insert" ON public.driver_applications
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND status = 'submitted');

-- Only admins (or the KYC review path) may move an application forward.
CREATE OR REPLACE FUNCTION public.driver_applications_protect()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only the operations team can decide driver applications';
    END IF;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.decision_note := OLD.decision_note;
  END IF;
  NEW.user_id := OLD.user_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS driver_applications_protect ON public.driver_applications;
CREATE TRIGGER driver_applications_protect BEFORE UPDATE ON public.driver_applications
  FOR EACH ROW EXECUTE FUNCTION public.driver_applications_protect();

DROP TRIGGER IF EXISTS driver_applications_touch ON public.driver_applications;
CREATE TRIGGER driver_applications_touch BEFORE UPDATE ON public.driver_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS driver_applications_status_idx
  ON public.driver_applications (status, applied_at DESC);

INSERT INTO public.driver_applications(user_id, status, applied_at, reviewed_at, reviewed_by, decision_note)
SELECT k.driver_id,
       CASE k.status
         WHEN 'approved' THEN 'approved'::public.driver_application_status
         WHEN 'rejected' THEN 'rejected'::public.driver_application_status
         ELSE 'submitted'::public.driver_application_status
       END,
       k.submitted_at, k.reviewed_at, k.reviewed_by, k.rejection_reason
  FROM public.driver_kyc k
ON CONFLICT (user_id) DO NOTHING;

-- Keep the application record and the driver operational record in step with KYC.
CREATE OR REPLACE FUNCTION public.sync_driver_domain_from_kyc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.driver_profiles(user_id, vehicle_number)
  VALUES (NEW.driver_id, NULLIF(btrim(COALESCE(NEW.vehicle_number,'')),''))
  ON CONFLICT (user_id) DO UPDATE
    SET vehicle_number = COALESCE(NULLIF(btrim(COALESCE(NEW.vehicle_number,'')),''), public.driver_profiles.vehicle_number),
        updated_at = now();

  INSERT INTO public.driver_applications(user_id, status, applied_at, reviewed_at, reviewed_by, decision_note)
  VALUES (
    NEW.driver_id,
    CASE NEW.status
      WHEN 'approved' THEN 'approved'::public.driver_application_status
      WHEN 'rejected' THEN 'rejected'::public.driver_application_status
      ELSE 'submitted'::public.driver_application_status
    END,
    NEW.submitted_at, NEW.reviewed_at, NEW.reviewed_by, NEW.rejection_reason)
  ON CONFLICT (user_id) DO UPDATE
    SET status = EXCLUDED.status,
        reviewed_at = EXCLUDED.reviewed_at,
        reviewed_by = EXCLUDED.reviewed_by,
        decision_note = EXCLUDED.decision_note,
        updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_driver_domain_from_kyc ON public.driver_kyc;
CREATE TRIGGER sync_driver_domain_from_kyc AFTER INSERT OR UPDATE ON public.driver_kyc
  FOR EACH ROW EXECUTE FUNCTION public.sync_driver_domain_from_kyc();

-- 5. BOOKING DOMAIN: booking_stops ---------------------------
CREATE TABLE IF NOT EXISTS public.booking_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  sequence smallint NOT NULL,
  kind public.booking_stop_kind NOT NULL,
  address text NOT NULL,
  latitude double precision,
  longitude double precision,
  place_id text,
  contact_name text,
  contact_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_stops_sequence_unique UNIQUE (booking_id, sequence),
  CONSTRAINT booking_stops_sequence_range CHECK (sequence >= 0 AND sequence <= 10),
  CONSTRAINT booking_stops_address_len CHECK (length(btrim(address)) BETWEEN 3 AND 400),
  CONSTRAINT booking_stops_lat_range CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CONSTRAINT booking_stops_lng_range CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))
);

GRANT SELECT, INSERT ON public.booking_stops TO authenticated;
GRANT ALL ON public.booking_stops TO service_role;
ALTER TABLE public.booking_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_stops_participants_select" ON public.booking_stops;
CREATE POLICY "booking_stops_participants_select" ON public.booking_stops
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.id = booking_stops.booking_id
         AND (b.customer_id = auth.uid() OR b.driver_id = auth.uid())
    )
    OR public.has_role(auth.uid(),'admin')
  );

DROP POLICY IF EXISTS "booking_stops_customer_insert" ON public.booking_stops;
CREATE POLICY "booking_stops_customer_insert" ON public.booking_stops
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.id = booking_stops.booking_id
         AND b.customer_id = auth.uid()
         AND b.status = 'pending'::public.booking_status
    )
  );

CREATE INDEX IF NOT EXISTS booking_stops_booking_idx
  ON public.booking_stops (booking_id, sequence);

-- Backfill pickup/drop for every historical trip.
INSERT INTO public.booking_stops(booking_id, sequence, kind, address, latitude, longitude)
SELECT b.id, 0, 'pickup', b.pickup_address, b.pickup_lat, b.pickup_lng
  FROM public.bookings b
 WHERE length(btrim(b.pickup_address)) BETWEEN 3 AND 400
ON CONFLICT (booking_id, sequence) DO NOTHING;

INSERT INTO public.booking_stops(booking_id, sequence, kind, address, latitude, longitude)
SELECT b.id, 10, 'drop', b.drop_address, b.drop_lat, b.drop_lng
  FROM public.bookings b
 WHERE length(btrim(b.drop_address)) BETWEEN 3 AND 400
ON CONFLICT (booking_id, sequence) DO NOTHING;

-- 6. Signup now also creates the customer domain record ------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE normalized_phone text;
BEGIN
  normalized_phone := regexp_replace(COALESCE(NEW.raw_user_meta_data->>'phone',''), '[^0-9]', '', 'g');
  IF normalized_phone <> '' AND (length(normalized_phone) <> 10 OR normalized_phone !~ '^[6-9][0-9]{9}$') THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number';
  END IF;
  INSERT INTO public.profiles(id, phone, name)
  VALUES (NEW.id, normalized_phone, COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'name'),''),'User'))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'customer'::public.app_role)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.customer_profiles(user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;

-- 7. Extra integrity / lookup coverage -----------------------
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_id_key
  ON public.payments (provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_customer_created_idx
  ON public.payments (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_booking_idx ON public.payments (booking_id);
CREATE INDEX IF NOT EXISTS withdrawal_requests_driver_created_idx
  ON public.withdrawal_requests (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_transactions_user_created_idx
  ON public.wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS saved_addresses_user_idx ON public.saved_addresses (user_id, kind);
CREATE INDEX IF NOT EXISTS customer_gstins_user_idx ON public.customer_gstins (user_id);
CREATE INDEX IF NOT EXISTS driver_bank_accounts_driver_idx ON public.driver_bank_accounts (driver_id);

-- 8. Data dictionary ----------------------------------------
COMMENT ON TABLE public.profiles IS 'Identity domain. Minimal shared account state for every user (name, phone, active mode, online flag, KYC mirror, service zone). Owner: the user; readable by the user and admins only.';
COMMENT ON TABLE public.customer_profiles IS 'Customer domain. One row per user holding customer-only settings. Owner: the customer; readable by the customer and admins.';
COMMENT ON COLUMN public.customer_profiles.default_gstin_id IS 'Preferred billing GSTIN; must belong to the same customer.';
COMMENT ON TABLE public.driver_profiles IS 'Driver domain. One row per driver holding operational vehicle/payout state. payout_hold is ops-only. Sensitive documents live in driver_kyc, payout details in driver_bank_accounts.';
COMMENT ON TABLE public.driver_applications IS 'Driver domain. Application lifecycle for a customer applying to drive. Role stays customer until an admin approves; only admins can change status.';
COMMENT ON TABLE public.driver_kyc IS 'Driver domain. KYC documents and review audit fields. Private storage paths only; never readable by customers or other drivers.';
COMMENT ON TABLE public.driver_bank_accounts IS 'Driver domain. Payout bank/UPI details. Readable only by the owning driver and admins.';
COMMENT ON TABLE public.booking_stops IS 'Booking domain. Ordered pickup, intermediate stops and drop for a trip. sequence 0 = pickup, 10 = drop. Readable by the trip customer, the assigned driver and admins.';
COMMENT ON TABLE public.bookings IS 'Booking domain. Central trip aggregate: addresses, vehicle, distance, fare, status, payment and verification state. Fare/status/driver/commission/payment fields are server-authoritative; OTPs live in private.booking_otps.';
COMMENT ON TABLE public.payments IS 'Finance domain. Payment provider order/transaction state only. Never stores provider secrets.';
COMMENT ON TABLE public.webhook_events IS 'Finance domain. Provider webhook idempotency log.';
COMMENT ON TABLE public.wallet_accounts IS 'Finance domain. Current coin/cash balance snapshot; written only by server-side functions and triggers.';
COMMENT ON TABLE public.wallet_transactions IS 'Finance domain. Append-only wallet ledger; users may read only their own rows.';
COMMENT ON TABLE public.withdrawal_requests IS 'Finance domain. Driver payout requests; amount and balance validated server-side.';
COMMENT ON TABLE public.coupons IS 'Rewards domain. Coupon master configuration.';
COMMENT ON TABLE public.coupon_redemptions IS 'Rewards domain. Per-user, per-booking redemption ledger; one redemption per booking.';
COMMENT ON TABLE public.audit_logs IS 'Operations domain. Append-only audit trail; readable by admins/service role only.';
COMMENT ON TABLE public.sms_logs IS 'Operations domain. Outbound SMS delivery records.';
COMMENT ON TABLE public.device_tokens IS 'Shared domain. Push tokens for any user in either mode; owned by the user.';
COMMENT ON TABLE public.driver_locations IS 'Driver domain. Latest GPS ping per driver; visible to admins and the customer of an active trip.';
COMMENT ON TABLE public.driver_booking_passes IS 'Driver domain. Records a driver skipping a trip so it leaves their queue.';
COMMENT ON TABLE public.driver_incentive_config IS 'Driver domain. Daily ride-count bonus configuration.';
COMMENT ON TABLE public.driver_incentive_earnings IS 'Driver domain. Settled daily incentive per driver.';
COMMENT ON TABLE public.saved_addresses IS 'Customer domain. Saved pickup/drop addresses owned by the user.';
COMMENT ON TABLE public.customer_gstins IS 'Customer domain. Customer GST numbers used for tax invoices.';
COMMENT ON TABLE public.user_roles IS 'Identity domain. Role assignments (customer/driver/admin); the only source of truth for authorisation.';

-- 9. Least privilege on the new helper functions -------------
REVOKE ALL ON FUNCTION public.customer_profiles_validate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_profiles_protect() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_applications_protect() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_driver_domain_from_kyc() FROM PUBLIC;

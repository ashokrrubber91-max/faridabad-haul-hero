-- 1. Detach transactional history from auth.users so deleting a login cannot erase business records.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass::text AS tbl
    FROM pg_constraint c
    JOIN pg_class ref ON ref.oid = c.confrelid
    JOIN pg_namespace refn ON refn.oid = ref.relnamespace
    WHERE c.contype = 'f'
      AND refn.nspname = 'auth' AND ref.relname = 'users'
      AND c.conrelid IN ('public.bookings'::regclass, 'public.payments'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- 2. Consent records
CREATE TABLE IF NOT EXISTS public.user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  source text NOT NULL DEFAULT 'signup',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, terms_version, privacy_version)
);
GRANT SELECT, INSERT ON public.user_consents TO authenticated;
GRANT ALL ON public.user_consents TO service_role;
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_consents_own_select ON public.user_consents
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_consents_own_insert ON public.user_consents
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY user_consents_admin_select ON public.user_consents
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.record_consent(
  _terms_version text,
  _privacy_version text,
  _source text DEFAULT 'signup'
) RETURNS public.user_consents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.user_consents;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF coalesce(trim(_terms_version), '') = '' OR coalesce(trim(_privacy_version), '') = '' THEN
    RAISE EXCEPTION 'Policy version is required';
  END IF;
  IF _source NOT IN ('signup', 'reconsent', 'account') THEN
    RAISE EXCEPTION 'Invalid consent source';
  END IF;
  INSERT INTO public.user_consents (user_id, terms_version, privacy_version, source)
  VALUES (auth.uid(), trim(_terms_version), trim(_privacy_version), _source)
  ON CONFLICT (user_id, terms_version, privacy_version) DO UPDATE SET user_id = public.user_consents.user_id
  RETURNING * INTO row;
  RETURN row;
END $$;
REVOKE ALL ON FUNCTION public.record_consent(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_consent(text, text, text) TO authenticated;

-- 3. Deletion log (no personal data)
CREATE TABLE IF NOT EXISTS public.account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  had_bookings boolean NOT NULL DEFAULT false,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.account_deletions TO service_role;
GRANT SELECT ON public.account_deletions TO authenticated;
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_deletions_admin_select ON public.account_deletions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 4. Self-service deletion: anonymise personal data, keep transactional records.
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  open_count int;
  had bool;
  paths text[] := '{}';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT count(*) INTO open_count FROM public.bookings
   WHERE (customer_id = uid OR driver_id = uid)
     AND status IN ('pending', 'accepted', 'in_progress');
  IF open_count > 0 THEN
    RAISE EXCEPTION 'You still have an ongoing trip. Please finish or cancel it before deleting your account.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.bookings WHERE customer_id = uid OR driver_id = uid) INTO had;

  SELECT coalesce(array_agg(p) FILTER (WHERE p IS NOT NULL), '{}')
    INTO paths
  FROM (
    SELECT unnest(ARRAY[dl_front_url, dl_back_url, rc_url, id_proof_url, vehicle_photo_url,
                        insurance_url, puc_url, number_plate_url, driver_photo_url, poc_photo_url]) AS p
    FROM public.driver_kyc WHERE driver_id = uid
  ) s;

  DELETE FROM public.saved_addresses WHERE user_id = uid;
  DELETE FROM public.customer_gstins WHERE user_id = uid;
  DELETE FROM public.device_tokens WHERE user_id = uid;
  DELETE FROM public.driver_bank_accounts WHERE driver_id = uid;
  DELETE FROM public.driver_locations WHERE driver_id = uid;
  DELETE FROM public.notifications WHERE user_id = uid;
  DELETE FROM public.driver_kyc WHERE driver_id = uid;
  DELETE FROM public.customer_profiles WHERE user_id = uid;
  DELETE FROM public.driver_profiles WHERE user_id = uid;
  UPDATE public.booking_share_links SET revoked_at = now()
    WHERE created_by = uid AND revoked_at IS NULL;
  UPDATE public.profiles
     SET name = 'Deleted user', phone = '0000000000'
   WHERE id = uid;

  INSERT INTO public.account_deletions (user_id, had_bookings) VALUES (uid, had);

  RETURN jsonb_build_object('storage_paths', to_jsonb(paths), 'had_bookings', had);
END $$;
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
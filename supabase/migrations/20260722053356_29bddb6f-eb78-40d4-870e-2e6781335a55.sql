-- KYC status enum
DO $$ BEGIN
  CREATE TYPE public.kyc_status AS ENUM ('not_submitted','pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Profile column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kyc_status public.kyc_status NOT NULL DEFAULT 'not_submitted';

-- KYC table
CREATE TABLE IF NOT EXISTS public.driver_kyc (
  driver_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  city text NOT NULL DEFAULT 'Faridabad',
  vehicle_id text NOT NULL,
  dl_front_url text,
  dl_back_url text,
  rc_url text,
  id_proof_url text,
  vehicle_photo_url text,
  status public.kyc_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_kyc TO authenticated;
GRANT ALL ON public.driver_kyc TO service_role;
ALTER TABLE public.driver_kyc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers manage own kyc" ON public.driver_kyc;
CREATE POLICY "Drivers manage own kyc" ON public.driver_kyc
  FOR ALL TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.sync_profile_kyc_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET kyc_status = NEW.status WHERE id = NEW.driver_id;
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_kyc_status ON public.driver_kyc;
CREATE TRIGGER trg_sync_kyc_status
BEFORE INSERT OR UPDATE ON public.driver_kyc
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_kyc_status();

-- Storage RLS for driver-kyc bucket (files scoped by driver uid folder)
DROP POLICY IF EXISTS "Driver uploads own kyc files" ON storage.objects;
CREATE POLICY "Driver uploads own kyc files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'driver-kyc'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Driver reads own kyc files" ON storage.objects;
CREATE POLICY "Driver reads own kyc files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'driver-kyc'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin')
    )
  );

DROP POLICY IF EXISTS "Driver updates own kyc files" ON storage.objects;
CREATE POLICY "Driver updates own kyc files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'driver-kyc'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
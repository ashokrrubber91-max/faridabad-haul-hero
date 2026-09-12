-- 1. Remove blanket UPDATE from ordinary signed-in users on the verification domain.
REVOKE UPDATE ON public.driver_kyc FROM authenticated;
REVOKE UPDATE ON public.driver_applications FROM authenticated;
REVOKE UPDATE ON public.driver_profiles FROM authenticated;

-- 2. Re-grant only the columns a driver legitimately edits about themselves.
GRANT UPDATE (
  full_name, city, vehicle_id, vehicle_number,
  dl_front_url, dl_back_url, rc_url, id_proof_url, vehicle_photo_url,
  insurance_url, puc_url, number_plate_url, updated_at
) ON public.driver_kyc TO authenticated;

GRANT UPDATE (vehicle_type, vehicle_number, updated_at) ON public.driver_profiles TO authenticated;
-- driver_applications: no UPDATE for authenticated at all; lifecycle is server-side only.

GRANT ALL ON public.driver_kyc TO service_role;
GRANT ALL ON public.driver_applications TO service_role;
GRANT ALL ON public.driver_profiles TO service_role;

-- 3. Driver-owned (re)submission: the only path that may set status back to pending.
CREATE OR REPLACE FUNCTION public.submit_driver_kyc(
  _full_name text,
  _city text,
  _vehicle_id text,
  _dl_front_url text,
  _dl_back_url text,
  _rc_url text,
  _id_proof_url text,
  _vehicle_photo_url text,
  _vehicle_number text DEFAULT NULL,
  _insurance_url text DEFAULT NULL,
  _puc_url text DEFAULT NULL,
  _number_plate_url text DEFAULT NULL
)
RETURNS public.driver_kyc
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _current kyc_status;
  _row public.driver_kyc;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to submit your documents';
  END IF;
  IF coalesce(length(btrim(_full_name)), 0) < 2 THEN
    RAISE EXCEPTION 'Enter your full name';
  END IF;
  IF _vehicle_id IS NULL OR btrim(_vehicle_id) = '' THEN
    RAISE EXCEPTION 'Choose your vehicle';
  END IF;

  SELECT status INTO _current FROM public.driver_kyc WHERE driver_id = _uid;
  IF _current = 'approved' THEN
    RAISE EXCEPTION 'Your account is already verified. Contact support to change your details.';
  END IF;

  INSERT INTO public.driver_kyc AS k (
    driver_id, full_name, city, vehicle_id, vehicle_number,
    dl_front_url, dl_back_url, rc_url, id_proof_url, vehicle_photo_url,
    insurance_url, puc_url, number_plate_url,
    status, rejection_reason, submitted_at, reviewed_at, reviewed_by
  ) VALUES (
    _uid, btrim(_full_name), coalesce(nullif(btrim(_city), ''), 'Faridabad'), _vehicle_id, nullif(btrim(_vehicle_number), ''),
    _dl_front_url, _dl_back_url, _rc_url, _id_proof_url, _vehicle_photo_url,
    _insurance_url, _puc_url, _number_plate_url,
    'pending', NULL, now(), NULL, NULL
  )
  ON CONFLICT (driver_id) DO UPDATE SET
    full_name = excluded.full_name,
    city = excluded.city,
    vehicle_id = excluded.vehicle_id,
    vehicle_number = coalesce(excluded.vehicle_number, k.vehicle_number),
    dl_front_url = excluded.dl_front_url,
    dl_back_url = excluded.dl_back_url,
    rc_url = excluded.rc_url,
    id_proof_url = excluded.id_proof_url,
    vehicle_photo_url = excluded.vehicle_photo_url,
    insurance_url = coalesce(excluded.insurance_url, k.insurance_url),
    puc_url = coalesce(excluded.puc_url, k.puc_url),
    number_plate_url = coalesce(excluded.number_plate_url, k.number_plate_url),
    status = 'pending',
    rejection_reason = NULL,
    submitted_at = now(),
    reviewed_at = NULL,
    reviewed_by = NULL
  RETURNING k.* INTO _row;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_driver_kyc(text,text,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_driver_kyc(text,text,text,text,text,text,text,text,text,text,text,text) TO authenticated;

-- 4. Admin-only review: the only path that may set approved/rejected.
CREATE OR REPLACE FUNCTION public.review_driver_kyc(
  _driver_id uuid,
  _decision kyc_status,
  _reason text DEFAULT NULL
)
RETURNS public.driver_kyc
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.driver_kyc;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Only the operations team can review applications';
  END IF;
  IF _decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;
  IF _decision = 'rejected' AND coalesce(length(btrim(_reason)), 0) < 4 THEN
    RAISE EXCEPTION 'Add a rejection reason the applicant can act on';
  END IF;

  UPDATE public.driver_kyc SET
    status = _decision,
    rejection_reason = CASE WHEN _decision = 'rejected' THEN btrim(_reason) ELSE NULL END,
    reviewed_at = now(),
    reviewed_by = _uid
  WHERE driver_id = _driver_id
  RETURNING * INTO _row;

  IF _row.driver_id IS NULL THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.review_driver_kyc(uuid, kyc_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_driver_kyc(uuid, kyc_status, text) TO authenticated;

COMMENT ON FUNCTION public.submit_driver_kyc(text,text,text,text,text,text,text,text,text,text,text,text) IS 'Driver-owned document (re)submission. Status is always forced to pending and review fields cleared; approval columns are not writable by authenticated role.';
COMMENT ON FUNCTION public.review_driver_kyc(uuid, kyc_status, text) IS 'Admin-only approve/reject. Verifies has_role(admin) before writing status/reviewer columns, which authenticated role cannot update directly.';

ALTER TABLE public.driver_kyc
  ADD COLUMN IF NOT EXISTS driver_photo_url text,
  ADD COLUMN IF NOT EXISTS poc_name text,
  ADD COLUMN IF NOT EXISTS poc_phone text,
  ADD COLUMN IF NOT EXISTS poc_photo_url text;

DROP FUNCTION IF EXISTS public.driver_update_account_profile(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.driver_update_account_profile(
  _vehicle_number text DEFAULT NULL::text,
  _vehicle_photo_url text DEFAULT NULL::text,
  _insurance_url text DEFAULT NULL::text,
  _puc_url text DEFAULT NULL::text,
  _number_plate_url text DEFAULT NULL::text,
  _driver_photo_url text DEFAULT NULL::text,
  _poc_photo_url text DEFAULT NULL::text,
  _poc_name text DEFAULT NULL::text,
  _poc_phone text DEFAULT NULL::text
)
RETURNS driver_kyc
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.driver_kyc;
  _docs_changed boolean := (_vehicle_photo_url IS NOT NULL OR _insurance_url IS NOT NULL OR _puc_url IS NOT NULL OR _number_plate_url IS NOT NULL OR _driver_photo_url IS NOT NULL OR _poc_photo_url IS NOT NULL);
  _num text := nullif(btrim(coalesce(_vehicle_number, '')), '');
  _pname text := nullif(btrim(coalesce(_poc_name, '')), '');
  _pphone text := nullif(regexp_replace(coalesce(_poc_phone, ''), '\D', '', 'g'), '');
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to update your driver profile';
  END IF;
  IF NOT public.has_role(_uid, 'driver'::app_role) THEN
    RAISE EXCEPTION 'Only drivers can update a driver profile';
  END IF;
  IF _num IS NOT NULL AND (length(_num) < 4 OR length(_num) > 20) THEN
    RAISE EXCEPTION 'Enter a valid vehicle registration number';
  END IF;
  IF _pname IS NOT NULL AND (length(_pname) < 2 OR length(_pname) > 80) THEN
    RAISE EXCEPTION 'Enter a valid contact person name';
  END IF;
  IF _pphone IS NOT NULL AND _pphone !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit contact phone number';
  END IF;

  SELECT * INTO _row FROM public.driver_kyc WHERE driver_id = _uid;
  IF _row.driver_id IS NULL THEN
    RAISE EXCEPTION 'Submit your driver documents first';
  END IF;

  UPDATE public.driver_kyc AS k
     SET vehicle_number = coalesce(_num, k.vehicle_number),
         vehicle_photo_url = coalesce(_vehicle_photo_url, k.vehicle_photo_url),
         insurance_url = coalesce(_insurance_url, k.insurance_url),
         puc_url = coalesce(_puc_url, k.puc_url),
         number_plate_url = coalesce(_number_plate_url, k.number_plate_url),
         driver_photo_url = coalesce(_driver_photo_url, k.driver_photo_url),
         poc_photo_url = coalesce(_poc_photo_url, k.poc_photo_url),
         poc_name = coalesce(_pname, k.poc_name),
         poc_phone = coalesce(_pphone, k.poc_phone),
         status = CASE WHEN _docs_changed THEN 'pending'::kyc_status ELSE k.status END,
         rejection_reason = CASE WHEN _docs_changed THEN NULL ELSE k.rejection_reason END,
         submitted_at = CASE WHEN _docs_changed THEN now() ELSE k.submitted_at END,
         reviewed_at = CASE WHEN _docs_changed THEN NULL ELSE k.reviewed_at END,
         reviewed_by = CASE WHEN _docs_changed THEN NULL ELSE k.reviewed_by END,
         updated_at = now()
   WHERE k.driver_id = _uid
  RETURNING k.* INTO _row;

  RETURN _row;
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_update_account_profile(text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_update_account_profile(text, text, text, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_update_account_profile(text, text, text, text, text, text, text, text, text) TO authenticated;
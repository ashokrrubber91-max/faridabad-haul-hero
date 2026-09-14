-- Driver self-service account profile: operational vehicle number plus KYC document paths.
-- Sensitive documents remain in the private driver-kyc bucket and are never exposed to other drivers/customers.

CREATE OR REPLACE FUNCTION public.driver_update_account_profile(
  _vehicle_number text DEFAULT NULL,
  _vehicle_photo_url text DEFAULT NULL,
  _insurance_url text DEFAULT NULL,
  _puc_url text DEFAULT NULL,
  _number_plate_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only an approved driver can update driver profile details';
  END IF;

  INSERT INTO public.driver_profiles(user_id, vehicle_number)
  VALUES (uid, NULLIF(btrim(_vehicle_number), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET vehicle_number = CASE
      WHEN _vehicle_number IS NULL THEN public.driver_profiles.vehicle_number
      ELSE NULLIF(btrim(_vehicle_number), '')
    END,
    updated_at = now();

  INSERT INTO public.driver_kyc AS k (
    driver_id, full_name, city, vehicle_number,
    vehicle_photo_url, insurance_url, puc_url, number_plate_url,
    status, submitted_at
  )
  SELECT uid,
         COALESCE(NULLIF(p.name, ''), 'Driver'),
         COALESCE(NULLIF(p.service_zone, ''), 'Faridabad'),
         NULLIF(btrim(_vehicle_number), ''),
         _vehicle_photo_url, _insurance_url, _puc_url, _number_plate_url,
         'pending', now()
    FROM public.profiles p
   WHERE p.id = uid
  ON CONFLICT (driver_id) DO UPDATE
    SET vehicle_number = CASE WHEN _vehicle_number IS NULL THEN k.vehicle_number ELSE NULLIF(btrim(_vehicle_number), '') END,
        vehicle_photo_url = COALESCE(_vehicle_photo_url, k.vehicle_photo_url),
        insurance_url = COALESCE(_insurance_url, k.insurance_url),
        puc_url = COALESCE(_puc_url, k.puc_url),
        number_plate_url = COALESCE(_number_plate_url, k.number_plate_url),
        status = CASE WHEN _vehicle_photo_url IS NOT NULL OR _insurance_url IS NOT NULL OR _puc_url IS NOT NULL OR _number_plate_url IS NOT NULL OR _vehicle_number IS NOT NULL THEN 'pending' ELSE k.status END,
        submitted_at = CASE WHEN _vehicle_photo_url IS NOT NULL OR _insurance_url IS NOT NULL OR _puc_url IS NOT NULL OR _number_plate_url IS NOT NULL OR _vehicle_number IS NOT NULL THEN now() ELSE k.submitted_at END;
END $function$;

REVOKE ALL ON FUNCTION public.driver_update_account_profile(text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_update_account_profile(text,text,text,text,text) TO authenticated;

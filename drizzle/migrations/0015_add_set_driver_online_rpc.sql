-- Let trusted server-side functions change the online/mode mirror while
-- ordinary client updates still cannot touch privileged profile fields.
CREATE OR REPLACE FUNCTION public.profiles_protect_privileged_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE trusted boolean := COALESCE(current_setting('miniport.trusted_write', true), '') = 'on';
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  NEW.id := OLD.id;
  NEW.phone := OLD.phone;
  NEW.kyc_status := OLD.kyc_status;
  IF NOT trusted THEN
    NEW.is_online := OLD.is_online;
    NEW.active_mode := OLD.active_mode;
  END IF;
  NEW.referral_code := OLD.referral_code;
  NEW.service_zone := OLD.service_zone;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.set_driver_online(_is_online boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE uid uuid := auth.uid(); result boolean;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Driver access required' USING ERRCODE = '42501';
  END IF;
  IF _is_online AND NOT public.is_kyc_approved(uid) THEN
    RAISE EXCEPTION 'Driver verification must be approved before going online.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.profiles
  SET is_online = _is_online,
      kyc_status = CASE WHEN _is_online THEN 'approved'::public.kyc_status ELSE kyc_status END,
      active_mode = CASE WHEN _is_online THEN 'driver' ELSE active_mode END
  WHERE id = uid
  RETURNING is_online INTO result;
  PERFORM set_config('miniport.trusted_write', '', true);
  IF result IS NULL THEN
    RAISE EXCEPTION 'Driver profile not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.set_driver_online(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_driver_online(boolean) TO authenticated;

-- set_my_online had the same silent no-op under the protection trigger.
CREATE OR REPLACE FUNCTION public.set_my_online(_is_online boolean)
 RETURNS public.profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE uid uuid := auth.uid(); result public.profiles;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Driver access required';
  END IF;
  IF _is_online AND NOT public.is_kyc_approved(uid) THEN
    RAISE EXCEPTION 'Driver verification required';
  END IF;
  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.profiles
  SET is_online = _is_online,
      active_mode = CASE WHEN _is_online THEN 'driver' ELSE active_mode END
  WHERE id = uid
  RETURNING * INTO result;
  PERFORM set_config('miniport.trusted_write', '', true);
  RETURN result;
END
$function$;

NOTIFY pgrst, 'reload schema';
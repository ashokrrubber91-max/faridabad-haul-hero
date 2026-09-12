REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (name, phone, is_online, active_mode) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE OR REPLACE FUNCTION public.profiles_protect_privileged_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  NEW.id := OLD.id;
  NEW.kyc_status := OLD.kyc_status;
  NEW.service_zone := OLD.service_zone;
  NEW.created_at := OLD.created_at;
  -- A driver can only be online once their documents are approved.
  IF NEW.is_online IS TRUE AND OLD.kyc_status <> 'approved'::public.kyc_status THEN
    NEW.is_online := false;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS profiles_protect_privileged_fields ON public.profiles;
CREATE TRIGGER profiles_protect_privileged_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_privileged_fields();

REVOKE ALL ON FUNCTION public.profiles_protect_privileged_fields() FROM PUBLIC, anon, authenticated;
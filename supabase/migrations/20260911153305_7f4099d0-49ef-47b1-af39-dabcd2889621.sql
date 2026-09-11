CREATE OR REPLACE FUNCTION public.sync_driver_role_on_kyc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status = 'approved'::public.kyc_status THEN
    INSERT INTO public.user_roles(user_id, role)
    VALUES (NEW.driver_id, 'driver'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSIF NEW.status = 'rejected'::public.kyc_status THEN
    DELETE FROM public.user_roles
      WHERE user_id = NEW.driver_id AND role = 'driver'::public.app_role;
    UPDATE public.profiles SET is_online = false WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS zzz_driver_kyc_sync_role ON public.driver_kyc;
CREATE TRIGGER zzz_driver_kyc_sync_role
AFTER INSERT OR UPDATE OF status ON public.driver_kyc
FOR EACH ROW EXECUTE FUNCTION public.sync_driver_role_on_kyc();

INSERT INTO public.user_roles(user_id, role)
SELECT k.driver_id, 'driver'::public.app_role
FROM public.driver_kyc k
WHERE k.status = 'approved'::public.kyc_status
ON CONFLICT (user_id, role) DO NOTHING;
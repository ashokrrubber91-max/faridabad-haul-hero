-- Safety invariant: a driver cannot remain online when KYC is not approved.
CREATE OR REPLACE FUNCTION public.force_driver_offline_when_kyc_not_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'approved'::public.kyc_status THEN
    UPDATE public.profiles
       SET is_online = false,
           kyc_status = NEW.status
     WHERE id = NEW.driver_id;
  ELSE
    UPDATE public.profiles
       SET kyc_status = NEW.status
     WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS force_driver_offline_when_kyc_changes ON public.driver_kyc;
CREATE TRIGGER force_driver_offline_when_kyc_changes
AFTER INSERT OR UPDATE OF status ON public.driver_kyc
FOR EACH ROW
EXECUTE FUNCTION public.force_driver_offline_when_kyc_not_approved();

REVOKE ALL ON FUNCTION public.force_driver_offline_when_kyc_not_approved() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.force_driver_offline_when_kyc_not_approved() TO service_role;

REVOKE ALL ON FUNCTION public.customer_profiles_validate() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.driver_profiles_protect() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.driver_applications_protect() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_driver_domain_from_kyc() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;

-- Trigger-only SECURITY DEFINER functions are not API endpoints.
-- Trigger execution does not require end-user EXECUTE grants.
REVOKE ALL ON FUNCTION public.driver_profiles_protect() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_driver_profile_vehicle_from_kyc() FROM PUBLIC, anon, authenticated;

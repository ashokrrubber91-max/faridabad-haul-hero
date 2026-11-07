-- A driver must not be able to change the operational vehicle type
-- independently of the verified KYC vehicle record.
REVOKE UPDATE ON TABLE public.driver_profiles FROM authenticated;
DROP POLICY IF EXISTS "driver_profiles_own_update" ON public.driver_profiles;
DROP TRIGGER IF EXISTS driver_profiles_protect ON public.driver_profiles;
DROP FUNCTION IF EXISTS public.driver_profiles_protect();
-- Vehicle type/number changes now flow through driver_kyc and its server-side sync trigger.

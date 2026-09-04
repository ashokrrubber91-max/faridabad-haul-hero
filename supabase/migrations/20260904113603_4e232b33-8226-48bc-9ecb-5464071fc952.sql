CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $private_role$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$private_role$;

CREATE OR REPLACE FUNCTION private.is_kyc_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $private_kyc$
  SELECT EXISTS (
    SELECT 1 FROM public.driver_kyc
    WHERE driver_id = _user_id AND status = 'approved'::public.kyc_status
  )
$private_kyc$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_kyc_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_kyc_approved(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $public_role$
  SELECT private.has_role(_user_id, _role)
$public_role$;

CREATE OR REPLACE FUNCTION public.is_kyc_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $public_kyc$
  SELECT private.is_kyc_approved(_user_id)
$public_kyc$;

ALTER FUNCTION public.validate_coupon(text, numeric) SECURITY INVOKER;
ALTER FUNCTION public.settle_daily_incentives(date) SECURITY INVOKER;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_kyc_approved(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.settle_daily_incentives(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_kyc_approved(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_daily_incentives(date) TO authenticated, service_role;
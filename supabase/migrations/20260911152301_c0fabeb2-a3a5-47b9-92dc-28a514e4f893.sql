REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, numeric, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, numeric, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text, numeric) TO authenticated;
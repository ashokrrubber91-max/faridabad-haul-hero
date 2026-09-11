REVOKE ALL ON FUNCTION public.audit_booking_financial_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_payment_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_user_role_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_booking_state_machine() FROM PUBLIC, anon, authenticated;
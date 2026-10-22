-- Lock down exposed RPC entry points identified by the Supabase security advisor.
-- These changes affect function permissions only; no booking, payment, or wallet rows are changed.

REVOKE ALL ON FUNCTION public.bookings_debit_wallet_cash() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_debit_wallet_cash() TO service_role;

REVOKE ALL ON FUNCTION public.start_driver_dispatch_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_driver_dispatch_trigger() TO service_role;

REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.broadcast_driver_location() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_driver_location() TO authenticated, service_role;

-- This helper is for development/testing only and must not be callable by app users.
REVOKE ALL ON FUNCTION public.test_recharge_driver_wallet(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_recharge_driver_wallet(numeric) TO service_role;

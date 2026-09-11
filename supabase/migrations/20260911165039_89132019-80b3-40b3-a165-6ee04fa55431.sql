-- Forward-only cleanup of exact duplicate indexes (identical definitions kept once)
DROP INDEX IF EXISTS public.idx_bookings_customer_created;
DROP INDEX IF EXISTS public.idx_bookings_driver_created;
DROP INDEX IF EXISTS public.idx_audit_logs_created_at;
DROP INDEX IF EXISTS public.idx_audit_logs_table_name;
DROP INDEX IF EXISTS public.uq_payments_provider_order_id;
DROP INDEX IF EXISTS public.uq_payments_provider_payment_id;
DROP INDEX IF EXISTS public.idx_wallet_transactions_user_created;
DROP INDEX IF EXISTS public.idx_wallet_txn_user_created;
DROP INDEX IF EXISTS public.idx_withdrawal_requests_driver_created;
DROP INDEX IF EXISTS public.idx_withdrawals_status_created;

-- Missing high-value indexes based on actual query patterns
CREATE INDEX IF NOT EXISTS driver_kyc_status_submitted_idx
  ON public.driver_kyc (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS sms_logs_status_created_idx
  ON public.sms_logs (status, created_at DESC);

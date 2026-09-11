CREATE POLICY "Admins read wallet ledger" ON public.wallet_transactions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON public.audit_logs (table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_created ON public.withdrawal_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_user_created ON public.wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_state_created ON public.payments (state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_created ON public.bookings (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_driver_created ON public.bookings (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_status_created ON public.bookings (status, created_at DESC);
-- Payout details used by the wallet and admin payout screens.
-- Wallet debit (on request) and refund (on rejection) stay in the existing
-- withdrawals_validate / withdrawals_settle triggers, so these RPCs never move money themselves.
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS upi_id text,
  ADD COLUMN IF NOT EXISTS utr_number text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(p_amount numeric, p_upi_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_driver_id uuid := auth.uid();
  v_request public.withdrawal_requests;
  v_upi text := btrim(coalesce(p_upi_id, ''));
BEGIN
  IF v_driver_id IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF NOT public.has_role(v_driver_id, 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only driver partners can withdraw';
  END IF;
  IF v_upi !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$' THEN
    RAISE EXCEPTION 'Enter a valid UPI ID';
  END IF;

  -- withdrawals_validate enforces limits and atomically debits the wallet.
  INSERT INTO public.withdrawal_requests(driver_id, amount, method, status, note, upi_id)
  VALUES (v_driver_id, round(p_amount, 2), 'upi', 'requested'::public.withdrawal_status, 'UPI: ' || v_upi, v_upi)
  RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'amount', v_request.amount,
    'upi_id', v_request.upi_id,
    'status', v_request.status,
    'remaining_balance', (SELECT cash_balance FROM public.wallet_accounts WHERE user_id = v_driver_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_withdrawal_admin(
  p_request_id uuid, p_status text, p_utr_number text DEFAULT NULL, p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_admin uuid := auth.uid();
  v_request public.withdrawal_requests;
  v_status public.withdrawal_status;
  v_utr text := nullif(btrim(coalesce(p_utr_number, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only MiniPort admins can process withdrawals';
  END IF;
  IF p_status = 'approved' THEN
    v_status := 'paid'::public.withdrawal_status;
    IF v_utr IS NULL THEN RAISE EXCEPTION 'UTR / transaction reference is required'; END IF;
  ELSIF p_status = 'rejected' THEN
    v_status := 'rejected'::public.withdrawal_status;
    IF v_reason IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
  ELSE
    RAISE EXCEPTION 'Invalid payout status';
  END IF;

  SELECT * INTO v_request FROM public.withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal request not found'; END IF;
  IF v_request.status <> 'requested'::public.withdrawal_status THEN
    RAISE EXCEPTION 'This withdrawal has already been processed';
  END IF;

  -- withdrawals_settle refunds the wallet exactly once on requested -> rejected.
  UPDATE public.withdrawal_requests
     SET status = v_status,
         utr_number = CASE WHEN v_status = 'paid'::public.withdrawal_status THEN v_utr END,
         rejection_reason = CASE WHEN v_status = 'rejected'::public.withdrawal_status THEN v_reason END,
         processed_at = now()
   WHERE id = p_request_id
   RETURNING * INTO v_request;

  INSERT INTO public.notifications(user_id, title, body, kind)
  VALUES (
    v_request.driver_id,
    CASE WHEN v_status = 'paid'::public.withdrawal_status THEN 'Withdrawal approved' ELSE 'Withdrawal rejected' END,
    CASE WHEN v_status = 'paid'::public.withdrawal_status
      THEN 'Your withdrawal of ₹' || round(v_request.amount, 0)::text || ' has been approved. UTR: ' || v_request.utr_number
      ELSE 'Your withdrawal of ₹' || round(v_request.amount, 0)::text || ' was rejected. ' || v_request.rejection_reason || ' The amount has been returned to your wallet.'
    END,
    'withdrawal'
  );

  RETURN jsonb_build_object('success', true, 'request_id', v_request.id, 'status', v_request.status,
    'amount', v_request.amount, 'utr_number', v_request.utr_number, 'rejection_reason', v_request.rejection_reason);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.request_wallet_withdrawal(numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_wallet_withdrawal(numeric, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.process_withdrawal_admin(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_withdrawal_admin(uuid, text, text, text) TO authenticated;
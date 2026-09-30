CREATE OR REPLACE FUNCTION public.credit_driver_wallet_topup(
  _payment_id uuid,
  _driver_id uuid,
  _amount numeric,
  _provider_payment_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.payments%rowtype;
  new_balance numeric;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'; END IF;
  IF p.customer_id <> _driver_id OR p.method <> 'wallet_topup' OR p.booking_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid wallet top-up payment';
  END IF;
  IF abs(p.amount - _amount) > 0.01 THEN RAISE EXCEPTION 'Top-up amount mismatch'; END IF;

  IF p.state = 'paid' THEN
    SELECT cash_balance INTO new_balance FROM public.wallet_accounts WHERE user_id = _driver_id;
    RETURN jsonb_build_object('ok', true, 'already_credited', true, 'balance', coalesce(new_balance, 0));
  END IF;

  IF p.state <> 'created' THEN RAISE EXCEPTION 'Payment is not payable'; END IF;

  INSERT INTO public.wallet_accounts(user_id, cash_balance, coins_balance)
  VALUES (_driver_id, _amount, 0)
  ON CONFLICT (user_id) DO UPDATE
    SET cash_balance = public.wallet_accounts.cash_balance + EXCLUDED.cash_balance,
        updated_at = now()
  RETURNING cash_balance INTO new_balance;

  INSERT INTO public.wallet_transactions(user_id, delta, reason)
  VALUES (_driver_id, _amount, 'Online wallet top-up');

  UPDATE public.payments
  SET state = 'paid',
      provider_payment_id = _provider_payment_id,
      method = 'wallet_topup',
      updated_at = now()
  WHERE id = _payment_id;

  RETURN jsonb_build_object('ok', true, 'already_credited', false, 'balance', new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.credit_driver_wallet_topup(uuid, uuid, numeric, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_driver_wallet_topup(uuid, uuid, numeric, text) TO service_role;

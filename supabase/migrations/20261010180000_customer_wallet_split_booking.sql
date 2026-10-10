ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS wallet_deducted_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_payable_amount numeric;

UPDATE public.bookings
SET final_payable_amount = COALESCE(final_payable_amount, fare)
WHERE final_payable_amount IS NULL;

CREATE OR REPLACE FUNCTION public.apply_booking_wallet_deduction(
  _booking_id uuid,
  _customer_id uuid,
  _requested_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance numeric;
  v_fare numeric;
  v_payable numeric;
BEGIN
  IF _requested_amount < 0 THEN RAISE EXCEPTION 'Invalid wallet amount'; END IF;
  SELECT fare INTO v_fare FROM bookings WHERE id = _booking_id AND customer_id = _customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  SELECT cash_balance INTO v_balance FROM wallet_accounts WHERE user_id = _customer_id FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);
  IF _requested_amount > v_balance OR _requested_amount > v_fare THEN
    RAISE EXCEPTION 'Wallet balance changed. Please review your fare and try again.';
  END IF;
  v_payable := GREATEST(0, v_fare - _requested_amount);
  IF _requested_amount > 0 THEN
    UPDATE wallet_accounts SET cash_balance = cash_balance - _requested_amount, updated_at = now() WHERE user_id = _customer_id;
    INSERT INTO wallet_transactions(user_id, booking_id, delta, reason)
      VALUES (_customer_id, _booking_id, -_requested_amount, 'Wallet used for booking');
  END IF;
  UPDATE bookings SET wallet_deducted_amount = _requested_amount, final_payable_amount = v_payable,
    payment_status = CASE WHEN v_payable = 0 THEN 'paid'::public.payment_status ELSE payment_status END
    WHERE id = _booking_id;
  RETURN jsonb_build_object('wallet_deducted_amount', _requested_amount, 'final_payable_amount', v_payable, 'wallet_balance', v_balance-_requested_amount);
END $$;

REVOKE ALL ON FUNCTION public.apply_booking_wallet_deduction(uuid,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_booking_wallet_deduction(uuid,uuid,numeric) TO authenticated, service_role;

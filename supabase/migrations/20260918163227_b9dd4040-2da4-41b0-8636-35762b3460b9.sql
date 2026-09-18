-- 1. Withdrawals: make the balance check + debit atomic, and make "one open request" a hard DB rule
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_one_open_per_driver
  ON public.withdrawal_requests (driver_id)
  WHERE status = 'requested'::public.withdrawal_status;

CREATE OR REPLACE FUNCTION public.withdrawals_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE open_count int; day_count int; new_bal numeric;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.driver_id <> auth.uid() THEN RAISE EXCEPTION 'You can only withdraw your own earnings'; END IF;
  IF NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN RAISE EXCEPTION 'Only driver partners can withdraw'; END IF;

  NEW.status := 'requested'::public.withdrawal_status;
  NEW.amount := round(COALESCE(NEW.amount, 0)::numeric, 2);
  IF NEW.amount < 100 THEN RAISE EXCEPTION 'Minimum withdrawal is INR 100'; END IF;
  IF NEW.amount > 100000 THEN RAISE EXCEPTION 'Maximum withdrawal is INR 100000 per request'; END IF;

  SELECT count(*) INTO open_count FROM public.withdrawal_requests
    WHERE driver_id = NEW.driver_id AND status = 'requested'::public.withdrawal_status;
  IF open_count > 0 THEN RAISE EXCEPTION 'You already have a withdrawal being processed'; END IF;

  SELECT count(*) INTO day_count FROM public.withdrawal_requests
    WHERE driver_id = NEW.driver_id AND created_at > now() - interval '24 hours';
  IF day_count >= 3 THEN RAISE EXCEPTION 'Withdrawal limit reached. Try again after 24 hours.'; END IF;

  -- Atomic: locks the wallet row and only debits when the balance still covers the amount.
  UPDATE public.wallet_accounts
     SET cash_balance = cash_balance - NEW.amount, updated_at = now()
   WHERE user_id = NEW.driver_id
     AND cash_balance >= NEW.amount
  RETURNING cash_balance INTO new_bal;

  IF new_bal IS NULL THEN RAISE EXCEPTION 'Amount exceeds your available balance'; END IF;

  INSERT INTO public.wallet_transactions(user_id, delta, reason)
    VALUES (NEW.driver_id, -NEW.amount, 'Withdrawal requested');
  RETURN NEW;
END;
$function$;

REVOKE DELETE ON public.withdrawal_requests FROM authenticated;

-- 2. Coupon redemptions are written only by the trusted booking trigger (SECURITY DEFINER)
REVOKE INSERT, UPDATE, DELETE ON public.coupon_redemptions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.coupon_redemptions FROM anon;
GRANT ALL ON public.coupon_redemptions TO service_role;

-- 3. Bookings: no client deletes; status/driver_id remain non-writable at the grant level
REVOKE DELETE ON public.bookings FROM authenticated;
REVOKE DELETE ON public.bookings FROM anon;
REVOKE UPDATE ON public.bookings FROM authenticated;
REVOKE UPDATE ON public.bookings FROM anon;
GRANT UPDATE (notes, rating, review) ON public.bookings TO authenticated;

-- 4. Restrict the SECURITY DEFINER coupon check that trusts a caller-supplied account id
REVOKE ALL ON FUNCTION public.validate_coupon(text, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_coupon(text, numeric, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.validate_coupon(text, numeric, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text, numeric) TO authenticated;
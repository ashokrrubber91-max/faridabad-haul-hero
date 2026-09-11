-- Admin wallet adjustment: atomic delta, admin-only, audited
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(_user_id uuid, _delta numeric, _reason text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _new numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only the operations team can adjust wallets';
  END IF;
  IF _delta IS NULL OR _delta = 0 THEN
    RAISE EXCEPTION 'Enter a non-zero amount';
  END IF;
  IF abs(_delta) > 100000 THEN
    RAISE EXCEPTION 'Adjustment exceeds the allowed limit';
  END IF;
  IF coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'Add a reason for this adjustment';
  END IF;

  INSERT INTO public.wallet_accounts (user_id, cash_balance, coins_balance)
  VALUES (_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallet_accounts
     SET cash_balance = cash_balance + _delta,
         updated_at = now()
   WHERE user_id = _user_id
  RETURNING cash_balance INTO _new;

  IF _new IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  IF _new < 0 THEN
    RAISE EXCEPTION 'Adjustment would make the balance negative';
  END IF;

  INSERT INTO public.wallet_transactions (user_id, delta, reason)
  VALUES (_user_id, _delta, left(btrim(_reason), 200));

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_adjust_wallet', 'wallet_accounts', _user_id,
          jsonb_build_object('delta', _delta, 'reason', btrim(_reason), 'balance', _new));

  RETURN _new;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_adjust_wallet(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid, numeric, text) TO authenticated;

-- Admin driver assignment with eligibility checks
CREATE OR REPLACE FUNCTION public.admin_assign_driver(_booking_id uuid, _driver_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _b public.bookings;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only the operations team can assign drivers';
  END IF;
  IF NOT public.has_role(_driver_id, 'driver') OR NOT public.is_kyc_approved(_driver_id) THEN
    RAISE EXCEPTION 'That driver is not approved to take trips';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.driver_id = _driver_id
       AND b.status IN ('accepted', 'in_progress')
       AND b.id <> _booking_id
  ) THEN
    RAISE EXCEPTION 'That driver is already on a trip';
  END IF;

  SELECT * INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;
  IF _b.status <> 'pending' OR _b.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Trip is no longer waiting for a driver';
  END IF;

  UPDATE public.bookings
     SET driver_id = _driver_id, status = 'accepted', updated_at = now()
   WHERE id = _booking_id
  RETURNING * INTO _b;

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_assign_driver', 'bookings', _booking_id,
          jsonb_build_object('driver_id', _driver_id));

  RETURN _b;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_assign_driver(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_driver(uuid, uuid) TO authenticated;

-- Admin cancellation with mandatory reason
CREATE OR REPLACE FUNCTION public.admin_cancel_booking(_booking_id uuid, _reason text)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _b public.bookings;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only the operations team can cancel trips';
  END IF;
  IF length(coalesce(btrim(_reason), '')) < 4 THEN
    RAISE EXCEPTION 'Add a cancellation reason';
  END IF;

  SELECT * INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;
  IF _b.status IN ('completed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'Trip is already closed';
  END IF;

  UPDATE public.bookings
     SET status = 'cancelled',
         cancellation_reason = left(btrim(_reason), 300),
         cancelled_at = now(),
         updated_at = now()
   WHERE id = _booking_id
  RETURNING * INTO _b;

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_cancel_booking', 'bookings', _booking_id,
          jsonb_build_object('reason', btrim(_reason)));

  RETURN _b;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_cancel_booking(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_booking(uuid, text) TO authenticated;
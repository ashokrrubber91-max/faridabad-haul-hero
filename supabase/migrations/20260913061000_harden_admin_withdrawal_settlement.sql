-- Harden admin payout settlement: withdrawal states are terminal and cannot be
-- rewritten after settlement. The existing withdrawals_settle trigger remains
-- responsible for returning funds on requested -> rejected.
CREATE OR REPLACE FUNCTION public.withdrawals_settle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only the MiniPort team can update a withdrawal';
  END IF;

  IF OLD.status <> 'requested'::public.withdrawal_status THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'A settled withdrawal cannot change status';
    END IF;
  ELSE
    IF NEW.status NOT IN ('paid'::public.withdrawal_status, 'rejected'::public.withdrawal_status) THEN
      RAISE EXCEPTION 'Withdrawal must be marked paid or rejected';
    END IF;

    IF NEW.status = 'rejected'::public.withdrawal_status THEN
      UPDATE public.wallet_accounts
      SET cash_balance = cash_balance + OLD.amount,
          updated_at = now()
      WHERE user_id = OLD.driver_id;

      INSERT INTO public.wallet_transactions(user_id, delta, reason)
      VALUES (OLD.driver_id, OLD.amount, 'Withdrawal rejected - amount returned');
    END IF;
  END IF;

  NEW.driver_id := OLD.driver_id;
  NEW.amount := OLD.amount;
  NEW.method := OLD.method;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.withdrawals_settle() FROM PUBLIC, anon, authenticated;
-- Trigger execution does not require callers to have EXECUTE on the trigger function.

DROP TRIGGER IF EXISTS withdrawals_settle ON public.withdrawal_requests;
CREATE TRIGGER withdrawals_settle
BEFORE UPDATE ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.withdrawals_settle();

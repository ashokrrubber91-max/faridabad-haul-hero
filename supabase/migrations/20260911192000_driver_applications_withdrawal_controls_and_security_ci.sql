-- MiniPort production feature pack:
-- 1) Driver applications are separate from privileged driver role assignment.
-- 2) Withdrawal requests get server-side anti-abuse/funds controls.
-- 3) Sensitive bank changes receive a short cooling-off period before payout.

CREATE TABLE IF NOT EXISTS public.driver_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_applications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.driver_applications TO authenticated;
GRANT ALL ON public.driver_applications TO service_role;

DROP POLICY IF EXISTS "Applicants read own application" ON public.driver_applications;
CREATE POLICY "Applicants read own application"
ON public.driver_applications FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins manage driver applications" ON public.driver_applications;
CREATE POLICY "Admins manage driver applications"
ON public.driver_applications FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.create_driver_application_for_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'role', '') = 'driver' THEN
    INSERT INTO public.driver_applications (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_driver_application_for_signup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_driver_application_for_signup() TO service_role;

DROP TRIGGER IF EXISTS trg_create_driver_application ON auth.users;
CREATE TRIGGER trg_create_driver_application
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.create_driver_application_for_signup();

CREATE TRIGGER driver_applications_touch
BEFORE UPDATE ON public.driver_applications
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Withdrawal anti-abuse. The existing UI can continue inserting requests, but the
-- database is now the final authority on eligibility and available cash.
CREATE OR REPLACE FUNCTION public.guard_withdrawal_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  balance numeric;
  kyc text;
  recent_count integer;
  pending_count integer;
  default_bank_time timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NEW.driver_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized withdrawal request';
  END IF;

  IF NOT public.has_role(auth.uid(), 'driver'::app_role) THEN
    RAISE EXCEPTION 'Driver account required';
  END IF;

  SELECT kyc_status INTO kyc FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(kyc, '') <> 'approved' THEN
    RAISE EXCEPTION 'KYC approval required before withdrawal';
  END IF;

  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Invalid withdrawal amount';
  END IF;

  SELECT cash_balance INTO balance FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF COALESCE(balance, 0) < NEW.amount THEN
    RAISE EXCEPTION 'Insufficient available balance';
  END IF;

  SELECT count(*) INTO pending_count
  FROM public.withdrawal_requests
  WHERE driver_id = auth.uid() AND status = 'requested';
  IF pending_count > 0 THEN
    RAISE EXCEPTION 'A withdrawal is already pending';
  END IF;

  SELECT count(*) INTO recent_count
  FROM public.withdrawal_requests
  WHERE driver_id = auth.uid()
    AND created_at >= now() - interval '24 hours';
  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'Daily withdrawal limit reached';
  END IF;

  SELECT updated_at INTO default_bank_time
  FROM public.driver_bank_accounts
  WHERE driver_id = auth.uid() AND is_default = true
  ORDER BY updated_at DESC LIMIT 1;
  IF default_bank_time IS NULL THEN
    RAISE EXCEPTION 'Add a default bank account before withdrawing';
  END IF;
  IF default_bank_time > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'Bank details recently changed. Try again after the security hold expires';
  END IF;

  NEW.status := 'requested'::withdrawal_status;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_withdrawal_request ON public.withdrawal_requests;
CREATE TRIGGER guard_withdrawal_request
BEFORE INSERT ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawal_request();

REVOKE UPDATE ON public.withdrawal_requests FROM authenticated;
GRANT INSERT, SELECT ON public.withdrawal_requests TO authenticated;

-- Prevent drivers from editing bank ownership after creation. They can maintain
-- their own payout details, but ownership and account identity cannot be moved.
CREATE OR REPLACE FUNCTION public.protect_bank_account_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.driver_id <> OLD.driver_id OR NEW.account_number <> OLD.account_number THEN
      RAISE EXCEPTION 'Bank account identity cannot be changed';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_bank_account_identity ON public.driver_bank_accounts;
CREATE TRIGGER protect_bank_account_identity
BEFORE UPDATE ON public.driver_bank_accounts
FOR EACH ROW EXECUTE FUNCTION public.protect_bank_account_identity();

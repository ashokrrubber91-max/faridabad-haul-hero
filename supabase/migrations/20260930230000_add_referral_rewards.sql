-- MiniPort referral rewards: ₹100 per qualifying referral, unlimited invites.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code text;

CREATE OR REPLACE FUNCTION public.generate_unique_referral_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE candidate text;
BEGIN
  LOOP
    candidate := 'MP' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_assign_referral_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.referral_code IS NULL OR btrim(NEW.referral_code) = '' THEN
    NEW.referral_code := public.generate_unique_referral_code();
  ELSE
    NEW.referral_code := upper(btrim(NEW.referral_code));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_assign_referral_code ON public.profiles;
CREATE TRIGGER profiles_assign_referral_code BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_assign_referral_code();

UPDATE public.profiles SET referral_code = public.generate_unique_referral_code() WHERE referral_code IS NULL OR btrim(referral_code) = '';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key ON public.profiles(referral_code);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  referred_type text NOT NULL CHECK (referred_type IN ('customer','driver')),
  reward_amount numeric NOT NULL DEFAULT 100 CHECK (reward_amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','rewarded','invalid')),
  qualifying_booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rewarded_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS referrals_referrer_id_idx ON public.referrals(referrer_id);
CREATE INDEX IF NOT EXISTS referrals_status_idx ON public.referrals(status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referrals_select_own ON public.referrals;
CREATE POLICY referrals_select_own ON public.referrals FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR referred_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.attach_referral_to_new_user(_referred_user_id uuid, _referral_code text, _referred_type text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _referrer_id uuid;
BEGIN
  IF _referral_code IS NULL OR btrim(_referral_code) = '' THEN RETURN false; END IF;
  SELECT id INTO _referrer_id FROM public.profiles WHERE referral_code = upper(btrim(_referral_code)) LIMIT 1;
  IF _referrer_id IS NULL OR _referrer_id = _referred_user_id THEN RETURN false; END IF;
  INSERT INTO public.referrals(referrer_id,referred_user_id,referral_code,referred_type)
  VALUES(_referrer_id,_referred_user_id,upper(btrim(_referral_code)),CASE WHEN _referred_type='driver' THEN 'driver' ELSE 'customer' END)
  ON CONFLICT (referred_user_id) DO NOTHING;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_referral_to_new_user(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_referral_to_new_user(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.award_referral_reward(_referred_user_id uuid, _referred_type text, _booking_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.referrals%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.referrals WHERE referred_user_id=_referred_user_id AND status='pending' AND referred_type=_referred_type FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.wallet_accounts(user_id,cash_balance,coins_balance) VALUES(r.referrer_id,r.reward_amount,0)
  ON CONFLICT(user_id) DO UPDATE SET cash_balance=public.wallet_accounts.cash_balance+EXCLUDED.cash_balance, updated_at=now();
  INSERT INTO public.wallet_transactions(user_id,booking_id,delta,reason) VALUES(r.referrer_id,_booking_id,r.reward_amount,'Referral reward ₹'||trim(to_char(r.reward_amount,'FM999999990.##')));
  UPDATE public.referrals SET status='rewarded',qualifying_booking_id=_booking_id,rewarded_at=now() WHERE id=r.id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.award_referral_reward(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_reward(uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.process_referral_booking_reward()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN PERFORM public.award_referral_reward(NEW.customer_id,'customer',NEW.id); END IF;
  IF TG_OP='UPDATE' AND NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.driver_id IS NOT NULL THEN
    PERFORM public.award_referral_reward(NEW.driver_id,'driver',NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS process_referral_booking_reward ON public.bookings;
CREATE TRIGGER process_referral_booking_reward AFTER INSERT OR UPDATE OF status ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.process_referral_booking_reward();

GRANT SELECT ON public.referrals TO authenticated;

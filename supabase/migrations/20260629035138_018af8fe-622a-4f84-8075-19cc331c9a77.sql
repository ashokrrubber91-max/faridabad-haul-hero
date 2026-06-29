
-- Enums
CREATE TYPE public.payment_method AS ENUM ('cod','wallet','upi','card','netbanking');
CREATE TYPE public.payment_status AS ENUM ('pending','paid','failed','refunded');
CREATE TYPE public.coupon_kind AS ENUM ('flat','percent');

-- Coupons
CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  kind public.coupon_kind NOT NULL,
  value numeric NOT NULL CHECK (value > 0),
  min_fare numeric NOT NULL DEFAULT 0,
  max_discount numeric,
  max_uses int,
  uses int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read active coupons" ON public.coupons FOR SELECT TO authenticated USING (active = true);
CREATE POLICY "admins manage coupons" ON public.coupons FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Wallet
CREATE TABLE public.wallet_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  coins_balance numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.wallet_accounts TO authenticated;
GRANT ALL ON public.wallet_accounts TO service_role;
ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads wallet" ON public.wallet_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owner inits wallet" ON public.wallet_accounts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  delta numeric NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads txns" ON public.wallet_transactions FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Booking columns
ALTER TABLE public.bookings
  ADD COLUMN coupon_code text,
  ADD COLUMN coupon_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN coins_redeemed numeric NOT NULL DEFAULT 0,
  ADD COLUMN payment_method public.payment_method NOT NULL DEFAULT 'cod',
  ADD COLUMN payment_status public.payment_status NOT NULL DEFAULT 'pending';

-- validate_coupon RPC
CREATE OR REPLACE FUNCTION public.validate_coupon(_code text, _fare numeric)
RETURNS TABLE(code text, discount numeric, message text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.coupons%ROWTYPE; d numeric;
BEGIN
  SELECT * INTO c FROM public.coupons WHERE upper(coupons.code) = upper(_code) AND active = true;
  IF NOT FOUND THEN RETURN QUERY SELECT _code, 0::numeric, 'Invalid code'; RETURN; END IF;
  IF c.expires_at IS NOT NULL AND c.expires_at < now() THEN RETURN QUERY SELECT _code, 0::numeric, 'Expired'; RETURN; END IF;
  IF c.max_uses IS NOT NULL AND c.uses >= c.max_uses THEN RETURN QUERY SELECT _code, 0::numeric, 'Fully redeemed'; RETURN; END IF;
  IF _fare < c.min_fare THEN RETURN QUERY SELECT _code, 0::numeric, format('Min fare ₹%s', c.min_fare); RETURN; END IF;
  d := CASE WHEN c.kind = 'flat' THEN c.value ELSE round(_fare * c.value / 100.0) END;
  IF c.max_discount IS NOT NULL THEN d := LEAST(d, c.max_discount); END IF;
  d := LEAST(d, _fare);
  RETURN QUERY SELECT c.code, d, 'ok';
END $$;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text, numeric) TO authenticated;

-- Award coins on completion + debit redeemed coins
CREATE OR REPLACE FUNCTION public.bookings_award_coins() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE award numeric;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    award := round(NEW.fare * 0.02);
    INSERT INTO public.wallet_accounts(user_id, coins_balance) VALUES (NEW.customer_id, award)
      ON CONFLICT (user_id) DO UPDATE SET coins_balance = wallet_accounts.coins_balance + award, updated_at = now();
    INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
      VALUES (NEW.customer_id, NEW.id, award, 'Earned on trip');
    IF NEW.coins_redeemed > 0 THEN
      INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
        VALUES (NEW.customer_id, NEW.id, -NEW.coins_redeemed, 'Redeemed on trip');
    END IF;
    IF NEW.coupon_code IS NOT NULL THEN
      UPDATE public.coupons SET uses = uses + 1 WHERE upper(code) = upper(NEW.coupon_code);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bookings_award_coins AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_award_coins();

-- Debit coins immediately at booking time
CREATE OR REPLACE FUNCTION public.bookings_debit_coins() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bal numeric;
BEGIN
  IF NEW.coins_redeemed > 0 THEN
    SELECT coins_balance INTO bal FROM public.wallet_accounts WHERE user_id = NEW.customer_id FOR UPDATE;
    IF bal IS NULL OR bal < NEW.coins_redeemed THEN
      RAISE EXCEPTION 'Insufficient coins';
    END IF;
    UPDATE public.wallet_accounts SET coins_balance = coins_balance - NEW.coins_redeemed, updated_at = now()
      WHERE user_id = NEW.customer_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bookings_debit_coins BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_debit_coins();

-- Seed coupons
INSERT INTO public.coupons(code, kind, value, min_fare, max_discount) VALUES
  ('WELCOME50','flat',50,200,50),
  ('FIRST100','percent',10,300,100);

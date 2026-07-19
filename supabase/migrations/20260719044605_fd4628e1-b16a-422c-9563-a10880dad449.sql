
-- Phase 1: driver commission, wallet cash balance, incentives
-- Phase 2: OTP columns for pickup/drop verification

-- 1. Bookings additions
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS commission_rate numeric NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS commission_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_net_earning numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pickup_otp text,
  ADD COLUMN IF NOT EXISTS drop_otp text,
  ADD COLUMN IF NOT EXISTS pickup_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS drop_verified_at timestamptz;

-- 2. Wallet: driver cash payout balance (separate from customer coins)
ALTER TABLE public.wallet_accounts
  ADD COLUMN IF NOT EXISTS cash_balance numeric NOT NULL DEFAULT 0;

-- 3. Incentive config (daily milestone tiers)
CREATE TABLE IF NOT EXISTS public.driver_incentive_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rides_required int NOT NULL UNIQUE,
  bonus_amount numeric NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_incentive_config TO authenticated;
GRANT ALL ON public.driver_incentive_config TO service_role;
ALTER TABLE public.driver_incentive_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authed can read incentive tiers"
  ON public.driver_incentive_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manages tiers"
  ON public.driver_incentive_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.driver_incentive_config (rides_required, bonus_amount, label) VALUES
  (5, 50, 'Milestone 1: 5 rides'),
  (10, 200, 'Milestone 2: 10 rides')
ON CONFLICT (rides_required) DO NOTHING;

-- 4. Incentive earnings ledger
CREATE TABLE IF NOT EXISTS public.driver_incentive_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  earned_on date NOT NULL,
  rides_completed int NOT NULL,
  bonus_amount numeric NOT NULL,
  credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, earned_on)
);
GRANT SELECT ON public.driver_incentive_earnings TO authenticated;
GRANT ALL ON public.driver_incentive_earnings TO service_role;
ALTER TABLE public.driver_incentive_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver reads own incentives"
  ON public.driver_incentive_earnings FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- 5. Generate OTPs on booking insert
CREATE OR REPLACE FUNCTION public.bookings_generate_otps()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.pickup_otp IS NULL THEN
    NEW.pickup_otp := lpad((floor(random()*10000))::int::text, 4, '0');
  END IF;
  IF NEW.drop_otp IS NULL THEN
    NEW.drop_otp := lpad((floor(random()*10000))::int::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_generate_otps ON public.bookings;
CREATE TRIGGER trg_bookings_generate_otps
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_generate_otps();

-- Backfill OTPs for existing rows still in progress
UPDATE public.bookings
  SET pickup_otp = COALESCE(pickup_otp, lpad((floor(random()*10000))::int::text, 4, '0')),
      drop_otp   = COALESCE(drop_otp,   lpad((floor(random()*10000))::int::text, 4, '0'))
  WHERE pickup_otp IS NULL OR drop_otp IS NULL;

-- 6. Extend award-coins trigger to also compute driver commission + credit wallet
CREATE OR REPLACE FUNCTION public.bookings_award_coins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE award numeric; commission numeric; net numeric;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    -- Customer cashback
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

    -- Driver commission + net earning
    IF NEW.driver_id IS NOT NULL THEN
      commission := round(NEW.fare * COALESCE(NEW.commission_rate, 0.10));
      net := NEW.fare - commission;
      NEW.commission_amount := commission;
      NEW.driver_net_earning := net;

      INSERT INTO public.wallet_accounts(user_id, coins_balance) VALUES (NEW.driver_id, 0)
        ON CONFLICT (user_id) DO NOTHING;

      IF NEW.payment_method = 'cod' THEN
        -- Driver collected full fare in cash; deduct commission from cash wallet
        UPDATE public.wallet_accounts
          SET cash_balance = cash_balance - commission, updated_at = now()
          WHERE user_id = NEW.driver_id;
        INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
          VALUES (NEW.driver_id, NEW.id, -commission, 'Miniport commission (cash trip)');
      ELSE
        -- Online payment: credit net earning to driver
        UPDATE public.wallet_accounts
          SET cash_balance = cash_balance + net, updated_at = now()
          WHERE user_id = NEW.driver_id;
        INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
          VALUES (NEW.driver_id, NEW.id, net, 'Trip earning (online payment)');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Need BEFORE trigger to persist commission_amount/driver_net_earning on NEW
DROP TRIGGER IF EXISTS trg_bookings_award_coins ON public.bookings;
CREATE TRIGGER trg_bookings_award_coins
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_award_coins();

-- 7. Settle daily incentives (admin-callable RPC)
CREATE OR REPLACE FUNCTION public.settle_daily_incentives(_day date DEFAULT (current_date - 1))
RETURNS TABLE(driver_id uuid, rides int, bonus numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; best_bonus numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  FOR r IN
    SELECT b.driver_id AS drv, count(*)::int AS ride_count
    FROM public.bookings b
    WHERE b.status = 'completed'
      AND b.driver_id IS NOT NULL
      AND (b.updated_at AT TIME ZONE 'Asia/Kolkata')::date = _day
    GROUP BY b.driver_id
  LOOP
    SELECT COALESCE(MAX(bonus_amount), 0) INTO best_bonus
      FROM public.driver_incentive_config
      WHERE active = true AND rides_required <= r.ride_count;

    IF best_bonus > 0 THEN
      INSERT INTO public.driver_incentive_earnings(driver_id, earned_on, rides_completed, bonus_amount, credited_at)
        VALUES (r.drv, _day, r.ride_count, best_bonus, now())
        ON CONFLICT (driver_id, earned_on) DO UPDATE
          SET rides_completed = EXCLUDED.rides_completed,
              bonus_amount = EXCLUDED.bonus_amount,
              credited_at = now();

      UPDATE public.wallet_accounts SET cash_balance = cash_balance + best_bonus, updated_at = now()
        WHERE user_id = r.drv;
      INSERT INTO public.wallet_transactions(user_id, delta, reason)
        VALUES (r.drv, best_bonus, 'Daily incentive bonus (' || _day || ')');
    END IF;

    driver_id := r.drv; rides := r.ride_count; bonus := best_bonus;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.settle_daily_incentives(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_daily_incentives(date) TO authenticated, service_role;

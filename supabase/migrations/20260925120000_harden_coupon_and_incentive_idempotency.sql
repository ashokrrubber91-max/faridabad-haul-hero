-- Harden transactional idempotency without changing existing product behavior.
-- Coupon usage is finalized at booking creation; completion must not increment it again.
-- Daily incentive settlement must credit a given driver/day at most once.

CREATE OR REPLACE FUNCTION public.bookings_award_coins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  award numeric;
  commission numeric;
  net numeric;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    award := round(NEW.fare * 0.02);

    INSERT INTO public.wallet_accounts(user_id, coins_balance)
    VALUES (NEW.customer_id, award)
    ON CONFLICT (user_id) DO UPDATE
      SET coins_balance = wallet_accounts.coins_balance + award,
          updated_at = now();

    INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
    VALUES (NEW.customer_id, NEW.id, award, 'Earned on trip');

    IF NEW.coins_redeemed > 0 THEN
      INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
      VALUES (NEW.customer_id, NEW.id, -NEW.coins_redeemed, 'Redeemed on trip');
    END IF;

    -- Coupon redemption/usage is recorded once at booking creation by
    -- bookings_record_coupon_redemption(). Do not increment it again here.

    IF NEW.driver_id IS NOT NULL THEN
      commission := round(NEW.fare * COALESCE(NEW.commission_rate, 0.10));
      net := NEW.fare - commission;
      NEW.commission_amount := commission;
      NEW.driver_net_earning := net;

      INSERT INTO public.wallet_accounts(user_id, coins_balance)
      VALUES (NEW.driver_id, 0)
      ON CONFLICT (user_id) DO NOTHING;

      IF NEW.payment_method = 'cod' THEN
        UPDATE public.wallet_accounts
        SET cash_balance = cash_balance - commission, updated_at = now()
        WHERE user_id = NEW.driver_id;

        INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
        VALUES (NEW.driver_id, NEW.id, -commission, 'Miniport commission (cash trip)');
      ELSE
        UPDATE public.wallet_accounts
        SET cash_balance = cash_balance + net, updated_at = now()
        WHERE user_id = NEW.driver_id;

        INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
        VALUES (NEW.driver_id, NEW.id, net, 'Trip earning (online payment)');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.settle_daily_incentives(_day date DEFAULT (CURRENT_DATE - 1))
RETURNS TABLE(driver_id uuid, rides integer, bonus numeric)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  best_bonus numeric;
  inserted_earning boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
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
    SELECT COALESCE(MAX(bonus_amount), 0)
      INTO best_bonus
      FROM public.driver_incentive_config
      WHERE active = true
        AND rides_required <= r.ride_count;

    inserted_earning := false;

    IF best_bonus > 0 THEN
      INSERT INTO public.driver_incentive_earnings(
        driver_id, earned_on, rides_completed, bonus_amount, credited_at
      )
      VALUES (r.drv, _day, r.ride_count, best_bonus, now())
      ON CONFLICT (driver_id, earned_on) DO NOTHING;

      inserted_earning := FOUND;

      IF inserted_earning THEN
        UPDATE public.wallet_accounts
        SET cash_balance = cash_balance + best_bonus, updated_at = now()
        WHERE user_id = r.drv;

        INSERT INTO public.wallet_transactions(user_id, delta, reason)
        VALUES (r.drv, best_bonus, 'Daily incentive bonus (' || _day || ')');
      ELSE
        -- Keep the settlement row current, but never issue another credit.
        UPDATE public.driver_incentive_earnings
        SET rides_completed = r.ride_count,
            bonus_amount = best_bonus
        WHERE driver_id = r.drv
          AND earned_on = _day;
      END IF;
    END IF;

    driver_id := r.drv;
    rides := r.ride_count;
    bonus := best_bonus;
    RETURN NEXT;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION public.settle_daily_incentives(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_daily_incentives(date) TO authenticated, service_role;

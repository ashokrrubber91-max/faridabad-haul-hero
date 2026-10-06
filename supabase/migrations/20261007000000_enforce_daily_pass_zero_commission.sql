-- Daily Pass: 0% commission on completed rides while the pass is active.
-- Standard commission is 15% when no active pass exists.

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
  active_pass record;
  is_pass_active boolean := false;
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

    -- Coupon redemption/usage is recorded once at booking creation.
    -- Do not increment it again here.

    IF NEW.driver_id IS NOT NULL THEN
      SELECT id, starts_at, ends_at
        INTO active_pass
        FROM public.driver_daily_passes
       WHERE driver_id = NEW.driver_id
         AND status = 'active'
         AND starts_at <= now()
         AND ends_at > now()
       ORDER BY ends_at DESC
       LIMIT 1;

      is_pass_active := FOUND;

      commission := CASE
        WHEN is_pass_active THEN 0
        ELSE round(NEW.fare * 0.15)
      END;

      net := NEW.fare - commission;

      NEW.commission_rate := CASE WHEN is_pass_active THEN 0 ELSE 0.15 END;
      NEW.commission_amount := commission;
      NEW.driver_net_earning := net;

      INSERT INTO public.wallet_accounts(user_id, coins_balance)
      VALUES (NEW.driver_id, 0)
      ON CONFLICT (user_id) DO NOTHING;

      IF NEW.payment_method = 'cod' THEN
        IF commission > 0 THEN
          UPDATE public.wallet_accounts
          SET cash_balance = cash_balance - commission, updated_at = now()
          WHERE user_id = NEW.driver_id;

          INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
          VALUES (NEW.driver_id, NEW.id, -commission, 'Miniport commission (cash trip)');
        END IF;
      ELSE
        UPDATE public.wallet_accounts
        SET cash_balance = cash_balance + net, updated_at = now()
        WHERE user_id = NEW.driver_id;

        INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
        VALUES (
          NEW.driver_id,
          NEW.id,
          net,
          CASE
            WHEN is_pass_active THEN 'Trip earning (Daily Pass — 0% commission)'
            ELSE 'Trip earning (online payment)'
          END
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

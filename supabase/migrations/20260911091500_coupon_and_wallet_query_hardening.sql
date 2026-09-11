-- MiniPort production hardening: atomic coupon settlement and wallet/withdrawal query indexes.

-- Prevent coupon usage from ever crossing max_uses under concurrent completions.
CREATE OR REPLACE FUNCTION public.bookings_award_coins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        SET coins_balance = wallet_accounts.coins_balance + award, updated_at = now();

    INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
      VALUES (NEW.customer_id, NEW.id, award, 'Earned on trip');

    IF NEW.coins_redeemed > 0 THEN
      INSERT INTO public.wallet_transactions(user_id, booking_id, delta, reason)
        VALUES (NEW.customer_id, NEW.id, -NEW.coins_redeemed, 'Redeemed on trip');
    END IF;

    IF NEW.coupon_code IS NOT NULL THEN
      UPDATE public.coupons
        SET uses = uses + 1
        WHERE upper(code) = upper(NEW.coupon_code)
          AND active = true
          AND (max_uses IS NULL OR uses < max_uses);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon is no longer available';
      END IF;
    END IF;

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
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created
  ON public.wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_booking
  ON public.wallet_transactions (booking_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_driver_created
  ON public.withdrawal_requests (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_created
  ON public.withdrawal_requests (status, created_at DESC);

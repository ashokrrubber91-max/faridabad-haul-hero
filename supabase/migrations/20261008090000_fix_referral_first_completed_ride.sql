-- Fix referral rewards: reward the referrer only after the invited user's first completed ride.
-- Customer referrals previously rewarded on booking INSERT; that was too early.
CREATE OR REPLACE FUNCTION public.process_referral_booking_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- Customer referrer: first completed ride by the invited customer.
    PERFORM public.award_referral_reward(NEW.customer_id, 'customer', NEW.id);

    -- Driver referrer: first completed ride by the invited driver.
    IF NEW.driver_id IS NOT NULL THEN
      PERFORM public.award_referral_reward(NEW.driver_id, 'driver', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.process_referral_booking_reward() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_booking_reward() TO service_role;

DROP TRIGGER IF EXISTS process_referral_booking_reward ON public.bookings;
CREATE TRIGGER process_referral_booking_reward
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.process_referral_booking_reward();

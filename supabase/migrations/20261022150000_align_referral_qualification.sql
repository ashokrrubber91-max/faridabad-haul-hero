-- Align referral qualification with the business rule:
-- customer invitee qualifies on their first booking; driver invitee qualifies
-- only after their first completed ride. The referrals.status row is the
-- idempotency lock, so each referrer can be rewarded once per referred account.
CREATE OR REPLACE FUNCTION public.process_referral_booking_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.award_referral_reward(NEW.customer_id, 'customer', NEW.id);
  ELSIF TG_OP = 'UPDATE'
     AND NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.driver_id IS NOT NULL THEN
    PERFORM public.award_referral_reward(NEW.driver_id, 'driver', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.process_referral_booking_reward() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_booking_reward() TO service_role;

DROP TRIGGER IF EXISTS process_referral_booking_reward ON public.bookings;
CREATE TRIGGER process_referral_booking_reward
AFTER INSERT OR UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.process_referral_booking_reward();

CREATE OR REPLACE FUNCTION public.process_referral_booking_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Rewards only on the referred account's first completed ride; never on booking creation.
  -- award_referral_reward only acts on a 'pending' referral, so each referred account pays once.
  IF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.award_referral_reward(NEW.customer_id, 'customer', NEW.id);
    IF NEW.driver_id IS NOT NULL THEN
      PERFORM public.award_referral_reward(NEW.driver_id, 'driver', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_profile_kyc_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.profiles
     SET kyc_status = NEW.status,
         is_online = CASE WHEN NEW.status = 'approved'::kyc_status THEN is_online ELSE false END
   WHERE id = NEW.driver_id;
  NEW.updated_at = now();
  RETURN NEW;
END $function$;
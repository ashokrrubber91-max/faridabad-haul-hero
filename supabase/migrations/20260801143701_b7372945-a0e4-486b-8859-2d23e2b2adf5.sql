
-- 1) Protect financial fields on bookings from non-admin writes
CREATE OR REPLACE FUNCTION public.bookings_protect_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins and privileged/internal contexts (no auth.uid()) may change anything.
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  NEW.fare := OLD.fare;
  NEW.coupon_code := OLD.coupon_code;
  NEW.coupon_discount := OLD.coupon_discount;
  NEW.coins_redeemed := OLD.coins_redeemed;
  NEW.commission_rate := OLD.commission_rate;
  NEW.commission_amount := OLD.commission_amount;
  NEW.driver_net_earning := OLD.driver_net_earning;
  NEW.payment_status := OLD.payment_status;
  NEW.payment_method := OLD.payment_method;
  NEW.distance_km := OLD.distance_km;
  NEW.customer_id := OLD.customer_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_protect_financials ON public.bookings;
CREATE TRIGGER bookings_protect_financials
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_protect_financials();

-- Ensure the commission/coin award trigger runs AFTER protection (alphabetical order by name):
DROP TRIGGER IF EXISTS bookings_award_coins ON public.bookings;
CREATE TRIGGER zz_bookings_award_coins
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_award_coins();

DROP TRIGGER IF EXISTS zz_bookings_debit_coins ON public.bookings;
DROP TRIGGER IF EXISTS bookings_debit_coins ON public.bookings;
CREATE TRIGGER bookings_debit_coins
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_debit_coins();

DROP TRIGGER IF EXISTS bookings_generate_otps ON public.bookings;
CREATE TRIGGER bookings_generate_otps
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_generate_otps();

DROP TRIGGER IF EXISTS zzz_bookings_enqueue_sms ON public.bookings;
CREATE TRIGGER zzz_bookings_enqueue_sms
  AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_sms_for_booking();

DROP TRIGGER IF EXISTS bookings_touch_updated_at ON public.bookings;
CREATE TRIGGER bookings_touch_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Prevent drivers from approving their own KYC
CREATE OR REPLACE FUNCTION public.driver_kyc_protect_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  NEW.status := OLD.status;
  NEW.reviewed_by := OLD.reviewed_by;
  NEW.reviewed_at := OLD.reviewed_at;
  NEW.rejection_reason := OLD.rejection_reason;
  NEW.driver_id := OLD.driver_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS driver_kyc_protect_review ON public.driver_kyc;
CREATE TRIGGER driver_kyc_protect_review
  BEFORE UPDATE ON public.driver_kyc
  FOR EACH ROW EXECUTE FUNCTION public.driver_kyc_protect_review();

-- On insert, a non-admin driver's row must start as 'pending' with no review metadata
CREATE OR REPLACE FUNCTION public.driver_kyc_force_pending_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    NEW.status := 'pending'::kyc_status;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.rejection_reason := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS driver_kyc_force_pending_on_insert ON public.driver_kyc;
CREATE TRIGGER driver_kyc_force_pending_on_insert
  BEFORE INSERT ON public.driver_kyc
  FOR EACH ROW EXECUTE FUNCTION public.driver_kyc_force_pending_on_insert();

DROP TRIGGER IF EXISTS zz_driver_kyc_sync_profile ON public.driver_kyc;
DROP TRIGGER IF EXISTS driver_kyc_sync_profile ON public.driver_kyc;
CREATE TRIGGER zz_driver_kyc_sync_profile
  BEFORE INSERT OR UPDATE ON public.driver_kyc
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_kyc_status();

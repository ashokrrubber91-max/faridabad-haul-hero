CREATE OR REPLACE FUNCTION public.bookings_protect_financials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR public.has_role(uid, 'admin'::app_role) THEN
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

  -- Driver assignment integrity: the only non-admin, non-trusted change allowed is
  -- a verified driver claiming a trip that currently has no driver.
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     AND NOT public.is_trusted_booking_write()
     AND NOT (
       OLD.driver_id IS NULL
       AND NEW.driver_id = uid
       AND public.has_role(uid, 'driver'::app_role)
     )
  THEN
    NEW.driver_id := OLD.driver_id;
  END IF;

  -- Verification integrity: only the server-side verification/photo functions
  -- (which set the trusted marker) may touch these.
  IF NOT public.is_trusted_booking_write() THEN
    NEW.pickup_otp := OLD.pickup_otp;
    NEW.drop_otp := OLD.drop_otp;
    NEW.pickup_verified_at := OLD.pickup_verified_at;
    NEW.drop_verified_at := OLD.drop_verified_at;
    NEW.pod_photo_url := OLD.pod_photo_url;
    NEW.service_zone := OLD.service_zone;
    NEW.expires_at := OLD.expires_at;
  END IF;

  RETURN NEW;
END $function$;
-- MiniPort final security lockdown
REVOKE ALL ON FUNCTION public.expire_stale_pending_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_bookings() TO service_role;
REVOKE ALL ON FUNCTION public.verify_pickup_otp(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_pickup_otp(uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_drop_otp(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_drop_otp(uuid,text,text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Driver updates own location" ON public.driver_locations;
CREATE POLICY "Driver updates own location" ON public.driver_locations
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid() AND public.has_role(auth.uid(),'driver'::public.app_role))
  WITH CHECK (driver_id = auth.uid() AND public.has_role(auth.uid(),'driver'::public.app_role));

CREATE OR REPLACE FUNCTION public.secure_driver_location_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
BEGIN
  IF auth.uid() IS NULL OR NEW.driver_id IS DISTINCT FROM auth.uid() OR NOT public.has_role(auth.uid(),'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Driver location write is not authorized';
  END IF;
  IF NEW.latitude IS NULL OR NEW.longitude IS NULL OR NEW.latitude NOT BETWEEN -90 AND 90 OR NEW.longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Invalid GPS coordinates';
  END IF;
  IF NEW.accuracy_m IS NOT NULL AND (NEW.accuracy_m < 0 OR NEW.accuracy_m > 10000) THEN RAISE EXCEPTION 'Invalid GPS accuracy'; END IF;
  IF NEW.speed_mps IS NOT NULL AND (NEW.speed_mps < 0 OR NEW.speed_mps > 100) THEN RAISE EXCEPTION 'Invalid GPS speed'; END IF;
  IF NEW.heading_deg IS NOT NULL AND (NEW.heading_deg < 0 OR NEW.heading_deg >= 360) THEN RAISE EXCEPTION 'Invalid GPS heading'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;$function$;
DROP TRIGGER IF EXISTS secure_driver_location_write ON public.driver_locations;
CREATE TRIGGER secure_driver_location_write BEFORE INSERT OR UPDATE ON public.driver_locations FOR EACH ROW EXECUTE FUNCTION public.secure_driver_location_write();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.audit_logs FROM anon, authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

REVOKE UPDATE (customer_id, driver_id, fare, distance_km, commission_rate, commission_amount, driver_net_earning, payment_status, payment_method, coupon_code, coupon_discount, coins_redeemed, pickup_address, drop_address, pickup_lat, pickup_lng, drop_lat, drop_lng, service_zone, pickup_otp, drop_otp, pickup_verified_at, drop_verified_at) ON public.bookings FROM authenticated;

CREATE OR REPLACE FUNCTION public.protect_booking_sensitive_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR public.has_role(uid,'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id OR NEW.fare IS DISTINCT FROM OLD.fare OR NEW.distance_km IS DISTINCT FROM OLD.distance_km OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate OR NEW.commission_amount IS DISTINCT FROM OLD.commission_amount OR NEW.driver_net_earning IS DISTINCT FROM OLD.driver_net_earning OR NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.coupon_code IS DISTINCT FROM OLD.coupon_code OR NEW.coupon_discount IS DISTINCT FROM OLD.coupon_discount OR NEW.coins_redeemed IS DISTINCT FROM OLD.coins_redeemed OR NEW.pickup_address IS DISTINCT FROM OLD.pickup_address OR NEW.drop_address IS DISTINCT FROM OLD.drop_address OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng OR NEW.drop_lat IS DISTINCT FROM OLD.drop_lat OR NEW.drop_lng IS DISTINCT FROM OLD.drop_lng OR NEW.service_zone IS DISTINCT FROM OLD.service_zone OR NEW.pickup_otp IS DISTINCT FROM OLD.pickup_otp OR NEW.drop_otp IS DISTINCT FROM OLD.drop_otp OR NEW.pickup_verified_at IS DISTINCT FROM OLD.pickup_verified_at OR NEW.drop_verified_at IS DISTINCT FROM OLD.drop_verified_at THEN
    RAISE EXCEPTION 'Protected booking fields cannot be changed directly';
  END IF;
  RETURN NEW;
END;$function$;
DROP TRIGGER IF EXISTS protect_booking_sensitive_fields ON public.bookings;
CREATE TRIGGER protect_booking_sensitive_fields BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.protect_booking_sensitive_fields();

CREATE INDEX IF NOT EXISTS idx_bookings_customer_status_created ON public.bookings(customer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_driver_status_updated ON public.bookings(driver_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_updated ON public.driver_locations(driver_id, updated_at DESC);

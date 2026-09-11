-- 1) Column-level privileges: hide OTP columns from API roles
REVOKE SELECT ON public.bookings FROM authenticated;
REVOKE SELECT ON public.bookings FROM anon;
GRANT SELECT (id, customer_id, driver_id, pickup_address, drop_address, vehicle_type, distance_km, fare, status, notes, created_at, updated_at, coupon_code, coupon_discount, coins_redeemed, payment_method, payment_status, commission_rate, commission_amount, driver_net_earning, pickup_verified_at, drop_verified_at, rating, review, pod_photo_url, cancellation_reason, pickup_lat, pickup_lng, drop_lat, drop_lng, loading_started_at, loading_stopped_at, unloading_started_at, unloading_stopped_at, service_zone, cancelled_at, expires_at) ON public.bookings TO authenticated;

-- 2) accept_booking must run as definer now (it reads full rows) and must never return OTPs
CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
 RETURNS public.bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.profiles;
  v_booking public.bookings;
  v_cash_balance numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;
  SELECT * INTO v_driver FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND OR v_driver.is_online IS NOT TRUE OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be online and verified';
  END IF;
  SELECT COALESCE(w.cash_balance, 0) INTO v_cash_balance FROM public.wallet_accounts w WHERE w.user_id = auth.uid();
  IF v_cash_balance < 100 THEN
    RAISE EXCEPTION 'Minimum wallet balance of INR 100 is required to accept rides';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found or no longer available'; END IF;
  IF v_booking.driver_id IS NOT NULL OR v_booking.status <> 'pending'::public.booking_status OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;
  IF v_booking.service_zone IS DISTINCT FROM v_driver.service_zone THEN
    RAISE EXCEPTION 'Ride is outside your service zone';
  END IF;
  UPDATE public.bookings SET driver_id = auth.uid(), status = 'accepted'::public.booking_status
  WHERE id = _booking_id AND driver_id IS NULL AND status = 'pending'::public.booking_status AND cancelled_at IS NULL
  RETURNING * INTO v_booking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride already accepted or closed'; END IF;
  v_booking.pickup_otp := NULL;
  v_booking.drop_otp := NULL;
  RETURN v_booking;
END;
$function$;

-- 3) Counterpart profile visibility only while a trip is live
CREATE OR REPLACE FUNCTION private.shares_booking_with(_a uuid, _b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
      AND b.cancelled_at IS NULL
      AND ((b.customer_id = _a AND b.driver_id = _b)
        OR (b.driver_id = _a AND b.customer_id = _b))
  )
$function$;
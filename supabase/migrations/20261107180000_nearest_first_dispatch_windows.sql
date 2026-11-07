-- Nearest-first dispatch windows.
-- A pending ride opens to drivers by distance from the pickup point, widening with age:
--   0-20s: 3 km, 20-40s: 6 km, 40-60s: 10 km, 60s+: every matching driver.
-- accept_booking is the single authority; the driver app mirrors the same rule for display.
-- A driver whose last location is missing or older than 5 minutes is only eligible once the
-- ride is open to everyone (60s+). Rides without pickup coordinates are never restricted.
-- Every existing accept_booking rule is kept unchanged (online + KYC, INR 100 wallet minimum,
-- one active trip, zone match, row lock + conditional update).

CREATE OR REPLACE FUNCTION public.dispatch_radius_km(_age_seconds numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _age_seconds < 20 THEN 3::numeric
    WHEN _age_seconds < 40 THEN 6::numeric
    WHEN _age_seconds < 60 THEN 10::numeric
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.haversine_km(_lat1 double precision, _lng1 double precision, _lat2 double precision, _lng2 double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 2 * 6371.0 * asin(sqrt(
    power(sin(radians(_lat2 - _lat1) / 2), 2) +
    cos(radians(_lat1)) * cos(radians(_lat2)) * power(sin(radians(_lng2 - _lng1) / 2), 2)
  ));
$$;

CREATE OR REPLACE FUNCTION public.driver_in_dispatch_window(_driver uuid, _booking public.bookings)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_radius numeric;
  v_lat double precision;
  v_lng double precision;
  v_seen timestamptz;
BEGIN
  v_radius := public.dispatch_radius_km(extract(epoch FROM (now() - _booking.created_at)));
  IF v_radius IS NULL THEN RETURN true; END IF;
  IF _booking.pickup_lat IS NULL OR _booking.pickup_lng IS NULL THEN RETURN true; END IF;
  SELECT latitude, longitude, updated_at INTO v_lat, v_lng, v_seen
    FROM public.driver_locations WHERE driver_id = _driver;
  IF NOT FOUND OR v_seen < now() - interval '5 minutes' THEN RETURN false; END IF;
  RETURN public.haversine_km(v_lat, v_lng, _booking.pickup_lat, _booking.pickup_lng) <= v_radius;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_in_dispatch_window(uuid, public.bookings) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.profiles;
  v_booking public.bookings;
  v_cash_balance numeric := 0;
  v_active int := 0;
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
  SELECT count(*) INTO v_active FROM public.bookings
    WHERE driver_id = auth.uid()
      AND status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
      AND cancelled_at IS NULL;
  IF v_active > 0 THEN
    RAISE EXCEPTION 'Finish your current trip before accepting a new one';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found or no longer available'; END IF;
  IF v_booking.driver_id IS NOT NULL OR v_booking.status <> 'pending'::public.booking_status OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;
  IF v_booking.service_zone IS DISTINCT FROM v_driver.service_zone THEN
    RAISE EXCEPTION 'Ride is outside your service zone';
  END IF;
  IF NOT public.driver_in_dispatch_window(auth.uid(), v_booking) THEN
    RAISE EXCEPTION 'This ride is not open to you yet';
  END IF;
  UPDATE public.bookings SET driver_id = auth.uid(), status = 'accepted'::public.booking_status
  WHERE id = _booking_id AND driver_id IS NULL AND status = 'pending'::public.booking_status AND cancelled_at IS NULL
  RETURNING * INTO v_booking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride already accepted or closed'; END IF;
  RETURN v_booking;
END;
$function$;

-- Nearest eligible drivers for the push fallback (replaces an arbitrary LIMIT 500).
CREATE OR REPLACE FUNCTION public.nearest_dispatch_drivers(_booking_id uuid, _limit integer DEFAULT 15)
RETURNS TABLE (driver_id uuid, distance_km double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         public.haversine_km(l.latitude, l.longitude, b.pickup_lat, b.pickup_lng) AS distance_km
  FROM public.bookings b
  JOIN public.profiles p
    ON p.is_online AND p.kyc_status = 'approved'::public.kyc_status AND p.service_zone = b.service_zone
  JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'driver'::public.app_role
  JOIN public.driver_profiles dp ON dp.user_id = p.id AND dp.vehicle_type = b.vehicle_type
  JOIN public.driver_locations l ON l.driver_id = p.id AND l.updated_at > now() - interval '5 minutes'
  WHERE b.id = _booking_id
    AND b.status = 'pending'::public.booking_status
    AND b.driver_id IS NULL
    AND b.cancelled_at IS NULL
    AND b.pickup_lat IS NOT NULL AND b.pickup_lng IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.driver_booking_passes x
      WHERE x.booking_id = b.id AND x.driver_id = p.id
    )
  ORDER BY distance_km ASC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 15), 50));
$$;

REVOKE ALL ON FUNCTION public.nearest_dispatch_drivers(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearest_dispatch_drivers(uuid, integer) TO service_role;

-- Harmless helper, but there is no reason for signed-out callers to run it.
REVOKE EXECUTE ON FUNCTION public.generate_unique_referral_code() FROM anon;

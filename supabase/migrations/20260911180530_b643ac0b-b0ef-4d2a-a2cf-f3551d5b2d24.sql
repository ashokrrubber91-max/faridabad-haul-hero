-- 1. Trip verification codes are no longer readable by any signed-in user.
REVOKE SELECT ON public.bookings FROM authenticated;
GRANT SELECT (
  id, customer_id, driver_id, pickup_address, drop_address, vehicle_type, distance_km,
  fare, status, notes, created_at, updated_at, coupon_code, coupon_discount, coins_redeemed,
  payment_method, payment_status, commission_rate, commission_amount, driver_net_earning,
  pickup_verified_at, drop_verified_at, rating, review, pod_photo_url, cancellation_reason,
  pickup_lat, pickup_lng, drop_lat, drop_lng, loading_started_at, loading_stopped_at,
  unloading_started_at, unloading_stopped_at, service_zone, cancelled_at, expires_at
) ON public.bookings TO authenticated;

-- 2. Trip counterparts no longer expose the whole profile row (incl. phone).
DROP POLICY IF EXISTS "Profiles: read trip counterpart" ON public.profiles;

CREATE OR REPLACE FUNCTION public.booking_contacts(_booking_ids uuid[])
RETURNS TABLE(booking_id uuid, counterpart_id uuid, name text, phone text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR _booking_ids IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT b.id,
         p.id,
         p.name,
         CASE WHEN b.status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
              THEN p.phone ELSE NULL END
  FROM public.bookings b
  JOIN public.profiles p
    ON p.id = CASE WHEN b.customer_id = auth.uid() THEN b.driver_id ELSE b.customer_id END
  WHERE b.id = ANY(_booking_ids)
    AND (b.customer_id = auth.uid() OR b.driver_id = auth.uid())
    AND array_length(_booking_ids, 1) <= 200;
END $$;

REVOKE ALL ON FUNCTION public.booking_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_contacts(uuid[]) TO authenticated, service_role;
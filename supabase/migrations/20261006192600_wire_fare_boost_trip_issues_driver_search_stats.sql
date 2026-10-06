ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS fare_boost numeric NOT NULL DEFAULT 0
    CHECK (fare_boost IN (0, 5, 25, 35, 45));

CREATE TABLE IF NOT EXISTS public.trip_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  issue_type text NOT NULL CHECK (issue_type IN ('Demanded extra cash', 'Rash driving', 'Wrong Vehicle', 'No issues')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_issues_booking_idx ON public.trip_issues (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trip_issues_reporter_idx ON public.trip_issues (reporter_id, created_at DESC);

ALTER TABLE public.trip_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trip_issues FROM anon, authenticated;
GRANT INSERT, SELECT ON TABLE public.trip_issues TO authenticated;

DROP POLICY IF EXISTS "Users can insert their own trip issues" ON public.trip_issues;
CREATE POLICY "Users can insert their own trip issues"
  ON public.trip_issues FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = reporter_id
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_id
        AND (b.customer_id = (select auth.uid()) OR b.driver_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Users can read their own trip issues" ON public.trip_issues;
CREATE POLICY "Users can read their own trip issues"
  ON public.trip_issues FOR SELECT TO authenticated
  USING ((select auth.uid()) = reporter_id OR public.has_role((select auth.uid()), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.set_booking_fare_boost(_booking_id uuid, _boost numeric)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_booking public.bookings;
  v_old_boost numeric;
  v_base_fare numeric;
BEGIN
  IF (select auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _boost NOT IN (0, 5, 25, 35, 45) THEN RAISE EXCEPTION 'Invalid fare boost'; END IF;
  SELECT * INTO v_booking FROM public.bookings
  WHERE id = _booking_id AND customer_id = (select auth.uid()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_booking.status <> 'pending'::public.booking_status OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Fare boost is only available while searching for a driver';
  END IF;
  IF v_booking.payment_status <> 'pending'::public.payment_status THEN
    RAISE EXCEPTION 'Fare boost must be selected before payment is completed';
  END IF;
  v_old_boost := COALESCE(v_booking.fare_boost, 0);
  v_base_fare := GREATEST(COALESCE(v_booking.fare, 0) - v_old_boost, 0);
  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings SET fare_boost = _boost, fare = v_base_fare + _boost, updated_at = now()
  WHERE id = _booking_id RETURNING * INTO v_booking;
  PERFORM set_config('miniport.trusted_write', 'off', true);
  RETURN v_booking;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_booking_fare_boost(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_booking_fare_boost(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_booking_driver_search_stats(_booking_id uuid)
RETURNS TABLE (total_nearby bigint, declined_captains bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE
AS $function$
  WITH b AS (
    SELECT pickup_lat, pickup_lng FROM public.bookings
    WHERE id = _booking_id AND customer_id = (select auth.uid()) AND status = 'pending'::public.booking_status
  ),
  nearby AS (
    SELECT DISTINCT dl.driver_id
    FROM public.driver_locations dl
    JOIN public.profiles p ON p.id = dl.driver_id
    JOIN public.user_roles ur ON ur.user_id = dl.driver_id AND ur.role = 'driver'::public.app_role
    CROSS JOIN b
    WHERE p.is_online = true AND p.kyc_status = 'approved'::public.kyc_status
      AND dl.updated_at >= now() - interval '2 minutes'
      AND b.pickup_lat IS NOT NULL AND b.pickup_lng IS NOT NULL
      AND (6371.0 * acos(least(1.0, greatest(-1.0,
        cos(radians(b.pickup_lat)) * cos(radians(dl.latitude)) *
        cos(radians(dl.longitude) - radians(b.pickup_lng)) +
        sin(radians(b.pickup_lat)) * sin(radians(dl.latitude))
      )))) <= 5.0
  )
  SELECT (SELECT count(*) FROM nearby),
         (SELECT count(*) FROM public.driver_booking_passes pass
          WHERE pass.booking_id = _booking_id AND pass.driver_id IN (SELECT driver_id FROM nearby));
$function$;
REVOKE ALL ON FUNCTION public.get_booking_driver_search_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_driver_search_stats(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bookings_protect_fare_boost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.has_role((select auth.uid()), 'admin'::public.app_role)
     OR public.is_trusted_booking_write() THEN RETURN NEW; END IF;
  NEW.fare_boost := OLD.fare_boost;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS bookings_protect_fare_boost ON public.bookings;
CREATE TRIGGER bookings_protect_fare_boost BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_protect_fare_boost();
REVOKE ALL ON FUNCTION public.bookings_protect_fare_boost() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_protect_fare_boost() TO authenticated, service_role;
ALTER TABLE public.bookings REPLICA IDENTITY FULL;

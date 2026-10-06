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
CREATE OR REPLACE FUNCTION private.booking_snapshot(_id uuid)
 RETURNS TABLE(status public.booking_status, driver_id uuid, fare numeric, payment_status public.payment_status)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.status, b.driver_id, b.fare, b.payment_status
  FROM public.bookings b WHERE b.id = _id
$function$;
REVOKE ALL ON FUNCTION private.booking_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.booking_snapshot(uuid) TO authenticated;

DROP POLICY IF EXISTS "Bookings: customer update own" ON public.bookings;
CREATE POLICY "Bookings: customer update own" ON public.bookings
FOR UPDATE TO authenticated
USING (auth.uid() = customer_id)
WITH CHECK (
  auth.uid() = customer_id
  AND EXISTS (
    SELECT 1 FROM private.booking_snapshot(bookings.id) s
     WHERE bookings.status IS NOT DISTINCT FROM s.status
       AND bookings.driver_id IS NOT DISTINCT FROM s.driver_id
       AND bookings.fare IS NOT DISTINCT FROM s.fare
       AND bookings.payment_status IS NOT DISTINCT FROM s.payment_status
  )
);

DROP POLICY IF EXISTS "Bookings: driver update" ON public.bookings;
CREATE POLICY "Bookings: driver update" ON public.bookings
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'driver'::public.app_role)
  AND (
    driver_id = auth.uid()
    OR (
      driver_id IS NULL
      AND status = 'pending'::public.booking_status
      AND cancelled_at IS NULL
      AND public.is_kyc_approved(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid() AND p.is_online = true AND p.service_zone = bookings.service_zone
      )
    )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'driver'::public.app_role)
  AND driver_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM private.booking_snapshot(bookings.id) s
     WHERE bookings.fare IS NOT DISTINCT FROM s.fare
       AND bookings.payment_status IS NOT DISTINCT FROM s.payment_status
       AND (
         (bookings.status IS NOT DISTINCT FROM s.status AND s.driver_id = auth.uid())
         OR (bookings.status = 'accepted'::public.booking_status
             AND s.driver_id IS NULL
             AND s.status = 'pending'::public.booking_status
             AND public.is_kyc_approved(auth.uid()))
       )
  )
);
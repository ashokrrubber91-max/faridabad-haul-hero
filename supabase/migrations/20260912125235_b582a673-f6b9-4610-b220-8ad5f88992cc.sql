DROP POLICY IF EXISTS "Bookings: customer update own" ON public.bookings;
CREATE POLICY "Bookings: customer update own" ON public.bookings
FOR UPDATE TO authenticated
USING (auth.uid() = customer_id)
WITH CHECK (
  auth.uid() = customer_id
  AND status IS NOT DISTINCT FROM (SELECT b.status FROM public.bookings b WHERE b.id = bookings.id)
  AND driver_id IS NOT DISTINCT FROM (SELECT b.driver_id FROM public.bookings b WHERE b.id = bookings.id)
  AND fare IS NOT DISTINCT FROM (SELECT b.fare FROM public.bookings b WHERE b.id = bookings.id)
  AND payment_status IS NOT DISTINCT FROM (SELECT b.payment_status FROM public.bookings b WHERE b.id = bookings.id)
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
  AND fare IS NOT DISTINCT FROM (SELECT b.fare FROM public.bookings b WHERE b.id = bookings.id)
  AND payment_status IS NOT DISTINCT FROM (SELECT b.payment_status FROM public.bookings b WHERE b.id = bookings.id)
  AND (
    -- either nothing about the assignment/stage changes,
    (
      status IS NOT DISTINCT FROM (SELECT b.status FROM public.bookings b WHERE b.id = bookings.id)
      AND (SELECT b.driver_id FROM public.bookings b WHERE b.id = bookings.id) = auth.uid()
    )
    -- or this is a verified driver claiming a waiting, unassigned trip.
    OR (
      status = 'accepted'::public.booking_status
      AND (SELECT b.driver_id FROM public.bookings b WHERE b.id = bookings.id) IS NULL
      AND (SELECT b.status FROM public.bookings b WHERE b.id = bookings.id) = 'pending'::public.booking_status
      AND public.is_kyc_approved(auth.uid())
    )
  )
);
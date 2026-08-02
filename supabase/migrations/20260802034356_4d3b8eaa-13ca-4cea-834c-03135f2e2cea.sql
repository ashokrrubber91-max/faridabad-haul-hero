ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pod_photo_url text,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

CREATE OR REPLACE FUNCTION public.is_kyc_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.driver_kyc
    WHERE driver_id = _user_id AND status = 'approved'::kyc_status
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_kyc_approved(uuid) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Bookings: driver read pending or own" ON public.bookings;
CREATE POLICY "Bookings: driver read pending or own"
ON public.bookings FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'driver'::app_role)
  AND (
    (status = 'pending'::booking_status AND public.is_kyc_approved(auth.uid()))
    OR driver_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Bookings: driver update" ON public.bookings;
CREATE POLICY "Bookings: driver update"
ON public.bookings FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'driver'::app_role)
  AND public.is_kyc_approved(auth.uid())
  AND (status = 'pending'::booking_status OR driver_id = auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'driver'::app_role)
  AND public.is_kyc_approved(auth.uid())
  AND driver_id = auth.uid()
);
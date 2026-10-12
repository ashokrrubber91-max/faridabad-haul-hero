-- Repair customer booking insert 42501 without weakening ownership or anon protections.
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.bookings FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bookings TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.bookings TO service_role;

DROP POLICY IF EXISTS "Bookings: customer inserts own booking" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: customer insert own booking" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: customer insert" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: customer insert own booking" ON public.bookings;

CREATE POLICY "Bookings: authenticated user inserts own booking"
ON public.bookings FOR INSERT TO authenticated
WITH CHECK ((select auth.uid()) IS NOT NULL AND customer_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public.get_open_driver_bookings()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT to_jsonb(b) - ARRAY['pickup_otp','drop_otp','customer_phone']
  FROM public.bookings b
  WHERE auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'driver'::public.app_role)
    AND public.is_kyc_approved(auth.uid())
    AND b.status = 'pending'::public.booking_status
    AND b.driver_id IS NULL
    AND b.cancelled_at IS NULL
    AND (b.expires_at IS NULL OR b.expires_at > now())
  ORDER BY b.created_at DESC
  LIMIT 60;
$$;

REVOKE ALL ON FUNCTION public.get_open_driver_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_driver_bookings() TO authenticated;
NOTIFY pgrst, 'reload schema';

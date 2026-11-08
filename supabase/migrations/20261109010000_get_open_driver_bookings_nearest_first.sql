-- Secure driver job feed, aware of nearest-first dispatch windows.
-- Replaces the never-applied version from 20261012134500: same OTP/phone stripping, plus
-- zone match, the driver's own passes, and the distance window used by accept_booking.
CREATE OR REPLACE FUNCTION public.get_open_driver_bookings()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT to_jsonb(b) - ARRAY['pickup_otp','drop_otp','customer_phone']
  FROM public.bookings b
  JOIN public.profiles p ON p.id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'driver'::public.app_role)
    AND p.kyc_status = 'approved'::public.kyc_status
    AND b.service_zone IS NOT DISTINCT FROM p.service_zone
    AND b.status = 'pending'::public.booking_status
    AND b.driver_id IS NULL
    AND b.cancelled_at IS NULL
    AND (b.expires_at IS NULL OR b.expires_at > now())
    AND NOT EXISTS (
      SELECT 1 FROM public.driver_booking_passes x
      WHERE x.booking_id = b.id AND x.driver_id = auth.uid()
    )
    AND public.driver_in_dispatch_window(auth.uid(), b)
  ORDER BY b.created_at DESC
  LIMIT 60;
$$;

REVOKE ALL ON FUNCTION public.get_open_driver_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_driver_bookings() TO authenticated;
NOTIFY pgrst, 'reload schema';

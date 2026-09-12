REVOKE ALL ON FUNCTION public.booking_overtime(public.bookings) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.booking_overtime(public.bookings) FROM anon;
REVOKE ALL ON FUNCTION public.booking_overtime(public.bookings) FROM authenticated;
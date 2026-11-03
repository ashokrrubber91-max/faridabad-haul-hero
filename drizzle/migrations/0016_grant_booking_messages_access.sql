GRANT SELECT, INSERT ON public.booking_messages TO authenticated;
GRANT ALL ON public.booking_messages TO service_role;
REVOKE ALL ON public.booking_messages FROM anon;
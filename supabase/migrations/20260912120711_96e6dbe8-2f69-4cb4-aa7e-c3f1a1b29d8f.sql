CREATE OR REPLACE FUNCTION public.is_trusted_booking_write()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(current_setting('miniport.trusted_write', true), '') = 'on'
$$;
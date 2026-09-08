GRANT INSERT ON public.driver_booking_passes TO authenticated;
CREATE POLICY "Drivers can pass rides for themselves" ON public.driver_booking_passes
  FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid());

CREATE OR REPLACE FUNCTION public.force_faridabad_zone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.service_zone := 'Faridabad';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.force_faridabad_zone() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bookings_force_faridabad_zone ON public.bookings;
CREATE TRIGGER bookings_force_faridabad_zone
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.force_faridabad_zone();

DROP TRIGGER IF EXISTS profiles_force_faridabad_zone ON public.profiles;
CREATE TRIGGER profiles_force_faridabad_zone
  BEFORE INSERT OR UPDATE OF service_zone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.force_faridabad_zone();
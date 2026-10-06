ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'expired';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_zone text NOT NULL DEFAULT 'Faridabad',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS service_zone text NOT NULL DEFAULT 'Faridabad';

CREATE TABLE IF NOT EXISTS public.driver_booking_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, driver_id)
);
GRANT SELECT ON public.driver_booking_passes TO authenticated;
GRANT ALL ON public.driver_booking_passes TO service_role;
ALTER TABLE public.driver_booking_passes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Drivers read their own passes" ON public.driver_booking_passes;
CREATE POLICY "Drivers read their own passes"
  ON public.driver_booking_passes FOR SELECT TO authenticated
  USING (driver_id = (select auth.uid()));
CREATE INDEX IF NOT EXISTS driver_booking_passes_driver_idx ON public.driver_booking_passes(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS driver_booking_passes_booking_idx ON public.driver_booking_passes(booking_id);

CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver public.profiles;
  v_booking public.bookings;
BEGIN
  IF (select auth.uid()) IS NULL OR NOT public.has_role((select auth.uid()), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;
  SELECT * INTO v_driver FROM public.profiles WHERE id = (select auth.uid()) FOR SHARE;
  IF NOT FOUND OR v_driver.is_online IS NOT TRUE OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be online and verified';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_booking.driver_id IS NOT NULL OR v_booking.status <> 'pending'::public.booking_status OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;
  IF v_booking.service_zone IS DISTINCT FROM v_driver.service_zone THEN
    RAISE EXCEPTION 'Ride is outside your service zone';
  END IF;
  UPDATE public.bookings
  SET driver_id = (select auth.uid()), status = 'accepted'::public.booking_status
  WHERE id = _booking_id AND driver_id IS NULL AND status = 'pending'::public.booking_status AND cancelled_at IS NULL
  RETURNING * INTO v_booking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride already accepted or closed'; END IF;
  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_booking(_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver public.profiles;
  v_available boolean;
BEGIN
  IF (select auth.uid()) IS NULL OR NOT public.has_role((select auth.uid()), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can pass rides';
  END IF;
  SELECT * INTO v_driver FROM public.profiles WHERE id = (select auth.uid()) FOR SHARE;
  IF NOT FOUND OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be verified';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = _booking_id AND b.driver_id IS NULL AND b.status = 'pending'::public.booking_status
      AND b.cancelled_at IS NULL AND b.service_zone = v_driver.service_zone
  ) INTO v_available;
  IF v_available THEN
    INSERT INTO public.driver_booking_passes (booking_id, driver_id)
    VALUES (_booking_id, (select auth.uid()))
    ON CONFLICT (booking_id, driver_id) DO NOTHING;
  END IF;
  RETURN v_available;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_booking(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_booking(uuid) TO authenticated, service_role;
ALTER TABLE public.bookings REPLICA IDENTITY FULL;

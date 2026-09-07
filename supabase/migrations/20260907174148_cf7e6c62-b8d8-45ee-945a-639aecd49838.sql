ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'expired';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_zone text NOT NULL DEFAULT 'Faridabad',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS service_zone text NOT NULL DEFAULT 'Faridabad';

CREATE TABLE public.driver_booking_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, driver_id)
);
GRANT SELECT ON public.driver_booking_passes TO authenticated;
GRANT ALL ON public.driver_booking_passes TO service_role;
ALTER TABLE public.driver_booking_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Drivers read their own passes" ON public.driver_booking_passes
  FOR SELECT TO authenticated USING (driver_id = auth.uid());
CREATE INDEX driver_booking_passes_driver_idx ON public.driver_booking_passes(driver_id, created_at DESC);
CREATE INDEX driver_booking_passes_booking_idx ON public.driver_booking_passes(booking_id);

CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_driver public.profiles;
  v_booking public.bookings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;

  SELECT * INTO v_driver
  FROM public.profiles
  WHERE id = auth.uid()
  FOR SHARE;

  IF NOT FOUND OR v_driver.is_online IS NOT TRUE OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be online and verified';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF v_booking.driver_id IS NOT NULL OR v_booking.status <> 'pending'::public.booking_status
     OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;

  IF v_booking.service_zone IS DISTINCT FROM v_driver.service_zone THEN
    RAISE EXCEPTION 'Ride is outside your service zone';
  END IF;

  UPDATE public.bookings
  SET driver_id = auth.uid(), status = 'accepted'::public.booking_status
  WHERE id = _booking_id AND driver_id IS NULL AND status = 'pending'::public.booking_status
    AND cancelled_at IS NULL
  RETURNING * INTO v_booking;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;

  RETURN v_booking;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_booking(_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_driver public.profiles;
  v_available boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can pass rides';
  END IF;

  SELECT * INTO v_driver FROM public.profiles WHERE id = auth.uid() FOR SHARE;
  IF NOT FOUND OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be verified';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = _booking_id
      AND b.driver_id IS NULL
      AND b.status = 'pending'::public.booking_status
      AND b.cancelled_at IS NULL
      AND b.service_zone = v_driver.service_zone
  ) INTO v_available;

  IF v_available THEN
    INSERT INTO public.driver_booking_passes (booking_id, driver_id)
    VALUES (_booking_id, auth.uid())
    ON CONFLICT (booking_id, driver_id) DO NOTHING;
  END IF;

  RETURN v_available;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_booking(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_booking(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shares_booking_with(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_kyc_approved(uuid) TO authenticated;

DROP POLICY IF EXISTS "Bookings: driver read pending or own" ON public.bookings;
CREATE POLICY "Bookings: driver read pending or own"
ON public.bookings FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'driver'::public.app_role)
  AND (
    driver_id = auth.uid()
    OR (
      status = 'pending'::public.booking_status
      AND driver_id IS NULL
      AND cancelled_at IS NULL
      AND public.is_kyc_approved(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.is_online = true
          AND p.service_zone = public.bookings.service_zone
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.driver_booking_passes pass
        WHERE pass.booking_id = public.bookings.id AND pass.driver_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS "Bookings: driver update" ON public.bookings;
CREATE POLICY "Bookings: driver update"
ON public.bookings FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'driver'::public.app_role)
  AND driver_id = auth.uid()
  AND status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
)
WITH CHECK (
  public.has_role(auth.uid(), 'driver'::public.app_role)
  AND driver_id = auth.uid()
);

ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER TABLE public.driver_booking_passes REPLICA IDENTITY FULL;
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.has_role(_user_id, _role)
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION private.shares_booking_with(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE (b.customer_id = _a AND b.driver_id = _b)
       OR (b.driver_id = _a AND b.customer_id = _b)
  )
$$;

REVOKE ALL ON FUNCTION private.shares_booking_with(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.shares_booking_with(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.shares_booking_with(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.shares_booking_with(_a, _b)
$$;

REVOKE ALL ON FUNCTION public.shares_booking_with(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_booking_with(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, private
AS $$
DECLARE
  v_driver public.profiles;
  v_booking public.bookings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;

  SELECT * INTO v_driver FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND OR v_driver.is_online IS NOT TRUE OR v_driver.kyc_status <> 'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be online and verified';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found or no longer available';
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
  WHERE id = _booking_id
    AND driver_id IS NULL
    AND status = 'pending'::public.booking_status
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
SECURITY INVOKER
SET search_path = public, private
AS $$
DECLARE
  v_driver public.profiles;
  v_available boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can pass rides';
  END IF;

  SELECT * INTO v_driver FROM public.profiles WHERE id = auth.uid();
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
GRANT EXECUTE ON FUNCTION public.accept_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_booking(uuid) TO authenticated;

DROP POLICY IF EXISTS "Bookings: driver update" ON public.bookings;
CREATE POLICY "Bookings: driver update"
ON public.bookings FOR UPDATE TO authenticated
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
        WHERE p.id = auth.uid()
          AND p.is_online = true
          AND p.service_zone = public.bookings.service_zone
      )
    )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'driver'::public.app_role)
  AND driver_id = auth.uid()
);
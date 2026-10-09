-- Harden admin driver assignment and expose driver pass monitor to admins.

DROP POLICY IF EXISTS "Admins read all driver passes" ON public.driver_booking_passes;
CREATE POLICY "Admins read all driver passes"
  ON public.driver_booking_passes
  FOR SELECT TO authenticated
  USING ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));

CREATE OR REPLACE FUNCTION public.admin_assign_driver(_booking_id uuid, _driver_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _b public.bookings;
  _driver public.profiles;
BEGIN
  IF NOT public.has_role((select auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only the operations team can assign drivers';
  END IF;

  SELECT * INTO _driver
  FROM public.profiles
  WHERE id = _driver_id
  FOR SHARE;

  IF NOT FOUND
     OR NOT public.has_role(_driver_id, 'driver'::public.app_role)
     OR _driver.kyc_status <> 'approved'::public.kyc_status
     OR _driver.is_online IS NOT TRUE THEN
    RAISE EXCEPTION 'Driver must be online and approved to take trips';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.driver_id = _driver_id
      AND b.status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
      AND b.id <> _booking_id
  ) THEN
    RAISE EXCEPTION 'That driver is already on a trip';
  END IF;

  SELECT * INTO _b
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;

  IF _b.status <> 'pending'::public.booking_status OR _b.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Trip is no longer searching for a driver';
  END IF;

  IF _b.service_zone IS DISTINCT FROM _driver.service_zone THEN
    RAISE EXCEPTION 'Driver is outside the trip service zone';
  END IF;

  UPDATE public.bookings
  SET driver_id = _driver_id,
      status = 'accepted'::public.booking_status,
      updated_at = now()
  WHERE id = _booking_id
  RETURNING * INTO _b;

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (
    (select auth.uid()),
    'admin_assign_driver',
    'bookings',
    _booking_id,
    jsonb_build_object('driver_id', _driver_id)
  );

  RETURN _b;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_driver(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_driver(uuid, uuid) TO authenticated;
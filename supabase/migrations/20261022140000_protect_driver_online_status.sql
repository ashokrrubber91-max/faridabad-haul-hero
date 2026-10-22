-- Protected driver online toggle: the server, not the browser, enforces current KYC status.
CREATE OR REPLACE FUNCTION public.set_driver_online(_is_online boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kyc_status text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only registered drivers can change online status';
  END IF;

  IF _is_online THEN
    SELECT dk.status::text INTO v_kyc_status
    FROM public.driver_kyc dk
    WHERE dk.driver_id = v_uid
    ORDER BY dk.updated_at DESC NULLS LAST
    LIMIT 1;

    IF v_kyc_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'Driver verification must be approved before going online';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = v_uid AND p.kyc_status = 'approved'::public.kyc_status
    ) THEN
      RAISE EXCEPTION 'Driver profile verification is not approved';
    END IF;
  END IF;

  UPDATE public.profiles
  SET is_online = _is_online, updated_at = now()
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver profile not found';
  END IF;

  RETURN _is_online;
END;
$$;

REVOKE ALL ON FUNCTION public.set_driver_online(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_driver_online(boolean) TO authenticated, service_role;

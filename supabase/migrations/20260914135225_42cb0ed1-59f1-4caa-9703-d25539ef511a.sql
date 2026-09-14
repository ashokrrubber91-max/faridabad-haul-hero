-- 1) Customer keeps the same booking after a failed online payment and pays cash instead.
CREATE OR REPLACE FUNCTION public.switch_failed_payment_to_cod(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.bookings;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to update this booking';
  END IF;

  SELECT * INTO _row FROM public.bookings WHERE id = _booking_id;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  IF _row.customer_id <> _uid AND NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'You can only change your own booking';
  END IF;
  IF _row.status <> 'pending'::booking_status THEN
    RAISE EXCEPTION 'This booking can no longer be switched to cash';
  END IF;
  IF _row.payment_status <> 'failed'::payment_status THEN
    RAISE EXCEPTION 'This booking has no failed online payment';
  END IF;

  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings
     SET payment_method = 'cod'::payment_method,
         payment_status = 'pending'::payment_status
   WHERE id = _booking_id
  RETURNING * INTO _row;
  PERFORM set_config('miniport.trusted_write', 'off', true);

  RETURN _row;
END;
$function$;

REVOKE ALL ON FUNCTION public.switch_failed_payment_to_cod(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.switch_failed_payment_to_cod(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.switch_failed_payment_to_cod(uuid) TO authenticated;

-- 2) Driver updates own vehicle number / vehicle documents from the account screen.
CREATE OR REPLACE FUNCTION public.driver_update_account_profile(
  _vehicle_number text DEFAULT NULL,
  _vehicle_photo_url text DEFAULT NULL,
  _insurance_url text DEFAULT NULL,
  _puc_url text DEFAULT NULL,
  _number_plate_url text DEFAULT NULL
)
RETURNS public.driver_kyc
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.driver_kyc;
  _docs_changed boolean := (_vehicle_photo_url IS NOT NULL OR _insurance_url IS NOT NULL OR _puc_url IS NOT NULL OR _number_plate_url IS NOT NULL);
  _num text := nullif(btrim(coalesce(_vehicle_number, '')), '');
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to update your driver profile';
  END IF;
  IF NOT public.has_role(_uid, 'driver'::app_role) THEN
    RAISE EXCEPTION 'Only drivers can update a driver profile';
  END IF;
  IF _num IS NOT NULL AND (length(_num) < 4 OR length(_num) > 20) THEN
    RAISE EXCEPTION 'Enter a valid vehicle registration number';
  END IF;

  SELECT * INTO _row FROM public.driver_kyc WHERE driver_id = _uid;
  IF _row.driver_id IS NULL THEN
    RAISE EXCEPTION 'Submit your driver documents first';
  END IF;

  UPDATE public.driver_kyc AS k
     SET vehicle_number = coalesce(_num, k.vehicle_number),
         vehicle_photo_url = coalesce(_vehicle_photo_url, k.vehicle_photo_url),
         insurance_url = coalesce(_insurance_url, k.insurance_url),
         puc_url = coalesce(_puc_url, k.puc_url),
         number_plate_url = coalesce(_number_plate_url, k.number_plate_url),
         status = CASE WHEN _docs_changed THEN 'pending'::kyc_status ELSE k.status END,
         rejection_reason = CASE WHEN _docs_changed THEN NULL ELSE k.rejection_reason END,
         submitted_at = CASE WHEN _docs_changed THEN now() ELSE k.submitted_at END,
         reviewed_at = CASE WHEN _docs_changed THEN NULL ELSE k.reviewed_at END,
         reviewed_by = CASE WHEN _docs_changed THEN NULL ELSE k.reviewed_by END,
         updated_at = now()
   WHERE k.driver_id = _uid
  RETURNING k.* INTO _row;

  RETURN _row;
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_update_account_profile(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_update_account_profile(text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_update_account_profile(text, text, text, text, text) TO authenticated;
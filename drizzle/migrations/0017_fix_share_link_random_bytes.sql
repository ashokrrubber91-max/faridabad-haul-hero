CREATE OR REPLACE FUNCTION public.create_booking_share_link(_booking_id uuid)
 RETURNS booking_share_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.booking_share_links;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.id = _booking_id AND (b.customer_id = _uid OR b.driver_id = _uid)
  ) THEN
    RAISE EXCEPTION 'You can only share your own trip';
  END IF;

  SELECT * INTO _row
    FROM public.booking_share_links
   WHERE booking_id = _booking_id
     AND created_by = _uid
     AND revoked_at IS NULL
     AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1;

  IF _row.id IS NOT NULL THEN RETURN _row; END IF;

  -- pgcrypto lives in the "extensions" schema; qualify it so the locked search_path still resolves it.
  INSERT INTO public.booking_share_links (booking_id, token, created_by)
  VALUES (_booking_id, encode(extensions.gen_random_bytes(24), 'hex'), _uid)
  RETURNING * INTO _row;

  RETURN _row;
END;
$function$;
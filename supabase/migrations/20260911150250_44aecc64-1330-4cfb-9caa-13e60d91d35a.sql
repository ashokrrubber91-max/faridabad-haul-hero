-- Photo proof is evidence only; it can never complete a trip on its own.
DROP FUNCTION IF EXISTS public.complete_booking_with_pod(uuid, text);

CREATE OR REPLACE FUNCTION public.attach_delivery_photo(_booking_id uuid, _pod_path text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE b public.bookings; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF _pod_path IS NULL OR btrim(_pod_path) = '' OR length(_pod_path) > 400 THEN
    RAISE EXCEPTION 'Invalid photo reference';
  END IF;
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.driver_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the assigned driver can add a delivery photo'; END IF;
  IF b.status NOT IN ('in_progress'::public.booking_status, 'completed'::public.booking_status) THEN
    RAISE EXCEPTION 'Delivery photos can only be added on an ongoing or completed trip';
  END IF;
  UPDATE public.bookings SET pod_photo_url = _pod_path WHERE id = _booking_id;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.attach_delivery_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_delivery_photo(uuid, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.cancel_booking(_booking_id uuid, _reason text, _note text DEFAULT NULL::text)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b public.bookings;
  uid uuid := auth.uid();
  clean_reason text;
  next_notes text;
  actor public.cancel_actor;
  category public.cancellation_category;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  clean_reason := left(btrim(COALESCE(_reason, '')), 300);
  IF length(clean_reason) < 3 THEN RAISE EXCEPTION 'Add a cancellation reason'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN RAISE EXCEPTION 'Trip is already closed'; END IF;
  IF b.customer_id = uid THEN
    IF b.status NOT IN ('pending'::public.booking_status, 'accepted'::public.booking_status, 'in_progress'::public.booking_status) THEN RAISE EXCEPTION 'This trip can no longer be cancelled'; END IF;
    actor := 'customer'; category := 'customer_cancelled';
  ELSIF b.driver_id = uid THEN
    IF b.status <> 'accepted'::public.booking_status THEN RAISE EXCEPTION 'You can only drop a trip before pickup verification'; END IF;
    actor := 'driver'; category := 'driver_cancelled';
  ELSE
    RAISE EXCEPTION 'Only the customer or assigned driver can cancel this trip';
  END IF;
  next_notes := CASE
    WHEN _note IS NULL OR btrim(_note) = '' THEN b.notes
    WHEN b.notes IS NULL OR btrim(b.notes) = '' THEN left(btrim(_note), 500)
    ELSE left(b.notes || ' · ' || btrim(_note), 1000)
  END;
  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings
     SET status = 'cancelled'::public.booking_status,
         cancelled_at = now(),
         cancellation_reason = clean_reason,
         cancelled_by = actor,
         cancellation_category = category,
         notes = next_notes,
         payment_status = CASE WHEN b.payment_status = 'pending'::public.payment_status THEN 'failed'::public.payment_status ELSE b.payment_status END
   WHERE id = _booking_id
  RETURNING * INTO b;
  PERFORM set_config('miniport.trusted_write', 'off', true);
  RETURN b;
END
$function$;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO authenticated;

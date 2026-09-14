CREATE OR REPLACE FUNCTION public.switch_failed_payment_to_cod(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE b public.bookings;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.customer_id <> auth.uid() THEN RAISE EXCEPTION 'Only the customer can change this payment method'; END IF;
  IF b.status <> 'pending'::public.booking_status THEN RAISE EXCEPTION 'Only a pending booking can be switched to cash'; END IF;
  IF b.payment_status <> 'failed'::public.payment_status THEN RAISE EXCEPTION 'This booking does not have a failed payment'; END IF;

  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings
     SET payment_method = 'cod'::public.payment_method,
         payment_status = 'pending'::public.payment_status,
         cancellation_reason = NULL,
         cancelled_at = NULL
   WHERE id = _booking_id
  RETURNING * INTO b;
  PERFORM set_config('miniport.trusted_write', 'off', true);
  RETURN b;
END $function$;

REVOKE ALL ON FUNCTION public.switch_failed_payment_to_cod(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_failed_payment_to_cod(uuid) TO authenticated;

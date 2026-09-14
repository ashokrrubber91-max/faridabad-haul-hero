CREATE OR REPLACE FUNCTION public.switch_failed_payment_to_cod(_booking_id uuid)
 RETURNS bookings
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

  SELECT * INTO _row FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  IF _row.customer_id <> _uid AND NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'You can only change your own booking';
  END IF;

  -- Idempotent: a repeated/duplicate request on an already-switched booking is a no-op.
  IF _row.payment_method = 'cod'::payment_method
     AND _row.payment_status = 'pending'::payment_status THEN
    RETURN _row;
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
         payment_status = 'pending'::payment_status,
         updated_at = now()
   WHERE id = _booking_id
  RETURNING * INTO _row;
  PERFORM set_config('miniport.trusted_write', 'off', true);

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (_uid, 'switch_failed_payment_to_cod', 'bookings', _booking_id,
          jsonb_build_object('payment_method', 'cod', 'payment_status', 'pending'));

  RETURN _row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_stale_bookings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE public.bookings
     SET status = 'expired'::booking_status,
         cancelled_at = now(),
         cancellation_reason = coalesce(nullif(btrim(cancellation_reason), ''),
           'No driver accepted this request before it timed out.'),
         cancelled_by = 'system'::public.cancel_actor,
         cancellation_category = 'expired'::public.cancellation_category,
         updated_at = now()
   WHERE status = 'pending'
     AND driver_id IS NULL
     AND cancelled_at IS NULL
     AND expires_at IS NOT NULL
     AND expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;
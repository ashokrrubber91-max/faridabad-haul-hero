CREATE OR REPLACE FUNCTION public.verify_booking_otp(_booking_id uuid, _stage text, _otp text)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b public.bookings;
  att public.booking_otp_attempts;
  expected text;
  uid uuid := auth.uid();
  clean text := regexp_replace(COALESCE(_otp, ''), '[^0-9]', '', 'g');
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF _stage NOT IN ('pickup', 'drop') THEN RAISE EXCEPTION 'Invalid verification step'; END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.driver_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the assigned driver can verify this trip'; END IF;
  IF b.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'This trip was cancelled'; END IF;

  SELECT * INTO att FROM public.booking_otp_attempts
    WHERE booking_id = _booking_id AND stage = _stage FOR UPDATE;
  IF att.locked_until IS NOT NULL AND att.locked_until > now() THEN
    RAISE EXCEPTION 'Too many wrong codes. Try again in a few minutes.';
  END IF;

  IF _stage = 'pickup' THEN
    IF b.status <> 'accepted'::public.booking_status THEN RAISE EXCEPTION 'Trip is not awaiting pickup'; END IF;
    expected := b.pickup_otp;
  ELSE
    IF b.status <> 'in_progress'::public.booking_status THEN RAISE EXCEPTION 'Start the trip before confirming delivery'; END IF;
    -- Proof of delivery is mandatory: the photo must exist before the code is checked.
    IF b.pod_photo_url IS NULL OR btrim(b.pod_photo_url) = '' THEN
      RAISE EXCEPTION 'Upload the delivery photo before confirming delivery';
    END IF;
    expected := b.drop_otp;
  END IF;

  IF expected IS NULL OR clean <> expected THEN
    INSERT INTO public.booking_otp_attempts(booking_id, stage, attempts, updated_at)
      VALUES (_booking_id, _stage, 1, now())
      ON CONFLICT (booking_id, stage) DO UPDATE
        SET attempts = public.booking_otp_attempts.attempts + 1,
            updated_at = now(),
            locked_until = CASE WHEN public.booking_otp_attempts.attempts + 1 >= 5
                                THEN now() + interval '10 minutes' ELSE NULL END;
    RAISE EXCEPTION 'Incorrect code. Please re-check with the customer.';
  END IF;

  DELETE FROM public.booking_otp_attempts WHERE booking_id = _booking_id AND stage = _stage;

  IF _stage = 'pickup' THEN
    UPDATE public.bookings
      SET pickup_verified_at = now(),
          status = 'in_progress'::public.booking_status,
          loading_stopped_at = COALESCE(loading_stopped_at, now())
      WHERE id = _booking_id RETURNING * INTO b;
  ELSE
    UPDATE public.bookings
      SET drop_verified_at = now(),
          status = 'completed'::public.booking_status,
          unloading_stopped_at = COALESCE(unloading_stopped_at, now())
      WHERE id = _booking_id RETURNING * INTO b;
  END IF;

  b.pickup_otp := NULL;
  b.drop_otp := NULL;
  RETURN b;
END;
$function$;
-- Payment checkout failures are not customer/driver cancellations.
-- The browser currently calls cancel_booking when Razorpay is abandoned or fails;
-- preserve the booking as pending so the customer can retry/switch payment instead
-- of showing a false "Cancelled" ride in history.

CREATE OR REPLACE FUNCTION public.cancel_booking(_booking_id uuid, _reason text, _note text DEFAULT NULL)
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
  is_payment_failure boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  clean_reason := left(btrim(COALESCE(_reason, '')), 300);
  IF length(clean_reason) < 3 THEN RAISE EXCEPTION 'Add a cancellation reason'; END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    RAISE EXCEPTION 'Trip is already closed';
  END IF;

  -- This path is only for the payment-failure cleanup used by checkout.
  -- It must never be treated as a real ride cancellation.
  is_payment_failure :=
    lower(clean_reason) IN ('payment not completed', 'payment failed')
    OR lower(clean_reason) LIKE 'payment failed:%'
    OR lower(clean_reason) LIKE 'payment cancelled:%';

  IF is_payment_failure THEN
    IF b.customer_id <> uid THEN
      RAISE EXCEPTION 'Only the customer can mark checkout payment as failed';
    END IF;
    IF b.status <> 'pending'::public.booking_status THEN
      RAISE EXCEPTION 'Payment can only fail before a driver is assigned';
    END IF;

    next_notes := CASE
      WHEN _note IS NULL OR btrim(_note) = '' THEN b.notes
      WHEN b.notes IS NULL OR btrim(b.notes) = '' THEN left(btrim(_note), 500)
      ELSE left(b.notes || ' · ' || btrim(_note), 1000)
    END;

    PERFORM set_config('miniport.trusted_write', 'on', true);
    UPDATE public.bookings
       SET payment_status = 'failed'::public.payment_status,
           cancellation_reason = NULL,
           cancelled_at = NULL,
           notes = next_notes
     WHERE id = _booking_id
    RETURNING * INTO b;
    PERFORM set_config('miniport.trusted_write', 'off', true);
    RETURN b;
  END IF;

  IF b.customer_id = uid THEN
    IF b.status NOT IN ('pending'::public.booking_status, 'accepted'::public.booking_status, 'in_progress'::public.booking_status) THEN
      RAISE EXCEPTION 'This trip can no longer be cancelled';
    END IF;
  ELSIF b.driver_id = uid THEN
    IF b.status <> 'accepted'::public.booking_status THEN
      RAISE EXCEPTION 'You can only drop a trip before pickup verification';
    END IF;
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
         notes = next_notes
   WHERE id = _booking_id
  RETURNING * INTO b;
  PERFORM set_config('miniport.trusted_write', 'off', true);

  RETURN b;
END $function$;

REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO authenticated;

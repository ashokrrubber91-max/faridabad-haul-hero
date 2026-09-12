REVOKE ALL ON FUNCTION public.bookings_generate_otps() FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.cancel_booking(_booking_id uuid, _reason text, _note text DEFAULT NULL)
 RETURNS public.bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b public.bookings; uid uuid := auth.uid(); clean_reason text; next_notes text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  clean_reason := left(btrim(COALESCE(_reason, '')), 300);
  IF length(clean_reason) < 3 THEN RAISE EXCEPTION 'Add a cancellation reason'; END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.status IN ('completed'::public.booking_status, 'cancelled'::public.booking_status, 'expired'::public.booking_status) THEN
    RAISE EXCEPTION 'Trip is already closed';
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

CREATE OR REPLACE FUNCTION public.admin_mark_refunded(_booking_id uuid)
 RETURNS public.bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b public.bookings;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only the operations team can mark a refund';
  END IF;
  UPDATE public.bookings
     SET payment_status = 'refunded'::public.payment_status
   WHERE id = _booking_id
  RETURNING * INTO b;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Trip not found'; END IF;

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_mark_refunded', 'bookings', _booking_id,
          jsonb_build_object('payment_status', 'refunded'));
  RETURN b;
END $function$;

GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_refunded(uuid) TO authenticated;

-- Column-level write scope: app users may only edit descriptive/timing fields directly.
REVOKE UPDATE ON public.bookings FROM authenticated;
GRANT UPDATE (notes, rating, review, loading_started_at, loading_stopped_at,
              unloading_started_at, unloading_stopped_at) ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;

DROP POLICY IF EXISTS "driver requests withdrawal" ON public.withdrawal_requests;
CREATE POLICY "driver requests withdrawal" ON public.withdrawal_requests
FOR INSERT TO authenticated
WITH CHECK (
  driver_id = auth.uid()
  AND status = 'requested'::public.withdrawal_status
  AND public.has_role(auth.uid(), 'driver'::public.app_role)
  AND amount >= 100
  AND amount <= 100000
  AND amount <= COALESCE((SELECT w.cash_balance FROM public.wallet_accounts w WHERE w.user_id = auth.uid()), 0)
);
CREATE OR REPLACE FUNCTION public.enqueue_sms_for_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ev public.sms_event;
  cust_phone text; cust_name text;
  drv_phone text; drv_name text;
  ev_label text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'accepted' THEN ev := 'accepted'; ev_label := 'accepted';
    ELSIF NEW.status = 'in_progress' THEN ev := 'started'; ev_label := 'started (driver en route)';
    ELSIF NEW.status = 'completed' THEN ev := 'completed'; ev_label := 'completed';
    ELSIF NEW.status = 'cancelled' THEN ev := 'cancelled'; ev_label := 'cancelled';
    END IF;
  ELSIF NEW.payment_status = 'paid'::public.payment_status
        AND OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    ev := 'payment_received'; ev_label := 'paid';
  END IF;

  IF ev IS NULL THEN RETURN NEW; END IF;

  SELECT phone, name INTO cust_phone, cust_name FROM public.profiles WHERE id = NEW.customer_id;
  IF NEW.driver_id IS NOT NULL THEN
    SELECT phone, name INTO drv_phone, drv_name FROM public.profiles WHERE id = NEW.driver_id;
  END IF;

  IF cust_phone IS NOT NULL AND cust_phone <> '' THEN
    INSERT INTO public.sms_logs(booking_id, recipient, recipient_user_id, phone, event, body)
    VALUES (NEW.id, 'customer', NEW.customer_id, cust_phone, ev,
      'MiniPort: Your booking from ' || NEW.pickup_address || ' has been ' || ev_label || '.')
    ON CONFLICT (booking_id, recipient, event) DO NOTHING;
  END IF;

  IF drv_phone IS NOT NULL AND drv_phone <> '' AND ev <> 'payment_received' THEN
    INSERT INTO public.sms_logs(booking_id, recipient, recipient_user_id, phone, event, body)
    VALUES (NEW.id, 'driver', NEW.driver_id, drv_phone, ev,
      'MiniPort: Job ' || ev_label || ' - pickup ' || NEW.pickup_address || ' to ' || NEW.drop_address || '.')
    ON CONFLICT (booking_id, recipient, event) DO NOTHING;
  END IF;

  RETURN NEW;
END $function$;

-- Worker: atomically claim due jobs. SKIP LOCKED prevents two workers taking the same row.
CREATE OR REPLACE FUNCTION public.claim_sms_jobs(_limit integer DEFAULT 20)
 RETURNS SETOF public.sms_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.sms_logs
     WHERE status IN ('queued'::public.sms_status, 'sending'::public.sms_status)
       AND attempts < max_attempts
       AND next_attempt_at <= now()
       AND (status <> 'sending'::public.sms_status OR last_attempt_at < now() - interval '5 minutes')
     ORDER BY next_attempt_at
     LIMIT GREATEST(LEAST(COALESCE(_limit, 20), 100), 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sms_logs s
     SET status = 'sending'::public.sms_status,
         attempts = s.attempts + 1,
         last_attempt_at = now(),
         next_attempt_at = now() + interval '5 minutes'
    FROM due
   WHERE s.id = due.id
  RETURNING s.*;
END $function$;

-- Worker: record the outcome. Never re-sends or overwrites a delivered message.
CREATE OR REPLACE FUNCTION public.complete_sms_job(
  _id uuid,
  _outcome text,
  _provider_sid text DEFAULT NULL,
  _error text DEFAULT NULL
) RETURNS public.sms_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE row public.sms_logs;
BEGIN
  IF _outcome NOT IN ('sent', 'retry', 'failed', 'not_configured') THEN
    RAISE EXCEPTION 'Invalid outcome';
  END IF;

  SELECT * INTO row FROM public.sms_logs WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF row.status = 'sent'::public.sms_status THEN RETURN row; END IF;

  IF _outcome = 'sent' THEN
    UPDATE public.sms_logs
       SET status = 'sent'::public.sms_status, sent_at = now(),
           provider_sid = _provider_sid, error = NULL, next_attempt_at = now()
     WHERE id = _id RETURNING * INTO row;
  ELSIF _outcome = 'not_configured' THEN
    UPDATE public.sms_logs
       SET status = 'not_configured'::public.sms_status,
           error = COALESCE(_error, 'SMS provider is not configured'),
           attempts = GREATEST(row.attempts - 1, 0),
           next_attempt_at = now() + interval '1 hour'
     WHERE id = _id RETURNING * INTO row;
  ELSIF _outcome = 'retry' AND row.attempts < row.max_attempts THEN
    UPDATE public.sms_logs
       SET status = 'queued'::public.sms_status, error = _error,
           next_attempt_at = now() + (interval '1 minute' * power(3, row.attempts)::int)
     WHERE id = _id RETURNING * INTO row;
  ELSE
    UPDATE public.sms_logs
       SET status = 'failed'::public.sms_status, error = _error
     WHERE id = _id RETURNING * INTO row;
  END IF;

  RETURN row;
END $function$;

REVOKE ALL ON FUNCTION public.claim_sms_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_sms_job(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sms_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sms_job(uuid, text, text, text) TO service_role;

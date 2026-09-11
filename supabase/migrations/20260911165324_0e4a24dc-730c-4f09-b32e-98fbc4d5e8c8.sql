-- 1. New lifecycle + event values
ALTER TYPE public.sms_status ADD VALUE IF NOT EXISTS 'sending';
ALTER TYPE public.sms_status ADD VALUE IF NOT EXISTS 'not_configured';
ALTER TYPE public.sms_event ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE public.sms_event ADD VALUE IF NOT EXISTS 'payment_received';

-- 2. Delivery bookkeeping
ALTER TABLE public.sms_logs
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

-- 3. Idempotency: one message per booking/recipient/event
DELETE FROM public.sms_logs s
 WHERE EXISTS (
   SELECT 1 FROM public.sms_logs t
    WHERE t.booking_id = s.booking_id
      AND t.recipient = s.recipient
      AND t.event = s.event
      AND (t.created_at, t.id) < (s.created_at, s.id)
 );
CREATE UNIQUE INDEX IF NOT EXISTS sms_logs_booking_recipient_event_uq
  ON public.sms_logs (booking_id, recipient, event);

-- 4. Queue polling index
CREATE INDEX IF NOT EXISTS sms_logs_due_idx
  ON public.sms_logs (status, next_attempt_at);

-- 5. Revoke convenience grants (trusted server only)
REVOKE EXECUTE ON FUNCTION public.expire_stale_bookings() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_bookings() FROM anon;

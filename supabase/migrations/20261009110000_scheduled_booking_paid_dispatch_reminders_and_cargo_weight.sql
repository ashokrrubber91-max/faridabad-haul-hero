-- MiniPort scheduled booking hardening: required customer ownership, cargo weight,
-- idempotent 24-hour reminders, and paid-only dispatch within 30 minutes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bookings WHERE customer_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce bookings.customer_id NOT NULL: existing bookings without an owner must be reviewed first';
  END IF;
END $$;

ALTER TABLE public.bookings ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cargo_weight_kg numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_cargo_weight_kg_positive'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_cargo_weight_kg_positive
      CHECK (cargo_weight_kg IS NULL OR cargo_weight_kg > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bookings_scheduled_dispatch_idx
  ON public.bookings (scheduled_for)
  WHERE status = 'scheduled' AND scheduled_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.scheduled_booking_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  reminder_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'cancelled')),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_booking_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scheduled_booking_reminders FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_scheduled_booking_reminder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'scheduled' AND NEW.scheduled_for IS NOT NULL AND NEW.customer_id IS NOT NULL THEN
    INSERT INTO public.scheduled_booking_reminders
      (booking_id, customer_id, scheduled_for, reminder_at, status)
    VALUES
      (NEW.id, NEW.customer_id, NEW.scheduled_for,
       GREATEST(now(), NEW.scheduled_for - interval '24 hours'), 'queued')
    ON CONFLICT (booking_id) DO UPDATE
      SET customer_id = EXCLUDED.customer_id,
          scheduled_for = EXCLUDED.scheduled_for,
          reminder_at = EXCLUDED.reminder_at,
          status = CASE
            WHEN public.scheduled_booking_reminders.status = 'sent' THEN 'sent'
            ELSE 'queued'
          END,
          updated_at = now();
  ELSE
    UPDATE public.scheduled_booking_reminders
       SET status = CASE WHEN status = 'sent' THEN 'sent' ELSE 'cancelled' END,
           updated_at = now()
     WHERE booking_id = NEW.id AND status = 'queued';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_scheduled_booking_reminder ON public.bookings;
CREATE TRIGGER trg_sync_scheduled_booking_reminder
AFTER INSERT OR UPDATE OF status, scheduled_for, payment_status
ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_scheduled_booking_reminder();

INSERT INTO public.scheduled_booking_reminders
  (booking_id, customer_id, scheduled_for, reminder_at, status)
SELECT b.id, b.customer_id, b.scheduled_for,
       GREATEST(now(), b.scheduled_for - interval '24 hours'), 'queued'
FROM public.bookings b
WHERE b.status = 'scheduled'
  AND b.scheduled_for IS NOT NULL
  AND b.customer_id IS NOT NULL
ON CONFLICT (booking_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.process_scheduled_booking_automation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  reminder_count integer := 0;
  dispatch_count integer := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.booking_id, s.customer_id, s.scheduled_for
    FROM public.scheduled_booking_reminders s
    JOIN public.bookings b ON b.id = s.booking_id
    WHERE s.status = 'queued'
      AND s.reminder_at <= now()
      AND b.status = 'scheduled'
      AND b.payment_status = 'paid'
      AND b.scheduled_for > now()
    ORDER BY s.reminder_at
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      r.customer_id,
      'Upcoming scheduled trip',
      'Your MiniPort pickup is scheduled for ' ||
        to_char(r.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') ||
        '. Your trip will be sent to nearby drivers 30 minutes before pickup.',
      'scheduled_reminder'
    );
    UPDATE public.scheduled_booking_reminders
       SET status = 'sent', sent_at = now(), updated_at = now()
     WHERE id = r.id AND status = 'queued';
    reminder_count := reminder_count + 1;
  END LOOP;

  UPDATE public.bookings
     SET status = 'pending', updated_at = now()
   WHERE status = 'scheduled'
     AND scheduled_for IS NOT NULL
     AND scheduled_for > now()
     AND scheduled_for <= now() + interval '30 minutes'
     AND payment_status = 'paid';
  GET DIAGNOSTICS dispatch_count = ROW_COUNT;

  UPDATE public.scheduled_booking_reminders s
     SET status = 'cancelled', updated_at = now()
    FROM public.bookings b
   WHERE s.booking_id = b.id
     AND s.status = 'queued'
     AND (b.status <> 'scheduled' OR b.scheduled_for <= now());

  RETURN jsonb_build_object('reminders_sent', reminder_count, 'bookings_dispatched', dispatch_count);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_scheduled_booking_reminder() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_scheduled_booking_automation() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('miniport-scheduled-booking-dispatch', 'miniport-scheduled-booking-automation')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'miniport-scheduled-booking-automation',
  '* * * * *',
  $$SELECT public.process_scheduled_booking_automation();$$
);

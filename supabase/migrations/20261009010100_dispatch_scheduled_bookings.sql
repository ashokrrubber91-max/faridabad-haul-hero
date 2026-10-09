CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule(
  'miniport-scheduled-booking-dispatch',
  '* * * * *',
  $$
    UPDATE public.bookings
       SET status = 'pending', updated_at = now()
     WHERE status = 'scheduled'
       AND scheduled_for IS NOT NULL
       AND scheduled_for <= now() + interval '30 minutes';
  $$
);

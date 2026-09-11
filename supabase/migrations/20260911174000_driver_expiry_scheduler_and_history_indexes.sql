-- MiniPort: automatic dispatch expiry + cursor-friendly history indexes.
-- The scheduler uses pg_cron when available; the function is safe to invoke manually/service-role as well.

CREATE INDEX IF NOT EXISTS idx_bookings_customer_history
  ON public.bookings(customer_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_driver_history
  ON public.bookings(driver_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_pending_expiry
  ON public.bookings(status, created_at)
  WHERE status='pending'::public.booking_status AND cancelled_at IS NULL;

CREATE OR REPLACE FUNCTION public.expire_stale_pending_bookings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE changed integer;
BEGIN
  UPDATE public.bookings
  SET status='expired'::public.booking_status,
      cancellation_reason='No driver accepted within dispatch window',
      cancelled_at=COALESCE(cancelled_at,now()),
      updated_at=now()
  WHERE status='pending'::public.booking_status
    AND driver_id IS NULL
    AND cancelled_at IS NULL
    AND expires_at IS NOT NULL
    AND expires_at < now();
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed;
END;$function$;
REVOKE ALL ON FUNCTION public.expire_stale_pending_bookings() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_bookings() TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='miniport-expire-pending-bookings';
    PERFORM cron.schedule('miniport-expire-pending-bookings','* * * * *','select public.expire_stale_pending_bookings();');
  END IF;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  NULL;
END;$cron$;

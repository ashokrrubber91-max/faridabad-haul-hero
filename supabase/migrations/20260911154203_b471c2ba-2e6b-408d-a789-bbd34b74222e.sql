CREATE OR REPLACE FUNCTION public.expire_stale_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.bookings
     SET status = 'expired'::booking_status,
         updated_at = now()
   WHERE status = 'pending'
     AND driver_id IS NULL
     AND cancelled_at IS NULL
     AND expires_at IS NOT NULL
     AND expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_bookings() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS bookings_pending_expiry_idx
  ON public.bookings (expires_at)
  WHERE status = 'pending' AND driver_id IS NULL;
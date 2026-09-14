UPDATE public.bookings
   SET cancelled_at = COALESCE(updated_at, created_at)
 WHERE status = 'cancelled'
   AND cancelled_at IS NULL;
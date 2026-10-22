-- Retry unassigned paid/COD bookings when a driver comes online after earlier offers expired.
CREATE OR REPLACE FUNCTION public.process_driver_dispatch_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record; advanced integer := 0; started integer := 0;
BEGIN
  FOR r IN SELECT DISTINCT booking_id FROM public.booking_dispatch_offers
    WHERE status='offered' AND expires_at<=now() ORDER BY booking_id LIMIT 200
  LOOP
    UPDATE public.booking_dispatch_offers SET status='expired',responded_at=now()
      WHERE booking_id=r.booking_id AND status='offered' AND expires_at<=now();
    IF public.dispatch_next_driver(r.booking_id) IS NOT NULL THEN advanced:=advanced+1; END IF;
  END LOOP;
  FOR r IN SELECT b.id FROM public.bookings b
    WHERE b.status='pending' AND b.driver_id IS NULL AND b.cancelled_at IS NULL
      AND (b.payment_method='cod' OR b.payment_status='paid')
      AND b.pickup_lat IS NOT NULL AND b.pickup_lng IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.booking_dispatch_offers o WHERE o.booking_id=b.id AND o.status='offered' AND o.expires_at>now())
    ORDER BY b.created_at LIMIT 200
  LOOP
    IF public.dispatch_next_driver(r.id) IS NOT NULL THEN started:=started+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('started',started,'advanced',advanced);
END;
$$;
REVOKE ALL ON FUNCTION public.process_driver_dispatch_queue() FROM PUBLIC, anon, authenticated;
-- Prevent simultaneous live offers to one driver and serialize concurrent
-- accepts. Lock order is booking -> driver profile -> offer rows.

CREATE OR REPLACE FUNCTION public.dispatch_next_driver(_booking_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions
AS $$
DECLARE b public.bookings%ROWTYPE; next_driver uuid; next_seq integer; dist numeric;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR b.status<>'pending' OR b.driver_id IS NOT NULL OR b.cancelled_at IS NOT NULL
     OR (b.payment_method<>'cod' AND b.payment_status<>'paid') THEN RETURN NULL; END IF;

  -- A booking must have at most one live offer, even when its trigger and
  -- queue worker attempt dispatch at the same time.
  IF EXISTS (SELECT 1 FROM public.booking_dispatch_offers x
    WHERE x.booking_id=_booking_id AND x.status='offered' AND x.expires_at>now()) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(MAX(sequence_no),0)+1 INTO next_seq
  FROM public.booking_dispatch_offers WHERE booking_id=_booking_id;

  SELECT dl.driver_id,
    round((ST_Distance(dl.location_geog,
      ST_SetSRID(ST_MakePoint(b.pickup_lng,b.pickup_lat),4326)::geography)/1000.0)::numeric,3)
  INTO next_driver,dist
  FROM public.driver_locations dl
  JOIN public.profiles p ON p.id=dl.driver_id
  JOIN public.user_roles ur ON ur.user_id=dl.driver_id AND ur.role='driver'::public.app_role
  WHERE p.is_online IS TRUE AND p.kyc_status='approved'::public.kyc_status
    AND COALESCE(p.service_zone,'Faridabad')=COALESCE(b.service_zone,'Faridabad')
    AND dl.updated_at>=now()-interval '90 seconds'
    AND b.pickup_lat IS NOT NULL AND b.pickup_lng IS NOT NULL
    AND ST_DWithin(dl.location_geog,
      ST_SetSRID(ST_MakePoint(b.pickup_lng,b.pickup_lat),4326)::geography,7000)
    AND NOT EXISTS(SELECT 1 FROM public.driver_booking_passes x
      WHERE x.booking_id=_booking_id AND x.driver_id=dl.driver_id)
    AND NOT EXISTS(SELECT 1 FROM public.booking_dispatch_offers x
      WHERE x.booking_id=_booking_id AND x.driver_id=dl.driver_id)
    -- A driver may have only one unexpired offer across all bookings.
    AND NOT EXISTS(SELECT 1 FROM public.booking_dispatch_offers x
      WHERE x.driver_id=dl.driver_id AND x.status='offered' AND x.expires_at>now())
    AND NOT EXISTS(SELECT 1 FROM public.bookings active
      WHERE active.driver_id=dl.driver_id AND active.status IN ('accepted','in_progress')
        AND active.cancelled_at IS NULL)
  ORDER BY
    ST_Distance(dl.location_geog,
      ST_SetSRID(ST_MakePoint(b.pickup_lng,b.pickup_lat),4326)::geography) ASC,
    (SELECT count(*) FROM public.bookings done
      WHERE done.driver_id=dl.driver_id AND done.status='completed') DESC,
    dl.updated_at DESC
  LIMIT 1
  FOR UPDATE OF p SKIP LOCKED;

  IF next_driver IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.booking_dispatch_offers
    (booking_id,driver_id,sequence_no,status,offered_at,expires_at,distance_km)
  VALUES (_booking_id,next_driver,next_seq,'offered',now(),now()+interval '20 seconds',dist)
  ON CONFLICT(booking_id,driver_id) DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.notifications(user_id,title,body,kind)
  VALUES(next_driver,'New MiniPort ride request',
    'You have 20 seconds to accept a nearby ride. Pickup: '||
    b.pickup_address||' → Drop: '||b.drop_address||'. Fare ₹'||round(b.fare)::text,
    'driver_ride_offer');
  RETURN next_driver;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_next_driver(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_next_driver(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.process_driver_dispatch_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE r record; advanced integer:=0; started integer:=0; locked_booking uuid;
BEGIN
  FOR r IN SELECT DISTINCT booking_id FROM public.booking_dispatch_offers
    WHERE status='offered' AND expires_at<=now() ORDER BY booking_id LIMIT 200
  LOOP
    -- Lock the booking before updating offers to avoid lock-order deadlocks.
    SELECT b.id INTO locked_booking FROM public.bookings b
    WHERE b.id=r.booking_id FOR UPDATE SKIP LOCKED;
    IF locked_booking IS NULL THEN CONTINUE; END IF;

    UPDATE public.booking_dispatch_offers SET status='expired',responded_at=now()
      WHERE booking_id=r.booking_id AND status='offered' AND expires_at<=now();
    IF FOUND AND public.dispatch_next_driver(r.booking_id) IS NOT NULL THEN
      advanced:=advanced+1;
    END IF;
    locked_booking:=NULL;
  END LOOP;

  FOR r IN SELECT b.id FROM public.bookings b
    WHERE b.status='pending' AND b.driver_id IS NULL AND b.cancelled_at IS NULL
      AND (b.payment_method='cod' OR b.payment_status='paid')
      AND b.pickup_lat IS NOT NULL AND b.pickup_lng IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.booking_dispatch_offers o
        WHERE o.booking_id=b.id AND o.status='offered' AND o.expires_at>now())
    ORDER BY b.created_at LIMIT 200
  LOOP
    IF public.dispatch_next_driver(r.id) IS NOT NULL THEN started:=started+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('started',started,'advanced',advanced);
END;
$$;
REVOKE ALL ON FUNCTION public.process_driver_dispatch_queue() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.accept_booking(_booking_id uuid)
RETURNS public.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_driver public.profiles%ROWTYPE; v_booking public.bookings%ROWTYPE;
  v_balance numeric:=0; v_active integer:=0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;

  -- Booking first, then profile: concurrent accepts by this driver serialize.
  SELECT * INTO v_booking FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.driver_id IS NOT NULL OR v_booking.status<>'pending'
     OR v_booking.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;

  SELECT * INTO v_driver FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_driver.is_online IS NOT TRUE
     OR v_driver.kyc_status<>'approved'::public.kyc_status THEN
    RAISE EXCEPTION 'Driver must be online and verified';
  END IF;

  SELECT COALESCE(cash_balance,0) INTO v_balance
  FROM public.wallet_accounts WHERE user_id=auth.uid();
  IF v_balance<100 THEN
    RAISE EXCEPTION 'Minimum wallet balance of INR 100 is required to accept rides';
  END IF;

  SELECT count(*) INTO v_active FROM public.bookings
  WHERE driver_id=auth.uid() AND status IN ('accepted','in_progress') AND cancelled_at IS NULL;
  IF v_active>0 THEN RAISE EXCEPTION 'Finish your current trip before accepting a new one'; END IF;

  -- Match dispatch's Faridabad default for profiles without an explicit zone.
  IF COALESCE(v_booking.service_zone,'Faridabad')
     IS DISTINCT FROM COALESCE(v_driver.service_zone,'Faridabad') THEN
    RAISE EXCEPTION 'Ride is outside your service zone';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.booking_dispatch_offers o
    WHERE o.booking_id=_booking_id AND o.driver_id=auth.uid()
      AND o.status='offered' AND o.expires_at>now()) THEN
    RAISE EXCEPTION 'This ride is not currently offered to you or the 20-second timer has expired';
  END IF;

  UPDATE public.bookings SET driver_id=auth.uid(),status='accepted',updated_at=now()
  WHERE id=_booking_id AND driver_id IS NULL AND status='pending' AND cancelled_at IS NULL
  RETURNING * INTO v_booking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ride already accepted or closed'; END IF;

  UPDATE public.booking_dispatch_offers SET status='accepted',responded_at=now()
  WHERE booking_id=_booking_id AND driver_id=auth.uid() AND status='offered';
  UPDATE public.booking_dispatch_offers SET status='skipped',responded_at=now()
  WHERE booking_id=_booking_id AND status='offered' AND driver_id<>auth.uid();

  v_booking.pickup_otp:=NULL; v_booking.drop_otp:=NULL;
  RETURN v_booking;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_booking(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_booking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_booking(_booking_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE changed integer; v_booking public.bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can decline rides';
  END IF;
  -- Lock booking before offer rows, matching accept/expiry lock order.
  SELECT * INTO v_booking FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.status<>'pending' OR v_booking.driver_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ride already accepted or closed';
  END IF;

  UPDATE public.booking_dispatch_offers SET status='declined',responded_at=now()
  WHERE booking_id=_booking_id AND driver_id=auth.uid()
    AND status='offered' AND expires_at>now();
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RAISE EXCEPTION 'No active offer to decline'; END IF;
  PERFORM public.dispatch_next_driver(_booking_id);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.decline_booking(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decline_booking(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';

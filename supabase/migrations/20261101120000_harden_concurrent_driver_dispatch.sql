-- Prevent simultaneous live offers to one driver and serialize concurrent
-- accepts. Lock order is booking -> driver profile -> offer rows.

-- Fail before changing anything if the project's prerequisite schema is missing.
-- The read-only project audit found these relations absent in the connected DB,
-- although the application and existing booking-pricing functions depend on them.
DO $$
BEGIN
  IF to_regclass('public.driver_profiles') IS NULL
     OR to_regclass('public.vehicle_types') IS NULL
     OR to_regclass('public.platform_settings') IS NULL
     OR to_regclass('private.booking_otps') IS NULL
     OR to_regclass('public.booking_otp_attempts') IS NULL THEN
    RAISE EXCEPTION
      'MiniPort schema is incomplete: restore and validate driver_profiles, vehicle_types, platform_settings, booking_otps, and booking_otp_attempts migrations before applying dispatch hardening';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_next_driver(_booking_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE b public.bookings%ROWTYPE; next_driver uuid; next_seq integer; dist numeric;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR b.status<>'pending' OR b.driver_id IS NOT NULL OR b.cancelled_at IS NOT NULL
     OR (b.expires_at IS NOT NULL AND b.expires_at<=now())
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
    round((extensions.ST_Distance(dl.location_geog,
      extensions.ST_SetSRID(extensions.ST_MakePoint(b.pickup_lng,b.pickup_lat),4326)::extensions.geography)/1000.0)::numeric,3)
  INTO next_driver,dist
  FROM public.driver_locations dl
  JOIN public.profiles p ON p.id=dl.driver_id
  JOIN public.user_roles ur ON ur.user_id=dl.driver_id AND ur.role='driver'::public.app_role
  LEFT JOIN public.driver_profiles dp ON dp.user_id=dl.driver_id
  JOIN LATERAL (
    SELECT dk.vehicle_id
    FROM public.driver_kyc dk
    WHERE dk.driver_id=dl.driver_id AND dk.status='approved'::public.kyc_status
    ORDER BY dk.updated_at DESC
    LIMIT 1
  ) approved_kyc ON true
  WHERE p.is_online IS TRUE AND p.kyc_status='approved'::public.kyc_status
    AND COALESCE(p.service_zone,'Faridabad')=COALESCE(b.service_zone,'Faridabad')
    -- Match the requested catalogue vehicle. Prefer a valid driver profile
    -- vehicle, then fall back to the vehicle from the latest approved KYC.
    AND COALESCE(
      (SELECT vt.id FROM public.vehicle_types vt WHERE vt.id=dp.vehicle_type),
      approved_kyc.vehicle_id
    )=b.vehicle_type
    AND dl.updated_at>=now()-interval '90 seconds'
    AND b.pickup_lat IS NOT NULL AND b.pickup_lng IS NOT NULL
    AND extensions.ST_DWithin(dl.location_geog,
      extensions.ST_SetSRID(extensions.ST_MakePoint(b.pickup_lng,b.pickup_lat),4326)::extensions.geography,7000)
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
    extensions.ST_Distance(dl.location_geog,
      extensions.ST_SetSRID(extensions.ST_MakePoint(b.pickup_lng,b.pickup_lat),4326)::extensions.geography) ASC,
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
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
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
RETURNS public.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_driver public.profiles%ROWTYPE; v_booking public.bookings%ROWTYPE;
  v_balance numeric:=0; v_active integer:=0; v_driver_vehicle text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'driver'::public.app_role) THEN
    RAISE EXCEPTION 'Only drivers can accept rides';
  END IF;

  -- Booking first, then profile: concurrent accepts by this driver serialize.
  SELECT * INTO v_booking FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.driver_id IS NOT NULL OR v_booking.status<>'pending'
     OR v_booking.cancelled_at IS NOT NULL
     OR (v_booking.expires_at IS NOT NULL AND v_booking.expires_at <= now()) THEN
    RAISE EXCEPTION 'Ride already accepted, expired or closed';
  END IF;
  IF v_booking.payment_method <> 'cod' AND v_booking.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Trip payment must be confirmed before driver acceptance';
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

  SELECT COALESCE(
    (SELECT vt.id
     FROM public.vehicle_types vt
     JOIN public.driver_profiles dp ON dp.user_id=auth.uid()
     WHERE vt.id=dp.vehicle_type),
    (SELECT dk.vehicle_id
     FROM public.driver_kyc dk
     WHERE dk.driver_id=auth.uid()
       AND dk.status='approved'::public.kyc_status
     ORDER BY dk.updated_at DESC
     LIMIT 1)
  ) INTO v_driver_vehicle;

  IF v_driver_vehicle IS DISTINCT FROM v_booking.vehicle_type THEN
    RAISE EXCEPTION 'This ride requires a different vehicle type';
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

  v_booking.pickup_otp:=NULL;
  v_booking.drop_otp:=NULL;
  v_booking.customer_phone:=NULL;
  RETURN v_booking;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_booking(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_booking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_booking(_booking_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
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


-- Scheduled trips must use the same single-driver offer pipeline as immediate
-- trips. The older automation broadcast to every online driver in a zone,
-- including drivers who had no active offer and could not accept the booking.
CREATE OR REPLACE FUNCTION public.process_scheduled_booking_automation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
  reminder_count integer := 0;
  assigned_driver_reminder_count integer := 0;
  dispatch_count integer := 0;
BEGIN
  -- Dispatch first (booking -> driver -> offer locks), then reminders. This
  -- keeps the same lock order as cancellation's booking -> reminder trigger.
  WITH dispatched AS (
    UPDATE public.bookings b
       SET status = 'pending', updated_at = now()
     WHERE b.status = 'scheduled'
       AND b.scheduled_for IS NOT NULL
       AND b.scheduled_for > now()
       AND b.scheduled_for <= now() + interval '30 minutes'
       AND (b.payment_method = 'cod' OR b.payment_status = 'paid')
       AND (b.expires_at IS NULL OR b.expires_at > now())
    RETURNING b.id
  )
  SELECT count(*) INTO dispatch_count FROM dispatched;

  FOR r IN
    SELECT s.id, s.customer_id, b.driver_id, s.scheduled_for,
           b.pickup_address, b.drop_address
    FROM public.scheduled_booking_reminders s
    JOIN public.bookings b ON b.id = s.booking_id
    WHERE s.status = 'queued'
      AND s.reminder_at <= now()
      AND b.status = 'scheduled'
      AND (b.payment_method = 'cod' OR b.payment_status = 'paid')
      AND b.scheduled_for > now()
    ORDER BY s.reminder_at
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    INSERT INTO public.notifications (user_id, title, body, kind)
    VALUES (
      r.customer_id,
      'Upcoming scheduled trip — 24-hour reminder',
      'Your MiniPort pickup is scheduled for ' ||
        to_char(r.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') ||
        '. Your trip will be offered to one eligible nearby driver shortly before pickup.',
      'scheduled_reminder'
    );

    IF r.driver_id IS NOT NULL AND r.driver_id <> r.customer_id THEN
      INSERT INTO public.notifications (user_id, title, body, kind)
      VALUES (
        r.driver_id,
        'Assigned scheduled trip — 24-hour reminder',
        'You are assigned to a MiniPort pickup scheduled for ' ||
          to_char(r.scheduled_for AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') ||
          '. Pickup: ' || r.pickup_address || '. Drop: ' || r.drop_address ||
          '. Please keep your availability updated.',
        'scheduled_reminder'
      );
      assigned_driver_reminder_count := assigned_driver_reminder_count + 1;
    END IF;

    UPDATE public.scheduled_booking_reminders
       SET status = 'sent', sent_at = now(), updated_at = now()
     WHERE id = r.id AND status = 'queued';
    reminder_count := reminder_count + 1;
  END LOOP;

  UPDATE public.scheduled_booking_reminders s
     SET status = 'cancelled', updated_at = now()
    FROM public.bookings b
   WHERE s.booking_id = b.id
     AND s.status = 'queued'
     AND (b.status <> 'scheduled' OR b.scheduled_for <= now());

  RETURN jsonb_build_object(
    'reminders_sent', reminder_count,
    'assigned_driver_reminders_sent', assigned_driver_reminder_count,
    'bookings_dispatched', dispatch_count,
    'dispatch_mode', 'sequential_single_driver_offer'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.process_scheduled_booking_automation() FROM PUBLIC, anon, authenticated;



-- Restore column-scoped access that was accidentally widened by a later
-- table-level GRANT. API users must never read OTP/contact columns directly.
REVOKE SELECT, INSERT, UPDATE ON public.bookings FROM authenticated, anon, PUBLIC;
REVOKE SELECT (pickup_otp, drop_otp, customer_phone)
  ON public.bookings FROM authenticated, anon, PUBLIC;
REVOKE INSERT (pickup_otp, drop_otp, customer_phone, driver_id, payment_status,
               commission_amount, driver_net_earning, pickup_verified_at, drop_verified_at)
  ON public.bookings FROM authenticated, anon, PUBLIC;
REVOKE UPDATE (notes, rating, review, loading_started_at, loading_stopped_at,
               unloading_started_at, unloading_stopped_at)
  ON public.bookings FROM authenticated, anon, PUBLIC;

GRANT SELECT (
  id, customer_id, driver_id, pickup_address, drop_address, vehicle_type,
  distance_km, fare, fare_boost, helper_count, helper_fee, status, notes,
  created_at, updated_at, coupon_code, coupon_discount, coins_redeemed,
  payment_method, payment_status, commission_rate, commission_amount,
  driver_net_earning, pickup_verified_at, drop_verified_at, rating, review,
  pod_photo_url, cancellation_reason, pickup_lat, pickup_lng, drop_lat, drop_lng,
  loading_started_at, loading_stopped_at, unloading_started_at, unloading_stopped_at,
  service_zone, scheduled_for, cargo_weight_kg, cancelled_at, expires_at,
  booking_source, loading_overtime_minutes, unloading_overtime_minutes,
  overtime_charge, final_fare, cancelled_by, cancellation_category, stops,
  is_multi_stop, total_stops
) ON public.bookings TO authenticated;

-- Customers may submit only booking inputs. Server-owned fields (OTP, driver,
-- payment state, calculated totals, timestamps and verification fields) are
-- never writable from the browser.
-- Booking rows are inserted only by the authenticated server function after
-- route calculation and user verification. The browser has no direct INSERT.
REVOKE INSERT ON public.bookings FROM authenticated, anon, PUBLIC;
DROP POLICY IF EXISTS "Bookings: authenticated user inserts own booking" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: customer inserts own booking" ON public.bookings;

-- The only direct customer edit on an existing booking is a completed-trip review.
GRANT UPDATE (rating, review) ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;

-- Remove the exact legacy policy names currently present in the live
-- database as well as names used by earlier migration variants. PostgreSQL
-- combines permissive policies with OR, so leaving even one broad SELECT
-- policy would preserve cross-customer pending-booking visibility.
DROP POLICY IF EXISTS "Drivers can view searching rides" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: customer and assigned driver select" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: customer insert own" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: authorized participant update" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: select own or authorized dispatch" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: update by authorized participant" ON public.bookings;
DROP POLICY IF EXISTS "Bookings: customer review completed trip" ON public.bookings;

-- private.booking_stop_otps remains a separate defense-in-depth follow-up.
-- It has no anon/authenticated table grants in the reviewed live schema.
-- Do not enable RLS until its trusted RPC access path and policies are reviewed.

CREATE POLICY "Bookings: select own or assigned driver"
ON public.bookings FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR customer_id = auth.uid()
  OR (
    public.has_role(auth.uid(), 'driver'::public.app_role)
    AND driver_id = auth.uid()
  )
);

CREATE POLICY "Bookings: customer review completed trip"
ON public.bookings FOR UPDATE TO authenticated
USING (
  customer_id = auth.uid()
  AND status = 'completed'::public.booking_status
)
WITH CHECK (
  customer_id = auth.uid()
  AND status = 'completed'::public.booking_status
);

-- The open-driver feed is now offer-scoped, vehicle/zone-aware and privacy
-- minimized. A driver cannot enumerate every pending customer booking.
CREATE OR REPLACE FUNCTION public.get_open_driver_bookings()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (
      to_jsonb(b) - ARRAY[
        'pickup_otp', 'drop_otp', 'customer_phone', 'customer_id', 'notes',
        'stops', 'pod_photo_url', 'rating', 'review', 'cancellation_reason',
        'cancelled_by', 'coupon_code', 'coupon_discount', 'coins_redeemed',
        'wallet_deducted_amount', 'final_payable_amount'
      ]
    ) || jsonb_build_object(
      'notes', NULL,
      'stops', COALESCE(
        (
          SELECT jsonb_agg(
            stop_item.value - ARRAY['contact_name', 'contact_phone']
            ORDER BY COALESCE((stop_item.value->>'sequence')::integer, 0)
          )
          FROM jsonb_array_elements(COALESCE(b.stops, '[]'::jsonb)) AS stop_item(value)
        ),
        '[]'::jsonb
      )
    )
  FROM public.bookings b
  JOIN public.booking_dispatch_offers o
    ON o.booking_id = b.id
   AND o.driver_id = auth.uid()
   AND o.status = 'offered'
   AND o.expires_at > now()
  JOIN public.profiles p ON p.id = auth.uid()
  LEFT JOIN public.driver_profiles dp ON dp.user_id = auth.uid()
  JOIN LATERAL (
    SELECT dk.vehicle_id
    FROM public.driver_kyc dk
    WHERE dk.driver_id = auth.uid()
      AND dk.status = 'approved'::public.kyc_status
    ORDER BY dk.updated_at DESC
    LIMIT 1
  ) approved_kyc ON true
  WHERE auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'driver'::public.app_role)
    AND public.is_kyc_approved(auth.uid())
    AND p.is_online IS TRUE
    AND p.kyc_status = 'approved'::public.kyc_status
    AND COALESCE(p.service_zone, 'Faridabad') = COALESCE(b.service_zone, 'Faridabad')
    AND COALESCE(
      (SELECT vt.id FROM public.vehicle_types vt WHERE vt.id = dp.vehicle_type),
      approved_kyc.vehicle_id
    ) = b.vehicle_type
    AND b.status = 'pending'::public.booking_status
    AND b.driver_id IS NULL
    AND b.cancelled_at IS NULL
    AND (b.expires_at IS NULL OR b.expires_at > now())
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings active
      WHERE active.driver_id = auth.uid()
        AND active.status IN ('accepted', 'in_progress')
        AND active.cancelled_at IS NULL
    )
  ORDER BY b.created_at DESC
  LIMIT 60;
$$;

REVOKE ALL ON FUNCTION public.get_open_driver_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_driver_bookings() TO authenticated;
NOTIFY pgrst, 'reload schema';


-- Cancellation closes any outstanding driver offers and never returns OTPs.
CREATE OR REPLACE FUNCTION public.cancel_booking(
  _booking_id uuid,
  _reason text,
  _note text DEFAULT NULL::text
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  uid uuid := auth.uid();
  clean_reason text;
  next_notes text;
  actor public.cancel_actor;
  category public.cancellation_category;
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
    actor := 'customer';
    category := 'customer_cancelled';
  ELSIF b.driver_id = uid THEN
    IF b.status <> 'accepted'::public.booking_status THEN
      RAISE EXCEPTION 'You can only drop a trip before pickup verification';
    END IF;
    actor := 'driver';
    category := 'driver_cancelled';
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
         cancelled_by = actor,
         cancellation_category = category,
         notes = next_notes,
         payment_status = CASE
           WHEN b.payment_status = 'pending'::public.payment_status
           THEN 'failed'::public.payment_status
           ELSE b.payment_status
         END,
         pickup_otp = NULL,
         drop_otp = NULL
   WHERE id = _booking_id
  RETURNING * INTO b;
  PERFORM set_config('miniport.trusted_write', 'off', true);

  UPDATE public.booking_dispatch_offers
     SET status = 'skipped', responded_at = now()
   WHERE booking_id = _booking_id AND status = 'offered';
  DELETE FROM private.booking_otps WHERE booking_id = _booking_id;

  b.pickup_otp := NULL;
  b.drop_otp := NULL;
  b.customer_phone := NULL;
  RETURN b;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, text) TO authenticated;

-- Admin manual assignment follows the same lock order and eligibility checks
-- as automatic dispatch, and records the assignment in the offer history.
CREATE OR REPLACE FUNCTION public.admin_assign_driver(_booking_id uuid, _driver_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  v_driver public.profiles%ROWTYPE;
  v_driver_vehicle text;
  next_seq integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only the operations team can assign drivers';
  END IF;

  -- Match automatic dispatch lock order: booking first, then driver profile.
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.status <> 'pending'::public.booking_status OR b.driver_id IS NOT NULL
     OR b.cancelled_at IS NOT NULL
     OR (b.expires_at IS NOT NULL AND b.expires_at <= now()) THEN
    RAISE EXCEPTION 'Trip is no longer searching for a driver';
  END IF;
  IF b.payment_method <> 'cod' AND b.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Trip payment must be confirmed before driver assignment';
  END IF;

  SELECT * INTO v_driver FROM public.profiles WHERE id = _driver_id FOR UPDATE;
  IF NOT FOUND
     OR NOT public.has_role(_driver_id, 'driver'::public.app_role)
     OR v_driver.kyc_status <> 'approved'::public.kyc_status
     OR v_driver.is_online IS NOT TRUE THEN
    RAISE EXCEPTION 'Driver must be online and approved to take trips';
  END IF;

  IF COALESCE(b.service_zone, 'Faridabad')
     IS DISTINCT FROM COALESCE(v_driver.service_zone, 'Faridabad') THEN
    RAISE EXCEPTION 'Driver is outside the trip service zone';
  END IF;

  SELECT COALESCE(
    (SELECT vt.id
     FROM public.vehicle_types vt
     JOIN public.driver_profiles dp ON dp.user_id = _driver_id
     WHERE vt.id = dp.vehicle_type),
    (SELECT dk.vehicle_id
     FROM public.driver_kyc dk
     WHERE dk.driver_id = _driver_id
       AND dk.status = 'approved'::public.kyc_status
     ORDER BY dk.updated_at DESC
     LIMIT 1)
  ) INTO v_driver_vehicle;
  IF v_driver_vehicle IS DISTINCT FROM b.vehicle_type THEN
    RAISE EXCEPTION 'Driver vehicle does not match the trip vehicle type';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings active
    WHERE active.driver_id = _driver_id
      AND active.status IN ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
      AND active.cancelled_at IS NULL
      AND active.id <> _booking_id
  ) THEN
    RAISE EXCEPTION 'That driver is already on a trip';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_dispatch_offers active_offer
    WHERE active_offer.driver_id = _driver_id
      AND active_offer.status = 'offered'
      AND active_offer.expires_at > now()
      AND active_offer.booking_id <> _booking_id
  ) THEN
    RAISE EXCEPTION 'That driver already has another live ride offer';
  END IF;

  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings
     SET driver_id = _driver_id,
         status = 'accepted'::public.booking_status,
         updated_at = now()
   WHERE id = _booking_id
  RETURNING * INTO b;
  PERFORM set_config('miniport.trusted_write', 'off', true);

  UPDATE public.booking_dispatch_offers
     SET status = 'skipped', responded_at = now()
   WHERE booking_id = _booking_id
     AND status = 'offered'
     AND driver_id <> _driver_id;

  SELECT COALESCE(MAX(sequence_no), 0) + 1 INTO next_seq
  FROM public.booking_dispatch_offers
  WHERE booking_id = _booking_id;

  INSERT INTO public.booking_dispatch_offers
    (booking_id, driver_id, sequence_no, status, offered_at, expires_at, responded_at)
  VALUES (_booking_id, _driver_id, next_seq, 'accepted', now(), now(), now())
  ON CONFLICT (booking_id, driver_id)
  DO UPDATE SET status = 'accepted', responded_at = now(), expires_at = now();

  INSERT INTO public.notifications (user_id, title, body, kind)
  VALUES (
    _driver_id,
    'MiniPort ride assigned by operations',
    'A verified MiniPort booking has been assigned to you. Pickup: ' ||
      b.pickup_address || ' → Drop: ' || b.drop_address,
    'driver_ride_offer'
  );

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (
    auth.uid(),
    'admin_assign_driver',
    'bookings',
    _booking_id,
    jsonb_build_object('driver_id', _driver_id)
  );

  b.pickup_otp := NULL;
  b.drop_otp := NULL;
  b.customer_phone := NULL;
  RETURN b;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_assign_driver(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_driver(uuid, uuid) TO authenticated;


-- The trusted server booking function uses the service-role client only after
-- checking the caller's session. Re-run all financial rules using the explicit
-- customer_id, and preserve scheduled bookings rather than forcing them pending.
CREATE OR REPLACE FUNCTION public.bookings_enforce_insert_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  service_role_call boolean := COALESCE(auth.role(), '') = 'service_role';
  base numeric;
  per_km numeric;
  gross numeric;
  disc numeric := 0;
  cpn record;
  coin_cap numeric;
  bal numeric;
  v_weight integer;
  helper_count_safe smallint;
  helper_fee_safe numeric;
  stop_fee numeric;
  stop_count integer;
BEGIN
  IF actor_id IS NULL AND NOT service_role_call THEN
    RAISE EXCEPTION 'Please sign in again';
  END IF;
  IF actor_id IS NOT NULL AND public.has_role(actor_id, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN RAISE EXCEPTION 'Booking customer is required'; END IF;
  IF actor_id IS NOT NULL AND NEW.customer_id <> actor_id THEN
    RAISE EXCEPTION 'You can only book for your own account';
  END IF;

  IF NEW.scheduled_for IS NOT NULL AND NEW.scheduled_for > now() THEN
    NEW.status := 'scheduled'::public.booking_status;
    -- The table default is now()+30m; scheduled trips must override it so
    -- they remain dispatchable until 30 minutes after the requested pickup.
    NEW.expires_at := NEW.scheduled_for + interval '30 minutes';
  ELSE
    NEW.status := 'pending'::public.booking_status;
    NEW.expires_at := COALESCE(NEW.expires_at, now() + interval '30 minutes');
  END IF;

  NEW.payment_status := 'pending'::public.payment_status;
  SELECT s.commission_rate INTO NEW.commission_rate
  FROM public.platform_settings s WHERE s.id;
  NEW.commission_rate := COALESCE(NEW.commission_rate, 0.10);
  NEW.commission_amount := 0;
  NEW.driver_net_earning := 0;
  NEW.driver_id := NULL;
  NEW.pickup_verified_at := NULL;
  NEW.drop_verified_at := NULL;
  NEW.rating := NULL;
  NEW.review := NULL;
  NEW.pod_photo_url := NULL;

  SELECT v.base_fare, v.per_km_fare, v.weight_limit_kg
    INTO base, per_km, v_weight
  FROM public.vehicle_types v
  WHERE v.id::text = NEW.vehicle_type::text AND v.active;
  IF base IS NULL THEN RAISE EXCEPTION 'This vehicle is not available for booking'; END IF;

  helper_count_safe := GREATEST(LEAST(COALESCE(NEW.helper_count, 0), 2), 0)::smallint;
  IF COALESCE(v_weight, 0) <= 20 THEN helper_count_safe := 0; END IF;
  helper_fee_safe := helper_count_safe * 250;
  NEW.helper_count := helper_count_safe;
  NEW.helper_fee := helper_fee_safe;
  NEW.distance_km := GREATEST(COALESCE(NEW.distance_km, 0), 0);

  stop_count := GREATEST(LEAST(COALESCE(NEW.total_stops, 1), 4), 1);
  NEW.total_stops := stop_count;
  NEW.is_multi_stop := stop_count > 1;
  stop_fee := GREATEST(stop_count - 1, 0) * 50;
  gross := ROUND(base + per_km * NEW.distance_km + helper_fee_safe + stop_fee);

  IF NEW.coupon_code IS NOT NULL AND BTRIM(NEW.coupon_code) <> '' THEN
    SELECT * INTO cpn
    FROM public.validate_coupon(NEW.coupon_code, gross, NEW.customer_id);
    IF cpn.message = 'ok' AND cpn.discount > 0 THEN
      NEW.coupon_code := cpn.code;
      NEW.coupon_discount := cpn.discount;
    ELSE
      NEW.coupon_code := NULL;
      NEW.coupon_discount := 0;
    END IF;
  ELSE
    NEW.coupon_code := NULL;
    NEW.coupon_discount := 0;
  END IF;

  SELECT coins_balance INTO bal
  FROM public.wallet_accounts WHERE user_id = NEW.customer_id;
  coin_cap := LEAST(
    GREATEST(gross - COALESCE(NEW.coupon_discount, 0), 0),
    COALESCE(bal, 0)
  );
  NEW.coins_redeemed := GREATEST(LEAST(COALESCE(NEW.coins_redeemed, 0), coin_cap), 0);
  disc := COALESCE(NEW.coupon_discount, 0) + COALESCE(NEW.coins_redeemed, 0);
  NEW.fare := GREATEST(gross - disc, 0);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bookings_enforce_insert_financials() FROM PUBLIC, anon, authenticated;


-- Completing a trip with POD is a trusted state transition. Keep the booking
-- trigger's protected columns writable only inside this verified RPC and
-- return no OTP or customer contact data to the driver.
CREATE OR REPLACE FUNCTION public.complete_booking_with_pod(_booking_id uuid, _pod_path text)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF _pod_path IS NULL OR btrim(_pod_path) = '' THEN
    RAISE EXCEPTION 'Attach a delivery photo first';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF b.driver_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Only the assigned driver can complete this trip';
  END IF;
  IF b.status <> 'in_progress'::public.booking_status THEN
    RAISE EXCEPTION 'Trip is not in progress';
  END IF;

  PERFORM set_config('miniport.trusted_write', 'on', true);
  UPDATE public.bookings
     SET drop_verified_at = now(),
         status = 'completed'::public.booking_status,
         pod_photo_url = _pod_path,
         pickup_otp = NULL,
         drop_otp = NULL,
         unloading_stopped_at = COALESCE(unloading_stopped_at, now())
   WHERE id = _booking_id
  RETURNING * INTO b;
  PERFORM set_config('miniport.trusted_write', 'off', true);

  DELETE FROM private.booking_otps WHERE booking_id = _booking_id;
  DELETE FROM public.booking_otp_attempts WHERE booking_id = _booking_id;

  b.pickup_otp := NULL;
  b.drop_otp := NULL;
  b.customer_phone := NULL;
  RETURN b;
END;
$$;
-- Do not expose this legacy helper: it can mark a trip complete without
-- checking the customer's drop OTP. The supported flow is verify_booking_otp.
REVOKE ALL ON FUNCTION public.complete_booking_with_pod(uuid, text)
  FROM PUBLIC, anon, authenticated;


-- Purge OTP material once a trip is closed, regardless of which trusted
-- completion/cancellation path performed the transition.
CREATE OR REPLACE FUNCTION public.purge_closed_booking_otps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN (
    'completed'::public.booking_status,
    'cancelled'::public.booking_status,
    'expired'::public.booking_status
  ) AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM private.booking_otps WHERE booking_id = NEW.id;
    DELETE FROM public.booking_otp_attempts WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_purge_closed_otps ON public.bookings;
CREATE TRIGGER bookings_purge_closed_otps
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.purge_closed_booking_otps();

REVOKE ALL ON FUNCTION public.purge_closed_booking_otps() FROM PUBLIC, anon, authenticated;


-- This row-sync trigger uses only NEW/OLD fields. An empty search_path avoids
-- mutable schema resolution without changing its behavior.
CREATE OR REPLACE FUNCTION public.sync_booking_cargo_weight_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.cargo_weight IS DISTINCT FROM OLD.cargo_weight
     AND NEW.cargo_weight_kg IS NOT DISTINCT FROM OLD.cargo_weight_kg THEN
    NEW.cargo_weight_kg := NEW.cargo_weight;
  ELSIF NEW.cargo_weight_kg IS DISTINCT FROM OLD.cargo_weight_kg
     AND NEW.cargo_weight IS NOT DISTINCT FROM OLD.cargo_weight THEN
    NEW.cargo_weight := NEW.cargo_weight_kg;
  ELSIF NEW.cargo_weight IS NOT NULL AND NEW.cargo_weight_kg IS NULL THEN
    NEW.cargo_weight_kg := NEW.cargo_weight;
  ELSIF NEW.cargo_weight_kg IS NOT NULL AND NEW.cargo_weight IS NULL THEN
    NEW.cargo_weight := NEW.cargo_weight_kg;
  END IF;
  RETURN NEW;
END;
$$;

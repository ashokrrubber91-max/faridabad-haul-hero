-- Repair missing vehicle-domain tables and tighten dispatch/booking safety.
-- Additive schema only; no existing bookings, wallet balances, or user records are deleted.

-- 1) Restore the vehicle catalogue expected by booking, driver and WhatsApp flows.
CREATE TABLE IF NOT EXISTS public.vehicle_types (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{3,40}$'),
  label text NOT NULL CHECK (btrim(label) <> ''),
  capacity_label text NOT NULL DEFAULT '',
  weight_limit_kg integer CHECK (weight_limit_kg IS NULL OR weight_limit_kg > 0),
  load_area text NOT NULL DEFAULT '',
  good_for text[] NOT NULL DEFAULT '{}',
  image_url text,
  base_fare numeric NOT NULL DEFAULT 0 CHECK (base_fare >= 0 AND base_fare <= 100000),
  per_km_fare numeric NOT NULL DEFAULT 0 CHECK (per_km_fare >= 0 AND per_km_fare <= 10000),
  free_loading_minutes integer NOT NULL DEFAULT 60 CHECK (free_loading_minutes BETWEEN 0 AND 480),
  free_unloading_minutes integer NOT NULL DEFAULT 30 CHECK (free_unloading_minutes BETWEEN 0 AND 480),
  overtime_rate_per_min numeric NOT NULL DEFAULT 2 CHECK (overtime_rate_per_min BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  length_ft numeric,
  width_ft numeric,
  height_ft numeric,
  payload_kg integer CHECK (payload_kg IS NULL OR payload_kg > 0),
  spec_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_types FROM anon, authenticated;
GRANT SELECT ON public.vehicle_types TO anon, authenticated;
GRANT ALL ON public.vehicle_types TO service_role;
DROP POLICY IF EXISTS "Vehicle catalogue is readable" ON public.vehicle_types;
CREATE POLICY "Vehicle catalogue is readable"
  ON public.vehicle_types FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS vehicle_types_active_sort_idx
  ON public.vehicle_types(active, sort_order);

INSERT INTO public.vehicle_types
  (id,label,capacity_label,weight_limit_kg,load_area,good_for,base_fare,per_km_fare,
   free_loading_minutes,free_unloading_minutes,overtime_rate_per_min,active,sort_order)
VALUES
  ('tata_ace','Tata Ace (Chhota Hathi)','750 kg',750,'6.5 x 4.5 ft open bed',
   ARRAY['Small household shifting','Boxes & cartons','Appliances'],150,22,90,45,2,true,10),
  ('pickup_8ft','Pickup 8ft','1.2 ton',1200,'8 x 5 ft open bed',
   ARRAY['Furniture','Construction material','Multi-room shifting'],220,28,60,30,2,true,20),
  ('tata_407','Tata 407','2.5 ton',2500,'9 x 5.5 ft closed body',
   ARRAY['Bulk goods','Commercial cargo','Office relocation'],350,38,60,30,2,true,30),
  ('bike_delivery','Bike Delivery','20 kg',20,'Rear carrier + delivery bag',
   ARRAY['Documents','Food & parcels','Small urgent items'],40,9,15,10,1,false,5)
ON CONFLICT (id) DO NOTHING;

-- 2) Restore the driver operational profile table expected by the app.
CREATE TABLE IF NOT EXISTS public.driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  vehicle_type text REFERENCES public.vehicle_types(id) ON DELETE SET NULL,
  vehicle_number text,
  payout_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_profiles_vehicle_number_len
    CHECK (vehicle_number IS NULL OR length(btrim(vehicle_number)) BETWEEN 4 AND 20)
);
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_profiles FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.driver_profiles TO authenticated;
GRANT ALL ON public.driver_profiles TO service_role;
DROP POLICY IF EXISTS "driver_profiles_own_select" ON public.driver_profiles;
CREATE POLICY "driver_profiles_own_select" ON public.driver_profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.has_role((SELECT auth.uid()),'admin'::public.app_role)));
DROP POLICY IF EXISTS "driver_profiles_own_update" ON public.driver_profiles;
CREATE POLICY "driver_profiles_own_update" ON public.driver_profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE OR REPLACE FUNCTION public.driver_profiles_protect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payout_hold IS DISTINCT FROM OLD.payout_hold
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only administrators can change payout hold';
  END IF;
  NEW.user_id := OLD.user_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS driver_profiles_protect ON public.driver_profiles;
CREATE TRIGGER driver_profiles_protect
  BEFORE UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.driver_profiles_protect();
DROP TRIGGER IF EXISTS driver_profiles_touch ON public.driver_profiles;
CREATE TRIGGER driver_profiles_touch
  BEFORE UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill profile rows without overwriting any existing operational settings.
INSERT INTO public.driver_profiles(user_id, vehicle_type, vehicle_number)
SELECT k.driver_id,
       CASE WHEN EXISTS (SELECT 1 FROM public.vehicle_types v WHERE v.id=k.vehicle_id)
            THEN k.vehicle_id ELSE NULL END,
       NULLIF(btrim(COALESCE(k.vehicle_number,'')),'')
FROM public.driver_kyc k
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.driver_profiles(user_id)
SELECT ur.user_id FROM public.user_roles ur
WHERE ur.role='driver'::public.app_role
ON CONFLICT (user_id) DO NOTHING;

-- Keep verified vehicle data synchronized from the KYC record.
CREATE OR REPLACE FUNCTION public.sync_driver_profile_vehicle_from_kyc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_vehicle_type text;
BEGIN
  SELECT v.id INTO v_vehicle_type
  FROM public.vehicle_types v
  WHERE v.id = NEW.vehicle_id AND v.active IS TRUE;

  INSERT INTO public.driver_profiles(user_id, vehicle_type, vehicle_number)
  VALUES (NEW.driver_id, v_vehicle_type, NULLIF(btrim(COALESCE(NEW.vehicle_number,'')), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET vehicle_type = COALESCE(EXCLUDED.vehicle_type, public.driver_profiles.vehicle_type),
        vehicle_number = COALESCE(EXCLUDED.vehicle_number, public.driver_profiles.vehicle_number),
        updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_driver_profile_vehicle_from_kyc ON public.driver_kyc;
CREATE TRIGGER sync_driver_profile_vehicle_from_kyc
  AFTER INSERT OR UPDATE OF vehicle_id, vehicle_number ON public.driver_kyc
  FOR EACH ROW EXECUTE FUNCTION public.sync_driver_profile_vehicle_from_kyc();

-- 3) Enforce vehicle compatibility inside the database dispatch decision.
-- The profile value wins when it is a valid active catalogue item; otherwise
-- fall back to the approved KYC vehicle_id, matching the client resolver.
CREATE OR REPLACE FUNCTION public.dispatch_next_driver(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  next_driver uuid;
  next_seq integer;
  dist numeric;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR b.status<>'pending' OR b.driver_id IS NOT NULL OR b.cancelled_at IS NOT NULL
     OR (b.payment_method<>'cod' AND b.payment_status<>'paid') THEN
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
  JOIN public.user_roles ur
    ON ur.user_id=dl.driver_id AND ur.role='driver'::public.app_role
  WHERE p.is_online IS TRUE
    AND p.kyc_status='approved'::public.kyc_status
    AND (p.service_zone IS NULL OR p.service_zone=b.service_zone)
    AND dl.updated_at>=now()-interval '90 seconds'
    AND b.pickup_lat IS NOT NULL AND b.pickup_lng IS NOT NULL
    AND ST_DWithin(dl.location_geog,
      ST_SetSRID(ST_MakePoint(b.pickup_lng,b.pickup_lat),4326)::geography,7000)
    AND COALESCE(
      (SELECT dp.vehicle_type
         FROM public.driver_profiles dp
         JOIN public.vehicle_types vt ON vt.id=dp.vehicle_type AND vt.active IS TRUE
        WHERE dp.user_id=dl.driver_id),
      (SELECT dk.vehicle_id
         FROM public.driver_kyc dk
         JOIN public.vehicle_types vt ON vt.id=dk.vehicle_id AND vt.active IS TRUE
        WHERE dk.driver_id=dl.driver_id
          AND dk.status='approved'::public.kyc_status
        ORDER BY dk.updated_at DESC
        LIMIT 1)
    ) = b.vehicle_type::text
    AND NOT EXISTS (
      SELECT 1 FROM public.driver_booking_passes x
      WHERE x.booking_id=_booking_id AND x.driver_id=dl.driver_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.booking_dispatch_offers x
      WHERE x.booking_id=_booking_id AND x.driver_id=dl.driver_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings active
      WHERE active.driver_id=dl.driver_id
        AND active.status IN ('accepted','in_progress')
        AND active.cancelled_at IS NULL
    )
  ORDER BY
    ST_Distance(dl.location_geog,
      ST_SetSRID(ST_MakePoint(b.pickup_lng,b.pickup_lat),4326)::geography) ASC,
    (SELECT count(*) FROM public.bookings done
      WHERE done.driver_id=dl.driver_id AND done.status='completed') DESC,
    dl.updated_at DESC
  LIMIT 1;

  IF next_driver IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.booking_dispatch_offers
    (booking_id,driver_id,sequence_no,status,offered_at,expires_at,distance_km)
  VALUES (_booking_id,next_driver,next_seq,'offered',now(),now()+interval '20 seconds',dist)
  ON CONFLICT (booking_id,driver_id) DO NOTHING;

  INSERT INTO public.notifications(user_id,title,body,kind)
  VALUES (next_driver,'New MiniPort ride request',
    'You have 20 seconds to accept a nearby ride. Pickup: '||b.pickup_address||
    ' → Drop: '||b.drop_address||'. Fare ₹'||round(b.fare)::text,
    'driver_ride_offer');
  RETURN next_driver;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_next_driver(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_next_driver(uuid) TO service_role;

-- 4) Pending ride rows must not be directly selectable by every eligible driver:
-- the secure RPC returns only the driver's active offer and strips OTPs/phone.
DROP POLICY IF EXISTS "Drivers can view searching rides" ON public.bookings;

-- The old driver_wallets table is unused by the app; keep access service-only.
REVOKE ALL ON TABLE public.driver_wallets FROM anon, authenticated;

-- 5) Remove duplicate triggers which double-debited coins, double-awarded
-- completion coins/earnings, duplicated SMS queue entries and regenerated OTPs.
DROP TRIGGER IF EXISTS trg_bookings_debit_coins ON public.bookings;
DROP TRIGGER IF EXISTS zz_bookings_award_coins ON public.bookings;
DROP TRIGGER IF EXISTS trg_bookings_generate_otps ON public.bookings;
DROP TRIGGER IF EXISTS zzz_bookings_enqueue_sms ON public.bookings;
DROP TRIGGER IF EXISTS bookings_touch_updated_at ON public.bookings;

-- 6) Search-path hardening and missing foreign-key indexes.
ALTER FUNCTION public.sync_booking_cargo_weight_columns() SET search_path = public;
CREATE INDEX IF NOT EXISTS booking_messages_sender_id_idx
  ON public.booking_messages(sender_id);
CREATE INDEX IF NOT EXISTS scheduled_booking_reminders_customer_id_idx
  ON public.scheduled_booking_reminders(customer_id);
CREATE INDEX IF NOT EXISTS trip_issues_resolved_by_idx
  ON public.trip_issues(resolved_by);

NOTIFY pgrst, 'reload schema';

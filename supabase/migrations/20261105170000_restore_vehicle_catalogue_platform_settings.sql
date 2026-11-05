-- Restore the vehicle catalogue and platform settings expected by the current app.
-- This is a forward-only schema/configuration repair. It does not touch customer,
-- booking, wallet, referral or payment records.
BEGIN;

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
  free_loading_minutes integer NOT NULL DEFAULT 60 CHECK (free_loading_minutes >= 0 AND free_loading_minutes <= 480),
  free_unloading_minutes integer NOT NULL DEFAULT 30 CHECK (free_unloading_minutes >= 0 AND free_unloading_minutes <= 480),
  overtime_rate_per_min numeric NOT NULL DEFAULT 2 CHECK (overtime_rate_per_min >= 0 AND overtime_rate_per_min <= 100),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  length_ft numeric,
  width_ft numeric,
  height_ft numeric,
  payload_kg integer,
  spec_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_types
  ADD COLUMN IF NOT EXISTS length_ft numeric,
  ADD COLUMN IF NOT EXISTS width_ft numeric,
  ADD COLUMN IF NOT EXISTS height_ft numeric,
  ADD COLUMN IF NOT EXISTS payload_kg integer,
  ADD COLUMN IF NOT EXISTS spec_notes text,
  ADD COLUMN IF NOT EXISTS weight_limit_kg integer,
  ADD COLUMN IF NOT EXISTS load_area text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS good_for text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS base_fare numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_km_fare numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_loading_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS free_unloading_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS overtime_rate_per_min numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

GRANT SELECT ON public.vehicle_types TO anon, authenticated;
GRANT ALL ON public.vehicle_types TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.vehicle_types FROM anon, authenticated;
ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Vehicle catalogue is readable" ON public.vehicle_types;
CREATE POLICY "Vehicle catalogue is readable" ON public.vehicle_types FOR SELECT USING (true);

DROP TRIGGER IF EXISTS vehicle_types_touch ON public.vehicle_types;
CREATE TRIGGER vehicle_types_touch BEFORE UPDATE ON public.vehicle_types
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed only missing catalogue rows; existing configured rates are preserved.
INSERT INTO public.vehicle_types
  (id, label, capacity_label, weight_limit_kg, payload_kg, load_area, good_for,
   base_fare, per_km_fare, free_loading_minutes, free_unloading_minutes,
   overtime_rate_per_min, active, sort_order)
VALUES
  ('tata_ace', 'Tata Ace (Chhota Hathi)', '750 kg', 750, 750, '6.5 x 4.5 ft open bed',
   ARRAY['Small household shifting','Boxes & cartons','Appliances'], 150, 22, 90, 45, 2, true, 10),
  ('pickup_8ft', 'Pickup 8ft', '1.2 ton', 1200, 1200, '8 x 5 ft open bed',
   ARRAY['Furniture','Construction material','Multi-room shifting'], 220, 28, 60, 30, 2, true, 20),
  ('tata_407', 'Tata 407', '2.5 ton', 2500, 2500, '9 x 5.5 ft closed body',
   ARRAY['Bulk goods','Commercial cargo','Office relocation'], 350, 38, 60, 30, 2, true, 30),
  ('bike_delivery', 'Bike Delivery', '20 kg', 20, 20, 'Rear carrier + delivery bag',
   ARRAY['Documents','Food & parcels','Small urgent items'], 40, 9, 15, 10, 1, false, 5)
ON CONFLICT (id) DO NOTHING;

-- The generated app types already model bookings.vehicle_type as text.
-- Convert the live enum column to the catalogue key and add the FK.
ALTER TABLE public.bookings
  ALTER COLUMN vehicle_type TYPE text USING vehicle_type::text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass AND conname = 'bookings_vehicle_type_fkey'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_vehicle_type_fkey
      FOREIGN KEY (vehicle_type) REFERENCES public.vehicle_types(id) NOT VALID;
  END IF;
END;
$$;
ALTER TABLE public.bookings VALIDATE CONSTRAINT bookings_vehicle_type_fkey;

CREATE INDEX IF NOT EXISTS vehicle_types_active_sort_idx ON public.vehicle_types (active, sort_order);

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  commission_rate numeric NOT NULL DEFAULT 0.10 CHECK (commission_rate >= 0 AND commission_rate <= 0.50),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.platform_settings FROM anon, authenticated;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Settings readable by signed-in users" ON public.platform_settings;
CREATE POLICY "Settings readable by signed-in users" ON public.platform_settings
  FOR SELECT TO authenticated USING (true);
INSERT INTO public.platform_settings (id, commission_rate) VALUES (true, 0.10)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS platform_settings_touch ON public.platform_settings;
CREATE TRIGGER platform_settings_touch BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle_type(
  _id text, _label text, _capacity_label text, _weight_limit_kg integer, _load_area text,
  _good_for text[], _base_fare numeric, _per_km_fare numeric,
  _free_loading_minutes integer, _free_unloading_minutes integer,
  _overtime_rate_per_min numeric, _active boolean, _sort_order integer, _image_url text,
  _length_ft numeric DEFAULT NULL, _width_ft numeric DEFAULT NULL, _height_ft numeric DEFAULT NULL,
  _payload_kg integer DEFAULT NULL, _spec_notes text DEFAULT NULL
)
RETURNS public.vehicle_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.vehicle_types;
  clean_id text := lower(btrim(COALESCE(_id, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can change the vehicle catalogue';
  END IF;
  IF clean_id !~ '^[a-z0-9_]{3,40}$' OR btrim(COALESCE(_label, '')) = '' THEN
    RAISE EXCEPTION 'Enter a valid vehicle id and name';
  END IF;
  IF COALESCE(_base_fare, -1) < 0 OR COALESCE(_per_km_fare, -1) < 0
     OR COALESCE(_overtime_rate_per_min, -1) < 0
     OR COALESCE(_free_loading_minutes, -1) < 0
     OR COALESCE(_free_unloading_minutes, -1) < 0
     OR COALESCE(_weight_limit_kg, 0) < 0
     OR COALESCE(_payload_kg, 0) < 0
     OR COALESCE(_length_ft, 0) < 0 OR COALESCE(_width_ft, 0) < 0 OR COALESCE(_height_ft, 0) < 0 THEN
    RAISE EXCEPTION 'Vehicle capacity, dimensions, minutes and fares must not be negative';
  END IF;

  INSERT INTO public.vehicle_types AS vt (
    id, label, capacity_label, weight_limit_kg, load_area, good_for, image_url,
    base_fare, per_km_fare, free_loading_minutes, free_unloading_minutes,
    overtime_rate_per_min, active, sort_order, length_ft, width_ft, height_ft, payload_kg, spec_notes
  ) VALUES (
    clean_id, btrim(_label), COALESCE(btrim(_capacity_label), ''),
    NULLIF(_weight_limit_kg, 0), COALESCE(btrim(_load_area), ''),
    COALESCE(_good_for, '{}'::text[]), NULLIF(btrim(COALESCE(_image_url, '')), ''),
    _base_fare, _per_km_fare, _free_loading_minutes, _free_unloading_minutes,
    _overtime_rate_per_min, COALESCE(_active, true), COALESCE(_sort_order, 100),
    _length_ft, _width_ft, _height_ft, _payload_kg, NULLIF(btrim(COALESCE(_spec_notes, '')), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    label = EXCLUDED.label, capacity_label = EXCLUDED.capacity_label,
    weight_limit_kg = EXCLUDED.weight_limit_kg, load_area = EXCLUDED.load_area,
    good_for = EXCLUDED.good_for, image_url = COALESCE(EXCLUDED.image_url, vt.image_url),
    base_fare = EXCLUDED.base_fare, per_km_fare = EXCLUDED.per_km_fare,
    free_loading_minutes = EXCLUDED.free_loading_minutes, free_unloading_minutes = EXCLUDED.free_unloading_minutes,
    overtime_rate_per_min = EXCLUDED.overtime_rate_per_min, active = EXCLUDED.active,
    sort_order = EXCLUDED.sort_order, length_ft = EXCLUDED.length_ft, width_ft = EXCLUDED.width_ft,
    height_ft = EXCLUDED.height_ft, payload_kg = EXCLUDED.payload_kg, spec_notes = EXCLUDED.spec_notes,
    updated_at = now()
  RETURNING * INTO v;

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_upsert_vehicle_type', 'vehicle_types', NULL, to_jsonb(v));
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_upsert_vehicle_type(text,text,text,integer,text,text[],numeric,numeric,integer,integer,numeric,boolean,integer,text,numeric,numeric,numeric,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle_type(text,text,text,integer,text,text[],numeric,numeric,integer,integer,numeric,boolean,integer,text,numeric,numeric,numeric,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_vehicle_active(_id text, _active boolean)
RETURNS public.vehicle_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v public.vehicle_types;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can change the vehicle catalogue';
  END IF;
  UPDATE public.vehicle_types SET active = COALESCE(_active, true), updated_at = now()
   WHERE id = _id RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_set_vehicle_active', 'vehicle_types', NULL, to_jsonb(v));
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_vehicle_active(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_vehicle_active(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_commission_rate(_rate numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can change the commission rate';
  END IF;
  IF _rate IS NULL OR _rate < 0 OR _rate > 0.50 THEN
    RAISE EXCEPTION 'Commission must be between 0 and 50 percent';
  END IF;
  UPDATE public.platform_settings SET commission_rate = _rate, updated_by = auth.uid(), updated_at = now()
   WHERE id RETURNING commission_rate INTO v;
  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_set_commission_rate', 'platform_settings', NULL, jsonb_build_object('commission_rate', v));
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_commission_rate(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_commission_rate(numeric) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

ALTER TABLE public.vehicle_types
  ADD COLUMN IF NOT EXISTS length_ft numeric,
  ADD COLUMN IF NOT EXISTS width_ft numeric,
  ADD COLUMN IF NOT EXISTS height_ft numeric,
  ADD COLUMN IF NOT EXISTS payload_kg integer,
  ADD COLUMN IF NOT EXISTS spec_notes text;

CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle_type(
  _id text,
  _label text,
  _capacity_label text,
  _weight_limit_kg integer,
  _load_area text,
  _good_for text[],
  _base_fare numeric,
  _per_km_fare numeric,
  _free_loading_minutes integer,
  _free_unloading_minutes integer,
  _overtime_rate_per_min numeric,
  _active boolean,
  _sort_order integer,
  _image_url text,
  _length_ft numeric DEFAULT NULL,
  _width_ft numeric DEFAULT NULL,
  _height_ft numeric DEFAULT NULL,
  _payload_kg integer DEFAULT NULL,
  _spec_notes text DEFAULT NULL
)
RETURNS vehicle_types
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row public.vehicle_types;
  _clean_id text := lower(btrim(_id));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the operations team can change the vehicle catalogue';
  END IF;
  IF _clean_id !~ '^[a-z0-9_]{2,40}$' THEN
    RAISE EXCEPTION 'Vehicle id must be 2-40 characters of lowercase letters, numbers or underscores';
  END IF;
  IF length(btrim(coalesce(_label, ''))) < 2 THEN
    RAISE EXCEPTION 'Add a vehicle name';
  END IF;
  IF _base_fare < 0 OR _per_km_fare < 0 OR _overtime_rate_per_min < 0 THEN
    RAISE EXCEPTION 'Fares cannot be negative';
  END IF;
  IF _free_loading_minutes < 0 OR _free_unloading_minutes < 0 THEN
    RAISE EXCEPTION 'Free minutes cannot be negative';
  END IF;
  IF coalesce(_length_ft, 0) < 0 OR coalesce(_width_ft, 0) < 0 OR coalesce(_height_ft, 0) < 0
     OR coalesce(_payload_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Vehicle specifications cannot be negative';
  END IF;

  INSERT INTO public.vehicle_types AS vt (
    id, label, capacity_label, weight_limit_kg, load_area, good_for, image_url,
    base_fare, per_km_fare, free_loading_minutes, free_unloading_minutes,
    overtime_rate_per_min, active, sort_order,
    length_ft, width_ft, height_ft, payload_kg, spec_notes
  ) VALUES (
    _clean_id, btrim(_label), btrim(coalesce(_capacity_label, '')),
    nullif(_weight_limit_kg, 0), btrim(coalesce(_load_area, '')),
    coalesce(_good_for, '{}'::text[]), nullif(btrim(coalesce(_image_url, '')), ''),
    _base_fare, _per_km_fare, _free_loading_minutes, _free_unloading_minutes,
    _overtime_rate_per_min, coalesce(_active, true), coalesce(_sort_order, 100),
    _length_ft, _width_ft, _height_ft, _payload_kg,
    nullif(btrim(coalesce(_spec_notes, '')), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    label = excluded.label,
    capacity_label = excluded.capacity_label,
    weight_limit_kg = excluded.weight_limit_kg,
    load_area = excluded.load_area,
    good_for = excluded.good_for,
    image_url = coalesce(excluded.image_url, vt.image_url),
    base_fare = excluded.base_fare,
    per_km_fare = excluded.per_km_fare,
    free_loading_minutes = excluded.free_loading_minutes,
    free_unloading_minutes = excluded.free_unloading_minutes,
    overtime_rate_per_min = excluded.overtime_rate_per_min,
    active = excluded.active,
    sort_order = excluded.sort_order,
    length_ft = excluded.length_ft,
    width_ft = excluded.width_ft,
    height_ft = excluded.height_ft,
    payload_kg = excluded.payload_kg,
    spec_notes = excluded.spec_notes,
    updated_at = now()
  RETURNING * INTO _row;

  INSERT INTO public.audit_logs (actor_id, action, table_name, row_id, new_data)
  VALUES (auth.uid(), 'admin_upsert_vehicle_type', 'vehicle_types', NULL,
          to_jsonb(_row));

  RETURN _row;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_upsert_vehicle_type(text,text,text,integer,text,text[],numeric,numeric,integer,integer,numeric,boolean,integer,text,numeric,numeric,numeric,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle_type(text,text,text,integer,text,text[],numeric,numeric,integer,integer,numeric,boolean,integer,text,numeric,numeric,numeric,integer,text) TO authenticated;
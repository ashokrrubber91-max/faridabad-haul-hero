CREATE TABLE IF NOT EXISTS public.booking_share_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.booking_share_links TO authenticated;
GRANT ALL ON public.booking_share_links TO service_role;

ALTER TABLE public.booking_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Trip participants manage their share links" ON public.booking_share_links;
CREATE POLICY "Trip participants manage their share links"
ON public.booking_share_links
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.id = booking_share_links.booking_id
       AND (b.customer_id = auth.uid() OR b.driver_id = auth.uid())
  )
)
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.id = booking_share_links.booking_id
       AND (b.customer_id = auth.uid() OR b.driver_id = auth.uid())
  )
);

CREATE INDEX IF NOT EXISTS booking_share_links_booking_idx
  ON public.booking_share_links (booking_id);

-- Create (or reuse) a live link for a trip the caller is part of.
CREATE OR REPLACE FUNCTION public.create_booking_share_link(_booking_id uuid)
RETURNS booking_share_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.booking_share_links;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.id = _booking_id AND (b.customer_id = _uid OR b.driver_id = _uid)
  ) THEN
    RAISE EXCEPTION 'You can only share your own trip';
  END IF;

  SELECT * INTO _row
    FROM public.booking_share_links
   WHERE booking_id = _booking_id
     AND created_by = _uid
     AND revoked_at IS NULL
     AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1;

  IF _row.id IS NOT NULL THEN RETURN _row; END IF;

  INSERT INTO public.booking_share_links (booking_id, token, created_by)
  VALUES (_booking_id, encode(gen_random_bytes(24), 'hex'), _uid)
  RETURNING * INTO _row;

  RETURN _row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_booking_share_links(_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _n integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  UPDATE public.booking_share_links l
     SET revoked_at = now()
   WHERE l.booking_id = _booking_id
     AND l.revoked_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.bookings b
        WHERE b.id = l.booking_id AND (b.customer_id = _uid OR b.driver_id = _uid)
     );
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

-- Public, read-only resolver: safe fields only, no phones, codes or fare breakdown.
CREATE OR REPLACE FUNCTION public.shared_trip_view(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _link public.booking_share_links;
  _b public.bookings;
  _driver_name text;
  _vehicle_number text;
  _loc record;
BEGIN
  SELECT * INTO _link FROM public.booking_share_links WHERE token = _token;
  IF _link.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF _link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revoked');
  END IF;
  IF _link.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT * INTO _b FROM public.bookings WHERE id = _link.booking_id;
  IF _b.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF _b.driver_id IS NOT NULL THEN
    SELECT split_part(btrim(p.name), ' ', 1) INTO _driver_name
      FROM public.profiles p WHERE p.id = _b.driver_id;
    SELECT k.vehicle_number INTO _vehicle_number
      FROM public.driver_kyc k WHERE k.driver_id = _b.driver_id;
    SELECT latitude, longitude, updated_at INTO _loc
      FROM public.driver_locations WHERE driver_id = _b.driver_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', _b.status,
    'pickup_address', _b.pickup_address,
    'drop_address', _b.drop_address,
    'pickup', jsonb_build_object('lat', _b.pickup_lat, 'lng', _b.pickup_lng),
    'drop', jsonb_build_object('lat', _b.drop_lat, 'lng', _b.drop_lng),
    'distance_km', _b.distance_km,
    'vehicle_label', (SELECT label FROM public.vehicle_types WHERE id = _b.vehicle_type),
    'driver_first_name', _driver_name,
    'vehicle_number', _vehicle_number,
    'driver_location', CASE
      WHEN _loc.latitude IS NULL THEN NULL
      ELSE jsonb_build_object('lat', _loc.latitude, 'lng', _loc.longitude, 'updated_at', _loc.updated_at)
    END,
    'created_at', _b.created_at,
    'expires_at', _link.expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_share_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking_share_link(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_booking_share_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_booking_share_links(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.shared_trip_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shared_trip_view(text) TO anon, authenticated, service_role;
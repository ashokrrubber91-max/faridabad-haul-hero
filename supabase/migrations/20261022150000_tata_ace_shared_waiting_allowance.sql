-- Shared Tata Ace (750 kg) waiting allowance: 70 min loading + 20 min unloading.
-- This migration changes calculation logic only; it does not update existing booking rows
-- or vehicle catalogue records.
CREATE OR REPLACE FUNCTION public.booking_overtime(_booking public.bookings)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  fl int;
  fu int;
  rate numeric;
  l_min int := 0;
  u_min int := 0;
  l_ot int := 0;
  u_ot int := 0;
  total_min int := 0;
  free_total int;
  loading_base_free int;
  unloading_free int;
BEGIN
  SELECT free_loading_minutes, free_unloading_minutes, overtime_rate_per_min
    INTO fl, fu, rate
  FROM public.vehicle_types
  WHERE id = _booking.vehicle_type;

  fl := COALESCE(fl, 70);
  fu := COALESCE(fu, 20);
  rate := COALESCE(rate, 2);

  IF _booking.loading_started_at IS NOT NULL THEN
    l_min := GREATEST(0, ceil(extract(epoch FROM
      (COALESCE(_booking.loading_stopped_at, now()) - _booking.loading_started_at)) / 60.0)::int);
  END IF;

  IF _booking.unloading_started_at IS NOT NULL THEN
    u_min := GREATEST(0, ceil(extract(epoch FROM
      (COALESCE(_booking.unloading_stopped_at, now()) - _booking.unloading_started_at)) / 60.0)::int);
  END IF;

  IF _booking.vehicle_type = 'tata_ace' THEN
    loading_base_free := 70;
    free_total := 90;
    unloading_free := 20 + GREATEST(0, loading_base_free - l_min);
    total_min := l_min + u_min;

    -- Charge only for combined time above 90 minutes. Unused loading time
    -- carries into unloading; no charge is calculated independently per stage.
    IF total_min > free_total THEN
      l_ot := LEAST(GREATEST(0, l_min - loading_base_free), total_min - free_total);
      u_ot := GREATEST(0, (total_min - free_total) - l_ot);
    END IF;
  ELSE
    unloading_free := fu;
    l_ot := GREATEST(0, l_min - fl);
    u_ot := GREATEST(0, u_min - fu);
  END IF;

  RETURN jsonb_build_object(
    'free_loading_minutes', CASE WHEN _booking.vehicle_type = 'tata_ace' THEN 70 ELSE fl END,
    'free_unloading_minutes', CASE WHEN _booking.vehicle_type = 'tata_ace' THEN unloading_free ELSE fu END,
    'free_total_minutes', CASE WHEN _booking.vehicle_type = 'tata_ace' THEN 90 ELSE fl + fu END,
    'rate_per_min', rate,
    'loading_minutes', l_min,
    'unloading_minutes', u_min,
    'loading_overtime_minutes', l_ot,
    'unloading_overtime_minutes', u_ot,
    'overtime_charge', round((l_ot + u_ot) * rate)
  );
END
$function$;

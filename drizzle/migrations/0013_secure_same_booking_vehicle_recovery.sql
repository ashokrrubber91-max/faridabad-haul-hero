DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.bookings_protect_financials()'::regprocedure) INTO definition;
  IF position('NEW.vehicle_type := OLD.vehicle_type;' in definition) > 0 THEN
    definition := replace(definition, 'NEW.vehicle_type := OLD.vehicle_type;', 'IF NOT (trusted AND current_setting(''miniport.vehicle_recovery'', true) = ''on'') THEN NEW.vehicle_type := OLD.vehicle_type; END IF;');
    EXECUTE definition;
  ELSIF position('miniport.vehicle_recovery' in definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected financial protection function; recovery not installed';
  END IF;
END $migration$;
CREATE OR REPLACE FUNCTION public.change_searching_booking_vehicle(_booking_id uuid, _vehicle_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE b public.bookings; v public.vehicle_types; next_fare numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id AND customer_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF b.status <> 'pending' OR b.driver_id IS NOT NULL OR b.cancelled_at IS NOT NULL OR b.expires_at <= now() THEN RAISE EXCEPTION 'Vehicle can only change while this ride is searching'; END IF;
  IF b.payment_status <> 'pending' OR b.payment_method <> 'cod'
     OR COALESCE(b.coupon_discount,0)>0 OR b.coupon_code IS NOT NULL OR COALESCE(b.coins_redeemed,0)>0
     OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id=b.id)
     OR EXISTS (SELECT 1 FROM public.wallet_transactions w WHERE w.booking_id=b.id AND w.delta<0) THEN
    RAISE EXCEPTION 'Vehicle change is locked for paid, discounted or wallet-funded rides; keep this booking or contact support';
  END IF;
  SELECT * INTO v FROM public.vehicle_types WHERE id::text=_vehicle_type AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle is unavailable'; END IF;
  IF b.cargo_weight_kg IS NOT NULL AND COALESCE(v.payload_kg,v.weight_limit_kg) IS NOT NULL AND b.cargo_weight_kg>COALESCE(v.payload_kg,v.weight_limit_kg) THEN RAISE EXCEPTION 'Cargo exceeds this vehicle capacity'; END IF;
  IF COALESCE(b.helper_count,0)>0 AND COALESCE(v.weight_limit_kg,0)<=20 THEN RAISE EXCEPTION 'Choose a vehicle that supports your helpers'; END IF;
  IF b.vehicle_type::text=_vehicle_type THEN RETURN jsonb_build_object('id',b.id,'fare',b.fare,'vehicle_type',b.vehicle_type); END IF;
  next_fare := round(v.base_fare + v.per_km_fare*COALESCE(b.distance_km,0) + COALESCE(b.helper_fee,0) + GREATEST(COALESCE(b.total_stops,1)-1,0)*50) + COALESCE(b.fare_boost,0);
  PERFORM set_config('miniport.trusted_write','on',true);
  PERFORM set_config('miniport.vehicle_recovery','on',true);
  UPDATE public.bookings SET vehicle_type=v.id, fare=next_fare, final_fare=NULL, updated_at=now() WHERE id=b.id RETURNING * INTO b;
  PERFORM set_config('miniport.vehicle_recovery','off',true);
  PERFORM set_config('miniport.trusted_write','off',true);
  RETURN jsonb_build_object('id',b.id,'fare',b.fare,'vehicle_type',b.vehicle_type);
END $function$;
REVOKE ALL ON FUNCTION public.change_searching_booking_vehicle(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_searching_booking_vehicle(uuid,text) TO authenticated;
COMMENT ON FUNCTION public.change_searching_booking_vehicle(uuid,text) IS 'Customer-owned, row-locked searching recovery. Preserves route, stops, helpers, booking ID; rejects secured or discounted payment states.';
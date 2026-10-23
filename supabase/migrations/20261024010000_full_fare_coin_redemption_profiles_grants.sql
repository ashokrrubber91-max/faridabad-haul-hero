-- Restore safe self-service profile access and allow full-fare MiniPort Coin redemption.
-- No existing user or booking data is modified.
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS "Profiles: read own or admin" ON public.profiles;
CREATE POLICY "Profiles: read own or admin"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Profiles: update own safe fields" ON public.profiles;
CREATE POLICY "Profiles: update own safe fields"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.bookings_enforce_insert_financials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  base numeric; per_km numeric; gross numeric; disc numeric := 0; cpn record;
  coin_cap numeric; bal numeric; v_weight integer; helper_count_safe smallint;
  helper_fee_safe numeric; stop_fee numeric; stop_count integer;
BEGIN
  IF NEW.expires_at IS NULL THEN NEW.expires_at := now() + interval '30 minutes'; END IF;
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.customer_id <> auth.uid() THEN RAISE EXCEPTION 'You can only book for your own account'; END IF;
  NEW.status := 'pending'::public.booking_status;
  NEW.payment_status := 'pending'::public.payment_status;
  SELECT s.commission_rate INTO NEW.commission_rate FROM public.platform_settings s WHERE s.id;
  NEW.commission_rate := coalesce(NEW.commission_rate, 0.10);
  NEW.commission_amount := 0; NEW.driver_net_earning := 0; NEW.driver_id := NULL;
  NEW.pickup_verified_at := NULL; NEW.drop_verified_at := NULL; NEW.rating := NULL;
  NEW.review := NULL; NEW.pod_photo_url := NULL;
  SELECT v.base_fare, v.per_km_fare, v.weight_limit_kg INTO base, per_km, v_weight
    FROM public.vehicle_types v WHERE v.id::text = NEW.vehicle_type::text AND v.active;
  IF base IS NULL THEN RAISE EXCEPTION 'This vehicle is not available for booking'; END IF;
  helper_count_safe := greatest(least(coalesce(NEW.helper_count, 0), 2), 0)::smallint;
  IF coalesce(v_weight, 0) <= 20 THEN helper_count_safe := 0; END IF;
  helper_fee_safe := helper_count_safe * 250; NEW.helper_count := helper_count_safe; NEW.helper_fee := helper_fee_safe;
  NEW.distance_km := greatest(coalesce(NEW.distance_km, 0), 0);
  stop_count := greatest(least(coalesce(NEW.total_stops, 1), 4), 1);
  NEW.total_stops := stop_count; NEW.is_multi_stop := stop_count > 1;
  stop_fee := greatest(stop_count - 1, 0) * 50;
  gross := round(base + per_km * NEW.distance_km + helper_fee_safe + stop_fee);
  IF NEW.coupon_code IS NOT NULL AND btrim(NEW.coupon_code) <> '' THEN
    SELECT * INTO cpn FROM public.validate_coupon(NEW.coupon_code, gross, NEW.customer_id);
    IF cpn.message = 'ok' AND cpn.discount > 0 THEN
      NEW.coupon_code := cpn.code; NEW.coupon_discount := cpn.discount;
    ELSE NEW.coupon_code := NULL; NEW.coupon_discount := 0; END IF;
  ELSE NEW.coupon_code := NULL; NEW.coupon_discount := 0; END IF;
  SELECT coins_balance INTO bal FROM public.wallet_accounts WHERE user_id = NEW.customer_id;
  coin_cap := least(greatest(gross - coalesce(NEW.coupon_discount, 0), 0), coalesce(bal, 0));
  NEW.coins_redeemed := greatest(least(coalesce(NEW.coins_redeemed, 0), coin_cap), 0);
  disc := coalesce(NEW.coupon_discount, 0) + coalesce(NEW.coins_redeemed, 0);
  NEW.fare := greatest(gross - disc, 0);
  RETURN NEW;
END;
$function$;

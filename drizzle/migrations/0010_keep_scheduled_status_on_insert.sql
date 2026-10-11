CREATE OR REPLACE FUNCTION public.bookings_enforce_insert_financials()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  base numeric; per_km numeric; gross numeric; disc numeric := 0; cpn record;
  coin_cap numeric; bal numeric; v_weight integer;
  helper_count_safe smallint; helper_fee_safe numeric;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := COALESCE(NEW.scheduled_for, now()) + interval '30 minutes';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only book for your own account';
  END IF;

  IF NEW.scheduled_for IS NOT NULL THEN
    IF NEW.scheduled_for < now() + interval '31 minutes' OR NEW.scheduled_for > now() + interval '30 days' THEN
      RAISE EXCEPTION 'Scheduled pickup must be between 31 minutes and 30 days from now';
    END IF;
    NEW.status := 'scheduled'::booking_status;
    NEW.expires_at := NEW.scheduled_for + interval '30 minutes';
  ELSE
    NEW.status := 'pending'::booking_status;
    NEW.expires_at := now() + interval '30 minutes';
  END IF;

  NEW.payment_status := 'pending'::payment_status;
  SELECT s.commission_rate INTO NEW.commission_rate FROM public.platform_settings s WHERE s.id;
  NEW.commission_rate := COALESCE(NEW.commission_rate, 0.10);
  NEW.commission_amount := 0;
  NEW.driver_net_earning := 0;
  NEW.driver_id := NULL;
  NEW.pickup_verified_at := NULL;
  NEW.drop_verified_at := NULL;
  NEW.rating := NULL;
  NEW.review := NULL;
  NEW.pod_photo_url := NULL;

  SELECT v.base_fare, v.per_km_fare, v.weight_limit_kg INTO base, per_km, v_weight
  FROM public.vehicle_types v WHERE v.id::text = NEW.vehicle_type::text AND v.active;
  IF base IS NULL THEN
    RAISE EXCEPTION 'This vehicle is not available for booking';
  END IF;

  helper_count_safe := GREATEST(LEAST(COALESCE(NEW.helper_count, 0), 2), 0)::smallint;
  IF COALESCE(v_weight, 0) <= 20 THEN helper_count_safe := 0; END IF;
  helper_fee_safe := helper_count_safe * 250;
  NEW.helper_count := helper_count_safe;
  NEW.helper_fee := helper_fee_safe;

  NEW.distance_km := GREATEST(COALESCE(NEW.distance_km, 0), 0);
  gross := round(base + per_km * NEW.distance_km + helper_fee_safe);

  IF NEW.coupon_code IS NOT NULL AND btrim(NEW.coupon_code) <> '' THEN
    SELECT * INTO cpn FROM public.validate_coupon(NEW.coupon_code, gross, NEW.customer_id);
    IF cpn.message = 'ok' AND cpn.discount > 0 THEN
      NEW.coupon_code := cpn.code; NEW.coupon_discount := cpn.discount;
    ELSE
      NEW.coupon_code := NULL; NEW.coupon_discount := 0;
    END IF;
  ELSE
    NEW.coupon_code := NULL; NEW.coupon_discount := 0;
  END IF;

  SELECT coins_balance INTO bal FROM public.wallet_accounts WHERE user_id = NEW.customer_id;
  coin_cap := LEAST(floor(gross * 0.5), COALESCE(bal, 0));
  NEW.coins_redeemed := GREATEST(LEAST(COALESCE(NEW.coins_redeemed, 0), coin_cap), 0);
  disc := COALESCE(NEW.coupon_discount, 0) + COALESCE(NEW.coins_redeemed, 0);
  NEW.fare := GREATEST(gross - disc, 0);
  RETURN NEW;
END $function$;
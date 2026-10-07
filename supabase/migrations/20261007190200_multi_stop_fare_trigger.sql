create or replace function public.bookings_enforce_insert_financials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
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
begin
  if new.expires_at is null then
    new.expires_at := now() + interval '30 minutes';
  end if;

  if auth.uid() is null or public.has_role(auth.uid(), 'admin'::public.app_role) then
    return new;
  end if;

  if new.customer_id <> auth.uid() then
    raise exception 'You can only book for your own account';
  end if;

  new.status := 'pending'::public.booking_status;
  new.payment_status := 'pending'::public.payment_status;
  select s.commission_rate into new.commission_rate
  from public.platform_settings s where s.id;
  new.commission_rate := coalesce(new.commission_rate, 0.10);
  new.commission_amount := 0;
  new.driver_net_earning := 0;
  new.driver_id := null;
  new.pickup_verified_at := null;
  new.drop_verified_at := null;
  new.rating := null;
  new.review := null;
  new.pod_photo_url := null;

  select v.base_fare, v.per_km_fare, v.weight_limit_kg
    into base, per_km, v_weight
  from public.vehicle_types v
  where v.id::text = new.vehicle_type::text and v.active;

  if base is null then
    raise exception 'This vehicle is not available for booking';
  end if;

  helper_count_safe := greatest(least(coalesce(new.helper_count, 0), 2), 0)::smallint;
  if coalesce(v_weight, 0) <= 20 then helper_count_safe := 0; end if;
  helper_fee_safe := helper_count_safe * 250;
  new.helper_count := helper_count_safe;
  new.helper_fee := helper_fee_safe;

  new.distance_km := greatest(coalesce(new.distance_km, 0), 0);
  stop_count := greatest(least(coalesce(new.total_stops, 1), 4), 1);
  new.total_stops := stop_count;
  new.is_multi_stop := stop_count > 1;
  stop_fee := greatest(stop_count - 1, 0) * 50;
  gross := round(base + per_km * new.distance_km + helper_fee_safe + stop_fee);

  if new.coupon_code is not null and btrim(new.coupon_code) <> '' then
    select * into cpn from public.validate_coupon(new.coupon_code, gross, new.customer_id);
    if cpn.message = 'ok' and cpn.discount > 0 then
      new.coupon_code := cpn.code;
      new.coupon_discount := cpn.discount;
    else
      new.coupon_code := null;
      new.coupon_discount := 0;
    end if;
  else
    new.coupon_code := null;
    new.coupon_discount := 0;
  end if;

  select coins_balance into bal from public.wallet_accounts where user_id = new.customer_id;
  coin_cap := least(floor(gross * 0.5), coalesce(bal, 0));
  new.coins_redeemed := greatest(least(coalesce(new.coins_redeemed, 0), coin_cap), 0);
  disc := coalesce(new.coupon_discount, 0) + coalesce(new.coins_redeemed, 0);
  new.fare := greatest(gross - disc, 0);
  return new;
end;
$function$;
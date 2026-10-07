create unique index if not exists driver_daily_passes_one_active_per_driver
  on public.driver_daily_passes(driver_id)
  where status = 'active';

create or replace function public.activate_driver_daily_pass()
returns public.driver_daily_passes
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  balance numeric;
  existing_pass public.driver_daily_passes;
  row public.driver_daily_passes;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = uid and role = 'driver'
  ) then
    raise exception 'Driver only';
  end if;

  update public.driver_daily_passes
  set status = 'expired'
  where driver_id = uid
    and status = 'active'
    and ends_at <= now();

  select *
  into existing_pass
  from public.driver_daily_passes
  where driver_id = uid
    and status = 'active'
    and starts_at <= now()
    and ends_at > now()
  order by ends_at desc
  limit 1
  for update;

  if existing_pass.id is not null then
    return existing_pass;
  end if;

  select cash_balance
  into balance
  from public.wallet_accounts
  where user_id = uid
  for update;

  if coalesce(balance, 0) < 99 then
    raise exception 'Wallet balance must be at least ₹99';
  end if;

  update public.wallet_accounts
  set cash_balance = cash_balance - 99,
      updated_at = now()
  where user_id = uid;

  insert into public.wallet_transactions(user_id, delta, reason)
  values (uid, -99, 'Daily Pass — 24 hours');

  insert into public.driver_daily_passes(
    driver_id, starts_at, ends_at, amount, status
  )
  values (
    uid, now(), now() + interval '24 hours', 99, 'active'
  )
  returning * into row;

  return row;
end;
$function$;

revoke all on function public.activate_driver_daily_pass() from public, anon;
grant execute on function public.activate_driver_daily_pass() to authenticated;
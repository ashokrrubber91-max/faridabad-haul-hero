-- Driver Daily Pass: atomic ₹99 purchase, owner-only reads, and 0% commission
-- for trips completed while the pass is active.

create unique index if not exists driver_daily_passes_one_active_per_driver
  on public.driver_daily_passes(driver_id)
  where status = 'active';

alter table public.driver_daily_passes enable row level security;

revoke all on table public.driver_daily_passes from anon, authenticated;
grant select on table public.driver_daily_passes to authenticated;

drop policy if exists "Drivers can view their own daily passes" on public.driver_daily_passes;
create policy "Drivers can view their own daily passes"
  on public.driver_daily_passes
  for select
  to authenticated
  using ((select auth.uid()) = driver_id);

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
  new_pass public.driver_daily_passes;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.user_roles
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
  returning * into new_pass;

  return new_pass;
end;
$function$;

revoke all on function public.activate_driver_daily_pass() from public, anon;
grant execute on function public.activate_driver_daily_pass() to authenticated;

create or replace function public.bookings_award_coins()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  award numeric;
  commission numeric;
  net numeric;
  pass_active boolean := false;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    award := round(new.fare * 0.02);

    insert into public.wallet_accounts(user_id, coins_balance)
    values (new.customer_id, award)
    on conflict (user_id) do update
      set coins_balance = wallet_accounts.coins_balance + award,
          updated_at = now();

    insert into public.wallet_transactions(user_id, booking_id, delta, reason)
    values (new.customer_id, new.id, award, 'Earned on trip');

    if new.coins_redeemed > 0 then
      insert into public.wallet_transactions(user_id, booking_id, delta, reason)
      values (new.customer_id, new.id, -new.coins_redeemed, 'Redeemed on trip');
    end if;

    if new.driver_id is not null then
      select exists (
        select 1
        from public.driver_daily_passes p
        where p.driver_id = new.driver_id
          and p.status = 'active'
          and p.starts_at <= now()
          and p.ends_at > now()
      )
      into pass_active;

      if pass_active then
        commission := 0;
        new.commission_rate := 0;
      else
        commission := round(new.fare * coalesce(new.commission_rate, 0.10));
      end if;

      net := new.fare - commission;
      new.commission_amount := commission;
      new.driver_net_earning := net;

      insert into public.wallet_accounts(user_id, coins_balance)
      values (new.driver_id, 0)
      on conflict (user_id) do nothing;

      if new.payment_method = 'cod' then
        if commission > 0 then
          update public.wallet_accounts
          set cash_balance = cash_balance - commission,
              updated_at = now()
          where user_id = new.driver_id;

          insert into public.wallet_transactions(user_id, booking_id, delta, reason)
          values (new.driver_id, new.id, -commission, 'Miniport commission (cash trip)');
        end if;
      else
        update public.wallet_accounts
        set cash_balance = cash_balance + net,
            updated_at = now()
        where user_id = new.driver_id;

        insert into public.wallet_transactions(user_id, booking_id, delta, reason)
        values (
          new.driver_id,
          new.id,
          net,
          case
            when pass_active then 'Trip earning (Daily Pass — 0% commission)'
            else 'Trip earning (online payment)'
          end
        );
      end if;
    end if;
  end if;

  return new;
end
$function$;

revoke all on function public.activate_driver_daily_pass() from public, anon;
grant execute on function public.activate_driver_daily_pass() to authenticated;

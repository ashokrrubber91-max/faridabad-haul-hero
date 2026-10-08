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
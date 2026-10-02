-- MiniPort security/performance hardening 2026-10-03
--
-- Applied to production Supabase as migration:
-- security_and_performance_hardening_20261003
--
-- Goals:
-- 1) least-privilege Data API grants
-- 2) server-only incentive settlement
-- 3) atomic daily-pass and payout reservations
-- 4) payout destination ownership validation
-- 5) foreign-key indexes
-- 6) cached auth.uid()/security-definer checks in hot RLS policies

revoke all on table public.profiles from anon;
revoke all on table public.user_roles from anon;
revoke all on table public.bookings from anon;
revoke all on table public.driver_locations from anon;
revoke all on table public.booking_documents from anon;
revoke all on table public.wallet_accounts from anon;
revoke all on table public.merchant_accounts from anon;
revoke all on table public.merchant_billing_cycles from anon;
revoke all on table public.driver_daily_passes from anon;
revoke all on table public.device_tokens from anon;

revoke insert, update, delete on table public.wallet_accounts from authenticated;
grant select on table public.wallet_accounts to authenticated;
revoke insert, update, delete on table public.driver_daily_passes from authenticated;
grant select on table public.driver_daily_passes to authenticated;
revoke insert, update, delete on table public.merchant_billing_cycles from authenticated;
grant select on table public.merchant_billing_cycles to authenticated;
revoke insert, update, delete on table public.booking_documents from authenticated;

revoke all on function public.settle_daily_incentives(date) from authenticated;
grant execute on function public.settle_daily_incentives(date) to service_role;

create or replace function public.reserve_driver_payout(
  _amount numeric,
  _method text,
  _upi_id text default null,
  _bank_account_id uuid default null
)
returns public.driver_payouts
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); balance numeric; row public.driver_payouts;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.user_roles where user_id = uid and role = 'driver') then raise exception 'Driver only'; end if;
  if _amount <= 0 then raise exception 'Invalid amount'; end if;
  if _method not in ('upi','bank') then raise exception 'Invalid payout method'; end if;
  if _method = 'upi' then
    if _upi_id is null or btrim(_upi_id) !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$' then raise exception 'Invalid UPI ID'; end if;
  else
    if _bank_account_id is null then raise exception 'Bank account required'; end if;
    if not exists(select 1 from public.driver_bank_accounts where id = _bank_account_id and driver_id = uid) then
      raise exception 'Bank account not found';
    end if;
  end if;
  select cash_balance into balance from public.wallet_accounts where user_id = uid for update;
  if coalesce(balance,0) < _amount then raise exception 'Insufficient wallet balance'; end if;
  insert into public.driver_payouts(driver_id,amount,method,upi_id,bank_account_id,status)
  values(uid,round(_amount,2),_method,case when _method='upi' then btrim(_upi_id) else null end,
    case when _method='bank' then _bank_account_id else null end,'processing')
  returning * into row;
  update public.wallet_accounts set cash_balance=cash_balance-round(_amount,2),updated_at=now() where user_id=uid;
  insert into public.wallet_transactions(user_id,delta,reason) values(uid,-round(_amount,2),'Instant payout reserved');
  return row;
end;
$$;
revoke all on function public.reserve_driver_payout(numeric,text,text,uuid) from public,anon;
grant execute on function public.reserve_driver_payout(numeric,text,text,uuid) to authenticated,service_role;

create or replace function public.activate_driver_daily_pass()
returns public.driver_daily_passes
language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); balance numeric; row public.driver_daily_passes;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.user_roles where user_id=uid and role='driver') then raise exception 'Driver only'; end if;
  update public.driver_daily_passes set status='expired' where driver_id=uid and status='active' and ends_at<=now();
  select cash_balance into balance from public.wallet_accounts where user_id=uid for update;
  if coalesce(balance,0)<99 then raise exception 'Wallet balance must be at least ₹99'; end if;
  update public.wallet_accounts set cash_balance=cash_balance-99,updated_at=now() where user_id=uid;
  insert into public.wallet_transactions(user_id,delta,reason) values(uid,-99,'Daily Pass — 24 hours');
  insert into public.driver_daily_passes(driver_id,starts_at,ends_at,amount,status)
  values(uid,now(),now()+interval '24 hours',99,'active') returning * into row;
  return row;
end;
$$;
revoke all on function public.activate_driver_daily_pass() from public,anon;
grant execute on function public.activate_driver_daily_pass() to authenticated;

create index if not exists booking_documents_created_by_idx on public.booking_documents(created_by);
create index if not exists bookings_customer_id_idx on public.bookings(customer_id);
create index if not exists bookings_driver_id_idx on public.bookings(driver_id);
create index if not exists driver_bank_accounts_driver_id_idx on public.driver_bank_accounts(driver_id);
create index if not exists driver_kyc_reviewed_by_idx on public.driver_kyc(reviewed_by);
create index if not exists referrals_qualifying_booking_id_idx on public.referrals(qualifying_booking_id);
create index if not exists wallet_transactions_booking_id_idx on public.wallet_transactions(booking_id);
create index if not exists wallet_transactions_user_id_idx on public.wallet_transactions(user_id);
create index if not exists withdrawal_requests_driver_id_idx on public.withdrawal_requests(driver_id);
create index if not exists driver_locations_driver_id_idx on public.driver_locations(driver_id);

drop policy if exists "Profiles: insert own" on public.profiles;
create policy "Profiles: insert own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "Profiles: update own safe fields" on public.profiles;
create policy "Profiles: update own safe fields" on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Roles: admin insert only" on public.user_roles;
create policy "Roles: admin insert only" on public.user_roles for insert to authenticated
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "Roles: admin read all" on public.user_roles;
create policy "Roles: admin read all" on public.user_roles for select to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "Roles: read own" on public.user_roles;
create policy "Roles: read own" on public.user_roles for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Device tokens: own rows" on public.device_tokens;
create policy "Device tokens: own rows" on public.device_tokens for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Bookings: admin read all" on public.bookings;
create policy "Bookings: admin read all" on public.bookings for select to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "Bookings: admin update all" on public.bookings;
create policy "Bookings: admin update all" on public.bookings for update to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)))
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "Bookings: customer insert" on public.bookings;
create policy "Bookings: customer insert" on public.bookings for insert to authenticated
with check (((select auth.uid()) = customer_id) and (select has_role((select auth.uid()), 'customer'::public.app_role)));

drop policy if exists "Bookings: customer read own" on public.bookings;
create policy "Bookings: customer read own" on public.bookings for select to authenticated
using ((select auth.uid()) = customer_id);

drop policy if exists "Bookings: customer update own" on public.bookings;
create policy "Bookings: customer update own" on public.bookings for update to authenticated
using ((select auth.uid()) = customer_id) with check ((select auth.uid()) = customer_id);

drop policy if exists "Bookings: driver read pending or own" on public.bookings;
create policy "Bookings: driver read pending or own" on public.bookings for select to authenticated
using ((select has_role((select auth.uid()), 'driver'::public.app_role))
  and (((status='pending'::public.booking_status) and (select is_kyc_approved((select auth.uid()))))
  or driver_id=(select auth.uid())));

drop policy if exists "Bookings: driver update" on public.bookings;
create policy "Bookings: driver update" on public.bookings for update to authenticated
using ((select has_role((select auth.uid()), 'driver'::public.app_role))
  and (select is_kyc_approved((select auth.uid())))
  and ((status='pending'::public.booking_status) or driver_id=(select auth.uid())))
with check ((select has_role((select auth.uid()), 'driver'::public.app_role))
  and (select is_kyc_approved((select auth.uid())))
  and driver_id=(select auth.uid()));

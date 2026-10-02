-- MiniPort B2B RLS hardening audit.
-- Actual schema uses booking_documents / merchant_accounts /
-- merchant_billing_cycles / driver_daily_passes plus bookings insurance columns.

alter table public.booking_documents enable row level security;
alter table public.merchant_accounts enable row level security;
alter table public.merchant_billing_cycles enable row level security;
alter table public.driver_daily_passes enable row level security;
alter table public.driver_locations enable row level security;

revoke all on table public.booking_documents from anon, authenticated;
grant select on table public.booking_documents to authenticated;
grant all on table public.booking_documents to service_role;

drop policy if exists booking_documents_strict_select on public.booking_documents;
create policy booking_documents_strict_select
on public.booking_documents
as restrictive
for select to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = booking_documents.booking_id
      and (b.customer_id = (select auth.uid()) or b.driver_id = (select auth.uid()))
  )
);

drop policy if exists merchant_accounts_strict_owner on public.merchant_accounts;
create policy merchant_accounts_strict_owner
on public.merchant_accounts
as restrictive
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists merchant_billing_strict_owner on public.merchant_billing_cycles;
create policy merchant_billing_strict_owner
on public.merchant_billing_cycles
as restrictive
for select to authenticated
using (
  exists (
    select 1 from public.merchant_accounts m
    where m.id = merchant_billing_cycles.merchant_id
      and m.user_id = (select auth.uid())
  )
);

drop policy if exists daily_pass_strict_owner on public.driver_daily_passes;
create policy daily_pass_strict_owner
on public.driver_daily_passes
as restrictive
for select to authenticated
using (driver_id = (select auth.uid()));

drop policy if exists driver_locations_strict_owner_insert on public.driver_locations;
create policy driver_locations_strict_owner_insert
on public.driver_locations
as restrictive
for insert to authenticated
with check (driver_id = (select auth.uid()));

drop policy if exists driver_locations_strict_owner_update on public.driver_locations;
create policy driver_locations_strict_owner_update
on public.driver_locations
as restrictive
for update to authenticated
using (driver_id = (select auth.uid()))
with check (driver_id = (select auth.uid()));

-- Cargo insurance is stored as authoritative columns on bookings:
-- insurance_opted, insurance_fee, insurance_limit, cargo_value.
-- Booking RLS remains the single access boundary; no separate public
-- cargo_insurance table is created just for the audit requirement.

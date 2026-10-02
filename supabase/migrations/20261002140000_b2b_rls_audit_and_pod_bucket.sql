-- B2B production hardening audit.
-- The app's canonical tables are booking_documents/merchant_accounts/
-- merchant_billing_cycles/driver_daily_passes; these policies cover the
-- requested POD, merchant khata, daily-pass and insurance domains.

alter table public.booking_documents enable row level security;
alter table public.merchant_accounts enable row level security;
alter table public.merchant_billing_cycles enable row level security;
alter table public.driver_daily_passes enable row level security;
alter table public.driver_locations enable row level security;

revoke all on table public.booking_documents from anon;
revoke all on table public.merchant_accounts from anon;
revoke all on table public.merchant_billing_cycles from anon;
revoke all on table public.driver_daily_passes from anon;
revoke all on table public.driver_locations from anon;

drop policy if exists booking_documents_insert_driver on public.booking_documents;
create policy booking_documents_insert_driver
on public.booking_documents for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.bookings b
    where b.id = booking_documents.booking_id
      and b.driver_id = (select auth.uid())
  )
);

drop policy if exists booking_documents_select_trip_party on public.booking_documents;
create policy booking_documents_select_trip_party
on public.booking_documents for select to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = booking_documents.booking_id
      and (b.customer_id = (select auth.uid()) or b.driver_id = (select auth.uid()))
  )
);

drop policy if exists merchant_accounts_insert_own on public.merchant_accounts;
create policy merchant_accounts_insert_own
on public.merchant_accounts for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists merchant_accounts_update_own on public.merchant_accounts;
create policy merchant_accounts_update_own
on public.merchant_accounts for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists merchant_billing_select_own on public.merchant_billing_cycles;
create policy merchant_billing_select_own
on public.merchant_billing_cycles for select to authenticated
using (
  exists (
    select 1 from public.merchant_accounts m
    where m.id = merchant_billing_cycles.merchant_id
      and m.user_id = (select auth.uid())
  )
);

drop policy if exists daily_pass_select_own on public.driver_daily_passes;
create policy daily_pass_select_own
on public.driver_daily_passes for select to authenticated
using (driver_id = (select auth.uid()));

drop policy if exists driver_locations_insert_own on public.driver_locations;
create policy driver_locations_insert_own
on public.driver_locations for insert to authenticated
with check (driver_id = (select auth.uid()));

drop policy if exists driver_locations_update_own on public.driver_locations;
create policy driver_locations_update_own
on public.driver_locations for update to authenticated
using (driver_id = (select auth.uid()))
with check (driver_id = (select auth.uid()));

insert into storage.buckets (id, name, public)
values ('pod-files', 'pod-files', false)
on conflict (id) do nothing;

drop policy if exists pod_files_insert_driver on storage.objects;
create policy pod_files_insert_driver
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists pod_files_select_owner on storage.objects;
create policy pod_files_select_owner
on storage.objects for select to authenticated
using (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists pod_files_update_owner on storage.objects;
create policy pod_files_update_owner
on storage.objects for update to authenticated
using (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

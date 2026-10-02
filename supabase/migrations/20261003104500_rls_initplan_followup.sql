-- RLS initplan follow-up: wrap stable auth/role checks so PostgreSQL
-- caches them once per statement instead of re-evaluating for every row.

create index if not exists broadcasts_created_by_idx on public.broadcasts(created_by);

drop policy if exists booking_documents_own on public.booking_documents;
create policy booking_documents_own on public.booking_documents
for select to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = booking_documents.booking_id
      and (b.customer_id = (select auth.uid()) or b.driver_id = (select auth.uid()))
  )
);

drop policy if exists booking_stops_insert_own on public.booking_stops;
create policy booking_stops_insert_own on public.booking_stops
for insert to authenticated
with check (
  exists (
    select 1 from public.bookings b
    where b.id = booking_stops.booking_id and b.customer_id = (select auth.uid())
  )
);

drop policy if exists booking_stops_own on public.booking_stops;
create policy booking_stops_own on public.booking_stops
for select to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = booking_stops.booking_id
      and (b.customer_id = (select auth.uid()) or b.driver_id = (select auth.uid()))
  )
);

drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons" on public.coupons
for all to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)))
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "own gstins" on public.customer_gstins;
create policy "own gstins" on public.customer_gstins
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "own bank accounts" on public.driver_bank_accounts;
create policy "own bank accounts" on public.driver_bank_accounts
for all to authenticated
using (driver_id = (select auth.uid()) or (select has_role((select auth.uid()), 'admin'::public.app_role)))
with check (driver_id = (select auth.uid()) or (select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists driver_daily_passes_own on public.driver_daily_passes;

drop policy if exists "Admin manages tiers" on public.driver_incentive_config;
create policy "Admin manages tiers" on public.driver_incentive_config
for all to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)))
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "Driver reads own incentives" on public.driver_incentive_earnings;
create policy "Driver reads own incentives" on public.driver_incentive_earnings
for select to authenticated
using (
  driver_id = (select auth.uid())
  or (select has_role((select auth.uid()), 'admin'::public.app_role))
);

drop policy if exists "KYC: admin manages all" on public.driver_kyc;
create policy "KYC: admin manages all" on public.driver_kyc
for all to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)))
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "KYC: driver submits own" on public.driver_kyc;
create policy "KYC: driver submits own" on public.driver_kyc
for insert to authenticated
with check (
  driver_id = (select auth.uid())
  and status = 'pending'::public.kyc_status
  and reviewed_by is null
  and reviewed_at is null
  and rejection_reason is null
);

drop policy if exists "KYC: driver updates own documents" on public.driver_kyc;
create policy "KYC: driver updates own documents" on public.driver_kyc
for update to authenticated
using (
  driver_id = (select auth.uid())
  and not (select has_role((select auth.uid()), 'admin'::public.app_role))
)
with check (driver_id = (select auth.uid()));

drop policy if exists "KYC: read own or admin" on public.driver_kyc;
create policy "KYC: read own or admin" on public.driver_kyc
for select to authenticated
using (
  driver_id = (select auth.uid())
  or (select has_role((select auth.uid()), 'admin'::public.app_role))
);

drop policy if exists driver_payouts_own on public.driver_payouts;
create policy driver_payouts_own on public.driver_payouts
for select to authenticated
using (driver_id = (select auth.uid()));

drop policy if exists merchant_accounts_own on public.merchant_accounts;
drop policy if exists merchant_billing_own on public.merchant_billing_cycles;

drop policy if exists "Payments: customer reads own" on public.payments;
create policy "Payments: customer reads own" on public.payments
for select to authenticated
using (
  customer_id = (select auth.uid())
  or (select has_role((select auth.uid()), 'admin'::public.app_role))
);

drop policy if exists referrals_select_own on public.referrals;
create policy referrals_select_own on public.referrals
for select to authenticated
using (
  referrer_id = (select auth.uid())
  or referred_user_id = (select auth.uid())
);

drop policy if exists own_saved_addresses_delete on public.saved_addresses;
create policy own_saved_addresses_delete on public.saved_addresses
for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists own_saved_addresses_insert on public.saved_addresses;
create policy own_saved_addresses_insert on public.saved_addresses
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists own_saved_addresses_select on public.saved_addresses;
create policy own_saved_addresses_select on public.saved_addresses
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists own_saved_addresses_update on public.saved_addresses;
create policy own_saved_addresses_update on public.saved_addresses
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists scheduled_dispatch_own on public.scheduled_dispatch_jobs;
create policy scheduled_dispatch_own on public.scheduled_dispatch_jobs
for select to authenticated
using (
  exists (
    select 1 from public.bookings b
    where b.id = scheduled_dispatch_jobs.booking_id
      and (b.customer_id = (select auth.uid()) or b.driver_id = (select auth.uid()))
  )
);

drop policy if exists "SMS logs: admin delete" on public.sms_logs;
create policy "SMS logs: admin delete" on public.sms_logs
for delete to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "SMS logs: admin read" on public.sms_logs;
create policy "SMS logs: admin read" on public.sms_logs
for select to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "SMS logs: admin update" on public.sms_logs;
create policy "SMS logs: admin update" on public.sms_logs
for update to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)))
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists voice_drafts_owner on public.voice_booking_drafts;
create policy voice_drafts_owner on public.voice_booking_drafts
for select to authenticated
using (
  requester_phone is null
  or requester_phone = coalesce(
    (select p.phone from public.profiles p where p.id = (select auth.uid())),
    ''
  )
);

drop policy if exists "owner inits wallet" on public.wallet_accounts;
create policy "owner inits wallet" on public.wallet_accounts
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "owner reads wallet" on public.wallet_accounts;
create policy "owner reads wallet" on public.wallet_accounts
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "owner reads txns" on public.wallet_transactions;
create policy "owner reads txns" on public.wallet_transactions
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "admin updates withdrawal" on public.withdrawal_requests;
create policy "admin updates withdrawal" on public.withdrawal_requests
for update to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)))
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "driver reads own withdrawals" on public.withdrawal_requests;
create policy "driver reads own withdrawals" on public.withdrawal_requests
for select to authenticated
using (
  driver_id = (select auth.uid())
  or (select has_role((select auth.uid()), 'admin'::public.app_role))
);

drop policy if exists "driver requests withdrawal" on public.withdrawal_requests;
create policy "driver requests withdrawal" on public.withdrawal_requests
for insert to authenticated
with check (
  driver_id = (select auth.uid())
  and status = 'requested'::public.withdrawal_status
);

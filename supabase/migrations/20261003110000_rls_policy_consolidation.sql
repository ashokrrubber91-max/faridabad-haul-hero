-- Consolidate overlapping permissive RLS policies into one policy per
-- table/action to reduce repeated policy evaluation.

drop policy if exists "Bookings: admin read all" on public.bookings;
drop policy if exists "Bookings: customer read own" on public.bookings;
drop policy if exists "Bookings: driver read pending or own" on public.bookings;
create policy "Bookings: read by role" on public.bookings
for select to authenticated
using (
  (select has_role((select auth.uid()), 'admin'::public.app_role))
  or (customer_id = (select auth.uid()))
  or (
    (select has_role((select auth.uid()), 'driver'::public.app_role))
    and (
      ((status='pending'::public.booking_status) and (select is_kyc_approved((select auth.uid()))))
      or driver_id = (select auth.uid())
    )
  )
);

drop policy if exists "Bookings: admin update all" on public.bookings;
drop policy if exists "Bookings: customer update own" on public.bookings;
drop policy if exists "Bookings: driver update" on public.bookings;
create policy "Bookings: update by role" on public.bookings
for update to authenticated
using (
  (select has_role((select auth.uid()), 'admin'::public.app_role))
  or customer_id = (select auth.uid())
  or (
    (select has_role((select auth.uid()), 'driver'::public.app_role))
    and (select is_kyc_approved((select auth.uid())))
    and ((status='pending'::public.booking_status) or driver_id=(select auth.uid()))
  )
)
with check (
  (select has_role((select auth.uid()), 'admin'::public.app_role))
  or customer_id = (select auth.uid())
  or (
    (select has_role((select auth.uid()), 'driver'::public.app_role))
    and (select is_kyc_approved((select auth.uid())))
    and driver_id=(select auth.uid())
  )
);

drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons" on public.coupons
for insert to authenticated
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));
create policy "admins update coupons" on public.coupons
for update to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)))
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));
create policy "admins delete coupons" on public.coupons
for delete to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "Admin manages tiers" on public.driver_incentive_config;
create policy "Admin inserts tiers" on public.driver_incentive_config
for insert to authenticated
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));
create policy "Admin updates tiers" on public.driver_incentive_config
for update to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)))
with check ((select has_role((select auth.uid()), 'admin'::public.app_role)));
create policy "Admin deletes tiers" on public.driver_incentive_config
for delete to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "KYC: admin manages all" on public.driver_kyc;
drop policy if exists "KYC: driver submits own" on public.driver_kyc;
drop policy if exists "KYC: driver updates own documents" on public.driver_kyc;
drop policy if exists "KYC: read own or admin" on public.driver_kyc;

create policy "KYC: read own or admin" on public.driver_kyc
for select to authenticated
using (
  driver_id = (select auth.uid())
  or (select has_role((select auth.uid()), 'admin'::public.app_role))
);

create policy "KYC: insert own or admin" on public.driver_kyc
for insert to authenticated
with check (
  (select has_role((select auth.uid()), 'admin'::public.app_role))
  or (
    driver_id = (select auth.uid())
    and status = 'pending'::public.kyc_status
    and reviewed_by is null
    and reviewed_at is null
    and rejection_reason is null
  )
);

create policy "KYC: update own or admin" on public.driver_kyc
for update to authenticated
using (
  (select has_role((select auth.uid()), 'admin'::public.app_role))
  or driver_id = (select auth.uid())
)
with check (
  (select has_role((select auth.uid()), 'admin'::public.app_role))
  or driver_id = (select auth.uid())
);

create policy "KYC: admin delete" on public.driver_kyc
for delete to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "Roles: admin read all" on public.user_roles;
drop policy if exists "Roles: read own" on public.user_roles;
create policy "Roles: read own or admin" on public.user_roles
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select has_role((select auth.uid()), 'admin'::public.app_role))
);

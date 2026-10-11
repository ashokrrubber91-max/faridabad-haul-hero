-- Keep booking records private to the customer, assigned/eligible drivers, and admins.
-- Do not grant anon unrestricted access: bookings contain addresses, phone numbers and OTPs.
alter table public.bookings enable row level security;

drop policy if exists "Allow users to view their own bookings" on public.bookings;
drop policy if exists "Allow users to insert bookings" on public.bookings;
drop policy if exists "Allow users to update bookings" on public.bookings;
drop policy if exists "Enable all access for authenticated users" on public.bookings;
drop policy if exists "Allow authenticated and anon select on bookings" on public.bookings;
drop policy if exists "Allow authenticated and anon insert on bookings" on public.bookings;
drop policy if exists "Allow authenticated and anon update on bookings" on public.bookings;
drop policy if exists "Bookings: customer insert" on public.bookings;
drop policy if exists "Bookings: customer insert own booking" on public.bookings;
drop policy if exists "Bookings: read by role" on public.bookings;
drop policy if exists "Bookings: read own customer or assigned driver" on public.bookings;
drop policy if exists "Bookings: update by role" on public.bookings;

create policy "Bookings: select own or authorized dispatch"
on public.bookings for select to authenticated
using (
  (select public.has_role((select auth.uid()), 'admin'::public.app_role))
  or customer_id = (select auth.uid())
  or (
    (select public.has_role((select auth.uid()), 'driver'::public.app_role))
    and (select public.is_kyc_approved((select auth.uid())))
    and (status = 'pending'::public.booking_status or driver_id = (select auth.uid()))
  )
);

create policy "Bookings: customer inserts own booking"
on public.bookings for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and (select public.has_role((select auth.uid()), 'customer'::public.app_role))
);

create policy "Bookings: update by authorized participant"
on public.bookings for update to authenticated
using (
  (select public.has_role((select auth.uid()), 'admin'::public.app_role))
  or customer_id = (select auth.uid())
  or (
    (select public.has_role((select auth.uid()), 'driver'::public.app_role))
    and (select public.is_kyc_approved((select auth.uid())))
    and (status = 'pending'::public.booking_status or driver_id = (select auth.uid()))
  )
)
with check (
  (select public.has_role((select auth.uid()), 'admin'::public.app_role))
  or customer_id = (select auth.uid())
  or (
    (select public.has_role((select auth.uid()), 'driver'::public.app_role))
    and (select public.is_kyc_approved((select auth.uid())))
    and driver_id = (select auth.uid())
  )
);

revoke all on table public.bookings from anon;
grant select, insert, update on table public.bookings to authenticated;
grant all on table public.bookings to service_role;

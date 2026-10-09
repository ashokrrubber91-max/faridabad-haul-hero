-- Repair customer booking permissions without widening access to other users' trips.
-- Supabase grants and RLS policies are both required for API access.
grant select, insert, update on table public.bookings to authenticated;

-- A signed-in user may create a booking only for their own auth identity.
-- This ownership check avoids a failed role lookup denying an otherwise valid
-- customer insert. Existing role-aware SELECT and UPDATE policies stay in place.
drop policy if exists "Bookings: customer insert own booking" on public.bookings;
create policy "Bookings: customer insert own booking"
on public.bookings
for insert
to authenticated
with check (customer_id = (select auth.uid()));

create index if not exists bookings_customer_id_idx on public.bookings(customer_id);

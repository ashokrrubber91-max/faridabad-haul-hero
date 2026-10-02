drop policy if exists booking_stops_insert_own on public.booking_stops;
create policy booking_stops_insert_own on public.booking_stops for insert to authenticated with check (
  exists (select 1 from public.bookings b where b.id = booking_stops.booking_id and b.customer_id = auth.uid())
);
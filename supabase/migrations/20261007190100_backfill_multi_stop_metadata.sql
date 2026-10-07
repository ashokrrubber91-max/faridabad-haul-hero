update public.bookings b
set stops = coalesce((
  select jsonb_agg(jsonb_build_object(
    'sequence', bs.sequence,
    'address', bs.address,
    'lat', bs.latitude,
    'lng', bs.longitude,
    'place_id', bs.place_id,
    'contact_name', bs.contact_name,
    'contact_phone', bs.contact_phone,
    'status', bs.status
  ) order by bs.sequence)
  from public.booking_stops bs
  where bs.booking_id = b.id and bs.kind = 'stop'
), '[]'::jsonb),
total_stops = greatest(1, 1 + coalesce((
  select count(*) from public.booking_stops bs where bs.booking_id = b.id and bs.kind = 'stop'
), 0)::integer),
is_multi_stop = exists (
  select 1 from public.booking_stops bs
  where bs.booking_id = b.id and bs.kind = 'stop'
)
where exists (
  select 1 from public.booking_stops bs
  where bs.booking_id = b.id and bs.kind = 'stop'
);
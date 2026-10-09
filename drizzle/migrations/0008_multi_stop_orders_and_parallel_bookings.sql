create schema if not exists private;

alter table public.bookings
  add column if not exists stops jsonb not null default '[]'::jsonb,
  add column if not exists is_multi_stop boolean not null default false,
  add column if not exists total_stops integer not null default 1;

alter table public.bookings
  drop constraint if exists bookings_total_stops_check;

alter table public.bookings
  add constraint bookings_total_stops_check
  check (total_stops between 1 and 4);

alter table public.booking_stops
  add column if not exists status text not null default 'pending',
  add column if not exists arrived_at timestamptz,
  add column if not exists verified_at timestamptz;

alter table public.booking_stops
  drop constraint if exists booking_stops_status_check;

alter table public.booking_stops
  add constraint booking_stops_status_check
  check (status in ('pending','arrived','verified','completed'));

create table if not exists private.booking_stop_otps (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sequence integer not null,
  otp text not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (booking_id, sequence),
  constraint booking_stop_otps_sequence_check check (sequence between 1 and 3),
  constraint booking_stop_otps_otp_check check (otp ~ '^[0-9]{4}$')
);

revoke all on table private.booking_stop_otps from public, anon, authenticated;

create index if not exists bookings_stops_gin_idx on public.bookings using gin (stops);

-- Stop OTPs are generated server-side and are never stored in the public booking_stops table.
create or replace function public.booking_stop_generate_otp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'stop' then
    insert into private.booking_stop_otps(booking_id, sequence, otp)
    values (new.booking_id, new.sequence, lpad((floor(random() * 10000))::integer::text, 4, '0'))
    on conflict (booking_id, sequence) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.booking_stop_generate_otp() from public, anon, authenticated;

drop trigger if exists booking_stops_generate_otp on public.booking_stops;
create trigger booking_stops_generate_otp after insert on public.booking_stops
for each row execute function public.booking_stop_generate_otp();

create or replace function public.get_booking_stop_otps(_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.bookings b
    where b.id = _booking_id
      and (b.customer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role))
  ) then raise exception 'Not authorized'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sequence', o.sequence,
      'otp', o.otp,
      'verified_at', o.verified_at
    ) order by o.sequence)
    from private.booking_stop_otps o
    where o.booking_id = _booking_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_booking_stop_otps(uuid) from public, anon;
grant execute on function public.get_booking_stop_otps(uuid) to authenticated;

create or replace function public.mark_booking_stop_arrived(_booking_id uuid, _sequence integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare stop_row public.booking_stops%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.bookings b
    where b.id = _booking_id
      and b.driver_id = auth.uid()
      and public.has_role(auth.uid(), 'driver'::public.app_role)
      and public.is_kyc_approved(auth.uid())
      and b.status in ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
  ) then raise exception 'Only the assigned verified driver can confirm arrival'; end if;

  select * into stop_row from public.booking_stops
  where booking_id = _booking_id and sequence = _sequence and kind = 'stop'
  for update;

  if not found then raise exception 'Stop not found'; end if;
  if stop_row.status in ('verified','completed') then
    return jsonb_build_object('ok', true, 'already_verified', true, 'sequence', _sequence);
  end if;

  update public.booking_stops
  set status = 'arrived', arrived_at = coalesce(arrived_at, now())
  where id = stop_row.id;

  update public.bookings
  set stops = (
    select coalesce(jsonb_agg(
      case when (elem->>'sequence')::integer = _sequence
        then elem || jsonb_build_object('status','arrived')
        else elem end
      order by ordinality
    ), '[]'::jsonb)
    from jsonb_array_elements(stops) with ordinality as x(elem, ordinality)
  )
  where id = _booking_id;

  return jsonb_build_object('ok', true, 'sequence', _sequence, 'status', 'arrived');
end;
$$;

revoke all on function public.mark_booking_stop_arrived(uuid, integer) from public, anon;
grant execute on function public.mark_booking_stop_arrived(uuid, integer) to authenticated;

create or replace function public.verify_booking_stop(_booking_id uuid, _sequence integer, _otp text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  stop_row public.booking_stops%rowtype;
  otp_row private.booking_stop_otps%rowtype;
  cleaned text := regexp_replace(coalesce(_otp, ''), '\D', '', 'g');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.bookings b
    where b.id = _booking_id
      and b.driver_id = auth.uid()
      and public.has_role(auth.uid(), 'driver'::public.app_role)
      and public.is_kyc_approved(auth.uid())
      and b.status in ('accepted'::public.booking_status, 'in_progress'::public.booking_status)
  ) then raise exception 'Only the assigned verified driver can verify this stop'; end if;

  select * into stop_row from public.booking_stops
  where booking_id = _booking_id and sequence = _sequence and kind = 'stop'
  for update;

  if not found then raise exception 'Stop not found'; end if;
  if stop_row.status <> 'arrived' then raise exception 'Confirm arrival at this stop before entering the OTP'; end if;

  select * into otp_row from private.booking_stop_otps
  where booking_id = _booking_id and sequence = _sequence for update;

  if not found then raise exception 'Stop verification code is unavailable'; end if;
  if otp_row.verified_at is not null or stop_row.status = 'verified' then
    return jsonb_build_object('ok', true, 'already_verified', true, 'sequence', _sequence, 'next_sequence', _sequence + 1);
  end if;
  if otp_row.attempts >= 5 then raise exception 'Too many incorrect stop OTP attempts'; end if;

  if cleaned <> otp_row.otp then
    update private.booking_stop_otps set attempts = attempts + 1
    where booking_id = _booking_id and sequence = _sequence;
    raise exception 'Incorrect stop OTP';
  end if;

  update private.booking_stop_otps set verified_at = now()
  where booking_id = _booking_id and sequence = _sequence;

  update public.booking_stops set status = 'verified', verified_at = now()
  where id = stop_row.id;

  update public.bookings
  set stops = (
    select coalesce(jsonb_agg(
      case when (elem->>'sequence')::integer = _sequence
        then elem || jsonb_build_object('status','verified')
        else elem end
      order by ordinality
    ), '[]'::jsonb)
    from jsonb_array_elements(stops) with ordinality as x(elem, ordinality)
  )
  where id = _booking_id;

  return jsonb_build_object('ok', true, 'sequence', _sequence, 'next_sequence', _sequence + 1);
end;
$$;

revoke all on function public.verify_booking_stop(uuid, integer, text) from public, anon;
grant execute on function public.verify_booking_stop(uuid, integer, text) to authenticated;
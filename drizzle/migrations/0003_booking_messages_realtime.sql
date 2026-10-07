create table if not exists public.booking_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  message_type text not null default 'text' check (message_type in ('text','location','voice')),
  created_at timestamptz not null default now()
);

create index if not exists booking_messages_booking_created_idx
  on public.booking_messages(booking_id, created_at);

alter table public.booking_messages enable row level security;

revoke all on table public.booking_messages from anon, authenticated;
grant select, insert on table public.booking_messages to authenticated;

drop policy if exists "booking participants can read messages" on public.booking_messages;
create policy "booking participants can read messages"
  on public.booking_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_messages.booking_id
        and (b.customer_id = auth.uid() or b.driver_id = auth.uid())
    )
  );

drop policy if exists "booking participants can send messages" on public.booking_messages;
create policy "booking participants can send messages"
  on public.booking_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = booking_messages.booking_id
        and (b.customer_id = auth.uid() or b.driver_id = auth.uid())
        and b.status in ('accepted','in_progress')
    )
  );

alter publication supabase_realtime add table public.booking_messages;
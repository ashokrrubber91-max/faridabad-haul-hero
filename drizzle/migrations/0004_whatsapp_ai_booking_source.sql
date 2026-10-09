alter table public.bookings
  add column if not exists booking_source text not null default 'app'
    check (booking_source in ('app','whatsapp_ai')),
  add column if not exists customer_phone text,
  add column if not exists whatsapp_message_id text;

alter table public.bookings
  alter column customer_id drop not null;

create unique index if not exists bookings_whatsapp_message_id_uidx
  on public.bookings (whatsapp_message_id)
  where whatsapp_message_id is not null;
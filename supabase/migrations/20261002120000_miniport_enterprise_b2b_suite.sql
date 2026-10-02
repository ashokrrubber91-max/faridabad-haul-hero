-- MiniPort Enterprise & B2B expansion
-- Adds merchant, scheduled, insurance, helper, POD signature/receipt,
-- driver pass/payout and WhatsApp voice-draft primitives.
create extension if not exists pgcrypto;

alter table public.bookings
  add column if not exists helper_count smallint not null default 0,
  add column if not exists helper_fee numeric not null default 0,
  add column if not exists scheduled_for timestamptz,
  add column if not exists insurance_opted boolean not null default false,
  add column if not exists insurance_fee numeric not null default 0,
  add column if not exists insurance_limit numeric not null default 0,
  add column if not exists cargo_value numeric not null default 0,
  add column if not exists gstin_id uuid,
  add column if not exists eway_bill_number text,
  add column if not exists pod_signature_url text,
  add column if not exists pod_receipt_url text,
  add column if not exists business_account_id uuid;

create table if not exists public.booking_stops (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sequence integer not null,
  kind text not null check (kind in ('pickup','stop','drop')),
  address text not null,
  latitude double precision,
  longitude double precision,
  place_id text,
  contact_name text,
  contact_phone text,
  created_at timestamptz not null default now(),
  unique (booking_id, sequence)
);
create index if not exists booking_stops_booking_idx on public.booking_stops(booking_id, sequence);

create table if not exists public.merchant_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  business_name text not null,
  gstin text,
  business_address text,
  billing_email text,
  verified boolean not null default false,
  postpaid_enabled boolean not null default false,
  credit_limit numeric not null default 0,
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','weekly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.merchant_billing_cycles (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_accounts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'open' check (status in ('open','invoiced','paid','overdue')),
  invoice_url text,
  created_at timestamptz not null default now(),
  unique (merchant_id, period_start, period_end)
);

create table if not exists public.driver_daily_passes (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  amount numeric not null default 99,
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  provider_payment_id text,
  created_at timestamptz not null default now()
);
create index if not exists driver_daily_passes_active_idx on public.driver_daily_passes(driver_id, starts_at, ends_at, status);

create table if not exists public.driver_payouts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  method text not null default 'upi' check (method in ('upi','bank')),
  upi_id text,
  bank_account_id uuid,
  provider text not null default 'razorpayx',
  provider_payout_id text,
  status text not null default 'created' check (status in ('created','processing','paid','failed','reversed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists driver_payouts_driver_idx on public.driver_payouts(driver_id, created_at desc);

create table if not exists public.booking_documents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  document_type text not null check (document_type in ('pod_photo','pod_signature','delivery_receipt','gst_invoice','eway_bill')),
  storage_path text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists booking_documents_booking_idx on public.booking_documents(booking_id, document_type);

create table if not exists public.scheduled_dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  dispatch_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','dispatched','cancelled','failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.voice_booking_drafts (
  id uuid primary key default gen_random_uuid(),
  requester_phone text,
  source text not null default 'whatsapp_voice',
  media_url text,
  transcript text,
  parsed_data jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','confirmed','expired','failed')),
  public_token text not null unique default encode(gen_random_bytes(18),'hex'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists voice_booking_drafts_phone_idx on public.voice_booking_drafts(requester_phone, created_at desc);

insert into storage.buckets (id, name, public)
values ('booking-pod','booking-pod',false)
on conflict (id) do nothing;

alter table public.booking_stops enable row level security;
alter table public.merchant_accounts enable row level security;
alter table public.merchant_billing_cycles enable row level security;
alter table public.driver_daily_passes enable row level security;
alter table public.driver_payouts enable row level security;
alter table public.booking_documents enable row level security;
alter table public.scheduled_dispatch_jobs enable row level security;
alter table public.voice_booking_drafts enable row level security;

drop policy if exists booking_stops_own on public.booking_stops;
create policy booking_stops_own on public.booking_stops for select to authenticated using (
  exists (select 1 from public.bookings b where b.id = booking_stops.booking_id and (b.customer_id = auth.uid() or b.driver_id = auth.uid()))
);

drop policy if exists merchant_accounts_own on public.merchant_accounts;
create policy merchant_accounts_own on public.merchant_accounts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists merchant_billing_own on public.merchant_billing_cycles;
create policy merchant_billing_own on public.merchant_billing_cycles for select to authenticated using (
  exists (select 1 from public.merchant_accounts m where m.id = merchant_billing_cycles.merchant_id and m.user_id = auth.uid())
);

drop policy if exists driver_daily_passes_own on public.driver_daily_passes;
create policy driver_daily_passes_own on public.driver_daily_passes for select to authenticated using (driver_id = auth.uid());

drop policy if exists driver_payouts_own on public.driver_payouts;
create policy driver_payouts_own on public.driver_payouts for select to authenticated using (driver_id = auth.uid());

drop policy if exists booking_documents_own on public.booking_documents;
create policy booking_documents_own on public.booking_documents for select to authenticated using (
  exists (select 1 from public.bookings b where b.id = booking_documents.booking_id and (b.customer_id = auth.uid() or b.driver_id = auth.uid()))
);

drop policy if exists scheduled_dispatch_own on public.scheduled_dispatch_jobs;
create policy scheduled_dispatch_own on public.scheduled_dispatch_jobs for select to authenticated using (
  exists (select 1 from public.bookings b where b.id = scheduled_dispatch_jobs.booking_id and (b.customer_id = auth.uid() or b.driver_id = auth.uid()))
);

drop policy if exists voice_drafts_owner on public.voice_booking_drafts;
create policy voice_drafts_owner on public.voice_booking_drafts for select to authenticated using (
  requester_phone is null or requester_phone = coalesce((select phone from public.profiles where id = auth.uid()), '')
);

drop policy if exists booking_pod_insert on storage.objects;
create policy booking_pod_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'booking-pod' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists booking_pod_select on storage.objects;
create policy booking_pod_select on storage.objects for select to authenticated using (
  bucket_id = 'booking-pod' and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.driver_daily_pass_active(_driver_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.driver_daily_passes p where p.driver_id = _driver_id and p.status = 'active' and now() >= p.starts_at and now() < p.ends_at);
$$;
revoke all on function public.driver_daily_pass_active(uuid) from public, anon;
grant execute on function public.driver_daily_pass_active(uuid) to authenticated, service_role;

create or replace function public.activate_driver_daily_pass()
returns public.driver_daily_passes language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid(); balance numeric; row public.driver_daily_passes;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.user_roles where user_id = uid and role = 'driver') then raise exception 'Driver only'; end if;
  select cash_balance into balance from public.wallet_accounts where user_id = uid;
  if coalesce(balance,0) < 99 then raise exception 'Wallet balance must be at least ₹99'; end if;
  update public.wallet_accounts set cash_balance = cash_balance - 99, updated_at = now() where user_id = uid;
  insert into public.wallet_transactions(user_id, delta, reason) values(uid, -99, 'Daily Pass — 24 hours');
  update public.driver_daily_passes set status='expired' where driver_id=uid and status='active' and ends_at <= now();
  insert into public.driver_daily_passes(driver_id, starts_at, ends_at, amount, status)
  values(uid, now(), now()+interval '24 hours', 99, 'active')
  returning * into row;
  return row;
end;
$$;
revoke all on function public.activate_driver_daily_pass() from public, anon;
grant execute on function public.activate_driver_daily_pass() to authenticated;

create or replace function public.schedule_booking_dispatch(_booking_id uuid, _scheduled_for timestamptz)
returns public.scheduled_dispatch_jobs language plpgsql security definer set search_path = public
as $$
declare row public.scheduled_dispatch_jobs;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.scheduled_dispatch_jobs(booking_id, dispatch_at, status)
  values(_booking_id, greatest(_scheduled_for - interval '30 minutes', now()), 'queued')
  on conflict (booking_id) do update set dispatch_at=excluded.dispatch_at, status='queued', updated_at=now()
  returning * into row;
  update public.bookings set scheduled_for=_scheduled_for where id=_booking_id and customer_id=auth.uid();
  return row;
end;
$$;
revoke all on function public.schedule_booking_dispatch(uuid,timestamptz) from public, anon;
grant execute on function public.schedule_booking_dispatch(uuid,timestamptz) to authenticated;

create or replace function public.bookings_schedule_dispatch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.scheduled_for is not null and (old.scheduled_for is distinct from new.scheduled_for) then
    insert into public.scheduled_dispatch_jobs(booking_id, dispatch_at, status)
    values(new.id, greatest(new.scheduled_for - interval '30 minutes', now()), 'queued')
    on conflict (booking_id) do update set dispatch_at=excluded.dispatch_at, status='queued', updated_at=now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_bookings_schedule_dispatch on public.bookings;
create trigger trg_bookings_schedule_dispatch after insert or update of scheduled_for on public.bookings for each row execute function public.bookings_schedule_dispatch();

create or replace function public.merchant_monthly_statement(_merchant_id uuid, _start date, _end date)
returns table(bookings integer, subtotal numeric, tax numeric, total numeric)
language sql stable security definer set search_path=public
as $$
  select count(*)::int, coalesce(sum(b.fare + b.helper_fee + b.insurance_fee),0), coalesce(sum(round((b.fare + b.helper_fee + b.insurance_fee) * 0.18)),0), coalesce(sum((b.fare + b.helper_fee + b.insurance_fee) * 1.18),0)
  from public.bookings b
  where b.business_account_id = _merchant_id and b.status = 'completed' and b.created_at::date between _start and _end;
$$;
revoke all on function public.merchant_monthly_statement(uuid,date,date) from public, anon;
grant execute on function public.merchant_monthly_statement(uuid,date,date) to authenticated, service_role;

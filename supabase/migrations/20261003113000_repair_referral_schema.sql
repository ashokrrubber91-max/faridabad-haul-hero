-- Production repair: restore referral_code and referrals schema used by
-- Refer & Earn, auth attribution and qualifying ride rewards.

alter table public.profiles add column if not exists referral_code text;

create or replace function public.generate_unique_referral_code()
returns text language plpgsql security definer set search_path=''
as $$
declare candidate text;
begin
  loop
    candidate := 'MP' || upper(substr(md5(random()::text || clock_timestamp()::text),1,8));
    exit when not exists(select 1 from public.profiles where referral_code=candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.profiles_assign_referral_code()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.referral_code is null or btrim(new.referral_code)='' then
    new.referral_code := public.generate_unique_referral_code();
  else
    new.referral_code := upper(btrim(new.referral_code));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_referral_code on public.profiles;
create trigger profiles_assign_referral_code before insert on public.profiles
for each row execute function public.profiles_assign_referral_code();

update public.profiles set referral_code=public.generate_unique_referral_code()
where referral_code is null or btrim(referral_code)='';
create unique index if not exists profiles_referral_code_key on public.profiles(referral_code);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_code text not null,
  referred_type text not null check (referred_type in ('customer','driver')),
  reward_amount numeric not null default 100 check (reward_amount > 0),
  status text not null default 'pending' check (status in ('pending','rewarded','invalid')),
  qualifying_booking_id uuid null references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz null
);

create index if not exists referrals_referrer_id_idx on public.referrals(referrer_id);
create index if not exists referrals_status_idx on public.referrals(status);
create index if not exists referrals_qualifying_booking_id_idx on public.referrals(qualifying_booking_id);

alter table public.referrals enable row level security;
revoke all on table public.referrals from anon;
grant select on table public.referrals to authenticated;

drop policy if exists referrals_select_own on public.referrals;
create policy referrals_select_own on public.referrals
for select to authenticated
using (referrer_id=(select auth.uid()) or referred_user_id=(select auth.uid()));

create or replace function public.attach_referral_to_new_user(_referred_user_id uuid,_referral_code text,_referred_type text)
returns boolean language plpgsql security definer set search_path=''
as $$
declare _referrer_id uuid;
begin
  if _referral_code is null or btrim(_referral_code)='' then return false; end if;
  select id into _referrer_id from public.profiles
  where referral_code=upper(btrim(_referral_code)) limit 1;
  if _referrer_id is null or _referrer_id=_referred_user_id then return false; end if;
  insert into public.referrals(referrer_id,referred_user_id,referral_code,referred_type)
  values(_referrer_id,_referred_user_id,upper(btrim(_referral_code)),
    case when _referred_type='driver' then 'driver' else 'customer' end)
  on conflict (referred_user_id) do nothing;
  return found;
end;
$$;
revoke all on function public.attach_referral_to_new_user(uuid,text,text) from public,anon,authenticated;
grant execute on function public.attach_referral_to_new_user(uuid,text,text) to service_role;

create or replace function public.award_referral_reward(_referred_user_id uuid,_referred_type text,_booking_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare r public.referrals%rowtype;
begin
  select * into r from public.referrals
  where referred_user_id=_referred_user_id and status='pending' and referred_type=_referred_type
  for update;
  if not found then return false; end if;
  insert into public.wallet_accounts(user_id,cash_balance,coins_balance)
  values(r.referrer_id,r.reward_amount,0)
  on conflict(user_id) do update
  set cash_balance=public.wallet_accounts.cash_balance+excluded.cash_balance, updated_at=now();
  insert into public.wallet_transactions(user_id,booking_id,delta,reason)
  values(r.referrer_id,_booking_id,r.reward_amount,'Referral reward ₹'||trim(to_char(r.reward_amount,'FM999999990.##')));
  update public.referrals
  set status='rewarded',qualifying_booking_id=_booking_id,rewarded_at=now()
  where id=r.id;
  return true;
end;
$$;
revoke all on function public.award_referral_reward(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.award_referral_reward(uuid,text,uuid) to service_role;

create or replace function public.process_referral_booking_reward()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='INSERT' then perform public.award_referral_reward(new.customer_id,'customer',new.id); end if;
  if tg_op='UPDATE' and new.status='completed' and old.status is distinct from new.status and new.driver_id is not null then
    perform public.award_referral_reward(new.driver_id,'driver',new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists process_referral_booking_reward on public.bookings;
create trigger process_referral_booking_reward after insert or update of status on public.bookings
for each row execute function public.process_referral_booking_reward();

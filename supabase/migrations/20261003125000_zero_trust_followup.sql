-- Zero-trust follow-up: restrict profile visibility, self-scope role helpers,
-- validate telemetry/input ranges, and remove direct KYC status probing.
drop policy if exists "Profiles: read all authenticated" on public.profiles;
create policy "Profiles: read own or admin"
on public.profiles
for select to authenticated
using (
  (select auth.uid()) = id
  or (select public.has_role((select auth.uid()), 'admin'::public.app_role))
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  if _user_id is distinct from uid
     and not exists (select 1 from public.user_roles where user_id=uid and role='admin'::public.app_role) then
    return false;
  end if;
  return exists (select 1 from public.user_roles where user_id=_user_id and role=_role);
end;
$$;

create or replace function public.is_kyc_approved(_user_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  if _user_id is distinct from uid
     and not exists (select 1 from public.user_roles where user_id=uid and role='admin'::public.app_role) then
    return false;
  end if;
  return exists (
    select 1 from public.driver_kyc
    where driver_id=_user_id and status='approved'::public.kyc_status
  );
end;
$$;

revoke all on function public.is_kyc_approved(uuid) from public, anon, authenticated;

alter table public.driver_locations
  drop constraint if exists driver_locations_latitude_check,
  drop constraint if exists driver_locations_longitude_check,
  drop constraint if exists driver_locations_accuracy_check,
  drop constraint if exists driver_locations_heading_check,
  drop constraint if exists driver_locations_speed_check;
alter table public.driver_locations
  add constraint driver_locations_latitude_check check (latitude between -90 and 90),
  add constraint driver_locations_longitude_check check (longitude between -180 and 180),
  add constraint driver_locations_accuracy_check check (accuracy_m is null or accuracy_m >= 0),
  add constraint driver_locations_heading_check check (heading_deg is null or (heading_deg >= 0 and heading_deg < 360)),
  add constraint driver_locations_speed_check check (speed_mps is null or speed_mps >= 0);

alter table public.bookings
  drop constraint if exists bookings_helper_count_check,
  drop constraint if exists bookings_helper_fee_check,
  drop constraint if exists bookings_cargo_value_check;
alter table public.bookings
  add constraint bookings_helper_count_check check (helper_count between 0 and 2),
  add constraint bookings_helper_fee_check check (helper_fee >= 0),
  add constraint bookings_cargo_value_check check (cargo_value >= 0);

alter table public.device_tokens
  drop constraint if exists device_tokens_token_length_check;
alter table public.device_tokens
  add constraint device_tokens_token_length_check check (char_length(token) between 8 and 4096);

alter table public.referrals
  drop constraint if exists referrals_code_format_check;
alter table public.referrals
  add constraint referrals_code_format_check check (referral_code ~ '^MP[A-Z0-9]{8}$');

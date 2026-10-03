-- Production security regression checks.
-- Run with the Supabase local test runner before a release.
do $$
declare
  t text;
  enabled boolean;
  anon_count integer;
  auth_write_count integer;
begin
  foreach t in array ARRAY[
    'profiles','user_roles','bookings','driver_locations','booking_documents',
    'wallet_accounts','merchant_accounts','merchant_billing_cycles',
    'driver_daily_passes','notifications','device_tokens','referrals'
  ] loop
    select c.relrowsecurity into enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname=t;
    if enabled is not true then
      raise exception 'RLS is disabled on public.%', t;
    end if;
  end loop;

  select count(*) into anon_count
  from information_schema.role_table_grants
  where table_schema='public'
    and grantee='anon'
    and table_name in (
      'profiles','user_roles','bookings','driver_locations','booking_documents',
      'wallet_accounts','merchant_accounts','merchant_billing_cycles',
      'driver_daily_passes','notifications','device_tokens','referrals'
    );
  if anon_count <> 0 then
    raise exception 'Unexpected anon grants remain on MiniPort protected tables: %', anon_count;
  end if;

  select count(*) into auth_write_count
  from information_schema.role_table_grants
  where table_schema='public'
    and grantee='authenticated'
    and privilege_type in ('INSERT','UPDATE','DELETE')
    and table_name in ('wallet_accounts','driver_daily_passes','merchant_billing_cycles','booking_documents');
  if auth_write_count <> 0 then
    raise exception 'Unexpected authenticated write grants remain on server-owned tables: %', auth_write_count;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='driver_locations'
      and policyname='driver_locations_strict_owner_insert'
      and with_check like '%auth.uid%'
  ) then
    raise exception 'driver_locations owner insert policy is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='driver_locations'
      and policyname='driver_locations_strict_owner_update'
      and qual like '%auth.uid%'
      and with_check like '%auth.uid%'
  ) then
    raise exception 'driver_locations owner update policy is missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles'
      and policyname='Profiles: read own or admin'
      and qual like '%auth.uid%'
  ) then
    raise exception 'profiles privacy policy is missing';
  end if;

  if has_function_privilege('authenticated','public.is_kyc_approved(uuid)','EXECUTE') then
    raise exception 'is_kyc_approved should not be directly callable by authenticated clients';
  end if;
end $$;

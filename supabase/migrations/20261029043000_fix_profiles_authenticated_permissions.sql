-- Repair profile API permissions and enforce per-user row access.
-- This migration changes only grants/policies; it does not touch profile or trip records.
alter table public.profiles enable row level security;

grant usage on schema public to authenticated;
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "Allow users to read own profile" on public.profiles;
drop policy if exists "Allow users to insert own profile" on public.profiles;
drop policy if exists "Allow users to update own profile" on public.profiles;
drop policy if exists "Users can view their own profile." on public.profiles;
drop policy if exists "Users can create their own profile." on public.profiles;
drop policy if exists "Users can update their own profile." on public.profiles;

create policy "Allow users to read own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Allow users to insert own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "Allow users to update own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

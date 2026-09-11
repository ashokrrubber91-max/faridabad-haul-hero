create or replace function public.admin_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where role = 'admin')
$$;

revoke all on function public.admin_exists() from public, anon;
grant execute on function public.admin_exists() to authenticated, service_role;

create or replace function public.claim_first_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first';
  end if;
  -- Bootstrap only: allowed exclusively while the platform has no admin at all.
  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'An admin already exists. Ask them to grant you access.';
  end if;

  insert into public.user_roles (user_id, role)
  values (uid, 'admin')
  on conflict (user_id, role) do nothing;

  insert into public.audit_logs (actor_id, action, table_name, row_id, new_data)
  values (uid, 'claim_first_admin', 'user_roles', uid, jsonb_build_object('role', 'admin'));

  return true;
end;
$$;

revoke all on function public.claim_first_admin() from public, anon;
grant execute on function public.claim_first_admin() to authenticated, service_role;
drop function if exists public.claim_first_admin();
drop function if exists public.admin_exists();

create or replace function public.admin_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where role = 'admin')
$$;

create or replace function public.claim_first_admin(_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if _user_id is null then
    raise exception 'Sign in first';
  end if;
  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'An admin already exists. Ask them to grant you access.';
  end if;

  insert into public.user_roles (user_id, role)
  values (_user_id, 'admin')
  on conflict (user_id, role) do nothing;

  insert into public.audit_logs (actor_id, action, table_name, row_id, new_data)
  values (_user_id, 'claim_first_admin', 'user_roles', _user_id, jsonb_build_object('role', 'admin'));

  return true;
end;
$$;

revoke all on function public.admin_exists() from public, anon, authenticated;
revoke all on function public.claim_first_admin(uuid) from public, anon, authenticated;
grant execute on function public.admin_exists() to service_role;
grant execute on function public.claim_first_admin(uuid) to service_role;
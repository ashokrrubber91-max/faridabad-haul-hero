create or replace function public.admin_set_driver_online(_driver_id uuid,_is_online boolean)
returns public.profiles
language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); row public.profiles;
begin
  if uid is null or not public.has_role(uid,'admin'::public.app_role) then raise exception 'Admin only'; end if;
  update public.profiles
  set is_online=_is_online,
      active_mode=case when _is_online then 'driver'::public.active_mode else active_mode end,
      updated_at=now()
  where id=_driver_id
  returning * into row;
  if not found then raise exception 'Driver profile not found'; end if;
  return row;
end;
$$;
revoke all on function public.admin_set_driver_online(uuid,boolean) from public,anon;
grant execute on function public.admin_set_driver_online(uuid,boolean) to authenticated;

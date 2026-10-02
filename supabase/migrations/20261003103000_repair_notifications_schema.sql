-- Production repair: notifications/broadcasts were present in source migrations
-- but absent from the live public schema. Restore the runtime contract used by
-- NotificationsCard and the admin broadcast RPC.

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('customer','driver','all')),
  title text not null check (btrim(title) <> ''),
  body text not null check (btrim(body) <> ''),
  recipient_count integer not null default 0,
  channel text not null default 'in_app',
  sms_status text not null default 'not_configured' check (sms_status in ('not_configured','queued','sent','failed')),
  idempotency_key text unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broadcast_id uuid references public.broadcasts(id) on delete set null,
  title text not null,
  body text not null,
  kind text not null default 'broadcast',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.broadcasts enable row level security;
alter table public.notifications enable row level security;

revoke all on table public.broadcasts from anon;
revoke all on table public.notifications from anon;
revoke all on table public.notifications from authenticated;
grant select on table public.broadcasts to authenticated;
grant select, update (read_at) on table public.notifications to authenticated;
grant all on table public.broadcasts to service_role;
grant all on table public.notifications to service_role;

drop policy if exists "Admins read broadcasts" on public.broadcasts;
create policy "Admins read broadcasts" on public.broadcasts
for select to authenticated
using ((select has_role((select auth.uid()), 'admin'::public.app_role)));

drop policy if exists "People read their own notifications" on public.notifications;
create policy "People read their own notifications" on public.notifications
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select has_role((select auth.uid()), 'admin'::public.app_role))
);

drop policy if exists "People mark their own notifications read" on public.notifications;
create policy "People mark their own notifications read" on public.notifications
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, read_at, created_at desc);
create index if not exists notifications_broadcast_idx
  on public.notifications(broadcast_id);

create or replace function public.admin_send_broadcast(
  _audience text, _title text, _body text, _idempotency_key text default null
)
returns public.broadcasts
language plpgsql security definer set search_path=public
as $$
declare
  bc public.broadcasts;
  n int := 0;
  key text := nullif(btrim(coalesce(_idempotency_key,'')),'');
begin
  if auth.uid() is null or not public.has_role(auth.uid(),'admin'::public.app_role) then
    raise exception 'Only admins can send broadcasts';
  end if;
  if _audience not in ('customer','driver','all') then
    raise exception 'Choose a valid audience';
  end if;
  if btrim(coalesce(_title,''))='' or btrim(coalesce(_body,''))='' then
    raise exception 'Title and message are both required';
  end if;
  if key is not null then
    select * into bc from public.broadcasts where idempotency_key=key;
    if found then return bc; end if;
  end if;

  insert into public.broadcasts(audience,title,body,idempotency_key,created_by)
  values(_audience,left(btrim(_title),120),left(btrim(_body),1000),key,auth.uid())
  returning * into bc;

  with targets as (
    select distinct ur.user_id
    from public.user_roles ur
    where (_audience='all' and ur.role in ('customer'::public.app_role,'driver'::public.app_role))
       or (_audience='customer' and ur.role='customer'::public.app_role)
       or (_audience='driver' and ur.role='driver'::public.app_role)
  ), inserted as (
    insert into public.notifications(user_id,broadcast_id,title,body,kind)
    select t.user_id,bc.id,bc.title,bc.body,'broadcast'
    from targets t
    returning 1
  )
  select count(*) into n from inserted;

  update public.broadcasts
  set recipient_count=n
  where id=bc.id
  returning * into bc;

  return bc;
end;
$$;

revoke all on function public.admin_send_broadcast(text,text,text,text) from public,anon;
grant execute on function public.admin_send_broadcast(text,text,text,text) to authenticated;

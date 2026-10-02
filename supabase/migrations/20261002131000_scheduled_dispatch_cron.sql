create extension if not exists pg_cron;

create or replace function public.process_scheduled_dispatch_jobs()
returns integer language plpgsql security definer set search_path=public
as $$
declare n integer;
begin
  update public.scheduled_dispatch_jobs
  set status='dispatched',updated_at=now()
  where status='queued' and dispatch_at <= now();
  get diagnostics n = row_count;
  return n;
end;$$;
revoke all on function public.process_scheduled_dispatch_jobs() from public,anon,authenticated;
grant execute on function public.process_scheduled_dispatch_jobs() to service_role;

select cron.schedule(
  'miniport-scheduled-dispatch',
  '* * * * *',
  'select public.process_scheduled_dispatch_jobs()'
)
where not exists (select 1 from cron.job where jobname='miniport-scheduled-dispatch');
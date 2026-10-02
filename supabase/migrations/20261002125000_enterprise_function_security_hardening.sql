-- Security hardening for enterprise functions.
revoke all on function public.bookings_apply_enterprise_fare() from public,anon,authenticated;
revoke all on function public.bookings_schedule_dispatch() from public,anon,authenticated;
revoke all on function public.enforce_delivery_pod() from public,anon,authenticated;
revoke all on function public.driver_daily_pass_active(uuid) from public,anon,authenticated;
revoke all on function public.settle_driver_payout(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.settle_driver_payout(uuid,text,text,text) to service_role;

create or replace function public.schedule_booking_dispatch(_booking_id uuid, _scheduled_for timestamptz)
returns public.scheduled_dispatch_jobs language plpgsql security definer set search_path=public
as $$
declare row public.scheduled_dispatch_jobs;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.bookings where id=_booking_id and customer_id=auth.uid()) then raise exception 'Booking not found'; end if;
  insert into public.scheduled_dispatch_jobs(booking_id, dispatch_at, status)
  values(_booking_id, greatest(_scheduled_for - interval '30 minutes', now()), 'queued')
  on conflict (booking_id) do update set dispatch_at=excluded.dispatch_at, status='queued', updated_at=now()
  returning * into row;
  update public.bookings set scheduled_for=_scheduled_for where id=_booking_id and customer_id=auth.uid();
  return row;
end;
$$;

create or replace function public.merchant_monthly_statement(_merchant_id uuid, _start date, _end date)
returns table(bookings integer, subtotal numeric, tax numeric, total numeric)
language plpgsql stable security definer set search_path=public
as $$
begin
  if not exists(select 1 from public.merchant_accounts where id=_merchant_id and user_id=auth.uid()) then
    raise exception 'Merchant account not found';
  end if;
  return query
  select count(*)::int,
         coalesce(sum(b.fare + b.helper_fee + b.insurance_fee),0),
         coalesce(sum(round((b.fare + b.helper_fee + b.insurance_fee) * 0.18)),0),
         coalesce(sum((b.fare + b.helper_fee + b.insurance_fee) * 1.18),0)
  from public.bookings b
  where b.business_account_id = _merchant_id
    and b.status = 'completed'
    and b.created_at::date between _start and _end;
end;
$$;
revoke all on function public.merchant_monthly_statement(uuid,date,date) from public,anon;
grant execute on function public.merchant_monthly_statement(uuid,date,date) to authenticated,service_role;

revoke all on function public.bookings_enforce_insert_financials() from public,anon,authenticated;
revoke all on function public.bookings_protect_financials() from public,anon,authenticated;
revoke all on function public.driver_kyc_force_pending_on_insert() from public,anon,authenticated;
revoke all on function public.driver_kyc_protect_review() from public,anon,authenticated;
revoke all on function public.generate_unique_referral_code() from public,anon,authenticated;
revoke all on function public.process_referral_booking_reward() from public,anon,authenticated;
revoke all on function public.profiles_assign_referral_code() from public,anon,authenticated;
-- Production repair: restore core profile-mode, driver-online and wallet
-- top-up RPCs referenced by the client but missing from the live schema.

create or replace function public.set_my_active_mode(_mode text)
returns public.profiles language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); row public.profiles;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if _mode not in ('customer','driver') then raise exception 'Invalid active mode'; end if;
  if _mode='driver' then
    if not exists(select 1 from public.user_roles where user_id=uid and role='driver') then raise exception 'Driver mode is not enabled'; end if;
    if not exists(select 1 from public.driver_kyc where driver_id=uid and status='approved') then raise exception 'Driver verification must be approved'; end if;
  end if;
  update public.profiles
  set active_mode=_mode::public.active_mode, updated_at=now()
  where id=uid
  returning * into row;
  if not found then raise exception 'Profile not found'; end if;
  return row;
end;
$$;
revoke all on function public.set_my_active_mode(text) from public,anon;
grant execute on function public.set_my_active_mode(text) to authenticated;

create or replace function public.set_my_online(_is_online boolean)
returns public.profiles language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); row public.profiles;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.user_roles where user_id=uid and role='driver') then raise exception 'Driver only'; end if;
  if _is_online and not exists(select 1 from public.driver_kyc where driver_id=uid and status='approved') then
    raise exception 'Driver verification must be approved before going online';
  end if;
  update public.profiles
  set is_online=_is_online,
      active_mode=case when _is_online then 'driver'::public.active_mode else active_mode end,
      updated_at=now()
  where id=uid
  returning * into row;
  if not found then raise exception 'Profile not found'; end if;
  return row;
end;
$$;
revoke all on function public.set_my_online(boolean) from public,anon;
grant execute on function public.set_my_online(boolean) to authenticated;

create or replace function public.credit_driver_wallet_topup(
  _payment_id uuid,_driver_id uuid,_amount numeric,_provider_payment_id text
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare p public.payments%rowtype; new_balance numeric;
begin
  select * into p from public.payments where id=_payment_id for update;
  if not found then raise exception 'Payment record not found'; end if;
  if p.customer_id<>_driver_id or p.method<>'wallet_topup' or p.booking_id is not null then
    raise exception 'Invalid wallet top-up payment';
  end if;
  if abs(p.amount-_amount)>0.01 then raise exception 'Top-up amount mismatch'; end if;
  if p.state='paid' then
    select cash_balance into new_balance from public.wallet_accounts where user_id=_driver_id;
    return jsonb_build_object('ok',true,'already_credited',true,'balance',coalesce(new_balance,0));
  end if;
  if p.state<>'created' then raise exception 'Payment is not payable'; end if;
  insert into public.wallet_accounts(user_id,cash_balance,coins_balance)
  values(_driver_id,_amount,0)
  on conflict(user_id) do update set cash_balance=public.wallet_accounts.cash_balance+excluded.cash_balance,updated_at=now()
  returning cash_balance into new_balance;
  insert into public.wallet_transactions(user_id,delta,reason)
  values(_driver_id,_amount,'Online wallet top-up');
  update public.payments
  set state='paid',provider_payment_id=_provider_payment_id,method='wallet_topup',updated_at=now()
  where id=_payment_id;
  return jsonb_build_object('ok',true,'already_credited',false,'balance',new_balance);
end;
$$;
revoke all on function public.credit_driver_wallet_topup(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.credit_driver_wallet_topup(uuid,uuid,numeric,text) to service_role;

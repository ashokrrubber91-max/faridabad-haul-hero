-- Reserve and settle driver instant payouts atomically.
create or replace function public.reserve_driver_payout(_amount numeric,_method text,_upi_id text default null,_bank_account_id uuid default null)
returns public.driver_payouts
language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid(); balance numeric; row public.driver_payouts;
begin
 if uid is null then raise exception 'Not authenticated'; end if;
 if not exists(select 1 from public.user_roles where user_id=uid and role='driver') then raise exception 'Driver only'; end if;
 if _amount <= 0 then raise exception 'Invalid amount'; end if;
 select cash_balance into balance from public.wallet_accounts where user_id=uid for update;
 if coalesce(balance,0) < _amount then raise exception 'Insufficient wallet balance'; end if;
 insert into public.driver_payouts(driver_id,amount,method,upi_id,bank_account_id,status)
 values(uid,_amount,coalesce(_method,'upi'),_upi_id,_bank_account_id,'processing')
 returning * into row;
 update public.wallet_accounts set cash_balance=cash_balance-_amount,updated_at=now() where user_id=uid;
 insert into public.wallet_transactions(user_id,delta,reason) values(uid,-_amount,'Instant payout reserved');
 return row;
end;$$;
revoke all on function public.reserve_driver_payout(numeric,text,text,uuid) from public,anon;
grant execute on function public.reserve_driver_payout(numeric,text,text,uuid) to authenticated,service_role;

create or replace function public.settle_driver_payout(_payout_id uuid,_status text,_provider_payout_id text default null,_error text default null)
returns public.driver_payouts
language plpgsql security definer set search_path=public
as $$
declare row public.driver_payouts; refund numeric;
begin
 select * into row from public.driver_payouts where id=_payout_id for update;
 if not found then raise exception 'Payout not found'; end if;
 if row.status='paid' and _status='paid' then return row; end if;
 refund:=case when _status='failed' then row.amount else 0 end;
 update public.driver_payouts set status=_status,provider_payout_id=coalesce(_provider_payout_id,provider_payout_id),error=_error,updated_at=now() where id=_payout_id returning * into row;
 if refund>0 then
   update public.wallet_accounts set cash_balance=cash_balance+refund,updated_at=now() where user_id=row.driver_id;
   insert into public.wallet_transactions(user_id,delta,reason) values(row.driver_id,refund,'Instant payout failed — refunded');
 end if;
 return row;
end;$$;
revoke all on function public.settle_driver_payout(uuid,text,text,text) from public,anon;
grant execute on function public.settle_driver_payout(uuid,text,text,text) to authenticated,service_role;
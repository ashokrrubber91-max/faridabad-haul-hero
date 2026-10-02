-- Daily Pass: active 24h pass changes completed-trip commission to 0%.
create or replace function public.bookings_award_coins()
returns trigger language plpgsql security definer set search_path=public
as $function$
declare award numeric; commission numeric; net numeric; pass_active boolean;
begin
  if new.status='completed' and old.status is distinct from 'completed' then
    award := round(new.fare * 0.02);
    insert into public.wallet_accounts(user_id,coins_balance) values(new.customer_id,award)
      on conflict(user_id) do update set coins_balance=wallet_accounts.coins_balance+award,updated_at=now();
    insert into public.wallet_transactions(user_id,booking_id,delta,reason)
      values(new.customer_id,new.id,award,'Earned on trip');
    if new.coins_redeemed > 0 then
      insert into public.wallet_transactions(user_id,booking_id,delta,reason)
        values(new.customer_id,new.id,-new.coins_redeemed,'Redeemed on trip');
    end if;
    if new.driver_id is not null then
      pass_active := public.driver_daily_pass_active(new.driver_id);
      commission := case when pass_active then 0 else round(new.fare * coalesce(new.commission_rate,0.10)) end;
      net := new.fare - commission;
      new.commission_amount := commission;
      new.driver_net_earning := net;
      new.commission_rate := case when pass_active then 0 else coalesce(new.commission_rate,0.10) end;
      insert into public.wallet_accounts(user_id,coins_balance) values(new.driver_id,0)
        on conflict(user_id) do nothing;
      if new.payment_method='cod' then
        update public.wallet_accounts set cash_balance=cash_balance-commission,updated_at=now() where user_id=new.driver_id;
        insert into public.wallet_transactions(user_id,booking_id,delta,reason)
          values(new.driver_id,new.id,-commission,case when pass_active then 'Daily Pass — 0% commission (cash trip)' else 'Miniport commission (cash trip)' end);
      else
        update public.wallet_accounts set cash_balance=cash_balance+net,updated_at=now() where user_id=new.driver_id;
        insert into public.wallet_transactions(user_id,booking_id,delta,reason)
          values(new.driver_id,new.id,net,case when pass_active then 'Trip earning — Daily Pass (0% commission)' else 'Trip earning (online payment)' end);
      end if;
    end if;
  end if;
  return new;
end
$function$;
-- Harden driver wallet withdrawals:
-- 1) reserve cash atomically with a row lock when requesting
-- 2) refund the reserved cash atomically when an admin rejects
-- 3) keep admin approval protected by a row lock and UTR/reason validation

create or replace function public.request_wallet_withdrawal(p_amount numeric, p_upi_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_driver_id uuid := auth.uid();
  v_request public.withdrawal_requests;
  v_upi text := btrim(coalesce(p_upi_id, ''));
  v_cash numeric;
begin
  if v_driver_id is null then
    raise exception 'Please sign in again';
  end if;

  if not public.has_role(v_driver_id, 'driver'::public.app_role) then
    raise exception 'Only driver partners can withdraw';
  end if;

  if p_amount is null or p_amount < 100 then
    raise exception 'Minimum withdrawal is ₹100';
  end if;

  if p_amount > 100000 then
    raise exception 'Maximum withdrawal is ₹100,000 per request';
  end if;

  if v_upi !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$' then
    raise exception 'Enter a valid UPI ID';
  end if;

  insert into public.wallet_accounts(user_id, coins_balance, cash_balance)
  values (v_driver_id, 0, 0)
  on conflict (user_id) do nothing;

  select cash_balance
    into v_cash
    from public.wallet_accounts
   where user_id = v_driver_id
   for update;

  if coalesce(v_cash, 0) < round(p_amount, 2) then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.wallet_accounts
     set cash_balance = cash_balance - round(p_amount, 2),
         updated_at = now()
   where user_id = v_driver_id;

  insert into public.wallet_transactions(user_id, delta, reason)
  values (v_driver_id, -round(p_amount, 2), 'Withdrawal requested');

  insert into public.withdrawal_requests(
    driver_id, amount, method, status, note, upi_id
  )
  values (
    v_driver_id, round(p_amount, 2), 'upi',
    'requested'::public.withdrawal_status,
    'UPI: ' || v_upi,
    v_upi
  )
  returning * into v_request;

  return jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'amount', v_request.amount,
    'upi_id', v_request.upi_id,
    'status', v_request.status,
    'remaining_balance',
      (select cash_balance from public.wallet_accounts where user_id = v_driver_id)
  );
end;
$function$;

create or replace function public.process_withdrawal_admin(
  p_request_id uuid,
  p_status text,
  p_utr_number text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin uuid := auth.uid();
  v_request public.withdrawal_requests;
  v_status public.withdrawal_status;
  v_utr text := nullif(btrim(coalesce(p_utr_number, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_title text;
  v_body text;
begin
  if v_admin is null or not public.has_role(v_admin, 'admin'::public.app_role) then
    raise exception 'Only MiniPort admins can process withdrawals';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid payout status';
  end if;

  if p_status = 'approved' then
    v_status := 'paid'::public.withdrawal_status;
    if v_utr is null then
      raise exception 'UTR / transaction reference is required';
    end if;
  else
    v_status := 'rejected'::public.withdrawal_status;
    if v_reason is null then
      raise exception 'Rejection reason is required';
    end if;
  end if;

  select *
    into v_request
    from public.withdrawal_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'Withdrawal request not found';
  end if;

  if v_request.status <> 'requested'::public.withdrawal_status then
    raise exception 'This withdrawal has already been processed';
  end if;

  if v_status = 'rejected'::public.withdrawal_status then
    insert into public.wallet_accounts(user_id, coins_balance, cash_balance)
    values (v_request.driver_id, 0, 0)
    on conflict (user_id) do nothing;

    update public.wallet_accounts
       set cash_balance = cash_balance + v_request.amount,
           updated_at = now()
     where user_id = v_request.driver_id;

    insert into public.wallet_transactions(user_id, delta, reason)
    values (
      v_request.driver_id,
      v_request.amount,
      'Withdrawal rejected — refund'
    );
  end if;

  update public.withdrawal_requests
     set status = v_status,
         utr_number = case when v_status = 'paid'::public.withdrawal_status then v_utr else null end,
         rejection_reason = case when v_status = 'rejected'::public.withdrawal_status then v_reason else null end,
         processed_at = now()
   where id = p_request_id
   returning * into v_request;

  if v_status = 'paid'::public.withdrawal_status then
    v_title := 'Withdrawal approved';
    v_body := 'Your withdrawal of ₹' || round(v_request.amount, 0)::text ||
              ' has been approved. UTR: ' || v_request.utr_number;
  else
    v_title := 'Withdrawal rejected';
    v_body := 'Your withdrawal of ₹' || round(v_request.amount, 0)::text ||
              ' was rejected. ' || v_request.rejection_reason ||
              ' The amount has been returned to your wallet.';
  end if;

  insert into public.notifications(user_id, title, body, kind)
  values (v_request.driver_id, v_title, v_body, 'withdrawal');

  return jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'status', v_request.status,
    'amount', v_request.amount,
    'utr_number', v_request.utr_number,
    'rejection_reason', v_request.rejection_reason
  );
end;
$function$;

revoke execute on function public.request_wallet_withdrawal(numeric, text) from public, anon;
grant execute on function public.request_wallet_withdrawal(numeric, text) to authenticated;

revoke execute on function public.process_withdrawal_admin(uuid, text, text, text) from public, anon;
grant execute on function public.process_withdrawal_admin(uuid, text, text, text) to authenticated;

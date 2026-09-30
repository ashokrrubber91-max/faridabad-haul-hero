create table if not exists public.wallet_topup_requests (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0 and amount <= 100000),
  method text not null check (method in ('upi','bank_transfer','cash')),
  reference text,
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wallet_topup_requests_driver_created_idx
  on public.wallet_topup_requests(driver_id, created_at desc);

create index if not exists wallet_topup_requests_status_created_idx
  on public.wallet_topup_requests(status, created_at desc);

alter table public.wallet_topup_requests enable row level security;

drop policy if exists "Drivers can view own topup requests" on public.wallet_topup_requests;
create policy "Drivers can view own topup requests"
on public.wallet_topup_requests
for select to authenticated
using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists "Drivers can create own topup requests" on public.wallet_topup_requests;
create policy "Drivers can create own topup requests"
on public.wallet_topup_requests
for insert to authenticated
with check (
  driver_id = auth.uid()
  and public.has_role(auth.uid(), 'driver')
  and status = 'pending'
);

drop policy if exists "Admins can update topup requests" on public.wallet_topup_requests;
create policy "Admins can update topup requests"
on public.wallet_topup_requests
for update to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create or replace function public.admin_review_wallet_topup(
  _request_id uuid,
  _decision text,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.wallet_topup_requests%rowtype;
  new_balance numeric(12,2);
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Admin access required';
  end if;

  if _decision not in ('approved','rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into req
  from public.wallet_topup_requests
  where id = _request_id
  for update;

  if not found then
    raise exception 'Top-up request not found';
  end if;

  if req.status <> 'pending' then
    raise exception 'Top-up request is already processed';
  end if;

  if _decision = 'approved' then
    insert into public.wallet_accounts(user_id, cash_balance, coins_balance)
    values (req.driver_id, req.amount, 0)
    on conflict (user_id) do update
      set cash_balance = public.wallet_accounts.cash_balance + excluded.cash_balance;

    select cash_balance into new_balance
    from public.wallet_accounts
    where user_id = req.driver_id;

    insert into public.wallet_transactions(user_id, delta, reason)
    values (req.driver_id, req.amount, 'Wallet top-up approved');

    update public.wallet_topup_requests
    set status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        note = coalesce(_note, note)
    where id = req.id;
  else
    update public.wallet_topup_requests
    set status = 'rejected',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        note = coalesce(_note, note)
    where id = req.id;
  end if;

  insert into public.audit_logs(actor_id, action, table_name, row_id, new_data)
  values (
    auth.uid(),
    'admin_review_wallet_topup',
    'wallet_topup_requests',
    req.id,
    jsonb_build_object(
      'decision', _decision,
      'amount', req.amount,
      'driver_id', req.driver_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'status', _decision,
    'balance', new_balance
  );
end;
$$;

revoke all on function public.admin_review_wallet_topup(uuid,text,text) from public, anon, authenticated;
grant execute on function public.admin_review_wallet_topup(uuid,text,text) to authenticated, service_role;

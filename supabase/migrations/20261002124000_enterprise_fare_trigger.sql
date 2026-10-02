-- Apply helper and insurance charges after the base fare trigger computes discounts.
create or replace function public.bookings_apply_enterprise_fare()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  new.helper_count := greatest(least(coalesce(new.helper_count,0),2),0);
  new.helper_fee := case when new.helper_count=1 then 250 when new.helper_count=2 then 500 else 0 end;
  new.insurance_opted := coalesce(new.insurance_opted,false);
  new.insurance_fee := case when new.insurance_opted then 10 else 0 end;
  new.insurance_limit := case when new.insurance_opted then 50000 else 0 end;
  if coalesce(new.cargo_value,0) > 50000 and nullif(btrim(coalesce(new.eway_bill_number,'')),'') is null then
    raise exception 'E-Way Bill number is required for cargo above ₹50,000';
  end if;
  new.fare := greatest(coalesce(new.fare,0) + new.helper_fee + new.insurance_fee,0);
  return new;
end;
$$;
drop trigger if exists zz_bookings_apply_enterprise_fare on public.bookings;
create trigger zz_bookings_apply_enterprise_fare before insert on public.bookings
for each row execute function public.bookings_apply_enterprise_fare();
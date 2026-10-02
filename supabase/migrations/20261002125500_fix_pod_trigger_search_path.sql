create or replace function public.enforce_delivery_pod()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 if new.status='completed' and old.status is distinct from 'completed' then
   if nullif(new.pod_photo_url,'') is null then raise exception 'Delivery photo is required before completing the trip'; end if;
   if nullif(new.pod_signature_url,'') is null then raise exception 'Customer digital signature is required before completing the trip'; end if;
 end if;
 return new;
end;$$;
revoke all on function public.enforce_delivery_pod() from public,anon,authenticated;
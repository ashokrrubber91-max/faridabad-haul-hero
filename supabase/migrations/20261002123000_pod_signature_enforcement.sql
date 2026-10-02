-- Enforce digital POD signature + photo before trip completion.
create or replace function public.attach_delivery_signature(_booking_id uuid,_signature_path text)
returns boolean language plpgsql security definer set search_path=public
as $$
declare uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Not authenticated'; end if;
 if not exists(select 1 from public.bookings where id=_booking_id and driver_id=uid and status in ('in_progress','completed')) then raise exception 'Only the assigned driver can attach delivery signature'; end if;
 update public.bookings set pod_signature_url=_signature_path,updated_at=now() where id=_booking_id;
 insert into public.booking_documents(booking_id,document_type,storage_path,created_by) values(_booking_id,'pod_signature',_signature_path,uid);
 return true;
end;$$;
revoke all on function public.attach_delivery_signature(uuid,text) from public,anon;
grant execute on function public.attach_delivery_signature(uuid,text) to authenticated,service_role;

create or replace function public.enforce_delivery_pod()
returns trigger language plpgsql
as $$
begin
 if new.status='completed' and old.status is distinct from 'completed' then
   if nullif(new.pod_photo_url,'') is null then raise exception 'Delivery photo is required before completing the trip'; end if;
   if nullif(new.pod_signature_url,'') is null then raise exception 'Customer digital signature is required before completing the trip'; end if;
 end if;
 return new;
end;$$;
drop trigger if exists trg_enforce_delivery_pod on public.bookings;
create trigger trg_enforce_delivery_pod before update of status on public.bookings for each row execute function public.enforce_delivery_pod();
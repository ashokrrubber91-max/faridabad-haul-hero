-- Private storage buckets required by current MiniPort driver/KYC/POD flows.
insert into storage.buckets (id,name,public) values
  ('pod-files','pod-files',false),
  ('driver-kyc','driver-kyc',false)
on conflict (id) do update set public=false;

drop policy if exists pod_files_owner_insert on storage.objects;
create policy pod_files_owner_insert on storage.objects as restrictive for insert to authenticated
with check (bucket_id='pod-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists pod_files_owner_select on storage.objects;
create policy pod_files_owner_select on storage.objects as restrictive for select to authenticated
using (bucket_id='pod-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists pod_files_owner_update on storage.objects;
create policy pod_files_owner_update on storage.objects as restrictive for update to authenticated
using (bucket_id='pod-files' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check (bucket_id='pod-files' and (storage.foldername(name))[1]=(select auth.uid())::text);

drop policy if exists driver_kyc_owner_insert on storage.objects;
create policy driver_kyc_owner_insert on storage.objects as restrictive for insert to authenticated
with check (bucket_id='driver-kyc' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists driver_kyc_owner_select on storage.objects;
create policy driver_kyc_owner_select on storage.objects as restrictive for select to authenticated
using (bucket_id='driver-kyc' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists driver_kyc_owner_update on storage.objects;
create policy driver_kyc_owner_update on storage.objects as restrictive for update to authenticated
using (bucket_id='driver-kyc' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check (bucket_id='driver-kyc' and (storage.foldername(name))[1]=(select auth.uid())::text);

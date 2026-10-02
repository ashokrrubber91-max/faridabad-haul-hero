-- Align POD signature storage with the pod-files bucket used by delivery photos.
insert into storage.buckets (id, name, public)
values ('pod-files', 'pod-files', false)
on conflict (id) do nothing;

drop policy if exists pod_files_insert on storage.objects;
create policy pod_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists pod_files_select on storage.objects;
create policy pod_files_select on storage.objects
for select to authenticated
using (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists pod_files_update on storage.objects;
create policy pod_files_update on storage.objects
for update to authenticated
using (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists pod_files_delete on storage.objects;
create policy pod_files_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

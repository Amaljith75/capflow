-- Capflow · 0005 · private storage bucket for invoice attachments
-- Object path convention: <organisation_id>/<invoice_id>/<file name>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-files', 'invoice-files', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy invoice_files_select on storage.objects for select to authenticated
  using (bucket_id = 'invoice-files' and app.is_org_member(((storage.foldername(name))[1])::uuid));
create policy invoice_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invoice-files' and app.has_min_role(((storage.foldername(name))[1])::uuid, 'accountant'));
create policy invoice_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'invoice-files' and app.has_min_role(((storage.foldername(name))[1])::uuid, 'accountant'));

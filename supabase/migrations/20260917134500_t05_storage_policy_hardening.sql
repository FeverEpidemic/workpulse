-- Keep browser roles out of the WorkPulse bucket even when unrelated
-- permissive Storage policies exist.

begin;

drop policy if exists workpulse_private_server_only on storage.objects;

create policy workpulse_private_server_only
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id <> 'workpulse-private')
with check (bucket_id <> 'workpulse-private');

commit;

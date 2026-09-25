-- Terminal scan jobs deliberately scrub payloads. Validate active payloads only;
-- the existing terminal_payload_check enforces the scrubbed terminal representation.
alter table internal.evidence_scan_jobs
  drop constraint evidence_scan_jobs_key_owner_check,
  drop constraint evidence_scan_jobs_bytes_check,
  drop constraint evidence_scan_jobs_mime_check;
alter table internal.evidence_scan_jobs
  add constraint evidence_scan_jobs_key_owner_check check (
    status not in ('queued','running') or (
      object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/evidence/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(object_key,'/',1)=user_id::text
      and split_part(object_key,'/',3)=evidence_id::text
    )
  ),
  add constraint evidence_scan_jobs_bytes_check check (status not in ('queued','running') or expected_bytes between 1 and 10485760),
  add constraint evidence_scan_jobs_mime_check check (status not in ('queued','running') or mime_type in (
    'application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ));

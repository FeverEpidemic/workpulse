-- Evidence worker must not claim import/export cleanup jobs.
create or replace function public.claim_evidence_cleanup_jobs(p_limit integer default 1)
returns table (
  id uuid, user_id uuid, bucket_id text, object_key text, kind text, status text,
  attempt_count integer, attempt_token uuid, lease_expires_at timestamptz,
  next_attempt_at timestamptz, error_code text, created_at timestamptz,
  updated_at timestamptz, finished_at timestamptz, evidence_id uuid,
  evidence_bytes bigint, evidence_sha256 text, evidence_mime_type text,
  evidence_original_name text, evidence_parent_kind text, evidence_parent_id uuid,
  last_error_code text
)
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_CLEANUP_CLAIM';
  end if;
  return query
  with candidates as (
    select queued.id from internal.storage_jobs as queued
    where queued.bucket_id = 'workpulse-private'
      and split_part(queued.object_key, '/', 2) = 'evidence'
      and queued.next_attempt_at <= clock_timestamp()
      and (queued.status = 'queued' or (queued.status = 'running' and queued.lease_expires_at <= clock_timestamp()))
    order by queued.next_attempt_at, queued.created_at, queued.id
    for update of queued skip locked limit p_limit
  ), claimed as (
    update internal.storage_jobs as queued
    set status = 'running', attempt_count = queued.attempt_count + 1,
        attempt_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '120 seconds',
        error_code = null, finished_at = null, updated_at = clock_timestamp()
    from candidates where queued.id = candidates.id returning queued.*
  )
  select job.id, job.user_id, job.bucket_id, job.object_key, job.kind, job.status,
    job.attempt_count, job.attempt_token, job.lease_expires_at, job.next_attempt_at,
    job.error_code, job.created_at, job.updated_at, job.finished_at, job.evidence_id,
    job.evidence_bytes, job.evidence_sha256, job.evidence_mime_type,
    job.evidence_original_name, job.evidence_parent_kind, job.evidence_parent_id,
    job.last_error_code
  from claimed as job;
end;
$$;


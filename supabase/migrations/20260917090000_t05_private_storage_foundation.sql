-- T05 private storage foundation.
-- Storage objects are available only through server-authorized operations.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'workpulse-private',
  'workpulse-private',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Remove any earlier policy that named or referenced this bucket. No client
-- Storage policy is needed because every request is authorized by a server adapter.
do $migration$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        policyname ilike '%workpulse-private%'
        or coalesce(qual, '') ilike '%workpulse-private%'
        or coalesce(with_check, '') ilike '%workpulse-private%'
      )
  loop
    execute format('drop policy %I on storage.objects', v_policy.policyname);
  end loop;
end;
$migration$;

revoke all privileges on table storage.objects, storage.buckets from public, anon, authenticated;
grant all privileges on table storage.objects, storage.buckets to service_role;

create table internal.storage_jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null,
  bucket_id text not null default 'workpulse-private',
  object_key text not null,
  kind text not null default 'delete',
  status text not null default 'queued',
  attempt_count integer not null default 0,
  attempt_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default pg_catalog.transaction_timestamp(),
  error_code text,
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  updated_at timestamptz not null default pg_catalog.transaction_timestamp(),
  finished_at timestamptz,
  constraint storage_jobs_bucket_check
    check (bucket_id = 'workpulse-private'),
  constraint storage_jobs_key_owner_check
    check (
      object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(import|evidence|export)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and pg_catalog.split_part(object_key, '/', 1) = user_id::text
    ),
  constraint storage_jobs_kind_check
    check (kind = 'delete'),
  constraint storage_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  constraint storage_jobs_attempt_count_check
    check (attempt_count >= 0),
  constraint storage_jobs_error_code_check
    check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint storage_jobs_state_check
    check (
      (
        status = 'queued'
        and attempt_token is null
        and lease_expires_at is null
        and finished_at is null
        and error_code is null
      )
      or (
        status = 'running'
        and attempt_count > 0
        and attempt_token is not null
        and lease_expires_at is not null
        and finished_at is null
        and error_code is null
      )
      or (
        status = 'succeeded'
        and attempt_count > 0
        and attempt_token is not null
        and lease_expires_at is null
        and finished_at is not null
        and error_code is null
      )
      or (
        status = 'failed'
        and attempt_count > 0
        and attempt_token is not null
        and lease_expires_at is null
        and finished_at is not null
        and error_code is not null
      )
    ),
  constraint storage_jobs_timestamp_check
    check (updated_at >= created_at and (finished_at is null or finished_at >= created_at)),
  constraint storage_jobs_object_kind_key
    unique (bucket_id, object_key, kind)
);

comment on table internal.storage_jobs is
  'Durable private-object cleanup receipts. This queue intentionally has no foreign keys to profiles or parent records.';
comment on column internal.storage_jobs.user_id is
  'Owner identifier retained for authorization and audit; deliberately has no profile foreign key.';
comment on column internal.storage_jobs.object_key is
  'Canonical owner/category/object UUID key. It contains no filename or user-controlled path segment.';
comment on column internal.storage_jobs.attempt_token is
  'Fresh token for each claimed lease; completion requires the current token and an unexpired lease.';
comment on column internal.storage_jobs.lease_expires_at is
  'Claim lease deadline. Claims expire after 120 seconds and can be reclaimed atomically.';
comment on column internal.storage_jobs.error_code is
  'Allowlisted safe provider or worker code only; never store filenames, secrets, or object content.';

alter table internal.storage_jobs enable row level security;
revoke all privileges on table internal.storage_jobs from public, anon, authenticated, service_role;

create index storage_jobs_claim_idx
  on internal.storage_jobs (next_attempt_at, created_at, id)
  where status in ('queued', 'running');

create or replace function internal.enqueue_storage_delete(
  p_user_id uuid,
  p_object_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
declare
  v_job_id uuid;
begin
  if p_user_id is null
     or p_object_key is null
     or p_object_key !~ ('^' || p_user_id::text || '/(import|evidence|export)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode = '22023', message = 'INVALID_STORAGE_JOB_INPUT';
  end if;

  insert into internal.storage_jobs (user_id, object_key)
  values (p_user_id, p_object_key)
  on conflict (bucket_id, object_key, kind) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select job.id
    into v_job_id
    from internal.storage_jobs as job
    where job.bucket_id = 'workpulse-private'
      and job.object_key = p_object_key
      and job.kind = 'delete';
  end if;

  return v_job_id;
end;
$$;

comment on function internal.enqueue_storage_delete(uuid, text) is
  'Idempotently record a private-object delete request without a parent or profile foreign key.';

create or replace function internal.claim_storage_jobs(p_limit integer default 1)
returns setof internal.storage_jobs
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'INVALID_STORAGE_JOB_CLAIM_LIMIT';
  end if;

  return query
  with candidates as (
    select job.id
    from internal.storage_jobs as job
    where job.next_attempt_at <= pg_catalog.clock_timestamp()
      and (
        job.status = 'queued'
        or (job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp())
      )
    order by job.next_attempt_at, job.created_at, job.id
    for update of job skip locked
    limit p_limit
  ),
  claimed as (
    update internal.storage_jobs as job
    set status = 'running',
        attempt_count = job.attempt_count + 1,
        attempt_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds',
        error_code = null,
        finished_at = null,
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select claimed.*
  from claimed
  order by claimed.next_attempt_at, claimed.created_at, claimed.id;
end;
$$;

comment on function internal.claim_storage_jobs(integer) is
  'Atomically claim queued or expired cleanup work using skip-locked ordering and a fresh 120-second lease token.';

create or replace function internal.complete_storage_job(
  p_job_id uuid,
  p_attempt_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if p_job_id is null or p_attempt_token is null then
    return false;
  end if;

  update internal.storage_jobs as job
  set status = 'succeeded',
      lease_expires_at = null,
      error_code = null,
      finished_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where job.id = p_job_id
    and job.status = 'running'
    and job.attempt_token = p_attempt_token
    and job.lease_expires_at > pg_catalog.clock_timestamp();

  return found;
end;
$$;

comment on function internal.complete_storage_job(uuid, uuid) is
  'Complete only the current unexpired lease attempt for a cleanup job.';

create or replace function internal.fail_storage_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if p_job_id is null
     or p_attempt_token is null
     or p_error_code is null
     or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception using errcode = '22023', message = 'INVALID_STORAGE_JOB_FAILURE';
  end if;

  update internal.storage_jobs as job
  set status = 'failed',
      lease_expires_at = null,
      error_code = p_error_code,
      finished_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where job.id = p_job_id
    and job.status = 'running'
    and job.attempt_token = p_attempt_token
    and job.lease_expires_at > pg_catalog.clock_timestamp();

  return found;
end;
$$;

comment on function internal.fail_storage_job(uuid, uuid, text) is
  'Fail only the current unexpired lease attempt using a safe allowlisted error code.';

create or replace function internal.retry_storage_job(
  p_job_id uuid,
  p_next_attempt_at timestamptz default pg_catalog.clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if p_job_id is null or p_next_attempt_at is null then
    raise exception using errcode = '22023', message = 'INVALID_STORAGE_JOB_RETRY';
  end if;

  update internal.storage_jobs as job
  set status = 'queued',
      attempt_token = null,
      lease_expires_at = null,
      next_attempt_at = p_next_attempt_at,
      error_code = null,
      finished_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where job.id = p_job_id
    and job.status = 'failed';

  return found;
end;
$$;

comment on function internal.retry_storage_job(uuid, timestamptz) is
  'Explicitly return a failed cleanup job to the queue; it never retries terminal work implicitly.';

revoke all privileges on function internal.enqueue_storage_delete(uuid, text) from public, anon, authenticated;
revoke all privileges on function internal.claim_storage_jobs(integer) from public, anon, authenticated;
revoke all privileges on function internal.complete_storage_job(uuid, uuid) from public, anon, authenticated;
revoke all privileges on function internal.fail_storage_job(uuid, uuid, text) from public, anon, authenticated;
revoke all privileges on function internal.retry_storage_job(uuid, timestamptz) from public, anon, authenticated;

grant execute on function internal.enqueue_storage_delete(uuid, text) to service_role;
grant execute on function internal.claim_storage_jobs(integer) to service_role;
grant execute on function internal.complete_storage_job(uuid, uuid) to service_role;
grant execute on function internal.fail_storage_job(uuid, uuid, text) to service_role;
grant execute on function internal.retry_storage_job(uuid, timestamptz) to service_role;

commit;

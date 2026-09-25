-- T10 Evidence reservation, private metadata, and screening backend.
-- Forward-only extension of the canonical evidence schema in Database Schema §4/§6.

begin;

-- The scan queue deliberately has no profile, parent, or evidence FK. A source or account
-- deletion can therefore preserve the active lease receipt until the worker observes it.
create table internal.evidence_scan_jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null,
  evidence_id uuid not null,
  object_key text not null,
  expected_bytes bigint not null,
  mime_type text not null,
  sha256 text not null,
  status text not null default 'queued',
  result text,
  attempt_count integer not null default 0,
  attempt_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  error_code text,
  last_error_code text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  finished_at timestamptz,
  constraint evidence_scan_jobs_key_owner_check check (
    object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/evidence/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and pg_catalog.split_part(object_key, '/', 1) = user_id::text
    and pg_catalog.split_part(object_key, '/', 3) = evidence_id::text
  ),
  constraint evidence_scan_jobs_bytes_check check (expected_bytes between 1 and 10485760),
  constraint evidence_scan_jobs_mime_check check (mime_type in (
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  constraint evidence_scan_jobs_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint evidence_scan_jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint evidence_scan_jobs_result_check check (result is null or result in ('clean', 'rejected', 'superseded')),
  constraint evidence_scan_jobs_attempt_check check (attempt_count >= 0),
  constraint evidence_scan_jobs_error_check check (
    (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
    and (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
  ),
  constraint evidence_scan_jobs_state_check check (
    (
      status = 'queued' and attempt_token is null and lease_expires_at is null
      and error_code is null and result is null and finished_at is null
    )
    or (
      status = 'running' and attempt_count > 0 and attempt_token is not null
      and lease_expires_at is not null and error_code is null and result is null
      and finished_at is null
    )
    or (
      status = 'succeeded' and attempt_count > 0 and attempt_token is not null
      and lease_expires_at is null and error_code is null and result is not null
      and finished_at is not null
    )
    or (
      status = 'failed' and attempt_count > 0 and attempt_token is not null
      and lease_expires_at is null and error_code is not null and result is null
      and finished_at is not null
    )
    or (
      status = 'cancelled' and attempt_token is not null
      and lease_expires_at is null and error_code is not null and result is null
      and finished_at is not null
    )
  ),
  constraint evidence_scan_jobs_terminal_payload_check check (
    status in ('queued', 'running')
    or (object_key = '' and expected_bytes = 0 and mime_type = '' and sha256 = repeat('0', 64))
  ),
  constraint evidence_scan_jobs_timestamp_check check (
    updated_at >= created_at and (finished_at is null or finished_at >= created_at)
  ),
  constraint evidence_scan_jobs_evidence_key unique (evidence_id)
);

comment on table internal.evidence_scan_jobs is
  'Durable malware-screening queue. It intentionally has no profile, parent, or evidence FK so an active lease remains revocable after source deletion.';
comment on column internal.evidence_scan_jobs.attempt_token is
  'Fresh per-claim token; completion and retry require the current unexpired 120-second lease.';
comment on column internal.evidence_scan_jobs.last_error_code is
  'Safe code from the last transient scanner error, retained after the job is re-queued.';

alter table internal.evidence_scan_jobs enable row level security;
revoke all privileges on table internal.evidence_scan_jobs from public, anon, authenticated, service_role;

create index evidence_scan_jobs_claim_idx
  on internal.evidence_scan_jobs (next_attempt_at, created_at, id)
  where status in ('queued', 'running');

-- Minimal immutable operation receipts survive terminal upload failure and canonical
-- metadata deletion. No filename, MIME, parent, or object content is copied here.
create table internal.evidence_reservation_requests (
  user_id uuid not null,
  idempotency_key uuid not null,
  payload_hash bytea not null,
  evidence_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint evidence_reservation_requests_pk primary key (user_id, idempotency_key),
  constraint evidence_reservation_requests_hash_check check (pg_catalog.octet_length(payload_hash) = 32)
);
comment on table internal.evidence_reservation_requests is
  'Minimal no-FK idempotency receipt; it keeps the payload conflict check after account or parent cleanup without retaining filenames or file metadata.';
alter table internal.evidence_reservation_requests enable row level security;
revoke all privileges on table internal.evidence_reservation_requests from public, anon, authenticated, service_role;

create table public.evidence_files (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid,
  achievement_id uuid,
  project_id uuid,
  object_key text not null,
  original_name text not null,
  mime_type text not null,
  bytes bigint not null,
  actual_bytes bigint,
  sha256 text,
  status text not null default 'uploading',
  error_code text,
  reserved_until timestamptz,
  parent_revision integer not null,
  revision integer not null default 1,
  idempotency_key uuid not null,
  payload_hash bytea not null,
  finalize_payload_hash bytea,
  scan_job_id uuid references internal.evidence_scan_jobs(id) on delete set null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint evidence_files_user_id_id_key unique (user_id, id),
  constraint evidence_files_object_key_key unique (object_key),
  constraint evidence_files_owner_key_check check (
    object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/evidence/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and pg_catalog.split_part(object_key, '/', 1) = user_id::text
    and pg_catalog.split_part(object_key, '/', 3) = id::text
  ),
  constraint evidence_files_one_parent_check check (pg_catalog.num_nonnulls(activity_id, achievement_id, project_id) = 1),
  constraint evidence_files_original_name_check check (
    original_name = pg_catalog.btrim(original_name)
    and pg_catalog.char_length(original_name) between 1 and 255
  ),
  constraint evidence_files_mime_check check (mime_type in (
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  constraint evidence_files_bytes_check check (bytes between 1 and 10485760),
  constraint evidence_files_actual_bytes_check check (
    actual_bytes is null or actual_bytes between 1 and 10485760
  ),
  constraint evidence_files_sha_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint evidence_files_status_check check (status in ('uploading', 'scanning', 'ready', 'failed', 'deleting')),
  constraint evidence_files_error_check check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint evidence_files_revision_check check (revision > 0 and parent_revision > 0),
  constraint evidence_files_hash_check check (
    pg_catalog.octet_length(payload_hash) = 32
    and (finalize_payload_hash is null or pg_catalog.octet_length(finalize_payload_hash) = 32)
  ),
  constraint evidence_files_state_check check (
    (
      status = 'uploading' and reserved_until is not null and actual_bytes is null
      and sha256 is null and scan_job_id is null and error_code is null
    )
    or (
      status = 'scanning' and reserved_until is null and actual_bytes = bytes
      and sha256 is not null and scan_job_id is not null and error_code is null
    )
    or (
      status = 'ready' and reserved_until is null and actual_bytes = bytes
      and sha256 is not null and scan_job_id is not null and error_code is null
    )
    or (
      status = 'failed' and reserved_until is null and error_code is not null
    )
    or (
      status = 'deleting' and reserved_until is null
    )
  ),
  constraint evidence_files_timestamp_check check (updated_at >= created_at),
  constraint evidence_files_activity_fk foreign key (user_id, activity_id)
    references public.activities(user_id, id) on delete cascade,
  constraint evidence_files_achievement_fk foreign key (user_id, achievement_id)
    references public.achievements(user_id, id) on delete cascade,
  constraint evidence_files_project_fk foreign key (user_id, project_id)
    references public.projects(user_id, id) on delete cascade,
  constraint evidence_files_user_id_idempotency_key unique (user_id, idempotency_key)
);

comment on table public.evidence_files is
  'Canonical evidence metadata. The typed nullable parent columns preserve composite ownership FKs; only one is populated for a live row.';
comment on column public.evidence_files.bytes is
  'Reserved size while uploading; verified actual size after finalize. Only uploading/scanning/ready rows count toward quota.';
comment on column public.evidence_files.actual_bytes is
  'Server-verified actual upload size, persisted before screening. It must match the reserved bytes before scanning.';
comment on column public.evidence_files.parent_revision is
  'Parent revision checked and locked during reservation; retained as reservation provenance.';
comment on column public.evidence_files.idempotency_key is
  'User-scoped reservation key; a separate minimal receipt keeps payload conflict detection after cleanup.';
comment on column public.evidence_files.object_key is
  'Immutable server-generated key: user_uuid/evidence/evidence_uuid. It contains no filename.';

alter table public.evidence_files enable row level security;
create policy evidence_files_owner_read
  on public.evidence_files for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles as profile
      where profile.id = user_id and profile.deleting_at is null
    )
  );
revoke all privileges on table public.evidence_files from public, anon, authenticated, service_role;
grant select on table public.evidence_files to authenticated, service_role;

create index evidence_files_activity_idx on public.evidence_files (user_id, activity_id, created_at, id)
  where activity_id is not null;
create index evidence_files_achievement_idx on public.evidence_files (user_id, achievement_id, created_at, id)
  where achievement_id is not null;
create index evidence_files_project_idx on public.evidence_files (user_id, project_id, created_at, id)
  where project_id is not null;
create index evidence_files_quota_idx on public.evidence_files (user_id, status, bytes)
  where status in ('uploading', 'scanning', 'ready');

-- The delete queue remains the T05 queue. It gets a no-FK evidence identity and the
-- metadata needed to finish cleanup after its source rows disappear.
alter table internal.storage_jobs
  add column evidence_id uuid,
  add column evidence_bytes bigint,
  add column evidence_sha256 text,
  add column evidence_mime_type text,
  add column evidence_original_name text,
  add column evidence_parent_kind text,
  add column evidence_parent_id uuid,
  add column last_error_code text;

alter table internal.storage_jobs
  add constraint storage_jobs_last_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  add constraint storage_jobs_evidence_metadata_check check (
    evidence_id is null
    or (
      object_key = pg_catalog.split_part(object_key, '/', 1) || '/evidence/' || evidence_id::text
      and (evidence_parent_kind is null or evidence_parent_kind in ('activity', 'achievement', 'project'))
      and (evidence_bytes is null or evidence_bytes between 1 and 10485760)
      and (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$')
      and (evidence_mime_type is null or evidence_mime_type in (
        'application/pdf', 'image/png', 'image/jpeg',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ))
    )
  );
comment on column internal.storage_jobs.evidence_id is
  'Evidence identity retained without an FK until object deletion is verified.';
comment on column internal.storage_jobs.evidence_original_name is
  'Private cleanup metadata retained only until object absence is verified, then cleared.';

create or replace function internal.enqueue_evidence_cleanup(p_file public.evidence_files)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
declare
  v_job_id uuid;
  v_parent_kind text;
  v_parent_id uuid;
begin
  if p_file.id is null or p_file.user_id is null
     or p_file.object_key <> p_file.user_id::text || '/evidence/' || p_file.id::text then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_CLEANUP_RECEIPT';
  end if;

  v_parent_kind := case
    when p_file.activity_id is not null then 'activity'
    when p_file.achievement_id is not null then 'achievement'
    else 'project'
  end;
  v_parent_id := coalesce(p_file.activity_id, p_file.achievement_id, p_file.project_id);

  insert into internal.storage_jobs (
    user_id, bucket_id, object_key, kind, evidence_id, evidence_bytes,
    evidence_sha256, evidence_mime_type, evidence_original_name,
    evidence_parent_kind, evidence_parent_id
  ) values (
    p_file.user_id, 'workpulse-private', p_file.object_key, 'delete', p_file.id,
    p_file.bytes, p_file.sha256, p_file.mime_type, p_file.original_name,
    v_parent_kind, v_parent_id
  ) on conflict (bucket_id, object_key, kind) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select job.id into v_job_id
    from internal.storage_jobs as job
    where job.bucket_id = 'workpulse-private'
      and job.object_key = p_file.object_key
      and job.kind = 'delete';
  end if;
  return v_job_id;
end;
$$;
comment on function internal.enqueue_evidence_cleanup(public.evidence_files) is
  'Idempotently preserves evidence object identity and required private metadata in T05 cleanup queue before canonical rows disappear.';

create or replace function internal.cancel_evidence_scan(p_file public.evidence_files, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if p_file.scan_job_id is null then return; end if;
  if p_reason is null or p_reason !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_SCAN_CANCEL';
  end if;
  update internal.evidence_scan_jobs as job
  set status = 'cancelled',
      attempt_token = coalesce(job.attempt_token, pg_catalog.gen_random_uuid()),
      lease_expires_at = null,
      error_code = p_reason,
      result = null,
      object_key = '', expected_bytes = 0, mime_type = '', sha256 = repeat('0', 64),
      finished_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where job.id = p_file.scan_job_id
    and job.status in ('queued', 'running');
end;
$$;

create or replace function internal.enqueue_evidence_cleanup_before_file_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  perform internal.enqueue_evidence_cleanup(old);
  return old;
end;
$$;

create trigger evidence_files_cleanup_before_delete
  before delete on public.evidence_files
  for each row execute function internal.enqueue_evidence_cleanup_before_file_delete();

create or replace function internal.enqueue_parent_evidence_before_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  v_file public.evidence_files%rowtype;
  v_updated public.evidence_files%rowtype;
  v_column text;
begin
  v_column := case tg_table_name
    when 'activities' then 'activity_id'
    when 'achievements' then 'achievement_id'
    when 'projects' then 'project_id'
    else null
  end;
  if v_column is null then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_PARENT_TRIGGER';
  end if;

  if v_column = 'activity_id' then
    for v_file in
      select file.* from public.evidence_files as file
      where file.user_id = old.user_id and file.activity_id = old.id
      order by file.id for update
    loop
      perform internal.enqueue_evidence_cleanup(v_file);
      update public.evidence_files as file
      set status = 'deleting',
          reserved_until = null,
          error_code = case when file.status = 'failed' then file.error_code else 'PARENT_DELETED' end,
          revision = file.revision + 1,
          updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = v_file.user_id
      returning file.* into v_updated;
      perform internal.cancel_evidence_scan(v_updated, 'PARENT_DELETED');
    end loop;
  elsif v_column = 'achievement_id' then
    for v_file in
      select file.* from public.evidence_files as file
      where file.user_id = old.user_id and file.achievement_id = old.id
      order by file.id for update
    loop
      perform internal.enqueue_evidence_cleanup(v_file);
      update public.evidence_files as file
      set status = 'deleting',
          reserved_until = null,
          error_code = case when file.status = 'failed' then file.error_code else 'PARENT_DELETED' end,
          revision = file.revision + 1,
          updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = v_file.user_id
      returning file.* into v_updated;
      perform internal.cancel_evidence_scan(v_updated, 'PARENT_DELETED');
    end loop;
  else
    for v_file in
      select file.* from public.evidence_files as file
      where file.user_id = old.user_id and file.project_id = old.id
      order by file.id for update
    loop
      perform internal.enqueue_evidence_cleanup(v_file);
      update public.evidence_files as file
      set status = 'deleting',
          reserved_until = null,
          error_code = case when file.status = 'failed' then file.error_code else 'PARENT_DELETED' end,
          revision = file.revision + 1,
          updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = v_file.user_id
      returning file.* into v_updated;
      perform internal.cancel_evidence_scan(v_updated, 'PARENT_DELETED');
    end loop;
  end if;
  return old;
end;
$$;

create trigger activities_evidence_cleanup_before_delete
  before delete on public.activities
  for each row execute function internal.enqueue_parent_evidence_before_delete();
create trigger achievements_evidence_cleanup_before_delete
  before delete on public.achievements
  for each row execute function internal.enqueue_parent_evidence_before_delete();
create trigger projects_evidence_cleanup_before_delete
  before delete on public.projects
  for each row execute function internal.enqueue_parent_evidence_before_delete();

revoke all privileges on function internal.enqueue_evidence_cleanup(public.evidence_files) from public, anon, authenticated, service_role;
revoke all privileges on function internal.cancel_evidence_scan(public.evidence_files, text) from public, anon, authenticated, service_role;
revoke all privileges on function internal.enqueue_evidence_cleanup_before_file_delete() from public, anon, authenticated, service_role;
revoke all privileges on function internal.enqueue_parent_evidence_before_delete() from public, anon, authenticated, service_role;

create or replace function public.reserve_evidence_upload(
  p_user_id uuid,
  p_parent_kind text,
  p_parent_id uuid,
  p_filename text,
  p_content_type text,
  p_expected_bytes bigint,
  p_idempotency_key uuid,
  p_expected_revision integer
)
returns table (
  id uuid, user_id uuid, parent_kind text, parent_id uuid, parent_revision integer,
  filename text, content_type text, expected_bytes bigint, actual_bytes bigint,
  sha256 text, object_key text, status text, revision integer,
  reservation_expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  failure_code text, scan_job_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, internal, extensions
as $$
declare
  v_profile public.profiles%rowtype;
  v_parent_revision integer;
  v_payload jsonb;
  v_payload_hash bytea;
  v_receipt internal.evidence_reservation_requests%rowtype;
  v_file public.evidence_files%rowtype;
  v_count integer;
  v_bytes bigint;
  v_evidence_id uuid := pg_catalog.gen_random_uuid();
begin
  if p_user_id is null or p_parent_kind is null or p_parent_kind not in ('activity', 'achievement', 'project')
     or p_parent_id is null or p_idempotency_key is null
     or p_expected_revision is null or p_expected_revision < 1
     or p_filename is null or p_filename <> pg_catalog.btrim(p_filename)
     or pg_catalog.char_length(p_filename) not between 1 and 255
     or p_filename ~ '[[:cntrl:]]'
     or p_content_type is null or p_content_type not in (
       'application/pdf', 'image/png', 'image/jpeg',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     )
     or p_expected_bytes is null or p_expected_bytes not between 1 and 10485760 then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_RESERVATION';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'parent_kind', p_parent_kind, 'parent_id', p_parent_id,
    'parent_revision', p_expected_revision, 'filename', p_filename,
    'content_type', p_content_type, 'expected_bytes', p_expected_bytes
  );
  v_payload_hash := extensions.digest(v_payload::text, 'sha256');

  -- One profile lock serializes every account's byte reservation and all per-parent
  -- slot reservations. It is always acquired before the typed parent row lock.
  select profile.* into v_profile
  from public.profiles as profile
  where profile.id = p_user_id and profile.deleting_at is null
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select receipt.* into v_receipt
  from internal.evidence_reservation_requests as receipt
  where receipt.user_id = p_user_id and receipt.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_receipt.payload_hash is distinct from v_payload_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    select file.* into v_file
    from public.evidence_files as file
    where file.user_id = p_user_id and file.id = v_receipt.evidence_id;
    if found then
      return query select
        v_file.id, v_file.user_id,
        case when v_file.activity_id is not null then 'activity'
             when v_file.achievement_id is not null then 'achievement' else 'project' end,
        coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
        v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
        v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
        v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
        v_file.error_code, v_file.scan_job_id;
    end if;
    return;
  end if;

  if p_parent_kind = 'activity' then
    select activity.revision into v_parent_revision from public.activities as activity
    where activity.user_id = p_user_id and activity.id = p_parent_id for update;
  elsif p_parent_kind = 'achievement' then
    select achievement.revision into v_parent_revision from public.achievements as achievement
    where achievement.user_id = p_user_id and achievement.id = p_parent_id for update;
  else
    select project.revision into v_parent_revision from public.projects as project
    where project.user_id = p_user_id and project.id = p_parent_id for update;
  end if;
  if not found then return; end if;
  if v_parent_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

  if p_parent_kind = 'activity' then
    select pg_catalog.count(*)::integer into v_count from public.evidence_files as file
    where file.user_id = p_user_id and file.activity_id = p_parent_id
      and file.status in ('uploading', 'scanning', 'ready');
  elsif p_parent_kind = 'achievement' then
    select pg_catalog.count(*)::integer into v_count from public.evidence_files as file
    where file.user_id = p_user_id and file.achievement_id = p_parent_id
      and file.status in ('uploading', 'scanning', 'ready');
  else
    select pg_catalog.count(*)::integer into v_count from public.evidence_files as file
    where file.user_id = p_user_id and file.project_id = p_parent_id
      and file.status in ('uploading', 'scanning', 'ready');
  end if;
  if v_count >= 3 then
    raise exception using errcode = 'P0001', message = 'EVIDENCE_SLOT_LIMIT';
  end if;

  select coalesce(pg_catalog.sum(file.bytes), 0)::bigint into v_bytes
  from public.evidence_files as file
  where file.user_id = p_user_id and file.status in ('uploading', 'scanning', 'ready');
  if v_bytes + p_expected_bytes > 52428800 then
    raise exception using errcode = 'P0001', message = 'EVIDENCE_QUOTA_EXCEEDED';
  end if;

  insert into public.evidence_files (
    id, user_id, activity_id, achievement_id, project_id, object_key, original_name,
    mime_type, bytes, status, reserved_until, parent_revision, idempotency_key, payload_hash
  ) values (
    v_evidence_id, p_user_id,
    case when p_parent_kind = 'activity' then p_parent_id end,
    case when p_parent_kind = 'achievement' then p_parent_id end,
    case when p_parent_kind = 'project' then p_parent_id end,
    p_user_id::text || '/evidence/' || v_evidence_id::text,
    p_filename, p_content_type, p_expected_bytes, 'uploading',
    pg_catalog.clock_timestamp() + interval '15 minutes', v_parent_revision,
    p_idempotency_key, v_payload_hash
  ) returning * into v_file;

  insert into internal.evidence_reservation_requests (user_id, idempotency_key, payload_hash, evidence_id)
  values (p_user_id, p_idempotency_key, v_payload_hash, v_file.id);

  return query select
    v_file.id, v_file.user_id,
    case when v_file.activity_id is not null then 'activity'
         when v_file.achievement_id is not null then 'achievement' else 'project' end,
    coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
    v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
    v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
    v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
    v_file.error_code, v_file.scan_job_id;
end;
$$;

create or replace function public.get_evidence_file(p_user_id uuid, p_evidence_id uuid)
returns table (
  id uuid, user_id uuid, parent_kind text, parent_id uuid, parent_revision integer,
  filename text, content_type text, expected_bytes bigint, actual_bytes bigint,
  sha256 text, object_key text, status text, revision integer,
  reservation_expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  failure_code text, scan_job_id uuid
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select file.id, file.user_id,
    case when file.activity_id is not null then 'activity'
         when file.achievement_id is not null then 'achievement' else 'project' end,
    coalesce(file.activity_id, file.achievement_id, file.project_id),
    file.parent_revision, file.original_name, file.mime_type, file.bytes, file.actual_bytes,
    file.sha256, file.object_key, file.status, file.revision, file.reserved_until,
    file.created_at, file.updated_at, file.error_code, file.scan_job_id
  from public.evidence_files as file
  join public.profiles as profile on profile.id = file.user_id and profile.deleting_at is null
  where file.user_id = p_user_id and file.id = p_evidence_id
$$;

create or replace function public.finalize_evidence_upload(
  p_user_id uuid,
  p_evidence_id uuid,
  p_expected_revision integer,
  p_actual_bytes bigint,
  p_verified_content_type text,
  p_sha256 text
)
returns table (
  id uuid, user_id uuid, parent_kind text, parent_id uuid, parent_revision integer,
  filename text, content_type text, expected_bytes bigint, actual_bytes bigint,
  sha256 text, object_key text, status text, revision integer,
  reservation_expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  failure_code text, scan_job_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, internal, extensions
as $$
declare
  v_file public.evidence_files%rowtype;
  v_snapshot public.evidence_files%rowtype;
  v_parent_live boolean := false;
  v_payload_hash bytea;
  v_job_id uuid;
  v_error_code text;
begin
  if p_user_id is null or p_evidence_id is null or p_expected_revision is null or p_expected_revision < 1
     or p_actual_bytes is null or p_verified_content_type is null or p_sha256 is null then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_FINALIZE';
  end if;
  v_payload_hash := extensions.digest(pg_catalog.jsonb_build_object(
    'expected_revision', p_expected_revision, 'actual_bytes', p_actual_bytes,
    'content_type', p_verified_content_type, 'sha256', p_sha256
  )::text, 'sha256');

  select file.* into v_snapshot from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id;
  if not found then return; end if;

  perform 1 from public.profiles as profile
  where profile.id = p_user_id and profile.deleting_at is null for update;
  if not found then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;

  if v_snapshot.activity_id is not null then
    perform 1 from public.activities as parent where parent.user_id = p_user_id and parent.id = v_snapshot.activity_id for update;
  elsif v_snapshot.achievement_id is not null then
    perform 1 from public.achievements as parent where parent.user_id = p_user_id and parent.id = v_snapshot.achievement_id for update;
  else
    perform 1 from public.projects as parent where parent.user_id = p_user_id and parent.id = v_snapshot.project_id for update;
  end if;
  v_parent_live := found;

  select file.* into v_file from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id for update;
  if not found then return; end if;

  if v_file.finalize_payload_hash is not null then
    if v_file.finalize_payload_hash is distinct from v_payload_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return query select v_file.id, v_file.user_id,
      case when v_file.activity_id is not null then 'activity'
           when v_file.achievement_id is not null then 'achievement' else 'project' end,
      coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
      v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
      v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
      v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
      v_file.error_code, v_file.scan_job_id;
    return;
  end if;

  if v_file.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  if v_file.status = 'failed' and v_file.error_code = 'RESERVATION_EXPIRED' then
    return query select v_file.id, v_file.user_id,
      case when v_file.activity_id is not null then 'activity'
           when v_file.achievement_id is not null then 'achievement' else 'project' end,
      coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
      v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
      v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
      v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
      v_file.error_code, v_file.scan_job_id;
    return;
  end if;
  if v_file.status <> 'uploading' then
    raise exception using errcode = 'P0001', message = 'EVIDENCE_STATE_CONFLICT';
  end if;

  if not v_parent_live then
    perform internal.enqueue_evidence_cleanup(v_file);
    update public.evidence_files as file
    set status = 'deleting', reserved_until = null, error_code = 'PARENT_DELETED',
        finalize_payload_hash = v_payload_hash, revision = file.revision + 1,
        updated_at = pg_catalog.clock_timestamp()
    where file.id = v_file.id and file.user_id = p_user_id returning file.* into v_file;
  else
    if p_actual_bytes is null or p_actual_bytes not between 1 and 10485760 or p_actual_bytes <> v_file.bytes then
      v_error_code := 'SIZE_MISMATCH';
    elsif p_verified_content_type <> v_file.mime_type then
      v_error_code := 'MIME_MISMATCH';
    elsif p_sha256 !~ '^[0-9a-f]{64}$' then
      v_error_code := 'INVALID_HASH';
    elsif v_file.reserved_until <= pg_catalog.clock_timestamp() then
      v_error_code := 'RESERVATION_EXPIRED';
    end if;

    if v_error_code is not null then
      update public.evidence_files as file
      set status = 'failed', reserved_until = null, error_code = v_error_code,
          actual_bytes = case when p_actual_bytes between 1 and 10485760 then p_actual_bytes else null end,
          sha256 = case when p_sha256 ~ '^[0-9a-f]{64}$' then p_sha256 else null end,
          finalize_payload_hash = v_payload_hash, revision = file.revision + 1,
          updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = p_user_id returning file.* into v_file;
      perform internal.enqueue_evidence_cleanup(v_file);
    else
      insert into internal.evidence_scan_jobs (
        user_id, evidence_id, object_key, expected_bytes, mime_type, sha256
      ) values (
        p_user_id, v_file.id, v_file.object_key, p_actual_bytes,
        p_verified_content_type, p_sha256
      ) returning id into v_job_id;
      update public.evidence_files as file
      set status = 'scanning', reserved_until = null, actual_bytes = p_actual_bytes,
          sha256 = p_sha256, finalize_payload_hash = v_payload_hash,
          scan_job_id = v_job_id, revision = file.revision + 1,
          updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = p_user_id returning file.* into v_file;
    end if;
  end if;

  return query select v_file.id, v_file.user_id,
    case when v_file.activity_id is not null then 'activity'
         when v_file.achievement_id is not null then 'achievement' else 'project' end,
    coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
    v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
    v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
    v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
    v_file.error_code, v_file.scan_job_id;
end;
$$;

create or replace function public.fail_evidence_upload(
  p_user_id uuid,
  p_evidence_id uuid,
  p_expected_revision integer,
  p_error_code text
)
returns table (
  id uuid, user_id uuid, parent_kind text, parent_id uuid, parent_revision integer,
  filename text, content_type text, expected_bytes bigint, actual_bytes bigint,
  sha256 text, object_key text, status text, revision integer,
  reservation_expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  failure_code text, scan_job_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  v_snapshot public.evidence_files%rowtype;
  v_file public.evidence_files%rowtype;
begin
  if p_user_id is null or p_evidence_id is null or p_expected_revision is null or p_expected_revision < 1
     or p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_UPLOAD_FAILURE';
  end if;
  select file.* into v_snapshot from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id;
  if not found then return; end if;
  perform 1 from public.profiles as profile where profile.id = p_user_id and profile.deleting_at is null for update;
  if not found then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_snapshot.activity_id is not null then
    perform 1 from public.activities as parent where parent.user_id = p_user_id and parent.id = v_snapshot.activity_id for update;
  elsif v_snapshot.achievement_id is not null then
    perform 1 from public.achievements as parent where parent.user_id = p_user_id and parent.id = v_snapshot.achievement_id for update;
  else
    perform 1 from public.projects as parent where parent.user_id = p_user_id and parent.id = v_snapshot.project_id for update;
  end if;
  select file.* into v_file from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id for update;
  if not found then return; end if;
  if v_file.status = 'failed' and v_file.error_code = p_error_code then
    return query select v_file.id, v_file.user_id,
      case when v_file.activity_id is not null then 'activity'
           when v_file.achievement_id is not null then 'achievement' else 'project' end,
      coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
      v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
      v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
      v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
      v_file.error_code, v_file.scan_job_id;
    return;
  end if;
  if v_file.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  if v_file.status <> 'uploading' then
    raise exception using errcode = 'P0001', message = 'EVIDENCE_STATE_CONFLICT';
  end if;
  update public.evidence_files as file
  set status = 'failed', reserved_until = null, error_code = p_error_code,
      revision = file.revision + 1, updated_at = pg_catalog.clock_timestamp()
  where file.id = p_evidence_id and file.user_id = p_user_id returning file.* into v_file;
  perform internal.enqueue_evidence_cleanup(v_file);
  return query select v_file.id, v_file.user_id,
    case when v_file.activity_id is not null then 'activity'
         when v_file.achievement_id is not null then 'achievement' else 'project' end,
    coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
    v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
    v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
    v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
    v_file.error_code, v_file.scan_job_id;
end;
$$;

create or replace function public.expire_evidence_uploads(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  v_file public.evidence_files%rowtype;
  v_updated public.evidence_files%rowtype;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_EXPIRY_LIMIT';
  end if;
  for v_file in
    select file.* from public.evidence_files as file
    where file.status = 'uploading' and file.reserved_until <= pg_catalog.clock_timestamp()
    order by file.reserved_until, file.created_at, file.id
    for update of file skip locked limit p_limit
  loop
    -- Queue first so even an account/parent cascade later in the same transaction
    -- leaves a durable object receipt after this reservation releases quota.
    perform internal.enqueue_evidence_cleanup(v_file);
    update public.evidence_files as file
    set status = 'failed', reserved_until = null, error_code = 'RESERVATION_EXPIRED',
        revision = file.revision + 1, updated_at = pg_catalog.clock_timestamp()
    where file.id = v_file.id and file.user_id = v_file.user_id
    returning file.* into v_updated;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.delete_evidence_file(
  p_user_id uuid,
  p_evidence_id uuid,
  p_expected_revision integer
)
returns table (
  id uuid, user_id uuid, parent_kind text, parent_id uuid, parent_revision integer,
  filename text, content_type text, expected_bytes bigint, actual_bytes bigint,
  sha256 text, object_key text, status text, revision integer,
  reservation_expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  failure_code text, scan_job_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  v_snapshot public.evidence_files%rowtype;
  v_file public.evidence_files%rowtype;
begin
  if p_user_id is null or p_evidence_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_DELETE';
  end if;
  select file.* into v_snapshot from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id;
  if not found then return; end if;
  perform 1 from public.profiles as profile where profile.id = p_user_id and profile.deleting_at is null for update;
  if not found then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_snapshot.activity_id is not null then
    perform 1 from public.activities as parent where parent.user_id = p_user_id and parent.id = v_snapshot.activity_id for update;
  elsif v_snapshot.achievement_id is not null then
    perform 1 from public.achievements as parent where parent.user_id = p_user_id and parent.id = v_snapshot.achievement_id for update;
  else
    perform 1 from public.projects as parent where parent.user_id = p_user_id and parent.id = v_snapshot.project_id for update;
  end if;
  select file.* into v_file from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id for update;
  if not found then return; end if;
  if v_file.status = 'deleting' then
    return query select v_file.id, v_file.user_id,
      case when v_file.activity_id is not null then 'activity'
           when v_file.achievement_id is not null then 'achievement' else 'project' end,
      coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
      v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
      v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
      v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
      v_file.error_code, v_file.scan_job_id;
    return;
  end if;
  if v_file.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  update public.evidence_files as file
  set status = 'deleting', reserved_until = null,
      error_code = coalesce(file.error_code, 'USER_DELETED'),
      revision = file.revision + 1, updated_at = pg_catalog.clock_timestamp()
  where file.id = p_evidence_id and file.user_id = p_user_id returning file.* into v_file;
  perform internal.cancel_evidence_scan(v_file, 'EVIDENCE_DELETED');
  perform internal.enqueue_evidence_cleanup(v_file);
  return query select v_file.id, v_file.user_id,
    case when v_file.activity_id is not null then 'activity'
         when v_file.achievement_id is not null then 'achievement' else 'project' end,
    coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
    v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
    v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
    v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
    v_file.error_code, v_file.scan_job_id;
end;
$$;

create or replace function public.claim_evidence_scan_jobs(p_limit integer default 1)
returns setof internal.evidence_scan_jobs
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_SCAN_CLAIM_LIMIT';
  end if;
  return query
  with candidates as (
    select job.id from internal.evidence_scan_jobs as job
    where job.next_attempt_at <= pg_catalog.clock_timestamp()
      and (
        job.status = 'queued'
        or (job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp())
      )
    order by job.next_attempt_at, job.created_at, job.id
    for update of job skip locked limit p_limit
  ), claimed as (
    update internal.evidence_scan_jobs as job
    set status = 'running', attempt_count = job.attempt_count + 1,
        attempt_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds',
        error_code = null, result = null, finished_at = null,
        updated_at = pg_catalog.clock_timestamp()
    from candidates where job.id = candidates.id
    returning job.*
  )
  select claimed.* from claimed order by claimed.next_attempt_at, claimed.created_at, claimed.id;
end;
$$;

create or replace function public.complete_evidence_scan_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_result text,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  v_job_snapshot internal.evidence_scan_jobs%rowtype;
  v_job internal.evidence_scan_jobs%rowtype;
  v_file_snapshot public.evidence_files%rowtype;
  v_file public.evidence_files%rowtype;
  v_profile_live boolean := false;
  v_parent_live boolean := false;
begin
  if p_job_id is null or p_attempt_token is null or p_result not in ('clean', 'rejected')
     or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$')
     or (p_result = 'rejected' and p_error_code is null) then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_SCAN_COMPLETION';
  end if;
  select job.* into v_job_snapshot from internal.evidence_scan_jobs as job where job.id = p_job_id;
  if not found then return false; end if;
  select file.* into v_file_snapshot from public.evidence_files as file
  where file.user_id = v_job_snapshot.user_id and file.id = v_job_snapshot.evidence_id;

  perform 1 from public.profiles as profile
  where profile.id = v_job_snapshot.user_id and profile.deleting_at is null for update;
  v_profile_live := found;

  if found and v_file_snapshot.id is not null then
    if v_file_snapshot.activity_id is not null then
      perform 1 from public.activities as parent where parent.user_id = v_job_snapshot.user_id and parent.id = v_file_snapshot.activity_id for update;
    elsif v_file_snapshot.achievement_id is not null then
      perform 1 from public.achievements as parent where parent.user_id = v_job_snapshot.user_id and parent.id = v_file_snapshot.achievement_id for update;
    else
      perform 1 from public.projects as parent where parent.user_id = v_job_snapshot.user_id and parent.id = v_file_snapshot.project_id for update;
    end if;
    v_parent_live := found;
    select file.* into v_file from public.evidence_files as file
    where file.user_id = v_job_snapshot.user_id and file.id = v_job_snapshot.evidence_id for update;
  end if;

  select job.* into v_job from internal.evidence_scan_jobs as job where job.id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;

  update internal.evidence_scan_jobs as job
  set status = 'succeeded', result = case
        when v_profile_live and v_parent_live and v_file.id is not null and v_file.status = 'scanning'
          and v_file.scan_job_id = job.id then p_result
        else 'superseded' end,
      lease_expires_at = null, error_code = null,
      object_key = '', expected_bytes = 0, mime_type = '', sha256 = repeat('0', 64),
      finished_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
  where job.id = p_job_id and job.status = 'running' and job.attempt_token = p_attempt_token
    and job.lease_expires_at > pg_catalog.clock_timestamp();
  if not found then return false; end if;

  if v_file.id is not null and v_file.status = 'scanning' and v_file.scan_job_id = p_job_id then
    if v_profile_live and v_parent_live and p_result = 'clean' then
      update public.evidence_files as file
      set status = 'ready', error_code = null, revision = file.revision + 1,
          updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = v_file.user_id returning file.* into v_file;
    elsif v_profile_live and v_parent_live then
      update public.evidence_files as file
      set status = 'failed', error_code = coalesce(p_error_code, 'MALWARE_DETECTED'),
          revision = file.revision + 1, updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = v_file.user_id returning file.* into v_file;
      perform internal.enqueue_evidence_cleanup(v_file);
    else
      update public.evidence_files as file
      set status = 'deleting', reserved_until = null, error_code = 'PARENT_OR_ACCOUNT_DELETED',
          revision = file.revision + 1, updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = v_file.user_id returning file.* into v_file;
      perform internal.enqueue_evidence_cleanup(v_file);
    end if;
  end if;
  return true;
end;
$$;

create or replace function public.retry_evidence_scan_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_error_code text,
  p_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  v_job_snapshot internal.evidence_scan_jobs%rowtype;
  v_job internal.evidence_scan_jobs%rowtype;
  v_file_snapshot public.evidence_files%rowtype;
  v_file public.evidence_files%rowtype;
  v_profile_live boolean := false;
  v_parent_live boolean := false;
begin
  if p_job_id is null or p_attempt_token is null or p_error_code is null
     or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' or p_next_attempt_at is null then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_SCAN_RETRY';
  end if;
  select job.* into v_job_snapshot from internal.evidence_scan_jobs as job where job.id = p_job_id;
  if not found then return false; end if;
  select file.* into v_file_snapshot from public.evidence_files as file
  where file.user_id = v_job_snapshot.user_id and file.id = v_job_snapshot.evidence_id;

  perform 1 from public.profiles as profile
  where profile.id = v_job_snapshot.user_id and profile.deleting_at is null for update;
  v_profile_live := found;
  if found and v_file_snapshot.id is not null then
    if v_file_snapshot.activity_id is not null then
      perform 1 from public.activities as parent where parent.user_id = v_job_snapshot.user_id and parent.id = v_file_snapshot.activity_id for update;
    elsif v_file_snapshot.achievement_id is not null then
      perform 1 from public.achievements as parent where parent.user_id = v_job_snapshot.user_id and parent.id = v_file_snapshot.achievement_id for update;
    else
      perform 1 from public.projects as parent where parent.user_id = v_job_snapshot.user_id and parent.id = v_file_snapshot.project_id for update;
    end if;
    v_parent_live := found;
    select file.* into v_file from public.evidence_files as file
    where file.user_id = v_job_snapshot.user_id and file.id = v_job_snapshot.evidence_id for update;
  end if;

  select job.* into v_job from internal.evidence_scan_jobs as job where job.id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;

  if not v_profile_live or not v_parent_live or v_file.id is null or v_file.status <> 'scanning'
     or v_file.scan_job_id <> p_job_id then
    update internal.evidence_scan_jobs as job
    set status = 'cancelled', lease_expires_at = null, error_code = 'EVIDENCE_UNAVAILABLE',
        object_key = '', expected_bytes = 0, mime_type = '', sha256 = repeat('0', 64),
        finished_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
    where job.id = p_job_id;
    if v_file.id is not null and v_file.status = 'scanning' then
      update public.evidence_files as file
      set status = 'deleting', reserved_until = null, error_code = 'PARENT_OR_ACCOUNT_DELETED',
          revision = file.revision + 1, updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = v_file.user_id returning file.* into v_file;
      perform internal.enqueue_evidence_cleanup(v_file);
    end if;
    return true;
  end if;

  if v_job.attempt_count >= 5 then
    update internal.evidence_scan_jobs as job
    set status = 'failed', lease_expires_at = null, error_code = 'SCANNER_RETRY_EXHAUSTED',
        last_error_code = p_error_code, object_key = '', expected_bytes = 0,
        mime_type = '', sha256 = repeat('0', 64),
        finished_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
    where job.id = p_job_id;
    update public.evidence_files as file
    set status = 'failed', reserved_until = null, error_code = 'SCANNER_RETRY_EXHAUSTED',
        revision = file.revision + 1, updated_at = pg_catalog.clock_timestamp()
    where file.id = v_file.id and file.user_id = v_file.user_id returning file.* into v_file;
    perform internal.enqueue_evidence_cleanup(v_file);
  else
    update internal.evidence_scan_jobs as job
    set status = 'queued', attempt_token = null, lease_expires_at = null,
        next_attempt_at = p_next_attempt_at, error_code = null,
        last_error_code = p_error_code, result = null, finished_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where job.id = p_job_id;
  end if;
  return true;
end;
$$;

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
  return query
  select job.id, job.user_id, job.bucket_id, job.object_key, job.kind, job.status,
    job.attempt_count, job.attempt_token, job.lease_expires_at, job.next_attempt_at,
    job.error_code, job.created_at, job.updated_at, job.finished_at, job.evidence_id,
    job.evidence_bytes, job.evidence_sha256, job.evidence_mime_type,
    job.evidence_original_name, job.evidence_parent_kind, job.evidence_parent_id,
    job.last_error_code
  from internal.claim_storage_jobs(p_limit) as job;
end;
$$;

create or replace function public.complete_evidence_cleanup_job(p_job_id uuid, p_attempt_token uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  v_job_snapshot internal.storage_jobs%rowtype;
  v_file public.evidence_files%rowtype;
  v_completed boolean;
begin
  if p_job_id is null or p_attempt_token is null then return false; end if;
  select job.* into v_job_snapshot from internal.storage_jobs as job where job.id = p_job_id;
  if not found then return false; end if;

  -- Keep the delete path parent -> evidence -> receipt, matching user/parent deletion and
  -- avoiding a job-row/evidence-row deadlock with concurrent deletion.
  if v_job_snapshot.evidence_parent_kind = 'activity' then
    perform 1 from public.activities as parent where parent.user_id = v_job_snapshot.user_id and parent.id = v_job_snapshot.evidence_parent_id for update;
  elsif v_job_snapshot.evidence_parent_kind = 'achievement' then
    perform 1 from public.achievements as parent where parent.user_id = v_job_snapshot.user_id and parent.id = v_job_snapshot.evidence_parent_id for update;
  elsif v_job_snapshot.evidence_parent_kind = 'project' then
    perform 1 from public.projects as parent where parent.user_id = v_job_snapshot.user_id and parent.id = v_job_snapshot.evidence_parent_id for update;
  end if;
  if v_job_snapshot.evidence_id is not null then
    select file.* into v_file from public.evidence_files as file
    where file.user_id = v_job_snapshot.user_id and file.id = v_job_snapshot.evidence_id
      and file.object_key = v_job_snapshot.object_key for update;
  end if;

  v_completed := internal.complete_storage_job(p_job_id, p_attempt_token);
  if not v_completed then return false; end if;
  if v_file.id is not null and v_file.status in ('deleting', 'failed') then
    delete from public.evidence_files as file
    where file.user_id = v_job_snapshot.user_id and file.id = v_file.id
      and file.object_key = v_job_snapshot.object_key and file.status in ('deleting', 'failed');
  end if;
  update internal.storage_jobs as job
  set evidence_bytes = null, evidence_sha256 = null, evidence_mime_type = null,
      evidence_original_name = null, evidence_parent_kind = null, evidence_parent_id = null,
      last_error_code = null
  where job.id = p_job_id and job.status = 'succeeded';
  return true;
end;
$$;

create or replace function public.fail_evidence_cleanup_job(p_job_id uuid, p_attempt_token uuid, p_error_code text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  return internal.fail_storage_job(p_job_id, p_attempt_token, p_error_code);
end;
$$;

create or replace function public.retry_evidence_cleanup_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_error_code text,
  p_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if p_job_id is null or p_attempt_token is null or p_error_code is null
     or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' or p_next_attempt_at is null then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_CLEANUP_RETRY';
  end if;
  update internal.storage_jobs as job
  set status = 'queued', attempt_token = null, lease_expires_at = null,
      next_attempt_at = p_next_attempt_at, error_code = null,
      last_error_code = p_error_code, finished_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where job.id = p_job_id and job.kind = 'delete' and job.status = 'running'
    and job.attempt_token = p_attempt_token
    and job.lease_expires_at > pg_catalog.clock_timestamp();
  return found;
end;
$$;

create or replace function public.requeue_failed_evidence_cleanup_job(
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
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_CLEANUP_REQUEUE';
  end if;
  update internal.storage_jobs as job
  set status = 'queued', attempt_token = null, lease_expires_at = null,
      next_attempt_at = p_next_attempt_at, error_code = null,
      last_error_code = coalesce(job.error_code, job.last_error_code),
      finished_at = null, updated_at = pg_catalog.clock_timestamp()
  where job.id = p_job_id and job.kind = 'delete' and job.status = 'failed';
  return found;
end;
$$;

create or replace function public.reconcile_orphan_evidence_objects(
  p_min_age_seconds integer default 900,
  p_limit integer default 100
)
returns table (job_id uuid, user_id uuid, object_key text)
language plpgsql
security definer
set search_path = pg_catalog, public, internal, storage
as $$
declare
  v_object record;
  v_owner_id uuid;
  v_job_id uuid;
  v_existing internal.storage_jobs%rowtype;
begin
  if p_min_age_seconds is null or p_min_age_seconds < 900 or p_min_age_seconds > 86400
     or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_ORPHAN_RECONCILIATION';
  end if;

  for v_object in
    select object_row.id, object_row.name
    from storage.objects as object_row
    where object_row.bucket_id = 'workpulse-private'
      and object_row.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/evidence/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and object_row.created_at <= pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_min_age_seconds)
      and not exists (select 1 from public.evidence_files as file where file.object_key = object_row.name)
    order by object_row.created_at, object_row.id
    for update of object_row skip locked
    limit p_limit
  loop
    v_owner_id := pg_catalog.split_part(v_object.name, '/', 1)::uuid;
    select job.* into v_existing from internal.storage_jobs as job
    where job.bucket_id = 'workpulse-private' and job.object_key = v_object.name and job.kind = 'delete'
    for update;
    if found then
      if v_existing.status <> 'succeeded' then continue; end if;
      update internal.storage_jobs as job
      set status = 'queued', attempt_token = null, lease_expires_at = null,
          next_attempt_at = pg_catalog.clock_timestamp(), error_code = null,
          last_error_code = coalesce(job.error_code, job.last_error_code),
          finished_at = null, updated_at = pg_catalog.clock_timestamp()
      where job.id = v_existing.id returning job.id into v_job_id;
    else
      insert into internal.storage_jobs (user_id, bucket_id, object_key, kind)
      values (v_owner_id, 'workpulse-private', v_object.name, 'delete')
      returning id into v_job_id;
    end if;
    job_id := v_job_id;
    user_id := v_owner_id;
    object_key := v_object.name;
    return next;
  end loop;
end;
$$;

-- Public wrappers are the only PostgREST/API surface for internal worker operations.
revoke all on function public.reserve_evidence_upload(uuid,text,uuid,text,text,bigint,uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.get_evidence_file(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.finalize_evidence_upload(uuid,uuid,integer,bigint,text,text) from public, anon, authenticated, service_role;
revoke all on function public.fail_evidence_upload(uuid,uuid,integer,text) from public, anon, authenticated, service_role;
revoke all on function public.expire_evidence_uploads(integer) from public, anon, authenticated, service_role;
revoke all on function public.delete_evidence_file(uuid,uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.claim_evidence_scan_jobs(integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_evidence_scan_job(uuid,uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function public.retry_evidence_scan_job(uuid,uuid,text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.claim_evidence_cleanup_jobs(integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_evidence_cleanup_job(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.fail_evidence_cleanup_job(uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.retry_evidence_cleanup_job(uuid,uuid,text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.requeue_failed_evidence_cleanup_job(uuid,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_orphan_evidence_objects(integer,integer) from public, anon, authenticated, service_role;

grant execute on function public.reserve_evidence_upload(uuid,text,uuid,text,text,bigint,uuid,integer) to service_role;
grant execute on function public.get_evidence_file(uuid,uuid) to service_role;
grant execute on function public.finalize_evidence_upload(uuid,uuid,integer,bigint,text,text) to service_role;
grant execute on function public.fail_evidence_upload(uuid,uuid,integer,text) to service_role;
grant execute on function public.expire_evidence_uploads(integer) to service_role;
grant execute on function public.delete_evidence_file(uuid,uuid,integer) to service_role;
grant execute on function public.claim_evidence_scan_jobs(integer) to service_role;
grant execute on function public.complete_evidence_scan_job(uuid,uuid,text,text) to service_role;
grant execute on function public.retry_evidence_scan_job(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.claim_evidence_cleanup_jobs(integer) to service_role;
grant execute on function public.complete_evidence_cleanup_job(uuid,uuid) to service_role;
grant execute on function public.fail_evidence_cleanup_job(uuid,uuid,text) to service_role;
grant execute on function public.retry_evidence_cleanup_job(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.requeue_failed_evidence_cleanup_job(uuid,timestamptz) to service_role;
grant execute on function public.reconcile_orphan_evidence_objects(integer,integer) to service_role;

comment on function public.reserve_evidence_upload(uuid,text,uuid,text,text,bigint,uuid,integer) is
  'Service gateway passes the user resolved from the active session. Atomically locks profile then typed parent, validates expected revision, quota, slots, and idempotency before reserving an immutable owner path.';
comment on function public.finalize_evidence_upload(uuid,uuid,integer,bigint,text,text) is
  'Binds finalize to the evidence revision, expiry, actual size, verified MIME, and SHA-256. A successful finalize and durable scan job are one transaction.';
comment on function public.complete_evidence_scan_job(uuid,uuid,text,text) is
  'Transitions scanning to ready only for a clean verdict from the current unexpired lease and a live owner/parent; rejected or unavailable payloads cannot become ready.';
comment on function public.complete_evidence_cleanup_job(uuid,uuid) is
  'Completes only after the worker verified the object is absent, then removes failed/deleting evidence metadata while preserving the no-FK storage receipt.';

commit;

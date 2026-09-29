-- T15 Import upload and extraction staging.
-- Adds import_batches/import_items (DB §4), a private scan+parse queue (internal.import_jobs),
-- and the ai_jobs `import` kind (DB §3: exactly one of activity_id or import_batch_id).
-- Extraction only ever writes staging rows; no canonical career table is touched here.
-- Lock order for every import operation: profile -> import batch -> import/AI job -> items.

-- 1. Helpers ---------------------------------------------------------------------------

create or replace function internal.is_permanent_import_error(p_code text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_code in (
    'FILE_EMPTY', 'FILE_TOO_LARGE', 'FILE_TYPE_MISMATCH', 'UNSUPPORTED_FORMAT', 'ENCRYPTED_FILE',
    'SCANNED_PDF', 'CORRUPT_FILE', 'EMPTY_DOCUMENT', 'TOO_MANY_PAGES', 'IMPORT_TEXT_TOO_LONG',
    'PARSER_TIMEOUT', 'MALWARE_DETECTED', 'UPLOAD_INCOMPLETE', 'ACCOUNT_DELETING', 'INVALID_IMPORT_JOB'
  );
$$;

comment on function internal.is_permanent_import_error(text) is
  'T15: file-level failures that a retry cannot fix; the batch offers another file or manual entry instead.';

-- 2. Tables -----------------------------------------------------------------------------

create table public.import_batches (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key uuid not null,
  payload_hash bytea not null,
  file_key text,
  filename text not null,
  mime_type text not null,
  bytes bigint not null,
  sha256 text not null,
  status text not null default 'queued',
  stage text not null default 'uploading',
  page_count integer,
  extracted_text text,
  error_code text,
  retry_count integer not null default 0,
  committed_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  expires_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  revision integer not null default 1,
  constraint import_batches_user_id_id_key unique (user_id, id),
  constraint import_batches_user_idempotency_key unique (user_id, idempotency_key),
  constraint import_batches_payload_hash_check check (pg_catalog.octet_length(payload_hash) = 32),
  constraint import_batches_file_key_check check (
    file_key is null or file_key = user_id::text || '/import/' || id::text
  ),
  constraint import_batches_filename_check check (
    pg_catalog.char_length(filename) between 1 and 255
    and pg_catalog.btrim(filename) <> ''
    and filename !~ '[[:cntrl:]]'
  ),
  constraint import_batches_mime_check check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  constraint import_batches_bytes_check check (bytes between 1 and 10485760),
  constraint import_batches_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint import_batches_status_check check (
    status in ('queued', 'running', 'review', 'committed', 'failed', 'cancelled')
  ),
  constraint import_batches_stage_check check (
    stage in ('uploading', 'screening', 'parsing', 'extracting', 'done')
  ),
  constraint import_batches_page_count_check check (page_count is null or page_count between 1 and 20),
  constraint import_batches_text_check check (
    extracted_text is null or pg_catalog.char_length(extracted_text) <= 60000
  ),
  constraint import_batches_error_code_check check (
    error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  constraint import_batches_retry_count_check check (retry_count between 0 and 3),
  constraint import_batches_failed_check check (
    (status = 'failed') = (error_code is not null and failed_at is not null)
  ),
  constraint import_batches_cancelled_check check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint import_batches_committed_check check ((status = 'committed') = (committed_at is not null)),
  constraint import_batches_review_check check (
    status not in ('review', 'committed') or (stage = 'done' and page_count is not null)
  ),
  constraint import_batches_expires_check check (
    expires_at is null or status in ('failed', 'cancelled', 'committed')
  ),
  constraint import_batches_purged_check check (
    purged_at is null
    or (status in ('failed', 'cancelled', 'committed') and extracted_text is null and file_key is null)
  ),
  constraint import_batches_revision_positive check (revision > 0)
);

create index import_batches_user_created_idx on public.import_batches (user_id, created_at desc, id);
create index import_batches_user_sha_idx on public.import_batches (user_id, sha256, created_at desc);
create index import_batches_expires_idx on public.import_batches (expires_at) where purged_at is null;

comment on table public.import_batches is
  'T15 CV import staging batch (DB §4). Owner-readable except text/object/idempotency columns; written only by import RPCs.';
comment on column public.import_batches.stage is
  'Technical progress within queued/running (uploading, screening, parsing, extracting, done). Status keeps the DB §4 enum.';
comment on column public.import_batches.page_count is
  'Pages from the trusted parser (PDF) or isolated renderer (DOCX); never from DOCX metadata.';
comment on column public.import_batches.expires_at is
  'Terminal purge deadline: immediately for cancelled/committed/permanent failures, 23 hours for retriable failures.';

create table public.import_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null,
  batch_id uuid not null,
  entity_type text not null,
  ordinal integer not null,
  payload jsonb,
  source_excerpt text,
  action text not null default 'create',
  target_id uuid,
  committed_id uuid,
  validation_errors jsonb not null default '[]'::jsonb,
  purged_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  revision integer not null default 1,
  constraint import_items_user_id_id_key unique (user_id, id),
  constraint import_items_batch_ordinal_key unique (user_id, batch_id, entity_type, ordinal),
  constraint import_items_user_batch_fkey foreign key (user_id, batch_id)
    references public.import_batches (user_id, id) on delete cascade,
  constraint import_items_entity_type_check check (
    entity_type in ('profile', 'experience', 'education', 'certification', 'skill', 'achievement')
  ),
  constraint import_items_ordinal_check check (ordinal >= 0),
  constraint import_items_payload_check check (
    payload is null
    or (pg_catalog.jsonb_typeof(payload) = 'object' and pg_catalog.pg_column_size(payload) <= 16384)
  ),
  constraint import_items_achievement_draft_check check (
    payload is null or entity_type <> 'achievement' or payload ->> 'status' = 'draft'
  ),
  constraint import_items_excerpt_check check (
    source_excerpt is null
    or (pg_catalog.btrim(source_excerpt) <> '' and pg_catalog.char_length(source_excerpt) <= 1000)
  ),
  constraint import_items_action_check check (action in ('create', 'map', 'skip')),
  constraint import_items_validation_errors_check check (
    pg_catalog.jsonb_typeof(validation_errors) = 'array'
    and pg_catalog.jsonb_array_length(validation_errors) <= 50
  ),
  constraint import_items_purged_check check (
    (purged_at is null) = (payload is not null and source_excerpt is not null)
  ),
  constraint import_items_revision_positive check (revision > 0)
);

create index import_items_batch_idx on public.import_items (user_id, batch_id, entity_type, ordinal);

comment on table public.import_items is
  'T15 staged import candidates. Extraction creates them; T16 commit resolves action/target_id/committed_id. Never canonical.';
comment on column public.import_items.payload is
  'Candidate fields named after canonical columns. Achievement payloads are always status=draft here; NULL only after purge.';

create table internal.import_jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null,
  batch_id uuid not null,
  object_key text not null,
  expected_bytes bigint not null,
  mime_type text not null,
  sha256 text not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  attempt_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  error_code text,
  last_error_code text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  finished_at timestamptz,
  constraint import_jobs_batch_key unique (batch_id),
  constraint import_jobs_user_batch_fkey foreign key (user_id, batch_id)
    references public.import_batches (user_id, id) on delete cascade,
  constraint import_jobs_key_owner_check check (object_key = user_id::text || '/import/' || batch_id::text),
  constraint import_jobs_bytes_check check (expected_bytes between 1 and 10485760),
  constraint import_jobs_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint import_jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint import_jobs_attempt_check check (attempt_count between 0 and 5),
  constraint import_jobs_error_check check (
    (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
    and (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
  ),
  constraint import_jobs_state_check check (
    (status = 'queued' and attempt_token is null and lease_expires_at is null
      and error_code is null and finished_at is null)
    or (status = 'running' and attempt_count > 0 and attempt_token is not null
      and lease_expires_at is not null and error_code is null and finished_at is null)
    or (status = 'succeeded' and attempt_count > 0 and attempt_token is not null
      and lease_expires_at is null and error_code is null and finished_at is not null)
    or (status = 'failed' and attempt_count > 0 and lease_expires_at is null
      and error_code is not null and finished_at is not null)
    or (status = 'cancelled' and lease_expires_at is null
      and error_code is not null and finished_at is not null)
  )
);

create index import_jobs_claim_idx on internal.import_jobs (next_attempt_at, created_at, id)
  where status in ('queued', 'running');

comment on table internal.import_jobs is
  'T15 scan+parse queue, one row per batch. 120 second lease, attempt token, at most 5 transient attempts.';

alter table internal.import_jobs enable row level security;
revoke all privileges on table internal.import_jobs from public, anon, authenticated, service_role;

-- 3. Guards -----------------------------------------------------------------------------

create or replace function internal.guard_import_batch_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if row(new.id, new.user_id, new.idempotency_key, new.payload_hash, new.filename, new.mime_type,
         new.bytes, new.sha256, new.created_at)
     is distinct from
     row(old.id, old.user_id, old.idempotency_key, old.payload_hash, old.filename, old.mime_type,
         old.bytes, old.sha256, old.created_at) then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_BATCH_MUTATION';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'queued' and new.status in ('running', 'failed', 'cancelled'))
    or (old.status = 'running' and new.status in ('review', 'failed', 'cancelled'))
    or (old.status = 'review' and new.status in ('committed', 'cancelled'))
    or (old.status = 'failed' and new.status in ('queued', 'running'))
  ) then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_TRANSITION';
  end if;
  if old.purged_at is not null and (new.extracted_text is not null or new.file_key is not null) then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_BATCH_MUTATION';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger import_batches_guard_row
before update on public.import_batches
for each row execute function internal.guard_import_batch_row();

create or replace function internal.guard_import_item_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if row(new.id, new.user_id, new.batch_id, new.entity_type, new.ordinal, new.created_at)
     is distinct from
     row(old.id, old.user_id, old.batch_id, old.entity_type, old.ordinal, old.created_at) then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_MUTATION';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger import_items_guard_row
before update on public.import_items
for each row execute function internal.guard_import_item_row();

alter table public.import_batches enable row level security;
alter table public.import_items enable row level security;

create policy import_batches_select_own on public.import_batches
  for select to authenticated using ((select auth.uid()) = user_id);
create policy import_items_select_own on public.import_items
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.import_batches from public, anon, authenticated, service_role;
revoke all on table public.import_items from public, anon, authenticated, service_role;
grant select (
  id, user_id, filename, mime_type, bytes, sha256, status, stage, page_count, error_code,
  retry_count, committed_at, cancelled_at, failed_at, expires_at, purged_at,
  created_at, updated_at, revision
) on public.import_batches to authenticated;
grant select on public.import_items to authenticated;
grant select on public.import_batches to service_role;
grant select on public.import_items to service_role;

-- 4. ai_jobs: import kind -------------------------------------------------------------------

alter table public.ai_jobs
  alter column activity_id drop not null,
  add column import_batch_id uuid;

alter table public.ai_jobs
  add constraint ai_jobs_user_import_batch_fkey foreign key (user_id, import_batch_id)
    references public.import_batches (user_id, id) on delete cascade;

alter table public.ai_jobs
  drop constraint ai_jobs_kind_check,
  add constraint ai_jobs_kind_check check (kind in ('detect', 'refine', 'import'));

alter table public.ai_jobs
  drop constraint ai_jobs_idempotency_key_check,
  add constraint ai_jobs_idempotency_key_check check (
    idempotency_key ~ '^(detect|refine|import):[0-9a-f-]{36}:r[1-9][0-9]*$'
  );

alter table public.ai_jobs
  drop constraint ai_jobs_key_kind_check,
  add constraint ai_jobs_key_kind_check check (
    (kind = 'detect' and idempotency_key like 'detect:%')
    or (kind = 'refine' and idempotency_key like 'refine:%')
    or (kind = 'import' and idempotency_key = 'import:' || import_batch_id::text || ':r1')
  );

alter table public.ai_jobs
  add constraint ai_jobs_target_check check (
    (kind in ('detect', 'refine') and activity_id is not null and import_batch_id is null)
    or (kind = 'import' and import_batch_id is not null and activity_id is null and input_revision = 1)
  ),
  add constraint ai_jobs_result_kind_check check (
    result is null or ((kind = 'import') = (result ->> 'schema_version' = 'import.v1'))
  );

create unique index ai_jobs_one_per_import_batch_idx
  on public.ai_jobs (user_id, import_batch_id) where import_batch_id is not null;

create or replace function internal.is_valid_ai_result(p_result jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_result is not null
    and pg_catalog.jsonb_typeof(p_result) = 'object'
    and pg_catalog.pg_column_size(p_result) <= 32768
    and (
      (p_result ->> 'schema_version' = 'detect.v1'
        and pg_catalog.jsonb_typeof(p_result -> 'potential') = 'boolean'
        and pg_catalog.jsonb_typeof(p_result -> 'questions') = 'array'
        and pg_catalog.jsonb_typeof(p_result -> 'suggestion') in ('object', 'null'))
      or (p_result ->> 'schema_version' = 'import.v1'
        and pg_catalog.jsonb_typeof(p_result -> 'counts') = 'object'
        and pg_catalog.jsonb_typeof(p_result -> 'dropped_ungrounded') = 'number'
        and not (p_result ? 'items'))
    );
$$;

create or replace function internal.guard_ai_job_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if row(new.id, new.user_id, new.kind, new.activity_id, new.import_batch_id, new.input_revision,
         new.idempotency_key, new.payload_hash, new.created_at)
     is distinct from
     row(old.id, old.user_id, old.kind, old.activity_id, old.import_batch_id, old.input_revision,
         old.idempotency_key, old.payload_hash, old.created_at) then
    raise exception using errcode = '22023', message = 'INVALID_AI_JOB_MUTATION';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

revoke select on public.ai_jobs from authenticated;
grant select (
  id, user_id, kind, activity_id, import_batch_id, input_revision, idempotency_key, consent_version,
  status, attempt_count, result, error_code, started_at, finished_at,
  created_at, updated_at, revision
) on public.ai_jobs to authenticated;

-- Batch failure shared by the scan/parse queue and the AI path. Caller holds the batch lock.
create or replace function internal.fail_import_batch_locked(p_batch_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.import_batches as batch
  set status = 'failed', error_code = p_error_code, failed_at = pg_catalog.clock_timestamp(),
      expires_at = pg_catalog.clock_timestamp()
        + case when internal.is_permanent_import_error(p_error_code) then interval '0' else interval '23 hours' end
  where batch.id = p_batch_id and batch.status in ('queued', 'running');
end;
$$;

-- T13 fail path, extended: an import job failure also fails its batch (still running).
create or replace function internal.fail_ai_job_locked(p_job public.ai_jobs, p_error_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.ai_jobs as job
  set status = 'failed', error_code = p_error_code, result = null,
      lease_expires_at = null, finished_at = pg_catalog.clock_timestamp()
  where job.id = p_job.id;
  if p_job.import_batch_id is not null then
    perform internal.fail_import_batch_locked(p_job.import_batch_id, p_error_code);
  else
    perform internal.set_activity_analysis_state(
      p_job.user_id, p_job.activity_id, p_job.input_revision, 'failed'
    );
  end if;
end;
$$;

-- Lock the job's target (activity or import batch) before the job row. Returns false when
-- the target could not be locked without waiting (skip_locked) or does not exist.
create or replace function internal.lock_ai_job_target(p_job public.ai_jobs, p_skip_locked boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_job.import_batch_id is not null then
    if p_skip_locked then
      perform 1 from public.import_batches as batch
      where batch.user_id = p_job.user_id and batch.id = p_job.import_batch_id for update skip locked;
    else
      perform 1 from public.import_batches as batch
      where batch.user_id = p_job.user_id and batch.id = p_job.import_batch_id for update;
    end if;
  else
    if p_skip_locked then
      perform 1 from public.activities as activity
      where activity.user_id = p_job.user_id and activity.id = p_job.activity_id for update skip locked;
    else
      perform 1 from public.activities as activity
      where activity.user_id = p_job.user_id and activity.id = p_job.activity_id for update;
    end if;
  end if;
  return found;
end;
$$;

create or replace function public.expire_ai_job_leases()
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_candidate public.ai_jobs%rowtype;
  v_job public.ai_jobs%rowtype;
  v_count integer := 0;
begin
  for v_candidate in
    select job.*
    from public.ai_jobs as job
    where job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    limit 100
  loop
    if not internal.lock_ai_job_target(v_candidate, true) then
      continue;
    end if;
    select job.* into v_job
    from public.ai_jobs as job
    where job.id = v_candidate.id
      and job.status = 'running'
      and job.lease_expires_at <= pg_catalog.clock_timestamp()
    for update skip locked;
    if not found then
      continue;
    end if;
    perform internal.fail_ai_job_locked(v_job, 'AI_TIMEOUT');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.fail_ai_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_snapshot public.ai_jobs%rowtype;
  v_job public.ai_jobs%rowtype;
begin
  if p_job_id is null or p_attempt_token is null or p_error_code is null
     or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception using errcode = '22023', message = 'INVALID_AI_JOB_FAILURE';
  end if;
  select job.* into v_snapshot from public.ai_jobs as job where job.id = p_job_id;
  if not found then
    return false;
  end if;
  perform 1 from public.profiles as profile where profile.id = v_snapshot.user_id for share;
  perform internal.lock_ai_job_target(v_snapshot, false);
  select job.* into v_job from public.ai_jobs as job where job.id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;
  perform internal.fail_ai_job_locked(v_job, p_error_code);
  return true;
end;
$$;

-- The activity-only input and completion RPCs never touch an import job.
create or replace function public.get_ai_job_input(p_job_id uuid, p_attempt_token uuid)
returns table (
  raw_text text,
  role text,
  scope text,
  outcome text,
  locale text,
  input_revision integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_snapshot public.ai_jobs%rowtype;
  v_deleting_at timestamptz;
  v_locale text;
  v_activity public.activities%rowtype;
  v_job public.ai_jobs%rowtype;
begin
  if p_job_id is null or p_attempt_token is null then
    return;
  end if;
  select job.* into v_snapshot from public.ai_jobs as job where job.id = p_job_id;
  if not found or v_snapshot.kind = 'import' then
    return;
  end if;

  select profile.deleting_at, profile.locale into v_deleting_at, v_locale
  from public.profiles as profile
  where profile.id = v_snapshot.user_id
  for share;

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_snapshot.user_id and activity.id = v_snapshot.activity_id
  for update;

  select job.* into v_job from public.ai_jobs as job where job.id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return;
  end if;

  if v_deleting_at is not null then
    perform internal.fail_ai_job_locked(v_job, 'ACCOUNT_DELETING');
    return;
  end if;
  if not internal.has_current_ai_consent(v_job.user_id) then
    perform internal.fail_ai_job_locked(v_job, 'CONSENT_REQUIRED');
    return;
  end if;
  if v_activity.id is null or v_activity.revision <> v_job.input_revision then
    perform internal.fail_ai_job_locked(v_job, 'STALE_INPUT');
    return;
  end if;

  perform internal.set_activity_analysis_state(v_job.user_id, v_job.activity_id, v_job.input_revision, 'running');
  return query select v_activity.raw_text, v_activity.role, v_activity.scope, v_activity.outcome,
    v_locale, v_job.input_revision;
end;
$$;

create or replace function public.complete_ai_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_result jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_snapshot public.ai_jobs%rowtype;
  v_deleting_at timestamptz;
  v_activity public.activities%rowtype;
  v_job public.ai_jobs%rowtype;
begin
  if p_job_id is null or p_attempt_token is null then
    raise exception using errcode = '22023', message = 'INVALID_AI_JOB_COMPLETION';
  end if;
  select job.* into v_snapshot from public.ai_jobs as job where job.id = p_job_id;
  if not found or v_snapshot.kind = 'import' then
    return 'stale';
  end if;

  select profile.deleting_at into v_deleting_at
  from public.profiles as profile
  where profile.id = v_snapshot.user_id
  for share;

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_snapshot.user_id and activity.id = v_snapshot.activity_id
  for update;

  select job.* into v_job from public.ai_jobs as job where job.id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return 'stale';
  end if;

  if v_deleting_at is not null then
    perform internal.fail_ai_job_locked(v_job, 'ACCOUNT_DELETING');
    return 'failed:ACCOUNT_DELETING';
  end if;
  if not internal.has_current_ai_consent(v_job.user_id) then
    perform internal.fail_ai_job_locked(v_job, 'CONSENT_WITHDRAWN');
    return 'failed:CONSENT_WITHDRAWN';
  end if;
  if v_activity.id is null or v_activity.revision <> v_job.input_revision then
    perform internal.fail_ai_job_locked(v_job, 'STALE_INPUT');
    return 'failed:STALE_INPUT';
  end if;
  if not internal.is_valid_ai_result(p_result) or p_result ->> 'schema_version' <> 'detect.v1' then
    perform internal.fail_ai_job_locked(v_job, 'AI_OUTPUT_INVALID');
    return 'invalid';
  end if;
  if pg_catalog.jsonb_array_length(p_result -> 'questions') > 3
     or (v_job.kind = 'refine' and pg_catalog.jsonb_array_length(p_result -> 'questions') <> 0) then
    perform internal.fail_ai_job_locked(v_job, 'AI_OUTPUT_INVALID');
    return 'invalid';
  end if;

  update public.ai_jobs as job
  set status = 'succeeded', result = p_result, error_code = null,
      lease_expires_at = null, finished_at = pg_catalog.clock_timestamp()
  where job.id = v_job.id;
  perform internal.set_activity_analysis_state(v_job.user_id, v_job.activity_id, v_job.input_revision, 'done');
  return 'succeeded';
end;
$$;

-- T14 retry_ai_job body, with import jobs refused (they retry through retry_import_batch).
create or replace function public.retry_ai_job(p_job_id uuid)
returns table (
  job_id uuid,
  status text,
  input_revision integer,
  attempt_count integer,
  error_code text,
  kind text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_snapshot public.ai_jobs%rowtype;
  v_activity_revision integer;
  v_job public.ai_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  perform 1 from public.profiles as profile
  where profile.id = v_user_id and profile.deleting_at is null
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select job.* into v_snapshot
  from public.ai_jobs as job
  where job.id = p_job_id and job.user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;
  if v_snapshot.kind = 'import' then
    raise exception using errcode = 'P0001', message = 'AI_JOB_NOT_APPLICABLE';
  end if;

  select activity.revision into v_activity_revision
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = v_snapshot.activity_id
  for update;

  select job.* into v_job
  from public.ai_jobs as job
  where job.id = p_job_id and job.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;
  if v_job.status <> 'failed' then
    raise exception using errcode = 'P0001', message = 'AI_JOB_NOT_RETRYABLE';
  end if;
  if not internal.has_current_ai_consent(v_user_id) then
    raise exception using errcode = 'P0001', message = 'CONSENT_REQUIRED';
  end if;
  if v_activity_revision is distinct from v_job.input_revision then
    raise exception using errcode = 'P0001', message = 'STALE_INPUT';
  end if;
  if v_job.attempt_count >= 3 then
    raise exception using errcode = 'P0001', message = 'AI_RETRY_EXHAUSTED';
  end if;

  update public.ai_jobs as job
  set status = 'queued', attempt_token = null, lease_expires_at = null,
      error_code = null, result = null, finished_at = null,
      consent_version = internal.current_ai_consent_version()
  where job.id = v_job.id
  returning job.* into v_job;
  perform internal.set_activity_analysis_state(v_user_id, v_job.activity_id, v_job.input_revision, 'queued');

  return query select v_job.id, v_job.status, v_job.input_revision, v_job.attempt_count, v_job.error_code, v_job.kind;
end;
$$;

-- Enqueue (or requeue) the single import AI job for a locked batch.
create or replace function internal.enqueue_import_ai_job(p_batch public.import_batches)
returns public.ai_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.ai_jobs%rowtype;
  v_hash bytea := extensions.digest(coalesce(p_batch.extracted_text, ''), 'sha256');
begin
  insert into public.ai_jobs (
    user_id, kind, activity_id, import_batch_id, input_revision, idempotency_key, payload_hash, consent_version
  ) values (
    p_batch.user_id, 'import', null, p_batch.id, 1, 'import:' || p_batch.id::text || ':r1', v_hash,
    internal.current_ai_consent_version()
  )
  on conflict (user_id, import_batch_id) where import_batch_id is not null do nothing
  returning * into v_job;
  if v_job.id is null then
    select job.* into v_job from public.ai_jobs as job
    where job.user_id = p_batch.user_id and job.import_batch_id = p_batch.id
    for update;
    if v_job.status = 'failed' then
      update public.ai_jobs as job
      set status = 'queued', attempt_token = null, lease_expires_at = null,
          error_code = null, result = null, finished_at = null,
          consent_version = internal.current_ai_consent_version()
      where job.id = v_job.id
      returning job.* into v_job;
    end if;
  end if;
  return v_job;
end;
$$;

-- 5. User operations (authenticated, owner from auth.uid()) ---------------------------------

create or replace function internal.import_actor()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  perform 1 from public.profiles as profile
  where profile.id = v_user_id and profile.deleting_at is null
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  return v_user_id;
end;
$$;

create or replace function public.begin_import_batch(
  p_idempotency_key uuid,
  p_filename text,
  p_bytes bigint,
  p_mime_type text,
  p_sha256 text
)
returns table (
  batch_id uuid,
  revision integer,
  status text,
  stage text,
  file_key text,
  duplicate_of_created_at timestamptz,
  duplicate_of_status text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.import_actor();
  v_hash bytea;
  v_batch public.import_batches%rowtype;
  v_replayed boolean := false;
  v_dup_created timestamptz;
  v_dup_status text;
  v_id uuid := pg_catalog.gen_random_uuid();
begin
  if p_idempotency_key is null or p_filename is null or p_bytes is null or p_mime_type is null or p_sha256 is null
     or pg_catalog.char_length(p_filename) not between 1 and 255 or pg_catalog.btrim(p_filename) = ''
     or p_filename ~ '[[:cntrl:]]'
     or p_bytes not between 1 and 10485760
     or p_mime_type not in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
     or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_UPLOAD';
  end if;
  if not internal.has_current_ai_consent(v_user_id) then
    raise exception using errcode = 'P0001', message = 'CONSENT_REQUIRED';
  end if;

  v_hash := extensions.digest(p_sha256 || ':' || p_bytes::text || ':' || p_mime_type || ':' || p_filename, 'sha256');

  insert into public.import_batches (
    id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256
  ) values (
    v_id, v_user_id, p_idempotency_key, v_hash, v_user_id::text || '/import/' || v_id::text,
    p_filename, p_mime_type, p_bytes, p_sha256
  )
  on conflict on constraint import_batches_user_idempotency_key do nothing
  returning * into v_batch;

  if v_batch.id is null then
    select batch.* into v_batch from public.import_batches as batch
    where batch.user_id = v_user_id and batch.idempotency_key = p_idempotency_key;
    if v_batch.payload_hash <> v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    v_replayed := true;
  end if;

  select batch.created_at, batch.status into v_dup_created, v_dup_status
  from public.import_batches as batch
  where batch.user_id = v_user_id and batch.sha256 = p_sha256 and batch.id <> v_batch.id
    and batch.created_at <= v_batch.created_at
  order by batch.created_at desc, batch.id desc
  limit 1;

  return query select v_batch.id, v_batch.revision, v_batch.status, v_batch.stage, v_batch.file_key,
    v_dup_created, v_dup_status, v_replayed;
end;
$$;

create or replace function public.cancel_import_batch(p_batch_id uuid)
returns table (batch_id uuid, revision integer, status text, stage text, error_code text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.import_actor();
  v_batch public.import_batches%rowtype;
begin
  select batch.* into v_batch from public.import_batches as batch
  where batch.user_id = v_user_id and batch.id = p_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  if v_batch.status in ('queued', 'running', 'review') then
    update internal.import_jobs as job
    set status = 'cancelled', attempt_token = job.attempt_token, lease_expires_at = null,
        error_code = 'IMPORT_CANCELLED', finished_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where job.batch_id = v_batch.id and job.status in ('queued', 'running');
    update public.import_batches as batch
    set status = 'cancelled', cancelled_at = pg_catalog.clock_timestamp(),
        expires_at = pg_catalog.clock_timestamp()
    where batch.id = v_batch.id
    returning batch.* into v_batch;
  elsif v_batch.status <> 'cancelled' then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_CANCELLABLE';
  end if;
  return query select v_batch.id, v_batch.revision, v_batch.status, v_batch.stage, v_batch.error_code;
end;
$$;

create or replace function public.retry_import_batch(p_batch_id uuid)
returns table (batch_id uuid, revision integer, status text, stage text, error_code text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.import_actor();
  v_batch public.import_batches%rowtype;
  v_ai public.ai_jobs%rowtype;
begin
  select batch.* into v_batch from public.import_batches as batch
  where batch.user_id = v_user_id and batch.id = p_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  if v_batch.status in ('queued', 'running') then
    -- A concurrent retry already resumed the batch.
    return query select v_batch.id, v_batch.revision, v_batch.status, v_batch.stage, v_batch.error_code;
    return;
  end if;
  if v_batch.status <> 'failed' or internal.is_permanent_import_error(v_batch.error_code)
     or v_batch.stage = 'uploading' then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_RETRIABLE';
  end if;
  if v_batch.purged_at is not null or v_batch.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'IMPORT_EXPIRED';
  end if;
  if v_batch.retry_count >= 3 then
    raise exception using errcode = 'P0001', message = 'IMPORT_RETRY_EXHAUSTED';
  end if;
  if not internal.has_current_ai_consent(v_user_id) then
    raise exception using errcode = 'P0001', message = 'CONSENT_REQUIRED';
  end if;

  if v_batch.stage = 'extracting' then
    select job.* into v_ai from public.ai_jobs as job
    where job.user_id = v_user_id and job.import_batch_id = v_batch.id
    for update;
    if v_ai.id is not null and v_ai.attempt_count >= 3 then
      raise exception using errcode = 'P0001', message = 'IMPORT_RETRY_EXHAUSTED';
    end if;
    update public.import_batches as batch
    set status = 'running', error_code = null, failed_at = null, expires_at = null,
        retry_count = batch.retry_count + 1
    where batch.id = v_batch.id
    returning batch.* into v_batch;
    perform internal.enqueue_import_ai_job(v_batch);
  else
    update internal.import_jobs as job
    set status = 'queued', attempt_count = 0, attempt_token = null, lease_expires_at = null,
        next_attempt_at = pg_catalog.clock_timestamp(), error_code = null, finished_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where job.batch_id = v_batch.id;
    update public.import_batches as batch
    set status = 'queued', stage = 'screening', error_code = null, failed_at = null, expires_at = null,
        retry_count = batch.retry_count + 1
    where batch.id = v_batch.id
    returning batch.* into v_batch;
  end if;
  return query select v_batch.id, v_batch.revision, v_batch.status, v_batch.stage, v_batch.error_code;
end;
$$;

-- 6. Server/worker operations (service_role) -------------------------------------------------

create or replace function public.finalize_import_upload(p_user_id uuid, p_batch_id uuid)
returns table (batch_id uuid, revision integer, status text, stage text, error_code text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_batch public.import_batches%rowtype;
begin
  if p_user_id is null or p_batch_id is null then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_FINALIZE';
  end if;
  perform 1 from public.profiles as profile
  where profile.id = p_user_id and profile.deleting_at is null
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select batch.* into v_batch from public.import_batches as batch
  where batch.user_id = p_user_id and batch.id = p_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  if v_batch.status = 'queued' and v_batch.stage = 'uploading' then
    insert into internal.import_jobs (user_id, batch_id, object_key, expected_bytes, mime_type, sha256)
    values (v_batch.user_id, v_batch.id, v_batch.file_key, v_batch.bytes, v_batch.mime_type, v_batch.sha256)
    on conflict (batch_id) do nothing;
    update public.import_batches as batch
    set stage = 'screening'
    where batch.id = v_batch.id
    returning batch.* into v_batch;
  end if;
  return query select v_batch.id, v_batch.revision, v_batch.status, v_batch.stage, v_batch.error_code;
end;
$$;

create or replace function public.expire_import_uploads(p_limit integer default 100, p_min_age_seconds integer default 900)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 or p_min_age_seconds is null or p_min_age_seconds < 0 then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_HOUSEKEEPING';
  end if;
  with candidates as (
    select batch.id from public.import_batches as batch
    where batch.status = 'queued' and batch.stage = 'uploading'
      and batch.created_at <= pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_min_age_seconds)
    order by batch.created_at, batch.id
    for update skip locked
    limit p_limit
  )
  update public.import_batches as batch
  set status = 'failed', error_code = 'UPLOAD_INCOMPLETE', failed_at = pg_catalog.clock_timestamp(),
      expires_at = pg_catalog.clock_timestamp()
  from candidates where batch.id = candidates.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.claim_import_jobs(p_limit integer default 1)
returns table (
  id uuid, user_id uuid, batch_id uuid, object_key text, expected_bytes bigint, mime_type text,
  sha256 text, attempt_count integer, attempt_token uuid, lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_expired record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10 then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_JOB_CLAIM_LIMIT';
  end if;

  -- A lease that expired on the last allowed attempt fails its batch as a transient outage.
  for v_expired in
    select job.id, job.batch_id from internal.import_jobs as job
    where job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp()
      and job.attempt_count >= 5
    order by job.lease_expires_at
    limit 20
  loop
    perform 1 from public.import_batches as batch where batch.id = v_expired.batch_id for update skip locked;
    if not found then continue; end if;
    update internal.import_jobs as job
    set status = 'failed', lease_expires_at = null, error_code = 'IMPORT_WORKER_TIMEOUT',
        finished_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
    where job.id = v_expired.id and job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp();
    if found then
      perform internal.fail_import_batch_locked(v_expired.batch_id, 'IMPORT_WORKER_TIMEOUT');
    end if;
  end loop;

  return query
  with candidates as (
    select job.id, job.batch_id from internal.import_jobs as job
    join public.import_batches as batch on batch.id = job.batch_id
    join public.profiles as profile on profile.id = job.user_id
    where job.next_attempt_at <= pg_catalog.clock_timestamp()
      and job.attempt_count < 5
      and (job.status = 'queued' or (job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp()))
      and batch.status in ('queued', 'running')
      and profile.deleting_at is null
    order by job.next_attempt_at, job.created_at, job.id
    for update of batch, job skip locked
    limit p_limit
  ), marked as (
    update public.import_batches as batch
    set status = 'running', stage = 'screening'
    from candidates where batch.id = candidates.batch_id
    returning batch.id
  ), claimed as (
    update internal.import_jobs as job
    set status = 'running', attempt_count = job.attempt_count + 1,
        attempt_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds',
        error_code = null, finished_at = null, updated_at = pg_catalog.clock_timestamp()
    from candidates where job.id = candidates.id and exists (select 1 from marked where marked.id = candidates.batch_id)
    returning job.*
  )
  select claimed.id, claimed.user_id, claimed.batch_id, claimed.object_key, claimed.expected_bytes,
    claimed.mime_type, claimed.sha256, claimed.attempt_count, claimed.attempt_token, claimed.lease_expires_at
  from claimed
  order by claimed.next_attempt_at, claimed.created_at, claimed.id;
end;
$$;

-- Lock profile -> batch -> job and verify the lease. Returns the locked job, or NULL when stale.
create or replace function internal.lock_import_job(
  p_job_id uuid,
  p_attempt_token uuid,
  out o_job internal.import_jobs,
  out o_batch public.import_batches,
  out o_deleting boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_snapshot internal.import_jobs%rowtype;
begin
  if p_job_id is null or p_attempt_token is null then
    return;
  end if;
  select job.* into v_snapshot from internal.import_jobs as job where job.id = p_job_id;
  if not found then
    return;
  end if;
  select profile.deleting_at is not null into o_deleting
  from public.profiles as profile where profile.id = v_snapshot.user_id for share;
  select batch.* into o_batch from public.import_batches as batch
  where batch.user_id = v_snapshot.user_id and batch.id = v_snapshot.batch_id for update;
  select job.* into o_job from internal.import_jobs as job where job.id = p_job_id for update;
  if o_job.id is null or o_job.status <> 'running' or o_job.attempt_token <> p_attempt_token
     or o_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    o_job := null;
  end if;
end;
$$;

create or replace function internal.close_import_job(p_job_id uuid, p_status text, p_error_code text)
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  update internal.import_jobs as job
  set status = p_status, lease_expires_at = null, error_code = p_error_code,
      finished_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
  where job.id = p_job_id;
$$;

create or replace function public.advance_import_job(p_job_id uuid, p_attempt_token uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_lock record;
begin
  select * into v_lock from internal.lock_import_job(p_job_id, p_attempt_token);
  if (v_lock.o_job).id is null then
    return false;
  end if;
  if (v_lock.o_batch).status <> 'running' then
    perform internal.close_import_job((v_lock.o_job).id, 'cancelled', 'IMPORT_CANCELLED');
    return false;
  end if;
  if v_lock.o_deleting then
    perform internal.close_import_job((v_lock.o_job).id, 'failed', 'ACCOUNT_DELETING');
    perform internal.fail_import_batch_locked((v_lock.o_batch).id, 'ACCOUNT_DELETING');
    return false;
  end if;
  update public.import_batches as batch set stage = 'parsing' where batch.id = (v_lock.o_batch).id;
  return true;
end;
$$;

create or replace function public.complete_import_parse(
  p_job_id uuid,
  p_attempt_token uuid,
  p_text text,
  p_page_count integer
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_lock record;
  v_batch public.import_batches%rowtype;
begin
  if p_text is null or pg_catalog.btrim(p_text) = '' or pg_catalog.char_length(p_text) > 60000
     or p_page_count is null or p_page_count not between 1 and 20 then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_PARSE';
  end if;
  select * into v_lock from internal.lock_import_job(p_job_id, p_attempt_token);
  if (v_lock.o_job).id is null then
    return 'stale';
  end if;
  if (v_lock.o_batch).status <> 'running' or (v_lock.o_batch).stage <> 'parsing' then
    perform internal.close_import_job((v_lock.o_job).id, 'cancelled', 'IMPORT_CANCELLED');
    return 'stale';
  end if;
  if v_lock.o_deleting then
    perform internal.close_import_job((v_lock.o_job).id, 'failed', 'ACCOUNT_DELETING');
    perform internal.fail_import_batch_locked((v_lock.o_batch).id, 'ACCOUNT_DELETING');
    return 'failed:ACCOUNT_DELETING';
  end if;

  update internal.import_jobs as job
  set status = 'succeeded', lease_expires_at = null, error_code = null,
      finished_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
  where job.id = (v_lock.o_job).id;
  update public.import_batches as batch
  set stage = 'extracting', extracted_text = p_text, page_count = p_page_count
  where batch.id = (v_lock.o_batch).id
  returning batch.* into v_batch;

  if not internal.has_current_ai_consent(v_batch.user_id) then
    perform internal.fail_import_batch_locked(v_batch.id, 'CONSENT_REQUIRED');
    return 'failed:CONSENT_REQUIRED';
  end if;
  perform internal.enqueue_import_ai_job(v_batch);
  return 'succeeded';
end;
$$;

-- p_final=true stops retrying the scan/parse job now; the batch code decides whether the
-- user may retry later (internal.is_permanent_import_error).
create or replace function public.fail_import_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_error_code text,
  p_final boolean,
  p_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_lock record;
begin
  if p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' or p_final is null
     or p_next_attempt_at is null then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_JOB_FAILURE';
  end if;
  select * into v_lock from internal.lock_import_job(p_job_id, p_attempt_token);
  if (v_lock.o_job).id is null then
    return false;
  end if;
  if (v_lock.o_batch).status <> 'running' then
    perform internal.close_import_job((v_lock.o_job).id, 'cancelled', 'IMPORT_CANCELLED');
    return false;
  end if;
  if p_final or internal.is_permanent_import_error(p_error_code) or (v_lock.o_job).attempt_count >= 5 then
    update internal.import_jobs as job
    set status = 'failed', lease_expires_at = null, error_code = p_error_code, last_error_code = p_error_code,
        finished_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
    where job.id = (v_lock.o_job).id;
    perform internal.fail_import_batch_locked((v_lock.o_batch).id, p_error_code);
  else
    update internal.import_jobs as job
    set status = 'queued', attempt_token = null, lease_expires_at = null,
        next_attempt_at = p_next_attempt_at, error_code = null, last_error_code = p_error_code,
        finished_at = null, updated_at = pg_catalog.clock_timestamp()
    where job.id = (v_lock.o_job).id;
  end if;
  return true;
end;
$$;

-- Locks profile -> batch -> AI job for an import job lease. NULL job when stale.
create or replace function internal.lock_import_ai_job(
  p_job_id uuid,
  p_attempt_token uuid,
  out o_job public.ai_jobs,
  out o_batch public.import_batches,
  out o_deleting boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_snapshot public.ai_jobs%rowtype;
begin
  if p_job_id is null or p_attempt_token is null then
    return;
  end if;
  select job.* into v_snapshot from public.ai_jobs as job where job.id = p_job_id;
  if not found or v_snapshot.kind <> 'import' then
    return;
  end if;
  select profile.deleting_at is not null into o_deleting
  from public.profiles as profile where profile.id = v_snapshot.user_id for share;
  select batch.* into o_batch from public.import_batches as batch
  where batch.user_id = v_snapshot.user_id and batch.id = v_snapshot.import_batch_id for update;
  select job.* into o_job from public.ai_jobs as job where job.id = p_job_id for update;
  if o_job.id is null or o_job.status <> 'running' or o_job.attempt_token <> p_attempt_token
     or o_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    o_job := null;
  end if;
end;
$$;

create or replace function public.get_import_ai_job_input(p_job_id uuid, p_attempt_token uuid)
returns table (text text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_lock record;
begin
  select * into v_lock from internal.lock_import_ai_job(p_job_id, p_attempt_token);
  if (v_lock.o_job).id is null then
    return;
  end if;
  if (v_lock.o_batch).status <> 'running' or (v_lock.o_batch).stage <> 'extracting'
     or (v_lock.o_batch).extracted_text is null then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'IMPORT_CANCELLED');
    return;
  end if;
  if v_lock.o_deleting then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'ACCOUNT_DELETING');
    return;
  end if;
  if not internal.has_current_ai_consent((v_lock.o_job).user_id) then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'CONSENT_REQUIRED');
    return;
  end if;
  return query select (v_lock.o_batch).extracted_text;
end;
$$;

create or replace function public.complete_import_ai_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_summary jsonb,
  p_items jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_lock record;
  v_batch public.import_batches%rowtype;
  v_item jsonb;
  v_type text;
  v_payload jsonb;
  v_refs jsonb := '{}'::jsonb;
  v_id uuid;
  v_ordinals jsonb := '{}'::jsonb;
  v_ordinal integer;
  v_valid boolean := true;
begin
  if p_job_id is null or p_attempt_token is null then
    raise exception using errcode = '22023', message = 'INVALID_AI_JOB_COMPLETION';
  end if;
  select * into v_lock from internal.lock_import_ai_job(p_job_id, p_attempt_token);
  if (v_lock.o_job).id is null then
    return 'stale';
  end if;
  v_batch := v_lock.o_batch;
  if v_batch.status <> 'running' or v_batch.stage <> 'extracting' then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'IMPORT_CANCELLED');
    return 'stale';
  end if;
  if v_lock.o_deleting then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'ACCOUNT_DELETING');
    return 'failed:ACCOUNT_DELETING';
  end if;
  if not internal.has_current_ai_consent((v_lock.o_job).user_id) then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'CONSENT_WITHDRAWN');
    return 'failed:CONSENT_WITHDRAWN';
  end if;

  -- Structural validation of the staged candidates (field grounding is done in the worker).
  if not internal.is_valid_ai_result(p_summary) or p_summary ->> 'schema_version' <> 'import.v1'
     or p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) > 300
     or (select count(*) from pg_catalog.jsonb_array_elements(p_items) as e(value) where e.value ->> 'entity_type' = 'profile') > 1 then
    v_valid := false;
  else
    for v_item in select value from pg_catalog.jsonb_array_elements(p_items) loop
      v_type := v_item ->> 'entity_type';
      if pg_catalog.jsonb_typeof(v_item) <> 'object'
         or v_type is null
         or v_type not in ('profile', 'experience', 'education', 'certification', 'skill', 'achievement')
         or pg_catalog.jsonb_typeof(v_item -> 'payload') <> 'object'
         or pg_catalog.jsonb_typeof(v_item -> 'source_excerpt') <> 'string'
         or pg_catalog.btrim(v_item ->> 'source_excerpt') = ''
         or pg_catalog.char_length(v_item ->> 'source_excerpt') > 1000
         or pg_catalog.jsonb_typeof(coalesce(v_item -> 'validation_errors', '[]'::jsonb)) <> 'array'
         or (v_type = 'achievement' and v_item -> 'payload' ->> 'status' is distinct from 'draft')
         or (select count(*) from pg_catalog.jsonb_array_elements(p_items) as e(value) where e.value ->> 'entity_type' = v_type) > 60 then
        v_valid := false;
        exit;
      end if;
    end loop;
  end if;
  if not v_valid then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'AI_OUTPUT_INVALID');
    return 'invalid';
  end if;

  -- Insert non-achievement items first so achievement experience_ref can resolve.
  for v_item in
    select value from pg_catalog.jsonb_array_elements(p_items) with ordinality as e(value, n)
    order by (e.value ->> 'entity_type' = 'achievement'), e.n
  loop
    v_type := v_item ->> 'entity_type';
    v_payload := v_item -> 'payload';
    if v_type = 'achievement' then
      if v_payload ? 'experience_ref' then
        v_payload := v_payload - 'experience_ref'
          || pg_catalog.jsonb_build_object('experience_item_id', v_refs -> (v_item -> 'payload' ->> 'experience_ref'));
      end if;
    end if;
    v_ordinal := coalesce((v_ordinals ->> v_type)::integer, 0);
    v_ordinals := v_ordinals || pg_catalog.jsonb_build_object(v_type, v_ordinal + 1);
    insert into public.import_items (
      user_id, batch_id, entity_type, ordinal, payload, source_excerpt, validation_errors
    ) values (
      v_batch.user_id, v_batch.id, v_type, v_ordinal, v_payload, v_item ->> 'source_excerpt',
      coalesce(v_item -> 'validation_errors', '[]'::jsonb)
    )
    returning id into v_id;
    if v_type = 'experience' and pg_catalog.jsonb_typeof(v_item -> 'ref') = 'string' then
      v_refs := v_refs || pg_catalog.jsonb_build_object(v_item ->> 'ref', v_id);
    end if;
  end loop;

  update public.ai_jobs as job
  set status = 'succeeded', result = p_summary, error_code = null,
      lease_expires_at = null, finished_at = pg_catalog.clock_timestamp()
  where job.id = (v_lock.o_job).id;
  update public.import_batches as batch
  set status = 'review', stage = 'done'
  where batch.id = v_batch.id;
  return 'succeeded';
end;
$$;

-- 7. Retention ----------------------------------------------------------------------------

create or replace function public.purge_expired_import_batches(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_batch public.import_batches%rowtype;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_HOUSEKEEPING';
  end if;
  for v_batch in
    select batch.* from public.import_batches as batch
    where batch.purged_at is null
      and batch.status in ('failed', 'cancelled', 'committed')
      and batch.expires_at <= pg_catalog.clock_timestamp()
    order by batch.expires_at, batch.id
    for update skip locked
    limit p_limit
  loop
    if v_batch.file_key is not null then
      perform internal.enqueue_storage_delete(v_batch.user_id, v_batch.file_key);
    end if;
    if v_batch.status = 'committed' then
      update public.import_items as item
      set payload = null, source_excerpt = null, purged_at = pg_catalog.clock_timestamp()
      where item.user_id = v_batch.user_id and item.batch_id = v_batch.id and item.purged_at is null;
    else
      delete from public.import_items as item
      where item.user_id = v_batch.user_id and item.batch_id = v_batch.id;
    end if;
    update public.import_batches as batch
    set extracted_text = null, file_key = null, purged_at = pg_catalog.clock_timestamp()
    where batch.id = v_batch.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.claim_import_cleanup_jobs(p_limit integer default 1)
returns table (
  id uuid, user_id uuid, object_key text, attempt_count integer, attempt_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_CLEANUP_CLAIM';
  end if;
  return query
  with candidates as (
    select queued.id from internal.storage_jobs as queued
    where queued.bucket_id = 'workpulse-private'
      and pg_catalog.split_part(queued.object_key, '/', 2) = 'import'
      and queued.next_attempt_at <= pg_catalog.clock_timestamp()
      and (queued.status = 'queued' or (queued.status = 'running' and queued.lease_expires_at <= pg_catalog.clock_timestamp()))
    order by queued.next_attempt_at, queued.created_at, queued.id
    for update of queued skip locked limit p_limit
  ), claimed as (
    update internal.storage_jobs as queued
    set status = 'running', attempt_count = queued.attempt_count + 1,
        attempt_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds',
        error_code = null, finished_at = null, updated_at = pg_catalog.clock_timestamp()
    from candidates where queued.id = candidates.id returning queued.*
  )
  select job.id, job.user_id, job.object_key, job.attempt_count, job.attempt_token, job.lease_expires_at
  from claimed as job;
end;
$$;

create or replace function public.complete_import_cleanup_job(p_job_id uuid, p_attempt_token uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if not exists (
    select 1 from internal.storage_jobs as job
    where job.id = p_job_id and pg_catalog.split_part(job.object_key, '/', 2) = 'import'
  ) then
    return false;
  end if;
  return internal.complete_storage_job(p_job_id, p_attempt_token);
end;
$$;

create or replace function public.fail_import_cleanup_job(p_job_id uuid, p_attempt_token uuid, p_error_code text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, internal
as $$
begin
  if not exists (
    select 1 from internal.storage_jobs as job
    where job.id = p_job_id and pg_catalog.split_part(job.object_key, '/', 2) = 'import'
  ) then
    return false;
  end if;
  return internal.fail_storage_job(p_job_id, p_attempt_token, p_error_code);
end;
$$;

create or replace function public.retry_import_cleanup_job(
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
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_CLEANUP_RETRY';
  end if;
  update internal.storage_jobs as job
  set status = 'queued', attempt_token = null, lease_expires_at = null,
      next_attempt_at = p_next_attempt_at, error_code = null,
      last_error_code = p_error_code, finished_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where job.id = p_job_id and job.kind = 'delete' and job.status = 'running'
    and pg_catalog.split_part(job.object_key, '/', 2) = 'import'
    and job.attempt_token = p_attempt_token
    and job.lease_expires_at > pg_catalog.clock_timestamp();
  return found;
end;
$$;

create or replace function public.reconcile_orphan_import_objects(
  p_min_age_seconds integer default 3600,
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, internal, storage
as $$
declare
  v_object record;
  v_count integer := 0;
begin
  if p_min_age_seconds is null or p_min_age_seconds < 900 or p_min_age_seconds > 86400
     or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_ORPHAN_RECONCILIATION';
  end if;
  for v_object in
    select object_row.name
    from storage.objects as object_row
    where object_row.bucket_id = 'workpulse-private'
      and object_row.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/import/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and object_row.created_at <= pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_min_age_seconds)
      and not exists (select 1 from public.import_batches as batch where batch.file_key = object_row.name)
      and not exists (
        select 1 from internal.storage_jobs as job
        where job.object_key = object_row.name and job.kind = 'delete' and job.status in ('queued', 'running')
      )
    order by object_row.created_at, object_row.id
    limit p_limit
  loop
    update internal.storage_jobs as job
    set status = 'queued', attempt_token = null, lease_expires_at = null,
        next_attempt_at = pg_catalog.clock_timestamp(), error_code = null, finished_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where job.bucket_id = 'workpulse-private' and job.object_key = v_object.name and job.kind = 'delete'
      and job.status in ('succeeded', 'failed');
    if not found then
      perform internal.enqueue_storage_delete(pg_catalog.split_part(v_object.name, '/', 1)::uuid, v_object.name);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 8. Grants and comments --------------------------------------------------------------------

revoke all on function internal.is_permanent_import_error(text) from public, anon, authenticated, service_role;
revoke all on function internal.guard_import_batch_row() from public, anon, authenticated, service_role;
revoke all on function internal.guard_import_item_row() from public, anon, authenticated, service_role;
revoke all on function internal.fail_import_batch_locked(uuid, text) from public, anon, authenticated, service_role;
revoke all on function internal.lock_ai_job_target(public.ai_jobs, boolean) from public, anon, authenticated, service_role;
revoke all on function internal.enqueue_import_ai_job(public.import_batches) from public, anon, authenticated, service_role;
revoke all on function internal.import_actor() from public, anon, authenticated, service_role;
revoke all on function internal.lock_import_job(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function internal.close_import_job(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function internal.lock_import_ai_job(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.begin_import_batch(uuid, text, bigint, text, text) from public, anon, service_role;
revoke all on function public.cancel_import_batch(uuid) from public, anon, service_role;
revoke all on function public.retry_import_batch(uuid) from public, anon, service_role;
grant execute on function public.begin_import_batch(uuid, text, bigint, text, text) to authenticated;
grant execute on function public.cancel_import_batch(uuid) to authenticated;
grant execute on function public.retry_import_batch(uuid) to authenticated;

revoke all on function public.finalize_import_upload(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.expire_import_uploads(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.claim_import_jobs(integer) from public, anon, authenticated, service_role;
revoke all on function public.advance_import_job(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_import_parse(uuid, uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.fail_import_job(uuid, uuid, text, boolean, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.get_import_ai_job_input(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_import_ai_job(uuid, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.purge_expired_import_batches(integer) from public, anon, authenticated, service_role;
revoke all on function public.claim_import_cleanup_jobs(integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_import_cleanup_job(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.fail_import_cleanup_job(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.retry_import_cleanup_job(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_orphan_import_objects(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.finalize_import_upload(uuid, uuid) to service_role;
grant execute on function public.expire_import_uploads(integer, integer) to service_role;
grant execute on function public.claim_import_jobs(integer) to service_role;
grant execute on function public.advance_import_job(uuid, uuid) to service_role;
grant execute on function public.complete_import_parse(uuid, uuid, text, integer) to service_role;
grant execute on function public.fail_import_job(uuid, uuid, text, boolean, timestamptz) to service_role;
grant execute on function public.get_import_ai_job_input(uuid, uuid) to service_role;
grant execute on function public.complete_import_ai_job(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.purge_expired_import_batches(integer) to service_role;
grant execute on function public.claim_import_cleanup_jobs(integer) to service_role;
grant execute on function public.complete_import_cleanup_job(uuid, uuid) to service_role;
grant execute on function public.fail_import_cleanup_job(uuid, uuid, text) to service_role;
grant execute on function public.retry_import_cleanup_job(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.reconcile_orphan_import_objects(integer, integer) to service_role;

comment on function public.begin_import_batch(uuid, text, bigint, text, text) is
  'T15: session owner starts an import batch after server-side signature checks. Requires current AI consent; idempotent per key; returns a duplicate-hash warning.';
comment on function public.cancel_import_batch(uuid) is
  'T15: queued/running/review -> cancelled; idempotent; closes the scan job; purge-eligible immediately.';
comment on function public.retry_import_batch(uuid) is
  'T15: resumes a failed batch from the failed stage (scan/parse or AI) on the same batch; max 3 retries; permanent codes and purged batches refuse.';
comment on function public.finalize_import_upload(uuid, uuid) is
  'T15 server: after the object upload, moves the batch to screening and enqueues its scan+parse job. Idempotent.';
comment on function public.expire_import_uploads(integer, integer) is
  'T15 worker: batches still uploading after the grace period fail as UPLOAD_INCOMPLETE.';
comment on function public.claim_import_jobs(integer) is
  'T15 worker: claims scan+parse jobs with a 120 second lease and marks the batch running.';
comment on function public.advance_import_job(uuid, uuid) is
  'T15 worker: screening -> parsing after a clean malware scan (compare-and-set on the lease).';
comment on function public.complete_import_parse(uuid, uuid, text, integer) is
  'T15 worker: stores extracted text and trusted page_count, then enqueues the import AI job if consent is current.';
comment on function public.fail_import_job(uuid, uuid, text, boolean, timestamptz) is
  'T15 worker: transient retry with backoff (max 5 attempts) or a final failure that fails the batch.';
comment on function public.get_import_ai_job_input(uuid, uuid) is
  'T15 worker: releases only the extracted text for a live import AI lease, live account, current consent and running batch.';
comment on function public.complete_import_ai_job(uuid, uuid, jsonb, jsonb) is
  'T15 worker: atomically stages validated candidates as import_items and opens review; stores only a summary on the job.';
comment on function public.purge_expired_import_batches(integer) is
  'T15 worker: purges raw object/text of terminal batches; deletes uncommitted items; keeps minimal metadata and committed mappings.';
comment on function public.claim_import_cleanup_jobs(integer) is
  'T15 worker: claims object delete receipts under the import prefix only.';
comment on function public.reconcile_orphan_import_objects(integer, integer) is
  'T15 worker: queues deletion for import objects that no live batch references.';

-- T13 Durable AI jobs and consent.
-- ai_jobs is a PostgreSQL-owned queue: clients read their own rows, every write
-- goes through the functions below. Workers claim with a 120 second lease and an
-- attempt token; completion is compare-and-set on that token and lease. Consent is
-- checked before enqueue, before text leaves the database, and before a result is
-- stored. Results are never applied to Achievements here (T14 review action).

create or replace function internal.current_ai_consent_version()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'ai-processing-v1'::text;
$$;

create or replace function internal.has_current_ai_consent(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.profiles as profile
    where profile.id = p_user_id
      and profile.ai_consent_at is not null
      and profile.ai_consent_version = internal.current_ai_consent_version()
  );
$$;

create or replace function internal.ai_detect_payload(
  p_raw_text text,
  p_role text,
  p_scope text,
  p_outcome text
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'raw_text', p_raw_text,
    'role', p_role,
    'scope', p_scope,
    'outcome', p_outcome
  );
$$;

create or replace function internal.is_valid_ai_result(p_result jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_result is not null
    and pg_catalog.jsonb_typeof(p_result) = 'object'
    and p_result ->> 'schema_version' = 'detect.v1'
    and pg_catalog.jsonb_typeof(p_result -> 'potential') = 'boolean'
    and pg_catalog.jsonb_typeof(p_result -> 'questions') = 'array'
    and pg_catalog.jsonb_typeof(p_result -> 'suggestion') in ('object', 'null')
    and pg_catalog.pg_column_size(p_result) <= 32768;
$$;

create table public.ai_jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  activity_id uuid not null,
  input_revision integer not null,
  idempotency_key text not null,
  payload_hash bytea not null,
  consent_version text not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  attempt_token uuid,
  lease_expires_at timestamptz,
  result jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  revision integer not null default 1,
  constraint ai_jobs_user_id_id_key unique (user_id, id),
  constraint ai_jobs_user_idempotency_key unique (user_id, idempotency_key),
  constraint ai_jobs_kind_check check (kind in ('detect')),
  constraint ai_jobs_input_revision_check check (input_revision > 0),
  constraint ai_jobs_idempotency_key_check check (
    idempotency_key ~ '^detect:[0-9a-f-]{36}:r[1-9][0-9]*$'
  ),
  constraint ai_jobs_payload_hash_check check (pg_catalog.octet_length(payload_hash) = 32),
  constraint ai_jobs_consent_version_check check (
    consent_version <> '' and pg_catalog.char_length(consent_version) <= 64
  ),
  constraint ai_jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed')),
  constraint ai_jobs_attempt_count_check check (attempt_count between 0 and 3),
  constraint ai_jobs_error_code_check check (
    error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  constraint ai_jobs_result_check check (
    result is null or internal.is_valid_ai_result(result)
  ),
  constraint ai_jobs_state_check check (
    (status = 'queued'
      and attempt_token is null and lease_expires_at is null
      and result is null and error_code is null and finished_at is null)
    or (status = 'running'
      and attempt_count > 0 and attempt_token is not null and lease_expires_at is not null
      and started_at is not null
      and result is null and error_code is null and finished_at is null)
    or (status = 'succeeded'
      and attempt_count > 0 and attempt_token is not null and lease_expires_at is null
      and result is not null and error_code is null and finished_at is not null)
    or (status = 'failed'
      and attempt_count > 0 and lease_expires_at is null
      and result is null and error_code is not null and finished_at is not null)
  ),
  constraint ai_jobs_user_activity_fkey foreign key (user_id, activity_id)
    references public.activities (user_id, id) on delete cascade
);

create index ai_jobs_status_created_at_idx on public.ai_jobs (status, created_at);
create index ai_jobs_user_activity_created_at_idx
  on public.ai_jobs (user_id, activity_id, created_at desc);

comment on table public.ai_jobs is
  'T13 durable AI operations. Owner-readable; written only by AI RPCs. result holds validated structured output only and is never applied without the T14 review action.';
comment on column public.ai_jobs.input_revision is
  'Activity revision the job analyses; a mismatch at input or completion fails the job with STALE_INPUT.';
comment on column public.ai_jobs.idempotency_key is
  'Server-derived detect:<activity_id>:r<revision>; one job per activity revision.';
comment on column public.ai_jobs.payload_hash is
  'SHA-256 of the minimized input payload; the same key with a different payload is rejected.';
comment on column public.ai_jobs.error_code is
  'Stable error identifier only; never contains source text or provider output.';

create or replace function internal.guard_ai_job_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if row(new.id, new.user_id, new.kind, new.activity_id, new.input_revision,
         new.idempotency_key, new.payload_hash, new.created_at)
     is distinct from
     row(old.id, old.user_id, old.kind, old.activity_id, old.input_revision,
         old.idempotency_key, old.payload_hash, old.created_at) then
    raise exception using errcode = '22023', message = 'INVALID_AI_JOB_MUTATION';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger ai_jobs_guard_row
before update on public.ai_jobs
for each row execute function internal.guard_ai_job_row();

alter table public.ai_jobs enable row level security;

create policy ai_jobs_select_own on public.ai_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.ai_jobs from public, anon, authenticated, service_role;
grant select (
  id, user_id, kind, activity_id, input_revision, idempotency_key, consent_version,
  status, attempt_count, result, error_code, started_at, finished_at,
  created_at, updated_at, revision
) on public.ai_jobs to authenticated;
grant select on public.ai_jobs to service_role;

-- An input or context edit makes pending analysis stale; reset the visible state
-- so an older job cannot leave the new revision looking queued or done.
create or replace function internal.guard_activity_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.capture_mode is distinct from old.capture_mode
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_MUTATION';
  end if;

  if row(new.raw_text, new.occurred_on, new.role, new.scope, new.outcome, new.experience_id, new.project_id)
     is distinct from
     row(old.raw_text, old.occurred_on, old.role, old.scope, old.outcome, old.experience_id, old.project_id) then
    new.revision := old.revision + 1;
    new.analysis_state := 'not_requested';
  else
    new.revision := old.revision;
  end if;
  new.created_at := old.created_at;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

-- Only a job for the activity's current revision may change its analysis_state.
create or replace function internal.set_activity_analysis_state(
  p_user_id uuid,
  p_activity_id uuid,
  p_input_revision integer,
  p_state text
)
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  update public.activities as activity
  set analysis_state = p_state
  where activity.user_id = p_user_id
    and activity.id = p_activity_id
    and activity.revision = p_input_revision
    and activity.analysis_state is distinct from p_state;
$$;

-- Fails a job whose row is already locked by the caller.
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
  perform internal.set_activity_analysis_state(
    p_job.user_id, p_job.activity_id, p_job.input_revision, 'failed'
  );
end;
$$;

-- User operations ---------------------------------------------------------------

create or replace function public.set_ai_consent(
  p_expected_revision integer,
  p_consented boolean
)
returns table (revision integer, ai_consent_at timestamptz, ai_consent_version text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.profiles as profile
    where profile.id = v_user_id and profile.deleting_at is null
  ) then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_consented is null then
    raise exception using errcode = '22023', message = 'INVALID_CONSENT_OPERATION';
  end if;
  if not internal.set_ai_consent(
    v_user_id,
    p_expected_revision,
    p_consented,
    case when p_consented then internal.current_ai_consent_version() end
  ) then
    raise exception using errcode = '22023', message = 'INVALID_CONSENT_OPERATION';
  end if;
  return query
  select profile.revision, profile.ai_consent_at, profile.ai_consent_version
  from public.profiles as profile
  where profile.id = v_user_id;
end;
$$;

create or replace function public.request_ai_analysis(
  p_activity_id uuid,
  p_expected_revision integer
)
returns table (
  job_id uuid,
  status text,
  input_revision integer,
  attempt_count integer,
  error_code text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_activity public.activities%rowtype;
  v_key text;
  v_hash bytea;
  v_job public.ai_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_activity_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'INVALID_AI_REQUEST';
  end if;

  perform 1 from public.profiles as profile
  where profile.id = v_user_id and profile.deleting_at is null
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = p_activity_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACTIVITY_UNAVAILABLE';
  end if;

  if not internal.has_current_ai_consent(v_user_id) then
    raise exception using errcode = 'P0001', message = 'CONSENT_REQUIRED';
  end if;
  if v_activity.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_INPUT';
  end if;

  v_key := 'detect:' || v_activity.id::text || ':r' || v_activity.revision::text;
  v_hash := extensions.digest(
    internal.ai_detect_payload(v_activity.raw_text, v_activity.role, v_activity.scope, v_activity.outcome)::text,
    'sha256'
  );

  insert into public.ai_jobs (
    user_id, kind, activity_id, input_revision, idempotency_key, payload_hash, consent_version
  ) values (
    v_user_id, 'detect', v_activity.id, v_activity.revision, v_key, v_hash,
    internal.current_ai_consent_version()
  )
  on conflict on constraint ai_jobs_user_idempotency_key do nothing
  returning * into v_job;

  if v_job.id is null then
    select job.* into v_job
    from public.ai_jobs as job
    where job.user_id = v_user_id and job.idempotency_key = v_key;
    if v_job.payload_hash <> v_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  else
    perform internal.set_activity_analysis_state(v_user_id, v_activity.id, v_activity.revision, 'queued');
  end if;

  return query select v_job.id, v_job.status, v_job.input_revision, v_job.attempt_count, v_job.error_code;
end;
$$;

create or replace function public.retry_ai_job(p_job_id uuid)
returns table (
  job_id uuid,
  status text,
  input_revision integer,
  attempt_count integer,
  error_code text
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

  return query select v_job.id, v_job.status, v_job.input_revision, v_job.attempt_count, v_job.error_code;
end;
$$;

-- Worker operations (service_role only) -----------------------------------------
-- Lock order everywhere: profile -> activity -> job.

create or replace function public.expire_ai_job_leases()
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_candidate record;
  v_job public.ai_jobs%rowtype;
  v_count integer := 0;
begin
  for v_candidate in
    select job.id, job.user_id, job.activity_id
    from public.ai_jobs as job
    where job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    limit 100
  loop
    perform 1 from public.activities as activity
    where activity.user_id = v_candidate.user_id and activity.id = v_candidate.activity_id
    for update skip locked;
    if not found then
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

create or replace function public.claim_ai_jobs(p_limit integer default 1)
returns table (
  id uuid,
  user_id uuid,
  kind text,
  input_revision integer,
  attempt_count integer,
  attempt_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 10 then
    raise exception using errcode = '22023', message = 'INVALID_AI_JOB_CLAIM_LIMIT';
  end if;
  perform public.expire_ai_job_leases();
  return query
  with candidates as (
    select job.id from public.ai_jobs as job
    where job.status = 'queued'
    order by job.created_at, job.id
    for update of job skip locked
    limit p_limit
  ), claimed as (
    update public.ai_jobs as job
    set status = 'running', attempt_count = job.attempt_count + 1,
        attempt_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds',
        started_at = coalesce(job.started_at, pg_catalog.clock_timestamp()),
        error_code = null, result = null, finished_at = null
    from candidates
    where job.id = candidates.id
    returning job.id, job.user_id, job.kind, job.input_revision, job.attempt_count,
      job.attempt_token, job.created_at
  )
  select claimed.id, claimed.user_id, claimed.kind, claimed.input_revision,
    claimed.attempt_count, claimed.attempt_token
  from claimed
  order by claimed.created_at, claimed.id;
end;
$$;

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
  if not found then
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
  if not found then
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
  if not internal.is_valid_ai_result(p_result) then
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
  perform 1 from public.activities as activity
  where activity.user_id = v_snapshot.user_id and activity.id = v_snapshot.activity_id
  for update;
  select job.* into v_job from public.ai_jobs as job where job.id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;
  perform internal.fail_ai_job_locked(v_job, p_error_code);
  return true;
end;
$$;

-- Grants --------------------------------------------------------------------------

revoke all on function internal.current_ai_consent_version() from public, anon, authenticated, service_role;
revoke all on function internal.has_current_ai_consent(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.ai_detect_payload(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function internal.set_activity_analysis_state(uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function internal.fail_ai_job_locked(public.ai_jobs, text) from public, anon, authenticated, service_role;
revoke all on function internal.guard_ai_job_row() from public, anon, authenticated, service_role;
revoke all on function internal.guard_activity_row() from public, anon, authenticated, service_role;

-- The table check calls this validator under the caller's role.
revoke all on function internal.is_valid_ai_result(jsonb) from public, anon;
grant execute on function internal.is_valid_ai_result(jsonb) to authenticated, service_role;

revoke all on function public.set_ai_consent(integer, boolean) from public, anon, service_role;
revoke all on function public.request_ai_analysis(uuid, integer) from public, anon, service_role;
revoke all on function public.retry_ai_job(uuid) from public, anon, service_role;
grant execute on function public.set_ai_consent(integer, boolean) to authenticated;
grant execute on function public.request_ai_analysis(uuid, integer) to authenticated;
grant execute on function public.retry_ai_job(uuid) to authenticated;

revoke all on function public.expire_ai_job_leases() from public, anon, authenticated, service_role;
revoke all on function public.claim_ai_jobs(integer) from public, anon, authenticated, service_role;
revoke all on function public.get_ai_job_input(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_ai_job(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fail_ai_job(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.expire_ai_job_leases() to service_role;
grant execute on function public.claim_ai_jobs(integer) to service_role;
grant execute on function public.get_ai_job_input(uuid, uuid) to service_role;
grant execute on function public.complete_ai_job(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_ai_job(uuid, uuid, text) to service_role;

comment on function internal.current_ai_consent_version() is
  'T13: single source of the AI processing consent version. TypeScript AI_CONSENT_VERSION must match.';
comment on function public.set_ai_consent(integer, boolean) is
  'T13: session owner grants the current consent version or withdraws consent; revision-guarded.';
comment on function public.request_ai_analysis(uuid, integer) is
  'T13: enqueue detect for the session owner activity at its expected revision. Requires current consent; idempotent per activity revision.';
comment on function public.retry_ai_job(uuid) is
  'T13: explicit failed -> queued retry for the same revision; max 3 attempts; consent rechecked.';
comment on function public.expire_ai_job_leases() is
  'T13 worker: running jobs past their 120 second lease fail with AI_TIMEOUT.';
comment on function public.claim_ai_jobs(integer) is
  'T13 worker: atomically claims queued jobs with a 120 second lease and a fresh attempt token. Returns no source text.';
comment on function public.get_ai_job_input(uuid, uuid) is
  'T13 worker: releases minimized input only for a live lease, a live account, current consent and the matching revision.';
comment on function public.complete_ai_job(uuid, uuid, jsonb) is
  'T13 worker: compare-and-set completion; rechecks account, consent and revision before storing a validated result.';
comment on function public.fail_ai_job(uuid, uuid, text) is
  'T13 worker: compare-and-set failure with a stable error code.';

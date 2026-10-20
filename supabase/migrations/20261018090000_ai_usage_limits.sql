-- Pilot AI usage limits (decision 0032). Open signup means every account can spend provider budget, so each
-- request that queues a provider attempt is charged one unit against the account's plan and a shared daily
-- capacity, in the same transaction as the job write. A refused charge raises AI_QUOTA_EXCEEDED (account) or
-- AI_CAPACITY_EXCEEDED (shared) and nothing is queued. Idempotent replays are never charged. Windows are UTC
-- calendar days and months. Manual paths never call these functions.
--
-- Charged: request_ai_analysis (new detect job), answer_ai_questions (new refine job; answers are still saved
-- when the charge is refused, like a missing consent), retry_ai_job, begin_import_batch (new batch) and
-- retry_import_batch. Buckets: 'analysis' (detect, refine, retry) and 'import'.

begin;

-- 1. Plans, assignments and the shared capacity ----------------------------------------------------------------------------
-- A NULL limit means no limit for that window. Billing does not exist in v0.1: every account is on 'free' unless an
-- operator assigns another plan with SQL.

create table internal.ai_plans (
  plan text primary key,
  analysis_daily integer,
  analysis_monthly integer,
  import_daily integer,
  import_monthly integer,
  counts_toward_capacity boolean not null default true,
  constraint ai_plans_plan_check check (plan ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint ai_plans_limits_check check (
    coalesce(analysis_daily, 0) >= 0 and coalesce(analysis_monthly, 0) >= 0
    and coalesce(import_daily, 0) >= 0 and coalesce(import_monthly, 0) >= 0
  )
);

insert into internal.ai_plans (plan, analysis_daily, analysis_monthly, import_daily, import_monthly, counts_toward_capacity)
values ('free', 20, 200, 3, 5, true),
       ('unlimited', null, null, null, null, false);

comment on table internal.ai_plans is
  'Decision 0032: AI unit limits per plan and UTC window; NULL is no limit. unlimited is for operator and test accounts and is outside the shared capacity.';

create table internal.ai_plan_assignments (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan text not null references internal.ai_plans(plan),
  assigned_at timestamptz not null default pg_catalog.clock_timestamp()
);

comment on table internal.ai_plan_assignments is
  'Decision 0032: operator-assigned plan; an account without a row is on free. The future billing hook.';

create table internal.ai_capacity (
  singleton boolean primary key default true,
  daily_units integer not null,
  constraint ai_capacity_singleton_check check (singleton),
  constraint ai_capacity_daily_units_check check (daily_units >= 0)
);

insert into internal.ai_capacity (singleton, daily_units) values (true, 2000);

comment on table internal.ai_capacity is
  'Decision 0032: one row; units per UTC day across every account whose plan counts toward capacity.';

-- 2. Counters ---------------------------------------------------------------------------------------------------------------

create table internal.ai_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null,
  window_kind text not null,
  window_start date not null,
  units integer not null,
  constraint ai_usage_pkey primary key (user_id, bucket, window_kind, window_start),
  constraint ai_usage_bucket_check check (bucket in ('analysis', 'import')),
  constraint ai_usage_window_kind_check check (window_kind in ('day', 'month')),
  constraint ai_usage_units_check check (units >= 0)
);

comment on table internal.ai_usage is
  'Decision 0032: units charged per account, bucket and UTC window. Holds no content; removed with the Auth user.';

create table internal.ai_capacity_usage (
  usage_day date primary key,
  units integer not null,
  constraint ai_capacity_usage_units_check check (units >= 0)
);

comment on table internal.ai_capacity_usage is
  'Decision 0032: shared units per UTC day.';

alter table internal.ai_plans enable row level security;
alter table internal.ai_plan_assignments enable row level security;
alter table internal.ai_capacity enable row level security;
alter table internal.ai_usage enable row level security;
alter table internal.ai_capacity_usage enable row level security;
revoke all privileges on table internal.ai_plans from public, anon, authenticated, service_role;
revoke all privileges on table internal.ai_plan_assignments from public, anon, authenticated, service_role;
revoke all privileges on table internal.ai_capacity from public, anon, authenticated, service_role;
revoke all privileges on table internal.ai_usage from public, anon, authenticated, service_role;
revoke all privileges on table internal.ai_capacity_usage from public, anon, authenticated, service_role;

-- 3. Charge -----------------------------------------------------------------------------------------------------------------

create or replace function internal.ai_plan_for(p_user_id uuid)
returns internal.ai_plans
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select plan.*
  from internal.ai_plans as plan
  where plan.plan = coalesce(
    (select assignment.plan from internal.ai_plan_assignments as assignment where assignment.user_id = p_user_id),
    'free'
  );
$$;

-- Adds one unit to a window when it stays within p_limit (NULL: no limit). Returns false when the window is full.
-- The conditional upsert locks the counter row, so concurrent charges for one window serialize on it.
create or replace function internal.add_ai_usage_unit(
  p_user_id uuid,
  p_bucket text,
  p_window_kind text,
  p_window_start date,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_limit is not null and p_limit < 1 then
    return false;
  end if;
  insert into internal.ai_usage as usage (user_id, bucket, window_kind, window_start, units)
  values (p_user_id, p_bucket, p_window_kind, p_window_start, 1)
  on conflict on constraint ai_usage_pkey do update
    set units = usage.units + 1
    where p_limit is null or usage.units < p_limit;
  return found;
end;
$$;

-- Charges one unit or raises. The caller's transaction owns the job write, so a raise leaves no job and no unit.
-- Lock order: account day, account month, shared day.
create or replace function internal.charge_ai_usage(p_user_id uuid, p_bucket text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_plan internal.ai_plans%rowtype;
  v_capacity integer;
begin
  if p_user_id is null or p_bucket is null or p_bucket not in ('analysis', 'import') then
    raise exception using errcode = '22023', message = 'INVALID_AI_USAGE_CHARGE';
  end if;
  v_plan := internal.ai_plan_for(p_user_id);
  if v_plan.plan is null then
    raise exception using errcode = 'P0001', message = 'AI_QUOTA_EXCEEDED';
  end if;

  if not internal.add_ai_usage_unit(p_user_id, p_bucket, 'day', v_day,
       case p_bucket when 'analysis' then v_plan.analysis_daily else v_plan.import_daily end)
     or not internal.add_ai_usage_unit(p_user_id, p_bucket, 'month', v_month,
       case p_bucket when 'analysis' then v_plan.analysis_monthly else v_plan.import_monthly end) then
    raise exception using errcode = 'P0001', message = 'AI_QUOTA_EXCEEDED';
  end if;

  if v_plan.counts_toward_capacity then
    select capacity.daily_units into v_capacity from internal.ai_capacity as capacity where capacity.singleton;
    if coalesce(v_capacity, 0) < 1 then
      raise exception using errcode = 'P0001', message = 'AI_CAPACITY_EXCEEDED';
    end if;
    insert into internal.ai_capacity_usage as usage (usage_day, units)
    values (v_day, 1)
    on conflict (usage_day) do update
      set units = usage.units + 1
      where usage.units < v_capacity;
    if not found then
      raise exception using errcode = 'P0001', message = 'AI_CAPACITY_EXCEEDED';
    end if;
  end if;
end;
$$;

-- 4. Read model for the session owner ---------------------------------------------------------------------------------------
-- One row per bucket. limit_reason is the window that blocks the next request (monthly wins over daily, both over the
-- shared capacity), and resets_at is when that window ends. Shared usage numbers are never exposed.

create or replace function public.get_ai_usage()
returns table (
  bucket text,
  day_used integer,
  day_limit integer,
  month_used integer,
  month_limit integer,
  limit_reason text,
  resets_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_plan internal.ai_plans%rowtype;
  v_capacity_full boolean := false;
begin
  if v_user_id is null or not exists (
    select 1 from public.profiles as profile where profile.id = v_user_id and profile.deleting_at is null
  ) then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  v_plan := internal.ai_plan_for(v_user_id);
  if v_plan.counts_toward_capacity then
    select coalesce((select usage.units from internal.ai_capacity_usage as usage where usage.usage_day = v_day), 0)
      >= coalesce((select capacity.daily_units from internal.ai_capacity as capacity where capacity.singleton), 0)
    into v_capacity_full;
  end if;

  return query
  with buckets as (
    select 'analysis'::text as bucket, v_plan.analysis_daily as day_limit, v_plan.analysis_monthly as month_limit
    union all
    select 'import', v_plan.import_daily, v_plan.import_monthly
  ), used as (
    select buckets.bucket, buckets.day_limit, buckets.month_limit,
      coalesce((select usage.units from internal.ai_usage as usage
        where usage.user_id = v_user_id and usage.bucket = buckets.bucket
          and usage.window_kind = 'day' and usage.window_start = v_day), 0) as day_used,
      coalesce((select usage.units from internal.ai_usage as usage
        where usage.user_id = v_user_id and usage.bucket = buckets.bucket
          and usage.window_kind = 'month' and usage.window_start = v_month), 0) as month_used
    from buckets
  ), reasons as (
    select used.*,
      case
        when used.month_limit is not null and used.month_used >= used.month_limit then 'monthly'
        when used.day_limit is not null and used.day_used >= used.day_limit then 'daily'
        when v_capacity_full then 'capacity'
      end as limit_reason
    from used
  )
  select reasons.bucket, reasons.day_used, reasons.day_limit, reasons.month_used, reasons.month_limit,
    reasons.limit_reason,
    case reasons.limit_reason
      when 'monthly' then ((v_month + interval '1 month')::date)::timestamp at time zone 'UTC'
      when 'daily' then (v_day + 1)::timestamp at time zone 'UTC'
      when 'capacity' then (v_day + 1)::timestamp at time zone 'UTC'
    end
  from reasons
  order by reasons.bucket;
end;
$$;

-- 5. Charged enqueue paths --------------------------------------------------------------------------------------------------

-- T14 body plus the charge. A new job is charged inside a subtransaction; for refine a refused charge rolls the
-- insert back and returns NULL, so answer_ai_questions still saves the answers without a follow-up job.
create or replace function internal.enqueue_ai_job(
  p_user_id uuid,
  p_activity public.activities,
  p_kind text
)
returns public.ai_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_hash bytea;
  v_job public.ai_jobs%rowtype;
begin
  v_key := p_kind || ':' || p_activity.id::text || ':r' || p_activity.revision::text;
  v_hash := extensions.digest(
    internal.ai_detect_payload(p_activity.raw_text, p_activity.role, p_activity.scope, p_activity.outcome)::text,
    'sha256'
  );

  begin
    insert into public.ai_jobs (
      user_id, kind, activity_id, input_revision, idempotency_key, payload_hash, consent_version
    ) values (
      p_user_id, p_kind, p_activity.id, p_activity.revision, v_key, v_hash,
      internal.current_ai_consent_version()
    )
    on conflict on constraint ai_jobs_one_per_revision_key do nothing
    returning * into v_job;
    if v_job.id is not null then
      perform internal.charge_ai_usage(p_user_id, 'analysis');
    end if;
  exception when raise_exception then
    if p_kind = 'refine' and sqlerrm in ('AI_QUOTA_EXCEEDED', 'AI_CAPACITY_EXCEEDED') then
      return null;
    end if;
    raise;
  end;

  if v_job.id is null then
    select job.* into v_job
    from public.ai_jobs as job
    where job.user_id = p_user_id and job.activity_id = p_activity.id and job.input_revision = p_activity.revision;
    if v_job.payload_hash <> v_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  else
    perform internal.set_activity_analysis_state(p_user_id, p_activity.id, p_activity.revision, 'queued');
  end if;

  return v_job;
end;
$$;

-- T15 body; a retry queues a new provider attempt, so it is charged after every other check passes.
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

  perform internal.charge_ai_usage(v_user_id, 'analysis');

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

-- T15 body; a new batch is charged before the upload starts, so a refused import never reaches Storage. Every
-- successful parse leads to exactly one provider attempt, so the unit is taken here rather than in the worker.
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
  else
    perform internal.charge_ai_usage(v_user_id, 'import');
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

-- T15 body; both retry stages end in a provider attempt, so each accepted retry is charged.
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
    perform internal.charge_ai_usage(v_user_id, 'import');
    update public.import_batches as batch
    set status = 'running', error_code = null, failed_at = null, expires_at = null,
        retry_count = batch.retry_count + 1
    where batch.id = v_batch.id
    returning batch.* into v_batch;
    perform internal.enqueue_import_ai_job(v_batch);
  else
    perform internal.charge_ai_usage(v_user_id, 'import');
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

-- 6. Grants -----------------------------------------------------------------------------------------------------------------

revoke all on function internal.ai_plan_for(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.add_ai_usage_unit(uuid, text, text, date, integer) from public, anon, authenticated, service_role;
revoke all on function internal.charge_ai_usage(uuid, text) from public, anon, authenticated, service_role;
revoke all on function internal.enqueue_ai_job(uuid, public.activities, text) from public, anon, authenticated, service_role;

revoke all on function public.get_ai_usage() from public, anon, service_role;
grant execute on function public.get_ai_usage() to authenticated;
revoke all on function public.retry_ai_job(uuid) from public, anon, service_role;
grant execute on function public.retry_ai_job(uuid) to authenticated;
revoke all on function public.begin_import_batch(uuid, text, bigint, text, text) from public, anon, service_role;
grant execute on function public.begin_import_batch(uuid, text, bigint, text, text) to authenticated;
revoke all on function public.retry_import_batch(uuid) from public, anon, service_role;
grant execute on function public.retry_import_batch(uuid) to authenticated;

comment on function internal.charge_ai_usage(uuid, text) is
  'Decision 0032: charge one AI unit to the account (UTC day and month) and the shared daily capacity, or raise AI_QUOTA_EXCEEDED / AI_CAPACITY_EXCEEDED.';
comment on function public.get_ai_usage() is
  'Decision 0032: the session owner''s AI units per bucket, the blocking window (monthly, daily, capacity) and when it resets. Shared usage numbers are not exposed.';
comment on function internal.enqueue_ai_job(uuid, public.activities, text) is
  'T14 shared enqueue, charged per new job (decision 0032). Returns NULL for a refine job refused by the AI usage limit.';

commit;

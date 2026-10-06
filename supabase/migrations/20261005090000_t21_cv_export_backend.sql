-- T21 CV export backend (PRD R10, F07, DB §4/§5/§6, decision 0027).
-- Forward-only. Adds the operational columns, state constraint and immutability guard to cv_exports, the export
-- readiness and request RPCs, the explicit retry, the owner-authorized download key, and the worker RPCs
-- (lease, claim, input, complete, fail, expiry, cleanup, orphan reconciliation). No T18-T20 function is changed.
-- Lock order:
--   request_cv_export  profile (share) -> cv_documents (update, no revision check yet) -> idempotency lookup
--                      -> revision check -> sources (share, canonical type order, by id) -> blockers -> insert
--   retry_cv_export    profile (share) -> cv_documents (update) -> export (update)
--   worker RPCs        profile (share) -> export (update); they never wait on cv_documents or on a source.
-- Every source-edit path locks the source FOR UPDATE without waiting on cv_documents, and every delete path locks
-- cv_documents first, so a request either snapshots the state before a mutation or sees the mutation as a blocker.

-- 1. Table ------------------------------------------------------------------------------------------------------

alter table public.cv_exports
  add column page_count integer,
  add column byte_size bigint,
  add column purged_at timestamptz;

alter table public.cv_exports
  add constraint cv_exports_snapshot_size_check check (pg_catalog.pg_column_size(snapshot) <= 4194304),
  add constraint cv_exports_page_count_check check (page_count is null or page_count between 1 and 20),
  add constraint cv_exports_byte_size_check check (byte_size is null or byte_size between 1 and 10485760),
  add constraint cv_exports_object_key_owner_check check (
    object_key is null
    or object_key ~ ('^' || user_id::text || '/export/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  ),
  add constraint cv_exports_state_check check (
    (
      status = 'queued'
      and attempt_token is null and lease_expires_at is null and finished_at is null and error_code is null
      and object_key is null and page_count is null and byte_size is null and expires_at is null and purged_at is null
    )
    or (
      status = 'running'
      and attempt_count > 0 and attempt_token is not null and lease_expires_at is not null
      and finished_at is null and error_code is null
      and object_key is null and page_count is null and byte_size is null and expires_at is null and purged_at is null
    )
    or (
      status = 'succeeded'
      and attempt_count > 0 and attempt_token is not null and lease_expires_at is null
      and finished_at is not null and error_code is null
      and object_key is not null and page_count is not null and byte_size is not null and expires_at is not null
    )
    or (
      status = 'failed'
      and attempt_count > 0 and attempt_token is not null and lease_expires_at is null
      and finished_at is not null and error_code is not null
      and object_key is null and page_count is null and byte_size is null and expires_at is null and purged_at is null
    )
  );

-- At most one queued or running export per CV (no duplicate jobs).
create unique index cv_exports_one_active_key on public.cv_exports (cv_id) where status in ('queued', 'running');
create index cv_exports_expiry_idx on public.cv_exports (expires_at) where status = 'succeeded' and purged_at is null;
create index cv_exports_claim_idx on public.cv_exports (created_at, id) where status = 'queued';

comment on table public.cv_exports is
  'One export request: an immutable snapshot of the saved CV (schema cv-export.v1), the CV revision it is bound to, and the durable job state (queued, running, succeeded, failed) with lease and attempt token. Clients cannot write it.';
comment on column public.cv_exports.snapshot is
  'Immutable copy of the saved CV at request time (template, locale, title, section order, profile with overrides, summary override, items with source snapshot and override). The worker renders only this.';
comment on column public.cv_exports.purged_at is
  'Set when the expired PDF object was queued for deletion; the row, the CV and its items stay.';

-- 2. Immutability guard -------------------------------------------------------------------------------------------

create or replace function internal.guard_cv_export_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.cv_id is distinct from old.cv_id
     or new.cv_revision is distinct from old.cv_revision
     or new.snapshot is distinct from old.snapshot
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_IMMUTABLE';
  end if;
  return new;
end;
$$;

-- Fires before the touch trigger (alphabetical order), so it sees the statement's own NEW row.
create trigger cv_exports_a_guard
before update on public.cv_exports
for each row execute function internal.guard_cv_export_row();

-- 3. Helpers ---------------------------------------------------------------------------------------------------------

create or replace function internal.is_permanent_export_error(p_error_code text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_error_code in ('EXPORT_SNAPSHOT_INVALID', 'EXPORT_TOO_LONG', 'ACCOUNT_DELETING')
$$;

-- The name printed on the CV: the display override, else the copied profile name; null when blank.
create or replace function internal.cv_export_effective_name(p_document public.cv_documents)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(pg_catalog.btrim(coalesce(
    p_document.profile_snapshot #>> '{display_overrides,display_name}',
    p_document.profile_snapshot ->> 'display_name',
    ''
  ), E' \t\r\n'), '')
$$;

-- The single definition of export readiness (decision 0027): used by get_cv_export_readiness (no lock) and by
-- request_cv_export (under the document and source locks). Only codes and the caller's own item ids are returned.
create or replace function internal.cv_export_blockers(p_document public.cv_documents)
returns table (code text, item_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_item public.cv_items%rowtype;
  v_state text;
begin
  if internal.cv_export_effective_name(p_document) is null then
    return query select 'NAME_REQUIRED'::text, null::uuid;
  end if;
  if not exists (
    select 1 from public.cv_items as item
    where item.user_id = p_document.user_id and item.cv_id = p_document.id and not item.source_deleted
      and item.section_key in ('experience', 'projects', 'education', 'achievements')
  ) then
    return query select 'CONTENT_REQUIRED'::text, null::uuid;
  end if;
  for v_item in
    select item.* from public.cv_items as item
    where item.user_id = p_document.user_id and item.cv_id = p_document.id
    order by item.section_key, item.position, item.id
  loop
    v_state := internal.cv_item_state(v_item);
    if v_state = 'changed' then
      return query select 'ITEM_CHANGED'::text, v_item.id;
    elsif v_state = 'deleted' then
      return query select 'ITEM_DELETED'::text, v_item.id;
    elsif v_state = 'unconfirmed' then
      return query select 'ITEM_UNCONFIRMED'::text, v_item.id;
    end if;
  end loop;
  if internal.cv_profile_state(p_document) = 'changed' then
    return query select 'PROFILE_CHANGED'::text, null::uuid;
  end if;
end;
$$;

-- cv-export.v1: the whole saved CV, copied as stored (never rebuilt from live career rows). Items follow
-- section, position, id. No source text beyond the display snapshot, no metrics, activity link or evidence.
create or replace function internal.cv_export_snapshot(p_document public.cv_documents)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'schema_version', 'cv-export.v1',
    'template_key', p_document.template_key,
    'locale', p_document.locale,
    'title', p_document.title,
    'cv_id', p_document.id,
    'cv_revision', p_document.revision,
    'section_order', p_document.section_order,
    'profile_snapshot', p_document.profile_snapshot,
    'summary_override', p_document.summary_override,
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', item.id,
          'section_key', item.section_key,
          'position', item.position,
          'source_snapshot', item.source_snapshot,
          'override_text', item.override_text
        )
        order by item.section_key, item.position, item.id
      )
      from public.cv_items as item
      where item.user_id = p_document.user_id and item.cv_id = p_document.id
    ), '[]'::jsonb)
  )
$$;

-- Locks every live source of the CV FOR SHARE in the canonical order (experience, project, achievement, education,
-- skill, certification; by id), the same order resolve_cv_freshness uses.
create or replace function internal.cv_export_lock_sources(p_user_id uuid, p_cv_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_type text;
  v_id uuid;
begin
  foreach v_type in array array['experience', 'project', 'achievement', 'education', 'skill', 'certification'] loop
    for v_id in
      select picked.source_id
      from (
        select case v_type
          when 'experience' then item.experience_id
          when 'project' then item.project_id
          when 'achievement' then item.achievement_id
          when 'education' then item.education_id
          when 'skill' then item.skill_id
          else item.certification_id
        end as source_id
        from public.cv_items as item
        where item.user_id = p_user_id and item.cv_id = p_cv_id and not item.source_deleted
      ) as picked
      where picked.source_id is not null
      order by picked.source_id
    loop
      perform internal.cv_lock_source(p_user_id, v_type, v_id);
    end loop;
  end loop;
end;
$$;

create or replace function internal.fail_cv_export_locked(p_export public.cv_exports, p_error_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.cv_exports as job
  set status = 'failed', lease_expires_at = null, error_code = p_error_code,
      finished_at = pg_catalog.clock_timestamp(), object_key = null, page_count = null, byte_size = null,
      expires_at = null
  where job.id = p_export.id;
end;
$$;

-- 4. User RPCs ---------------------------------------------------------------------------------------------------------

create or replace function public.get_cv_export_readiness()
returns table (has_cv boolean, cv_revision integer, ready boolean, blockers jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_document public.cv_documents%rowtype;
  v_blockers jsonb;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles as profile where profile.id = v_user_id and profile.deleting_at is null) then
    return;
  end if;
  select document.* into v_document from public.cv_documents as document where document.user_id = v_user_id;
  if not found then
    return query select false, null::integer, false,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', 'CV_NOT_FOUND'));
    return;
  end if;
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('code', blocker.code)
      || case when blocker.item_id is not null then pg_catalog.jsonb_build_object('item_id', blocker.item_id) else '{}'::jsonb end
  ), '[]'::jsonb)
  into v_blockers
  from internal.cv_export_blockers(v_document) as blocker;
  return query select true, v_document.revision, pg_catalog.jsonb_array_length(v_blockers) = 0, v_blockers;
end;
$$;

create or replace function public.request_cv_export(p_expected_revision integer, p_idempotency_key text)
returns table (export_id uuid, status text, cv_revision integer, reused boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.cv_actor();
  v_onboarded timestamptz;
  v_key text;
  v_cv public.cv_documents%rowtype;
  v_existing public.cv_exports%rowtype;
  v_blockers jsonb;
  v_id uuid;
begin
  select profile.onboarding_completed_at into v_onboarded from public.profiles as profile where profile.id = v_user_id;
  if v_onboarded is null then
    raise exception using errcode = '22023', message = 'ONBOARDING_REQUIRED';
  end if;
  v_key := pg_catalog.btrim(p_idempotency_key);
  if p_expected_revision is null or p_expected_revision < 1
     or v_key is null or v_key !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;

  -- The document lock comes before any revision or idempotency decision so concurrent requests serialize.
  select document.* into v_cv from public.cv_documents as document where document.user_id = v_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CV_NOT_FOUND';
  end if;

  select job.* into v_existing from public.cv_exports as job
  where job.user_id = v_user_id and job.idempotency_key = v_key;
  if found then
    if v_existing.cv_revision = p_expected_revision then
      return query select v_existing.id, v_existing.status, v_existing.cv_revision, true;
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
  end if;
  if v_cv.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

  -- Sources are locked before readiness is computed: a concurrent edit either committed first (and is then seen
  -- as a blocker) or waits until this transaction ends (and the snapshot predates it).
  perform internal.cv_export_lock_sources(v_user_id, v_cv.id);
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('code', blocker.code)
      || case when blocker.item_id is not null then pg_catalog.jsonb_build_object('item_id', blocker.item_id) else '{}'::jsonb end
  ), '[]'::jsonb)
  into v_blockers
  from internal.cv_export_blockers(v_cv) as blocker;
  if pg_catalog.jsonb_array_length(v_blockers) > 0 then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_BLOCKED',
      detail = pg_catalog.jsonb_build_object('blockers', v_blockers)::text;
  end if;

  -- Dedup comes after validation, so a CV that is blocked now never gets an older export as a shortcut.
  select job.* into v_existing from public.cv_exports as job
  where job.user_id = v_user_id and job.cv_id = v_cv.id and job.status in ('queued', 'running');
  if found then
    if v_existing.cv_revision = v_cv.revision then
      return query select v_existing.id, v_existing.status, v_existing.cv_revision, true;
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_IN_PROGRESS';
  end if;
  select job.* into v_existing from public.cv_exports as job
  where job.user_id = v_user_id and job.cv_id = v_cv.id and job.cv_revision = v_cv.revision
    and job.status = 'succeeded' and job.purged_at is null and job.expires_at > pg_catalog.clock_timestamp()
  order by job.created_at desc, job.id
  limit 1;
  if found then
    return query select v_existing.id, v_existing.status, v_existing.cv_revision, true;
    return;
  end if;

  begin
    insert into public.cv_exports (user_id, cv_id, cv_revision, snapshot, idempotency_key)
    values (v_user_id, v_cv.id, v_cv.revision, internal.cv_export_snapshot(v_cv), v_key)
    returning id into v_id;
  exception when check_violation then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end;
  return query select v_id, 'queued'::text, v_cv.revision, false;
end;
$$;

-- Explicit retry of the same snapshot. Never revalidates freshness and never builds a new snapshot.
create or replace function public.retry_cv_export(p_export_id uuid)
returns table (export_id uuid, status text, attempt_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.cv_actor();
  v_cv_id uuid;
  v_job public.cv_exports%rowtype;
begin
  if p_export_id is null then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_NOT_FOUND';
  end if;
  select document.id into v_cv_id from public.cv_documents as document where document.user_id = v_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_NOT_FOUND';
  end if;
  select job.* into v_job from public.cv_exports as job
  where job.id = p_export_id and job.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_NOT_FOUND';
  end if;
  if v_job.status <> 'failed' or v_job.attempt_count >= 3 or internal.is_permanent_export_error(v_job.error_code) then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_NOT_RETRYABLE';
  end if;
  if exists (
    select 1 from public.cv_exports as other
    where other.user_id = v_user_id and other.cv_id = v_job.cv_id and other.id <> v_job.id
      and other.status in ('queued', 'running')
  ) then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_IN_PROGRESS';
  end if;
  update public.cv_exports as job
  set status = 'queued', attempt_token = null, lease_expires_at = null, error_code = null, finished_at = null
  where job.id = v_job.id
  returning job.* into v_job;
  return query select v_job.id, v_job.status, v_job.attempt_count;
end;
$$;

-- The Storage key of a finished, unexpired export of the caller. The service issues the signed URL (<= 5 minutes);
-- the key never reaches the browser. Another account's export is indistinguishable from a missing one.
create or replace function public.get_cv_export_download(p_export_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.cv_exports%rowtype;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles as profile where profile.id = v_user_id and profile.deleting_at is null) then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_export_id is null then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_NOT_FOUND';
  end if;
  select job.* into v_job from public.cv_exports as job where job.id = p_export_id and job.user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_NOT_FOUND';
  end if;
  if v_job.status <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_NOT_READY';
  end if;
  if v_job.purged_at is not null or v_job.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_EXPIRED';
  end if;
  return v_job.object_key;
end;
$$;

-- 5. Worker RPCs (service_role only) ---------------------------------------------------------------------------------------

create or replace function public.expire_cv_export_leases()
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_candidate record;
  v_job public.cv_exports%rowtype;
  v_count integer := 0;
begin
  for v_candidate in
    select job.id, job.user_id
    from public.cv_exports as job
    where job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    limit 100
  loop
    perform 1 from public.profiles as profile where profile.id = v_candidate.user_id for share skip locked;
    if not found then
      continue;
    end if;
    select job.* into v_job
    from public.cv_exports as job
    where job.id = v_candidate.id and job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp()
    for update skip locked;
    if not found then
      continue;
    end if;
    perform internal.fail_cv_export_locked(v_job, 'EXPORT_TIMEOUT');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.claim_cv_export_jobs(p_limit integer default 1)
returns table (id uuid, user_id uuid, cv_revision integer, attempt_count integer, attempt_token uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 10 then
    raise exception using errcode = '22023', message = 'INVALID_CV_EXPORT_CLAIM_LIMIT';
  end if;
  perform public.expire_cv_export_leases();
  return query
  with candidates as (
    select job.id from public.cv_exports as job
    where job.status = 'queued'
    order by job.created_at, job.id
    for update of job skip locked
    limit p_limit
  ), claimed as (
    update public.cv_exports as job
    set status = 'running', attempt_count = job.attempt_count + 1,
        attempt_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds',
        started_at = coalesce(job.started_at, pg_catalog.clock_timestamp()),
        error_code = null, finished_at = null
    from candidates
    where job.id = candidates.id
    returning job.id, job.user_id, job.cv_revision, job.attempt_count, job.attempt_token, job.created_at
  )
  select claimed.id, claimed.user_id, claimed.cv_revision, claimed.attempt_count, claimed.attempt_token
  from claimed
  order by claimed.created_at, claimed.id;
end;
$$;

-- The only input the renderer ever receives: the stored snapshot of the claimed export.
create or replace function public.get_cv_export_input(p_export_id uuid, p_attempt_token uuid)
returns table (snapshot jsonb, cv_revision integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid;
  v_deleting_at timestamptz;
  v_job public.cv_exports%rowtype;
begin
  if p_export_id is null or p_attempt_token is null then
    return;
  end if;
  select job.user_id into v_user_id from public.cv_exports as job where job.id = p_export_id;
  if not found then
    return;
  end if;
  select profile.deleting_at into v_deleting_at from public.profiles as profile where profile.id = v_user_id for share;
  select job.* into v_job from public.cv_exports as job where job.id = p_export_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return;
  end if;
  if v_deleting_at is not null then
    perform internal.fail_cv_export_locked(v_job, 'ACCOUNT_DELETING');
    return;
  end if;
  return query select v_job.snapshot, v_job.cv_revision;
end;
$$;

create or replace function public.complete_cv_export(
  p_export_id uuid,
  p_attempt_token uuid,
  p_object_key text,
  p_page_count integer,
  p_byte_size bigint
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid;
  v_deleting_at timestamptz;
  v_job public.cv_exports%rowtype;
  v_now timestamptz;
begin
  if p_export_id is null or p_attempt_token is null or p_object_key is null
     or p_page_count is null or p_page_count < 1 or p_page_count > 20
     or p_byte_size is null or p_byte_size < 1 or p_byte_size > 10485760 then
    raise exception using errcode = '22023', message = 'INVALID_CV_EXPORT_COMPLETION';
  end if;
  select job.user_id into v_user_id from public.cv_exports as job where job.id = p_export_id;
  if not found then
    return 'stale';
  end if;
  select profile.deleting_at into v_deleting_at from public.profiles as profile where profile.id = v_user_id for share;
  select job.* into v_job from public.cv_exports as job where job.id = p_export_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return 'stale';
  end if;
  if v_deleting_at is not null then
    perform internal.fail_cv_export_locked(v_job, 'ACCOUNT_DELETING');
    return 'failed:ACCOUNT_DELETING';
  end if;
  -- One object per attempt: a worker from an older lease can never own the key of the current attempt.
  if p_object_key <> v_job.user_id::text || '/export/' || p_attempt_token::text then
    raise exception using errcode = '22023', message = 'INVALID_CV_EXPORT_COMPLETION';
  end if;
  v_now := pg_catalog.clock_timestamp();
  update public.cv_exports as job
  set status = 'succeeded', lease_expires_at = null, error_code = null, finished_at = v_now,
      object_key = p_object_key, page_count = p_page_count, byte_size = p_byte_size,
      expires_at = v_now + interval '24 hours'
  where job.id = v_job.id;
  return 'succeeded';
end;
$$;

create or replace function public.fail_cv_export(p_export_id uuid, p_attempt_token uuid, p_error_code text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid;
  v_job public.cv_exports%rowtype;
begin
  if p_export_id is null or p_attempt_token is null or p_error_code is null
     or p_error_code not in ('EXPORT_TIMEOUT', 'RENDERER_UNAVAILABLE', 'RENDERER_TIMEOUT', 'EXPORT_RENDER_INVALID',
                             'EXPORT_TOO_LONG', 'EXPORT_SNAPSHOT_INVALID', 'STORAGE_UNAVAILABLE', 'ACCOUNT_DELETING') then
    raise exception using errcode = '22023', message = 'INVALID_CV_EXPORT_FAILURE';
  end if;
  select job.user_id into v_user_id from public.cv_exports as job where job.id = p_export_id;
  if not found then
    return false;
  end if;
  perform 1 from public.profiles as profile where profile.id = v_user_id for share;
  select job.* into v_job from public.cv_exports as job where job.id = p_export_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return false;
  end if;
  perform internal.fail_cv_export_locked(v_job, p_error_code);
  return true;
end;
$$;

-- Retention: a succeeded export is downloadable for 24 hours; then its object is queued for deletion (storage
-- job, category export) and the row is marked purged. The row, the CV and its items stay.
create or replace function public.expire_cv_exports(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.cv_exports%rowtype;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_CV_EXPORT_HOUSEKEEPING';
  end if;
  for v_job in
    select job.* from public.cv_exports as job
    where job.status = 'succeeded' and job.purged_at is null and job.expires_at <= pg_catalog.clock_timestamp()
    order by job.expires_at, job.id
    for update skip locked
    limit p_limit
  loop
    perform internal.enqueue_storage_delete(v_job.user_id, v_job.object_key);
    update public.cv_exports as job set purged_at = pg_catalog.clock_timestamp() where job.id = v_job.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.claim_export_cleanup_jobs(p_limit integer default 1)
returns table (
  id uuid, user_id uuid, object_key text, attempt_count integer, attempt_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'INVALID_EXPORT_CLEANUP_CLAIM';
  end if;
  return query
  with candidates as (
    select queued.id from internal.storage_jobs as queued
    where queued.bucket_id = 'workpulse-private'
      and pg_catalog.split_part(queued.object_key, '/', 2) = 'export'
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

create or replace function public.complete_export_cleanup_job(p_job_id uuid, p_attempt_token uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1 from internal.storage_jobs as job
    where job.id = p_job_id and pg_catalog.split_part(job.object_key, '/', 2) = 'export'
  ) then
    return false;
  end if;
  return internal.complete_storage_job(p_job_id, p_attempt_token);
end;
$$;

create or replace function public.fail_export_cleanup_job(p_job_id uuid, p_attempt_token uuid, p_error_code text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1 from internal.storage_jobs as job
    where job.id = p_job_id and pg_catalog.split_part(job.object_key, '/', 2) = 'export'
  ) then
    return false;
  end if;
  return internal.fail_storage_job(p_job_id, p_attempt_token, p_error_code);
end;
$$;

create or replace function public.retry_export_cleanup_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_error_code text,
  p_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_job_id is null or p_attempt_token is null or p_error_code is null
     or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' or p_next_attempt_at is null then
    raise exception using errcode = '22023', message = 'INVALID_EXPORT_CLEANUP_RETRY';
  end if;
  update internal.storage_jobs as job
  set status = 'queued', attempt_token = null, lease_expires_at = null,
      next_attempt_at = p_next_attempt_at, error_code = null,
      last_error_code = p_error_code, finished_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where job.id = p_job_id and job.kind = 'delete' and job.status = 'running'
    and pg_catalog.split_part(job.object_key, '/', 2) = 'export'
    and job.attempt_token = p_attempt_token
    and job.lease_expires_at > pg_catalog.clock_timestamp();
  return found;
end;
$$;

-- Export objects older than the minimum age that no live export row owns (stale attempts, failed cleanup of a
-- purged export) are queued for deletion. A purged export no longer owns its object.
create or replace function public.reconcile_orphan_export_objects(
  p_min_age_seconds integer default 3600,
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_object record;
  v_count integer := 0;
begin
  if p_min_age_seconds is null or p_min_age_seconds < 900 or p_min_age_seconds > 86400
     or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_EXPORT_ORPHAN_RECONCILIATION';
  end if;
  for v_object in
    select object_row.name
    from storage.objects as object_row
    where object_row.bucket_id = 'workpulse-private'
      and object_row.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/export/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and object_row.created_at <= pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_min_age_seconds)
      and not exists (
        select 1 from public.cv_exports as export_row
        where export_row.object_key = object_row.name and export_row.purged_at is null
      )
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

-- 6. Grants and comments --------------------------------------------------------------------------------------------------

revoke all on function internal.guard_cv_export_row() from public, anon, authenticated, service_role;
revoke all on function internal.is_permanent_export_error(text) from public, anon, authenticated, service_role;
revoke all on function internal.cv_export_effective_name(public.cv_documents) from public, anon, authenticated, service_role;
revoke all on function internal.cv_export_blockers(public.cv_documents) from public, anon, authenticated, service_role;
revoke all on function internal.cv_export_snapshot(public.cv_documents) from public, anon, authenticated, service_role;
revoke all on function internal.cv_export_lock_sources(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function internal.fail_cv_export_locked(public.cv_exports, text) from public, anon, authenticated, service_role;

revoke all on function public.get_cv_export_readiness() from public, anon, service_role;
revoke all on function public.request_cv_export(integer, text) from public, anon, service_role;
revoke all on function public.retry_cv_export(uuid) from public, anon, service_role;
revoke all on function public.get_cv_export_download(uuid) from public, anon, service_role;
grant execute on function public.get_cv_export_readiness() to authenticated;
grant execute on function public.request_cv_export(integer, text) to authenticated;
grant execute on function public.retry_cv_export(uuid) to authenticated;
grant execute on function public.get_cv_export_download(uuid) to authenticated;

revoke all on function public.expire_cv_export_leases() from public, anon, authenticated, service_role;
revoke all on function public.claim_cv_export_jobs(integer) from public, anon, authenticated, service_role;
revoke all on function public.get_cv_export_input(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_cv_export(uuid, uuid, text, integer, bigint) from public, anon, authenticated, service_role;
revoke all on function public.fail_cv_export(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.expire_cv_exports(integer) from public, anon, authenticated, service_role;
revoke all on function public.claim_export_cleanup_jobs(integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_export_cleanup_job(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.fail_export_cleanup_job(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.retry_export_cleanup_job(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_orphan_export_objects(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.expire_cv_export_leases() to service_role;
grant execute on function public.claim_cv_export_jobs(integer) to service_role;
grant execute on function public.get_cv_export_input(uuid, uuid) to service_role;
grant execute on function public.complete_cv_export(uuid, uuid, text, integer, bigint) to service_role;
grant execute on function public.fail_cv_export(uuid, uuid, text) to service_role;
grant execute on function public.expire_cv_exports(integer) to service_role;
grant execute on function public.claim_export_cleanup_jobs(integer) to service_role;
grant execute on function public.complete_export_cleanup_job(uuid, uuid) to service_role;
grant execute on function public.fail_export_cleanup_job(uuid, uuid, text) to service_role;
grant execute on function public.retry_export_cleanup_job(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.reconcile_orphan_export_objects(integer, integer) to service_role;

comment on function internal.cv_export_blockers(public.cv_documents) is
  'T21: the single definition of export readiness. NAME_REQUIRED, CONTENT_REQUIRED, ITEM_CHANGED, ITEM_DELETED, ITEM_UNCONFIRMED, PROFILE_CHANGED; kept items and a kept profile do not block.';
comment on function internal.cv_export_snapshot(public.cv_documents) is
  'T21: cv-export.v1 snapshot of the saved CV as stored (never rebuilt from live career rows).';
comment on function public.get_cv_export_readiness() is
  'T21: readiness of the session owner CV for export, without locking. Codes and the caller''s own item ids only.';
comment on function public.request_cv_export(integer, text) is
  'T21: validates the saved CV under the document and source locks, then stores the immutable snapshot and queues the export in one transaction. Idempotent per key and revision; at most one active export per CV.';
comment on function public.retry_cv_export(uuid) is
  'T21: explicit failed -> queued retry of the same snapshot; at most three attempts; permanent codes are not retryable.';
comment on function public.get_cv_export_download(uuid) is
  'T21: Storage key of a finished, unexpired export of the session owner. The service issues the short-lived signed URL.';
comment on function public.expire_cv_export_leases() is
  'T21 worker: running exports past their 120 second lease fail with EXPORT_TIMEOUT.';
comment on function public.claim_cv_export_jobs(integer) is
  'T21 worker: atomically claims queued exports with a 120 second lease and a fresh attempt token. Returns no CV text.';
comment on function public.get_cv_export_input(uuid, uuid) is
  'T21 worker: releases the stored snapshot only for a live lease and a live account.';
comment on function public.complete_cv_export(uuid, uuid, text, integer, bigint) is
  'T21 worker: compare-and-set completion bound to the attempt token, the lease and the object key owner/export/token.';
comment on function public.fail_cv_export(uuid, uuid, text) is
  'T21 worker: compare-and-set failure with an allowlisted error code.';
comment on function public.expire_cv_exports(integer) is
  'T21 worker: queues deletion of expired export objects and marks the rows purged; the CV is untouched.';
comment on function public.reconcile_orphan_export_objects(integer, integer) is
  'T21 worker: queues deletion of export objects no live export row owns.';

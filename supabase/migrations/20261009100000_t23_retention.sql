-- T23 retention (PRD Data minimization, decisions 0027 N2, 0028 N4, 0023 and 0029).
-- 1. Abandoned import reviews are cancelled after 30 idle days; the T15 purge then removes file and text within 24 hours.
-- 2. Export snapshots are emptied when the PDF expires or 24 hours after a failed export; metadata stays.
-- 3. Retry of a failed export is refused when the CV changed, is blocked, or the snapshot was emptied.

begin;

-- 1. Abandoned import reviews -----------------------------------------------------------------------------------------------

-- Same transition as cancel_import_batch (cancelled_at and expires_at set, queued or running jobs cancelled), driven by
-- time instead of the owner. Activity is the later of the batch update and the latest item update.
create or replace function public.expire_abandoned_import_reviews(
  p_limit integer default 100,
  p_idle_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_batch public.import_batches%rowtype;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500
     or p_idle_days is null or p_idle_days < 7 or p_idle_days > 365 then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_HOUSEKEEPING';
  end if;
  for v_batch in
    select batch.*
    from public.import_batches as batch
    where batch.status = 'review'
      and greatest(
        batch.updated_at,
        coalesce((select max(item.updated_at) from public.import_items as item
                  where item.user_id = batch.user_id and item.batch_id = batch.id), batch.updated_at)
      ) <= pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => p_idle_days)
    order by batch.updated_at, batch.id
    for update of batch skip locked
    limit p_limit
  loop
    update internal.import_jobs as job
    set status = 'cancelled', lease_expires_at = null,
        error_code = 'IMPORT_CANCELLED', finished_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where job.batch_id = v_batch.id and job.status in ('queued', 'running');
    update public.import_batches as batch
    set status = 'cancelled', cancelled_at = pg_catalog.clock_timestamp(),
        expires_at = pg_catalog.clock_timestamp()
    where batch.id = v_batch.id and batch.status = 'review';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 2. Export snapshot retention ----------------------------------------------------------------------------------------------

alter table public.cv_exports add column snapshot_purged_at timestamptz;

alter table public.cv_exports
  add constraint cv_exports_snapshot_purged_check
  check (snapshot_purged_at is null or snapshot = '{}'::jsonb);

comment on column public.cv_exports.snapshot_purged_at is
  'T23: set when the snapshot was emptied to {} (PDF expired, or 24 hours after a failed export). Status, revision, times, page_count and error_code stay.';

-- The snapshot stays immutable except for the single transition to {} together with snapshot_purged_at.
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
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_IMMUTABLE';
  end if;
  if new.snapshot is distinct from old.snapshot then
    if not (old.snapshot_purged_at is null and new.snapshot = '{}'::jsonb and new.snapshot_purged_at is not null) then
      raise exception using errcode = 'P0001', message = 'CV_EXPORT_IMMUTABLE';
    end if;
  elsif new.snapshot_purged_at is distinct from old.snapshot_purged_at then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_IMMUTABLE';
  end if;
  return new;
end;
$$;

-- Retention: a succeeded export is downloadable for 24 hours; then its object is queued for deletion, the row is marked
-- purged and the snapshot is emptied. The row, the CV and its items stay.
create or replace function public.expire_cv_exports(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.cv_exports%rowtype;
  v_count integer := 0;
  v_now timestamptz;
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
    v_now := pg_catalog.clock_timestamp();
    perform internal.enqueue_storage_delete(v_job.user_id, v_job.object_key);
    update public.cv_exports as job
    set purged_at = v_now, snapshot = '{}'::jsonb, snapshot_purged_at = v_now
    where job.id = v_job.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- A failed export keeps its snapshot for 24 hours so a retry is possible; then the snapshot is emptied.
create or replace function public.redact_cv_export_snapshots(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_CV_EXPORT_HOUSEKEEPING';
  end if;
  with doomed as (
    select job.id
    from public.cv_exports as job
    where job.status = 'failed' and job.snapshot_purged_at is null
      and job.finished_at <= pg_catalog.clock_timestamp() - interval '24 hours'
    order by job.finished_at, job.id
    for update skip locked
    limit p_limit
  ), redacted as (
    update public.cv_exports as job
    set snapshot = '{}'::jsonb, snapshot_purged_at = pg_catalog.clock_timestamp()
    from doomed
    where job.id = doomed.id
    returning 1
  )
  select count(*)::integer into v_count from redacted;
  return v_count;
end;
$$;

-- 3. Guarded retry ---------------------------------------------------------------------------------------------------------

-- Explicit retry of the same snapshot. It is refused when the snapshot was emptied, when the CV changed since the export
-- was requested, or when the CV is blocked now: otherwise source text the owner already removed could be printed again.
create or replace function public.retry_cv_export(p_export_id uuid)
returns table (export_id uuid, status text, attempt_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.cv_actor();
  v_cv public.cv_documents%rowtype;
  v_job public.cv_exports%rowtype;
begin
  if p_export_id is null then
    raise exception using errcode = 'P0001', message = 'CV_EXPORT_NOT_FOUND';
  end if;
  select document.* into v_cv from public.cv_documents as document where document.user_id = v_user_id for update;
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

  if v_job.snapshot_purged_at is not null or v_cv.revision <> v_job.cv_revision then
    raise exception using errcode = 'P0001', message = 'EXPORT_RETRY_UNAVAILABLE';
  end if;
  -- Sources are locked before readiness is computed, as in request_cv_export.
  perform internal.cv_export_lock_sources(v_user_id, v_cv.id);
  if exists (select 1 from internal.cv_export_blockers(v_cv)) then
    raise exception using errcode = 'P0001', message = 'EXPORT_RETRY_UNAVAILABLE';
  end if;

  update public.cv_exports as job
  set status = 'queued', attempt_token = null, lease_expires_at = null, error_code = null, finished_at = null
  where job.id = v_job.id
  returning job.* into v_job;
  return query select v_job.id, v_job.status, v_job.attempt_count;
end;
$$;

-- 4. Grants and comments ----------------------------------------------------------------------------------------------------

revoke all on function public.expire_abandoned_import_reviews(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.redact_cv_export_snapshots(integer) from public, anon, authenticated, service_role;
revoke all on function public.expire_cv_exports(integer) from public, anon, authenticated, service_role;
revoke all on function public.retry_cv_export(uuid) from public, anon, service_role;
revoke all on function internal.guard_cv_export_row() from public, anon, authenticated, service_role;
grant execute on function public.expire_abandoned_import_reviews(integer, integer) to service_role;
grant execute on function public.redact_cv_export_snapshots(integer) to service_role;
grant execute on function public.expire_cv_exports(integer) to service_role;
grant execute on function public.retry_cv_export(uuid) to authenticated;

comment on function public.expire_abandoned_import_reviews(integer, integer) is
  'T23 worker: cancels review batches idle for at least p_idle_days (7 to 365, default 30) with the cancel_import_batch transition; purge_expired_import_batches then removes the file and text.';
comment on function public.expire_cv_exports(integer) is
  'T23 worker: queues deletion of expired export objects, marks the rows purged and empties their snapshot; the CV is untouched.';
comment on function public.redact_cv_export_snapshots(integer) is
  'T23 worker: empties the snapshot of failed exports 24 hours after they finished; metadata stays.';
comment on function public.retry_cv_export(uuid) is
  'T23: explicit failed -> queued retry of the same snapshot; at most three attempts; refused with EXPORT_RETRY_UNAVAILABLE when the snapshot was emptied, the CV revision changed or the CV is blocked.';

commit;

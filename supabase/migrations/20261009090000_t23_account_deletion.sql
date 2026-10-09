-- T23 account deletion backend (PRD R01 and Privacy and safety: Deletion, DB section 4 and 6, decision 0029).
-- 1. A generic write guard on every user-owned public table, so a deleting account cannot write through any path.
-- 2. internal.account_deletions: a durable receipt per account, with no foreign key, claim, lease and CAS.
-- 3. Service-role RPCs: begin, claim, ordered purge, mark Auth deleted, retry, verify, prune, backlog.
-- 4. A read-only preview for the confirmation dialog.

begin;

-- 1. Write guard ------------------------------------------------------------------------------------------------------------
-- A request that carries a user JWT (auth.uid() is not null) cannot insert, update or delete a row whose owner is deleting.
-- Requests without a subject (service role, workers, the purge, Auth admin) are not affected. For profiles the OLD row is
-- checked, so the NULL -> value transition that starts a deletion stays legal.
create or replace function internal.guard_account_writable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_owner uuid;
  v_deleting_at timestamptz;
begin
  -- Only a request made as a user (database role authenticated with a JWT subject) is guarded. Service role, workers,
  -- the purge, Auth admin and owner sessions are not; PostgREST always runs user requests as authenticated.
  if auth.uid() is null or pg_catalog.current_setting('role', true) is distinct from 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then return new; end if;
    if old.deleting_at is not null then
      raise exception using errcode = '42501', message = 'ACCOUNT_DELETING';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_owner := new.user_id;
  else
    v_owner := old.user_id;
  end if;

  select profile.deleting_at
  into v_deleting_at
  from public.profiles as profile
  where profile.id = v_owner;

  if v_deleting_at is not null then
    raise exception using errcode = '42501', message = 'ACCOUNT_DELETING';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function internal.guard_account_writable() from public, anon, authenticated, service_role;

comment on function internal.guard_account_writable() is
  'T23: rejects INSERT, UPDATE and DELETE by a user JWT on rows of an account that is deleting (42501 ACCOUNT_DELETING). Requests without a subject are unaffected.';

do $install$
declare
  v_table text;
begin
  for v_table in
    select columns.table_name
    from information_schema.columns as columns
    join information_schema.tables as tables
      on tables.table_schema = columns.table_schema and tables.table_name = columns.table_name
    where columns.table_schema = 'public'
      and columns.column_name = 'user_id'
      and tables.table_type = 'BASE TABLE'
    union
    select 'profiles'
    order by 1
  loop
    execute format('drop trigger if exists zz_guard_account_writable on public.%I', v_table);
    execute format(
      'create trigger zz_guard_account_writable before insert or update or delete on public.%I for each row execute function internal.guard_account_writable()',
      v_table
    );
  end loop;
end;
$install$;

-- 2. Receipts ---------------------------------------------------------------------------------------------------------------

create table internal.account_deletions (
  user_id uuid primary key,
  status text not null default 'queued',
  requested_at timestamptz not null,
  attempt_count integer not null default 0,
  attempt_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null,
  objects_enqueued_at timestamptz,
  rows_purged_at timestamptz,
  auth_deleted_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null,
  constraint account_deletions_status_check
    check (status in ('queued', 'running', 'purged', 'completed')),
  constraint account_deletions_attempt_count_check
    check (attempt_count >= 0),
  constraint account_deletions_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint account_deletions_state_check
    check (
      (status = 'queued' and attempt_token is null and lease_expires_at is null and completed_at is null)
      or (status = 'running' and attempt_count > 0 and attempt_token is not null and lease_expires_at is not null and completed_at is null)
      or (status = 'purged' and attempt_token is null and lease_expires_at is null and rows_purged_at is not null
          and auth_deleted_at is not null and completed_at is null)
      or (status = 'completed' and attempt_token is null and lease_expires_at is null and rows_purged_at is not null
          and auth_deleted_at is not null and completed_at is not null)
    ),
  constraint account_deletions_timestamp_check
    check (updated_at >= requested_at)
);

comment on table internal.account_deletions is
  'T23: one durable receipt per account deletion. Intentionally no foreign key to profiles or auth.users; it holds only the user id, timestamps, a status and an allowlisted error code.';

alter table internal.account_deletions enable row level security;
revoke all privileges on table internal.account_deletions from public, anon, authenticated, service_role;

create index account_deletions_claim_idx
  on internal.account_deletions (next_attempt_at, requested_at, user_id)
  where status in ('queued', 'running');
create index account_deletions_pending_idx
  on internal.account_deletions (requested_at)
  where status <> 'completed';

-- 3. RPCs -------------------------------------------------------------------------------------------------------------------

-- Locks the profile, marks it deleting and creates the receipt in one transaction. A second call returns the same request.
create or replace function public.begin_account_deletion(p_user_id uuid)
returns table (requested_at timestamptz, already_requested boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_deleting_at timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_requested_at timestamptz;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_ACCOUNT_DELETION';
  end if;

  select profile.deleting_at
  into v_deleting_at
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_NOT_FOUND';
  end if;

  if v_deleting_at is not null then
    select receipt.requested_at
    into v_requested_at
    from internal.account_deletions as receipt
    where receipt.user_id = p_user_id;
    if v_requested_at is null then
      -- Marked deleting by another path (internal.mark_account_deleting) without a receipt: create one now.
      insert into internal.account_deletions (user_id, requested_at, next_attempt_at, updated_at)
      values (p_user_id, v_deleting_at, v_now, v_now)
      on conflict (user_id) do nothing;
      v_requested_at := v_deleting_at;
    end if;
    return query select v_requested_at, true;
    return;
  end if;

  update public.profiles as profile
  set deleting_at = v_now
  where profile.id = p_user_id;

  insert into internal.account_deletions (user_id, requested_at, next_attempt_at, updated_at)
  values (p_user_id, v_now, v_now, v_now)
  on conflict (user_id) do nothing;

  return query select v_now, false;
end;
$$;

-- Read-only counts for the confirmation dialog; the owner is the session user.
create or replace function public.get_account_deletion_preview()
returns table (
  activities integer,
  achievements integer,
  projects integer,
  evidence_files integer,
  import_batches integer,
  has_cv boolean,
  cv_exports integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if exists (select 1 from public.profiles as profile where profile.id = v_user_id and profile.deleting_at is not null) then
    raise exception using errcode = '42501', message = 'ACCOUNT_DELETING';
  end if;
  return query select
    (select count(*)::integer from public.activities as t where t.user_id = v_user_id),
    (select count(*)::integer from public.achievements as t where t.user_id = v_user_id),
    (select count(*)::integer from public.projects as t where t.user_id = v_user_id),
    (select count(*)::integer from public.evidence_files as t where t.user_id = v_user_id and t.status in ('uploading', 'scanning', 'ready')),
    (select count(*)::integer from public.import_batches as t where t.user_id = v_user_id),
    exists (select 1 from public.cv_documents as t where t.user_id = v_user_id),
    (select count(*)::integer from public.cv_exports as t where t.user_id = v_user_id);
end;
$$;

create or replace function public.claim_account_deletion_jobs(p_limit integer default 1)
returns table (
  user_id uuid,
  requested_at timestamptz,
  attempt_count integer,
  attempt_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'INVALID_ACCOUNT_DELETION_CLAIM';
  end if;
  return query
  with candidates as (
    select receipt.user_id
    from internal.account_deletions as receipt
    where receipt.next_attempt_at <= pg_catalog.clock_timestamp()
      and (
        receipt.status = 'queued'
        or (receipt.status = 'running' and receipt.lease_expires_at <= pg_catalog.clock_timestamp())
      )
    order by receipt.next_attempt_at, receipt.requested_at, receipt.user_id
    for update of receipt skip locked
    limit p_limit
  ), claimed as (
    update internal.account_deletions as receipt
    set status = 'running',
        attempt_count = receipt.attempt_count + 1,
        attempt_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds',
        updated_at = pg_catalog.clock_timestamp()
    from candidates
    where receipt.user_id = candidates.user_id
    returning receipt.*
  )
  select claimed.user_id, claimed.requested_at, claimed.attempt_count, claimed.attempt_token, claimed.lease_expires_at
  from claimed
  order by claimed.requested_at, claimed.user_id;
end;
$$;

-- Queues every known object key and every object under the user prefix, then deletes the account rows in a safe order.
-- All of it is one transaction: a failure rolls back the queued jobs and the deletions together. The profile row stays as
-- a tombstone so sign-in during the Auth-delete window still sees the deleting state. Returns the number of keys queued.
create or replace function public.purge_account_data(p_user_id uuid, p_attempt_token uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_count integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_profile_present boolean;
  v_deleting_at timestamptz;
begin
  if p_user_id is null or p_attempt_token is null then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_PURGE_LEASE_LOST';
  end if;

  perform 1
  from internal.account_deletions as receipt
  where receipt.user_id = p_user_id
    and receipt.status = 'running'
    and receipt.attempt_token = p_attempt_token
    and receipt.lease_expires_at > v_now
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_PURGE_LEASE_LOST';
  end if;

  select profile.deleting_at
  into v_deleting_at
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  v_profile_present := found;
  if v_profile_present and v_deleting_at is null then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_DELETING';
  end if;

  -- 1. Queue every object key before the first DELETE. Keys known from rows, then every canonical object under the prefix.
  for v_key in
    select distinct keys.object_key
    from (
      select evidence.object_key from public.evidence_files as evidence where evidence.user_id = p_user_id
      union all
      select batch.file_key from public.import_batches as batch where batch.user_id = p_user_id and batch.file_key is not null
      union all
      select export_row.object_key from public.cv_exports as export_row
        where export_row.user_id = p_user_id and export_row.object_key is not null and export_row.purged_at is null
      union all
      select object_row.name from storage.objects as object_row
        where object_row.bucket_id = 'workpulse-private'
          and pg_catalog.starts_with(object_row.name, p_user_id::text || '/')
          and object_row.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(import|evidence|export)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) as keys
    where keys.object_key is not null
    order by keys.object_key
  loop
    perform internal.enqueue_storage_delete(p_user_id, v_key);
    -- A failed job, or a succeeded job whose object is present again, goes back to the queue.
    update internal.storage_jobs as job
    set status = 'queued', attempt_token = null, lease_expires_at = null,
        next_attempt_at = v_now, error_code = null, finished_at = null, updated_at = v_now
    where job.bucket_id = 'workpulse-private' and job.object_key = v_key and job.kind = 'delete'
      and (
        job.status = 'failed'
        or (job.status = 'succeeded' and exists (
          select 1 from storage.objects as object_row
          where object_row.bucket_id = 'workpulse-private' and object_row.name = v_key))
      );
    v_count := v_count + 1;
  end loop;

  -- 2. Delete the rows in an order that never leaves a dependent row pointing at a missing parent.
  delete from public.cv_exports where user_id = p_user_id;
  delete from public.cv_items where user_id = p_user_id;
  delete from public.cv_documents where user_id = p_user_id;
  delete from public.ai_suggestion_reviews where user_id = p_user_id;
  delete from public.ai_jobs where user_id = p_user_id;
  delete from public.import_batches where user_id = p_user_id;
  delete from public.evidence_files where user_id = p_user_id;
  delete from internal.evidence_scan_jobs where user_id = p_user_id;
  delete from internal.evidence_reservation_requests where user_id = p_user_id;
  delete from public.chat_messages where user_id = p_user_id;
  delete from public.achievement_skills where user_id = p_user_id;
  delete from public.achievements where user_id = p_user_id;
  delete from public.activities where user_id = p_user_id;
  delete from public.projects where user_id = p_user_id;
  delete from public.skills where user_id = p_user_id;
  delete from public.certifications where user_id = p_user_id;
  delete from public.education where user_id = p_user_id;
  delete from public.experiences where user_id = p_user_id;
  delete from internal.operation_requests where user_id = p_user_id;
  delete from internal.import_jobs where user_id = p_user_id;

  update internal.account_deletions as receipt
  set objects_enqueued_at = coalesce(receipt.objects_enqueued_at, v_now),
      rows_purged_at = v_now,
      last_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
  where receipt.user_id = p_user_id;

  return v_count;
end;
$$;

-- Compare-and-set: only the current, unexpired lease may record that the Auth user is gone, and only after the purge.
create or replace function public.mark_account_auth_deleted(p_user_id uuid, p_attempt_token uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_user_id is null or p_attempt_token is null then
    return false;
  end if;
  update internal.account_deletions as receipt
  set status = 'purged',
      auth_deleted_at = pg_catalog.clock_timestamp(),
      attempt_token = null,
      lease_expires_at = null,
      last_error_code = null,
      updated_at = pg_catalog.clock_timestamp()
  where receipt.user_id = p_user_id
    and receipt.status = 'running'
    and receipt.attempt_token = p_attempt_token
    and receipt.lease_expires_at > pg_catalog.clock_timestamp()
    and receipt.rows_purged_at is not null;
  return found;
end;
$$;

create or replace function public.retry_account_deletion_job(
  p_user_id uuid,
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
  if p_user_id is null or p_attempt_token is null or p_next_attempt_at is null
     or p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception using errcode = '22023', message = 'INVALID_ACCOUNT_DELETION_RETRY';
  end if;
  update internal.account_deletions as receipt
  set status = 'queued',
      attempt_token = null,
      lease_expires_at = null,
      next_attempt_at = p_next_attempt_at,
      last_error_code = p_error_code,
      updated_at = pg_catalog.clock_timestamp()
  where receipt.user_id = p_user_id
    and receipt.status = 'running'
    and receipt.attempt_token = p_attempt_token
    and receipt.lease_expires_at > pg_catalog.clock_timestamp();
  return found;
end;
$$;

-- A purged receipt becomes completed only when the storage prefix is empty and no cleanup job is queued, running or failed.
create or replace function public.verify_account_purges(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_receipt record;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_ACCOUNT_DELETION_HOUSEKEEPING';
  end if;
  for v_receipt in
    select receipt.user_id
    from internal.account_deletions as receipt
    where receipt.status = 'purged'
    order by receipt.requested_at, receipt.user_id
    for update skip locked
    limit p_limit
  loop
    if not exists (
         select 1 from storage.objects as object_row
         where object_row.bucket_id = 'workpulse-private'
           and pg_catalog.starts_with(object_row.name, v_receipt.user_id::text || '/')
       )
       and not exists (
         select 1 from internal.storage_jobs as job
         where job.user_id = v_receipt.user_id and job.status in ('queued', 'running', 'failed')
       ) then
      update internal.account_deletions as receipt
      set status = 'completed',
          completed_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      where receipt.user_id = v_receipt.user_id and receipt.status = 'purged';
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.prune_account_deletion_receipts(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'INVALID_ACCOUNT_DELETION_HOUSEKEEPING';
  end if;
  with doomed as (
    select receipt.user_id
    from internal.account_deletions as receipt
    where receipt.status = 'completed' and receipt.completed_at <= pg_catalog.clock_timestamp() - interval '30 days'
    order by receipt.completed_at, receipt.user_id
    for update skip locked
    limit p_limit
  ), removed as (
    delete from internal.account_deletions as receipt using doomed where receipt.user_id = doomed.user_id returning 1
  )
  select count(*)::integer into v_count from removed;
  return v_count;
end;
$$;

create or replace function public.get_account_deletion_backlog()
returns table (pending integer, overdue integer)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    (count(*) filter (where receipt.status <> 'completed'))::integer,
    (count(*) filter (where receipt.status <> 'completed'
                        and receipt.requested_at <= pg_catalog.clock_timestamp() - interval '24 hours'))::integer
  from internal.account_deletions as receipt;
$$;

-- 4. Grants and comments ----------------------------------------------------------------------------------------------------

revoke all on function public.begin_account_deletion(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_account_deletion_preview() from public, anon, authenticated, service_role;
revoke all on function public.claim_account_deletion_jobs(integer) from public, anon, authenticated, service_role;
revoke all on function public.purge_account_data(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_account_auth_deleted(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.retry_account_deletion_job(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.verify_account_purges(integer) from public, anon, authenticated, service_role;
revoke all on function public.prune_account_deletion_receipts(integer) from public, anon, authenticated, service_role;
revoke all on function public.get_account_deletion_backlog() from public, anon, authenticated, service_role;

grant execute on function public.get_account_deletion_preview() to authenticated;
grant execute on function public.begin_account_deletion(uuid) to service_role;
grant execute on function public.claim_account_deletion_jobs(integer) to service_role;
grant execute on function public.purge_account_data(uuid, uuid) to service_role;
grant execute on function public.mark_account_auth_deleted(uuid, uuid) to service_role;
grant execute on function public.retry_account_deletion_job(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.verify_account_purges(integer) to service_role;
grant execute on function public.prune_account_deletion_receipts(integer) to service_role;
grant execute on function public.get_account_deletion_backlog() to service_role;

comment on function public.begin_account_deletion(uuid) is
  'T23: service role only. Locks the profile, marks it deleting and creates the deletion receipt in one transaction; idempotent.';
comment on function public.get_account_deletion_preview() is
  'T23: counts of the session owner data that account deletion removes. Refused for a deleting account.';
comment on function public.claim_account_deletion_jobs(integer) is
  'T23 worker: skip-locked claim of queued or lease-expired deletion receipts with a 120 second lease and a fresh attempt token. Returns no personal data.';
comment on function public.purge_account_data(uuid, uuid) is
  'T23 worker: one transaction that queues every known object key and every canonical object under the user prefix, then deletes the account rows in a fixed order. The profile stays as a tombstone.';
comment on function public.mark_account_auth_deleted(uuid, uuid) is
  'T23 worker: compare-and-set from running to purged after the Auth user was deleted.';
comment on function public.retry_account_deletion_job(uuid, uuid, text, timestamptz) is
  'T23 worker: compare-and-set back to queued with an allowlisted error code and the next attempt time.';
comment on function public.verify_account_purges(integer) is
  'T23 worker: completes purged receipts once the storage prefix is empty and no cleanup job is queued, running or failed.';
comment on function public.prune_account_deletion_receipts(integer) is
  'T23 worker: removes completed receipts older than 30 days (the backup window).';
comment on function public.get_account_deletion_backlog() is
  'T23: counts receipts that are not completed, and those older than 24 hours.';

commit;

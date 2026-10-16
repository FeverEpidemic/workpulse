begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T25 operational health (T25 plan sections 2.2.8 and 3.1).
-- Rows are inserted and aged as the test owner. Every metric is checked as a delta against the rows already in the
-- database, so leftover rows from other suites do not matter.

-- 1. Structure and privileges -------------------------------------------------

select ok(
  to_regprocedure('public.get_operational_health(timestamptz)') is not null,
  'get_operational_health(timestamptz) exists'
);
select is(
  pg_catalog.pg_get_function_result('public.get_operational_health(timestamptz)'::regprocedure),
  'TABLE(metric text, value integer)',
  'the report has two columns only: metric and value'
);
select ok(
  (select prosecdef and provolatile = 's' and proconfig = array['search_path=pg_catalog']
   from pg_catalog.pg_proc where oid = 'public.get_operational_health(timestamptz)'::regprocedure),
  'the function is security definer, stable, and pins search_path'
);
select ok(
  has_function_privilege('service_role', 'public.get_operational_health(timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.get_operational_health(timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_operational_health(timestamptz)', 'EXECUTE'),
  'only service_role can execute the report'
);
select ok(
  (select obj_description('public.get_operational_health(timestamptz)'::regprocedure, 'pg_proc') like 'T25%'),
  'the function comment is labelled T25'
);
select is(
  (select array_agg(metric) from public.get_operational_health()),
  array['account_deletion_overdue', 'storage_cleanup_failed', 'storage_cleanup_overdue', 'import_purge_overdue',
        'export_purge_overdue', 'evidence_stuck', 'jobs_failed_24h', 'jobs_expired_lease'],
  'the eight metrics come back in the frozen order'
);
select ok(
  (select bool_and(value is not null and value >= 0) from public.get_operational_health()),
  'every value is a non-negative count'
);

-- 2. Fixtures -------------------------------------------------------------------

create or replace function pg_temp.usr(p_suffix text) returns uuid language sql as $$
  select ('c2500000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;
create or replace function pg_temp.u(p_suffix text) returns uuid language sql as $$
  select ('c2510000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;
create or replace function pg_temp.set_jwt_subject(p_user_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    case when p_user_id is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_user_id::text, 'role', p_role)::text end, true);
end;
$$;
-- Backdates rows without letting the touch and guard triggers move the clocks back.
create or replace function pg_temp.age(p_sql text) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  execute p_sql;
  set local session_replication_role = origin;
end;
$$;
-- Runs one statement and returns the metrics that changed, as {metric: difference}.
create or replace function pg_temp.step(p_sql text) returns jsonb language plpgsql as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select jsonb_object_agg(metric, value) into v_before from public.get_operational_health();
  perform pg_temp.age(p_sql);
  select jsonb_object_agg(metric, value) into v_after from public.get_operational_health();
  return coalesce((
    select jsonb_object_agg(a.key, (a.value)::integer - (v_before ->> a.key)::integer)
    from jsonb_each(v_after) as a
    where (a.value)::integer <> (v_before ->> a.key)::integer), '{}'::jsonb);
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select pg_temp.usr(suffix), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'health-' || suffix || '@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values ('a1')) as users(suffix);
update public.profiles set display_name = 'Ani Kesehatan', onboarding_completed_at = now() where id = pg_temp.usr('a1');

insert into public.activities (id, user_id, raw_text, occurred_on, capture_mode)
values (pg_temp.u('ac01'), pg_temp.usr('a1'), 'Catatan kesehatan', current_date, 'note');
insert into public.education (id, user_id, institution, qualification, field_of_study)
values (pg_temp.u('ed01'), pg_temp.usr('a1'), 'Universitas Contoh', 'S1', 'Informatika');
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));
select count(*) from public.ensure_cv_document();
select count(*) from public.select_cv_source(1, 'education', pg_temp.u('ed01'));
select pg_temp.set_jwt_subject(null);

-- 3. account_deletion_overdue: the same definition as get_account_deletion_backlog --------------------

select is(
  pg_temp.step(format($$ insert into internal.account_deletions (user_id, next_attempt_at, status, requested_at, updated_at)
    values (%L, now(), 'queued', now() - interval '23 hours', now() - interval '23 hours') $$, pg_temp.u('d001'))),
  '{}'::jsonb, 'a receipt requested 23 hours ago is not overdue'
);
select is(
  pg_temp.step(format($$ insert into internal.account_deletions (user_id, next_attempt_at, status, requested_at, updated_at)
    values (%L, now(), 'queued', now() - interval '25 hours', now() - interval '25 hours') $$, pg_temp.u('d002'))),
  '{"account_deletion_overdue": 1}'::jsonb, 'a queued receipt older than 24 hours raises account_deletion_overdue by one'
);
select is(
  pg_temp.step(format($$ insert into internal.account_deletions
      (user_id, next_attempt_at, status, requested_at, updated_at, rows_purged_at, auth_deleted_at, completed_at)
    values (%L, now(), 'completed', now() - interval '26 hours', now() - interval '25 hours',
            now() - interval '25 hours', now() - interval '25 hours', now() - interval '25 hours') $$, pg_temp.u('d003'))),
  '{}'::jsonb, 'a completed receipt is never overdue'
);
select is(
  (select value from public.get_operational_health() where metric = 'account_deletion_overdue'),
  (select overdue from public.get_account_deletion_backlog()),
  'account_deletion_overdue equals the overdue count of get_account_deletion_backlog'
);

-- 4. Storage cleanup jobs ------------------------------------------------------------------------

select is(
  pg_temp.step(format($$ insert into internal.storage_jobs (id, user_id, object_key, status, created_at, updated_at)
    values (%L, %L, %L, 'queued', now() - interval '23 hours', now() - interval '23 hours') $$,
    pg_temp.u('e001'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/evidence/' || pg_temp.u('e001'))),
  '{}'::jsonb, 'a cleanup job queued 23 hours ago is not overdue'
);
select is(
  pg_temp.step(format($$ insert into internal.storage_jobs (id, user_id, object_key, status, created_at, updated_at)
    values (%L, %L, %L, 'queued', now() - interval '25 hours', now() - interval '25 hours') $$,
    pg_temp.u('e002'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/evidence/' || pg_temp.u('e002'))),
  '{"storage_cleanup_overdue": 1}'::jsonb, 'a cleanup job queued 25 hours ago raises storage_cleanup_overdue by one'
);
select is(
  pg_temp.step(format($$ insert into internal.storage_jobs
      (id, user_id, object_key, status, attempt_count, attempt_token, lease_expires_at, created_at, updated_at)
    values (%L, %L, %L, 'running', 1, gen_random_uuid(), now() + interval '2 minutes', now() - interval '26 hours', now() - interval '26 hours') $$,
    pg_temp.u('e003'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/evidence/' || pg_temp.u('e003'))),
  '{"storage_cleanup_overdue": 1}'::jsonb, 'a running cleanup job older than 24 hours is overdue too'
);
select is(
  pg_temp.step(format($$ insert into internal.storage_jobs
      (id, user_id, object_key, status, attempt_count, attempt_token, finished_at, created_at, updated_at)
    values (%L, %L, %L, 'succeeded', 1, gen_random_uuid(), now() - interval '20 hours', now() - interval '26 hours', now() - interval '20 hours') $$,
    pg_temp.u('e004'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/evidence/' || pg_temp.u('e004'))),
  '{}'::jsonb, 'a succeeded cleanup job is not counted'
);
select is(
  pg_temp.step(format($$ insert into internal.storage_jobs
      (id, user_id, object_key, status, attempt_count, attempt_token, finished_at, error_code, created_at, updated_at)
    values (%L, %L, %L, 'failed', 1, gen_random_uuid(), now() - interval '1 hour', 'STORAGE_UNAVAILABLE', now() - interval '2 hours', now() - interval '1 hour') $$,
    pg_temp.u('e005'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/evidence/' || pg_temp.u('e005'))),
  '{"storage_cleanup_failed": 1}'::jsonb, 'a failed cleanup job raises storage_cleanup_failed by one'
);

-- 5. jobs_expired_lease -------------------------------------------------------------------------

select is(
  pg_temp.step(format($$ insert into internal.storage_jobs
      (id, user_id, object_key, status, attempt_count, attempt_token, lease_expires_at, created_at, updated_at)
    values (%L, %L, %L, 'running', 1, gen_random_uuid(), now() - interval '9 minutes', now() - interval '1 hour', now() - interval '9 minutes') $$,
    pg_temp.u('f001'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/evidence/' || pg_temp.u('f001'))),
  '{}'::jsonb, 'a lease that expired 9 minutes ago is not reported'
);
select is(
  pg_temp.step(format($$ insert into internal.storage_jobs
      (id, user_id, object_key, status, attempt_count, attempt_token, lease_expires_at, created_at, updated_at)
    values (%L, %L, %L, 'running', 1, gen_random_uuid(), now() - interval '11 minutes', now() - interval '1 hour', now() - interval '11 minutes') $$,
    pg_temp.u('f002'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/evidence/' || pg_temp.u('f002'))),
  '{"jobs_expired_lease": 1}'::jsonb, 'a cleanup lease expired 11 minutes ago raises jobs_expired_lease by one'
);
select is(
  pg_temp.step(format($$ insert into internal.account_deletions
      (user_id, next_attempt_at, status, requested_at, updated_at, attempt_count, attempt_token, lease_expires_at)
    values (%L, now(), 'running', now() - interval '1 hour', now() - interval '1 hour', 1, gen_random_uuid(), now() - interval '12 minutes') $$,
    pg_temp.u('f003'))),
  '{"jobs_expired_lease": 1}'::jsonb, 'a deletion receipt with an expired lease is reported'
);
select is(
  pg_temp.step(format($$ insert into internal.import_jobs
      (id, user_id, batch_id, object_key, expected_bytes, mime_type, sha256, status, attempt_count, attempt_token, lease_expires_at)
    values (%L, %L, %L, %L, 10, 'application/pdf', repeat('a', 64), 'running', 1, gen_random_uuid(), now() - interval '12 minutes') $$,
    pg_temp.u('f004'), pg_temp.usr('a1'), pg_temp.u('fb04'), pg_temp.usr('a1') || '/import/' || pg_temp.u('fb04'))),
  '{"jobs_expired_lease": 1}'::jsonb, 'an import job with an expired lease is reported'
);

-- 6. evidence_stuck -----------------------------------------------------------------------------

insert into public.evidence_files (id, user_id, activity_id, object_key, original_name, mime_type, bytes, status, reserved_until,
                                   parent_revision, idempotency_key, payload_hash)
values (pg_temp.u('e101'), pg_temp.usr('a1'), pg_temp.u('ac01'), pg_temp.usr('a1') || '/evidence/' || pg_temp.u('e101'),
        'bukti.pdf', 'application/pdf', 10, 'uploading', now() + interval '1 hour', 1, gen_random_uuid(), decode(repeat('ab', 32), 'hex'));
select is(
  pg_temp.step(format($$ update public.evidence_files set created_at = now() - interval '3 hours', updated_at = now() - interval '59 minutes' where id = %L $$, pg_temp.u('e101'))),
  '{}'::jsonb, 'a file that has been uploading for 59 minutes is not stuck'
);
select is(
  pg_temp.step(format($$ update public.evidence_files set created_at = now() - interval '3 hours', updated_at = now() - interval '61 minutes' where id = %L $$, pg_temp.u('e101'))),
  '{"evidence_stuck": 1}'::jsonb, 'a file uploading for 61 minutes raises evidence_stuck by one'
);

-- 7. import_purge_overdue -----------------------------------------------------------------------

select is(
  pg_temp.step(format($$ insert into public.import_batches
      (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, cancelled_at, expires_at)
    values (%L, %L, gen_random_uuid(), decode(repeat('ab', 32), 'hex'), %L, 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
            'cancelled', 'screening', now() - interval '23 hours', now() - interval '23 hours') $$,
    pg_temp.u('b001'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/import/' || pg_temp.u('b001'))),
  '{}'::jsonb, 'a batch cancelled 23 hours ago and not yet purged is not overdue'
);
select is(
  pg_temp.step(format($$ insert into public.import_batches
      (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, cancelled_at, expires_at)
    values (%L, %L, gen_random_uuid(), decode(repeat('ab', 32), 'hex'), %L, 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
            'cancelled', 'screening', now() - interval '25 hours', now() - interval '25 hours') $$,
    pg_temp.u('b002'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/import/' || pg_temp.u('b002'))),
  '{"import_purge_overdue": 1}'::jsonb, 'a batch cancelled 25 hours ago and not purged raises import_purge_overdue by one'
);
select is(
  pg_temp.step(format($$ insert into public.import_batches
      (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, error_code, failed_at, expires_at)
    values (%L, %L, gen_random_uuid(), decode(repeat('ab', 32), 'hex'), %L, 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
            'failed', 'parsing', 'IMPORT_WORKER_TIMEOUT', now() - interval '30 hours', now() - interval '7 hours') $$,
    pg_temp.u('b003'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/import/' || pg_temp.u('b003'))),
  '{"import_purge_overdue": 1}'::jsonb, 'a batch that failed 30 hours ago and was not purged is overdue'
);
select is(
  pg_temp.step(format($$ insert into public.import_batches
      (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, cancelled_at, expires_at, purged_at)
    values (%L, %L, gen_random_uuid(), decode(repeat('ab', 32), 'hex'), null, 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
            'cancelled', 'screening', now() - interval '30 hours', now() - interval '30 hours', now() - interval '29 hours') $$,
    pg_temp.u('b004'), pg_temp.usr('a1'))),
  '{}'::jsonb, 'a purged batch is not overdue'
);

-- 8. export_purge_overdue and failed jobs ---------------------------------------------------------

create or replace function pg_temp.cv_id() returns uuid language sql as $$
  select id from public.cv_documents where user_id = pg_temp.usr('a1')
$$;
create or replace function pg_temp.cv_rev() returns integer language sql as $$
  select revision from public.cv_documents where user_id = pg_temp.usr('a1')
$$;

select is(
  pg_temp.step(format($$ insert into public.cv_exports
      (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key, attempt_count, attempt_token, finished_at, object_key, page_count, byte_size, expires_at)
    values (%L, %L, %L, %s, '{}'::jsonb, 'succeeded', %L, 1, gen_random_uuid(), now() - interval '23 hours', %L, 1, 100, now() + interval '1 hour') $$,
    pg_temp.u('c001'), pg_temp.usr('a1'), pg_temp.cv_id(), pg_temp.cv_rev(), 'health-' || pg_temp.u('c001'),
    pg_temp.usr('a1') || '/export/' || pg_temp.u('c001'))),
  '{}'::jsonb, 'an export that succeeded 23 hours ago is not overdue'
);
select is(
  pg_temp.step(format($$ insert into public.cv_exports
      (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key, attempt_count, attempt_token, finished_at, object_key, page_count, byte_size, expires_at)
    values (%L, %L, %L, %s, '{}'::jsonb, 'succeeded', %L, 1, gen_random_uuid(), now() - interval '25 hours', %L, 1, 100, now() - interval '1 hour') $$,
    pg_temp.u('c002'), pg_temp.usr('a1'), pg_temp.cv_id(), pg_temp.cv_rev(), 'health-' || pg_temp.u('c002'),
    pg_temp.usr('a1') || '/export/' || pg_temp.u('c002'))),
  '{"export_purge_overdue": 1}'::jsonb, 'an export that succeeded 25 hours ago and was not purged raises export_purge_overdue by one'
);
select is(
  pg_temp.step(format($$ insert into public.cv_exports
      (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key, attempt_count, attempt_token, finished_at, object_key, page_count, byte_size, expires_at, purged_at)
    values (%L, %L, %L, %s, '{}'::jsonb, 'succeeded', %L, 1, gen_random_uuid(), now() - interval '30 hours', %L, 1, 100, now() - interval '6 hours', now() - interval '5 hours') $$,
    pg_temp.u('c003'), pg_temp.usr('a1'), pg_temp.cv_id(), pg_temp.cv_rev(), 'health-' || pg_temp.u('c003'),
    pg_temp.usr('a1') || '/export/' || pg_temp.u('c003'))),
  '{}'::jsonb, 'a purged export is not overdue'
);

select is(
  pg_temp.step(format($$ insert into public.cv_exports
      (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key, attempt_count, attempt_token, finished_at, error_code)
    values (%L, %L, %L, %s, '{}'::jsonb, 'failed', %L, 1, gen_random_uuid(), now() - interval '2 hours', 'RENDERER_UNAVAILABLE') $$,
    pg_temp.u('c004'), pg_temp.usr('a1'), pg_temp.cv_id(), pg_temp.cv_rev(), 'health-' || pg_temp.u('c004'))),
  '{"jobs_failed_24h": 1}'::jsonb, 'an export that failed 2 hours ago raises jobs_failed_24h by one'
);
select is(
  pg_temp.step(format($$ insert into public.cv_exports
      (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key, attempt_count, attempt_token, finished_at, error_code)
    values (%L, %L, %L, %s, '{}'::jsonb, 'failed', %L, 1, gen_random_uuid(), now() - interval '25 hours', 'RENDERER_UNAVAILABLE') $$,
    pg_temp.u('c005'), pg_temp.usr('a1'), pg_temp.cv_id(), pg_temp.cv_rev(), 'health-' || pg_temp.u('c005'))),
  '{}'::jsonb, 'an export that failed 25 hours ago is outside the 24 hour window'
);
select is(
  pg_temp.step(format($$ insert into public.ai_jobs
      (id, user_id, kind, activity_id, input_revision, idempotency_key, payload_hash, consent_version, status, attempt_count, error_code, finished_at)
    values (%L, %L, 'detect', %L, 1, %L, decode(repeat('00', 32), 'hex'), 'ai-processing-v1', 'failed', 1, 'AI_PROVIDER_UNAVAILABLE', now() - interval '3 hours') $$,
    pg_temp.u('a001'), pg_temp.usr('a1'), pg_temp.u('ac01'), 'detect:' || pg_temp.u('ac01') || ':r1')),
  '{"jobs_failed_24h": 1}'::jsonb, 'an AI job that failed 3 hours ago raises jobs_failed_24h by one'
);
select is(
  pg_temp.step(format($$ insert into public.import_batches
      (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, error_code, failed_at, expires_at)
    values (%L, %L, gen_random_uuid(), decode(repeat('ab', 32), 'hex'), %L, 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
            'failed', 'parsing', 'IMPORT_WORKER_TIMEOUT', now() - interval '4 hours', now() + interval '19 hours') $$,
    pg_temp.u('b005'), pg_temp.usr('a1'), pg_temp.usr('a1') || '/import/' || pg_temp.u('b005'))),
  '{"jobs_failed_24h": 1}'::jsonb, 'an import that failed 4 hours ago raises jobs_failed_24h by one'
);

-- 9. The reference time is a parameter ------------------------------------------------------------

select is(
  (select value from public.get_operational_health(now() + interval '48 hours') where metric = 'jobs_failed_24h'),
  0, 'moving the reference time forward ages every failed job out of the 24 hour window'
);
select ok(
  (select value from public.get_operational_health(now() + interval '48 hours') where metric = 'evidence_stuck') >=
  (select value from public.get_operational_health() where metric = 'evidence_stuck'),
  'a later reference time never reports fewer stuck files'
);

select * from finish();
rollback;

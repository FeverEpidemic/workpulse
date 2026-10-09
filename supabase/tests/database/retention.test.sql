begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T23 retention (PRD Data minimization, decisions 0027 N2 and 0028 N4, decision 0029).
-- Rows are inserted and aged as the test owner; user RPCs run with a JWT subject; worker RPCs are called directly.

-- 1. Structure and privileges -------------------------------------------------

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cv_exports' and column_name = 'snapshot_purged_at')
  and exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.cv_exports'::regclass and conname = 'cv_exports_snapshot_purged_check'),
  'cv_exports has snapshot_purged_at and its check'
);
select ok(
  (select bool_and(has_function_privilege('service_role', sig, 'EXECUTE')
      and not has_function_privilege('anon', sig, 'EXECUTE')
      and not has_function_privilege('authenticated', sig, 'EXECUTE'))
   from unnest(array['public.expire_abandoned_import_reviews(integer,integer)', 'public.redact_cv_export_snapshots(integer)',
     'public.expire_cv_exports(integer)']) as sigs(sig)),
  'the retention RPCs are executable by service_role only'
);
select ok(
  has_function_privilege('authenticated', 'public.retry_cv_export(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.retry_cv_export(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.retry_cv_export(uuid)', 'EXECUTE'),
  'retry_cv_export is still executable by authenticated only'
);

-- 2. Fixtures -------------------------------------------------------------------

create or replace function pg_temp.usr(p_suffix text) returns uuid language sql as $$
  select ('b2300000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;
create or replace function pg_temp.u(p_suffix text) returns uuid language sql as $$
  select ('b2310000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select pg_temp.usr(suffix), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'ret-' || suffix || '@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values ('a1'), ('b1')) as users(suffix);
update public.profiles set display_name = 'Ani Retensi', locale = 'id', onboarding_completed_at = now() where id = pg_temp.usr('a1');
update public.profiles set display_name = 'Budi Retensi', onboarding_completed_at = now() where id = pg_temp.usr('b1');

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
create or replace function pg_temp.try(p_sql text)
returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return v_state || '|' || v_msg;
end;
$$;

-- A ready CV for owner A: one education item, named profile.
insert into public.education (id, user_id, institution, qualification, field_of_study) values
  (pg_temp.u('ed01'), pg_temp.usr('a1'), 'Universitas Contoh', 'S1', 'Informatika');
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));
select count(*) from public.ensure_cv_document();
select count(*) from public.select_cv_source(1, 'education', pg_temp.u('ed01'));
select pg_temp.set_jwt_subject(null);

create or replace function pg_temp.cv_id() returns uuid language sql as $$
  select id from public.cv_documents where user_id = pg_temp.usr('a1')
$$;
create or replace function pg_temp.cv_rev() returns integer language sql as $$
  select revision from public.cv_documents where user_id = pg_temp.usr('a1')
$$;
-- Backdates rows without letting the touch and guard triggers move the clocks back.
create or replace function pg_temp.age(p_sql text) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  execute p_sql;
  set local session_replication_role = origin;
end;
$$;

-- 3. Abandoned import reviews ---------------------------------------------------------------------

insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256,
                                   status, stage, page_count, extracted_text)
select pg_temp.u(batch.suffix), batch.owner, gen_random_uuid(), decode(repeat('ab', 32), 'hex'),
       batch.owner || '/import/' || pg_temp.u(batch.suffix), 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
       batch.status, 'done', 1, 'WP-PRIVATE-RETENTION-SENTINEL ' || batch.suffix
from (values
  ('b001', pg_temp.usr('a1'), 'review'),
  ('b002', pg_temp.usr('a1'), 'review'),
  ('b003', pg_temp.usr('a1'), 'review'),
  ('b004', pg_temp.usr('b1'), 'review')) as batch(suffix, owner, status);
insert into public.import_items (id, user_id, batch_id, entity_type, ordinal, payload, source_excerpt, action)
select pg_temp.u('f' || batch.suffix), batch.owner, pg_temp.u(batch.suffix), 'skill', 0, '{"name":"SQL"}'::jsonb, 'SQL', 'create'
from (values ('b001', pg_temp.usr('a1')), ('b002', pg_temp.usr('a1')), ('b003', pg_temp.usr('a1')), ('b004', pg_temp.usr('b1'))) as batch(suffix, owner);

-- b001: idle 31 days (batch and item). b002: batch idle 31 days but an item edited yesterday. b003: idle 10 days. b004: another owner, idle 40 days.
select pg_temp.age(format($$ update public.import_batches set updated_at = now() - interval '31 days' where id = %L $$, pg_temp.u('b001')));
select pg_temp.age(format($$ update public.import_items set updated_at = now() - interval '31 days' where batch_id = %L $$, pg_temp.u('b001')));
select pg_temp.age(format($$ update public.import_batches set updated_at = now() - interval '31 days' where id = %L $$, pg_temp.u('b002')));
select pg_temp.age(format($$ update public.import_items set updated_at = now() - interval '1 day' where batch_id = %L $$, pg_temp.u('b002')));
select pg_temp.age(format($$ update public.import_batches set updated_at = now() - interval '10 days' where id = %L $$, pg_temp.u('b003')));
select pg_temp.age(format($$ update public.import_items set updated_at = now() - interval '10 days' where batch_id = %L $$, pg_temp.u('b003')));
select pg_temp.age(format($$ update public.import_batches set updated_at = now() - interval '40 days' where id = %L $$, pg_temp.u('b004')));
select pg_temp.age(format($$ update public.import_items set updated_at = now() - interval '40 days' where batch_id = %L $$, pg_temp.u('b004')));

select is(pg_temp.try('select public.expire_abandoned_import_reviews(0, 30)'), '22023|INVALID_IMPORT_HOUSEKEEPING', 'a zero limit is rejected');
select is(pg_temp.try('select public.expire_abandoned_import_reviews(100, 6)'), '22023|INVALID_IMPORT_HOUSEKEEPING', 'fewer than 7 idle days is rejected');
select is(pg_temp.try('select public.expire_abandoned_import_reviews(100, 366)'), '22023|INVALID_IMPORT_HOUSEKEEPING', 'more than 365 idle days is rejected');

select is(public.expire_abandoned_import_reviews(100, 30), 2, 'two review batches idle for 30 days or more are cancelled');
select is((select status from public.import_batches where id = pg_temp.u('b001')), 'cancelled', 'the idle batch is cancelled');
select ok((select cancelled_at is not null and expires_at is not null from public.import_batches where id = pg_temp.u('b001')),
  'the idle batch has cancelled_at and expires_at, like cancel_import_batch');
select is((select status from public.import_batches where id = pg_temp.u('b002')), 'review', 'a batch with a recently edited item is untouched');
select is((select status from public.import_batches where id = pg_temp.u('b003')), 'review', 'a batch idle for 10 days is untouched');
select is((select status from public.import_batches where id = pg_temp.u('b004')), 'cancelled', 'another owner''s idle batch is cancelled too');
select is(public.expire_abandoned_import_reviews(100, 30), 0, 'running the pass again changes nothing');
select is(public.expire_abandoned_import_reviews(100, 7), 1, 'a shorter idle window cancels the batch idle for 10 days');
select is((select status from public.import_batches where id = pg_temp.u('b003')), 'cancelled', 'the 10 day batch is cancelled with a 7 day window');

-- The existing T15 purge removes the file and the text.
select is(public.purge_expired_import_batches(100), 3, 'the existing purge handles the three cancelled batches');
select ok((select extracted_text is null and file_key is null and purged_at is not null from public.import_batches where id = pg_temp.u('b001')),
  'the purge removed the file key and the text');
select is((select count(*)::integer from public.import_items where batch_id = pg_temp.u('b001')), 0, 'the purge removed the staged items');
select is(
  (select count(*)::integer from internal.storage_jobs where object_key = pg_temp.usr('a1') || '/import/' || pg_temp.u('b001')),
  1, 'the import file key was queued for deletion'
);
select is((select status from public.import_batches where id = pg_temp.u('b002')), 'review', 'the untouched batch still has its review state after the purge');

-- 4. Export snapshots ---------------------------------------------------------------------------

create or replace function pg_temp.export_row(p_label text, p_status text, p_cv_revision integer, p_finished_ago interval, p_expires_in interval)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  if p_status = 'succeeded' then
    insert into public.cv_exports (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key, attempt_count, attempt_token,
                                   finished_at, object_key, page_count, byte_size, expires_at)
    values (v_id, pg_temp.usr('a1'), pg_temp.cv_id(), p_cv_revision, '{"title":"WP-PRIVATE-RETENTION-SENTINEL"}'::jsonb, 'succeeded', p_label, 1,
            gen_random_uuid(), now() - p_finished_ago, pg_temp.usr('a1') || '/export/' || v_id, 1, 100, now() + p_expires_in);
  else
    insert into public.cv_exports (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key, attempt_count, attempt_token,
                                   finished_at, error_code)
    values (v_id, pg_temp.usr('a1'), pg_temp.cv_id(), p_cv_revision, '{"title":"WP-PRIVATE-RETENTION-SENTINEL"}'::jsonb, 'failed', p_label, 1,
            gen_random_uuid(), now() - p_finished_ago, 'EXPORT_TIMEOUT');
  end if;
  return v_id;
end;
$$;

create temporary table pg_temp.ex as
  select 'ok_old'::text as label, pg_temp.export_row('ex-ok-old', 'succeeded', pg_temp.cv_rev(), interval '25 hours', interval '-1 hour') as id
  union all select 'ok_live', pg_temp.export_row('ex-ok-live', 'succeeded', pg_temp.cv_rev(), interval '1 hour', interval '23 hours')
  union all select 'fail_old', pg_temp.export_row('ex-fail-old', 'failed', pg_temp.cv_rev(), interval '25 hours', null)
  union all select 'fail_new', pg_temp.export_row('ex-fail-new', 'failed', pg_temp.cv_rev(), interval '1 hour', null);
create or replace function pg_temp.exid(p_label text) returns uuid language sql as $$ select id from pg_temp.ex where label = p_label $$;
create or replace function pg_temp.exr(p_label text) returns public.cv_exports language sql as $$
  select e from public.cv_exports as e where e.id = pg_temp.exid(p_label)
$$;

select is(pg_temp.try('select public.redact_cv_export_snapshots(0)'), '22023|INVALID_CV_EXPORT_HOUSEKEEPING', 'redaction rejects a zero limit');

select is(public.expire_cv_exports(100), 1, 'one succeeded export is past its expiry');
select ok((select snapshot = '{}'::jsonb and snapshot_purged_at is not null and purged_at is not null from pg_temp.exr('ok_old')),
  'expiry empties the snapshot and records both purge times');
select ok((select status = 'succeeded' and page_count = 1 and byte_size = 100 and cv_revision = pg_temp.cv_rev() and expires_at is not null
  from pg_temp.exr('ok_old')), 'the history row keeps its status, revision, page count and size');
select is((select snapshot ->> 'title' from pg_temp.exr('ok_live')), 'WP-PRIVATE-RETENTION-SENTINEL', 'an export that is not expired keeps its snapshot');
select is((select count(*)::integer from internal.storage_jobs where object_key = (pg_temp.exr('ok_old')).object_key), 1, 'the PDF object was queued for deletion');
select is(public.expire_cv_exports(100), 0, 'expiry is idempotent');

select is(public.redact_cv_export_snapshots(100), 1, 'one failed export is older than 24 hours');
select ok((select snapshot = '{}'::jsonb and snapshot_purged_at is not null and status = 'failed' and error_code = 'EXPORT_TIMEOUT'
  from pg_temp.exr('fail_old')), 'redaction empties the snapshot and keeps status and error code');
select is((select snapshot ->> 'title' from pg_temp.exr('fail_new')), 'WP-PRIVATE-RETENTION-SENTINEL', 'a failed export younger than 24 hours keeps its snapshot');
select is(public.redact_cv_export_snapshots(100), 0, 'redaction is idempotent');
select ok((select snapshot_purged_at is null from pg_temp.exr('ok_live')), 'a live succeeded export is not redacted');

-- Guard: the snapshot is immutable except for the single emptying transition.
select is(pg_temp.try(format($$ update public.cv_exports set snapshot = '{"x":1}'::jsonb where id = %L $$, pg_temp.exid('fail_new'))), 'P0001|CV_EXPORT_IMMUTABLE',
  'changing a snapshot to other content is still immutable');
select is(pg_temp.try(format($$ update public.cv_exports set snapshot = '{}'::jsonb where id = %L $$, pg_temp.exid('fail_new'))), 'P0001|CV_EXPORT_IMMUTABLE',
  'emptying a snapshot without recording the purge time is refused');
select is(pg_temp.try(format($$ update public.cv_exports set snapshot_purged_at = now() where id = %L $$, pg_temp.exid('fail_new'))), 'P0001|CV_EXPORT_IMMUTABLE',
  'setting the purge time without emptying the snapshot is refused');
select is(pg_temp.try(format($$ update public.cv_exports set snapshot = '{"back":1}'::jsonb, snapshot_purged_at = null where id = %L $$, pg_temp.exid('fail_old'))), 'P0001|CV_EXPORT_IMMUTABLE', 'an emptied snapshot cannot be refilled');
select is(pg_temp.try(format($$ update public.cv_exports set cv_revision = cv_revision + 1 where id = %L $$, pg_temp.exid('fail_new'))), 'P0001|CV_EXPORT_IMMUTABLE',
  'the other immutable columns are unchanged');
select is(pg_temp.try(format($$ update public.cv_exports set snapshot = '{}'::jsonb, snapshot_purged_at = now() where id = %L $$, pg_temp.exid('fail_new'))), 'ok',
  'the emptying transition itself is allowed');

-- 5. Guarded retry -------------------------------------------------------------------------------

-- A fresh failed export on the current revision, the stale one, the purged one, then a blocked CV.
create temporary table pg_temp.rx as
  select 'good'::text as label, pg_temp.export_row('rx-good', 'failed', pg_temp.cv_rev(), interval '1 hour', null) as id;
create or replace function pg_temp.rxid(p_label text) returns uuid language sql as $$ select id from pg_temp.rx where label = p_label $$;

select pg_temp.set_jwt_subject(pg_temp.usr('a1'));
-- Snapshot purged (the fail_old row): refused.
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', pg_temp.exid('fail_old'))), 'P0001|EXPORT_RETRY_UNAVAILABLE',
  'a retry of an export whose snapshot was emptied is refused');
-- Revision changed: bump the CV with a legal selection, then retry the older export.
insert into public.skills (id, user_id, name) values (pg_temp.u('5101'), pg_temp.usr('a1'), 'SQL');
select count(*) from public.select_cv_source(pg_temp.cv_rev(), 'skill', pg_temp.u('5101'));
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', pg_temp.rxid('good'))), 'P0001|EXPORT_RETRY_UNAVAILABLE',
  'a retry after the CV revision changed is refused');

-- Same revision, ready, snapshot present: the export bound to the current revision retries.
create temporary table pg_temp.rx2 as
  select 'current'::text as label, pg_temp.export_row('rx-current', 'failed', pg_temp.cv_rev(), interval '1 hour', null) as id;
create temporary table pg_temp.snap_before as select snapshot::text as s from public.cv_exports where id = (select id from pg_temp.rx2);
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.rx2))), 'ok', 'a retry on the same revision with a ready CV is accepted');
select is((select status || ',' || attempt_count from public.cv_exports where id = (select id from pg_temp.rx2)), 'queued,1', 'the export is queued again with the same attempt count');
select is((select snapshot::text from public.cv_exports where id = (select id from pg_temp.rx2)), (select s from pg_temp.snap_before), 'the retry keeps the same snapshot');

-- A blocked CV refuses the retry. Make the export failed again, then block the CV.
select pg_temp.set_jwt_subject(null);
select pg_temp.age(format($$ update public.cv_exports set status = 'failed', attempt_token = gen_random_uuid(), finished_at = now(), error_code = 'EXPORT_TIMEOUT' where id = %L $$, (select id from pg_temp.rx2)));
update public.cv_documents
set profile_snapshot = profile_snapshot - 'display_name' - 'display_overrides'
where user_id = pg_temp.usr('a1');
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.rx2))), 'P0001|EXPORT_RETRY_UNAVAILABLE',
  'a retry while the CV has an export blocker is refused');
select is((select status from public.cv_exports where id = (select id from pg_temp.rx2)), 'failed', 'a refused retry leaves the export failed');

select pg_temp.set_jwt_subject(pg_temp.usr('b1'));
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.rx2))), 'P0001|CV_EXPORT_NOT_FOUND',
  'another account cannot retry the export');

select * from finish();
rollback;

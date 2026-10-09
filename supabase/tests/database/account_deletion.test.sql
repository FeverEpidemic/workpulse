begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T23 account deletion backend (PRD R01, Privacy and safety: Deletion, DB section 4 and 6, decision 0029).
-- Account rows are written as the test owner; user RPCs run with a JWT subject; worker RPCs are called directly
-- (they are security definer and granted to service_role only).

-- 1. Structure and privileges -------------------------------------------------

select ok(
  (select count(*) from pg_catalog.pg_trigger
    where tgname = 'zz_guard_account_writable' and not tgisinternal
      and tgrelid in (select c.oid from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace)) =
  (select count(*) from information_schema.columns c
     join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE') + 1,
  'every public table with a user_id column, and profiles, carries the zz_guard_account_writable trigger'
);
select is(
  (select count(*)::integer from information_schema.columns c
     join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
      and not exists (select 1 from pg_catalog.pg_trigger g
        where g.tgrelid = format('public.%I', c.table_name)::regclass and g.tgname = 'zz_guard_account_writable' and not g.tgisinternal)),
  0, 'no public table that has a user_id column is missing the write guard'
);
select ok(
  (select tgtype & 1 = 1 and tgtype & 2 = 2 and tgtype & 4 = 4 and tgtype & 8 = 8 and tgtype & 16 = 16
   from pg_catalog.pg_trigger where tgrelid = 'public.activities'::regclass and tgname = 'zz_guard_account_writable'),
  'the guard is a row-level BEFORE INSERT OR DELETE OR UPDATE trigger'
);
select ok(
  to_regclass('internal.account_deletions') is not null
  and not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'internal.account_deletions'::regclass and contype = 'f')
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'internal.account_deletions'::regclass),
  'internal.account_deletions exists, has RLS and no foreign key'
);
select ok(
  not has_table_privilege('anon', 'internal.account_deletions', 'SELECT')
  and not has_table_privilege('authenticated', 'internal.account_deletions', 'SELECT')
  and not has_table_privilege('service_role', 'internal.account_deletions', 'SELECT')
  and not has_table_privilege('service_role', 'internal.account_deletions', 'INSERT')
  and not has_table_privilege('service_role', 'internal.account_deletions', 'UPDATE')
  and not has_table_privilege('service_role', 'internal.account_deletions', 'DELETE'),
  'no API role has any table privilege on the deletion receipts'
);
select ok(
  (select count(to_regprocedure(sig)) from unnest(array[
    'public.begin_account_deletion(uuid)', 'public.get_account_deletion_preview()', 'public.claim_account_deletion_jobs(integer)',
    'public.purge_account_data(uuid,uuid)', 'public.mark_account_auth_deleted(uuid,uuid)',
    'public.retry_account_deletion_job(uuid,uuid,text,timestamptz)', 'public.verify_account_purges(integer)',
    'public.prune_account_deletion_receipts(integer)', 'public.get_account_deletion_backlog()',
    'internal.guard_account_writable()']) as sigs(sig)) = 10
  and (select bool_and((select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure(sig))) from unnest(array[
    'public.begin_account_deletion(uuid)', 'public.get_account_deletion_preview()', 'public.claim_account_deletion_jobs(integer)',
    'public.purge_account_data(uuid,uuid)', 'public.mark_account_auth_deleted(uuid,uuid)',
    'public.retry_account_deletion_job(uuid,uuid,text,timestamptz)', 'public.verify_account_purges(integer)',
    'public.prune_account_deletion_receipts(integer)', 'public.get_account_deletion_backlog()',
    'internal.guard_account_writable()']) as sigs(sig)),
  'the ten T23 functions exist and are security definer'
);
select ok(
  (select bool_and(has_function_privilege('service_role', sig, 'EXECUTE')
      and not has_function_privilege('anon', sig, 'EXECUTE')
      and not has_function_privilege('authenticated', sig, 'EXECUTE'))
   from unnest(array['public.begin_account_deletion(uuid)', 'public.claim_account_deletion_jobs(integer)',
     'public.purge_account_data(uuid,uuid)', 'public.mark_account_auth_deleted(uuid,uuid)',
     'public.retry_account_deletion_job(uuid,uuid,text,timestamptz)', 'public.verify_account_purges(integer)',
     'public.prune_account_deletion_receipts(integer)', 'public.get_account_deletion_backlog()']) as sigs(sig)),
  'the eight deletion worker RPCs are executable by service_role only'
);
select ok(
  has_function_privilege('authenticated', 'public.get_account_deletion_preview()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_account_deletion_preview()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_account_deletion_preview()', 'EXECUTE'),
  'the preview is executable by authenticated only'
);
select ok(
  not has_function_privilege('anon', 'internal.guard_account_writable()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.guard_account_writable()', 'EXECUTE')
  and not has_function_privilege('service_role', 'internal.guard_account_writable()', 'EXECUTE'),
  'the guard function has no API-role grant'
);

-- 2. Fixtures -------------------------------------------------------------------

create or replace function pg_temp.usr(p_suffix text) returns uuid language sql as $$
  select ('a2300000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;
create or replace function pg_temp.u(p_suffix text) returns uuid language sql as $$
  select ('a2310000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select pg_temp.usr(suffix), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'acd-' || suffix || '@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values ('da'), ('db'), ('dc'), ('de')) as users(suffix);

update public.profiles set display_name = 'Ani Hapus', locale = 'id', onboarding_completed_at = now() where id = pg_temp.usr('da');
update public.profiles set display_name = 'Budi Tetap', onboarding_completed_at = now() where id in (pg_temp.usr('db'), pg_temp.usr('dc'));

update public.profiles set deleting_at = now() where id = pg_temp.usr('de');

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
-- True when the statement fails with SQLSTATE 42501 and a deleting-account style message.
create or replace function pg_temp.denied(p_sql text) returns boolean language sql as $$
  select pg_temp.try(p_sql) in ('42501|ACCOUNT_DELETING', '42501|AUTH_REQUIRED')
$$;

-- Owner A (deleted later): a full set of rows in every table.
insert into public.experiences (id, user_id, organization, role_title, kind, description) values
  (pg_temp.u('e001'), pg_temp.usr('da'), 'Org Contoh', 'Engineer', 'employment', 'Deskripsi');
insert into public.projects (id, user_id, experience_id, title, description, user_role, outcome, status) values
  (pg_temp.u('b001'), pg_temp.usr('da'), pg_temp.u('e001'), 'Proyek Rahasia', 'Deskripsi', 'Peneliti', 'Lulus', 'completed');
insert into public.activities (id, user_id, raw_text, occurred_on, capture_mode) values
  (pg_temp.u('a001'), pg_temp.usr('da'), 'WP-PRIVATE-ACCOUNT-SENTINEL aktivitas', current_date, 'chat');
insert into public.achievements (id, user_id, experience_id, project_id, title, contribution, scope, outcome, cv_bullet, achieved_on, status) values
  (pg_temp.u('c001'), pg_temp.usr('da'), pg_temp.u('e001'), pg_temp.u('b001'), 'Capaian', 'Kontribusi', 'Lingkup', 'Hasil', 'Bullet', '2023-05-10', 'confirmed');
insert into public.education (id, user_id, institution, qualification, field_of_study) values
  (pg_temp.u('d001'), pg_temp.usr('da'), 'Universitas Contoh', 'S1', 'Informatika');
insert into public.skills (id, user_id, name) values (pg_temp.u('f001'), pg_temp.usr('da'), 'SQL');
insert into public.certifications (id, user_id, name) values
  (pg_temp.u('a0c1'), pg_temp.usr('da'), 'Sertifikat'),
  (pg_temp.u('a0c2'), pg_temp.usr('da'), 'Sertifikat Belum Dipilih');
insert into public.achievement_skills (user_id, achievement_id, skill_id) values (pg_temp.usr('da'), pg_temp.u('c001'), pg_temp.u('f001'));
insert into public.chat_messages (user_id, activity_id, role, content, sequence_no) values
  (pg_temp.usr('da'), pg_temp.u('a001'), 'user', 'WP-PRIVATE-ACCOUNT-SENTINEL chat', 1);

-- Other owners keep their own rows.
insert into public.education (id, user_id, institution, qualification) values
  (pg_temp.u('bd01'), pg_temp.usr('db'), 'B Uni', 'S1'),
  (pg_temp.u('cd01'), pg_temp.usr('dc'), 'C Uni', 'S1');

select pg_temp.set_jwt_subject(pg_temp.usr('da'));
select count(*) from public.ensure_cv_document();
select count(*) from public.select_cv_source(1, 'experience', pg_temp.u('e001'));
select count(*) from public.select_cv_source(2, 'project', pg_temp.u('b001'));
select count(*) from public.select_cv_source(3, 'achievement', pg_temp.u('c001'));
select count(*) from public.select_cv_source(4, 'education', pg_temp.u('d001'));
select count(*) from public.select_cv_source(5, 'skill', pg_temp.u('f001'));
select count(*) from public.select_cv_source(6, 'certification', pg_temp.u('a0c1'));
select pg_temp.set_jwt_subject(pg_temp.usr('db'));
select count(*) from public.ensure_cv_document();
select count(*) from public.select_cv_source(1, 'education', pg_temp.u('bd01'));
select pg_temp.set_jwt_subject(null);

insert into public.cv_exports (user_id, cv_id, cv_revision, snapshot, status, idempotency_key)
select user_id, id, revision, '{"title":"WP-PRIVATE-ACCOUNT-SENTINEL"}'::jsonb, 'queued', 'acd-queued' from public.cv_documents where user_id = pg_temp.usr('da');

insert into public.evidence_files (id, user_id, activity_id, object_key, original_name, mime_type, bytes, status, reserved_until, parent_revision, idempotency_key, payload_hash)
values (pg_temp.u('e0e1'), pg_temp.usr('da'), pg_temp.u('a001'), pg_temp.usr('da') || '/evidence/' || pg_temp.u('e0e1'),
  'rahasia.pdf', 'application/pdf', 10, 'uploading', now() + interval '1 hour', 1, gen_random_uuid(), decode(repeat('ab', 32), 'hex'));
insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256)
values (pg_temp.u('b0b1'), pg_temp.usr('da'), gen_random_uuid(), decode(repeat('ab', 32), 'hex'),
  pg_temp.usr('da') || '/import/' || pg_temp.u('b0b1'), 'cv.pdf', 'application/pdf', 10, repeat('a', 64));
insert into public.ai_jobs (user_id, kind, activity_id, input_revision, idempotency_key, payload_hash, consent_version)
values (pg_temp.usr('da'), 'detect', pg_temp.u('a001'), 1, 'detect:' || pg_temp.u('a001')::text || ':r1', decode(repeat('00', 32), 'hex'), 'ai-processing-v1');

-- Storage objects: one per known row, one for an exported PDF, one orphan, one non-canonical, one for another owner.
insert into storage.objects (bucket_id, name, created_at) values
  ('workpulse-private', pg_temp.usr('da') || '/evidence/' || pg_temp.u('e0e1'), now() - interval '2 hours'),
  ('workpulse-private', pg_temp.usr('da') || '/import/' || pg_temp.u('b0b1'), now() - interval '2 hours'),
  ('workpulse-private', pg_temp.usr('da') || '/export/' || pg_temp.u('ee01'), now() - interval '2 hours'),
  ('workpulse-private', pg_temp.usr('da') || '/evidence/' || pg_temp.u('0a01'), now() - interval '2 hours'),
  ('workpulse-private', pg_temp.usr('db') || '/evidence/' || pg_temp.u('0b01'), now() - interval '2 hours');

-- Other owner storage job that must survive.
select internal.enqueue_storage_delete(pg_temp.usr('db'), pg_temp.usr('db') || '/evidence/' || pg_temp.u('0b01'));

create temporary table pg_temp.counts_b as
  select (select count(*) from public.education where user_id = pg_temp.usr('db')) as education,
         (select count(*) from public.cv_items where user_id = pg_temp.usr('db')) as items,
         (select count(*) from internal.storage_jobs where user_id = pg_temp.usr('db')) as jobs;

-- 3. Begin -----------------------------------------------------------------------------------------

select is(pg_temp.try($$ select * from public.begin_account_deletion(null) $$), '22023|INVALID_ACCOUNT_DELETION',
  'begin rejects a null user id');
select is(pg_temp.try(format('select * from public.begin_account_deletion(%L)', gen_random_uuid())), 'P0002|ACCOUNT_NOT_FOUND',
  'begin rejects an unknown user');
select ok((select deleting_at is null from public.profiles where id = pg_temp.usr('da')), 'the profile is active before begin');

create temporary table pg_temp.begin1 as select * from public.begin_account_deletion(pg_temp.usr('da'));
select is((select already_requested from pg_temp.begin1), false, 'the first begin creates the request');
select ok((select deleting_at is not null from public.profiles where id = pg_temp.usr('da')), 'begin marks the profile deleting');
select is(
  (select status || ',' || (requested_at is not null)::text || ',' || attempt_count from internal.account_deletions where user_id = pg_temp.usr('da')),
  'queued,true,0', 'begin creates a queued receipt'
);
create temporary table pg_temp.begin2 as select * from public.begin_account_deletion(pg_temp.usr('da'));
select is((select already_requested from pg_temp.begin2), true, 'the second begin reports the existing request');
select is((select requested_at from pg_temp.begin2), (select requested_at from pg_temp.begin1), 'the second begin returns the same request time');
select is((select count(*)::integer from internal.account_deletions where user_id = pg_temp.usr('da')), 1, 'only one receipt exists');

-- Grants: direct calls through user roles fail.
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.usr('db'));
select is(pg_temp.try(format('select * from public.begin_account_deletion(%L)', pg_temp.usr('dc'))), '42501|permission denied for function begin_account_deletion',
  'authenticated cannot call begin_account_deletion, for itself or another account');
select is(pg_temp.try('select * from public.get_account_deletion_backlog()'), '42501|permission denied for function get_account_deletion_backlog',
  'authenticated cannot read the backlog');
reset role;
set local role anon;
select is(pg_temp.try('select * from public.get_account_deletion_preview()'), '42501|permission denied for function get_account_deletion_preview',
  'anon cannot read the preview');
reset role;
select ok((select deleting_at is null from public.profiles where id = pg_temp.usr('dc')), 'the other account was not marked');

-- 4. Guard ------------------------------------------------------------------------------------------

-- User requests run as the database role authenticated, exactly as PostgREST runs them.
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.usr('da'));
select ok(pg_temp.denied(format($$ select * from public.update_profile(%s, '{"headline":"x"}'::jsonb) $$, (select revision from public.profiles where id = pg_temp.usr('da')))), 'profile updates are rejected for a deleting account');
select pg_temp.set_jwt_subject(pg_temp.usr('de'));
select ok(pg_temp.denied(format($$ select * from public.complete_onboarding('Nama', 'id', 'Asia/Jakarta', %s) $$, (select revision from public.profiles where id = pg_temp.usr('de')))), 'onboarding is rejected for a deleting account');
select pg_temp.set_jwt_subject(pg_temp.usr('da'));
select ok(pg_temp.denied(format($$ select * from public.create_education_idempotent(%L, 'Inst', 'S1', null, null, null, null, null, null, false) $$, gen_random_uuid())),
  'foundation creation is rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.update_education(%L, 1, '{"institution":"Baru"}'::jsonb) $$, pg_temp.u('d001'))),
  'foundation updates are rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.delete_experience(%L, 1) $$, pg_temp.u('e001'))), 'foundation deletes are rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.create_activity_idempotent(%L, 'Teks', current_date, 'note', null, null, null, null, null) $$, gen_random_uuid())),
  'activity creation is rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.update_activity(%L, 1, '{"raw_text":"baru"}'::jsonb) $$, pg_temp.u('a001'))),
  'activity updates are rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.create_project_idempotent(%L, 'Proyek', null, null, null, 'ongoing', null, null, null, null, false, null) $$, gen_random_uuid())),
  'project creation is rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.save_achievement(%L, 1, 'save_changes', '{}'::jsonb, null) $$, pg_temp.u('c001'))),
  'achievement saves are rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.begin_import_batch(%L, 'cv.pdf', 10, 'application/pdf', %L) $$, gen_random_uuid(), repeat('a', 64))),
  'starting an import is rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.request_ai_analysis(%L, 1) $$, pg_temp.u('a001'))), 'AI analysis requests are rejected for a deleting account');
select ok(pg_temp.denied($$ select * from public.set_ai_consent(1, true) $$), 'AI consent changes are rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.select_cv_source(%s, 'certification', %L) $$, (select revision from public.cv_documents where user_id = pg_temp.usr('da')), pg_temp.u('a0c2'))), 'CV selection is rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.save_cv_edits(%s, '{"item_overrides":[]}'::jsonb) $$, (select revision from public.cv_documents where user_id = pg_temp.usr('da')))), 'CV edits are rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.request_cv_export(%s, 'key-deleting') $$, (select revision from public.cv_documents where user_id = pg_temp.usr('da')))), 'CV export requests are rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.retry_cv_export(%L) $$, gen_random_uuid())), 'CV export retries are rejected for a deleting account');
select ok(pg_temp.denied(format($$ select * from public.get_cv_export_download(%L) $$, gen_random_uuid())), 'export downloads are refused for a deleting account');
select ok(pg_temp.denied($$ select * from public.get_account_deletion_preview() $$), 'the preview is refused for a deleting account');
-- The trigger itself: update_skill has no deleting check of its own, so the guard produces the stable code.
select is(pg_temp.try(format($$ select * from public.update_skill(%L, 1, '{"name":"SQL baru"}'::jsonb) $$, pg_temp.u('f001'))), '42501|ACCOUNT_DELETING',
  'a write by the deleting user fails with ACCOUNT_DELETING from the guard');
select pg_temp.set_jwt_subject(pg_temp.usr('db'));
select is(pg_temp.try(format($$ select * from public.create_skill_idempotent(%L, 'Lainnya') $$, gen_random_uuid())), 'ok',
  'another account can still write');
select pg_temp.set_jwt_subject(pg_temp.usr('dc'));
select is(pg_temp.try(format($$ select * from public.update_profile(%s, '{"headline":"ok"}'::jsonb) $$, (select revision from public.profiles where id = pg_temp.usr('dc')))), 'ok', 'a non-deleting account can update its profile');
reset role;
-- A session that is not the authenticated role (owner, service role) is not guarded, even with a stale user claim.
select pg_temp.set_jwt_subject(pg_temp.usr('da'));
select is(pg_temp.try(format($$ update public.profiles set headline = 'stale claim' where id = %L $$, pg_temp.usr('da'))), 'ok',
  'an owner session holding a deleting user claim is not guarded');
set local role service_role;
select is(pg_temp.try(format($$ update public.profiles set headline = 'service role' where id = %L $$, pg_temp.usr('da'))), 'ok',
  'the service_role database role is not guarded');
reset role;
select pg_temp.set_jwt_subject(null);
-- Service role (no auth.uid()) is not affected.
select is(pg_temp.try(format($$ update public.profiles set headline = 'dari service' where id = %L $$, pg_temp.usr('da'))), 'ok',
  'a write without a JWT subject (service role, worker, purge) is not guarded');
-- The NULL to value transition on profiles is legal for an active account written without JWT.
select is(pg_temp.try(format($$ update public.profiles set deleting_at = now() where id = %L $$, pg_temp.usr('dc'))), 'ok',
  'marking an active profile deleting is legal');
update public.profiles set deleting_at = null where id = pg_temp.usr('dc');

-- 5. Claim, lease and CAS -----------------------------------------------------------------------

select is(pg_temp.try('select * from public.claim_account_deletion_jobs(0)'), '22023|INVALID_ACCOUNT_DELETION_CLAIM', 'claim rejects a zero limit');
create temporary table pg_temp.claim1 as select * from public.claim_account_deletion_jobs(5);
select is((select count(*)::integer from pg_temp.claim1 where user_id = pg_temp.usr('da')), 1, 'the queued receipt is claimed');
select is((select attempt_count from pg_temp.claim1 where user_id = pg_temp.usr('da')), 1, 'the claim counts the attempt');
select is((select count(*)::integer from public.claim_account_deletion_jobs(5) where user_id = pg_temp.usr('da')), 0, 'a live lease is not claimed twice');
select is(
  (select status from internal.account_deletions where user_id = pg_temp.usr('da')), 'running', 'the receipt is running while claimed'
);
select is(pg_temp.try(format('select public.purge_account_data(%L, %L)', pg_temp.usr('da'), gen_random_uuid())), 'P0001|ACCOUNT_PURGE_LEASE_LOST',
  'a wrong attempt token cannot purge');
select is((select count(*)::integer from public.education where user_id = pg_temp.usr('da')), 1, 'a refused purge deleted nothing');

-- Expire the lease: the receipt is claimable again and the old token is dead.
update internal.account_deletions set lease_expires_at = now() - interval '1 second' where user_id = pg_temp.usr('da');
create temporary table pg_temp.old_token as select attempt_token as token from pg_temp.claim1 where user_id = pg_temp.usr('da');
create temporary table pg_temp.claim2 as select * from public.claim_account_deletion_jobs(5);
select is((select attempt_count from pg_temp.claim2 where user_id = pg_temp.usr('da')), 2, 'an expired lease is claimed again with a new attempt');
select isnt((select attempt_token from pg_temp.claim2 where user_id = pg_temp.usr('da')), (select token from pg_temp.old_token), 'the new claim has a fresh token');
select is(pg_temp.try(format('select public.purge_account_data(%L, %L)', pg_temp.usr('da'), (select token from pg_temp.old_token))), 'P0001|ACCOUNT_PURGE_LEASE_LOST',
  'the old token cannot purge after a re-claim');
select is(public.mark_account_auth_deleted(pg_temp.usr('da'), (select token from pg_temp.old_token)), false, 'the old token cannot mark Auth deleted');
select is(public.retry_account_deletion_job(pg_temp.usr('da'), (select token from pg_temp.old_token), 'AUTH_DELETE_FAILED', now()), false,
  'the old token cannot retry the receipt');
select is(pg_temp.try(format($$ select public.retry_account_deletion_job(%L, %L, 'bad code', now()) $$, pg_temp.usr('da'), gen_random_uuid())),
  '22023|INVALID_ACCOUNT_DELETION_RETRY', 'retry rejects a non-allowlisted error code');
select is(public.mark_account_auth_deleted(pg_temp.usr('da'), (select attempt_token from pg_temp.claim2 where user_id = pg_temp.usr('da'))), false,
  'Auth cannot be marked deleted before the rows are purged');

-- 6. Purge ------------------------------------------------------------------------------------------

select is((select count(*)::integer from internal.storage_jobs where user_id = pg_temp.usr('da')), 0, 'no storage job exists before the purge');

create temporary table pg_temp.purge1 as
  select public.purge_account_data(pg_temp.usr('da'), (select attempt_token from pg_temp.claim2 where user_id = pg_temp.usr('da'))) as enqueued;
select is((select enqueued from pg_temp.purge1), 4, 'purge queued the four distinct keys: evidence, import, orphan and export object');

select is(
  (select count(*)::integer from internal.storage_jobs where user_id = pg_temp.usr('da') and object_key in (
    pg_temp.usr('da') || '/evidence/' || pg_temp.u('e0e1'), pg_temp.usr('da') || '/import/' || pg_temp.u('b0b1'))),
  2, 'the evidence and import keys of known rows were queued'
);
select is(
  (select count(*)::integer from internal.storage_jobs where user_id = pg_temp.usr('da') and object_key = pg_temp.usr('da') || '/evidence/' || pg_temp.u('0a01')),
  1, 'an orphan object with no row was queued from the storage prefix'
);
select is(
  (select count(*)::integer from internal.storage_jobs where user_id = pg_temp.usr('da') and object_key = pg_temp.usr('da') || '/export/' || pg_temp.u('ee01')),
  1, 'an export object with no live row was queued from the storage prefix'
);
select is(
  (select count(*)::integer from internal.storage_jobs where user_id = pg_temp.usr('da') and status in ('queued', 'running')),
  (select count(*)::integer from internal.storage_jobs where user_id = pg_temp.usr('da')), 'every job for the account is queued'
);

select is(
  (select sum(c)::integer from (
    select count(*) as c from public.achievement_skills where user_id = pg_temp.usr('da')
    union all select count(*) from public.achievements where user_id = pg_temp.usr('da')
    union all select count(*) from public.activities where user_id = pg_temp.usr('da')
    union all select count(*) from public.ai_jobs where user_id = pg_temp.usr('da')
    union all select count(*) from public.ai_suggestion_reviews where user_id = pg_temp.usr('da')
    union all select count(*) from public.certifications where user_id = pg_temp.usr('da')
    union all select count(*) from public.chat_messages where user_id = pg_temp.usr('da')
    union all select count(*) from public.cv_documents where user_id = pg_temp.usr('da')
    union all select count(*) from public.cv_exports where user_id = pg_temp.usr('da')
    union all select count(*) from public.cv_items where user_id = pg_temp.usr('da')
    union all select count(*) from public.education where user_id = pg_temp.usr('da')
    union all select count(*) from public.evidence_files where user_id = pg_temp.usr('da')
    union all select count(*) from public.experiences where user_id = pg_temp.usr('da')
    union all select count(*) from public.import_batches where user_id = pg_temp.usr('da')
    union all select count(*) from public.import_items where user_id = pg_temp.usr('da')
    union all select count(*) from public.projects where user_id = pg_temp.usr('da')
    union all select count(*) from public.skills where user_id = pg_temp.usr('da')
    union all select count(*) from internal.operation_requests where user_id = pg_temp.usr('da')
    union all select count(*) from internal.evidence_scan_jobs where user_id = pg_temp.usr('da')
    union all select count(*) from internal.evidence_reservation_requests where user_id = pg_temp.usr('da')
    union all select count(*) from internal.import_jobs where user_id = pg_temp.usr('da')) as counts),
  0, 'every table that holds a user_id row is empty after the purge'
);
select is((select count(*)::integer from public.profiles where id = pg_temp.usr('da')), 1, 'the profile stays as a tombstone');
select ok((select deleting_at is not null from public.profiles where id = pg_temp.usr('da')), 'the tombstone is still marked deleting');
select ok((select rows_purged_at is not null and objects_enqueued_at is not null and status = 'running'
  from internal.account_deletions where user_id = pg_temp.usr('da')), 'the receipt records the purge time');
select ok((select enqueued >= 0 from pg_temp.purge1), 'purge returns a count');
select ok(
  public.purge_account_data(pg_temp.usr('da'), (select attempt_token from pg_temp.claim2 where user_id = pg_temp.usr('da'))) >= 0,
  'a repeated purge is idempotent and does not fail'
);

-- Another owner is untouched.
select is((select education from pg_temp.counts_b), (select count(*) from public.education where user_id = pg_temp.usr('db')),
  'another account keeps its education');
select is((select items from pg_temp.counts_b), (select count(*) from public.cv_items where user_id = pg_temp.usr('db')),
  'another account keeps its CV items');
select is((select jobs from pg_temp.counts_b), (select count(*) from internal.storage_jobs where user_id = pg_temp.usr('db')),
  'another account keeps its storage jobs');
select is((select count(*)::integer from internal.storage_jobs where user_id = pg_temp.usr('db') and status = 'queued'), 1,
  'the other account job is still queued');

-- 7. Auth delete, verify, backlog, prune --------------------------------------------------------

select is(public.verify_account_purges(100), 0, 'verify does not complete a receipt that is not purged yet');
select is(
  public.mark_account_auth_deleted(pg_temp.usr('da'), (select attempt_token from pg_temp.claim2 where user_id = pg_temp.usr('da'))), true,
  'the current token marks Auth deleted after the purge'
);
select is((select status from internal.account_deletions where user_id = pg_temp.usr('da')), 'purged', 'the receipt is purged');
select ok((select auth_deleted_at is not null and attempt_token is null and lease_expires_at is null
  from internal.account_deletions where user_id = pg_temp.usr('da')), 'the lease is released');
select is(public.verify_account_purges(100), 0, 'verify holds the receipt while storage objects and jobs remain');
select is((select status from internal.account_deletions where user_id = pg_temp.usr('da')), 'purged', 'the receipt stays purged until cleanup finishes');
select is((select pending from public.get_account_deletion_backlog()), 1, 'the backlog counts the pending deletion');
select is((select overdue from public.get_account_deletion_backlog()), 0, 'a fresh deletion is not overdue');
update internal.account_deletions set requested_at = now() - interval '25 hours' where user_id = pg_temp.usr('da');
select is((select overdue from public.get_account_deletion_backlog()), 1, 'a deletion older than 24 hours is overdue');

-- Cleanup finishes: delete the storage objects and succeed the jobs.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'workpulse-private' and name like pg_temp.usr('da')::text || '/%';
update internal.storage_jobs
set status = 'running', attempt_count = 1, attempt_token = gen_random_uuid(), lease_expires_at = now() + interval '1 minute'
where user_id = pg_temp.usr('da');
update internal.storage_jobs
set status = 'failed', lease_expires_at = null, finished_at = now(), error_code = 'STORAGE_UNAVAILABLE'
where user_id = pg_temp.usr('da') and object_key like '%/export/%';
update internal.storage_jobs
set status = 'succeeded', lease_expires_at = null, finished_at = now(), error_code = null
where user_id = pg_temp.usr('da') and status = 'running';
select is(public.verify_account_purges(100), 0, 'a failed cleanup job still blocks completion');
update internal.storage_jobs set status = 'succeeded', finished_at = now(), error_code = null where user_id = pg_temp.usr('da');
select is(public.verify_account_purges(100), 1, 'verify completes the receipt once nothing is left');
select ok((select status = 'completed' and completed_at is not null and requested_at is not null and rows_purged_at is not null and auth_deleted_at is not null
  from internal.account_deletions where user_id = pg_temp.usr('da')), 'a completed receipt carries all four timestamps');
select is((select pending from public.get_account_deletion_backlog()), 0, 'a completed deletion leaves the backlog');

select is(public.prune_account_deletion_receipts(100), 0, 'a recent completed receipt is kept');
update internal.account_deletions set completed_at = now() - interval '31 days', requested_at = now() - interval '32 days' where user_id = pg_temp.usr('da');
select is(public.prune_account_deletion_receipts(100), 1, 'a completed receipt older than 30 days is pruned');
select is((select count(*)::integer from internal.account_deletions where user_id = pg_temp.usr('da')), 0, 'the pruned receipt is gone');
select is(pg_temp.try('select public.verify_account_purges(0)'), '22023|INVALID_ACCOUNT_DELETION_HOUSEKEEPING', 'housekeeping rejects a zero limit');

-- 8. Queue survives the foreign keys ------------------------------------------------------------

select public.begin_account_deletion(pg_temp.usr('dc'));
select internal.enqueue_storage_delete(pg_temp.usr('dc'), pg_temp.usr('dc') || '/evidence/' || pg_temp.u('0c01'));
delete from auth.users where id = pg_temp.usr('dc');
select is((select count(*)::integer from public.profiles where id = pg_temp.usr('dc')), 0, 'deleting the Auth user removes the profile');
select is((select count(*)::integer from internal.storage_jobs where user_id = pg_temp.usr('dc')), 1, 'the storage job outlives the Auth user and the profile');
select is((select count(*)::integer from internal.account_deletions where user_id = pg_temp.usr('dc')), 1, 'the deletion receipt outlives the Auth user and the profile');
create temporary table pg_temp.claim3 as select * from public.claim_account_deletion_jobs(5);
select is((select count(*)::integer from pg_temp.claim3 where user_id = pg_temp.usr('dc')), 1, 'the surviving receipt is still claimable');
select is(
  public.purge_account_data(pg_temp.usr('dc'), (select attempt_token from pg_temp.claim3 where user_id = pg_temp.usr('dc'))) >= 0, true,
  'purging after the Auth user is gone is a successful no-op'
);

-- 9. Rollback on failure ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (pg_temp.usr('dd'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acd-dd@workpulse.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
update public.profiles set display_name = 'Dede', onboarding_completed_at = now() where id = pg_temp.usr('dd');
insert into public.skills (id, user_id, name) values (pg_temp.u('5d01'), pg_temp.usr('dd'), 'Rollback');
insert into public.education (id, user_id, institution, qualification) values (pg_temp.u('ed02'), pg_temp.usr('dd'), 'Uni', 'S1');
select public.begin_account_deletion(pg_temp.usr('dd'));
create temporary table pg_temp.claim4 as select * from public.claim_account_deletion_jobs(5);
-- A blocking trigger on a late table forces the DELETE sequence to fail after earlier tables were already deleted.
create or replace function pg_temp.fail_delete() returns trigger language plpgsql as $$
begin raise exception using errcode = 'P0001', message = 'FORCED_FAILURE'; end;
$$;
create trigger zz_force_failure before delete on public.education for each row execute function pg_temp.fail_delete();
select is(pg_temp.try(format('select public.purge_account_data(%L, %L)', pg_temp.usr('dd'), (select attempt_token from pg_temp.claim4 where user_id = pg_temp.usr('dd')))),
  'P0001|FORCED_FAILURE', 'a failure in the middle of the purge propagates');
drop trigger zz_force_failure on public.education;
select is((select count(*)::integer from public.skills where user_id = pg_temp.usr('dd')), 1, 'a failed purge rolled back earlier deletions (skills)');
select is((select count(*)::integer from public.education where user_id = pg_temp.usr('dd')), 1, 'a failed purge rolled back earlier deletions (education)');
select is((select rows_purged_at is null from internal.account_deletions where user_id = pg_temp.usr('dd')), true, 'a failed purge leaves no purge timestamp');

select * from finish();
rollback;

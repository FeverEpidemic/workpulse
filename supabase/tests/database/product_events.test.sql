begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T24 product events, pilot cohort and pilot metrics (PRD section 4 Performance targets and section 5 Pilot measures,
-- decision 0030). Domain rows are written through the real RPCs with a JWT subject; fixture rows that no RPC creates
-- (import staging, export jobs, back-dated metric events) are written as the test owner.

-- 1. Structure and privileges -------------------------------------------------

select ok(
  to_regclass('internal.product_events') is not null
  and to_regclass('internal.product_event_epoch') is not null
  and to_regclass('internal.pilot_participants') is not null,
  'the three T24 tables exist in the internal schema'
);
select ok(
  (select count(*) = 3 and bool_and(relrowsecurity) from pg_catalog.pg_class
    where oid in (to_regclass('internal.product_events'), to_regclass('internal.product_event_epoch'),
                  to_regclass('internal.pilot_participants'))),
  'row level security is enabled on all three tables'
);
select ok(
  (select bool_and(not has_table_privilege(r.role_name, t.table_name, p.privilege))
   from (values ('anon'), ('authenticated'), ('service_role')) as r(role_name),
        (values ('internal.product_events'), ('internal.product_event_epoch'), ('internal.pilot_participants')) as t(table_name),
        (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(privilege)),
  'no API role holds any table privilege on the T24 tables'
);
select ok(
  not has_sequence_privilege('anon', 'internal.product_events_id_seq', 'USAGE')
  and not has_sequence_privilege('authenticated', 'internal.product_events_id_seq', 'USAGE')
  and not has_sequence_privilege('service_role', 'internal.product_events_id_seq', 'USAGE'),
  'no API role can use the event sequence'
);
select ok(
  (select count(*) = 2 and bool_and(con.confdeltype = 'c' and con.confrelid = 'public.profiles'::regclass)
   from pg_catalog.pg_constraint as con
   where con.contype = 'f'
     and con.conrelid in (to_regclass('internal.product_events'), to_regclass('internal.pilot_participants'))),
  'events and participants reference profiles with ON DELETE CASCADE'
);
select is(
  (select count(*)::integer from internal.product_event_epoch), 1, 'the epoch table holds exactly one row'
);
select ok(
  (select started_at <= pg_catalog.clock_timestamp() from internal.product_event_epoch),
  'the epoch is set to the time of the migration'
);
select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute as a
    where a.attrelid = to_regclass('internal.product_events') and a.attnum > 0 and not a.attisdropped),
  array['id', 'user_id', 'event_name', 'occurred_at', 'local_date', 'properties'],
  'the event table has only the six minimal columns'
);

select ok(
  (select count(to_regprocedure(sig)) from unnest(array[
    'public.set_pilot_participant(uuid,text,boolean)', 'public.get_pilot_metrics(timestamptz)',
    'internal.record_product_event(uuid,text,jsonb)', 'internal.product_event_properties_valid(text,jsonb)',
    'internal.product_event_int_in_range(jsonb,integer,integer)',
    'internal.product_event_activity_saved()', 'internal.product_event_career_record()',
    'internal.product_event_achievement_created()', 'internal.product_event_achievement_confirmed()',
    'internal.product_event_import_committed()', 'internal.product_event_cv_export_finished()']) as sigs(sig)) = 11,
  'the eleven T24 functions exist'
);
select ok(
  (select bool_and((select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure(sig))) from unnest(array[
    'public.set_pilot_participant(uuid,text,boolean)', 'public.get_pilot_metrics(timestamptz)',
    'internal.record_product_event(uuid,text,jsonb)',
    'internal.product_event_activity_saved()', 'internal.product_event_career_record()',
    'internal.product_event_achievement_created()', 'internal.product_event_achievement_confirmed()',
    'internal.product_event_import_committed()', 'internal.product_event_cv_export_finished()']) as sigs(sig)),
  'the RPCs, the recorder and the trigger functions are security definer'
);
select ok(
  (select provolatile = 'i' and not prosecdef from pg_catalog.pg_proc
    where oid = to_regprocedure('internal.product_event_properties_valid(text,jsonb)')),
  'the property validator is a pure immutable function'
);
select ok(
  (select bool_and(has_function_privilege('service_role', sig, 'EXECUTE')
      and not has_function_privilege('anon', sig, 'EXECUTE')
      and not has_function_privilege('authenticated', sig, 'EXECUTE'))
   from unnest(array['public.set_pilot_participant(uuid,text,boolean)', 'public.get_pilot_metrics(timestamptz)']) as sigs(sig)),
  'set_pilot_participant and get_pilot_metrics are executable by service_role only'
);
select ok(
  (select bool_and(not has_function_privilege('anon', sig, 'EXECUTE')
      and not has_function_privilege('authenticated', sig, 'EXECUTE')
      and not has_function_privilege('service_role', sig, 'EXECUTE'))
   from unnest(array['internal.record_product_event(uuid,text,jsonb)',
    'internal.product_event_activity_saved()', 'internal.product_event_career_record()',
    'internal.product_event_achievement_created()', 'internal.product_event_achievement_confirmed()',
    'internal.product_event_import_committed()', 'internal.product_event_cv_export_finished()']) as sigs(sig)),
  'the recorder and the trigger functions have no API-role grant'
);
select ok(
  (select count(*) = 2 and bool_and(obj_description(to_regprocedure(sig), 'pg_proc') like 'T24%')
   from unnest(array['public.set_pilot_participant(uuid,text,boolean)', 'public.get_pilot_metrics(timestamptz)']) as sigs(sig)),
  'the two RPCs carry a T24 comment'
);

select is(
  (select count(*)::integer from pg_catalog.pg_trigger
    where tgname like 'product\_event\_%' and not tgisinternal), 10,
  'there are ten product_event_ triggers'
);
select ok(
  (select bool_and((tgtype & 1) = 1 and (tgtype & 2) = 0 and (tgtype & 64) = 0)
   from pg_catalog.pg_trigger where tgname like 'product\_event\_%' and not tgisinternal),
  'every product_event_ trigger is a row-level AFTER trigger'
);
select ok(
  (select count(*) = 10 from (values
     ('public.activities', 'product_event_activity_saved'),
     ('public.achievements', 'product_event_career_record'),
     ('public.projects', 'product_event_career_record'),
     ('public.experiences', 'product_event_career_record'),
     ('public.education', 'product_event_career_record'),
     ('public.certifications', 'product_event_career_record'),
     ('public.achievements', 'product_event_confirmed_achievement_insert'),
     ('public.achievements', 'product_event_confirmed_achievement_update'),
     ('public.import_batches', 'product_event_import_committed'),
     ('public.cv_exports', 'product_event_cv_export_finished')) as want(tbl, trg)
   where exists (select 1 from pg_catalog.pg_trigger where tgrelid = want.tbl::regclass and tgname = want.trg and not tgisinternal)),
  'each trigger is attached to the table the contract names'
);
select ok(
  not exists (select 1 from pg_catalog.pg_trigger
    where tgname like 'product\_event\_%' and not tgisinternal
      and tgrelid not in ('public.activities'::regclass, 'public.achievements'::regclass, 'public.projects'::regclass,
        'public.experiences'::regclass, 'public.education'::regclass, 'public.certifications'::regclass,
        'public.import_batches'::regclass, 'public.cv_exports'::regclass)),
  'no event trigger sits on any other table (skills, profiles, AI, evidence and reads produce no event)'
);

-- 2. Fixtures -------------------------------------------------------------------

delete from internal.pilot_participants;
-- profiles_touch_mutable_row pins created_at; the metric windows start there, so the fixtures need to move it.
alter table public.profiles disable trigger profiles_touch_mutable_row;

create or replace function pg_temp.usr(p_suffix text) returns uuid language sql as $$
  select md5('t24-user:' || p_suffix)::uuid
$$;
create or replace function pg_temp.k(p_label text) returns uuid language sql as $$
  select md5('t24:' || p_label)::uuid
$$;
create or replace function pg_temp.t0() returns timestamptz language sql stable as $$ select now() $$;

create or replace function pg_temp.mk_user(p_suffix text, p_timezone text default 'UTC') returns uuid language plpgsql as $$
declare v_id uuid := pg_temp.usr(p_suffix);
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    't24-' || p_suffix || '@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );
  update public.profiles set display_name = 'Akun ' || p_suffix, timezone = p_timezone, onboarding_completed_at = now()
  where id = v_id;
  return v_id;
end;
$$;

create or replace function pg_temp.set_jwt_subject(p_user_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', p_role)::text, true);
end;
$$;

-- Runs a statement and returns "sqlstate|message", or 'ok'.
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

create or replace function pg_temp.evc(p_user uuid, p_name text default null) returns integer language sql as $$
  select count(*)::integer from internal.product_events where user_id = p_user and (p_name is null or event_name = p_name)
$$;
create or replace function pg_temp.evp(p_user uuid, p_name text) returns jsonb language sql as $$
  select properties from internal.product_events where user_id = p_user and event_name = p_name order by id desc limit 1
$$;
create or replace function pg_temp.ev(p_user uuid, p_name text, p_props jsonb, p_at timestamptz, p_local date default null)
returns void language sql as $$
  insert into internal.product_events (user_id, event_name, occurred_at, local_date, properties)
  values (p_user, p_name, p_at, coalesce(p_local, (p_at at time zone 'UTC')::date), p_props)
$$;

-- 3. Trigger per write path (acceptance 1) -----------------------------------------------------------------------

select pg_temp.mk_user('a1', 'Asia/Jakarta');
select pg_temp.mk_user('b1', 'UTC');
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));

create temporary table pg_temp.act_note as
select * from public.create_activity_idempotent(
  p_operation_key => pg_temp.k('act-note'), p_raw_text => 'WP-PRIVATE-T24-SENTINEL catatan privat',
  p_occurred_on => current_date, p_capture_mode => 'note', p_role => null, p_scope => null, p_outcome => null,
  p_experience_id => null, p_project_id => null);
select is(pg_temp.evc(pg_temp.usr('a1'), 'activity_saved'), 1, 'a note activity writes one activity_saved event');
select is(pg_temp.evp(pg_temp.usr('a1'), 'activity_saved'), '{"capture_mode":"note"}'::jsonb, 'the note event carries only the capture mode');

select count(*) from public.create_activity_idempotent(
  p_operation_key => pg_temp.k('act-note'), p_raw_text => 'WP-PRIVATE-T24-SENTINEL catatan privat',
  p_occurred_on => current_date, p_capture_mode => 'note', p_role => null, p_scope => null, p_outcome => null,
  p_experience_id => null, p_project_id => null);
select is(pg_temp.evc(pg_temp.usr('a1'), 'activity_saved'), 1, 'an idempotent retry with the same key adds no event');

select count(*) from public.create_activity_idempotent(
  p_operation_key => pg_temp.k('act-form'), p_raw_text => 'Formulir', p_occurred_on => current_date, p_capture_mode => 'form',
  p_role => 'Analis', p_scope => null, p_outcome => null, p_experience_id => null, p_project_id => null);
select is(pg_temp.evp(pg_temp.usr('a1'), 'activity_saved'), '{"capture_mode":"form"}'::jsonb, 'a form activity writes capture_mode form');
select count(*) from public.create_activity_idempotent(
  p_operation_key => pg_temp.k('act-chat'), p_raw_text => 'Obrolan', p_occurred_on => current_date, p_capture_mode => 'chat',
  p_role => null, p_scope => null, p_outcome => null, p_experience_id => null, p_project_id => null);
select is(pg_temp.evp(pg_temp.usr('a1'), 'activity_saved'), '{"capture_mode":"chat"}'::jsonb, 'a chat activity writes capture_mode chat');
select is(pg_temp.evc(pg_temp.usr('a1'), 'activity_saved'), 3, 'three activities wrote three events');

select count(*) from public.update_activity(
  (select activity_id from pg_temp.act_note), (select revision from pg_temp.act_note),
  jsonb_build_object('raw_text', 'WP-PRIVATE-T24-SENTINEL diedit', 'occurred_on', current_date::text,
    'role', null, 'scope', null, 'outcome', null, 'experience_id', null, 'project_id', null));
select is(pg_temp.evc(pg_temp.usr('a1')), 3, 'editing an activity writes no event');

create temporary table pg_temp.exp1 as
select id from public.create_experience_idempotent(
  p_operation_key => pg_temp.k('exp'), p_organization => 'WP-PRIVATE-T24-SENTINEL Org', p_role_title => 'Analis',
  p_description => null, p_kind => 'employment', p_start_date => '2020-01-01', p_start_precision => 'month',
  p_end_date => null, p_end_precision => null, p_is_current => true);
select is(pg_temp.evp(pg_temp.usr('a1'), 'career_record_created'), '{"record_type":"experience"}'::jsonb,
  'an experience writes career_record_created without an origin');
select count(*) from public.create_education_idempotent(
  p_operation_key => pg_temp.k('edu'), p_institution => 'Universitas', p_qualification => 'S1', p_field_of_study => null,
  p_description => null, p_start_date => '2014-01-01', p_start_precision => 'year', p_end_date => '2018-01-01',
  p_end_precision => 'year', p_is_current => false);
select is(pg_temp.evp(pg_temp.usr('a1'), 'career_record_created'), '{"record_type":"education"}'::jsonb, 'education writes record_type education');
select count(*) from public.create_certification_idempotent(
  p_operation_key => pg_temp.k('cert'), p_name => 'Sertifikat', p_issuer => null, p_credential_url => null,
  p_issued_date => null, p_issued_precision => null);
select is(pg_temp.evp(pg_temp.usr('a1'), 'career_record_created'), '{"record_type":"certification"}'::jsonb, 'a certification writes record_type certification');
select count(*) from public.create_skill_idempotent(pg_temp.k('skill'), 'SQL');
select is(pg_temp.evc(pg_temp.usr('a1'), 'career_record_created'), 3, 'a skill is a label, not a career record: no event');

create temporary table pg_temp.proj1 as
select * from public.create_project_idempotent(
  p_operation_key => pg_temp.k('proj'), p_title => 'WP-PRIVATE-T24-SENTINEL Proyek', p_description => null,
  p_user_role => null, p_outcome => null, p_status => 'planned', p_start_date => null, p_start_precision => null,
  p_end_date => null, p_end_precision => null, p_is_current => false, p_experience_id => null);
select is(pg_temp.evp(pg_temp.usr('a1'), 'career_record_created'), '{"record_type":"project"}'::jsonb, 'a project writes record_type project');
select count(*) from public.update_project((select project_id from pg_temp.proj1), 1, '{"title":"Proyek diedit"}'::jsonb);
select is(pg_temp.evc(pg_temp.usr('a1'), 'career_record_created'), 4, 'editing a project writes no event');

create temporary table pg_temp.ach1 as
select * from public.create_achievement_idempotent(pg_temp.k('ach-standalone'), null, null, null);
select is(pg_temp.evp(pg_temp.usr('a1'), 'career_record_created'), '{"record_type":"achievement","origin":"manual"}'::jsonb,
  'a standalone achievement writes record_type achievement with origin manual');
select is(pg_temp.evc(pg_temp.usr('a1'), 'achievement_confirmed'), 0, 'a draft achievement is not a confirmation');
create temporary table pg_temp.ach2 as
select * from public.create_achievement_idempotent(pg_temp.k('ach-derived'), (select activity_id from pg_temp.act_note), null, null);
select is(pg_temp.evp(pg_temp.usr('a1'), 'career_record_created'), '{"record_type":"achievement","origin":"activity"}'::jsonb,
  'an achievement derived from an activity writes origin activity');

select is(
  pg_temp.try(format('select * from public.save_achievement(%L, 99, %L, %L, null)', (select achievement_id from pg_temp.ach1),
    'confirm', '{"title":"x"}')),
  'P0001|STALE_REVISION', 'a stale confirm is rejected');
select is(pg_temp.evc(pg_temp.usr('a1'), 'achievement_confirmed'), 0, 'a rejected save writes no event');

select count(*) from public.save_achievement((select achievement_id from pg_temp.ach1), (select revision from pg_temp.ach1), 'save_draft',
  jsonb_build_object('title', 'WP-PRIVATE-T24-SENTINEL Capaian', 'contribution', 'Kontribusi'), null);
select is(pg_temp.evc(pg_temp.usr('a1'), 'achievement_confirmed'), 0, 'saving a draft is not a confirmation');
select count(*) from public.save_achievement((select achievement_id from pg_temp.ach1),
  (select revision from public.achievements where id = (select achievement_id from pg_temp.ach1)), 'confirm',
  jsonb_build_object('title', 'WP-PRIVATE-T24-SENTINEL Capaian', 'contribution', 'Kontribusi', 'outcome', 'Hasil',
    'achieved_on', current_date::text), null);
select is(pg_temp.evp(pg_temp.usr('a1'), 'achievement_confirmed'), '{"origin":"manual"}'::jsonb, 'confirming writes achievement_confirmed with the origin');
select is(pg_temp.evc(pg_temp.usr('a1'), 'achievement_confirmed'), 1, 'one confirmation wrote one event');

select count(*) from public.save_achievement((select achievement_id from pg_temp.ach1),
  (select revision from public.achievements where id = (select achievement_id from pg_temp.ach1)), 'save_changes',
  jsonb_build_object('title', 'WP-PRIVATE-T24-SENTINEL Capaian diedit', 'contribution', 'Kontribusi', 'outcome', 'Hasil',
    'achieved_on', current_date::text), null);
select is(pg_temp.evc(pg_temp.usr('a1'), 'achievement_confirmed'), 1, 'editing a confirmed achievement writes no event');
select count(*) from public.save_achievement((select achievement_id from pg_temp.ach1),
  (select revision from public.achievements where id = (select achievement_id from pg_temp.ach1)), 'reopen', '{}'::jsonb, null);
select is(pg_temp.evc(pg_temp.usr('a1'), 'achievement_confirmed'), 1, 'reopening writes no event');
select count(*) from public.save_achievement((select achievement_id from pg_temp.ach1),
  (select revision from public.achievements where id = (select achievement_id from pg_temp.ach1)), 'confirm', '{}'::jsonb, null);
select is(pg_temp.evc(pg_temp.usr('a1'), 'achievement_confirmed'), 2,
  'confirming again after a reopen is a new transition and writes a second event (the measures count "at least one")');

-- Confirmed directly at INSERT (owner-written row, like an import) writes both events.
insert into public.achievements (id, user_id, title, contribution, outcome, cv_bullet, achieved_on, status, origin)
values (pg_temp.k('ach-direct'), pg_temp.usr('a1'), 'Langsung', 'K', 'H', 'B', current_date, 'confirmed', 'import');
select is(pg_temp.evp(pg_temp.usr('a1'), 'achievement_confirmed'), '{"origin":"import"}'::jsonb, 'an achievement inserted as confirmed writes achievement_confirmed');
select is(pg_temp.evp(pg_temp.usr('a1'), 'career_record_created'), '{"record_type":"achievement","origin":"import"}'::jsonb,
  'and also career_record_created with origin import');

-- CV selection and reorder are not events.
select count(*) from public.ensure_cv_document();
select count(*) from public.select_cv_source(1, 'experience', (select id from pg_temp.exp1));
select count(*) from public.select_cv_source(2, 'achievement', pg_temp.k('ach-direct'));
create temporary table pg_temp.ev_before_cv as select pg_temp.evc(pg_temp.usr('a1')) as n;
select count(*) from public.remove_cv_item(
  (select revision from public.cv_documents where user_id = pg_temp.usr('a1')),
  (select id from public.cv_items where user_id = pg_temp.usr('a1') and achievement_id = pg_temp.k('ach-direct')), false);
select is(pg_temp.evc(pg_temp.usr('a1')), (select n from pg_temp.ev_before_cv), 'CV selection and removal write no event');

-- 4. Import commit (acceptance 1 and 2) --------------------------------------------------------------------------

insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256,
  status, stage, page_count, extracted_text)
values (pg_temp.k('batch-ok'), pg_temp.usr('a1'), gen_random_uuid(), decode(repeat('00', 32), 'hex'),
  pg_temp.usr('a1')::text || '/import/' || pg_temp.k('batch-ok')::text, 'cv-WP-PRIVATE-T24-SENTINEL.pdf', 'application/pdf', 1000,
  md5('batch-ok') || md5('t24'), 'review', 'done', 2, 'WP-PRIVATE-T24-SENTINEL teks ekstraksi');
insert into public.import_items (user_id, batch_id, entity_type, ordinal, payload, source_excerpt, action, target_id, confirm_requested) values
  (pg_temp.usr('a1'), pg_temp.k('batch-ok'), 'profile', 0,
    jsonb_build_object('headline', 'Headline Impor', 'selected_fields', jsonb_build_array('headline')), 'x', 'create', null, false),
  (pg_temp.usr('a1'), pg_temp.k('batch-ok'), 'experience', 0,
    jsonb_build_object('organization', 'Org Impor', 'role_title', 'Analis', 'kind', 'employment'), 'x', 'create', null, false),
  (pg_temp.usr('a1'), pg_temp.k('batch-ok'), 'experience', 1,
    jsonb_build_object('organization', 'Diabaikan', 'role_title', 'Diabaikan'), 'x', 'map', (select id from pg_temp.exp1), false),
  (pg_temp.usr('a1'), pg_temp.k('batch-ok'), 'education', 0,
    jsonb_build_object('institution', 'Univ Impor', 'qualification', 'S1'), 'x', 'create', null, false),
  (pg_temp.usr('a1'), pg_temp.k('batch-ok'), 'education', 1,
    jsonb_build_object('institution', 'Lewat', 'qualification', 'S1'), 'x', 'skip', null, false),
  (pg_temp.usr('a1'), pg_temp.k('batch-ok'), 'skill', 0, jsonb_build_object('name', 'Python'), 'x', 'create', null, false),
  (pg_temp.usr('a1'), pg_temp.k('batch-ok'), 'achievement', 0,
    jsonb_build_object('status', 'draft', 'title', 'Capaian Impor', 'contribution', 'Menyusun laporan', 'outcome', 'Waktu turun',
      'achieved_on', '2025-06-15', 'cv_bullet', null, 'metrics', '[]'::jsonb), 'x', 'create', null, true);

create temporary table pg_temp.ev_before_import as
select pg_temp.evc(pg_temp.usr('a1'), 'career_record_created') as career, pg_temp.evc(pg_temp.usr('a1'), 'achievement_confirmed') as confirmed,
       pg_temp.evc(pg_temp.usr('a1'), 'import_committed') as committed;
select is(
  pg_temp.try(format('select public.commit_import_batch(%L, %s)', pg_temp.k('batch-ok'),
    (select revision from public.import_batches where id = pg_temp.k('batch-ok')))),
  'ok', 'the import batch commits');
select is(pg_temp.evc(pg_temp.usr('a1'), 'import_committed'), (select committed + 1 from pg_temp.ev_before_import), 'the commit writes one import_committed event');
select is(
  pg_temp.evp(pg_temp.usr('a1'), 'import_committed'),
  '{"created":3,"mapped":1,"skipped":1,"confirmed_achievements":1}'::jsonb,
  'counts sum experience, education, certification and achievement only (profile and skill items are not career records)'
);
select is(
  pg_temp.evc(pg_temp.usr('a1'), 'career_record_created'), (select career + 3 from pg_temp.ev_before_import),
  'the commit writes career_record_created for the experience, the education and the achievement it created (not for the map, skip, skill or profile)'
);
select is(pg_temp.evc(pg_temp.usr('a1'), 'achievement_confirmed'), (select confirmed + 1 from pg_temp.ev_before_import),
  'the achievement confirmed by the commit writes achievement_confirmed');
select is(
  pg_temp.try(format('select public.commit_import_batch(%L, %s)', pg_temp.k('batch-ok'), 1)), 'ok',
  'a second commit of the same batch returns the stored result'
);
select is(pg_temp.evc(pg_temp.usr('a1'), 'import_committed'), (select committed + 1 from pg_temp.ev_before_import),
  'the repeated commit adds no import_committed event');
select is(pg_temp.evc(pg_temp.usr('a1'), 'career_record_created'), (select career + 3 from pg_temp.ev_before_import),
  'the repeated commit adds no career_record_created event');

-- A batch with one invalid item rolls back every event with it.
insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256,
  status, stage, page_count, extracted_text)
values (pg_temp.k('batch-bad'), pg_temp.usr('a1'), gen_random_uuid(), decode(repeat('00', 32), 'hex'),
  pg_temp.usr('a1')::text || '/import/' || pg_temp.k('batch-bad')::text, 'cv.pdf', 'application/pdf', 1000,
  md5('batch-bad') || md5('t24'), 'review', 'done', 2, 'x');
insert into public.import_items (user_id, batch_id, entity_type, ordinal, payload, source_excerpt, action) values
  (pg_temp.usr('a1'), pg_temp.k('batch-bad'), 'experience', 0,
    jsonb_build_object('organization', 'Valid Org', 'role_title', 'Valid Role', 'kind', 'employment'), 'x', 'create'),
  (pg_temp.usr('a1'), pg_temp.k('batch-bad'), 'experience', 1,
    jsonb_build_object('organization', 'Bad Org', 'role_title', null, 'kind', 'employment'), 'x', 'create');
create temporary table pg_temp.ev_before_bad as select pg_temp.evc(pg_temp.usr('a1')) as n;
select is(
  pg_temp.try(format('select public.commit_import_batch(%L, %s)', pg_temp.k('batch-bad'),
    (select revision from public.import_batches where id = pg_temp.k('batch-bad')))),
  '22023|IMPORT_ITEM_INVALID', 'an invalid item fails the commit');
select is(pg_temp.evc(pg_temp.usr('a1')), (select n from pg_temp.ev_before_bad), 'the failed commit leaves no event behind');

-- 5. Export terminal transitions (acceptance 1 and 9) ---------------------------------------------------------------

create or replace function pg_temp.run_export(p_id uuid) returns uuid language plpgsql as $$
declare v_token uuid := gen_random_uuid();
begin
  update public.cv_exports
  set status = 'running', attempt_count = attempt_count + 1, attempt_token = v_token,
      lease_expires_at = now() + interval '120 seconds', started_at = coalesce(started_at, now())
  where id = p_id;
  return v_token;
end;
$$;
create or replace function pg_temp.mk_export(p_label text, p_user uuid) returns uuid language plpgsql as $$
begin
  insert into public.cv_exports (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key)
  select pg_temp.k(p_label), d.user_id, d.id, d.revision, '{}'::jsonb, 'queued', 't24-' || p_label
  from public.cv_documents as d where d.user_id = p_user;
  return pg_temp.k(p_label);
end;
$$;

select pg_temp.mk_export('exp-a', pg_temp.usr('a1'));
create temporary table pg_temp.tok_a as select pg_temp.run_export(pg_temp.k('exp-a')) as t;
select is(pg_temp.evc(pg_temp.usr('a1'), 'cv_export_finished'), 0, 'queued and running are not terminal: no event');
select is(
  (select public.complete_cv_export(pg_temp.k('exp-a'), (select t from pg_temp.tok_a),
    pg_temp.usr('a1')::text || '/export/' || (select t from pg_temp.tok_a)::text, 2, 1000)),
  'succeeded', 'the export completes');
select is(pg_temp.evc(pg_temp.usr('a1'), 'cv_export_finished'), 1, 'a successful export writes one cv_export_finished event');
select is(pg_temp.evp(pg_temp.usr('a1'), 'cv_export_finished'),
  '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":2}'::jsonb, 'the success event carries outcome, attempt and page count only');
select is((select public.complete_cv_export(pg_temp.k('exp-a'), (select t from pg_temp.tok_a),
    pg_temp.usr('a1')::text || '/export/' || (select t from pg_temp.tok_a)::text, 2, 1000)),
  'stale', 'a repeated completion is stale');
select is(pg_temp.evc(pg_temp.usr('a1'), 'cv_export_finished'), 1, 'a stale completion writes no event');

-- A failure, then a retry that succeeds: two terminal transitions, two events.
select pg_temp.mk_export('exp-b', pg_temp.usr('a1'));
create temporary table pg_temp.tok_b as select pg_temp.run_export(pg_temp.k('exp-b')) as t;
select is((select public.fail_cv_export(pg_temp.k('exp-b'), (select t from pg_temp.tok_b), 'RENDERER_UNAVAILABLE')), true, 'the export fails');
select is(pg_temp.evp(pg_temp.usr('a1'), 'cv_export_finished'),
  '{"outcome":"failed","error_code":"RENDERER_UNAVAILABLE","attempt":1,"page_count":null}'::jsonb, 'the failure event carries the allowlisted error code');
update public.cv_exports set status = 'queued', attempt_token = null, lease_expires_at = null, error_code = null, finished_at = null
where id = pg_temp.k('exp-b');
select is(pg_temp.evc(pg_temp.usr('a1'), 'cv_export_finished'), 2, 'requeueing a failed export writes no event');
create temporary table pg_temp.tok_b2 as select pg_temp.run_export(pg_temp.k('exp-b')) as t;
select is((select public.complete_cv_export(pg_temp.k('exp-b'), (select t from pg_temp.tok_b2),
    pg_temp.usr('a1')::text || '/export/' || (select t from pg_temp.tok_b2)::text, 1, 500)), 'succeeded', 'the retry succeeds');
select is(pg_temp.evc(pg_temp.usr('a1'), 'cv_export_finished'), 3, 'fail then retry-success is two terminal events');
select is(pg_temp.evp(pg_temp.usr('a1'), 'cv_export_finished'),
  '{"outcome":"succeeded","error_code":null,"attempt":2,"page_count":1}'::jsonb, 'the retry event carries attempt 2');

-- ACCOUNT_DELETING and a lease timeout, on other owners.
select pg_temp.set_jwt_subject(pg_temp.usr('b1'));
select count(*) from public.ensure_cv_document();
select pg_temp.mk_export('exp-c', pg_temp.usr('b1'));
create temporary table pg_temp.tok_c as select pg_temp.run_export(pg_temp.k('exp-c')) as t;
update public.profiles set deleting_at = now() where id = pg_temp.usr('b1');
select is((select public.complete_cv_export(pg_temp.k('exp-c'), (select t from pg_temp.tok_c),
    pg_temp.usr('b1')::text || '/export/' || (select t from pg_temp.tok_c)::text, 1, 500)), 'failed:ACCOUNT_DELETING',
  'a completion for a deleting account fails the export');
select is(pg_temp.evp(pg_temp.usr('b1'), 'cv_export_finished'),
  '{"outcome":"failed","error_code":"ACCOUNT_DELETING","attempt":1,"page_count":null}'::jsonb, 'the event records ACCOUNT_DELETING (the measure excludes it)');

select pg_temp.mk_user('d1');
select pg_temp.set_jwt_subject(pg_temp.usr('d1'));
select count(*) from public.ensure_cv_document();
select pg_temp.mk_export('exp-d', pg_temp.usr('d1'));
select pg_temp.run_export(pg_temp.k('exp-d'));
update public.cv_exports set lease_expires_at = now() - interval '1 second' where id = pg_temp.k('exp-d');
select ok((select public.expire_cv_export_leases()) >= 1, 'the expired lease is failed by the worker RPC');
select is(pg_temp.evp(pg_temp.usr('d1'), 'cv_export_finished'),
  '{"outcome":"failed","error_code":"EXPORT_TIMEOUT","attempt":1,"page_count":null}'::jsonb, 'the lease timeout writes a failure event');

-- 6. local_date follows the profile timezone (acceptance 3 and 8) ----------------------------------------------------

-- Choose a zone whose calendar date differs from the UTC date right now, whatever the hour is.
create temporary table pg_temp.zone as
select case when extract(hour from clock_timestamp() at time zone 'UTC') < 11 then 'Pacific/Pago_Pago' else 'Pacific/Kiritimati' end as tz;
select pg_temp.mk_user('z1', (select tz from pg_temp.zone));
select pg_temp.set_jwt_subject(pg_temp.usr('z1'));
select count(*) from public.create_activity_idempotent(
  p_operation_key => pg_temp.k('act-zone'), p_raw_text => 'Zona', p_occurred_on => current_date - 2, p_capture_mode => 'note',
  p_role => null, p_scope => null, p_outcome => null, p_experience_id => null, p_project_id => null);
select is(
  (select local_date from internal.product_events where user_id = pg_temp.usr('z1')),
  (select (occurred_at at time zone (select tz from pg_temp.zone))::date from internal.product_events where user_id = pg_temp.usr('z1')),
  'local_date is the date in the profile timezone at event time'
);
select isnt(
  (select local_date from internal.product_events where user_id = pg_temp.usr('z1')),
  (select (occurred_at at time zone 'UTC')::date from internal.product_events where user_id = pg_temp.usr('z1')),
  'and it differs from the UTC date for a zone on the other side of the date line'
);
select is(
  (select local_date from internal.product_events where user_id = pg_temp.usr('a1') and event_name = 'activity_saved' limit 1),
  (select (occurred_at at time zone 'Asia/Jakarta')::date from internal.product_events
    where user_id = pg_temp.usr('a1') and event_name = 'activity_saved' order by id limit 1),
  'a Jakarta profile records the Jakarta date'
);

-- 7. Allowlist (acceptance 3) --------------------------------------------------------------------------------------

create or replace function pg_temp.raw_event(p_name text, p_props jsonb) returns text language plpgsql as $$
begin
  insert into internal.product_events (user_id, event_name, occurred_at, local_date, properties)
  values (pg_temp.usr('a1'), p_name, now(), current_date, p_props);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
select is(pg_temp.raw_event('activity_saved', '{"capture_mode":"note"}'), 'ok', 'a valid event is accepted');
select is(pg_temp.raw_event('activity_saved', '{"capture_mode":"note","activity_id":"4d0c1f0e-0000-4000-8000-000000000000"}'), '23514', 'a record id key is rejected');
select is(pg_temp.raw_event('activity_saved', '{"capture_mode":"WP-PRIVATE free text"}'), '23514', 'a free-text value is rejected');
select is(pg_temp.raw_event('activity_saved', '{}'), '23514', 'a missing key is rejected');
select is(pg_temp.raw_event('activity_saved', '[]'), '23514', 'a non-object is rejected');
select is(pg_temp.raw_event('activity_saved', '{"capture_mode":"note","note":"teks"}'), '23514', 'an unknown key is rejected');
select is(pg_temp.raw_event('page_view', '{}'), '23514', 'an event name outside the list is rejected');
select is(pg_temp.raw_event('career_record_created', '{"record_type":"skill"}'), '23514', 'skill is not a career record type');
select is(pg_temp.raw_event('career_record_created', '{"record_type":"project","origin":"manual"}'), '23514', 'origin is only valid for achievements');
select is(pg_temp.raw_event('career_record_created', '{"record_type":"achievement"}'), '23514', 'an achievement needs an origin');
select is(pg_temp.raw_event('achievement_confirmed', '{"origin":"ai"}'), '23514', 'an origin outside the enum is rejected');
select is(pg_temp.raw_event('import_committed', '{"created":1001,"mapped":0,"skipped":0,"confirmed_achievements":0}'), '23514', 'a count above 1000 is rejected');
select is(pg_temp.raw_event('import_committed', '{"created":1.5,"mapped":0,"skipped":0,"confirmed_achievements":0}'), '23514', 'a fractional count is rejected');
select is(pg_temp.raw_event('import_committed', '{"created":"3","mapped":0,"skipped":0,"confirmed_achievements":0}'), '23514', 'a string count is rejected');
select is(pg_temp.raw_event('import_committed', '{"created":0,"mapped":0,"skipped":0,"confirmed_achievements":0}'), 'ok', 'zero counts are accepted');
select is(pg_temp.raw_event('cv_export_finished', '{"outcome":"failed","error_code":"WP-PRIVATE detail","attempt":1,"page_count":null}'), '23514',
  'an error code outside the allowlist is rejected');
select is(pg_temp.raw_event('cv_export_finished', '{"outcome":"succeeded","error_code":"EXPORT_TIMEOUT","attempt":1,"page_count":1}'), '23514',
  'a success cannot carry an error code');
select is(pg_temp.raw_event('cv_export_finished', '{"outcome":"failed","error_code":null,"attempt":11,"page_count":null}'), '23514', 'an attempt above 10 is rejected');
select is(pg_temp.raw_event('cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":21}'), '23514', 'a page count above 20 is rejected');
select is(pg_temp.raw_event('cv_export_finished', '{"outcome":"cancelled","error_code":null,"attempt":1,"page_count":null}'), '23514', 'an outcome outside the enum is rejected');

-- 8. Cohort enrollment (acceptance 5) ---------------------------------------------------------------------------------

select pg_temp.mk_user('e1');
select is(pg_temp.try(format('select * from public.set_pilot_participant(%L, %L, true)', gen_random_uuid(), 'pilot-v1')),
  '22023|PILOT_ACCOUNT_UNAVAILABLE', 'an unknown account is unavailable');
select is(pg_temp.try('select * from public.set_pilot_participant(null, ''pilot-v1'', true)'), '22023|INVALID_PILOT_PARTICIPANT', 'a null account is rejected');
select is(pg_temp.try(format('select * from public.set_pilot_participant(%L, %L, true)', pg_temp.usr('e1'), 'Pilot V1')),
  '22023|INVALID_PILOT_PARTICIPANT', 'a consent version outside the pattern is rejected');
select is(pg_temp.try(format('select * from public.set_pilot_participant(%L, null, true)', pg_temp.usr('e1'))),
  '22023|INVALID_PILOT_PARTICIPANT', 'a missing consent version is rejected when enrolling');
select is(pg_temp.try(format('select * from public.set_pilot_participant(%L, %L, false)', pg_temp.usr('e1'), 'pilot-v1')),
  '22023|PILOT_PARTICIPANT_UNKNOWN', 'withdrawing someone who never enrolled is unknown');
select is(pg_temp.try(format('select * from public.set_pilot_participant(%L, %L, true)', pg_temp.usr('b1'), 'pilot-v1')),
  '22023|PILOT_ACCOUNT_UNAVAILABLE', 'a deleting account is unavailable');

create temporary table pg_temp.enr1 as select * from public.set_pilot_participant(pg_temp.usr('e1'), 'pilot-v1', true);
select ok((select user_id = pg_temp.usr('e1') and enrolled_at is not null and withdrawn_at is null from pg_temp.enr1), 'enrolling returns the participant');
create temporary table pg_temp.enr2 as select * from public.set_pilot_participant(pg_temp.usr('e1'), 'pilot-v1', true);
select is((select enrolled_at from pg_temp.enr2), (select enrolled_at from pg_temp.enr1), 'enrolling again with the same version is idempotent');
select is((select count(*)::integer from internal.pilot_participants where user_id = pg_temp.usr('e1')), 1, 'and keeps a single row');
create temporary table pg_temp.enr3 as select * from public.set_pilot_participant(pg_temp.usr('e1'), 'pilot-v2', true);
select ok((select enrolled_at = (select enrolled_at from pg_temp.enr1) from pg_temp.enr3)
  and (select consent_version = 'pilot-v2' from internal.pilot_participants where user_id = pg_temp.usr('e1')),
  'a new consent version is stored without changing enrolled_at');
create temporary table pg_temp.wd1 as select * from public.set_pilot_participant(pg_temp.usr('e1'), 'pilot-v2', false);
select ok((select withdrawn_at is not null from pg_temp.wd1), 'withdrawing sets withdrawn_at');
create temporary table pg_temp.wd2 as select * from public.set_pilot_participant(pg_temp.usr('e1'), 'pilot-v2', false);
select is((select withdrawn_at from pg_temp.wd2), (select withdrawn_at from pg_temp.wd1), 'withdrawing again keeps the first timestamp');
select is(pg_temp.try(format('select * from public.set_pilot_participant(%L, %L, true)', pg_temp.usr('e1'), 'pilot-v2')),
  '22023|PILOT_PARTICIPANT_WITHDRAWN', 'withdrawal is final: enrolling again is refused');

select pg_temp.mk_user('e2');
update public.profiles
set created_at = (select started_at - interval '1 second' from internal.product_event_epoch)
where id = pg_temp.usr('e2');
select is(pg_temp.try(format('select * from public.set_pilot_participant(%L, %L, true)', pg_temp.usr('e2'), 'pilot-v1')),
  '22023|PILOT_ACCOUNT_PREDATES_INSTRUMENTATION', 'an account created before the epoch cannot be enrolled');

-- 9. Metrics (acceptance 6 to 10) -----------------------------------------------------------------------------------

delete from internal.pilot_participants;

create or replace function pg_temp.member(p_suffix text, p_created timestamptz) returns uuid language plpgsql as $$
declare v_id uuid := pg_temp.mk_user(p_suffix);
begin
  update public.profiles set created_at = p_created where id = v_id;
  perform public.set_pilot_participant(v_id, 'pilot-v1', true);
  return v_id;
end;
$$;
create or replace function pg_temp.drop_members(p_ids uuid[]) returns void language plpgsql as $$
declare v_id uuid;
begin
  foreach v_id in array p_ids loop
    perform public.set_pilot_participant(v_id, 'pilot-v1', false);
  end loop;
end;
$$;
-- "cohort|eligible|achieved|pending|rate|target"
create or replace function pg_temp.m(p_measure text, p_as_of timestamptz) returns text language sql as $$
  select format('%s|%s|%s|%s|%s|%s', cohort_size, eligible, achieved, pending, coalesce(rate::text, 'null'), target)
  from public.get_pilot_metrics(p_as_of) where measure = p_measure
$$;
create or replace function pg_temp.asof() returns timestamptz language sql stable as $$ select pg_temp.t0() + interval '29 days' $$;

-- 9.0 Shape: four rows, an empty cohort reports NULL rates.
select is((select count(*)::integer from public.get_pilot_metrics(pg_temp.asof())), 4, 'get_pilot_metrics returns four rows');
select is(
  (select array_agg(measure order by measure) from public.get_pilot_metrics(pg_temp.asof())),
  array['activation', 'export_reliability', 'return_capture', 'value_completion'], 'the four measures are named as the contract says');
select is(pg_temp.m('activation', pg_temp.asof()), '0|0|0|0|null|0.60', 'an empty cohort reports no rate (activation target 0.60)');
select is(pg_temp.m('value_completion', pg_temp.asof()), '0|0|0|0|null|0.40', 'value completion target 0.40');
select is(pg_temp.m('return_capture', pg_temp.asof()), '0|0|0|0|null|0.30', 'return capture target 0.30');
select is(pg_temp.m('export_reliability', pg_temp.asof()), '0|0|0|0|null|0.98', 'export reliability target 0.98');
select is((select count(*)::integer from public.get_pilot_metrics()), 4, 'the default as-of is now()');

-- 9.1 Activation: the 24 hour window is [created, created + 24h), inclusive of 23:59:59 and exclusive of 24:00:00.
create temporary table pg_temp.g1 as select array[
  pg_temp.member('ga', pg_temp.t0()), pg_temp.member('gb', pg_temp.t0()), pg_temp.member('gc', pg_temp.t0()),
  pg_temp.member('gd', pg_temp.t0()), pg_temp.member('ge', pg_temp.t0()), pg_temp.member('gf', pg_temp.t0()),
  pg_temp.member('gg', pg_temp.t0()), pg_temp.member('gh', pg_temp.asof() - interval '2 hours')] as ids;
select pg_temp.ev(pg_temp.usr('ga'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '23 hours 59 minutes 59 seconds');
select pg_temp.ev(pg_temp.usr('gb'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '24 hours');
select pg_temp.ev(pg_temp.usr('gc'), 'career_record_created', '{"record_type":"project"}', pg_temp.t0() + interval '1 hour');
select pg_temp.ev(pg_temp.usr('gd'), 'import_committed', '{"created":0,"mapped":0,"skipped":3,"confirmed_achievements":0}', pg_temp.t0() + interval '1 hour');
select pg_temp.ev(pg_temp.usr('ge'), 'import_committed', '{"created":0,"mapped":2,"skipped":0,"confirmed_achievements":0}', pg_temp.t0() + interval '1 hour');
select pg_temp.ev(pg_temp.usr('gf'), 'import_committed', '{"created":1,"mapped":0,"skipped":0,"confirmed_achievements":0}', pg_temp.t0() + interval '1 hour');
select pg_temp.ev(pg_temp.usr('gh'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.asof() - interval '1 hour');
select is(pg_temp.m('activation', pg_temp.asof()), '8|7|4|1|0.5714|0.60',
  'activation: 23:59:59 in, 24:00:00 out, import counts need created + mapped > 0, an open window is pending, not a failure');
select is(pg_temp.m('value_completion', pg_temp.asof()), '8|4|0|1|0.0000|0.40',
  'value completion starts from activated accounts only; the activated account with an open 7 day window is pending');
select is(pg_temp.m('return_capture', pg_temp.asof()), '8|4|0|1|0.0000|0.30', 'return capture likewise');
select is(pg_temp.m('export_reliability', pg_temp.asof()), '8|0|0|0|null|0.98', 'no export, no rate');
select pg_temp.drop_members((select ids from pg_temp.g1));

-- 9.2 Value completion: confirmed achievement AND a successful export, both before created + 7 days.
create temporary table pg_temp.g2 as select array[
  pg_temp.member('va', pg_temp.t0()), pg_temp.member('vb', pg_temp.t0()), pg_temp.member('vc', pg_temp.t0()),
  pg_temp.member('vd', pg_temp.t0()), pg_temp.member('ve', pg_temp.t0()), pg_temp.member('vf', pg_temp.asof() - interval '3 days')] as ids;
select pg_temp.ev(u.id, 'activity_saved', '{"capture_mode":"note"}', c.at + interval '1 hour')
from (select pg_temp.usr(s) as id from unnest(array['va','vb','vc','vd','ve']) as s) as u, (select pg_temp.t0() as at) as c;
select pg_temp.ev(pg_temp.usr('vf'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.asof() - interval '3 days' + interval '1 hour');
-- va: both just inside the window.
select pg_temp.ev(pg_temp.usr('va'), 'achievement_confirmed', '{"origin":"manual"}', pg_temp.t0() + interval '6 days 23 hours 59 minutes 59 seconds');
select pg_temp.ev(pg_temp.usr('va'), 'cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":1}', pg_temp.t0() + interval '6 days 23 hours 59 minutes 59 seconds');
-- vb: the confirmation lands exactly at 7 days.
select pg_temp.ev(pg_temp.usr('vb'), 'achievement_confirmed', '{"origin":"manual"}', pg_temp.t0() + interval '7 days');
select pg_temp.ev(pg_temp.usr('vb'), 'cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":1}', pg_temp.t0() + interval '1 day');
-- vc: only a failed export.
select pg_temp.ev(pg_temp.usr('vc'), 'achievement_confirmed', '{"origin":"manual"}', pg_temp.t0() + interval '1 day');
select pg_temp.ev(pg_temp.usr('vc'), 'cv_export_finished', '{"outcome":"failed","error_code":"RENDERER_UNAVAILABLE","attempt":1,"page_count":null}', pg_temp.t0() + interval '1 day');
-- vd: the successful export is one second late.
select pg_temp.ev(pg_temp.usr('vd'), 'achievement_confirmed', '{"origin":"manual"}', pg_temp.t0() + interval '1 day');
select pg_temp.ev(pg_temp.usr('vd'), 'cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":1}', pg_temp.t0() + interval '7 days 1 second');
-- ve: an export but no confirmation.
select pg_temp.ev(pg_temp.usr('ve'), 'cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":1}', pg_temp.t0() + interval '1 day');
-- vf: both, but the 7 day window is still open.
select pg_temp.ev(pg_temp.usr('vf'), 'achievement_confirmed', '{"origin":"manual"}', pg_temp.asof() - interval '3 days' + interval '2 hours');
select pg_temp.ev(pg_temp.usr('vf'), 'cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":1}', pg_temp.asof() - interval '3 days' + interval '3 hours');
select is(pg_temp.m('value_completion', pg_temp.asof()), '6|5|1|1|0.2000|0.40',
  'value completion: needs both events inside 7 days, a failed export does not count, an open window is pending');
select is(pg_temp.m('activation', pg_temp.asof()), '6|6|6|0|1.0000|0.60', 'activation for the same cohort');
select is(pg_temp.m('export_reliability', pg_temp.asof()), '6|6|5|0|0.8333|0.98', 'export reliability counts every terminal event of the cohort');
select is(pg_temp.m('return_capture', pg_temp.asof()), '6|5|0|1|0.0000|0.30', 'one save in a week is not a return');
select pg_temp.drop_members((select ids from pg_temp.g2));

-- 9.3 Return capture: two distinct ISO weeks (by local_date) among saves before created + 28 days.
create temporary table pg_temp.g3 as select array[
  pg_temp.member('ra', pg_temp.t0()), pg_temp.member('rb', pg_temp.t0()), pg_temp.member('rc', pg_temp.t0()),
  pg_temp.member('rd', pg_temp.t0()), pg_temp.member('re', pg_temp.t0()), pg_temp.member('rf', pg_temp.asof() - interval '10 days')] as ids;
-- 2026-10-04 is a Sunday, 2026-10-05 the Monday after, 2026-10-11 the Sunday of that week.
select pg_temp.ev(pg_temp.usr('ra'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '1 hour', date '2026-10-04');
select pg_temp.ev(pg_temp.usr('ra'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '2 days', date '2026-10-05');
select pg_temp.ev(pg_temp.usr('rb'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '1 hour', date '2026-10-05');
select pg_temp.ev(pg_temp.usr('rb'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '2 days', date '2026-10-11');
-- rc: the UTC dates are nine days apart (two weeks), the profile-zone dates are Monday and Tuesday of one week.
select pg_temp.ev(pg_temp.usr('rc'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '1 hour', date '2026-10-05');
select pg_temp.ev(pg_temp.usr('rc'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '9 days', date '2026-10-06');
-- rd: the second week arrives exactly at 28 days.
select pg_temp.ev(pg_temp.usr('rd'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '1 hour', date '2026-10-05');
select pg_temp.ev(pg_temp.usr('rd'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '28 days', date '2026-10-12');
-- re: three weeks.
select pg_temp.ev(pg_temp.usr('re'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '1 hour', date '2026-09-21');
select pg_temp.ev(pg_temp.usr('re'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '8 days', date '2026-09-30');
select pg_temp.ev(pg_temp.usr('re'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '20 days', date '2026-10-14');
-- rf: two weeks, but only 10 days old.
select pg_temp.ev(pg_temp.usr('rf'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.asof() - interval '10 days' + interval '1 hour', date '2026-10-05');
select pg_temp.ev(pg_temp.usr('rf'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.asof() - interval '5 days', date '2026-10-12');
select is(pg_temp.m('return_capture', pg_temp.asof()), '6|5|2|1|0.4000|0.30',
  'return capture: Sunday and Monday are two weeks, Monday and Sunday are one, the local date decides, the 28 day edge is exclusive');
select pg_temp.drop_members((select ids from pg_temp.g3));

-- 9.4 Export reliability: every terminal transition, ACCOUNT_DELETING excluded.
create temporary table pg_temp.g4 as select array[
  pg_temp.member('xa', pg_temp.t0()), pg_temp.member('xb', pg_temp.t0()), pg_temp.member('xc', pg_temp.t0()), pg_temp.member('xd', pg_temp.t0())] as ids;
select pg_temp.ev(pg_temp.usr('xa'), 'cv_export_finished', '{"outcome":"failed","error_code":"RENDERER_UNAVAILABLE","attempt":1,"page_count":null}', pg_temp.t0() + interval '1 hour');
select pg_temp.ev(pg_temp.usr('xa'), 'cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":2,"page_count":1}', pg_temp.t0() + interval '2 hours');
select pg_temp.ev(pg_temp.usr('xb'), 'cv_export_finished', '{"outcome":"failed","error_code":"ACCOUNT_DELETING","attempt":1,"page_count":null}', pg_temp.t0() + interval '1 hour');
select pg_temp.ev(pg_temp.usr('xc'), 'cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":3}', pg_temp.t0() + interval '1 hour');
select pg_temp.ev(pg_temp.usr('xd'), 'cv_export_finished', '{"outcome":"failed","error_code":"EXPORT_TOO_LONG","attempt":1,"page_count":null}', pg_temp.t0() + interval '1 hour');
select is(pg_temp.m('export_reliability', pg_temp.asof()), '4|4|2|0|0.5000|0.98',
  'export reliability: fail then retry-success is 1 of 2, ACCOUNT_DELETING is excluded, pending is always 0');
select is(pg_temp.m('value_completion', pg_temp.asof()), '4|0|0|0|null|0.40', 'no activated account: value completion has no rate');
select pg_temp.drop_members((select ids from pg_temp.g4));

-- 9.5 Fixtures stay out: a non-enrolled account and a withdrawn participant never count.
create temporary table pg_temp.g5 as select array[pg_temp.member('na', pg_temp.t0()), pg_temp.member('nb', pg_temp.t0())] as ids;
select pg_temp.mk_user('nc');
update public.profiles set created_at = pg_temp.t0() where id = pg_temp.usr('nc');
select pg_temp.ev(pg_temp.usr('nb'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '1 hour', date '2026-10-05');
select pg_temp.ev(pg_temp.usr('nb'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '2 days', date '2026-10-12');
select pg_temp.ev(pg_temp.usr('nb'), 'achievement_confirmed', '{"origin":"manual"}', pg_temp.t0() + interval '1 day');
select pg_temp.ev(pg_temp.usr('nb'), 'cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":1}', pg_temp.t0() + interval '1 day');
select pg_temp.ev(pg_temp.usr('nc'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '1 hour', date '2026-10-05');
select pg_temp.ev(pg_temp.usr('nc'), 'activity_saved', '{"capture_mode":"note"}', pg_temp.t0() + interval '2 days', date '2026-10-12');
select pg_temp.ev(pg_temp.usr('nc'), 'achievement_confirmed', '{"origin":"manual"}', pg_temp.t0() + interval '1 day');
select pg_temp.ev(pg_temp.usr('nc'), 'cv_export_finished', '{"outcome":"succeeded","error_code":null,"attempt":1,"page_count":1}', pg_temp.t0() + interval '1 day');
select public.set_pilot_participant(pg_temp.usr('nb'), 'pilot-v1', false);
select is(pg_temp.m('activation', pg_temp.asof()), '1|1|0|0|0.0000|0.60', 'only the enrolled, active participant is in the cohort');
select is(pg_temp.m('export_reliability', pg_temp.asof()), '1|0|0|0|null|0.98', 'a withdrawn participant and an unenrolled account add no export');
select pg_temp.drop_members((select ids from pg_temp.g5));

-- 10. Deletion cascade (acceptance 11) ---------------------------------------------------------------------------------

select pg_temp.mk_user('f1');
select pg_temp.mk_user('f2');
select public.set_pilot_participant(pg_temp.usr('f1'), 'pilot-v1', true);
select pg_temp.ev(pg_temp.usr('f1'), 'activity_saved', '{"capture_mode":"note"}', now());
select pg_temp.ev(pg_temp.usr('f2'), 'activity_saved', '{"capture_mode":"note"}', now());
select is(pg_temp.evc(pg_temp.usr('f1')), 1, 'the account about to be deleted has an event');
delete from auth.users where id = pg_temp.usr('f1');
select is(pg_temp.evc(pg_temp.usr('f1')), 0, 'deleting the user removes its events');
select is((select count(*)::integer from internal.pilot_participants where user_id = pg_temp.usr('f1')), 0, 'and its participant row');
select is(pg_temp.evc(pg_temp.usr('f2')), 1, 'another account keeps its events');

-- 11. No content in any event (acceptance 3) -----------------------------------------------------------------------------

select is(
  (select count(*)::integer from internal.product_events
    where properties::text ilike '%WP-PRIVATE%' or properties::text ilike '%SENTINEL%'),
  0, 'no private sentinel appears in any event property'
);
select is(
  (select count(*)::integer from internal.product_events
    where properties::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
  0, 'no record id appears in any event property'
);

select * from finish();
rollback;

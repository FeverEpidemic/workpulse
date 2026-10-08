begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T21 CV export backend (PRD R10, F07, DB §4/§5/§6, decision 0027).
-- Sources are edited directly as the test owner; export RPCs run with a JWT subject; worker RPCs are called
-- directly (they are security definer and granted to service_role only).

-- 1. Structure and privileges -------------------------------------------------

select ok(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'cv_exports' and column_name in ('page_count', 'byte_size', 'purged_at')) = 3,
  'cv_exports has the T21 columns'
);
select ok(
  (select count(*) from pg_catalog.pg_constraint
    where conrelid = 'public.cv_exports'::regclass
      and conname in ('cv_exports_state_check', 'cv_exports_snapshot_size_check', 'cv_exports_page_count_check',
                      'cv_exports_byte_size_check', 'cv_exports_object_key_owner_check')) = 5,
  'cv_exports has the five T21 constraints'
);
select ok(
  exists (select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and tablename = 'cv_exports' and indexname = 'cv_exports_one_active_key'
      and indexdef ilike 'create unique index%' and indexdef ilike '%queued%' and indexdef ilike '%running%')
  and (select count(*) from pg_catalog.pg_indexes
    where schemaname = 'public' and tablename = 'cv_exports' and indexname in ('cv_exports_expiry_idx', 'cv_exports_claim_idx')) = 2,
  'the one-active partial unique index and the expiry and claim indexes exist'
);
select ok(
  (select count(*) from pg_catalog.pg_trigger
    where tgrelid = 'public.cv_exports'::regclass and not tgisinternal
      and tgname in ('cv_exports_a_guard', 'cv_exports_touch_mutable_row')) = 2,
  'the immutability guard and the touch trigger exist'
);
select ok(
  (select count(to_regprocedure(sig)) from unnest(array[
    'public.get_cv_export_readiness()', 'public.request_cv_export(integer,text)', 'public.retry_cv_export(uuid)',
    'public.get_cv_export_download(uuid)', 'public.expire_cv_export_leases()', 'public.claim_cv_export_jobs(integer)',
    'public.get_cv_export_input(uuid,uuid)', 'public.complete_cv_export(uuid,uuid,text,integer,bigint)',
    'public.fail_cv_export(uuid,uuid,text)', 'public.expire_cv_exports(integer)',
    'public.claim_export_cleanup_jobs(integer)', 'public.complete_export_cleanup_job(uuid,uuid)',
    'public.fail_export_cleanup_job(uuid,uuid,text)', 'public.retry_export_cleanup_job(uuid,uuid,text,timestamptz)',
    'public.reconcile_orphan_export_objects(integer,integer)',
    'internal.cv_export_effective_name(public.cv_documents)', 'internal.cv_export_blockers(public.cv_documents)',
    'internal.cv_export_snapshot(public.cv_documents)', 'internal.cv_export_lock_sources(uuid,uuid)',
    'internal.fail_cv_export_locked(public.cv_exports,text)', 'internal.is_permanent_export_error(text)',
    'internal.guard_cv_export_row()']) as sigs(sig)) = 22
  and (select bool_and((select prosecdef from pg_catalog.pg_proc where oid = to_regprocedure(sig))) from unnest(array[
    'public.get_cv_export_readiness()', 'public.request_cv_export(integer,text)', 'public.retry_cv_export(uuid)',
    'public.get_cv_export_download(uuid)', 'public.expire_cv_export_leases()', 'public.claim_cv_export_jobs(integer)',
    'public.get_cv_export_input(uuid,uuid)', 'public.complete_cv_export(uuid,uuid,text,integer,bigint)',
    'public.fail_cv_export(uuid,uuid,text)', 'public.expire_cv_exports(integer)',
    'public.claim_export_cleanup_jobs(integer)', 'public.complete_export_cleanup_job(uuid,uuid)',
    'public.fail_export_cleanup_job(uuid,uuid,text)', 'public.retry_export_cleanup_job(uuid,uuid,text,timestamptz)',
    'public.reconcile_orphan_export_objects(integer,integer)',
    'internal.cv_export_blockers(public.cv_documents)',
    'internal.cv_export_snapshot(public.cv_documents)', 'internal.cv_export_lock_sources(uuid,uuid)',
    'internal.fail_cv_export_locked(public.cv_exports,text)',
    'internal.guard_cv_export_row()']) as sigs(sig)),
  'the 20 data-reading T21 functions are security definer'
);
select ok(
  (select count(*) = 2 and bool_and(not proc.prosecdef and proc.provolatile = 'i')
   from pg_catalog.pg_proc as proc
   where proc.oid in (to_regprocedure('internal.cv_export_effective_name(public.cv_documents)'),
                      to_regprocedure('internal.is_permanent_export_error(text)'))),
  'the two pure helpers read only their arguments: immutable and not security definer'
);
select ok(
  (select bool_and(has_function_privilege('authenticated', sig, 'EXECUTE')
      and not has_function_privilege('anon', sig, 'EXECUTE')
      and not has_function_privilege('service_role', sig, 'EXECUTE'))
   from unnest(array['public.get_cv_export_readiness()', 'public.request_cv_export(integer,text)',
     'public.retry_cv_export(uuid)', 'public.get_cv_export_download(uuid)']) as sigs(sig)),
  'the four user RPCs are executable by authenticated only'
);
select ok(
  (select bool_and(has_function_privilege('service_role', sig, 'EXECUTE')
      and not has_function_privilege('anon', sig, 'EXECUTE')
      and not has_function_privilege('authenticated', sig, 'EXECUTE'))
   from unnest(array['public.expire_cv_export_leases()', 'public.claim_cv_export_jobs(integer)',
     'public.get_cv_export_input(uuid,uuid)', 'public.complete_cv_export(uuid,uuid,text,integer,bigint)',
     'public.fail_cv_export(uuid,uuid,text)', 'public.expire_cv_exports(integer)',
     'public.claim_export_cleanup_jobs(integer)', 'public.complete_export_cleanup_job(uuid,uuid)',
     'public.fail_export_cleanup_job(uuid,uuid,text)', 'public.retry_export_cleanup_job(uuid,uuid,text,timestamptz)',
     'public.reconcile_orphan_export_objects(integer,integer)']) as sigs(sig)),
  'the eleven worker RPCs are executable by service_role only'
);
select ok(
  (select bool_and(not has_function_privilege('anon', sig, 'EXECUTE')
      and not has_function_privilege('authenticated', sig, 'EXECUTE')
      and not has_function_privilege('service_role', sig, 'EXECUTE'))
   from unnest(array['internal.cv_export_effective_name(public.cv_documents)', 'internal.cv_export_blockers(public.cv_documents)',
     'internal.cv_export_snapshot(public.cv_documents)', 'internal.cv_export_lock_sources(uuid,uuid)',
     'internal.fail_cv_export_locked(public.cv_exports,text)', 'internal.is_permanent_export_error(text)',
     'internal.guard_cv_export_row()']) as sigs(sig)),
  'the internal export helpers have no API-role grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.cv_exports', 'INSERT')
  and not has_table_privilege('authenticated', 'public.cv_exports', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.cv_exports', 'DELETE')
  and has_table_privilege('authenticated', 'public.cv_exports', 'SELECT')
  and not has_table_privilege('service_role', 'public.cv_exports', 'SELECT'),
  'cv_exports grants are unchanged: select own for authenticated, nothing for service_role'
);

-- 2. Fixtures -------------------------------------------------------------------

create or replace function pg_temp.usr(p_suffix text) returns uuid language sql as $$
  select ('7c300000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;
create or replace function pg_temp.u(p_suffix text) returns uuid language sql as $$
  select ('7c400000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select pg_temp.usr(suffix), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'cve-' || suffix || '@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values ('a1'), ('b1'), ('c1'), ('d1'), ('e1'), ('51'), ('e2'), ('f1')) as users(suffix);

update public.profiles set display_name = 'Ani Contoh', locale = 'id', headline = 'Lulusan Informatika',
  contact_email = 'ani@example.com', summary = 'Ringkasan sumber', onboarding_completed_at = now()
where id = pg_temp.usr('a1');
update public.profiles set display_name = 'Budi Contoh', onboarding_completed_at = now()
where id in (pg_temp.usr('b1'), pg_temp.usr('c1'), pg_temp.usr('d1'), pg_temp.usr('51'), pg_temp.usr('e2'), pg_temp.usr('f1'));

create or replace function pg_temp.set_jwt_subject(p_user_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', p_role)::text, true);
end;
$$;

create or replace function pg_temp.try(p_sql text)
returns text language plpgsql as $$
declare v_state text; v_msg text; v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || '|' || v_msg || '|' || coalesce(v_detail, '');
end;
$$;

create or replace function pg_temp.me() returns uuid language sql as $$
  select current_setting('request.jwt.claim.sub')::uuid
$$;
create or replace function pg_temp.cv_rev(p_user_id uuid default null)
returns integer language sql as $$
  select revision from public.cv_documents where user_id = coalesce(p_user_id, pg_temp.me())
$$;
create or replace function pg_temp.doc(p_user_id uuid default null)
returns public.cv_documents language sql as $$
  select d from public.cv_documents as d where d.user_id = coalesce(p_user_id, pg_temp.me())
$$;

-- Owner A: employment E1 with project P1 (achievement AC1), standalone achievement AC2, education, skill, certification.
insert into public.experiences (id, user_id, organization, role_title, kind, description) values
  (pg_temp.u('e001'), pg_temp.usr('a1'), 'Org Contoh', 'Engineer', 'employment', 'Deskripsi peran');
insert into public.projects (id, user_id, experience_id, title, description, user_role, outcome, status) values
  (pg_temp.u('b001'), pg_temp.usr('a1'), pg_temp.u('e001'), 'Sistem Antrian', 'Deskripsi', 'Peneliti', 'Lulus', 'completed');
insert into public.achievements (id, user_id, experience_id, project_id, title, contribution, scope, outcome, cv_bullet, achieved_on, status) values
  (pg_temp.u('c001'), pg_temp.usr('a1'), pg_temp.u('e001'), pg_temp.u('b001'), 'Menurunkan waktu antre', 'Kontribusi privat', 'Lingkup', 'Waktu turun 30 persen',
   'Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”', '2023-05-10', 'confirmed'),
  (pg_temp.u('c002'), pg_temp.usr('a1'), null, null, 'Standalone', 'Kontribusi dua', 'Lingkup dua', 'Hasil dua',
   'Menulis laporan mingguan', '2023-06-10', 'confirmed'),
  (pg_temp.u('c004'), pg_temp.usr('a1'), null, null, 'Untuk dihapus', 'Kontribusi empat', 'Lingkup empat', 'Hasil empat',
   'Membersihkan data lama', '2023-08-10', 'confirmed');
insert into public.education (id, user_id, institution, qualification, field_of_study) values
  (pg_temp.u('d001'), pg_temp.usr('a1'), 'Universitas Contoh', 'S1', 'Informatika');
insert into public.skills (id, user_id, name) values (pg_temp.u('f001'), pg_temp.usr('a1'), 'SQL');
insert into public.certifications (id, user_id, name, credential_url) values
  (pg_temp.u('a001'), pg_temp.usr('a1'), 'Sertifikat Satu', 'https://example.com/credential');

-- Other owners.
insert into public.education (id, user_id, institution, qualification) values
  (pg_temp.u('bd01'), pg_temp.usr('b1'), 'B Uni', 'S1'),
  (pg_temp.u('dd01'), pg_temp.usr('d1'), 'D Uni', 'S1'),
  (pg_temp.u('fd01'), pg_temp.usr('f1'), 'G Uni', 'S1'),
  (pg_temp.u('ed01'), pg_temp.usr('e2'), 'N Uni', 'S1');
insert into public.skills (id, user_id, name) values (pg_temp.u('5f01'), pg_temp.usr('51'), 'Python');
insert into public.certifications (id, user_id, name) values (pg_temp.u('5a01'), pg_temp.usr('51'), 'Sertifikat S');

select pg_temp.set_jwt_subject(pg_temp.usr('a1'));
select * from public.ensure_cv_document();
select * from public.select_cv_source(1, 'experience', pg_temp.u('e001'));
select * from public.select_cv_source(2, 'project', pg_temp.u('b001'));
select * from public.select_cv_source(3, 'achievement', pg_temp.u('c001'));
select * from public.select_cv_source(4, 'achievement', pg_temp.u('c002'));
select * from public.select_cv_source(5, 'education', pg_temp.u('d001'));
select * from public.select_cv_source(6, 'skill', pg_temp.u('f001'));
select * from public.select_cv_source(7, 'certification', pg_temp.u('a001'));
select pg_temp.set_jwt_subject(pg_temp.usr('b1'));
select * from public.ensure_cv_document();
select * from public.select_cv_source(1, 'education', pg_temp.u('bd01'));
select pg_temp.set_jwt_subject(pg_temp.usr('d1'));
select * from public.ensure_cv_document();
select * from public.select_cv_source(1, 'education', pg_temp.u('dd01'));
select pg_temp.set_jwt_subject(pg_temp.usr('f1'));
select * from public.ensure_cv_document();
select * from public.select_cv_source(1, 'education', pg_temp.u('fd01'));
select pg_temp.set_jwt_subject(pg_temp.usr('51'));
select * from public.ensure_cv_document();
select * from public.select_cv_source(1, 'skill', pg_temp.u('5f01'));
select * from public.select_cv_source(2, 'certification', pg_temp.u('5a01'));
select pg_temp.set_jwt_subject(pg_temp.usr('e2'));
select * from public.ensure_cv_document();
select * from public.select_cv_source(1, 'education', pg_temp.u('ed01'));
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));

create temporary table pg_temp.k as
  select 'ex'::text as key, id from public.cv_items where experience_id = pg_temp.u('e001')
  union all select 'pj', id from public.cv_items where project_id = pg_temp.u('b001')
  union all select 'ac1', id from public.cv_items where achievement_id = pg_temp.u('c001')
  union all select 'ac2', id from public.cv_items where achievement_id = pg_temp.u('c002')
  union all select 'ed', id from public.cv_items where education_id = pg_temp.u('d001')
  union all select 'sk', id from public.cv_items where skill_id = pg_temp.u('f001')
  union all select 'ce', id from public.cv_items where certification_id = pg_temp.u('a001');

create or replace function pg_temp.i(p_key text) returns uuid language sql as $$
  select id from pg_temp.k where key = p_key
$$;
-- Sorted blocker codes of the current owner's CV.
create or replace function pg_temp.bl() returns text language sql as $$
  select coalesce(string_agg(b.code, ',' order by b.code, b.item_id), '')
  from internal.cv_export_blockers(pg_temp.doc()) as b
$$;
create or replace function pg_temp.bl_item(p_code text) returns uuid language sql as $$
  select b.item_id from internal.cv_export_blockers(pg_temp.doc()) as b where b.code = p_code limit 1
$$;
create or replace function pg_temp.rev_of(p_table text, p_id uuid) returns integer language plpgsql as $$
declare v integer;
begin
  execute format('select revision from public.%I where id = $1', p_table) into v using p_id;
  return v;
end;
$$;
create or replace function pg_temp.keep(p_key text) returns text language sql as $$
  select pg_temp.try(format(
    'select * from public.resolve_cv_freshness(%L, %L::jsonb)', pg_temp.cv_rev(),
    format('[{"target":"item","item_id":"%s","source_revision":%s,"action":"keep"}]', pg_temp.i(p_key),
      (select source.live_revision from public.cv_items as item, internal.cv_live_source(item) as source where item.id = pg_temp.i(p_key)))))
$$;
create or replace function pg_temp.keep_profile() returns text language sql as $$
  select pg_temp.try(format(
    'select * from public.resolve_cv_freshness(%L, %L::jsonb)', pg_temp.cv_rev(),
    format('[{"target":"profile","source_revision":%s,"action":"keep"}]', (select revision from public.profiles where id = pg_temp.me()))))
$$;
create or replace function pg_temp.req(p_rev integer, p_key text) returns text language sql as $$
  select pg_temp.try(format('select * from public.request_cv_export(%L, %L)', p_rev, p_key))
$$;
create or replace function pg_temp.req_id(p_rev integer, p_key text) returns uuid language sql as $$
  select export_id from public.request_cv_export(p_rev, p_key)
$$;
create or replace function pg_temp.fp() returns text language sql as $$
  select md5(
    coalesce((select string_agg(d::text, '|' order by d.id) from public.cv_documents as d), '')
    || coalesce((select string_agg(i::text, '|' order by i.id) from public.cv_items as i), ''))
$$;
create or replace function pg_temp.n_exports() returns integer language sql as $$
  select count(*)::integer from public.cv_exports
$$;
create or replace function pg_temp.exp(p_id uuid) returns public.cv_exports language sql as $$
  select e from public.cv_exports as e where e.id = p_id
$$;
-- Claims every queued export and returns the attempt token of one export (null when it was not claimed).
create temporary table pg_temp.claimed (id uuid, user_id uuid, cv_revision integer, attempt_count integer, attempt_token uuid);
create or replace function pg_temp.claim(p_id uuid) returns uuid language plpgsql as $$
begin
  insert into pg_temp.claimed select * from public.claim_cv_export_jobs(10);
  return (select c.attempt_token from pg_temp.claimed as c where c.id = p_id order by c.attempt_count desc limit 1);
end;
$$;

select is(pg_temp.cv_rev(), 8, 'owner A CV is at revision 8 after seven selections');
select is(pg_temp.n_exports(), 0, 'no export exists yet');

-- 3. Readiness and blockers (one definition) --------------------------------------------------------

select is(pg_temp.bl(), '', 'a fresh, named CV with content has no blocker');
select is(
  (select has_cv::text || ',' || ready::text || ',' || cv_revision || ',' || jsonb_array_length(blockers) from public.get_cv_export_readiness()),
  'true,true,8,0', 'readiness reports a ready CV and its revision'
);

update public.achievements set cv_bullet = 'Pengelolaan anggaran Rp2 miliar' where id = pg_temp.u('c001');
select is(pg_temp.bl(), 'ITEM_CHANGED', 'a changed source blocks export');
select is(pg_temp.bl_item('ITEM_CHANGED'), pg_temp.i('ac1'), 'the blocker carries the item id');
select is(
  (select blockers -> 0 ->> 'code' || ':' || (blockers -> 0 ->> 'item_id') from public.get_cv_export_readiness()),
  'ITEM_CHANGED:' || pg_temp.i('ac1'), 'readiness lists the blocker with its item id'
);
select is(
  (select ready::text from public.get_cv_export_readiness()), 'false', 'readiness is not ready while an item is changed'
);
select is(pg_temp.keep('ac1'), 'ok', 'Keep saved wording is accepted');
select is(pg_temp.bl(), '', 'a kept item does not block export');

update public.profiles set headline = 'Headline sumber baru' where id = pg_temp.usr('a1');
select is(pg_temp.bl(), 'PROFILE_CHANGED', 'a changed profile blocks export');
select is((select count(*)::integer from internal.cv_export_blockers(pg_temp.doc()) where item_id is null), 1, 'the profile blocker has no item id');
select is(pg_temp.keep_profile(), 'ok', 'Keep saved profile is accepted');
select is(pg_temp.bl(), '', 'a kept profile does not block export');

select public.save_achievement(pg_temp.u('c002'),
  (select revision from public.achievements where id = pg_temp.u('c002')), 'reopen', '{}'::jsonb, null);
select is(pg_temp.bl(), 'ITEM_UNCONFIRMED', 'a reopened achievement blocks export');
select is(pg_temp.bl_item('ITEM_UNCONFIRMED'), pg_temp.i('ac2'), 'the unconfirmed blocker names the item');
select public.save_achievement(pg_temp.u('c002'),
  (select revision from public.achievements where id = pg_temp.u('c002')), 'confirm', '{}'::jsonb, null);
select is(pg_temp.bl(), '', 'a re-confirmed achievement with unchanged wording does not block');

select * from public.delete_achievement(pg_temp.u('c001'), pg_temp.rev_of('achievements', pg_temp.u('c001')));
select is(pg_temp.bl(), 'ITEM_DELETED', 'a deleted source blocks export');
select is(pg_temp.bl_item('ITEM_DELETED'), pg_temp.i('ac1'), 'the deleted blocker names the item');
select * from public.remove_cv_item(pg_temp.cv_rev(), pg_temp.i('ac1'), false);
select is(pg_temp.bl(), '', 'removing the deleted item clears the blocker');

-- Name and content.
select pg_temp.set_jwt_subject(pg_temp.usr('e2'));
select is(pg_temp.bl(), '', 'a named CV with education is ready');
update public.cv_documents set profile_snapshot = profile_snapshot - 'display_name' - 'display_overrides' where user_id = pg_temp.usr('e2');
select ok(pg_temp.bl() like '%NAME_REQUIRED%', 'no snapshot name and no override blocks export');
update public.cv_documents
set profile_snapshot = profile_snapshot || '{"display_overrides":{"display_name":"Nama Tampil"}}'::jsonb
where user_id = pg_temp.usr('e2');
select ok(pg_temp.bl() not like '%NAME_REQUIRED%', 'a display name override satisfies the name requirement');
select is(internal.cv_export_effective_name(pg_temp.doc()), 'Nama Tampil', 'the effective name prefers the override');
select pg_temp.set_jwt_subject(pg_temp.usr('51'));
select is(pg_temp.bl(), 'CONTENT_REQUIRED', 'skills and certifications alone do not satisfy the content requirement');
select pg_temp.set_jwt_subject(pg_temp.usr('c1'));
select is(
  (select has_cv::text || ',' || ready::text || ',' || (blockers -> 0 ->> 'code') from public.get_cv_export_readiness()),
  'false,false,CV_NOT_FOUND', 'an account without a CV is not ready and says CV_NOT_FOUND'
);
select pg_temp.set_jwt_subject(null);
select is((select count(*)::integer from public.get_cv_export_readiness()), 0, 'readiness returns nothing without a session');
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));

-- 4. Request ---------------------------------------------------------------------------------------

-- Make the CV unambiguous again: fresh ac2, ed, ex, pj, sk, ce and a fresh profile; override one wording.
select is(pg_temp.bl(), '', 'owner A is ready again');
select public.save_cv_edits(pg_temp.cv_rev(), jsonb_build_object('item_overrides',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.i('ac2'), 'override_text', 'Wording override ac2'))));

create temporary table pg_temp.before_request as select pg_temp.fp() as fingerprint, pg_temp.cv_rev() as cv_revision;
create temporary table pg_temp.x as select 'first'::text as label, pg_temp.req_id(pg_temp.cv_rev(), 'key-first') as id;

select is((select status from pg_temp.exp((select id from pg_temp.x where label = 'first'))), 'queued', 'a ready CV queues one export');
select is(
  (select cv_revision from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  (select cv_revision from pg_temp.before_request), 'the export is bound to the CV revision'
);
select is(pg_temp.n_exports(), 1, 'exactly one export row exists');
select is(pg_temp.fp(), (select fingerprint from pg_temp.before_request), 'requesting an export did not touch the CV or its items');
select is(
  (select (snapshot ->> 'schema_version') || ',' || (snapshot ->> 'template_key') || ',' || (snapshot ->> 'locale') || ',' || (snapshot ->> 'cv_revision')
   from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  'cv-export.v1,single_column_v1,id,' || (select cv_revision from pg_temp.before_request),
  'the snapshot records its schema, template, locale and revision'
);
select ok(
  (select array(select jsonb_object_keys(snapshot) order by 1) = array['cv_id', 'cv_revision', 'items', 'locale', 'profile_snapshot',
        'schema_version', 'section_order', 'summary_override', 'template_key', 'title']
   from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  'the snapshot has exactly the documented top-level keys'
);
select is(
  (select jsonb_array_length(snapshot -> 'items') from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  (select count(*)::integer from public.cv_items where cv_id = (pg_temp.doc()).id),
  'the snapshot holds every saved item'
);
select ok(
  (select bool_and(array(select jsonb_object_keys(item) order by 1) = array['id', 'override_text', 'position', 'section_key', 'source_snapshot'])
   from pg_temp.exp((select id from pg_temp.x where label = 'first')) as e, jsonb_array_elements(e.snapshot -> 'items') as item),
  'every snapshot item has exactly id, section_key, position, source_snapshot and override_text'
);
select is(
  (select string_agg(item ->> 'id', ',' order by ord) from pg_temp.exp((select id from pg_temp.x where label = 'first')) as e,
     jsonb_array_elements(e.snapshot -> 'items') with ordinality as t(item, ord)),
  (select string_agg(id::text, ',' order by section_key, position, id) from public.cv_items where cv_id = (pg_temp.doc()).id),
  'snapshot items follow section, position and id order'
);
select ok(
  (select (item ->> 'override_text') = 'Wording override ac2'
   from pg_temp.exp((select id from pg_temp.x where label = 'first')) as e, jsonb_array_elements(e.snapshot -> 'items') as item
   where item ->> 'id' = pg_temp.i('ac2')::text),
  'the snapshot carries the wording override'
);
select ok(
  (select snapshot::text !~ '"(raw_text|contribution|source_excerpt|metrics|activity_id|activity_ids|evidence|scope)"'
   from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  'the snapshot has no source text, metrics, activity link or evidence key'
);
select ok(
  (select snapshot::text not like '%Kontribusi privat%' from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  'the private contribution text never reaches the snapshot'
);

-- Blocked requests write nothing and report only codes and item ids.
select is(pg_temp.req(pg_temp.cv_rev(), 'key-first'), (select 'ok' from pg_temp.x limit 1), 'the same key and revision is idempotent');
update public.education set institution = 'Kampus Baru' where id = pg_temp.u('d001');
create temporary table pg_temp.before_block as select pg_temp.fp() as fingerprint, pg_temp.n_exports() as exports;
select is(
  split_part(pg_temp.req(pg_temp.cv_rev(), 'key-blocked'), '|', 1) || '|' || split_part(pg_temp.req(pg_temp.cv_rev(), 'key-blocked'), '|', 2),
  'P0001|CV_EXPORT_BLOCKED', 'a CV with a changed item is blocked'
);
select is(
  ((split_part(pg_temp.req(pg_temp.cv_rev(), 'key-blocked'), '|', 3))::jsonb -> 'blockers' -> 0 ->> 'code'),
  'ITEM_CHANGED', 'the blocked detail lists the blocker code'
);
select is(
  ((split_part(pg_temp.req(pg_temp.cv_rev(), 'key-blocked'), '|', 3))::jsonb -> 'blockers' -> 0 ->> 'item_id'),
  pg_temp.i('ed')::text, 'the blocked detail lists the caller-owned item id'
);
select ok(
  split_part(pg_temp.req(pg_temp.cv_rev(), 'key-blocked'), '|', 3) not like '%Kampus%'
  and split_part(pg_temp.req(pg_temp.cv_rev(), 'key-blocked'), '|', 3) not like '%Universitas%',
  'the blocked detail carries no CV text'
);
select is(pg_temp.n_exports(), (select exports from pg_temp.before_block), 'a blocked request inserted nothing');
select is(pg_temp.fp(), (select fingerprint from pg_temp.before_block), 'a blocked request wrote nothing to the CV');
select is(pg_temp.keep('ed'), 'ok', 'Keep saved wording clears the block');
select is(pg_temp.req(pg_temp.cv_rev() - 1, 'key-stale'), 'P0001|STALE_REVISION|', 'a stale expected revision is rejected');
select is(pg_temp.req(null, 'key-null'), '22023|INVALID_CV_INPUT|', 'a null expected revision is rejected');
select is(pg_temp.req(0, 'key-zero'), '22023|INVALID_CV_INPUT|', 'a zero expected revision is rejected');
select is(pg_temp.req(pg_temp.cv_rev(), null), '22023|INVALID_CV_INPUT|', 'a null idempotency key is rejected');
select is(pg_temp.req(pg_temp.cv_rev(), ''), '22023|INVALID_CV_INPUT|', 'an empty idempotency key is rejected');
select is(pg_temp.req(pg_temp.cv_rev(), 'bad key!'), '22023|INVALID_CV_INPUT|', 'a key with unsafe characters is rejected');
select is(pg_temp.req(pg_temp.cv_rev(), repeat('k', 201)), '22023|INVALID_CV_INPUT|', 'a key longer than 200 characters is rejected');

-- 5. Idempotency and one active export -------------------------------------------------------------

-- The earlier export is still queued at the older revision: a different key at the new revision is refused.
select is(pg_temp.req(pg_temp.cv_rev(), 'key-newer'), 'P0001|CV_EXPORT_IN_PROGRESS|', 'a newer revision while an export is active is refused');
select is(
  (select reused::text || ',' || (export_id = (select id from pg_temp.x where label = 'first'))::text
   from public.request_cv_export((select cv_revision from pg_temp.before_request), 'key-first')),
  'true,true', 'the same key and original revision returns the existing export'
);
select is(pg_temp.req(pg_temp.cv_rev(), 'key-first'), 'P0001|IDEMPOTENCY_KEY_REUSED|', 'the same key with another revision is rejected');
select is(pg_temp.n_exports(), 1, 'idempotent and refused requests created no extra export');

-- Same revision, different key while active: returns the active export. Rebuild the situation on owner B.
select pg_temp.set_jwt_subject(pg_temp.usr('b1'));
insert into pg_temp.x select 'b1', pg_temp.req_id(pg_temp.cv_rev(), 'b-key-1');
select is(
  (select reused::text || ',' || (export_id = (select id from pg_temp.x where label = 'b1'))::text
   from public.request_cv_export(pg_temp.cv_rev(), 'b-key-2')),
  'true,true', 'a different key at the same revision returns the active export instead of a second job'
);
select is((select count(*)::integer from public.cv_exports where user_id = pg_temp.usr('b1')), 1, 'owner B still has one export');
select throws_ok(
  format($i$insert into public.cv_exports (user_id, cv_id, cv_revision, snapshot, idempotency_key)
    select user_id, cv_id, cv_revision, snapshot, 'b-direct' from public.cv_exports where id = %L$i$, (select id from pg_temp.x where label = 'b1')),
  '23505', null, 'the partial unique index rejects a second active export for one CV'
);
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));

-- 6. Immutability and state constraints ---------------------------------------------------------------

select is(
  pg_temp.try(format('update public.cv_exports set snapshot = %L::jsonb where id = %L', '{}', (select id from pg_temp.x where label = 'first'))),
  'P0001|CV_EXPORT_IMMUTABLE|', 'the snapshot cannot be changed'
);
select is(
  pg_temp.try(format('update public.cv_exports set cv_revision = cv_revision + 1 where id = %L', (select id from pg_temp.x where label = 'first'))),
  'P0001|CV_EXPORT_IMMUTABLE|', 'the bound CV revision cannot be changed'
);
select is(
  pg_temp.try(format('update public.cv_exports set idempotency_key = %L where id = %L', 'other', (select id from pg_temp.x where label = 'first'))),
  'P0001|CV_EXPORT_IMMUTABLE|', 'the idempotency key cannot be changed'
);
select is(
  pg_temp.try(format('update public.cv_exports set user_id = %L where id = %L', pg_temp.usr('b1'), (select id from pg_temp.x where label = 'first'))),
  'P0001|CV_EXPORT_IMMUTABLE|', 'the owner cannot be changed'
);
select is(
  split_part(pg_temp.try(format($u$update public.cv_exports set status = 'succeeded' where id = %L$u$, (select id from pg_temp.x where label = 'first'))), '|', 1),
  '23514', 'the state check rejects a succeeded row without object, pages and expiry'
);
select is(
  split_part(pg_temp.try(format($u$update public.cv_exports set status = 'running' where id = %L$u$, (select id from pg_temp.x where label = 'first'))), '|', 1),
  '23514', 'the state check rejects a running row without token and lease'
);
select is(
  split_part(pg_temp.try(format($u$update public.cv_exports set object_key = %L where id = %L$u$, pg_temp.usr('b1') || '/export/' || gen_random_uuid(),
    (select id from pg_temp.x where label = 'first'))), '|', 1),
  '23514', 'the state check rejects an object key on a queued row'
);

-- 7. Durable job ----------------------------------------------------------------------------------------

create temporary table pg_temp.tok as select pg_temp.claim((select id from pg_temp.x where label = 'first')) as token;
select ok((select token is not null from pg_temp.tok), 'claim returns an attempt token for the queued export');
select is(
  (select status || ',' || attempt_count from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  'running,1', 'a claimed export is running with attempt 1'
);
select ok(
  (select lease_expires_at - clock_timestamp() between interval '115 seconds' and interval '121 seconds'
   from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  'the lease is 120 seconds'
);
select is((select count(*)::integer from public.claim_cv_export_jobs(10) where id = (select id from pg_temp.x where label = 'first')), 0,
  'a second claim does not take the running export');
select is((select count(*)::integer from public.claim_cv_export_jobs(1)), 0, 'claim accepts a limit of 1 and finds nothing left to take');
select is(pg_temp.try('select * from public.claim_cv_export_jobs(0)'), '22023|INVALID_CV_EXPORT_CLAIM_LIMIT|', 'claim rejects a limit below 1');
select is(pg_temp.try('select * from public.claim_cv_export_jobs(11)'), '22023|INVALID_CV_EXPORT_CLAIM_LIMIT|', 'claim rejects a limit above 10');

select is(
  (select count(*)::integer from public.get_cv_export_input((select id from pg_temp.x where label = 'first'), gen_random_uuid())),
  0, 'the wrong attempt token releases no input'
);
select is(
  (select snapshot = (select snapshot from pg_temp.exp((select id from pg_temp.x where label = 'first')))
          and cv_revision = (select cv_revision from pg_temp.before_request)
   from public.get_cv_export_input((select id from pg_temp.x where label = 'first'), (select token from pg_temp.tok))),
  true, 'the right token releases exactly the stored snapshot'
);

select is(
  public.complete_cv_export((select id from pg_temp.x where label = 'first'), gen_random_uuid(),
    pg_temp.usr('a1') || '/export/' || gen_random_uuid(), 1, 1000),
  'stale', 'completion with the wrong token is stale'
);
select is(
  split_part(pg_temp.try(format('select public.complete_cv_export(%L, %L, %L, 1, 1000)',
    (select id from pg_temp.x where label = 'first'), (select token from pg_temp.tok), pg_temp.usr('a1') || '/export/' || gen_random_uuid())), '|', 1),
  '22023', 'completion with an object key that is not owner/export/token is rejected'
);
select is(
  split_part(pg_temp.try(format('select public.complete_cv_export(%L, %L, %L, 21, 1000)',
    (select id from pg_temp.x where label = 'first'), (select token from pg_temp.tok),
    pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok))), '|', 1),
  '22023', 'completion with more than 20 pages is rejected'
);
select is(
  split_part(pg_temp.try(format('select public.complete_cv_export(%L, %L, %L, 1, 10485761)',
    (select id from pg_temp.x where label = 'first'), (select token from pg_temp.tok),
    pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok))), '|', 1),
  '22023', 'completion above 10 MiB is rejected'
);
select is(
  public.complete_cv_export((select id from pg_temp.x where label = 'first'), (select token from pg_temp.tok),
    pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok), 2, 54321),
  'succeeded', 'completion with the current token and the canonical key succeeds'
);
select ok(
  (select status = 'succeeded' and page_count = 2 and byte_size = 54321 and lease_expires_at is null and error_code is null
          and object_key = pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok)
          and expires_at = finished_at + interval '24 hours'
   from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  'a succeeded export stores its object, pages, size and a 24 hour expiry'
);
select is(
  public.complete_cv_export((select id from pg_temp.x where label = 'first'), (select token from pg_temp.tok),
    pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok), 2, 54321),
  'stale', 'completing twice is stale'
);
select is(public.fail_cv_export((select id from pg_temp.x where label = 'first'), (select token from pg_temp.tok), 'RENDERER_UNAVAILABLE'), false,
  'a succeeded export cannot be failed');

-- Succeeded and not expired with the same revision: returned as is. The CV is at a newer revision, so the same
-- revision is only reachable through the key.
select is(
  (select reused::text || ',' || status from public.request_cv_export((select cv_revision from pg_temp.before_request), 'key-first')),
  'true,succeeded', 'the same key returns the finished export'
);

-- Lease expiry and stale workers (fresh export on the new revision).
create temporary table pg_temp.y as select 'second'::text as label, pg_temp.req_id(pg_temp.cv_rev(), 'key-second') as id;
select is((select status from pg_temp.exp((select id from pg_temp.y))), 'queued', 'a new revision can be requested after the old export finished');
create temporary table pg_temp.tok2 as select pg_temp.claim((select id from pg_temp.y)) as token;
update public.cv_exports set lease_expires_at = clock_timestamp() - interval '1 second' where id = (select id from pg_temp.y);
select is(
  public.complete_cv_export((select id from pg_temp.y), (select token from pg_temp.tok2),
    pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok2), 1, 100),
  'stale', 'a worker whose lease ran out cannot complete'
);
select is(public.fail_cv_export((select id from pg_temp.y), (select token from pg_temp.tok2), 'RENDERER_UNAVAILABLE'), false,
  'a worker whose lease ran out cannot fail the job either');
select is(
  (select count(*)::integer from public.get_cv_export_input((select id from pg_temp.y), (select token from pg_temp.tok2))),
  0, 'a worker whose lease ran out receives no input');
select is(public.expire_cv_export_leases(), 1, 'one expired lease is failed');
select is(
  (select status || ',' || error_code || ',' || attempt_count from pg_temp.exp((select id from pg_temp.y))),
  'failed,EXPORT_TIMEOUT,1', 'the expired lease fails with EXPORT_TIMEOUT'
);
select is(public.expire_cv_export_leases(), 0, 'expiry is idempotent');

select is(pg_temp.try(format('select public.fail_cv_export(%L, %L, %L)', (select id from pg_temp.y), gen_random_uuid(), 'NOT_ALLOWED')), '22023|INVALID_CV_EXPORT_FAILURE|',
  'an error code outside the allowlist is rejected');
select is(pg_temp.try(format('select public.fail_cv_export(%L, %L, %L)', (select id from pg_temp.y), gen_random_uuid(), 'bad code')), '22023|INVALID_CV_EXPORT_FAILURE|',
  'a malformed error code is rejected');

-- 8. Retry ---------------------------------------------------------------------------------------------------

create temporary table pg_temp.before_retry as
  select md5(snapshot::text) as snapshot_hash, cv_revision, attempt_count, idempotency_key
  from pg_temp.exp((select id from pg_temp.y));
select is(
  (select status || ',' || attempt_count from public.retry_cv_export((select id from pg_temp.y))),
  'queued,1', 'a failed retriable export returns to the queue'
);
select ok(
  (select md5(snapshot::text) = (select snapshot_hash from pg_temp.before_retry)
          and cv_revision = (select cv_revision from pg_temp.before_retry)
          and idempotency_key = (select idempotency_key from pg_temp.before_retry)
          and attempt_token is null and lease_expires_at is null and error_code is null and finished_at is null
   from pg_temp.exp((select id from pg_temp.y))),
  'retry keeps the same snapshot and clears the attempt state'
);
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.y))), 'P0001|CV_EXPORT_NOT_RETRYABLE|',
  'retrying a queued export is rejected');
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.x where label = 'first'))), 'P0001|CV_EXPORT_NOT_RETRYABLE|',
  'retrying a succeeded export is rejected');
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', gen_random_uuid())), 'P0001|CV_EXPORT_NOT_FOUND|', 'a random id is not found');
select is(pg_temp.try('select * from public.retry_cv_export(null)'), 'P0001|CV_EXPORT_NOT_FOUND|', 'a null id is not found');

-- Permanent code and the third attempt.
create temporary table pg_temp.tok3 as select pg_temp.claim((select id from pg_temp.y)) as token;
select is(public.fail_cv_export((select id from pg_temp.y), (select token from pg_temp.tok3), 'EXPORT_TOO_LONG'), true, 'the worker fails the job with a permanent code');
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.y))), 'P0001|CV_EXPORT_NOT_RETRYABLE|',
  'a permanent failure is not retryable');
update public.cv_exports set error_code = 'RENDERER_TIMEOUT', attempt_count = 3 where id = (select id from pg_temp.y);
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.y))), 'P0001|CV_EXPORT_NOT_RETRYABLE|',
  'the third failed attempt is not retryable');
update public.cv_exports set error_code = 'RENDERER_TIMEOUT', attempt_count = 2 where id = (select id from pg_temp.y);
select is((select status || ',' || attempt_count from public.retry_cv_export((select id from pg_temp.y))), 'queued,2', 'a retriable failure with two attempts can retry');
create temporary table pg_temp.tok4 as select pg_temp.claim((select id from pg_temp.y)) as token;
select is((select attempt_count from pg_temp.exp((select id from pg_temp.y))), 3, 'the third attempt is the last one');
select is(public.fail_cv_export((select id from pg_temp.y), (select token from pg_temp.tok4), 'RENDERER_UNAVAILABLE'), true, 'the third attempt can fail');
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.y))), 'P0001|CV_EXPORT_NOT_RETRYABLE|',
  'after three attempts only a new request remains');

-- A failed export does not block a new request; the old export stays failed.
create temporary table pg_temp.z as select 'third'::text as label, pg_temp.req_id(pg_temp.cv_rev(), 'key-third') as id;
select ok((select status = 'queued' from pg_temp.exp((select id from pg_temp.z))), 'a new request after a failed export creates a fresh export');
select is((select status from pg_temp.exp((select id from pg_temp.y))), 'failed', 'the old failed export is untouched');
-- Another export active for the CV blocks the retry of a failed one.
update public.cv_exports set error_code = 'RENDERER_TIMEOUT', attempt_count = 1 where id = (select id from pg_temp.y);
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.y))), 'P0001|CV_EXPORT_IN_PROGRESS|',
  'a retry while another export is active is refused');

-- Ownership.
select pg_temp.set_jwt_subject(pg_temp.usr('b1'));
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.y))), 'P0001|CV_EXPORT_NOT_FOUND|',
  'another account cannot retry the export and cannot tell it exists');
grant select on pg_temp.y to authenticated;
set local role authenticated;
select is((select count(*)::integer from public.cv_exports where id = (select id from pg_temp.y)), 0, 'RLS hides the export from another account');
reset role;
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));

-- 9. Download -------------------------------------------------------------------------------------------------

select is(
  public.get_cv_export_download((select id from pg_temp.x where label = 'first')),
  pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok), 'the owner gets the object key of a succeeded export'
);
select is(pg_temp.try(format('select public.get_cv_export_download(%L)', (select id from pg_temp.z))), 'P0001|CV_EXPORT_NOT_READY|', 'a queued export is not ready');
select is(pg_temp.try(format('select public.get_cv_export_download(%L)', (select id from pg_temp.y))), 'P0001|CV_EXPORT_NOT_READY|', 'a failed export is not ready');
select is(pg_temp.try(format('select public.get_cv_export_download(%L)', gen_random_uuid())), 'P0001|CV_EXPORT_NOT_FOUND|', 'a random id is not found');
select pg_temp.set_jwt_subject(pg_temp.usr('b1'));
select is(pg_temp.try(format('select public.get_cv_export_download(%L)', (select id from pg_temp.x where label = 'first'))), 'P0001|CV_EXPORT_NOT_FOUND|',
  'another account cannot download and cannot tell the export exists');
select pg_temp.set_jwt_subject(null);
select is(pg_temp.try(format('select public.get_cv_export_download(%L)', (select id from pg_temp.x where label = 'first'))), '42501|AUTH_REQUIRED|', 'no session is rejected');
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));

-- 10. Expiry, cleanup and orphans ---------------------------------------------------------------------------------

select is(public.expire_cv_exports(10), 0, 'nothing is due before the 24 hours have passed');
update public.cv_exports set expires_at = clock_timestamp() - interval '1 minute' where id = (select id from pg_temp.x where label = 'first');
select is(pg_temp.try(format('select public.get_cv_export_download(%L)', (select id from pg_temp.x where label = 'first'))), 'P0001|CV_EXPORT_EXPIRED|',
  'an expired export cannot be downloaded even before purge');
select is(public.expire_cv_exports(10), 1, 'one expired export is purged');
select ok(
  (select purged_at is not null and status = 'succeeded' and object_key is not null from pg_temp.exp((select id from pg_temp.x where label = 'first'))),
  'purge marks the export, keeps the row'
);
select is(public.expire_cv_exports(10), 0, 'purge is idempotent');
select is(
  (select count(*)::integer from internal.storage_jobs
   where object_key = pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok) and kind = 'delete' and status = 'queued'),
  1, 'purge queued exactly one storage delete job'
);
select is(pg_temp.try('select public.expire_cv_exports(0)'), '22023|INVALID_CV_EXPORT_HOUSEKEEPING|', 'purge rejects a limit below 1');
select is(pg_temp.try(format('select public.get_cv_export_download(%L)', (select id from pg_temp.x where label = 'first'))), 'P0001|CV_EXPORT_EXPIRED|',
  'a purged export reports CV_EXPORT_EXPIRED');
select ok((pg_temp.doc()).revision = pg_temp.cv_rev() and (select count(*) from public.cv_items where cv_id = (pg_temp.doc()).id) = 6,
  'expiry never removes the CV or its items');

-- An import-category job must not be claimed by the export cleanup.
select internal.enqueue_storage_delete(pg_temp.usr('a1'), pg_temp.usr('a1') || '/import/' || gen_random_uuid());
create temporary table pg_temp.cleanup as select * from public.claim_export_cleanup_jobs(100);
select is((select count(*)::integer from pg_temp.cleanup where split_part(object_key, '/', 2) <> 'export'), 0, 'export cleanup claims only export objects');
select ok((select count(*) from pg_temp.cleanup where object_key = pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok)) = 1,
  'export cleanup claims the purged export object');
select is(
  public.complete_export_cleanup_job((select id from internal.storage_jobs where split_part(object_key, '/', 2) = 'import' and user_id = pg_temp.usr('a1') limit 1), gen_random_uuid()),
  false, 'export cleanup cannot complete an import job');
select is(
  public.complete_export_cleanup_job((select id from pg_temp.cleanup limit 1), (select attempt_token from pg_temp.cleanup limit 1)),
  true, 'export cleanup completes its own claimed job');
select internal.enqueue_storage_delete(pg_temp.usr('a1'), pg_temp.usr('a1') || '/export/7c400000-0000-4000-8000-0000000000ad');
create temporary table pg_temp.cleanup2 as select * from public.claim_export_cleanup_jobs(10);
select is((select count(*)::integer from pg_temp.cleanup2), 1, 'export cleanup claims the newly queued export object');
select is(
  public.retry_export_cleanup_job((select id from pg_temp.cleanup2), (select attempt_token from pg_temp.cleanup2), 'STORAGE_UNAVAILABLE',
    clock_timestamp() + interval '1 minute'),
  true, 'export cleanup can requeue a claimed job with a backoff');
select is((select count(*)::integer from public.claim_export_cleanup_jobs(10)), 0, 'a backed-off cleanup job is not claimed again yet');
select is(
  public.fail_export_cleanup_job((select id from internal.storage_jobs where split_part(object_key, '/', 2) = 'import' and user_id = pg_temp.usr('a1') limit 1), gen_random_uuid(), 'X'),
  false, 'export cleanup cannot fail an import job');

insert into storage.objects (bucket_id, name, created_at)
values ('workpulse-private', pg_temp.usr('a1') || '/export/' || '7c400000-0000-4000-8000-0000000000aa', now() - interval '2 hours'),
       ('workpulse-private', pg_temp.usr('a1') || '/export/' || '7c400000-0000-4000-8000-0000000000ab', now() - interval '1 minute'),
       ('workpulse-private', pg_temp.usr('a1') || '/import/' || '7c400000-0000-4000-8000-0000000000ac', now() - interval '2 hours');
select is(public.reconcile_orphan_export_objects(3600, 100), 1, 'reconciliation queues only the old orphan export object');
select is(public.reconcile_orphan_export_objects(3600, 100), 0, 'reconciliation does not duplicate the receipt');
select is(
  (select count(*)::integer from internal.storage_jobs where object_key = pg_temp.usr('a1') || '/export/7c400000-0000-4000-8000-0000000000aa' and status = 'queued'),
  1, 'the orphan has one queued delete job');
select is(pg_temp.try('select public.reconcile_orphan_export_objects(10, 100)'), '22023|INVALID_EXPORT_ORPHAN_RECONCILIATION|', 'reconciliation rejects an age below 15 minutes');

select is(public.expire_cv_export_leases(), 0, 'no lease is due');

-- 11. Dedup after expiry --------------------------------------------------------------------------------------

-- Finish the queued third export on the current revision, then expire it: a new key at the same revision builds a new export.
create temporary table pg_temp.tok5 as select pg_temp.claim((select id from pg_temp.z)) as token;
select is(
  public.complete_cv_export((select id from pg_temp.z), (select token from pg_temp.tok5),
    pg_temp.usr('a1') || '/export/' || (select token from pg_temp.tok5), 1, 2000),
  'succeeded', 'the third export completes');
select is(
  (select reused::text || ',' || (export_id = (select id from pg_temp.z))::text from public.request_cv_export(pg_temp.cv_rev(), 'key-fourth')),
  'true,true', 'a succeeded, unexpired export for the same revision is returned instead of a new one'
);
update public.cv_exports set expires_at = clock_timestamp() - interval '1 second' where id = (select id from pg_temp.z);
select is(public.expire_cv_exports(10), 1, 'the third export expires');
create temporary table pg_temp.w as select 'fifth'::text as label, pg_temp.req_id(pg_temp.cv_rev(), 'key-fifth') as id;
select ok((select id <> (select id from pg_temp.z) from pg_temp.w), 'after expiry a new key at the same revision builds a new export');
select is((select status from pg_temp.exp((select id from pg_temp.w))), 'queued', 'the regenerated export is queued');

-- A CV that is blocked right now never gets an older export as a shortcut.
update public.education set institution = 'Kampus Lagi' where id = pg_temp.u('d001');
select is(split_part(pg_temp.req(pg_temp.cv_rev(), 'key-sixth'), '|', 2), 'CV_EXPORT_BLOCKED', 'a blocked CV is blocked even when an export is active');

-- 12. Account states ---------------------------------------------------------------------------------------------

select pg_temp.set_jwt_subject(null);
select is(pg_temp.req(1, 'key-anon'), '42501|AUTH_REQUIRED|', 'no session cannot request an export');
select pg_temp.set_jwt_subject(pg_temp.usr('e1'));
select is(pg_temp.req(1, 'key-e1'), '22023|ONBOARDING_REQUIRED|', 'an account that has not finished onboarding cannot request an export');
select pg_temp.set_jwt_subject(pg_temp.usr('c1'));
select is(pg_temp.req(1, 'key-c1'), 'P0001|CV_NOT_FOUND|', 'an onboarded account without a CV gets CV_NOT_FOUND');
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', gen_random_uuid())), 'P0001|CV_EXPORT_NOT_FOUND|', 'an account without a CV has no export to retry');

select pg_temp.set_jwt_subject(pg_temp.usr('f1'));
create temporary table pg_temp.dy as select 'g1'::text as label, pg_temp.req_id(pg_temp.cv_rev(), 'g-key') as id;
select pg_temp.set_jwt_subject(pg_temp.usr('d1'));
create temporary table pg_temp.dx as select 'd1'::text as label, pg_temp.req_id(pg_temp.cv_rev(), 'd-key') as id;
create temporary table pg_temp.dtok as select pg_temp.claim((select id from pg_temp.dx)) as token;
create temporary table pg_temp.dtok2 as select pg_temp.claim((select id from pg_temp.dy)) as token;
update public.profiles set deleting_at = now() where id in (pg_temp.usr('d1'), pg_temp.usr('f1'));
select is(pg_temp.req(pg_temp.cv_rev(), 'd-key-2'), '42501|AUTH_REQUIRED|', 'a deleting account cannot request an export');
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.dx))), '42501|AUTH_REQUIRED|', 'a deleting account cannot retry');
select is(
  (select count(*)::integer from public.get_cv_export_input((select id from pg_temp.dx), (select token from pg_temp.dtok))),
  0, 'a deleting account releases no input'
);
select is(
  (select status || ',' || error_code from pg_temp.exp((select id from pg_temp.dx))),
  'failed,ACCOUNT_DELETING', 'the worker input check fails the job with ACCOUNT_DELETING'
);
select is(pg_temp.try(format('select * from public.get_cv_export_readiness()')), 'ok', 'readiness is callable for a deleting account');
select is((select count(*)::integer from public.get_cv_export_readiness()), 0, 'readiness returns nothing for a deleting account');

-- Completion for a deleting account fails the job instead of succeeding.
select is(
  public.complete_cv_export((select id from pg_temp.dy), (select token from pg_temp.dtok2),
    pg_temp.usr('f1') || '/export/' || (select token from pg_temp.dtok2), 1, 100),
  'failed:ACCOUNT_DELETING', 'completion for a deleting account fails with ACCOUNT_DELETING'
);
select is(
  (select status || ',' || error_code || ',' || coalesce(object_key, 'none') from pg_temp.exp((select id from pg_temp.dy))),
  'failed,ACCOUNT_DELETING,none', 'the deleting account''s export is failed without an object'
);
select is(pg_temp.try(format('select * from public.retry_cv_export(%L)', (select id from pg_temp.dy))), '42501|AUTH_REQUIRED|',
  'a failed ACCOUNT_DELETING export cannot be retried by a deleting account');
select is(
  public.fail_cv_export((select id from pg_temp.dy), (select token from pg_temp.dtok2), 'ACCOUNT_DELETING'), false,
  'a job that already failed cannot be failed again');

-- 13. Isolation and ownership of the rows ----------------------------------------------------------------------------

select pg_temp.set_jwt_subject(pg_temp.usr('b1'));
set local role authenticated;
select is((select count(*)::integer from public.cv_exports where user_id <> pg_temp.usr('b1')), 0, 'RLS: owner B sees no export of another account');
select is((select count(*)::integer from public.cv_exports), 1, 'RLS: owner B sees only their own export');
select is(
  (select count(*)::integer from public.cv_exports where snapshot::text like '%Ani Contoh%'), 0,
  'RLS: another account''s snapshot text is not readable');
reset role;
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));

select * from finish();
rollback;

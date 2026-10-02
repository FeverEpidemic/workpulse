begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T20 CV freshness and source deletion (PRD R03/R09, F03/F07, DB §2/§5/§6, decision 0026).
-- Sources are edited directly as the test owner; CV RPCs, delete RPCs and relink RPCs run with a JWT subject.

-- 1. Structure and privileges -------------------------------------------------

select ok(
  (select count(*) from pg_catalog.pg_proc as proc join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public' and proc.proname in ('get_cv_freshness', 'get_cv_review_summary', 'resolve_cv_freshness')
      and proc.prosecdef) = 3,
  'the three T20 RPCs exist and are security definer'
);
select ok(
  has_function_privilege('authenticated', 'public.get_cv_freshness()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_cv_review_summary()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.resolve_cv_freshness(integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_cv_freshness()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_cv_review_summary()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.resolve_cv_freshness(integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_cv_freshness()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_cv_review_summary()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.resolve_cv_freshness(integer,jsonb)', 'EXECUTE'),
  'the T20 RPCs are executable by authenticated only'
);
select ok(
  not (has_function_privilege('anon', 'internal.cv_live_source(public.cv_items)', 'EXECUTE')
    or has_function_privilege('authenticated', 'internal.cv_live_source(public.cv_items)', 'EXECUTE')
    or has_function_privilege('service_role', 'internal.cv_live_source(public.cv_items)', 'EXECUTE')
    or has_function_privilege('anon', 'internal.cv_item_state(public.cv_items)', 'EXECUTE')
    or has_function_privilege('authenticated', 'internal.cv_item_state(public.cv_items)', 'EXECUTE')
    or has_function_privilege('service_role', 'internal.cv_item_state(public.cv_items)', 'EXECUTE')
    or has_function_privilege('anon', 'internal.cv_profile_display(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'internal.cv_profile_display(uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'internal.cv_profile_display(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'internal.cv_profile_state(public.cv_documents)', 'EXECUTE')
    or has_function_privilege('authenticated', 'internal.cv_profile_state(public.cv_documents)', 'EXECUTE')
    or has_function_privilege('service_role', 'internal.cv_profile_state(public.cv_documents)', 'EXECUTE')
    or has_function_privilege('anon', 'internal.cv_lock_for_source_change(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'internal.cv_lock_for_source_change(uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'internal.cv_lock_for_source_change(uuid)', 'EXECUTE')),
  'internal state and lock helpers are not executable by API roles'
);
select ok(
  not has_table_privilege('authenticated', 'public.cv_documents', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.cv_items', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.cv_items', 'INSERT'),
  'no client write grant was added to the CV tables'
);
select ok(
  has_function_privilege('authenticated', 'public.delete_experience(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.delete_project(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.delete_achievement(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.select_cv_source(integer,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.delete_achievement(uuid,integer)', 'EXECUTE'),
  'replaced delete and select functions keep their grants'
);

-- 2. Fixtures -------------------------------------------------------------------

create or replace function pg_temp.usr(p_suffix text) returns uuid language sql as $$
  select ('7c100000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;
create or replace function pg_temp.u(p_suffix text) returns uuid language sql as $$
  select ('7c200000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select pg_temp.usr(suffix), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'cvf-' || suffix || '@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (values ('a1'), ('b1'), ('c1'), ('d1'), ('e1')) as users(suffix);

update public.profiles set display_name = 'Ani Contoh', locale = 'id', headline = 'Lulusan Informatika',
  contact_email = 'ani@example.com', summary = 'Ringkasan sumber', onboarding_completed_at = now()
where id = pg_temp.usr('a1');
update public.profiles set display_name = 'Budi Contoh', onboarding_completed_at = now()
where id in (pg_temp.usr('b1'), pg_temp.usr('c1'), pg_temp.usr('d1'));
update public.profiles set deleting_at = now() where id = pg_temp.usr('d1');

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

-- Owner A sources: employment E1 with project P1 (achievement AC1), standalone achievement AC2, plus
-- unselected records (E2, P2, P3, AC3, AC4, ED2, SK2, CE2) for the delete and relink checks.
insert into public.experiences (id, user_id, organization, role_title, kind, description) values
  (pg_temp.u('e001'), pg_temp.usr('a1'), 'Org Contoh', 'Engineer', 'employment', 'Deskripsi peran'),
  (pg_temp.u('e002'), pg_temp.usr('a1'), 'Org Lain', 'Analis', 'employment', null);
insert into public.projects (id, user_id, experience_id, title, description, user_role, outcome, status) values
  (pg_temp.u('b001'), pg_temp.usr('a1'), pg_temp.u('e001'), 'Sistem Antrian', 'Deskripsi', 'Peneliti', 'Lulus', 'completed'),
  (pg_temp.u('b002'), pg_temp.usr('a1'), null, 'Proyek Kedua', 'Deskripsi kedua', null, null, 'active'),
  (pg_temp.u('b003'), pg_temp.usr('a1'), null, 'Proyek Ketiga', null, null, null, 'planned');
insert into public.achievements (id, user_id, experience_id, project_id, title, contribution, scope, outcome, cv_bullet, achieved_on, status) values
  (pg_temp.u('c001'), pg_temp.usr('a1'), pg_temp.u('e001'), pg_temp.u('b001'), 'Menurunkan waktu antre', 'Kontribusi', 'Lingkup', 'Waktu turun 30 persen',
   'Merancang simulasi antrian', '2023-05-10', 'confirmed'),
  (pg_temp.u('c002'), pg_temp.usr('a1'), null, null, 'Standalone', 'Kontribusi dua', 'Lingkup dua', 'Hasil dua',
   'Menulis laporan mingguan', '2023-06-10', 'confirmed'),
  (pg_temp.u('c003'), pg_temp.usr('a1'), null, null, 'Belum dipilih', 'Kontribusi tiga', 'Lingkup tiga', 'Hasil tiga',
   'Mengotomatiskan rekap', '2023-07-10', 'confirmed'),
  (pg_temp.u('c004'), pg_temp.usr('a1'), null, null, 'Untuk dihapus', 'Kontribusi empat', 'Lingkup empat', 'Hasil empat',
   'Membersihkan data lama', '2023-08-10', 'confirmed');
insert into public.education (id, user_id, institution, qualification, field_of_study) values
  (pg_temp.u('d001'), pg_temp.usr('a1'), 'Universitas Contoh', 'S1', 'Informatika'),
  (pg_temp.u('d002'), pg_temp.usr('a1'), 'Kampus Dua', 'D3', null);
insert into public.skills (id, user_id, name) values
  (pg_temp.u('f001'), pg_temp.usr('a1'), 'SQL'),
  (pg_temp.u('f002'), pg_temp.usr('a1'), 'Python');
insert into public.certifications (id, user_id, name) values
  (pg_temp.u('a001'), pg_temp.usr('a1'), 'Sertifikat Satu'),
  (pg_temp.u('a002'), pg_temp.usr('a1'), 'Sertifikat Dua');

-- Owner B: CV with one education item, one confirmed achievement left unselected, one draft achievement.
insert into public.education (id, user_id, institution, qualification) values
  (pg_temp.u('bd01'), pg_temp.usr('b1'), 'B Uni', 'S1');
insert into public.achievements (id, user_id, title, contribution, scope, outcome, cv_bullet, achieved_on, status) values
  (pg_temp.u('bc01'), pg_temp.usr('b1'), 'B confirmed', 'k', 's', 'o', 'B bullet', '2023-01-10', 'confirmed');
insert into public.achievements (id, user_id, title, status) values
  (pg_temp.u('bc02'), pg_temp.usr('b1'), 'B draft', 'draft');

-- Owner C: no CV, two confirmed achievements and one education.
insert into public.achievements (id, user_id, title, contribution, scope, outcome, cv_bullet, achieved_on, status) values
  (pg_temp.u('cc01'), pg_temp.usr('c1'), 'C one', 'k', 's', 'o', 'C bullet one', '2023-01-10', 'confirmed'),
  (pg_temp.u('cc02'), pg_temp.usr('c1'), 'C two', 'k', 's', 'o', 'C bullet two', '2023-02-10', 'confirmed');
insert into public.education (id, user_id, institution, qualification) values
  (pg_temp.u('cd01'), pg_temp.usr('c1'), 'C Uni', 'S1');

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
create or replace function pg_temp.st(p_key text) returns text language sql as $$
  select internal.cv_item_state(item) from public.cv_items as item where item.id = pg_temp.i(p_key)
$$;
create or replace function pg_temp.live(p_key text) returns integer language sql as $$
  select source.live_revision from public.cv_items as item, internal.cv_live_source(item) as source where item.id = pg_temp.i(p_key)
$$;
create or replace function pg_temp.pst() returns text language sql as $$
  select internal.cv_profile_state(document) from public.cv_documents as document where document.user_id = pg_temp.me()
$$;
create or replace function pg_temp.fp() returns text language sql as $$
  select md5(
    coalesce((select string_agg(d::text, '|' order by d.id) from public.cv_documents as d), '')
    || coalesce((select string_agg(i::text, '|' order by i.id) from public.cv_items as i), ''))
$$;
create or replace function pg_temp.el(p_key text, p_action text) returns text language sql as $$
  select format('{"target":"item","item_id":"%s","source_revision":%s,"action":"%s"}',
    pg_temp.i(p_key), coalesce(pg_temp.live(p_key), 1), p_action)
$$;
create or replace function pg_temp.pel(p_action text) returns text language sql as $$
  select format('{"target":"profile","source_revision":%s,"action":"%s"}',
    (select revision from public.profiles where id = pg_temp.me()), p_action)
$$;
create or replace function pg_temp.arr(variadic p_els text[]) returns text language sql as $$
  select '[' || array_to_string(p_els, ',') || ']'
$$;
create or replace function pg_temp.res(p_rev integer, p_json text) returns text language sql as $$
  select pg_temp.try(format('select * from public.resolve_cv_freshness(%L, %L::jsonb)', p_rev, p_json))
$$;
create or replace function pg_temp.res(p_json text) returns text language sql as $$
  select pg_temp.res(pg_temp.cv_rev(), p_json)
$$;
create or replace function pg_temp.override(p_key text, p_text text) returns integer language sql as $$
  select public.save_cv_edits(pg_temp.cv_rev(), jsonb_build_object('item_overrides',
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(p_key), 'override_text', p_text))))
$$;

select is(pg_temp.cv_rev(), 8, 'owner A CV is at revision 8 after seven selections');

-- 3. State basics ------------------------------------------------------------------

select is(
  (select string_agg(key || '=' || pg_temp.st(key), ',' order by key) from pg_temp.k),
  'ac1=fresh,ac2=fresh,ce=fresh,ed=fresh,ex=fresh,pj=fresh,sk=fresh',
  'every freshly selected item is fresh'
);
select is(pg_temp.pst(), 'fresh', 'the profile is fresh after the CV is opened');

update public.profiles set locale = 'en', timezone = 'UTC' where id = pg_temp.usr('a1');
select is(pg_temp.pst(), 'fresh', 'a locale or timezone edit leaves the profile fresh (no visible field changed)');
update public.achievements set scope = 'Lingkup lain' where id = pg_temp.u('c002');
select ok(
  (select revision from public.achievements where id = pg_temp.u('c002')) > (select source_revision from public.cv_items where id = pg_temp.i('ac2')),
  'the source revision moved without a visible change'
);
select is(pg_temp.st('ac2'), 'fresh', 'a revision bump without a display change stays fresh');

-- 4. Source edits do not write the CV ---------------------------------------------------

create temporary table pg_temp.baseline as
  select pg_temp.fp() as fingerprint, pg_temp.cv_rev() as cv_revision;

update public.experiences set role_title = 'Lead Engineer' where id = pg_temp.u('e001');
update public.projects set title = 'Sistem Antrian Baru' where id = pg_temp.u('b001');
update public.achievements set cv_bullet = 'Merancang simulasi antrian versi dua' where id = pg_temp.u('c001');
update public.education set institution = 'Kampus Baru' where id = pg_temp.u('d001');
update public.skills set name = 'PostgreSQL' where id = pg_temp.u('f001');
update public.certifications set name = 'Sertifikat Baru' where id = pg_temp.u('a001');

select is(
  (select string_agg(key || '=' || pg_temp.st(key), ',' order by key) from pg_temp.k),
  'ac1=changed,ac2=fresh,ce=changed,ed=changed,ex=changed,pj=changed,sk=changed',
  'editing each of the six source types marks its item changed'
);
select is(pg_temp.fp(), (select fingerprint from pg_temp.baseline), 'source edits wrote nothing to cv_items or cv_documents');
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.baseline), 'source edits did not move the CV revision');

-- 5. Keep saved wording is bound to the live revision ----------------------------------

select is(pg_temp.res(pg_temp.arr(pg_temp.el('ac1', 'keep'))), 'ok', 'keep is accepted for a changed item');
select is(pg_temp.st('ac1'), 'kept', 'a kept item reports kept');
select ok(
  (select item.acknowledged_revision = (select source.live_revision from internal.cv_live_source(item) as source)
      and item.source_snapshot ->> 'cv_bullet' = 'Merancang simulasi antrian' and item.override_text is null
   from public.cv_items as item where item.id = pg_temp.i('ac1')),
  'keep stores the live revision and leaves the saved snapshot untouched'
);
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.baseline) + 1, 'keep moved the CV revision exactly once');
select is(
  pg_temp.res(pg_temp.arr(pg_temp.el('ac1', 'keep'))),
  'P0001|CV_RESOLUTION_INVALID|',
  'keeping an already kept item is rejected'
);
update public.achievements set cv_bullet = 'Merancang simulasi antrian versi tiga' where id = pg_temp.u('c001');
select is(pg_temp.st('ac1'), 'changed', 'a second source edit invalidates the earlier acknowledgement');
select ok(
  (select item.acknowledged_revision is not null and item.source_snapshot ->> 'cv_bullet' = 'Merancang simulasi antrian'
   from public.cv_items as item where item.id = pg_temp.i('ac1')),
  'the second edit did not write the CV either'
);

-- 6. Refresh keeps the override, replace removes it --------------------------------------

select pg_temp.override('ac1', 'Wording saya sendiri');
select is(pg_temp.res(pg_temp.arr(pg_temp.el('ac1', 'refresh'))), 'ok', 'refresh is accepted for a changed item with an override');
select ok(
  (select item.override_text = 'Wording saya sendiri'
      and item.source_snapshot ->> 'cv_bullet' = 'Merancang simulasi antrian versi tiga'
      and item.source_revision = (select source.live_revision from internal.cv_live_source(item) as source)
      and item.acknowledged_revision is null
   from public.cv_items as item where item.id = pg_temp.i('ac1')),
  'refresh copied the live snapshot and revision, cleared the acknowledgement and kept the override'
);
select is(pg_temp.st('ac1'), 'fresh', 'a refreshed item is fresh');
update public.achievements set cv_bullet = 'Merancang simulasi antrian versi empat' where id = pg_temp.u('c001');
select is(pg_temp.res(pg_temp.arr(pg_temp.el('ac1', 'replace'))), 'ok', 'replace is accepted for an item with an override');
select ok(
  (select item.override_text is null and item.source_snapshot ->> 'cv_bullet' = 'Merancang simulasi antrian versi empat'
   from public.cv_items as item where item.id = pg_temp.i('ac1')),
  'replace refreshed the snapshot and cleared the override'
);
select is(pg_temp.st('ac1'), 'fresh', 'a replaced item is fresh');
create temporary table pg_temp.before_invalid as select pg_temp.fp() as fingerprint;
select is(pg_temp.res(pg_temp.arr(pg_temp.el('ex', 'replace'))), 'P0001|CV_RESOLUTION_INVALID|', 'replace without an override is rejected');
select is(pg_temp.fp(), (select fingerprint from pg_temp.before_invalid), 'the rejected replace wrote nothing');

-- 7. Rejections write nothing ------------------------------------------------------------

update public.achievements set cv_bullet = 'Merancang simulasi antrian versi lima' where id = pg_temp.u('c001');
create temporary table pg_temp.before_reject as select pg_temp.fp() as fingerprint;

select is(
  pg_temp.res(format('[{"target":"item","item_id":"%s","source_revision":%s,"action":"refresh"}]',
    pg_temp.i('ac1'), pg_temp.live('ac1') - 1)),
  'P0001|CV_SOURCE_CHANGED|',
  'a source revision different from the live one is rejected'
);
select is(pg_temp.res(pg_temp.cv_rev() - 1, pg_temp.arr(pg_temp.el('ac1', 'refresh'))), 'P0001|STALE_REVISION|', 'a stale CV revision is rejected');
select is(pg_temp.res(pg_temp.arr(pg_temp.el('ac2', 'refresh'))), 'P0001|CV_RESOLUTION_INVALID|', 'resolving a fresh item is rejected');
select is(pg_temp.res('[]'), '22023|INVALID_CV_INPUT|', 'an empty resolution list is rejected');
select is(pg_temp.res('{}'), '22023|INVALID_CV_INPUT|', 'a non-array payload is rejected');
select is(pg_temp.res('null'), '22023|INVALID_CV_INPUT|', 'a json null payload is rejected');
select is(
  pg_temp.res((select '[' || string_agg(pg_temp.el('ac1', 'refresh'), ',') || ']' from generate_series(1, 201))),
  '22023|INVALID_CV_INPUT|',
  'more than 200 resolutions are rejected'
);
select is(pg_temp.res(pg_temp.arr(pg_temp.el('ac1', 'refresh'), pg_temp.el('ac1', 'keep'))), '22023|INVALID_CV_INPUT|', 'a duplicate item is rejected');
select is(pg_temp.res(pg_temp.arr(pg_temp.pel('keep'), pg_temp.pel('refresh'))), '22023|INVALID_CV_INPUT|', 'two profile entries are rejected');
select is(
  pg_temp.res(format('[{"target":"item","item_id":"%s","source_revision":1,"action":"merge"}]', pg_temp.i('ac1'))),
  '22023|INVALID_CV_INPUT|', 'an unknown action is rejected'
);
select is(
  pg_temp.res(format('[{"target":"item","item_id":"%s","action":"refresh"}]', pg_temp.i('ac1'))),
  '22023|INVALID_CV_INPUT|', 'a missing source revision is rejected'
);
select is(
  pg_temp.res(format('[{"target":"item","item_id":"%s","source_revision":0,"action":"refresh"}]', pg_temp.i('ac1'))),
  '22023|INVALID_CV_INPUT|', 'a source revision below one is rejected'
);
select is(
  pg_temp.res(format('[{"target":"item","item_id":"%s","source_revision":1.5,"action":"refresh"}]', pg_temp.i('ac1'))),
  '22023|INVALID_CV_INPUT|', 'a fractional source revision is rejected'
);
select is(
  pg_temp.res(format('[{"target":"item","item_id":"%s","source_revision":1,"action":"refresh","extra":1}]', pg_temp.i('ac1'))),
  '22023|INVALID_CV_INPUT|', 'an unknown key is rejected'
);
select is(
  pg_temp.res('[{"target":"item","source_revision":1,"action":"refresh"}]'),
  '22023|INVALID_CV_INPUT|', 'an item entry without an item id is rejected'
);
select is(
  pg_temp.res(format('[{"target":"profile","item_id":"%s","source_revision":1,"action":"refresh"}]', pg_temp.i('ac1'))),
  '22023|INVALID_CV_INPUT|', 'a profile entry with an item id is rejected'
);
select is(
  pg_temp.res('[{"target":"item","item_id":"not-a-uuid","source_revision":1,"action":"refresh"}]'),
  '22023|INVALID_CV_INPUT|', 'a malformed item id is rejected'
);
select is(pg_temp.res(null, pg_temp.arr(pg_temp.el('ac1', 'refresh'))), '22023|INVALID_CV_INPUT|', 'a null expected revision is rejected');
select is(pg_temp.fp(), (select fingerprint from pg_temp.before_reject), 'none of the rejections wrote anything');

-- Auth and onboarding.
select pg_temp.set_jwt_subject(null);
select is(pg_temp.res(1, pg_temp.arr(pg_temp.el('ac1', 'refresh'))), '42501|AUTH_REQUIRED|', 'no session is rejected');
select pg_temp.set_jwt_subject(pg_temp.usr('d1'));
select is(pg_temp.res(1, '[{"target":"profile","source_revision":1,"action":"keep"}]'), '42501|AUTH_REQUIRED|', 'a deleting account is rejected');
select pg_temp.set_jwt_subject(pg_temp.usr('e1'));
select is(pg_temp.res(1, '[{"target":"profile","source_revision":1,"action":"keep"}]'), '22023|ONBOARDING_REQUIRED|',
  'an account that has not completed onboarding is rejected');
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));

-- Keep on an already kept item needs a kept item: keep SK, then keep again.
select is(pg_temp.res(pg_temp.arr(pg_temp.el('sk', 'keep'))), 'ok', 'keep on the skill item');
select is(pg_temp.res(pg_temp.arr(pg_temp.el('sk', 'keep'))), 'P0001|CV_RESOLUTION_INVALID|', 'keep on a kept skill is rejected');

-- 8. Batch is one transaction and one revision step -----------------------------------------

select is(pg_temp.st('ex') || ',' || pg_temp.st('pj'), 'changed,changed', 'experience and project are still changed before the batch');
create temporary table pg_temp.before_batch as select pg_temp.cv_rev() as cv_revision;
select is(pg_temp.res(pg_temp.arr(pg_temp.el('ex', 'refresh'), pg_temp.el('pj', 'refresh'))), 'ok', 'a batch of two refreshes succeeds');
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_batch) + 1, 'the batch moved the CV revision exactly once');
select is(pg_temp.st('ex') || ',' || pg_temp.st('pj'), 'fresh,fresh', 'both batch items are fresh');

create temporary table pg_temp.before_bad_batch as select pg_temp.fp() as fingerprint;
select is(
  pg_temp.res(pg_temp.arr(pg_temp.el('ed', 'refresh'), pg_temp.el('ac2', 'refresh'))),
  'P0001|CV_RESOLUTION_INVALID|',
  'a batch with one invalid resolution fails'
);
select is(pg_temp.fp(), (select fingerprint from pg_temp.before_bad_batch), 'the failed batch changed nothing, not even its valid item');
select is(pg_temp.st('ed'), 'changed', 'the valid item of the failed batch is still changed');

-- 9. Profile freshness ----------------------------------------------------------------------

select is(pg_temp.pst(), 'fresh', 'the profile is still fresh');
select public.save_cv_edits(pg_temp.cv_rev(), '{"summary_override":"Ringkasan saya","profile_overrides":{"headline":"Headline saya"}}'::jsonb);
update public.profiles set headline = 'Headline sumber baru' where id = pg_temp.usr('a1');
select is(pg_temp.pst(), 'changed', 'editing a visible profile field marks the profile changed');
select is(pg_temp.res(pg_temp.arr(pg_temp.pel('keep'))), 'ok', 'keep is accepted for the changed profile');
select is(pg_temp.pst(), 'kept', 'a kept profile reports kept');
select ok(
  (select document.profile_ack_revision = (select revision from public.profiles where id = document.user_id)
      and document.profile_snapshot ->> 'headline' = 'Lulusan Informatika'
   from public.cv_documents as document where document.user_id = pg_temp.me()),
  'profile keep stores the live profile revision and leaves the snapshot untouched'
);
update public.profiles set display_name = 'Ani Baru' where id = pg_temp.usr('a1');
select is(pg_temp.pst(), 'changed', 'a later profile edit invalidates the profile acknowledgement');
select is(pg_temp.res(pg_temp.arr(pg_temp.pel('refresh'))), 'ok', 'refresh is accepted for the changed profile');
select ok(
  (select document.profile_snapshot ->> 'headline' = 'Headline sumber baru'
      and document.profile_snapshot ->> 'display_name' = 'Ani Baru'
      and document.profile_snapshot ->> 'summary' = 'Ringkasan sumber'
      and document.profile_snapshot ->> 'schema_version' = 'cv-profile.v1'
      and document.profile_snapshot -> 'display_overrides' ->> 'headline' = 'Headline saya'
      and document.summary_override = 'Ringkasan saya'
      and document.profile_ack_revision is null
      and document.profile_source_revision = (select revision from public.profiles where id = document.user_id)
   from public.cv_documents as document where document.user_id = pg_temp.me()),
  'profile refresh copied the seven source fields and kept both overrides'
);
select is(pg_temp.pst(), 'fresh', 'a refreshed profile is fresh');
update public.profiles set contact_email = 'baru@example.com' where id = pg_temp.usr('a1');
select is(pg_temp.res(pg_temp.arr(pg_temp.pel('replace'))), 'ok', 'replace is accepted for a profile with overrides');
select ok(
  (select document.profile_snapshot -> 'display_overrides' is null and document.summary_override is null
      and document.profile_snapshot ->> 'contact_email' = 'baru@example.com'
   from public.cv_documents as document where document.user_id = pg_temp.me()),
  'profile replace refreshed the source fields and removed both overrides'
);
update public.profiles set phone = '+62 812 0000' where id = pg_temp.usr('a1');
select is(pg_temp.res(pg_temp.arr(pg_temp.pel('replace'))), 'P0001|CV_RESOLUTION_INVALID|', 'profile replace without overrides is rejected');
select is(pg_temp.res(pg_temp.arr(pg_temp.pel('refresh'))), 'ok', 'a plain profile refresh still works');
select is(pg_temp.res(pg_temp.arr(pg_temp.pel('refresh'))), 'P0001|CV_RESOLUTION_INVALID|', 'refreshing a fresh profile is rejected');
update public.profiles set website = 'https://example.com', location = 'Jakarta' where id = pg_temp.usr('a1');
select is(pg_temp.pst(), 'changed', 'website and location edits mark the profile changed');
select is(
  pg_temp.res(format('[{"target":"profile","source_revision":%s,"action":"refresh"}]',
    (select revision from public.profiles where id = pg_temp.me()) - 1)),
  'P0001|CV_SOURCE_CHANGED|', 'a stale profile revision is rejected'
);
select is(pg_temp.res(pg_temp.arr(pg_temp.pel('refresh'))), 'ok', 'the profile is refreshed again');

-- 10. A context change adds the new parent on refresh ---------------------------------------------

select is(
  (select count(*)::integer from public.cv_items where cv_id = (select id from public.cv_documents where user_id = pg_temp.me())
     and project_id = pg_temp.u('b002')),
  0, 'the second project is not on the CV yet'
);
select public.relink_achievement_project(pg_temp.u('c002'),
  (select revision from public.achievements where id = pg_temp.u('c002')), pg_temp.u('b002'));
select is(pg_temp.st('ac2'), 'changed', 'relinking a selected achievement to another project marks its item changed');
create temporary table pg_temp.before_parent as select pg_temp.cv_rev() as cv_revision;
select is(
  (select cardinality(added_parent_item_ids)::integer
     from public.resolve_cv_freshness(pg_temp.cv_rev(), pg_temp.arr(pg_temp.el('ac2', 'refresh'))::jsonb)),
  1, 'refreshing the relinked achievement returns exactly one added parent item'
);
select is(
  (select count(*)::integer from public.cv_items where cv_id = (select id from public.cv_documents where user_id = pg_temp.me())
     and project_id = pg_temp.u('b002')),
  1, 'the new parent project item was added'
);
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_parent) + 1, 'refresh with a new parent is still one revision step');
select is(pg_temp.st('ac2'), 'fresh', 'the relinked achievement is fresh after refresh');
select is(
  (select source_snapshot ->> 'project_id' from public.cv_items where id = pg_temp.i('ac2')),
  pg_temp.u('b002')::text, 'the item snapshot points at the new project'
);

-- 11. Reopen, dismiss and re-confirm ----------------------------------------------------------------

select public.save_achievement(pg_temp.u('c001'),
  (select revision from public.achievements where id = pg_temp.u('c001')), 'reopen', '{}'::jsonb, null);
select is(pg_temp.st('ac1'), 'unconfirmed', 'a reopened achievement makes its item unconfirmed');
select is(pg_temp.res(pg_temp.arr(pg_temp.el('ac1', 'refresh'))), 'P0001|CV_SOURCE_INELIGIBLE|', 'an unconfirmed item cannot be resolved');
select public.save_achievement(pg_temp.u('c001'),
  (select revision from public.achievements where id = pg_temp.u('c001')), 'save_draft', '{"title":"Judul diedit"}'::jsonb, null);
select public.save_achievement(pg_temp.u('c001'),
  (select revision from public.achievements where id = pg_temp.u('c001')), 'confirm', '{}'::jsonb, null);
select is(pg_temp.st('ac1'), 'changed', 're-confirming an edited achievement makes its item changed, not silently fresh');

select public.save_achievement(pg_temp.u('c002'),
  (select revision from public.achievements where id = pg_temp.u('c002')), 'reopen', '{}'::jsonb, null);
select public.save_achievement(pg_temp.u('c002'),
  (select revision from public.achievements where id = pg_temp.u('c002')), 'dismiss', '{}'::jsonb, null);
select is(pg_temp.st('ac2'), 'unconfirmed', 'a dismissed achievement makes its item unconfirmed');
select public.save_achievement(pg_temp.u('c002'),
  (select revision from public.achievements where id = pg_temp.u('c002')), 'reopen', '{}'::jsonb, null);
select public.save_achievement(pg_temp.u('c002'),
  (select revision from public.achievements where id = pg_temp.u('c002')), 'confirm', '{}'::jsonb, null);
select is(pg_temp.st('ac2'), 'fresh', 're-confirming an unchanged achievement is fresh because no display field differs');

-- 12. Read RPCs and ownership ------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.get_cv_freshness()),
  (select count(*)::integer from public.cv_items where user_id = pg_temp.me()) + 1,
  'get_cv_freshness returns one row per item plus one profile row'
);
select is((select count(*)::integer from public.get_cv_freshness() where target = 'profile'), 1, 'exactly one profile row');
select ok(
  (select bool_and((state in ('changed', 'kept')) = (live_snapshot is not null)) from public.get_cv_freshness()),
  'live_snapshot is present exactly for changed and kept rows'
);
update public.profiles set headline = 'Headline akhir' where id = pg_temp.usr('a1');
select ok(
  (select state = 'changed' and live_snapshot ->> 'headline' = 'Headline akhir' and live_snapshot ? 'website'
      and not (live_snapshot ? 'display_overrides') and not (live_snapshot ? 'schema_version')
   from public.get_cv_freshness() where target = 'profile'),
  'a changed profile row carries the live source fields only'
);
select ok(
  (select state = 'changed' and live_revision = pg_temp.live('ac1') and live_snapshot ->> 'title' = 'Judul diedit'
   from public.get_cv_freshness() where item_id = pg_temp.i('ac1')),
  'a changed item row carries the live revision and the live display snapshot'
);

select pg_temp.set_jwt_subject(pg_temp.usr('b1'));
select ok(
  (select count(*) = 2 and bool_and(item_id is null or item_id in (select id from public.cv_items where user_id = pg_temp.usr('b1')))
   from public.get_cv_freshness()),
  'get_cv_freshness returns only the caller rows'
);
select is(
  pg_temp.res(format('[{"target":"item","item_id":"%s","source_revision":1,"action":"refresh"}]', pg_temp.i('ac1'))),
  'P0001|CV_ITEM_NOT_FOUND|', 'an item of another account is reported as missing'
);
select is(
  pg_temp.res('[{"target":"item","item_id":"00000000-0000-4000-8000-0000000000ff","source_revision":1,"action":"refresh"}]'),
  'P0001|CV_ITEM_NOT_FOUND|', 'a random item id is reported the same way'
);
select pg_temp.set_jwt_subject(pg_temp.usr('d1'));
select is((select count(*)::integer from public.get_cv_freshness()), 0, 'a deleting account gets no freshness rows');
select is((select count(*)::integer from public.get_cv_review_summary()), 0, 'a deleting account gets no summary row');
select pg_temp.set_jwt_subject(null);
select is(pg_temp.try('select * from public.get_cv_freshness()'), 'ok', 'get_cv_freshness without a session does not raise');
select is((select count(*)::integer from public.get_cv_freshness()), 0, 'get_cv_freshness without a session returns nothing');

-- Review summary with and without a CV.
select pg_temp.set_jwt_subject(pg_temp.usr('c1'));
select is(
  (select has_cv::text || ',' || review_count || ',' || available_count from public.get_cv_review_summary()),
  'false,0,2', 'without a CV the summary has no review items and every confirmed achievement is available'
);
update public.education set institution = 'B Uni Baru' where id = pg_temp.u('bd01');
select pg_temp.set_jwt_subject(pg_temp.usr('b1'));
select is(
  (select has_cv::text || ',' || review_count || ',' || available_count from public.get_cv_review_summary()),
  'true,1,1', 'one changed item and one unselected confirmed achievement (draft excluded) are counted separately'
);
select pg_temp.set_jwt_subject(pg_temp.usr('a1'));

-- 13. Deleting a source invalidates its item in the delete transaction ------------------------------

-- Wording overrides must survive deletion; collect baselines first.
select pg_temp.override('ac1', 'Wording ac1');
select pg_temp.override('ex', 'Wording ex');
create temporary table pg_temp.deleted_baseline as
  select key, item.source_snapshot, item.override_text from pg_temp.k join public.cv_items as item on item.id = pg_temp.k.id;

create or replace function pg_temp.rev_of(p_table text, p_id uuid) returns integer language plpgsql as $$
declare v integer;
begin
  execute format('select revision from public.%I where id = $1', p_table) into v using p_id;
  return v;
end;
$$;

create temporary table pg_temp.before_delete as select pg_temp.cv_rev() as cv_revision;
select is(pg_temp.try(format('select * from public.delete_experience(%L, 99)', pg_temp.u('e001'))), 'P0001|STALE_REVISION|',
  'a stale delete keeps raising STALE_REVISION');
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_delete), 'a rejected delete does not move the CV revision');

select is(
  (select deleted_achievement_id::text || ',' || retained_activity::text
     from public.delete_achievement(pg_temp.u('c001'), pg_temp.rev_of('achievements', pg_temp.u('c001')))),
  pg_temp.u('c001')::text || ',false', 'delete_achievement keeps its return value'
);
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_delete) + 1, 'deleting a selected achievement moved the CV revision once');
select is(pg_temp.st('ac1'), 'deleted', 'the achievement item is deleted');
select ok(
  (select item.source_deleted and item.achievement_id is null and item.override_text = 'Wording ac1'
      and item.source_snapshot = (select source_snapshot from pg_temp.deleted_baseline where key = 'ac1')
   from public.cv_items as item where item.id = pg_temp.i('ac1')),
  'the deleted achievement item kept its snapshot and override'
);
select is(pg_temp.res(pg_temp.arr(pg_temp.el('ac1', 'refresh'))), 'P0001|CV_RESOLUTION_INVALID|', 'a deleted item cannot be resolved');

update pg_temp.before_delete set cv_revision = pg_temp.cv_rev();
select is(
  (select deleted_project_id::text from public.delete_project(pg_temp.u('b001'), pg_temp.rev_of('projects', pg_temp.u('b001')))),
  pg_temp.u('b001')::text, 'delete_project keeps its return value'
);
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_delete) + 1, 'deleting a selected project moved the CV revision once');
select is(pg_temp.st('pj'), 'deleted', 'the project item is deleted');

update pg_temp.before_delete set cv_revision = pg_temp.cv_rev();
select is(
  (select deleted_experience_id::text from public.delete_experience(pg_temp.u('e001'), pg_temp.rev_of('experiences', pg_temp.u('e001')))),
  pg_temp.u('e001')::text, 'delete_experience keeps its return value'
);
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_delete) + 1, 'deleting a selected experience moved the CV revision once');
select ok(
  (select item.source_deleted and item.override_text = 'Wording ex'
      and item.source_snapshot = (select source_snapshot from pg_temp.deleted_baseline where key = 'ex')
   from public.cv_items as item where item.id = pg_temp.i('ex')),
  'the deleted experience item kept its snapshot and override'
);

update pg_temp.before_delete set cv_revision = pg_temp.cv_rev();
select is(public.delete_education(pg_temp.u('d001'), pg_temp.rev_of('education', pg_temp.u('d001'))), pg_temp.u('d001'),
  'delete_education keeps its return value');
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_delete) + 1, 'deleting a selected education moved the CV revision once');
select is(pg_temp.st('ed'), 'deleted', 'the education item is deleted');

update pg_temp.before_delete set cv_revision = pg_temp.cv_rev();
select is(public.delete_skill(pg_temp.u('f001'), pg_temp.rev_of('skills', pg_temp.u('f001'))), pg_temp.u('f001'), 'delete_skill keeps its return value');
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_delete) + 1, 'deleting a selected skill moved the CV revision once');
select is(pg_temp.st('sk'), 'deleted', 'the skill item is deleted');

update pg_temp.before_delete set cv_revision = pg_temp.cv_rev();
select is(public.delete_certification(pg_temp.u('a001'), pg_temp.rev_of('certifications', pg_temp.u('a001'))), pg_temp.u('a001'),
  'delete_certification keeps its return value');
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_delete) + 1, 'deleting a selected certification moved the CV revision once');
select is(pg_temp.st('ce'), 'deleted', 'the certification item is deleted');

-- Sources without a CV item leave the CV revision alone.
update pg_temp.before_delete set cv_revision = pg_temp.cv_rev();
select * from public.delete_experience(pg_temp.u('e002'), pg_temp.rev_of('experiences', pg_temp.u('e002')));
select * from public.delete_project(pg_temp.u('b003'), pg_temp.rev_of('projects', pg_temp.u('b003')));
select * from public.delete_achievement(pg_temp.u('c004'), pg_temp.rev_of('achievements', pg_temp.u('c004')));
select public.delete_education(pg_temp.u('d002'), pg_temp.rev_of('education', pg_temp.u('d002')));
select public.delete_skill(pg_temp.u('f002'), pg_temp.rev_of('skills', pg_temp.u('f002')));
select public.delete_certification(pg_temp.u('a002'), pg_temp.rev_of('certifications', pg_temp.u('a002')));
select is(pg_temp.cv_rev(), (select cv_revision from pg_temp.before_delete), 'deleting unselected sources did not move the CV revision');
select is(
  (select count(*)::integer from public.experiences where id = pg_temp.u('e002'))
  + (select count(*)::integer from public.projects where id = pg_temp.u('b003'))
  + (select count(*)::integer from public.achievements where id = pg_temp.u('c004'))
  + (select count(*)::integer from public.education where id = pg_temp.u('d002'))
  + (select count(*)::integer from public.skills where id = pg_temp.u('f002'))
  + (select count(*)::integer from public.certifications where id = pg_temp.u('a002')),
  0, 'the six unselected sources were really deleted'
);

-- An account without a CV can still delete.
select pg_temp.set_jwt_subject(pg_temp.usr('c1'));
select is(public.delete_education(pg_temp.u('cd01'), pg_temp.rev_of('education', pg_temp.u('cd01'))), pg_temp.u('cd01'),
  'an account without a CV can delete a source');
select is(pg_temp.try(format('select * from public.delete_achievement(%L, 1)', pg_temp.u('cc01'))), 'ok', 'delete_achievement works for an account without a CV');

-- 14. select_cv_source keeps its behaviour with the parent-first lock order ---------------------------------

select pg_temp.set_jwt_subject(pg_temp.usr('a1'));
select is(
  pg_temp.try(format('select * from public.select_cv_source(%s, %L, %L)', pg_temp.cv_rev(), 'achievement', pg_temp.u('c003'))),
  'ok', 'selecting an unselected confirmed achievement still works'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(%s, %L, %L)', pg_temp.cv_rev(), 'achievement', pg_temp.u('c003'))),
  'P0001|CV_SOURCE_DUPLICATE|', 'selecting it twice is still a duplicate'
);

select * from finish();
rollback;

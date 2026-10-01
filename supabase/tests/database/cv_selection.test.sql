begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T18 CV schema and selection service (PRD R09, F07 step 1-2, DB §5/§6).
-- Sources are inserted directly as the test owner; the CV RPCs are exercised with a JWT subject.

-- 1. Structure and privileges -------------------------------------------------

select has_table('cv_documents', 'cv_documents exists');
select has_table('cv_items', 'cv_items exists');
select has_table('cv_exports', 'cv_exports exists');
select ok(
  (select bool_and(relrowsecurity) from pg_catalog.pg_class
   where oid in ('public.cv_documents'::regclass, 'public.cv_items'::regclass, 'public.cv_exports'::regclass)),
  'RLS is enabled on all three CV tables'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('cv_documents', 'cv_items', 'cv_exports') and cmd = 'SELECT'),
  3, 'each CV table has one select policy'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('cv_documents', 'cv_items', 'cv_exports') and cmd <> 'SELECT'),
  0, 'no CV table has a write policy'
);
select ok(
  not has_table_privilege('authenticated', 'public.cv_documents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.cv_documents', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.cv_documents', 'DELETE')
  and not has_table_privilege('authenticated', 'public.cv_items', 'INSERT')
  and not has_table_privilege('authenticated', 'public.cv_items', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.cv_items', 'DELETE')
  and not has_table_privilege('authenticated', 'public.cv_exports', 'INSERT')
  and not has_table_privilege('authenticated', 'public.cv_exports', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.cv_exports', 'DELETE')
  and has_table_privilege('authenticated', 'public.cv_documents', 'SELECT')
  and has_table_privilege('authenticated', 'public.cv_items', 'SELECT')
  and has_table_privilege('authenticated', 'public.cv_exports', 'SELECT')
  and not has_table_privilege('anon', 'public.cv_items', 'SELECT')
  and not has_table_privilege('service_role', 'public.cv_items', 'INSERT'),
  'authenticated can only select; anon and service_role have no client grants'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint where conname = 'cv_documents_user_key' and contype = 'u')
  and exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'cv_items_section_position_key' and contype = 'u' and condeferrable and not condeferred),
  'one CV per user and a deferrable initially-immediate position key exist'
);
select is(
  (select count(*)::integer from pg_catalog.pg_indexes
   where schemaname = 'public' and tablename = 'cv_items' and indexname like 'cv_items\_cv\_%\_key' escape '\'),
  6, 'six per-type unique source indexes exist'
);
select is(
  (select count(*)::integer from pg_catalog.pg_constraint
   where conrelid = 'public.cv_items'::regclass and contype = 'f' and confdeltype = 'n'),
  6, 'six source foreign keys use ON DELETE SET NULL'
);
select ok(
  has_function_privilege('authenticated', 'public.ensure_cv_document()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.select_cv_source(integer,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.remove_cv_item(integer,uuid,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.reorder_cv_section(integer,text,uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_cv_layout(integer,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.ensure_cv_document()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.select_cv_source(integer,text,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.select_cv_source(integer,text,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.update_cv_layout(integer,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.cv_source_snapshot(uuid,text,uuid)', 'EXECUTE'),
  'the five CV RPCs are executable by authenticated only; the snapshot builder is internal'
);
select ok(
  (select bool_and(proc.prosecdef) from pg_catalog.pg_proc as proc
   join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
   where ns.nspname = 'public'
     and proc.proname in ('ensure_cv_document', 'select_cv_source', 'remove_cv_item', 'reorder_cv_section', 'update_cv_layout')),
  'CV RPCs are security definer'
);

-- 2. Fixtures -------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11818181-1818-4181-8181-181818181811', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cv-a@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('21818181-1818-4181-8181-181818181812', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cv-b@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('31818181-1818-4181-8181-181818181813', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cv-c@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('41818181-1818-4181-8181-181818181814', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cv-d@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

update public.profiles set display_name = 'Ani Contoh', locale = 'id', headline = 'Lulusan Informatika',
  contact_email = 'ani@example.com', onboarding_completed_at = now()
where id = '11818181-1818-4181-8181-181818181811';
update public.profiles set display_name = 'Budi Contoh', onboarding_completed_at = now()
where id in ('21818181-1818-4181-8181-181818181812', '41818181-1818-4181-8181-181818181814');
update public.profiles set deleting_at = now() where id = '41818181-1818-4181-8181-181818181814';

create or replace function pg_temp.set_jwt_subject(p_user_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', p_role)::text, true);
end;
$$;

-- Run a statement and return "sqlstate|message|detail", or 'ok'.
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

create or replace function pg_temp.sqlstate_of(p_sql text)
returns text language sql as $$ select split_part(pg_temp.try(p_sql), '|', 1) $$;

create or replace function pg_temp.cv_rev(p_user_id uuid)
returns integer language sql as $$ select revision from public.cv_documents where user_id = p_user_id $$;

create or replace function pg_temp.cv_id(p_user_id uuid)
returns uuid language sql as $$ select id from public.cv_documents where user_id = p_user_id $$;

create or replace function pg_temp.positions(p_user_id uuid, p_section text)
returns text language sql as $$
  select coalesce(string_agg(position::text, ',' order by position), '')
  from public.cv_items where cv_id = pg_temp.cv_id(p_user_id) and section_key = p_section
$$;

create or replace function pg_temp.cv_state(p_user_id uuid)
returns text language sql as $$
  select format('rev=%s items=%s', (select revision from public.cv_documents where user_id = p_user_id),
    (select count(*) from public.cv_items where user_id = p_user_id))
$$;

create temporary table pg_temp.ids (label text primary key, id uuid not null);
grant select on pg_temp.ids to public;
create or replace function pg_temp.id(p_label text) returns uuid language sql as
$$ select id from pg_temp.ids where label = p_label $$;

-- Owner A (graduate) sources.
insert into public.experiences (id, user_id, organization, role_title, kind, description, start_date, start_precision, is_current) values
  ('a1000000-0000-4000-8000-000000000001', '11818181-1818-4181-8181-181818181811', 'PT Magang Sentosa', 'Analis Magang', 'internship',
   'Deskripsi magang', '2023-06-01', 'month', false),
  ('a1000000-0000-4000-8000-000000000002', '11818181-1818-4181-8181-181818181811', 'Relawan Kampus', 'Koordinator', 'volunteer',
   null, null, null, false);
insert into public.education (id, user_id, institution, qualification, field_of_study, start_date, start_precision, end_date, end_precision) values
  ('a2000000-0000-4000-8000-000000000001', '11818181-1818-4181-8181-181818181811', 'Universitas Contoh', 'S1', 'Informatika',
   '2019-01-01', 'year', '2023-01-01', 'year');
insert into public.certifications (id, user_id, name) values
  ('a3000000-0000-4000-8000-000000000001', '11818181-1818-4181-8181-181818181811', 'Sertifikat Tanpa Tanggal');
insert into public.skills (id, user_id, name) values
  ('a4000000-0000-4000-8000-000000000001', '11818181-1818-4181-8181-181818181811', 'SQL'),
  ('a4000000-0000-4000-8000-000000000002', '11818181-1818-4181-8181-181818181811', 'Python');
insert into public.projects (id, user_id, experience_id, title, description, user_role, outcome, status) values
  ('a6000000-0000-4000-8000-000000000001', '11818181-1818-4181-8181-181818181811', 'a1000000-0000-4000-8000-000000000001',
   'Dasbor Magang', 'Deskripsi dasbor', 'Analis', 'Dasbor rilis', 'completed'),
  ('a6000000-0000-4000-8000-000000000002', '11818181-1818-4181-8181-181818181811', null,
   'Skripsi Sistem Antrian', 'Deskripsi skripsi', 'Peneliti', 'Lulus', 'completed');
insert into public.achievements (id, user_id, experience_id, project_id, title, contribution, scope, outcome, cv_bullet, achieved_on, status) values
  ('a5000000-0000-4000-8000-000000000001', '11818181-1818-4181-8181-181818181811', null, 'a6000000-0000-4000-8000-000000000002',
   'Menurunkan waktu antre', 'WP-PRIVATE-CONTRIB-1', 'WP-PRIVATE-SCOPE-1', 'Waktu turun 30 persen', 'Merancang simulasi antrian dan menurunkan waktu antre',
   '2023-05-10', 'confirmed'),
  ('a5000000-0000-4000-8000-000000000002', '11818181-1818-4181-8181-181818181811', 'a1000000-0000-4000-8000-000000000001',
   'a6000000-0000-4000-8000-000000000001', 'Membangun dasbor', 'Membuat dasbor', null, 'Dasbor dipakai tim', 'Membangun dasbor untuk tim operasi',
   '2023-08-01', 'confirmed'),
  ('a5000000-0000-4000-8000-000000000003', '11818181-1818-4181-8181-181818181811', 'a1000000-0000-4000-8000-000000000002', null,
   'Mengelola relawan', 'Mengelola jadwal', null, 'Jadwal rapi', 'Mengelola jadwal relawan kampus', '2022-03-01', 'confirmed'),
  ('a5000000-0000-4000-8000-000000000004', '11818181-1818-4181-8181-181818181811', null, null,
   'Mandiri', 'Menulis panduan', null, 'Panduan dipakai', 'Menulis panduan onboarding', '2024-01-01', 'confirmed');
insert into public.achievements (id, user_id, title, status) values
  ('a5000000-0000-4000-8000-000000000005', '11818181-1818-4181-8181-181818181811', 'Draf saja', 'draft'),
  ('a5000000-0000-4000-8000-000000000006', '11818181-1818-4181-8181-181818181811', 'Ditolak', 'dismissed');

-- Owner B sources.
insert into public.experiences (id, user_id, organization, role_title, kind) values
  ('b1000000-0000-4000-8000-000000000001', '21818181-1818-4181-8181-181818181812', 'B Corp', 'Staff', 'employment');
insert into public.skills (id, user_id, name) values
  ('b4000000-0000-4000-8000-000000000001', '21818181-1818-4181-8181-181818181812', 'B Skill');
insert into public.achievements (id, user_id, title, contribution, outcome, cv_bullet, achieved_on, status) values
  ('b5000000-0000-4000-8000-000000000001', '21818181-1818-4181-8181-181818181812', 'B hasil', 'B kontribusi', 'B outcome', 'B bullet', '2024-02-01', 'confirmed');

-- 3. ensure_cv_document ---------------------------------------------------------

select pg_temp.set_jwt_subject('31818181-1818-4181-8181-181818181813');
select is(
  pg_temp.try('select * from public.ensure_cv_document()'),
  '22023|ONBOARDING_REQUIRED|', 'an account that has not completed onboarding cannot open a CV'
);
select pg_temp.set_jwt_subject('41818181-1818-4181-8181-181818181814');
select is(
  pg_temp.try('select * from public.ensure_cv_document()'),
  '42501|AUTH_REQUIRED|', 'a deleting account is rejected'
);
select pg_temp.set_jwt_subject(null);
select is(
  pg_temp.try('select * from public.ensure_cv_document()'),
  '42501|AUTH_REQUIRED|', 'no session is rejected'
);
select is(
  (select count(*)::integer from public.cv_documents where user_id in (
    '31818181-1818-4181-8181-181818181813', '41818181-1818-4181-8181-181818181814')),
  0, 'rejected calls write nothing'
);

select pg_temp.set_jwt_subject('11818181-1818-4181-8181-181818181811');
create temporary table pg_temp.ensure1 as select * from public.ensure_cv_document();
select ok(
  (select created and revision = 1 from pg_temp.ensure1)
  and (select count(*) = 1 from public.cv_documents where user_id = '11818181-1818-4181-8181-181818181811'),
  'the first open creates exactly one CV'
);
select is(
  (select locale || '|' || template_key || '|' || title from public.cv_documents where user_id = '11818181-1818-4181-8181-181818181811'),
  'id|single_column_v1|Master CV', 'initial locale follows the profile; template and title are the defaults'
);
select is(
  (select section_order from public.cv_documents where user_id = '11818181-1818-4181-8181-181818181811'),
  '["experience","projects","achievements","education","skills","certifications"]'::jsonb,
  'initial section order is the documented default'
);
select ok(
  (select profile_snapshot ->> 'display_name' = 'Ani Contoh'
      and profile_snapshot ->> 'headline' = 'Lulusan Informatika'
      and profile_snapshot ->> 'contact_email' = 'ani@example.com'
      and profile_snapshot ->> 'schema_version' = 'cv-profile.v1'
      and profile_source_revision = (select revision from public.profiles where id = '11818181-1818-4181-8181-181818181811')
      and summary_override is null and profile_ack_revision is null
   from public.cv_documents where user_id = '11818181-1818-4181-8181-181818181811'),
  'the profile snapshot and its source revision are captured'
);
create temporary table pg_temp.ensure_before as
  select revision, updated_at from public.cv_documents where user_id = '11818181-1818-4181-8181-181818181811';
create temporary table pg_temp.ensure2 as select * from public.ensure_cv_document();
select ok(
  (select cv_id = (select cv_id from pg_temp.ensure1) and not created and revision = 1 from pg_temp.ensure2)
  and (select revision = 1 and updated_at = (select updated_at from pg_temp.ensure_before)
       from public.cv_documents where user_id = '11818181-1818-4181-8181-181818181811'),
  'a second open returns the same CV without a write'
);
select is(
  pg_temp.sqlstate_of($sql$insert into public.cv_documents (user_id, locale, profile_snapshot, profile_source_revision, section_order)
    values ('11818181-1818-4181-8181-181818181811', 'en', '{}'::jsonb, 1,
    '["experience","projects","achievements","education","skills","certifications"]'::jsonb)$sql$),
  '23505', 'a second CV row for the same user violates UNIQUE(user_id)'
);

select pg_temp.set_jwt_subject('21818181-1818-4181-8181-181818181812');
create temporary table pg_temp.ensure_b as select * from public.ensure_cv_document();
select ok(
  (select created and cv_id <> (select cv_id from pg_temp.ensure1) from pg_temp.ensure_b)
  and (select locale = 'en' from public.cv_documents where user_id = '21818181-1818-4181-8181-181818181812'),
  'owner B gets a separate CV with the profile default locale'
);

-- 4. Check constraints ----------------------------------------------------------

select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision)
  values (%L, %L, 'skills', 1, 'a4000000-0000-4000-8000-000000000001', '{}', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  'ok', 'a valid direct item insert (owner privilege) succeeds');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision)
  values (%L, %L, 'projects', 1, 'a4000000-0000-4000-8000-000000000002', '{}', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23514', 'a section that does not match the source column is rejected');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, source_snapshot, source_revision)
  values (%L, %L, 'skills', 2, '{}', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23514', 'no source while not deleted is rejected');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, project_id, source_snapshot, source_revision)
  values (%L, %L, 'skills', 2, 'a4000000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000002', '{}', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23514', 'two sources on one item are rejected');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision, source_deleted)
  values (%L, %L, 'skills', 2, 'a4000000-0000-4000-8000-000000000002', '{}', 1, true)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23514', 'a deleted item that still points at a source is rejected');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, source_snapshot, source_revision, source_deleted)
  values (%L, %L, 'skills', 2, '{}', 1, true)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  'ok', 'a deleted item without a source is valid');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision)
  values (%L, %L, 'hobbies', 3, 'a4000000-0000-4000-8000-000000000002', '{}', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23514', 'an unknown section key is rejected');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision)
  values (%L, %L, 'skills', 0, 'a4000000-0000-4000-8000-000000000002', '{}', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23514', 'position below 1 is rejected');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision)
  values (%L, %L, 'skills', 1, 'a4000000-0000-4000-8000-000000000002', '{}', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23505', 'a position already used in the section is rejected');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision)
  values (%L, %L, 'skills', 5, 'a4000000-0000-4000-8000-000000000001', '{}', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23505', 'the same source twice in one CV is rejected by the per-type unique index');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision, override_text)
  values (%L, %L, 'skills', 5, 'a4000000-0000-4000-8000-000000000002', '{}', 1, '   ')$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23514', 'a blank override text is rejected');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision)
  values (%L, %L, 'skills', 5, 'b4000000-0000-4000-8000-000000000001', '{}', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23503', 'the composite FK rejects an item of A that points at a source of B');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision)
  values (%L, %L, 'skills', 5, 'b4000000-0000-4000-8000-000000000001', '{}', 1)$sql$,
  '21818181-1818-4181-8181-181818181812', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23503', 'the composite FK rejects an item whose CV belongs to another user');
select is(pg_temp.sqlstate_of(format($sql$insert into public.cv_items (user_id, cv_id, section_key, position, skill_id, source_snapshot, source_revision)
  values (%L, %L, 'skills', 5, 'a4000000-0000-4000-8000-000000000002', '[]', 1)$sql$,
  '11818181-1818-4181-8181-181818181811', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))),
  '23514', 'a non-object snapshot is rejected');
delete from public.cv_items where user_id = '11818181-1818-4181-8181-181818181811';

select is(pg_temp.sqlstate_of(format($sql$update public.cv_documents set section_order = '["experience","projects"]'::jsonb where id = %L$sql$,
  pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))), '23514', 'an incomplete section_order is rejected');
select is(pg_temp.sqlstate_of(format($sql$update public.cv_documents set section_order = '["experience","experience","achievements","education","skills","certifications"]'::jsonb where id = %L$sql$,
  pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))), '23514', 'a duplicated section key is rejected');
select is(pg_temp.sqlstate_of(format($sql$update public.cv_documents set section_order = '["experience","projects","achievements","education","skills","hobbies"]'::jsonb where id = %L$sql$,
  pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))), '23514', 'a foreign section key is rejected');
select is(pg_temp.sqlstate_of(format($sql$update public.cv_documents set locale = 'fr' where id = %L$sql$,
  pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))), '23514', 'an unsupported locale is rejected');
select is(pg_temp.sqlstate_of(format($sql$update public.cv_documents set template_key = 'two_column' where id = %L$sql$,
  pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))), 'P0001', 'the template of a CV is immutable');
select is(pg_temp.sqlstate_of(format($sql$update public.cv_documents set user_id = %L where id = %L$sql$,
  '21818181-1818-4181-8181-181818181812', pg_temp.cv_id('11818181-1818-4181-8181-181818181811'))), 'P0001',
  'moving a CV to another user is refused (the owner is immutable)');
select is(pg_temp.sqlstate_of($sql$insert into public.cv_documents (user_id, locale, template_key, profile_snapshot, profile_source_revision, section_order)
  values ('31818181-1818-4181-8181-181818181813', 'en', 'two_column', '{}'::jsonb, 1,
  '["experience","projects","achievements","education","skills","certifications"]'::jsonb)$sql$),
  '23514', 'an unsupported template is rejected on insert');

-- 5. select_cv_source -----------------------------------------------------------

select pg_temp.set_jwt_subject('11818181-1818-4181-8181-181818181811');
select is(
  pg_temp.try(format('select * from public.select_cv_source(1, %L, %L)', 'achievement', 'a5000000-0000-4000-8000-000000000005')),
  'P0001|CV_SOURCE_INELIGIBLE|', 'a draft achievement is not eligible'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(1, %L, %L)', 'achievement', 'a5000000-0000-4000-8000-000000000006')),
  'P0001|CV_SOURCE_INELIGIBLE|', 'a dismissed achievement is not eligible'
);
select is(pg_temp.cv_state('11818181-1818-4181-8181-181818181811'), 'rev=1 items=0', 'ineligible attempts write nothing');
select is(
  pg_temp.try(format('select * from public.select_cv_source(1, %L, %L)', 'achievement', 'b5000000-0000-4000-8000-000000000001')),
  'P0001|CV_SOURCE_NOT_FOUND|', 'a source of another account is reported as not found'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(1, %L, %L)', 'achievement', gen_random_uuid())),
  'P0001|CV_SOURCE_NOT_FOUND|', 'a random source id gives the same generic error'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(1, %L, %L)', 'hobby', 'a4000000-0000-4000-8000-000000000001')),
  '22023|INVALID_CV_INPUT|', 'an unknown source type is invalid input'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(null, %L, %L)', 'skill', 'a4000000-0000-4000-8000-000000000001')),
  '22023|INVALID_CV_INPUT|', 'a null expected revision is invalid input'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(1, %L, null)', 'skill')),
  '22023|INVALID_CV_INPUT|', 'a null source id is invalid input'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(9, %L, %L)', 'skill', 'a4000000-0000-4000-8000-000000000001')),
  'P0001|STALE_REVISION|', 'a stale revision is rejected'
);
select is(pg_temp.cv_state('11818181-1818-4181-8181-181818181811'), 'rev=1 items=0', 'stale attempts write nothing');

-- Standalone experience-less achievement in a standalone project: project parent is added first.
create temporary table pg_temp.sel_proj as
  select * from public.select_cv_source(1, 'achievement', 'a5000000-0000-4000-8000-000000000001');
select ok(
  (select cv_revision = 2 and cardinality(item_ids) = 2 and cardinality(parent_item_ids) = 1 from pg_temp.sel_proj),
  'selecting an achievement with a project creates the project item and the achievement item, revision +1'
);
select is(
  (select string_agg(section_key || ':' || position::text || ':' || coalesce(project_id::text, achievement_id::text), ',' order by section_key)
   from public.cv_items where user_id = '11818181-1818-4181-8181-181818181811'),
  'achievements:1:a5000000-0000-4000-8000-000000000001,projects:1:a6000000-0000-4000-8000-000000000002',
  'the project sits in projects and the achievement in achievements, both at position 1'
);
select is(
  (select array(select id from public.cv_items where user_id = '11818181-1818-4181-8181-181818181811'
     and project_id is not null)), (select parent_item_ids from pg_temp.sel_proj),
  'parent_item_ids reports the created parent item'
);
select is(
  (select array_agg(k order by k collate "C") from public.cv_items i, jsonb_object_keys(i.source_snapshot) as k
   where i.achievement_id = 'a5000000-0000-4000-8000-000000000001'),
  array['achieved_on', 'cv_bullet', 'experience_id', 'project_id', 'schema_version', 'source_id', 'source_type', 'title'],
  'the achievement snapshot holds exactly the display fields'
);
select is(
  (select array_agg(k order by k collate "C") from public.cv_items i, jsonb_object_keys(i.source_snapshot) as k
   where i.project_id = 'a6000000-0000-4000-8000-000000000002'),
  array['description', 'end_date', 'end_precision', 'experience_id', 'is_current', 'outcome', 'schema_version', 'source_id',
        'source_type', 'start_date', 'start_precision', 'status', 'title', 'user_role'],
  'the project snapshot holds exactly the display fields'
);
select ok(
  (select source_snapshot::text !~ 'WP-PRIVATE' and source_snapshot ->> 'project_id' = 'a6000000-0000-4000-8000-000000000002'
      and source_snapshot ->> 'experience_id' is null and source_snapshot ->> 'achieved_on' = '2023-05-10'
      and source_snapshot ->> 'source_type' = 'achievement' and source_snapshot ->> 'schema_version' = 'cv-source.v1'
   from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000001'),
  'the snapshot carries parent context and ISO dates, never contribution, scope or source text'
);
select ok(
  (select source_revision = (select revision from public.achievements where id = 'a5000000-0000-4000-8000-000000000001')
   from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000001')
  and (select source_revision = (select revision from public.projects where id = 'a6000000-0000-4000-8000-000000000002')
   from public.cv_items where project_id = 'a6000000-0000-4000-8000-000000000002'),
  'source_revision equals the revision of each source at selection time'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(2, %L, %L)', 'achievement', 'a5000000-0000-4000-8000-000000000001')),
  'P0001|CV_SOURCE_DUPLICATE|', 'selecting the same achievement again is a duplicate'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(2, %L, %L)', 'project', 'a6000000-0000-4000-8000-000000000002')),
  'P0001|CV_SOURCE_DUPLICATE|', 'selecting an auto-added parent explicitly is a duplicate'
);
select is(pg_temp.cv_rev('11818181-1818-4181-8181-181818181811'), 2, 'duplicate attempts do not raise the revision');

-- Editing the source afterwards leaves the snapshot alone (refresh is T20).
update public.achievements set cv_bullet = 'Kalimat baru sesudah dipilih' where id = 'a5000000-0000-4000-8000-000000000001';
select ok(
  (select source_snapshot ->> 'cv_bullet' = 'Merancang simulasi antrian dan menurunkan waktu antre'
      and source_revision < (select revision from public.achievements where id = 'a5000000-0000-4000-8000-000000000001')
   from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000001'),
  'editing the source later leaves the saved snapshot and source_revision unchanged'
);

-- Achievement with project and experience: the project is the parent; the experience is not added.
create temporary table pg_temp.sel_p1 as
  select * from public.select_cv_source(2, 'achievement', 'a5000000-0000-4000-8000-000000000002');
select ok(
  (select cv_revision = 3 and cardinality(item_ids) = 2 and cardinality(parent_item_ids) = 1 from pg_temp.sel_p1)
  and not exists (select 1 from public.cv_items where user_id = '11818181-1818-4181-8181-181818181811' and experience_id is not null),
  'project is the required parent; its experience is not added implicitly'
);
-- Experience-only achievement adds its experience parent.
create temporary table pg_temp.sel_e as
  select * from public.select_cv_source(3, 'achievement', 'a5000000-0000-4000-8000-000000000003');
select ok(
  (select cv_revision = 4 and cardinality(item_ids) = 2 and cardinality(parent_item_ids) = 1 from pg_temp.sel_e)
  and exists (select 1 from public.cv_items where experience_id = 'a1000000-0000-4000-8000-000000000002' and section_key = 'experience'),
  'an achievement with only an experience adds the experience parent'
);
-- Standalone achievement creates no parent.
create temporary table pg_temp.sel_s as
  select * from public.select_cv_source(4, 'achievement', 'a5000000-0000-4000-8000-000000000004');
select ok(
  (select cv_revision = 5 and cardinality(item_ids) = 1 and cardinality(parent_item_ids) = 0 from pg_temp.sel_s),
  'a standalone achievement creates no parent item'
);
-- Parent already selected is not duplicated: pick the experience first, then its achievement is covered by project rule; use E2 already selected.
select ok(
  (select count(*) = 1 from public.cv_items where experience_id = 'a1000000-0000-4000-8000-000000000002')
  and pg_temp.positions('11818181-1818-4181-8181-181818181811', 'achievements') = '1,2,3,4'
  and pg_temp.positions('11818181-1818-4181-8181-181818181811', 'projects') = '1,2'
  and pg_temp.positions('11818181-1818-4181-8181-181818181811', 'experience') = '1',
  'positions are contiguous and appended per section'
);
-- Non-achievement sources.
create temporary table pg_temp.sel_plain as
  select 'exp' as k, * from public.select_cv_source(5, 'experience', 'a1000000-0000-4000-8000-000000000001');
insert into pg_temp.sel_plain select 'edu', * from public.select_cv_source(6, 'education', 'a2000000-0000-4000-8000-000000000001');
insert into pg_temp.sel_plain select 'skill', * from public.select_cv_source(7, 'skill', 'a4000000-0000-4000-8000-000000000001');
insert into pg_temp.sel_plain select 'cert', * from public.select_cv_source(8, 'certification', 'a3000000-0000-4000-8000-000000000001');
select is(
  (select array_agg(cv_revision order by cv_revision) from pg_temp.sel_plain), array[6, 7, 8, 9],
  'each successful selection raises the CV revision by exactly one'
);
select ok(
  (select bool_and(cardinality(item_ids) = 1 and cardinality(parent_item_ids) = 0) from pg_temp.sel_plain),
  'experience, education, skill and certification items have no parents'
);
select is(
  (select array_agg(k order by k collate "C") from public.cv_items i, jsonb_object_keys(i.source_snapshot) as k
   where i.experience_id = 'a1000000-0000-4000-8000-000000000001'),
  array['description', 'end_date', 'end_precision', 'is_current', 'kind', 'organization', 'role_title', 'schema_version',
        'source_id', 'source_type', 'start_date', 'start_precision'],
  'the experience snapshot holds exactly the display fields'
);
select is(
  (select array_agg(k order by k collate "C") from public.cv_items i, jsonb_object_keys(i.source_snapshot) as k
   where i.certification_id = 'a3000000-0000-4000-8000-000000000001'),
  array['credential_url', 'issued_date', 'issued_precision', 'issuer', 'name', 'schema_version', 'source_id', 'source_type'],
  'the certification snapshot holds exactly the display fields'
);
select is(
  (select source_snapshot ->> 'issued_date' from public.cv_items where certification_id = 'a3000000-0000-4000-8000-000000000001'),
  null, 'unknown dates stay null in the snapshot'
);
select is(
  (select array_agg(k order by k collate "C") from public.cv_items i, jsonb_object_keys(i.source_snapshot) as k
   where i.skill_id = 'a4000000-0000-4000-8000-000000000001'),
  array['name', 'schema_version', 'source_id', 'source_type'], 'the skill snapshot holds exactly the display fields'
);

-- The experience picked explicitly now exists; selecting another project achievement must not duplicate it.
-- (Experience E1 is selected; A2 = project P1 achievement already added, so reuse is proven via a second scenario below.)

-- Confirming an achievement never adds it to the CV.
insert into public.achievements (id, user_id, title, contribution, outcome, cv_bullet, achieved_on, status) values
  ('a5000000-0000-4000-8000-000000000007', '11818181-1818-4181-8181-181818181811', 'Belum dikonfirmasi', 'Kontribusi', 'Hasil', 'Bullet', '2024-03-01', 'draft');
create temporary table pg_temp.cv_items_before as select count(*) as n from public.cv_items where user_id = '11818181-1818-4181-8181-181818181811';
select is(
  pg_temp.sqlstate_of($sql$select * from public.save_achievement('a5000000-0000-4000-8000-000000000007', 1, 'confirm', '{}'::jsonb, null)$sql$),
  'ok', 'the achievement is confirmed through the existing lifecycle RPC'
);
select is(
  (select count(*)::integer from public.cv_items where user_id = '11818181-1818-4181-8181-181818181811'),
  (select n::integer from pg_temp.cv_items_before), 'confirming an achievement does not add it to the CV'
);
select is(
  pg_temp.try(format('select * from public.select_cv_source(9, %L, %L)', 'achievement', 'a5000000-0000-4000-8000-000000000007')),
  'ok', 'once confirmed, the achievement becomes eligible'
);
select ok(pg_temp.cv_rev('11818181-1818-4181-8181-181818181811') = 10, 'the successful select raised the revision once more');

-- Parent already selected is reused: experience E1 is already an item, add an achievement whose parent is E1 only.
insert into public.achievements (id, user_id, experience_id, title, contribution, outcome, cv_bullet, achieved_on, status) values
  ('a5000000-0000-4000-8000-000000000008', '11818181-1818-4181-8181-181818181811', 'a1000000-0000-4000-8000-000000000001',
   'Di bawah magang', 'Kontribusi', 'Hasil', 'Bullet magang', '2023-09-01', 'confirmed');
create temporary table pg_temp.sel_reuse as
  select * from public.select_cv_source(10, 'achievement', 'a5000000-0000-4000-8000-000000000008');
select ok(
  (select cardinality(item_ids) = 1 and cardinality(parent_item_ids) = 0 from pg_temp.sel_reuse)
  and (select count(*) = 1 from public.cv_items where experience_id = 'a1000000-0000-4000-8000-000000000001'),
  'an already selected parent is reused, not duplicated'
);

-- 6. Ownership -------------------------------------------------------------------

select pg_temp.set_jwt_subject('21818181-1818-4181-8181-181818181812');
set local role authenticated;
select is((select count(*)::integer from public.cv_items), 0, 'RLS: B sees no CV item of A');
select is((select count(*)::integer from public.cv_documents), 1, 'RLS: B sees only its own CV');
select is(pg_temp.sqlstate_of($sql$insert into public.cv_items (user_id, cv_id, section_key, position, source_snapshot, source_revision, source_deleted)
  values ('21818181-1818-4181-8181-181818181812', gen_random_uuid(), 'skills', 1, '{}', 1, true)$sql$),
  '42501', 'a direct item insert is denied');
select is(pg_temp.sqlstate_of($sql$update public.cv_documents set title = 'Hijack'$sql$), '42501', 'a direct CV update is denied');
select is(pg_temp.sqlstate_of($sql$delete from public.cv_items$sql$), '42501', 'a direct item delete is denied');
select is((select count(*)::integer from public.cv_exports), 0, 'RLS: cv_exports is readable and empty for B');
reset role;
select pg_temp.set_jwt_subject('11818181-1818-4181-8181-181818181811');
set local role authenticated;
select ok(
  (select count(*) > 0 from public.cv_items) and (select count(*) = 1 from public.cv_documents),
  'RLS: A sees its own CV and items'
);
reset role;
select pg_temp.set_jwt_subject('21818181-1818-4181-8181-181818181812');
select is(
  pg_temp.try(format('select * from public.select_cv_source(1, %L, %L)', 'skill', 'a4000000-0000-4000-8000-000000000002')),
  'P0001|CV_SOURCE_NOT_FOUND|', 'B cannot select a source of A'
);
select is(
  pg_temp.try(format('select * from public.remove_cv_item(1, %L, false)', (select id from public.cv_items where skill_id = 'a4000000-0000-4000-8000-000000000001'))),
  'P0001|CV_ITEM_NOT_FOUND|', 'B cannot remove an item of A'
);
select is(
  pg_temp.try(format('select * from public.reorder_cv_section(1, %L, %L)', 'skills',
    array[(select id from public.cv_items where skill_id = 'a4000000-0000-4000-8000-000000000001')]::uuid[])),
  'P0001|CV_REORDER_INVALID|', 'B cannot reorder with an item of A'
);

-- 7. remove_cv_item, reorder_cv_section, update_cv_layout ---------------------------

select pg_temp.set_jwt_subject('11818181-1818-4181-8181-181818181811');
select is(
  pg_temp.try(format('select * from public.remove_cv_item(11, %L, false)', (select id from public.cv_items where project_id = 'a6000000-0000-4000-8000-000000000002'))),
  'P0001|CV_CHILD_ITEMS_EXIST|' || (select jsonb_agg(id)::text from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000001'),
  'removing a parent without deciding about its children lists exactly the child item ids'
);
select is(pg_temp.cv_state('11818181-1818-4181-8181-181818181811'), 'rev=11 items=13', 'the refused removal wrote nothing');
select is(
  pg_temp.try(format('select * from public.remove_cv_item(3, %L, false)', (select id from public.cv_items where skill_id = 'a4000000-0000-4000-8000-000000000001'))),
  'P0001|STALE_REVISION|', 'a stale revision on remove is rejected'
);
-- Experience E1 has a child (a8 achievement) since its project parent rule does not apply to it.
select is(
  pg_temp.try(format('select * from public.remove_cv_item(11, %L, false)', (select id from public.cv_items where experience_id = 'a1000000-0000-4000-8000-000000000001'))),
  'P0001|CV_CHILD_ITEMS_EXIST|' || (select jsonb_agg(id)::text from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000008'),
  'an experience parent lists only the achievements whose required parent it is'
);
-- Achievement a2 (project P1 + experience E1): project P1 is its parent; E1 removal does not list it (proved above).

create temporary table pg_temp.rm_child as
  select * from public.remove_cv_item(11, (select id from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000004'), false);
select ok(
  (select cv_revision = 12 and cardinality(removed_item_ids) = 1 from pg_temp.rm_child)
  and pg_temp.positions('11818181-1818-4181-8181-181818181811', 'achievements') = '1,2,3,4,5'
  and (select count(*) = 0 from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000004'),
  'removing a leaf item deletes it, renumbers, and raises the revision once'
);
create temporary table pg_temp.rm_parent as
  select * from public.remove_cv_item(12, (select id from public.cv_items where project_id = 'a6000000-0000-4000-8000-000000000002'), true);
select ok(
  (select cv_revision = 13 and cardinality(removed_item_ids) = 2 from pg_temp.rm_parent)
  and (select count(*) = 0 from public.cv_items where project_id = 'a6000000-0000-4000-8000-000000000002')
  and (select count(*) = 0 from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000001')
  and pg_temp.positions('11818181-1818-4181-8181-181818181811', 'projects') = '1'
  and pg_temp.positions('11818181-1818-4181-8181-181818181811', 'achievements') = '1,2,3,4',
  'removing a parent with children removes both in one call and renumbers both sections'
);

-- reorder: skills has one item; add Python to test a swap.
select is(
  pg_temp.sqlstate_of($sql$select * from public.select_cv_source(13, 'skill', 'a4000000-0000-4000-8000-000000000002')$sql$),
  'ok', 'a second skill is selected'
);
create temporary table pg_temp.skill_ids as
  select array_agg(id order by position) as ids from public.cv_items where cv_id = pg_temp.cv_id('11818181-1818-4181-8181-181818181811') and section_key = 'skills';
select is(pg_temp.cv_rev('11818181-1818-4181-8181-181818181811'), 14, 'revision is 14 before the reorder');
select is(
  pg_temp.try(format('select * from public.reorder_cv_section(14, %L, %L)', 'skills', (select array[ids[1]] from pg_temp.skill_ids))),
  'P0001|CV_REORDER_INVALID|', 'a missing item is rejected'
);
select is(
  pg_temp.try(format('select * from public.reorder_cv_section(14, %L, %L)', 'skills', (select array[ids[1], ids[1]] from pg_temp.skill_ids))),
  'P0001|CV_REORDER_INVALID|', 'a duplicated item is rejected'
);
select is(
  pg_temp.try(format('select * from public.reorder_cv_section(14, %L, %L)', 'skills',
    (select array[ids[1], ids[2], (select id from public.cv_items where experience_id = 'a1000000-0000-4000-8000-000000000001')] from pg_temp.skill_ids))),
  'P0001|CV_REORDER_INVALID|', 'an item of another section is rejected'
);
select is(
  pg_temp.try(format('select * from public.reorder_cv_section(14, %L, %L)', 'hobbies', (select ids from pg_temp.skill_ids))),
  '22023|INVALID_CV_INPUT|', 'an unknown section is invalid input'
);
select is(
  pg_temp.try(format('select * from public.reorder_cv_section(3, %L, %L)', 'skills', (select ids from pg_temp.skill_ids))),
  'P0001|STALE_REVISION|', 'a stale revision on reorder is rejected'
);
select is(pg_temp.cv_rev('11818181-1818-4181-8181-181818181811'), 14, 'rejected reorders do not raise the revision');
select is(
  (select public.reorder_cv_section(14, 'skills', (select array[ids[2], ids[1]] from pg_temp.skill_ids))), 15,
  'a swap of two items succeeds and returns the new revision'
);
select is(
  (select array_agg(id order by position) from public.cv_items where cv_id = pg_temp.cv_id('11818181-1818-4181-8181-181818181811') and section_key = 'skills'),
  (select array[ids[2], ids[1]] from pg_temp.skill_ids), 'the positions follow the requested order'
);
select is(pg_temp.positions('11818181-1818-4181-8181-181818181811', 'skills'), '1,2', 'positions stay contiguous after a swap');

select is(
  pg_temp.try(format('select public.update_cv_layout(15, null, null)')),
  '22023|INVALID_CV_INPUT|', 'a layout update with nothing to change is invalid'
);
select is(
  pg_temp.try(format('select public.update_cv_layout(15, %L, null)', 'fr')),
  '22023|INVALID_CV_INPUT|', 'an unsupported locale is invalid input'
);
select is(
  pg_temp.try(format('select public.update_cv_layout(15, null, %L::jsonb)', '["skills","projects"]')),
  '22023|INVALID_CV_INPUT|', 'a partial section order is invalid input'
);
select is(
  pg_temp.try(format('select public.update_cv_layout(2, %L, null)', 'en')),
  'P0001|STALE_REVISION|', 'a stale revision on layout is rejected'
);
select is(
  (select public.update_cv_layout(15, 'en', '["skills","education","experience","projects","achievements","certifications"]'::jsonb)), 16,
  'layout update raises the revision once'
);
select ok(
  (select locale = 'en' and section_order = '["skills","education","experience","projects","achievements","certifications"]'::jsonb
   from public.cv_documents where user_id = '11818181-1818-4181-8181-181818181811'),
  'locale and section order are stored'
);
select ok(
  (select source_snapshot ->> 'cv_bullet' = 'Membangun dasbor untuk tim operasi'
   from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000002'),
  'changing the locale does not translate or touch source snapshots'
);
select is(
  (select public.update_cv_layout(16, 'id', null)), 17, 'locale alone is enough for a layout update'
);

-- 8. Source deletion keeps the CV valid -----------------------------------------------

select is(pg_temp.sqlstate_of(format('select * from public.delete_skill(%L, %L)', 'a4000000-0000-4000-8000-000000000001',
  (select revision from public.skills where id = 'a4000000-0000-4000-8000-000000000001'))), 'ok', 'a selected skill can be deleted');
select is(pg_temp.sqlstate_of(format('select * from public.delete_education(%L, %L)', 'a2000000-0000-4000-8000-000000000001',
  (select revision from public.education where id = 'a2000000-0000-4000-8000-000000000001'))), 'ok', 'a selected education can be deleted');
select is(pg_temp.sqlstate_of(format('select * from public.delete_certification(%L, %L)', 'a3000000-0000-4000-8000-000000000001',
  (select revision from public.certifications where id = 'a3000000-0000-4000-8000-000000000001'))), 'ok', 'a selected certification can be deleted');
select is(pg_temp.sqlstate_of(format('select * from public.delete_achievement(%L, %L)', 'a5000000-0000-4000-8000-000000000003',
  (select revision from public.achievements where id = 'a5000000-0000-4000-8000-000000000003'))), 'ok', 'a selected achievement can be deleted');
select is(pg_temp.sqlstate_of(format('select * from public.delete_project(%L, %L)', 'a6000000-0000-4000-8000-000000000001',
  (select revision from public.projects where id = 'a6000000-0000-4000-8000-000000000001'))), 'ok', 'a selected project can be deleted');
select is(pg_temp.sqlstate_of(format('select * from public.delete_experience(%L, %L)', 'a1000000-0000-4000-8000-000000000001',
  (select revision from public.experiences where id = 'a1000000-0000-4000-8000-000000000001'))), 'ok', 'a selected experience can be deleted');
select is(
  (select count(*)::integer from public.cv_items
   where user_id = '11818181-1818-4181-8181-181818181811' and source_deleted
     and num_nonnulls(experience_id, project_id, achievement_id, education_id, skill_id, certification_id) = 0),
  6, 'the six matching items are marked source_deleted with every source column null'
);
select ok(
  (select bool_and(source_snapshot ? 'source_id' and source_snapshot ? 'source_type' and source_snapshot ->> 'schema_version' = 'cv-source.v1')
   from public.cv_items where source_deleted and user_id = '11818181-1818-4181-8181-181818181811'),
  'the snapshots of deleted sources are preserved'
);
select is(
  (select count(*)::integer from public.cv_items where user_id = '11818181-1818-4181-8181-181818181811'), 11,
  'no item is deleted by source deletion'
);
select is(
  (select string_agg(section_key || ':' || position::text, ',' order by section_key, position)
   from public.cv_items where source_deleted and section_key in ('education', 'skills', 'certifications')),
  'certifications:1,education:1,skills:2', 'deleted items keep their position (the skill was swapped to position 2 earlier)'
);
select is(
  pg_temp.sqlstate_of(format($sql$update public.cv_items set skill_id = 'a4000000-0000-4000-8000-000000000002' where id = %L$sql$,
    (select id from public.cv_items where source_deleted and section_key = 'education'))),
  'P0001', 'restoring a source on a deleted item is refused (CV_ITEM_IMMUTABLE)'
);
select is(
  pg_temp.sqlstate_of(format($sql$update public.cv_items set section_key = 'skills' where id = %L$sql$,
    (select id from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000002'))),
  'P0001', 'the section of an item is immutable'
);
select is(
  (select count(*)::integer from public.cv_items where source_deleted and revision >= 2), 6,
  'source deletion updated each affected item through the guarded trigger path'
);
-- Remove a parent whose source was deleted: the snapshot still identifies its children.
select is(
  pg_temp.try(format('select * from public.remove_cv_item(17, %L, false)',
    (select id from public.cv_items where source_deleted and section_key = 'projects'))),
  'P0001|CV_CHILD_ITEMS_EXIST|' || (select jsonb_agg(id)::text from public.cv_items where achievement_id = 'a5000000-0000-4000-8000-000000000002'),
  'a deleted parent still resolves its children through the snapshot'
);
select ok(
  (select cv_revision = 18 and cardinality(removed_item_ids) = 2
   from public.remove_cv_item(17, (select id from public.cv_items where source_deleted and section_key = 'projects'), true)),
  'a deleted parent can be removed together with its children'
);

select * from finish();
rollback;

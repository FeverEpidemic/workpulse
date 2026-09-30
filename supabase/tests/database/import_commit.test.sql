begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T16 import commit transaction (DB §4, PRD R02, F01 step 3-4).
-- Fixtures are inserted directly as the test owner; the T15 pipeline that produces review batches
-- is proven in import_staging.test.sql and the real integration suite.

-- 1. Structure and privileges -------------------------------------------------

select has_column('import_items', 'confirm_requested', 'import_items.confirm_requested exists');
select col_type_is('import_items', 'confirm_requested', 'boolean', 'confirm_requested is boolean');
select has_column('import_batches', 'commit_result', 'import_batches.commit_result exists');
select col_type_is('import_batches', 'commit_result', 'jsonb', 'commit_result is jsonb');

select ok(
  exists (select 1 from pg_catalog.pg_constraint where conname = 'import_items_confirm_check' and conrelid = 'public.import_items'::regclass)
  and exists (select 1 from pg_catalog.pg_constraint where conname = 'import_batches_commit_result_check' and conrelid = 'public.import_batches'::regclass),
  'confirm and commit_result checks exist'
);
select ok(
  exists (select 1 from pg_catalog.pg_trigger where tgname = 'import_items_validate_target' and tgrelid = 'public.import_items'::regclass and not tgisinternal),
  'type-aware target trigger exists on import_items'
);
select ok(
  has_function_privilege('authenticated', 'public.update_import_item(uuid,integer,text,uuid,jsonb,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.validate_import_batch(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commit_import_batch(uuid,integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_import_item(uuid,integer,text,uuid,jsonb,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commit_import_batch(uuid,integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.commit_import_batch(uuid,integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.validate_import_batch(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.import_item_errors(uuid,uuid)', 'EXECUTE'),
  'the three T16 RPCs are executable by authenticated only; the validator is internal'
);
select ok(
  (select bool_and(proc.prosecdef) from pg_catalog.pg_proc as proc
   join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
   where ns.nspname = 'public' and proc.proname in ('update_import_item', 'validate_import_batch', 'commit_import_batch')),
  'T16 RPCs are security definer'
);
select ok(
  not has_table_privilege('authenticated', 'public.import_batches', 'INSERT')
  and not has_table_privilege('authenticated', 'public.import_batches', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.import_items', 'INSERT')
  and not has_table_privilege('authenticated', 'public.import_items', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.import_items', 'DELETE'),
  'authenticated still has no write grant on import tables'
);
select ok(
  has_column_privilege('authenticated', 'public.import_batches', 'commit_result', 'SELECT')
  and not has_column_privilege('authenticated', 'public.import_batches', 'extracted_text', 'SELECT'),
  'commit_result is client-readable while extracted_text stays private'
);

-- 2. Fixtures -------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11616161-1616-4161-8161-161616161611', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'commit-a@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('21616161-1616-4161-8161-161616161612', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'commit-b@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('31616161-1616-4161-8161-161616161613', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'commit-d@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('41616161-1616-4161-8161-161616161614', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'commit-e@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

update public.profiles set display_name = 'Ani Contoh', onboarding_completed_at = now()
where id in ('11616161-1616-4161-8161-161616161611', '21616161-1616-4161-8161-161616161612', '41616161-1616-4161-8161-161616161614');

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

create or replace function pg_temp.canon(p_user_id uuid)
returns text language sql as $$
  select format('exp=%s edu=%s cert=%s skill=%s ach=%s proj=%s prof_rev=%s onb=%s',
    (select count(*) from public.experiences where user_id = p_user_id),
    (select count(*) from public.education where user_id = p_user_id),
    (select count(*) from public.certifications where user_id = p_user_id),
    (select count(*) from public.skills where user_id = p_user_id),
    (select count(*) from public.achievements where user_id = p_user_id),
    (select count(*) from public.projects where user_id = p_user_id),
    (select revision from public.profiles where id = p_user_id),
    (select onboarding_completed_at is not null from public.profiles where id = p_user_id));
$$;

create temporary table pg_temp.ids (label text primary key, id uuid not null);
grant select on pg_temp.ids to public;
create or replace function pg_temp.id(p_label text) returns uuid language sql as
$$ select id from pg_temp.ids where label = p_label $$;

create or replace function pg_temp.mk_batch(p_label text, p_user_id uuid, p_status text default 'review')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  if p_status = 'review' then
    insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256,
      status, stage, page_count, extracted_text)
    values (v_id, p_user_id, gen_random_uuid(), decode(repeat('00', 32), 'hex'), p_user_id::text || '/import/' || v_id::text,
      'cv-WP-FILENAME-SENTINEL.pdf', 'application/pdf', 1000, md5(v_id::text) || md5(p_label), 'review', 'done', 2, 'WP-PRIVATE-IMPORT-SENTINEL');
  elsif p_status = 'queued' then
    insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256)
    values (v_id, p_user_id, gen_random_uuid(), decode(repeat('00', 32), 'hex'), p_user_id::text || '/import/' || v_id::text,
      'cv.pdf', 'application/pdf', 1000, md5(v_id::text) || md5(p_label));
  elsif p_status = 'running' then
    insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage)
    values (v_id, p_user_id, gen_random_uuid(), decode(repeat('00', 32), 'hex'), p_user_id::text || '/import/' || v_id::text,
      'cv.pdf', 'application/pdf', 1000, md5(v_id::text) || md5(p_label), 'running', 'parsing');
  elsif p_status = 'failed' then
    insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256,
      status, stage, error_code, failed_at, expires_at)
    values (v_id, p_user_id, gen_random_uuid(), decode(repeat('00', 32), 'hex'), p_user_id::text || '/import/' || v_id::text,
      'cv.pdf', 'application/pdf', 1000, md5(v_id::text) || md5(p_label), 'failed', 'parsing', 'CORRUPT_FILE', now(), now() + interval '1 hour');
  elsif p_status = 'cancelled' then
    insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256,
      status, stage, cancelled_at, expires_at)
    values (v_id, p_user_id, gen_random_uuid(), decode(repeat('00', 32), 'hex'), p_user_id::text || '/import/' || v_id::text,
      'cv.pdf', 'application/pdf', 1000, md5(v_id::text) || md5(p_label), 'cancelled', 'parsing', now(), now() + interval '1 hour');
  end if;
  insert into pg_temp.ids values (p_label, v_id);
  return v_id;
end;
$$;

create or replace function pg_temp.mk_item(
  p_label text, p_batch_label text, p_type text, p_ordinal integer, p_payload jsonb,
  p_action text default 'create', p_target uuid default null, p_confirm boolean default false
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.import_items (id, user_id, batch_id, entity_type, ordinal, payload, source_excerpt, action, target_id, confirm_requested)
  select v_id, batch.user_id, batch.id, p_type, p_ordinal, p_payload, 'EXCERPT|' || p_label, p_action, p_target, p_confirm
  from public.import_batches as batch where batch.id = pg_temp.id(p_batch_label);
  insert into pg_temp.ids values (p_label, v_id);
  return v_id;
end;
$$;

-- Existing canonical rows for map targets.
insert into public.experiences (id, user_id, organization, role_title, kind) values
  ('a1000000-0000-4000-8000-000000000001', '11616161-1616-4161-8161-161616161611', 'PT Lama Sentosa', 'Staf', 'employment'),
  ('b1000000-0000-4000-8000-000000000001', '21616161-1616-4161-8161-161616161612', 'B Corp', 'Staff', 'employment');
insert into public.education (id, user_id, institution, qualification) values
  ('a2000000-0000-4000-8000-000000000001', '11616161-1616-4161-8161-161616161611', 'SMA Lama', 'SMA');
insert into public.certifications (id, user_id, name) values
  ('a3000000-0000-4000-8000-000000000001', '11616161-1616-4161-8161-161616161611', 'Sertifikat Lama');
insert into public.skills (id, user_id, name) values
  ('a4000000-0000-4000-8000-000000000001', '11616161-1616-4161-8161-161616161611', 'SQL'),
  ('b4000000-0000-4000-8000-000000000001', '21616161-1616-4161-8161-161616161612', 'B Skill');
insert into public.achievements (id, user_id, title) values
  ('a5000000-0000-4000-8000-000000000001', '11616161-1616-4161-8161-161616161611', 'Pencapaian lama');

-- Main review batch (owner A): every entity type and action.
select pg_temp.mk_batch('main', '11616161-1616-4161-8161-161616161611');
select pg_temp.mk_item('m-profile', 'main', 'profile', 0, jsonb_build_object(
  'display_name', 'Ani Import', 'headline', 'Analis Data', 'summary', 'Ringkas', 'contact_email', 'ani@example.com',
  'phone', '0812', 'location', 'Jakarta', 'website', 'https://example.com', 'selected_fields', jsonb_build_array('headline', 'location')));
select pg_temp.mk_item('m-exp0', 'main', 'experience', 0, jsonb_build_object(
  'organization', 'PT Sentinel Nusantara', 'role_title', 'Analis Data', 'kind', 'employment', 'description', null,
  'start_date', '2019-01-01', 'start_precision', 'year', 'end_date', '2022-01-01', 'end_precision', 'year', 'is_current', false));
select pg_temp.mk_item('m-exp1', 'main', 'experience', 1, jsonb_build_object(
  'organization', 'WP Labs', 'role_title', 'Data Lead', 'kind', 'employment', 'description', 'Memimpin tim',
  'start_date', '2021-03-01', 'start_precision', 'month', 'end_date', null, 'end_precision', null, 'is_current', true));
select pg_temp.mk_item('m-exp2', 'main', 'experience', 2, jsonb_build_object('organization', 'Diabaikan', 'role_title', 'Diabaikan'),
  'map', 'a1000000-0000-4000-8000-000000000001');
select pg_temp.mk_item('m-exp3', 'main', 'experience', 3, jsonb_build_object('organization', null, 'role_title', null, 'kind', 'salah'), 'skip');
select pg_temp.mk_item('m-edu0', 'main', 'education', 0, jsonb_build_object(
  'institution', 'Universitas Contoh', 'qualification', 'S1 Statistika', 'field_of_study', 'Statistika', 'description', null,
  'start_date', '2014-01-01', 'start_precision', 'year', 'end_date', '2018-01-01', 'end_precision', 'year', 'is_current', false));
select pg_temp.mk_item('m-edu1', 'main', 'education', 1, jsonb_build_object('institution', 'x', 'qualification', 'x'),
  'map', 'a2000000-0000-4000-8000-000000000001');
select pg_temp.mk_item('m-cert0', 'main', 'certification', 0, jsonb_build_object(
  'name', 'Data Analyst', 'issuer', 'Dicoding', 'issued_date', '2020-05-01', 'issued_precision', 'month', 'credential_url', 'https://example.com/c/1'));
select pg_temp.mk_item('m-cert1', 'main', 'certification', 1, jsonb_build_object(
  'name', 'Tanpa Tautan', 'issuer', null, 'issued_date', null, 'issued_precision', null, 'credential_url', null));
select pg_temp.mk_item('m-skill0', 'main', 'skill', 0, jsonb_build_object('name', 'Python'));
select pg_temp.mk_item('m-skill1', 'main', 'skill', 1, jsonb_build_object('name', 'sql'), 'map', 'a4000000-0000-4000-8000-000000000001');
select pg_temp.mk_item('m-skill2', 'main', 'skill', 2, jsonb_build_object('name', 'Dilewati'), 'skip');
select pg_temp.mk_item('m-ach0', 'main', 'achievement', 0, jsonb_build_object(
  'status', 'draft', 'title', 'Menurunkan waktu laporan', 'contribution', null, 'outcome', null, 'achieved_on', null,
  'cv_bullet', null, 'metrics', '[]'::jsonb, 'experience_item_id', pg_temp.id('m-exp0')));
select pg_temp.mk_item('m-ach1', 'main', 'achievement', 1, jsonb_build_object(
  'status', 'draft', 'title', 'Membangun pipeline', 'contribution', 'Menyusun laporan', 'outcome', 'Waktu turun',
  'achieved_on', '2021-06-15', 'cv_bullet', null,
  'metrics', jsonb_build_array(jsonb_build_object('label', 'Waktu laporan', 'value', 2, 'unit', 'jam', 'baseline', 5)),
  'experience_item_id', pg_temp.id('m-exp2')), 'create', null, true);
select pg_temp.mk_item('m-ach2', 'main', 'achievement', 2, jsonb_build_object(
  'status', 'draft', 'title', 'Mandiri', 'contribution', null, 'outcome', null, 'achieved_on', null, 'cv_bullet', null,
  'metrics', '[]'::jsonb, 'experience_item_id', pg_temp.id('m-exp3')));
select pg_temp.mk_item('m-ach3', 'main', 'achievement', 3, jsonb_build_object('status', 'draft', 'title', 'abaikan'),
  'map', 'a5000000-0000-4000-8000-000000000001');

-- 3. update_import_item ---------------------------------------------------------

select pg_temp.mk_batch('upd', '11616161-1616-4161-8161-161616161611');
select pg_temp.mk_item('u-exp', 'upd', 'experience', 0, jsonb_build_object(
  'organization', 'PT Sementara', 'role_title', 'Analis', 'kind', 'employment', 'is_current', false));
select pg_temp.mk_item('u-ach', 'upd', 'achievement', 0, jsonb_build_object('status', 'draft', 'title', 'Judul'));
select pg_temp.mk_item('u-skill', 'upd', 'skill', 0, jsonb_build_object('name', 'Excel'));
select pg_temp.mk_batch('other', '11616161-1616-4161-8161-161616161611');
select pg_temp.mk_item('o-exp', 'other', 'experience', 0, jsonb_build_object('organization', 'Lain', 'role_title', 'Lain'));
select pg_temp.mk_batch('cancelled', '11616161-1616-4161-8161-161616161611', 'cancelled');
select pg_temp.mk_item('c-exp', 'cancelled', 'experience', 0, jsonb_build_object('organization', 'X', 'role_title', 'Y'));

select pg_temp.set_jwt_subject('11616161-1616-4161-8161-161616161611');
create temporary table pg_temp.upd_before as
select (select revision from public.import_batches where id = pg_temp.id('upd')) as batch_rev,
       (select revision from public.import_items where id = pg_temp.id('u-exp')) as item_rev;

create temporary table pg_temp.upd1 as
select * from public.update_import_item(pg_temp.id('u-exp'), 1, 'create', null,
  '{"role_title":"  Lead Analis  ","description":"Deskripsi"}'::jsonb, null);
select ok(
  (select item_revision = 2 and batch_revision = (select batch_rev + 1 from pg_temp.upd_before) from pg_temp.upd1),
  'update_import_item raises both the item and the batch revision'
);
select is(
  (select payload ->> 'role_title' from public.import_items where id = pg_temp.id('u-exp')), '  Lead Analis  ',
  'the patch is stored as written (trimming happens at commit)'
);
select is(
  (select payload ->> 'organization' from public.import_items where id = pg_temp.id('u-exp')), 'PT Sementara',
  'fields outside the patch are untouched'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, null, %L, null)', pg_temp.id('u-exp'), 'create', '{"role_title":"x"}')),
  'P0001|STALE_REVISION|', 'a stale item revision is rejected without a write'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 2, %L, null, %L, null)', pg_temp.id('u-exp'), 'create', '{"source_excerpt":"x"}')),
  '22023|INVALID_IMPORT_ITEM_INPUT|', 'a key outside the allowlist is rejected'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 2, %L, null, %L, null)', pg_temp.id('u-exp'), 'create', '{"is_current":"ya"}')),
  '22023|INVALID_IMPORT_ITEM_INPUT|', 'a wrong value type is rejected'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 2, %L, null, null, null)', pg_temp.id('u-exp'), 'hapus')),
  '22023|INVALID_IMPORT_ITEM_INPUT|', 'an unknown action is rejected'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 2, %L, null, null, true)', pg_temp.id('u-exp'), 'create')),
  '22023|INVALID_IMPORT_ITEM_INPUT|', 'confirm_requested is rejected on a non-achievement'
);
select is(
  (select revision from public.import_items where id = pg_temp.id('u-exp')), 2, 'rejected updates leave the item revision alone'
);
create temporary table pg_temp.upd_confirm as
select * from public.update_import_item(pg_temp.id('u-ach'), 1, 'create', null, null, true);
select ok(
  (select item_revision = 2 from pg_temp.upd_confirm)
  and (select confirm_requested from public.import_items where id = pg_temp.id('u-ach')),
  'confirm_requested can be requested on an achievement create'
);
create temporary table pg_temp.upd_skip as
select * from public.update_import_item(pg_temp.id('u-ach'), 2, 'skip', null, null, null);
select ok(
  (select item_revision = 3 from pg_temp.upd_skip)
  and not (select confirm_requested from public.import_items where id = pg_temp.id('u-ach')),
  'leaving create clears confirm_requested'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 3, %L, null, null, true)', pg_temp.id('u-ach'), 'skip')),
  '22023|INVALID_IMPORT_ITEM_INPUT|', 'confirm_requested is rejected on a skipped achievement'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 3, %L, null, %L, null)', pg_temp.id('u-ach'), 'create',
    jsonb_build_object('experience_item_id', pg_temp.id('o-exp')))),
  '22023|INVALID_IMPORT_ITEM_INPUT|', 'experience_item_id cannot point at another batch'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 3, %L, null, %L, null)', pg_temp.id('u-ach'), 'create',
    jsonb_build_object('experience_item_id', pg_temp.id('u-exp')))),
  'ok', 'experience_item_id may point at an experience item of the same batch'
);
select is(
  (select (entity_type || ordinal::text || source_excerpt) from public.import_items where id = pg_temp.id('u-ach')),
  'achievement0EXCERPT|u-ach', 'entity_type, ordinal and the source excerpt never change'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, null, null, null)', pg_temp.id('c-exp'), 'skip')),
  'P0001|IMPORT_NOT_REVIEWABLE|', 'a batch that is not in review cannot be edited'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, null, null, null)', gen_random_uuid(), 'skip')),
  'P0001|IMPORT_NOT_FOUND|', 'an unknown item is reported generically'
);

-- 4. Type-aware target trigger --------------------------------------------------

select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, %L, null, null)', pg_temp.id('u-skill'), 'map', 'b4000000-0000-4000-8000-000000000001')),
  '22023|IMPORT_TARGET_INVALID|', 'map to a skill owned by another account is rejected'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, %L, null, null)', pg_temp.id('u-skill'), 'map', gen_random_uuid())),
  '22023|IMPORT_TARGET_INVALID|', 'map to an unknown id is rejected'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, %L, null, null)', pg_temp.id('u-skill'), 'map', 'a1000000-0000-4000-8000-000000000001')),
  '22023|IMPORT_TARGET_INVALID|', 'map to a row of the wrong table (experience for a skill) is rejected'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, null, null, null)', pg_temp.id('u-skill'), 'map')),
  '22023|IMPORT_TARGET_INVALID|', 'map without a target is rejected'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, %L, null, null)', pg_temp.id('u-skill'), 'create', 'a4000000-0000-4000-8000-000000000001')),
  '22023|IMPORT_TARGET_INVALID|', 'create with a target is rejected'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, %L, null, null)', pg_temp.id('u-skill'), 'map', 'a4000000-0000-4000-8000-000000000001')),
  'ok', 'map to an own skill is accepted'
);
select is(
  (select target_id::text from public.import_items where id = pg_temp.id('u-skill')), 'a4000000-0000-4000-8000-000000000001',
  'the map choice is persisted'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 2, %L, null, null, null)', pg_temp.id('u-skill'), 'create')),
  'ok', 'switching back to create clears the target'
);
select is(
  (select target_id from public.import_items where id = pg_temp.id('u-skill')), null::uuid, 'target_id is cleared when leaving map'
);
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, %L, null, null)', pg_temp.id('m-profile'), 'map', 'a1000000-0000-4000-8000-000000000001')),
  '22023|IMPORT_TARGET_INVALID|', 'a profile item can never map'
);

-- 5. validate_import_batch --------------------------------------------------------

insert into public.experiences (id, user_id, organization, role_title, kind)
values ('a1000000-0000-4000-8000-0000000000ff', '11616161-1616-4161-8161-161616161611', 'Akan Dihapus', 'X', 'employment');
select pg_temp.mk_batch('val', '11616161-1616-4161-8161-161616161611');
select pg_temp.mk_item('v-exp-req', 'val', 'experience', 0, jsonb_build_object('organization', null, 'role_title', 'Analis', 'kind', 'employment'));
select pg_temp.mk_item('v-exp-long', 'val', 'experience', 1, jsonb_build_object('organization', 'Org', 'role_title', repeat('x', 201), 'kind', 'employment'));
select pg_temp.mk_item('v-exp-kind', 'val', 'experience', 2, jsonb_build_object('organization', 'Org', 'role_title', 'Role', 'kind', 'freelance'));
select pg_temp.mk_item('v-exp-range', 'val', 'experience', 3, jsonb_build_object('organization', 'Org', 'role_title', 'Role', 'kind', 'employment',
  'start_date', '2022-01-01', 'start_precision', 'year', 'end_date', '2019-01-01', 'end_precision', 'year', 'is_current', false));
select pg_temp.mk_item('v-exp-date', 'val', 'experience', 4, jsonb_build_object('organization', 'Org', 'role_title', 'Role', 'kind', 'employment',
  'start_date', '2019-02-30', 'start_precision', 'day', 'is_current', false));
select pg_temp.mk_item('v-exp-skip', 'val', 'experience', 5, jsonb_build_object('organization', null), 'skip');
select pg_temp.mk_item('v-exp-gone', 'val', 'experience', 6, jsonb_build_object('organization', 'x', 'role_title', 'y'),
  'map', 'a1000000-0000-4000-8000-0000000000ff');
select pg_temp.mk_item('v-skill-db', 'val', 'skill', 0, jsonb_build_object('name', '  SQL  '));
select pg_temp.mk_item('v-skill-a', 'val', 'skill', 1, jsonb_build_object('name', 'Go'));
select pg_temp.mk_item('v-skill-b', 'val', 'skill', 2, jsonb_build_object('name', 'go'));
select pg_temp.mk_item('v-cert-url', 'val', 'certification', 0, jsonb_build_object('name', 'Cert', 'credential_url', 'ftp://example.com/x'));
select pg_temp.mk_item('v-ach-confirm', 'val', 'achievement', 0, jsonb_build_object(
  'status', 'draft', 'title', 'T', 'contribution', 'C', 'outcome', 'O', 'achieved_on', null, 'cv_bullet', null, 'metrics', '[]'::jsonb),
  'create', null, true);
select pg_temp.mk_item('v-ach-metric', 'val', 'achievement', 1, jsonb_build_object(
  'status', 'draft', 'title', 'T', 'metrics', jsonb_build_array(jsonb_build_object('label', '', 'value', 1, 'unit', 'x'))));
select pg_temp.mk_item('v-ach-ref', 'val', 'achievement', 2, jsonb_build_object(
  'status', 'draft', 'title', 'T', 'metrics', '[]'::jsonb, 'experience_item_id', gen_random_uuid()));
delete from public.experiences where id = 'a1000000-0000-4000-8000-0000000000ff';

select pg_temp.set_jwt_subject('11616161-1616-4161-8161-161616161611');
create temporary table pg_temp.val as select * from public.validate_import_batch(pg_temp.id('val'));
grant select on pg_temp.val to public;
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-exp-req') and field = 'organization' and code = 'REQUIRED'), 'REQUIRED is reported');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-exp-long') and field = 'role_title' and code = 'TOO_LONG'), 'TOO_LONG is reported');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-exp-kind') and field = 'kind' and code = 'INVALID'), 'an unknown kind is INVALID');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-exp-range') and field = 'end_date' and code = 'DATE_RANGE'), 'a certain reversed interval is DATE_RANGE');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-exp-date') and field = 'start_date' and code = 'INVALID'), 'an impossible calendar date is INVALID');
select ok(not exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-exp-skip')), 'a skipped item is never validated');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-exp-gone') and code = 'TARGET_UNAVAILABLE'), 'a map target deleted after review is TARGET_UNAVAILABLE');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-skill-db') and code = 'DUPLICATE' and existing_id = 'a4000000-0000-4000-8000-000000000001'), 'a skill that already exists is DUPLICATE with existing_id');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-skill-b') and code = 'DUPLICATE' and existing_id is null)
  and not exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-skill-a')), 'the second of two identical skills is DUPLICATE without existing_id');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-cert-url') and field = 'credential_url' and code = 'INVALID'), 'a non-http credential URL is INVALID');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-ach-confirm') and field = 'achieved_on' and code = 'REQUIRED'), 'confirming without achieved_on is REQUIRED');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-ach-metric') and field = 'metrics' and code = 'INVALID'), 'invalid metrics are INVALID');
select ok(exists (select 1 from pg_temp.val where item_id = pg_temp.id('v-ach-ref') and field = 'experience_item_id' and code = 'INVALID'), 'a dangling experience_item_id is INVALID');
select is(
  pg_temp.canon('11616161-1616-4161-8161-161616161611'),
  pg_temp.canon('11616161-1616-4161-8161-161616161611'), 'validate performs no writes'
);
select is(
  pg_temp.try(format('select * from public.validate_import_batch(%L)', pg_temp.id('cancelled'))),
  'P0001|IMPORT_NOT_REVIEWABLE|', 'validate needs a review batch'
);

-- 6. Rollback: one invalid item leaves nothing behind -----------------------------

select pg_temp.mk_batch('bad', '11616161-1616-4161-8161-161616161611');
select pg_temp.mk_item('b-exp-ok', 'bad', 'experience', 0, jsonb_build_object('organization', 'Valid Org', 'role_title', 'Valid Role', 'kind', 'employment'));
select pg_temp.mk_item('b-exp-bad', 'bad', 'experience', 1, jsonb_build_object('organization', 'Bad Org', 'role_title', null, 'kind', 'employment'));
select pg_temp.mk_item('b-skill', 'bad', 'skill', 0, jsonb_build_object('name', 'Valid Skill'));
select pg_temp.mk_item('b-profile', 'bad', 'profile', 0, jsonb_build_object('headline', 'Headline Baru', 'selected_fields', jsonb_build_array('headline')));

create temporary table pg_temp.canon_before as select pg_temp.canon('11616161-1616-4161-8161-161616161611') as s;
create temporary table pg_temp.bad_run as
select pg_temp.try(format('select public.commit_import_batch(%L, %s, null)', pg_temp.id('bad'),
  (select revision from public.import_batches where id = pg_temp.id('bad')))) as r;
select ok(
  (select r like '22023|IMPORT_ITEM_INVALID|%' from pg_temp.bad_run), 'one invalid selected item fails the commit'
);
select ok(
  (select r ~ pg_temp.id('b-exp-bad')::text and r ~ 'role_title' and r ~ 'REQUIRED' and r !~ 'Valid Org|Bad Org|WP-PRIVATE|SENTINEL' from pg_temp.bad_run),
  'the detail names the item, field and code only'
);
select is(pg_temp.canon('11616161-1616-4161-8161-161616161611'), (select s from pg_temp.canon_before), 'no canonical row or profile revision changed');
select ok(
  (select status = 'review' and committed_at is null and commit_result is null from public.import_batches where id = pg_temp.id('bad'))
  and not exists (select 1 from public.import_items where batch_id = pg_temp.id('bad') and committed_id is not null),
  'the batch stays in review with no committed_id'
);
select is(
  (select count(*) from public.validate_import_batch(pg_temp.id('bad'))), 1::bigint,
  'validate reports the same single error that fails the commit'
);

-- A violation that only a canonical constraint catches still rolls back without a raw message.
alter table public.experiences add constraint zz_t16_defense check (organization <> 'ZZ-DEFENSE');
select pg_temp.mk_batch('defense', '11616161-1616-4161-8161-161616161611');
select pg_temp.mk_item('d-skill', 'defense', 'skill', 0, jsonb_build_object('name', 'Defense Skill'));
select pg_temp.mk_item('d-exp', 'defense', 'experience', 0, jsonb_build_object('organization', 'ZZ-DEFENSE', 'role_title', 'Role', 'kind', 'employment'));
create temporary table pg_temp.canon_before2 as select pg_temp.canon('11616161-1616-4161-8161-161616161611') as s;
select is(
  pg_temp.try(format('select public.commit_import_batch(%L, %s, null)', pg_temp.id('defense'),
    (select revision from public.import_batches where id = pg_temp.id('defense')))),
  '22023|IMPORT_ITEM_INVALID|', 'a constraint violation is mapped to IMPORT_ITEM_INVALID without raw details'
);
select is(pg_temp.canon('11616161-1616-4161-8161-161616161611'), (select s from pg_temp.canon_before2), 'the defense-in-depth failure also writes nothing');
alter table public.experiences drop constraint zz_t16_defense;

-- 7. Successful mixed commit -------------------------------------------------------

create temporary table pg_temp.snap as
select 'exp' as k, to_jsonb(e) as row from public.experiences e where id = 'a1000000-0000-4000-8000-000000000001'
union all select 'edu', to_jsonb(e) from public.education e where id = 'a2000000-0000-4000-8000-000000000001'
union all select 'skill', to_jsonb(e) from public.skills e where id = 'a4000000-0000-4000-8000-000000000001'
union all select 'ach', to_jsonb(e) from public.achievements e where id = 'a5000000-0000-4000-8000-000000000001';
create temporary table pg_temp.counts_before as
select (select count(*) from public.experiences where user_id = '11616161-1616-4161-8161-161616161611') as e,
       (select count(*) from public.education where user_id = '11616161-1616-4161-8161-161616161611') as d,
       (select count(*) from public.certifications where user_id = '11616161-1616-4161-8161-161616161611') as c,
       (select count(*) from public.skills where user_id = '11616161-1616-4161-8161-161616161611') as s,
       (select count(*) from public.achievements where user_id = '11616161-1616-4161-8161-161616161611') as a;

select is(
  pg_temp.try(format('select public.commit_import_batch(%L, 999, null)', pg_temp.id('main'))),
  'P0001|STALE_REVISION|', 'a stale batch revision is rejected'
);
create temporary table pg_temp.commit1 as
select public.commit_import_batch(pg_temp.id('main'), (select revision from public.import_batches where id = pg_temp.id('main')),
  jsonb_build_object('display_name', 'Nama Tidak Dipakai', 'locale', 'id', 'timezone', 'Asia/Jakarta')) as r;
grant select on pg_temp.commit1 to public;

select ok(
  (select r ->> 'schema_version' = 'import-commit.v1' and (r ->> 'batch_id') = pg_temp.id('main')::text
     and (r -> 'counts' -> 'experience') = '{"created":2,"mapped":1,"skipped":1}'::jsonb
     and (r -> 'counts' -> 'education') = '{"created":1,"mapped":1,"skipped":0}'::jsonb
     and (r -> 'counts' -> 'certification') = '{"created":2,"mapped":0,"skipped":0}'::jsonb
     and (r -> 'counts' -> 'skill') = '{"created":1,"mapped":1,"skipped":1}'::jsonb
     and (r -> 'counts' -> 'achievement') = '{"created":3,"mapped":1,"skipped":0}'::jsonb
     and (r -> 'counts' -> 'profile') = '{"created":1,"mapped":0,"skipped":0}'::jsonb
     and (r ->> 'confirmed_achievements')::int = 1 and (r ->> 'profile_fields_applied')::int = 2
     and (r ->> 'onboarding_completed')::boolean = false from pg_temp.commit1),
  'the commit result carries only counts, booleans and ids'
);
select ok(
  (select experiences.n = b.e + 2 and education.n = b.d + 1 and certs.n = b.c + 2 and skills.n = b.s + 1 and ach.n = b.a + 3
   from pg_temp.counts_before b,
     lateral (select count(*) n from public.experiences where user_id = '11616161-1616-4161-8161-161616161611') experiences,
     lateral (select count(*) n from public.education where user_id = '11616161-1616-4161-8161-161616161611') education,
     lateral (select count(*) n from public.certifications where user_id = '11616161-1616-4161-8161-161616161611') certs,
     lateral (select count(*) n from public.skills where user_id = '11616161-1616-4161-8161-161616161611') skills,
     lateral (select count(*) n from public.achievements where user_id = '11616161-1616-4161-8161-161616161611') ach),
  'exactly the selected create items became rows (2 experience, 1 education, 2 certification, 1 skill, 3 achievement)'
);
select ok(
  (select status = 'committed' and committed_at is not null and expires_at = committed_at and commit_result is not null
   from public.import_batches where id = pg_temp.id('main')),
  'the batch is committed with committed_at and an immediate purge deadline'
);
select ok(
  (select count(*) filter (where committed_id is not null) = 9
     and count(*) filter (where action = 'create' and entity_type <> 'profile') = 9
     and bool_and(committed_id is null) filter (where action <> 'create' or entity_type = 'profile')
   from public.import_items where batch_id = pg_temp.id('main')),
  'committed_id is set for the 9 created rows and only for them (profile, map and skip carry none)'
);
select ok(
  (select e.organization = 'PT Sentinel Nusantara' and e.start_precision = 'year' and e.end_precision = 'year'
   from public.experiences e where e.id = (select committed_id from public.import_items where id = pg_temp.id('m-exp0'))),
  'experience fields are copied with their precision'
);
select ok(
  (select e.is_current and e.end_date is null and e.start_date = date '2021-03-01' and e.start_precision = 'month' and e.description = 'Memimpin tim'
   from public.experiences e where e.id = (select committed_id from public.import_items where id = pg_temp.id('m-exp1'))),
  'the overlapping current experience is stored with its open end'
);
select ok(
  (select a.experience_id = (select committed_id from public.import_items where id = pg_temp.id('m-exp0'))
     and a.status = 'draft' and a.origin = 'import' and a.source_excerpt = 'EXCERPT|m-ach0' and a.source_activity_revision is null and a.activity_id is null
   from public.achievements a where a.id = (select committed_id from public.import_items where id = pg_temp.id('m-ach0'))),
  'a draft achievement resolves the created experience and keeps its excerpt with origin import'
);
select ok(
  (select a.experience_id = 'a1000000-0000-4000-8000-000000000001' and a.status = 'confirmed' and a.origin = 'import'
     and a.cv_bullet = 'Menyusun laporan. Waktu turun' and a.achieved_on = date '2021-06-15' and jsonb_array_length(a.metrics) = 1
   from public.achievements a where a.id = (select committed_id from public.import_items where id = pg_temp.id('m-ach1'))),
  'a confirm-requested achievement is confirmed with the factual bullet and resolves the mapped experience'
);
select ok(
  (select a.experience_id is null and a.status = 'draft'
   from public.achievements a where a.id = (select committed_id from public.import_items where id = pg_temp.id('m-ach2'))),
  'an achievement pointing at a skipped experience becomes standalone'
);
select is(
  (select count(*) from public.achievements where user_id = '11616161-1616-4161-8161-161616161611' and status = 'confirmed' and origin = 'import'),
  1::bigint, 'only the explicitly confirmed achievement is confirmed'
);
select ok(
  (select p.headline = 'Analis Data' and p.location = 'Jakarta' and p.summary is null and p.contact_email is null
     and p.phone is null and p.website is null and p.display_name = 'Ani Contoh'
   from public.profiles p where p.id = '11616161-1616-4161-8161-161616161611'),
  'the profile receives only the selected fields and the name is untouched'
);
select ok(
  (select bool_and(s.row = (select to_jsonb(x) from public.experiences x where x.id = 'a1000000-0000-4000-8000-000000000001')) filter (where s.k = 'exp')
     and bool_and(s.row = (select to_jsonb(x) from public.education x where x.id = 'a2000000-0000-4000-8000-000000000001')) filter (where s.k = 'edu')
     and bool_and(s.row = (select to_jsonb(x) from public.skills x where x.id = 'a4000000-0000-4000-8000-000000000001')) filter (where s.k = 'skill')
     and bool_and(s.row = (select to_jsonb(x) from public.achievements x where x.id = 'a5000000-0000-4000-8000-000000000001')) filter (where s.k = 'ach')
   from pg_temp.snap s),
  'map never changes the target row (revision, timestamps and every column identical)'
);
select ok(
  (select name = 'Python' from public.skills where id = (select committed_id from public.import_items where id = pg_temp.id('m-skill0')))
  and not exists (select 1 from public.skills where user_id = '11616161-1616-4161-8161-161616161611' and name = 'Dilewati'),
  'a created skill exists and a skipped skill does not'
);

-- 8. Idempotency ------------------------------------------------------------------

create temporary table pg_temp.canon_after as select pg_temp.canon('11616161-1616-4161-8161-161616161611') as s;
select is(
  (select public.commit_import_batch(pg_temp.id('main'), 1, null)), (select r from pg_temp.commit1),
  'a second commit (even with an old revision) returns the first result'
);
select is(
  (select public.commit_import_batch(pg_temp.id('main'), (select revision from public.import_batches where id = pg_temp.id('main')), '{"display_name":"Lain"}'::jsonb)),
  (select r from pg_temp.commit1), 'a repeated commit returns the identical result'
);
select is(pg_temp.canon('11616161-1616-4161-8161-161616161611'), (select s from pg_temp.canon_after), 'repeated commits add no rows');
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, null, null, null)', pg_temp.id('m-exp0'), 'skip')),
  'P0001|IMPORT_NOT_REVIEWABLE|', 'a committed batch is no longer editable'
);

-- 9. Onboarding through the commit ---------------------------------------------------

select pg_temp.mk_batch('onb', '31616161-1616-4161-8161-161616161613');
select pg_temp.mk_item('n-skill', 'onb', 'skill', 0, jsonb_build_object('name', 'Komunikasi'));
select pg_temp.set_jwt_subject('31616161-1616-4161-8161-161616161613');
create temporary table pg_temp.canon_d as select pg_temp.canon('31616161-1616-4161-8161-161616161613') as s;
select is(
  pg_temp.try(format('select public.commit_import_batch(%L, 1, null)', pg_temp.id('onb'))),
  '22023|ONBOARDING_REQUIRED|', 'a new user must supply onboarding data'
);
select is(
  pg_temp.try(format('select public.commit_import_batch(%L, 1, %L)', pg_temp.id('onb'), '{"display_name":"Pending Onboarding","locale":"id","timezone":"Asia/Jakarta"}')),
  '22023|INVALID_DISPLAY_NAME|', 'the placeholder name is rejected'
);
select is(
  pg_temp.try(format('select public.commit_import_batch(%L, 1, %L)', pg_temp.id('onb'), '{"display_name":"Dewi","locale":"fr","timezone":"Asia/Jakarta"}')),
  '22023|INVALID_LOCALE|', 'an unsupported locale is rejected'
);
select is(
  pg_temp.try(format('select public.commit_import_batch(%L, 1, %L)', pg_temp.id('onb'), '{"display_name":"Dewi","locale":"id","timezone":"Mars/Base"}')),
  '22023|INVALID_TIMEZONE|', 'an unknown timezone is rejected'
);
select is(pg_temp.canon('31616161-1616-4161-8161-161616161613'), (select s from pg_temp.canon_d), 'failed onboarding validation writes nothing');
create temporary table pg_temp.onb_commit as
select public.commit_import_batch(pg_temp.id('onb'), 1,
  '{"display_name":"  Dewi Nyata  ","locale":"id","timezone":"Asia/Jakarta"}'::jsonb) as r;
select ok(
  (select (r ->> 'onboarding_completed')::boolean from pg_temp.onb_commit)
  and (select display_name = 'Dewi Nyata' and locale = 'id' and timezone = 'Asia/Jakarta' and onboarding_completed_at is not null
       from public.profiles where id = '31616161-1616-4161-8161-161616161613')
  and exists (select 1 from public.skills where user_id = '31616161-1616-4161-8161-161616161613' and name = 'Komunikasi'),
  'a valid commit completes onboarding and creates the rows in one transaction'
);

-- 10. Status and isolation --------------------------------------------------------------

select pg_temp.set_jwt_subject('11616161-1616-4161-8161-161616161611');
select pg_temp.mk_batch('q', '11616161-1616-4161-8161-161616161611', 'queued');
select pg_temp.mk_batch('r', '11616161-1616-4161-8161-161616161611', 'running');
select pg_temp.mk_batch('f', '11616161-1616-4161-8161-161616161611', 'failed');
select is(pg_temp.try(format('select public.commit_import_batch(%L, 1, null)', pg_temp.id('q'))), 'P0001|IMPORT_NOT_COMMITTABLE|', 'a queued batch cannot be committed');
select is(pg_temp.try(format('select public.commit_import_batch(%L, 1, null)', pg_temp.id('r'))), 'P0001|IMPORT_NOT_COMMITTABLE|', 'a running batch cannot be committed');
select is(pg_temp.try(format('select public.commit_import_batch(%L, 1, null)', pg_temp.id('f'))), 'P0001|IMPORT_NOT_COMMITTABLE|', 'a failed batch cannot be committed');
select is(pg_temp.try(format('select public.commit_import_batch(%L, 1, null)', pg_temp.id('cancelled'))), 'P0001|IMPORT_NOT_COMMITTABLE|', 'a cancelled batch cannot be committed');
select is(pg_temp.try(format('select public.commit_import_batch(%L, 1, null)', gen_random_uuid())), 'P0001|IMPORT_NOT_FOUND|', 'an unknown batch is reported generically');

select pg_temp.mk_batch('bbatch', '21616161-1616-4161-8161-161616161612');
select pg_temp.mk_item('bb-skill', 'bbatch', 'skill', 0, jsonb_build_object('name', 'B Only'));
select pg_temp.set_jwt_subject('21616161-1616-4161-8161-161616161612');
select is(pg_temp.try(format('select public.commit_import_batch(%L, 1, null)', pg_temp.id('upd'))), 'P0001|IMPORT_NOT_FOUND|', 'B cannot commit the batch of A');
select is(pg_temp.try(format('select * from public.validate_import_batch(%L)', pg_temp.id('upd'))), 'P0001|IMPORT_NOT_FOUND|', 'B cannot validate the batch of A');
select is(pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, null, null, null)', pg_temp.id('u-skill'), 'skip')), 'P0001|IMPORT_NOT_FOUND|', 'B cannot update an item of A');
select is(
  pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, %L, null, null)', pg_temp.id('bb-skill'), 'map', 'a4000000-0000-4000-8000-000000000001')),
  '22023|IMPORT_TARGET_INVALID|', 'B cannot map onto a row of A'
);

select pg_temp.mk_batch('ebatch', '41616161-1616-4161-8161-161616161614');
select pg_temp.mk_item('e-skill', 'ebatch', 'skill', 0, jsonb_build_object('name', 'E Skill'));
update public.profiles set deleting_at = now() where id = '41616161-1616-4161-8161-161616161614';
select pg_temp.set_jwt_subject('41616161-1616-4161-8161-161616161614');
select is(pg_temp.try(format('select public.commit_import_batch(%L, 1, null)', pg_temp.id('ebatch'))), '42501|AUTH_REQUIRED|', 'a deleting account cannot commit');
select is(pg_temp.try(format('select * from public.update_import_item(%L, 1, %L, null, null, null)', pg_temp.id('e-skill'), 'skip')), '42501|AUTH_REQUIRED|', 'a deleting account cannot edit items');
select pg_temp.set_jwt_subject(null);
select is(pg_temp.try(format('select public.commit_import_batch(%L, 1, null)', pg_temp.id('ebatch'))), '42501|AUTH_REQUIRED|', 'an anonymous caller is rejected');

-- Direct client writes stay impossible.
select pg_temp.set_jwt_subject('11616161-1616-4161-8161-161616161611');
set local role authenticated;
select throws_ok($$ update public.import_items set action = 'skip' $$, '42501', null, 'authenticated cannot update import_items');
select throws_ok($$ update public.import_batches set status = 'committed' $$, '42501', null, 'authenticated cannot update import_batches');
select ok(
  (select count(*) from public.import_batches where id = (select id from pg_temp.ids where label = 'main')) = 1
  and (select commit_result is not null from public.import_batches where id = (select id from pg_temp.ids where label = 'main')),
  'the owner can read commit_result'
);
reset role;

-- 11. Guard after commit and retention ---------------------------------------------------

select throws_ok(
  format($$ update public.import_items set action = 'skip' where id = %L $$, pg_temp.id('m-exp0')),
  '22023', 'INVALID_IMPORT_ITEM_MUTATION', 'action of a committed item is immutable'
);
select throws_ok(
  format($$ update public.import_items set committed_id = gen_random_uuid() where id = %L $$, pg_temp.id('m-exp1')),
  '22023', 'INVALID_IMPORT_ITEM_MUTATION', 'committed_id of a committed item is immutable'
);
select throws_ok(
  format($$ update public.import_items set confirm_requested = false where id = %L $$, pg_temp.id('m-ach1')),
  '22023', 'INVALID_IMPORT_ITEM_MUTATION', 'confirm_requested of a committed item is immutable'
);
select throws_ok(
  format($$ update public.import_items set committed_id = 'a1000000-0000-4000-8000-000000000001' where id = %L $$, pg_temp.id('u-exp')),
  '22023', 'INVALID_IMPORT_ITEM_MUTATION', 'committed_id can only be written by the commit function'
);

set local role service_role;
select is(public.purge_expired_import_batches(50) >= 1, true, 'the T15 purge takes the committed batch immediately');
reset role;
select ok(
  (select bool_and(payload is null and source_excerpt is null and purged_at is not null) from public.import_items where batch_id = pg_temp.id('main'))
  and (select count(*) = 9 from public.import_items where batch_id = pg_temp.id('main') and committed_id is not null)
  and (select count(*) = 4 from public.import_items where batch_id = pg_temp.id('main') and target_id is not null),
  'purge clears staged text but keeps action, target_id and committed_id (mapping provenance)'
);
select ok(
  (select extracted_text is null and file_key is null and purged_at is not null and status = 'committed' and commit_result is not null
   from public.import_batches where id = pg_temp.id('main')),
  'the batch keeps only status metadata and the commit result after purge'
);
select is(
  (select source_excerpt from public.achievements where id = (select committed_id from public.import_items where id = pg_temp.id('m-ach0'))),
  'EXCERPT|m-ach0', 'the achievement keeps its source excerpt after the staging text is purged'
);
select is(
  (select public.commit_import_batch(pg_temp.id('main'), 1, null)), (select r from pg_temp.commit1),
  'a purged committed batch still returns the first result'
);

-- 12. Achievement provenance check ---------------------------------------------------------

select throws_ok(
  $$ insert into public.achievements (user_id, title, origin, source_excerpt) values ('11616161-1616-4161-8161-161616161611', 't', 'manual', 'x') $$,
  '23514', null, 'a manual achievement still needs a source revision with an excerpt'
);
select throws_ok(
  $$ insert into public.achievements (user_id, title, origin, source_activity_revision) values ('11616161-1616-4161-8161-161616161611', 't', 'activity', 1) $$,
  '23514', null, 'an activity achievement still needs an excerpt with a revision'
);
select throws_ok(
  $$ insert into public.achievements (user_id, title, origin, source_excerpt, source_activity_revision) values ('11616161-1616-4161-8161-161616161611', 't', 'import', 'x', 1) $$,
  '23514', null, 'an imported achievement never carries an activity revision'
);
select lives_ok(
  $$ insert into public.achievements (user_id, title, origin, source_excerpt) values ('11616161-1616-4161-8161-161616161611', 't', 'import', 'excerpt') $$,
  'an imported achievement may keep just an excerpt'
);

select * from finish();
rollback;

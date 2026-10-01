begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T19 CV builder and overrides (PRD R09, F07, S13, DB §5/§6, decision 0025).
-- save_cv_edits is exercised with a JWT subject; canonical sources are inserted directly as the test owner.

-- 1. Structure and privileges -------------------------------------------------

select ok(
  exists (select 1 from pg_catalog.pg_proc as proc join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
          where ns.nspname = 'public' and proc.proname = 'save_cv_edits' and proc.prosecdef),
  'save_cv_edits exists and is security definer'
);
select ok(
  has_function_privilege('authenticated', 'public.save_cv_edits(integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.save_cv_edits(integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.save_cv_edits(integer,jsonb)', 'EXECUTE'),
  'save_cv_edits is executable by authenticated only'
);
select ok(
  not has_table_privilege('authenticated', 'public.cv_documents', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.cv_items', 'UPDATE'),
  'no client write grant was added to the CV tables'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint where conname = 'cv_documents_profile_overrides_check' and contype = 'c'),
  'cv_documents_profile_overrides_check exists'
);

-- 2. Fixtures -------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11919191-1919-4191-8191-191919191911', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cvb-a@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('21919191-1919-4191-8191-191919191912', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cvb-b@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('31919191-1919-4191-8191-191919191913', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cvb-c@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('41919191-1919-4191-8191-191919191914', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cvb-d@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

update public.profiles set display_name = 'Ani Contoh', locale = 'id', headline = 'Lulusan Informatika',
  contact_email = 'ani@example.com', summary = 'Ringkasan sumber', onboarding_completed_at = now()
where id = '11919191-1919-4191-8191-191919191911';
update public.profiles set display_name = 'Budi Contoh', onboarding_completed_at = now()
where id in ('21919191-1919-4191-8191-191919191912', '41919191-1919-4191-8191-191919191914');
update public.profiles set deleting_at = now() where id = '41919191-1919-4191-8191-191919191914';

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

create or replace function pg_temp.cv_rev(p_user_id uuid)
returns integer language sql as $$ select revision from public.cv_documents where user_id = p_user_id $$;

create or replace function pg_temp.cv_id(p_user_id uuid)
returns uuid language sql as $$ select id from public.cv_documents where user_id = p_user_id $$;

create or replace function pg_temp.item_id(p_user_id uuid, p_section text, p_position integer)
returns uuid language sql as $$
  select id from public.cv_items where cv_id = pg_temp.cv_id(p_user_id) and section_key = p_section and position = p_position
$$;

-- Owner A (graduate) sources.
insert into public.education (id, user_id, institution, qualification, field_of_study, start_date, start_precision, end_date, end_precision) values
  ('a2000000-0000-4000-8000-000000000001', '11919191-1919-4191-8191-191919191911', 'Universitas Contoh', 'S1', 'Informatika',
   '2019-01-01', 'year', '2023-01-01', 'year');
insert into public.skills (id, user_id, name) values
  ('a4000000-0000-4000-8000-000000000001', '11919191-1919-4191-8191-191919191911', 'SQL');
insert into public.certifications (id, user_id, name) values
  ('a3000000-0000-4000-8000-000000000001', '11919191-1919-4191-8191-191919191911', 'Sertifikat Tanpa Tanggal');
insert into public.projects (id, user_id, title, description, user_role, outcome, status) values
  ('a6000000-0000-4000-8000-000000000002', '11919191-1919-4191-8191-191919191911',
   'Skripsi Sistem Antrian', 'Deskripsi skripsi', 'Peneliti', 'Lulus', 'completed');
insert into public.achievements (id, user_id, project_id, title, contribution, scope, outcome, cv_bullet, achieved_on, status) values
  ('a5000000-0000-4000-8000-000000000001', '11919191-1919-4191-8191-191919191911', 'a6000000-0000-4000-8000-000000000002',
   'Menurunkan waktu antre', 'Kontribusi', 'Lingkup', 'Waktu turun 30 persen', 'Merancang simulasi antrian',
   '2023-05-10', 'confirmed');

-- Owner B sources.
insert into public.education (id, user_id, institution, qualification) values
  ('b2000000-0000-4000-8000-000000000001', '21919191-1919-4191-8191-191919191912', 'B Uni', 'S1');

-- Open both CVs and select items as A.
select pg_temp.set_jwt_subject('11919191-1919-4191-8191-191919191911');
select * from public.ensure_cv_document();
select * from public.select_cv_source(1, 'education', 'a2000000-0000-4000-8000-000000000001');
select * from public.select_cv_source(2, 'project', 'a6000000-0000-4000-8000-000000000002');
select * from public.select_cv_source(3, 'achievement', 'a5000000-0000-4000-8000-000000000001');
select * from public.select_cv_source(4, 'skill', 'a4000000-0000-4000-8000-000000000001');
select * from public.select_cv_source(5, 'certification', 'a3000000-0000-4000-8000-000000000001');
select pg_temp.set_jwt_subject('21919191-1919-4191-8191-191919191912');
select * from public.ensure_cv_document();
select * from public.select_cv_source(1, 'education', 'b2000000-0000-4000-8000-000000000001');

create temporary table pg_temp.baseline as
  select (select jsonb_agg(source_snapshot order by id) from public.cv_items where user_id = '11919191-1919-4191-8191-191919191911') as snapshots,
         (select jsonb_agg(source_revision order by id) from public.cv_items where user_id = '11919191-1919-4191-8191-191919191911') as revisions,
         (select profile_snapshot from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911') as profile,
         (select profile_source_revision from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911') as profile_rev,
         (select revision from public.achievements where id = 'a5000000-0000-4000-8000-000000000001') as achievement_rev,
         (select revision from public.education where id = 'a2000000-0000-4000-8000-000000000001') as education_rev,
         (select cv_bullet from public.achievements where id = 'a5000000-0000-4000-8000-000000000001') as bullet;

-- 3. Auth and onboarding ---------------------------------------------------------

select pg_temp.set_jwt_subject(null);
select is(pg_temp.try($$select public.save_cv_edits(1, '{"title":"X"}'::jsonb)$$), '42501|AUTH_REQUIRED|', 'no session is rejected');
select pg_temp.set_jwt_subject('41919191-1919-4191-8191-191919191914');
select is(pg_temp.try($$select public.save_cv_edits(1, '{"title":"X"}'::jsonb)$$), '42501|AUTH_REQUIRED|', 'a deleting account is rejected');
select pg_temp.set_jwt_subject('31919191-1919-4191-8191-191919191913');
select is(pg_temp.try($$select public.save_cv_edits(1, '{"title":"X"}'::jsonb)$$), '22023|ONBOARDING_REQUIRED|',
  'an account that has not completed onboarding is rejected');

-- 4. Validation: nothing is written ------------------------------------------------

select pg_temp.set_jwt_subject('11919191-1919-4191-8191-191919191911');
select is(pg_temp.cv_rev('11919191-1919-4191-8191-191919191911'), 6, 'owner A CV is at revision 6 before edits');

create or replace function pg_temp.invalid(p_edits text, p_rev integer default 6)
returns text language sql as $$
  select pg_temp.try(format('select public.save_cv_edits(%s, %L::jsonb)', p_rev, p_edits))
$$;

select is(pg_temp.try('select public.save_cv_edits(6, null)'), '22023|INVALID_CV_INPUT|', 'null edits are rejected');
select is(pg_temp.try('select public.save_cv_edits(null, ''{"title":"X"}''::jsonb)'), '22023|INVALID_CV_INPUT|', 'null revision is rejected');
select is(pg_temp.invalid('{}'), '22023|INVALID_CV_INPUT|', 'empty edits are rejected');
select is(pg_temp.invalid('[]'), '22023|INVALID_CV_INPUT|', 'array edits are rejected');
select is(pg_temp.invalid('{"unknown":"x"}'), '22023|INVALID_CV_INPUT|', 'unknown edit keys are rejected');
select is(pg_temp.invalid('{"title":"   "}'), '22023|INVALID_CV_INPUT|', 'a blank title is rejected');
select is(pg_temp.invalid('{"title":null}'), '22023|INVALID_CV_INPUT|', 'a null title is rejected');
select is(pg_temp.invalid(format('{"title":"%s"}', repeat('t', 121))), '22023|INVALID_CV_INPUT|', 'a title over 120 characters is rejected');
select is(pg_temp.invalid(format('{"summary_override":"%s"}', repeat('s', 5001))), '22023|INVALID_CV_INPUT|', 'a summary over 5000 characters is rejected');
select is(pg_temp.invalid('{"summary_override":5}'), '22023|INVALID_CV_INPUT|', 'a non-string summary is rejected');
select is(pg_temp.invalid('{"profile_overrides":{"nickname":"x"}}'), '22023|INVALID_CV_INPUT|', 'an unknown profile key is rejected');
select is(pg_temp.invalid('{"profile_overrides":{"website":"ftp://example.com"}}'), '22023|INVALID_CV_INPUT|', 'a non-http website is rejected');
select is(pg_temp.invalid('{"profile_overrides":{"contact_email":"not-an-email"}}'), '22023|INVALID_CV_INPUT|', 'an invalid email is rejected');
select is(pg_temp.invalid(format('{"profile_overrides":{"headline":"%s"}}', repeat('h', 121))), '22023|INVALID_CV_INPUT|', 'a headline over 120 characters is rejected');
select is(pg_temp.invalid(format('{"profile_overrides":{"display_name":"%s"}}', repeat('n', 81))), '22023|INVALID_CV_INPUT|', 'a display name over 80 characters is rejected');
select is(pg_temp.invalid('{"profile_overrides":[]}'), '22023|INVALID_CV_INPUT|', 'non-object profile overrides are rejected');
select is(pg_temp.invalid(format('{"item_overrides":[{"item_id":"%s","override_text":"%s"}]}',
  pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1), repeat('o', 2001))), '22023|INVALID_CV_INPUT|',
  'an override over 2000 characters is rejected');
select is(pg_temp.invalid(format('{"item_overrides":[{"item_id":"%1$s","override_text":"a"},{"item_id":"%1$s","override_text":"b"}]}',
  pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1))), '22023|INVALID_CV_INPUT|', 'duplicate item ids are rejected');
select is(pg_temp.invalid('{"item_overrides":[{"item_id":"not-a-uuid","override_text":"a"}]}'), '22023|INVALID_CV_INPUT|', 'a malformed item id is rejected');
select is(pg_temp.invalid('{"item_overrides":"x"}'), '22023|INVALID_CV_INPUT|', 'non-array item overrides are rejected');
select is(pg_temp.invalid(format('{"item_overrides":[{"item_id":"%s","override_text":"a","extra":1}]}',
  pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1))), '22023|INVALID_CV_INPUT|', 'unknown item override keys are rejected');
select is(pg_temp.try($$select public.save_cv_edits(6, '{"title":"WP-PRIVATE-SENTINEL-TITLE","website":1}'::jsonb)$$), '22023|INVALID_CV_INPUT|',
  'the error carries a code only, never the submitted text');
select is(pg_temp.cv_rev('11919191-1919-4191-8191-191919191911'), 6, 'rejected batches did not change the revision');
select is((select title from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911'), 'Master CV', 'rejected batches did not change the title');

-- 5. Stale revision and missing CV ---------------------------------------------------

select is(pg_temp.try($$select public.save_cv_edits(3, '{"title":"Stale"}'::jsonb)$$), 'P0001|STALE_REVISION|', 'a stale revision is rejected');
select is((select title from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911'), 'Master CV', 'a stale save wrote nothing');
select pg_temp.set_jwt_subject('11919191-1919-4191-8191-191919191911');

-- 6. Item overrides -----------------------------------------------------------------

select is(
  public.save_cv_edits(6, format('{"item_overrides":[{"item_id":"%s","override_text":"  Teks kustom pendidikan  "}]}',
    pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1))::jsonb),
  7, 'one override raises the CV revision by exactly one'
);
select is(
  (select override_text from public.cv_items where id = pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1)),
  'Teks kustom pendidikan', 'the override is trimmed and stored on cv_items.override_text'
);
select ok(
  (select jsonb_agg(source_snapshot order by id) = snapshots and jsonb_agg(source_revision order by id) = revisions
   from public.cv_items, pg_temp.baseline where user_id = '11919191-1919-4191-8191-191919191911' group by snapshots, revisions),
  'source_snapshot and source_revision are unchanged by an override'
);
select ok(
  (select achievement_rev = (select revision from public.achievements where id = 'a5000000-0000-4000-8000-000000000001')
      and education_rev = (select revision from public.education where id = 'a2000000-0000-4000-8000-000000000001')
      and bullet = (select cv_bullet from public.achievements where id = 'a5000000-0000-4000-8000-000000000001')
   from pg_temp.baseline),
  'canonical source rows keep their revision and content'
);
select is(
  public.save_cv_edits(7, format('{"item_overrides":[{"item_id":"%s","override_text":"Bullet kustom"}]}',
    pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'achievements', 1))::jsonb),
  8, 'an achievement override is accepted'
);
select is(
  public.save_cv_edits(8, format('{"item_overrides":[{"item_id":"%s","override_text":"Deskripsi proyek kustom"}]}',
    pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'projects', 1))::jsonb),
  9, 'a project override is accepted'
);
select is(
  pg_temp.try(format('select public.save_cv_edits(9, %L::jsonb)',
    format('{"item_overrides":[{"item_id":"%s","override_text":"Nama skill"}]}', pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'skills', 1)))),
  'P0001|CV_OVERRIDE_UNSUPPORTED|', 'a skill cannot carry an override'
);
select is(
  pg_temp.try(format('select public.save_cv_edits(9, %L::jsonb)',
    format('{"item_overrides":[{"item_id":"%s","override_text":"Nama sertifikat"}]}', pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'certifications', 1)))),
  'P0001|CV_OVERRIDE_UNSUPPORTED|', 'a certification cannot carry an override'
);
select is(
  pg_temp.try(format('select public.save_cv_edits(9, %L::jsonb)',
    format('{"item_overrides":[{"item_id":"%s","override_text":null}]}', pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'skills', 1)))),
  'ok', 'clearing an override on a skill item is not a violation and writes nothing'
);
select is(pg_temp.cv_rev('11919191-1919-4191-8191-191919191911'), 9, 'clearing a non-existent override did not raise the revision');

select pg_temp.set_jwt_subject('21919191-1919-4191-8191-191919191912');
select is(
  pg_temp.try(format('select public.save_cv_edits(2, %L::jsonb)',
    format('{"item_overrides":[{"item_id":"%s","override_text":"Tidak boleh"}]}', pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1)))),
  'P0001|CV_ITEM_NOT_FOUND|', 'another account''s item is not found'
);
select is(
  pg_temp.try(format('select public.save_cv_edits(2, %L::jsonb)',
    format('{"item_overrides":[{"item_id":"%s","override_text":"Tidak boleh"}]}', gen_random_uuid()))),
  'P0001|CV_ITEM_NOT_FOUND|', 'a random item id gives the same answer'
);
select is(
  (select override_text from public.cv_items where id = pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1)),
  'Teks kustom pendidikan', 'account B did not change account A''s override'
);
select is(pg_temp.cv_rev('21919191-1919-4191-8191-191919191912'), 2, 'account B CV revision is untouched by the failed attempts');

select pg_temp.set_jwt_subject('11919191-1919-4191-8191-191919191911');

-- 7. Batch atomicity and single revision -------------------------------------------------

select is(
  pg_temp.try(format('select public.save_cv_edits(9, %L::jsonb)',
    format('{"title":"Batch invalid","item_overrides":[{"item_id":"%s","override_text":"Tulis"},{"item_id":"%s","override_text":"Hilang"}]}',
      pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1), gen_random_uuid()))),
  'P0001|CV_ITEM_NOT_FOUND|', 'a batch with one unknown item is rejected as a whole'
);
select ok(
  pg_temp.cv_rev('11919191-1919-4191-8191-191919191911') = 9
  and (select title from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911') = 'Master CV'
  and (select override_text from public.cv_items where id = pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1)) = 'Teks kustom pendidikan',
  'nothing from the rejected batch was stored'
);
select is(
  public.save_cv_edits(9, format('{"title":"CV Ani","summary_override":"Ringkasan kustom","profile_overrides":{"headline":"Data Analyst","website":"https://example.com/ani"},"item_overrides":[{"item_id":"%s","override_text":"Pendidikan baru"},{"item_id":"%s","override_text":"Proyek baru"}]}',
    pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1),
    pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'projects', 1))::jsonb),
  10, 'a multi-edit batch raises the revision by exactly one'
);
select ok(
  (select title = 'CV Ani' and summary_override = 'Ringkasan kustom'
      and profile_snapshot -> 'display_overrides' = '{"headline":"Data Analyst","website":"https://example.com/ani"}'::jsonb
   from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911'),
  'title, summary and display overrides are stored on cv_documents'
);

-- 8. Profile source is untouched ------------------------------------------------------------

select ok(
  (select profile_snapshot - 'display_overrides' = profile and profile_source_revision = profile_rev
   from public.cv_documents, pg_temp.baseline where user_id = '11919191-1919-4191-8191-191919191911'),
  'the copied profile source and its revision are unchanged by display overrides'
);
select is(
  (select headline from public.profiles where id = '11919191-1919-4191-8191-191919191911'),
  'Lulusan Informatika', 'the canonical profile is unchanged'
);

-- 9. No-op saves ------------------------------------------------------------------------------

create temporary table pg_temp.before_noop as
  select revision, updated_at from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911';
select is(
  public.save_cv_edits(10, '{"title":"CV Ani","summary_override":"Ringkasan kustom","profile_overrides":{"headline":"Data Analyst"}}'::jsonb),
  10, 'saving identical values returns the current revision'
);
select ok(
  (select d.revision = b.revision and d.updated_at = b.updated_at
   from public.cv_documents as d, pg_temp.before_noop as b where d.user_id = '11919191-1919-4191-8191-191919191911'),
  'a no-op save writes nothing and does not raise the revision'
);
select is(public.save_cv_edits(10, '{"profile_overrides":{}}'::jsonb), 10, 'empty profile overrides are a no-op');

-- 10. Clearing overrides ----------------------------------------------------------------------

select is(
  public.save_cv_edits(10, format('{"summary_override":"  ","profile_overrides":{"headline":null},"item_overrides":[{"item_id":"%s","override_text":null}]}',
    pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1))::jsonb),
  11, 'blank or null values clear overrides in one revision'
);
select ok(
  (select summary_override is null and profile_snapshot -> 'display_overrides' = '{"website":"https://example.com/ani"}'::jsonb
   from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911')
  and (select override_text is null from public.cv_items where id = pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'education', 1)),
  'summary, one profile key and one item override were cleared'
);
select is(public.save_cv_edits(11, '{"profile_overrides":{"website":""}}'::jsonb), 12, 'clearing the last key succeeds');
select ok(
  (select not (profile_snapshot ? 'display_overrides') from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911'),
  'removing every key removes display_overrides'
);

-- 11. Compatibility with T18 ---------------------------------------------------------------------

select is(
  public.save_cv_edits(12, format('{"item_overrides":[{"item_id":"%s","override_text":"Tetap ada"}]}',
    pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'projects', 1))::jsonb),
  13, 'an override can be rewritten'
);
select is(public.update_cv_layout(13, 'en', null), 14, 'update_cv_layout still works after overrides');
select is((select override_text from public.cv_items where id = pg_temp.item_id('11919191-1919-4191-8191-191919191911', 'projects', 1)), 'Tetap ada',
  'a layout change keeps overrides');

delete from public.projects where id = 'a6000000-0000-4000-8000-000000000002';
select ok(
  (select source_deleted and override_text = 'Tetap ada' and source_snapshot ->> 'title' = 'Skripsi Sistem Antrian'
   from public.cv_items where cv_id = pg_temp.cv_id('11919191-1919-4191-8191-191919191911') and section_key = 'projects'),
  'deleting the source keeps the override and the snapshot on the item'
);
select is(
  public.save_cv_edits(14, format('{"item_overrides":[{"item_id":"%s","override_text":"Diedit setelah dihapus"}]}',
    (select id from public.cv_items where cv_id = pg_temp.cv_id('11919191-1919-4191-8191-191919191911') and section_key = 'projects'))::jsonb),
  15, 'a source_deleted item can still be edited'
);
select is(
  (select cv_revision from public.remove_cv_item(15,
    (select id from public.cv_items where cv_id = pg_temp.cv_id('11919191-1919-4191-8191-191919191911') and section_key = 'projects'), true)),
  16, 'remove_cv_item removes an item that carries an override'
);

-- 12. Isolation ------------------------------------------------------------------------------------

select pg_temp.set_jwt_subject('21919191-1919-4191-8191-191919191912');
select is(public.save_cv_edits(2, '{"title":"CV Budi"}'::jsonb), 3, 'account B saves only its own CV');
select is((select title from public.cv_documents where user_id = '11919191-1919-4191-8191-191919191911'), 'CV Ani', 'account A''s title is not touched by B');

select * from finish();
rollback;

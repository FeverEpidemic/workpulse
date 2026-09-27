begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function('public', 'filter_achievements', array['uuid', 'boolean'], 'Achievement read filter exists with the T12 signature');
select has_function('public', 'filter_projects', array['boolean'], 'Project read filter exists with the T12 signature');
select has_function('public', 'get_dashboard_summary', array[]::text[], 'Dashboard summary exists');
select has_function('public', 'list_demonstrated_skills', array['integer'], 'Demonstrated skill list exists');

select ok(
  (select count(*) = 4 from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('filter_achievements', 'filter_projects', 'get_dashboard_summary', 'list_demonstrated_skills')
     and not p.prosecdef),
  'All four read functions use SECURITY INVOKER'
);
select ok(
  not coalesce(has_function_privilege('anon', pg_catalog.to_regprocedure('public.filter_achievements(uuid,boolean)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('anon', pg_catalog.to_regprocedure('public.filter_projects(boolean)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('anon', pg_catalog.to_regprocedure('public.get_dashboard_summary()'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('anon', pg_catalog.to_regprocedure('public.list_demonstrated_skills(integer)'), 'EXECUTE'), false)
  and coalesce(has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.filter_achievements(uuid,boolean)'), 'EXECUTE'), false)
  and coalesce(has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.filter_projects(boolean)'), 'EXECUTE'), false)
  and coalesce(has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.get_dashboard_summary()'), 'EXECUTE'), false)
  and coalesce(has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.list_demonstrated_skills(integer)'), 'EXECUTE'), false),
  'Only authenticated callers receive the public read functions'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('filter_achievements', 'filter_projects', 'get_dashboard_summary', 'list_demonstrated_skills')
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE grant on T12 functions'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a9999999-9999-4999-8999-999999999991'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 't12-a@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('a9999999-9999-4999-8999-999999999992'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 't12-b@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('a9999999-9999-4999-8999-999999999993'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 't12-empty@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.projects (id, user_id, title, outcome, status)
values
  ('a9999999-9999-4999-8999-999999999901', 'a9999999-9999-4999-8999-999999999991', 'Current project', 'Shipped', 'active'),
  ('a9999999-9999-4999-8999-999999999902', 'a9999999-9999-4999-8999-999999999991', 'Completed without outcome', null, 'completed'),
  ('a9999999-9999-4999-8999-999999999903', 'a9999999-9999-4999-8999-999999999991', 'Planned with blank outcome', '   ', 'planned'),
  ('a9999999-9999-4999-8999-999999999904', 'a9999999-9999-4999-8999-999999999992', 'Foreign completed project', 'Delivered', 'completed');

insert into public.activities (id, user_id, raw_text, occurred_on, capture_mode)
values ('a9999999-9999-4999-8999-999999999921', 'a9999999-9999-4999-8999-999999999991', 'Source activity with evidence', '2026-09-20', 'note');

insert into public.achievements (
  id, user_id, activity_id, project_id, title, contribution, outcome, cv_bullet,
  achieved_on, status, origin, source_excerpt, source_activity_revision
) values
  ('a9999999-9999-4999-8999-999999999931', 'a9999999-9999-4999-8999-999999999991', null, null, 'Confirmed ready', 'Built a report', 'Published it', 'Built and published a report', '2026-08-10', 'confirmed', 'manual', null, null),
  ('a9999999-9999-4999-8999-999999999932', 'a9999999-9999-4999-8999-999999999991', null, null, 'Confirmed scanning', 'Prepared the work', 'It is pending', 'Prepared the work while scanning', '2026-07-01', 'confirmed', 'manual', null, null),
  ('a9999999-9999-4999-8999-999999999933', 'a9999999-9999-4999-8999-999999999991', null, null, 'Confirmed failed', 'Reviewed a draft', 'The file failed screening', 'Reviewed a draft after screening failed', '2026-06-01', 'confirmed', 'manual', null, null),
  ('a9999999-9999-4999-8999-999999999934', 'a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999921', null, 'Derived confirmed', 'Improved the process', 'Reduced repeat work', 'Improved the process and reduced repeat work', '2026-05-01', 'confirmed', 'activity', 'Source activity with evidence', 1),
  ('a9999999-9999-4999-8999-999999999935', 'a9999999-9999-4999-8999-999999999991', null, 'a9999999-9999-4999-8999-999999999902', 'Project confirmed', 'Delivered the project', 'Completed the work', 'Delivered the completed project', '2026-04-01', 'confirmed', 'manual', null, null),
  ('a9999999-9999-4999-8999-999999999936', 'a9999999-9999-4999-8999-999999999991', null, null, null, null, null, null, null, 'draft', 'manual', null, null),
  ('a9999999-9999-4999-8999-999999999937', 'a9999999-9999-4999-8999-999999999991', null, null, null, null, null, null, null, 'dismissed', 'manual', null, null),
  ('a9999999-9999-4999-8999-999999999938', 'a9999999-9999-4999-8999-999999999992', null, null, 'Foreign confirmed', 'Built a feature', 'Released it', 'Built and released a feature', '2026-03-01', 'confirmed', 'manual', null, null);

insert into public.skills (id, user_id, name)
values
  ('a9999999-9999-4999-8999-999999999951', 'a9999999-9999-4999-8999-999999999991', 'TypeScript'),
  ('a9999999-9999-4999-8999-999999999952', 'a9999999-9999-4999-8999-999999999991', 'SQL'),
  ('a9999999-9999-4999-8999-999999999953', 'a9999999-9999-4999-8999-999999999991', 'Figma');
insert into public.achievement_skills (user_id, achievement_id, skill_id)
values
  ('a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999931', 'a9999999-9999-4999-8999-999999999951'),
  ('a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999931', 'a9999999-9999-4999-8999-999999999952'),
  ('a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999932', 'a9999999-9999-4999-8999-999999999951'),
  ('a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999936', 'a9999999-9999-4999-8999-999999999953');

insert into internal.evidence_scan_jobs (
  id, user_id, evidence_id, object_key, expected_bytes, mime_type, sha256, status
) values
  ('a9999999-9999-4999-8999-999999999961', 'a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999971', 'a9999999-9999-4999-8999-999999999991/evidence/a9999999-9999-4999-8999-999999999971', 100, 'application/pdf', repeat('a', 64), 'queued'),
  ('a9999999-9999-4999-8999-999999999962', 'a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999972', 'a9999999-9999-4999-8999-999999999991/evidence/a9999999-9999-4999-8999-999999999972', 100, 'application/pdf', repeat('b', 64), 'queued'),
  ('a9999999-9999-4999-8999-999999999963', 'a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999973', 'a9999999-9999-4999-8999-999999999991/evidence/a9999999-9999-4999-8999-999999999973', 100, 'application/pdf', repeat('c', 64), 'queued'),
  ('a9999999-9999-4999-8999-999999999964', 'a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999975', 'a9999999-9999-4999-8999-999999999991/evidence/a9999999-9999-4999-8999-999999999975', 100, 'application/pdf', repeat('e', 64), 'queued');

insert into public.evidence_files (
  id, user_id, activity_id, achievement_id, project_id, object_key, original_name, mime_type,
  bytes, actual_bytes, sha256, status, error_code, reserved_until, parent_revision, revision,
  idempotency_key, payload_hash, scan_job_id
) values
  ('a9999999-9999-4999-8999-999999999971', 'a9999999-9999-4999-8999-999999999991', null, 'a9999999-9999-4999-8999-999999999931', null, 'a9999999-9999-4999-8999-999999999991/evidence/a9999999-9999-4999-8999-999999999971', 'ready.pdf', 'application/pdf', 100, 100, repeat('a', 64), 'ready', null, null, 1, 1, 'a9999999-9999-4999-8999-999999999981', decode(repeat('a', 64), 'hex'), 'a9999999-9999-4999-8999-999999999961'),
  ('a9999999-9999-4999-8999-999999999972', 'a9999999-9999-4999-8999-999999999991', null, 'a9999999-9999-4999-8999-999999999932', null, 'a9999999-9999-4999-8999-999999999991/evidence/a9999999-9999-4999-8999-999999999972', 'scanning.pdf', 'application/pdf', 100, 100, repeat('b', 64), 'scanning', null, null, 1, 1, 'a9999999-9999-4999-8999-999999999982', decode(repeat('b', 64), 'hex'), 'a9999999-9999-4999-8999-999999999962'),
  ('a9999999-9999-4999-8999-999999999973', 'a9999999-9999-4999-8999-999999999991', 'a9999999-9999-4999-8999-999999999921', null, null, 'a9999999-9999-4999-8999-999999999991/evidence/a9999999-9999-4999-8999-999999999973', 'activity.pdf', 'application/pdf', 100, 100, repeat('c', 64), 'ready', null, null, 1, 1, 'a9999999-9999-4999-8999-999999999983', decode(repeat('c', 64), 'hex'), 'a9999999-9999-4999-8999-999999999963'),
  ('a9999999-9999-4999-8999-999999999974', 'a9999999-9999-4999-8999-999999999991', null, 'a9999999-9999-4999-8999-999999999933', null, 'a9999999-9999-4999-8999-999999999991/evidence/a9999999-9999-4999-8999-999999999974', 'failed.pdf', 'application/pdf', 100, null, null, 'failed', 'SCAN_REJECTED', null, 1, 1, 'a9999999-9999-4999-8999-999999999984', decode(repeat('d', 64), 'hex'), null),
  ('a9999999-9999-4999-8999-999999999975', 'a9999999-9999-4999-8999-999999999991', null, null, 'a9999999-9999-4999-8999-999999999902', 'a9999999-9999-4999-8999-999999999991/evidence/a9999999-9999-4999-8999-999999999975', 'project.pdf', 'application/pdf', 100, 100, repeat('e', 64), 'ready', null, null, 1, 1, 'a9999999-9999-4999-8999-999999999985', decode(repeat('e', 64), 'hex'), 'a9999999-9999-4999-8999-999999999964');

create or replace function pg_temp.set_jwt_subject(p_user_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', p_role)::text, true);
end;
$$;

select pg_temp.set_jwt_subject('a9999999-9999-4999-8999-999999999991'::uuid);
set local role authenticated;

select is((select confirmed_achievement_count from public.get_dashboard_summary()), 5, 'Dashboard counts only confirmed Achievements');
select is((select active_project_count from public.get_dashboard_summary()), 1, 'Dashboard counts only active Projects');
select is((select demonstrated_skill_count from public.get_dashboard_summary()), 2, 'Dashboard counts skills used by confirmed Achievements');
select is((select missing_evidence_count from public.get_dashboard_summary()), 4, 'Dashboard counts confirmed Achievements without direct ready evidence');
select is((select completed_missing_outcome_count from public.get_dashboard_summary()), 1, 'Dashboard counts completed Projects with blank outcomes');
select ok((select has_career_records from public.get_dashboard_summary()), 'Dashboard reports canonical career records');
select is((select count(*) from public.filter_achievements(null, true)), 6::bigint, 'Missing-evidence filter is orthogonal to Achievement status');
select is((select count(*) from public.filter_achievements('a9999999-9999-4999-8999-999999999951', false)), 2::bigint, 'Skill filter returns only linked Achievements');
select ok(not exists (select 1 from public.filter_achievements(null, true) where id = 'a9999999-9999-4999-8999-999999999931'), 'Direct ready Achievement evidence is not missing');
select ok(exists (select 1 from public.filter_achievements(null, true) where id = 'a9999999-9999-4999-8999-999999999932'), 'Scanning evidence does not count as ready');
select ok(exists (select 1 from public.filter_achievements(null, true) where id = 'a9999999-9999-4999-8999-999999999933'), 'Failed evidence does not count as ready');
select ok(exists (select 1 from public.filter_achievements(null, true) where id = 'a9999999-9999-4999-8999-999999999934'), 'Activity evidence is not inherited by a derived Achievement');
select ok(exists (select 1 from public.filter_achievements(null, true) where id = 'a9999999-9999-4999-8999-999999999935'), 'Project evidence is not inherited by its Achievement');
select ok(exists (select 1 from public.filter_achievements(null, true) where id = 'a9999999-9999-4999-8999-999999999936'), 'A draft without direct ready evidence is returned by the orthogonal filter');
select is((select count(*) from public.filter_projects(true)), 2::bigint, 'Outcome filter catches NULL and trimmed-blank outcomes');
select ok(exists (select 1 from public.filter_projects(true) where id = 'a9999999-9999-4999-8999-999999999902'), 'Outcome filter includes completed NULL outcome');
select is(
  (select string_agg(name || ':' || confirmed_achievement_count::text, ',' order by confirmed_achievement_count desc, name)
   from public.list_demonstrated_skills(12)),
  'TypeScript:2,SQL:1',
  'Skill list is ordered by distinct confirmed Achievement count and omits draft-only skills'
);

select pg_temp.set_jwt_subject('a9999999-9999-4999-8999-999999999992'::uuid);
select is((select confirmed_achievement_count from public.get_dashboard_summary()), 1, 'Second account summary contains only its own Achievement');
select is((select count(*) from public.filter_achievements(null, true)), 1::bigint, 'Second account Achievement filter cannot see owner A');
select ok((select bool_and(user_id = auth.uid()) from public.filter_projects(false)), 'Second account Project filter is owner scoped');
select is((select count(*) from public.filter_projects(false)), 1::bigint, 'Second account Project filter returns its own row');

select pg_temp.set_jwt_subject('a9999999-9999-4999-8999-999999999993'::uuid);
select is((select confirmed_achievement_count from public.get_dashboard_summary()), 0, 'Empty account has zero confirmed Achievements');
select is((select active_project_count from public.get_dashboard_summary()), 0, 'Empty account has zero active Projects');
select is((select demonstrated_skill_count from public.get_dashboard_summary()), 0, 'Empty account has zero demonstrated skills');
select is((select missing_evidence_count from public.get_dashboard_summary()), 0, 'Empty account has zero missing-evidence checks');
select is((select completed_missing_outcome_count from public.get_dashboard_summary()), 0, 'Empty account has zero missing-outcome checks');
select ok(not (select has_career_records from public.get_dashboard_summary()), 'Empty account reports no career records');

reset role;
update public.profiles set deleting_at = now() where id = 'a9999999-9999-4999-8999-999999999991';
select pg_temp.set_jwt_subject('a9999999-9999-4999-8999-999999999991'::uuid);
set local role authenticated;
select is((select count(*) from public.get_dashboard_summary()), 0::bigint, 'Deleting account receives no dashboard summary row');
select is((select count(*) from public.filter_achievements(null, false)), 0::bigint, 'Deleting account Achievement filter is empty');
select is((select count(*) from public.filter_projects(false)), 0::bigint, 'Deleting account Project filter is empty');
select is((select count(*) from public.list_demonstrated_skills(12)), 0::bigint, 'Deleting account skill list is empty');

select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('achievements', 'Achievement table exists');
select has_table('achievement_skills', 'Achievement skill join table exists');
select has_column('achievements', 'source_excerpt', 'Achievement retains source excerpt');
select has_column('achievements', 'source_activity_revision', 'Achievement retains source Activity revision');
select has_column('achievements', 'metrics', 'Achievement stores optional metrics');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.achievements'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'public.achievement_skills'::regclass),
  'Achievement tables have RLS enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.achievements', 'SELECT')
  and not has_table_privilege('authenticated', 'public.achievements', 'INSERT')
  and not has_table_privilege('authenticated', 'public.achievements', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.achievements', 'DELETE')
  and has_function_privilege('authenticated', 'public.create_achievement_idempotent(uuid,uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.save_achievement(uuid,integer,text,jsonb,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.delete_activity(uuid,integer)', 'EXECUTE'),
  'Browser access is read-only and mutation uses narrow Achievement/Activity RPCs'
);
select ok(
  exists (select 1 from pg_catalog.pg_indexes where indexname = 'achievements_one_derived_activity_idx')
  and exists (select 1 from pg_catalog.pg_constraint where conname = 'achievements_confirmed_fields_check')
  and exists (select 1 from pg_catalog.pg_constraint where conname = 'achievements_metrics_check'),
  'Achievement uniqueness and confirmation/metric constraints exist'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a9999999-9999-4999-8999-999999999991'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'achievement-a@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('a9999999-9999-4999-8999-999999999992'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'achievement-b@workpulse.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.experiences (id, user_id, organization, role_title, kind)
values
  ('a9999999-9999-4999-8999-999999999901'::uuid, 'a9999999-9999-4999-8999-999999999991'::uuid, 'Achievement Org A', 'Builder A', 'employment'),
  ('a9999999-9999-4999-8999-999999999902'::uuid, 'a9999999-9999-4999-8999-999999999991'::uuid, 'Achievement Org B', 'Builder B', 'volunteer'),
  ('a9999999-9999-4999-8999-999999999903'::uuid, 'a9999999-9999-4999-8999-999999999992'::uuid, 'Foreign Org', 'Foreign Builder', 'internship');

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

create temporary table pg_temp.t09_project_a as
select * from public.create_project_idempotent(
  'a9999999-9999-4999-8999-999999999801'::uuid,
  'Achievement Project A', null, null, null, 'active', null, null, null, null, false,
  'a9999999-9999-4999-8999-999999999901'::uuid
);
create temporary table pg_temp.t09_project_b as
select * from public.create_project_idempotent(
  'a9999999-9999-4999-8999-999999999802'::uuid,
  'Achievement Project B', null, null, null, 'active', null, null, null, null, false,
  'a9999999-9999-4999-8999-999999999902'::uuid
);

create temporary table pg_temp.t09_standalone as
select * from public.create_achievement_idempotent(
  'a9999999-9999-4999-8999-999999999811'::uuid,
  null, null, 'a9999999-9999-4999-8999-999999999901'::uuid
);
select is((select revision from pg_temp.t09_standalone), 1, 'standalone Achievement starts at revision one');
select is((select status from public.achievements where id = (select achievement_id from pg_temp.t09_standalone)), 'draft', 'manual create starts as draft');
select is((select count(*) from public.create_achievement_idempotent('a9999999-9999-4999-8999-999999999811'::uuid, null, null, 'a9999999-9999-4999-8999-999999999901'::uuid)), 1::bigint, 'identical Achievement create replay returns one receipt');
select is((select achievement_id from public.create_achievement_idempotent('a9999999-9999-4999-8999-999999999811'::uuid, null, null, 'a9999999-9999-4999-8999-999999999901'::uuid)), (select achievement_id from pg_temp.t09_standalone), 'Achievement replay returns original id');
select throws_ok(
  $$select * from public.create_achievement_idempotent('a9999999-9999-4999-8999-999999999811'::uuid, null, (select project_id from pg_temp.t09_project_a), null)$$,
  '22023', 'IDEMPOTENCY_KEY_REUSED', 'changed Achievement payload with the same operation key is rejected'
);

select throws_ok(
  $$insert into public.achievements (user_id, title) values (auth.uid(), 'Direct Achievement')$$,
  '42501', null, 'authenticated clients cannot insert Achievements directly'
);
select throws_ok(
  $$update public.achievements set title = 'Direct update' where id = (select achievement_id from pg_temp.t09_standalone)$$,
  '42501', null, 'authenticated clients cannot update Achievements directly'
);

select * from public.save_achievement(
  (select achievement_id from pg_temp.t09_standalone), 1, 'save_draft',
  jsonb_build_object(
    'title', 'Reduce manual work',
    'contribution', 'I redesigned the intake flow',
    'scope', 'Internal operations',
    'outcome', 'The team processed requests faster',
    'achieved_on', '2026-09-20',
    'cv_bullet', null,
    'metrics', '[]'::jsonb
  ),
  '["SQL", "Product operations"]'::jsonb
);
select is((select revision from public.achievements where id = (select achievement_id from pg_temp.t09_standalone)), 2, 'draft save increments revision once');
select is((select count(*) from public.achievement_skills where achievement_id = (select achievement_id from pg_temp.t09_standalone)), 2::bigint, 'skill labels are resolved and linked atomically');

select * from public.save_achievement(
  (select achievement_id from pg_temp.t09_standalone), 2, 'confirm',
  jsonb_build_object('title', 'Reduce manual work', 'contribution', 'I redesigned the intake flow', 'outcome', 'The team processed requests faster', 'achieved_on', '2026-09-20', 'cv_bullet', null, 'metrics', '[]'::jsonb),
  '["SQL", "Product operations"]'::jsonb
);
select is((select status from public.achievements where id = (select achievement_id from pg_temp.t09_standalone)), 'confirmed', 'confirm transitions a valid draft');
select is((select cv_bullet from public.achievements where id = (select achievement_id from pg_temp.t09_standalone)), 'I redesigned the intake flow. The team processed requests faster', 'confirm uses the factual fallback without inventing wording');
select is((select count(*) from public.achievement_skills link join public.achievements a on a.id = link.achievement_id where a.status = 'confirmed'), 2::bigint, 'demonstrated skill links are countable only for confirmed Achievements');
select throws_ok(
  $$select * from public.save_achievement((select achievement_id from pg_temp.t09_standalone), 3, 'dismiss', '{}'::jsonb, '[]'::jsonb)$$,
  'P0001', 'INVALID_ACHIEVEMENT_TRANSITION', 'confirmed Achievement cannot be dismissed directly'
);
select * from public.save_achievement(
  (select achievement_id from pg_temp.t09_standalone), 3, 'reopen', '{}'::jsonb, '[]'::jsonb
);
select is((select status from public.achievements where id = (select achievement_id from pg_temp.t09_standalone)), 'draft', 'reopen removes confirmed eligibility');

select * from public.create_activity_idempotent(
  'a9999999-9999-4999-8999-999999999821'::uuid,
  E'  source survives deletion 😀  ', '2026-09-19'::date, 'note', 'role', 'scope', 'outcome',
  'a9999999-9999-4999-8999-999999999901'::uuid,
  (select project_id from pg_temp.t09_project_a)
);
create temporary table pg_temp.t09_activity as
select id, revision from public.activities where raw_text = E'  source survives deletion 😀  ';
create temporary table pg_temp.t09_derived as
select * from public.create_achievement_idempotent(
  'a9999999-9999-4999-8999-999999999822'::uuid,
  (select id from pg_temp.t09_activity), null, null
);
select is((select source_excerpt from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), E'  source survives deletion 😀  ', 'derived create preserves Activity text exactly');
select is((select source_activity_revision from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), 1, 'derived create records source revision');
select is((select project_id from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), (select project_id from pg_temp.t09_project_a), 'derived create copies Project context');
select is((select experience_id from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), 'a9999999-9999-4999-8999-999999999901'::uuid, 'derived create copies Experience context');
select throws_ok(
  $$select * from public.create_achievement_idempotent('a9999999-9999-4999-8999-999999999823'::uuid, (select id from pg_temp.t09_activity), null, null)$$,
  'P0001', 'ACHIEVEMENT_EXISTS', 'one Activity cannot receive a second derived Achievement'
);

select is((select revision from public.relink_activity_project((select id from pg_temp.t09_activity), 1, (select project_id from pg_temp.t09_project_b))), 2, 'Activity relink succeeds with optimistic revision');
select is((select project_id from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), (select project_id from pg_temp.t09_project_b), 'Activity relink propagates Project to derived Achievement');
select is((select experience_id from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), 'a9999999-9999-4999-8999-999999999902'::uuid, 'Activity relink propagates Experience to derived Achievement');
select is((select revision from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), 2, 'context propagation increments derived Achievement once');

select is((select retained_achievement_count from public.delete_activity((select id from pg_temp.t09_activity), 2)), 1, 'Activity delete receipt reports retained derived Achievement');
select is((select activity_id from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), null::uuid, 'Activity delete detaches but retains Achievement');
select is((select source_excerpt from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), E'  source survives deletion 😀  ', 'Activity delete retains provenance text');
select is((select source_activity_revision from public.achievements where id = (select achievement_id from pg_temp.t09_derived)), 1, 'Activity delete retains provenance revision');

create temporary table pg_temp.t09_project_delete as
select * from public.create_project_idempotent(
  'a9999999-9999-4999-8999-999999999831'::uuid,
  'Achievement delete Project', null, null, null, 'active', null, null, null, null, false,
  'a9999999-9999-4999-8999-999999999901'::uuid
);
create temporary table pg_temp.t09_delete_achievement as
select * from public.create_achievement_idempotent(
  'a9999999-9999-4999-8999-999999999832'::uuid,
  null, (select project_id from pg_temp.t09_project_delete),
  'a9999999-9999-4999-8999-999999999901'::uuid
);
select is((select released_achievement_count from public.delete_project((select project_id from pg_temp.t09_project_delete), 1)), 1, 'Project delete receipt reports released Achievements');
select is((select project_id from public.achievements where id = (select achievement_id from pg_temp.t09_delete_achievement)), null::uuid, 'Project delete detaches but retains standalone Achievement');

select pg_temp.set_jwt_subject('a9999999-9999-4999-8999-999999999992'::uuid);
select is((select count(*) from public.achievements), 0::bigint, 'RLS hides another owner’s Achievements');
select pg_temp.set_jwt_subject('a9999999-9999-4999-8999-999999999991'::uuid);

select * from finish();
rollback;

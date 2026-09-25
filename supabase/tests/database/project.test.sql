begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  not has_table_privilege('authenticated', 'public.projects', 'INSERT')
  and not has_table_privilege('authenticated', 'public.projects', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.projects', 'DELETE')
  and has_function_privilege(
    'authenticated',
    'public.create_project_idempotent(uuid,text,text,text,text,text,date,text,date,text,boolean,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.relink_activity_project(uuid,integer,uuid)',
    'EXECUTE'
  ),
  'Project direct mutation is closed and narrow public RPCs remain executable'
);

select ok(
  to_regprocedure('public.delete_project(uuid,integer)') is not null
  and pg_get_function_result('public.delete_project(uuid,integer)'::regprocedure) like '%released_activity_count%',
  'Project deletion exposes an actual activity release receipt'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '88888888-8888-4888-8888-888888888881'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'project-a@workpulse.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()
  ),
  (
    '88888888-8888-4888-8888-888888888882'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'project-b@workpulse.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()
  );

insert into public.experiences (id, user_id, organization, role_title, kind)
values
  ('88888888-8888-4888-8888-888888888891'::uuid, '88888888-8888-4888-8888-888888888881'::uuid, 'Project Org A', 'Builder A', 'employment'),
  ('88888888-8888-4888-8888-888888888892'::uuid, '88888888-8888-4888-8888-888888888881'::uuid, 'Project Org B', 'Builder B', 'volunteer'),
  ('88888888-8888-4888-8888-888888888894'::uuid, '88888888-8888-4888-8888-888888888881'::uuid, 'Replay Org', 'Replay Builder', 'employment'),
  ('88888888-8888-4888-8888-888888888893'::uuid, '88888888-8888-4888-8888-888888888882'::uuid, 'Foreign Org', 'Foreign Builder', 'internship');

create or replace function pg_temp.set_jwt_subject(p_user_id uuid, p_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', p_role)::text, true);
end;
$$;

select pg_temp.set_jwt_subject('88888888-8888-4888-8888-888888888881'::uuid);
set local role authenticated;

create temporary table pg_temp.t08_standalone_receipt as
select * from public.create_project_idempotent(
  '88888888-8888-4888-8888-888888888801'::uuid,
  'Completed without outcome', null, null, null, 'completed',
  null, null, '2024-06-01'::date, 'month', false, null
);

select is((select revision from pg_temp.t08_standalone_receipt), 1, 'a minimal standalone Project starts at revision 1');
select is((select user_id from pg_temp.t08_standalone_receipt), auth.uid(), 'Project create derives ownership from the session');
select is(
  (select count(*) from public.projects where id = (select project_id from pg_temp.t08_standalone_receipt) and status = 'completed' and outcome is null and experience_id is null and not is_current and end_date = '2024-06-01'::date and end_precision = 'month'),
  1::bigint,
  'completed Projects retain a valid partial end date while omitting outcome and Experience'
);

select is(
  (select end_date from public.update_project(
    (select project_id from pg_temp.t08_standalone_receipt), 1,
    '{"status":"completed","end_date":"2024-06-15","end_precision":"day","is_current":false}'::jsonb
  )),
  '2024-06-15'::date,
  'completed Project updates retain a valid end date'
);
select is(
  (select end_precision from public.projects where id = (select project_id from pg_temp.t08_standalone_receipt)),
  'day',
  'completed Project updates retain end precision'
);

select is(
  (select count(*) from public.create_project_idempotent(
    '88888888-8888-4888-8888-888888888801'::uuid,
    'Completed without outcome', null, null, null, 'completed',
    null, null, '2024-06-01'::date, 'month', false, null
  )),
  1::bigint,
  'an identical Project create retry returns one stable receipt'
);
select is(
  (select project_id from public.create_project_idempotent(
    '88888888-8888-4888-8888-888888888801'::uuid,
    'Completed without outcome', null, null, null, 'completed',
    null, null, '2024-06-01'::date, 'month', false, null
  )),
  (select project_id from pg_temp.t08_standalone_receipt),
  'an idempotent replay returns the original Project ID'
);
select throws_ok(
  $$select * from public.create_project_idempotent(
    '88888888-8888-4888-8888-888888888801'::uuid,
    'Changed payload', null, null, null, 'completed',
    null, null, '2024-06-01'::date, 'month', false, null
  )$$,
  '22023', 'IDEMPOTENCY_KEY_REUSED',
  'a reused Project operation key with a changed payload is rejected'
);

create temporary table pg_temp.t08_deleted_parent_receipt as
select * from public.create_project_idempotent(
  '88888888-8888-4888-8888-888888888805'::uuid,
  'Replay after parent deletion', null, null, null, 'active',
  null, null, null, null, false,
  '88888888-8888-4888-8888-888888888894'::uuid
);
select is(
  (select count(*) from public.delete_experience('88888888-8888-4888-8888-888888888894'::uuid, 1)),
  1::bigint,
  'deleting an Experience releases the linked Project context'
);
select is(
  (select project_id from public.create_project_idempotent(
    '88888888-8888-4888-8888-888888888805'::uuid,
    'Replay after parent deletion', null, null, null, 'active',
    null, null, null, null, false,
    '88888888-8888-4888-8888-888888888894'::uuid
  )),
  (select project_id from pg_temp.t08_deleted_parent_receipt),
  'an identical Project replay returns its immutable receipt after parent deletion'
);
select throws_ok(
  $$select * from public.create_project_idempotent(
    '88888888-8888-4888-8888-888888888805'::uuid,
    'Changed after parent deletion', null, null, null, 'active',
    null, null, null, null, false,
    '88888888-8888-4888-8888-888888888894'::uuid
  )$$,
  '22023', 'IDEMPOTENCY_KEY_REUSED',
  'a changed Project replay remains rejected after parent deletion'
);
select throws_ok(
  $$select * from public.create_project_idempotent(
    '88888888-8888-4888-8888-888888888806'::uuid,
    'Foreign Experience Project', null, null, null, 'active',
    null, null, null, null, false,
    '88888888-8888-4888-8888-888888888893'::uuid
  )$$,
  '22023', 'INVALID_PROJECT_INPUT',
  'a fresh Project create rejects a foreign Experience without disclosure'
);

select throws_ok(
  $$insert into public.projects (user_id, title, status) values (auth.uid(), 'Direct Project', 'planned')$$,
  '42501', null,
  'authenticated clients cannot insert Projects directly'
);
select throws_ok(
  $$update public.projects set title = 'Direct update' where id = (select project_id from pg_temp.t08_standalone_receipt)$$,
  '42501', null,
  'authenticated clients cannot update Projects directly'
);
select throws_ok(
  $$delete from public.projects where id = (select project_id from pg_temp.t08_standalone_receipt)$$,
  '42501', null,
  'authenticated clients cannot delete Projects directly'
);

create temporary table pg_temp.t08_project_a as
select * from public.create_project_idempotent(
  '88888888-8888-4888-8888-888888888802'::uuid,
  'Context project A', null, null, null, 'active',
  null, null, null, null, false,
  '88888888-8888-4888-8888-888888888891'::uuid
);
create temporary table pg_temp.t08_project_b as
select * from public.create_project_idempotent(
  '88888888-8888-4888-8888-888888888803'::uuid,
  'Context project B', null, null, null, 'active',
  null, null, null, null, false,
  '88888888-8888-4888-8888-888888888892'::uuid
);

select is(
  (select count(*) from public.create_activity_idempotent(
    '88888888-8888-4888-8888-888888888811'::uuid,
    '  chat source survives relink 😀  ', '2026-09-20'::date, 'chat',
    'role', 'scope', 'outcome', '88888888-8888-4888-8888-888888888891'::uuid, null
  )),
  1::bigint,
  'an owned Chat Activity can start without a Project'
);

create temporary table pg_temp.t08_activity_a as
select id, revision, project_id, experience_id, raw_text
from public.activities
where raw_text = '  chat source survives relink 😀  ';

select is(
  (select experience_id from public.relink_activity_project(
    (select id from pg_temp.t08_activity_a), 1, (select project_id from pg_temp.t08_project_b)
  )),
  '88888888-8888-4888-8888-888888888892'::uuid,
  'relink derives Experience from the target Project'
);
select is(
  (select revision from public.relink_activity_project(
    (select id from pg_temp.t08_activity_a), 2, null
  )),
  3,
  'detach increments Activity revision and preserves Project-derived Experience'
);
select is(
  (select project_id from public.activities where id = (select id from pg_temp.t08_activity_a)),
  null::uuid,
  'detach clears only the Project link'
);
select is(
  (select raw_text from public.activities where id = (select id from pg_temp.t08_activity_a)),
  '  chat source survives relink 😀  ',
  'relink preserves Activity source text'
);
select is(
  (select count(*) from public.chat_messages where activity_id = (select id from pg_temp.t08_activity_a)),
  1::bigint,
  'relink preserves Chat history'
);

select * from public.create_activity_idempotent(
  '88888888-8888-4888-8888-888888888812'::uuid,
  'linked source', '2026-09-19'::date, 'note', null, null, null,
  '88888888-8888-4888-8888-888888888891'::uuid,
  (select project_id from pg_temp.t08_project_a)
);
create temporary table pg_temp.t08_activity_b as
select id, revision from public.activities
where raw_text = 'linked source';

select is(
  (select experience_id from public.update_project(
    (select project_id from pg_temp.t08_project_a), 1,
    jsonb_build_object('experience_id', '88888888-8888-4888-8888-888888888892'::uuid)
  )),
  '88888888-8888-4888-8888-888888888892'::uuid,
  'Project context update commits the new Experience'
);
select is(
  (select experience_id from public.activities where id = (select id from pg_temp.t08_activity_b)),
  '88888888-8888-4888-8888-888888888892'::uuid,
  'Project context propagation updates every linked Activity'
);
select is(
  (select revision from public.activities where id = (select id from pg_temp.t08_activity_b)),
  2,
  'context propagation increments a changed Activity exactly once'
);
select is(
  (select revision from public.update_project(
    (select project_id from pg_temp.t08_project_a), 2,
    '{"title":"Title only"}'::jsonb
  )),
  3,
  'Project updates retain the established revision-checked partial patch contract'
);
select is(
  (select revision from public.activities where id = (select id from pg_temp.t08_activity_b)),
  2,
  'a Project edit without context change does not bump Activity revision'
);

create temporary table pg_temp.t08_delete_receipt as
select * from public.delete_project((select project_id from pg_temp.t08_project_a), 3);
select is((select released_activity_count from pg_temp.t08_delete_receipt), 1, 'delete receipt reports actual released Activity count');
select is((select deleted_project_id from pg_temp.t08_delete_receipt), (select project_id from pg_temp.t08_project_a), 'delete receipt identifies the deleted Project');
select is((select project_id from public.activities where id = (select id from pg_temp.t08_activity_b)), null::uuid, 'Project deletion clears only Activity project_id');
select is((select experience_id from public.activities where id = (select id from pg_temp.t08_activity_b)), '88888888-8888-4888-8888-888888888892'::uuid, 'Project deletion preserves Activity Experience');
select is((select revision from public.activities where id = (select id from pg_temp.t08_activity_b)), 3, 'Project deletion increments released Activity revision exactly once');

select pg_temp.set_jwt_subject('88888888-8888-4888-8888-888888888882'::uuid);
create temporary table pg_temp.t08_foreign_project as
select * from public.create_project_idempotent(
  '88888888-8888-4888-8888-888888888804'::uuid,
  'Foreign Project', null, null, null, 'planned', null, null, null, null, false,
  '88888888-8888-4888-8888-888888888893'::uuid
);
select pg_temp.set_jwt_subject('88888888-8888-4888-8888-888888888881'::uuid);
select throws_ok(
  $$select * from public.relink_activity_project(
    (select id from pg_temp.t08_activity_a), 3,
    (select project_id from pg_temp.t08_foreign_project)
  )$$,
  'P0001', 'ACTIVITY_UNAVAILABLE',
  'foreign Project targets fail without exposing ownership'
);

select * from finish();
rollback;

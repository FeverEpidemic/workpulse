begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- 1. Structure and privileges -------------------------------------------------

select has_table('ai_suggestion_reviews', 'T14 ai_suggestion_reviews table exists');
select has_column('ai_jobs', 'kind', 'ai_jobs still has kind');
select has_column('ai_suggestion_reviews', 'answers_hash', 'ai_suggestion_reviews records the answers hash');
select has_column('ai_suggestion_reviews', 'applied_achievement_revision', 'ai_suggestion_reviews records the applied achievement revision');

select ok(
  (select relation.relrowsecurity from pg_catalog.pg_class as relation
   where relation.oid = 'public.ai_suggestion_reviews'::regclass),
  'RLS is enabled on ai_suggestion_reviews'
);

select ok(
  not has_table_privilege('authenticated', 'public.ai_suggestion_reviews', 'INSERT')
  and not has_table_privilege('authenticated', 'public.ai_suggestion_reviews', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ai_suggestion_reviews', 'DELETE')
  and not has_table_privilege('service_role', 'public.ai_suggestion_reviews', 'INSERT')
  and not has_table_privilege('service_role', 'public.ai_suggestion_reviews', 'UPDATE')
  and not has_table_privilege('service_role', 'public.ai_suggestion_reviews', 'DELETE')
  and not has_table_privilege('anon', 'public.ai_suggestion_reviews', 'SELECT'),
  'no role can write ai_suggestion_reviews directly; anon cannot read it'
);

select ok(
  has_function_privilege('authenticated', 'public.answer_ai_questions(uuid,integer,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.skip_ai_questions(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.dismiss_ai_suggestion(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.apply_ai_suggestion(uuid,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_ai_suggestion(uuid,integer,integer)', 'EXECUTE'),
  'T14 review RPCs are executable by authenticated only'
);

select ok(
  (select pg_catalog.bool_and(proc.prosecdef) from pg_catalog.pg_proc as proc
   join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
   where ns.nspname = 'public'
     and proc.proname in ('answer_ai_questions', 'skip_ai_questions', 'dismiss_ai_suggestion', 'apply_ai_suggestion')),
  'all T14 review RPCs are security definer'
);

select throws_ok(
  $$ select kind from public.ai_jobs limit 0 union all select 'import'::text $$,
  null, null, 'sanity: kind column is text'
);

-- 2. Fixtures -------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1414141-1414-4141-8141-141414141411', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'review-a@workpulse.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('d1414141-1414-4141-8141-141414141412', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'review-b@workpulse.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.activities (id, user_id, raw_text, occurred_on, capture_mode, role, outcome)
values
  ('c2414141-1414-4141-8141-141414141411', 'c1414141-1414-4141-8141-141414141411',
   'Migrated 3 reports to the new pipeline. WP-PRIVATE-SENTINEL', '2026-09-20', 'note', null, null),
  ('c2414141-1414-4141-8141-141414141412', 'c1414141-1414-4141-8141-141414141411',
   'Routine standup note, nothing notable', '2026-09-21', 'note', null, null),
  ('c2414141-1414-4141-8141-141414141413', 'c1414141-1414-4141-8141-141414141411',
   'Third activity for dismiss flow', '2026-09-22', 'note', null, null),
  ('c2414141-1414-4141-8141-141414141414', 'c1414141-1414-4141-8141-141414141411',
   'Fourth activity chat mode', '2026-09-23', 'chat', 'Existing role already set', null),
  ('d2414141-1414-4141-8141-141414141411', 'd1414141-1414-4141-8141-141414141412',
   'B private activity for isolation', '2026-09-20', 'note', null, null);

insert into public.chat_messages (user_id, activity_id, role, content, sequence_no)
values ('c1414141-1414-4141-8141-141414141411', 'c2414141-1414-4141-8141-141414141414',
        'user', 'Fourth activity chat mode', 1);

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

create or replace function pg_temp.result_with_questions(p_n integer, p_kind text default 'detect')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schema_version', 'detect.v1',
    'potential', true,
    'suggestion', jsonb_build_object(
      'title', 'Migrated 3 reports to a new pipeline',
      'contribution', 'Led the migration end to end',
      'outcome', 'Reduced manual steps for the team',
      'role', null, 'scope', null,
      'cv_bullet', 'Migrated 3 reports to the new pipeline',
      'metrics', jsonb_build_array(jsonb_build_object('label', 'Reports migrated', 'value', 3, 'unit', 'reports', 'baseline', null)),
      'skills', jsonb_build_array('Data migration')
    ),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object('field', field, 'text', 'What was the ' || field || '?')), '[]'::jsonb)
      from unnest((case
        when p_n >= 4 then array['role','scope','outcome','role']
        when p_n = 3 then array['role','scope','outcome']
        when p_n = 2 then array['role','scope']
        when p_n = 1 then array['outcome']
        else array[]::text[] end)) as field
    )
  );
$$;

create or replace function pg_temp.result_for_fields(p_fields text[])
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schema_version', 'detect.v1',
    'potential', true,
    'suggestion', jsonb_build_object(
      'title', 'Fourth activity reviewed',
      'contribution', 'Led the fourth activity end to end',
      'outcome', 'Reduced manual steps for the team',
      'role', null, 'scope', null,
      'cv_bullet', 'Reviewed the fourth activity',
      'metrics', '[]'::jsonb,
      'skills', '[]'::jsonb
    ),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object('field', field, 'text', 'What was the ' || field || '?')), '[]'::jsonb)
      from unnest(p_fields) as field
    )
  );
$$;

create or replace function pg_temp.nonpotential_result()
returns jsonb
language sql
as $$
  select '{"schema_version":"detect.v1","potential":false,"suggestion":null,"questions":[]}'::jsonb;
$$;

-- 3. Request/refine, one job per revision, question limits ----------------------

select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
select lives_ok(
  format('select * from public.set_ai_consent(%s, true)',
    (select revision from public.profiles where id = auth.uid())),
  'owner grants AI consent'
);

create temporary table pg_temp.job1 as
select * from public.request_ai_analysis('c2414141-1414-4141-8141-141414141411', 1);
grant select on pg_temp.job1 to public;
select is((select kind from pg_temp.job1), 'detect', 'request_ai_analysis receipt now carries kind');

reset role;
set local role service_role;
create temporary table pg_temp.claim1 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim1 to public;

select is(
  public.complete_ai_job((select id from pg_temp.claim1), (select attempt_token from pg_temp.claim1),
    pg_temp.result_with_questions(4)),
  'invalid', 'a detect result with more than 3 questions is rejected'
);
reset role;
select ok(
  (select status = 'failed' and error_code = 'AI_OUTPUT_INVALID' from public.ai_jobs where id = (select id from pg_temp.claim1)),
  'over-limit questions fail the job as AI_OUTPUT_INVALID'
);

select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
select is(
  (select status from public.retry_ai_job((select id from pg_temp.claim1))),
  'queued', 'owner retries the failed job'
);
reset role;
set local role service_role;
create temporary table pg_temp.claim2 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim2 to public;
select is(
  public.complete_ai_job((select id from pg_temp.claim2), (select attempt_token from pg_temp.claim2), pg_temp.result_with_questions(3)),
  'succeeded', '3 questions on a detect result is accepted'
);
reset role;

-- Duplicate request for the same revision returns the same (now succeeded) job.
select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
select is(
  (select job_id from public.request_ai_analysis('c2414141-1414-4141-8141-141414141411', 1)),
  (select job_id from pg_temp.job1), 'request for an analysed revision returns the same job'
);
select is((select count(*) from public.ai_jobs where activity_id = 'c2414141-1414-4141-8141-141414141411'), 1::bigint, 'still one job for this revision');

-- 4. Answering questions creates a new input revision and a refine job ----------

create temporary table pg_temp.answer1 as
select * from public.answer_ai_questions(
  (select id from pg_temp.claim2), 1,
  jsonb_build_object('role', 'Tech lead', 'scope', 'Reporting pipeline', 'outcome', 'Weekly prep dropped from 5 to 2 hours')
);
grant select on pg_temp.answer1 to public;
select is((select activity_revision from pg_temp.answer1), 2, 'answering bumps the activity revision by one');
select is((select job_status from pg_temp.answer1), 'queued', 'answering enqueues a refine job (consent is current)');
select ok((select job_id from pg_temp.answer1) is not null, 'a refine job id is returned');
select is(
  (select kind from public.ai_jobs where id = (select job_id from pg_temp.answer1)),
  'refine', 'the enqueued job is kind refine'
);
select is(
  (select raw_text from public.activities where id = 'c2414141-1414-4141-8141-141414141411'),
  'Migrated 3 reports to the new pipeline. WP-PRIVATE-SENTINEL', 'raw_text is unchanged by answering'
);
select is(
  (select role from public.activities where id = 'c2414141-1414-4141-8141-141414141411'),
  'Tech lead', 'answered role is written to the activity'
);

-- Replay with identical answers returns the same receipt without a second bump.
create temporary table pg_temp.answer1_replay as
select * from public.answer_ai_questions(
  (select id from pg_temp.claim2), 1,
  jsonb_build_object('role', 'Tech lead', 'scope', 'Reporting pipeline', 'outcome', 'Weekly prep dropped from 5 to 2 hours')
);
grant select on pg_temp.answer1_replay to public;
select is((select activity_revision from pg_temp.answer1_replay), 2, 'replay does not bump the revision again');
select is(
  (select job_id from pg_temp.answer1_replay), (select job_id from pg_temp.answer1),
  'replay returns the same refine job id'
);
select is(
  (select revision from public.activities where id = 'c2414141-1414-4141-8141-141414141411'), 2,
  'activity revision stays at 2 after replay'
);

-- Different answers with the same job/revision are rejected.
select throws_ok(
  format('select * from public.answer_ai_questions(%L, 1, %L)',
    (select id from pg_temp.claim2), jsonb_build_object('role', 'Something else')),
  '22023', 'IDEMPOTENCY_KEY_REUSED', 'a different answer payload for the same revision is rejected'
);

-- Drain the refine job created by the answer above before moving to a fresh activity,
-- so claim_ai_jobs (FIFO) does not hand it to the next section by accident.
reset role;
set local role service_role;
create temporary table pg_temp.claim_refine1 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim_refine1 to public;
select is((select kind from pg_temp.claim_refine1), 'refine', 'the queued refine job is claimed and drained');
select is(
  public.complete_ai_job((select id from pg_temp.claim_refine1), (select attempt_token from pg_temp.claim_refine1), pg_temp.result_with_questions(0)),
  'succeeded', 'the drained refine job completes with no questions'
);
reset role;

-- Answering a field the job never asked about is rejected.
select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
create temporary table pg_temp.job_chat as
select * from public.request_ai_analysis('c2414141-1414-4141-8141-141414141414', 1);
grant select on pg_temp.job_chat to public;
reset role;
set local role service_role;
create temporary table pg_temp.claim_chat as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim_chat to public;
select is(
  public.complete_ai_job((select id from pg_temp.claim_chat), (select attempt_token from pg_temp.claim_chat),
    pg_temp.result_for_fields(array['role', 'outcome'])),
  'succeeded', 'chat activity analysis succeeds asking about role (already set) and outcome'
);
reset role;
select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
select throws_ok(
  format('select * from public.answer_ai_questions(%L, 1, %L)',
    (select id from pg_temp.claim_chat), jsonb_build_object('scope', 'Not asked about')),
  '22023', 'INVALID_AI_ANSWER', 'answering a field the job did not ask about is rejected'
);
select throws_ok(
  format('select * from public.answer_ai_questions(%L, 1, %L)',
    (select id from pg_temp.claim_chat), jsonb_build_object('role', 'Should not overwrite')),
  '22023', 'INVALID_AI_ANSWER', 'answering a field that already has a value is rejected even though the job asked about it'
);

create temporary table pg_temp.answer_chat as
select * from public.answer_ai_questions(
  (select id from pg_temp.claim_chat), 1, jsonb_build_object('outcome', 'Weekly prep dropped from 5 to 2 hours')
);
grant select on pg_temp.answer_chat to public;
select is((select activity_revision from pg_temp.answer_chat), 2, 'answering the valid field bumps the revision');
select is(
  (select outcome from public.activities where id = 'c2414141-1414-4141-8141-141414141414'),
  'Weekly prep dropped from 5 to 2 hours', 'the answered outcome is written'
);
select is(
  (select count(*) from public.chat_messages where user_id = 'c1414141-1414-4141-8141-141414141411'
    and activity_id = 'c2414141-1414-4141-8141-141414141414'),
  3::bigint, 'a chat pair (assistant question + user answer) is appended after the seeded first message'
);
select is(
  (select role from public.chat_messages where user_id = 'c1414141-1414-4141-8141-141414141411'
    and activity_id = 'c2414141-1414-4141-8141-141414141414' and sequence_no = 2),
  'assistant', 'the appended question is from the assistant'
);
select is(
  (select content from public.chat_messages where user_id = 'c1414141-1414-4141-8141-141414141411'
    and activity_id = 'c2414141-1414-4141-8141-141414141414' and sequence_no = 3),
  'Weekly prep dropped from 5 to 2 hours', 'the appended answer matches what was submitted'
);
reset role;

-- Refine result cannot carry questions.
reset role;
set local role service_role;
create temporary table pg_temp.claim3 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim3 to public;
select is((select kind from pg_temp.claim3), 'refine', 'worker claims the refine job');
select is(
  public.complete_ai_job((select id from pg_temp.claim3), (select attempt_token from pg_temp.claim3), pg_temp.result_with_questions(1, 'refine')),
  'invalid', 'a refine result with questions is rejected'
);
reset role;
select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
select is((select status from public.retry_ai_job((select id from pg_temp.claim3))), 'queued', 'owner retries the refine job');
reset role;
set local role service_role;
create temporary table pg_temp.claim4 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim4 to public;
select is(
  public.complete_ai_job((select id from pg_temp.claim4), (select attempt_token from pg_temp.claim4), pg_temp.result_with_questions(0, 'refine')),
  'succeeded', 'refine result with zero questions succeeds'
);
reset role;

-- 5. Skip and dismiss -------------------------------------------------------------

select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
select lives_ok(
  format('select public.skip_ai_questions(%L)', (select id from pg_temp.claim1)),
  'owner skips questions (idempotent)'
);
select lives_ok(
  format('select public.skip_ai_questions(%L)', (select id from pg_temp.claim1)),
  'skip is idempotent on a second call'
);

create temporary table pg_temp.job5 as
select * from public.request_ai_analysis('c2414141-1414-4141-8141-141414141413', 1);
grant select on pg_temp.job5 to public;
reset role;
set local role service_role;
create temporary table pg_temp.claim5 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim5 to public;
select is(
  public.complete_ai_job((select id from pg_temp.claim5), (select attempt_token from pg_temp.claim5), pg_temp.nonpotential_result()),
  'succeeded', 'nonpotential result succeeds'
);
reset role;

select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
select throws_ok(
  format('select * from public.apply_ai_suggestion(%L, 1, null)', (select id from pg_temp.claim5)),
  'P0001', 'AI_JOB_NOT_APPLICABLE', 'apply on a nonpotential job is rejected'
);

select lives_ok(
  format('select public.dismiss_ai_suggestion(%L)', (select id from pg_temp.claim5)),
  'owner dismisses the nonpotential suggestion (idempotent even though nothing applies)'
);
select lives_ok(
  format('select public.dismiss_ai_suggestion(%L)', (select id from pg_temp.claim5)),
  'dismiss is idempotent on a second call'
);

-- Dismiss on the analysed activity blocks apply and future suggestions.
select lives_ok(
  format('select public.dismiss_ai_suggestion(%L)', (select id from pg_temp.claim4)),
  'owner dismisses the refine suggestion'
);
select throws_ok(
  format('select * from public.apply_ai_suggestion(%L, 2, null)', (select id from pg_temp.claim4)),
  'P0001', 'AI_SUGGESTION_DISMISSED', 'apply after dismiss is rejected'
);

-- 6. Apply: create draft, protections, idempotency -------------------------------

reset role;
-- Re-open a fresh activity/job pair for the create-draft path (activity 1 was dismissed above).
select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
create temporary table pg_temp.job6 as
select * from public.request_ai_analysis('c2414141-1414-4141-8141-141414141412', 1);
grant select on pg_temp.job6 to public;
reset role;
set local role service_role;
create temporary table pg_temp.claim6 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim6 to public;
select is(
  public.complete_ai_job((select id from pg_temp.claim6), (select attempt_token from pg_temp.claim6), pg_temp.result_with_questions(0)),
  'succeeded', 'activity 2 analysis succeeds with a suggestion and no questions'
);
reset role;

select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
select throws_ok(
  format('select * from public.apply_ai_suggestion(%L, 1, 1)', (select id from pg_temp.claim6)),
  'P0001', 'STALE_REVISION', 'apply with a non-null expected achievement revision when none exists is rejected'
);

create temporary table pg_temp.apply1 as
select * from public.apply_ai_suggestion((select id from pg_temp.claim6), 1, null);
grant select on pg_temp.apply1 to public;
select is((select created from pg_temp.apply1), true, 'first apply creates the draft');
select is(
  (select status from public.achievements where id = (select achievement_id from pg_temp.apply1)),
  'draft', 'apply never creates a confirmed achievement'
);
select is(
  (select origin from public.achievements where id = (select achievement_id from pg_temp.apply1)),
  'activity', 'draft origin is activity'
);
select is(
  (select source_activity_revision from public.achievements where id = (select achievement_id from pg_temp.apply1)),
  1, 'source_activity_revision matches the job input revision'
);
select is(
  (select metrics from public.achievements where id = (select achievement_id from pg_temp.apply1)),
  '[{"label":"Reports migrated","value":3,"unit":"reports"}]'::jsonb,
  'a null baseline is dropped from the metric object, not stored as null'
);

-- Replay of the same apply is idempotent.
create temporary table pg_temp.apply1_replay as
select * from public.apply_ai_suggestion((select id from pg_temp.claim6), 1, null);
grant select on pg_temp.apply1_replay to public;
select is(
  (select achievement_id from pg_temp.apply1_replay), (select achievement_id from pg_temp.apply1),
  'replay returns the same achievement'
);
select is((select created from pg_temp.apply1_replay), false, 'replay reports created = false');
select is(
  (select revision from public.achievements where id = (select achievement_id from pg_temp.apply1)),
  1, 'replay does not bump the achievement revision'
);

-- Confirmed achievement blocks apply.
select lives_ok(
  format('select * from public.save_achievement(%L, %s, %L, %L, null)',
    (select achievement_id from pg_temp.apply1), 1, 'confirm', '{}'::jsonb),
  'owner confirms the draft via the T09 action'
);
select throws_ok(
  format('select * from public.apply_ai_suggestion(%L, 1, 2)', (select id from pg_temp.claim6)),
  'P0001', 'ACHIEVEMENT_CONFIRMED', 'apply on a confirmed achievement is rejected'
);
select is(
  (select status from public.achievements where id = (select achievement_id from pg_temp.apply1)), 'confirmed',
  'the confirmed row is untouched by the rejected apply'
);

-- 7. Isolation between accounts --------------------------------------------------

reset role;
select pg_temp.set_jwt_subject('d1414141-1414-4141-8141-141414141412');
set local role authenticated;
select is(
  (select count(*) from public.ai_suggestion_reviews), 0::bigint,
  'RLS hides every A review row from B'
);
select throws_ok(
  format('select * from public.answer_ai_questions(%L, 1, %L)', (select id from pg_temp.claim6), jsonb_build_object('role', 'x')),
  'P0001', 'AI_JOB_UNAVAILABLE', 'B cannot answer A''s job'
);
select throws_ok(
  format('select public.skip_ai_questions(%L)', (select id from pg_temp.claim6)),
  'P0001', 'AI_JOB_UNAVAILABLE', 'B cannot skip on A''s job'
);
select throws_ok(
  format('select public.dismiss_ai_suggestion(%L)', (select id from pg_temp.claim6)),
  'P0001', 'AI_JOB_UNAVAILABLE', 'B cannot dismiss A''s job'
);
select throws_ok(
  format('select * from public.apply_ai_suggestion(%L, 1, null)', (select id from pg_temp.claim6)),
  'P0001', 'AI_JOB_UNAVAILABLE', 'B cannot apply A''s job'
);

-- 8. Delete cascade -----------------------------------------------------------------

reset role;
select pg_temp.set_jwt_subject('c1414141-1414-4141-8141-141414141411');
set local role authenticated;
create temporary table pg_temp.job_del as
select * from public.request_ai_analysis('c2414141-1414-4141-8141-141414141414', 2);
grant select on pg_temp.job_del to public;
select lives_ok(
  format('select public.skip_ai_questions(%L)', (select job_id from pg_temp.job_del)),
  'a review row exists for the activity about to be deleted'
);
reset role;
delete from public.activities where id = 'c2414141-1414-4141-8141-141414141414';
select is(
  (select count(*) from public.ai_jobs where id = (select job_id from pg_temp.job_del)),
  0::bigint, 'deleting the activity deletes its AI jobs'
);
select is(
  (select count(*) from public.ai_suggestion_reviews where job_id = (select job_id from pg_temp.job_del)),
  0::bigint, 'deleting the activity deletes its suggestion reviews too'
);

reset role;
select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- 1. Structure and privileges -------------------------------------------------

select has_table('ai_jobs', 'T13 ai_jobs table exists');
select has_column('ai_jobs', 'attempt_token', 'ai_jobs has a lease ownership token');
select has_column('ai_jobs', 'lease_expires_at', 'ai_jobs has a lease expiry');
select has_column('ai_jobs', 'consent_version', 'ai_jobs records the consent version used at enqueue');

select ok(
  (select relation.relrowsecurity from pg_catalog.pg_class as relation
   where relation.oid = 'public.ai_jobs'::regclass),
  'RLS is enabled on ai_jobs'
);

select ok(
  not has_table_privilege('authenticated', 'public.ai_jobs', 'INSERT')
  and not has_table_privilege('authenticated', 'public.ai_jobs', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ai_jobs', 'DELETE')
  and not has_table_privilege('service_role', 'public.ai_jobs', 'INSERT')
  and not has_table_privilege('service_role', 'public.ai_jobs', 'UPDATE')
  and not has_table_privilege('service_role', 'public.ai_jobs', 'DELETE')
  and not has_table_privilege('anon', 'public.ai_jobs', 'SELECT'),
  'no role can write ai_jobs directly; anon cannot read it'
);

select ok(
  has_column_privilege('authenticated', 'public.ai_jobs', 'status', 'SELECT')
  and has_column_privilege('authenticated', 'public.ai_jobs', 'result', 'SELECT')
  and not has_column_privilege('authenticated', 'public.ai_jobs', 'attempt_token', 'SELECT')
  and not has_column_privilege('authenticated', 'public.ai_jobs', 'lease_expires_at', 'SELECT')
  and not has_column_privilege('authenticated', 'public.ai_jobs', 'payload_hash', 'SELECT'),
  'authenticated may read job status/result but not lease internals'
);

select ok(
  has_function_privilege('authenticated', 'public.set_ai_consent(integer,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.request_ai_analysis(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.retry_ai_job(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_ai_consent(integer,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.request_ai_analysis(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.retry_ai_job(uuid)', 'EXECUTE'),
  'user AI RPCs are executable by authenticated only'
);

select ok(
  has_function_privilege('service_role', 'public.expire_ai_job_leases()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_ai_jobs(integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.get_ai_job_input(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.complete_ai_job(uuid,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.fail_ai_job(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_ai_jobs(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.get_ai_job_input(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.complete_ai_job(uuid,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.fail_ai_job(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.expire_ai_job_leases()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_ai_jobs(integer)', 'EXECUTE'),
  'worker AI RPCs are executable by service_role only'
);

select ok(
  (select bool_and(proc.prosecdef) from pg_catalog.pg_proc as proc
   join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
   where ns.nspname = 'public'
     and proc.proname in ('set_ai_consent', 'request_ai_analysis', 'retry_ai_job',
       'expire_ai_job_leases', 'claim_ai_jobs', 'get_ai_job_input', 'complete_ai_job', 'fail_ai_job')),
  'all AI RPCs are security definer'
);

select is(internal.current_ai_consent_version(), 'ai-processing-v1', 'consent version has one SQL source');

-- 2. Fixtures -----------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1313131-1313-4131-8131-131313131311', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ai-a@workpulse.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('b1313131-1313-4131-8131-131313131312', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ai-b@workpulse.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.activities (id, user_id, raw_text, occurred_on, capture_mode)
values
  ('a2313131-1313-4131-8131-131313131311', 'a1313131-1313-4131-8131-131313131311',
   'Led migration of 3 reports; WP-PRIVATE-SENTINEL', '2026-09-20', 'note'),
  ('a2313131-1313-4131-8131-131313131312', 'a1313131-1313-4131-8131-131313131311',
   'Second activity for retries', '2026-09-21', 'note'),
  ('a2313131-1313-4131-8131-131313131313', 'a1313131-1313-4131-8131-131313131311',
   'Third activity for lease expiry', '2026-09-22', 'note'),
  ('b2313131-1313-4131-8131-131313131311', 'b1313131-1313-4131-8131-131313131312',
   'B private activity', '2026-09-20', 'note');

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

create or replace function pg_temp.valid_result()
returns jsonb
language sql
as $$
  select '{"schema_version":"detect.v1","potential":false,"suggestion":null,"questions":[]}'::jsonb;
$$;

-- 3. Consent ------------------------------------------------------------------

select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;

select throws_ok(
  $$ select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131311', 1) $$,
  'P0001', 'CONSENT_REQUIRED', 'request without consent is rejected'
);
select is((select count(*) from public.ai_jobs), 0::bigint, 'no job exists without consent');
select is(
  (select analysis_state from public.activities where id = 'a2313131-1313-4131-8131-131313131311'),
  'not_requested', 'activity stays not_requested without consent'
);

create temporary table pg_temp.rev as
select revision from public.profiles where id = auth.uid();
grant select on pg_temp.rev to public;

select throws_ok(
  format('select * from public.set_ai_consent(%s, true)', (select revision + 5 from pg_temp.rev)),
  'P0001', 'STALE_REVISION', 'consent with a stale profile revision is rejected'
);

select lives_ok(
  format('select * from public.set_ai_consent(%s, true)', (select revision from pg_temp.rev)),
  'owner grants consent with the current revision'
);
select ok(
  (select ai_consent_version = 'ai-processing-v1' and ai_consent_at is not null
   from public.profiles where id = auth.uid()),
  'grant stores current version and timestamp'
);

-- withdraw then grant again to cover both directions
select lives_ok(
  format('select * from public.set_ai_consent(%s, false)',
    (select revision from public.profiles where id = auth.uid())),
  'owner withdraws consent'
);
select ok(
  (select ai_consent_version is null and ai_consent_at is null from public.profiles where id = auth.uid()),
  'withdraw clears version and timestamp together'
);
select lives_ok(
  format('select * from public.set_ai_consent(%s, true)',
    (select revision from public.profiles where id = auth.uid())),
  'owner grants consent again'
);

-- 4. Request ------------------------------------------------------------------

select throws_ok(
  $$ select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131311', 2) $$,
  'P0001', 'STALE_INPUT', 'request with a stale activity revision fails with STALE_INPUT'
);
select throws_ok(
  $$ select * from public.request_ai_analysis('b2313131-1313-4131-8131-131313131311', 1) $$,
  'P0001', 'ACTIVITY_UNAVAILABLE', 'foreign activity is indistinguishable from missing'
);

create temporary table pg_temp.job1 as
select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131311', 1);
grant select on pg_temp.job1 to public;

select is((select status from pg_temp.job1), 'queued', 'first request queues a job');
select is(
  (select analysis_state from public.activities where id = 'a2313131-1313-4131-8131-131313131311'),
  'queued', 'activity analysis_state follows the queued job'
);
select is(
  (select job_id from public.request_ai_analysis('a2313131-1313-4131-8131-131313131311', 1)),
  (select job_id from pg_temp.job1),
  'duplicate request returns the same job'
);
select is((select count(*) from public.ai_jobs), 1::bigint, 'duplicate request does not create a second row');

select throws_ok(
  $$ select * from public.claim_ai_jobs(1) $$,
  '42501', null, 'authenticated cannot claim worker jobs'
);

-- B cannot see or retry A jobs
reset role;
select pg_temp.set_jwt_subject('b1313131-1313-4131-8131-131313131312');
set local role authenticated;
select is((select count(*) from public.ai_jobs), 0::bigint, 'RLS hides A jobs from B');
select throws_ok(
  format('select * from public.retry_ai_job(%L)', (select job_id from pg_temp.job1)),
  'P0001', 'AI_JOB_UNAVAILABLE', 'B cannot retry A job'
);

-- 5. Claim, input, complete ---------------------------------------------------

reset role;
set local role service_role;

create temporary table pg_temp.claim1 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim1 to public;
select is((select count(*) from pg_temp.claim1), 1::bigint, 'worker claims one queued job');
select ok(
  (select c.id = j.job_id and c.attempt_count = 1 and c.attempt_token is not null
   from pg_temp.claim1 as c, pg_temp.job1 as j),
  'claim increments the attempt and issues a token'
);
reset role;
select ok(
  (select status = 'running'
     and lease_expires_at between now() + interval '110 seconds' and clock_timestamp() + interval '121 seconds'
   from public.ai_jobs where id = (select id from pg_temp.claim1)),
  'claim sets a 120 second lease'
);
set local role service_role;

select is(
  (select count(*) from public.get_ai_job_input((select id from pg_temp.claim1), gen_random_uuid())),
  0::bigint, 'input is withheld for a wrong token'
);
select is(
  (select raw_text from public.get_ai_job_input((select id from pg_temp.claim1), (select attempt_token from pg_temp.claim1))),
  'Led migration of 3 reports; WP-PRIVATE-SENTINEL',
  'input is returned for the current lease'
);
reset role;
select is(
  (select analysis_state from public.activities where id = 'a2313131-1313-4131-8131-131313131311'),
  'running', 'input fetch marks the activity running'
);
set local role service_role;

select is(
  public.complete_ai_job((select id from pg_temp.claim1), gen_random_uuid(), pg_temp.valid_result()),
  'stale', 'completion with a wrong token is stale'
);
select is(
  public.complete_ai_job((select id from pg_temp.claim1), (select attempt_token from pg_temp.claim1),
    '{"schema_version":"x"}'::jsonb),
  'invalid', 'completion with an invalid result is rejected'
);
reset role;
select ok(
  (select status = 'failed' and error_code = 'AI_OUTPUT_INVALID' and result is null
   from public.ai_jobs where id = (select id from pg_temp.claim1)),
  'invalid result fails the job without storing output'
);
select is(
  (select analysis_state from public.activities where id = 'a2313131-1313-4131-8131-131313131311'),
  'failed', 'invalid result marks the activity failed'
);

-- 6. Retry and success --------------------------------------------------------

select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
select is(
  (select status from public.retry_ai_job((select id from pg_temp.claim1))),
  'queued', 'owner retries a failed job'
);
select throws_ok(
  format('select * from public.retry_ai_job(%L)', (select id from pg_temp.claim1)),
  'P0001', 'AI_JOB_NOT_RETRYABLE', 'queued job cannot be retried'
);

reset role;
set local role service_role;
create temporary table pg_temp.claim2 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim2 to public;
select is((select attempt_count from pg_temp.claim2), 2, 'second claim is attempt two');
select is(
  public.complete_ai_job((select id from pg_temp.claim1), (select attempt_token from pg_temp.claim1), pg_temp.valid_result()),
  'stale', 'the superseded attempt token cannot complete the retried job'
);
select is(
  public.complete_ai_job((select id from pg_temp.claim2), (select attempt_token from pg_temp.claim2), pg_temp.valid_result()),
  'succeeded', 'current attempt completes with a valid result'
);
reset role;
select ok(
  (select status = 'succeeded' and result ->> 'schema_version' = 'detect.v1' and error_code is null
     and lease_expires_at is null and finished_at is not null
   from public.ai_jobs where id = (select id from pg_temp.claim2)),
  'succeeded job stores the validated result and clears the lease'
);
select is(
  (select analysis_state from public.activities where id = 'a2313131-1313-4131-8131-131313131311'),
  'done', 'success marks the activity done'
);
set local role service_role;
select is(
  public.fail_ai_job((select id from pg_temp.claim2), (select attempt_token from pg_temp.claim2), 'AI_PROVIDER_UNAVAILABLE'),
  false, 'a finished job cannot be failed by its old token'
);
reset role;

-- 7. Stale input through an edit ---------------------------------------------

select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
create temporary table pg_temp.job2 as
select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131312', 1);
grant select on pg_temp.job2 to public;
reset role;
set local role service_role;
create temporary table pg_temp.claim3 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim3 to public;
select is((select id from pg_temp.claim3), (select job_id from pg_temp.job2), 'worker claims the second activity job');
reset role;

update public.activities set raw_text = 'Second activity edited'
where id = 'a2313131-1313-4131-8131-131313131312';
select ok(
  (select revision = 2 and analysis_state = 'not_requested'
   from public.activities where id = 'a2313131-1313-4131-8131-131313131312'),
  'an input edit bumps the revision and resets analysis_state'
);

update public.activities set analysis_state = 'failed'
where id = 'a2313131-1313-4131-8131-131313131312';
select is(
  (select revision from public.activities where id = 'a2313131-1313-4131-8131-131313131312'),
  2, 'changing only analysis_state keeps the revision'
);
update public.activities set analysis_state = 'not_requested'
where id = 'a2313131-1313-4131-8131-131313131312';

set local role service_role;
select is(
  (select count(*) from public.get_ai_job_input((select id from pg_temp.claim3), (select attempt_token from pg_temp.claim3))),
  0::bigint, 'input is withheld after the source changed'
);
reset role;
select ok(
  (select status = 'failed' and error_code = 'STALE_INPUT' and result is null
   from public.ai_jobs where id = (select id from pg_temp.claim3)),
  'stale source fails the job with STALE_INPUT'
);
select is(
  (select analysis_state from public.activities where id = 'a2313131-1313-4131-8131-131313131312'),
  'not_requested', 'a stale job does not overwrite the newer revision state'
);

select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
select throws_ok(
  format('select * from public.retry_ai_job(%L)', (select id from pg_temp.claim3)),
  'P0001', 'STALE_INPUT', 'retrying a job for an old revision fails with STALE_INPUT'
);
create temporary table pg_temp.job3 as
select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131312', 2);
grant select on pg_temp.job3 to public;
select isnt((select job_id from pg_temp.job3), (select job_id from pg_temp.job2), 'a new revision gets a new job');

-- Stale while running at completion time.
reset role;
set local role service_role;
create temporary table pg_temp.claim4 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim4 to public;
select is(
  (select count(*) from public.get_ai_job_input((select id from pg_temp.claim4), (select attempt_token from pg_temp.claim4))),
  1::bigint, 'input fetched for revision two'
);
reset role;
update public.activities set outcome = 'Changed outcome'
where id = 'a2313131-1313-4131-8131-131313131312';
set local role service_role;
select is(
  public.complete_ai_job((select id from pg_temp.claim4), (select attempt_token from pg_temp.claim4), pg_temp.valid_result()),
  'failed:STALE_INPUT', 'an edit while running prevents the late result from being stored'
);
reset role;
select ok(
  (select result is null from public.ai_jobs where id = (select id from pg_temp.claim4)),
  'stale completion stores no result'
);

-- 8. Consent withdrawn --------------------------------------------------------

select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
create temporary table pg_temp.job5 as
select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131312', 3);
grant select on pg_temp.job5 to public;
reset role;
set local role service_role;
create temporary table pg_temp.claim5 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim5 to public;
select is(
  (select count(*) from public.get_ai_job_input((select id from pg_temp.claim5), (select attempt_token from pg_temp.claim5))),
  1::bigint, 'input fetched while consent is current'
);
reset role;
select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
select lives_ok(
  format('select * from public.set_ai_consent(%s, false)',
    (select revision from public.profiles where id = auth.uid())),
  'owner withdraws consent while a job is running'
);
reset role;
set local role service_role;
select is(
  public.complete_ai_job((select id from pg_temp.claim5), (select attempt_token from pg_temp.claim5), pg_temp.valid_result()),
  'failed:CONSENT_WITHDRAWN', 'withdrawn consent prevents storing the result'
);
reset role;
select ok(
  (select status = 'failed' and error_code = 'CONSENT_WITHDRAWN' and result is null
   from public.ai_jobs where id = (select id from pg_temp.claim5)),
  'consent-withdrawn job has no result'
);

-- Queued job after withdrawal is failed at the input fence.
select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
select lives_ok(
  format('select * from public.set_ai_consent(%s, true)',
    (select revision from public.profiles where id = auth.uid())),
  'owner grants consent again'
);
create temporary table pg_temp.job6 as
select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131313', 1);
grant select on pg_temp.job6 to public;
select lives_ok(
  format('select * from public.set_ai_consent(%s, false)',
    (select revision from public.profiles where id = auth.uid())),
  'owner withdraws consent before the job is claimed'
);
reset role;
set local role service_role;
create temporary table pg_temp.claim6 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim6 to public;
select is(
  (select count(*) from public.get_ai_job_input((select id from pg_temp.claim6), (select attempt_token from pg_temp.claim6))),
  0::bigint, 'no text is released after consent withdrawal'
);
reset role;
select is(
  (select error_code from public.ai_jobs where id = (select id from pg_temp.claim6)),
  'CONSENT_REQUIRED', 'queued job fails with CONSENT_REQUIRED at the input fence'
);

-- 9. Lease expiry and attempt limit ------------------------------------------

select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
select lives_ok(
  format('select * from public.set_ai_consent(%s, true)',
    (select revision from public.profiles where id = auth.uid())),
  'consent restored for lease tests'
);
select is(
  (select status from public.retry_ai_job((select id from pg_temp.claim6))),
  'queued', 'retry after CONSENT_REQUIRED queues attempt two'
);
reset role;
set local role service_role;
create temporary table pg_temp.claim7 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim7 to public;
reset role;
update public.ai_jobs set lease_expires_at = clock_timestamp() - interval '1 second'
where id = (select id from pg_temp.claim7);
set local role service_role;
select is(public.expire_ai_job_leases(), 1, 'expired lease is failed');
reset role;
select ok(
  (select status = 'failed' and error_code = 'AI_TIMEOUT' and lease_expires_at is null
   from public.ai_jobs where id = (select id from pg_temp.claim7)),
  'expired lease becomes AI_TIMEOUT'
);
set local role service_role;
select is(
  public.complete_ai_job((select id from pg_temp.claim7), (select attempt_token from pg_temp.claim7), pg_temp.valid_result()),
  'stale', 'a worker with an expired lease cannot write late'
);
reset role;

select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
select is(
  (select attempt_count from public.retry_ai_job((select id from pg_temp.claim7))),
  2, 'retry after timeout keeps the attempt count'
);
reset role;
set local role service_role;
create temporary table pg_temp.claim8 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim8 to public;
select is((select attempt_count from pg_temp.claim8), 3, 'third claim is attempt three');
select is(
  public.fail_ai_job((select id from pg_temp.claim8), (select attempt_token from pg_temp.claim8), 'AI_PROVIDER_UNAVAILABLE'),
  true, 'current attempt can fail with a code'
);
select throws_ok(
  format('select public.fail_ai_job(%L, %L, %L)', (select id from pg_temp.claim8), gen_random_uuid(), 'bad code'),
  '22023', 'INVALID_AI_JOB_FAILURE', 'error codes must be stable identifiers'
);
reset role;
select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
select throws_ok(
  format('select * from public.retry_ai_job(%L)', (select id from pg_temp.claim8)),
  'P0001', 'AI_RETRY_EXHAUSTED', 'a fourth attempt is refused'
);

-- 10. Account deletion and activity deletion ---------------------------------

create temporary table pg_temp.job9 as
select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131311', 1);
grant select on pg_temp.job9 to public;
select is((select status from pg_temp.job9), 'succeeded', 'request for an analysed revision returns the finished job');

reset role;
insert into public.activities (id, user_id, raw_text, occurred_on, capture_mode)
values ('a2313131-1313-4131-8131-131313131314', 'a1313131-1313-4131-8131-131313131311',
        'Fourth activity for deletion', '2026-09-23', 'note');
select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
create temporary table pg_temp.job10 as
select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131314', 1);
grant select on pg_temp.job10 to public;
reset role;
set local role service_role;
create temporary table pg_temp.claim10 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim10 to public;
reset role;
delete from public.activities where id = 'a2313131-1313-4131-8131-131313131314';
select is(
  (select count(*) from public.ai_jobs where id = (select id from pg_temp.claim10)),
  0::bigint, 'deleting the activity deletes its AI jobs'
);
set local role service_role;
select is(
  public.complete_ai_job((select id from pg_temp.claim10), (select attempt_token from pg_temp.claim10), pg_temp.valid_result()),
  'stale', 'a worker cannot complete a job whose activity was deleted'
);
reset role;

insert into public.activities (id, user_id, raw_text, occurred_on, capture_mode)
values ('a2313131-1313-4131-8131-131313131315', 'a1313131-1313-4131-8131-131313131311',
        'Fifth activity for account deletion', '2026-09-24', 'note');
select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
create temporary table pg_temp.job11 as
select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131315', 1);
grant select on pg_temp.job11 to public;
reset role;
update public.profiles set deleting_at = now() where id = 'a1313131-1313-4131-8131-131313131311';
set local role service_role;
create temporary table pg_temp.claim11 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.claim11 to public;
select is(
  (select count(*) from public.get_ai_job_input((select id from pg_temp.claim11), (select attempt_token from pg_temp.claim11))),
  0::bigint, 'no text is released for a deleting account'
);
reset role;
select is(
  (select error_code from public.ai_jobs where id = (select id from pg_temp.claim11)),
  'ACCOUNT_DELETING', 'deleting account fails the job'
);
select pg_temp.set_jwt_subject('a1313131-1313-4131-8131-131313131311');
set local role authenticated;
select throws_ok(
  $$ select * from public.request_ai_analysis('a2313131-1313-4131-8131-131313131313', 1) $$,
  '42501', 'AUTH_REQUIRED', 'deleting account cannot request analysis'
);
select throws_ok(
  format('select * from public.retry_ai_job(%L)', (select id from pg_temp.claim11)),
  '42501', 'AUTH_REQUIRED', 'deleting account cannot retry'
);
select throws_ok(
  $$ select * from public.set_ai_consent(1, true) $$,
  '42501', 'AUTH_REQUIRED', 'deleting account cannot change consent'
);
reset role;

select * from finish();
rollback;

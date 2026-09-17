begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select ok(
  exists (
    select 1
    from storage.buckets as bucket
    where bucket.id = 'workpulse-private'
      and bucket.name = 'workpulse-private'
      and bucket.public is false
      and bucket.file_size_limit = 52428800
      and bucket.allowed_mime_types = array[
        'application/pdf',
        'image/png',
        'image/jpeg',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ]::text[]
  ),
  'the WorkPulse bucket is private with the agreed size and MIME limits'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
  ),
  'Storage object rows remain protected by row-level security'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'storage.objects', 'SELECT')
  and pg_catalog.has_table_privilege('service_role', 'storage.objects', 'INSERT')
  and pg_catalog.has_table_privilege('service_role', 'storage.objects', 'UPDATE')
  and pg_catalog.has_table_privilege('service_role', 'storage.objects', 'DELETE'),
  'the privileged Storage role retains provider access for server operations'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and (
        policy.policyname ilike '%workpulse-private%'
        or coalesce(policy.qual, '') ilike '%workpulse-private%'
        or coalesce(policy.with_check, '') ilike '%workpulse-private%'
      )
  ),
  0::bigint,
  'no client Storage policy names or references the WorkPulse bucket'
);

select has_table('internal', 'storage_jobs', 'the private cleanup queue exists in the internal schema');
select has_column('internal', 'storage_jobs', 'user_id', 'cleanup receipts retain the owner id');
select has_column('internal', 'storage_jobs', 'attempt_token', 'cleanup claims have an attempt token');
select has_column('internal', 'storage_jobs', 'lease_expires_at', 'cleanup claims have a lease deadline');
select has_column('internal', 'storage_jobs', 'next_attempt_at', 'cleanup jobs have a retry schedule');

select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as namespace on namespace.oid = c.relnamespace
    where namespace.nspname = 'internal'
      and c.relname = 'storage_jobs'
  ),
  'row-level security is enabled on the cleanup queue'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'internal.storage_jobs'::regclass
      and constraint_row.contype = 'f'
  ),
  'the cleanup queue has no profile or parent foreign keys'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'internal.storage_jobs', 'SELECT')
  and not pg_catalog.has_table_privilege('anon', 'internal.storage_jobs', 'INSERT')
  and not pg_catalog.has_table_privilege('authenticated', 'internal.storage_jobs', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'internal.storage_jobs', 'INSERT')
  and not pg_catalog.has_table_privilege('service_role', 'internal.storage_jobs', 'SELECT')
  and not pg_catalog.has_table_privilege('service_role', 'internal.storage_jobs', 'INSERT'),
  'no API role can access the queue table directly'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'internal.enqueue_storage_delete(uuid,text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'internal.enqueue_storage_delete(uuid,text)', 'EXECUTE')
  and pg_catalog.has_function_privilege('service_role', 'internal.enqueue_storage_delete(uuid,text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'internal.claim_storage_jobs(integer)', 'EXECUTE')
  and pg_catalog.has_function_privilege('service_role', 'internal.claim_storage_jobs(integer)', 'EXECUTE'),
  'only the privileged server role can invoke queue transitions'
);

select throws_ok(
  $$
    insert into internal.storage_jobs (user_id, object_key)
    values (
      '11111111-1111-4111-8111-111111111111'::uuid,
      '22222222-2222-4222-8222-222222222222/evidence/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )
  $$,
  '23514',
  null,
  'the row constraint rejects an object key that belongs to another owner'
);

select throws_ok(
  $$
    insert into internal.storage_jobs (user_id, bucket_id, object_key)
    values (
      '11111111-1111-4111-8111-111111111111'::uuid,
      'public',
      '11111111-1111-4111-8111-111111111111/evidence/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )
  $$,
  '23514',
  null,
  'the cleanup queue only accepts the private WorkPulse bucket'
);

select throws_ok(
  $$select * from internal.claim_storage_jobs(0)$$,
  '22023',
  'INVALID_STORAGE_JOB_CLAIM_LIMIT',
  'claim rejects an invalid batch size'
);

create temporary table t05_storage_jobs (
  label text primary key,
  job_id uuid not null,
  first_attempt uuid,
  second_attempt uuid
) on commit drop;

insert into pg_temp.t05_storage_jobs (label, job_id)
values (
  'reclaim',
  internal.enqueue_storage_delete(
    '22222222-2222-4222-8222-222222222222'::uuid,
    '22222222-2222-4222-8222-222222222222/evidence/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  )
);

select is(
  internal.enqueue_storage_delete(
    '22222222-2222-4222-8222-222222222222'::uuid,
    '22222222-2222-4222-8222-222222222222/evidence/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  (select job_id from pg_temp.t05_storage_jobs where label = 'reclaim'),
  'identical cleanup enqueue returns the existing receipt'
);

select is(
  (
    select count(*)
    from internal.storage_jobs
    where object_key = '22222222-2222-4222-8222-222222222222/evidence/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  1::bigint,
  'idempotent enqueue stores one cleanup receipt'
);

update pg_temp.t05_storage_jobs as fixture
set first_attempt = claimed.attempt_token
from internal.claim_storage_jobs(100) as claimed
where claimed.id = fixture.job_id;

select ok(
  (
    select job.status = 'running'
       and job.attempt_count = 1
       and fixture.first_attempt is not null
       and job.attempt_token = fixture.first_attempt
       and job.lease_expires_at > pg_catalog.clock_timestamp()
       and extract(epoch from job.lease_expires_at - job.updated_at) between 119 and 121
    from internal.storage_jobs as job
    join pg_temp.t05_storage_jobs as fixture on fixture.job_id = job.id
    where fixture.label = 'reclaim'
  ),
  'atomic claim starts attempt one with a fresh token and a 120-second lease'
);

update internal.storage_jobs
set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = (select job_id from pg_temp.t05_storage_jobs where label = 'reclaim');

update pg_temp.t05_storage_jobs as fixture
set second_attempt = claimed.attempt_token
from internal.claim_storage_jobs(100) as claimed
where claimed.id = fixture.job_id;

select ok(
  (
    select job.status = 'running'
       and job.attempt_count = 2
       and fixture.second_attempt is not null
       and fixture.second_attempt <> fixture.first_attempt
       and job.attempt_token = fixture.second_attempt
       and job.lease_expires_at > pg_catalog.clock_timestamp()
    from internal.storage_jobs as job
    join pg_temp.t05_storage_jobs as fixture on fixture.job_id = job.id
    where fixture.label = 'reclaim'
  ),
  'an expired lease is reclaimed with an incremented attempt and new token'
);

select is(
  internal.complete_storage_job(
    (select job_id from pg_temp.t05_storage_jobs where label = 'reclaim'),
    (select first_attempt from pg_temp.t05_storage_jobs where label = 'reclaim')
  ),
  false,
  'a worker with the stale lease token cannot complete a reclaimed job'
);

select is(
  internal.fail_storage_job(
    (select job_id from pg_temp.t05_storage_jobs where label = 'reclaim'),
    (select first_attempt from pg_temp.t05_storage_jobs where label = 'reclaim'),
    'STALE_WORKER'
  ),
  false,
  'a worker with the stale lease token cannot fail a reclaimed job'
);

select is(
  internal.complete_storage_job(
    (select job_id from pg_temp.t05_storage_jobs where label = 'reclaim'),
    (select second_attempt from pg_temp.t05_storage_jobs where label = 'reclaim')
  ),
  true,
  'the current lease token can complete the job'
);

select ok(
  (
    select status = 'succeeded'
       and lease_expires_at is null
       and finished_at is not null
       and error_code is null
    from internal.storage_jobs
    where id = (select job_id from pg_temp.t05_storage_jobs where label = 'reclaim')
  ),
  'successful completion records a terminal receipt and clears the lease'
);

select is(
  internal.complete_storage_job(
    (select job_id from pg_temp.t05_storage_jobs where label = 'reclaim'),
    (select second_attempt from pg_temp.t05_storage_jobs where label = 'reclaim')
  ),
  false,
  'a completed job cannot be completed twice'
);

insert into pg_temp.t05_storage_jobs (label, job_id)
values (
  'retry',
  internal.enqueue_storage_delete(
    '22222222-2222-4222-8222-222222222222'::uuid,
    '22222222-2222-4222-8222-222222222222/export/cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  )
);

update pg_temp.t05_storage_jobs as fixture
set first_attempt = claimed.attempt_token
from internal.claim_storage_jobs(100) as claimed
where claimed.id = fixture.job_id
  and fixture.label = 'retry';

select is(
  internal.fail_storage_job(
    (select job_id from pg_temp.t05_storage_jobs where label = 'retry'),
    (select first_attempt from pg_temp.t05_storage_jobs where label = 'retry'),
    'PROVIDER_UNAVAILABLE'
  ),
  true,
  'the current lease token can fail a job with a safe error code'
);

select is(
  internal.retry_storage_job(
    (select job_id from pg_temp.t05_storage_jobs where label = 'retry')
  ),
  true,
  'a failed job can be retried explicitly'
);

select ok(
  (
    select status = 'queued'
       and attempt_count = 1
       and attempt_token is null
       and lease_expires_at is null
       and finished_at is null
       and error_code is null
    from internal.storage_jobs
    where id = (select job_id from pg_temp.t05_storage_jobs where label = 'retry')
  ),
  'explicit retry clears terminal state but preserves the attempt count'
);

select is(
  internal.retry_storage_job(
    (select job_id from pg_temp.t05_storage_jobs where label = 'retry')
  ),
  false,
  'a queued job cannot be retried a second time'
);

select throws_ok(
  $$
    select internal.fail_storage_job(
      (select job_id from pg_temp.t05_storage_jobs where label = 'retry'),
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
      'unsafe error text containing details'
    )
  $$,
  '22023',
  'INVALID_STORAGE_JOB_FAILURE',
  'failure records reject unsafe error strings'
);

insert into pg_temp.t05_storage_jobs (label, job_id)
values (
  'project-receipt',
  internal.enqueue_storage_delete(
    '22222222-2222-4222-8222-222222222222'::uuid,
    '22222222-2222-4222-8222-222222222222/evidence/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  )
);

create or replace function pg_temp.set_jwt_subject(p_user_id uuid, p_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', p_role)::text,
    true
  );
end;
$$;

select pg_temp.set_jwt_subject('22222222-2222-4222-8222-222222222222'::uuid);
set local role authenticated;

select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'workpulse-private'
  ),
  0::bigint,
  'authenticated clients cannot read WorkPulse object metadata without a policy'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'workpulse-private',
      '22222222-2222-4222-8222-222222222222/evidence/ffffffff-ffff-4fff-8fff-ffffffffffff'
    )
  $$,
  '42501',
  null,
  'authenticated clients cannot write directly to private Storage'
);

select throws_ok(
  $$select id from internal.storage_jobs limit 1$$,
  '42501',
  null,
  'authenticated clients cannot read cleanup receipts'
);

select is(
  public.delete_project(
    '55555555-5555-4555-8555-555555555551'::uuid,
    (select revision from public.projects where id = '55555555-5555-4555-8555-555555555551'::uuid)
  ),
  '55555555-5555-4555-8555-555555555551'::uuid,
  'the fixture project can be deleted through its owner revision-checked operation'
);

reset role;

select ok(
  exists (
    select 1
    from internal.storage_jobs
    where id = (select job_id from pg_temp.t05_storage_jobs where label = 'project-receipt')
      and status = 'queued'
      and user_id = '22222222-2222-4222-8222-222222222222'::uuid
  ),
  'the cleanup receipt survives deletion of the parent project'
);

select * from finish();
rollback;

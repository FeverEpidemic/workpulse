begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- 1. Structure and privileges -------------------------------------------------

select has_table('import_batches', 'T15 import_batches table exists');
select has_table('import_items', 'T15 import_items table exists');
select ok(to_regclass('internal.import_jobs') is not null, 'T15 internal.import_jobs queue exists');
select has_column('ai_jobs', 'import_batch_id', 'ai_jobs has import_batch_id');
select col_is_null('ai_jobs', 'activity_id', 'ai_jobs.activity_id is nullable for import jobs');

select ok(
  (select bool_and(relation.relrowsecurity) from pg_catalog.pg_class as relation
   where relation.oid in ('public.import_batches'::regclass, 'public.import_items'::regclass, 'internal.import_jobs'::regclass)),
  'RLS is enabled on import tables'
);

select ok(
  not has_table_privilege('authenticated', 'public.import_batches', 'INSERT')
  and not has_table_privilege('authenticated', 'public.import_batches', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.import_batches', 'DELETE')
  and not has_table_privilege('authenticated', 'public.import_items', 'INSERT')
  and not has_table_privilege('authenticated', 'public.import_items', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.import_items', 'DELETE')
  and not has_table_privilege('service_role', 'public.import_batches', 'INSERT')
  and not has_table_privilege('service_role', 'public.import_items', 'UPDATE')
  and not has_table_privilege('anon', 'public.import_batches', 'SELECT')
  and not has_table_privilege('anon', 'public.import_items', 'SELECT'),
  'no role can write import tables directly; anon cannot read them'
);

select ok(
  not has_column_privilege('authenticated', 'public.import_batches', 'extracted_text', 'SELECT')
  and not has_column_privilege('authenticated', 'public.import_batches', 'file_key', 'SELECT')
  and not has_column_privilege('authenticated', 'public.import_batches', 'idempotency_key', 'SELECT')
  and not has_column_privilege('authenticated', 'public.import_batches', 'payload_hash', 'SELECT')
  and has_column_privilege('authenticated', 'public.import_batches', 'status', 'SELECT')
  and has_column_privilege('authenticated', 'public.import_batches', 'sha256', 'SELECT'),
  'extracted text, object key and idempotency data are not client-readable'
);

select ok(
  not has_table_privilege('authenticated', 'internal.import_jobs', 'SELECT')
  and not has_table_privilege('service_role', 'internal.import_jobs', 'SELECT'),
  'import_jobs is reachable only through functions'
);

select ok(
  has_function_privilege('authenticated', 'public.begin_import_batch(uuid,text,bigint,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_import_batch(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.retry_import_batch(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.begin_import_batch(uuid,text,bigint,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.cancel_import_batch(uuid)', 'EXECUTE'),
  'import user RPCs are executable by authenticated only'
);

select ok(
  has_function_privilege('service_role', 'public.finalize_import_upload(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_import_jobs(integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.complete_import_parse(uuid,uuid,text,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.complete_import_ai_job(uuid,uuid,jsonb,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.purge_expired_import_batches(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_import_upload(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.complete_import_ai_job(uuid,uuid,jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.get_import_ai_job_input(uuid,uuid)', 'EXECUTE'),
  'import worker RPCs are executable by service_role only'
);

select ok(
  (select pg_catalog.bool_and(proc.prosecdef) from pg_catalog.pg_proc as proc
   join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
   where ns.nspname = 'public'
     and proc.proname in (
       'begin_import_batch', 'finalize_import_upload', 'cancel_import_batch', 'retry_import_batch',
       'claim_import_jobs', 'advance_import_job', 'complete_import_parse', 'fail_import_job',
       'get_import_ai_job_input', 'complete_import_ai_job', 'expire_import_uploads',
       'purge_expired_import_batches', 'claim_import_cleanup_jobs', 'complete_import_cleanup_job',
       'retry_import_cleanup_job', 'fail_import_cleanup_job', 'reconcile_orphan_import_objects')),
  'all T15 RPCs are security definer'
);

-- 2. Fixtures -------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e1515151-1515-4151-8151-151515151511', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'import-a@workpulse.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('f1515151-1515-4151-8151-151515151512', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'import-b@workpulse.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

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

create or replace function pg_temp.canonical_count(p_user_id uuid)
returns bigint
language sql
as $$
  select (select count(*) from public.experiences where user_id = p_user_id)
       + (select count(*) from public.education where user_id = p_user_id)
       + (select count(*) from public.certifications where user_id = p_user_id)
       + (select count(*) from public.skills where user_id = p_user_id)
       + (select count(*) from public.projects where user_id = p_user_id)
       + (select count(*) from public.activities where user_id = p_user_id)
       + (select count(*) from public.achievements where user_id = p_user_id)
       + (select revision::bigint from public.profiles where id = p_user_id);
$$;

create or replace function pg_temp.items(p_status text default 'draft')
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('entity_type', 'experience', 'ref', 'exp-1',
      'payload', jsonb_build_object('organization', 'PT Sentinel Nusantara', 'role_title', 'Analis Data', 'kind', 'employment',
        'description', null, 'start_date', '2019-01-01', 'start_precision', 'year', 'end_date', '2022-01-01',
        'end_precision', 'year', 'is_current', false),
      'source_excerpt', 'EXP|PT Sentinel Nusantara|Analis Data|2019|2022', 'validation_errors', '[]'::jsonb),
    jsonb_build_object('entity_type', 'skill',
      'payload', jsonb_build_object('name', 'Statistika'),
      'source_excerpt', 'SKILL|Statistika', 'validation_errors', '[]'::jsonb),
    jsonb_build_object('entity_type', 'achievement',
      'payload', jsonb_build_object('status', p_status, 'title', 'Menurunkan waktu laporan', 'experience_ref', 'exp-1',
        'contribution', null, 'outcome', null, 'achieved_on', null, 'achieved_precision', null, 'cv_bullet', null, 'metrics', '[]'::jsonb),
      'source_excerpt', 'ACH|Menurunkan waktu laporan|PT Sentinel Nusantara',
      'validation_errors', '[{"field":"contribution","code":"REQUIRED"}]'::jsonb)
  );
$$;

create or replace function pg_temp.summary()
returns jsonb
language sql
as $$
  select jsonb_build_object('schema_version', 'import.v1',
    'counts', jsonb_build_object('experience', 1, 'skill', 1, 'achievement', 1), 'dropped_ungrounded', 0);
$$;

-- 3. Begin, consent and idempotency ------------------------------------------------

select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;

select throws_ok(
  $$ select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000001', 'cv.pdf', 1000, 'application/pdf', repeat('a', 64)) $$,
  'P0001', 'CONSENT_REQUIRED', 'upload without current consent is rejected'
);
select is((select count(*) from public.import_batches), 0::bigint, 'no batch exists after a consent rejection');

select lives_ok(
  format('select * from public.set_ai_consent(%s, true)', (select revision from public.profiles where id = auth.uid())),
  'owner A grants AI consent'
);
select is(pg_temp.canonical_count('e1515151-1515-4151-8151-151515151511') > 0, true, 'baseline canonical counter is defined');
create temporary table pg_temp.canon_a as select pg_temp.canonical_count('e1515151-1515-4151-8151-151515151511') as n;
grant select on pg_temp.canon_a to public;

create temporary table pg_temp.b1 as
select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000001', 'cv-WP-FILENAME-SENTINEL.pdf', 1000, 'application/pdf', repeat('a', 64));
grant select on pg_temp.b1 to public;
select ok(
  (select status = 'queued' and stage = 'uploading' and not replayed and duplicate_of_created_at is null
     and file_key = 'e1515151-1515-4151-8151-151515151511/import/' || batch_id::text from pg_temp.b1),
  'begin creates a queued/uploading batch with an owner-scoped object key'
);

select is(
  (select batch_id from public.begin_import_batch('a0000000-0000-4000-8000-000000000001', 'cv-WP-FILENAME-SENTINEL.pdf', 1000, 'application/pdf', repeat('a', 64))),
  (select batch_id from pg_temp.b1), 'replaying the same key and payload returns the same batch'
);
select throws_ok(
  $$ select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000001', 'cv-WP-FILENAME-SENTINEL.pdf', 1000, 'application/pdf', repeat('b', 64)) $$,
  'P0001', 'IDEMPOTENCY_KEY_REUSED', 'the same key with different bytes is rejected'
);
select throws_ok(
  $$ select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000009', 'cv.pdf', 10485761, 'application/pdf', repeat('c', 64)) $$,
  '22023', 'INVALID_IMPORT_UPLOAD', 'more than 10 MiB is rejected'
);
select throws_ok(
  $$ select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000009', 'cv.png', 1000, 'image/png', repeat('c', 64)) $$,
  '22023', 'INVALID_IMPORT_UPLOAD', 'a non PDF/DOCX MIME is rejected'
);
select throws_ok(
  format('select * from public.begin_import_batch(%L, %L, 1000, %L, %L)', 'a0000000-0000-4000-8000-000000000009', E'bad\nname.pdf', 'application/pdf', repeat('c', 64)),
  '22023', 'INVALID_IMPORT_UPLOAD', 'a filename with control characters is rejected'
);

create temporary table pg_temp.b2 as
select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000002', 'cv-again.pdf', 1000, 'application/pdf', repeat('a', 64));
grant select on pg_temp.b2 to public;
select ok(
  (select batch_id <> (select batch_id from pg_temp.b1) and duplicate_of_created_at is not null and duplicate_of_status = 'queued' from pg_temp.b2),
  'same bytes under a new key create a new batch with a duplicate warning'
);

select throws_ok(
  $$ insert into public.import_batches (user_id, idempotency_key, payload_hash, filename, mime_type, bytes, sha256)
     values (auth.uid(), gen_random_uuid(), decode(repeat('00', 32), 'hex'), 'x.pdf', 'application/pdf', 1, repeat('d', 64)) $$,
  '42501', null, 'authenticated cannot insert batches directly'
);
select throws_ok($$ select extracted_text from public.import_batches $$, '42501', null, 'authenticated cannot read extracted_text');

reset role;

-- Account B isolation.
select pg_temp.set_jwt_subject('f1515151-1515-4151-8151-151515151512');
set local role authenticated;
select lives_ok(
  format('select * from public.set_ai_consent(%s, true)', (select revision from public.profiles where id = auth.uid())),
  'owner B grants AI consent'
);
select ok(
  (select duplicate_of_created_at is null from public.begin_import_batch('b0000000-0000-4000-8000-000000000001', 'b.pdf', 1000, 'application/pdf', repeat('a', 64))),
  'another account hash never triggers a duplicate warning'
);
select is(
  (select count(*) from public.import_batches where user_id = 'e1515151-1515-4151-8151-151515151511'), 0::bigint,
  'B cannot see A batches'
);
select throws_ok(
  format('select * from public.cancel_import_batch(%L)', (select batch_id from pg_temp.b1)),
  'P0001', 'IMPORT_NOT_FOUND', 'B cannot cancel A batch'
);
select throws_ok(
  format('select * from public.retry_import_batch(%L)', (select batch_id from pg_temp.b1)),
  'P0001', 'IMPORT_NOT_FOUND', 'B cannot retry A batch'
);
select is(
  (select batch_id from public.begin_import_batch('a0000000-0000-4000-8000-000000000001', 'cv-WP-FILENAME-SENTINEL.pdf', 1000, 'application/pdf', repeat('a', 64)))
    = (select batch_id from pg_temp.b1),
  false, 'B reusing A idempotency key never receives A batch'
);
reset role;

-- 4. Finalize, claim, scan/parse stages -----------------------------------------

set local role service_role;
select ok(
  (select stage = 'screening' and status = 'queued'
   from public.finalize_import_upload('e1515151-1515-4151-8151-151515151511', (select batch_id from pg_temp.b1))),
  'finalize moves the batch to screening'
);
select ok(
  (select stage = 'screening' from public.finalize_import_upload('e1515151-1515-4151-8151-151515151511', (select batch_id from pg_temp.b1))),
  'finalize replay is idempotent'
);
select throws_ok(
  format('select * from public.finalize_import_upload(%L, %L)', 'f1515151-1515-4151-8151-151515151512', (select batch_id from pg_temp.b1)),
  'P0001', 'IMPORT_NOT_FOUND', 'finalize for another owner is rejected'
);
reset role;
select is((select count(*) from internal.import_jobs where batch_id = (select batch_id from pg_temp.b1)), 1::bigint, 'exactly one import job per batch');

set local role service_role;
create temporary table pg_temp.j1 as select * from public.claim_import_jobs(1);
grant select on pg_temp.j1 to public;
reset role;
select ok(
  (select batch_id = (select batch_id from pg_temp.b1) and attempt_count = 1 and attempt_token is not null
     and object_key = 'e1515151-1515-4151-8151-151515151511/import/' || batch_id::text from pg_temp.j1),
  'claim returns the queued job with a fresh token'
);
select is((select status from public.import_batches where id = (select batch_id from pg_temp.b1)), 'running', 'claim marks the batch running');

set local role service_role;
select is(public.advance_import_job((select id from pg_temp.j1), gen_random_uuid()), false, 'advance with a wrong token is stale');
select is(public.advance_import_job((select id from pg_temp.j1), (select attempt_token from pg_temp.j1)), true, 'advance with the lease token succeeds');
select is(
  public.complete_import_parse((select id from pg_temp.j1), gen_random_uuid(), 'x', 1),
  'stale', 'parse completion with a wrong token is stale'
);
select throws_ok(
  format('select public.complete_import_parse(%L, %L, %L, 21)', (select id from pg_temp.j1), (select attempt_token from pg_temp.j1), 'text'),
  '22023', 'INVALID_IMPORT_PARSE', 'more than 20 pages is not accepted as a parse result'
);
select is(
  public.complete_import_parse((select id from pg_temp.j1), (select attempt_token from pg_temp.j1),
    E'EXP|PT Sentinel Nusantara|Analis Data|2019|2022\nSKILL|Statistika\nACH|Menurunkan waktu laporan|PT Sentinel Nusantara', 2),
  'succeeded', 'parse completion stores the text and enqueues extraction'
);
reset role;
select ok(
  (select stage = 'extracting' and page_count = 2 and extracted_text like 'EXP|%' from public.import_batches where id = (select batch_id from pg_temp.b1)),
  'batch is extracting with page_count and text stored'
);
select ok(
  (select count(*) = 1 and bool_and(kind = 'import' and activity_id is null and input_revision = 1
     and idempotency_key = 'import:' || (select batch_id from pg_temp.b1)::text || ':r1')
   from public.ai_jobs where import_batch_id = (select batch_id from pg_temp.b1)),
  'one import AI job targets the batch'
);
select throws_ok(
  format($$ insert into public.ai_jobs (user_id, kind, activity_id, import_batch_id, input_revision, idempotency_key, payload_hash, consent_version)
    values (%L, 'import', null, %L, 1, %L, decode(repeat('00', 32), 'hex'), 'ai-processing-v1') $$,
    'e1515151-1515-4151-8151-151515151511', (select batch_id from pg_temp.b1), 'import:' || (select batch_id from pg_temp.b1)::text || ':r1'),
  '23505', null, 'a second import job for the same batch is rejected'
);

-- 5. AI extraction ---------------------------------------------------------------

set local role service_role;
create temporary table pg_temp.a1 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.a1 to public;
select is((select kind from pg_temp.a1), 'import', 'claim_ai_jobs returns the import job');
select is(
  (select count(*) from public.get_ai_job_input((select id from pg_temp.a1), (select attempt_token from pg_temp.a1))),
  0::bigint, 'the activity input RPC returns nothing for an import job'
);
reset role;
select is((select status from public.ai_jobs where id = (select id from pg_temp.a1)), 'running', 'and does not fail the import job');

set local role service_role;
select ok(
  (select text like 'EXP|PT Sentinel%' from public.get_import_ai_job_input((select id from pg_temp.a1), (select attempt_token from pg_temp.a1))),
  'import input RPC releases only the extracted text'
);
select is(
  public.complete_import_ai_job((select id from pg_temp.a1), (select attempt_token from pg_temp.a1), pg_temp.summary(), pg_temp.items('confirmed')),
  'invalid', 'a confirmed achievement candidate is rejected'
);
reset role;
select ok(
  (select status = 'failed' and error_code = 'AI_OUTPUT_INVALID' and expires_at > now() + interval '22 hours'
   from public.import_batches where id = (select batch_id from pg_temp.b1)),
  'AI failure propagates to the batch with a 23 hour retry window'
);
select is((select count(*) from public.import_items where batch_id = (select batch_id from pg_temp.b1)), 0::bigint, 'invalid output writes no items');

select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
select throws_ok(
  format('select * from public.retry_ai_job(%L)', (select id from pg_temp.a1)),
  'P0001', 'AI_JOB_NOT_APPLICABLE', 'retry_ai_job refuses import jobs'
);
select ok(
  (select status = 'running' and stage = 'extracting' from public.retry_import_batch((select batch_id from pg_temp.b1))),
  'retry resumes the AI stage on the same batch'
);
select ok(
  (select status = 'running' from public.retry_import_batch((select batch_id from pg_temp.b1))),
  'a second retry while running is a no-op'
);
reset role;
select ok(
  (select count(*) = 1 and bool_and(status = 'queued') from public.ai_jobs where import_batch_id = (select batch_id from pg_temp.b1)),
  'retry requeued the same AI job'
);
select is((select retry_count from public.import_batches where id = (select batch_id from pg_temp.b1)), 1, 'retry_count advanced once');

set local role service_role;
create temporary table pg_temp.a2 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.a2 to public;
select is(
  public.complete_import_ai_job((select id from pg_temp.a2), (select attempt_token from pg_temp.a2), pg_temp.summary(), pg_temp.items('draft')),
  'succeeded', 'valid staged candidates complete the job'
);
reset role;
select ok(
  (select status = 'review' and stage = 'done' from public.import_batches where id = (select batch_id from pg_temp.b1)),
  'batch opens review'
);
select is((select count(*) from public.import_items where batch_id = (select batch_id from pg_temp.b1)), 3::bigint, 'three staged items');
select is(
  (select payload ->> 'experience_item_id' from public.import_items
   where batch_id = (select batch_id from pg_temp.b1) and entity_type = 'achievement'),
  (select id::text from public.import_items where batch_id = (select batch_id from pg_temp.b1) and entity_type = 'experience'),
  'achievement experience_ref resolves to the staged experience item'
);
select ok(
  (select not (payload ? 'experience_ref') and payload ->> 'status' = 'draft' and validation_errors = '[{"field":"contribution","code":"REQUIRED"}]'::jsonb
   from public.import_items where batch_id = (select batch_id from pg_temp.b1) and entity_type = 'achievement'),
  'achievement stays a draft candidate with its validation errors'
);
select ok(
  (select result ->> 'schema_version' = 'import.v1' and not (result ? 'items') from public.ai_jobs where id = (select id from pg_temp.a2)),
  'the AI job keeps only a small summary'
);
select is(pg_temp.canonical_count('e1515151-1515-4151-8151-151515151511'), (select n from pg_temp.canon_a), 'extraction wrote no canonical records');

select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
select is((select count(*) from public.import_items), 3::bigint, 'owner can read staged items');
select throws_ok(
  format('select * from public.retry_import_batch(%L)', (select batch_id from pg_temp.b1)),
  'P0001', 'IMPORT_NOT_RETRIABLE', 'a batch in review cannot be retried'
);
select ok((select status = 'cancelled' from public.cancel_import_batch((select batch_id from pg_temp.b1))), 'review batch can be cancelled');
select ok((select status = 'cancelled' from public.cancel_import_batch((select batch_id from pg_temp.b1))), 'cancel is idempotent');
reset role;
select pg_temp.set_jwt_subject('f1515151-1515-4151-8151-151515151512');
set local role authenticated;
select is((select count(*) from public.import_items where batch_id = (select batch_id from pg_temp.b1)), 0::bigint, 'B cannot read A items');
reset role;

-- 6. Purge ------------------------------------------------------------------------

set local role service_role;
select ok(public.purge_expired_import_batches(100) >= 1, 'purge processes the cancelled batch');
reset role;
select ok(
  (select purged_at is not null and extracted_text is null and file_key is null and sha256 = repeat('a', 64) and status = 'cancelled'
   from public.import_batches where id = (select batch_id from pg_temp.b1)),
  'purge clears text and object key while keeping minimal metadata'
);
select is((select count(*) from public.import_items where batch_id = (select batch_id from pg_temp.b1)), 0::bigint, 'purge removes items of a cancelled batch');
select is(
  (select count(*) from internal.storage_jobs where object_key = 'e1515151-1515-4151-8151-151515151511/import/' || (select batch_id from pg_temp.b1)::text),
  1::bigint, 'purge enqueues one object delete receipt'
);
set local role service_role;
select is(
  (select count(*) from public.claim_evidence_cleanup_jobs(100) where object_key like '%/import/%'),
  0::bigint, 'the evidence cleanup claim never takes import objects'
);
create temporary table pg_temp.c1 as select * from public.claim_import_cleanup_jobs(100);
grant select on pg_temp.c1 to public;
select ok(
  (select count(*) >= 1 and bool_and(object_key like '%/import/%') from pg_temp.c1),
  'the import cleanup claim takes import objects only'
);
select is(
  public.complete_import_cleanup_job(
    (select id from pg_temp.c1 where object_key like 'e1515151-1515-4151-8151-151515151511/%' limit 1),
    (select attempt_token from pg_temp.c1 where object_key like 'e1515151-1515-4151-8151-151515151511/%' limit 1)),
  true, 'import cleanup completes with the lease token'
);
reset role;

-- 7. Permanent parse failure and expiry ----------------------------------------------

set local role service_role;
select lives_ok(
  format('select * from public.finalize_import_upload(%L, %L)', 'e1515151-1515-4151-8151-151515151511', (select batch_id from pg_temp.b2)),
  'finalize b2'
);
create temporary table pg_temp.j2 as select * from public.claim_import_jobs(1);
grant select on pg_temp.j2 to public;
select is(public.fail_import_job((select id from pg_temp.j2), (select attempt_token from pg_temp.j2), 'ENCRYPTED_FILE', true, now()), true, 'permanent parse failure is recorded');
reset role;
select ok(
  (select status = 'failed' and error_code = 'ENCRYPTED_FILE' and stage = 'screening' and expires_at <= clock_timestamp()
   from public.import_batches where id = (select batch_id from pg_temp.b2)),
  'a permanent failure is immediately purge-eligible'
);
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
select throws_ok(
  format('select * from public.retry_import_batch(%L)', (select batch_id from pg_temp.b2)),
  'P0001', 'IMPORT_NOT_RETRIABLE', 'a permanent failure cannot be retried'
);
select throws_ok(
  format('select * from public.cancel_import_batch(%L)', (select batch_id from pg_temp.b2)),
  'P0001', 'IMPORT_NOT_CANCELLABLE', 'a failed batch cannot be cancelled'
);

-- 8. Transient scanner failure, retry exhaustion, cancel while queued ----------------

create temporary table pg_temp.b3 as
select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000003', 'cv3.pdf', 2000, 'application/pdf', repeat('c', 64));
grant select on pg_temp.b3 to public;
reset role;
set local role service_role;
select lives_ok(
  format('select * from public.finalize_import_upload(%L, %L)', 'e1515151-1515-4151-8151-151515151511', (select batch_id from pg_temp.b3)),
  'finalize b3'
);
do $$
declare
  v_job record;
begin
  for i in 1..5 loop
    select * into v_job from public.claim_import_jobs(1);
    perform public.fail_import_job(v_job.id, v_job.attempt_token, 'SCANNER_UNAVAILABLE', false, now());
  end loop;
end;
$$;
reset role;
select ok(
  (select status = 'failed' and error_code = 'SCANNER_UNAVAILABLE' and expires_at > now() + interval '22 hours'
   from public.import_batches where id = (select batch_id from pg_temp.b3)),
  'five transient attempts fail the batch with a retriable code'
);
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
select ok(
  (select status = 'queued' and stage = 'screening' and error_code is null from public.retry_import_batch((select batch_id from pg_temp.b3))),
  'retry requeues the scan stage'
);
reset role;
select ok(
  (select status = 'queued' and attempt_count = 0 from internal.import_jobs where batch_id = (select batch_id from pg_temp.b3)),
  'retry resets the scan job attempts'
);
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
select ok((select status = 'cancelled' from public.cancel_import_batch((select batch_id from pg_temp.b3))), 'queued batch can be cancelled');
reset role;
select is(
  (select status from internal.import_jobs where batch_id = (select batch_id from pg_temp.b3)), 'cancelled',
  'cancel closes the queued scan job'
);
set local role service_role;
select is(
  (select count(*) from public.claim_import_jobs(1) where batch_id = (select batch_id from pg_temp.b3)), 0::bigint,
  'a cancelled job is never claimed'
);
reset role;

-- Retry limit and expiry.
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
create temporary table pg_temp.b4 as
select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000004', 'cv4.pdf', 2000, 'application/pdf', repeat('e', 64));
grant select on pg_temp.b4 to public;
reset role;
set local role service_role;
select lives_ok(format('select * from public.finalize_import_upload(%L, %L)', 'e1515151-1515-4151-8151-151515151511', (select batch_id from pg_temp.b4)), 'finalize b4');
create temporary table pg_temp.j4 as select * from public.claim_import_jobs(1);
grant select on pg_temp.j4 to public;
select is(public.fail_import_job((select id from pg_temp.j4), (select attempt_token from pg_temp.j4), 'PAGE_COUNT_UNAVAILABLE', true, now()), true, 'renderer outage recorded');
reset role;
select is((select error_code from public.import_batches where id = (select batch_id from pg_temp.b4)), 'PAGE_COUNT_UNAVAILABLE', 'renderer outage fails the batch');
select ok((select expires_at > now() + interval '22 hours' from public.import_batches where id = (select batch_id from pg_temp.b4)),
  'PAGE_COUNT_UNAVAILABLE is transient even when reported as final by the worker');
update public.import_batches set retry_count = 3 where id = (select batch_id from pg_temp.b4);
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
select throws_ok(
  format('select * from public.retry_import_batch(%L)', (select batch_id from pg_temp.b4)),
  'P0001', 'IMPORT_RETRY_EXHAUSTED', 'retry limit is enforced'
);
reset role;
update public.import_batches set retry_count = 0, expires_at = now() - interval '1 second' where id = (select batch_id from pg_temp.b4);
set local role service_role;
select ok(public.purge_expired_import_batches(100) >= 1, 'purge processes the expired failed batch');
reset role;
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
select throws_ok(
  format('select * from public.retry_import_batch(%L)', (select batch_id from pg_temp.b4)),
  'P0001', 'IMPORT_EXPIRED', 'retry after purge is rejected'
);

-- 9. Consent withdrawal before extraction, cancel during AI --------------------------

create temporary table pg_temp.b5 as
select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000005', 'cv5.pdf', 2000, 'application/pdf', repeat('f', 64));
grant select on pg_temp.b5 to public;
select lives_ok(
  format('select * from public.set_ai_consent(%s, false)', (select revision from public.profiles where id = auth.uid())),
  'owner withdraws consent'
);
reset role;
set local role service_role;
select lives_ok(format('select * from public.finalize_import_upload(%L, %L)', 'e1515151-1515-4151-8151-151515151511', (select batch_id from pg_temp.b5)), 'finalize b5');
create temporary table pg_temp.j5 as select * from public.claim_import_jobs(1);
grant select on pg_temp.j5 to public;
select is(public.advance_import_job((select id from pg_temp.j5), (select attempt_token from pg_temp.j5)), true, 'scan stage done without consent');
select is(
  public.complete_import_parse((select id from pg_temp.j5), (select attempt_token from pg_temp.j5), 'EXP|WP Labs|Data Lead|2021|', 1),
  'failed:CONSENT_REQUIRED', 'parse completion without consent fails before any AI job'
);
reset role;
select ok(
  (select status = 'failed' and error_code = 'CONSENT_REQUIRED' and stage = 'extracting' from public.import_batches where id = (select batch_id from pg_temp.b5)),
  'batch failed with a retriable consent code'
);
select is((select count(*) from public.ai_jobs where import_batch_id = (select batch_id from pg_temp.b5)), 0::bigint, 'no AI job without consent');
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
select throws_ok(
  format('select * from public.retry_import_batch(%L)', (select batch_id from pg_temp.b5)),
  'P0001', 'CONSENT_REQUIRED', 'retry requires consent again'
);
select lives_ok(
  format('select * from public.set_ai_consent(%s, true)', (select revision from public.profiles where id = auth.uid())),
  'owner grants consent again'
);
select ok((select status = 'running' and stage = 'extracting' from public.retry_import_batch((select batch_id from pg_temp.b5))), 'retry after consent creates the AI job');
reset role;
set local role service_role;
create temporary table pg_temp.a5 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.a5 to public;
reset role;
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
select ok((select status = 'cancelled' from public.cancel_import_batch((select batch_id from pg_temp.b5))), 'cancel while the AI job is running');
reset role;
set local role service_role;
select is(
  (select count(*) from public.get_import_ai_job_input((select id from pg_temp.a5), (select attempt_token from pg_temp.a5))),
  0::bigint, 'a cancelled batch releases no text'
);
select is(
  public.complete_import_ai_job((select id from pg_temp.a5), (select attempt_token from pg_temp.a5), pg_temp.summary(), pg_temp.items('draft')),
  'stale', 'late completion after cancel is stale'
);
reset role;
select is((select count(*) from public.import_items where batch_id = (select batch_id from pg_temp.b5)), 0::bigint, 'no items after cancel');
select is((select status from public.import_batches where id = (select batch_id from pg_temp.b5)), 'cancelled', 'batch stays cancelled');

-- 10. Upload expiry, committed purge, AI lease expiry -------------------------------------

select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
create temporary table pg_temp.b6 as
select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000006', 'cv6.pdf', 2000, 'application/pdf', repeat('1', 64));
grant select on pg_temp.b6 to public;
reset role;
set local role service_role;
select ok(public.expire_import_uploads(100, 0) >= 1, 'stuck uploads expire');
reset role;
select ok(
  (select status = 'failed' and error_code = 'UPLOAD_INCOMPLETE' from public.import_batches where id = (select batch_id from pg_temp.b6)),
  'an unfinished upload becomes UPLOAD_INCOMPLETE'
);

-- A committed batch (T16 fixture) keeps mapping metadata after purge.
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
create temporary table pg_temp.b7 as
select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000007', 'cv7.pdf', 2000, 'application/pdf', repeat('2', 64));
grant select on pg_temp.b7 to public;
reset role;
set local role service_role;
select lives_ok(format('select * from public.finalize_import_upload(%L, %L)', 'e1515151-1515-4151-8151-151515151511', (select batch_id from pg_temp.b7)), 'finalize b7');
create temporary table pg_temp.j7 as select * from public.claim_import_jobs(1);
grant select on pg_temp.j7 to public;
select is(public.advance_import_job((select id from pg_temp.j7), (select attempt_token from pg_temp.j7)), true, 'b7 scanned');
select is(public.complete_import_parse((select id from pg_temp.j7), (select attempt_token from pg_temp.j7),
  E'EXP|PT Sentinel Nusantara|Analis Data|2019|2022\nSKILL|Statistika\nACH|Menurunkan waktu laporan|PT Sentinel Nusantara', 1), 'succeeded', 'b7 parsed');
create temporary table pg_temp.a7 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.a7 to public;
select is(public.complete_import_ai_job((select id from pg_temp.a7), (select attempt_token from pg_temp.a7), pg_temp.summary(), pg_temp.items('draft')),
  'succeeded', 'b7 in review');
reset role;
update public.import_batches set status = 'committed', committed_at = now(), expires_at = now() where id = (select batch_id from pg_temp.b7);
update public.import_items set committed_id = gen_random_uuid() where batch_id = (select batch_id from pg_temp.b7) and entity_type = 'skill';
set local role service_role;
select ok(public.purge_expired_import_batches(100) >= 1, 'purge processes the committed batch');
reset role;
select is((select count(*) from public.import_items where batch_id = (select batch_id from pg_temp.b7)), 3::bigint, 'committed items remain after purge');
select ok(
  (select bool_and(payload is null and source_excerpt is null and purged_at is not null and action = 'create') from public.import_items
   where batch_id = (select batch_id from pg_temp.b7)),
  'committed items lose payload and excerpt but keep action'
);
select ok(
  (select committed_id is not null from public.import_items where batch_id = (select batch_id from pg_temp.b7) and entity_type = 'skill'),
  'committed_id survives purge'
);

-- Invalid transitions are rejected by the guard.
select throws_ok(
  format($$ update public.import_batches set status = 'review' where id = %L $$, (select batch_id from pg_temp.b3)),
  '22023', 'INVALID_IMPORT_TRANSITION', 'cancelled -> review is rejected'
);
select throws_ok(
  format($$ update public.import_batches set sha256 = repeat('9', 64) where id = %L $$, (select batch_id from pg_temp.b3)),
  '22023', 'INVALID_IMPORT_BATCH_MUTATION', 'batch identity is immutable'
);

-- AI lease expiry on an import job fails the batch.
select pg_temp.set_jwt_subject('e1515151-1515-4151-8151-151515151511');
set local role authenticated;
create temporary table pg_temp.b8 as
select * from public.begin_import_batch('a0000000-0000-4000-8000-000000000008', 'cv8.pdf', 2000, 'application/pdf', repeat('3', 64));
grant select on pg_temp.b8 to public;
reset role;
set local role service_role;
select lives_ok(format('select * from public.finalize_import_upload(%L, %L)', 'e1515151-1515-4151-8151-151515151511', (select batch_id from pg_temp.b8)), 'finalize b8');
create temporary table pg_temp.j8 as select * from public.claim_import_jobs(1);
grant select on pg_temp.j8 to public;
select is(public.advance_import_job((select id from pg_temp.j8), (select attempt_token from pg_temp.j8)), true, 'b8 scanned');
select is(public.complete_import_parse((select id from pg_temp.j8), (select attempt_token from pg_temp.j8), 'SKILL|Statistika', 1), 'succeeded', 'b8 parsed');
create temporary table pg_temp.a8 as select * from public.claim_ai_jobs(1);
grant select on pg_temp.a8 to public;
reset role;
update public.ai_jobs set lease_expires_at = now() - interval '1 second' where id = (select id from pg_temp.a8);
set local role service_role;
select ok(public.expire_ai_job_leases() >= 1, 'expired import AI leases are failed');
reset role;
select ok(
  (select status = 'failed' and error_code = 'AI_TIMEOUT' from public.import_batches where id = (select batch_id from pg_temp.b8)),
  'AI lease expiry fails the batch with AI_TIMEOUT'
);

-- 11. Deleting account ------------------------------------------------------------------

select internal.mark_account_deleting('f1515151-1515-4151-8151-151515151512',
  (select revision from public.profiles where id = 'f1515151-1515-4151-8151-151515151512'));
select pg_temp.set_jwt_subject('f1515151-1515-4151-8151-151515151512');
set local role authenticated;
select throws_ok(
  $$ select * from public.begin_import_batch('b0000000-0000-4000-8000-000000000002', 'b2.pdf', 1000, 'application/pdf', repeat('4', 64)) $$,
  '42501', 'AUTH_REQUIRED', 'a deleting account cannot start an import'
);
reset role;

select is(pg_temp.canonical_count('e1515151-1515-4151-8151-151515151511'), (select n from pg_temp.canon_a) + 2,
  'only consent profile updates (two more) changed; no canonical career rows were written');

select * from finish();
rollback;

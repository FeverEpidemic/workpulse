begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- T26: import batches read by fixed rules (extraction_mode = 'rules') need no AI consent, never create an
-- ai_jobs row and are never charged against the AI usage limit (decision 0033).

-- 1. Structure and privileges -------------------------------------------------

select has_column('import_batches', 'extraction_mode', 'import_batches has extraction_mode');
select col_not_null('import_batches', 'extraction_mode', 'extraction_mode is not null');
select col_default_is('import_batches', 'extraction_mode', 'ai', 'batches without an explicit mode are ai');
select ok(
  exists (select 1 from information_schema.columns
          where table_schema = 'internal' and table_name = 'import_jobs' and column_name = 'extraction_mode'
            and is_nullable = 'NO' and column_default like '''ai''%'),
  'internal.import_jobs has a not-null extraction_mode defaulting to ai'
);
select ok(
  has_column_privilege('authenticated', 'public.import_batches', 'extraction_mode', 'SELECT'),
  'the owner can read the mode of a batch'
);

select ok(
  to_regprocedure('public.begin_import_batch(uuid,text,bigint,text,text)') is null
  and to_regprocedure('public.complete_import_parse(uuid,uuid,text,integer)') is null,
  'the old begin and parse signatures are dropped'
);
select ok(
  has_function_privilege('authenticated', 'public.begin_import_batch(uuid,text,bigint,text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.begin_import_batch(uuid,text,bigint,text,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.begin_import_batch(uuid,text,bigint,text,text,text)', 'EXECUTE'),
  'begin_import_batch with a mode is executable by authenticated only'
);
select ok(
  has_function_privilege('service_role', 'public.complete_import_parse(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.complete_import_parse(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.complete_import_parse(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_import_jobs(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_import_jobs(integer)', 'EXECUTE'),
  'parse completion and claim stay service_role only'
);
select ok(
  to_regprocedure('internal.stage_import_items(public.import_batches,jsonb,text[])') is not null
  and not has_function_privilege('authenticated', 'internal.stage_import_items(public.import_batches,jsonb,text[])', 'EXECUTE')
  and not has_function_privilege('service_role', 'internal.stage_import_items(public.import_batches,jsonb,text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'internal.stage_import_items(public.import_batches,jsonb,text[])', 'EXECUTE'),
  'the shared staging helper exists and no API role can call it'
);
select ok(
  (select bool_and(proc.prosecdef and proc.proconfig @> array['search_path=pg_catalog'])
   from pg_catalog.pg_proc as proc
   where proc.oid in (
     'public.begin_import_batch(uuid,text,bigint,text,text,text)'::regprocedure,
     'public.complete_import_parse(uuid,uuid,text,integer,jsonb)'::regprocedure,
     'public.claim_import_jobs(integer)'::regprocedure,
     'internal.stage_import_items(public.import_batches,jsonb,text[])'::regprocedure)),
  'new and recreated functions are security definer with a fixed search_path'
);
select ok(
  (select pg_catalog.obj_description('public.begin_import_batch(uuid,text,bigint,text,text,text)'::regprocedure, 'pg_proc') is not null
     and pg_catalog.obj_description('public.complete_import_parse(uuid,uuid,text,integer,jsonb)'::regprocedure, 'pg_proc') is not null
     and pg_catalog.obj_description('public.claim_import_jobs(integer)'::regprocedure, 'pg_proc') is not null),
  'recreated RPCs keep a comment'
);
select ok(internal.is_permanent_import_error('IMPORT_RULES_FAILED'), 'IMPORT_RULES_FAILED is permanent');
select ok(not internal.is_permanent_import_error('SCANNER_UNAVAILABLE'), 'transient codes stay transient');

-- 2. Fixtures -------------------------------------------------------------------
-- A: no consent, free plan (proves rules batches are never charged). C: consent, unlimited plan (AI path).

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e2626262-2626-4262-8262-262626262621', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rules-a@workpulse.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('c2626262-2626-4262-8262-262626262623', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rules-c@workpulse.local', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into internal.ai_plan_assignments (user_id, plan) values ('c2626262-2626-4262-8262-262626262623', 'unlimited');

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

create or replace function pg_temp.rules_items()
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('entity_type', 'profile',
      'payload', jsonb_build_object('display_name', 'Rina Fiktif', 'headline', null, 'summary', null,
        'contact_email', 'rina@contoh.test', 'phone', null, 'location', null, 'website', null),
      'source_excerpt', 'Rina Fiktif', 'validation_errors', '[]'::jsonb),
    jsonb_build_object('entity_type', 'experience', 'ref', 'exp-1',
      'payload', jsonb_build_object('organization', 'PT Contoh Rekaan', 'role_title', 'Analis Data', 'kind', null,
        'description', null, 'start_date', '2019-01-01', 'start_precision', 'year', 'end_date', '2022-01-01',
        'end_precision', 'year', 'is_current', false),
      'source_excerpt', 'Analis Data at PT Contoh Rekaan 2019 - 2022', 'validation_errors', '[]'::jsonb),
    jsonb_build_object('entity_type', 'education',
      'payload', jsonb_build_object('institution', 'Universitas Rekaan', 'qualification', 'S1', 'field_of_study', 'Statistika',
        'start_date', null, 'start_precision', null, 'end_date', '2018-01-01', 'end_precision', 'year'),
      'source_excerpt', 'S1 Statistika, Universitas Rekaan 2018', 'validation_errors', '[]'::jsonb),
    jsonb_build_object('entity_type', 'skill',
      'payload', jsonb_build_object('name', 'SQL'),
      'source_excerpt', 'SQL, Python', 'validation_errors', '[]'::jsonb)
  );
$$;

create or replace function pg_temp.rules_text()
returns text
language sql
as $$
  select E'Rina Fiktif\nrina@contoh.test\nExperience\nAnalis Data at PT Contoh Rekaan 2019 - 2022\nEducation\nS1 Statistika, Universitas Rekaan 2018\nSkills\nSQL, Python';
$$;

-- Claims up to ten jobs and keeps the one for this batch, so leftover jobs of other suites cannot interfere.
create or replace function pg_temp.claim_for(p_batch_id uuid)
returns table (id uuid, attempt_token uuid, extraction_mode text)
language plpgsql
as $$
begin
  return query select job.id, job.attempt_token, job.extraction_mode
  from public.claim_import_jobs(10) as job where job.batch_id = p_batch_id;
end;
$$;

create or replace function pg_temp.usage_units(p_user_id uuid)
returns bigint
language sql
as $$
  select coalesce(sum(units), 0)::bigint from internal.ai_usage where user_id = p_user_id and window_kind = 'day';
$$;

-- 3. Begin: consent only for ai, mode validation, idempotency (acceptance 1, 2) -----

select pg_temp.set_jwt_subject('e2626262-2626-4262-8262-262626262621');
set local role authenticated;

select throws_ok(
  $$ select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000001', 'cv.pdf', 1000, 'application/pdf', repeat('a', 64), 'ai') $$,
  'P0001', 'CONSENT_REQUIRED', 'ai mode without consent is still CONSENT_REQUIRED'
);
select throws_ok(
  $$ select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000001', 'cv.pdf', 1000, 'application/pdf', repeat('a', 64)) $$,
  'P0001', 'CONSENT_REQUIRED', 'a call without a mode is ai and needs consent'
);
select throws_ok(
  $$ select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000001', 'cv.pdf', 1000, 'application/pdf', repeat('a', 64), 'ocr') $$,
  '22023', 'INVALID_IMPORT_UPLOAD', 'an unknown mode is rejected'
);
select throws_ok(
  $$ select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000001', 'cv.pdf', 1000, 'application/pdf', repeat('a', 64), null) $$,
  '22023', 'INVALID_IMPORT_UPLOAD', 'a null mode is rejected'
);

create temporary table pg_temp.r1 as
select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000001', 'cv-WP-RULES-SENTINEL.pdf', 1000, 'application/pdf', repeat('a', 64), 'rules');
grant select on pg_temp.r1 to public;
select ok(
  (select status = 'queued' and stage = 'uploading' and not replayed from pg_temp.r1),
  'rules mode without consent creates a queued batch'
);
select is(
  (select extraction_mode from public.import_batches where id = (select batch_id from pg_temp.r1)), 'rules',
  'the owner reads the stored mode'
);
select ok(
  (select batch_id = (select batch_id from pg_temp.r1) and replayed
   from public.begin_import_batch('a2600000-0000-4000-8000-000000000001', 'cv-WP-RULES-SENTINEL.pdf', 1000, 'application/pdf', repeat('a', 64), 'rules')),
  'replaying the same key, payload and mode returns the same batch'
);
reset role;
select is((select count(*) from public.ai_jobs where user_id = 'e2626262-2626-4262-8262-262626262621'), 0::bigint, 'begin creates no AI job');

-- A free account can start more rules batches than the import day limit (3): none of them is charged.
select pg_temp.set_jwt_subject('e2626262-2626-4262-8262-262626262621');
set local role authenticated;
create temporary table pg_temp.r_more as
select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000002', 'cv2.pdf', 1000, 'application/pdf', repeat('b', 64), 'rules')
union all select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000003', 'cv3.pdf', 1000, 'application/pdf', repeat('c', 64), 'rules')
union all select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000004', 'cv4.pdf', 1000, 'application/pdf', repeat('d', 64), 'rules')
union all select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000005', 'cv5.pdf', 1000, 'application/pdf', repeat('e', 64), 'rules');
grant select on pg_temp.r_more to public;
reset role;
select is((select count(*) from pg_temp.r_more), 4::bigint, 'five rules batches on the free plan in one day are accepted');
select is(pg_temp.usage_units('e2626262-2626-4262-8262-262626262621'), 0::bigint, 'no AI unit is charged for rules batches');

-- C: consent; the same key with another mode is a different payload.
select pg_temp.set_jwt_subject('c2626262-2626-4262-8262-262626262623');
set local role authenticated;
select lives_ok(
  format('select * from public.set_ai_consent(%s, true)', (select revision from public.profiles where id = auth.uid())),
  'owner C grants AI consent'
);
create temporary table pg_temp.c1 as
select * from public.begin_import_batch('c2600000-0000-4000-8000-000000000001', 'c.pdf', 1000, 'application/pdf', repeat('f', 64));
grant select on pg_temp.c1 to public;
select is(
  (select extraction_mode from public.import_batches where id = (select batch_id from pg_temp.c1)), 'ai',
  'a call without a mode stores ai'
);
select throws_ok(
  $$ select * from public.begin_import_batch('c2600000-0000-4000-8000-000000000001', 'c.pdf', 1000, 'application/pdf', repeat('f', 64), 'rules') $$,
  'P0001', 'IDEMPOTENCY_KEY_REUSED', 'the same key and bytes with another mode is IDEMPOTENCY_KEY_REUSED'
);
select ok(
  (select batch_id = (select batch_id from pg_temp.c1) and replayed
   from public.begin_import_batch('c2600000-0000-4000-8000-000000000001', 'c.pdf', 1000, 'application/pdf', repeat('f', 64), 'ai')),
  'an explicit ai replay of a call without a mode returns the same batch'
);
reset role;
select is(pg_temp.usage_units('c2626262-2626-4262-8262-262626262623'), 1::bigint, 'the new ai batch is charged once and its replays are free');

-- Immutability.
select throws_ok(
  format($$ update public.import_batches set extraction_mode = 'ai' where id = %L $$, (select batch_id from pg_temp.r1)),
  '22023', 'INVALID_IMPORT_BATCH_MUTATION', 'extraction_mode cannot change after insert'
);
select throws_ok(
  $$ insert into public.import_batches (user_id, idempotency_key, payload_hash, filename, mime_type, bytes, sha256, extraction_mode)
     values ('e2626262-2626-4262-8262-262626262621', gen_random_uuid(), decode(repeat('00', 32), 'hex'), 'x.pdf', 'application/pdf', 1, repeat('9', 64), 'manual') $$,
  '23514', null, 'the column check rejects an unknown mode'
);

-- 4. Finalize, claim and parse a rules batch (acceptance 3) ---------------------------

set local role service_role;
select lives_ok(
  format('select * from public.finalize_import_upload(%L, %L)', 'e2626262-2626-4262-8262-262626262621', (select batch_id from pg_temp.r1)),
  'finalize the rules batch'
);
reset role;
select is(
  (select extraction_mode from internal.import_jobs where batch_id = (select batch_id from pg_temp.r1)), 'rules',
  'finalize copies the mode to the scan/parse job'
);

set local role service_role;
create temporary table pg_temp.j1 as select * from pg_temp.claim_for((select batch_id from pg_temp.r1));
grant select on pg_temp.j1 to public;
select is((select extraction_mode from pg_temp.j1), 'rules', 'claim returns the job mode');
select is(public.advance_import_job((select id from pg_temp.j1), (select attempt_token from pg_temp.j1)), true, 'the rules batch is scanned');
select throws_ok(
  format('select public.complete_import_parse(%L, %L, %L, 1)', (select id from pg_temp.j1), (select attempt_token from pg_temp.j1), pg_temp.rules_text()),
  '22023', 'INVALID_IMPORT_PARSE', 'a rules batch needs an item array'
);
select throws_ok(
  format('select public.complete_import_parse(%L, %L, %L, 1, %L::jsonb)', (select id from pg_temp.j1), (select attempt_token from pg_temp.j1), pg_temp.rules_text(), '{}'),
  '22023', 'INVALID_IMPORT_PARSE', 'a non-array item value is rejected'
);
select is(
  public.complete_import_parse((select id from pg_temp.j1), (select attempt_token from pg_temp.j1), pg_temp.rules_text(), 1, pg_temp.rules_items()),
  'succeeded', 'rules parse stages items without consent'
);
reset role;
select ok(
  (select status = 'review' and stage = 'done' and page_count = 1 and extracted_text = pg_temp.rules_text() and error_code is null
   from public.import_batches where id = (select batch_id from pg_temp.r1)),
  'the rules batch opens review with its text and page count'
);
select is(
  (select status from internal.import_jobs where batch_id = (select batch_id from pg_temp.r1)), 'succeeded',
  'the scan/parse job succeeded'
);
select is(
  (select array_agg(entity_type order by entity_type) from public.import_items where batch_id = (select batch_id from pg_temp.r1)),
  array['education', 'experience', 'profile', 'skill'], 'four candidates are staged'
);
select ok(
  (select bool_and(action = 'create' and ordinal = 0 and validation_errors = '[]'::jsonb and source_excerpt is not null)
   from public.import_items where batch_id = (select batch_id from pg_temp.r1)),
  'staged rules items look like staged AI items'
);
select is(
  (select payload ->> 'organization' from public.import_items where batch_id = (select batch_id from pg_temp.r1) and entity_type = 'experience'),
  'PT Contoh Rekaan', 'payload fields are kept'
);
select is((select count(*) from public.ai_jobs where import_batch_id = (select batch_id from pg_temp.r1)), 0::bigint, 'no ai_jobs row for a rules batch');
select is(pg_temp.usage_units('e2626262-2626-4262-8262-262626262621'), 0::bigint, 'staging charges nothing');

select pg_temp.set_jwt_subject('e2626262-2626-4262-8262-262626262621');
set local role authenticated;
select is((select count(*) from public.import_items where batch_id = (select batch_id from pg_temp.r1)), 4::bigint, 'owner reads the staged rules items');
reset role;
select pg_temp.set_jwt_subject('c2626262-2626-4262-8262-262626262623');
set local role authenticated;
select is((select count(*) from public.import_batches where id = (select batch_id from pg_temp.r1)), 0::bigint, 'another account cannot see the rules batch');
reset role;

-- 5. Structure rules for rules batches (acceptance 8) ---------------------------------

create or replace function pg_temp.stage_rules(p_batch_id uuid, p_items jsonb)
returns text
language plpgsql
as $$
declare
  v_job record;
begin
  perform public.finalize_import_upload('e2626262-2626-4262-8262-262626262621', p_batch_id);
  select * into v_job from pg_temp.claim_for(p_batch_id);
  perform public.advance_import_job(v_job.id, v_job.attempt_token);
  return public.complete_import_parse(v_job.id, v_job.attempt_token, 'Achievement text', 1, p_items);
end;
$$;

set local role service_role;
select is(
  pg_temp.stage_rules((select batch_id from pg_temp.r_more order by batch_id limit 1 offset 0),
    jsonb_build_array(jsonb_build_object('entity_type', 'achievement',
      'payload', jsonb_build_object('status', 'draft', 'title', 'Achievement'), 'source_excerpt', 'Achievement text'))),
  'failed:IMPORT_RULES_FAILED', 'a rules batch cannot stage an achievement'
);
select is(
  pg_temp.stage_rules((select batch_id from pg_temp.r_more order by batch_id limit 1 offset 1),
    jsonb_build_array(jsonb_build_object('entity_type', 'certification',
      'payload', jsonb_build_object('name', 'Achievement'), 'source_excerpt', 'Achievement text'))),
  'failed:IMPORT_RULES_FAILED', 'a rules batch cannot stage a certification'
);
select is(
  pg_temp.stage_rules((select batch_id from pg_temp.r_more order by batch_id limit 1 offset 2),
    (select jsonb_agg(jsonb_build_object('entity_type', 'skill', 'payload', jsonb_build_object('name', 'S' || n), 'source_excerpt', 'Achievement text'))
     from generate_series(1, 61) as n)),
  'failed:IMPORT_RULES_FAILED', 'more than 60 candidates of one type fail the same way as AI output'
);
reset role;
create temporary table pg_temp.failed_rules as
select id from public.import_batches
where id in (select batch_id from pg_temp.r_more order by batch_id limit 3);
grant select on pg_temp.failed_rules to public;
select ok(
  (select bool_and(batch.status = 'failed' and batch.error_code = 'IMPORT_RULES_FAILED' and batch.expires_at <= clock_timestamp()
     and batch.extracted_text is null)
   from public.import_batches as batch where batch.id in (select id from pg_temp.failed_rules)),
  'invalid rules output fails the batch permanently without keeping the text'
);
select ok(
  (select bool_and(job.status = 'failed' and job.error_code = 'IMPORT_RULES_FAILED')
   from internal.import_jobs as job where job.batch_id in (select id from pg_temp.failed_rules)),
  'the scan/parse job records the same code'
);
select is((select count(*) from public.import_items where batch_id in (select id from pg_temp.failed_rules)), 0::bigint, 'invalid rules output writes no items');
select pg_temp.set_jwt_subject('e2626262-2626-4262-8262-262626262621');
set local role authenticated;
select throws_ok(
  format('select * from public.retry_import_batch(%L)', (select id from pg_temp.failed_rules order by id limit 1)),
  'P0001', 'IMPORT_NOT_RETRIABLE', 'IMPORT_RULES_FAILED offers no retry'
);
reset role;

-- The worker reports an extractor failure through fail_import_job.
set local role service_role;
select lives_ok(
  format('select * from public.finalize_import_upload(%L, %L)', 'e2626262-2626-4262-8262-262626262621',
    (select batch_id from pg_temp.r_more order by batch_id limit 1 offset 3)),
  'finalize the fourth extra batch'
);
create temporary table pg_temp.j4 as select * from pg_temp.claim_for((select batch_id from pg_temp.r_more order by batch_id limit 1 offset 3));
grant select on pg_temp.j4 to public;
select is(public.advance_import_job((select id from pg_temp.j4), (select attempt_token from pg_temp.j4)), true, 'fourth batch scanned');
select is(
  public.fail_import_job((select id from pg_temp.j4), (select attempt_token from pg_temp.j4), 'IMPORT_RULES_FAILED', true, now()),
  true, 'the worker fails an extractor error as final'
);
reset role;
select ok(
  (select status = 'failed' and error_code = 'IMPORT_RULES_FAILED' and expires_at <= clock_timestamp()
   from public.import_batches where id = (select batch_id from pg_temp.r_more order by batch_id limit 1 offset 3)),
  'an extractor failure from the worker is permanent and purge-eligible'
);

-- 6. Cancel while parsing (acceptance 3) ------------------------------------------------

select pg_temp.set_jwt_subject('e2626262-2626-4262-8262-262626262621');
set local role authenticated;
create temporary table pg_temp.r6 as
select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000006', 'cv6.pdf', 1000, 'application/pdf', repeat('6', 64), 'rules');
grant select on pg_temp.r6 to public;
reset role;
set local role service_role;
select lives_ok(format('select * from public.finalize_import_upload(%L, %L)', 'e2626262-2626-4262-8262-262626262621', (select batch_id from pg_temp.r6)), 'finalize r6');
create temporary table pg_temp.j6 as select * from pg_temp.claim_for((select batch_id from pg_temp.r6));
grant select on pg_temp.j6 to public;
select is(public.advance_import_job((select id from pg_temp.j6), (select attempt_token from pg_temp.j6)), true, 'r6 scanned');
reset role;
select pg_temp.set_jwt_subject('e2626262-2626-4262-8262-262626262621');
set local role authenticated;
select ok((select status = 'cancelled' from public.cancel_import_batch((select batch_id from pg_temp.r6))), 'cancel the rules batch while parsing');
reset role;
set local role service_role;
select is(
  public.complete_import_parse((select id from pg_temp.j6), (select attempt_token from pg_temp.j6), pg_temp.rules_text(), 1, pg_temp.rules_items()),
  'stale', 'a late rules completion after cancel is stale'
);
reset role;
select ok(
  (select status = 'cancelled' and extracted_text is null from public.import_batches where id = (select batch_id from pg_temp.r6)),
  'the cancelled batch stays cancelled without text'
);
select is((select count(*) from public.import_items where batch_id = (select batch_id from pg_temp.r6)), 0::bigint, 'no items after cancel');

-- 7. Retry without consent for rules, with consent for ai (acceptance 9) ------------------

select pg_temp.set_jwt_subject('e2626262-2626-4262-8262-262626262621');
set local role authenticated;
create temporary table pg_temp.r7 as
select * from public.begin_import_batch('a2600000-0000-4000-8000-000000000007', 'cv7.pdf', 1000, 'application/pdf', repeat('7', 64), 'rules');
grant select on pg_temp.r7 to public;
reset role;
set local role service_role;
select lives_ok(format('select * from public.finalize_import_upload(%L, %L)', 'e2626262-2626-4262-8262-262626262621', (select batch_id from pg_temp.r7)), 'finalize r7');
create temporary table pg_temp.j7 as select * from pg_temp.claim_for((select batch_id from pg_temp.r7));
grant select on pg_temp.j7 to public;
select is(public.fail_import_job((select id from pg_temp.j7), (select attempt_token from pg_temp.j7), 'PAGE_COUNT_UNAVAILABLE', true, now()), true, 'r7 renderer outage');
reset role;
select pg_temp.set_jwt_subject('e2626262-2626-4262-8262-262626262621');
set local role authenticated;
select ok(
  (select status = 'queued' and stage = 'screening' and error_code is null from public.retry_import_batch((select batch_id from pg_temp.r7))),
  'a transient rules failure is retried without consent'
);
reset role;
select ok(
  (select status = 'queued' and attempt_count = 0 and extraction_mode = 'rules' from internal.import_jobs where batch_id = (select batch_id from pg_temp.r7)),
  'retry resumes the same rules parse job'
);
select is(pg_temp.usage_units('e2626262-2626-4262-8262-262626262621'), 0::bigint, 'a rules retry is not charged');

-- Granting consent later does not change the mode of an existing batch.
select pg_temp.set_jwt_subject('e2626262-2626-4262-8262-262626262621');
set local role authenticated;
select lives_ok(
  format('select * from public.set_ai_consent(%s, true)', (select revision from public.profiles where id = auth.uid())),
  'owner A grants consent after the upload'
);
reset role;
set local role service_role;
create temporary table pg_temp.j7b as select * from pg_temp.claim_for((select batch_id from pg_temp.r7));
grant select on pg_temp.j7b to public;
select is(public.advance_import_job((select id from pg_temp.j7b), (select attempt_token from pg_temp.j7b)), true, 'r7 scanned on retry');
select is(
  public.complete_import_parse((select id from pg_temp.j7b), (select attempt_token from pg_temp.j7b), pg_temp.rules_text(), 1, pg_temp.rules_items()),
  'succeeded', 'the batch is still staged by rules'
);
reset role;
select is((select count(*) from public.ai_jobs where import_batch_id = (select batch_id from pg_temp.r7)), 0::bigint, 'consent given later creates no AI job');

-- C: an ai batch keeps every consent check.
select pg_temp.set_jwt_subject('c2626262-2626-4262-8262-262626262623');
set local role authenticated;
create temporary table pg_temp.c2 as
select * from public.begin_import_batch('c2600000-0000-4000-8000-000000000002', 'c2.pdf', 1000, 'application/pdf', repeat('8', 64), 'ai');
grant select on pg_temp.c2 to public;
reset role;
set local role service_role;
select lives_ok(format('select * from public.finalize_import_upload(%L, %L)', 'c2626262-2626-4262-8262-262626262623', (select batch_id from pg_temp.c2)), 'finalize c2');
create temporary table pg_temp.jc2 as select * from pg_temp.claim_for((select batch_id from pg_temp.c2));
grant select on pg_temp.jc2 to public;
select is((select extraction_mode from pg_temp.jc2), 'ai', 'claim returns ai for an ai batch');
select is(public.fail_import_job((select id from pg_temp.jc2), (select attempt_token from pg_temp.jc2), 'SCANNER_UNAVAILABLE', true, now()), true, 'c2 scanner outage');
reset role;
select pg_temp.set_jwt_subject('c2626262-2626-4262-8262-262626262623');
set local role authenticated;
select lives_ok(
  format('select * from public.set_ai_consent(%s, false)', (select revision from public.profiles where id = auth.uid())),
  'owner C withdraws consent'
);
select throws_ok(
  format('select * from public.retry_import_batch(%L)', (select batch_id from pg_temp.c2)),
  'P0001', 'CONSENT_REQUIRED', 'an ai batch still needs consent to retry'
);
select lives_ok(
  format('select * from public.set_ai_consent(%s, true)', (select revision from public.profiles where id = auth.uid())),
  'owner C grants consent again'
);
select ok((select status = 'queued' from public.retry_import_batch((select batch_id from pg_temp.c2))), 'the ai retry resumes with consent');
reset role;

-- 8. The ai path is unchanged (acceptance 4) ----------------------------------------------

set local role service_role;
create temporary table pg_temp.jc2b as select * from pg_temp.claim_for((select batch_id from pg_temp.c2));
grant select on pg_temp.jc2b to public;
select is(public.advance_import_job((select id from pg_temp.jc2b), (select attempt_token from pg_temp.jc2b)), true, 'c2 scanned');
select throws_ok(
  format('select public.complete_import_parse(%L, %L, %L, 1, %L::jsonb)', (select id from pg_temp.jc2b), (select attempt_token from pg_temp.jc2b), pg_temp.rules_text(), pg_temp.rules_items()),
  '22023', 'INVALID_IMPORT_PARSE', 'an ai batch cannot receive rules items'
);
select is(
  public.complete_import_parse((select id from pg_temp.jc2b), (select attempt_token from pg_temp.jc2b), pg_temp.rules_text(), 1),
  'succeeded', 'an ai parse without items enqueues extraction'
);
reset role;
select ok(
  (select status = 'running' and stage = 'extracting' from public.import_batches where id = (select batch_id from pg_temp.c2)),
  'the ai batch moves to extracting'
);
select is((select count(*) from public.ai_jobs where import_batch_id = (select batch_id from pg_temp.c2)), 1::bigint, 'one AI job for the ai batch');

set local role service_role;
create temporary table pg_temp.ac2 as
select * from public.claim_ai_jobs(10) as job where job.id = (select id from public.ai_jobs where import_batch_id = (select batch_id from pg_temp.c2));
grant select on pg_temp.ac2 to public;
select is(
  public.complete_import_ai_job((select id from pg_temp.ac2), (select attempt_token from pg_temp.ac2),
    jsonb_build_object('schema_version', 'import.v1', 'counts', jsonb_build_object('skill', 1), 'dropped_ungrounded', 0),
    jsonb_build_array(
      jsonb_build_object('entity_type', 'certification', 'payload', jsonb_build_object('name', 'Sertifikat Rekaan'), 'source_excerpt', 'Skills'),
      jsonb_build_object('entity_type', 'skill', 'payload', jsonb_build_object('name', 'SQL'), 'source_excerpt', 'SQL, Python'))),
  'succeeded', 'AI staging through the shared helper still accepts certifications'
);
reset role;
select ok(
  (select status = 'review' and stage = 'done' from public.import_batches where id = (select batch_id from pg_temp.c2)),
  'the ai batch opens review'
);
select is((select count(*) from public.import_items where batch_id = (select batch_id from pg_temp.c2)), 2::bigint, 'two AI items staged');

select * from finish();
rollback;

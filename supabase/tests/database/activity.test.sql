begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('activities', 'activities table exists');
select has_table('chat_messages', 'chat messages table exists');
select has_column('activities', 'raw_text', 'activities retain the original raw text');
select has_column('activities', 'occurred_on', 'activities store exact calendar dates');
select has_column('activities', 'analysis_state', 'activities expose an explicit analysis state');
select has_column('activities', 'revision', 'activities expose an input revision');

select ok(
  (
    select count(*) = 2 and bool_and(relation.relrowsecurity)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname in ('activities', 'chat_messages')
  ),
  'RLS is enabled on Activity and Chat tables'
);

select ok(
  has_table_privilege('authenticated', 'public.activities', 'SELECT')
  and not has_table_privilege('authenticated', 'public.activities', 'INSERT')
  and not has_table_privilege('authenticated', 'public.activities', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.activities', 'DELETE')
  and has_table_privilege('authenticated', 'public.chat_messages', 'SELECT')
  and not has_table_privilege('authenticated', 'public.chat_messages', 'INSERT')
  and not has_table_privilege('authenticated', 'public.chat_messages', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.chat_messages', 'DELETE')
  and not has_table_privilege('anon', 'public.activities', 'SELECT')
  and not has_table_privilege('anon', 'public.chat_messages', 'SELECT'),
  'authenticated users can read own Activity/Chat rows but cannot mutate either table directly'
);

select ok(
  to_regprocedure('public.create_activity_idempotent(uuid,text,date,text,text,text,text,uuid,uuid)') is not null
  and to_regprocedure('public.update_activity(uuid,integer,jsonb)') is not null
  and has_function_privilege('authenticated', 'public.create_activity_idempotent(uuid,text,date,text,text,text,text,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_activity(uuid,integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_activity_idempotent(uuid,text,date,text,text,text,text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.create_activity(uuid,uuid,text,date,text,text,text,text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.update_activity(uuid,uuid,integer,jsonb)', 'EXECUTE'),
  'only the narrow authenticated Activity wrappers are executable'
);

select ok(
  to_regclass('public.ai_jobs') is null
  and (select count(*) = 2 from pg_catalog.pg_indexes
       where schemaname = 'public'
         and indexname in ('activities_user_occurred_on_id_idx', 'activities_user_project_occurred_on_id_idx')),
  'T06 adds the stable Activity indexes without creating AI jobs'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '18888888-8888-4888-8888-888888888881'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'activity-a@workpulse.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '28888888-8888-4888-8888-888888888882'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'activity-b@workpulse.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.experiences (id, user_id, organization, role_title, kind)
values
  ('38888888-8888-4888-8888-888888888881', '18888888-8888-4888-8888-888888888881', 'A Org', 'A Role', 'employment'),
  ('38888888-8888-4888-8888-888888888882', '18888888-8888-4888-8888-888888888881', 'A Org', 'A New Role', 'volunteer'),
  ('38888888-8888-4888-8888-888888888883', '28888888-8888-4888-8888-888888888882', 'B Org', 'B Role', 'internship');

insert into public.projects (id, user_id, experience_id, title, status)
values
  ('48888888-8888-4888-8888-888888888881', '18888888-8888-4888-8888-888888888881', '38888888-8888-4888-8888-888888888881', 'A Project', 'active'),
  ('48888888-8888-4888-8888-888888888882', '28888888-8888-4888-8888-888888888882', '38888888-8888-4888-8888-888888888883', 'B Project', 'planned');

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

select pg_temp.set_jwt_subject('18888888-8888-4888-8888-888888888881'::uuid);
set local role authenticated;

select lives_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888881'::uuid,
      E'  original note\n😀  ',
      '2026-09-17'::date,
      'chat',
      null,
      null,
      null,
      '38888888-8888-4888-8888-888888888881'::uuid,
      '48888888-8888-4888-8888-888888888881'::uuid
    )
  $$,
  'authenticated Chat create succeeds without an owner argument'
);

select is(
  (select raw_text from public.activities where user_id = auth.uid() and capture_mode = 'chat' limit 1),
  E'  original note\n😀  ',
  'raw_text is stored byte-for-byte, including whitespace and Unicode'
);

select is(
  (select revision from public.activities where user_id = auth.uid() and capture_mode = 'chat' limit 1),
  1,
  'a new Activity starts at revision one'
);

select is(
  (select analysis_state from public.activities where user_id = auth.uid() and capture_mode = 'chat' limit 1),
  'not_requested',
  'manual persistence leaves analysis not requested'
);

select is(
  (select count(*) from public.chat_messages where user_id = auth.uid()),
  1::bigint,
  'Chat create writes one first message in the same transaction'
);

select is(
  (select content from public.chat_messages where user_id = auth.uid()),
  E'  original note\n😀  ',
  'the first Chat message exactly matches raw_text'
);

select is(
  (select sequence_no from public.chat_messages where user_id = auth.uid()),
  1,
  'the first Chat message uses sequence one'
);

select is(
  (select count(*) from public.activities where user_id = auth.uid()),
  1::bigint,
  'RLS returns only the authenticated owner Activity'
);

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888882'::uuid,
      '   ',
      '2026-09-17'::date,
      'note',
      null, null, null, null, null
    )
  $$,
  '22023',
  'INVALID_ACTIVITY_INPUT',
  'blank Activity text is rejected in the database'
);

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888883'::uuid,
      pg_catalog.repeat('x', 10001),
      '2026-09-17'::date,
      'note',
      null, null, null, null, null
    )
  $$,
  '22023',
  'INVALID_ACTIVITY_INPUT',
  '10,001 characters are rejected in the database'
);

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888889'::uuid,
      'oversized role',
      '2026-09-17'::date,
      'form',
      pg_catalog.repeat('r', 201), null, null, null, null
    )
  $$,
  '22023',
  'INVALID_ACTIVITY_INPUT',
  'role length is enforced by the database'
);

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888890'::uuid,
      'oversized scope',
      '2026-09-17'::date,
      'form',
      null, pg_catalog.repeat('s', 5001), null, null, null
    )
  $$,
  '22023',
  'INVALID_ACTIVITY_INPUT',
  'scope length is enforced by the database'
);

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888891'::uuid,
      'oversized outcome',
      '2026-09-17'::date,
      'form',
      null, null, pg_catalog.repeat('o', 5001), null, null
    )
  $$,
  '22023',
  'INVALID_ACTIVITY_INPUT',
  'outcome length is enforced by the database'
);

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888892'::uuid,
      'infinite date',
      'infinity'::date,
      'note',
      null, null, null, null, null
    )
  $$,
  '22023',
  'INVALID_ACTIVITY_INPUT',
  'Activity dates must be finite calendar dates'
);

select lives_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888884'::uuid,
      pg_catalog.repeat('😀', 10000),
      '2026-09-17'::date,
      'form',
      null, null, null, null, null
    )
  $$,
  '10,000 Unicode code points are accepted in the database'
);

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888885'::uuid,
      'mismatched project context',
      '2026-09-17'::date,
      'form',
      null, null, null,
      '38888888-8888-4888-8888-888888888882'::uuid,
      '48888888-8888-4888-8888-888888888881'::uuid
    )
  $$,
  '22023',
  'INVALID_ACTIVITY_CONTEXT',
  'project and experience must match exactly'
);

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888886'::uuid,
      'foreign project context',
      '2026-09-17'::date,
      'form',
      null, null, null,
      '38888888-8888-4888-8888-888888888883'::uuid,
      '48888888-8888-4888-8888-888888888882'::uuid
    )
  $$,
  '22023',
  'INVALID_ACTIVITY_CONTEXT',
  'foreign project context is unavailable to the current owner'
);

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888881'::uuid,
      'same key different payload',
      '2026-09-17'::date,
      'note',
      null, null, null, null, null
    )
  $$,
  '22023',
  'IDEMPOTENCY_KEY_REUSED',
  'the idempotency key rejects a different payload'
);

select lives_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888881'::uuid,
      E'  original note\n😀  ',
      '2026-09-17'::date,
      'chat',
      null,
      null,
      null,
      '38888888-8888-4888-8888-888888888881'::uuid,
      '48888888-8888-4888-8888-888888888881'::uuid
    )
  $$,
  'an identical create replay returns its existing receipt'
);

select is(
  (select count(*) from public.activities where user_id = auth.uid()),
  2::bigint,
  'identical create replay does not duplicate Activity rows'
);

select is(
  (select count(*) from public.chat_messages where user_id = auth.uid()),
  1::bigint,
  'identical create replay does not duplicate the first Chat message'
);

select is(
  (
    select revision
    from public.update_activity(
      (select id from public.activities where user_id = auth.uid() and capture_mode = 'chat' limit 1),
      1,
      pg_catalog.jsonb_build_object(
        'raw_text', 'updated note',
        'occurred_on', '2026-09-18',
        'role', null,
        'scope', null,
        'outcome', null,
        'experience_id', '38888888-8888-4888-8888-888888888881',
        'project_id', '48888888-8888-4888-8888-888888888881'
      )
    )
  ),
  2,
  'expected-revision update advances source revision once'
);

select throws_ok(
  $$
    select * from public.update_activity(
      (select id from public.activities where user_id = auth.uid() and capture_mode = 'chat' limit 1),
      1,
      pg_catalog.jsonb_build_object(
        'raw_text', 'stale note',
        'occurred_on', '2026-09-19',
        'role', null,
        'scope', null,
        'outcome', null,
        'experience_id', '38888888-8888-4888-8888-888888888881',
        'project_id', '48888888-8888-4888-8888-888888888881'
      )
    )
  $$,
  'P0001',
  'STALE_REVISION',
  'stale expected revisions fail without replacing input'
);

select is(
  (select content from public.chat_messages where user_id = auth.uid()),
  E'  original note\n😀  ',
  'editing Activity source never rewrites the original Chat message'
);

reset role;

select ok(
  (
    select result_table = 'activities'
      and result_id::text = result_payload ->> 'id'
      and result_payload ?& array['id', 'user_id', 'revision', 'occurred_on', 'capture_mode']
      and result_payload - array['id', 'user_id', 'revision', 'occurred_on', 'capture_mode'] = '{}'::jsonb
      and not (result_payload ?| array['raw_text', 'role', 'scope', 'outcome', 'content'])
    from internal.operation_requests
    where user_id = '18888888-8888-4888-8888-888888888881'::uuid
      and operation_kind = 'activity.create'
      and operation_key = '58888888-8888-4888-8888-888888888881'::uuid
  ),
  'the idempotency ledger contains a minimal receipt without Activity or Chat content'
);

select is(
  (
    select result_payload ->> 'revision'
    from internal.operation_requests
    where user_id = '18888888-8888-4888-8888-888888888881'::uuid
      and operation_kind = 'activity.create'
      and operation_key = '58888888-8888-4888-8888-888888888881'::uuid
  ),
  '1',
  'the original create receipt stays stable after an Activity edit'
);

select is(
  (select count(*) from internal.operation_requests
   where user_id = '18888888-8888-4888-8888-888888888881'::uuid
     and operation_kind = 'activity.create'
       and operation_key in (
       '58888888-8888-4888-8888-888888888882'::uuid,
       '58888888-8888-4888-8888-888888888883'::uuid,
       '58888888-8888-4888-8888-888888888885'::uuid,
       '58888888-8888-4888-8888-888888888886'::uuid,
       '58888888-8888-4888-8888-888888888889'::uuid,
       '58888888-8888-4888-8888-888888888890'::uuid,
       '58888888-8888-4888-8888-888888888891'::uuid,
       '58888888-8888-4888-8888-888888888892'::uuid
     )),
  0::bigint,
  'invalid and conflicting creates leave no operation receipt'
);

select pg_temp.set_jwt_subject('28888888-8888-4888-8888-888888888882'::uuid);
set local role authenticated;

select lives_ok(
  $$
    select * from public.create_activity_idempotent(
      '68888888-8888-4888-8888-888888888881'::uuid,
      'account B private activity',
      '2026-09-17'::date,
      'note',
      null, null, null, null, null
    )
  $$,
  'a second authenticated account can create its own Activity'
);

select is(
  (select count(*) from public.activities),
  1::bigint,
  'a second account cannot read the first account Activity'
);

reset role;

select pg_temp.set_jwt_subject('18888888-8888-4888-8888-888888888881'::uuid);
set local role authenticated;

select is(
  (select count(*) from public.activities),
  2::bigint,
  'the first account cannot read the second account Activity'
);

select throws_ok(
  $$
    insert into public.activities (user_id, raw_text, occurred_on, capture_mode)
    values (auth.uid(), 'direct insert', '2026-09-17', 'note')
  $$,
  '42501',
  null,
  'authenticated direct Activity insert is denied'
);

select throws_ok(
  $$
    update public.activities
    set raw_text = 'direct update'
    where user_id = auth.uid()
  $$,
  '42501',
  null,
  'authenticated direct Activity update is denied'
);

select throws_ok(
  $$
    delete from public.activities
    where user_id = auth.uid()
  $$,
  '42501',
  null,
  'authenticated direct Activity delete is denied'
);

select throws_ok(
  $$
    insert into public.chat_messages (user_id, activity_id, role, content, sequence_no)
    values (
      auth.uid(),
      (select id from public.activities where user_id = auth.uid() limit 1),
      'user',
      'direct insert',
      2
    )
  $$,
  '42501',
  null,
  'authenticated direct Chat insert is denied'
);

select throws_ok(
  $$
    update public.chat_messages
    set content = 'direct update'
    where user_id = auth.uid()
  $$,
  '42501',
  null,
  'authenticated direct Chat update is denied'
);

select throws_ok(
  $$
    delete from public.chat_messages
    where user_id = auth.uid()
  $$,
  '42501',
  null,
  'authenticated direct Chat delete is denied'
);

reset role;

create or replace function internal.t06_test_fail_chat_message()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.content = 't06 atomic rollback marker' then
    raise exception using errcode = 'P0001', message = 'TEST_CHAT_INSERT_ABORT';
  end if;
  return new;
end;
$$;

create trigger t06_test_fail_chat_message
before insert on public.chat_messages
for each row execute function internal.t06_test_fail_chat_message();

select pg_temp.set_jwt_subject('18888888-8888-4888-8888-888888888881'::uuid);
set local role authenticated;

select throws_ok(
  $$
    select * from public.create_activity_idempotent(
      '58888888-8888-4888-8888-888888888888'::uuid,
      't06 atomic rollback marker',
      '2026-09-17'::date,
      'chat',
      null, null, null, null, null
    )
  $$,
  'P0001',
  'TEST_CHAT_INSERT_ABORT',
  'a failure inserting the first Chat message aborts the Activity transaction'
);

reset role;

select is(
  (select count(*) from public.activities where raw_text = 't06 atomic rollback marker'),
  0::bigint,
  'a failed Chat create leaves no Activity row'
);

select is(
  (select count(*) from internal.operation_requests
   where operation_key = '58888888-8888-4888-8888-888888888888'::uuid),
  0::bigint,
  'a failed Chat create leaves no idempotency receipt'
);

drop trigger t06_test_fail_chat_message on public.chat_messages;
drop function internal.t06_test_fail_chat_message();

select pg_temp.set_jwt_subject('18888888-8888-4888-8888-888888888881'::uuid);
set local role authenticated;

select is(
  (
    select revision
    from public.update_project(
      '48888888-8888-4888-8888-888888888881'::uuid,
      1,
      '{"experience_id":"38888888-8888-4888-8888-888888888882"}'::jsonb
    )
  ),
  2,
  'the existing project update RPC can change context with Activity rows present'
);

select ok(
  exists (
    select 1 from public.activities
    where user_id = auth.uid()
      and capture_mode = 'chat'
      and experience_id = '38888888-8888-4888-8888-888888888882'::uuid
      and project_id = '48888888-8888-4888-8888-888888888881'::uuid
      and revision = 3
  ),
  'project context propagation updates the linked Activity and its revision'
);

select is(
  (select deleted_project_id from public.delete_project('48888888-8888-4888-8888-888888888881'::uuid, 2)),
  '48888888-8888-4888-8888-888888888881'::uuid,
  'deleting a project keeps its Activity'
);

select ok(
  exists (
    select 1 from public.activities
    where user_id = auth.uid()
      and capture_mode = 'chat'
      and experience_id = '38888888-8888-4888-8888-888888888882'::uuid
      and project_id is null
      and revision = 4
  ),
  'project deletion clears only the project link and increments Activity revision'
);

select is(
  (select deleted_experience_id from public.delete_experience(
    '38888888-8888-4888-8888-888888888882'::uuid,
    1
  )),
  '38888888-8888-4888-8888-888888888882'::uuid,
  'deleting an experience keeps its Activity'
);

select ok(
  exists (
    select 1 from public.activities
    where user_id = auth.uid()
      and capture_mode = 'chat'
      and experience_id is null
      and project_id is null
      and revision = 5
  ),
  'experience deletion clears Activity context and increments its revision'
);

reset role;
select * from finish();
rollback;

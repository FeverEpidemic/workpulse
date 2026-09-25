begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

-- Structural checks run as the database owner before the test session adopts
-- the authenticated client role.
select has_table('profiles', 'profiles table exists');
select has_table('experiences', 'experiences table exists');
select has_table('education', 'education table exists');
select has_table('certifications', 'certifications table exists');
select has_table('projects', 'projects table exists');
select has_table('skills', 'skills table exists');

select has_column('profiles', 'onboarding_completed_at', 'profile onboarding lifecycle column exists');
select has_column('experiences', 'start_precision', 'experience partial-date precision exists');
select has_column('projects', 'experience_id', 'project experience context exists');
select has_column('skills', 'normalized_name', 'generated normalized skill name exists');

select ok(
  (
    select count(*) = 6
       and bool_and(c.relrowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'profiles',
        'experiences',
        'education',
        'certifications',
        'projects',
        'skills'
      )
  ),
  'RLS is enabled on every foundation table'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'experiences',
        'education',
        'certifications',
        'projects',
        'skills'
      )
      and policyname like '%_own'
  ),
  24::bigint,
  'each foundation table has separate select/insert/update/delete owner policies'
);

select ok(
  internal.is_valid_timezone('CET')
  and internal.is_valid_timezone('Japan')
  and not internal.is_valid_timezone('Mars/Phobos'),
  'timezone validation accepts catalog entries without a slash and rejects unknown names'
);

select ok(
  (
    select count(*) = 5
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname in (
        'experiences_user_start_date_id_idx',
        'education_user_start_date_id_idx',
        'certifications_user_issued_date_id_idx',
        'projects_user_status_updated_at_id_idx',
        'projects_experience_fk_idx'
      )
  ),
  'required date/status/composite-FK indexes exist'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT')
  and not has_table_privilege('anon', 'public.experiences', 'INSERT')
  and not has_table_privilege('anon', 'public.skills', 'DELETE'),
  'anonymous role has no foundation table privileges'
);

select ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT')
  and not has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'profiles are selected directly and mutated only through narrow operations'
);

select ok(
  has_table_privilege('authenticated', 'public.experiences', 'SELECT')
  and not has_table_privilege('authenticated', 'public.experiences', 'INSERT')
  and not has_table_privilege('authenticated', 'public.experiences', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.experiences', 'DELETE'),
  'experience creation, updates, and deletion require typed RPCs'
);

select ok(
  not has_table_privilege('authenticated', 'public.education', 'INSERT')
  and not has_table_privilege('authenticated', 'public.certifications', 'INSERT')
  and not has_table_privilege('authenticated', 'public.skills', 'INSERT')
  and not has_table_privilege('authenticated', 'public.projects', 'INSERT')
  and not has_table_privilege('authenticated', 'public.education', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.education', 'DELETE')
  and not has_table_privilege('authenticated', 'public.certifications', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.certifications', 'DELETE')
  and not has_table_privilege('authenticated', 'public.projects', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.projects', 'DELETE')
  and not has_table_privilege('authenticated', 'public.skills', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.skills', 'DELETE'),
  'foundation updates, deletes, and Project creation remain RPC-only'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'ai_consent_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'deleting_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'onboarding_completed_at', 'UPDATE'),
  'profile content and lifecycle fields cannot be changed by direct column update'
);

select ok(
  to_regprocedure('public.update_profile(integer,jsonb)') is not null
  and to_regprocedure('public.complete_onboarding(text,text,text,integer)') is not null
  and to_regprocedure('public.complete_onboarding(text,integer)') is null
  and to_regprocedure('public.update_experience(uuid,integer,jsonb)') is not null
  and to_regprocedure('public.update_education(uuid,integer,jsonb)') is not null
  and to_regprocedure('public.update_certification(uuid,integer,jsonb)') is not null
  and to_regprocedure('public.update_project(uuid,integer,jsonb)') is not null
  and to_regprocedure('public.update_skill(uuid,integer,jsonb)') is not null
  and to_regprocedure('public.delete_education(uuid,integer)') is not null
  and to_regprocedure('public.delete_certification(uuid,integer)') is not null
  and to_regprocedure('public.delete_project(uuid,integer)') is not null,
  'revision-checked update and delete RPCs exist for foundation tables'
);

select ok(
  not has_function_privilege('authenticated', 'internal.set_ai_consent(uuid,integer,boolean,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'internal.mark_account_deleting(uuid,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'internal.set_ai_consent(uuid,integer,boolean,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'internal.mark_account_deleting(uuid,integer)', 'EXECUTE'),
  'AI consent and account deletion state are restricted to trusted server operations'
);

select ok(
  to_regprocedure('public.delete_experience(uuid,integer)') is not null,
  'delete_experience RPC exists'
);

-- The auth trigger provisions this user without requiring a password or a
-- production login flow. The row is rolled back with the suite.
select lives_ok(
  $$
    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      '77777777-7777-4777-8777-777777777777'::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      'lifecycle-test@workpulse.local',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
  $$,
  'an auth user receives a provisional profile'
);

select is(
  (select display_name from public.profiles where id = '77777777-7777-4777-8777-777777777777'::uuid),
  'Pending onboarding',
  'new auth users receive the neutral provisional display name'
);

select is(
  (select locale from public.profiles where id = '77777777-7777-4777-8777-777777777777'::uuid),
  'en',
  'new auth users default to English locale'
);

select is(
  (select timezone from public.profiles where id = '77777777-7777-4777-8777-777777777777'::uuid),
  'UTC',
  'new auth users default to UTC timezone'
);

select is(
  (select onboarding_completed_at from public.profiles where id = '77777777-7777-4777-8777-777777777777'::uuid),
  null::timestamptz,
  'new auth users are not marked as onboarded'
);

select throws_ok(
  $$
    update public.profiles
    set onboarding_completed_at = now()
    where id = '77777777-7777-4777-8777-777777777777'::uuid
  $$,
  '23514',
  null,
  'the provisional name cannot complete onboarding'
);

-- Local helper: install the JWT claims that PostgREST normally sets. Role
-- changes stay explicit SET LOCAL statements below, following Supabase's RLS
-- testing pattern so the effective SQL role is unambiguous.
create or replace function pg_temp.set_jwt_subject(p_user_id uuid, p_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
  if p_role not in ('authenticated', 'anon') then
    raise exception 'unsupported test role';
  end if;

  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', p_role)::text,
    true
  );
end;
$$;

select pg_temp.set_jwt_subject('11111111-1111-4111-8111-111111111111'::uuid);
set local role authenticated;

select pg_temp.set_jwt_subject('77777777-7777-4777-8777-777777777777'::uuid);

select throws_ok(
  $$
    update public.profiles
    set deleting_at = now()
    where id = '77777777-7777-4777-8777-777777777777'::uuid
  $$,
  '42501',
  null,
  'authenticated clients cannot directly change account deletion state'
);

select throws_ok(
  $$
    select *
    from public.update_profile(
      1,
      '{"ai_consent_at":"2026-09-16T00:00:00Z","deleting_at":"2026-09-16T00:00:00Z","onboarding_completed_at":"2026-09-16T00:00:00Z"}'::jsonb
    )
  $$,
  '22023',
  'INVALID_PATCH',
  'profile content RPC rejects consent, deletion, and onboarding fields'
);

select is(
  (
    select revision
    from public.update_profile(
      1,
      '{"display_name":"Rafi","locale":"id","timezone":"CET"}'::jsonb
    )
  ),
  2,
  'editable profile fields save through an expected-revision RPC'
);

select is(
  (select timezone from public.profiles where id = '77777777-7777-4777-8777-777777777777'::uuid),
  'CET',
  'a catalog timezone name without a slash is accepted'
);

select is(
  (
    select revision
    from public.update_profile(2, '{"timezone":"Japan"}'::jsonb)
  ),
  3,
  'the Japan timezone catalog alias is accepted through the profile RPC'
);

select is(
  (select timezone from public.profiles where id = '77777777-7777-4777-8777-777777777777'::uuid),
  'Japan',
  'the saved timezone remains the selected catalog name'
);

select is(
  (
    select revision
    from public.complete_onboarding('Rafi', 'id', 'Asia/Jakarta', 3)
  ),
  4,
  'onboarding completion is a narrow revision-checked operation'
);

select ok(
  (
    select onboarding_completed_at is not null
       and display_name = 'Rafi'
       and locale = 'id'
       and timezone = 'Asia/Jakarta'
    from public.profiles
    where id = '77777777-7777-4777-8777-777777777777'::uuid
  ),
    'onboarding atomically records the real name, locale, timezone, and completion time'
);

select throws_ok(
  $$
    select *
    from public.complete_onboarding('Rafi', 'fr', 'UTC', 4)
  $$,
  '22023',
  'INVALID_LOCALE',
  'onboarding rejects an unsupported locale'
);

select throws_ok(
  $$
    select *
    from public.complete_onboarding('Rafi', 'id', 'Mars/Phobos', 4)
  $$,
  '22023',
  'INVALID_TIMEZONE',
  'onboarding rejects a timezone missing from the PostgreSQL catalog'
);

select throws_ok(
  $$
    select *
    from public.complete_onboarding('Rafi', 'id', 'Asia/Jakarta', 3)
  $$,
  'P0001',
  'STALE_REVISION',
  'onboarding rejects a stale profile revision'
);

select throws_ok(
  $$
    select *
    from public.update_profile(1, '{"display_name":"Stale profile edit"}'::jsonb)
  $$,
  'P0001',
  'STALE_REVISION',
  'profile RPC rejects a stale expected revision'
);

select pg_temp.set_jwt_subject('11111111-1111-4111-8111-111111111111'::uuid);

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'account A sees only its own profile'
);

select is(
  (select count(*) from public.experiences),
  0::bigint,
  'account A cannot read account B experiences'
);

select throws_ok(
  $$insert into public.experiences (user_id, organization, role_title, kind)
    values (auth.uid(), 'Direct insert', 'Experience', 'employment')$$,
  '42501', null,
  'authenticated direct insert into experiences is denied'
);

select throws_ok(
  $$insert into public.education (user_id, institution, qualification)
    values (auth.uid(), 'Direct insert', 'Degree')$$,
  '42501', null,
  'authenticated direct insert into education is denied'
);

select throws_ok(
  $$insert into public.certifications (user_id, name)
    values (auth.uid(), 'Direct insert')$$,
  '42501', null,
  'authenticated direct insert into certifications is denied'
);

select throws_ok(
  $$insert into public.skills (user_id, name)
    values (auth.uid(), 'Direct insert')$$,
  '42501', null,
  'authenticated direct insert into skills is denied'
);

reset role;

select lives_ok(
  $$
    insert into public.experiences (
      id, user_id, organization, role_title, kind
    )
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      'A Workspace',
      'Builder',
      'volunteer'
    )
  $$,
  'the database owner can prepare an experience fixture without opening client INSERT'
);

set local role authenticated;

select is(
  (select revision from public.experiences where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid),
  1,
  'new mutable rows start at revision 1'
);

select is(
  (
    select revision
    from public.update_experience(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      1,
      '{"role_title":"Builder and mentor"}'::jsonb
    )
  ),
  2,
  'an update with the expected revision succeeds and advances revision once'
);

select is(
  (select revision from public.experiences where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid),
  2,
  'the update trigger ignores payload revision and increments exactly once'
);

select is(
  (select id from public.experiences where role_title = 'Builder and mentor'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'the RPC update remains scoped to the addressed experience ID'
);

select ok(
  (
    select created_at > '2000-01-01 00:00:00+00'::timestamptz
       and updated_at > '2000-01-01 00:00:00+00'::timestamptz
    from public.experiences
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
  ),
  'audit timestamps remain valid after a revision-checked update'
);

select throws_ok(
  $$
    update public.experiences
    set role_title = 'Direct write without expected revision'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
  $$,
  '42501',
  null,
  'authenticated clients cannot update a foundation row directly'
);

select throws_ok(
  $$
    select *
    from public.update_experience(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      1,
      '{"role_title":"Stale write"}'::jsonb
    )
  $$,
  'P0001',
  'STALE_REVISION',
  'the update RPC rejects a stale expected revision'
);

select throws_ok(
  $$
    select *
    from public.update_experience(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      2,
      '{"revision":99,"role_title":"Forged revision"}'::jsonb
    )
  $$,
  '22023',
  'INVALID_PATCH',
  'update RPC patches cannot alter revision or other server-owned fields'
);

reset role;

select lives_ok(
  $$
    insert into public.projects (
      id, user_id, experience_id, title, status
    )
    values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      'A linked project',
      'planned'
    )
  $$,
  'account A can link its project to its own experience'
);

select lives_ok(
  $$
    insert into public.projects (
      id, user_id, title, status
    )
    values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      'Disposable project',
      'planned'
    )
  $$,
  'account A can create a standalone project'
);

set local role authenticated;

select throws_ok(
  $$delete from public.projects where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid$$,
  '42501',
  null,
  'authenticated clients cannot delete a project without expected revision'
);

select is(
  (
    select revision
    from public.update_project(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
      1,
      '{"title":"Disposable project updated"}'::jsonb
    )
  ),
  2,
  'project update succeeds only through the revision-checked RPC'
);

select throws_ok(
  $$select * from public.delete_project('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid, 1)$$,
  'P0001',
  'STALE_REVISION',
  'project deletion rejects a stale expected revision'
);

select is(
  (select deleted_project_id from public.delete_project('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid, 2)),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
  'project deletion succeeds with the current expected revision'
);

reset role;

select lives_ok(
  $$
    insert into public.education (
      id, user_id, institution, qualification
    )
    values (
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      'A University',
      'BSc'
    )
  $$,
  'the database accepts unknown education dates without client INSERT access'
);

select throws_ok(
  $$
    insert into public.skills (user_id, name)
    values ('11111111-1111-4111-8111-111111111111'::uuid, 'typescript')
  $$,
  '23505',
  null,
  'skill duplicates are rejected after case/whitespace normalization'
);

select lives_ok(
  $$
    insert into public.skills (user_id, name)
    values ('11111111-1111-4111-8111-111111111111'::uuid, 'SQL')
  $$,
  'the database accepts a distinct normalized skill without client INSERT access'
);

select is(
  (select normalized_name from public.skills where id = '66666666-6666-4666-8666-666666666661'::uuid),
  'typescript',
  'skill normalization trims, folds whitespace, and lowercases'
);

reset role;
select pg_temp.set_jwt_subject('22222222-2222-4222-8222-222222222222'::uuid);
set local role authenticated;

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'account B sees only its own profile'
);

select is(
  (select count(*) from public.experiences),
  2::bigint,
  'account B sees its two seeded experiences'
);

select is(
  (
    select count(*)
    from public.experiences
    where user_id = '22222222-2222-4222-8222-222222222222'::uuid
      and start_date <= end_date
  ),
  2::bigint,
  'overlapping employment records are accepted'
);

select is(
  (select count(*) from public.experiences where user_id = '11111111-1111-4111-8111-111111111111'::uuid),
  0::bigint,
  'account B cannot read account A experiences'
);

reset role;
select pg_temp.set_jwt_subject(null, 'anon');
set local role anon;

select throws_ok(
  $$select count(*) from public.profiles$$,
  '42501',
  null,
  'anonymous role has no table access'
);

reset role;
select pg_temp.set_jwt_subject('22222222-2222-4222-8222-222222222222'::uuid);
set local role authenticated;

select throws_ok(
  $$
    insert into public.experiences (
      id, user_id, organization, role_title, kind
    )
    values (
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      'Cross tenant',
      'Denied',
      'employment'
    )
  $$,
  '42501',
  null,
  'account B cannot insert a row owned by account A'
);

select is(
  (
    select count(*)
    from public.update_experience(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      1,
      '{"role_title":"Cross tenant update"}'::jsonb
    )
  ),
  0::bigint,
  'account B cannot update account A rows'
);

select is(
  public.delete_skill('66666666-6666-4666-8666-666666666661'::uuid, 1),
  null::uuid,
  'account B cannot delete account A skills'
);

select throws_ok(
  $$
    select * from public.create_project_idempotent(
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid,
      'Cross tenant parent',
      null, null, null, 'planned', null, null, null, null, false,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
    )
  $$,
  '22023',
  'INVALID_PROJECT_INPUT',
  'the Project create RPC rejects a cross-tenant Experience'
);

reset role;

select throws_ok(
  $$
    insert into public.experiences (
      user_id, organization, role_title, kind, start_date, start_precision
    )
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Invalid',
      'Incomplete date',
      'employment',
      '2024-01-01'::date,
      null
    )
  $$,
  '23514',
  null,
  'partial date and precision must be supplied as a pair'
);

select throws_ok(
  $$
    insert into public.experiences (
      user_id, organization, role_title, kind, start_date, start_precision
    )
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Invalid',
      'Noncanonical month',
      'employment',
      '2024-02-15'::date,
      'month'
    )
  $$,
  '23514',
  null,
  'month precision requires day one'
);

select throws_ok(
  $$
    insert into public.experiences (
      user_id, organization, role_title, kind,
      start_date, start_precision, end_date, end_precision
    )
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Invalid',
      'End before start',
      'employment',
      '2024-01-01'::date,
      'day',
      '2023-12-31'::date,
      'day'
    )
  $$,
  '23514',
  null,
  'a definite end-before-start contradiction is rejected'
);

select throws_ok(
  $$
    insert into public.experiences (
      user_id, organization, role_title, kind,
      start_date, start_precision, end_date, end_precision, is_current
    )
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Invalid',
      'Current with end',
      'employment',
      '2024-01-01'::date,
      'day',
      '2024-02-01'::date,
      'day',
      true
    )
  $$,
  '23514',
  null,
  'current experiences cannot have an end date'
);

select throws_ok(
  $$
    insert into public.experiences (
      user_id, organization, role_title, kind
    )
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Invalid',
      'Invalid kind',
      'contractor'
    )
  $$,
  '23514',
  null,
  'experience kind is constrained'
);

select lives_ok(
  $$
    insert into public.certifications (
      user_id, name, issued_date, issued_precision, credential_url
    )
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Database certificate',
      '2024-01-01'::date,
      'year',
      'https://example.test/certificate'
    )
  $$,
  'a canonical issued date and HTTP URL are accepted'
);

select throws_ok(
  $$
    insert into public.certifications (user_id, name, credential_url)
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Unsafe certificate',
      'javascript:alert(1)'
    )
  $$,
  '23514',
  null,
  'certification URLs are limited to HTTP and HTTPS'
);

select throws_ok(
  $$
    insert into public.certifications (
      user_id, name, issued_date, issued_precision
    )
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Invalid issued date',
      '2024-02-15'::date,
      'month'
    )
  $$,
  '23514',
  null,
  'certification issued precision is canonical'
);

select throws_ok(
  $$
    insert into public.projects (
      user_id, title, status, is_current
    )
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Completed current project',
      'completed',
      true
    )
  $$,
  '23514',
  null,
  'completed projects cannot be current'
);

select lives_ok(
  $$
    insert into public.projects (
      user_id, title, status, start_date, start_precision
    )
    values (
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Unknown date project',
      'planned',
      null,
      null
    )
  $$,
  'projects with unknown dates are accepted'
);

select throws_ok(
  $$
    select *
    from public.update_profile(
      (select revision from public.profiles where id = auth.uid()),
      '{"locale":"fr"}'::jsonb
    )
  $$,
  '23514',
  null,
  'profile locale is constrained to English or Indonesian'
);

select throws_ok(
  $$
    select *
    from public.update_profile(
      (select revision from public.profiles where id = auth.uid()),
      '{"timezone":"Mars/Phobos"}'::jsonb
    )
  $$,
  '23514',
  null,
  'unknown timezone names are rejected by the PostgreSQL catalog check'
);

set local role authenticated;

select is(
  (select count(*) from public.delete_experience(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
    2
  )),
  0::bigint,
  'delete_experience does not disclose or mutate another account experience'
);

select is(
  (
    select revision
    from public.update_experience(
      '33333333-3333-4333-8333-333333333331'::uuid,
      1,
      '{"description":"B revision two"}'::jsonb
    )
  ),
  2,
  'account B can update its own experience with the expected revision'
);

select throws_ok(
  $$
    select * from public.delete_experience(
      '33333333-3333-4333-8333-333333333331'::uuid,
      1
    )
  $$,
  'P0001',
  'STALE_REVISION',
  'delete_experience rejects a stale revision'
);

select results_eq(
  $$
    select deleted_experience_id::text, released_project_count::text
    from public.delete_experience(
      '33333333-3333-4333-8333-333333333331'::uuid,
      2
    )
  $$,
  $$
    values (
      '33333333-3333-4333-8333-333333333331',
      '1'
    )
  $$,
  'delete_experience deletes the owned experience and reports released projects'
);

select is(
  (select count(*) from public.experiences where id = '33333333-3333-4333-8333-333333333331'::uuid),
  0::bigint,
  'the deleted experience is gone'
);

select is(
  (select experience_id from public.projects where id = '55555555-5555-4555-8555-555555555551'::uuid),
  null::uuid,
  'the related project is retained with an empty experience context'
);

select is(
  (select revision from public.projects where id = '55555555-5555-4555-8555-555555555551'::uuid),
  2,
  'clearing project context bumps project revision exactly once'
);

reset role;
select pg_temp.set_jwt_subject('11111111-1111-4111-8111-111111111111'::uuid);
set local role authenticated;

select results_eq(
  $$
    select deleted_experience_id::text, released_project_count::text
    from public.delete_experience(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      2
    )
  $$,
  $$
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '1'
    )
  $$,
  'account A can delete its own experience with the expected revision'
);

select is(
  (select count(*) from public.experiences where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid),
  0::bigint,
  'account A experience is deleted atomically'
);

select is(
  (select experience_id from public.projects where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid),
  null::uuid,
  'account A project survives experience deletion with context cleared'
);

select is(
  (select revision from public.projects where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid),
  2,
  'account A project revision records the context change'
);

reset role;
set local role service_role;

select is(
  internal.set_ai_consent(
    '77777777-7777-4777-8777-777777777777'::uuid,
    4,
    true,
    'consent-v1'
  ),
  true,
  'trusted server operation records consent and assigns its timestamp'
);

select ok(
  (
    select ai_consent_at is not null
       and ai_consent_version = 'consent-v1'
       and revision = 5
    from public.profiles
    where id = '77777777-7777-4777-8777-777777777777'::uuid
  ),
  'consent operation changes only lifecycle state and advances profile revision'
);

select is(
  internal.mark_account_deleting(
    '77777777-7777-4777-8777-777777777777'::uuid,
    5
  ),
  true,
  'trusted server operation marks account deletion at the current revision'
);

select ok(
  (
    select deleting_at is not null and revision = 6
    from public.profiles
    where id = '77777777-7777-4777-8777-777777777777'::uuid
  ),
  'account deletion state advances revision and remains outside client patches'
);

reset role;

select ok(
  pg_catalog.to_regclass('internal.operation_requests') is not null
  and (
    select pg_catalog.count(*) = 6
    from information_schema.columns
    where table_schema = 'internal'
      and table_name = 'operation_requests'
      and column_name = any(array[
        'operation_key', 'payload_hash', 'result_table', 'result_id', 'result_payload', 'completed_at'
      ])
  ),
  'the private operation ledger records keys, payload hashes, immutable result snapshots, and completion time'
);

select ok(
  pg_catalog.to_regprocedure('public.create_experience_idempotent(uuid,text,text,text,text,date,text,date,text,boolean)') is not null
  and pg_catalog.to_regprocedure('public.create_education_idempotent(uuid,text,text,text,text,date,text,date,text,boolean)') is not null
  and pg_catalog.to_regprocedure('public.create_certification_idempotent(uuid,text,text,text,date,text)') is not null
  and pg_catalog.to_regprocedure('public.create_skill_idempotent(uuid,text)') is not null,
  'four typed authenticated foundation create RPCs exist without a client owner argument'
);

select ok(
  not has_table_privilege('authenticated', 'internal.operation_requests', 'SELECT')
  and not has_table_privilege('authenticated', 'internal.operation_requests', 'INSERT')
  and not has_function_privilege('authenticated', 'internal.create_foundation_record(uuid,text,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_skill_idempotent(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_skill_idempotent(uuid,text)', 'EXECUTE'),
  'only authenticated callers can invoke public create wrappers, not ledger storage or bypass helpers'
);

select pg_temp.set_jwt_subject(null, 'anon');
set local role anon;

select throws_ok(
  $$select * from public.create_skill_idempotent(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'::uuid,
    'Anonymous skill'
  )$$,
  '42501',
  null,
  'anonymous create is denied before a record can be written'
);

reset role;

select is(
  (
    select count(*)
    from internal.operation_requests
    where operation_key = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'::uuid
  ),
  0::bigint,
  'unauthenticated create leaves no ledger entry'
);

select pg_temp.set_jwt_subject('11111111-1111-4111-8111-111111111111'::uuid);
set local role authenticated;

select lives_ok(
  $$select * from public.create_experience_idempotent(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'::uuid,
    'RPC Experience Organization', 'RPC Experience Role', null, 'employment',
    null, null, null, null, false
  )$$,
  'the authenticated experience create RPC accepts a valid owner record'
);

select lives_ok(
  $$select * from public.create_education_idempotent(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4'::uuid,
    'RPC University', 'Bachelor Degree', null, null,
    null, null, null, null, false
  )$$,
  'the authenticated education create RPC accepts a valid owner record'
);

select lives_ok(
  $$select * from public.create_certification_idempotent(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'::uuid,
    'RPC Certification', 'RPC Issuer', 'https://example.test/certificate', null, null
  )$$,
  'the authenticated certification create RPC accepts a valid owner record'
);

select lives_ok(
  $$select * from public.create_skill_idempotent(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6'::uuid,
    'RPC Skill'
  )$$,
  'the authenticated skill create RPC accepts a valid owner record'
);

select throws_ok(
  $$select * from public.create_experience_idempotent(
    'ffffffff-ffff-4fff-8fff-ffffffffffe1'::uuid,
    pg_catalog.repeat('o', 201), 'Role', null, 'employment', null, null, null, null, false
  )$$,
  '23514', null,
  'database contract rejects oversized experience create values'
);

select throws_ok(
  $$select * from public.create_education_idempotent(
    'ffffffff-ffff-4fff-8fff-ffffffffffe2'::uuid,
    pg_catalog.repeat('i', 201), 'Degree', null, null, null, null, null, null, false
  )$$,
  '23514', null,
  'database contract rejects oversized education create values'
);

select throws_ok(
  $$select * from public.create_certification_idempotent(
    'ffffffff-ffff-4fff-8fff-ffffffffffe3'::uuid,
    pg_catalog.repeat('c', 201), null, null, null, null
  )$$,
  '23514', null,
  'database contract rejects oversized certification create values'
);

select throws_ok(
  $$select * from public.create_skill_idempotent(
    'ffffffff-ffff-4fff-8fff-ffffffffffe4'::uuid,
    pg_catalog.repeat('s', 101)
  )$$,
  '23514', null,
  'database contract rejects oversized skill create values'
);

select throws_ok(
  $$select * from public.create_certification_idempotent(
    'ffffffff-ffff-4fff-8fff-ffffffffffe5'::uuid,
    'Invalid URL Certification', null, 'javascript:alert(1)', null, null
  )$$,
  '23514', null,
  'database contract rejects a non-http certification URL'
);

select throws_ok(
  $$select * from public.update_experience(
    (select id from public.experiences where role_title = 'RPC Experience Role'),
    (select revision from public.experiences where role_title = 'RPC Experience Role'),
    pg_catalog.jsonb_build_object('role_title', pg_catalog.repeat('r', 201))
  )$$,
  '23514', null,
  'database contract rejects oversized experience update values'
);

select throws_ok(
  $$select * from public.update_education(
    (select id from public.education where institution = 'RPC University'),
    (select revision from public.education where institution = 'RPC University'),
    pg_catalog.jsonb_build_object('qualification', pg_catalog.repeat('q', 201))
  )$$,
  '23514', null,
  'database contract rejects oversized education update values'
);

select throws_ok(
  $$select * from public.update_certification(
    (select id from public.certifications where name = 'RPC Certification'),
    (select revision from public.certifications where name = 'RPC Certification'),
    pg_catalog.jsonb_build_object('issuer', pg_catalog.repeat('i', 201))
  )$$,
  '23514', null,
  'database contract rejects oversized certification update values'
);

select throws_ok(
  $$select * from public.update_skill(
    (select id from public.skills where name = 'RPC Skill'),
    (select revision from public.skills where name = 'RPC Skill'),
    pg_catalog.jsonb_build_object('name', pg_catalog.repeat('u', 101))
  )$$,
  '23514', null,
  'database contract rejects oversized skill update values'
);

select throws_ok(
  $$select * from public.update_profile(
    (select revision from public.profiles where id = auth.uid()),
    pg_catalog.jsonb_build_object('headline', pg_catalog.repeat('h', 121))
  )$$,
  '23514', null,
  'database contract rejects oversized profile update values'
);

select is(
  (
    select id::text
    from public.create_skill_idempotent(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid,
      'Idempotency replay skill'
    )
  ),
  (
    select id::text
    from public.create_skill_idempotent(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid,
      'Idempotency replay skill'
    )
  ),
  'same owner, kind, key, and payload returns the same skill id'
);

select is(
  (
    select count(*)
    from public.skills
    where user_id = auth.uid()
      and name = 'Idempotency replay skill'
  ),
  1::bigint,
  'identical replay creates exactly one domain row'
);

select is(
  (
    select revision
    from public.update_skill(
      (
        select id from public.skills
        where user_id = auth.uid() and name = 'Idempotency replay skill'
      ),
      1,
      '{"name":"Updated after create"}'::jsonb
    )
  ),
  2,
  'the created skill can be edited after the create transaction'
);

select is(
  (
    select name || '|' || revision::text
    from public.create_skill_idempotent(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid,
      'Idempotency replay skill'
    )
  ),
  'Idempotency replay skill|1',
  'replay after edit returns the original immutable create snapshot'
);

select lives_ok(
  $$select public.delete_skill(
    (
      select id from public.skills
      where user_id = auth.uid() and name = 'Updated after create'
    ),
    2
  )$$,
  'the created skill can be deleted after its snapshot is stored'
);

select lives_ok(
  $$
    do $test$
    declare
      v_record public.skills;
    begin
      select * into v_record
      from public.create_skill_idempotent(
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid,
        'Idempotency replay skill'
      );
      if v_record.name <> 'Idempotency replay skill' or v_record.revision <> 1 then
        raise exception using errcode = 'P0001', message = 'SNAPSHOT_MISMATCH';
      end if;
      if exists (
        select 1 from public.skills
        where user_id = auth.uid() and id = v_record.id
      ) then
        raise exception using errcode = 'P0001', message = 'DELETED_ROW_RECREATED';
      end if;
    end;
    $test$
  $$,
  'replay after delete returns the create snapshot without recreating the row'
);

select throws_ok(
  $$select * from public.create_skill_idempotent(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid,
    'Different payload skill'
  )$$,
  '22023',
  'IDEMPOTENCY_KEY_REUSED',
  'the same key with a different payload raises a stable error'
);

select is(
  (
    select count(*)
    from public.skills
    where user_id = auth.uid()
      and name in ('Idempotency replay skill', 'Different payload skill', 'Updated after create')
  ),
  0::bigint,
  'the deleted original stays absent and different-payload rejection creates nothing'
);

reset role;

select ok(
  (
    select input_revision = 0
       and result_table = 'skills'
       and result_id is not null
       and (pg_catalog.to_jsonb(operation_requests) -> 'result_payload' ->> 'name') = 'Idempotency replay skill'
       and (pg_catalog.to_jsonb(operation_requests) -> 'result_payload' ->> 'revision') = '1'
       and (pg_catalog.to_jsonb(operation_requests) -> 'result_payload' ->> 'id') = result_id::text
       and (pg_catalog.to_jsonb(operation_requests) -> 'result_payload' ->> 'user_id') = user_id::text
       and pg_catalog.octet_length(payload_hash) = 32
       and created_at is not null
       and completed_at is not null
       and completed_at >= created_at
    from internal.operation_requests
    where user_id = '11111111-1111-4111-8111-111111111111'::uuid
      and operation_kind = 'skill.create'
      and operation_key = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid
  ),
  'the ledger stores revision zero, canonical payload hash, and completed owned result'
);

select pg_temp.set_jwt_subject('11111111-1111-4111-8111-111111111111'::uuid);
set local role authenticated;

select lives_ok(
  $$select * from public.create_skill_idempotent(
    '88888888-8888-4888-8888-888888888888'::uuid,
    'Owner A scoped skill'
  )$$,
  'account A can claim a user-scoped create key'
);

select lives_ok(
  $$select * from public.create_education_idempotent(
    '88888888-8888-4888-8888-888888888888'::uuid,
    'Owner A scoped school',
    'Degree',
    null,
    null,
    null,
    null,
    null,
    null,
    false
  )$$,
  'the same UUID is independent for a different operation kind'
);

reset role;
select pg_temp.set_jwt_subject('22222222-2222-4222-8222-222222222222'::uuid);
set local role authenticated;

select lives_ok(
  $$select * from public.create_skill_idempotent(
    '88888888-8888-4888-8888-888888888888'::uuid,
    'Owner B scoped skill'
  )$$,
  'account B can use the same UUID without colliding with account A'
);

reset role;

select is(
  (
    select count(*)
    from internal.operation_requests
    where operation_key = '88888888-8888-4888-8888-888888888888'::uuid
  ),
  3::bigint,
  'operation-key uniqueness is scoped by both owner and operation kind'
);

select is(
  (
    select count(*)
    from public.skills
    where (user_id, name) in (
      ('11111111-1111-4111-8111-111111111111'::uuid, 'Owner A scoped skill'),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'Owner B scoped skill')
    )
  ),
  2::bigint,
  'same-key creates are isolated to the authenticated owner'
);

select pg_temp.set_jwt_subject('11111111-1111-4111-8111-111111111111'::uuid);
set local role authenticated;

select throws_ok(
  $$select * from public.create_skill_idempotent(
    'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid,
    ''
  )$$,
  '23514',
  null,
  'a failing domain insert rolls back the operation claim'
);

select throws_ok(
  $$select internal.create_foundation_record(
    auth.uid(),
    'skill.create',
    'ffffffff-ffff-4fff-8fff-fffffffffff2'::uuid,
    '{"name":"Bypass"}'::jsonb
  )$$,
  '42501',
  null,
  'authenticated callers cannot invoke the internal create helper'
);

select throws_ok(
  $$select * from internal.operation_requests$$,
  '42501',
  null,
  'authenticated callers cannot read the private operation ledger'
);

reset role;

select is(
  (
    select count(*)
    from internal.operation_requests
    where user_id = '11111111-1111-4111-8111-111111111111'::uuid
      and operation_kind = 'skill.create'
      and operation_key = 'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid
  ),
  0::bigint,
  'failed domain insert leaves no partial ledger record'
);

select is(
  (
    select count(*)
    from internal.operation_requests
    where user_id = '11111111-1111-4111-8111-111111111111'::uuid
      and operation_key = 'ffffffff-ffff-4fff-8fff-fffffffffff2'::uuid
  ),
  0::bigint,
  'a rejected internal helper call creates no ledger entry'
);

select * from finish();

rollback;

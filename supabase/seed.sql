-- Local development/test fixtures only. These auth rows intentionally have no
-- usable password and must never be copied to production.

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
values
  (
    '11111111-1111-4111-8111-111111111111'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'fresh-graduate@workpulse.local',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'employee@workpulse.local',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

-- The auth trigger creates these rows provisionally. Finalizing the fixture
-- models the normal onboarding update and therefore advances profile revision.
update public.profiles
set display_name = 'Alya Pratama',
    locale = 'id',
    timezone = 'Asia/Jakarta',
    contact_email = 'fresh-graduate@workpulse.local',
    onboarding_completed_at = '2026-01-10 00:00:00+00'::timestamptz
where id = '11111111-1111-4111-8111-111111111111'::uuid
  and (
    display_name is distinct from 'Alya Pratama'
    or locale is distinct from 'id'
    or timezone is distinct from 'Asia/Jakarta'
    or contact_email is distinct from 'fresh-graduate@workpulse.local'
    or onboarding_completed_at is distinct from '2026-01-10 00:00:00+00'::timestamptz
  );

update public.profiles
set display_name = 'Bima Santoso',
    locale = 'en',
    timezone = 'UTC',
    contact_email = 'employee@workpulse.local',
    onboarding_completed_at = '2026-01-11 00:00:00+00'::timestamptz
where id = '22222222-2222-4222-8222-222222222222'::uuid
  and (
    display_name is distinct from 'Bima Santoso'
    or locale is distinct from 'en'
    or timezone is distinct from 'UTC'
    or contact_email is distinct from 'employee@workpulse.local'
    or onboarding_completed_at is distinct from '2026-01-11 00:00:00+00'::timestamptz
  );

insert into public.education (
  id,
  user_id,
  institution,
  qualification,
  field_of_study,
  start_date,
  start_precision,
  end_date,
  end_precision,
  is_current
)
values (
  '44444444-4444-4444-8444-444444444441'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid,
  'Universitas Nusantara',
  'Bachelor of Computer Science',
  'Software Engineering',
  null,
  null,
  null,
  null,
  false
)
on conflict (id) do nothing;

insert into public.experiences (
  id,
  user_id,
  organization,
  role_title,
  description,
  kind,
  start_date,
  start_precision,
  end_date,
  end_precision,
  is_current
)
values
  (
    '33333333-3333-4333-8333-333333333331'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    'Karya Digital',
    'Product Analyst',
    'Improved internal reporting workflows.',
    'employment',
    '2021-01-01'::date,
    'month',
    '2023-06-30'::date,
    'day',
    false
  ),
  (
    '33333333-3333-4333-8333-333333333332'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    'Karya Digital',
    'Operations Lead',
    'Led a transition while retaining the analyst role.',
    'employment',
    '2023-01-01'::date,
    'day',
    '2024-02-01'::date,
    'day',
    false
  )
on conflict (id) do nothing;

insert into public.projects (
  id,
  user_id,
  experience_id,
  title,
  description,
  user_role,
  status,
  start_date,
  start_precision,
  is_current
)
values (
  '55555555-5555-4555-8555-555555555551'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  '33333333-3333-4333-8333-333333333331'::uuid,
  'Internal reporting migration',
  'Consolidated recurring operational reporting.',
  'Project owner',
  'active',
  '2023-02-01'::date,
  'day',
  true
)
on conflict (id) do nothing;

insert into public.skills (id, user_id, name)
values
  (
    '66666666-6666-4666-8666-666666666661'::uuid,
    '11111111-1111-4111-8111-111111111111'::uuid,
    'TypeScript'
  ),
  (
    '66666666-6666-4666-8666-666666666662'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    'PostgreSQL'
  )
on conflict (id) do nothing;


-- WorkPulse T02 foundation schema
-- Scope: profile lifecycle, career foundations, tenant ownership, RLS, and revision-safe deletion.

create schema if not exists extensions;

create schema if not exists internal;
comment on schema internal is
  'WorkPulse implementation helpers. This schema is intentionally not exposed through PostgREST.';

revoke all on schema internal from public;
grant usage on schema internal to authenticated, service_role;

create or replace function internal.normalize_skill_name(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select lower(btrim(regexp_replace(p_name, '[[:space:]]+', ' ', 'g')));
$$;

create or replace function internal.is_valid_timezone(p_timezone text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p_timezone is not null
     and p_timezone <> ''
     and p_timezone = btrim(p_timezone)
     and (
       p_timezone in ('UTC', 'GMT')
       or (
         p_timezone like '%/%'
         and exists (
           select 1
           from pg_catalog.pg_timezone_names as zones
           where zones.name = p_timezone
         )
       )
     );
$$;

create or replace function internal.is_real_display_name(p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p_name is not null
     and btrim(p_name) <> ''
     and lower(btrim(p_name)) <> 'pending onboarding';
$$;

create or replace function internal.is_canonical_partial_date(
  p_date date,
  p_precision text
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
begin
  if p_date is null and p_precision is null then
    return true;
  end if;

  if p_date is null or p_precision is null then
    return false;
  end if;

  case p_precision
    when 'year' then
      return extract(month from p_date) = 1
         and extract(day from p_date) = 1;
    when 'month' then
      return extract(day from p_date) = 1;
    when 'day' then
      return true;
    else
      return false;
  end case;
end;
$$;

create or replace function internal.date_upper_bound(
  p_date date,
  p_precision text
)
returns date
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select case p_precision
    when 'year' then make_date(extract(year from p_date)::integer, 12, 31)
    when 'month' then (
      date_trunc('month', p_date::timestamp)
      + interval '1 month'
      - interval '1 day'
    )::date
    when 'day' then p_date
    else null
  end;
$$;

create or replace function internal.is_valid_partial_interval(
  p_start_date date,
  p_start_precision text,
  p_end_date date,
  p_end_precision text,
  p_is_current boolean
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
begin
  if not internal.is_canonical_partial_date(p_start_date, p_start_precision)
     or not internal.is_canonical_partial_date(p_end_date, p_end_precision) then
    return false;
  end if;

  if p_is_current and (p_end_date is not null or p_end_precision is not null) then
    return false;
  end if;

  -- Only reject a contradiction that is certain from the stored precision.
  -- The stored start date is the minimum possible start; date_upper_bound is
  -- the maximum possible end.
  if p_start_date is not null
     and p_end_date is not null
     and internal.date_upper_bound(p_end_date, p_end_precision) < p_start_date then
    return false;
  end if;

  return true;
end;
$$;

create or replace function internal.touch_mutable_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.revision := old.revision + 1;

  -- The RLS WITH CHECK clauses also enforce this boundary. Keeping the
  -- owner immutable in the trigger protects service-side updates as well.
  if tg_table_name <> 'profiles' then
    new.user_id := old.user_id;
  end if;

  return new;
end;
$$;

-- Client-role statements can evaluate these functions from table checks and
-- generated columns. The schema itself is not in PostgREST's exposed schema
-- list; explicit grants keep direct PostgreSQL usage predictable.
grant execute on function internal.normalize_skill_name(text) to authenticated, service_role;
grant execute on function internal.is_valid_timezone(text) to authenticated, service_role;
grant execute on function internal.is_real_display_name(text) to authenticated, service_role;
grant execute on function internal.is_canonical_partial_date(date, text) to authenticated, service_role;
grant execute on function internal.date_upper_bound(date, text) to authenticated, service_role;
grant execute on function internal.is_valid_partial_interval(date, text, date, text, boolean) to authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Pending onboarding',
  headline text,
  summary text,
  contact_email text,
  phone text,
  location text,
  website text,
  locale text not null default 'en',
  timezone text not null default 'UTC',
  ai_consent_at timestamptz,
  ai_consent_version text,
  deleting_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint profiles_display_name_nonblank check (btrim(display_name) <> ''),
  constraint profiles_locale_check check (locale in ('en', 'id')),
  constraint profiles_timezone_check check (internal.is_valid_timezone(timezone)),
  constraint profiles_ai_consent_pair_check check (
    (ai_consent_at is null) = (ai_consent_version is null)
  ),
  constraint profiles_onboarding_name_check check (
    onboarding_completed_at is null
    or internal.is_real_display_name(display_name)
  ),
  constraint profiles_revision_positive check (revision > 0)
);

comment on column public.profiles.display_name is
  'Nonblank display label. The provisional value is not valid for workspace or CV output until onboarding_completed_at is set.';
comment on column public.profiles.onboarding_completed_at is
  'Set only when the user has saved a real display name and completed onboarding.';

create table public.experiences (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization text not null,
  role_title text not null,
  description text,
  kind text not null,
  start_date date,
  start_precision text,
  end_date date,
  end_precision text,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint experiences_user_id_id_key unique (user_id, id),
  constraint experiences_organization_nonblank check (btrim(organization) <> ''),
  constraint experiences_role_title_nonblank check (btrim(role_title) <> ''),
  constraint experiences_kind_check check (kind in ('employment', 'internship', 'volunteer')),
  constraint experiences_date_range_check check (
    internal.is_valid_partial_interval(
      start_date,
      start_precision,
      end_date,
      end_precision,
      is_current
    )
  ),
  constraint experiences_revision_positive check (revision > 0)
);

create table public.education (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  institution text not null,
  qualification text not null,
  field_of_study text,
  description text,
  start_date date,
  start_precision text,
  end_date date,
  end_precision text,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint education_user_id_id_key unique (user_id, id),
  constraint education_institution_nonblank check (btrim(institution) <> ''),
  constraint education_qualification_nonblank check (btrim(qualification) <> ''),
  constraint education_date_range_check check (
    internal.is_valid_partial_interval(
      start_date,
      start_precision,
      end_date,
      end_precision,
      is_current
    )
  ),
  constraint education_revision_positive check (revision > 0)
);

create table public.certifications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  issuer text,
  issued_date date,
  issued_precision text,
  credential_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint certifications_user_id_id_key unique (user_id, id),
  constraint certifications_name_nonblank check (btrim(name) <> ''),
  constraint certifications_issued_date_check check (
    internal.is_canonical_partial_date(issued_date, issued_precision)
  ),
  constraint certifications_credential_url_check check (
    credential_url is null
    or credential_url ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
  ),
  constraint certifications_revision_positive check (revision > 0)
);

create table public.projects (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  experience_id uuid,
  title text not null,
  description text,
  user_role text,
  outcome text,
  status text not null default 'planned',
  start_date date,
  start_precision text,
  end_date date,
  end_precision text,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint projects_user_id_id_key unique (user_id, id),
  constraint projects_experience_fk
    foreign key (user_id, experience_id)
    references public.experiences (user_id, id)
    on delete set null (experience_id),
  constraint projects_title_nonblank check (btrim(title) <> ''),
  constraint projects_status_check check (status in ('planned', 'active', 'completed')),
  constraint projects_completed_not_current_check check (
    status <> 'completed' or not is_current
  ),
  constraint projects_date_range_check check (
    internal.is_valid_partial_interval(
      start_date,
      start_precision,
      end_date,
      end_precision,
      is_current
    )
  ),
  constraint projects_revision_positive check (revision > 0)
);

create table public.skills (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (internal.normalize_skill_name(name)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  constraint skills_user_id_id_key unique (user_id, id),
  constraint skills_name_nonblank check (btrim(name) <> ''),
  constraint skills_normalized_name_nonblank check (normalized_name <> ''),
  constraint skills_user_normalized_name_key unique (user_id, normalized_name),
  constraint skills_revision_positive check (revision > 0)
);

create index experiences_user_start_date_id_idx
  on public.experiences (user_id, start_date desc nulls last, id);

create index education_user_start_date_id_idx
  on public.education (user_id, start_date desc nulls last, id);

create index certifications_user_issued_date_id_idx
  on public.certifications (user_id, issued_date desc nulls last, id);

create index projects_user_status_updated_at_id_idx
  on public.projects (user_id, status, updated_at desc, id);

create index projects_experience_fk_idx
  on public.projects (user_id, experience_id, id);

create or replace function internal.clear_experience_context_before_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.projects
  set experience_id = null
  where user_id = old.user_id
    and experience_id = old.id;

  return old;
end;
$$;

create trigger profiles_touch_mutable_row
before update on public.profiles
for each row execute function internal.touch_mutable_row();

create trigger experiences_touch_mutable_row
before update on public.experiences
for each row execute function internal.touch_mutable_row();

create trigger education_touch_mutable_row
before update on public.education
for each row execute function internal.touch_mutable_row();

create trigger certifications_touch_mutable_row
before update on public.certifications
for each row execute function internal.touch_mutable_row();

create trigger projects_touch_mutable_row
before update on public.projects
for each row execute function internal.touch_mutable_row();

create trigger skills_touch_mutable_row
before update on public.skills
for each row execute function internal.touch_mutable_row();

create trigger experiences_clear_project_context
before delete on public.experiences
for each row execute function internal.clear_experience_context_before_delete();

create or replace function internal.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created_workpulse_profile
after insert on auth.users
for each row execute function internal.handle_auth_user_created();

-- This is intentionally idempotent. It repairs auth users created before the
-- trigger/migration without changing an existing profile's user-authored data.
insert into public.profiles (id)
select users.id
from auth.users as users
on conflict (id) do nothing;

create or replace function public.delete_experience(
  p_experience_id uuid,
  p_expected_revision integer
)
returns table (
  deleted_experience_id uuid,
  released_project_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_revision integer;
  v_released_project_count integer;
begin
  -- A missing/foreign ID produces no row, so the function does not disclose
  -- whether another account owns the requested experience.
  if v_user_id is null
     or p_experience_id is null
     or p_expected_revision is null
     or p_expected_revision < 1 then
    return;
  end if;

  select experiences.revision
  into v_current_revision
  from public.experiences
  where experiences.id = p_experience_id
    and experiences.user_id = v_user_id
  for update;

  if not found then
    return;
  end if;

  if v_current_revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'STALE_REVISION';
  end if;

  -- Lock all related projects in deterministic ID order before changing any
  -- rows. The explicit owner predicate is required because this function is
  -- SECURITY DEFINER and therefore does not rely on caller RLS implicitly.
  with locked_projects as (
    select projects.id
    from public.projects
    where projects.user_id = v_user_id
      and projects.experience_id = p_experience_id
    order by projects.id
    for update
  )
  select count(*)::integer
  into v_released_project_count
  from locked_projects;

  update public.projects
  set experience_id = null
  where projects.user_id = v_user_id
    and projects.experience_id = p_experience_id;

  delete from public.experiences
  where experiences.id = p_experience_id
    and experiences.user_id = v_user_id
    and experiences.revision = p_expected_revision;

  if not found then
    return;
  end if;

  return query
  select p_experience_id, v_released_project_count;
end;
$$;

-- The API schema list intentionally contains public/graphql_public only, so
-- internal helpers are not PostgREST endpoints. Explicit table/function grants
-- below keep the client surface limited to this foundation contract.
alter table public.profiles enable row level security;
alter table public.experiences enable row level security;
alter table public.education enable row level security;
alter table public.certifications enable row level security;
alter table public.projects enable row level security;
alter table public.skills enable row level security;

create policy profiles_select_own
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy profiles_insert_own
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

create policy profiles_update_own
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy profiles_delete_own
on public.profiles for delete to authenticated
using ((select auth.uid()) = id);

create policy experiences_select_own
on public.experiences for select to authenticated
using ((select auth.uid()) = user_id);

create policy experiences_insert_own
on public.experiences for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy experiences_update_own
on public.experiences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy experiences_delete_own
on public.experiences for delete to authenticated
using ((select auth.uid()) = user_id);

create policy education_select_own
on public.education for select to authenticated
using ((select auth.uid()) = user_id);

create policy education_insert_own
on public.education for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy education_update_own
on public.education for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy education_delete_own
on public.education for delete to authenticated
using ((select auth.uid()) = user_id);

create policy certifications_select_own
on public.certifications for select to authenticated
using ((select auth.uid()) = user_id);

create policy certifications_insert_own
on public.certifications for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy certifications_update_own
on public.certifications for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy certifications_delete_own
on public.certifications for delete to authenticated
using ((select auth.uid()) = user_id);

create policy projects_select_own
on public.projects for select to authenticated
using ((select auth.uid()) = user_id);

create policy projects_insert_own
on public.projects for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy projects_update_own
on public.projects for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy projects_delete_own
on public.projects for delete to authenticated
using ((select auth.uid()) = user_id);

create policy skills_select_own
on public.skills for select to authenticated
using ((select auth.uid()) = user_id);

create policy skills_insert_own
on public.skills for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy skills_update_own
on public.skills for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy skills_delete_own
on public.skills for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table
  public.profiles,
  public.experiences,
  public.education,
  public.certifications,
  public.projects,
  public.skills
from public, anon, authenticated, service_role;

-- Profiles are provisioned by the auth trigger and account deletion is owned
-- by T23. Experience deletion must use the revision-checked RPC. Keep the RLS
-- DELETE policies as defense-in-depth for privileged/server paths without
-- exposing those direct destructive operations to authenticated clients.
grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.experiences to authenticated;
grant select, insert, update, delete on table
  public.education,
  public.certifications,
  public.projects,
  public.skills
to authenticated;

grant all privileges on table
  public.profiles,
  public.experiences,
  public.education,
  public.certifications,
  public.projects,
  public.skills
to service_role;

revoke all on function public.delete_experience(uuid, integer) from public, anon;
grant execute on function public.delete_experience(uuid, integer) to authenticated;

-- T02 review follow-up: authenticated mutations of existing rows must pass
-- through operations that lock the row and compare its expected revision.

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
     and exists (
       select 1
       from pg_catalog.pg_timezone_names as zones
       where zones.name = p_timezone
     );
$$;

create or replace function internal.lock_profile_revision(
  p_profile_id uuid,
  p_expected_revision integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_current_revision integer;
begin
  if p_profile_id is null
     or p_expected_revision is null
     or p_expected_revision < 1 then
    return false;
  end if;

  select profiles.revision
  into v_current_revision
  from public.profiles
  where profiles.id = p_profile_id
  for update;

  if not found then
    return false;
  end if;

  if v_current_revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'STALE_REVISION';
  end if;

  return true;
end;
$$;

create or replace function internal.update_foundation_record(
  p_table text,
  p_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_column text := 'user_id';
  v_allowed_columns text[];
  v_field text;
  v_set_clause text;
  v_current_revision integer;
  v_updated_row jsonb;
begin
  case p_table
    when 'profiles' then
      v_owner_column := 'id';
      v_allowed_columns := array[
        'display_name', 'headline', 'summary', 'contact_email', 'phone',
        'location', 'website', 'locale', 'timezone'
      ];
    when 'experiences' then
      v_allowed_columns := array[
        'organization', 'role_title', 'description', 'kind', 'start_date',
        'start_precision', 'end_date', 'end_precision', 'is_current'
      ];
    when 'education' then
      v_allowed_columns := array[
        'institution', 'qualification', 'field_of_study', 'description',
        'start_date', 'start_precision', 'end_date', 'end_precision',
        'is_current'
      ];
    when 'certifications' then
      v_allowed_columns := array[
        'name', 'issuer', 'issued_date', 'issued_precision', 'credential_url'
      ];
    when 'projects' then
      v_allowed_columns := array[
        'experience_id', 'title', 'description', 'user_role', 'outcome',
        'status', 'start_date', 'start_precision', 'end_date', 'end_precision',
        'is_current'
      ];
    when 'skills' then
      v_allowed_columns := array['name'];
    else
      raise exception using
        errcode = '22023',
        message = 'INVALID_MUTATION_TARGET';
  end case;

  if v_user_id is null
     or p_id is null
     or p_expected_revision is null
     or p_expected_revision < 1 then
    return null;
  end if;

  if p_changes is null
     or pg_catalog.jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception using
      errcode = '22023',
      message = 'INVALID_PATCH';
  end if;

  for v_field in
    select fields.name
    from pg_catalog.jsonb_object_keys(p_changes) as fields(name)
  loop
    if not (v_field = any(v_allowed_columns)) then
      raise exception using
        errcode = '22023',
        message = 'INVALID_PATCH';
    end if;
  end loop;

  execute pg_catalog.format(
    'select revision from public.%1$I where id = $1 and %2$I = $2 for update',
    p_table,
    v_owner_column
  )
  into v_current_revision
  using p_id, v_user_id;

  if not found then
    return null;
  end if;

  if v_current_revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'STALE_REVISION';
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('%1$I = patch.%1$I', fields.name),
    ', ' order by fields.name
  )
  into v_set_clause
  from pg_catalog.jsonb_object_keys(p_changes) as fields(name);

  execute pg_catalog.format(
    'update public.%1$I as target
       set %2$s
      from pg_catalog.jsonb_populate_record(null::public.%1$I, $1) as patch
     where target.id = $2
       and target.%3$I = $3
       and target.revision = $4
     returning pg_catalog.to_jsonb(target)',
    p_table,
    v_set_clause,
    v_owner_column
  )
  into v_updated_row
  using p_changes, p_id, v_user_id, p_expected_revision;

  return v_updated_row;
end;
$$;

create or replace function internal.delete_foundation_record(
  p_table text,
  p_id uuid,
  p_expected_revision integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_revision integer;
  v_deleted_id uuid;
begin
  if p_table not in ('education', 'certifications', 'projects', 'skills') then
    raise exception using
      errcode = '22023',
      message = 'INVALID_MUTATION_TARGET';
  end if;

  if v_user_id is null
     or p_id is null
     or p_expected_revision is null
     or p_expected_revision < 1 then
    return null;
  end if;

  execute pg_catalog.format(
    'select revision from public.%1$I where id = $1 and user_id = $2 for update',
    p_table
  )
  into v_current_revision
  using p_id, v_user_id;

  if not found then
    return null;
  end if;

  if v_current_revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'STALE_REVISION';
  end if;

  execute pg_catalog.format(
    'delete from public.%1$I
      where id = $1 and user_id = $2 and revision = $3
      returning id',
    p_table
  )
  into v_deleted_id
  using p_id, v_user_id, p_expected_revision;

  return v_deleted_id;
end;
$$;

create or replace function public.update_profile(
  p_expected_revision integer,
  p_changes jsonb
)
returns setof public.profiles
language sql
security definer
set search_path = pg_catalog
as $$
  select updated.*
  from (
    select internal.update_foundation_record(
      'profiles', auth.uid(), p_expected_revision, p_changes
    ) as row_data
  ) as changed
  cross join lateral pg_catalog.jsonb_populate_record(
    null::public.profiles, changed.row_data
  ) as updated
  where changed.row_data is not null;
$$;

create or replace function public.complete_onboarding(
  p_display_name text,
  p_expected_revision integer
)
returns setof public.profiles
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
     or not internal.lock_profile_revision(v_user_id, p_expected_revision) then
    return;
  end if;

  if not internal.is_real_display_name(p_display_name) then
    raise exception using
      errcode = '22023',
      message = 'INVALID_DISPLAY_NAME';
  end if;

  return query
  update public.profiles
  set display_name = btrim(p_display_name),
      onboarding_completed_at = coalesce(onboarding_completed_at, now())
  where id = v_user_id
    and revision = p_expected_revision
  returning *;
end;
$$;

create or replace function public.update_experience(
  p_experience_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns setof public.experiences
language sql
security definer
set search_path = pg_catalog
as $$
  select updated.*
  from (
    select internal.update_foundation_record(
      'experiences', p_experience_id, p_expected_revision, p_changes
    ) as row_data
  ) as changed
  cross join lateral pg_catalog.jsonb_populate_record(
    null::public.experiences, changed.row_data
  ) as updated
  where changed.row_data is not null;
$$;

create or replace function public.update_education(
  p_education_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns setof public.education
language sql
security definer
set search_path = pg_catalog
as $$
  select updated.*
  from (
    select internal.update_foundation_record(
      'education', p_education_id, p_expected_revision, p_changes
    ) as row_data
  ) as changed
  cross join lateral pg_catalog.jsonb_populate_record(
    null::public.education, changed.row_data
  ) as updated
  where changed.row_data is not null;
$$;

create or replace function public.update_certification(
  p_certification_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns setof public.certifications
language sql
security definer
set search_path = pg_catalog
as $$
  select updated.*
  from (
    select internal.update_foundation_record(
      'certifications', p_certification_id, p_expected_revision, p_changes
    ) as row_data
  ) as changed
  cross join lateral pg_catalog.jsonb_populate_record(
    null::public.certifications, changed.row_data
  ) as updated
  where changed.row_data is not null;
$$;

create or replace function public.update_project(
  p_project_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns setof public.projects
language sql
security definer
set search_path = pg_catalog
as $$
  select updated.*
  from (
    select internal.update_foundation_record(
      'projects', p_project_id, p_expected_revision, p_changes
    ) as row_data
  ) as changed
  cross join lateral pg_catalog.jsonb_populate_record(
    null::public.projects, changed.row_data
  ) as updated
  where changed.row_data is not null;
$$;

create or replace function public.update_skill(
  p_skill_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns setof public.skills
language sql
security definer
set search_path = pg_catalog
as $$
  select updated.*
  from (
    select internal.update_foundation_record(
      'skills', p_skill_id, p_expected_revision, p_changes
    ) as row_data
  ) as changed
  cross join lateral pg_catalog.jsonb_populate_record(
    null::public.skills, changed.row_data
  ) as updated
  where changed.row_data is not null;
$$;

create or replace function public.delete_education(
  p_education_id uuid,
  p_expected_revision integer
)
returns uuid
language sql
security definer
set search_path = pg_catalog
as $$
  select internal.delete_foundation_record(
    'education', p_education_id, p_expected_revision
  );
$$;

create or replace function public.delete_certification(
  p_certification_id uuid,
  p_expected_revision integer
)
returns uuid
language sql
security definer
set search_path = pg_catalog
as $$
  select internal.delete_foundation_record(
    'certifications', p_certification_id, p_expected_revision
  );
$$;

create or replace function public.delete_project(
  p_project_id uuid,
  p_expected_revision integer
)
returns uuid
language sql
security definer
set search_path = pg_catalog
as $$
  select internal.delete_foundation_record(
    'projects', p_project_id, p_expected_revision
  );
$$;

create or replace function public.delete_skill(
  p_skill_id uuid,
  p_expected_revision integer
)
returns uuid
language sql
security definer
set search_path = pg_catalog
as $$
  select internal.delete_foundation_record(
    'skills', p_skill_id, p_expected_revision
  );
$$;

create or replace function internal.set_ai_consent(
  p_user_id uuid,
  p_expected_revision integer,
  p_consented boolean,
  p_consent_version text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_consented is null
     or (p_consented and coalesce(btrim(p_consent_version), '') = '')
     or (not p_consented and p_consent_version is not null) then
    raise exception using
      errcode = '22023',
      message = 'INVALID_CONSENT_OPERATION';
  end if;

  if not internal.lock_profile_revision(p_user_id, p_expected_revision) then
    return false;
  end if;

  update public.profiles
  set ai_consent_at = case when p_consented then now() else null end,
      ai_consent_version = case
        when p_consented then btrim(p_consent_version)
        else null
      end
  where id = p_user_id
    and revision = p_expected_revision;

  return found;
end;
$$;

create or replace function internal.mark_account_deleting(
  p_user_id uuid,
  p_expected_revision integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_deleting_at timestamptz;
begin
  if not internal.lock_profile_revision(p_user_id, p_expected_revision) then
    return false;
  end if;

  select profiles.deleting_at
  into v_deleting_at
  from public.profiles
  where profiles.id = p_user_id;

  if v_deleting_at is not null then
    return true;
  end if;

  update public.profiles
  set deleting_at = now()
  where id = p_user_id
    and revision = p_expected_revision
    and deleting_at is null;

  return found;
end;
$$;

-- Remove direct authenticated UPDATE/DELETE. SELECT and INSERT remain available
-- under RLS; profile edits and all existing-row mutations use the RPCs above.
revoke all on table
  public.profiles,
  public.experiences,
  public.education,
  public.certifications,
  public.projects,
  public.skills
from anon, authenticated;

grant select on table
  public.profiles,
  public.experiences,
  public.education,
  public.certifications,
  public.projects,
  public.skills
to authenticated;

grant insert on table
  public.experiences,
  public.education,
  public.certifications,
  public.projects,
  public.skills
to authenticated;

revoke all on function internal.lock_profile_revision(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function internal.update_foundation_record(text, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function internal.delete_foundation_record(text, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function internal.set_ai_consent(uuid, integer, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function internal.mark_account_deleting(uuid, integer)
  from public, anon, authenticated, service_role;

grant execute on function internal.set_ai_consent(uuid, integer, boolean, text)
  to service_role;
grant execute on function internal.mark_account_deleting(uuid, integer)
  to service_role;

revoke all on function public.update_profile(integer, jsonb) from public, anon;
revoke all on function public.complete_onboarding(text, integer) from public, anon;
revoke all on function public.update_experience(uuid, integer, jsonb) from public, anon;
revoke all on function public.update_education(uuid, integer, jsonb) from public, anon;
revoke all on function public.update_certification(uuid, integer, jsonb) from public, anon;
revoke all on function public.update_project(uuid, integer, jsonb) from public, anon;
revoke all on function public.update_skill(uuid, integer, jsonb) from public, anon;
revoke all on function public.delete_education(uuid, integer) from public, anon;
revoke all on function public.delete_certification(uuid, integer) from public, anon;
revoke all on function public.delete_project(uuid, integer) from public, anon;
revoke all on function public.delete_skill(uuid, integer) from public, anon;
revoke all on function public.delete_experience(uuid, integer) from public, anon;

grant execute on function public.update_profile(integer, jsonb) to authenticated;
grant execute on function public.complete_onboarding(text, integer) to authenticated;
grant execute on function public.update_experience(uuid, integer, jsonb) to authenticated;
grant execute on function public.update_education(uuid, integer, jsonb) to authenticated;
grant execute on function public.update_certification(uuid, integer, jsonb) to authenticated;
grant execute on function public.update_project(uuid, integer, jsonb) to authenticated;
grant execute on function public.update_skill(uuid, integer, jsonb) to authenticated;
grant execute on function public.delete_education(uuid, integer) to authenticated;
grant execute on function public.delete_certification(uuid, integer) to authenticated;
grant execute on function public.delete_project(uuid, integer) to authenticated;
grant execute on function public.delete_skill(uuid, integer) to authenticated;
grant execute on function public.delete_experience(uuid, integer) to authenticated;

comment on function public.update_profile(integer, jsonb) is
  'Revision-checked authenticated profile edit. The patch allowlist includes only user-editable content and preferences; lifecycle fields use dedicated operations.';
comment on function public.complete_onboarding(text, integer) is
  'Revision-checked onboarding completion; the database supplies onboarding_completed_at.';
comment on function internal.set_ai_consent(uuid, integer, boolean, text) is
  'Trusted server operation for consent state; timestamp is assigned by the database.';
comment on function internal.mark_account_deleting(uuid, integer) is
  'Trusted server operation for deletion lifecycle state; orchestration remains owned by T23.';

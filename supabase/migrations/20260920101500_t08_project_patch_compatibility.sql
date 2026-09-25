-- T08 follow-up: retain the established revision-checked partial-patch contract
-- while the Project service sends the complete canonical field allowlist.
create or replace function public.update_project(
  p_project_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns setof public.projects
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_key text;
  v_project public.projects%rowtype;
  v_changes public.projects%rowtype;
  v_title text;
  v_description text;
  v_user_role text;
  v_outcome text;
  v_status text;
  v_start_date date;
  v_start_precision text;
  v_end_date date;
  v_end_precision text;
  v_is_current boolean;
  v_experience_id uuid;
  v_key_count integer;
begin
  if v_user_id is null
     or not exists (
       select 1 from public.profiles as profile
       where profile.id = v_user_id and profile.deleting_at is null
     ) then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if p_project_id is null
     or p_expected_revision is null
     or p_expected_revision < 1
     or p_changes is null
     or pg_catalog.jsonb_typeof(p_changes) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_PROJECT_INPUT';
  end if;

  select pg_catalog.count(*)::integer
  into v_key_count
  from pg_catalog.jsonb_object_keys(p_changes) as field(key);
  if v_key_count < 1 then
    raise exception using errcode = '22023', message = 'INVALID_PROJECT_INPUT';
  end if;

  for v_key in select field.key from pg_catalog.jsonb_object_keys(p_changes) as field(key) loop
    if not (v_key = any(array[
      'experience_id', 'title', 'description', 'user_role', 'outcome',
      'status', 'start_date', 'start_precision', 'end_date', 'end_precision',
      'is_current'
    ])) then
      raise exception using errcode = '22023', message = 'INVALID_PROJECT_INPUT';
    end if;
  end loop;

  select project.*
  into v_project
  from public.projects as project
  where project.user_id = v_user_id
    and project.id = p_project_id
  for update;
  if not found then
    return;
  end if;

  if v_project.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

  begin
    select populated.*
    into v_changes
    from pg_catalog.jsonb_populate_record(null::public.projects, p_changes) as populated;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'INVALID_PROJECT_INPUT';
  end;

  v_title := case when p_changes ? 'title' then nullif(pg_catalog.btrim(v_changes.title), '') else v_project.title end;
  v_description := case when p_changes ? 'description' then nullif(pg_catalog.btrim(v_changes.description), '') else v_project.description end;
  v_user_role := case when p_changes ? 'user_role' then nullif(pg_catalog.btrim(v_changes.user_role), '') else v_project.user_role end;
  v_outcome := case when p_changes ? 'outcome' then nullif(pg_catalog.btrim(v_changes.outcome), '') else v_project.outcome end;
  v_status := case when p_changes ? 'status' then v_changes.status else v_project.status end;
  v_start_date := case when p_changes ? 'start_date' then v_changes.start_date else v_project.start_date end;
  v_start_precision := case when p_changes ? 'start_precision' then v_changes.start_precision else v_project.start_precision end;
  v_end_date := case when p_changes ? 'end_date' then v_changes.end_date else v_project.end_date end;
  v_end_precision := case when p_changes ? 'end_precision' then v_changes.end_precision else v_project.end_precision end;
  v_is_current := case when p_changes ? 'is_current' then coalesce(v_changes.is_current, false) else v_project.is_current end;
  v_experience_id := case when p_changes ? 'experience_id' then v_changes.experience_id else v_project.experience_id end;

  if v_status = 'completed' then
    v_is_current := false;
  end if;
  if v_is_current then
    v_end_date := null;
    v_end_precision := null;
  end if;

  if v_title is null
     or pg_catalog.char_length(v_title) > 200
     or (v_description is not null and pg_catalog.char_length(v_description) > 5000)
     or (v_user_role is not null and pg_catalog.char_length(v_user_role) > 200)
     or (v_outcome is not null and pg_catalog.char_length(v_outcome) > 5000)
     or v_status is null
     or v_status not in ('planned', 'active', 'completed')
     or (v_start_date is not null and not pg_catalog.isfinite(v_start_date))
     or (v_end_date is not null and not pg_catalog.isfinite(v_end_date))
     or not internal.is_valid_partial_interval(
       v_start_date, v_start_precision, v_end_date, v_end_precision, v_is_current
     ) then
    raise exception using errcode = '22023', message = 'INVALID_PROJECT_INPUT';
  end if;

  if v_experience_id is not null then
    perform 1
    from public.experiences as experience
    where experience.user_id = v_user_id
      and experience.id = v_experience_id
    for share;
    if not found then
      raise exception using errcode = '22023', message = 'INVALID_PROJECT_INPUT';
    end if;
  end if;

  -- Project is locked before linked Activities. This is the same order used
  -- by relink and delete, so context changes serialize deterministically.
  if v_project.experience_id is distinct from v_experience_id then
    perform 1
    from public.activities as activity
    where activity.user_id = v_user_id
      and activity.project_id = p_project_id
    order by activity.id
    for update;
  end if;

  update public.projects as project
  set experience_id = v_experience_id,
      title = v_title,
      description = v_description,
      user_role = v_user_role,
      outcome = v_outcome,
      status = v_status,
      start_date = v_start_date,
      start_precision = v_start_precision,
      end_date = v_end_date,
      end_precision = v_end_precision,
      is_current = v_is_current
  where project.user_id = v_user_id
    and project.id = p_project_id
    and project.revision = p_expected_revision
  returning project.* into v_project;

  if found then
    return next v_project;
  end if;
end;
$$;

create or replace function public.relink_activity_project(
  p_activity_id uuid,
  p_expected_revision integer,
  p_project_id uuid
)
returns setof public.activities
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_experience_id uuid;
  v_activity public.activities%rowtype;
  v_updated public.activities%rowtype;
begin
  if v_user_id is null
     or not exists (
       select 1 from public.profiles as profile
       where profile.id = v_user_id and profile.deleting_at is null
     ) then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if p_activity_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_INPUT';
  end if;

  if p_project_id is not null then
    select project.experience_id
    into v_project_experience_id
    from public.projects as project
    where project.user_id = v_user_id
      and project.id = p_project_id
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'ACTIVITY_UNAVAILABLE';
    end if;
  end if;

  select activity.*
  into v_activity
  from public.activities as activity
  where activity.user_id = v_user_id
    and activity.id = p_activity_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACTIVITY_UNAVAILABLE';
  end if;

  if v_activity.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

  if v_activity.project_id is not distinct from p_project_id
     and (p_project_id is null or v_activity.experience_id is not distinct from v_project_experience_id) then
    return next v_activity;
    return;
  end if;

  update public.activities as activity
  set project_id = p_project_id,
      experience_id = case when p_project_id is null then activity.experience_id else v_project_experience_id end
  where activity.user_id = v_user_id
    and activity.id = p_activity_id
    and activity.revision = p_expected_revision
  returning activity.* into v_updated;

  if found then
    return next v_updated;
    return;
  end if;

  raise exception using errcode = 'P0001', message = 'STALE_REVISION';
end;
$$;

revoke all on function public.update_project(uuid, integer, jsonb)
  from public, anon, service_role;
grant execute on function public.update_project(uuid, integer, jsonb)
  to authenticated;

revoke all on function public.relink_activity_project(uuid, integer, uuid)
  from public, anon, service_role;
grant execute on function public.relink_activity_project(uuid, integer, uuid)
  to authenticated;

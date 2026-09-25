-- WorkPulse T08 review remediation.
-- Forward-only fixes for completed partial dates, ledger-first replays, and
-- the Experience -> Project -> Activity mutation lock hierarchy.

create or replace function public.create_project_idempotent(
  p_operation_key uuid,
  p_title text,
  p_description text,
  p_user_role text,
  p_outcome text,
  p_status text,
  p_start_date date,
  p_start_precision text,
  p_end_date date,
  p_end_precision text,
  p_is_current boolean,
  p_experience_id uuid
)
returns table (
  project_id uuid,
  user_id uuid,
  revision integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := nullif(pg_catalog.btrim(p_title), '');
  v_description text := nullif(pg_catalog.btrim(p_description), '');
  v_user_role text := nullif(pg_catalog.btrim(p_user_role), '');
  v_outcome text := nullif(pg_catalog.btrim(p_outcome), '');
  v_status text := p_status;
  v_start_date date := p_start_date;
  v_start_precision text := p_start_precision;
  v_end_date date := p_end_date;
  v_end_precision text := p_end_precision;
  v_is_current boolean := coalesce(p_is_current, false);
  v_payload jsonb;
  v_payload_hash bytea;
  v_existing_hash bytea;
  v_existing_table text;
  v_existing_id uuid;
  v_existing_payload jsonb;
  v_completed_at timestamptz;
  v_receipt_project_id uuid;
  v_receipt_user_id uuid;
  v_receipt_revision integer;
  v_rows integer;
  v_project public.projects%rowtype;
begin
  if v_user_id is null
     or not exists (
       select 1 from public.profiles as profile
       where profile.id = v_user_id and profile.deleting_at is null
     ) then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if p_operation_key is null then
    raise exception using errcode = '22023', message = 'INVALID_OPERATION_KEY';
  end if;

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

  -- The hash is formed from canonical scalar input before any live parent
  -- lookup. Existing ledger rows therefore remain replayable after a parent
  -- is deleted or otherwise changes state.
  v_payload := pg_catalog.jsonb_build_object(
    'title', v_title,
    'description', v_description,
    'user_role', v_user_role,
    'outcome', v_outcome,
    'status', v_status,
    'start_date', v_start_date,
    'start_precision', v_start_precision,
    'end_date', v_end_date,
    'end_precision', v_end_precision,
    'is_current', v_is_current,
    'experience_id', p_experience_id
  );
  v_payload_hash := extensions.digest(v_payload::text, 'sha256');

  insert into internal.operation_requests (
    user_id, operation_kind, operation_key, input_revision, payload_hash
  ) values (
    v_user_id, 'project.create', p_operation_key, 0, v_payload_hash
  ) on conflict on constraint operation_requests_pkey do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select operation.payload_hash, operation.result_table, operation.result_id,
      operation.result_payload, operation.completed_at
    into v_existing_hash, v_existing_table, v_existing_id,
      v_existing_payload, v_completed_at
    from internal.operation_requests as operation
    where operation.user_id = v_user_id
      and operation.operation_kind = 'project.create'
      and operation.operation_key = p_operation_key
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;
    if v_existing_hash is distinct from v_payload_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing_table is distinct from 'projects'
       or v_existing_id is null
       or v_existing_payload is null
       or v_completed_at is null then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;

    begin
      v_receipt_project_id := (v_existing_payload ->> 'project_id')::uuid;
      v_receipt_user_id := (v_existing_payload ->> 'user_id')::uuid;
      v_receipt_revision := (v_existing_payload ->> 'revision')::integer;
    exception
      when others then
        raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end;

    if v_receipt_project_id is null
       or v_receipt_user_id is null
       or v_receipt_revision is distinct from 1
       or v_existing_id is distinct from v_receipt_project_id
       or v_receipt_user_id is distinct from v_user_id then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;

    return query select v_receipt_project_id, v_receipt_user_id, v_receipt_revision;
    return;
  end if;

  -- Only a new ledger claim may inspect and lock the live Experience.
  if p_experience_id is not null then
    perform 1
    from public.experiences as experience
    where experience.user_id = v_user_id
      and experience.id = p_experience_id
    for share;
    if not found then
      raise exception using errcode = '22023', message = 'INVALID_PROJECT_INPUT';
    end if;
  end if;

  insert into public.projects (
    user_id, experience_id, title, description, user_role, outcome, status,
    start_date, start_precision, end_date, end_precision, is_current
  ) values (
    v_user_id, p_experience_id, v_title, v_description, v_user_role, v_outcome, v_status,
    v_start_date, v_start_precision, v_end_date, v_end_precision, v_is_current
  ) returning * into v_project;

  v_existing_payload := pg_catalog.jsonb_build_object(
    'project_id', v_project.id,
    'user_id', v_project.user_id,
    'revision', v_project.revision
  );

  update internal.operation_requests
  set result_table = 'projects',
      result_id = v_project.id,
      result_payload = v_existing_payload,
      completed_at = pg_catalog.clock_timestamp()
  where operation_requests.user_id = v_user_id
    and operation_requests.operation_kind = 'project.create'
    and operation_requests.operation_key = p_operation_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
  end if;

  return query select v_project.id, v_project.user_id, v_project.revision;
end;
$$;

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
  v_snapshot public.projects%rowtype;
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
  v_experience_ids uuid[];
  v_lock_experience_id uuid;
  v_expected_experience_count integer := 0;
  v_locked_experience_count integer := 0;
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

  begin
    select populated.*
    into v_changes
    from pg_catalog.jsonb_populate_record(null::public.projects, p_changes) as populated;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'INVALID_PROJECT_INPUT';
  end;

  -- This unlocked snapshot supplies the Experience hint for partial patches.
  -- It is checked again after the Experience and Project locks are acquired.
  select project.*
  into v_snapshot
  from public.projects as project
  where project.user_id = v_user_id
    and project.id = p_project_id;
  if not found then
    return;
  end if;

  v_experience_id := case when p_changes ? 'experience_id' then v_changes.experience_id else v_snapshot.experience_id end;
  v_experience_ids := array_remove(array[v_snapshot.experience_id, v_experience_id], null);

  select pg_catalog.count(*)::integer
  into v_expected_experience_count
  from (
    select distinct ids.id
    from pg_catalog.unnest(v_experience_ids) as ids(id)
  ) as unique_ids;

  -- Experience rows are locked first, in ID order. This is the same
  -- hierarchy used by delete_experience before it locks Projects.
  if v_expected_experience_count > 0 then
    for v_lock_experience_id in
      select experience.id
      from public.experiences as experience
      where experience.user_id = v_user_id
        and experience.id = any(v_experience_ids)
      order by experience.id
      for share
    loop
      v_locked_experience_count := v_locked_experience_count + 1;
    end loop;

    if v_locked_experience_count <> v_expected_experience_count then
      if v_snapshot.experience_id is not null
         and not exists (
           select 1 from public.experiences as experience
           where experience.user_id = v_user_id
             and experience.id = v_snapshot.experience_id
         ) then
        raise exception using errcode = 'P0001', message = 'STALE_REVISION';
      end if;
      raise exception using errcode = '22023', message = 'INVALID_PROJECT_INPUT';
    end if;
  end if;

  select project.*
  into v_project
  from public.projects as project
  where project.user_id = v_user_id
    and project.id = p_project_id
  for update;
  if not found then
    return;
  end if;

  if v_project.revision <> p_expected_revision
     or v_project.experience_id is distinct from v_snapshot.experience_id then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

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

  if v_project.experience_id is distinct from v_experience_id then
    -- Project is already locked; linked Activities are now locked in ID
    -- order before the trigger propagates the new Experience context.
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

revoke all on function public.create_project_idempotent(uuid, text, text, text, text, text, date, text, date, text, boolean, uuid)
  from public, anon, service_role;
grant execute on function public.create_project_idempotent(uuid, text, text, text, text, text, date, text, date, text, boolean, uuid)
  to authenticated;

revoke all on function public.update_project(uuid, integer, jsonb)
  from public, anon, service_role;
grant execute on function public.update_project(uuid, integer, jsonb)
  to authenticated;

comment on function public.create_project_idempotent(uuid, text, text, text, text, text, date, text, date, text, boolean, uuid) is
  'Owner-scoped idempotent Project create. Ledger replay is resolved before live Experience validation.';
comment on function public.update_project(uuid, integer, jsonb) is
  'Owner-scoped full Project update with Experience, Project, then Activity lock ordering and atomic context propagation.';

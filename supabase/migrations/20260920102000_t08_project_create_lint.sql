-- Qualify the idempotency conflict target for Supabase lint/pgTLE. The
-- CREATE RPC's output column user_id otherwise shadows the ledger column.
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

    if not found or v_existing_hash is distinct from v_payload_hash then
      if found then
        raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
      end if;
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;

    if v_existing_table is distinct from 'projects'
       or v_existing_id is null
       or v_existing_payload is null
       or v_completed_at is null then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;

    return query
    select
      (v_existing_payload ->> 'project_id')::uuid,
      (v_existing_payload ->> 'user_id')::uuid,
      (v_existing_payload ->> 'revision')::integer;
    return;
  end if;

  insert into public.projects (
    user_id, experience_id, title, description, user_role, outcome, status,
    start_date, start_precision, end_date, end_precision, is_current
  ) values (
    v_user_id, p_experience_id, v_title, v_description, v_user_role, v_outcome,
    v_status, v_start_date, v_start_precision, v_end_date, v_end_precision, v_is_current
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

revoke all on function public.create_project_idempotent(uuid, text, text, text, text, text, date, text, date, text, boolean, uuid)
  from public, anon, service_role;
grant execute on function public.create_project_idempotent(uuid, text, text, text, text, text, date, text, date, text, boolean, uuid)
  to authenticated;

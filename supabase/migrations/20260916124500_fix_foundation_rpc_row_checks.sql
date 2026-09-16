-- EXECUTE ... INTO does not update PL/pgSQL's FOUND flag. Check ROW_COUNT
-- explicitly so missing/foreign rows are handled without false NULL results.

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
  v_rows integer;
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
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
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
  v_rows integer;
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
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
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

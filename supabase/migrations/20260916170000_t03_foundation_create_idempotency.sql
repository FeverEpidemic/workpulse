-- T03 remediation: make foundation creates atomic and replay-safe.

create schema if not exists extensions;

do $migration$
declare
  v_extension_schema text;
begin
  select namespace.nspname
  into v_extension_schema
  from pg_catalog.pg_extension as extension
  join pg_catalog.pg_namespace as namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if v_extension_schema is null then
    execute 'create extension pgcrypto with schema extensions';
  elsif v_extension_schema <> 'extensions' then
    execute 'alter extension pgcrypto set schema extensions';
  end if;
end;
$migration$;

create table internal.operation_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_kind text not null,
  operation_key uuid not null,
  input_revision integer not null default 0,
  payload_hash bytea not null,
  result_table text,
  result_id uuid,
  created_at timestamptz not null default transaction_timestamp(),
  completed_at timestamptz,
  constraint operation_requests_pkey primary key (user_id, operation_kind, operation_key),
  constraint operation_requests_kind_check check (
    operation_kind in (
      'experience.create',
      'education.create',
      'certification.create',
      'skill.create'
    )
  ),
  constraint operation_requests_input_revision_check check (input_revision = 0),
  constraint operation_requests_payload_hash_check check (pg_catalog.octet_length(payload_hash) = 32),
  constraint operation_requests_result_table_check check (
    result_table is null or result_table in ('experiences', 'education', 'certifications', 'skills')
  ),
  constraint operation_requests_completion_check check (
    (result_table is null and result_id is null and completed_at is null)
    or (result_table is not null and result_id is not null and completed_at is not null)
  )
);

comment on table internal.operation_requests is
  'Private transactional idempotency ledger for T03 foundation create RPCs. Create input_revision is 0 because no source row exists yet.';
comment on column internal.operation_requests.payload_hash is
  'SHA-256 of the canonical JSONB create payload; never stores the career text itself.';
comment on column internal.operation_requests.result_id is
  'Owned domain row returned to an identical replay; no polymorphic foreign key is possible.';

alter table internal.operation_requests enable row level security;
revoke all on table internal.operation_requests from public, anon, authenticated, service_role;

create or replace function internal.create_foundation_record(
  p_owner_id uuid,
  p_operation_kind text,
  p_operation_key uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_table text;
  v_allowed_keys text[];
  v_key text;
  v_key_count integer;
  v_payload_hash bytea;
  v_existing_hash bytea;
  v_existing_table text;
  v_existing_id uuid;
  v_completed_at timestamptz;
  v_rows integer;
  v_record jsonb;
  v_experience public.experiences%rowtype;
  v_education public.education%rowtype;
  v_certification public.certifications%rowtype;
  v_skill public.skills%rowtype;
begin
  if v_user_id is null or p_owner_id is null or p_owner_id is distinct from v_user_id then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if p_operation_key is null then
    raise exception using errcode = '22023', message = 'INVALID_OPERATION_KEY';
  end if;

  perform 1
  from public.profiles
  where id = v_user_id
    and deleting_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  case p_operation_kind
    when 'experience.create' then
      v_table := 'experiences';
      v_allowed_keys := array[
        'organization', 'role_title', 'description', 'kind', 'start_date',
        'start_precision', 'end_date', 'end_precision', 'is_current'
      ];
    when 'education.create' then
      v_table := 'education';
      v_allowed_keys := array[
        'institution', 'qualification', 'field_of_study', 'description',
        'start_date', 'start_precision', 'end_date', 'end_precision', 'is_current'
      ];
    when 'certification.create' then
      v_table := 'certifications';
      v_allowed_keys := array[
        'name', 'issuer', 'credential_url', 'issued_date', 'issued_precision'
      ];
    when 'skill.create' then
      v_table := 'skills';
      v_allowed_keys := array['name'];
    else
      raise exception using errcode = '22023', message = 'INVALID_OPERATION_KIND';
  end case;

  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_CREATE_PAYLOAD';
  end if;

  select pg_catalog.count(*)::integer
  into v_key_count
  from pg_catalog.jsonb_object_keys(p_payload) as fields(key);

  if v_key_count <> pg_catalog.cardinality(v_allowed_keys) then
    raise exception using errcode = '22023', message = 'INVALID_CREATE_PAYLOAD';
  end if;

  for v_key in
    select fields.key
    from pg_catalog.jsonb_object_keys(p_payload) as fields(key)
  loop
    if not (v_key = any(v_allowed_keys)) then
      raise exception using errcode = '22023', message = 'INVALID_CREATE_PAYLOAD';
    end if;
  end loop;

  v_payload_hash := extensions.digest(p_payload::text, 'sha256');

  insert into internal.operation_requests (
    user_id,
    operation_kind,
    operation_key,
    input_revision,
    payload_hash
  )
  values (
    v_user_id,
    p_operation_kind,
    p_operation_key,
    0,
    v_payload_hash
  )
  on conflict (user_id, operation_kind, operation_key) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select
      operation_requests.payload_hash,
      operation_requests.result_table,
      operation_requests.result_id,
      operation_requests.completed_at
    into
      v_existing_hash,
      v_existing_table,
      v_existing_id,
      v_completed_at
    from internal.operation_requests
    where operation_requests.user_id = v_user_id
      and operation_requests.operation_kind = p_operation_kind
      and operation_requests.operation_key = p_operation_key
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;

    if v_existing_hash is distinct from v_payload_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_existing_table is distinct from v_table
       or v_existing_id is null
       or v_completed_at is null then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;

    case p_operation_kind
      when 'experience.create' then
        select pg_catalog.to_jsonb(record_row)
        into v_record
        from public.experiences as record_row
        where record_row.id = v_existing_id
          and record_row.user_id = v_user_id;
      when 'education.create' then
        select pg_catalog.to_jsonb(record_row)
        into v_record
        from public.education as record_row
        where record_row.id = v_existing_id
          and record_row.user_id = v_user_id;
      when 'certification.create' then
        select pg_catalog.to_jsonb(record_row)
        into v_record
        from public.certifications as record_row
        where record_row.id = v_existing_id
          and record_row.user_id = v_user_id;
      when 'skill.create' then
        select pg_catalog.to_jsonb(record_row)
        into v_record
        from public.skills as record_row
        where record_row.id = v_existing_id
          and record_row.user_id = v_user_id;
    end case;

    if v_record is null then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;

    return v_record;
  end if;

  case p_operation_kind
    when 'experience.create' then
      insert into public.experiences (
        user_id, organization, role_title, description, kind, start_date,
        start_precision, end_date, end_precision, is_current
      )
      select
        v_user_id,
        payload.organization,
        payload.role_title,
        payload.description,
        payload.kind,
        payload.start_date,
        payload.start_precision,
        payload.end_date,
        payload.end_precision,
        payload.is_current
      from pg_catalog.jsonb_populate_record(null::public.experiences, p_payload) as payload
      returning * into v_experience;
      v_record := pg_catalog.to_jsonb(v_experience);
    when 'education.create' then
      insert into public.education (
        user_id, institution, qualification, field_of_study, description,
        start_date, start_precision, end_date, end_precision, is_current
      )
      select
        v_user_id,
        payload.institution,
        payload.qualification,
        payload.field_of_study,
        payload.description,
        payload.start_date,
        payload.start_precision,
        payload.end_date,
        payload.end_precision,
        payload.is_current
      from pg_catalog.jsonb_populate_record(null::public.education, p_payload) as payload
      returning * into v_education;
      v_record := pg_catalog.to_jsonb(v_education);
    when 'certification.create' then
      insert into public.certifications (
        user_id, name, issuer, credential_url, issued_date, issued_precision
      )
      select
        v_user_id,
        payload.name,
        payload.issuer,
        payload.credential_url,
        payload.issued_date,
        payload.issued_precision
      from pg_catalog.jsonb_populate_record(null::public.certifications, p_payload) as payload
      returning * into v_certification;
      v_record := pg_catalog.to_jsonb(v_certification);
    when 'skill.create' then
      insert into public.skills (user_id, name)
      select v_user_id, payload.name
      from pg_catalog.jsonb_populate_record(null::public.skills, p_payload) as payload
      returning * into v_skill;
      v_record := pg_catalog.to_jsonb(v_skill);
  end case;

  update internal.operation_requests
  set result_table = v_table,
      result_id = (v_record ->> 'id')::uuid,
      completed_at = clock_timestamp()
  where operation_requests.user_id = v_user_id
    and operation_requests.operation_kind = p_operation_kind
    and operation_requests.operation_key = p_operation_key;

  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
  end if;

  return v_record;
end;
$$;

revoke all on function internal.create_foundation_record(uuid, text, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.create_experience_idempotent(
  p_operation_key uuid,
  p_organization text,
  p_role_title text,
  p_description text,
  p_kind text,
  p_start_date date,
  p_start_precision text,
  p_end_date date,
  p_end_precision text,
  p_is_current boolean
)
returns setof public.experiences
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_record jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  v_record := internal.create_foundation_record(
    v_user_id,
    'experience.create',
    p_operation_key,
    pg_catalog.jsonb_build_object(
      'organization', p_organization,
      'role_title', p_role_title,
      'description', p_description,
      'kind', p_kind,
      'start_date', p_start_date,
      'start_precision', p_start_precision,
      'end_date', p_end_date,
      'end_precision', p_end_precision,
      'is_current', p_is_current
    )
  );
  return query
    select record_row.*
    from pg_catalog.jsonb_populate_record(null::public.experiences, v_record) as record_row;
end;
$$;

create or replace function public.create_education_idempotent(
  p_operation_key uuid,
  p_institution text,
  p_qualification text,
  p_field_of_study text,
  p_description text,
  p_start_date date,
  p_start_precision text,
  p_end_date date,
  p_end_precision text,
  p_is_current boolean
)
returns setof public.education
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_record jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  v_record := internal.create_foundation_record(
    v_user_id,
    'education.create',
    p_operation_key,
    pg_catalog.jsonb_build_object(
      'institution', p_institution,
      'qualification', p_qualification,
      'field_of_study', p_field_of_study,
      'description', p_description,
      'start_date', p_start_date,
      'start_precision', p_start_precision,
      'end_date', p_end_date,
      'end_precision', p_end_precision,
      'is_current', p_is_current
    )
  );
  return query
    select record_row.*
    from pg_catalog.jsonb_populate_record(null::public.education, v_record) as record_row;
end;
$$;

create or replace function public.create_certification_idempotent(
  p_operation_key uuid,
  p_name text,
  p_issuer text,
  p_credential_url text,
  p_issued_date date,
  p_issued_precision text
)
returns setof public.certifications
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_record jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  v_record := internal.create_foundation_record(
    v_user_id,
    'certification.create',
    p_operation_key,
    pg_catalog.jsonb_build_object(
      'name', p_name,
      'issuer', p_issuer,
      'credential_url', p_credential_url,
      'issued_date', p_issued_date,
      'issued_precision', p_issued_precision
    )
  );
  return query
    select record_row.*
    from pg_catalog.jsonb_populate_record(null::public.certifications, v_record) as record_row;
end;
$$;

create or replace function public.create_skill_idempotent(
  p_operation_key uuid,
  p_name text
)
returns setof public.skills
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_record jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  v_record := internal.create_foundation_record(
    v_user_id,
    'skill.create',
    p_operation_key,
    pg_catalog.jsonb_build_object('name', p_name)
  );
  return query
    select record_row.*
    from pg_catalog.jsonb_populate_record(null::public.skills, v_record) as record_row;
end;
$$;

revoke all on function public.create_experience_idempotent(uuid, text, text, text, text, date, text, date, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.create_education_idempotent(uuid, text, text, text, text, date, text, date, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.create_certification_idempotent(uuid, text, text, text, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_skill_idempotent(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_experience_idempotent(uuid, text, text, text, text, date, text, date, text, boolean)
  to authenticated;
grant execute on function public.create_education_idempotent(uuid, text, text, text, text, date, text, date, text, boolean)
  to authenticated;
grant execute on function public.create_certification_idempotent(uuid, text, text, text, date, text)
  to authenticated;
grant execute on function public.create_skill_idempotent(uuid, text)
  to authenticated;

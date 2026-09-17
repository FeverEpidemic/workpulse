-- T03 review remediation: enforce the foundation contracts at the database
-- boundary and keep create replay results independent of later row changes.

revoke insert on table
  public.experiences,
  public.education,
  public.certifications,
  public.skills
from authenticated;

-- Refuse to change or truncate any existing value to make the new contract fit.
do $preflight$
begin
  if exists (
    select 1
    from public.profiles
    where not (
      display_name = btrim(display_name, E' \t\n\r')
      and char_length(display_name) between 1 and 80
      and (
        headline is null
        or (
          headline = btrim(headline, E' \t\n\r')
          and char_length(headline) between 1 and 120
        )
      )
      and (
        summary is null
        or (
          summary = btrim(summary, E' \t\n\r')
          and char_length(summary) between 1 and 2000
        )
      )
      and (
        contact_email is null
        or (
          contact_email = btrim(contact_email, E' \t\n\r')
          and char_length(contact_email) between 1 and 320
          and contact_email ~* '^[A-Za-z0-9_+''-]+([.][A-Za-z0-9_+''-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
        )
      )
      and (
        phone is null
        or (
          phone = btrim(phone, E' \t\n\r')
          and char_length(phone) between 1 and 40
        )
      )
      and (
        location is null
        or (
          location = btrim(location, E' \t\n\r')
          and char_length(location) between 1 and 120
        )
      )
      and (
        website is null
        or (
          website = btrim(website, E' \t\n\r')
          and char_length(website) between 1 and 2048
          and website ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
        )
      )
      and timezone = btrim(timezone, E' \t\n\r')
      and char_length(timezone) between 1 and 100
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'T03 contract hardening aborted: existing profile values violate the new length, format, or canonical-null contract. No rows were changed.';
  end if;

  if exists (
    select 1
    from public.experiences
    where not (
      organization = btrim(organization, E' \t\n\r')
      and char_length(organization) between 1 and 200
      and role_title = btrim(role_title, E' \t\n\r')
      and char_length(role_title) between 1 and 200
      and (
        description is null
        or (
          description = btrim(description, E' \t\n\r')
          and char_length(description) between 1 and 5000
        )
      )
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'T03 contract hardening aborted: existing experience values violate the new length or canonical-null contract. No rows were changed.';
  end if;

  if exists (
    select 1
    from public.education
    where not (
      institution = btrim(institution, E' \t\n\r')
      and char_length(institution) between 1 and 200
      and qualification = btrim(qualification, E' \t\n\r')
      and char_length(qualification) between 1 and 200
      and (
        field_of_study is null
        or (
          field_of_study = btrim(field_of_study, E' \t\n\r')
          and char_length(field_of_study) between 1 and 200
        )
      )
      and (
        description is null
        or (
          description = btrim(description, E' \t\n\r')
          and char_length(description) between 1 and 5000
        )
      )
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'T03 contract hardening aborted: existing education values violate the new length or canonical-null contract. No rows were changed.';
  end if;

  if exists (
    select 1
    from public.certifications
    where not (
      name = btrim(name, E' \t\n\r')
      and char_length(name) between 1 and 200
      and (
        issuer is null
        or (
          issuer = btrim(issuer, E' \t\n\r')
          and char_length(issuer) between 1 and 200
        )
      )
      and (
        credential_url is null
        or (
          credential_url = btrim(credential_url, E' \t\n\r')
          and char_length(credential_url) between 1 and 2048
          and credential_url ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
        )
      )
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'T03 contract hardening aborted: existing certification values violate the new length, URL, or canonical-null contract. No rows were changed.';
  end if;

  if exists (
    select 1
    from public.skills
    where not (
      name = btrim(name, E' \t\n\r')
      and char_length(name) between 1 and 100
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'T03 contract hardening aborted: existing skill values violate the new length or canonical-name contract. No rows were changed.';
  end if;
end;
$preflight$;

alter table public.profiles
  add constraint profiles_t03_field_contract_check check (
    display_name = btrim(display_name, E' \t\n\r')
    and char_length(display_name) between 1 and 80
    and (
      headline is null
      or (
        headline = btrim(headline, E' \t\n\r')
        and char_length(headline) between 1 and 120
      )
    )
    and (
      summary is null
      or (
        summary = btrim(summary, E' \t\n\r')
        and char_length(summary) between 1 and 2000
      )
    )
    and (
      contact_email is null
      or (
        contact_email = btrim(contact_email, E' \t\n\r')
        and char_length(contact_email) between 1 and 320
        and contact_email ~* '^[A-Za-z0-9_+''-]+([.][A-Za-z0-9_+''-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
      )
    )
    and (
      phone is null
      or (
        phone = btrim(phone, E' \t\n\r')
        and char_length(phone) between 1 and 40
      )
    )
    and (
      location is null
      or (
        location = btrim(location, E' \t\n\r')
        and char_length(location) between 1 and 120
      )
    )
    and (
      website is null
      or (
        website = btrim(website, E' \t\n\r')
        and char_length(website) between 1 and 2048
        and website ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
      )
    )
    and timezone = btrim(timezone, E' \t\n\r')
    and char_length(timezone) between 1 and 100
  );

alter table public.experiences
  add constraint experiences_t03_field_contract_check check (
    organization = btrim(organization, E' \t\n\r')
    and char_length(organization) between 1 and 200
    and role_title = btrim(role_title, E' \t\n\r')
    and char_length(role_title) between 1 and 200
    and (
      description is null
      or (
        description = btrim(description, E' \t\n\r')
        and char_length(description) between 1 and 5000
      )
    )
  );

alter table public.education
  add constraint education_t03_field_contract_check check (
    institution = btrim(institution, E' \t\n\r')
    and char_length(institution) between 1 and 200
    and qualification = btrim(qualification, E' \t\n\r')
    and char_length(qualification) between 1 and 200
    and (
      field_of_study is null
      or (
        field_of_study = btrim(field_of_study, E' \t\n\r')
        and char_length(field_of_study) between 1 and 200
      )
    )
    and (
      description is null
      or (
        description = btrim(description, E' \t\n\r')
        and char_length(description) between 1 and 5000
      )
    )
  );

alter table public.certifications
  drop constraint certifications_credential_url_check,
  add constraint certifications_t03_field_contract_check check (
    name = btrim(name, E' \t\n\r')
    and char_length(name) between 1 and 200
    and (
      issuer is null
      or (
        issuer = btrim(issuer, E' \t\n\r')
        and char_length(issuer) between 1 and 200
      )
    )
    and (
      credential_url is null
      or (
        credential_url = btrim(credential_url, E' \t\n\r')
        and char_length(credential_url) between 1 and 2048
        and credential_url ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
      )
    )
  );

alter table public.skills
  add constraint skills_t03_field_contract_check check (
    name = btrim(name, E' \t\n\r')
    and char_length(name) between 1 and 100
  );

comment on constraint profiles_t03_field_contract_check on public.profiles is
  'T03 UI/server field limits, format checks, and optional-field NULL canonicalization.';
comment on constraint experiences_t03_field_contract_check on public.experiences is
  'T03 field limits and canonical optional description value.';
comment on constraint education_t03_field_contract_check on public.education is
  'T03 field limits and canonical optional text values.';
comment on constraint certifications_t03_field_contract_check on public.certifications is
  'T03 field limits, HTTP(S) credential URL, and canonical optional text values.';
comment on constraint skills_t03_field_contract_check on public.skills is
  'T03 skill labels are trimmed and limited to 100 characters.';

alter table internal.operation_requests
  add column result_payload jsonb;

do $ledger_preflight$
begin
  if exists (
    select 1
    from internal.operation_requests
    where not (
      (result_table is null and result_id is null and completed_at is null)
      or (result_table is not null and result_id is not null and completed_at is not null)
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'T03 replay migration aborted: incomplete operation ledger rows exist. Inspect internal.operation_requests before retrying.';
  end if;

  if exists (
    select 1
    from internal.operation_requests
    where (operation_kind = 'experience.create' and result_table <> 'experiences')
       or (operation_kind = 'education.create' and result_table <> 'education')
       or (operation_kind = 'certification.create' and result_table <> 'certifications')
       or (operation_kind = 'skill.create' and result_table <> 'skills')
  ) then
    raise exception using
      errcode = '55000',
      message = 'T03 replay migration aborted: operation ledger result types do not match their create operation. Inspect internal.operation_requests before retrying.';
  end if;
end;
$ledger_preflight$;

update internal.operation_requests as operation
set result_payload = pg_catalog.to_jsonb(record_row)
from public.experiences as record_row
where operation.operation_kind = 'experience.create'
  and operation.completed_at is not null
  and operation.result_id = record_row.id
  and operation.user_id = record_row.user_id;

update internal.operation_requests as operation
set result_payload = pg_catalog.to_jsonb(record_row)
from public.education as record_row
where operation.operation_kind = 'education.create'
  and operation.completed_at is not null
  and operation.result_id = record_row.id
  and operation.user_id = record_row.user_id;

update internal.operation_requests as operation
set result_payload = pg_catalog.to_jsonb(record_row)
from public.certifications as record_row
where operation.operation_kind = 'certification.create'
  and operation.completed_at is not null
  and operation.result_id = record_row.id
  and operation.user_id = record_row.user_id;

update internal.operation_requests as operation
set result_payload = pg_catalog.to_jsonb(record_row)
from public.skills as record_row
where operation.operation_kind = 'skill.create'
  and operation.completed_at is not null
  and operation.result_id = record_row.id
  and operation.user_id = record_row.user_id;

-- An old result whose domain row was deleted cannot be reconstructed. Preserve
-- the ledger key and mark only those legacy rows as deterministically unavailable.
update internal.operation_requests
set result_payload = '{"__legacy_replay":"unavailable"}'::jsonb
where completed_at is not null
  and result_payload is null;

alter table internal.operation_requests
  drop constraint operation_requests_completion_check,
  add constraint operation_requests_completion_check check (
    (
      result_table is null
      and result_id is null
      and result_payload is null
      and completed_at is null
    )
    or (
      result_table is not null
      and result_id is not null
      and result_payload is not null
      and pg_catalog.jsonb_typeof(result_payload) = 'object'
      and completed_at is not null
    )
  );

comment on column internal.operation_requests.result_payload is
  'Private immutable result row snapshot for identical create replay. Pre-snapshot ledger rows with a deleted result carry the explicit __legacy_replay=unavailable marker.';

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
  v_existing_payload jsonb;
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
      operation_requests.result_payload,
      operation_requests.completed_at
    into
      v_existing_hash,
      v_existing_table,
      v_existing_id,
      v_existing_payload,
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

    if v_existing_payload = '{"__legacy_replay":"unavailable"}'::jsonb then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;

    if v_existing_payload is null
       or pg_catalog.jsonb_typeof(v_existing_payload) <> 'object'
       or v_existing_payload ->> 'id' is distinct from v_existing_id::text
       or v_existing_payload ->> 'user_id' is distinct from v_user_id::text then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;

    return v_existing_payload;
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
      result_payload = v_record,
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

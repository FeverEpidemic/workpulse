-- T16 Import commit transaction (DB §4 "Import commit transaction", PRD R02, F01 step 3-4).
-- Review choices are persisted on import_items through update_import_item; commit_import_batch
-- validates every selected item, creates foundation rows first, then achievements, and flips the
-- batch to committed in one transaction. Staging text never reaches an error, log or result.
-- Lock order: profile -> import batch -> import items (entity_type, ordinal) -> map targets (share) -> inserts.

-- 1. Columns and checks ---------------------------------------------------------------------

alter table public.import_items
  add column confirm_requested boolean not null default false;

alter table public.import_items
  add constraint import_items_confirm_check check (
    not confirm_requested or (entity_type = 'achievement' and action = 'create')
  );

comment on column public.import_items.confirm_requested is
  'T16: the user explicitly asked to confirm this achievement candidate at commit. Only valid for achievement create.';

alter table public.import_batches
  add column commit_result jsonb;

alter table public.import_batches
  add constraint import_batches_commit_result_check check (
    commit_result is null
    or (
      status = 'committed'
      and pg_catalog.jsonb_typeof(commit_result) = 'object'
      and pg_catalog.pg_column_size(commit_result) <= 4096
    )
  );

comment on column public.import_batches.commit_result is
  'T16: import-commit.v1 result (counts, booleans only). Returned again by a repeated commit.';

grant select (commit_result) on public.import_batches to authenticated;

-- Imported achievements keep the source excerpt but have no source Activity revision.
alter table public.achievements
  drop constraint achievements_source_pair_check,
  add constraint achievements_source_pair_check check (
    (origin <> 'import' and (source_excerpt is null) = (source_activity_revision is null))
    or (origin = 'import' and source_activity_revision is null)
  );

-- 2. Pure helpers --------------------------------------------------------------------------------

create or replace function internal.import_text(p_value jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when pg_catalog.jsonb_typeof(p_value) = 'string'
    then nullif(pg_catalog.btrim(p_value #>> '{}', E' \t\n\r'), '') end;
$$;

create or replace function internal.import_is_absent(p_value jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_value is null or pg_catalog.jsonb_typeof(p_value) = 'null';
$$;

create or replace function internal.import_text_error(p_value jsonb, p_required boolean, p_max integer)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_text text;
begin
  if internal.import_is_absent(p_value) then
    return case when p_required then 'REQUIRED' end;
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'string' then
    return 'INVALID';
  end if;
  v_text := pg_catalog.btrim(p_value #>> '{}', E' \t\n\r');
  if v_text = '' then
    return case when p_required then 'REQUIRED' end;
  end if;
  if pg_catalog.char_length(v_text) > p_max then
    return 'TOO_LONG';
  end if;
  return null;
end;
$$;

create or replace function internal.import_err(p_errors jsonb, p_field text, p_code text, p_existing uuid default null)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_code is null then p_errors
    else p_errors || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field', p_field, 'code', p_code)
      || case when p_existing is null then '{}'::jsonb else pg_catalog.jsonb_build_object('existing_id', p_existing) end
    ) end;
$$;

create or replace function internal.import_try_date(p_value jsonb)
returns date
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_value is null
     or pg_catalog.jsonb_typeof(p_value) <> 'string'
     or (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  return (p_value #>> '{}')::date;
exception when others then
  return null;
end;
$$;

create or replace function internal.import_date_pair_error(p_date jsonb, p_precision jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_date date;
begin
  if internal.import_is_absent(p_date) and internal.import_is_absent(p_precision) then
    return null;
  end if;
  if internal.import_is_absent(p_date) or internal.import_is_absent(p_precision)
     or pg_catalog.jsonb_typeof(p_precision) <> 'string' then
    return 'INVALID';
  end if;
  v_date := internal.import_try_date(p_date);
  if v_date is null or not internal.is_canonical_partial_date(v_date, p_precision #>> '{}') then
    return 'INVALID';
  end if;
  return null;
end;
$$;

create or replace function internal.import_interval_errors(p_payload jsonb, p_errors jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_errors jsonb := p_errors;
  v_start_error text := internal.import_date_pair_error(p_payload -> 'start_date', p_payload -> 'start_precision');
  v_end_error text := internal.import_date_pair_error(p_payload -> 'end_date', p_payload -> 'end_precision');
  v_current jsonb := p_payload -> 'is_current';
  v_is_current boolean := false;
  v_start date;
  v_end date;
begin
  v_errors := internal.import_err(v_errors, 'start_date', v_start_error);
  v_errors := internal.import_err(v_errors, 'end_date', v_end_error);
  if not internal.import_is_absent(v_current) then
    if pg_catalog.jsonb_typeof(v_current) <> 'boolean' then
      v_errors := internal.import_err(v_errors, 'is_current', 'INVALID');
    else
      v_is_current := v_current = 'true'::jsonb;
    end if;
  end if;
  if v_end_error is null and not internal.import_is_absent(p_payload -> 'end_date') then
    v_end := internal.import_try_date(p_payload -> 'end_date');
    if v_is_current then
      v_errors := internal.import_err(v_errors, 'end_date', 'DATE_RANGE');
    elsif v_start_error is null and not internal.import_is_absent(p_payload -> 'start_date') then
      v_start := internal.import_try_date(p_payload -> 'start_date');
      if internal.date_upper_bound(v_end, p_payload #>> '{end_precision}') < v_start then
        v_errors := internal.import_err(v_errors, 'end_date', 'DATE_RANGE');
      end if;
    end if;
  end if;
  return v_errors;
end;
$$;

create or replace function internal.import_url_error(p_value jsonb, p_max integer)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_error text := internal.import_text_error(p_value, false, p_max);
  v_text text := internal.import_text(p_value);
begin
  if v_error is not null then
    return v_error;
  end if;
  if v_text is not null and v_text !~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$' then
    return 'INVALID';
  end if;
  return null;
end;
$$;

create or replace function internal.import_experience_errors(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_errors jsonb := '[]'::jsonb;
  v_kind jsonb := p_payload -> 'kind';
begin
  v_errors := internal.import_err(v_errors, 'organization', internal.import_text_error(p_payload -> 'organization', true, 200));
  v_errors := internal.import_err(v_errors, 'role_title', internal.import_text_error(p_payload -> 'role_title', true, 200));
  if internal.import_is_absent(v_kind) then
    v_errors := internal.import_err(v_errors, 'kind', 'REQUIRED');
  elsif pg_catalog.jsonb_typeof(v_kind) <> 'string' or (v_kind #>> '{}') not in ('employment', 'internship', 'volunteer') then
    v_errors := internal.import_err(v_errors, 'kind', 'INVALID');
  end if;
  v_errors := internal.import_err(v_errors, 'description', internal.import_text_error(p_payload -> 'description', false, 5000));
  return internal.import_interval_errors(p_payload, v_errors);
end;
$$;

create or replace function internal.import_education_errors(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_errors jsonb := '[]'::jsonb;
begin
  v_errors := internal.import_err(v_errors, 'institution', internal.import_text_error(p_payload -> 'institution', true, 200));
  v_errors := internal.import_err(v_errors, 'qualification', internal.import_text_error(p_payload -> 'qualification', true, 200));
  v_errors := internal.import_err(v_errors, 'field_of_study', internal.import_text_error(p_payload -> 'field_of_study', false, 200));
  v_errors := internal.import_err(v_errors, 'description', internal.import_text_error(p_payload -> 'description', false, 5000));
  return internal.import_interval_errors(p_payload, v_errors);
end;
$$;

create or replace function internal.import_certification_errors(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_errors jsonb := '[]'::jsonb;
begin
  v_errors := internal.import_err(v_errors, 'name', internal.import_text_error(p_payload -> 'name', true, 200));
  v_errors := internal.import_err(v_errors, 'issuer', internal.import_text_error(p_payload -> 'issuer', false, 200));
  v_errors := internal.import_err(v_errors, 'issued_date',
    internal.import_date_pair_error(p_payload -> 'issued_date', p_payload -> 'issued_precision'));
  v_errors := internal.import_err(v_errors, 'credential_url', internal.import_url_error(p_payload -> 'credential_url', 2048));
  return v_errors;
end;
$$;

create or replace function internal.import_achievement_errors(p_payload jsonb, p_confirm boolean)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_errors jsonb := '[]'::jsonb;
  v_metrics jsonb := p_payload -> 'metrics';
  v_bullet_error text;
  v_fallback text;
begin
  v_errors := internal.import_err(v_errors, 'title', internal.import_text_error(p_payload -> 'title', p_confirm, 200));
  v_errors := internal.import_err(v_errors, 'contribution', internal.import_text_error(p_payload -> 'contribution', p_confirm, 5000));
  v_errors := internal.import_err(v_errors, 'outcome', internal.import_text_error(p_payload -> 'outcome', p_confirm, 5000));
  v_bullet_error := internal.import_text_error(p_payload -> 'cv_bullet', false, 2000);
  if v_bullet_error is null and p_confirm and internal.import_text(p_payload -> 'cv_bullet') is null then
    v_fallback := internal.factual_cv_bullet(internal.import_text(p_payload -> 'contribution'), internal.import_text(p_payload -> 'outcome'));
    if v_fallback is not null and pg_catalog.char_length(v_fallback) > 2000 then
      v_bullet_error := 'TOO_LONG';
    end if;
  end if;
  v_errors := internal.import_err(v_errors, 'cv_bullet', v_bullet_error);
  if internal.import_is_absent(p_payload -> 'achieved_on') then
    if p_confirm then
      v_errors := internal.import_err(v_errors, 'achieved_on', 'REQUIRED');
    end if;
  elsif internal.import_try_date(p_payload -> 'achieved_on') is null then
    v_errors := internal.import_err(v_errors, 'achieved_on', 'INVALID');
  end if;
  if internal.import_is_absent(v_metrics) then
    v_metrics := '[]'::jsonb;
  end if;
  if not internal.is_valid_achievement_metrics(v_metrics) then
    v_errors := internal.import_err(v_errors, 'metrics', 'INVALID');
  end if;
  return v_errors;
end;
$$;

create or replace function internal.import_profile_errors(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_errors jsonb := '[]'::jsonb;
  v_selected jsonb := p_payload -> 'selected_fields';
  v_field text;
  v_max integer;
  v_error text;
  v_text text;
  v_seen text[] := array[]::text[];
begin
  if internal.import_is_absent(v_selected) then
    return v_errors;
  end if;
  if pg_catalog.jsonb_typeof(v_selected) <> 'array' then
    return internal.import_err(v_errors, 'selected_fields', 'INVALID');
  end if;
  for v_field in select pg_catalog.jsonb_array_elements_text(v_selected) loop
    if v_field not in ('headline', 'summary', 'contact_email', 'phone', 'location', 'website') or v_field = any (v_seen) then
      v_errors := internal.import_err(v_errors, 'selected_fields', 'INVALID');
      continue;
    end if;
    v_seen := v_seen || v_field;
    v_max := case v_field when 'headline' then 120 when 'summary' then 2000 when 'contact_email' then 320
      when 'phone' then 40 when 'location' then 120 else 2048 end;
    v_error := internal.import_text_error(p_payload -> v_field, true, v_max);
    v_text := internal.import_text(p_payload -> v_field);
    if v_error is null and v_field = 'contact_email'
       and v_text !~* '^[A-Za-z0-9_+''-]+([.][A-Za-z0-9_+''-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then
      v_error := 'INVALID';
    end if;
    if v_error is null and v_field = 'website' and v_text !~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$' then
      v_error := 'INVALID';
    end if;
    v_errors := internal.import_err(v_errors, v_field, v_error);
  end loop;
  return v_errors;
end;
$$;

create or replace function internal.import_target_exists(p_entity_type text, p_user_id uuid, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  return case p_entity_type
    when 'experience' then exists (select 1 from public.experiences as t where t.user_id = p_user_id and t.id = p_id)
    when 'education' then exists (select 1 from public.education as t where t.user_id = p_user_id and t.id = p_id)
    when 'certification' then exists (select 1 from public.certifications as t where t.user_id = p_user_id and t.id = p_id)
    when 'skill' then exists (select 1 from public.skills as t where t.user_id = p_user_id and t.id = p_id)
    when 'achievement' then exists (select 1 from public.achievements as t where t.user_id = p_user_id and t.id = p_id)
    else false
  end;
end;
$$;

-- 3. Item guards ------------------------------------------------------------------------------------

create or replace function internal.validate_import_item_target()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.entity_type = 'profile' and (new.target_id is not null or new.committed_id is not null) then
    raise exception using errcode = '22023', message = 'IMPORT_TARGET_INVALID';
  end if;
  if (new.action = 'map') <> (new.target_id is not null) then
    raise exception using errcode = '22023', message = 'IMPORT_TARGET_INVALID';
  end if;
  if new.committed_id is not null and new.action <> 'create' then
    raise exception using errcode = '22023', message = 'IMPORT_TARGET_INVALID';
  end if;
  if new.target_id is not null
     and (tg_op = 'INSERT' or new.target_id is distinct from old.target_id)
     and not internal.import_target_exists(new.entity_type, new.user_id, new.target_id) then
    raise exception using errcode = '22023', message = 'IMPORT_TARGET_INVALID';
  end if;
  if new.committed_id is not null
     and (tg_op = 'INSERT' or new.committed_id is distinct from old.committed_id)
     and not internal.import_target_exists(new.entity_type, new.user_id, new.committed_id) then
    raise exception using errcode = '22023', message = 'IMPORT_TARGET_INVALID';
  end if;
  return new;
end;
$$;

create trigger import_items_validate_target
before insert or update of action, target_id, committed_id on public.import_items
for each row execute function internal.validate_import_item_target();

-- T15 body plus: committed_id is written only by commit_import_batch, and a committed batch's
-- items may change only by purge (payload and excerpt cleared together).
create or replace function internal.guard_import_item_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_status text;
begin
  if row(new.id, new.user_id, new.batch_id, new.entity_type, new.ordinal, new.created_at)
     is distinct from
     row(old.id, old.user_id, old.batch_id, old.entity_type, old.ordinal, old.created_at) then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_MUTATION';
  end if;
  if new.committed_id is distinct from old.committed_id
     and (old.committed_id is not null or coalesce(pg_catalog.current_setting('workpulse.import_commit', true), '') <> 'on') then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_MUTATION';
  end if;
  select batch.status into v_status from public.import_batches as batch where batch.id = old.batch_id;
  if v_status = 'committed' then
    if row(new.action, new.target_id, new.committed_id, new.confirm_requested, new.validation_errors)
       is distinct from
       row(old.action, old.target_id, old.committed_id, old.confirm_requested, old.validation_errors) then
      raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_MUTATION';
    end if;
    if row(new.payload, new.source_excerpt, new.purged_at) is distinct from row(old.payload, old.source_excerpt, old.purged_at)
       and not (new.payload is null and new.source_excerpt is null and new.purged_at is not null and old.purged_at is null) then
      raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_MUTATION';
    end if;
  end if;
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

-- 4. Shared validation ---------------------------------------------------------------------------------

create or replace function internal.import_item_errors(p_user_id uuid, p_batch_id uuid)
returns table (item_id uuid, field text, code text, existing_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_item public.import_items%rowtype;
  v_errors jsonb;
  v_error jsonb;
  v_text text;
  v_norm text;
  v_existing uuid;
  v_ref text;
  v_ref_ok boolean;
begin
  for v_item in
    select item.* from public.import_items as item
    where item.user_id = p_user_id and item.batch_id = p_batch_id and item.action <> 'skip'
    order by item.entity_type, item.ordinal
  loop
    v_errors := '[]'::jsonb;
    if v_item.payload is null then
      v_errors := internal.import_err(v_errors, 'payload', 'INVALID');
    elsif v_item.action = 'map' then
      if v_item.entity_type = 'profile' then
        v_errors := internal.import_err(v_errors, 'action', 'INVALID_ACTION');
      elsif v_item.target_id is null
            or not internal.import_target_exists(v_item.entity_type, p_user_id, v_item.target_id) then
        v_errors := internal.import_err(v_errors, 'target_id', 'TARGET_UNAVAILABLE');
      end if;
    elsif v_item.action <> 'create' then
      v_errors := internal.import_err(v_errors, 'action', 'INVALID_ACTION');
    elsif v_item.entity_type = 'profile' then
      v_errors := internal.import_profile_errors(v_item.payload);
    elsif v_item.entity_type = 'experience' then
      v_errors := internal.import_experience_errors(v_item.payload);
    elsif v_item.entity_type = 'education' then
      v_errors := internal.import_education_errors(v_item.payload);
    elsif v_item.entity_type = 'certification' then
      v_errors := internal.import_certification_errors(v_item.payload);
    elsif v_item.entity_type = 'skill' then
      v_errors := internal.import_err(v_errors, 'name', internal.import_text_error(v_item.payload -> 'name', true, 100));
      v_text := internal.import_text(v_item.payload -> 'name');
      if pg_catalog.jsonb_array_length(v_errors) = 0 and v_text is not null then
        v_norm := internal.normalize_skill_name(v_text);
        if v_norm = '' then
          v_errors := internal.import_err(v_errors, 'name', 'REQUIRED');
        else
          select skill.id into v_existing from public.skills as skill
          where skill.user_id = p_user_id and skill.normalized_name = v_norm;
          if v_existing is not null then
            v_errors := internal.import_err(v_errors, 'name', 'DUPLICATE', v_existing);
          elsif exists (
            select 1 from public.import_items as other
            where other.user_id = p_user_id and other.batch_id = p_batch_id
              and other.entity_type = 'skill' and other.action = 'create' and other.ordinal < v_item.ordinal
              and internal.normalize_skill_name(coalesce(internal.import_text(other.payload -> 'name'), '')) = v_norm
          ) then
            v_errors := internal.import_err(v_errors, 'name', 'DUPLICATE');
          end if;
        end if;
      end if;
      v_existing := null;
    elsif v_item.entity_type = 'achievement' then
      v_errors := internal.import_achievement_errors(v_item.payload, v_item.confirm_requested);
      if not internal.import_is_absent(v_item.payload -> 'experience_item_id') then
        v_ref := case when pg_catalog.jsonb_typeof(v_item.payload -> 'experience_item_id') = 'string'
          then v_item.payload ->> 'experience_item_id' end;
        v_ref_ok := v_ref is not null
          and v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and exists (
            select 1 from public.import_items as ref
            where ref.user_id = p_user_id and ref.batch_id = p_batch_id and ref.entity_type = 'experience'
              and ref.id::text = pg_catalog.lower(v_ref)
          );
        if not coalesce(v_ref_ok, false) then
          v_errors := internal.import_err(v_errors, 'experience_item_id', 'INVALID');
        end if;
      end if;
    end if;

    for v_error in select value from pg_catalog.jsonb_array_elements(v_errors) loop
      item_id := v_item.id;
      field := v_error ->> 'field';
      code := v_error ->> 'code';
      existing_id := nullif(v_error ->> 'existing_id', '')::uuid;
      return next;
    end loop;
  end loop;
end;
$$;

-- 5. Review RPCs -----------------------------------------------------------------------------------------

create or replace function public.update_import_item(
  p_item_id uuid,
  p_expected_revision integer,
  p_action text,
  p_target_id uuid,
  p_payload_patch jsonb,
  p_confirm_requested boolean
)
returns table (item_id uuid, item_revision integer, batch_revision integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.import_actor();
  v_batch_id uuid;
  v_batch public.import_batches%rowtype;
  v_item public.import_items%rowtype;
  v_action text;
  v_target uuid;
  v_confirm boolean;
  v_payload jsonb;
  v_allowed text[];
  v_key text;
  v_value jsonb;
  v_type text;
  v_ref text;
  v_ref_ok boolean;
  v_item_revision integer;
  v_batch_revision integer;
begin
  select item.batch_id into v_batch_id from public.import_items as item
  where item.user_id = v_user_id and item.id = p_item_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  select batch.* into v_batch from public.import_batches as batch
  where batch.user_id = v_user_id and batch.id = v_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  select item.* into v_item from public.import_items as item
  where item.user_id = v_user_id and item.id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  if v_batch.status <> 'review' or v_batch.purged_at is not null or v_item.payload is null then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_REVIEWABLE';
  end if;
  if v_item.revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

  if p_action is not null and p_action not in ('create', 'map', 'skip') then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_INPUT';
  end if;
  if p_payload_patch is not null and pg_catalog.jsonb_typeof(p_payload_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_INPUT';
  end if;

  v_action := coalesce(p_action, v_item.action);
  if v_action <> 'map' and p_target_id is not null then
    raise exception using errcode = '22023', message = 'IMPORT_TARGET_INVALID';
  end if;
  v_target := case when v_action = 'map' then coalesce(p_target_id, v_item.target_id) end;

  if p_confirm_requested is true and (v_item.entity_type <> 'achievement' or v_action <> 'create') then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_INPUT';
  end if;
  v_confirm := case when v_action = 'create' then coalesce(p_confirm_requested, v_item.confirm_requested) else false end;

  v_allowed := case v_item.entity_type
    when 'experience' then array['organization', 'role_title', 'kind', 'description', 'start_date', 'start_precision',
      'end_date', 'end_precision', 'is_current']
    when 'education' then array['institution', 'qualification', 'field_of_study', 'description', 'start_date',
      'start_precision', 'end_date', 'end_precision', 'is_current']
    when 'certification' then array['name', 'issuer', 'issued_date', 'issued_precision', 'credential_url']
    when 'skill' then array['name']
    when 'achievement' then array['title', 'contribution', 'outcome', 'cv_bullet', 'achieved_on', 'metrics', 'experience_item_id']
    else array['headline', 'summary', 'contact_email', 'phone', 'location', 'website', 'selected_fields', 'display_name']
  end;
  for v_key, v_value in select key, value from pg_catalog.jsonb_each(coalesce(p_payload_patch, '{}'::jsonb)) loop
    v_type := pg_catalog.jsonb_typeof(v_value);
    if not (v_key = any (v_allowed))
       or (v_key = 'is_current' and v_type <> 'boolean')
       or (v_key in ('metrics', 'selected_fields') and v_type <> 'array')
       or (v_key not in ('is_current', 'metrics', 'selected_fields') and v_type not in ('string', 'null')) then
      raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_INPUT';
    end if;
  end loop;
  v_payload := v_item.payload || coalesce(p_payload_patch, '{}'::jsonb);

  if p_payload_patch ? 'experience_item_id' and not internal.import_is_absent(p_payload_patch -> 'experience_item_id') then
    v_ref := p_payload_patch ->> 'experience_item_id';
    v_ref_ok := v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (
        select 1 from public.import_items as ref
        where ref.user_id = v_user_id and ref.batch_id = v_batch.id and ref.entity_type = 'experience'
          and ref.id::text = pg_catalog.lower(v_ref)
      );
    if not coalesce(v_ref_ok, false) then
      raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_INPUT';
    end if;
  end if;

  begin
    update public.import_items as item
    set action = v_action, target_id = v_target, payload = v_payload, confirm_requested = v_confirm
    where item.id = v_item.id
    returning item.revision into v_item_revision;
  exception when check_violation then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_ITEM_INPUT';
  end;
  update public.import_batches as batch
  set updated_at = batch.updated_at
  where batch.id = v_batch.id
  returning batch.revision into v_batch_revision;

  return query select v_item.id, v_item_revision, v_batch_revision;
end;
$$;

create or replace function public.validate_import_batch(p_batch_id uuid)
returns table (item_id uuid, field text, code text, existing_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.import_actor();
  v_batch public.import_batches%rowtype;
begin
  select batch.* into v_batch from public.import_batches as batch
  where batch.user_id = v_user_id and batch.id = p_batch_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  if v_batch.status <> 'review' or v_batch.purged_at is not null then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_REVIEWABLE';
  end if;
  return query select e.item_id, e.field, e.code, e.existing_id
    from internal.import_item_errors(v_user_id, v_batch.id) as e;
end;
$$;

-- 6. Commit ------------------------------------------------------------------------------------------------

create or replace function public.commit_import_batch(
  p_batch_id uuid,
  p_expected_revision integer,
  p_onboarding jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_batch public.import_batches%rowtype;
  v_item public.import_items%rowtype;
  v_errors jsonb;
  v_needs_onboarding boolean;
  v_name text;
  v_locale text;
  v_timezone text;
  v_new_id uuid;
  v_experience_id uuid;
  v_ref text;
  v_bullet text;
  v_selected jsonb := '[]'::jsonb;
  v_profile_payload jsonb := '{}'::jsonb;
  v_applied integer := 0;
  v_confirmed integer;
  v_counts jsonb;
  v_result jsonb;
  v_now timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select profile.* into v_profile from public.profiles as profile where profile.id = v_user_id for update;
  if not found or v_profile.deleting_at is not null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select batch.* into v_batch from public.import_batches as batch
  where batch.user_id = v_user_id and batch.id = p_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  if v_batch.status = 'committed' then
    return coalesce(v_batch.commit_result, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'batch_id', v_batch.id,
      'committed_at', pg_catalog.to_char(v_batch.committed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
  end if;
  if v_batch.status <> 'review' or v_batch.purged_at is not null then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_COMMITTABLE';
  end if;
  if v_batch.revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

  v_needs_onboarding := v_profile.onboarding_completed_at is null;
  if v_needs_onboarding then
    if p_onboarding is null or pg_catalog.jsonb_typeof(p_onboarding) <> 'object' then
      raise exception using errcode = '22023', message = 'ONBOARDING_REQUIRED';
    end if;
    v_name := internal.import_text(p_onboarding -> 'display_name');
    if v_name is null or not internal.is_real_display_name(v_name) or pg_catalog.char_length(v_name) > 80 then
      raise exception using errcode = '22023', message = 'INVALID_DISPLAY_NAME';
    end if;
    v_locale := case when pg_catalog.jsonb_typeof(p_onboarding -> 'locale') = 'string' then p_onboarding ->> 'locale' end;
    if v_locale is null or v_locale not in ('en', 'id') then
      raise exception using errcode = '22023', message = 'INVALID_LOCALE';
    end if;
    v_timezone := case when pg_catalog.jsonb_typeof(p_onboarding -> 'timezone') = 'string' then p_onboarding ->> 'timezone' end;
    if not internal.is_valid_timezone(v_timezone) then
      raise exception using errcode = '22023', message = 'INVALID_TIMEZONE';
    end if;
  end if;

  perform 1 from public.import_items as item
  where item.user_id = v_user_id and item.batch_id = v_batch.id
  order by item.entity_type, item.ordinal
  for update;

  perform 1 from public.experiences as target
  where target.user_id = v_user_id and target.id in (
    select item.target_id from public.import_items as item
    where item.batch_id = v_batch.id and item.entity_type = 'experience' and item.action = 'map')
  order by target.id for share;
  perform 1 from public.education as target
  where target.user_id = v_user_id and target.id in (
    select item.target_id from public.import_items as item
    where item.batch_id = v_batch.id and item.entity_type = 'education' and item.action = 'map')
  order by target.id for share;
  perform 1 from public.certifications as target
  where target.user_id = v_user_id and target.id in (
    select item.target_id from public.import_items as item
    where item.batch_id = v_batch.id and item.entity_type = 'certification' and item.action = 'map')
  order by target.id for share;
  perform 1 from public.skills as target
  where target.user_id = v_user_id and target.id in (
    select item.target_id from public.import_items as item
    where item.batch_id = v_batch.id and item.entity_type = 'skill' and item.action = 'map')
  order by target.id for share;
  perform 1 from public.achievements as target
  where target.user_id = v_user_id and target.id in (
    select item.target_id from public.import_items as item
    where item.batch_id = v_batch.id and item.entity_type = 'achievement' and item.action = 'map')
  order by target.id for share;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('item_id', e.item_id, 'field', e.field, 'code', e.code)
    || case when e.existing_id is null then '{}'::jsonb else pg_catalog.jsonb_build_object('existing_id', e.existing_id) end
  ), '[]'::jsonb) into v_errors
  from (select * from internal.import_item_errors(v_user_id, v_batch.id) limit 100) as e;
  if pg_catalog.jsonb_array_length(v_errors) > 0 then
    raise exception using errcode = '22023', message = 'IMPORT_ITEM_INVALID', detail = v_errors::text;
  end if;

  begin
    perform pg_catalog.set_config('workpulse.import_commit', 'on', true);

    for v_item in
      select item.* from public.import_items as item
      where item.batch_id = v_batch.id and item.entity_type = 'experience' and item.action = 'create'
      order by item.ordinal
    loop
      insert into public.experiences (
        user_id, organization, role_title, description, kind,
        start_date, start_precision, end_date, end_precision, is_current
      ) values (
        v_user_id, internal.import_text(v_item.payload -> 'organization'), internal.import_text(v_item.payload -> 'role_title'),
        internal.import_text(v_item.payload -> 'description'), internal.import_text(v_item.payload -> 'kind'),
        internal.import_try_date(v_item.payload -> 'start_date'), internal.import_text(v_item.payload -> 'start_precision'),
        internal.import_try_date(v_item.payload -> 'end_date'), internal.import_text(v_item.payload -> 'end_precision'),
        coalesce(v_item.payload -> 'is_current' = 'true'::jsonb, false)
      ) returning id into v_new_id;
      update public.import_items as item set committed_id = v_new_id where item.id = v_item.id;
    end loop;

    for v_item in
      select item.* from public.import_items as item
      where item.batch_id = v_batch.id and item.entity_type = 'education' and item.action = 'create'
      order by item.ordinal
    loop
      insert into public.education (
        user_id, institution, qualification, field_of_study, description,
        start_date, start_precision, end_date, end_precision, is_current
      ) values (
        v_user_id, internal.import_text(v_item.payload -> 'institution'), internal.import_text(v_item.payload -> 'qualification'),
        internal.import_text(v_item.payload -> 'field_of_study'), internal.import_text(v_item.payload -> 'description'),
        internal.import_try_date(v_item.payload -> 'start_date'), internal.import_text(v_item.payload -> 'start_precision'),
        internal.import_try_date(v_item.payload -> 'end_date'), internal.import_text(v_item.payload -> 'end_precision'),
        coalesce(v_item.payload -> 'is_current' = 'true'::jsonb, false)
      ) returning id into v_new_id;
      update public.import_items as item set committed_id = v_new_id where item.id = v_item.id;
    end loop;

    for v_item in
      select item.* from public.import_items as item
      where item.batch_id = v_batch.id and item.entity_type = 'certification' and item.action = 'create'
      order by item.ordinal
    loop
      insert into public.certifications (user_id, name, issuer, issued_date, issued_precision, credential_url)
      values (
        v_user_id, internal.import_text(v_item.payload -> 'name'), internal.import_text(v_item.payload -> 'issuer'),
        internal.import_try_date(v_item.payload -> 'issued_date'), internal.import_text(v_item.payload -> 'issued_precision'),
        internal.import_text(v_item.payload -> 'credential_url')
      ) returning id into v_new_id;
      update public.import_items as item set committed_id = v_new_id where item.id = v_item.id;
    end loop;

    for v_item in
      select item.* from public.import_items as item
      where item.batch_id = v_batch.id and item.entity_type = 'skill' and item.action = 'create'
      order by item.ordinal
    loop
      insert into public.skills (user_id, name)
      values (v_user_id, internal.import_text(v_item.payload -> 'name'))
      returning id into v_new_id;
      update public.import_items as item set committed_id = v_new_id where item.id = v_item.id;
    end loop;

    for v_item in
      select item.* from public.import_items as item
      where item.batch_id = v_batch.id and item.entity_type = 'achievement' and item.action = 'create'
      order by item.ordinal
    loop
      v_experience_id := null;
      v_ref := internal.import_text(v_item.payload -> 'experience_item_id');
      if v_ref is not null then
        select case ref.action when 'create' then ref.committed_id when 'map' then ref.target_id end
        into v_experience_id
        from public.import_items as ref
        where ref.batch_id = v_batch.id and ref.entity_type = 'experience' and ref.id = v_ref::uuid;
      end if;
      v_bullet := internal.import_text(v_item.payload -> 'cv_bullet');
      if v_item.confirm_requested and v_bullet is null then
        v_bullet := internal.factual_cv_bullet(
          internal.import_text(v_item.payload -> 'contribution'), internal.import_text(v_item.payload -> 'outcome'));
      end if;
      insert into public.achievements (
        user_id, experience_id, title, contribution, outcome, cv_bullet, achieved_on,
        status, origin, source_excerpt, metrics
      ) values (
        v_user_id, v_experience_id, internal.import_text(v_item.payload -> 'title'),
        internal.import_text(v_item.payload -> 'contribution'), internal.import_text(v_item.payload -> 'outcome'),
        v_bullet, internal.import_try_date(v_item.payload -> 'achieved_on'),
        case when v_item.confirm_requested then 'confirmed' else 'draft' end, 'import', v_item.source_excerpt,
        case when pg_catalog.jsonb_typeof(v_item.payload -> 'metrics') = 'array' then v_item.payload -> 'metrics' else '[]'::jsonb end
      ) returning id into v_new_id;
      update public.import_items as item set committed_id = v_new_id where item.id = v_item.id;
    end loop;

    perform pg_catalog.set_config('workpulse.import_commit', 'off', true);

    select item.payload into v_profile_payload from public.import_items as item
    where item.batch_id = v_batch.id and item.entity_type = 'profile' and item.action = 'create';
    if found then
      v_selected := coalesce(v_profile_payload -> 'selected_fields', '[]'::jsonb);
      v_applied := pg_catalog.jsonb_array_length(v_selected);
    end if;
    if v_applied > 0 or v_needs_onboarding then
      update public.profiles as profile
      set headline = case when v_selected ? 'headline' then internal.import_text(v_profile_payload -> 'headline') else profile.headline end,
          summary = case when v_selected ? 'summary' then internal.import_text(v_profile_payload -> 'summary') else profile.summary end,
          contact_email = case when v_selected ? 'contact_email' then internal.import_text(v_profile_payload -> 'contact_email') else profile.contact_email end,
          phone = case when v_selected ? 'phone' then internal.import_text(v_profile_payload -> 'phone') else profile.phone end,
          location = case when v_selected ? 'location' then internal.import_text(v_profile_payload -> 'location') else profile.location end,
          website = case when v_selected ? 'website' then internal.import_text(v_profile_payload -> 'website') else profile.website end,
          display_name = case when v_needs_onboarding then v_name else profile.display_name end,
          locale = case when v_needs_onboarding then v_locale else profile.locale end,
          timezone = case when v_needs_onboarding then v_timezone else profile.timezone end,
          onboarding_completed_at = case when v_needs_onboarding then pg_catalog.now() else profile.onboarding_completed_at end
      where profile.id = v_user_id;
    end if;

    select pg_catalog.jsonb_object_agg(kind.entity_type, pg_catalog.jsonb_build_object(
      'created', coalesce(tally.created, 0), 'mapped', coalesce(tally.mapped, 0), 'skipped', coalesce(tally.skipped, 0)))
    into v_counts
    from (values ('profile'), ('experience'), ('education'), ('certification'), ('skill'), ('achievement')) as kind(entity_type)
    left join (
      select item.entity_type,
             pg_catalog.count(*) filter (where item.action = 'create') as created,
             pg_catalog.count(*) filter (where item.action = 'map') as mapped,
             pg_catalog.count(*) filter (where item.action = 'skip') as skipped
      from public.import_items as item where item.batch_id = v_batch.id group by item.entity_type
    ) as tally on tally.entity_type = kind.entity_type;
    select pg_catalog.count(*)::integer into v_confirmed from public.import_items as item
    where item.batch_id = v_batch.id and item.entity_type = 'achievement' and item.action = 'create' and item.confirm_requested;
    v_result := pg_catalog.jsonb_build_object(
      'schema_version', 'import-commit.v1', 'counts', v_counts, 'confirmed_achievements', v_confirmed,
      'profile_fields_applied', v_applied, 'onboarding_completed', v_needs_onboarding);

    v_now := pg_catalog.clock_timestamp();
    update public.import_batches as batch
    set status = 'committed', committed_at = v_now, expires_at = v_now, commit_result = v_result
    where batch.id = v_batch.id
    returning batch.* into v_batch;
  exception when check_violation or not_null_violation or unique_violation or foreign_key_violation
      or invalid_parameter_value or string_data_right_truncation or invalid_text_representation
      or datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode = '22023', message = 'IMPORT_ITEM_INVALID';
  end;

  return v_result || pg_catalog.jsonb_build_object(
    'batch_id', v_batch.id,
    'committed_at', pg_catalog.to_char(v_batch.committed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
end;
$$;

-- 7. Privileges -------------------------------------------------------------------------------------------------

revoke all on function internal.import_text(jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.import_is_absent(jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.import_text_error(jsonb, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function internal.import_err(jsonb, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function internal.import_try_date(jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.import_date_pair_error(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.import_interval_errors(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.import_url_error(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function internal.import_experience_errors(jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.import_education_errors(jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.import_certification_errors(jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.import_achievement_errors(jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function internal.import_profile_errors(jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.import_target_exists(text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function internal.validate_import_item_target() from public, anon, authenticated, service_role;
revoke all on function internal.guard_import_item_row() from public, anon, authenticated, service_role;
revoke all on function internal.import_item_errors(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.update_import_item(uuid, integer, text, uuid, jsonb, boolean) from public, anon, service_role;
revoke all on function public.validate_import_batch(uuid) from public, anon, service_role;
revoke all on function public.commit_import_batch(uuid, integer, jsonb) from public, anon, service_role;
grant execute on function public.update_import_item(uuid, integer, text, uuid, jsonb, boolean) to authenticated;
grant execute on function public.validate_import_batch(uuid) to authenticated;
grant execute on function public.commit_import_batch(uuid, integer, jsonb) to authenticated;

comment on function public.update_import_item(uuid, integer, text, uuid, jsonb, boolean) is
  'T16: persists one review choice (action, map target, payload patch, confirm request). Revision-guarded; only for review batches.';
comment on function public.validate_import_batch(uuid) is
  'T16: dry-run of the commit validation. Returns item ids, fields and codes only; writes nothing.';
comment on function public.commit_import_batch(uuid, integer, jsonb) is
  'T16: atomic, idempotent import commit. A repeated call returns the stored result; any invalid selected item rolls back everything.';

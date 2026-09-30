-- T19 CV builder and overrides (PRD R09, F07, S13, DB §5/§6, decision 0025).
-- Forward-only. Adds one RPC that saves every text edit of the master CV in a single transaction and one
-- revision step. No table or column is added and no T18 object is changed.
-- Lock order (decision 0024): profile (share) -> cv_documents (update) -> touched cv_items (update, by id).
-- Source tables are never locked or written by this RPC.

-- 1. Display override validation ----------------------------------------------------------------------------

-- Optional display overrides kept under cv_documents.profile_snapshot -> 'display_overrides'.
-- Limits follow the canonical profile columns (T03): display_name 80, headline 120, contact_email 320,
-- phone 40, location 120, website 2048 with an http(s) scheme.
create or replace function internal.cv_profile_overrides_valid(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_value jsonb;
  v_text text;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for v_key, v_value in select key, value from pg_catalog.jsonb_each(p) loop
    if pg_catalog.jsonb_typeof(v_value) <> 'string' then
      return false;
    end if;
    v_text := v_value #>> '{}';
    if v_text <> pg_catalog.btrim(v_text, E' \t\n\r') or v_text = '' then
      return false;
    end if;
    case v_key
      when 'display_name' then
        if pg_catalog.char_length(v_text) > 80 then return false; end if;
      when 'headline' then
        if pg_catalog.char_length(v_text) > 120 then return false; end if;
      when 'contact_email' then
        if pg_catalog.char_length(v_text) > 320
           or v_text !~* '^[A-Za-z0-9_+''-]+([.][A-Za-z0-9_+''-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then
          return false;
        end if;
      when 'phone' then
        if pg_catalog.char_length(v_text) > 40 then return false; end if;
      when 'location' then
        if pg_catalog.char_length(v_text) > 120 then return false; end if;
      when 'website' then
        if pg_catalog.char_length(v_text) > 2048 or v_text !~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$' then
          return false;
        end if;
      else
        return false;
    end case;
  end loop;
  return true;
end;
$$;

grant execute on function internal.cv_profile_overrides_valid(jsonb) to authenticated, service_role;

alter table public.cv_documents
  add constraint cv_documents_profile_overrides_check check (
    (profile_snapshot -> 'display_overrides') is null
    or internal.cv_profile_overrides_valid(profile_snapshot -> 'display_overrides')
  );

-- 2. RPC ----------------------------------------------------------------------------------------------------

-- p_edits keys (at least one): title, summary_override, profile_overrides (object), item_overrides (array of
-- {item_id, override_text}). null or blank clears an override. Returns the CV revision after the save; a save
-- without an effective change writes nothing and returns the current revision.
create or replace function public.save_cv_edits(p_expected_revision integer, p_edits jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.cv_actor();
  v_onboarded timestamptz;
  v_cv public.cv_documents%rowtype;
  v_key text;
  v_value jsonb;
  v_text text;
  v_has_title boolean := false;
  v_title text;
  v_has_summary boolean := false;
  v_summary text;
  v_old_overrides jsonb;
  v_new_overrides jsonb;
  v_has_profile boolean := false;
  v_item jsonb;
  v_item_ids uuid[] := array[]::uuid[];
  v_item_texts text[] := array[]::text[];
  v_item_id uuid;
  v_found integer;
  v_changed boolean := false;
  v_new_revision integer;
  v_current record;
begin
  select profile.onboarding_completed_at into v_onboarded from public.profiles as profile where profile.id = v_user_id;
  if v_onboarded is null then
    raise exception using errcode = '22023', message = 'ONBOARDING_REQUIRED';
  end if;
  if p_expected_revision is null or p_edits is null or pg_catalog.jsonb_typeof(p_edits) <> 'object'
     or p_edits = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;
  for v_key in select key from pg_catalog.jsonb_object_keys(p_edits) as keys(key) loop
    if v_key not in ('title', 'summary_override', 'profile_overrides', 'item_overrides') then
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
  end loop;

  v_cv := internal.cv_lock(v_user_id, p_expected_revision);

  -- title: required text when present.
  if p_edits ? 'title' then
    if pg_catalog.jsonb_typeof(p_edits -> 'title') <> 'string' then
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
    v_title := pg_catalog.btrim(p_edits ->> 'title', E' \t\n\r');
    if v_title = '' or pg_catalog.char_length(v_title) > 120 then
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
    v_has_title := true;
  end if;

  -- summary_override: null or blank clears.
  if p_edits ? 'summary_override' then
    v_value := p_edits -> 'summary_override';
    if pg_catalog.jsonb_typeof(v_value) = 'null' then
      v_summary := null;
    elsif pg_catalog.jsonb_typeof(v_value) = 'string' then
      v_summary := pg_catalog.btrim(v_value #>> '{}', E' \t\n\r');
      if v_summary = '' then
        v_summary := null;
      elsif pg_catalog.char_length(v_summary) > 5000 then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
    else
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
    v_has_summary := true;
  end if;

  -- profile_overrides: a patch; a null or blank value removes that key.
  v_old_overrides := coalesce(v_cv.profile_snapshot -> 'display_overrides', '{}'::jsonb);
  v_new_overrides := v_old_overrides;
  if p_edits ? 'profile_overrides' then
    if pg_catalog.jsonb_typeof(p_edits -> 'profile_overrides') <> 'object' then
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
    for v_key, v_value in select key, value from pg_catalog.jsonb_each(p_edits -> 'profile_overrides') loop
      if v_key not in ('display_name', 'headline', 'contact_email', 'phone', 'location', 'website') then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
      if pg_catalog.jsonb_typeof(v_value) = 'null' then
        v_new_overrides := v_new_overrides - v_key;
      elsif pg_catalog.jsonb_typeof(v_value) = 'string' then
        v_text := pg_catalog.btrim(v_value #>> '{}', E' \t\n\r');
        if v_text = '' then
          v_new_overrides := v_new_overrides - v_key;
        else
          v_new_overrides := v_new_overrides || pg_catalog.jsonb_build_object(v_key, v_text);
        end if;
      else
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
    end loop;
    if not internal.cv_profile_overrides_valid(v_new_overrides) then
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
    v_has_profile := true;
  end if;

  -- item_overrides: at most 200 unique items.
  if p_edits ? 'item_overrides' then
    if pg_catalog.jsonb_typeof(p_edits -> 'item_overrides') <> 'array'
       or pg_catalog.jsonb_array_length(p_edits -> 'item_overrides') > 200 then
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_edits -> 'item_overrides') as items(value) loop
      if pg_catalog.jsonb_typeof(v_item) <> 'object' or not (v_item ? 'item_id') or not (v_item ? 'override_text') then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
      for v_key in select key from pg_catalog.jsonb_object_keys(v_item) as keys(key) loop
        if v_key not in ('item_id', 'override_text') then
          raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
        end if;
      end loop;
      if pg_catalog.jsonb_typeof(v_item -> 'item_id') <> 'string'
         or (v_item ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
      v_item_id := (v_item ->> 'item_id')::uuid;
      if v_item_id = any (v_item_ids) then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
      v_value := v_item -> 'override_text';
      if pg_catalog.jsonb_typeof(v_value) = 'null' then
        v_text := null;
      elsif pg_catalog.jsonb_typeof(v_value) = 'string' then
        v_text := pg_catalog.btrim(v_value #>> '{}', E' \t\n\r');
        if v_text = '' then
          v_text := null;
        elsif pg_catalog.char_length(v_text) > 2000 then
          raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
        end if;
      else
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
      v_item_ids := pg_catalog.array_append(v_item_ids, v_item_id);
      v_item_texts := pg_catalog.array_append(v_item_texts, v_text);
    end loop;
  end if;

  -- Lock the touched items by id; anything not owned by this CV is indistinguishable from missing.
  if pg_catalog.cardinality(v_item_ids) > 0 then
    v_found := 0;
    for v_current in
      select item.id, item.section_key, item.override_text from public.cv_items as item
      where item.user_id = v_user_id and item.cv_id = v_cv.id and item.id = any (v_item_ids)
      order by item.id
      for update
    loop
      v_found := v_found + 1;
    end loop;
    if v_found <> pg_catalog.cardinality(v_item_ids) then
      raise exception using errcode = 'P0001', message = 'CV_ITEM_NOT_FOUND';
    end if;
    if exists (
      select 1
      from rows from (pg_catalog.unnest(v_item_ids), pg_catalog.unnest(v_item_texts)) as requested(item_id, override_text)
      join public.cv_items as item on item.id = requested.item_id
      where requested.override_text is not null and item.section_key in ('skills', 'certifications')
    ) then
      raise exception using errcode = 'P0001', message = 'CV_OVERRIDE_UNSUPPORTED';
    end if;
  end if;

  if (v_has_title and v_title is distinct from v_cv.title)
     or (v_has_summary and v_summary is distinct from v_cv.summary_override)
     or (v_has_profile and v_new_overrides is distinct from v_old_overrides) then
    v_changed := true;
  end if;
  if not v_changed and pg_catalog.cardinality(v_item_ids) > 0 then
    v_changed := exists (
      select 1
      from rows from (pg_catalog.unnest(v_item_ids), pg_catalog.unnest(v_item_texts)) as requested(item_id, override_text)
      join public.cv_items as item on item.id = requested.item_id
      where requested.override_text is distinct from item.override_text
    );
  end if;
  if not v_changed then
    return v_cv.revision;
  end if;

  if pg_catalog.cardinality(v_item_ids) > 0 then
    update public.cv_items as item
    set override_text = requested.override_text
    from rows from (pg_catalog.unnest(v_item_ids), pg_catalog.unnest(v_item_texts)) as requested(item_id, override_text)
    where item.id = requested.item_id and item.override_text is distinct from requested.override_text;
  end if;

  begin
    update public.cv_documents as document
    set title = case when v_has_title then v_title else document.title end,
        summary_override = case when v_has_summary then v_summary else document.summary_override end,
        profile_snapshot = case
          when not v_has_profile then document.profile_snapshot
          when v_new_overrides = '{}'::jsonb then document.profile_snapshot - 'display_overrides'
          else pg_catalog.jsonb_set(document.profile_snapshot, '{display_overrides}', v_new_overrides, true)
        end
    where document.id = v_cv.id
    returning document.revision into v_new_revision;
  exception when check_violation then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end;
  return v_new_revision;
end;
$$;

revoke all on function public.save_cv_edits(integer, jsonb) from public, anon, service_role;
grant execute on function public.save_cv_edits(integer, jsonb) to authenticated;

comment on function public.save_cv_edits(integer, jsonb) is
  'Saves CV title, summary override, profile display overrides and item wording overrides in one transaction and one revision step. Never writes source snapshots or canonical rows.';

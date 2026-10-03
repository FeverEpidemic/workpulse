-- T20 CV freshness and source deletion (PRD R03/R09, F03/F07, DB §2/§5/§6, decision 0026).
-- Forward-only; no table or column is added. Freshness is computed when read, never written when a source is
-- edited: a source edit does not touch cv_items or cv_documents.
-- Lock order of every CV-aware path (decision 0026):
--   profile (share) -> cv_documents (update) -> touched cv_items (update, by id)
--   -> sources (share, canonical type order experience, project, achievement, education, skill, certification; by id).
-- Source-delete paths take profile (share) and cv_documents (update) first through
-- internal.cv_lock_for_source_change and only then lock the source, so they serialize per account with every
-- CV RPC and cannot form a cycle with it. select_cv_source locks an achievement's parent before the achievement,
-- the same order relink_achievement_project already uses.

-- 1. State helpers (single definition of freshness, reused by T21) -----------------------------------------

-- Live source of an item: type, id, live revision, live display snapshot and, for achievements, the status.
-- No row when the item has no live source.
create or replace function internal.cv_live_source(p_item public.cv_items)
returns table (source_type text, source_id uuid, live_revision integer, live_snapshot jsonb, achievement_status text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_type text;
  v_id uuid;
  v_revision integer;
  v_status text;
begin
  if p_item.source_deleted then
    return;
  end if;
  if p_item.experience_id is not null then
    v_type := 'experience'; v_id := p_item.experience_id;
  elsif p_item.project_id is not null then
    v_type := 'project'; v_id := p_item.project_id;
  elsif p_item.achievement_id is not null then
    v_type := 'achievement'; v_id := p_item.achievement_id;
  elsif p_item.education_id is not null then
    v_type := 'education'; v_id := p_item.education_id;
  elsif p_item.skill_id is not null then
    v_type := 'skill'; v_id := p_item.skill_id;
  elsif p_item.certification_id is not null then
    v_type := 'certification'; v_id := p_item.certification_id;
  else
    return;
  end if;
  v_revision := internal.cv_source_revision(p_item.user_id, v_type, v_id);
  if v_revision is null then
    return;
  end if;
  if v_type = 'achievement' then
    select achievement.status into v_status
    from public.achievements as achievement
    where achievement.user_id = p_item.user_id and achievement.id = v_id;
  end if;
  return query select v_type, v_id, v_revision, internal.cv_source_snapshot(p_item.user_id, v_type, v_id), v_status;
end;
$$;

-- deleted > unconfirmed > fresh > kept > changed. A source revision that moved without changing any displayed
-- field is fresh; keep applies only to the exact live revision that was acknowledged.
create or replace function internal.cv_item_state(p_item public.cv_items)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_revision integer;
  v_snapshot jsonb;
  v_status text;
  v_found boolean;
begin
  if p_item.source_deleted then
    return 'deleted';
  end if;
  select true, source.live_revision, source.live_snapshot, source.achievement_status
  into v_found, v_revision, v_snapshot, v_status
  from internal.cv_live_source(p_item) as source;
  if v_found is null then
    return 'deleted';
  end if;
  if v_status is not null and v_status <> 'confirmed' then
    return 'unconfirmed';
  end if;
  if v_revision = p_item.source_revision or v_snapshot = p_item.source_snapshot then
    return 'fresh';
  end if;
  if p_item.acknowledged_revision is not null and v_revision = p_item.acknowledged_revision then
    return 'kept';
  end if;
  return 'changed';
end;
$$;

-- The seven profile fields a CV copies (cv-profile.v1), read live.
create or replace function internal.cv_profile_display(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'display_name', profile.display_name,
    'headline', profile.headline,
    'summary', profile.summary,
    'contact_email', profile.contact_email,
    'phone', profile.phone,
    'location', profile.location,
    'website', profile.website
  )
  from public.profiles as profile
  where profile.id = p_user_id
$$;

-- fresh when the seven live fields equal the saved source fields (display_overrides and schema_version are
-- ignored); kept when the live profile revision is the acknowledged one; otherwise changed.
create or replace function internal.cv_profile_state(p_document public.cv_documents)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_live jsonb := internal.cv_profile_display(p_document.user_id);
  v_saved jsonb;
  v_revision integer;
begin
  if v_live is null then
    return 'fresh';
  end if;
  v_saved := pg_catalog.jsonb_build_object(
    'display_name', coalesce(p_document.profile_snapshot -> 'display_name', 'null'::pg_catalog.jsonb),
    'headline', coalesce(p_document.profile_snapshot -> 'headline', 'null'::pg_catalog.jsonb),
    'summary', coalesce(p_document.profile_snapshot -> 'summary', 'null'::pg_catalog.jsonb),
    'contact_email', coalesce(p_document.profile_snapshot -> 'contact_email', 'null'::pg_catalog.jsonb),
    'phone', coalesce(p_document.profile_snapshot -> 'phone', 'null'::pg_catalog.jsonb),
    'location', coalesce(p_document.profile_snapshot -> 'location', 'null'::pg_catalog.jsonb),
    'website', coalesce(p_document.profile_snapshot -> 'website', 'null'::pg_catalog.jsonb)
  );
  if v_saved = v_live then
    return 'fresh';
  end if;
  select profile.revision into v_revision from public.profiles as profile where profile.id = p_document.user_id;
  if p_document.profile_ack_revision is not null and p_document.profile_ack_revision = v_revision then
    return 'kept';
  end if;
  return 'changed';
end;
$$;

-- Takes the CV side of the lock order before a source is locked for deletion. Returns the CV id, or null when
-- the account has no CV yet.
create or replace function internal.cv_lock_for_source_change(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_cv_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;
  perform 1 from public.profiles as profile where profile.id = p_user_id for share;
  select document.id into v_cv_id
  from public.cv_documents as document
  where document.user_id = p_user_id
  for update;
  return v_cv_id;
end;
$$;

revoke all on function internal.cv_live_source(public.cv_items) from public, anon, authenticated, service_role;
revoke all on function internal.cv_item_state(public.cv_items) from public, anon, authenticated, service_role;
revoke all on function internal.cv_profile_display(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.cv_profile_state(public.cv_documents) from public, anon, authenticated, service_role;
revoke all on function internal.cv_lock_for_source_change(uuid) from public, anon, authenticated, service_role;

-- 2. Read RPCs ---------------------------------------------------------------------------------------------------

-- One row per item plus one profile row. live_snapshot (display fields only) is set for changed and kept rows.
create or replace function public.get_cv_freshness()
returns table (target text, item_id uuid, state text, live_revision integer, live_snapshot jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_document public.cv_documents%rowtype;
  v_item public.cv_items%rowtype;
  v_state text;
  v_revision integer;
  v_snapshot jsonb;
  v_profile_revision integer;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles as profile where profile.id = v_user_id and profile.deleting_at is null) then
    return;
  end if;
  select document.* into v_document from public.cv_documents as document where document.user_id = v_user_id;
  if not found then
    return;
  end if;

  for v_item in
    select item.* from public.cv_items as item
    where item.user_id = v_user_id and item.cv_id = v_document.id
    order by item.section_key, item.position
  loop
    v_state := internal.cv_item_state(v_item);
    v_revision := null;
    v_snapshot := null;
    select source.live_revision, source.live_snapshot into v_revision, v_snapshot
    from internal.cv_live_source(v_item) as source;
    return query select 'item'::text, v_item.id, v_state, v_revision,
      case when v_state in ('changed', 'kept') then v_snapshot end;
  end loop;

  v_state := internal.cv_profile_state(v_document);
  select profile.revision into v_profile_revision from public.profiles as profile where profile.id = v_user_id;
  return query select 'profile'::text, null::uuid, v_state, v_profile_revision,
    case when v_state in ('changed', 'kept') then internal.cv_profile_display(v_user_id) end;
end;
$$;

-- review_count: changed, deleted and unconfirmed items plus a changed profile.
-- available_count: confirmed achievements that have no CV item.
create or replace function public.get_cv_review_summary()
returns table (has_cv boolean, review_count integer, available_count integer)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_document public.cv_documents%rowtype;
  v_item public.cv_items%rowtype;
  v_review integer := 0;
  v_available integer;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles as profile where profile.id = v_user_id and profile.deleting_at is null) then
    return;
  end if;
  select pg_catalog.count(*)::integer into v_available
  from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.status = 'confirmed'
    and not exists (
      select 1 from public.cv_items as item where item.user_id = v_user_id and item.achievement_id = achievement.id
    );
  select document.* into v_document from public.cv_documents as document where document.user_id = v_user_id;
  if not found then
    return query select false, 0, v_available;
    return;
  end if;
  for v_item in
    select item.* from public.cv_items as item where item.user_id = v_user_id and item.cv_id = v_document.id
  loop
    if internal.cv_item_state(v_item) in ('changed', 'deleted', 'unconfirmed') then
      v_review := v_review + 1;
    end if;
  end loop;
  if internal.cv_profile_state(v_document) = 'changed' then
    v_review := v_review + 1;
  end if;
  return query select true, v_review, v_available;
end;
$$;

-- 3. resolve_cv_freshness ----------------------------------------------------------------------------------------

-- p_resolutions: 1-200 objects {target: item|profile, item_id (item only), source_revision, action: keep|refresh|replace}.
-- keep records the acknowledged live revision; refresh copies the live display fields and never touches
-- override_text; replace is refresh plus clearing the override(s). One revision step for the whole batch.
create or replace function public.resolve_cv_freshness(p_expected_revision integer, p_resolutions jsonb)
returns table (cv_revision integer, added_parent_item_ids uuid[])
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.cv_actor();
  v_onboarded timestamptz;
  v_cv public.cv_documents%rowtype;
  v_element jsonb;
  v_key text;
  v_num numeric;
  v_target text;
  v_action text;
  v_item_id uuid;
  v_targets text[] := array[]::text[];
  v_item_ids uuid[] := array[]::uuid[];
  v_revisions integer[] := array[]::integer[];
  v_actions text[] := array[]::text[];
  v_requested uuid[];
  v_profile_entries integer := 0;
  v_count integer;
  v_found integer;
  v_index integer;
  v_item public.cv_items%rowtype;
  v_state text;
  v_live_revision integer;
  v_live_snapshot jsonb;
  v_lock_types text[] := array[]::text[];
  v_lock_ids uuid[] := array[]::uuid[];
  v_lock_required boolean[] := array[]::boolean[];
  v_pre_parent_type text[] := array[]::text[];
  v_pre_parent_id uuid[] := array[]::uuid[];
  v_type text;
  v_lock record;
  v_pp uuid;
  v_pe uuid;
  v_parent_type text;
  v_parent_id uuid;
  v_parent_item uuid;
  v_added uuid[] := array[]::uuid[];
  v_new_profile jsonb;
  v_new_profile_revision integer;
  v_new_ack integer;
  v_new_summary text;
  v_profile_live jsonb;
  v_profile_revision integer;
  v_new_revision integer;
begin
  select profile.onboarding_completed_at into v_onboarded from public.profiles as profile where profile.id = v_user_id;
  if v_onboarded is null then
    raise exception using errcode = '22023', message = 'ONBOARDING_REQUIRED';
  end if;
  if p_resolutions is null or pg_catalog.jsonb_typeof(p_resolutions) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;
  v_count := pg_catalog.jsonb_array_length(p_resolutions);
  if v_count < 1 or v_count > 200 then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;

  -- Shape validation; the message never carries input values.
  for v_element in select value from pg_catalog.jsonb_array_elements(p_resolutions) as elements(value) loop
    if pg_catalog.jsonb_typeof(v_element) <> 'object' then
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
    for v_key in select key from pg_catalog.jsonb_object_keys(v_element) as keys(key) loop
      if v_key not in ('target', 'item_id', 'source_revision', 'action') then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
    end loop;
    if pg_catalog.jsonb_typeof(v_element -> 'target') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_element -> 'action') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_element -> 'source_revision') is distinct from 'number' then
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
    v_target := v_element ->> 'target';
    v_action := v_element ->> 'action';
    v_num := (v_element ->> 'source_revision')::numeric;
    if v_target not in ('item', 'profile') or v_action not in ('keep', 'refresh', 'replace')
       or v_num <> pg_catalog.trunc(v_num) or v_num < 1 or v_num > 2147483647 then
      raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
    end if;
    if v_target = 'item' then
      if pg_catalog.jsonb_typeof(v_element -> 'item_id') is distinct from 'string'
         or (v_element ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
      v_item_id := (v_element ->> 'item_id')::uuid;
      if v_item_id = any (v_item_ids) then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
    else
      if v_element ? 'item_id' then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
      v_profile_entries := v_profile_entries + 1;
      if v_profile_entries > 1 then
        raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
      end if;
      v_item_id := null;
    end if;
    v_targets := pg_catalog.array_append(v_targets, v_target);
    v_item_ids := pg_catalog.array_append(v_item_ids, v_item_id);
    v_revisions := pg_catalog.array_append(v_revisions, v_num::integer);
    v_actions := pg_catalog.array_append(v_actions, v_action);
  end loop;

  v_cv := internal.cv_lock(v_user_id, p_expected_revision);

  -- Touched items, locked by id; another account's item is indistinguishable from a missing one.
  select coalesce(pg_catalog.array_agg(requested.id), array[]::uuid[]) into v_requested
  from pg_catalog.unnest(v_item_ids) as requested(id)
  where requested.id is not null;
  if pg_catalog.cardinality(v_requested) > 0 then
    v_found := 0;
    for v_item in
      select item.* from public.cv_items as item
      where item.user_id = v_user_id and item.cv_id = v_cv.id and item.id = any (v_requested)
      order by item.id
      for update
    loop
      v_found := v_found + 1;
    end loop;
    if v_found <> pg_catalog.cardinality(v_requested) then
      raise exception using errcode = 'P0001', message = 'CV_ITEM_NOT_FOUND';
    end if;
  end if;

  -- Source locks. The parent of a refreshed achievement is read once without a lock, so it can be locked
  -- before the achievement (the relink order); it is compared again after the locks are held.
  for v_index in 1 .. pg_catalog.cardinality(v_targets) loop
    v_pre_parent_type := pg_catalog.array_append(v_pre_parent_type, null::text);
    v_pre_parent_id := pg_catalog.array_append(v_pre_parent_id, null::uuid);
    if v_targets[v_index] <> 'item' then
      continue;
    end if;
    select item.* into v_item from public.cv_items as item where item.id = v_item_ids[v_index];
    if v_item.source_deleted then
      continue;
    end if;
    v_type := case
      when v_item.experience_id is not null then 'experience'
      when v_item.project_id is not null then 'project'
      when v_item.achievement_id is not null then 'achievement'
      when v_item.education_id is not null then 'education'
      when v_item.skill_id is not null then 'skill'
      else 'certification'
    end;
    v_lock_types := pg_catalog.array_append(v_lock_types, v_type);
    v_lock_ids := pg_catalog.array_append(v_lock_ids, coalesce(v_item.experience_id, v_item.project_id, v_item.achievement_id,
      v_item.education_id, v_item.skill_id, v_item.certification_id));
    v_lock_required := pg_catalog.array_append(v_lock_required, true);
    if v_type = 'achievement' and v_actions[v_index] in ('refresh', 'replace') then
      select achievement.project_id, achievement.experience_id into v_pp, v_pe
      from public.achievements as achievement
      where achievement.user_id = v_user_id and achievement.id = v_item.achievement_id;
      if v_pp is not null then
        v_pre_parent_type[v_index] := 'project';
        v_pre_parent_id[v_index] := v_pp;
      elsif v_pe is not null then
        v_pre_parent_type[v_index] := 'experience';
        v_pre_parent_id[v_index] := v_pe;
      end if;
      if v_pre_parent_id[v_index] is not null then
        v_lock_types := pg_catalog.array_append(v_lock_types, v_pre_parent_type[v_index]);
        v_lock_ids := pg_catalog.array_append(v_lock_ids, v_pre_parent_id[v_index]);
        v_lock_required := pg_catalog.array_append(v_lock_required, false);
      end if;
    end if;
  end loop;

  foreach v_type in array array['experience', 'project', 'achievement', 'education', 'skill', 'certification'] loop
    for v_lock in
      select locks.id, pg_catalog.bool_or(locks.required) as required
      from rows from (pg_catalog.unnest(v_lock_types), pg_catalog.unnest(v_lock_ids), pg_catalog.unnest(v_lock_required))
        as locks(type, id, required)
      where locks.type = v_type
      group by locks.id
      order by locks.id
    loop
      if not internal.cv_lock_source(v_user_id, v_type, v_lock.id) then
        raise exception using errcode = 'P0001',
          message = case when v_lock.required then 'CV_SOURCE_NOT_FOUND' else 'CV_SOURCE_CHANGED' end;
      end if;
    end loop;
  end loop;

  v_new_profile := v_cv.profile_snapshot;
  v_new_profile_revision := v_cv.profile_source_revision;
  v_new_ack := v_cv.profile_ack_revision;
  v_new_summary := v_cv.summary_override;

  for v_index in 1 .. pg_catalog.cardinality(v_targets) loop
    v_action := v_actions[v_index];
    if v_targets[v_index] = 'profile' then
      v_state := internal.cv_profile_state(v_cv);
      select profile.revision into v_profile_revision from public.profiles as profile where profile.id = v_user_id;
      if v_state = 'fresh' then
        raise exception using errcode = 'P0001', message = 'CV_RESOLUTION_INVALID';
      end if;
      if v_revisions[v_index] <> v_profile_revision then
        raise exception using errcode = 'P0001', message = 'CV_SOURCE_CHANGED';
      end if;
      if v_action = 'keep' and v_state = 'kept' then
        raise exception using errcode = 'P0001', message = 'CV_RESOLUTION_INVALID';
      end if;
      if v_action = 'replace' and (v_cv.profile_snapshot -> 'display_overrides') is null and v_cv.summary_override is null then
        raise exception using errcode = 'P0001', message = 'CV_RESOLUTION_INVALID';
      end if;
      if v_action = 'keep' then
        v_new_ack := v_profile_revision;
      else
        v_profile_live := internal.cv_profile_display(v_user_id);
        v_new_profile := v_cv.profile_snapshot || v_profile_live;
        v_new_profile_revision := v_profile_revision;
        v_new_ack := null;
        if v_action = 'replace' then
          v_new_profile := v_new_profile - 'display_overrides';
          v_new_summary := null;
        end if;
      end if;
      continue;
    end if;

    select item.* into v_item from public.cv_items as item where item.id = v_item_ids[v_index];
    v_state := internal.cv_item_state(v_item);
    if v_state = 'deleted' then
      raise exception using errcode = 'P0001', message = 'CV_RESOLUTION_INVALID';
    elsif v_state = 'unconfirmed' then
      raise exception using errcode = 'P0001', message = 'CV_SOURCE_INELIGIBLE';
    elsif v_state = 'fresh' then
      raise exception using errcode = 'P0001', message = 'CV_RESOLUTION_INVALID';
    end if;
    v_live_revision := null;
    v_live_snapshot := null;
    select source.live_revision, source.live_snapshot into v_live_revision, v_live_snapshot
    from internal.cv_live_source(v_item) as source;
    if v_revisions[v_index] <> v_live_revision then
      raise exception using errcode = 'P0001', message = 'CV_SOURCE_CHANGED';
    end if;
    if v_action = 'keep' and v_state = 'kept' then
      raise exception using errcode = 'P0001', message = 'CV_RESOLUTION_INVALID';
    end if;
    if v_action = 'replace' and v_item.override_text is null then
      raise exception using errcode = 'P0001', message = 'CV_RESOLUTION_INVALID';
    end if;

    if v_action = 'keep' then
      update public.cv_items as item
      set acknowledged_revision = v_live_revision
      where item.id = v_item.id;
    elsif v_action = 'refresh' then
      update public.cv_items as item
      set source_snapshot = v_live_snapshot,
          source_revision = v_live_revision,
          acknowledged_revision = null
      where item.id = v_item.id;
    else
      update public.cv_items as item
      set source_snapshot = v_live_snapshot,
          source_revision = v_live_revision,
          acknowledged_revision = null,
          override_text = null
      where item.id = v_item.id;
    end if;

    if v_action <> 'keep' and v_item.achievement_id is not null then
      v_pp := (v_live_snapshot ->> 'project_id')::uuid;
      v_pe := (v_live_snapshot ->> 'experience_id')::uuid;
      v_parent_type := case when v_pp is not null then 'project' when v_pe is not null then 'experience' end;
      v_parent_id := coalesce(v_pp, v_pe);
      if v_parent_type is distinct from v_pre_parent_type[v_index] or v_parent_id is distinct from v_pre_parent_id[v_index] then
        raise exception using errcode = 'P0001', message = 'CV_SOURCE_CHANGED';
      end if;
      if v_parent_id is not null then
        select item.id into v_parent_item from public.cv_items as item
        where item.cv_id = v_cv.id
          and case v_parent_type when 'project' then item.project_id else item.experience_id end = v_parent_id;
        if v_parent_item is null then
          v_parent_item := internal.cv_append_item(v_user_id, v_cv.id, v_parent_type, v_parent_id);
          v_added := pg_catalog.array_append(v_added, v_parent_item);
        end if;
      end if;
    end if;
  end loop;

  begin
    update public.cv_documents as document
    set profile_snapshot = v_new_profile,
        profile_source_revision = v_new_profile_revision,
        profile_ack_revision = v_new_ack,
        summary_override = v_new_summary
    where document.id = v_cv.id
    returning document.revision into v_new_revision;
  exception when check_violation then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end;
  return query select v_new_revision, v_added;
end;
$$;

revoke all on function public.get_cv_freshness() from public, anon, service_role;
revoke all on function public.get_cv_review_summary() from public, anon, service_role;
revoke all on function public.resolve_cv_freshness(integer, jsonb) from public, anon, service_role;
grant execute on function public.get_cv_freshness() to authenticated;
grant execute on function public.get_cv_review_summary() to authenticated;
grant execute on function public.resolve_cv_freshness(integer, jsonb) to authenticated;

comment on function public.get_cv_freshness() is
  'Freshness state (fresh, changed, kept, deleted, unconfirmed) of every CV item and of the CV profile, computed from live source revisions.';
comment on function public.get_cv_review_summary() is
  'Counts for the dashboard CV check: items needing review and confirmed achievements not on the CV.';
comment on function public.resolve_cv_freshness(integer, jsonb) is
  'Keeps, refreshes or replaces changed CV sources and the CV profile in one transaction and one revision step. Refresh never touches wording overrides.';

-- 4. Source-delete paths: lock the CV first, bump its revision in the same transaction -----------------------------
-- Bodies are the latest definitions (T09 / foundation fix) with two insertions each:
-- (a) internal.cv_lock_for_source_change before the first source lock, (b) one document touch after a delete that
-- invalidated at least one CV item.

create or replace function public.delete_achievement(
  p_achievement_id uuid,
  p_expected_revision integer
)
returns table (
  deleted_achievement_id uuid,
  retained_activity boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_achievement public.achievements%rowtype;
  v_retained boolean;
  v_cv_id uuid;
  v_referenced boolean;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles where id = v_user_id and deleting_at is null)
     or p_achievement_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  v_cv_id := internal.cv_lock_for_source_change(v_user_id);
  select achievement.* into v_achievement
  from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.id = p_achievement_id
  for update;
  if not found then
    return;
  end if;
  if v_achievement.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  v_retained := v_achievement.activity_id is not null;
  v_referenced := v_cv_id is not null and exists (
    select 1 from public.cv_items as item where item.user_id = v_user_id and item.achievement_id = v_achievement.id
  );
  delete from public.achievement_skills
  where user_id = v_user_id and achievement_id = v_achievement.id;
  delete from public.achievements
  where user_id = v_user_id and id = v_achievement.id and revision = p_expected_revision;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
  end if;
  if v_referenced then
    update public.cv_documents as document set updated_at = document.updated_at where document.id = v_cv_id;
  end if;
  return query select v_achievement.id, v_retained;
end;
$$;

create or replace function public.delete_project(
  p_project_id uuid,
  p_expected_revision integer
)
returns table (
  deleted_project_id uuid,
  released_activity_count integer,
  released_achievement_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_snapshot public.projects%rowtype;
  v_project public.projects%rowtype;
  v_count integer;
  v_achievement_count integer;
  v_deleted_id uuid;
  v_cv_id uuid;
  v_referenced boolean;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles where id = v_user_id and deleting_at is null)
     or p_project_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  v_cv_id := internal.cv_lock_for_source_change(v_user_id);
  select project.* into v_snapshot
  from public.projects as project
  where project.user_id = v_user_id and project.id = p_project_id;
  if not found then return; end if;
  if v_snapshot.experience_id is not null then
    perform 1 from public.experiences as experience
    where experience.user_id = v_user_id and experience.id = v_snapshot.experience_id
    for update;
  end if;
  select project.* into v_project
  from public.projects as project
  where project.user_id = v_user_id and project.id = p_project_id
  for update;
  if not found then return; end if;
  if v_project.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

  perform 1 from public.activities as activity
  where activity.user_id = v_user_id and activity.project_id = p_project_id
  order by activity.id
  for update;
  select pg_catalog.count(*)::integer into v_count
  from public.activities as activity
  where activity.user_id = v_user_id and activity.project_id = p_project_id;

  perform 1 from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.project_id = p_project_id
  order by achievement.id
  for update;
  select pg_catalog.count(*)::integer into v_achievement_count
  from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.project_id = p_project_id;

  update public.activities as activity
  set project_id = null
  where activity.user_id = v_user_id and activity.project_id = p_project_id;
  update public.achievements as achievement
  set project_id = null
  where achievement.user_id = v_user_id
    and achievement.project_id = p_project_id
    and achievement.activity_id is null;

  v_referenced := v_cv_id is not null and exists (
    select 1 from public.cv_items as item where item.user_id = v_user_id and item.project_id = p_project_id
  );
  delete from public.projects as project
  where project.user_id = v_user_id and project.id = p_project_id and project.revision = p_expected_revision
  returning project.id into v_deleted_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROJECT_UNAVAILABLE';
  end if;
  if v_referenced then
    update public.cv_documents as document set updated_at = document.updated_at where document.id = v_cv_id;
  end if;
  return query select v_deleted_id, v_count, v_achievement_count;
end;
$$;

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
  v_experience public.experiences%rowtype;
  v_project_count integer;
  v_cv_id uuid;
  v_referenced boolean;
begin
  if v_user_id is null or p_experience_id is null or p_expected_revision is null or p_expected_revision < 1 then return; end if;
  v_cv_id := internal.cv_lock_for_source_change(v_user_id);
  select experience.* into v_experience
  from public.experiences as experience
  where experience.user_id = v_user_id and experience.id = p_experience_id
  for update;
  if not found then return; end if;
  if v_experience.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

  perform 1 from public.projects as project
  where project.user_id = v_user_id and project.experience_id = p_experience_id
  order by project.id
  for update;
  select pg_catalog.count(*)::integer into v_project_count
  from public.projects as project
  where project.user_id = v_user_id and project.experience_id = p_experience_id;

  update public.projects as project
  set experience_id = null
  where project.user_id = v_user_id and project.experience_id = p_experience_id;
  update public.achievements as achievement
  set experience_id = null
  where achievement.user_id = v_user_id
    and achievement.experience_id = p_experience_id
    and achievement.project_id is null
    and achievement.activity_id is null;

  v_referenced := v_cv_id is not null and exists (
    select 1 from public.cv_items as item where item.user_id = v_user_id and item.experience_id = p_experience_id
  );
  delete from public.experiences as experience
  where experience.user_id = v_user_id and experience.id = p_experience_id and experience.revision = p_expected_revision;
  if not found then return; end if;
  if v_referenced then
    update public.cv_documents as document set updated_at = document.updated_at where document.id = v_cv_id;
  end if;
  return query select p_experience_id, v_project_count;
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
  v_cv_id uuid;
  v_referenced boolean;
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

  v_cv_id := internal.cv_lock_for_source_change(v_user_id);

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

  if v_cv_id is not null then
    execute pg_catalog.format(
      'select exists (select 1 from public.cv_items as item where item.user_id = $1 and item.%1$I = $2)',
      case p_table
        when 'education' then 'education_id'
        when 'certifications' then 'certification_id'
        when 'skills' then 'skill_id'
        else 'project_id'
      end
    )
    into v_referenced
    using v_user_id, p_id;
  end if;

  execute pg_catalog.format(
    'delete from public.%1$I
      where id = $1 and user_id = $2 and revision = $3
      returning id',
    p_table
  )
  into v_deleted_id
  using p_id, v_user_id, p_expected_revision;

  if v_deleted_id is not null and coalesce(v_referenced, false) then
    update public.cv_documents as document set updated_at = document.updated_at where document.id = v_cv_id;
  end if;

  return v_deleted_id;
end;
$$;

-- 5. select_cv_source: parent before achievement ---------------------------------------------------------------------
-- Same behaviour as T18 with one change: an achievement's parent is locked before the achievement (the
-- relink_achievement_project order). If the parent moved between the unlocked read and the lock the call fails
-- with the retryable CV_SOURCE_CHANGED.

create or replace function public.select_cv_source(
  p_expected_revision integer,
  p_source_type text,
  p_source_id uuid
)
returns table (cv_revision integer, item_ids uuid[], parent_item_ids uuid[])
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.cv_actor();
  v_cv public.cv_documents%rowtype;
  v_achievement public.achievements%rowtype;
  v_parent_type text;
  v_parent_id uuid;
  v_locked_parent_type text;
  v_locked_parent_id uuid;
  v_parent_item uuid;
  v_created uuid[] := array[]::uuid[];
  v_parents uuid[] := array[]::uuid[];
  v_source_item uuid;
  v_new_revision integer;
begin
  if p_expected_revision is null or p_source_id is null
     or p_source_type is null
     or p_source_type not in ('experience', 'project', 'achievement', 'education', 'skill', 'certification') then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;
  v_cv := internal.cv_lock(v_user_id, p_expected_revision);

  if p_source_type = 'achievement' then
    select achievement.* into v_achievement from public.achievements as achievement
    where achievement.user_id = v_user_id and achievement.id = p_source_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'CV_SOURCE_NOT_FOUND';
    end if;
    if v_achievement.project_id is not null then
      v_parent_type := 'project';
      v_parent_id := v_achievement.project_id;
    elsif v_achievement.experience_id is not null then
      v_parent_type := 'experience';
      v_parent_id := v_achievement.experience_id;
    end if;
    if v_parent_id is not null then
      if not internal.cv_lock_source(v_user_id, v_parent_type, v_parent_id) then
        raise exception using errcode = 'P0001', message = 'CV_SOURCE_NOT_FOUND';
      end if;
    end if;
  end if;

  if not internal.cv_lock_source(v_user_id, p_source_type, p_source_id) then
    raise exception using errcode = 'P0001', message = 'CV_SOURCE_NOT_FOUND';
  end if;
  if p_source_type = 'achievement' then
    select achievement.* into v_achievement from public.achievements as achievement
    where achievement.user_id = v_user_id and achievement.id = p_source_id;
    if v_achievement.project_id is not null then
      v_locked_parent_type := 'project';
      v_locked_parent_id := v_achievement.project_id;
    elsif v_achievement.experience_id is not null then
      v_locked_parent_type := 'experience';
      v_locked_parent_id := v_achievement.experience_id;
    end if;
    if v_locked_parent_type is distinct from v_parent_type or v_locked_parent_id is distinct from v_parent_id then
      raise exception using errcode = 'P0001', message = 'CV_SOURCE_CHANGED';
    end if;
    if v_achievement.status <> 'confirmed' then
      raise exception using errcode = 'P0001', message = 'CV_SOURCE_INELIGIBLE';
    end if;
  end if;

  if exists (
    select 1 from public.cv_items as item
    where item.cv_id = v_cv.id
      and case p_source_type
        when 'experience' then item.experience_id
        when 'project' then item.project_id
        when 'achievement' then item.achievement_id
        when 'education' then item.education_id
        when 'skill' then item.skill_id
        else item.certification_id
      end = p_source_id
  ) then
    raise exception using errcode = 'P0001', message = 'CV_SOURCE_DUPLICATE';
  end if;

  if p_source_type = 'achievement' and v_parent_id is not null then
    select item.id into v_parent_item from public.cv_items as item
    where item.cv_id = v_cv.id
      and case v_parent_type when 'project' then item.project_id else item.experience_id end = v_parent_id;
    if v_parent_item is null then
      v_parent_item := internal.cv_append_item(v_user_id, v_cv.id, v_parent_type, v_parent_id);
      v_created := pg_catalog.array_append(v_created, v_parent_item);
      v_parents := pg_catalog.array_append(v_parents, v_parent_item);
    end if;
  end if;

  v_source_item := internal.cv_append_item(v_user_id, v_cv.id, p_source_type, p_source_id);
  v_created := pg_catalog.array_append(v_created, v_source_item);

  update public.cv_documents as document set updated_at = document.updated_at
  where document.id = v_cv.id
  returning document.revision into v_new_revision;
  return query select v_new_revision, v_created, v_parents;
end;
$$;

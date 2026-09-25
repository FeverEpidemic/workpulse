-- T09 forward patch: JSON null is the wire representation for clearing an
-- optional Achievement field. The original function accepted strings only.
create or replace function public.save_achievement(
  p_achievement_id uuid,
  p_expected_revision integer,
  p_action text,
  p_changes jsonb,
  p_skill_names jsonb
)
returns setof public.achievements
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_achievement public.achievements%rowtype;
  v_title text;
  v_contribution text;
  v_scope text;
  v_outcome text;
  v_cv_bullet text;
  v_achieved_on date;
  v_metrics jsonb;
  v_status text;
  v_fallback text;
  v_skill_json jsonb;
  v_skill_label text;
  v_skill_normalized text;
  v_skill_id uuid;
  v_skill_ids uuid[] := array[]::uuid[];
  v_skill_changed boolean := false;
  v_row_changed boolean := false;
  v_key text;
  v_item_count integer;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles where id = v_user_id and deleting_at is null) then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_achievement_id is null or p_expected_revision is null or p_expected_revision < 1
     or p_action not in ('save_draft', 'confirm', 'dismiss', 'reopen', 'save_changes')
     or p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_INPUT';
  end if;

  for v_key in select key from pg_catalog.jsonb_object_keys(p_changes) as fields(key) loop
    if v_key not in ('title', 'contribution', 'scope', 'outcome', 'cv_bullet', 'achieved_on', 'metrics') then
      raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_INPUT';
    end if;
  end loop;
  if p_skill_names is not null and pg_catalog.jsonb_typeof(p_skill_names) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_SKILL_INPUT';
  end if;
  if p_skill_names is not null and pg_catalog.jsonb_array_length(p_skill_names) > 20 then
    raise exception using errcode = '22023', message = 'TOO_MANY_SKILLS';
  end if;

  select achievement.* into v_achievement
  from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.id = p_achievement_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
  end if;
  if v_achievement.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;

  if p_action = 'confirm' and v_achievement.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'INVALID_ACHIEVEMENT_TRANSITION';
  elsif p_action = 'dismiss' and v_achievement.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'INVALID_ACHIEVEMENT_TRANSITION';
  elsif p_action = 'reopen' and v_achievement.status not in ('confirmed', 'dismissed') then
    raise exception using errcode = 'P0001', message = 'INVALID_ACHIEVEMENT_TRANSITION';
  elsif p_action = 'save_changes' and v_achievement.status <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'INVALID_ACHIEVEMENT_TRANSITION';
  elsif p_action = 'save_draft' and v_achievement.status = 'confirmed' then
    raise exception using errcode = 'P0001', message = 'INVALID_ACHIEVEMENT_TRANSITION';
  end if;

  if (p_changes ? 'title' and pg_catalog.jsonb_typeof(p_changes -> 'title') not in ('string', 'null'))
     or (p_changes ? 'contribution' and pg_catalog.jsonb_typeof(p_changes -> 'contribution') not in ('string', 'null'))
     or (p_changes ? 'scope' and pg_catalog.jsonb_typeof(p_changes -> 'scope') not in ('string', 'null'))
     or (p_changes ? 'outcome' and pg_catalog.jsonb_typeof(p_changes -> 'outcome') not in ('string', 'null'))
     or (p_changes ? 'cv_bullet' and pg_catalog.jsonb_typeof(p_changes -> 'cv_bullet') not in ('string', 'null'))
     or (p_changes ? 'achieved_on' and pg_catalog.jsonb_typeof(p_changes -> 'achieved_on') not in ('string', 'null')) then
    raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_INPUT';
  end if;

  v_title := case when p_changes ? 'title' then nullif(pg_catalog.btrim(p_changes ->> 'title'), '') else v_achievement.title end;
  v_contribution := case when p_changes ? 'contribution' then nullif(pg_catalog.btrim(p_changes ->> 'contribution'), '') else v_achievement.contribution end;
  v_scope := case when p_changes ? 'scope' then nullif(pg_catalog.btrim(p_changes ->> 'scope'), '') else v_achievement.scope end;
  v_outcome := case when p_changes ? 'outcome' then nullif(pg_catalog.btrim(p_changes ->> 'outcome'), '') else v_achievement.outcome end;
  v_cv_bullet := case when p_changes ? 'cv_bullet' then nullif(pg_catalog.btrim(p_changes ->> 'cv_bullet'), '') else v_achievement.cv_bullet end;
  begin
    v_achieved_on := case when p_changes ? 'achieved_on' then (p_changes ->> 'achieved_on')::date else v_achievement.achieved_on end;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_INPUT';
  end;
  v_metrics := case when p_changes ? 'metrics' then p_changes -> 'metrics' else v_achievement.metrics end;

  if v_title is not null and pg_catalog.char_length(v_title) > 200
     or v_contribution is not null and pg_catalog.char_length(v_contribution) > 5000
     or v_scope is not null and pg_catalog.char_length(v_scope) > 5000
     or v_outcome is not null and pg_catalog.char_length(v_outcome) > 5000
     or v_cv_bullet is not null and pg_catalog.char_length(v_cv_bullet) > 2000
     or not internal.is_valid_achievement_metrics(v_metrics) then
    raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_INPUT';
  end if;

  v_status := v_achievement.status;
  if p_action = 'confirm' then
    v_status := 'confirmed';
    if v_cv_bullet is null then
      v_fallback := internal.factual_cv_bullet(v_contribution, v_outcome);
      if v_fallback is not null and pg_catalog.char_length(v_fallback) > 2000 then
        raise exception using errcode = '22023', message = 'CV_BULLET_TOO_LONG';
      end if;
      v_cv_bullet := v_fallback;
    end if;
    if v_title is null or v_contribution is null or v_outcome is null or v_achieved_on is null or v_cv_bullet is null then
      raise exception using errcode = '22023', message = 'REQUIRED_CONFIRM_FIELDS';
    end if;
  elsif p_action = 'dismiss' then
    v_status := 'dismissed';
  elsif p_action = 'reopen' then
    v_status := 'draft';
  elsif p_action = 'save_changes' then
    v_status := 'confirmed';
    if v_title is null or v_contribution is null or v_outcome is null or v_achieved_on is null or v_cv_bullet is null then
      raise exception using errcode = '22023', message = 'REQUIRED_CONFIRM_FIELDS';
    end if;
  end if;

  if p_skill_names is not null then
    select pg_catalog.count(*)::integer into v_item_count
    from pg_catalog.jsonb_array_elements(p_skill_names) as items(value)
    where pg_catalog.jsonb_typeof(items.value) <> 'string'
       or internal.normalize_skill_name(items.value #>> '{}') = ''
       or pg_catalog.char_length(pg_catalog.btrim(items.value #>> '{}')) > 100;
    if v_item_count > 0 then
      raise exception using errcode = '22023', message = 'INVALID_SKILL_INPUT';
    end if;
    select pg_catalog.count(*)::integer into v_item_count
    from (
      select internal.normalize_skill_name(value #>> '{}') as normalized_name
      from pg_catalog.jsonb_array_elements(p_skill_names) as items(value)
      group by internal.normalize_skill_name(value #>> '{}')
      having count(*) > 1
    ) as duplicates;
    if v_item_count > 0 then
      raise exception using errcode = '22023', message = 'DUPLICATE_SKILL';
    end if;

    for v_skill_json in select value from pg_catalog.jsonb_array_elements(p_skill_names) as items(value)
      order by internal.normalize_skill_name(value #>> '{}') loop
      v_skill_label := pg_catalog.btrim(v_skill_json #>> '{}');
      v_skill_normalized := internal.normalize_skill_name(v_skill_label);
      select skill.id into v_skill_id
      from public.skills as skill
      where skill.user_id = v_user_id and skill.normalized_name = v_skill_normalized
      for update;
      if not found then
        insert into public.skills (user_id, name)
        values (v_user_id, v_skill_label)
        on conflict (user_id, normalized_name) do nothing
        returning id into v_skill_id;
        if v_skill_id is null then
          select skill.id into v_skill_id
          from public.skills as skill
          where skill.user_id = v_user_id and skill.normalized_name = v_skill_normalized
          for update;
        end if;
      end if;
      v_skill_ids := array_append(v_skill_ids, v_skill_id);
    end loop;

    v_skill_changed := exists (
      select 1 from public.achievement_skills as link
      where link.user_id = v_user_id and link.achievement_id = v_achievement.id
        and not (link.skill_id = any(v_skill_ids))
    ) or exists (
      select 1 from pg_catalog.unnest(v_skill_ids) as desired(skill_id)
      where not exists (
        select 1 from public.achievement_skills as link
        where link.user_id = v_user_id and link.achievement_id = v_achievement.id and link.skill_id = desired.skill_id
      )
    );
    delete from public.achievement_skills as link
    where link.user_id = v_user_id and link.achievement_id = v_achievement.id;
    insert into public.achievement_skills (user_id, achievement_id, skill_id)
    select v_user_id, v_achievement.id, desired.skill_id
    from pg_catalog.unnest(v_skill_ids) as desired(skill_id);
  end if;

  v_row_changed := row(v_achievement.title, v_achievement.contribution, v_achievement.scope, v_achievement.outcome, v_achievement.cv_bullet, v_achievement.achieved_on, v_achievement.status, v_achievement.metrics)
    is distinct from row(v_title, v_contribution, v_scope, v_outcome, v_cv_bullet, v_achieved_on, v_status, v_metrics);
  if v_row_changed then
    update public.achievements as achievement
    set title = v_title,
        contribution = v_contribution,
        scope = v_scope,
        outcome = v_outcome,
        cv_bullet = v_cv_bullet,
        achieved_on = v_achieved_on,
        status = v_status,
        metrics = v_metrics
    where achievement.user_id = v_user_id
      and achievement.id = v_achievement.id
      and achievement.revision = p_expected_revision;
  elsif v_skill_changed then
    update public.achievements as achievement
    set revision = v_achievement.revision + 1
    where achievement.user_id = v_user_id
      and achievement.id = v_achievement.id
      and achievement.revision = p_expected_revision;
  end if;

  select achievement.* into v_achievement
  from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.id = p_achievement_id
  for update;
  return next v_achievement;
end;
$$;

comment on function public.save_achievement(uuid, integer, text, jsonb, jsonb) is
  'Owner-scoped Achievement lifecycle with JSON null clearing for optional fields.';

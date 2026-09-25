-- WorkPulse T09 Manual Achievements and Skills.
-- Forward-only migration. T08 migrations remain immutable.

-- The private operation ledger is extended for the Achievement create receipt.
alter table internal.operation_requests
  drop constraint if exists operation_requests_kind_check,
  drop constraint if exists operation_requests_result_table_check,
  drop constraint if exists operation_requests_kind_result_check;

alter table internal.operation_requests
  add constraint operation_requests_kind_check check (
    operation_kind in (
      'experience.create',
      'education.create',
      'certification.create',
      'skill.create',
      'activity.create',
      'project.create',
      'achievement.create'
    )
  ),
  add constraint operation_requests_result_table_check check (
    result_table is null
    or result_table in ('experiences', 'education', 'certifications', 'skills', 'activities', 'projects', 'achievements')
  ),
  add constraint operation_requests_kind_result_check check (
    result_table is null
    or (operation_kind = 'experience.create' and result_table = 'experiences')
    or (operation_kind = 'education.create' and result_table = 'education')
    or (operation_kind = 'certification.create' and result_table = 'certifications')
    or (operation_kind = 'skill.create' and result_table = 'skills')
    or (operation_kind = 'activity.create' and result_table = 'activities')
    or (operation_kind = 'project.create' and result_table = 'projects')
    or (operation_kind = 'achievement.create' and result_table = 'achievements')
  );

alter table internal.operation_requests
  add constraint operation_requests_achievement_receipt_check check (
    operation_kind <> 'achievement.create'
    or result_payload is null
    or (
      result_table = 'achievements'
      and pg_catalog.jsonb_typeof(result_payload) = 'object'
      and result_payload ?& array['achievement_id', 'user_id', 'revision']
      and result_payload - array['achievement_id', 'user_id', 'revision'] = '{}'::jsonb
      and result_payload ->> 'achievement_id' = result_id::text
      and result_payload ->> 'user_id' = user_id::text
      and result_payload ->> 'revision' = '1'
    )
  );

create or replace function internal.is_valid_achievement_metrics(p_metrics jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_item_count integer;
begin
  if p_metrics is null
     or pg_catalog.jsonb_typeof(p_metrics) <> 'array'
     or pg_catalog.jsonb_array_length(p_metrics) > 20
     or pg_catalog.octet_length(p_metrics::text) > 20480 then
    return false;
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_metrics) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array['label', 'value', 'unit'])
       or v_item - array['label', 'value', 'unit', 'baseline', 'period'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(v_item -> 'label') <> 'string'
       or pg_catalog.jsonb_typeof(v_item -> 'value') <> 'number'
       or pg_catalog.jsonb_typeof(v_item -> 'unit') <> 'string'
       or pg_catalog.btrim(v_item ->> 'label') = ''
       or pg_catalog.btrim(v_item ->> 'unit') = ''
       or pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'label')) > 100
       or pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'unit')) > 50 then
      return false;
    end if;

    select pg_catalog.count(*)::integer
    into v_item_count
    from pg_catalog.jsonb_object_keys(v_item) as keys(key);
    if v_item_count < 3 or v_item_count > 5 then
      return false;
    end if;

    if v_item ? 'baseline' and pg_catalog.jsonb_typeof(v_item -> 'baseline') <> 'number' then
      return false;
    end if;
    if v_item ? 'period'
       and (
         pg_catalog.jsonb_typeof(v_item -> 'period') <> 'string'
         or pg_catalog.btrim(v_item ->> 'period') = ''
         or pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'period')) > 100
       ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function internal.factual_cv_bullet(p_contribution text, p_outcome text)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  v_contribution text := nullif(pg_catalog.btrim(p_contribution), '');
  v_outcome text := nullif(pg_catalog.btrim(p_outcome), '');
begin
  if v_contribution is null then return v_outcome; end if;
  if v_outcome is null or v_outcome = v_contribution then return v_contribution; end if;
  if v_contribution ~ '[[:punct:]]$' then
    return v_contribution || ' ' || v_outcome;
  end if;
  return v_contribution || '. ' || v_outcome;
end;
$$;

create table public.achievements (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid,
  experience_id uuid,
  project_id uuid,
  title text,
  contribution text,
  scope text,
  outcome text,
  cv_bullet text,
  achieved_on date,
  status text not null default 'draft',
  origin text not null default 'manual',
  source_excerpt text,
  source_activity_revision integer,
  metrics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  revision integer not null default 1,
  constraint achievements_user_id_id_key unique (user_id, id),
  constraint achievements_status_check check (status in ('draft', 'confirmed', 'dismissed')),
  constraint achievements_origin_check check (origin in ('manual', 'activity', 'import')),
  constraint achievements_title_check check (
    title is null or (title = pg_catalog.btrim(title) and title <> '' and pg_catalog.char_length(title) <= 200)
  ),
  constraint achievements_contribution_check check (
    contribution is null or (contribution = pg_catalog.btrim(contribution) and contribution <> '' and pg_catalog.char_length(contribution) <= 5000)
  ),
  constraint achievements_scope_check check (
    scope is null or (scope = pg_catalog.btrim(scope) and scope <> '' and pg_catalog.char_length(scope) <= 5000)
  ),
  constraint achievements_outcome_check check (
    outcome is null or (outcome = pg_catalog.btrim(outcome) and outcome <> '' and pg_catalog.char_length(outcome) <= 5000)
  ),
  constraint achievements_cv_bullet_check check (
    cv_bullet is null or (cv_bullet = pg_catalog.btrim(cv_bullet) and cv_bullet <> '' and pg_catalog.char_length(cv_bullet) <= 2000)
  ),
  constraint achievements_source_excerpt_check check (
    source_excerpt is null or (source_excerpt <> '' and pg_catalog.char_length(source_excerpt) <= 10000)
  ),
  constraint achievements_source_revision_check check (
    source_activity_revision is null or source_activity_revision > 0
  ),
  constraint achievements_source_pair_check check (
    (source_excerpt is null) = (source_activity_revision is null)
  ),
  constraint achievements_metrics_check check (internal.is_valid_achievement_metrics(metrics)),
  constraint achievements_confirmed_fields_check check (
    status <> 'confirmed'
    or (
      title is not null and contribution is not null and outcome is not null
      and achieved_on is not null and cv_bullet is not null
    )
  ),
  constraint achievements_revision_positive check (revision > 0),
  constraint achievements_activity_fk foreign key (user_id, activity_id)
    references public.activities (user_id, id) on delete set null (activity_id),
  constraint achievements_experience_fk foreign key (user_id, experience_id)
    references public.experiences (user_id, id) on delete set null (experience_id),
  constraint achievements_project_fk foreign key (user_id, project_id)
    references public.projects (user_id, id) on delete set null (project_id)
);

create table public.achievement_skills (
  user_id uuid not null,
  achievement_id uuid not null,
  skill_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint achievement_skills_pkey primary key (user_id, achievement_id, skill_id),
  constraint achievement_skills_user_achievement_fk foreign key (user_id, achievement_id)
    references public.achievements (user_id, id) on delete cascade,
  constraint achievement_skills_user_skill_fk foreign key (user_id, skill_id)
    references public.skills (user_id, id) on delete cascade
);

create unique index achievements_one_derived_activity_idx
  on public.achievements (user_id, activity_id)
  where activity_id is not null;
create index achievements_user_status_date_id_idx
  on public.achievements (user_id, status, achieved_on desc nulls last, id desc);
create index achievements_user_project_date_id_idx
  on public.achievements (user_id, project_id, achieved_on desc nulls last, id desc);
create index achievements_user_activity_idx
  on public.achievements (user_id, activity_id);
create index achievement_skills_skill_idx
  on public.achievement_skills (user_id, skill_id, achievement_id);

comment on table public.achievements is
  'Canonical user-owned Achievement. Confirmation is explicit; source Activity text is retained separately.';
comment on column public.achievements.source_excerpt is
  'Exact Activity raw_text captured at derived Achievement creation. It is provenance, not editable wording.';
comment on column public.achievements.source_activity_revision is
  'Activity revision used for source-changed review; it is not changed when Activity text is edited.';

alter table public.achievements enable row level security;
alter table public.achievement_skills enable row level security;

create policy achievements_select_own on public.achievements
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy achievement_skills_select_own on public.achievement_skills
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.achievements, public.achievement_skills from public, anon, authenticated, service_role;
grant select on table public.achievements, public.achievement_skills to authenticated;

create or replace function internal.guard_achievement_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_MUTATION';
  end if;
  if new.revision is distinct from old.revision
     or row(new.activity_id, new.experience_id, new.project_id, new.title, new.contribution, new.scope, new.outcome, new.cv_bullet, new.achieved_on, new.status, new.origin, new.source_excerpt, new.source_activity_revision, new.metrics)
        is distinct from
        row(old.activity_id, old.experience_id, old.project_id, old.title, old.contribution, old.scope, old.outcome, old.cv_bullet, old.achieved_on, old.status, old.origin, old.source_excerpt, old.source_activity_revision, old.metrics) then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create or replace function internal.enforce_achievement_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_activity public.activities%rowtype;
  v_project public.projects%rowtype;
begin
  if new.activity_id is not null then
    select activity.* into v_activity
    from public.activities as activity
    where activity.user_id = new.user_id and activity.id = new.activity_id;
    if not found
       or new.experience_id is distinct from v_activity.experience_id
       or new.project_id is distinct from v_activity.project_id then
      raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_CONTEXT';
    end if;
    if new.source_excerpt is null or new.source_activity_revision is null then
      raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_SOURCE';
    end if;
  end if;

  if new.experience_id is not null and not exists (
    select 1 from public.experiences as experience
    where experience.user_id = new.user_id and experience.id = new.experience_id
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_CONTEXT';
  end if;

  if new.project_id is not null then
    select project.* into v_project
    from public.projects as project
    where project.user_id = new.user_id and project.id = new.project_id;
    if not found or (new.activity_id is null and new.experience_id is distinct from v_project.experience_id) then
      raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_CONTEXT';
    end if;
  end if;
  return new;
end;
$$;

create trigger achievements_guard_row
before update on public.achievements
for each row execute function internal.guard_achievement_row();
create trigger achievements_enforce_context
before insert or update of user_id, activity_id, experience_id, project_id, source_excerpt, source_activity_revision
on public.achievements
for each row execute function internal.enforce_achievement_context();

create or replace function internal.sync_activity_context_to_achievements()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.experience_id is distinct from old.experience_id
     or new.project_id is distinct from old.project_id then
    update public.achievements as achievement
    set experience_id = new.experience_id,
        project_id = new.project_id
    where achievement.user_id = new.user_id
      and achievement.activity_id = new.id
      and (achievement.experience_id is distinct from new.experience_id
           or achievement.project_id is distinct from new.project_id);
  end if;
  return new;
end;
$$;

create trigger activities_sync_achievement_context
after update of experience_id, project_id on public.activities
for each row execute function internal.sync_activity_context_to_achievements();

create or replace function public.create_achievement_idempotent(
  p_operation_key uuid,
  p_activity_id uuid,
  p_project_id uuid,
  p_experience_id uuid
)
returns table (
  achievement_id uuid,
  user_id uuid,
  revision integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb;
  v_payload_hash bytea;
  v_existing_hash bytea;
  v_existing_table text;
  v_existing_id uuid;
  v_existing_payload jsonb;
  v_completed_at timestamptz;
  v_rows integer;
  v_activity public.activities%rowtype;
  v_project public.projects%rowtype;
  v_achievement public.achievements%rowtype;
  v_existing_achievement_id uuid;
  v_receipt jsonb;
  v_lock_id uuid;
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

  v_payload := pg_catalog.jsonb_build_object(
    'activity_id', p_activity_id,
    'project_id', p_project_id,
    'experience_id', p_experience_id
  );
  v_payload_hash := extensions.digest(v_payload::text, 'sha256');

  -- Claim/replay the receipt before looking up live parents. An identical
  -- retry remains safe even after the source Activity or Project is deleted.
  insert into internal.operation_requests (
    user_id, operation_kind, operation_key, input_revision, payload_hash
  ) values (
    v_user_id, 'achievement.create', p_operation_key, 0, v_payload_hash
  ) on conflict on constraint operation_requests_pkey do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select operation.payload_hash, operation.result_table, operation.result_id,
      operation.result_payload, operation.completed_at
    into v_existing_hash, v_existing_table, v_existing_id,
      v_existing_payload, v_completed_at
    from internal.operation_requests as operation
    where operation.user_id = v_user_id
      and operation.operation_kind = 'achievement.create'
      and operation.operation_key = p_operation_key
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;
    if v_existing_hash is distinct from v_payload_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing_table is distinct from 'achievements'
       or v_existing_id is null
       or v_existing_payload is null
       or v_completed_at is null then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;
    if (v_existing_payload ->> 'achievement_id')::uuid is distinct from v_existing_id
       or (v_existing_payload ->> 'user_id')::uuid is distinct from v_user_id
       or (v_existing_payload ->> 'revision')::integer is distinct from 1 then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;
    return query select
      (v_existing_payload ->> 'achievement_id')::uuid,
      (v_existing_payload ->> 'user_id')::uuid,
      (v_existing_payload ->> 'revision')::integer;
    return;
  end if;

  if p_activity_id is not null and (p_project_id is not null or p_experience_id is not null) then
    raise exception using errcode = '22023', message = 'INVALID_ACHIEVEMENT_INPUT';
  end if;

  if p_activity_id is not null then
    select activity.* into v_activity
    from public.activities as activity
    where activity.user_id = v_user_id and activity.id = p_activity_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
    end if;

    if v_activity.experience_id is not null then
      perform 1 from public.experiences as experience
      where experience.user_id = v_user_id and experience.id = v_activity.experience_id
      for update;
      if not found then
        raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
      end if;
    end if;
    if v_activity.project_id is not null then
      select project.* into v_project
      from public.projects as project
      where project.user_id = v_user_id and project.id = v_activity.project_id
      for update;
      if not found then
        raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
      end if;
    end if;

    select activity.* into v_activity
    from public.activities as activity
    where activity.user_id = v_user_id and activity.id = p_activity_id
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
    end if;
    select achievement.id into v_existing_achievement_id
    from public.achievements as achievement
    where achievement.user_id = v_user_id and achievement.activity_id = p_activity_id
    for update;
    if found then
      raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_EXISTS';
    end if;

    insert into public.achievements (
      user_id, activity_id, experience_id, project_id, origin,
      source_excerpt, source_activity_revision
    ) values (
      v_user_id, v_activity.id, v_activity.experience_id, v_activity.project_id, 'activity',
      v_activity.raw_text, v_activity.revision
    ) returning * into v_achievement;
  else
    if p_project_id is not null then
      select project.* into v_project
      from public.projects as project
      where project.user_id = v_user_id and project.id = p_project_id;
      if not found then
        raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
      end if;
      if v_project.experience_id is not null then
        perform 1 from public.experiences as experience
        where experience.user_id = v_user_id and experience.id = v_project.experience_id
        for update;
        if not found then
          raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
        end if;
      end if;
      select project.* into v_project
      from public.projects as project
      where project.user_id = v_user_id and project.id = p_project_id
      for update;
      insert into public.achievements (user_id, experience_id, project_id, origin)
      values (v_user_id, v_project.experience_id, v_project.id, 'manual')
      returning * into v_achievement;
    else
      if p_experience_id is not null then
        perform 1 from public.experiences as experience
        where experience.user_id = v_user_id and experience.id = p_experience_id
        for update;
        if not found then
          raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
        end if;
      end if;
      insert into public.achievements (user_id, experience_id, origin)
      values (v_user_id, p_experience_id, 'manual')
      returning * into v_achievement;
    end if;
  end if;

  v_receipt := pg_catalog.jsonb_build_object(
    'achievement_id', v_achievement.id,
    'user_id', v_achievement.user_id,
    'revision', v_achievement.revision
  );
  update internal.operation_requests
  set result_table = 'achievements',
      result_id = v_achievement.id,
      result_payload = v_receipt,
      completed_at = pg_catalog.clock_timestamp()
  where operation_requests.user_id = v_user_id
    and operation_requests.operation_kind = 'achievement.create'
    and operation_requests.operation_key = p_operation_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
  end if;
  return query select v_achievement.id, v_achievement.user_id, v_achievement.revision;
exception
  when unique_violation then
    if sqlerrm like '%achievements_one_derived_activity_idx%' then
      raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_EXISTS';
    end if;
    raise;
end;
$$;

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
  v_key_count integer;
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

  if (p_changes ? 'title' and p_changes -> 'title' is not null and pg_catalog.jsonb_typeof(p_changes -> 'title') <> 'string')
     or (p_changes ? 'contribution' and p_changes -> 'contribution' is not null and pg_catalog.jsonb_typeof(p_changes -> 'contribution') <> 'string')
     or (p_changes ? 'scope' and p_changes -> 'scope' is not null and pg_catalog.jsonb_typeof(p_changes -> 'scope') <> 'string')
     or (p_changes ? 'outcome' and p_changes -> 'outcome' is not null and pg_catalog.jsonb_typeof(p_changes -> 'outcome') <> 'string')
     or (p_changes ? 'cv_bullet' and p_changes -> 'cv_bullet' is not null and pg_catalog.jsonb_typeof(p_changes -> 'cv_bullet') <> 'string')
     or (p_changes ? 'achieved_on' and p_changes -> 'achieved_on' is not null and pg_catalog.jsonb_typeof(p_changes -> 'achieved_on') <> 'string') then
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

create or replace function internal.sync_project_experience_to_achievements()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.experience_id is distinct from old.experience_id then
    update public.achievements as achievement
    set experience_id = new.experience_id
    where achievement.user_id = new.user_id
      and achievement.project_id = new.id
      and achievement.activity_id is null
      and achievement.experience_id is distinct from new.experience_id;
  end if;
  return new;
end;
$$;

create trigger projects_sync_achievement_experience
after update of experience_id on public.projects
for each row execute function internal.sync_project_experience_to_achievements();

create or replace function public.relink_achievement_project(
  p_achievement_id uuid,
  p_expected_revision integer,
  p_project_id uuid
)
returns setof public.achievements
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_snapshot public.achievements%rowtype;
  v_achievement public.achievements%rowtype;
  v_activity public.activities%rowtype;
  v_target_project public.projects%rowtype;
  v_experience_id uuid;
  v_target_experience_id uuid;
  v_lock_id uuid;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles where id = v_user_id and deleting_at is null)
     or p_achievement_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select achievement.* into v_snapshot
  from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.id = p_achievement_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
  end if;

  if p_project_id is not null then
    select project.* into v_target_project
    from public.projects as project
    where project.user_id = v_user_id and project.id = p_project_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
    end if;
    v_target_experience_id := v_target_project.experience_id;
  end if;

  -- Experience -> Project -> Activity -> Achievement. The target and current
  -- context rows are locked in deterministic UUID order before mutation.
  for v_lock_id in
    select experience.id
    from public.experiences as experience
    where experience.user_id = v_user_id
      and experience.id = any(array_remove(array[v_snapshot.experience_id, v_target_experience_id], null::uuid))
    order by experience.id
    for update
  loop
    null;
  end loop;
  for v_lock_id in
    select project.id
    from public.projects as project
    where project.user_id = v_user_id
      and project.id = any(array_remove(array[v_snapshot.project_id, p_project_id], null::uuid))
    order by project.id
    for update
  loop
    null;
  end loop;

  if v_snapshot.activity_id is not null then
    select activity.* into v_activity
    from public.activities as activity
    where activity.user_id = v_user_id and activity.id = v_snapshot.activity_id
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
    end if;
    v_experience_id := case when p_project_id is null then v_activity.experience_id else v_target_experience_id end;
  else
    v_experience_id := case when p_project_id is null then v_snapshot.experience_id else v_target_experience_id end;
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

  if v_snapshot.activity_id is not null then
    if v_activity.project_id is distinct from p_project_id or v_activity.experience_id is distinct from v_experience_id then
      update public.activities as activity
      set project_id = p_project_id,
          experience_id = v_experience_id
      where activity.user_id = v_user_id
        and activity.id = v_activity.id;
    end if;
  else
    if v_achievement.project_id is distinct from p_project_id or v_achievement.experience_id is distinct from v_experience_id then
      update public.achievements as achievement
      set project_id = p_project_id,
          experience_id = v_experience_id
      where achievement.user_id = v_user_id
        and achievement.id = p_achievement_id
        and achievement.revision = p_expected_revision;
    end if;
  end if;

  select achievement.* into v_achievement
  from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.id = p_achievement_id
  for update;
  return next v_achievement;
end;
$$;

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
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles where id = v_user_id and deleting_at is null)
     or p_achievement_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
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
  delete from public.achievement_skills
  where user_id = v_user_id and achievement_id = v_achievement.id;
  delete from public.achievements
  where user_id = v_user_id and id = v_achievement.id and revision = p_expected_revision;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_UNAVAILABLE';
  end if;
  return query select v_achievement.id, v_retained;
end;
$$;

create or replace function public.delete_activity(
  p_activity_id uuid,
  p_expected_revision integer
)
returns table (
  deleted_activity_id uuid,
  retained_achievement_count integer,
  retained_chat_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_snapshot public.activities%rowtype;
  v_activity public.activities%rowtype;
  v_achievement public.achievements%rowtype;
  v_retained_count integer := 0;
  v_chat_count integer := 0;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles where id = v_user_id and deleting_at is null)
     or p_activity_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select activity.* into v_snapshot
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = p_activity_id;
  if not found then return; end if;

  if v_snapshot.experience_id is not null then
    perform 1 from public.experiences as experience
    where experience.user_id = v_user_id and experience.id = v_snapshot.experience_id
    for update;
  end if;
  if v_snapshot.project_id is not null then
    perform 1 from public.projects as project
    where project.user_id = v_user_id and project.id = v_snapshot.project_id
    for update;
  end if;

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = p_activity_id
  for update;
  if not found then return; end if;
  if v_activity.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  select pg_catalog.count(*)::integer into v_retained_count
  from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.activity_id = p_activity_id;
  select pg_catalog.count(*)::integer into v_chat_count
  from public.chat_messages as message
  where message.user_id = v_user_id and message.activity_id = p_activity_id;

  for v_achievement in
    select achievement.*
    from public.achievements as achievement
    where achievement.user_id = v_user_id and achievement.activity_id = p_activity_id
    order by achievement.id
    for update
  loop
    update public.achievements as achievement
    set activity_id = null
    where achievement.user_id = v_user_id and achievement.id = v_achievement.id;
  end loop;

  delete from public.activities
  where user_id = v_user_id and id = p_activity_id and revision = p_expected_revision;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACTIVITY_UNAVAILABLE';
  end if;
  return query select p_activity_id, v_retained_count, v_chat_count;
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
  v_snapshot public.activities%rowtype;
  v_activity public.activities%rowtype;
  v_target_project public.projects%rowtype;
  v_target_experience_id uuid;
  v_lock_id uuid;
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles where id = v_user_id and deleting_at is null)
     or p_activity_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select activity.* into v_snapshot
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = p_activity_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACTIVITY_UNAVAILABLE';
  end if;
  if p_project_id is not null then
    select project.* into v_target_project
    from public.projects as project
    where project.user_id = v_user_id and project.id = p_project_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'ACTIVITY_UNAVAILABLE';
    end if;
    v_target_experience_id := v_target_project.experience_id;
  end if;

  for v_lock_id in
    select experience.id
    from public.experiences as experience
    where experience.user_id = v_user_id
      and experience.id = any(array_remove(array[v_snapshot.experience_id, v_target_experience_id], null::uuid))
    order by experience.id
    for update
  loop
    null;
  end loop;
  for v_lock_id in
    select project.id
    from public.projects as project
    where project.user_id = v_user_id
      and project.id = any(array_remove(array[v_snapshot.project_id, p_project_id], null::uuid))
    order by project.id
    for update
  loop
    null;
  end loop;

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = p_activity_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACTIVITY_UNAVAILABLE';
  end if;
  if v_activity.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  v_target_experience_id := case when p_project_id is null then v_activity.experience_id else v_target_experience_id end;
  if v_activity.project_id is not distinct from p_project_id
     and v_activity.experience_id is not distinct from v_target_experience_id then
    return next v_activity;
    return;
  end if;
  update public.activities as activity
  set project_id = p_project_id,
      experience_id = v_target_experience_id
  where activity.user_id = v_user_id
    and activity.id = p_activity_id
    and activity.revision = p_expected_revision
  returning activity.* into v_activity;
  if not found then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  return next v_activity;
end;
$$;

drop function if exists public.delete_project(uuid, integer);

create function public.delete_project(
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
begin
  if v_user_id is null
     or not exists (select 1 from public.profiles where id = v_user_id and deleting_at is null)
     or p_project_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
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

  delete from public.projects as project
  where project.user_id = v_user_id and project.id = p_project_id and project.revision = p_expected_revision
  returning project.id into v_deleted_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROJECT_UNAVAILABLE';
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
begin
  if v_user_id is null or p_experience_id is null or p_expected_revision is null or p_expected_revision < 1 then return; end if;
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

  delete from public.experiences as experience
  where experience.user_id = v_user_id and experience.id = p_experience_id and experience.revision = p_expected_revision;
  if not found then return; end if;
  return query select p_experience_id, v_project_count;
end;
$$;

revoke all on function public.create_achievement_idempotent(uuid, uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.save_achievement(uuid, integer, text, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.relink_achievement_project(uuid, integer, uuid) from public, anon, service_role;
revoke all on function public.delete_achievement(uuid, integer) from public, anon, service_role;
revoke all on function public.delete_activity(uuid, integer) from public, anon, service_role;
revoke all on function public.relink_activity_project(uuid, integer, uuid) from public, anon, service_role;
revoke all on function public.delete_project(uuid, integer) from public, anon, service_role;
revoke all on function public.delete_experience(uuid, integer) from public, anon, service_role;

grant execute on function public.create_achievement_idempotent(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.save_achievement(uuid, integer, text, jsonb, jsonb) to authenticated;
grant execute on function public.relink_achievement_project(uuid, integer, uuid) to authenticated;
grant execute on function public.delete_achievement(uuid, integer) to authenticated;
grant execute on function public.delete_activity(uuid, integer) to authenticated;
grant execute on function public.relink_activity_project(uuid, integer, uuid) to authenticated;
grant execute on function public.delete_project(uuid, integer) to authenticated;
grant execute on function public.delete_experience(uuid, integer) to authenticated;

revoke all on function internal.is_valid_achievement_metrics(jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.factual_cv_bullet(text, text) from public, anon, authenticated, service_role;
revoke all on function internal.guard_achievement_row() from public, anon, authenticated, service_role;
revoke all on function internal.enforce_achievement_context() from public, anon, authenticated, service_role;
revoke all on function internal.sync_activity_context_to_achievements() from public, anon, authenticated, service_role;
revoke all on function internal.sync_project_experience_to_achievements() from public, anon, authenticated, service_role;

comment on function public.create_achievement_idempotent(uuid, uuid, uuid, uuid) is
  'Owner-scoped idempotent manual or Activity-derived Achievement draft creation.';
comment on function public.save_achievement(uuid, integer, text, jsonb, jsonb) is
  'Owner-scoped Achievement lifecycle transition and atomic skill replacement.';
comment on function public.delete_activity(uuid, integer) is
  'Deletes an Activity while detaching and preserving derived Achievement provenance.';
comment on function public.delete_project(uuid, integer) is
  'Deletes a Project while releasing linked Activity and Achievement project context.';

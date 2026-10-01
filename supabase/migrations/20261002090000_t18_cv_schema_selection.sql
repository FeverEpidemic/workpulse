-- T18 CV schema and selection service (PRD R09, F07 step 1-2, DB §5/§6, decision 0024).
-- Forward-only. Adds cv_documents, cv_items, cv_exports (structure only) and five authenticated RPCs.
-- Lock order for CV RPCs: profile (share) -> cv_documents (update) -> touched cv_items (update, by id) ->
-- sources (share, parent first). Source-delete paths lock source -> cv_items through the FK and never wait
-- on cv_documents, so the orders cannot form a cycle.

-- 1. Helpers ----------------------------------------------------------------------------------------------

create or replace function internal.cv_section_keys()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array['experience', 'projects', 'achievements', 'education', 'skills', 'certifications']::text[]
$$;

create or replace function internal.is_valid_cv_section_order(p_order jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_keys text[] := internal.cv_section_keys();
  v_seen text[] := array[]::text[];
  v_element jsonb;
begin
  if p_order is null or pg_catalog.jsonb_typeof(p_order) <> 'array'
     or pg_catalog.jsonb_array_length(p_order) <> pg_catalog.cardinality(v_keys) then
    return false;
  end if;
  for v_element in select value from pg_catalog.jsonb_array_elements(p_order) as items(value) loop
    if pg_catalog.jsonb_typeof(v_element) <> 'string'
       or not ((v_element #>> '{}') = any (v_keys))
       or (v_element #>> '{}') = any (v_seen) then
      return false;
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_element #>> '{}');
  end loop;
  return true;
end;
$$;

grant execute on function internal.cv_section_keys() to authenticated, service_role;
grant execute on function internal.is_valid_cv_section_order(jsonb) to authenticated, service_role;

-- 2. Tables ----------------------------------------------------------------------------------------------

create table public.cv_documents (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Master CV',
  locale text not null,
  template_key text not null default 'single_column_v1',
  summary_override text,
  profile_snapshot jsonb not null,
  profile_source_revision integer not null,
  profile_ack_revision integer,
  section_order jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  revision integer not null default 1,
  constraint cv_documents_user_key unique (user_id),
  constraint cv_documents_user_id_id_key unique (user_id, id),
  constraint cv_documents_title_check check (
    title = pg_catalog.btrim(title) and title <> '' and pg_catalog.char_length(title) <= 120
  ),
  constraint cv_documents_locale_check check (locale in ('en', 'id')),
  constraint cv_documents_template_check check (template_key = 'single_column_v1'),
  constraint cv_documents_summary_override_check check (
    summary_override is null
    or (summary_override = pg_catalog.btrim(summary_override) and summary_override <> ''
        and pg_catalog.char_length(summary_override) <= 5000)
  ),
  constraint cv_documents_profile_snapshot_check check (
    pg_catalog.jsonb_typeof(profile_snapshot) = 'object' and pg_catalog.pg_column_size(profile_snapshot) <= 8192
  ),
  constraint cv_documents_profile_source_revision_check check (profile_source_revision > 0),
  constraint cv_documents_profile_ack_revision_check check (profile_ack_revision is null or profile_ack_revision > 0),
  constraint cv_documents_section_order_check check (internal.is_valid_cv_section_order(section_order)),
  constraint cv_documents_revision_positive check (revision > 0)
);

create table public.cv_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cv_id uuid not null,
  section_key text not null,
  position integer not null,
  experience_id uuid,
  project_id uuid,
  achievement_id uuid,
  education_id uuid,
  skill_id uuid,
  certification_id uuid,
  source_snapshot jsonb not null,
  source_revision integer not null,
  override_text text,
  acknowledged_revision integer,
  source_deleted boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  revision integer not null default 1,
  constraint cv_items_user_id_id_key unique (user_id, id),
  constraint cv_items_cv_fk foreign key (user_id, cv_id)
    references public.cv_documents (user_id, id) on delete cascade,
  constraint cv_items_experience_fk foreign key (user_id, experience_id)
    references public.experiences (user_id, id) on delete set null (experience_id),
  constraint cv_items_project_fk foreign key (user_id, project_id)
    references public.projects (user_id, id) on delete set null (project_id),
  constraint cv_items_achievement_fk foreign key (user_id, achievement_id)
    references public.achievements (user_id, id) on delete set null (achievement_id),
  constraint cv_items_education_fk foreign key (user_id, education_id)
    references public.education (user_id, id) on delete set null (education_id),
  constraint cv_items_skill_fk foreign key (user_id, skill_id)
    references public.skills (user_id, id) on delete set null (skill_id),
  constraint cv_items_certification_fk foreign key (user_id, certification_id)
    references public.certifications (user_id, id) on delete set null (certification_id),
  constraint cv_items_section_position_key unique (cv_id, section_key, position)
    deferrable initially immediate,
  constraint cv_items_section_key_check check (section_key = any (internal.cv_section_keys())),
  constraint cv_items_position_check check (position >= 1),
  constraint cv_items_source_revision_check check (source_revision > 0),
  constraint cv_items_acknowledged_revision_check check (acknowledged_revision is null or acknowledged_revision > 0),
  constraint cv_items_override_text_check check (
    override_text is null
    or (override_text = pg_catalog.btrim(override_text) and override_text <> ''
        and pg_catalog.char_length(override_text) <= 2000)
  ),
  constraint cv_items_source_snapshot_check check (
    pg_catalog.jsonb_typeof(source_snapshot) = 'object' and pg_catalog.pg_column_size(source_snapshot) <= 16384
  ),
  constraint cv_items_revision_positive check (revision > 0),
  constraint cv_items_source_check check (
    (source_deleted and pg_catalog.num_nonnulls(experience_id, project_id, achievement_id, education_id, skill_id, certification_id) = 0)
    or (
      not source_deleted
      and pg_catalog.num_nonnulls(experience_id, project_id, achievement_id, education_id, skill_id, certification_id) = 1
      and case section_key
        when 'experience' then experience_id is not null
        when 'projects' then project_id is not null
        when 'achievements' then achievement_id is not null
        when 'education' then education_id is not null
        when 'skills' then skill_id is not null
        when 'certifications' then certification_id is not null
        else false
      end
    )
  )
);

create unique index cv_items_cv_experience_key on public.cv_items (cv_id, experience_id) where experience_id is not null;
create unique index cv_items_cv_project_key on public.cv_items (cv_id, project_id) where project_id is not null;
create unique index cv_items_cv_achievement_key on public.cv_items (cv_id, achievement_id) where achievement_id is not null;
create unique index cv_items_cv_education_key on public.cv_items (cv_id, education_id) where education_id is not null;
create unique index cv_items_cv_skill_key on public.cv_items (cv_id, skill_id) where skill_id is not null;
create unique index cv_items_cv_certification_key on public.cv_items (cv_id, certification_id) where certification_id is not null;

create index cv_items_user_cv_section_position_idx on public.cv_items (user_id, cv_id, section_key, position);
create index cv_items_experience_fk_idx on public.cv_items (user_id, experience_id) where experience_id is not null;
create index cv_items_project_fk_idx on public.cv_items (user_id, project_id) where project_id is not null;
create index cv_items_achievement_fk_idx on public.cv_items (user_id, achievement_id) where achievement_id is not null;
create index cv_items_education_fk_idx on public.cv_items (user_id, education_id) where education_id is not null;
create index cv_items_skill_fk_idx on public.cv_items (user_id, skill_id) where skill_id is not null;
create index cv_items_certification_fk_idx on public.cv_items (user_id, certification_id) where certification_id is not null;

-- Structure only: T21 owns export behavior and may add columns or functions forward.
create table public.cv_exports (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cv_id uuid not null,
  cv_revision integer not null,
  snapshot jsonb not null,
  status text not null default 'queued',
  object_key text,
  idempotency_key text not null,
  error_code text,
  attempt_count integer not null default 0,
  attempt_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  revision integer not null default 1,
  constraint cv_exports_user_id_id_key unique (user_id, id),
  constraint cv_exports_user_idempotency_key unique (user_id, idempotency_key),
  constraint cv_exports_cv_fk foreign key (user_id, cv_id)
    references public.cv_documents (user_id, id) on delete cascade,
  constraint cv_exports_cv_revision_check check (cv_revision > 0),
  constraint cv_exports_snapshot_check check (pg_catalog.jsonb_typeof(snapshot) = 'object'),
  constraint cv_exports_status_check check (status in ('queued', 'running', 'succeeded', 'failed')),
  constraint cv_exports_object_key_check check (object_key is null or pg_catalog.btrim(object_key) <> ''),
  constraint cv_exports_idempotency_key_check check (
    idempotency_key = pg_catalog.btrim(idempotency_key) and idempotency_key <> ''
    and pg_catalog.char_length(idempotency_key) <= 200
  ),
  constraint cv_exports_error_code_check check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint cv_exports_attempt_count_check check (attempt_count between 0 and 3),
  constraint cv_exports_revision_positive check (revision > 0)
);

create index cv_exports_user_cv_created_idx on public.cv_exports (user_id, cv_id, created_at desc);

comment on table public.cv_documents is
  'The single master CV of an account. Canonical career rows stay authoritative; the CV holds selection, snapshots and wording.';
comment on table public.cv_items is
  'A selected CV source. Exactly one source column is set while source_deleted is false; the display snapshot is kept when the source is deleted.';
comment on table public.cv_exports is
  'Structure only in T18. Export requests, snapshots and worker leases are defined by T21.';
comment on column public.cv_items.source_snapshot is
  'Display fields (schema cv-source.v1) copied when the item was selected. Never raw_text, source_excerpt, contribution, evidence or activity ids.';
comment on column public.cv_items.source_revision is
  'Revision of the source at selection time; freshness (T20) compares it with the current source revision.';
comment on column public.cv_documents.section_order is
  'Permutation of the six supported section keys.';

-- 3. Triggers ---------------------------------------------------------------------------------------------

create or replace function internal.guard_cv_document_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.user_id is distinct from old.user_id or new.template_key is distinct from old.template_key then
    raise exception using errcode = 'P0001', message = 'CV_ITEM_IMMUTABLE';
  end if;
  return new;
end;
$$;

create or replace function internal.guard_cv_item_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_deleted boolean := false;
begin
  if new.user_id is distinct from old.user_id
     or new.cv_id is distinct from old.cv_id
     or new.section_key is distinct from old.section_key then
    raise exception using errcode = 'P0001', message = 'CV_ITEM_IMMUTABLE';
  end if;
  if (old.experience_id is null and new.experience_id is not null)
     or (old.project_id is null and new.project_id is not null)
     or (old.achievement_id is null and new.achievement_id is not null)
     or (old.education_id is null and new.education_id is not null)
     or (old.skill_id is null and new.skill_id is not null)
     or (old.certification_id is null and new.certification_id is not null)
     or (old.experience_id is not null and new.experience_id is not null and old.experience_id <> new.experience_id)
     or (old.project_id is not null and new.project_id is not null and old.project_id <> new.project_id)
     or (old.achievement_id is not null and new.achievement_id is not null and old.achievement_id <> new.achievement_id)
     or (old.education_id is not null and new.education_id is not null and old.education_id <> new.education_id)
     or (old.skill_id is not null and new.skill_id is not null and old.skill_id <> new.skill_id)
     or (old.certification_id is not null and new.certification_id is not null and old.certification_id <> new.certification_id)
     or (old.source_deleted and not new.source_deleted) then
    raise exception using errcode = 'P0001', message = 'CV_ITEM_IMMUTABLE';
  end if;
  -- The ON DELETE SET NULL action of a source foreign key is an ordinary UPDATE; mark the item deleted.
  v_deleted := (old.experience_id is not null and new.experience_id is null)
    or (old.project_id is not null and new.project_id is null)
    or (old.achievement_id is not null and new.achievement_id is null)
    or (old.education_id is not null and new.education_id is null)
    or (old.skill_id is not null and new.skill_id is null)
    or (old.certification_id is not null and new.certification_id is null);
  if v_deleted then
    new.source_deleted := true;
  end if;
  return new;
end;
$$;

create trigger cv_documents_a_guard
before update on public.cv_documents
for each row execute function internal.guard_cv_document_row();
create trigger cv_documents_touch_mutable_row
before update on public.cv_documents
for each row execute function internal.touch_mutable_row();

create trigger cv_items_a_guard
before update on public.cv_items
for each row execute function internal.guard_cv_item_row();
create trigger cv_items_touch_mutable_row
before update on public.cv_items
for each row execute function internal.touch_mutable_row();

create trigger cv_exports_touch_mutable_row
before update on public.cv_exports
for each row execute function internal.touch_mutable_row();

-- 4. RLS and privileges ---------------------------------------------------------------------------------

alter table public.cv_documents enable row level security;
alter table public.cv_items enable row level security;
alter table public.cv_exports enable row level security;

create policy cv_documents_select_own on public.cv_documents
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy cv_items_select_own on public.cv_items
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy cv_exports_select_own on public.cv_exports
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.cv_documents, public.cv_items, public.cv_exports
  from public, anon, authenticated, service_role;
grant select on table public.cv_documents, public.cv_items, public.cv_exports to authenticated;

-- 5. Snapshot builder ---------------------------------------------------------------------------------------

create or replace function internal.cv_source_revision(p_user_id uuid, p_source_type text, p_source_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_revision integer;
begin
  case p_source_type
    when 'experience' then
      select s.revision into v_revision from public.experiences as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'project' then
      select s.revision into v_revision from public.projects as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'achievement' then
      select s.revision into v_revision from public.achievements as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'education' then
      select s.revision into v_revision from public.education as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'skill' then
      select s.revision into v_revision from public.skills as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'certification' then
      select s.revision into v_revision from public.certifications as s where s.user_id = p_user_id and s.id = p_source_id;
    else
      v_revision := null;
  end case;
  return v_revision;
end;
$$;

create or replace function internal.cv_source_snapshot(p_user_id uuid, p_source_type text, p_source_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_snapshot jsonb;
begin
  case p_source_type
    when 'experience' then
      select pg_catalog.jsonb_build_object(
        'schema_version', 'cv-source.v1', 'source_type', 'experience', 'source_id', s.id,
        'organization', s.organization, 'role_title', s.role_title, 'kind', s.kind, 'description', s.description,
        'start_date', pg_catalog.to_char(s.start_date, 'YYYY-MM-DD'), 'start_precision', s.start_precision,
        'end_date', pg_catalog.to_char(s.end_date, 'YYYY-MM-DD'), 'end_precision', s.end_precision,
        'is_current', s.is_current)
      into v_snapshot from public.experiences as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'project' then
      select pg_catalog.jsonb_build_object(
        'schema_version', 'cv-source.v1', 'source_type', 'project', 'source_id', s.id,
        'title', s.title, 'description', s.description, 'user_role', s.user_role, 'outcome', s.outcome, 'status', s.status,
        'start_date', pg_catalog.to_char(s.start_date, 'YYYY-MM-DD'), 'start_precision', s.start_precision,
        'end_date', pg_catalog.to_char(s.end_date, 'YYYY-MM-DD'), 'end_precision', s.end_precision,
        'is_current', s.is_current, 'experience_id', s.experience_id)
      into v_snapshot from public.projects as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'achievement' then
      select pg_catalog.jsonb_build_object(
        'schema_version', 'cv-source.v1', 'source_type', 'achievement', 'source_id', s.id,
        'title', s.title, 'cv_bullet', s.cv_bullet, 'achieved_on', pg_catalog.to_char(s.achieved_on, 'YYYY-MM-DD'),
        'experience_id', s.experience_id, 'project_id', s.project_id)
      into v_snapshot from public.achievements as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'education' then
      select pg_catalog.jsonb_build_object(
        'schema_version', 'cv-source.v1', 'source_type', 'education', 'source_id', s.id,
        'institution', s.institution, 'qualification', s.qualification, 'field_of_study', s.field_of_study,
        'description', s.description,
        'start_date', pg_catalog.to_char(s.start_date, 'YYYY-MM-DD'), 'start_precision', s.start_precision,
        'end_date', pg_catalog.to_char(s.end_date, 'YYYY-MM-DD'), 'end_precision', s.end_precision,
        'is_current', s.is_current)
      into v_snapshot from public.education as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'skill' then
      select pg_catalog.jsonb_build_object(
        'schema_version', 'cv-source.v1', 'source_type', 'skill', 'source_id', s.id, 'name', s.name)
      into v_snapshot from public.skills as s where s.user_id = p_user_id and s.id = p_source_id;
    when 'certification' then
      select pg_catalog.jsonb_build_object(
        'schema_version', 'cv-source.v1', 'source_type', 'certification', 'source_id', s.id,
        'name', s.name, 'issuer', s.issuer, 'issued_date', pg_catalog.to_char(s.issued_date, 'YYYY-MM-DD'),
        'issued_precision', s.issued_precision, 'credential_url', s.credential_url)
      into v_snapshot from public.certifications as s where s.user_id = p_user_id and s.id = p_source_id;
    else
      v_snapshot := null;
  end case;
  return v_snapshot;
end;
$$;

revoke all on function internal.cv_source_revision(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function internal.cv_source_snapshot(uuid, text, uuid) from public, anon, authenticated, service_role;

-- 6. Internal RPC helpers ---------------------------------------------------------------------------------

create or replace function internal.cv_actor()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  perform 1 from public.profiles as profile
  where profile.id = v_user_id and profile.deleting_at is null
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  return v_user_id;
end;
$$;

create or replace function internal.cv_lock(p_user_id uuid, p_expected_revision integer)
returns public.cv_documents
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_cv public.cv_documents%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;
  select document.* into v_cv from public.cv_documents as document
  where document.user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CV_NOT_FOUND';
  end if;
  if v_cv.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  return v_cv;
end;
$$;

-- Locks one source row FOR SHARE; false when the owner has no such row.
create or replace function internal.cv_lock_source(p_user_id uuid, p_source_type text, p_source_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  case p_source_type
    when 'experience' then
      perform 1 from public.experiences as s where s.user_id = p_user_id and s.id = p_source_id for share;
    when 'project' then
      perform 1 from public.projects as s where s.user_id = p_user_id and s.id = p_source_id for share;
    when 'achievement' then
      perform 1 from public.achievements as s where s.user_id = p_user_id and s.id = p_source_id for share;
    when 'education' then
      perform 1 from public.education as s where s.user_id = p_user_id and s.id = p_source_id for share;
    when 'skill' then
      perform 1 from public.skills as s where s.user_id = p_user_id and s.id = p_source_id for share;
    when 'certification' then
      perform 1 from public.certifications as s where s.user_id = p_user_id and s.id = p_source_id for share;
    else
      return false;
  end case;
  return found;
end;
$$;

create or replace function internal.cv_section_for_source(p_source_type text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_source_type
    when 'experience' then 'experience'
    when 'project' then 'projects'
    when 'achievement' then 'achievements'
    when 'education' then 'education'
    when 'skill' then 'skills'
    when 'certification' then 'certifications'
  end
$$;

-- Appends an item for an already locked source at the end of its section; returns the new item id.
create or replace function internal.cv_append_item(p_user_id uuid, p_cv_id uuid, p_source_type text, p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_section text := internal.cv_section_for_source(p_source_type);
  v_snapshot jsonb := internal.cv_source_snapshot(p_user_id, p_source_type, p_source_id);
  v_revision integer := internal.cv_source_revision(p_user_id, p_source_type, p_source_id);
  v_position integer;
  v_id uuid;
begin
  if v_snapshot is null or v_revision is null then
    raise exception using errcode = 'P0001', message = 'CV_SOURCE_NOT_FOUND';
  end if;
  select coalesce(pg_catalog.max(item.position), 0) + 1 into v_position
  from public.cv_items as item where item.cv_id = p_cv_id and item.section_key = v_section;
  begin
    insert into public.cv_items (
      user_id, cv_id, section_key, position, experience_id, project_id, achievement_id, education_id, skill_id,
      certification_id, source_snapshot, source_revision
    ) values (
      p_user_id, p_cv_id, v_section, v_position,
      case when p_source_type = 'experience' then p_source_id end,
      case when p_source_type = 'project' then p_source_id end,
      case when p_source_type = 'achievement' then p_source_id end,
      case when p_source_type = 'education' then p_source_id end,
      case when p_source_type = 'skill' then p_source_id end,
      case when p_source_type = 'certification' then p_source_id end,
      v_snapshot, v_revision
    ) returning id into v_id;
  exception when check_violation then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end;
  return v_id;
end;
$$;

create or replace function internal.cv_renumber_section(p_cv_id uuid, p_section_key text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  set constraints public.cv_items_section_position_key deferred;
  update public.cv_items as item
  set position = ranked.new_position
  from (
    select i.id, pg_catalog.row_number() over (order by i.position, i.id)::integer as new_position
    from public.cv_items as i
    where i.cv_id = p_cv_id and i.section_key = p_section_key
  ) as ranked
  where item.id = ranked.id and item.position <> ranked.new_position;
  set constraints public.cv_items_section_position_key immediate;
end;
$$;

revoke all on function internal.cv_actor() from public, anon, authenticated, service_role;
revoke all on function internal.cv_lock(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function internal.cv_lock_source(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function internal.cv_section_for_source(text) from public, anon, authenticated, service_role;
revoke all on function internal.cv_append_item(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function internal.cv_renumber_section(uuid, text) from public, anon, authenticated, service_role;

-- 7. RPCs -----------------------------------------------------------------------------------------------------

create or replace function public.ensure_cv_document()
returns table (cv_id uuid, revision integer, created boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_document public.cv_documents%rowtype;
  v_new_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select profile.* into v_profile from public.profiles as profile where profile.id = v_user_id for share;
  if not found or v_profile.deleting_at is not null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if v_profile.onboarding_completed_at is null then
    raise exception using errcode = '22023', message = 'ONBOARDING_REQUIRED';
  end if;

  insert into public.cv_documents (user_id, locale, profile_snapshot, profile_source_revision, section_order)
  values (
    v_user_id,
    v_profile.locale,
    pg_catalog.jsonb_build_object(
      'schema_version', 'cv-profile.v1',
      'display_name', v_profile.display_name,
      'headline', v_profile.headline,
      'summary', v_profile.summary,
      'contact_email', v_profile.contact_email,
      'phone', v_profile.phone,
      'location', v_profile.location,
      'website', v_profile.website
    ),
    v_profile.revision,
    pg_catalog.to_jsonb(internal.cv_section_keys())
  )
  on conflict (user_id) do nothing
  returning id into v_new_id;

  select document.* into v_document from public.cv_documents as document where document.user_id = v_user_id;
  return query select v_document.id, v_document.revision, v_new_id is not null;
end;
$$;

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

  if not internal.cv_lock_source(v_user_id, p_source_type, p_source_id) then
    raise exception using errcode = 'P0001', message = 'CV_SOURCE_NOT_FOUND';
  end if;
  if p_source_type = 'achievement' then
    select achievement.* into v_achievement from public.achievements as achievement
    where achievement.user_id = v_user_id and achievement.id = p_source_id;
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

  if p_source_type = 'achievement' then
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
      select item.id into v_parent_item from public.cv_items as item
      where item.cv_id = v_cv.id
        and case v_parent_type when 'project' then item.project_id else item.experience_id end = v_parent_id;
      if v_parent_item is null then
        v_parent_item := internal.cv_append_item(v_user_id, v_cv.id, v_parent_type, v_parent_id);
        v_created := pg_catalog.array_append(v_created, v_parent_item);
        v_parents := pg_catalog.array_append(v_parents, v_parent_item);
      end if;
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

create or replace function public.remove_cv_item(
  p_expected_revision integer,
  p_item_id uuid,
  p_remove_children boolean
)
returns table (cv_revision integer, removed_item_ids uuid[])
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.cv_actor();
  v_cv public.cv_documents%rowtype;
  v_item public.cv_items%rowtype;
  v_source_id text;
  v_children uuid[] := array[]::uuid[];
  v_removed uuid[];
  v_new_revision integer;
begin
  if p_expected_revision is null or p_item_id is null or p_remove_children is null then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;
  v_cv := internal.cv_lock(v_user_id, p_expected_revision);

  select item.* into v_item from public.cv_items as item
  where item.user_id = v_user_id and item.cv_id = v_cv.id and item.id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CV_ITEM_NOT_FOUND';
  end if;

  if v_item.section_key in ('experience', 'projects') then
    v_source_id := v_item.source_snapshot ->> 'source_id';
    select coalesce(pg_catalog.array_agg(child.id order by child.id), array[]::uuid[]) into v_children
    from public.cv_items as child
    where child.cv_id = v_cv.id and child.section_key = 'achievements'
      and case v_item.section_key
        when 'projects' then child.source_snapshot ->> 'project_id' = v_source_id
        else child.source_snapshot ->> 'project_id' is null and child.source_snapshot ->> 'experience_id' = v_source_id
      end;
    if pg_catalog.cardinality(v_children) > 0 then
      if not p_remove_children then
        raise exception using errcode = 'P0001', message = 'CV_CHILD_ITEMS_EXIST',
          detail = (select pg_catalog.jsonb_agg(child_id order by child_id)::text from pg_catalog.unnest(v_children) as t(child_id));
      end if;
      perform 1 from public.cv_items as child where child.id = any (v_children) order by child.id for update;
    end if;
  end if;

  v_removed := pg_catalog.array_append(v_children, v_item.id);
  delete from public.cv_items as item where item.id = any (v_removed);

  perform internal.cv_renumber_section(v_cv.id, v_item.section_key);
  if pg_catalog.cardinality(v_children) > 0 then
    perform internal.cv_renumber_section(v_cv.id, 'achievements');
  end if;

  update public.cv_documents as document set updated_at = document.updated_at
  where document.id = v_cv.id
  returning document.revision into v_new_revision;
  return query select v_new_revision, v_removed;
end;
$$;

create or replace function public.reorder_cv_section(
  p_expected_revision integer,
  p_section_key text,
  p_item_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := internal.cv_actor();
  v_cv public.cv_documents%rowtype;
  v_current uuid[];
  v_new_revision integer;
begin
  if p_expected_revision is null or p_section_key is null or p_item_ids is null
     or not (p_section_key = any (internal.cv_section_keys())) then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;
  v_cv := internal.cv_lock(v_user_id, p_expected_revision);

  perform 1 from public.cv_items as item
  where item.cv_id = v_cv.id and item.section_key = p_section_key
  order by item.id for update;
  select coalesce(pg_catalog.array_agg(item.id order by item.id), array[]::uuid[]) into v_current
  from public.cv_items as item
  where item.cv_id = v_cv.id and item.section_key = p_section_key;

  if pg_catalog.cardinality(p_item_ids) <> pg_catalog.cardinality(v_current)
     or (select pg_catalog.count(distinct requested.item_id) from pg_catalog.unnest(p_item_ids) as requested(item_id))
        <> pg_catalog.cardinality(p_item_ids)
     or exists (
       select 1 from pg_catalog.unnest(p_item_ids) as requested(item_id)
       where requested.item_id is null or not (requested.item_id = any (v_current))
     ) then
    raise exception using errcode = 'P0001', message = 'CV_REORDER_INVALID';
  end if;

  set constraints public.cv_items_section_position_key deferred;
  update public.cv_items as item
  set position = requested.ordinal::integer
  from pg_catalog.unnest(p_item_ids) with ordinality as requested(item_id, ordinal)
  where item.id = requested.item_id and item.position <> requested.ordinal::integer;
  set constraints public.cv_items_section_position_key immediate;

  update public.cv_documents as document set updated_at = document.updated_at
  where document.id = v_cv.id
  returning document.revision into v_new_revision;
  return v_new_revision;
end;
$$;

create or replace function public.update_cv_layout(
  p_expected_revision integer,
  p_locale text,
  p_section_order jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := internal.cv_actor();
  v_cv public.cv_documents%rowtype;
  v_new_revision integer;
begin
  if p_expected_revision is null or (p_locale is null and p_section_order is null) then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;
  v_cv := internal.cv_lock(v_user_id, p_expected_revision);
  if (p_locale is not null and p_locale not in ('en', 'id'))
     or (p_section_order is not null and not internal.is_valid_cv_section_order(p_section_order)) then
    raise exception using errcode = '22023', message = 'INVALID_CV_INPUT';
  end if;

  update public.cv_documents as document
  set locale = coalesce(p_locale, document.locale),
      section_order = coalesce(p_section_order, document.section_order)
  where document.id = v_cv.id
  returning document.revision into v_new_revision;
  return v_new_revision;
end;
$$;

revoke all on function public.ensure_cv_document() from public, anon, service_role;
revoke all on function public.select_cv_source(integer, text, uuid) from public, anon, service_role;
revoke all on function public.remove_cv_item(integer, uuid, boolean) from public, anon, service_role;
revoke all on function public.reorder_cv_section(integer, text, uuid[]) from public, anon, service_role;
revoke all on function public.update_cv_layout(integer, text, jsonb) from public, anon, service_role;
grant execute on function public.ensure_cv_document() to authenticated;
grant execute on function public.select_cv_source(integer, text, uuid) to authenticated;
grant execute on function public.remove_cv_item(integer, uuid, boolean) to authenticated;
grant execute on function public.reorder_cv_section(integer, text, uuid[]) to authenticated;
grant execute on function public.update_cv_layout(integer, text, jsonb) to authenticated;

comment on function public.ensure_cv_document() is
  'Idempotent first open of the single master CV (UNIQUE(user_id) + ON CONFLICT DO NOTHING).';
comment on function public.select_cv_source(integer, text, uuid) is
  'Adds a source to the master CV; an achievement adds its required parent (project, else experience) in the same transaction.';
comment on function public.remove_cv_item(integer, uuid, boolean) is
  'Removes a CV item; a parent with child achievement items needs p_remove_children = true.';
comment on function public.reorder_cv_section(integer, text, uuid[]) is
  'Rewrites positions 1..n for the exact set of items in a section using a deferred unique constraint.';
comment on function public.update_cv_layout(integer, text, jsonb) is
  'Sets the CV label locale and/or the section order. Never translates source content.';

-- T06 Activity persistence. This migration extends the ledger and adds the
-- Activity/Chat boundary without rewriting any T01-T05 migration.

do $t06_ledger_preflight$
begin
  if exists (
    select 1
    from internal.operation_requests
    where not (
      (result_table is null and result_id is null and result_payload is null and completed_at is null)
      or (result_table is not null and result_id is not null and result_payload is not null and completed_at is not null)
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'T06 migration aborted: incomplete operation ledger rows exist.';
  end if;

  if exists (
    select 1
    from internal.operation_requests
    where completed_at is not null
      and not (
        (operation_kind = 'experience.create' and result_table = 'experiences')
        or (operation_kind = 'education.create' and result_table = 'education')
        or (operation_kind = 'certification.create' and result_table = 'certifications')
        or (operation_kind = 'skill.create' and result_table = 'skills')
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'T06 migration aborted: existing ledger result types do not match their operation.';
  end if;
end;
$t06_ledger_preflight$;

alter table internal.operation_requests
  drop constraint operation_requests_kind_check,
  add constraint operation_requests_kind_check check (
    operation_kind in (
      'experience.create',
      'education.create',
      'certification.create',
      'skill.create',
      'activity.create'
    )
  );

alter table internal.operation_requests
  drop constraint operation_requests_result_table_check,
  add constraint operation_requests_result_table_check check (
    result_table is null
    or result_table in ('experiences', 'education', 'certifications', 'skills', 'activities')
  );

alter table internal.operation_requests
  add constraint operation_requests_kind_result_check check (
    result_table is null
    or (operation_kind = 'experience.create' and result_table = 'experiences')
    or (operation_kind = 'education.create' and result_table = 'education')
    or (operation_kind = 'certification.create' and result_table = 'certifications')
    or (operation_kind = 'skill.create' and result_table = 'skills')
    or (operation_kind = 'activity.create' and result_table = 'activities')
  ),
  add constraint operation_requests_activity_receipt_check check (
    operation_kind <> 'activity.create'
    or result_payload is null
    or (
      result_table = 'activities'
      and result_payload ?& array['id', 'user_id', 'revision', 'occurred_on', 'capture_mode']
      and result_payload - array['id', 'user_id', 'revision', 'occurred_on', 'capture_mode'] = '{}'::jsonb
      and result_payload ->> 'id' = result_id::text
      and result_payload ->> 'user_id' = user_id::text
      and result_payload ->> 'revision' = '1'
      and result_payload ->> 'occurred_on' is not null
      and result_payload ->> 'capture_mode' in ('note', 'form', 'chat')
    )
  );

comment on constraint operation_requests_activity_receipt_check on internal.operation_requests is
  'Activity create receipts contain only the stable identity/date/mode fields, never private Activity or Chat content.';

create table public.activities (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  raw_text text not null,
  occurred_on date not null,
  capture_mode text not null,
  role text,
  scope text,
  outcome text,
  experience_id uuid,
  project_id uuid,
  analysis_state text not null default 'not_requested',
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  revision integer not null default 1,
  constraint activities_user_id_id_key unique (user_id, id),
  constraint activities_raw_text_check check (
    pg_catalog.char_length(raw_text) between 1 and 10000
    and pg_catalog.btrim(raw_text) <> ''
    and raw_text !~ '^[[:space:]]*$'
  ),
  constraint activities_occurred_on_finite_check check (pg_catalog.isfinite(occurred_on)),
  constraint activities_capture_mode_check check (capture_mode in ('note', 'form', 'chat')),
  constraint activities_role_check check (
    role is null
    or (role = pg_catalog.btrim(role) and role !~ '^[[:space:]]*$' and pg_catalog.char_length(role) <= 200)
  ),
  constraint activities_scope_check check (
    scope is null
    or (scope = pg_catalog.btrim(scope) and scope !~ '^[[:space:]]*$' and pg_catalog.char_length(scope) <= 5000)
  ),
  constraint activities_outcome_check check (
    outcome is null
    or (outcome = pg_catalog.btrim(outcome) and outcome !~ '^[[:space:]]*$' and pg_catalog.char_length(outcome) <= 5000)
  ),
  constraint activities_analysis_state_check check (
    analysis_state in ('not_requested', 'queued', 'running', 'done', 'failed')
  ),
  constraint activities_revision_positive check (revision > 0),
  constraint activities_user_experience_fkey foreign key (user_id, experience_id)
    references public.experiences (user_id, id) on delete set null (experience_id),
  constraint activities_user_project_fkey foreign key (user_id, project_id)
    references public.projects (user_id, id) on delete set null (project_id)
);

create table public.chat_messages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid not null,
  role text not null,
  content text not null,
  sequence_no integer not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint chat_messages_user_activity_sequence_key unique (user_id, activity_id, sequence_no),
  constraint chat_messages_role_check check (role in ('user', 'assistant')),
  constraint chat_messages_content_check check (
    pg_catalog.char_length(content) between 1 and 10000
    and pg_catalog.btrim(content) <> ''
    and content !~ '^[[:space:]]*$'
  ),
  constraint chat_messages_sequence_positive check (sequence_no > 0),
  constraint chat_messages_user_activity_fkey foreign key (user_id, activity_id)
    references public.activities (user_id, id) on delete cascade
);

comment on table public.activities is
  'Canonical user-authored Activity source. raw_text is preserved exactly; AI work does not replace it.';
comment on column public.activities.raw_text is
  'Exact original Activity text; validation never trims, truncates, or replaces this value.';
comment on column public.activities.revision is
  'Input/context revision for stale-result checks; only user input and context changes increment it.';
comment on table public.chat_messages is
  'Append-only Chat history. The first user message is created atomically with its Activity.';

create index activities_user_occurred_on_id_idx
  on public.activities (user_id, occurred_on desc, id desc);
create index activities_user_project_occurred_on_id_idx
  on public.activities (user_id, project_id, occurred_on desc, id desc);

alter table public.activities enable row level security;
alter table public.chat_messages enable row level security;

create policy activities_select_own on public.activities
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy chat_messages_select_own on public.chat_messages
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.activities, public.chat_messages from public, anon, authenticated, service_role;
grant select on table public.activities, public.chat_messages to authenticated;

create or replace function internal.guard_activity_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.capture_mode is distinct from old.capture_mode
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_MUTATION';
  end if;

  if row(new.raw_text, new.occurred_on, new.role, new.scope, new.outcome, new.experience_id, new.project_id)
     is distinct from
     row(old.raw_text, old.occurred_on, old.role, old.scope, old.outcome, old.experience_id, old.project_id) then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  new.created_at := old.created_at;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create or replace function internal.enforce_activity_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_project_experience_id uuid;
begin
  if new.project_id is not null then
    select project.experience_id
    into v_project_experience_id
    from public.projects as project
    where project.user_id = new.user_id
      and project.id = new.project_id;

    if not found or new.experience_id is distinct from v_project_experience_id then
      raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_CONTEXT';
    end if;
  end if;

  if new.experience_id is not null and not exists (
    select 1
    from public.experiences as experience
    where experience.user_id = new.user_id
      and experience.id = new.experience_id
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_CONTEXT';
  end if;

  return new;
end;
$$;

create or replace function internal.lock_activity_context(
  p_user_id uuid,
  p_experience_id uuid,
  p_project_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_project_experience_id uuid;
  v_locked_project_experience_id uuid;
begin
  if p_project_id is null then
    if p_experience_id is not null then
      perform 1
      from public.experiences as experience
      where experience.user_id = p_user_id
        and experience.id = p_experience_id
      for share;
      if not found then
        raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_CONTEXT';
      end if;
    end if;
    return;
  end if;

  select project.experience_id
  into v_project_experience_id
  from public.projects as project
  where project.user_id = p_user_id
    and project.id = p_project_id;
  if not found or p_experience_id is distinct from v_project_experience_id then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_CONTEXT';
  end if;

  -- Match the existing delete_experience order: lock the experience before
  -- the project so a concurrent experience deletion cannot form a lock cycle.
  if v_project_experience_id is not null then
    perform 1
    from public.experiences as experience
    where experience.user_id = p_user_id
      and experience.id = v_project_experience_id
    for share;
    if not found then
      raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_CONTEXT';
    end if;
  end if;

  select project.experience_id
  into v_locked_project_experience_id
  from public.projects as project
  where project.user_id = p_user_id
    and project.id = p_project_id
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_CONTEXT';
  end if;

  if v_locked_project_experience_id is distinct from p_experience_id then
    raise exception using errcode = 'P0001', message = 'ACTIVITY_CONTEXT_CHANGED';
  end if;
end;
$$;

create or replace function internal.guard_chat_message_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.activities as activity
    where activity.user_id = new.user_id
      and activity.id = new.activity_id
      and activity.capture_mode = 'chat'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_CHAT_ACTIVITY';
  end if;
  return new;
end;
$$;

create trigger activities_guard_row
before update on public.activities
for each row execute function internal.guard_activity_row();
create trigger activities_enforce_context
before insert or update of user_id, experience_id, project_id on public.activities
for each row execute function internal.enforce_activity_context();
create trigger chat_messages_guard_insert
before insert on public.chat_messages
for each row execute function internal.guard_chat_message_insert();

create or replace function internal.sync_project_experience_to_activities()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.experience_id is distinct from old.experience_id then
    update public.activities as activity
    set experience_id = new.experience_id
    where activity.user_id = new.user_id
      and activity.project_id = new.id
      and activity.experience_id is distinct from new.experience_id;
  end if;
  return new;
end;
$$;

create trigger projects_sync_activity_experience
after update of experience_id on public.projects
for each row execute function internal.sync_project_experience_to_activities();

create or replace function internal.create_activity(
  p_user_id uuid,
  p_operation_key uuid,
  p_raw_text text,
  p_occurred_on date,
  p_capture_mode text,
  p_role text,
  p_scope text,
  p_outcome text,
  p_experience_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := nullif(pg_catalog.btrim(p_role), '');
  v_scope text := nullif(pg_catalog.btrim(p_scope), '');
  v_outcome text := nullif(pg_catalog.btrim(p_outcome), '');
  v_payload jsonb;
  v_payload_hash bytea;
  v_existing_hash bytea;
  v_existing_table text;
  v_existing_id uuid;
  v_existing_payload jsonb;
  v_completed_at timestamptz;
  v_rows integer;
  v_activity public.activities%rowtype;
  v_receipt jsonb;
begin
  if v_user_id is null or p_user_id is null or p_user_id is distinct from v_user_id then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_operation_key is null then
    raise exception using errcode = '22023', message = 'INVALID_OPERATION_KEY';
  end if;
  if not exists (
    select 1 from public.profiles as profile
    where profile.id = v_user_id and profile.deleting_at is null
  ) then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_raw_text is null
     or pg_catalog.char_length(p_raw_text) not between 1 and 10000
     or pg_catalog.btrim(p_raw_text) = ''
     or p_raw_text ~ '^[[:space:]]*$'
     or p_occurred_on is null
     or not pg_catalog.isfinite(p_occurred_on)
     or p_capture_mode not in ('note', 'form', 'chat')
     or (v_role is not null and pg_catalog.char_length(v_role) > 200)
     or (v_scope is not null and pg_catalog.char_length(v_scope) > 5000)
     or (v_outcome is not null and pg_catalog.char_length(v_outcome) > 5000) then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_INPUT';
  end if;

  v_payload := pg_catalog.jsonb_build_object(
    'raw_text', p_raw_text,
    'occurred_on', p_occurred_on,
    'capture_mode', p_capture_mode,
    'role', v_role,
    'scope', v_scope,
    'outcome', v_outcome,
    'experience_id', p_experience_id,
    'project_id', p_project_id
  );
  v_payload_hash := extensions.digest(v_payload::text, 'sha256');

  insert into internal.operation_requests (
    user_id, operation_kind, operation_key, input_revision, payload_hash
  ) values (
    v_user_id, 'activity.create', p_operation_key, 0, v_payload_hash
  ) on conflict (user_id, operation_kind, operation_key) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select operation.payload_hash, operation.result_table, operation.result_id,
      operation.result_payload, operation.completed_at
    into v_existing_hash, v_existing_table, v_existing_id,
      v_existing_payload, v_completed_at
    from internal.operation_requests as operation
    where operation.user_id = v_user_id
      and operation.operation_kind = 'activity.create'
      and operation.operation_key = p_operation_key
    for update;

    if not found or v_existing_hash is distinct from v_payload_hash then
      if found then
        raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
      end if;
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;
    if v_existing_table is distinct from 'activities'
       or v_existing_id is null
       or v_existing_payload is null
       or v_completed_at is null then
      raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
    end if;
    return v_existing_payload;
  end if;

  perform internal.lock_activity_context(v_user_id, p_experience_id, p_project_id);

  insert into public.activities (
    user_id, raw_text, occurred_on, capture_mode, role, scope, outcome,
    experience_id, project_id, analysis_state
  ) values (
    v_user_id, p_raw_text, p_occurred_on, p_capture_mode, v_role, v_scope, v_outcome,
    p_experience_id, p_project_id, 'not_requested'
  ) returning * into v_activity;

  if p_capture_mode = 'chat' then
    insert into public.chat_messages (user_id, activity_id, role, content, sequence_no)
    values (v_user_id, v_activity.id, 'user', p_raw_text, 1);
  end if;

  v_receipt := pg_catalog.jsonb_build_object(
    'id', v_activity.id,
    'user_id', v_activity.user_id,
    'revision', v_activity.revision,
    'occurred_on', v_activity.occurred_on,
    'capture_mode', v_activity.capture_mode
  );

  update internal.operation_requests
  set result_table = 'activities',
      result_id = v_activity.id,
      result_payload = v_receipt,
      completed_at = pg_catalog.clock_timestamp()
  where user_id = v_user_id
    and operation_kind = 'activity.create'
    and operation_key = p_operation_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_UNAVAILABLE';
  end if;

  return v_receipt;
end;
$$;

create or replace function internal.update_activity(
  p_user_id uuid,
  p_activity_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns public.activities
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_key text;
  v_key_count integer;
  v_raw_text text;
  v_occurred_on date;
  v_role text;
  v_scope text;
  v_outcome text;
  v_experience_id uuid;
  v_project_id uuid;
  v_activity public.activities%rowtype;
  v_revision integer;
begin
  if v_user_id is null or p_user_id is null or p_user_id is distinct from v_user_id then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles as profile
    where profile.id = v_user_id and profile.deleting_at is null
  ) then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_activity_id is null or p_expected_revision is null or p_expected_revision < 1
     or p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_INPUT';
  end if;

  select pg_catalog.count(*)::integer
  into v_key_count
  from pg_catalog.jsonb_object_keys(p_changes) as field(key);
  if v_key_count <> 7 then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_INPUT';
  end if;
  if not (p_changes ?& array[
    'raw_text', 'occurred_on', 'role', 'scope', 'outcome', 'experience_id', 'project_id'
  ]) then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_INPUT';
  end if;
  for v_key in select field.key from pg_catalog.jsonb_object_keys(p_changes) as field(key) loop
    if not (v_key = any(array[
      'raw_text', 'occurred_on', 'role', 'scope', 'outcome', 'experience_id', 'project_id'
    ])) then
      raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_INPUT';
    end if;
  end loop;

  v_raw_text := p_changes ->> 'raw_text';
  v_role := nullif(pg_catalog.btrim(p_changes ->> 'role'), '');
  v_scope := nullif(pg_catalog.btrim(p_changes ->> 'scope'), '');
  v_outcome := nullif(pg_catalog.btrim(p_changes ->> 'outcome'), '');
  begin
    v_occurred_on := (p_changes ->> 'occurred_on')::date;
    v_experience_id := nullif(p_changes ->> 'experience_id', '')::uuid;
    v_project_id := nullif(p_changes ->> 'project_id', '')::uuid;
  exception
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_INPUT';
  end;
  if v_raw_text is null
     or pg_catalog.char_length(v_raw_text) not between 1 and 10000
     or pg_catalog.btrim(v_raw_text) = ''
     or v_raw_text ~ '^[[:space:]]*$'
     or v_occurred_on is null
     or not pg_catalog.isfinite(v_occurred_on)
     or (v_role is not null and pg_catalog.char_length(v_role) > 200)
     or (v_scope is not null and pg_catalog.char_length(v_scope) > 5000)
     or (v_outcome is not null and pg_catalog.char_length(v_outcome) > 5000) then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_INPUT';
  end if;

  perform internal.lock_activity_context(v_user_id, v_experience_id, v_project_id);

  update public.activities as activity
  set raw_text = v_raw_text,
      occurred_on = v_occurred_on,
      role = v_role,
      scope = v_scope,
      outcome = v_outcome,
      experience_id = v_experience_id,
      project_id = v_project_id
  where activity.user_id = v_user_id
    and activity.id = p_activity_id
    and activity.revision = p_expected_revision
  returning activity.* into v_activity;

  if found then
    return v_activity;
  end if;

  select activity.revision
  into v_revision
  from public.activities as activity
  where activity.user_id = v_user_id
    and activity.id = p_activity_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACTIVITY_UNAVAILABLE';
  end if;
  raise exception using errcode = 'P0001', message = 'STALE_REVISION';
end;
$$;

create or replace function public.create_activity_idempotent(
  p_operation_key uuid,
  p_raw_text text,
  p_occurred_on date,
  p_capture_mode text,
  p_role text,
  p_scope text,
  p_outcome text,
  p_experience_id uuid,
  p_project_id uuid
)
returns table (
  activity_id uuid,
  user_id uuid,
  revision integer,
  occurred_on date,
  capture_mode text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt jsonb;
begin
  v_receipt := internal.create_activity(
    v_user_id, p_operation_key, p_raw_text, p_occurred_on, p_capture_mode,
    p_role, p_scope, p_outcome, p_experience_id, p_project_id
  );
  return query select
    (v_receipt ->> 'id')::uuid,
    (v_receipt ->> 'user_id')::uuid,
    (v_receipt ->> 'revision')::integer,
    (v_receipt ->> 'occurred_on')::date,
    v_receipt ->> 'capture_mode';
end;
$$;

create or replace function public.update_activity(
  p_activity_id uuid,
  p_expected_revision integer,
  p_changes jsonb
)
returns setof public.activities
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_activity public.activities%rowtype;
begin
  v_activity := internal.update_activity(auth.uid(), p_activity_id, p_expected_revision, p_changes);
  return next v_activity;
end;
$$;

revoke all on function internal.create_activity(uuid, uuid, text, date, text, text, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function internal.update_activity(uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function internal.lock_activity_context(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function internal.guard_activity_row()
  from public, anon, authenticated, service_role;
revoke all on function internal.enforce_activity_context()
  from public, anon, authenticated, service_role;
revoke all on function internal.guard_chat_message_insert()
  from public, anon, authenticated, service_role;
revoke all on function internal.sync_project_experience_to_activities()
  from public, anon, authenticated, service_role;

revoke all on function public.create_activity_idempotent(uuid, text, date, text, text, text, text, uuid, uuid)
  from public, anon, service_role;
revoke all on function public.update_activity(uuid, integer, jsonb)
  from public, anon, service_role;
grant execute on function public.create_activity_idempotent(uuid, text, date, text, text, text, text, uuid, uuid)
  to authenticated;
grant execute on function public.update_activity(uuid, integer, jsonb)
  to authenticated;


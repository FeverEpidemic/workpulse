-- T11 direct evidence listing and Activity-to-derived-Achievement movement.
begin;

create or replace function public.list_evidence_files(
  p_user_id uuid,
  p_parent_kind text,
  p_parent_id uuid
)
returns table (
  id uuid, user_id uuid, parent_kind text, parent_id uuid, parent_revision integer,
  filename text, content_type text, expected_bytes bigint, actual_bytes bigint,
  sha256 text, object_key text, status text, revision integer,
  reservation_expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  failure_code text, scan_job_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null or p_parent_kind is null
     or p_parent_kind not in ('activity', 'achievement', 'project') or p_parent_id is null then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_LIST';
  end if;

  if not exists (
    select 1 from public.profiles as profile
    where profile.id = p_user_id and profile.deleting_at is null
  ) then
    return;
  end if;
  if p_parent_kind = 'activity' and not exists (
    select 1 from public.activities as parent where parent.user_id = p_user_id and parent.id = p_parent_id
  ) then return;
  elsif p_parent_kind = 'achievement' and not exists (
    select 1 from public.achievements as parent where parent.user_id = p_user_id and parent.id = p_parent_id
  ) then return;
  elsif p_parent_kind = 'project' and not exists (
    select 1 from public.projects as parent where parent.user_id = p_user_id and parent.id = p_parent_id
  ) then return;
  end if;

  return query
  select file.id, file.user_id, p_parent_kind, p_parent_id, file.parent_revision,
    file.original_name, file.mime_type, file.bytes, file.actual_bytes, file.sha256,
    file.object_key, file.status, file.revision, file.reserved_until,
    file.created_at, file.updated_at, file.error_code, file.scan_job_id
  from public.evidence_files as file
  where file.user_id = p_user_id
    and case p_parent_kind
      when 'activity' then file.activity_id = p_parent_id
      when 'achievement' then file.achievement_id = p_parent_id
      else file.project_id = p_parent_id
    end
  order by file.created_at, file.id;
end;
$$;

create or replace function public.move_activity_evidence_to_achievement(
  p_user_id uuid,
  p_evidence_id uuid,
  p_target_achievement_id uuid,
  p_expected_revision integer,
  p_expected_target_revision integer
)
returns table (
  id uuid, user_id uuid, parent_kind text, parent_id uuid, parent_revision integer,
  filename text, content_type text, expected_bytes bigint, actual_bytes bigint,
  sha256 text, object_key text, status text, revision integer,
  reservation_expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  failure_code text, scan_job_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  v_snapshot public.evidence_files%rowtype;
  v_profile public.profiles%rowtype;
  v_activity public.activities%rowtype;
  v_achievement public.achievements%rowtype;
  v_file public.evidence_files%rowtype;
  v_slots integer;
begin
  if p_user_id is null or p_evidence_id is null or p_target_achievement_id is null
     or p_expected_revision is null or p_expected_revision < 1
     or p_expected_target_revision is null or p_expected_target_revision < 1 then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_MOVE';
  end if;

  -- The initial read only discovers the typed source. The ordered locks below are
  -- profile -> Activity -> Achievement -> evidence, matching reservation/delete.
  select file.* into v_snapshot from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id and file.activity_id is not null;
  if not found then return; end if;

  select profile.* into v_profile from public.profiles as profile
  where profile.id = p_user_id and profile.deleting_at is null for update;
  if not found then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;

  select activity.* into v_activity from public.activities as activity
  where activity.user_id = p_user_id and activity.id = v_snapshot.activity_id for update;
  if not found then return; end if;

  select achievement.* into v_achievement from public.achievements as achievement
  where achievement.user_id = p_user_id and achievement.id = p_target_achievement_id for update;
  if not found or v_achievement.activity_id is distinct from v_activity.id then return; end if;

  select file.* into v_file from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id for update;
  if not found or v_file.activity_id is distinct from v_activity.id then return; end if;
  if v_file.revision <> p_expected_revision
     or v_achievement.revision <> p_expected_target_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  if v_file.status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'EVIDENCE_MOVE_STATE_CONFLICT';
  end if;

  select pg_catalog.count(*)::integer into v_slots
  from public.evidence_files as file
  where file.user_id = p_user_id and file.achievement_id = v_achievement.id
    and file.id <> v_file.id and file.status in ('uploading', 'scanning', 'ready');
  if v_slots >= 3 then
    raise exception using errcode = 'P0001', message = 'EVIDENCE_SLOT_LIMIT';
  end if;

  update public.evidence_files as file
  set activity_id = null,
      achievement_id = v_achievement.id,
      parent_revision = v_achievement.revision,
      revision = file.revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where file.user_id = p_user_id and file.id = p_evidence_id
  returning file.* into v_file;

  return query select v_file.id, v_file.user_id, 'achievement'::text, v_file.achievement_id,
    v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
    v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status, v_file.revision,
    v_file.reserved_until, v_file.created_at, v_file.updated_at, v_file.error_code, v_file.scan_job_id;
end;
$$;

revoke all on function public.list_evidence_files(uuid,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.move_activity_evidence_to_achievement(uuid,uuid,uuid,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.list_evidence_files(uuid,text,uuid) to service_role;
grant execute on function public.move_activity_evidence_to_achievement(uuid,uuid,uuid,integer,integer) to service_role;

comment on function public.list_evidence_files(uuid,text,uuid) is
  'Lists direct evidence for one owner-validated parent in stable creation/id order, including lifecycle rows in deleting state.';
comment on function public.move_activity_evidence_to_achievement(uuid,uuid,uuid,integer,integer) is
  'Moves one ready direct Activity evidence row to its own derived Achievement under ordered owner/source/target/file locks.';

commit;

-- T10 forward-only fix: qualify INSERT RETURNING against RPC output aliases.
create or replace function public.finalize_evidence_upload(
  p_user_id uuid,
  p_evidence_id uuid,
  p_expected_revision integer,
  p_actual_bytes bigint,
  p_verified_content_type text,
  p_sha256 text
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
set search_path = pg_catalog, public, internal, extensions
as $$
declare
  v_file public.evidence_files%rowtype;
  v_snapshot public.evidence_files%rowtype;
  v_parent_live boolean := false;
  v_payload_hash bytea;
  v_job_id uuid;
  v_error_code text;
begin
  if p_user_id is null or p_evidence_id is null or p_expected_revision is null or p_expected_revision < 1
     or p_actual_bytes is null or p_verified_content_type is null or p_sha256 is null then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_FINALIZE';
  end if;
  v_payload_hash := extensions.digest(pg_catalog.jsonb_build_object(
    'expected_revision', p_expected_revision, 'actual_bytes', p_actual_bytes,
    'content_type', p_verified_content_type, 'sha256', p_sha256
  )::text, 'sha256');

  select file.* into v_snapshot from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id;
  if not found then return; end if;

  perform 1 from public.profiles as profile
  where profile.id = p_user_id and profile.deleting_at is null for update;
  if not found then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;

  if v_snapshot.activity_id is not null then
    perform 1 from public.activities as parent where parent.user_id = p_user_id and parent.id = v_snapshot.activity_id for update;
  elsif v_snapshot.achievement_id is not null then
    perform 1 from public.achievements as parent where parent.user_id = p_user_id and parent.id = v_snapshot.achievement_id for update;
  else
    perform 1 from public.projects as parent where parent.user_id = p_user_id and parent.id = v_snapshot.project_id for update;
  end if;
  v_parent_live := found;

  select file.* into v_file from public.evidence_files as file
  where file.user_id = p_user_id and file.id = p_evidence_id for update;
  if not found then return; end if;

  if v_file.finalize_payload_hash is not null then
    if v_file.finalize_payload_hash is distinct from v_payload_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return query select v_file.id, v_file.user_id,
      case when v_file.activity_id is not null then 'activity'
           when v_file.achievement_id is not null then 'achievement' else 'project' end,
      coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
      v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
      v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
      v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
      v_file.error_code, v_file.scan_job_id;
    return;
  end if;

  if v_file.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_REVISION';
  end if;
  if v_file.status = 'failed' and v_file.error_code = 'RESERVATION_EXPIRED' then
    return query select v_file.id, v_file.user_id,
      case when v_file.activity_id is not null then 'activity'
           when v_file.achievement_id is not null then 'achievement' else 'project' end,
      coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
      v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
      v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
      v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
      v_file.error_code, v_file.scan_job_id;
    return;
  end if;
  if v_file.status <> 'uploading' then
    raise exception using errcode = 'P0001', message = 'EVIDENCE_STATE_CONFLICT';
  end if;

  if not v_parent_live then
    perform internal.enqueue_evidence_cleanup(v_file);
    update public.evidence_files as file
    set status = 'deleting', reserved_until = null, error_code = 'PARENT_DELETED',
        finalize_payload_hash = v_payload_hash, revision = file.revision + 1,
        updated_at = pg_catalog.clock_timestamp()
    where file.id = v_file.id and file.user_id = p_user_id returning file.* into v_file;
  else
    if p_actual_bytes is null or p_actual_bytes not between 1 and 10485760 or p_actual_bytes <> v_file.bytes then
      v_error_code := 'SIZE_MISMATCH';
    elsif p_verified_content_type <> v_file.mime_type then
      v_error_code := 'MIME_MISMATCH';
    elsif p_sha256 !~ '^[0-9a-f]{64}$' then
      v_error_code := 'INVALID_HASH';
    elsif v_file.reserved_until <= pg_catalog.clock_timestamp() then
      v_error_code := 'RESERVATION_EXPIRED';
    end if;

    if v_error_code is not null then
      update public.evidence_files as file
      set status = 'failed', reserved_until = null, error_code = v_error_code,
          actual_bytes = case when p_actual_bytes between 1 and 10485760 then p_actual_bytes else null end,
          sha256 = case when p_sha256 ~ '^[0-9a-f]{64}$' then p_sha256 else null end,
          finalize_payload_hash = v_payload_hash, revision = file.revision + 1,
          updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = p_user_id returning file.* into v_file;
      perform internal.enqueue_evidence_cleanup(v_file);
    else
      insert into internal.evidence_scan_jobs as new_job (
        user_id, evidence_id, object_key, expected_bytes, mime_type, sha256
      ) values (
        p_user_id, v_file.id, v_file.object_key, p_actual_bytes,
        p_verified_content_type, p_sha256
      ) returning new_job.id into v_job_id;
      update public.evidence_files as file
      set status = 'scanning', reserved_until = null, actual_bytes = p_actual_bytes,
          sha256 = p_sha256, finalize_payload_hash = v_payload_hash,
          scan_job_id = v_job_id, revision = file.revision + 1,
          updated_at = pg_catalog.clock_timestamp()
      where file.id = v_file.id and file.user_id = p_user_id returning file.* into v_file;
    end if;
  end if;

  return query select v_file.id, v_file.user_id,
    case when v_file.activity_id is not null then 'activity'
         when v_file.achievement_id is not null then 'achievement' else 'project' end,
    coalesce(v_file.activity_id, v_file.achievement_id, v_file.project_id),
    v_file.parent_revision, v_file.original_name, v_file.mime_type, v_file.bytes,
    v_file.actual_bytes, v_file.sha256, v_file.object_key, v_file.status,
    v_file.revision, v_file.reserved_until, v_file.created_at, v_file.updated_at,
    v_file.error_code, v_file.scan_job_id;
end;
$$;


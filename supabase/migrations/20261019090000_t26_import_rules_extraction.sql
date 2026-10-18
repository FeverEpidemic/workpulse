-- T26 Import CV without AI (decision 0033).
-- Every batch gets an extraction_mode fixed at upload: 'ai' (T15 path, unchanged) or 'rules' (candidates come from a
-- rule-based extractor in the worker's parser thread). Consent and the AI usage charge (decision 0032) apply to 'ai'
-- batches only. A rules batch is staged by complete_import_parse in one transaction and never gets an ai_jobs row.
-- Staging validation moves from complete_import_ai_job into internal.stage_import_items without changing AI behaviour.
-- Lock order is unchanged: profile -> import batch -> import/AI job -> items.

-- 1. Columns ----------------------------------------------------------------------------------------------------------------

alter table public.import_batches
  add column extraction_mode text not null default 'ai',
  add constraint import_batches_extraction_mode_check check (extraction_mode in ('ai', 'rules'));

alter table internal.import_jobs
  add column extraction_mode text not null default 'ai',
  add constraint import_jobs_extraction_mode_check check (extraction_mode in ('ai', 'rules'));

comment on column public.import_batches.extraction_mode is
  'T26: ai (text sent to the AI provider, needs consent) or rules (read by fixed rules, no consent). Set at upload, immutable.';

grant select (extraction_mode) on public.import_batches to authenticated;

-- 2. Helpers ----------------------------------------------------------------------------------------------------------------

create or replace function internal.is_permanent_import_error(p_code text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_code in (
    'FILE_EMPTY', 'FILE_TOO_LARGE', 'FILE_TYPE_MISMATCH', 'UNSUPPORTED_FORMAT', 'ENCRYPTED_FILE',
    'SCANNED_PDF', 'CORRUPT_FILE', 'EMPTY_DOCUMENT', 'TOO_MANY_PAGES', 'IMPORT_TEXT_TOO_LONG',
    'PARSER_TIMEOUT', 'MALWARE_DETECTED', 'UPLOAD_INCOMPLETE', 'ACCOUNT_DELETING', 'INVALID_IMPORT_JOB',
    'IMPORT_RULES_FAILED'
  );
$$;

-- T15 body with extraction_mode added to the immutable identity columns.
create or replace function internal.guard_import_batch_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if row(new.id, new.user_id, new.idempotency_key, new.payload_hash, new.filename, new.mime_type,
         new.bytes, new.sha256, new.created_at, new.extraction_mode)
     is distinct from
     row(old.id, old.user_id, old.idempotency_key, old.payload_hash, old.filename, old.mime_type,
         old.bytes, old.sha256, old.created_at, old.extraction_mode) then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_BATCH_MUTATION';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'queued' and new.status in ('running', 'failed', 'cancelled'))
    or (old.status = 'running' and new.status in ('review', 'failed', 'cancelled'))
    or (old.status = 'review' and new.status in ('committed', 'cancelled'))
    or (old.status = 'failed' and new.status in ('queued', 'running'))
  ) then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_TRANSITION';
  end if;
  if old.purged_at is not null and (new.extracted_text is not null or new.file_key is not null) then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_BATCH_MUTATION';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

-- Structural validation and insert of staged candidates, moved from complete_import_ai_job (T15) unchanged. Validates
-- every item before inserting any; returns false without writing when the structure is invalid. Field grounding is done
-- in the worker. The caller holds the batch lock.
create or replace function internal.stage_import_items(
  p_batch public.import_batches,
  p_items jsonb,
  p_allowed_types text[]
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
  v_type text;
  v_payload jsonb;
  v_refs jsonb := '{}'::jsonb;
  v_id uuid;
  v_ordinals jsonb := '{}'::jsonb;
  v_ordinal integer;
begin
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) > 300
     or (select count(*) from pg_catalog.jsonb_array_elements(p_items) as e(value) where e.value ->> 'entity_type' = 'profile') > 1 then
    return false;
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_items) loop
    v_type := v_item ->> 'entity_type';
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or v_type is null
       or not (v_type = any (p_allowed_types))
       or pg_catalog.jsonb_typeof(v_item -> 'payload') <> 'object'
       or pg_catalog.jsonb_typeof(v_item -> 'source_excerpt') <> 'string'
       or pg_catalog.btrim(v_item ->> 'source_excerpt') = ''
       or pg_catalog.char_length(v_item ->> 'source_excerpt') > 1000
       or pg_catalog.jsonb_typeof(coalesce(v_item -> 'validation_errors', '[]'::jsonb)) <> 'array'
       or (v_type = 'achievement' and v_item -> 'payload' ->> 'status' is distinct from 'draft')
       or (select count(*) from pg_catalog.jsonb_array_elements(p_items) as e(value) where e.value ->> 'entity_type' = v_type) > 60 then
      return false;
    end if;
  end loop;

  -- Insert non-achievement items first so achievement experience_ref can resolve.
  for v_item in
    select value from pg_catalog.jsonb_array_elements(p_items) with ordinality as e(value, n)
    order by (e.value ->> 'entity_type' = 'achievement'), e.n
  loop
    v_type := v_item ->> 'entity_type';
    v_payload := v_item -> 'payload';
    if v_type = 'achievement' then
      if v_payload ? 'experience_ref' then
        v_payload := v_payload - 'experience_ref'
          || pg_catalog.jsonb_build_object('experience_item_id', v_refs -> (v_item -> 'payload' ->> 'experience_ref'));
      end if;
    end if;
    v_ordinal := coalesce((v_ordinals ->> v_type)::integer, 0);
    v_ordinals := v_ordinals || pg_catalog.jsonb_build_object(v_type, v_ordinal + 1);
    insert into public.import_items (
      user_id, batch_id, entity_type, ordinal, payload, source_excerpt, validation_errors
    ) values (
      p_batch.user_id, p_batch.id, v_type, v_ordinal, v_payload, v_item ->> 'source_excerpt',
      coalesce(v_item -> 'validation_errors', '[]'::jsonb)
    )
    returning id into v_id;
    if v_type = 'experience' and pg_catalog.jsonb_typeof(v_item -> 'ref') = 'string' then
      v_refs := v_refs || pg_catalog.jsonb_build_object(v_item ->> 'ref', v_id);
    end if;
  end loop;
  return true;
end;
$$;

-- 3. Session RPCs -----------------------------------------------------------------------------------------------------------

drop function public.begin_import_batch(uuid, text, bigint, text, text);

-- Decision 0032 body plus a mode. Consent and the import charge apply to ai batches only. The mode is part of the
-- idempotency payload; ai keeps the T15 hash so a replay across this migration still matches.
create function public.begin_import_batch(
  p_idempotency_key uuid,
  p_filename text,
  p_bytes bigint,
  p_mime_type text,
  p_sha256 text,
  p_extraction_mode text default 'ai'
)
returns table (
  batch_id uuid,
  revision integer,
  status text,
  stage text,
  file_key text,
  duplicate_of_created_at timestamptz,
  duplicate_of_status text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.import_actor();
  v_hash bytea;
  v_batch public.import_batches%rowtype;
  v_replayed boolean := false;
  v_dup_created timestamptz;
  v_dup_status text;
  v_id uuid := pg_catalog.gen_random_uuid();
begin
  if p_idempotency_key is null or p_filename is null or p_bytes is null or p_mime_type is null or p_sha256 is null
     or p_extraction_mode is null or p_extraction_mode not in ('ai', 'rules')
     or pg_catalog.char_length(p_filename) not between 1 and 255 or pg_catalog.btrim(p_filename) = ''
     or p_filename ~ '[[:cntrl:]]'
     or p_bytes not between 1 and 10485760
     or p_mime_type not in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
     or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_UPLOAD';
  end if;
  if p_extraction_mode = 'ai' and not internal.has_current_ai_consent(v_user_id) then
    raise exception using errcode = 'P0001', message = 'CONSENT_REQUIRED';
  end if;

  v_hash := extensions.digest(p_sha256 || ':' || p_bytes::text || ':' || p_mime_type || ':' || p_filename
    || case when p_extraction_mode = 'rules' then ':rules' else '' end, 'sha256');

  insert into public.import_batches (
    id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, extraction_mode
  ) values (
    v_id, v_user_id, p_idempotency_key, v_hash, v_user_id::text || '/import/' || v_id::text,
    p_filename, p_mime_type, p_bytes, p_sha256, p_extraction_mode
  )
  on conflict on constraint import_batches_user_idempotency_key do nothing
  returning * into v_batch;

  if v_batch.id is null then
    select batch.* into v_batch from public.import_batches as batch
    where batch.user_id = v_user_id and batch.idempotency_key = p_idempotency_key;
    if v_batch.payload_hash <> v_hash or v_batch.extraction_mode <> p_extraction_mode then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    v_replayed := true;
  elsif p_extraction_mode = 'ai' then
    perform internal.charge_ai_usage(v_user_id, 'import');
  end if;

  select batch.created_at, batch.status into v_dup_created, v_dup_status
  from public.import_batches as batch
  where batch.user_id = v_user_id and batch.sha256 = p_sha256 and batch.id <> v_batch.id
    and batch.created_at <= v_batch.created_at
  order by batch.created_at desc, batch.id desc
  limit 1;

  return query select v_batch.id, v_batch.revision, v_batch.status, v_batch.stage, v_batch.file_key,
    v_dup_created, v_dup_status, v_replayed;
end;
$$;

-- Decision 0032 body; consent and the charge apply to ai batches only. A rules batch never reaches the extracting stage.
create or replace function public.retry_import_batch(p_batch_id uuid)
returns table (batch_id uuid, revision integer, status text, stage text, error_code text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := internal.import_actor();
  v_batch public.import_batches%rowtype;
  v_ai public.ai_jobs%rowtype;
begin
  select batch.* into v_batch from public.import_batches as batch
  where batch.user_id = v_user_id and batch.id = p_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  if v_batch.status in ('queued', 'running') then
    -- A concurrent retry already resumed the batch.
    return query select v_batch.id, v_batch.revision, v_batch.status, v_batch.stage, v_batch.error_code;
    return;
  end if;
  if v_batch.status <> 'failed' or internal.is_permanent_import_error(v_batch.error_code)
     or v_batch.stage = 'uploading' then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_RETRIABLE';
  end if;
  if v_batch.purged_at is not null or v_batch.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'IMPORT_EXPIRED';
  end if;
  if v_batch.retry_count >= 3 then
    raise exception using errcode = 'P0001', message = 'IMPORT_RETRY_EXHAUSTED';
  end if;
  if v_batch.extraction_mode = 'ai' and not internal.has_current_ai_consent(v_user_id) then
    raise exception using errcode = 'P0001', message = 'CONSENT_REQUIRED';
  end if;

  if v_batch.stage = 'extracting' then
    select job.* into v_ai from public.ai_jobs as job
    where job.user_id = v_user_id and job.import_batch_id = v_batch.id
    for update;
    if v_ai.id is not null and v_ai.attempt_count >= 3 then
      raise exception using errcode = 'P0001', message = 'IMPORT_RETRY_EXHAUSTED';
    end if;
    perform internal.charge_ai_usage(v_user_id, 'import');
    update public.import_batches as batch
    set status = 'running', error_code = null, failed_at = null, expires_at = null,
        retry_count = batch.retry_count + 1
    where batch.id = v_batch.id
    returning batch.* into v_batch;
    perform internal.enqueue_import_ai_job(v_batch);
  else
    if v_batch.extraction_mode = 'ai' then
      perform internal.charge_ai_usage(v_user_id, 'import');
    end if;
    update internal.import_jobs as job
    set status = 'queued', attempt_count = 0, attempt_token = null, lease_expires_at = null,
        next_attempt_at = pg_catalog.clock_timestamp(), error_code = null, finished_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where job.batch_id = v_batch.id;
    update public.import_batches as batch
    set status = 'queued', stage = 'screening', error_code = null, failed_at = null, expires_at = null,
        retry_count = batch.retry_count + 1
    where batch.id = v_batch.id
    returning batch.* into v_batch;
  end if;
  return query select v_batch.id, v_batch.revision, v_batch.status, v_batch.stage, v_batch.error_code;
end;
$$;

-- 4. Server/worker RPCs -----------------------------------------------------------------------------------------------------

-- T15 body; the job carries the batch mode so the worker knows how to extract.
create or replace function public.finalize_import_upload(p_user_id uuid, p_batch_id uuid)
returns table (batch_id uuid, revision integer, status text, stage text, error_code text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_batch public.import_batches%rowtype;
begin
  if p_user_id is null or p_batch_id is null then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_FINALIZE';
  end if;
  perform 1 from public.profiles as profile
  where profile.id = p_user_id and profile.deleting_at is null
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select batch.* into v_batch from public.import_batches as batch
  where batch.user_id = p_user_id and batch.id = p_batch_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'IMPORT_NOT_FOUND';
  end if;
  if v_batch.status = 'queued' and v_batch.stage = 'uploading' then
    insert into internal.import_jobs (user_id, batch_id, object_key, expected_bytes, mime_type, sha256, extraction_mode)
    values (v_batch.user_id, v_batch.id, v_batch.file_key, v_batch.bytes, v_batch.mime_type, v_batch.sha256,
            v_batch.extraction_mode)
    on conflict (batch_id) do nothing;
    update public.import_batches as batch
    set stage = 'screening'
    where batch.id = v_batch.id
    returning batch.* into v_batch;
  end if;
  return query select v_batch.id, v_batch.revision, v_batch.status, v_batch.stage, v_batch.error_code;
end;
$$;

drop function public.claim_import_jobs(integer);

-- T15 body; the result gains extraction_mode.
create function public.claim_import_jobs(p_limit integer default 1)
returns table (
  id uuid, user_id uuid, batch_id uuid, object_key text, expected_bytes bigint, mime_type text,
  sha256 text, attempt_count integer, attempt_token uuid, lease_expires_at timestamptz, extraction_mode text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_expired record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10 then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_JOB_CLAIM_LIMIT';
  end if;

  -- A lease that expired on the last allowed attempt fails its batch as a transient outage.
  for v_expired in
    select job.id, job.batch_id from internal.import_jobs as job
    where job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp()
      and job.attempt_count >= 5
    order by job.lease_expires_at
    limit 20
  loop
    perform 1 from public.import_batches as batch where batch.id = v_expired.batch_id for update skip locked;
    if not found then continue; end if;
    update internal.import_jobs as job
    set status = 'failed', lease_expires_at = null, error_code = 'IMPORT_WORKER_TIMEOUT',
        finished_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
    where job.id = v_expired.id and job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp();
    if found then
      perform internal.fail_import_batch_locked(v_expired.batch_id, 'IMPORT_WORKER_TIMEOUT');
    end if;
  end loop;

  return query
  with candidates as (
    select job.id, job.batch_id from internal.import_jobs as job
    join public.import_batches as batch on batch.id = job.batch_id
    join public.profiles as profile on profile.id = job.user_id
    where job.next_attempt_at <= pg_catalog.clock_timestamp()
      and job.attempt_count < 5
      and (job.status = 'queued' or (job.status = 'running' and job.lease_expires_at <= pg_catalog.clock_timestamp()))
      and batch.status in ('queued', 'running')
      and profile.deleting_at is null
    order by job.next_attempt_at, job.created_at, job.id
    for update of batch, job skip locked
    limit p_limit
  ), marked as (
    update public.import_batches as batch
    set status = 'running', stage = 'screening'
    from candidates where batch.id = candidates.batch_id
    returning batch.id
  ), claimed as (
    update internal.import_jobs as job
    set status = 'running', attempt_count = job.attempt_count + 1,
        attempt_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds',
        error_code = null, finished_at = null, updated_at = pg_catalog.clock_timestamp()
    from candidates where job.id = candidates.id and exists (select 1 from marked where marked.id = candidates.batch_id)
    returning job.*
  )
  select claimed.id, claimed.user_id, claimed.batch_id, claimed.object_key, claimed.expected_bytes,
    claimed.mime_type, claimed.sha256, claimed.attempt_count, claimed.attempt_token, claimed.lease_expires_at,
    claimed.extraction_mode
  from claimed
  order by claimed.next_attempt_at, claimed.created_at, claimed.id;
end;
$$;

drop function public.complete_import_parse(uuid, uuid, text, integer);

-- ai: T15 behaviour, p_items must be NULL. rules: p_items is the worker-validated candidate array; the job closes, the
-- text is stored and the items are staged with review opened in one transaction, without consent or an AI job.
create function public.complete_import_parse(
  p_job_id uuid,
  p_attempt_token uuid,
  p_text text,
  p_page_count integer,
  p_items jsonb default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_lock record;
  v_batch public.import_batches%rowtype;
begin
  if p_text is null or pg_catalog.btrim(p_text) = '' or pg_catalog.char_length(p_text) > 60000
     or p_page_count is null or p_page_count not between 1 and 20 then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_PARSE';
  end if;
  select * into v_lock from internal.lock_import_job(p_job_id, p_attempt_token);
  if (v_lock.o_job).id is null then
    return 'stale';
  end if;
  if ((v_lock.o_batch).extraction_mode = 'ai' and p_items is not null)
     or ((v_lock.o_batch).extraction_mode = 'rules'
         and (p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array')) then
    raise exception using errcode = '22023', message = 'INVALID_IMPORT_PARSE';
  end if;
  if (v_lock.o_batch).status <> 'running' or (v_lock.o_batch).stage <> 'parsing' then
    perform internal.close_import_job((v_lock.o_job).id, 'cancelled', 'IMPORT_CANCELLED');
    return 'stale';
  end if;
  if v_lock.o_deleting then
    perform internal.close_import_job((v_lock.o_job).id, 'failed', 'ACCOUNT_DELETING');
    perform internal.fail_import_batch_locked((v_lock.o_batch).id, 'ACCOUNT_DELETING');
    return 'failed:ACCOUNT_DELETING';
  end if;

  if (v_lock.o_batch).extraction_mode = 'rules' then
    if not internal.stage_import_items(v_lock.o_batch, p_items,
         array['profile', 'experience', 'education', 'skill']) then
      perform internal.close_import_job((v_lock.o_job).id, 'failed', 'IMPORT_RULES_FAILED');
      perform internal.fail_import_batch_locked((v_lock.o_batch).id, 'IMPORT_RULES_FAILED');
      return 'failed:IMPORT_RULES_FAILED';
    end if;
    perform internal.close_import_job((v_lock.o_job).id, 'succeeded', null);
    update public.import_batches as batch
    set status = 'review', stage = 'done', extracted_text = p_text, page_count = p_page_count
    where batch.id = (v_lock.o_batch).id;
    return 'succeeded';
  end if;

  update internal.import_jobs as job
  set status = 'succeeded', lease_expires_at = null, error_code = null,
      finished_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
  where job.id = (v_lock.o_job).id;
  update public.import_batches as batch
  set stage = 'extracting', extracted_text = p_text, page_count = p_page_count
  where batch.id = (v_lock.o_batch).id
  returning batch.* into v_batch;

  if not internal.has_current_ai_consent(v_batch.user_id) then
    perform internal.fail_import_batch_locked(v_batch.id, 'CONSENT_REQUIRED');
    return 'failed:CONSENT_REQUIRED';
  end if;
  perform internal.enqueue_import_ai_job(v_batch);
  return 'succeeded';
end;
$$;

-- T15 body; staging goes through internal.stage_import_items with all six types.
create or replace function public.complete_import_ai_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_summary jsonb,
  p_items jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_lock record;
  v_batch public.import_batches%rowtype;
begin
  if p_job_id is null or p_attempt_token is null then
    raise exception using errcode = '22023', message = 'INVALID_AI_JOB_COMPLETION';
  end if;
  select * into v_lock from internal.lock_import_ai_job(p_job_id, p_attempt_token);
  if (v_lock.o_job).id is null then
    return 'stale';
  end if;
  v_batch := v_lock.o_batch;
  if v_batch.status <> 'running' or v_batch.stage <> 'extracting' then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'IMPORT_CANCELLED');
    return 'stale';
  end if;
  if v_lock.o_deleting then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'ACCOUNT_DELETING');
    return 'failed:ACCOUNT_DELETING';
  end if;
  if not internal.has_current_ai_consent((v_lock.o_job).user_id) then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'CONSENT_WITHDRAWN');
    return 'failed:CONSENT_WITHDRAWN';
  end if;

  if not internal.is_valid_ai_result(p_summary) or p_summary ->> 'schema_version' <> 'import.v1'
     or not internal.stage_import_items(v_batch, p_items,
          array['profile', 'experience', 'education', 'certification', 'skill', 'achievement']) then
    perform internal.fail_ai_job_locked(v_lock.o_job, 'AI_OUTPUT_INVALID');
    return 'invalid';
  end if;

  update public.ai_jobs as job
  set status = 'succeeded', result = p_summary, error_code = null,
      lease_expires_at = null, finished_at = pg_catalog.clock_timestamp()
  where job.id = (v_lock.o_job).id;
  update public.import_batches as batch
  set status = 'review', stage = 'done'
  where batch.id = v_batch.id;
  return 'succeeded';
end;
$$;

-- 5. Grants and comments ----------------------------------------------------------------------------------------------------

revoke all on function internal.is_permanent_import_error(text) from public, anon, authenticated, service_role;
revoke all on function internal.guard_import_batch_row() from public, anon, authenticated, service_role;
revoke all on function internal.stage_import_items(public.import_batches, jsonb, text[]) from public, anon, authenticated, service_role;

revoke all on function public.begin_import_batch(uuid, text, bigint, text, text, text) from public, anon, service_role;
grant execute on function public.begin_import_batch(uuid, text, bigint, text, text, text) to authenticated;
revoke all on function public.retry_import_batch(uuid) from public, anon, service_role;
grant execute on function public.retry_import_batch(uuid) to authenticated;

revoke all on function public.finalize_import_upload(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_import_jobs(integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_import_parse(uuid, uuid, text, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.complete_import_ai_job(uuid, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.finalize_import_upload(uuid, uuid) to service_role;
grant execute on function public.claim_import_jobs(integer) to service_role;
grant execute on function public.complete_import_parse(uuid, uuid, text, integer, jsonb) to service_role;
grant execute on function public.complete_import_ai_job(uuid, uuid, jsonb, jsonb) to service_role;

comment on function internal.is_permanent_import_error(text) is
  'T15: file-level failures that a retry cannot fix; the batch offers another file or manual entry instead. T26 adds IMPORT_RULES_FAILED.';
comment on function internal.stage_import_items(public.import_batches, jsonb, text[]) is
  'T26: validates candidate structure (<=300 items, <=60 per type, <=1 profile, allowed types, draft achievements) and inserts import_items; false writes nothing.';
comment on function public.begin_import_batch(uuid, text, bigint, text, text, text) is
  'T15/T26: session owner starts an import batch with extraction_mode ai (needs current AI consent and an AI unit) or rules (neither). Idempotent per key and mode; returns a duplicate-hash warning.';
comment on function public.retry_import_batch(uuid) is
  'T15/T26: resumes a failed batch from the failed stage on the same batch; max 3 retries; consent and the AI unit apply to ai batches only.';
comment on function public.finalize_import_upload(uuid, uuid) is
  'T15 server: after the object upload, moves the batch to screening and enqueues its scan+parse job with the batch mode. Idempotent.';
comment on function public.claim_import_jobs(integer) is
  'T15 worker: claims scan+parse jobs with a 120 second lease and marks the batch running. T26 returns extraction_mode.';
comment on function public.complete_import_parse(uuid, uuid, text, integer, jsonb) is
  'T15/T26 worker: stores extracted text and trusted page_count. ai: enqueues the import AI job if consent is current. rules: stages the given candidates and opens review without AI.';
comment on function public.complete_import_ai_job(uuid, uuid, jsonb, jsonb) is
  'T15 worker: atomically stages validated candidates as import_items and opens review; stores only a summary on the job.';

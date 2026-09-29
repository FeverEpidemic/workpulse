-- T14 gate review fix: answer_ai_questions took job -> review -> activity while apply_ai_suggestion
-- takes context -> activity -> job -> review, which could deadlock on the same job. Same body, new lock order.

create or replace function public.answer_ai_questions(
  p_job_id uuid,
  p_expected_revision integer,
  p_answers jsonb
)
returns table (
  activity_revision integer,
  job_id uuid,
  job_status text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_job public.ai_jobs%rowtype;
  v_review public.ai_suggestion_reviews%rowtype;
  v_has_review boolean;
  v_activity public.activities%rowtype;
  v_key text;
  v_key_count integer;
  v_canonical text;
  v_hash bytea;
  v_next_job_id uuid;
  v_next_job_status text;
  v_changes jsonb;
  v_updated public.activities%rowtype;
  v_seq integer;
  v_question_text text;
  v_answer_text text;
  v_refine_job public.ai_jobs%rowtype;
  v_snapshot public.ai_jobs%rowtype;
  v_activity_peek public.activities%rowtype;
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

  if p_job_id is null or p_expected_revision is null or p_expected_revision < 1
     or p_answers is null or pg_catalog.jsonb_typeof(p_answers) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_AI_ANSWER';
  end if;
  select pg_catalog.count(*)::integer into v_key_count from pg_catalog.jsonb_object_keys(p_answers) as field(key);
  if v_key_count < 1 or v_key_count > 3 then
    raise exception using errcode = '22023', message = 'INVALID_AI_ANSWER';
  end if;
  for v_key in select field.key from pg_catalog.jsonb_object_keys(p_answers) as field(key) loop
    if v_key not in ('role', 'scope', 'outcome') or pg_catalog.jsonb_typeof(p_answers -> v_key) <> 'string' then
      raise exception using errcode = '22023', message = 'INVALID_AI_ANSWER';
    end if;
  end loop;

  select job.* into v_snapshot from public.ai_jobs as job where job.id = p_job_id and job.user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;

  -- Lock order matches apply_ai_suggestion and internal.update_activity: context, activity, job, review.
  select activity.* into v_activity_peek
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = v_snapshot.activity_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;
  perform internal.lock_activity_context(v_user_id, v_activity_peek.experience_id, v_activity_peek.project_id);

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = v_snapshot.activity_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;

  select job.* into v_job from public.ai_jobs as job where job.id = p_job_id and job.user_id = v_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;
  if v_job.status <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'AI_JOB_NOT_APPLICABLE';
  end if;

  select review.* into v_review
  from public.ai_suggestion_reviews as review
  where review.user_id = v_user_id and review.activity_id = v_job.activity_id and review.activity_revision = v_job.input_revision
  for update;
  v_has_review := found;

  -- Canonical, order-independent hash of the three possible answer fields.
  v_canonical := pg_catalog.encode(pg_catalog.convert_to(coalesce(p_answers ->> 'role', ''), 'UTF8'), 'hex') || '|'
    || pg_catalog.encode(pg_catalog.convert_to(coalesce(p_answers ->> 'scope', ''), 'UTF8'), 'hex') || '|'
    || pg_catalog.encode(pg_catalog.convert_to(coalesce(p_answers ->> 'outcome', ''), 'UTF8'), 'hex');
  v_hash := extensions.digest(v_canonical, 'sha256');

  if v_has_review and v_review.answered_at is not null then
    if v_review.answers_hash is distinct from v_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    select job.id, job.status into v_next_job_id, v_next_job_status
    from public.ai_jobs as job
    where job.user_id = v_user_id and job.activity_id = v_job.activity_id
      and job.input_revision = v_job.input_revision + 1 and job.kind = 'refine';
    return query select v_job.input_revision + 1, v_next_job_id, v_next_job_status;
    return;
  end if;

  if v_has_review and (v_review.state = 'dismissed' or v_review.questions_skipped_at is not null) then
    raise exception using errcode = 'P0001', message = 'AI_QUESTIONS_CLOSED';
  end if;

  if v_activity.revision <> p_expected_revision or v_activity.revision <> v_job.input_revision then
    raise exception using errcode = 'P0001', message = 'STALE_INPUT';
  end if;

  for v_key in select field.key from pg_catalog.jsonb_object_keys(p_answers) as field(key) loop
    if not exists (
      select 1 from pg_catalog.jsonb_array_elements(v_job.result -> 'questions') as question(value)
      where question.value ->> 'field' = v_key
    ) then
      raise exception using errcode = '22023', message = 'INVALID_AI_ANSWER';
    end if;
    if (v_key = 'role' and v_activity.role is not null)
       or (v_key = 'scope' and v_activity.scope is not null)
       or (v_key = 'outcome' and v_activity.outcome is not null) then
      raise exception using errcode = '22023', message = 'INVALID_AI_ANSWER';
    end if;
    v_answer_text := nullif(pg_catalog.btrim(p_answers ->> v_key), '');
    if v_answer_text is null
       or (v_key = 'role' and pg_catalog.char_length(v_answer_text) > 200)
       or (v_key in ('scope', 'outcome') and pg_catalog.char_length(v_answer_text) > 5000) then
      raise exception using errcode = '22023', message = 'INVALID_AI_ANSWER';
    end if;
  end loop;

  v_changes := pg_catalog.jsonb_build_object(
    'raw_text', v_activity.raw_text,
    'occurred_on', v_activity.occurred_on::text,
    'role', case when p_answers ? 'role' then p_answers ->> 'role' else v_activity.role end,
    'scope', case when p_answers ? 'scope' then p_answers ->> 'scope' else v_activity.scope end,
    'outcome', case when p_answers ? 'outcome' then p_answers ->> 'outcome' else v_activity.outcome end,
    'experience_id', v_activity.experience_id::text,
    'project_id', v_activity.project_id::text
  );
  v_updated := internal.update_activity(v_user_id, v_activity.id, p_expected_revision, v_changes);

  if v_activity.capture_mode = 'chat' then
    select coalesce(pg_catalog.max(message.sequence_no), 0) into v_seq
    from public.chat_messages as message
    where message.user_id = v_user_id and message.activity_id = v_activity.id;
    for v_key in select field.key from pg_catalog.jsonb_object_keys(p_answers) as field(key) loop
      select question.value ->> 'text' into v_question_text
      from pg_catalog.jsonb_array_elements(v_job.result -> 'questions') as question(value)
      where question.value ->> 'field' = v_key;
      v_seq := v_seq + 1;
      insert into public.chat_messages (user_id, activity_id, role, content, sequence_no)
      values (v_user_id, v_activity.id, 'assistant', v_question_text, v_seq);
      v_seq := v_seq + 1;
      insert into public.chat_messages (user_id, activity_id, role, content, sequence_no)
      values (v_user_id, v_activity.id, 'user', pg_catalog.btrim(p_answers ->> v_key), v_seq);
    end loop;
  end if;

  insert into public.ai_suggestion_reviews (user_id, activity_id, activity_revision, job_id, answered_at, answers_hash)
  values (v_user_id, v_activity.id, v_job.input_revision, v_job.id, pg_catalog.clock_timestamp(), v_hash)
  on conflict on constraint ai_suggestion_reviews_user_activity_revision_key do update
    set answered_at = excluded.answered_at, answers_hash = excluded.answers_hash;

  if internal.has_current_ai_consent(v_user_id) then
    v_refine_job := internal.enqueue_ai_job(v_user_id, v_updated, 'refine');
  end if;

  return query select v_updated.revision, v_refine_job.id, v_refine_job.status;
end;
$$;

-- T14 Detection, refinement and review.
-- Extends T13's durable ai_jobs with a refine kind (answers to detect.v1 questions become
-- a new input revision and a follow-up job), a one-job-per-revision invariant across kinds,
-- and a review ledger (ai_suggestion_reviews) that tracks skip/dismiss/answer/apply per
-- activity revision. Applying a suggestion only ever creates or updates a draft Achievement
-- through the T09 review action; it never confirms one and never overwrites a confirmed,
-- dismissed, or user-edited draft.

-- ai_jobs: allow refine, enforce one job per (user, activity, input_revision) across kinds,
-- and cap follow-up questions at the table level so the invariant is structural.

alter table public.ai_jobs
  drop constraint ai_jobs_kind_check,
  add constraint ai_jobs_kind_check check (kind in ('detect', 'refine'));

alter table public.ai_jobs
  drop constraint ai_jobs_idempotency_key_check,
  add constraint ai_jobs_idempotency_key_check check (
    idempotency_key ~ '^(detect|refine):[0-9a-f-]{36}:r[1-9][0-9]*$'
  );

alter table public.ai_jobs
  add constraint ai_jobs_key_kind_check check (
    (kind = 'detect' and idempotency_key like 'detect:%')
    or (kind = 'refine' and idempotency_key like 'refine:%')
  );

alter table public.ai_jobs
  add constraint ai_jobs_one_per_revision_key unique (user_id, activity_id, input_revision);

alter table public.ai_jobs
  add constraint ai_jobs_questions_check check (
    result is null or pg_catalog.jsonb_array_length(result -> 'questions') <= 3
  ),
  add constraint ai_jobs_refine_no_questions_check check (
    kind <> 'refine' or result is null or pg_catalog.jsonb_array_length(result -> 'questions') = 0
  );

comment on constraint ai_jobs_one_per_revision_key on public.ai_jobs is
  'T14: one AI job (detect or refine) per activity revision; request_ai_analysis and the refine enqueue in answer_ai_questions share this invariant.';

-- ai_suggestion_reviews: one row per activity revision that had a job, tracking skip,
-- dismiss, answers, and the single derived-Achievement apply for that revision.

create table public.ai_suggestion_reviews (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid not null,
  activity_revision integer not null,
  job_id uuid not null,
  state text not null default 'open',
  questions_skipped_at timestamptz,
  answered_at timestamptz,
  answers_hash bytea,
  applied_achievement_id uuid,
  applied_achievement_revision integer,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  revision integer not null default 1,
  constraint ai_suggestion_reviews_user_id_id_key unique (user_id, id),
  constraint ai_suggestion_reviews_user_activity_revision_key unique (user_id, activity_id, activity_revision),
  constraint ai_suggestion_reviews_user_job_key unique (user_id, job_id),
  constraint ai_suggestion_reviews_activity_revision_check check (activity_revision > 0),
  constraint ai_suggestion_reviews_state_check check (state in ('open', 'dismissed', 'applied')),
  constraint ai_suggestion_reviews_answers_hash_check check (
    answers_hash is null or pg_catalog.octet_length(answers_hash) = 32
  ),
  constraint ai_suggestion_reviews_answered_pair_check check (
    (answered_at is null) = (answers_hash is null)
  ),
  constraint ai_suggestion_reviews_applied_achievement_revision_check check (
    applied_achievement_revision is null or applied_achievement_revision > 0
  ),
  constraint ai_suggestion_reviews_applied_state_check check (
    (state = 'applied') = (applied_achievement_revision is not null)
  ),
  constraint ai_suggestion_reviews_revision_positive check (revision > 0),
  constraint ai_suggestion_reviews_user_activity_fkey foreign key (user_id, activity_id)
    references public.activities (user_id, id) on delete cascade,
  constraint ai_suggestion_reviews_user_job_fkey foreign key (user_id, job_id)
    references public.ai_jobs (user_id, id) on delete cascade,
  constraint ai_suggestion_reviews_user_achievement_fkey foreign key (user_id, applied_achievement_id)
    references public.achievements (user_id, id) on delete set null (applied_achievement_id)
);

create index ai_suggestion_reviews_user_activity_revision_desc_idx
  on public.ai_suggestion_reviews (user_id, activity_id, activity_revision desc);

comment on table public.ai_suggestion_reviews is
  'T14: per-activity-revision review ledger for AI suggestions (skip/dismiss/answer/apply). Owner-readable; written only by the review RPCs.';
comment on column public.ai_suggestion_reviews.applied_achievement_revision is
  'Achievement.revision immediately after the apply that set applied_achievement_id; used to detect an untouched draft on a later apply.';
comment on constraint ai_suggestion_reviews_applied_state_check on public.ai_suggestion_reviews is
  'applied_achievement_id can still be nulled by its FK if the Achievement is ever deleted; applied_achievement_revision and state stay in lockstep regardless.';

create or replace function internal.guard_ai_suggestion_review_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if row(new.id, new.user_id, new.activity_id, new.activity_revision, new.job_id, new.created_at)
     is distinct from
     row(old.id, old.user_id, old.activity_id, old.activity_revision, old.job_id, old.created_at) then
    raise exception using errcode = '22023', message = 'INVALID_AI_SUGGESTION_REVIEW_MUTATION';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger ai_suggestion_reviews_guard_row
before update on public.ai_suggestion_reviews
for each row execute function internal.guard_ai_suggestion_review_row();

alter table public.ai_suggestion_reviews enable row level security;

create policy ai_suggestion_reviews_select_own on public.ai_suggestion_reviews
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.ai_suggestion_reviews from public, anon, authenticated, service_role;
grant select on public.ai_suggestion_reviews to authenticated;

-- Shared enqueue used by both public.request_ai_analysis (kind detect) and the refine
-- follow-up inside answer_ai_questions, so the one-job-per-revision invariant has one
-- insert path regardless of kind.

create or replace function internal.enqueue_ai_job(
  p_user_id uuid,
  p_activity public.activities,
  p_kind text
)
returns public.ai_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_hash bytea;
  v_job public.ai_jobs%rowtype;
begin
  v_key := p_kind || ':' || p_activity.id::text || ':r' || p_activity.revision::text;
  v_hash := extensions.digest(
    internal.ai_detect_payload(p_activity.raw_text, p_activity.role, p_activity.scope, p_activity.outcome)::text,
    'sha256'
  );

  insert into public.ai_jobs (
    user_id, kind, activity_id, input_revision, idempotency_key, payload_hash, consent_version
  ) values (
    p_user_id, p_kind, p_activity.id, p_activity.revision, v_key, v_hash,
    internal.current_ai_consent_version()
  )
  on conflict on constraint ai_jobs_one_per_revision_key do nothing
  returning * into v_job;

  if v_job.id is null then
    select job.* into v_job
    from public.ai_jobs as job
    where job.user_id = p_user_id and job.activity_id = p_activity.id and job.input_revision = p_activity.revision;
    if v_job.payload_hash <> v_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  else
    perform internal.set_activity_analysis_state(p_user_id, p_activity.id, p_activity.revision, 'queued');
  end if;

  return v_job;
end;
$$;

-- request_ai_analysis: same contract as T13, but the receipt now carries kind and the
-- existing-job lookup is keyed by (activity_id, input_revision) so a refine job created by
-- answer_ai_questions for this revision is returned instead of inserting a second row.
-- Return type gains a column, so the function is dropped and recreated.

drop function if exists public.request_ai_analysis(uuid, integer);

create function public.request_ai_analysis(
  p_activity_id uuid,
  p_expected_revision integer
)
returns table (
  job_id uuid,
  status text,
  input_revision integer,
  attempt_count integer,
  error_code text,
  kind text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_activity public.activities%rowtype;
  v_job public.ai_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_activity_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'INVALID_AI_REQUEST';
  end if;

  perform 1 from public.profiles as profile
  where profile.id = v_user_id and profile.deleting_at is null
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = p_activity_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACTIVITY_UNAVAILABLE';
  end if;

  if not internal.has_current_ai_consent(v_user_id) then
    raise exception using errcode = 'P0001', message = 'CONSENT_REQUIRED';
  end if;
  if v_activity.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_INPUT';
  end if;

  v_job := internal.enqueue_ai_job(v_user_id, v_activity, 'detect');

  return query select v_job.id, v_job.status, v_job.input_revision, v_job.attempt_count, v_job.error_code, v_job.kind;
end;
$$;

-- complete_ai_job: same contract as T13, with a pre-update check that a detect result has
-- at most 3 questions and a refine result has none, returned as 'invalid' like a schema
-- failure rather than raising, so the worker never has to distinguish the two cases.

create or replace function public.complete_ai_job(
  p_job_id uuid,
  p_attempt_token uuid,
  p_result jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_snapshot public.ai_jobs%rowtype;
  v_deleting_at timestamptz;
  v_activity public.activities%rowtype;
  v_job public.ai_jobs%rowtype;
begin
  if p_job_id is null or p_attempt_token is null then
    raise exception using errcode = '22023', message = 'INVALID_AI_JOB_COMPLETION';
  end if;
  select job.* into v_snapshot from public.ai_jobs as job where job.id = p_job_id;
  if not found then
    return 'stale';
  end if;

  select profile.deleting_at into v_deleting_at
  from public.profiles as profile
  where profile.id = v_snapshot.user_id
  for share;

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_snapshot.user_id and activity.id = v_snapshot.activity_id
  for update;

  select job.* into v_job from public.ai_jobs as job where job.id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt_token <> p_attempt_token
     or v_job.lease_expires_at <= pg_catalog.clock_timestamp() then
    return 'stale';
  end if;

  if v_deleting_at is not null then
    perform internal.fail_ai_job_locked(v_job, 'ACCOUNT_DELETING');
    return 'failed:ACCOUNT_DELETING';
  end if;
  if not internal.has_current_ai_consent(v_job.user_id) then
    perform internal.fail_ai_job_locked(v_job, 'CONSENT_WITHDRAWN');
    return 'failed:CONSENT_WITHDRAWN';
  end if;
  if v_activity.id is null or v_activity.revision <> v_job.input_revision then
    perform internal.fail_ai_job_locked(v_job, 'STALE_INPUT');
    return 'failed:STALE_INPUT';
  end if;
  if not internal.is_valid_ai_result(p_result) then
    perform internal.fail_ai_job_locked(v_job, 'AI_OUTPUT_INVALID');
    return 'invalid';
  end if;
  if pg_catalog.jsonb_array_length(p_result -> 'questions') > 3
     or (v_job.kind = 'refine' and pg_catalog.jsonb_array_length(p_result -> 'questions') <> 0) then
    perform internal.fail_ai_job_locked(v_job, 'AI_OUTPUT_INVALID');
    return 'invalid';
  end if;

  update public.ai_jobs as job
  set status = 'succeeded', result = p_result, error_code = null,
      lease_expires_at = null, finished_at = pg_catalog.clock_timestamp()
  where job.id = v_job.id;
  perform internal.set_activity_analysis_state(v_job.user_id, v_job.activity_id, v_job.input_revision, 'done');
  return 'succeeded';
end;
$$;

-- Metric mapping shared by apply_ai_suggestion: drop a null baseline entirely rather than
-- storing it as JSON null, so the result passes internal.is_valid_achievement_metrics.

create or replace function internal.ai_apply_metrics(p_metrics jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      case
        when pg_catalog.jsonb_typeof(item -> 'baseline') = 'number' then
          pg_catalog.jsonb_build_object(
            'label', item ->> 'label', 'value', (item ->> 'value')::numeric,
            'unit', item ->> 'unit', 'baseline', (item ->> 'baseline')::numeric
          )
        else
          pg_catalog.jsonb_build_object(
            'label', item ->> 'label', 'value', (item ->> 'value')::numeric, 'unit', item ->> 'unit'
          )
      end
    ),
    '[]'::jsonb
  )
  from pg_catalog.jsonb_array_elements(coalesce(p_metrics, '[]'::jsonb)) as item;
$$;

-- answer_ai_questions: answers become a new input revision (via internal.update_activity),
-- an optional Chat pair per answered field, and (with current consent) a refine job for the
-- new revision. Replay of the exact same answers for an already-answered revision returns
-- the stored receipt without writing again.

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

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = v_job.activity_id;
  if not found or v_activity.revision <> p_expected_revision or v_activity.revision <> v_job.input_revision then
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

-- skip_ai_questions / dismiss_ai_suggestion: no consent check (no processing happens),
-- idempotent, lazily create the review row for the job's revision.

create or replace function public.skip_ai_questions(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.ai_jobs%rowtype;
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
  if p_job_id is null then
    raise exception using errcode = '22023', message = 'INVALID_AI_REQUEST';
  end if;

  select job.* into v_job from public.ai_jobs as job where job.id = p_job_id and job.user_id = v_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;

  insert into public.ai_suggestion_reviews (user_id, activity_id, activity_revision, job_id, questions_skipped_at)
  values (v_user_id, v_job.activity_id, v_job.input_revision, v_job.id, pg_catalog.clock_timestamp())
  on conflict on constraint ai_suggestion_reviews_user_activity_revision_key do update
    set questions_skipped_at = coalesce(public.ai_suggestion_reviews.questions_skipped_at, pg_catalog.clock_timestamp())
  where public.ai_suggestion_reviews.state <> 'applied';
end;
$$;

create or replace function public.dismiss_ai_suggestion(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.ai_jobs%rowtype;
  v_review public.ai_suggestion_reviews%rowtype;
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
  if p_job_id is null then
    raise exception using errcode = '22023', message = 'INVALID_AI_REQUEST';
  end if;

  select job.* into v_job from public.ai_jobs as job where job.id = p_job_id and job.user_id = v_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;

  select review.* into v_review
  from public.ai_suggestion_reviews as review
  where review.user_id = v_user_id and review.activity_id = v_job.activity_id and review.activity_revision = v_job.input_revision
  for update;
  if found and v_review.state = 'applied' then
    raise exception using errcode = 'P0001', message = 'AI_SUGGESTION_APPLIED';
  end if;

  insert into public.ai_suggestion_reviews (user_id, activity_id, activity_revision, job_id, state)
  values (v_user_id, v_job.activity_id, v_job.input_revision, v_job.id, 'dismissed')
  on conflict on constraint ai_suggestion_reviews_user_activity_revision_key do update
    set state = 'dismissed';
end;
$$;

-- apply_ai_suggestion: create or refresh a draft Achievement from a succeeded, potential
-- job's suggestion. Lock order: profile -> experience -> project -> activity ->
-- derived achievement -> job -> review, matching create_achievement_idempotent (T09).

create or replace function public.apply_ai_suggestion(
  p_job_id uuid,
  p_expected_activity_revision integer,
  p_expected_achievement_revision integer
)
returns table (
  achievement_id uuid,
  achievement_revision integer,
  created boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_snapshot public.ai_jobs%rowtype;
  v_activity_peek public.activities%rowtype;
  v_activity public.activities%rowtype;
  v_has_achievement boolean;
  v_achievement public.achievements%rowtype;
  v_job public.ai_jobs%rowtype;
  v_review public.ai_suggestion_reviews%rowtype;
  v_has_review boolean;
  v_suggestion jsonb;
  v_metrics jsonb;
  v_potential boolean;
  v_created boolean;
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
  if p_job_id is null or p_expected_activity_revision is null or p_expected_activity_revision < 1
     or (p_expected_achievement_revision is not null and p_expected_achievement_revision < 1) then
    raise exception using errcode = '22023', message = 'INVALID_AI_REQUEST';
  end if;

  select job.* into v_snapshot from public.ai_jobs as job where job.id = p_job_id and job.user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;

  select activity.* into v_activity_peek
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = v_snapshot.activity_id;

  if v_activity_peek.experience_id is not null then
    perform 1 from public.experiences as experience
    where experience.user_id = v_user_id and experience.id = v_activity_peek.experience_id
    for update;
  end if;
  if v_activity_peek.project_id is not null then
    perform 1 from public.projects as project
    where project.user_id = v_user_id and project.id = v_activity_peek.project_id
    for update;
  end if;

  select activity.* into v_activity
  from public.activities as activity
  where activity.user_id = v_user_id and activity.id = v_snapshot.activity_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;

  select achievement.* into v_achievement
  from public.achievements as achievement
  where achievement.user_id = v_user_id and achievement.activity_id = v_activity.id
  for update;
  v_has_achievement := found;

  select job.* into v_job from public.ai_jobs as job where job.id = p_job_id and job.user_id = v_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;

  select review.* into v_review
  from public.ai_suggestion_reviews as review
  where review.user_id = v_user_id and review.activity_id = v_activity.id and review.activity_revision = v_job.input_revision
  for update;
  v_has_review := found;

  if v_job.status <> 'succeeded' then
    raise exception using errcode = 'P0001', message = 'AI_JOB_UNAVAILABLE';
  end if;
  v_potential := (v_job.result ->> 'potential')::boolean;
  if v_potential is not true or v_job.result -> 'suggestion' is null then
    raise exception using errcode = 'P0001', message = 'AI_JOB_NOT_APPLICABLE';
  end if;
  if v_activity.revision <> p_expected_activity_revision or v_activity.revision <> v_job.input_revision then
    raise exception using errcode = 'P0001', message = 'STALE_INPUT';
  end if;
  if not internal.has_current_ai_consent(v_user_id) then
    raise exception using errcode = 'P0001', message = 'CONSENT_REQUIRED';
  end if;
  if v_has_review and v_review.state = 'dismissed' then
    raise exception using errcode = 'P0001', message = 'AI_SUGGESTION_DISMISSED';
  end if;

  v_suggestion := v_job.result -> 'suggestion';
  v_metrics := internal.ai_apply_metrics(v_suggestion -> 'metrics');

  if not v_has_achievement then
    if p_expected_achievement_revision is not null then
      raise exception using errcode = 'P0001', message = 'STALE_REVISION';
    end if;

    insert into public.achievements (
      user_id, activity_id, experience_id, project_id,
      title, contribution, scope, outcome, cv_bullet, achieved_on,
      status, origin, source_excerpt, source_activity_revision, metrics
    ) values (
      v_user_id, v_activity.id, v_activity.experience_id, v_activity.project_id,
      v_suggestion ->> 'title', v_suggestion ->> 'contribution', v_suggestion ->> 'scope', v_suggestion ->> 'outcome',
      v_suggestion ->> 'cv_bullet', v_activity.occurred_on,
      'draft', 'activity', v_activity.raw_text, v_activity.revision, v_metrics
    )
    returning * into v_achievement;
    v_created := true;
  else
    if p_expected_achievement_revision is null then
      if v_has_review and v_review.state = 'applied' and v_review.applied_achievement_id = v_achievement.id then
        p_expected_achievement_revision := v_achievement.revision;
      else
        raise exception using errcode = 'P0001', message = 'STALE_REVISION';
      end if;
    end if;
    if v_achievement.revision <> p_expected_achievement_revision then
      raise exception using errcode = 'P0001', message = 'STALE_REVISION';
    end if;
    if v_achievement.status = 'confirmed' then
      raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_CONFIRMED';
    end if;
    if v_achievement.status = 'dismissed' then
      raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_DISMISSED';
    end if;

    if not (
      (v_achievement.title is null and v_achievement.contribution is null and v_achievement.scope is null
        and v_achievement.outcome is null and v_achievement.cv_bullet is null and v_achievement.achieved_on is null
        and v_achievement.metrics = '[]'::jsonb)
      or exists (
        select 1 from public.ai_suggestion_reviews as prior
        where prior.user_id = v_user_id and prior.activity_id = v_activity.id
          and prior.applied_achievement_id = v_achievement.id
          and prior.applied_achievement_revision = v_achievement.revision
      )
    ) then
      raise exception using errcode = 'P0001', message = 'DRAFT_EDITED';
    end if;

    update public.achievements as achievement
    set title = v_suggestion ->> 'title',
        contribution = v_suggestion ->> 'contribution',
        scope = v_suggestion ->> 'scope',
        outcome = v_suggestion ->> 'outcome',
        cv_bullet = v_suggestion ->> 'cv_bullet',
        achieved_on = v_activity.occurred_on,
        source_excerpt = v_activity.raw_text,
        source_activity_revision = v_activity.revision,
        metrics = v_metrics
    where achievement.user_id = v_user_id and achievement.id = v_achievement.id
    returning * into v_achievement;
    v_created := false;
  end if;

  insert into public.ai_suggestion_reviews (
    user_id, activity_id, activity_revision, job_id, state, applied_achievement_id, applied_achievement_revision
  ) values (
    v_user_id, v_activity.id, v_job.input_revision, v_job.id, 'applied', v_achievement.id, v_achievement.revision
  )
  on conflict on constraint ai_suggestion_reviews_user_activity_revision_key do update
    set state = 'applied',
        applied_achievement_id = excluded.applied_achievement_id,
        applied_achievement_revision = excluded.applied_achievement_revision;

  return query select v_achievement.id, v_achievement.revision, v_created;
exception
  when unique_violation then
    if sqlerrm like '%achievements_one_derived_activity_idx%' then
      raise exception using errcode = 'P0001', message = 'ACHIEVEMENT_EXISTS';
    end if;
    raise;
end;
$$;

-- Grants --------------------------------------------------------------------------

revoke all on function internal.enqueue_ai_job(uuid, public.activities, text) from public, anon, authenticated, service_role;
revoke all on function internal.ai_apply_metrics(jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.guard_ai_suggestion_review_row() from public, anon, authenticated, service_role;

revoke all on function public.request_ai_analysis(uuid, integer) from public, anon, service_role;
grant execute on function public.request_ai_analysis(uuid, integer) to authenticated;

revoke all on function public.answer_ai_questions(uuid, integer, jsonb) from public, anon, service_role;
revoke all on function public.skip_ai_questions(uuid) from public, anon, service_role;
revoke all on function public.dismiss_ai_suggestion(uuid) from public, anon, service_role;
revoke all on function public.apply_ai_suggestion(uuid, integer, integer) from public, anon, service_role;
grant execute on function public.answer_ai_questions(uuid, integer, jsonb) to authenticated;
grant execute on function public.skip_ai_questions(uuid) to authenticated;
grant execute on function public.dismiss_ai_suggestion(uuid) to authenticated;
grant execute on function public.apply_ai_suggestion(uuid, integer, integer) to authenticated;

comment on function internal.enqueue_ai_job(uuid, public.activities, text) is
  'T14: shared one-job-per-revision insert used by request_ai_analysis (detect) and the refine enqueue in answer_ai_questions.';
comment on function internal.ai_apply_metrics(jsonb) is
  'T14: maps a detect.v1 suggestion metrics array to the Achievement metrics shape, dropping a null baseline instead of storing JSON null.';
comment on function public.request_ai_analysis(uuid, integer) is
  'T14: enqueue detect for the session owner activity at its expected revision; the receipt now carries kind. Requires current consent; idempotent per activity revision across kinds.';
comment on function public.complete_ai_job(uuid, uuid, jsonb) is
  'T14 worker: compare-and-set completion; also rejects more than 3 questions on detect or any questions on refine as AI_OUTPUT_INVALID before storing a result.';
comment on function public.answer_ai_questions(uuid, integer, jsonb) is
  'T14: writes 1-3 still-empty activity fields the job asked about, bumping the revision once, appending a Chat pair in chat mode, and enqueueing one refine job when consent is current. Replay of identical answers is idempotent.';
comment on function public.skip_ai_questions(uuid) is
  'T14: records that follow-up questions were skipped for this job''s revision; idempotent, no consent required.';
comment on function public.dismiss_ai_suggestion(uuid) is
  'T14: suppresses the suggestion for this job''s revision; idempotent, no consent required. Rejected once the review has been applied.';
comment on function public.apply_ai_suggestion(uuid, integer, integer) is
  'T14: creates or refreshes a draft Achievement from a succeeded, potential suggestion. Never confirms; refuses a confirmed, dismissed, or user-edited draft; idempotent per job.';

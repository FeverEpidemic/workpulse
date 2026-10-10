-- T24 product events, pilot cohort and pilot metrics (PRD section 4 Performance targets and Privacy, section 5 Pilot
-- measures, decision 0030).
-- 1. internal.product_events: minimal, allowlisted events written by AFTER triggers in the same transaction as the domain
--    change. No API role has any privilege on it.
-- 2. internal.product_event_epoch and internal.pilot_participants: the pilot cohort, filled by the operator.
-- 3. Service-role RPCs: set_pilot_participant and get_pilot_metrics.
-- No T02-T23 function is replaced. Events and participants reference profiles with ON DELETE CASCADE, so they leave with
-- the tombstone profile when the T23 deletion pass removes the Auth user.

begin;

-- 1. Validators --------------------------------------------------------------------------------------------------------

-- True when the value is a JSON number with no fraction inside [p_min, p_max].
create or replace function internal.product_event_int_in_range(p_value jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'number' then false
    else (p_value #>> '{}')::numeric = pg_catalog.trunc((p_value #>> '{}')::numeric)
      and (p_value #>> '{}')::numeric between p_min and p_max
  end
$$;

-- The allowlist: only the keys, enums and bounded integers below can be stored. No record id, text, file name or email.
create or replace function internal.product_event_properties_valid(p_event_name text, p_properties jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(case
    when p_event_name is null or p_properties is null or pg_catalog.jsonb_typeof(p_properties) <> 'object' then false
    when p_event_name = 'activity_saved' then
      p_properties - array['capture_mode'] = '{}'::jsonb
      and p_properties ? 'capture_mode'
      and p_properties ->> 'capture_mode' in ('note', 'form', 'chat')
      and pg_catalog.jsonb_typeof(p_properties -> 'capture_mode') = 'string'
    when p_event_name = 'career_record_created' then
      p_properties - array['record_type', 'origin'] = '{}'::jsonb
      and p_properties ? 'record_type'
      and pg_catalog.jsonb_typeof(p_properties -> 'record_type') = 'string'
      and p_properties ->> 'record_type' in ('achievement', 'project', 'experience', 'education', 'certification')
      and case
        when p_properties ->> 'record_type' = 'achievement' then
          p_properties ? 'origin'
          and pg_catalog.jsonb_typeof(p_properties -> 'origin') = 'string'
          and p_properties ->> 'origin' in ('manual', 'activity', 'import')
        else not (p_properties ? 'origin')
      end
    when p_event_name = 'achievement_confirmed' then
      p_properties - array['origin'] = '{}'::jsonb
      and p_properties ? 'origin'
      and pg_catalog.jsonb_typeof(p_properties -> 'origin') = 'string'
      and p_properties ->> 'origin' in ('manual', 'activity', 'import')
    when p_event_name = 'import_committed' then
      p_properties - array['created', 'mapped', 'skipped', 'confirmed_achievements'] = '{}'::jsonb
      and p_properties ?& array['created', 'mapped', 'skipped', 'confirmed_achievements']
      and internal.product_event_int_in_range(p_properties -> 'created', 0, 1000)
      and internal.product_event_int_in_range(p_properties -> 'mapped', 0, 1000)
      and internal.product_event_int_in_range(p_properties -> 'skipped', 0, 1000)
      and internal.product_event_int_in_range(p_properties -> 'confirmed_achievements', 0, 1000)
    when p_event_name = 'cv_export_finished' then
      p_properties - array['outcome', 'error_code', 'attempt', 'page_count'] = '{}'::jsonb
      and p_properties ?& array['outcome', 'error_code', 'attempt', 'page_count']
      and pg_catalog.jsonb_typeof(p_properties -> 'outcome') = 'string'
      and p_properties ->> 'outcome' in ('succeeded', 'failed')
      and internal.product_event_int_in_range(p_properties -> 'attempt', 1, 10)
      and case
        when p_properties ->> 'outcome' = 'succeeded' then
          pg_catalog.jsonb_typeof(p_properties -> 'error_code') = 'null'
          and internal.product_event_int_in_range(p_properties -> 'page_count', 1, 20)
        else
          pg_catalog.jsonb_typeof(p_properties -> 'page_count') = 'null'
          and (
            pg_catalog.jsonb_typeof(p_properties -> 'error_code') = 'null'
            or (
              pg_catalog.jsonb_typeof(p_properties -> 'error_code') = 'string'
              and p_properties ->> 'error_code' in ('EXPORT_TIMEOUT', 'RENDERER_UNAVAILABLE', 'RENDERER_TIMEOUT',
                'EXPORT_RENDER_INVALID', 'EXPORT_TOO_LONG', 'EXPORT_SNAPSHOT_INVALID', 'STORAGE_UNAVAILABLE', 'ACCOUNT_DELETING')
            )
          )
      end
    else false
  end, false)
$$;

-- 2. Tables ------------------------------------------------------------------------------------------------------------

create table internal.product_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_name text not null,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  local_date date not null,
  properties jsonb not null default '{}'::jsonb,
  constraint product_events_event_name_check check (
    event_name in ('activity_saved', 'career_record_created', 'achievement_confirmed', 'import_committed', 'cv_export_finished')
  ),
  constraint product_events_properties_check check (internal.product_event_properties_valid(event_name, properties))
);

comment on table internal.product_events is
  'T24: one row per product event (activity saved, career record created, achievement confirmed, import committed, export finished). Written by AFTER triggers in the domain transaction. Properties are allowlisted enums and bounded integers: no text, record id, file name or email.';

create index product_events_user_event_occurred_idx
  on internal.product_events (user_id, event_name, occurred_at);

alter table internal.product_events enable row level security;
revoke all privileges on table internal.product_events from public, anon, authenticated, service_role;
revoke all privileges on sequence internal.product_events_id_seq from public, anon, authenticated, service_role;

create table internal.product_event_epoch (
  started_at timestamptz not null
);

comment on table internal.product_event_epoch is
  'T24: the single instant instrumentation started. Accounts created before it have no events from their first day and cannot join the pilot cohort.';

create unique index product_event_epoch_single_row on internal.product_event_epoch ((true));
insert into internal.product_event_epoch (started_at) values (pg_catalog.clock_timestamp());

alter table internal.product_event_epoch enable row level security;
revoke all privileges on table internal.product_event_epoch from public, anon, authenticated, service_role;

create table internal.pilot_participants (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  consent_version text not null,
  enrolled_at timestamptz not null,
  withdrawn_at timestamptz,
  constraint pilot_participants_consent_version_check check (consent_version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  constraint pilot_participants_withdrawn_check check (withdrawn_at is null or withdrawn_at >= enrolled_at)
);

comment on table internal.pilot_participants is
  'T24: accounts the operator enrolled after collecting pilot consent outside the app. Only active participants are reported by get_pilot_metrics. Fixture and test accounts are never enrolled.';

alter table internal.pilot_participants enable row level security;
revoke all privileges on table internal.pilot_participants from public, anon, authenticated, service_role;

-- 3. Recorder ----------------------------------------------------------------------------------------------------------

-- Reads the profile timezone without a lock and writes one event. A missing profile writes nothing (cannot happen on a
-- legal path: every owned row references a profile). A CHECK failure is not caught: it is a trigger bug the tests must see.
create or replace function internal.record_product_event(p_user_id uuid, p_event_name text, p_properties jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_timezone text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select profile.timezone into v_timezone from public.profiles as profile where profile.id = p_user_id;
  if not found then
    return;
  end if;
  insert into internal.product_events (user_id, event_name, occurred_at, local_date, properties)
  values (p_user_id, p_event_name, v_now, (v_now at time zone v_timezone)::date, p_properties);
end;
$$;

-- 4. Trigger functions -------------------------------------------------------------------------------------------------

create or replace function internal.product_event_activity_saved()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform internal.record_product_event(new.user_id, 'activity_saved', pg_catalog.jsonb_build_object('capture_mode', new.capture_mode));
  return null;
end;
$$;

-- projects, experiences, education, certifications. Skills are labels, not career records.
create or replace function internal.product_event_career_record()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform internal.record_product_event(new.user_id, 'career_record_created', pg_catalog.jsonb_build_object(
    'record_type', case tg_table_name
      when 'projects' then 'project'
      when 'experiences' then 'experience'
      when 'education' then 'education'
      when 'certifications' then 'certification'
    end));
  return null;
end;
$$;

create or replace function internal.product_event_achievement_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform internal.record_product_event(new.user_id, 'career_record_created',
    pg_catalog.jsonb_build_object('record_type', 'achievement', 'origin', new.origin));
  return null;
end;
$$;

create or replace function internal.product_event_achievement_confirmed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform internal.record_product_event(new.user_id, 'achievement_confirmed', pg_catalog.jsonb_build_object('origin', new.origin));
  return null;
end;
$$;

-- Counts come from the commit result. Profile and skill items are not career records (decision 0030), so only
-- experience, education, certification and achievement items are summed.
create or replace function internal.product_event_import_committed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_counts jsonb := case when pg_catalog.jsonb_typeof(new.commit_result -> 'counts') = 'object'
                         then new.commit_result -> 'counts' else '{}'::jsonb end;
  v_created bigint;
  v_mapped bigint;
  v_skipped bigint;
  v_confirmed integer := case when pg_catalog.jsonb_typeof(new.commit_result -> 'confirmed_achievements') = 'number'
                              then (new.commit_result ->> 'confirmed_achievements')::integer else 0 end;
begin
  select coalesce(pg_catalog.sum((entry.value ->> 'created')::integer), 0),
         coalesce(pg_catalog.sum((entry.value ->> 'mapped')::integer), 0),
         coalesce(pg_catalog.sum((entry.value ->> 'skipped')::integer), 0)
  into v_created, v_mapped, v_skipped
  from pg_catalog.jsonb_each(v_counts) as entry
  where entry.key in ('experience', 'education', 'certification', 'achievement');
  perform internal.record_product_event(new.user_id, 'import_committed', pg_catalog.jsonb_build_object(
    'created', least(v_created, 1000),
    'mapped', least(v_mapped, 1000),
    'skipped', least(v_skipped, 1000),
    'confirmed_achievements', least(greatest(v_confirmed, 0), 1000)));
  return null;
end;
$$;

create or replace function internal.product_event_cv_export_finished()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform internal.record_product_event(new.user_id, 'cv_export_finished', pg_catalog.jsonb_build_object(
    'outcome', new.status,
    'error_code', case
      when new.status = 'failed' and new.error_code in ('EXPORT_TIMEOUT', 'RENDERER_UNAVAILABLE', 'RENDERER_TIMEOUT',
        'EXPORT_RENDER_INVALID', 'EXPORT_TOO_LONG', 'EXPORT_SNAPSHOT_INVALID', 'STORAGE_UNAVAILABLE', 'ACCOUNT_DELETING')
        then new.error_code
    end,
    'attempt', least(greatest(new.attempt_count, 1), 10),
    'page_count', case when new.status = 'succeeded' and new.page_count between 1 and 20 then new.page_count end));
  return null;
end;
$$;

-- 5. Triggers ----------------------------------------------------------------------------------------------------------

create trigger product_event_activity_saved
  after insert on public.activities
  for each row execute function internal.product_event_activity_saved();

create trigger product_event_career_record
  after insert on public.projects
  for each row execute function internal.product_event_career_record();
create trigger product_event_career_record
  after insert on public.experiences
  for each row execute function internal.product_event_career_record();
create trigger product_event_career_record
  after insert on public.education
  for each row execute function internal.product_event_career_record();
create trigger product_event_career_record
  after insert on public.certifications
  for each row execute function internal.product_event_career_record();
create trigger product_event_career_record
  after insert on public.achievements
  for each row execute function internal.product_event_achievement_created();

-- An INSERT trigger WHEN clause cannot reference OLD, so the two entry points are separate triggers.
create trigger product_event_confirmed_achievement_insert
  after insert on public.achievements
  for each row when (new.status = 'confirmed')
  execute function internal.product_event_achievement_confirmed();
create trigger product_event_confirmed_achievement_update
  after update of status on public.achievements
  for each row when (new.status = 'confirmed' and old.status is distinct from 'confirmed')
  execute function internal.product_event_achievement_confirmed();

create trigger product_event_import_committed
  after update of status on public.import_batches
  for each row when (new.status = 'committed' and old.status is distinct from 'committed')
  execute function internal.product_event_import_committed();

create trigger product_event_cv_export_finished
  after update of status on public.cv_exports
  for each row when (old.status = 'running' and new.status in ('succeeded', 'failed'))
  execute function internal.product_event_cv_export_finished();

-- 6. Cohort and metric RPCs (service_role only) --------------------------------------------------------------------------

create or replace function public.set_pilot_participant(p_user_id uuid, p_consent_version text, p_enrolled boolean)
returns table (user_id uuid, enrolled_at timestamptz, withdrawn_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_profile public.profiles%rowtype;
  v_epoch timestamptz;
  v_row internal.pilot_participants%rowtype;
begin
  if p_user_id is null or p_enrolled is null
     or (p_enrolled and (p_consent_version is null or p_consent_version !~ '^[a-z0-9][a-z0-9._-]{0,31}$')) then
    raise exception using errcode = '22023', message = 'INVALID_PILOT_PARTICIPANT';
  end if;

  select profile.* into v_profile from public.profiles as profile where profile.id = p_user_id for share;
  if not found or v_profile.deleting_at is not null then
    raise exception using errcode = '22023', message = 'PILOT_ACCOUNT_UNAVAILABLE';
  end if;
  select epoch.started_at into v_epoch from internal.product_event_epoch as epoch;
  if v_profile.created_at < v_epoch then
    raise exception using errcode = '22023', message = 'PILOT_ACCOUNT_PREDATES_INSTRUMENTATION';
  end if;

  select participant.* into v_row from internal.pilot_participants as participant
  where participant.user_id = p_user_id for update;

  if p_enrolled then
    if not found then
      insert into internal.pilot_participants (user_id, consent_version, enrolled_at)
      values (p_user_id, p_consent_version, pg_catalog.clock_timestamp())
      on conflict (user_id) do nothing
      returning * into v_row;
      if not found then
        select participant.* into v_row from internal.pilot_participants as participant
        where participant.user_id = p_user_id for update;
      end if;
    end if;
    if v_row.withdrawn_at is not null then
      raise exception using errcode = '22023', message = 'PILOT_PARTICIPANT_WITHDRAWN';
    end if;
    if v_row.consent_version <> p_consent_version then
      update internal.pilot_participants as participant
      set consent_version = p_consent_version
      where participant.user_id = p_user_id
      returning * into v_row;
    end if;
  else
    if not found then
      raise exception using errcode = '22023', message = 'PILOT_PARTICIPANT_UNKNOWN';
    end if;
    if v_row.withdrawn_at is null then
      update internal.pilot_participants as participant
      set withdrawn_at = pg_catalog.clock_timestamp()
      where participant.user_id = p_user_id
      returning * into v_row;
    end if;
  end if;

  return query select v_row.user_id, v_row.enrolled_at, v_row.withdrawn_at;
end;
$$;

-- Windows run from profiles.created_at. An account is eligible for a measure once its window has closed at p_as_of;
-- until then it is pending. An event counts when occurred_at is strictly before the window end.
create or replace function public.get_pilot_metrics(p_as_of timestamptz default pg_catalog.now())
returns table (
  measure text,
  cohort_size integer,
  eligible integer,
  achieved integer,
  pending integer,
  rate numeric,
  target numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_as_of timestamptz := coalesce(p_as_of, pg_catalog.now());
begin
  return query
  with cohort as (
    select participant.user_id as uid, profile.created_at as created
    from internal.pilot_participants as participant
    join public.profiles as profile on profile.id = participant.user_id
    where participant.withdrawn_at is null
  ),
  flags as (
    select c.uid,
           (c.created + interval '24 hours' <= v_as_of) as w24_done,
           (c.created + interval '7 days' <= v_as_of) as w7_done,
           (c.created + interval '28 days' <= v_as_of) as w28_done,
           exists (
             select 1 from internal.product_events as e
             where e.user_id = c.uid and e.occurred_at < c.created + interval '24 hours'
               and (e.event_name in ('activity_saved', 'career_record_created')
                    or (e.event_name = 'import_committed'
                        and (e.properties ->> 'created')::integer + (e.properties ->> 'mapped')::integer > 0))
           ) as is_activated,
           exists (
             select 1 from internal.product_events as e
             where e.user_id = c.uid and e.event_name = 'achievement_confirmed'
               and e.occurred_at < c.created + interval '7 days'
           ) as has_confirmed,
           exists (
             select 1 from internal.product_events as e
             where e.user_id = c.uid and e.event_name = 'cv_export_finished'
               and e.properties ->> 'outcome' = 'succeeded' and e.occurred_at < c.created + interval '7 days'
           ) as has_export,
           (
             select pg_catalog.count(distinct pg_catalog.date_trunc('week', e.local_date::timestamp))
             from internal.product_events as e
             where e.user_id = c.uid and e.event_name = 'activity_saved'
               and e.occurred_at < c.created + interval '28 days'
           ) as week_count
    from cohort as c
  ),
  exports as (
    select pg_catalog.count(1)::integer as total,
           (pg_catalog.count(1) filter (where e.properties ->> 'outcome' = 'succeeded'))::integer as succeeded
    from internal.product_events as e
    join cohort as c on c.uid = e.user_id
    where e.event_name = 'cv_export_finished' and e.occurred_at <= v_as_of
      and e.properties ->> 'error_code' is distinct from 'ACCOUNT_DELETING'
  ),
  summary as (
    select (select pg_catalog.count(1) from cohort)::integer as n_cohort,
           (pg_catalog.count(1) filter (where f.w24_done))::integer as a_elig,
           (pg_catalog.count(1) filter (where f.w24_done and f.is_activated))::integer as a_ok,
           (pg_catalog.count(1) filter (where not f.w24_done))::integer as a_pend,
           (pg_catalog.count(1) filter (where f.is_activated and f.w7_done))::integer as v_elig,
           (pg_catalog.count(1) filter (where f.is_activated and f.w7_done and f.has_confirmed and f.has_export))::integer as v_ok,
           (pg_catalog.count(1) filter (where f.is_activated and not f.w7_done))::integer as v_pend,
           (pg_catalog.count(1) filter (where f.is_activated and f.w28_done))::integer as r_elig,
           (pg_catalog.count(1) filter (where f.is_activated and f.w28_done and f.week_count >= 2))::integer as r_ok,
           (pg_catalog.count(1) filter (where f.is_activated and not f.w28_done))::integer as r_pend,
           (select x.total from exports as x) as x_elig,
           (select x.succeeded from exports as x) as x_ok
    from flags as f
  )
  select r.measure_name, r.n_cohort, r.n_elig, r.n_ok, r.n_pend,
         case when r.n_elig = 0 then null else pg_catalog.round(r.n_ok::numeric / r.n_elig, 4) end,
         r.n_target
  from (
    select 1 as ord, 'activation'::text as measure_name, s.n_cohort, s.a_elig as n_elig, s.a_ok as n_ok, s.a_pend as n_pend, 0.60::numeric as n_target from summary as s
    union all
    select 2, 'value_completion', s.n_cohort, s.v_elig, s.v_ok, s.v_pend, 0.40 from summary as s
    union all
    select 3, 'return_capture', s.n_cohort, s.r_elig, s.r_ok, s.r_pend, 0.30 from summary as s
    union all
    select 4, 'export_reliability', s.n_cohort, s.x_elig, s.x_ok, 0, 0.98 from summary as s
  ) as r
  order by r.ord;
end;
$$;

-- 7. Privileges ----------------------------------------------------------------------------------------------------------

revoke all on function internal.product_event_int_in_range(jsonb, integer, integer) from public, anon, authenticated, service_role;
revoke all on function internal.product_event_properties_valid(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.record_product_event(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.product_event_activity_saved() from public, anon, authenticated, service_role;
revoke all on function internal.product_event_career_record() from public, anon, authenticated, service_role;
revoke all on function internal.product_event_achievement_created() from public, anon, authenticated, service_role;
revoke all on function internal.product_event_achievement_confirmed() from public, anon, authenticated, service_role;
revoke all on function internal.product_event_import_committed() from public, anon, authenticated, service_role;
revoke all on function internal.product_event_cv_export_finished() from public, anon, authenticated, service_role;

revoke all on function public.set_pilot_participant(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.get_pilot_metrics(timestamptz) from public, anon, authenticated;
grant execute on function public.set_pilot_participant(uuid, text, boolean) to service_role;
grant execute on function public.get_pilot_metrics(timestamptz) to service_role;

comment on function public.set_pilot_participant(uuid, text, boolean) is
  'T24: service role only. Enrolls (p_enrolled true) or withdraws (false) one account in the pilot cohort. Withdrawal is final. Accounts created before the instrumentation epoch and deleting accounts are refused.';
comment on function public.get_pilot_metrics(timestamptz) is
  'T24: service role only. Activation (24 h), value completion (7 d), return capture (28 d) and export reliability for active pilot participants, with eligible, achieved, pending, rate and the PRD target. Targets are pilot hypotheses, not results.';

commit;

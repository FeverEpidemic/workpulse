-- T24 follow-up (gate review G1, decision 0030): get_pilot_metrics is point-in-time. The activation, confirmation, export
-- and weekly-save subqueries also require occurred_at <= p_as_of, so a past as-of no longer counts an account activated
-- after it in the pending of value completion and return capture. Same signature, grants and comment as
-- 20261011090000_t24_product_events.sql.

begin;

-- Windows run from profiles.created_at. An account is eligible for a measure once its window has closed at p_as_of;
-- until then it is pending. An event counts when occurred_at is strictly before the window end and not after p_as_of.
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
             where e.user_id = c.uid and e.occurred_at < c.created + interval '24 hours' and e.occurred_at <= v_as_of
               and (e.event_name in ('activity_saved', 'career_record_created')
                    or (e.event_name = 'import_committed'
                        and (e.properties ->> 'created')::integer + (e.properties ->> 'mapped')::integer > 0))
           ) as is_activated,
           exists (
             select 1 from internal.product_events as e
             where e.user_id = c.uid and e.event_name = 'achievement_confirmed'
               and e.occurred_at < c.created + interval '7 days' and e.occurred_at <= v_as_of
           ) as has_confirmed,
           exists (
             select 1 from internal.product_events as e
             where e.user_id = c.uid and e.event_name = 'cv_export_finished'
               and e.properties ->> 'outcome' = 'succeeded' and e.occurred_at < c.created + interval '7 days'
               and e.occurred_at <= v_as_of
           ) as has_export,
           (
             select pg_catalog.count(distinct pg_catalog.date_trunc('week', e.local_date::timestamp))
             from internal.product_events as e
             where e.user_id = c.uid and e.event_name = 'activity_saved'
               and e.occurred_at < c.created + interval '28 days' and e.occurred_at <= v_as_of
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

revoke all on function public.get_pilot_metrics(timestamptz) from public, anon, authenticated;
grant execute on function public.get_pilot_metrics(timestamptz) to service_role;

comment on function public.get_pilot_metrics(timestamptz) is
  'T24: service role only. Activation (24 h), value completion (7 d), return capture (28 d) and export reliability for active pilot participants, with eligible, achieved, pending, rate and the PRD target. Targets are pilot hypotheses, not results.';

commit;

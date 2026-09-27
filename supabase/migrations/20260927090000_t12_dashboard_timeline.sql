-- T12 Dashboard and Timeline read models. Read-only, SECURITY INVOKER: caller RLS applies.

begin;

create or replace function public.filter_achievements(
  p_skill_id uuid default null,
  p_missing_ready_evidence boolean default false
)
returns setof public.achievements
language sql
stable
security invoker
set search_path = ''
as $$
  select achievement.*
  from public.achievements as achievement
  where achievement.user_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = achievement.user_id
        and profile.deleting_at is null
    )
    and (
      p_skill_id is null
      or exists (
        select 1
        from public.achievement_skills as join_row
        where join_row.user_id = achievement.user_id
          and join_row.achievement_id = achievement.id
          and join_row.skill_id = p_skill_id
      )
    )
    and (
      not coalesce(p_missing_ready_evidence, false)
      or not exists (
        select 1
        from public.evidence_files as evidence
        where evidence.user_id = achievement.user_id
          and evidence.achievement_id = achievement.id
          and evidence.status = 'ready'
      )
    );
$$;

create or replace function public.filter_projects(p_outcome_missing boolean default false)
returns setof public.projects
language sql
stable
security invoker
set search_path = ''
as $$
  select project.*
  from public.projects as project
  where project.user_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = project.user_id
        and profile.deleting_at is null
    )
    and (
      not coalesce(p_outcome_missing, false)
      or nullif(pg_catalog.btrim(project.outcome), '') is null
    );
$$;

create or replace function public.get_dashboard_summary()
returns table (
  confirmed_achievement_count integer,
  active_project_count integer,
  demonstrated_skill_count integer,
  missing_evidence_count integer,
  completed_missing_outcome_count integer,
  has_career_records boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with actor as (
    select profile.id
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.deleting_at is null
  )
  select
    (
      select pg_catalog.count(*)::integer
      from public.achievements as achievement
      where achievement.user_id = actor.id
        and achievement.status = 'confirmed'
    ),
    (
      select pg_catalog.count(*)::integer
      from public.projects as project
      where project.user_id = actor.id
        and project.status = 'active'
    ),
    (
      select pg_catalog.count(distinct join_row.skill_id)::integer
      from public.achievement_skills as join_row
      join public.achievements as achievement
        on achievement.user_id = join_row.user_id
       and achievement.id = join_row.achievement_id
      where join_row.user_id = actor.id
        and achievement.status = 'confirmed'
    ),
    (
      select pg_catalog.count(*)::integer
      from public.filter_achievements(null, true) as achievement
      where achievement.status = 'confirmed'
    ),
    (
      select pg_catalog.count(*)::integer
      from public.filter_projects(true) as project
      where project.status = 'completed'
    ),
    (
      exists (select 1 from public.activities as activity where activity.user_id = actor.id)
      or exists (select 1 from public.achievements as achievement where achievement.user_id = actor.id)
      or exists (select 1 from public.projects as project where project.user_id = actor.id)
      or exists (select 1 from public.experiences as experience where experience.user_id = actor.id)
      or exists (select 1 from public.education as education where education.user_id = actor.id)
    )
  from actor;
$$;

create or replace function public.list_demonstrated_skills(p_limit integer default 12)
returns table (skill_id uuid, name text, confirmed_achievement_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select skill.id, skill.name, pg_catalog.count(distinct achievement.id)::integer
  from public.skills as skill
  join public.achievement_skills as join_row
    on join_row.user_id = skill.user_id
   and join_row.skill_id = skill.id
  join public.achievements as achievement
    on achievement.user_id = join_row.user_id
   and achievement.id = join_row.achievement_id
   and achievement.status = 'confirmed'
  where skill.user_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = skill.user_id
        and profile.deleting_at is null
    )
  group by skill.id, skill.name, skill.normalized_name
  order by 3 desc, skill.normalized_name asc, skill.id asc
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

revoke all on function public.filter_achievements(uuid, boolean) from public, anon;
revoke all on function public.filter_projects(boolean) from public, anon;
revoke all on function public.get_dashboard_summary() from public, anon;
revoke all on function public.list_demonstrated_skills(integer) from public, anon;

grant execute on function public.filter_achievements(uuid, boolean) to authenticated, service_role;
grant execute on function public.filter_projects(boolean) to authenticated, service_role;
grant execute on function public.get_dashboard_summary() to authenticated, service_role;
grant execute on function public.list_demonstrated_skills(integer) to authenticated, service_role;

comment on function public.filter_achievements(uuid, boolean) is
  'T12: caller-owned Achievements optionally limited to one skill and/or no direct ready evidence. RLS applies.';
comment on function public.filter_projects(boolean) is
  'T12: caller-owned Projects optionally limited to blank outcome. RLS applies.';
comment on function public.get_dashboard_summary() is
  'T12: factual Dashboard counts; zero rows when the caller profile is missing or deleting.';
comment on function public.list_demonstrated_skills(integer) is
  'T12: skills with distinct confirmed Achievement counts, highest first; no proficiency.';

commit;

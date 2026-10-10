import { sql, sqlAsUser } from "./perf-support";

/** The dataset of plan section 6. Counts are compared exactly (cv_items is a lower bound: parents come along). */
export const EXPECTED_DATASET = {
  activities: 1000,
  activities_with_project: 300,
  achievements: 200,
  achievements_confirmed: 150,
  achievements_draft: 40,
  achievements_dismissed: 10,
  achievements_derived: 120,
  achievements_with_metrics: 60,
  projects: 50,
  projects_linked_experience: 30,
  projects_planned: 10,
  projects_active: 20,
  projects_completed: 20,
  projects_completed_missing_outcome: 5,
  experiences: 5,
  education: 2,
  certifications: 3,
  skills: 40,
  evidence_files: 0,
} as const;

export const MIN_CV_ITEMS = 40;

export type DatasetCounts = Record<keyof typeof EXPECTED_DATASET | "cv_items" | "achievement_skills" | "chat_messages", number>;

export function countDataset(userId: string): DatasetCounts {
  const u = `'${userId}'::uuid`;
  const rows = sql(`
select 'activities|' || count(1) from public.activities where user_id = ${u}
union all select 'activities_with_project|' || count(1) from public.activities where user_id = ${u} and project_id is not null
union all select 'achievements|' || count(1) from public.achievements where user_id = ${u}
union all select 'achievements_confirmed|' || count(1) from public.achievements where user_id = ${u} and status = 'confirmed'
union all select 'achievements_draft|' || count(1) from public.achievements where user_id = ${u} and status = 'draft'
union all select 'achievements_dismissed|' || count(1) from public.achievements where user_id = ${u} and status = 'dismissed'
union all select 'achievements_derived|' || count(1) from public.achievements where user_id = ${u} and activity_id is not null
union all select 'achievements_with_metrics|' || count(1) from public.achievements where user_id = ${u} and metrics <> '[]'::jsonb
union all select 'projects|' || count(1) from public.projects where user_id = ${u}
union all select 'projects_linked_experience|' || count(1) from public.projects where user_id = ${u} and experience_id is not null
union all select 'projects_planned|' || count(1) from public.projects where user_id = ${u} and status = 'planned'
union all select 'projects_active|' || count(1) from public.projects where user_id = ${u} and status = 'active'
union all select 'projects_completed|' || count(1) from public.projects where user_id = ${u} and status = 'completed'
union all select 'projects_completed_missing_outcome|' || count(1) from public.projects where user_id = ${u} and status = 'completed' and nullif(btrim(outcome), '') is null
union all select 'experiences|' || count(1) from public.experiences where user_id = ${u}
union all select 'education|' || count(1) from public.education where user_id = ${u}
union all select 'certifications|' || count(1) from public.certifications where user_id = ${u}
union all select 'skills|' || count(1) from public.skills where user_id = ${u}
union all select 'evidence_files|' || count(1) from public.evidence_files where user_id = ${u}
union all select 'cv_items|' || count(1) from public.cv_items where user_id = ${u}
union all select 'achievement_skills|' || count(1) from public.achievement_skills where user_id = ${u}
union all select 'chat_messages|' || count(1) from public.chat_messages where user_id = ${u};`);
  return Object.fromEntries(rows.split("\n").map((line) => {
    const [key, value] = line.split("|");
    return [key!, Number(value)];
  })) as DatasetCounts;
}

export function datasetMatches(counts: DatasetCounts): boolean {
  return (Object.keys(EXPECTED_DATASET) as (keyof typeof EXPECTED_DATASET)[]).every((key) => counts[key] === EXPECTED_DATASET[key])
    && counts.cv_items >= MIN_CV_ITEMS;
}

// Every row goes through the user RPCs, so triggers and constraints (including the T24 event triggers) run as in production.
// All text is synthetic.

const FOUNDATION = `
do $$
declare
  v_id uuid; i integer;
  v_exp uuid[] := array[]::uuid[];
  v_starts integer[] := array[0, 18, 32, 54, 72];
  v_start date; v_status text; v_pstart date;
begin
  for i in 1..5 loop
    v_start := (date '2018-01-01' + make_interval(months => v_starts[i]))::date;
    select x.id into v_id from public.create_experience_idempotent(
      p_operation_key => gen_random_uuid(), p_organization => 'Organisasi ' || i, p_role_title => 'Peran ' || i,
      p_description => null, p_kind => 'employment', p_start_date => v_start, p_start_precision => 'month',
      p_end_date => case when i = 5 then null else (v_start + make_interval(months => 16))::date end,
      p_end_precision => case when i = 5 then null else 'month' end, p_is_current => (i = 5)) as x;
    v_exp := v_exp || v_id;
  end loop;
  for i in 1..2 loop
    perform public.create_education_idempotent(
      p_operation_key => gen_random_uuid(), p_institution => 'Universitas ' || i, p_qualification => 'S' || i,
      p_field_of_study => 'Informatika', p_description => null,
      p_start_date => (date '2008-01-01' + make_interval(years => (i - 1) * 4))::date, p_start_precision => 'year',
      p_end_date => (date '2012-01-01' + make_interval(years => (i - 1) * 4))::date, p_end_precision => 'year', p_is_current => false);
  end loop;
  for i in 1..3 loop
    perform public.create_certification_idempotent(
      p_operation_key => gen_random_uuid(), p_name => 'Sertifikasi ' || i, p_issuer => 'Lembaga ' || i,
      p_credential_url => null, p_issued_date => (date '2019-01-01' + make_interval(years => i))::date, p_issued_precision => 'year');
  end loop;
  for i in 1..40 loop
    perform public.create_skill_idempotent(gen_random_uuid(), 'Skill ' || lpad(i::text, 2, '0'));
  end loop;
  for i in 1..50 loop
    v_status := case when i <= 10 then 'planned' when i <= 30 then 'active' else 'completed' end;
    v_pstart := (date '2022-01-01' + make_interval(months => i % 24))::date;
    perform public.create_project_idempotent(
      p_operation_key => gen_random_uuid(), p_title => 'Proyek ' || lpad(i::text, 2, '0'), p_description => null,
      p_user_role => 'Kontributor',
      p_outcome => case when v_status = 'planned' then null
                        when v_status = 'active' then case when i % 2 = 0 then 'Hasil ' || i else null end
                        when i <= 35 then null else 'Hasil ' || i end,
      p_status => v_status,
      p_start_date => case when v_status = 'planned' then null else v_pstart end,
      p_start_precision => case when v_status = 'planned' then null else 'month' end,
      p_end_date => case when v_status = 'completed' then (v_pstart + make_interval(months => 3))::date else null end,
      p_end_precision => case when v_status = 'completed' then 'month' else null end,
      p_is_current => (v_status = 'active'),
      p_experience_id => case when i <= 30 then v_exp[((i - 1) % 5) + 1] else null end);
  end loop;
end $$;
`;

const ACTIVITIES = `
do $$
declare
  v_pids uuid[]; v_pexp uuid[]; i integer; v_proj uuid; v_exp uuid; v_mode text;
begin
  select array_agg(p.id order by p.title), array_agg(p.experience_id order by p.title)
    into v_pids, v_pexp from public.projects as p;
  for i in 1..1000 loop
    v_proj := null; v_exp := null;
    if i % 10 < 3 then
      v_proj := v_pids[((i * 7) % 50) + 1];
      v_exp := v_pexp[((i * 7) % 50) + 1];
    end if;
    v_mode := (array['note', 'form', 'chat'])[(i % 3) + 1];
    perform public.create_activity_idempotent(
      p_operation_key => gen_random_uuid(),
      p_raw_text => left(repeat('Aktivitas sintetis ' || i || ' untuk pengukuran performa. ', 60), 200 + (i * 37) % 1800),
      p_occurred_on => (current_date - ((i - 1) * 1080 / 1000))::date,
      p_capture_mode => v_mode, p_role => null, p_scope => null, p_outcome => null,
      p_experience_id => v_exp, p_project_id => v_proj);
  end loop;
end $$;
`;

// 120 derived (every eighth activity), 80 standalone; 150 confirmed, 40 draft, 10 dismissed; 1-3 skills each;
// metrics on exactly the first 60 (all of them confirmed).
const ACHIEVEMENTS = `
do $$
declare
  v_acts uuid[]; v_pids uuid[]; v_exps uuid[]; k integer; n integer;
  v_ach record; v_action text; v_changes jsonb; v_skills jsonb;
begin
  select array_agg(a.id order by a.occurred_on desc, a.id desc) into v_acts from public.activities as a;
  select array_agg(p.id order by p.title) into v_pids from public.projects as p;
  select array_agg(e.id order by e.organization) into v_exps from public.experiences as e;
  for k in 1..200 loop
    if k <= 120 then
      select x.achievement_id, x.revision into v_ach
      from public.create_achievement_idempotent(gen_random_uuid(), v_acts[(k - 1) * 8 + 1], null, null) as x;
    elsif k <= 160 then
      select x.achievement_id, x.revision into v_ach
      from public.create_achievement_idempotent(gen_random_uuid(), null, v_pids[(k % 50) + 1], null) as x;
    elsif k <= 180 then
      select x.achievement_id, x.revision into v_ach
      from public.create_achievement_idempotent(gen_random_uuid(), null, null, v_exps[(k % 5) + 1]) as x;
    else
      select x.achievement_id, x.revision into v_ach
      from public.create_achievement_idempotent(gen_random_uuid(), null, null, null) as x;
    end if;
    v_action := case when k <= 150 then 'confirm' when k <= 190 then 'save_draft' else 'dismiss' end;
    v_changes := case v_action
      when 'dismiss' then '{}'::jsonb
      when 'save_draft' then jsonb_build_object('title', 'Capaian ' || k, 'contribution', 'Kontribusi pada kegiatan ' || k)
      else jsonb_build_object('title', 'Capaian ' || k, 'contribution', 'Kontribusi pada kegiatan ' || k,
                              'outcome', 'Hasil terukur ' || k, 'achieved_on', (current_date - k)::text)
    end;
    if k <= 60 then
      v_changes := v_changes || jsonb_build_object('metrics',
        jsonb_build_array(jsonb_build_object('label', 'Metrik', 'value', 12.5, 'unit', '%')));
    end if;
    n := 1 + (k % 3);
    select jsonb_agg('Skill ' || lpad((((k * 3 + s) % 40) + 1)::text, 2, '0')) into v_skills
    from generate_series(0, n - 1) as s;
    perform public.save_achievement(v_ach.achievement_id, v_ach.revision, v_action, v_changes, v_skills);
  end loop;
end $$;
`;

// 40 selected items across the six sections (parents come along when a child is selected).
const CV = `
do $$
declare
  v_rev integer; v_items integer; r record;
begin
  select x.revision into v_rev from public.ensure_cv_document() as x;
  for r in select e.id from public.experiences as e order by e.id loop
    select x.cv_revision into v_rev from public.select_cv_source(v_rev, 'experience', r.id) as x;
  end loop;
  for r in select e.id from public.education as e order by e.id loop
    select x.cv_revision into v_rev from public.select_cv_source(v_rev, 'education', r.id) as x;
  end loop;
  for r in select c.id from public.certifications as c order by c.id loop
    select x.cv_revision into v_rev from public.select_cv_source(v_rev, 'certification', r.id) as x;
  end loop;
  for r in select s.id from public.skills as s order by s.name limit 10 loop
    select x.cv_revision into v_rev from public.select_cv_source(v_rev, 'skill', r.id) as x;
  end loop;
  for r in select p.id from public.projects as p order by p.title limit 10 loop
    select x.cv_revision into v_rev from public.select_cv_source(v_rev, 'project', r.id) as x;
  end loop;
  for r in select a.id from public.achievements as a where a.status = 'confirmed' order by a.id loop
    select count(1)::integer into v_items from public.cv_items as i;
    exit when v_items >= 40;
    select x.cv_revision into v_rev from public.select_cv_source(v_rev, 'achievement', r.id) as x;
  end loop;
end $$;
`;

export interface SeedResult {
  seeded: boolean;
  seconds: number;
  counts: DatasetCounts;
}

/**
 * Seeds the dataset for one account. Idempotent per account: when the dataset is already complete nothing is written;
 * a partial dataset is refused rather than topped up (remove the account and start again).
 */
export function seedDataset(userId: string): SeedResult {
  const before = countDataset(userId);
  if (datasetMatches(before)) return { seeded: false, seconds: 0, counts: before };
  if (Object.values(before).some((value) => value > 0)) {
    throw new Error("T24 perf seed refused: the account already holds a partial dataset; remove the account first");
  }
  const started = Date.now();
  sqlAsUser(userId, FOUNDATION);
  sqlAsUser(userId, ACTIVITIES);
  sqlAsUser(userId, ACHIEVEMENTS);
  sqlAsUser(userId, CV);
  sql(
    "analyze public.activities, public.achievements, public.achievement_skills, public.projects, public.skills, " +
    "public.experiences, public.education, public.certifications, public.chat_messages, public.cv_items, public.cv_documents, " +
    "public.evidence_files, public.profiles;",
  );
  const counts = countDataset(userId);
  if (!datasetMatches(counts)) throw new Error("T24 perf seed produced a dataset that does not match the plan");
  return { seeded: true, seconds: Math.round((Date.now() - started) / 100) / 10, counts };
}

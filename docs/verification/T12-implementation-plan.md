# Handoff T12 Dashboard dan Timeline — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase berurutan dengan checkbox (`- [ ]`). Gunakan TDD: tulis test gagal → jalankan → implementasi minimal → jalankan ulang → commit. Jangan membuat sub-agent.

- Tanggal: 26 September 2026
- Status saat plan ditulis: **TODO**. T12 belum dimulai.
- Dependensi: T07, T09, dan T11 **DONE** pada acceptance lokal (lihat `docs/IMPLEMENTATION_STATUS.md`).
- Eksekutor: satu agent **GPT-6 Luna**. Semua fase dikerjakan berurutan tanpa delegasi atau paralelisme.
- Reviewer: **Claude**. Gate review read-only wajib setelah Fase 6; checkpoint setelah Fase 2 bersifat opsional.
- Acuan: PRD R03/R08, Flow F06 (serta F03 untuk filter missing evidence), Wireframe S04/S11 (serta S12 untuk deep link), Database Schema §1/§2/§3/§4/§6, IMPLEMENTATION_PLAN.md §1/§3/T12, handoff T11 §11, dan Design.md.

**Goal:** Dashboard S04 menampilkan agregat faktual dengan link ke record yang terfilter. Timeline S11 menurunkan event karier dari record canonical. Keduanya tidak memakai AI, tabel turunan, atau skor.

**Architecture:** Agregat dan filter anti-join dihitung di PostgreSQL melalui fungsi SQL `SECURITY INVOKER` sehingga RLS tetap berlaku. Service TypeScript memakai client sesi pengguna, bukan service role. Timeline adalah fungsi domain murni atas empat sumber canonical yang dimuat server. Dashboard check dan filter list memakai predikat SQL yang sama, sehingga count selalu sama dengan jumlah hasil setelah link dibuka.

**Tech stack:** Next.js App Router, TypeScript strict, Supabase PostgreSQL/RLS, Zod, Vitest (unit dan integration), pgTAP, Playwright + Axe, dan pnpm dari lockfile.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, bagian authoritative `docs/IMPLEMENTATION_STATUS.md`, `docs/IMPLEMENTATION_PLAN.md` §1/§3/T12, serta `docs/verification/T11-implementation-plan.md` §11. Ekstrak R03/R08 dari PRD, F06 dari User Flow, S04/S11 dari Wireframe, dan Database Schema §1/§6 dari DOCX dengan alat ekstraksi dokumen. Jangan menebak isi DOCX dari nama file.

Kutipan sumber yang mengikat (parafrase ringkas):

- **R03:** tampilkan recent activities, current projects, jumlah confirmed achievement, demonstrated skills, dan actionable completeness checks. Setiap item membuka sumbernya.
- **S04:** count harus nyata dan menaut ke record terfilter. Recent activities memakai `occurred_on`, bukan waktu pembuatan. Skill menunjukkan jumlah distinct confirmed achievement. Completed project dengan outcome kosong serta confirmed achievement tanpa direct ready evidence menjadi actionable check. Akun kosong menampilkan *Add your first activity* dan *Import CV*. Loading memakai skeleton dan kegagalan menampilkan Retry. Tidak ada streak, proficiency, readiness percentage, job matching, atau inferensi career gap.
- **R08/F06/S11:** timeline reverse chronological per tahun dengan konteks employer/role. Event mencakup experience periods, education periods, project starts, dan confirmed achievements. Filter tersedia per type atau project. Precision tanggal menentukan label; unknown berada di bawah pada *Date not set*; ongoing ditampilkan sebagai *Present*. Overlap employment tetap tampak dan standalone project/achievement tampil tanpa employer heading. Semua event deep link ke record canonical. Tidak ada salinan timeline yang dapat diedit, promotion/gap/skill level/readiness yang diinferensikan, atau tabel timeline (DB §1).

Selama pekerjaan, pertahankan perubahan lokal pengguna. Satu GPT-6 Luna menjadi satu-satunya penulis perubahan T12. Jangan menandai T12 DONE atau menulis bagian authoritative `docs/IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** berisi tujuan, file berubah, command dan hasil aktualnya (exit code/angka test), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya.

## 1. Acceptance inti T12

T12 dianggap lulus jika semua poin berikut dibuktikan dengan hasil lokal nyata:

1. **Count cocok dengan fixture.** Setiap angka Dashboard sama dengan fixture §7 dan sama dengan jumlah row yang muncul setelah link check/count dibuka, termasuk semua halaman pagination.
2. **Setiap item membuka sumbernya.** Recent activity → `/activity/<id>`, current project → `/projects/<id>`, skill → Achievement list terfilter, check → list terfilter, dan setiap event timeline → editor canonical.
3. **Semantik missing evidence tepat.** Achievement confirmed yang memiliki **nol** direct evidence berstatus `ready`. Status uploading/scanning/failed/deleting tidak dihitung, dan evidence Activity/Project tidak diwariskan.
4. **Completed missing outcome tepat.** Project berstatus `completed` dengan `outcome` NULL atau blank setelah trim.
5. **Empty dashboard jujur.** Akun tanpa record karier menampilkan CTA manual yang berfungsi dan CTA Import yang ditandai belum tersedia, tanpa link yang langsung redirect kembali ke dashboard (lihat §2.2).
6. **Timeline benar.** Pengelompokan per tahun berurutan descending; event unknown berada di grup *Date not set* paling bawah; overlap employment tetap menjadi dua event; *Present* muncul untuk current; label sesuai precision; draft/dismissed achievement tidak tampil; filter type/project bekerja lewat URL.
7. **Tanpa kebocoran owner.** Akun kedua tidak memengaruhi count/list/timeline. Project filter milik akun lain menghasilkan hasil kosong tanpa existence leak.
8. **Tanpa fitur terlarang.** Tidak ada streak, readiness, proficiency, persentase, CV check (CV check milik T20), inferensi gap/promotion, atau AI.
9. **Aksesibel dan responsif.** Kontrol dapat dioperasikan dengan keyboard dan focus terlihat. Status tidak hanya dibedakan dengan warna. Axe WCAG 2.2 A/AA harus bersih, tanpa horizontal overflow pada 360 px dan 1440 px, light dan dark.

Gate M2 baru dapat ditinjau setelah T12 DONE. Integration review gate dilakukan reviewer, bukan eksekutor.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration forward-only berisi empat fungsi read-only (§3.1) dan pgTAP.
- Filter list baru:
  - Achievements `evidence=missing` dan `skill=<uuid>`.
  - Projects `outcome=missing`.
  - Timeline `type` dan `project`.
- Semua filter baru diregistrasikan di reader URL, safe-return allowlist, service schema, dan UI list.
- Dashboard service + UI S04, termasuk loading, empty, dan error/Retry.
- Timeline domain builder + service + UI S11, termasuk loading, empty, error/Retry, filter, dan notice truncated.
- Deep link experience/education ke S12: `/settings/profile?record=<uuid>#experience-<uuid>` atau `#education-<uuid>`. Record target otomatis terbuka.
- Dictionary en/id, CSS token-based, serta test unit, integration, pgTAP, dan E2E.

### 2.2 Keputusan implementasi

1. **Fungsi SQL `SECURITY INVOKER`, bukan definer.** Tabel sumber sudah memiliki RLS `select` owner-only untuk `authenticated`, termasuk `evidence_files` (T10). Invoker menjaga RLS tetap aktif. Fungsi juga memfilter `user_id = (select auth.uid())` agar index terpakai dan mengembalikan kosong bila profil `deleting_at IS NOT NULL`. Grant execute diberikan hanya kepada `authenticated` dan `service_role`.
2. **Satu predikat untuk count dan list.** `get_dashboard_summary` menghitung missing evidence dan missing outcome melalui `filter_achievements`/`filter_projects` yang sama dengan list terfilter. Dengan demikian count selalu identik dengan hasil link.
3. **Filter bersifat ortogonal.** `evidence=missing` berarti "tanpa direct ready evidence" untuk status apa pun. Dashboard check menambahkan `status=confirmed`. `outcome=missing` berarti outcome kosong untuk status apa pun, dan dashboard menambahkan `status=completed`.
4. **Recent activity:** 5 teratas berdasarkan `occurred_on DESC, id DESC`. **Current projects:** 5 teratas dengan `status='active'`, berdasarkan `updated_at DESC, id DESC`. **Skills:** maksimal 12 teratas berdasarkan distinct confirmed count DESC, `normalized_name ASC`, `id ASC`; skill dengan count 0 tidak tampil. Total `demonstrated_skill_count` tetap dihitung penuh.
5. **Stat tile:** *Confirmed achievements* → `/achievements?status=confirmed`; *Current projects* → `/projects?status=active`; *Demonstrated skills* menjadi heading daftar skill tanpa link agregat, karena tidak ada list yang memuat tepat himpunan tersebut. Setiap chip skill menaut ke `/achievements?status=confirmed&skill=<id>`.
6. **Check dengan count 0 tidak dirender sebagai tugas.** Bila semua check bernilai 0, tampilkan teks status "No checks need attention". CV review check tidak dirender sama sekali karena merupakan bagian T20.
7. **Empty dashboard:** `has_career_records = false` bila akun tidak memiliki activity, achievement, project, experience, maupun education. CTA utama *Add your first activity* → `/activity/new`. CTA *Import CV* dirender sebagai kontrol disabled dengan teks bahwa import belum tersedia, memakai pola `onboarding.importUnavailable`. Alasannya, `/onboarding/import` me-redirect user yang sudah onboarding kembali ke `/dashboard` dan import baru tersedia pada T15–T17. Tambahkan juga link sekunder *Add career history* → `/settings/profile`.
8. **Timeline anchor:** experience/education/project memakai `start_date`; achievement memakai `achieved_on`. Anchor NULL masuk grup *Date not set*, tetapi label range tetap menampilkan bagian yang diketahui. Urutan dalam tahun: tanggal anchor DESC, precision (day > month > year), type (`achievement`, `project`, `experience`, `education`), lalu `id` ASC. Urutan grup undated: type, title (`localeCompare` dengan locale `en`), lalu `id`. Tahun dengan precision `year` disimpan sebagai 1 Januari sehingga muncul di akhir tahunnya. Perilaku ini benar karena hanya tahun yang diketahui.
9. **Timeline tidak dipaginasi.** Setiap sumber dimuat dengan `limit(TIMELINE_SOURCE_LIMIT + 1)`, dengan `TIMELINE_SOURCE_LIMIT = 500`. Bila ada sumber yang melebihi limit, potong ke 500 berdasarkan urutan tanggal DESC, set `truncated: true`, lalu tampilkan notice bahwa item lama mungkin tidak tampil. Jangan mengandalkan batas `max_rows` PostgREST secara diam-diam.
10. **Filter project timeline:** hanya project start event dari project tersebut dan confirmed achievement dengan `project_id` sama. Activity tidak masuk timeline. Project yang tidak ditemukan pada data owner menghasilkan grup kosong dengan pesan empty filter, bukan error yang menyatakan record ada atau tidak.
11. **Tanpa `returnTo` dari Timeline/Dashboard ke detail.** Link menuju URL canonical dan tombol back detail tetap memakai fallback list yang sudah ada. Perluasan `nestedTargetAllowed` berada di luar scope.
12. **Nomor decision.** Pakai `docs/decisions/0018-t12-dashboard-timeline.md`; `0017` dicadangkan untuk decision T11. Jika 0017 belum ada, catat hal itu sebagai temuan pada receipt dan jangan membuatnya.

### 2.3 Di luar scope

CV freshness/review check (T20), AI insight atau coaching, global search, library evidence, streak, readiness, proficiency, inferensi gap, chart/grafik, export timeline, timeline yang dapat diedit, pagination timeline, `returnTo` baru, perubahan skema tabel, dan perubahan perilaku T07–T11 di luar penambahan filter.

## 3. Kontrak teknis

### 3.1 Migration `supabase/migrations/20260927090000_t12_dashboard_timeline.sql`

Timestamp harus lebih besar daripada migration terakhir `20260926100000_t11_evidence_lifecycle.sql`. Migration bersifat forward-only dan tidak mengubah tabel.

```sql
-- T12 Dashboard and Timeline read models. Read-only, SECURITY INVOKER: caller RLS applies.

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
  select a.*
  from public.achievements a
  where a.user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = a.user_id and p.deleting_at is null
    )
    and (
      p_skill_id is null
      or exists (
        select 1 from public.achievement_skills j
        where j.user_id = a.user_id and j.achievement_id = a.id and j.skill_id = p_skill_id
      )
    )
    and (
      not coalesce(p_missing_ready_evidence, false)
      or not exists (
        select 1 from public.evidence_files e
        where e.user_id = a.user_id and e.achievement_id = a.id and e.status = 'ready'
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
  select p.*
  from public.projects p
  where p.user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles pr
      where pr.id = p.user_id and pr.deleting_at is null
    )
    and (
      not coalesce(p_outcome_missing, false)
      or nullif(pg_catalog.btrim(p.outcome), '') is null
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
    select p.id from public.profiles p
    where p.id = (select auth.uid()) and p.deleting_at is null
  )
  select
    (select count(*)::integer from public.achievements a
      where a.user_id = actor.id and a.status = 'confirmed'),
    (select count(*)::integer from public.projects p
      where p.user_id = actor.id and p.status = 'active'),
    (select count(distinct j.skill_id)::integer
      from public.achievement_skills j
      join public.achievements a on a.user_id = j.user_id and a.id = j.achievement_id
      where j.user_id = actor.id and a.status = 'confirmed'),
    (select count(*)::integer from public.filter_achievements(null, true) f
      where f.status = 'confirmed'),
    (select count(*)::integer from public.filter_projects(true) f
      where f.status = 'completed'),
    (exists (select 1 from public.activities x where x.user_id = actor.id)
      or exists (select 1 from public.achievements x where x.user_id = actor.id)
      or exists (select 1 from public.projects x where x.user_id = actor.id)
      or exists (select 1 from public.experiences x where x.user_id = actor.id)
      or exists (select 1 from public.education x where x.user_id = actor.id))
  from actor;
$$;

create or replace function public.list_demonstrated_skills(p_limit integer default 12)
returns table (skill_id uuid, name text, confirmed_achievement_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.name, count(distinct a.id)::integer
  from public.skills s
  join public.achievement_skills j on j.user_id = s.user_id and j.skill_id = s.id
  join public.achievements a
    on a.user_id = j.user_id and a.id = j.achievement_id and a.status = 'confirmed'
  where s.user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = s.user_id and p.deleting_at is null
    )
  group by s.id, s.name, s.normalized_name
  order by 3 desc, s.normalized_name asc, s.id asc
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
```

Catatan untuk eksekutor:

- Jika `supabase db lint` melaporkan masalah pada `set search_path = ''` atau kolom tidak ter-qualify, perbaiki dengan meng-qualify identifier. Jangan beralih ke `security definer`.
- Sebelum menulis SQL, verifikasi bahwa `profiles` memiliki policy `select` owner untuk `authenticated`. Jika tidak ada, **stop** dan laporkan (§9).
- Cek apakah index `achievement_skills (user_id, achievement_id)` sudah ada melalui unique constraint `UNIQUE(user_id, achievement_id, skill_id)`. Jangan menambah index tanpa bukti query plan; performa akan diukur pada T24.

### 3.2 Domain dan route contracts

**`src/domain/dashboard/contracts.ts`** (baru):

```ts
import type { ActivityRow } from "@/domain/activity/contracts";
import type { ProjectRow } from "@/domain/database-types";

export const DASHBOARD_RECENT_LIMIT = 5;
export const DASHBOARD_SKILL_LIMIT = 12;

export interface DashboardSummary {
  confirmedAchievementCount: number;
  activeProjectCount: number;
  demonstratedSkillCount: number;
  missingEvidenceCount: number;
  completedMissingOutcomeCount: number;
  hasCareerRecords: boolean;
}

export interface DashboardSkill { id: string; name: string; confirmedAchievementCount: number }

export interface DashboardData {
  summary: DashboardSummary;
  recentActivities: Pick<ActivityRow, "id" | "raw_text" | "occurred_on">[];
  activeProjects: Pick<ProjectRow, "id" | "title" | "updated_at">[];
  skills: DashboardSkill[];
}
```

**`src/domain/dashboard/links.ts`** (baru). Semua link dibangun dengan helper list yang sudah ada agar link dan reader list tidak menyimpang.

```ts
import { achievementListHref, EMPTY_ACHIEVEMENT_FILTERS } from "@/domain/routes/achievement-filters";
import { projectListHref } from "@/domain/routes/project-filters";

export const dashboardLinks = {
  confirmedAchievements: () => achievementListHref({ ...EMPTY_ACHIEVEMENT_FILTERS, status: "confirmed" }),
  missingEvidence: () => achievementListHref({ ...EMPTY_ACHIEVEMENT_FILTERS, status: "confirmed", evidence: "missing" }),
  skill: (skillId: string) => achievementListHref({ ...EMPTY_ACHIEVEMENT_FILTERS, status: "confirmed", skill: skillId }),
  activeProjects: () => projectListHref({ status: "active", outcome: "" }),
  missingOutcome: () => projectListHref({ status: "completed", outcome: "missing" }),
  activity: (id: string) => `/activity/${id}`,
  project: (id: string) => `/projects/${id}`,
  allActivity: () => "/activity",
  newActivity: () => "/activity/new",
  profile: () => "/settings/profile",
} as const;
```

**`src/domain/routes/achievement-filters.ts`** (ubah):

- `achievementFilterKeys = ["status", "project", "evidence", "skill"] as const`.
- `AchievementFilters` bertambah `evidence: "missing" | ""` dan `skill: string` (UUID atau `""`).
- Ekspor `EMPTY_ACHIEVEMENT_FILTERS: AchievementFilters = { status: "", project: "", evidence: "", skill: "" }`.
- `readAchievementQuery` menerima `evidence` hanya bila nilainya tepat `missing`, dan `skill` hanya bila berupa UUID. Nilai duplikat atau tidak valid menghasilkan `errors.evidence`/`errors.skill = "invalid"` dan filter dikosongkan, mengikuti pola `project`.
- `achievementListHref` menulis parameter dengan urutan `status`, `project`, `evidence`, `skill`, `cursor` dan tidak menulis nilai kosong.
- Perbarui seluruh caller yang membangun `AchievementFilters` literal, termasuk `StatusNav` di `src/app/(workspace)/achievements/page.tsx` dan `achievement-list.tsx`. Caller harus melakukan spread terhadap filter aktif agar pindah tab status tetap mempertahankan `evidence`/`skill`. Biarkan `typecheck` menunjukkan caller yang belum diperbarui.

**`src/domain/routes/project-filters.ts`** (ubah):

- `ProjectFilters` bertambah `outcome: "missing" | ""`.
- `known` bertambah `outcome`. Nilai selain `missing` menghasilkan `errors.outcome = "invalid"`.
- `projectFilterQuery` menulis parameter dengan urutan `status`, `outcome`, `cursor`.
- Perbarui caller `projectListHref({ status })` menjadi `{ status, outcome }`.

**`src/domain/routes/timeline-filters.ts`** (baru):

```ts
import * as z from "zod";

import { TIMELINE_EVENT_TYPES, type TimelineEventType } from "@/domain/timeline/timeline";

export interface TimelineFilters { type: TimelineEventType | ""; project: string }
export interface TimelineQuery {
  filters: TimelineFilters;
  errors: Partial<Record<"type" | "project", "invalid">>;
  isValid: boolean;
}

export function readTimelineQuery(params: Record<string, string | string[] | undefined>): TimelineQuery;
export function timelineListHref(filters: TimelineFilters): string; // "/timeline" atau "/timeline?type=..&project=.."
```

Aturan: satu nilai per key, `type` harus termasuk allowlist, `project` harus UUID, dan unknown key diabaikan seperti pada `readActivityQuery`.

**`src/domain/routes/safe-return.ts`** (ubah):

- `QUERY_KEYS["/achievements"]` menjadi `status, project, evidence, skill, cursor`. Validasi `evidence === "missing"` dan `skill` UUID.
- `QUERY_KEYS["/projects"]` menjadi `status, outcome, cursor`. Validasi `outcome === "missing"`.
- Tambahkan `"/timeline": new Set(["type", "project"])` dengan validasi type allowlist dan UUID.
- Tambahkan `record` pada `/settings/profile` dengan validasi UUID.

**`src/domain/timeline/timeline.ts`** (baru, murni, tanpa import server):

```ts
import type { AchievementRow } from "@/domain/achievement/contracts";
import type { EducationRow, ExperienceRow, ProjectRow } from "@/domain/database-types";

export const TIMELINE_EVENT_TYPES = ["experience", "education", "project", "achievement"] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];
export type TimelinePrecision = "year" | "month" | "day";
export const TIMELINE_SOURCE_LIMIT = 500;

export interface TimelineDate { date: string; precision: TimelinePrecision }

export interface TimelineEvent {
  type: TimelineEventType;
  id: string;
  title: string;            // role_title | qualification | project title | achievement title
  context: string | null;   // organization | institution | "role · org" | project title; null = standalone
  anchor: TimelineDate | null;
  start: TimelineDate | null;
  end: TimelineDate | null;
  isCurrent: boolean;
  projectId: string | null; // untuk filter project
  href: string;
}

export interface TimelineGroup { key: string; year: number | null; events: TimelineEvent[] } // key "2025" | "undated"

export interface TimelineSources {
  experiences: Pick<ExperienceRow, "id" | "organization" | "role_title" | "start_date" | "start_precision" | "end_date" | "end_precision" | "is_current">[];
  education: Pick<EducationRow, "id" | "institution" | "qualification" | "start_date" | "start_precision" | "end_date" | "end_precision" | "is_current">[];
  projects: Pick<ProjectRow, "id" | "title" | "experience_id" | "start_date" | "start_precision" | "end_date" | "end_precision" | "is_current">[];
  achievements: Pick<AchievementRow, "id" | "title" | "status" | "achieved_on" | "project_id" | "experience_id">[];
}

export function timelineHref(type: TimelineEventType, id: string): string;
// experience → `/settings/profile?record=${id}#experience-${id}`
// education  → `/settings/profile?record=${id}#education-${id}`
// project    → `/projects/${id}`
// achievement→ `/achievements/${id}`

export function buildTimelineEvents(sources: TimelineSources): TimelineEvent[];
export function filterTimelineEvents(events: TimelineEvent[], filters: { type: TimelineEventType | ""; project: string }): TimelineEvent[];
export function groupTimelineEvents(events: TimelineEvent[]): TimelineGroup[];
```

Aturan builder:

- Achievement berstatus selain `confirmed` atau tanpa `achieved_on` tidak dibuat menjadi event, sebagai defense in depth walaupun query sudah memfilter.
- `context` project: label experience `role_title · organization` bila `experience_id` ada di sumber, dan `null` bila standalone.
- `context` achievement: judul project bila `project_id` ada di sumber. Jika tidak ada, gunakan label experience. Jika keduanya tidak ada, gunakan `null`.
- `projectId`: project → `id`, achievement → `project_id`, dan lainnya → `null`.
- Filter `project` hanya menyisakan event dengan `projectId === project` sehingga experience/education otomatis tersaring.
- Timeline bukan tempat untuk inferensi promotion atau gap. Jangan menggabungkan event yang overlap.

Nama sengaja dibedakan: `timelineHref(type, id)` di `timeline.ts` menghasilkan deep link event, sedangkan `timelineListHref(filters)` di `timeline-filters.ts` menghasilkan URL halaman Timeline.

### 3.3 Services

**`src/features/dashboard/dashboard-service.ts`** (baru): `createDashboardService(client)` dengan `getDashboard(): Promise<DashboardData>`.

- Ambil `requireActorId()` dengan pola yang sama seperti `createAchievementService`: `auth.getUser()`, lalu bedakan `UNAUTHENTICATED` dan `UNAVAILABLE`.
- Jalankan empat query secara paralel:
  1. `client.rpc("get_dashboard_summary")`
  2. `client.rpc("list_demonstrated_skills", { p_limit: DASHBOARD_SKILL_LIMIT })`
  3. `client.from("activities").select("id, raw_text, occurred_on").eq("user_id", actorId).order("occurred_on", { ascending: false }).order("id", { ascending: false }).limit(DASHBOARD_RECENT_LIMIT)`
  4. `client.from("projects").select("id, title, updated_at").eq("user_id", actorId).eq("status", "active").order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(DASHBOARD_RECENT_LIMIT)`
- Summary yang mengembalikan nol row dipetakan ke `UNAUTHENTICATED`. Error query dipetakan ke `UNAVAILABLE`.
- Validasi setiap row RPC dengan Zod strict: integer ≥ 0 dan boolean.
- Tambahkan `DashboardServiceError` dengan `code: "UNAUTHENTICATED" | "UNAVAILABLE"`, `messageKey`, dan `correlationId: randomUUID()`, mengikuti bentuk `AchievementServiceError`. Jangan mencatat `raw_text`.
- Jangan memakai cache. Halaman harus membaca state terbaru pada setiap request karena DB §6 menyatakan bahwa Dashboard membaca confirmed state secara langsung.

**`src/features/timeline/timeline-service.ts`** (baru): `createTimelineService(client)` dengan `getTimeline(filters: TimelineFilters): Promise<{ groups: TimelineGroup[]; truncated: boolean; projectOptions: { id: string; title: string }[] }>`.

- Muat empat sumber secara paralel dengan `.eq("user_id", actorId)` dan `.limit(TIMELINE_SOURCE_LIMIT + 1)`:
  - Experiences dan education diurutkan `start_date DESC NULLS LAST, id`.
  - Projects diurutkan `start_date DESC NULLS LAST, id`.
  - Achievements memakai `.eq("status", "confirmed")` dan diurutkan `achieved_on DESC, id DESC`.
- `truncated = true` bila ada sumber yang mengembalikan lebih dari limit; potong setiap sumber ke `TIMELINE_SOURCE_LIMIT`.
- Hasil diproses dengan `groupTimelineEvents(filterTimelineEvents(buildTimelineEvents(sources), filters))`.
- `projectOptions` berisi semua project yang dimuat, diurutkan berdasarkan title.
- Pola error sama dengan Dashboard melalui `TimelineServiceError`.

**`src/features/achievement/schemas.ts` dan `achievement-service.ts`** (ubah):

- `achievementListFilterSchema` bertambah `skillId: z.uuid().optional()` dan `missingEvidence: z.literal(true).optional()`, tetap `.strict()`.
- Pada `listAchievements`, bila `skillId` atau `missingEvidence` ada, sumber query menjadi:

```ts
const base = parsed.data.skillId || parsed.data.missingEvidence
  ? client.rpc("filter_achievements", {
      p_skill_id: parsed.data.skillId ?? null,
      p_missing_ready_evidence: parsed.data.missingEvidence ?? false,
    }).select("*")
  : client.from("achievements").select("*").eq("user_id", actorId);
```

  Setelah itu gunakan rantai order, `status`, `projectId`, cursor, dan `limit` yang sama persis dengan kode saat ini. Ekstrak rantai tersebut menjadi helper lokal `applyAchievementListQuery(query, parsed.data)` agar kedua jalur memakai kode yang sama. Jika typing generic supabase-js menyulitkan helper, gunakan dua cabang dengan rantai identik dan test yang membuktikan kesamaannya. Jangan memakai `any`.
- Tetap filter `user_id` pada jalur RPC dengan `.eq("user_id", actorId)` sebagai defense in depth.
- Halaman `/achievements` meneruskan `skillId`/`missingEvidence` dari query URL. Jika filter aktif, tampilkan chip keterangan seperti "Missing direct evidence" atau "Skill: <name>" beserta link *Clear*. Nama skill diambil dari `skills` milik owner; jika tidak ditemukan, gunakan label generik tanpa menampilkan ID.

**`src/features/project/schemas.ts` dan `project-service.ts`** (ubah):

- `projectListFilterSchema` bertambah `outcomeMissing: z.literal(true).optional()`.
- `listProjects` memakai `client.rpc("filter_projects", { p_outcome_missing: true }).select("*").eq("user_id", actorId)` bila filter aktif. Selain itu gunakan `from("projects")`, kemudian terapkan rantai order/status/cursor/limit yang sama.
- Halaman `/projects` meneruskan filter, menampilkan chip "Outcome missing" dengan link *Clear*, dan mempertahankan `outcome` saat tab status berpindah.

Setelah migration diterapkan, jalankan `pnpm db:types` dan simpan output ke `src/server/supabase/database.types.ts` sebelum menulis kode service yang memanggil RPC baru.

### 3.4 S12 deep link

- `src/app/(workspace)/settings/profile/page.tsx` menerima `searchParams`, membaca `record` (UUID valid; selain itu diabaikan), lalu meneruskan `openRecordId` melalui `ProfileWorkspace` → `FoundationEditors` → `FoundationSection` → `RecordEditor`.
- `RecordEditor` merender `<details id={`${kind}-${record.id}`} open={record.id === openRecordId || undefined} ...>`. Tambahkan `scroll-margin-top` via CSS agar anchor tidak tertutup header.
- Jangan mengubah perilaku form, draft, conflict, atau delete S12.

## 4. UI

### 4.1 S04 `/dashboard`

File: `src/app/(workspace)/dashboard/page.tsx` (ubah), `src/app/(workspace)/dashboard/loading.tsx` (baru), `src/features/dashboard/dashboard-view.tsx` (baru, server component), dan `src/features/dashboard/dashboard-issue.tsx` (baru, pola `AchievementPageIssue`).

- Pertahankan `<OnboardingDraftCleanup ownerId=... />` dan guard auth/onboarding yang ada. Gunakan `requireCompletedWorkspace("/dashboard")` bila hasilnya setara.
- Hierarki halaman:
  1. Judul dengan satu aksi utama, yaitu Quick log yang sudah ada di frame. Jangan menambahkan tombol primer kedua.
  2. Stat row berisi *Confirmed achievements* (angka + link), *Current projects* (angka + link), dan *Demonstrated skills* (angka).
  3. *Needs attention* berisi check dengan count > 0, masing-masing berupa link teks yang menyertakan angka, misalnya "3 confirmed achievements have no ready evidence". Jika tidak ada check, tampilkan pesan status.
  4. *Recent activity* berisi 5 baris compact dengan tanggal `formatActivityDate`, excerpt `activityExcerpt(raw_text, 140)`, link detail, dan link *View all activity*.
  5. *Current projects* berisi maksimal 5 link detail dan *View all current projects* bila ada.
  6. *Demonstrated skills* berisi chip link "TypeScript · 2" dengan `aria-label` lengkap, misalnya "TypeScript, 2 confirmed achievements".
- Empty (`!hasCareerRecords`) memakai `EmptyState` dengan CTA *Add your first activity* (`button-primary`), *Import CV* disabled beserta keterangan, dan link sekunder *Add career history*.
- Error memakai `DashboardIssue` dengan Retry `href="/dashboard"`, correlation ID, dan link Sign in bila `UNAUTHENTICATED`.
- Loading menampilkan skeleton untuk stat row dan dua daftar dengan `aria-busy="true"`.
- Semua angka memakai `Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US")`. Plural dibuat dengan key berbeda untuk count 1 dan lainnya pada en; id boleh memakai satu bentuk.

### 4.2 S11 `/timeline`

File: `src/app/(workspace)/timeline/page.tsx` (ganti placeholder), `src/app/(workspace)/timeline/loading.tsx` (baru), dan `src/features/timeline/timeline-view.tsx` (baru, server component).

- Header berisi judul *Timeline* dan deskripsi singkat. Timeline tidak memiliki aksi primer karena hanya menampilkan data; Quick log tetap tersedia di frame.
- Filter adalah GET `<form action="/timeline">` tanpa JavaScript, berisi select *Type* (All/Experience/Education/Project/Achievement), select *Project* (All + `projectOptions`), dan tombol *Apply*, serta link *Clear* bila ada filter. Query invalid menampilkan peringatan dan link Clear seperti halaman Achievements.
- Struktur konten adalah `<ol>` grup tahun. Setiap grup memiliki `<h2>` berisi tahun atau *Date not set*, lalu `<ol>` event. Setiap event memuat:
  - badge type teks (bukan warna saja);
  - judul sebagai link ke `event.href`;
  - `context`, atau *Independent* bila null untuk project/achievement;
  - label tanggal.
- Label periode memakai `formatProjectDateRange(..., notSetLabel, presentLabel)` dari `src/domain/project/project-display.ts`. Jangan menduplikasi formatter. Label achievement memakai `formatActivityDate(achieved_on, locale)`. Project menampilkan label *Started <tanggal>* dan tidak menampilkan end sebagai event terpisah.
- Overlap tetap tampil sebagai event terpisah. Timeline tidak memuat garis gap atau teks promosi.
- Empty tanpa filter menampilkan pesan dengan link *Add career history* (`/settings/profile`) dan *Log activity* (`/activity/new`). Empty dengan filter menampilkan "No events match these filters" dan link Clear.
- Bila `truncated`, tampilkan notice `role="status"`.
- Error memakai `DashboardIssue` dengan retry ke URL timeline saat ini (`timelineListHref(filters)`).

### 4.3 Copy, CSS, dan aksesibilitas

- Tambahkan key `dashboard.*` dan `timeline.*` untuk **en dan id** di `src/i18n/messages.ts`. Hapus/ganti key `dashboard.description` hanya bila tidak dipakai lagi dan pastikan grep kosong. Contoh key: `dashboard.confirmedAchievements`, `dashboard.currentProjects`, `dashboard.demonstratedSkills`, `dashboard.needsAttention`, `dashboard.noChecks`, `dashboard.checkMissingEvidence`, `dashboard.checkMissingOutcome`, `dashboard.recentActivity`, `dashboard.viewAllActivity`, `dashboard.viewAllProjects`, `dashboard.emptyTitle`, `dashboard.emptyDescription`, `dashboard.addFirstActivity`, `dashboard.importCv`, `dashboard.importUnavailable`, `dashboard.addCareerHistory`, `dashboard.unavailableTitle`, `dashboard.retry`, `dashboard.skillCount`, `timeline.description`, `timeline.type`, `timeline.project`, `timeline.allTypes`, `timeline.allProjects`, `timeline.apply`, `timeline.clear`, `timeline.dateNotSet`, `timeline.present`, `timeline.started`, `timeline.independent`, `timeline.type.experience|education|project|achievement`, `timeline.empty`, `timeline.emptyFiltered`, `timeline.truncated`, `timeline.invalidFilters`, `achievement.filterMissingEvidence`, `achievement.filterSkill`, dan `project.filterOutcomeMissing`.
- Copy tidak boleh memuat kata streak, score, readiness, level, gap, atau percentage.
- Tambahkan CSS `.dashboard-*` dan `.timeline-*` di `src/app/globals.css`. Gunakan token yang ada seperti `--color-*`/`--wp-*` dan spacing kelipatan 4px; jangan memakai gradient. Stat row memakai grid 1 kolom pada 360 px dan 3 kolom pada ≥768 px. Judul dan konteks memakai `overflow-wrap: anywhere`. `.timeline-year` memakai heading dengan sticky opsional, tetapi jangan sticky bila menyebabkan overlap pada 360 px.
- Semua link memiliki nama yang dapat dibaca, focus-visible memakai token focus, dan `prefers-reduced-motion` dihormati. Skeleton tidak boleh berkedip ketika reduced motion aktif; ikuti pola `Skeleton`.

## 5. Struktur file

| Aksi | Path | Tanggung jawab |
| --- | --- | --- |
| Create | `supabase/migrations/20260927090000_t12_dashboard_timeline.sql` | Empat fungsi read-only |
| Create | `supabase/tests/database/dashboard_timeline.test.sql` | pgTAP semantik, owner, dan grant |
| Modify | `src/server/supabase/database.types.ts` | Output `pnpm db:types` |
| Create | `src/domain/dashboard/contracts.ts`, `src/domain/dashboard/links.ts` | Tipe dan link Dashboard |
| Create | `src/domain/timeline/timeline.ts` | Builder, filter, dan grouping murni |
| Create | `src/domain/routes/timeline-filters.ts` | Reader URL Timeline |
| Modify | `src/domain/routes/achievement-filters.ts`, `project-filters.ts`, `safe-return.ts` | Filter baru dan allowlist |
| Modify | `src/features/achievement/schemas.ts`, `achievement-service.ts`, `achievement-list.tsx` | Filter skill/evidence |
| Modify | `src/features/project/schemas.ts`, `project-service.ts`, `project-list.tsx` (bila membangun href) | Filter outcome |
| Modify | `src/app/(workspace)/achievements/page.tsx`, `src/app/(workspace)/projects/page.tsx` | Meneruskan filter dan chip Clear |
| Create | `src/features/dashboard/dashboard-service.ts`, `dashboard-view.tsx`, `dashboard-issue.tsx` | S04 |
| Create | `src/features/timeline/timeline-service.ts`, `timeline-view.tsx` | S11 |
| Modify/Create | `src/app/(workspace)/dashboard/page.tsx` + `loading.tsx`, `timeline/page.tsx` + `loading.tsx` | Route |
| Modify | `src/app/(workspace)/settings/profile/page.tsx`, `src/features/profile/profile-workspace.tsx`, `foundation-editors.tsx` | Deep link S12 |
| Modify | `src/i18n/messages.ts`, `src/app/globals.css` | Copy en/id dan style |
| Create | `tests/unit/timeline-build.test.ts`, `tests/unit/timeline-filters.test.ts`, `tests/unit/dashboard-links.test.ts`, `tests/unit/achievement-filters.test.ts`, `tests/unit/dashboard-service.test.ts` | Unit |
| Modify | `tests/unit/project-filters.test.ts`, `tests/unit/auth-routing.test.ts` (tempat test `sanitizeReturnTo`) | Unit regresi |
| Create | `tests/integration/dashboard-timeline.test.ts` | PostgreSQL nyata dua akun |
| Create | `tests/e2e/dashboard-timeline.spec.ts`, `playwright.dashboard.config.ts` (PORT 3005) | Browser |
| Modify | `package.json` | `test:integration:dashboard`, `test:e2e:dashboard` |
| Create (Fase 7) | `docs/decisions/0018-t12-dashboard-timeline.md`, `docs/verification/T12-dashboard-timeline.md` | Draft untuk reviewer |

## 6. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch`, branch, dan HEAD.
- [ ] **Hard gate:** jika working tree masih berisi perubahan T11 yang belum di-commit (lihat git status awal sesi ini), **stop** dan minta pengguna/reviewer meng-commit T11 lebih dulu. Hal ini diperlukan agar diff T12 dapat direview terpisah, karena `messages.ts` dan `globals.css` beririsan. Jangan melakukan commit, stash, reset, atau checkout atas nama pengguna.
- [ ] Jalankan `pnpm install --frozen-lockfile`, `pnpm db:status`, dan `pnpm exec supabase migration list --local`. Pastikan parity 20/20 dengan migration terakhir `20260926100000`.
- [ ] Jalankan baseline `pnpm test`, `pnpm typecheck`, dan `pnpm lint`, lalu catat angka. Angka terakhir menurut status adalah unit 38 file/181 test.
- [ ] Verifikasi asumsi berikut dari source SQL dan catat bukti file:baris:
  - policy `select` owner pada `profiles`, `activities`, `achievements`, `achievement_skills`, `skills`, `projects`, `experiences`, `education`, dan `evidence_files`;
  - normalisasi outcome project (`nullif(btrim)`) pada RPC T08;
  - nilai status `ready` pada `evidence_files`.
- [ ] Receipt Fase 0.

### Fase 1 — Database (TDD pgTAP)

- [ ] **Tulis pgTAP gagal** `supabase/tests/database/dashboard_timeline.test.sql` dengan pola `begin; ... select no_plan(); ... select * from finish(); rollback;`, fixture `auth.users`, dan `pg_temp.set_jwt_subject` dari `achievement.test.sql`. Assertion minimum:
  1. `has_function` untuk keempat fungsi dengan signature tepat.
  2. `anon` tidak memiliki `EXECUTE` dan `authenticated` memiliki `EXECUTE` (`has_function_privilege`).
  3. `prosecdef = false` untuk keempat fungsi (invoker).
  4. Fixture A (subset §7):
     - confirmed dengan direct ready evidence tidak masuk `filter_achievements(null,true)`;
     - confirmed dengan evidence `scanning` saja masuk;
     - confirmed dengan evidence `failed` saja masuk;
     - draft tanpa evidence masuk filter tetapi tidak masuk `missing_evidence_count`.
  5. Achievement derived yang Activity-nya memiliki ready evidence tetap dianggap missing (tanpa pewarisan). Achievement dalam Project yang memiliki ready evidence juga tetap missing.
  6. `filter_achievements(<skill>, false)` hanya mengembalikan achievement yang memiliki link skill tersebut.
  7. `filter_projects(true)` mencakup outcome NULL. Jika constraint tabel mengizinkan, sisipkan juga outcome whitespace `'   '` lewat superuser. Jika constraint menolak, catat bahwa kasus itu mustahil secara data dan lewati.
  8. `get_dashboard_summary()` mengembalikan angka persis fixture. `list_demonstrated_skills(12)` memberi urutan dan count persis; skill yang hanya dipakai draft tidak muncul.
  9. Dengan subject B, keempat fungsi tidak mengembalikan data A. `get_dashboard_summary()` B menghitung data B saja.
  10. Setelah `update profiles set deleting_at = now()` untuk A (sebagai superuser, lalu kembali ke role authenticated), `get_dashboard_summary()` mengembalikan 0 row dan fungsi list mengembalikan kosong.
  11. Akun baru tanpa record: `has_career_records = false` dan semua count 0.
- [ ] Jalankan `pnpm db:test` dan pastikan test baru **FAIL** karena fungsi belum ada.
- [ ] Tulis migration sesuai §3.1, terapkan dengan `pnpm exec supabase migration up --local`, dan **jangan** menjalankan `db reset` pada database aktif.
- [ ] Jalankan `pnpm db:test` (PASS; catat total assertion), `pnpm db:lint`, `pnpm db:types`, dan `pnpm exec supabase migration list --local` (21/21).
- [ ] Commit: `git add supabase/migrations/20260927090000_t12_dashboard_timeline.sql supabase/tests/database/dashboard_timeline.test.sql src/server/supabase/database.types.ts; git commit -m "feat(t12): add dashboard and timeline read functions"`.
- [ ] Receipt Fase 1: versi migration, assertion baru/total, parity sebelum/sesudah, dan hasil setiap command.

### Fase 2 — Domain, filter URL, dan service (TDD unit + integration)

- [ ] **Unit gagal dulu.** Tambahkan test berikut:
  - `tests/unit/achievement-filters.test.ts`: `evidence=missing` diterima; `evidence=yes`, duplikat, dan `skill=not-uuid` menjadi invalid dan dikosongkan; href mempertahankan urutan param; `EMPTY_ACHIEVEMENT_FILTERS` tidak menulis query.
  - `tests/unit/project-filters.test.ts`: `outcome=missing` diterima, `outcome=x` invalid, dan unknown key tetap error.
  - `tests/unit/timeline-filters.test.ts`: type allowlist, project UUID, duplikat, dan `timelineListHref`.
  - `tests/unit/auth-routing.test.ts` (atau file lain yang berisi test `sanitizeReturnTo`; temukan dengan grep): `/achievements?status=confirmed&evidence=missing&skill=<uuid>` lolos; `evidence=all` ditolak ke fallback; `/projects?status=completed&outcome=missing` lolos; `/timeline?type=project&project=<uuid>` lolos; `/timeline?type=streak` ditolak.
  - `tests/unit/dashboard-links.test.ts`: setiap link `dashboardLinks` di-parse ulang oleh reader masing-masing (`readAchievementQuery`/`readProjectQuery`) menjadi filter yang sama dan lolos `sanitizeReturnTo` tanpa berubah. Test ini mengikat link check ke filter list.
- [ ] Jalankan `pnpm test` dan pastikan test baru FAIL.
- [ ] Implementasikan perubahan filter/safe-return, lalu perbaiki semua caller sampai `pnpm typecheck` bersih. Jalankan `pnpm test` dan pastikan PASS.
- [ ] **Unit timeline gagal dulu.** Buat `tests/unit/timeline-build.test.ts` memakai fixture §7 dalam bentuk objek sumber. Test harus menegaskan:
  - urutan grup `2026, 2025, 2024, 2023, 2022, 2021, 2016, undated`;
  - urutan event per grup persis §7;
  - E1 dan E2 (overlap) sama-sama ada;
  - E2 `isCurrent`;
  - draft/dismissed tidak ada;
  - context P2/C2 bernilai `null`;
  - context C1 bernilai "Platform revamp";
  - filter `type=project` menghasilkan tepat P1–P4;
  - filter `project=P1` menghasilkan P1 dan C1;
  - filter project asing menghasilkan `[]`;
  - href experience `/settings/profile?record=<id>#experience-<id>`;
  - achievement dengan status `confirmed` tetapi `achieved_on` null diabaikan.
- [ ] Implementasikan `src/domain/timeline/timeline.ts` sampai PASS.
- [ ] **Service.** Buat `tests/unit/dashboard-service.test.ts` dengan fake client minimal, mengikuti pola `activity-service.test.ts`, untuk memetakan: summary nol row → `UNAUTHENTICATED`, error RPC → `UNAVAILABLE` dengan `correlationId` UUID, row invalid (count negatif) → `UNAVAILABLE`, dan `auth.getUser` null → `UNAUTHENTICATED`. Implementasikan dashboard service, timeline service, dan perubahan achievement/project service sampai PASS.
- [ ] **Integration nyata.** Buat `tests/integration/dashboard-timeline.test.ts` dengan pola setup `achievement-lifecycle.test.ts`: admin + owner A + owner B melalui sign-in nyata. Bangun fixture §7 melalui RPC publik (`create_project_idempotent`, `create_activity_idempotent`, `create_achievement_idempotent`, `save_achievement` dengan action `confirm`), dan experiences/education melalui RPC foundation atau admin insert seperti test T09. Evidence dibuat dengan menyalin cara T11 membuat row `ready`/`scanning` di `tests/integration/evidence-lifecycle.test.ts` (atau `tests/evidence-fixtures.ts`), tanpa mengubah constraint. Test wajib:
  1. `getDashboard()` A mengembalikan angka persis §7, recent activities berurutan berdasarkan `occurred_on`, dan activity yang dibuat terakhir dengan tanggal lama tidak berada di urutan pertama.
  2. **Link parity:** untuk setiap check/count ber-link, panggil `listAchievements`/`listProjects` dengan filter hasil `readAchievementQuery`/`readProjectQuery` atas link Dashboard. Ikuti `nextCursor` sampai habis; jumlah row harus sama dengan count Dashboard. Ulangi dengan page size nyata: buat ≥31 confirmed achievement tanpa evidence pada akun ketiga C untuk membuktikan cursor pada jalur RPC.
  3. Tambahkan direct ready evidence ke C3, lalu pastikan `missingEvidenceCount` turun 1 tanpa cache. Ubah C1 ke draft melalui `reopen`, lalu pastikan confirmed count dan skill count turun.
  4. `getTimeline({type:"",project:""})` A cocok dengan urutan §7. Filter project milik B dari sesi A menghasilkan grup kosong tanpa error.
  5. Dashboard/timeline B tidak memuat record A dan sebaliknya.
  6. Sesi anonymous menghasilkan `UNAUTHENTICATED`.
- [ ] Tambahkan script `"test:integration:dashboard": "vitest run --config vitest.integration.config.ts --configLoader native tests/integration/dashboard-timeline.test.ts"`. Jalankan script tersebut serta `test:integration:achievements` dan `test:integration:projects` sebagai regresi.
- [ ] Commit per kelompok logis (filter; timeline domain; services + integration).
- [ ] Receipt Fase 2. Checkpoint Claude read-only opsional dilakukan di sini.

### Fase 3 — Deep link S12

- [ ] Tambahkan test unit atau test render untuk `RecordEditor` bila pola test render sudah ada (lihat `tests/unit/evidence-attachments-ui.test.tsx`). Test menegaskan `id="experience-<id>"` dan `open` hanya untuk `openRecordId` yang cocok.
- [ ] Implementasikan §3.4. Jalankan `pnpm test`, `pnpm typecheck`, dan `pnpm test:e2e:auth` sebagai regresi S12.
- [ ] Commit dan buat receipt.

### Fase 4 — UI S04 Dashboard

- [ ] Implementasikan §4.1, copy en/id, dan CSS.
- [ ] Verifikasi manual di browser lokal (`pnpm build`, lalu jalankan server sesuai README) dengan akun fixture: akun kosong, akun penuh, dan service error. Error dapat disimulasikan dengan menghentikan `supabase` API, **hanya** bila tidak mengganggu pekerjaan lain; jika tidak, cukup gunakan unit test. Ambil screenshot 360/1440 light/dark.
- [ ] Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`, dan `pnpm test:e2e:ui` (regresi frame/Dashboard route).
- [ ] Commit dan buat receipt.

### Fase 5 — UI S11 Timeline + chip filter list

- [ ] Implementasikan §4.2, chip/Clear pada Achievements dan Projects, copy, dan CSS.
- [ ] Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e:achievements`, dan `pnpm test:e2e:projects`.
- [ ] Commit dan buat receipt.

### Fase 6 — Browser acceptance

- [ ] Buat `playwright.dashboard.config.ts` dengan menyalin `playwright.achievements.config.ts`, PORT **3005**, dan `testMatch: "dashboard-timeline.spec.ts"`. Tambahkan script `"test:e2e:dashboard": "playwright test --config playwright.dashboard.config.ts tests/e2e/dashboard-timeline.spec.ts"`.
- [ ] Tulis `tests/e2e/dashboard-timeline.spec.ts`. Salin helper `config/client/createUser/signIn` dari `achievements-ui.spec.ts`. Fixture dibuat via RPC/admin seperti integration dan user dihapus pada `afterAll`. Skenario:
  1. **Empty:** user baru → Dashboard menampilkan *Add your first activity* yang menuju `/activity/new` dengan fokus pada input, *Import CV* disabled beserta teks tidak tersedia, dan tanpa angka palsu.
  2. **Counts dan links:** user fixture §7 → stat angka persis. Klik *Confirmed achievements* menghasilkan URL `/achievements?status=confirmed` dan 5 row. Kembali, lalu klik check missing evidence untuk mendapatkan 4 row yang tepat (C2–C5 berdasarkan judul). Klik check missing outcome untuk mendapatkan tepat P2. Klik chip skill TypeScript untuk mendapatkan C1 dan C2. Klik recent activity pertama untuk membuka detail yang benar. Klik current project untuk membuka P1.
  3. **Timeline:** heading tahun berurutan; grup terakhir *Date not set* berisi ED2 dan P3; E1 dan E2 sama-sama tampil dan E2 memuat *Present*; draft/dismissed tidak ada. Filter Type=Project → Apply membuat URL memuat `type=project` dan tepat 4 event. Reload mempertahankan filter. Back/Forward memulihkan state. Klik event experience membuka `/settings/profile?record=...` dengan `<details>` terbuka dan terlihat. Klik achievement membuka `/achievements/<id>`.
  4. **Isolasi:** user B login dan memastikan Dashboard/Timeline tidak memuat judul A. `/timeline?project=<P1 milik A>` menghasilkan empty filtered tanpa error.
  5. **Aksesibilitas/responsif:** `expectNoWcagViolations` pada Dashboard penuh, Dashboard kosong, Timeline, dan Timeline terfilter. Keyboard-only Tab dari skip link mencapai stat link, check, dan event dengan focus terlihat. Pada 360×800 dan 1440×900, light dan dark (cookie `wp-theme`), `document.documentElement.scrollWidth <= clientWidth`. Lampirkan screenshot ke `testInfo`.
  6. **Copy terlarang:** `page.getByText(/streak|readiness|proficiency|%/i)` harus count 0 pada Dashboard dan Timeline (en). Untuk id, cek /runtun|kesiapan|kemahiran|%/i.
- [ ] Jalankan `pnpm test:e2e:dashboard`, lalu regresi `pnpm test:e2e:activity`, `test:e2e:achievements`, `test:e2e:projects`, `test:e2e:auth`, dan `test:e2e:ui`. Jalankan `test:e2e:evidence` bila ClamAV lokal tersedia; jika tidak, catat bahwa test tidak dijalankan beserta alasannya.
- [ ] Jalankan juga suite penuh §8 dan catat semua hasil.
- [ ] Serahkan kepada Claude: hash commit dan diff, receipt Fase 0–6, output command, screenshot 360/1440 light/dark, hasil Axe/keyboard, dan daftar acceptance yang belum terbukti.

### Fase 7 — Draft docs (setelah gate Claude dan perbaikan P0–P2)

- [ ] Buat `docs/decisions/0018-t12-dashboard-timeline.md` yang mencatat keputusan §2.2 poin 1, 2, 3, 5, 7, 8, dan 9 beserta alasannya.
- [ ] Buat `docs/verification/T12-dashboard-timeline.md` sebagai draft hasil aktual. Pisahkan pass, fail, warning, dan tidak dijalankan beserta alasannya, dengan trace ke R03/R08, F06, S04/S11, dan setiap poin §1.
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim T12 DONE.

## 7. Fixture kanonik (dipakai pgTAP, unit, integration, dan E2E)

Owner **A** (locale en, timezone `Asia/Jakarta`):

| Ref | Record | Data kunci |
| --- | --- | --- |
| E1 | experience employment | Northwind · Analyst, start 2021-03 (month), end 2023-06 (month) |
| E2 | experience employment | Contoso · Consultant, start 2022-01 (month), `is_current` (overlap dengan E1) |
| ED1 | education | Universitas Indonesia · S.Kom, 2016 (year)–2020 (year) |
| ED2 | education | Online Academy · Certificate, tanggal unknown |
| P1 | project active | "Platform revamp", experience E2, start 2024-02 (month) |
| P2 | project completed | "Thesis prototype", standalone, outcome NULL, start 2023 (year), dengan **direct ready evidence pada project** |
| P3 | project completed | "Migration", outcome "Shipped", start unknown |
| P4 | project planned | "Next initiative", start 2025-01-15 (day) |
| AC1..AC7 | activities | `occurred_on` 2026-09-20, 2026-09-18, 2026-09-10, 2026-08-01, 2026-07-15, 2026-06-01, 2025-11-03. **AC7 dibuat paling akhir** agar urutan created_at berbeda dari `occurred_on` |
| C1 | achievement confirmed | project P1, 2026-08-10, skills TypeScript + SQL, **direct ready evidence** |
| C2 | achievement confirmed | standalone, 2026-07-01, skill "typescript " (normalisasi ke TypeScript) |
| C3 | achievement confirmed | experience E1, 2023-05-20, evidence **scanning** saja |
| C4 | achievement confirmed derived dari AC7 | 2025-11-03; **AC7 memiliki direct ready evidence** (tidak diwariskan) |
| C5 | achievement confirmed | project P2, 2023-09-09 (evidence P2 tidak diwariskan) |
| D1 | achievement draft | skill Figma, tanpa evidence |
| X1 | achievement dismissed | — |

Angka Dashboard A yang diharapkan: confirmed **5**, current projects **1** (P1), demonstrated skills **2** (TypeScript 2, SQL 1; Figma tidak muncul), missing evidence **4** (C2, C3, C4, C5), completed missing outcome **1** (P2), `hasCareerRecords` **true**. Recent activity berurutan AC1, AC2, AC3, AC4, AC5.

Timeline A tanpa filter:

| Grup | Event berurutan |
| --- | --- |
| 2026 | C1 (2026-08-10), C2 (2026-07-01) |
| 2025 | C4 (2025-11-03), P4 (2025-01-15) |
| 2024 | P1 (2024-02) |
| 2023 | C5 (2023-09-09), C3 (2023-05-20), P2 (2023, precision year) |
| 2022 | E2 (Jan 2022 – Present) |
| 2021 | E1 (Mar 2021 – Jun 2023) |
| 2016 | ED1 (2016 – 2020) |
| Date not set | P3 (project), ED2 (education) — urutan type: project sebelum education |

Owner **B** memiliki minimal satu record untuk setiap jenis dengan judul unik, misalnya prefix "Foreign". Record B tidak boleh muncul pada data A.

## 8. Commands

Jalankan melalui pnpm/lockfile. Catat command, exit code, dan angka aktual.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm exec supabase migration list --local
pnpm test:integration:dashboard
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:activity
pnpm test:integration:evidence
pnpm test:e2e:dashboard
pnpm test:e2e:ui
pnpm test:e2e:auth
pnpm test:e2e:activity
pnpm test:e2e:achievements
pnpm test:e2e:projects
pnpm test:e2e:evidence
pnpm worker:check
pnpm build
git diff --check
```

Script baru dilaporkan lulus hanya setelah benar-benar ditambahkan dan dijalankan. Suite yang memerlukan ClamAV (`test:integration:evidence`, `test:e2e:evidence`) boleh dicatat sebagai "tidak dijalankan" bila container lokal tidak tersedia. Jangan menggantinya dengan fake scanner.

## 9. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Perubahan T11 masih belum di-commit pada awal Fase 0.
- Parity migration tidak 20/20, atau penyelesaian memerlukan `db reset` database aktif, rewrite migration lama, atau operasi destruktif.
- Salah satu tabel sumber tidak memiliki policy `select` owner untuk `authenticated`, sehingga fungsi invoker akan kosong atau bocor. Jangan beralih ke `security definer` tanpa keputusan reviewer.
- PostgREST menolak chaining `.order/.or/.limit` pada RPC `setof`. Laporkan error aktual; alternatif harus disetujui reviewer.
- Count Dashboard ≠ jumlah list link pada integration. Jangan mengubah expectation agar lulus; cari akar masalahnya.
- Implementasi terasa memerlukan CV check, AI, library evidence, pagination timeline, `returnTo` baru, atau perubahan tabel.
- Browser acceptance memerlukan layanan eksternal atau deployment.

## 10. Gate review Claude (setelah Fase 6)

Review bersifat read-only dan mencakup:

- Fungsi SQL berjenis invoker, memakai `search_path` kosong, memberi grant hanya kepada authenticated/service_role, mengecek `deleting_at`, dan tidak mengubah tabel.
- Predikat missing evidence hanya menghitung direct `ready`; tidak ada pewarisan Activity/Project; count dan list memakai fungsi yang sama.
- Link parity terbukti lintas pagination, termasuk cursor pada jalur RPC.
- Identity diambil dari sesi dan tidak ada owner dari payload. Filter project asing tidak membocorkan keberadaan record.
- Recent memakai `occurred_on`; skill memakai distinct confirmed; draft/dismissed tidak dihitung.
- Timeline mengikuti anchor dan urutan §2.2 poin 8; unknown berada di bawah; overlap terlihat; Present tampil; label mengikuti precision; tidak ada inferensi; `truncated` jujur.
- Empty CTA tidak membuat redirect loop, dan tidak ada copy/fitur terlarang.
- Filter baru tercatat di reader, safe-return, dan chip Clear; caller lama mempertahankan perilaku.
- Axe, keyboard, focus, responsif 360/1440 light/dark, copy en/id, serta tidak ada `any` atau log berisi `raw_text`.

Temuan **P0–P2** memblokir penerimaan dan harus diperbaiki serta diuji ulang. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative setelah semua gate lulus.

## 11. Review Focus — risiko yang paling mungkin lolos

1. **Count/list drift:** count check berbeda dengan jumlah list setelah link diklik, misalnya karena list lupa meneruskan `evidence`/`skill`, atau jalur RPC melewatkan cursor. Kasus ini dijaga oleh link-parity integration (Fase 2 test 2) dan E2E skenario 2.
2. **Filter hilang saat berpindah tab/halaman:** tab status Achievements/Projects atau link *Next page* membuang `evidence`/`skill`/`outcome`. Kasus ini dijaga oleh unit `achievementListHref` dan pemeriksaan E2E URL setelah klik tab bila tab tersedia di halaman terfilter.
3. **Redirect loop CTA Import:** `/onboarding/import` me-redirect user onboarding ke `/dashboard`. Kasus ini dijaga oleh E2E skenario 1, yang menegaskan tombol disabled dan tidak berupa link.
4. **Stale/cached dashboard:** confirm atau reopen tidak langsung tercermin. Kasus ini dijaga oleh integration Fase 2 test 3 dan larangan cache.
5. **Tanggal partial salah tampil:** year-only ditampilkan sebagai "Jan 1, 2023", atau unknown diberi placeholder. Kasus ini dijaga oleh unit timeline (label memakai formatter precision) dan E2E yang menegaskan teks "2023" tanpa "Jan".

# Verification T09 — Manual Achievements dan Skills

Tanggal eksekusi: 24 September 2026  
Status eksekusi sebelum review: **DONE**

Status terkini: **DONE per 25 September 2026**. Acceptance remediasi lokal lulus; Gate M2 tetap
terbuka sampai task M2 berikutnya selesai.

## Checkpoint remediasi review — 24 September 2026 (historis, PARTIAL)

RV1–RV6 sudah ditangani dan regresi unit, integration, serta browser ditambahkan. Retry memakai
action yang sama dengan revision terbaru; bila transisi sudah tidak valid, UI meminta pilihan aksi
valid. Pagination dated cursor kini juga mencakup semua row NULL-date. Jalur create memvalidasi
source/return query, mempertahankan context setelah sign-in, dan membuka existing Achievement tanpa
membuat duplikat. Sanitizer membatasi URL sampai 500 karakter dan empat tingkat nesting serta
mendukung Activity → Achievement → Activity return. Helper `normalizeMetricRows()` yang tidak
memiliki pemanggil dihapus; jalur save tetap memvalidasi blank metrics. Tidak ditemukan bukti
persistensi metric salah, sehingga tidak ada migration atau data repair.

| Check remediasi | Hasil aktual |
| --- | --- |
| Unit Vitest | Exit 0; `node node_modules/vitest/vitest.mjs run --configLoader native`; 32 file / 159 tests. |
| TypeScript | Exit 0; direct pinned binary, `--noEmit --incremental false`. |
| ESLint | Exit 0; direct pinned binary dengan `--max-warnings 0`. |
| Production build | Exit 0; Next.js production build berhasil. |
| `git diff --check` | Exit 0; hanya warning normal LF/CRLF. |
| Achievement/Project database integration | Belum dijalankan; Docker Desktop Linux engine tidak tersedia. |
| Achievement/Auth/Activity/Project browser E2E | Belum dijalankan; local database fixture tidak tersedia tanpa Docker. |
| Schema/migration | Tidak ada perubahan schema atau migration; database tidak di-reset. |

Pada checkpoint 24 September, T09 masih PARTIAL karena Docker lokal belum tersedia. Hasil acceptance
terkini setelah Docker tersedia dicatat berikutnya. Keputusan remediasi ada di
[decision 0015](../decisions/0015-t09-review-remediation.md).

## Acceptance remediasi lokal — 25 September 2026 (DONE)

Docker Desktop server 29.6.1 dan local Supabase dipakai untuk menjalankan ulang acceptance yang
tertunda. Hasil aktual:

| Check | Hasil |
| --- | --- |
| Achievement integration | 5/5 passed. |
| Project integration | 7/7 passed. |
| Achievement browser E2E | 3/3 passed: sign-in resume, lifecycle conflict retry/alternate action, manual lifecycle, metrics validation and preservation, source navigation, Axe, dan mobile viewport. |
| Auth browser E2E | 1/1 passed, termasuk standalone, Activity/Project source resume, dan session-expired recovery. |
| Activity browser E2E | 1/1 passed. |
| Project browser E2E | 1/1 passed. |
| Unit Vitest | 32 files / 159 tests passed. |
| TypeScript, ESLint | Exit 0. |
| Production build | Exit 0. |
| `git diff --check` | Exit 0; tracked diff bersih, hanya warning normal konversi LF/CRLF. File T09 baru/untracked dicek tanpa temuan baru; dua spasi pada baris tanggal dipertahankan sebagai hard-break Markdown. |

Tidak ada migration, perubahan schema/RPC, dependency, atau database reset. `pgTAP`, DB lint,
migration parity, dan clean disposable rebuild tidak diulang karena remediasi tidak mengubah SQL;
bukti tersebut tetap pada checkpoint T09 sebelum review di atas. Supabase melaporkan `imgproxy` dan
`pooler` berhenti; keduanya tidak dipakai oleh acceptance ini. E2E menampilkan warning Node `NO_COLOR`
dan Next.js `destination stream closed early` pada sebagian navigasi, tanpa assertion gagal.

T09 berjalan setelah hard gate T08 remediation berstatus DONE. Implementasi mengikuti PRD R05–R06,
Flow F02–F04, Screen S06–S10, schema database §§1–3/6, dan Design.md. Scope yang selesai mencakup
jalur manual tanpa AI: standalone/derived Achievement, draft/confirmed/dismissed/reopen, skills,
metrics opsional, source provenance, Activity/Project context, serta optimistic revision.

## Perubahan utama

- Decision record: [0014 T09 Achievement lifecycle](../decisions/0014-t09-achievement-lifecycle.md).
- Migration forward-only: `20260922100000_t09_achievements_skills.sql` dan
  `20260922110000_t09_achievement_null_patch.sql`.
- Domain/service/action: Achievement contract, nullable-date cursor, factual CV fallback, strict
  metrics, normalized skill labels, owner-scoped list/detail/context, idempotent create, revision
  save/relink/delete, dan safe error mapping.
- Route/UI: `/achievements`, `/achievements/new`, `/achievements/[id]`, Activity create/open
  Achievement, Project linked Achievement, attach/move/detach, deletion previews, bilingual copy,
  conflict/source/unavailable states, responsive layout, and reusable skill/metric editors.
- Database: RLS/composite ownership, one-derived-per-Activity race guard, source retention after
  Activity delete, Project/Activity context propagation, strict confirmation fields, live distinct
  confirmed-skill count, and Project deletion receipt.

## Acceptance evidence sebelum review (historis)

| Area | Result |
| --- | --- |
| Unit/domain | 32 files, 150 tests passed; Achievement fallback, metrics, transitions, cursor, filters, and safe-return coverage included. |
| Achievement integration | 3/3 passed: idempotent create/save/confirm/skill count, two-session derived race, source change and Activity deletion retention; attach/detach and Project deletion receipt included. |
| Project integration | 7/7 passed, including context propagation, revision conflicts, candidate pagination, lock race, and updated deletion receipt. |
| Activity integration | 6/6 passed, including persistence, ownership, pagination, context, and existing lifecycle behavior. |
| Private Storage integration | 1/1 passed as regression. |
| Database pgTAP | 5 files, 312 assertions passed. |
| DB lint | Exit 0, no error-level findings. |
| Migration parity | 15/15 local/remote migration entries match on the active local stack; the same 15 migrations applied from zero on the disposable stack. |
| Type/lint | Direct `tsc --noEmit --incremental false` and ESLint exit 0. |
| Production build | Next production build exit 0; routes include all Achievement and Project detail paths. |
| Worker check | Exit 0; worker ready, no registered jobs as expected for T09. |
| Browser/Axe | Auth E2E 1/1, UI/app-frame E2E 1/1, Achievement E2E 1/1, Activity browser regression 1/1, and Project browser regression 1/1 passed; suites include lifecycle/source handoff, Axe checks, and 360px overflow assertions. |
| Clean disposable rebuild | Project ID `workpulse-t09-disposable-20260924-a`, verified absolute workdir under `.tmp`, and ports `55320–55324`/`55327`; all 15 migrations and seed applied from zero, then pgTAP 312/312, DB lint, Achievement 3/3, Project 7/7, Activity 6/6, and Storage 1/1 passed. |
| Active-stack safety | Disposable resource stopped with `--no-backup`, temporary folder removed, and active WorkPulse status at `54321/54323` verified afterward; active database was not reset. |
| Diff hygiene | `git diff --check` exit 0; only normal Git LF/CRLF warnings. |

The browser commands use the dedicated Playwright configs, which build and start the production server
on port 3000 (Auth/UI), 3001 (Activity), 3002 (Project), and 3003 (Achievement). Activity and Project configs use
the pinned Next binaries directly so the browser suites do not depend on an interactive package-manager
wrapper. The runs emitted non-blocking Node `NO_COLOR` warnings and, on some navigations, a Next.js
`destination stream closed early` warning; all five browser suites completed successfully and no
assertion failed.

The clean disposable rebuild used the verified target
`D:\Project\WorkPulse\.tmp\supabase-t09-disposable-20260924-a`, project ID
`workpulse-t09-disposable-20260924-a`, and unique ports. Credentials were process-only and no key,
private content, or fixture value was recorded. The resource and temporary directory were removed
after verification; the active WorkPulse stack remained available.

## Scope boundaries and open work

T09 deliberately does not implement AI, Evidence, import, Dashboard/Timeline, CV selection or
invalidation, export/PDF, OCR, background jobs, or production deployment. Confirmed Achievements are
only eligible for future CV selection; they are not auto-selected.

Hosted/production checks, deployment, and T24 performance remain out of scope. The prior package-
manager wrapper attempted a non-interactive Corepack module replacement during some checks; the
successful checks used direct pinned binaries. No dependency or lockfile change was introduced.
Remediation database and browser acceptance completed on 25 September 2026 as recorded above.

T10 Evidence reservation dan screening tetap TODO; Gate M2 tetap terbuka sampai T10–T12 selesai.

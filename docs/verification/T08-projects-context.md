# Verification T08 — Projects dan context propagation

Tanggal verifikasi: 21 September 2026; remediasi review ditutup 22 September 2026  
Status: **DONE** — seluruh acceptance T08 dan empat temuan review lulus pada active local stack dan
clean disposable stack.

## Scope dan trace

T08 mengimplementasikan PRD R06, Flow F04/shared recovery, Wireframe S09-S10, Database Schema
§§1-3/6, dan kontrak T06-T07 berikut:

- S09 `/projects`: status filter `planned`/`active`/`completed`, cursor 30 row, compact row,
  partial/unknown date, linked Activity count, `Needs outcome`, loading/empty/no-match/error, dan
  safe return.
- S10 `/projects/new` dan `/projects/[id]`: create/edit canonical fields, standalone Project,
  revision conflict, restored draft guard, context-change confirmation, linked work, attach/move,
  detach, dependency preview, and delete receipt.
- R06/F04 context invariant: Project menentukan `experience_id` Activity ketika linked; detach/delete
  mempertahankan Activity, Chat, raw text, structured fields, dan Experience.
- T08 intentionally does not add Achievement, Evidence, Dashboard/Timeline, AI, or CV behavior.

## Implemented surface

Migration forward-only yang diterapkan ke active stack dan diverifikasi ulang pada disposable stack:

- `supabase/migrations/20260920100000_t08_projects_context.sql`
- `supabase/migrations/20260920101500_t08_project_patch_compatibility.sql`
- `supabase/migrations/20260920102000_t08_project_create_lint.sql`
- `supabase/migrations/20260921090000_t08_review_remediation.sql`

Surface aplikasi yang ditambahkan/diubah mencakup `src/domain/project`, `src/features/project`,
route `/projects`, Project service/actions/forms/detail/list, safe-return dan Project filters,
Activity Project prefill, bilingual messages, database types, pgTAP Project tests, unit tests,
Project integration/browser specs, and package scripts. Remediasi menambah completed-date
normalization regression, ledger-first replay, Experience → Project → Activity lock ordering, dan
server-side candidate keyset pagination dengan UI load-more state. Existing Activity fixtures were
changed to use the authenticated Project create RPC after direct Project INSERT was revoked.

## Acceptance evidence

| Area | Evidence aktual | Status |
| --- | --- | --- |
| Create, standalone, completed without outcome, limits | pgTAP Project suite; Project schemas/domain tests; UI label `Needs outcome` implemented | Passed active + disposable integration and Project E2E |
| Idempotent create and owner boundary | `create_project_idempotent`, operation ledger tests, direct INSERT denial tests, generated RPC types | Database evidence passed |
| Update and revision safety | `update_project`, service conflict mapping, restored-draft base revision metadata, unit coverage | Passed active + disposable integration and regression E2E |
| Context propagation | Project Experience update locks/propagates to linked Activity; pgTAP checks revision and preservation | Database evidence passed |
| Attach/move/detach | `relink_activity_project` derives Experience from target Project; detach preserves current Experience | Passed active + disposable integration and Project E2E |
| Delete retention | dependency-aware delete receipt returns released Activity count; Activity/Chat/Experience preservation covered in pgTAP | Passed active + disposable integration and Project E2E |
| List/filter/cursor/return | versioned opaque cursor, status URL filter, bounded nested return, S09/S10 routes and states | Passed unit/static and Project E2E |
| Completed end date | Completed forces non-current while preserving valid end date/precision; current still clears end date | Passed unit, Project integration read-back, pgTAP, and Project E2E |
| Replay after parent deletion | Identical create replay returns the immutable receipt before live Experience lookup; changed payload is rejected | Passed integration and pgTAP |
| Cross-operation locking | Project update uses Experience → Project → Activity when context changes; two-session update/delete race completes without deadlock | Passed repeated Project integration race and pgTAP context checks |
| Candidate pagination | Target exclusion occurs in SQL before limit; keyset pages reach eligible Activity beyond the old 100-row cutoff | Passed Project integration and Project E2E load-more regression |
| Foreign/missing safety | owner-scoped service/RPC errors map to safe unavailable state and correlation ID | Passed unit, database, and Project E2E evidence |
| Responsive/accessibility | Project Playwright spec includes 360px overflow and Axe hooks; keyboard/focus/reduced-motion styles reuse shared UI | Passed Project E2E |
| Scope boundary | no Achievement/Evidence/CV schema or fake counters/cards; seams recorded in decision 0012 | Verified by implementation review |

## Commands and results

Checks completed after Docker Desktop was restarted:

| Command | Result |
| --- | --- |
| `pnpm lint` | Exit 0; zero warnings. |
| `pnpm typecheck -- --incremental false` | Exit 0. |
| `pnpm install --frozen-lockfile` | Exit 0; lockfile already up to date. pnpm emitted a non-blocking registry metadata fetch warning. |
| `pnpm test` | Exit 0; 31 files / 142 unit tests. |
| `pnpm test:integration:projects` | Exit 0; 7/7 on active stack, including replay, pagination, and repeated two-session race. |
| `pnpm test:integration:activity` | Exit 0; 6/6 on active stack, including Project fixtures through the authenticated RPC. |
| `pnpm test:integration:storage` | Exit 0; 1/1 on active stack. |
| `pnpm db:test` | Exit 0; 274/274 pgTAP assertions on active stack across Activity, foundation, storage, and Project suites. |
| `pnpm db:lint` | Exit 0; no error-severity database results. |
| `pnpm exec supabase migration list --local` | Exit 0; 13/13 local/remote migration entries match, including the remediation migration. |
| `pnpm db:types` plus generated-file comparison | Exit 0; generated public output is identical to `src/server/supabase/database.types.ts`; CLI emitted only a MaxListeners warning. |
| `pnpm test:e2e:auth` | Exit 0; 1/1. |
| `pnpm test:e2e:ui` | Exit 0; 1/1. |
| `pnpm test:e2e:activity` | Exit 0; 1/1. |
| `pnpm test:e2e:projects` | Exit 0; 1/1, including Axe and 360px overflow assertion. |
| `pnpm build` | Exit 0 on the last completed production build. |
| `pnpm worker:check` | Exit 0; ready with no registered jobs. |
| `git diff --check` | Exit 0; line-ending warnings only. |

The four T08 migrations were applied incrementally with `supabase migration up --local` and without
resetting the active database. The generated database type review includes Project RPCs and found no
drift. Integration and browser commands received local Supabase variables process-only from the
local status output because `.env.local` did not contain the server secret; no credential values were
recorded here.

The clean disposable rebuild used a verified separate project ID, absolute workdir, and ports. It
applied all 13 migrations from zero, then passed `supabase test db` 274/274, DB lint, Project
integration 7/7, Activity integration 6/6, and Storage integration 1/1. Its Docker resources and
verified temporary directory were stopped/removed after checks; the active WorkPulse stack was not
reset.

## Scope exclusions

No T08 acceptance remains open. Hosted/staging/production checks, deployment, and T24 performance are
outside this task. Next task is T09; Gate M2 remains open until T08-T12 are complete.

## Next step

Proceed to T09 after preserving the T08 migrations and context seams. T09 extends relink/delete to
derived Achievement in the same transaction; T11 extends the delete receipt for direct Project
Evidence; T20 extends mutation invalidation to CV sources.

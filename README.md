# WorkPulse

Private career workspace (MVP v0.1). A user records activities, reviews and confirms
achievements, selects data into one master CV, and downloads a PDF. The manual path must
keep working with AI unavailable.

Status: **T01–T22 done locally; Gates M2 and M3 passed; Gate M4 (CV export integration review) next.** Auth/profile,
app frame, Activity capture, Projects and context, manual Achievements/Skills, Evidence,
Dashboard/Timeline, AI jobs with consent, detection/refinement review, and CV import (staging, commit, and the S03 review screen) are
implemented. Evidence covers atomic slot/byte reservation, private Storage, signature/MIME/size
checks, real ClamAV screening through the durable worker (T10), and the attachment UI on Activity,
Achievement, and Project detail screens with upload/scan polling, retry, authorized download,
named remove, and atomic move of `ready` Activity evidence to its derived Achievement (T11).
Unit, pgTAP, PostgreSQL/Storage/scanner integration, browser/Axe, worker, lint, typecheck, and
production build checks pass locally; nothing is deployed. The master CV (T18 schema and selection, T19 S13 builder with wording overrides, T20 freshness review and source-delete invalidation) is implemented, T21 adds the PDF export
backend, T22 adds the S14 preview and export page with real-renderer PDF QA, T23 adds account deletion and retention, and T24 adds pilot product events and the performance measurement. See
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the task list and
[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the current checkpoint.

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 24.18.0 (`>=24.18.0 <25`) | `engines` field; the pinned patch is what T01 was verified on |
| pnpm | 11.19.0 | pinned through `packageManager`; enable the Corepack shim once with `corepack enable --install-directory "$env:APPDATA\npm" pnpm` |
| Docker Desktop | current | required only for the local Supabase stack (`pnpm db:*`) |
| Supabase CLI | 2.117.0 | installed as a devDependency; use it through the `pnpm db:*` scripts |

Lint, typecheck, unit tests, and build can run without Supabase credentials. Activity
integration and browser acceptance use the local Supabase stack and require `.env.local`.

## Setup

```powershell
pnpm install --frozen-lockfile
```

Copy `.env.example` to `.env.local` when you need local Supabase values. `.env*` files are
git-ignored except the template, and the template holds variable names only — never commit
credentials. The Activity browser test provisions local test accounts and context records,
then removes them in `finally`; run it against the local stack only.

## Quality gates

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next.js development server on `http://localhost:3000` |
| `pnpm start` | serve the production build (`pnpm build` first) |
| `pnpm lint` | ESLint flat config, `--max-warnings 0` |
| `pnpm typecheck` | `tsc --noEmit` (TypeScript strict, `noUncheckedIndexedAccess`) |
| `pnpm test` | Vitest unit suite (`tests/unit`) |
| `pnpm test:integration:projects` | Project create/update/relink/delete and context propagation against local Supabase |
| `pnpm test:integration:achievements` | Achievement lifecycle, derived race, skill counts, relink, and source retention against local Supabase |
| `pnpm test:integration:activity` | Activity persistence, ownership, idempotency, revision conflicts, and pagination against local Supabase |
| `pnpm test:integration:storage` | Private Storage access, signed download, and expiry checks (`tests/integration/private-storage.test.ts`) |
| `pnpm test:integration:evidence` | Evidence reservation/quota, real scanner + Storage, and worker pipeline against local Supabase (scanner setup: [T10 runbook](docs/verification/T10-scanner-runbook.md)) |
| `pnpm test:integration:ai` | AI jobs, consent, lease/stale/attempt guards, worker process log hygiene, and the OpenAI-compatible adapter (Chat Completions and Responses) against a local stub (no network) |
| `pnpm test:integration:ai-review` | T14 detection, refinement and review against local Supabase with the real worker and the explicit fake provider: request/apply/answer/skip/dismiss, stale and retry guards, answer-versus-apply race, two-account isolation, and no-leak checks (no network) |
| `pnpm test:integration:import-commit` | T16 import commit against local Supabase, Storage and real ClamAV through the real T15 pipeline: PRD Indonesian-CV scenario, parallel commits, rollback, map ownership, onboarding through commit, races with update/cancel/delete, purge provenance, isolation, log hygiene |
| `pnpm test:integration:import-review` | T17 S03 read model against local Supabase through the real T15 pipeline: groups/excerpts/revisions, map options owner-only, persisted choices, stale item saves, committed result equals real rows, isolation, log hygiene |
| `pnpm test:integration:cv` | T18 master CV against local Supabase with real Auth: one CV under parallel first open, draft ineligibility, parent inclusion, duplicates, concurrent edits and source races, source deletion, two-account isolation, log hygiene |
| `pnpm test:integration:cv-builder` | T19 CV builder against local Supabase with real Auth: graduate journey with untouched canonical records, overrides kept out of snapshots, skill/certification refusal, concurrent text and structural edits, parent removal, isolation, deleted sources, log hygiene |
| `pnpm test:integration:cv-freshness` | T20 CV freshness against local Supabase with real Auth: PRD edit-after-override release scenario (refresh keeps the override, keep per revision, delete invalidates in the same transaction), six source types, context relink, reopen/dismiss, profile freshness, four two-session race scenarios without deadlock, dashboard counts, isolation, log hygiene |
| `pnpm test:integration:cv-export` | T21 CV export against local Supabase, Storage and the real worker: readiness, PRD delete-source and graduate scenarios, snapshot isolation from later edits, five request-versus-mutation races, dedup/idempotency, lease loss, render failure and retry, 24-hour expiry and cleanup, orphans, deleting accounts, owner-only signed download, log hygiene; plus a real Chromium renderer suite (A4, searchable en/id text, multipage, non-Latin names) that fails loudly without `workpulse-t21-pdf` ([PDF renderer runbook](docs/verification/T21-pdf-renderer-runbook.md)); plus the T22 S14 server layer (status route owner-only with identical 404s, named attachment and inline signed URLs, polling from queued to succeeded, Retry/Regenerate against real rows, one job per double click) |
| `pnpm test:pdf` | T22 PDF QA against the real Chromium renderer `workpulse-t21-pdf` (`WORKPULSE_PDF_GOTENBERG_URL`, no database, no fake fallback): extracted text equals the model in order, A4 and margins, no scaling, a 60-variant page-break sweep without orphan headings or split entries, page gaps around entries taller than a page, Indonesian and non-Latin text |
| `pnpm test:integration:import` | T15 CV import staging against local Supabase, Storage and real ClamAV with the isolated parser thread: upload validation, scan/parse/AI pipeline, grounding, cancel/retry/idempotency, purge, two-account isolation, log hygiene; plus the real Gotenberg DOCX page-count check ([renderer runbook](docs/verification/T15-renderer-runbook.md)) |
| `pnpm test:ai:live` | Opt-in live smoke against the configured OpenAI-compatible endpoint with synthetic fixtures; skipped unless `WORKPULSE_AI_LIVE=1` and `.env.ai.local` is configured |
| `pnpm test:e2e` | Playwright health/anonymous smoke suite; builds and starts the production server on port 3100 |
| `pnpm test:e2e:auth` | Local Supabase Auth/Profile acceptance through Mailpit |
| `pnpm test:e2e:ui` | Authenticated app-frame, theme, filter, keyboard, responsive, and Axe checks |
| `pnpm test:e2e:activity` | Activity capture/list/detail/edit acceptance against local Supabase; fixtures are cleaned up |
| `pnpm test:e2e:projects` | Project list/detail/create, linked Activity, delete retention, responsive, and Axe checks against local Supabase |
| `pnpm test:e2e:achievements` | Manual Achievement lifecycle, Activity source handoff, responsive, and Axe checks against local Supabase |
| `pnpm test:e2e:evidence` | Evidence API and attachment UI, plus Activity/Project/Achievement regression specs, against local Supabase |
| `pnpm test:e2e:ai` | S12 AI consent card and dialog: decline, allow, withdraw, conflict, id copy, responsive, and Axe checks |
| `pnpm test:e2e:ai-review` | S06 analysis panel and S08 suggestion aside: consent, analyze, follow-up questions, apply as draft, dismiss, outage/retry, stale, no-potential, `id` locale, responsive and Axe checks; drains the worker with the fake provider on port 3008 |
| `pnpm test:e2e:import` | S02 CV import: consent, keyboard file choice, leave-return, session expiry, failures, retry, cancel, duplicate warning, `id` locale, responsive and Axe checks; drains the worker (fake AI, fake renderer, real ClamAV) on port 3009 |
| `pnpm test:e2e:import-review` | S03 import review: PRD Indonesian-CV release scenario (keyboard only), idempotent commit, refresh, partial extraction, two-tab conflicts and commit token, empty extraction, returning user, isolation/privacy, 360/1440 light/dark and Axe; drains the worker on port 3010 |
| `pnpm test:e2e:cv` | S13 CV builder: graduate journey (keyboard moves, wording override, Save, reload), CV language, parent removal dialog, two-session conflict, wording dropped by a removal elsewhere, Add to CV, 360/1440 light/dark with Axe, reduced motion; port 3012 |
| `pnpm test:e2e:cv-freshness` | S13 freshness review and S04 CV checks: Refresh, Keep saved wording, Keep my wording, Replace, deleted/unconfirmed sources, profile review, Refresh all without manual wording, actions off while wording is unsaved, dashboard links, keyboard/focus/live region, 360/1440 light/dark with Axe, reduced motion; port 3013 |
| `pnpm test:e2e:cv-export` | S14 preview and export: access and empty state, graduate journey with the keyboard and the real renderer (real PDF pages, download), unsaved S13 wording, PRD delete-source scenario, Keep saved wording, failure → Retry → Regenerate, expiry, PDF pages that fail to load, two-tab conflict, two-account isolation, 360/1440 light/dark with Axe, long id/en CV page screenshots; drains the worker as a child process on port 3014 and writes `docs/verification/T22-screenshots/` |
| `pnpm test:integration:account-deletion` | T23 account deletion and retention against local Supabase, Auth, Storage and the real workers: guard on every user RPC, session revocation, ordered purge with real objects in three categories plus an orphan, crash at three points, isolation and re-registration, queued jobs never reach an adapter, abandoned import reviews, export snapshot redaction and the guarded retry |
| `pnpm test:e2e:account-deletion` | S12 account deletion with the keyboard (wrong password, wrong email, then delete), two sessions, re-sign-in refused, real worker drain and re-registration, S03 automatic cancel notice, 360/1440 light/dark with Axe, reduced motion; port 3015 and writes `docs/verification/T23-screenshots/` |
| `pnpm test:integration:product-events` | T24 product events against local Supabase, Auth and the real export worker: one event per save, import commit, AI apply and export transition, none for edits or retries, rollback leaves no event, private sentinels never reach event rows or the report, API roles refused, pilot cohort counts only enrolled accounts, events removed with the account through the T23 deletion path |
| `pnpm test:perf` | T24 p95 of the page reads and saves at the service layer on the PRD dataset (1,000 activities, 200 achievements, 50 projects, seeded through the user RPCs); 50 warm samples per operation; writes `docs/verification/T24-perf-results.json` unless `WORKPULSE_PERF_OUT` points elsewhere. Run it alone |
| `pnpm build` | Next.js production build |

Run the Playwright browser once per machine:

```powershell
pnpm exec playwright install chromium
```

## Web

```powershell
pnpm dev            # http://localhost:3000
pnpm build; pnpm start
```

`GET /api/health` returns `200` with `Cache-Control: no-store` and the fixed body

```json
{"status":"ok","service":"workpulse-web","version":"0.1.0"}
```

It is a liveness probe: it checks no dependency and exposes no configuration.

## Worker

```powershell
pnpm worker:check
```

Reports registered handlers and exits 0; this is a configuration check, not proof that
database or scanner dependencies are healthy. T10 adds a separate durable evidence worker:

```powershell
pnpm worker:run     # separate foreground process; stop with Ctrl+C
pnpm worker:once    # one bounded scan/cleanup/expiry sweep
```

The Node process uses built-in TypeScript stripping, loads `.env.local`, and runs
independently from web requests. PostgreSQL owns claims, 120-second leases, attempt tokens,
and retries. Configure the real ClamAV scanner with the server-only variables in `.env.example`.
Missing/unavailable scanning never marks a file ready; `fake-clean` is explicitly restricted
to development/tests and is not an integration substitute. See the
[T10 scanner runbook](docs/verification/T10-scanner-runbook.md) for pinned local setup,
real scanner checks, recovery, and the separate staging acceptance gate.

T13 adds the `ai-detect` handler to the same loop. PostgreSQL owns AI claims, 120-second
leases, attempt tokens and the three-attempt limit; consent, account state and the activity
revision are rechecked before text is released and before a result is stored. Provider
settings (OpenAI-compatible base URL, key, model, API style) live in `.env.ai.local` (see
`.env.example`); the default mode is `unavailable`, and
the worker prints only counts and error codes, never note text, provider output or keys.

T14 adds the `refine` job kind (one AI job per activity revision, across kinds), review
actions (answer, skip, dismiss, apply as a draft Achievement) and the owner-scoped status
route `GET /api/ai/activities/[id]/analysis`. Analysis is requested explicitly from the
activity page; apply never confirms an Achievement. E2E and integration tests drain the
worker with `WORKPULSE_AI_MODE=fake` set only on the child process (development/test only).

T15 adds CV import (`/onboarding/import`, `POST /api/imports`, `GET /api/imports/[id]`). The worker
gains an import pass (`import-scan-parse`, `import-cleanup`) and the `ai-import` handler: ClamAV
screening always runs before parsing; PDF/DOCX text is extracted in a `worker_threads` sandbox
(heap limit, no inherited environment, 30 s hard timeout) with `pdfjs-dist`; DOCX page counts come
from an isolated LibreOffice renderer (`WORKPULSE_DOCX_RENDERER_MODE`, default `unavailable`; see the
[T15 renderer runbook](docs/verification/T15-renderer-runbook.md)). Extraction only writes staging
rows (`import_batches`, `import_items`); raw files and text are purged within 24 hours of a terminal
state. See [decision 0021](docs/decisions/0021-t15-import-staging.md).

T16 adds the import commit backend: `update_import_item` persists each Create/Map/Skip choice and edit, `validate_import_batch` dry-runs the validation, and `commit_import_batch` commits every selected candidate in one atomic, idempotent transaction (foundation rows first, achievements as drafts unless explicitly confirmed, only the selected profile fields, onboarding completed through the commit for new users). Map only reuses the user's own records. See [decision 0022](docs/decisions/0022-t16-import-commit.md).

T17 adds the S03 review screen at `/imports/<id>/review` (reachable before onboarding): grouped candidates with source excerpts, Create/Map/Skip saved immediately, field edits saved per candidate, per-achievement confirmation, conflict recovery that keeps local input, onboarding inside the commit, and the stored commit result with *Open dashboard*. Returning users reach S02 from the empty dashboard and Settings. No migration. See [decision 0023](docs/decisions/0023-t17-import-review-ui.md).

T18 adds the master CV backend (no UI; `/cv` stays unavailable until T19): `cv_documents` (one per account), `cv_items` and structure-only `cv_exports`, with RLS select-own and no client write grants. Five RPCs (`ensure_cv_document`, `select_cv_source`, `remove_cv_item`, `reorder_cv_section`, `update_cv_layout`) guard every change with `expected_revision`; selecting a confirmed achievement also adds its project (else experience) parent; duplicates are rejected; deleting a source marks its item `source_deleted` and keeps the saved snapshot. Confirming an achievement does not add it to the CV. Domain rules and `buildCvOutline` live in `src/domain/cv/`, the service in `src/features/cv/`. See [decision 0024](docs/decisions/0024-t18-cv-schema-selection.md).

T19 turns `/cv` (S13) into the builder: pick records per section (a child achievement brings its parent and renders under it once), move items and sections with labelled up/down buttons, choose the CV language (labels and dates only; source text is never translated), and edit the title, summary, contact display values and per-item wording. Structural changes save immediately; text edits save together through one explicit Save (`save_cv_edits`: one transaction, one revision step, no write for a no-op) and never touch source snapshots or canonical records. A stale save keeps the typed text and asks *Keep mine* / *Use saved* per field. The preview shows only the saved CV (`buildCvPreviewModel`, reused by export later). Confirmed achievements link to `/cv?highlight=<id>` (*Add to CV*), which suggests the record without adding it. See [decision 0025](docs/decisions/0025-t19-cv-builder-overrides.md).

T20 adds CV freshness. Editing a selected record never writes the CV: the database computes each item's state (`fresh`, `changed`, `kept`, `deleted`, `unconfirmed`) and the profile's state from live source revisions and display snapshots (`get_cv_freshness`). In S13 a badge and a *Review change* panel compare the saved and current versions; the user chooses *Refresh from source* or *Keep saved wording* (bound to the reviewed revision), or, for an item with manual wording, *Keep my wording* (details refreshed, wording kept) or *Replace from source*. `resolve_cv_freshness` applies a batch in one transaction and one revision step and never clears wording except on Replace; *Refresh all items without manual wording* skips manual and unsaved wording. Deleting a selected source locks the CV first, marks the item `source_deleted` with its snapshot and wording kept, and bumps the CV revision in the same transaction. The dashboard shows two separate checks: CV items that need review and confirmed achievements not on the CV (`get_cv_review_summary`). Export blocking is T21. See [decision 0026](docs/decisions/0026-t20-cv-freshness-deletion.md).

T21 adds the CV export backend (no UI; S14 is T22).
- **Request.** `request_cv_export` locks the CV and every selected source in the canonical order, checks readiness (a name, at least one experience/project/education/achievement, no changed, deleted or unconfirmed item, no changed profile; *kept* items pass) and, in the same transaction, stores an immutable `cv-export.v1` snapshot of the saved CV and queues the job. It is idempotent per key and revision, with at most one active export per CV.
- **Worker.** The worker's `cv-export` pass claims with a 120-second lease and an attempt token. It reads only the snapshot, renders the `single_column_v1` HTML print template through an isolated Gotenberg Chromium container (`WORKPULSE_PDF_RENDERER_MODE`, default `unavailable`; see the [PDF renderer runbook](docs/verification/T21-pdf-renderer-runbook.md)), and checks `%PDF-`, ≤ 10 MiB, 1–20 pages and the searchable name in the parser thread. It then uploads to `<user>/export/<attempt token>` and completes by compare-and-set.
- **Failure and retry.** A failure never touches the CV; `retry_cv_export` re-queues the same snapshot, for at most three attempts.
- **Download and expiry.** A finished PDF can be downloaded for 24 hours through a signed URL of at most five minutes; then `export-cleanup` deletes the object, and a new request revalidates.

See [decision 0027](docs/decisions/0027-t21-cv-export-backend.md).

T22 adds S14 `/cv/preview`, opened from S13 through *Preview and export*. The link is disabled while wording is unsaved.
- **Saved revision only.** The page reads the saved CV and never creates one or starts an export by itself. It shows *Saved revision N*, the blockers with links to the place in S13 where each is fixed, and one explicit action. *Export PDF* sends the shown revision with a new idempotency key per click; a CV saved elsewhere meanwhile gives *Reload*, not an export.
- **Status.** `GET /api/cv/exports/[id]` serves the owner's safe columns with `no-store`; any other id gets the same 404. The page polls it with a staged delay (1–30 s) and announces the status in a live region.
- **Actions.** *Retry* is offered only for a retriable failure of the revision that is saved now; otherwise the page offers *Regenerate*, a new request that is validated again.
- **PDF pages.** Once a PDF exists, its real pages are drawn with pdf.js in the browser from a short-lived inline URL, with page navigation. *Download PDF* issues a 300-second attachment URL named `WorkPulse-CV-<date>.pdf` at the moment of the click.
- **Print template.** Long unbroken words wrap instead of shrinking the page. An entry taller than one page may break between its children, so no page is left blank before it.

See [decision 0028](docs/decisions/0028-t22-saved-preview-pdf-qa.md).

T23 adds account deletion in S12 and three retention rules.
- **Start.** *Delete account* asks for the current password (checked on a throwaway Auth client with the email of the session) and the account email. `begin_account_deletion` is service-role only; it marks the profile `deleting` and creates a receipt in one transaction, then the account is banned, every session is revoked and the browser leaves the workspace. There is no grace period and no undo.
- **Write guard.** A trigger on every user-owned table rejects the writes of a user request for a `deleting` account (`42501`, `ACCOUNT_DELETING`). Service-role requests, the worker and the purge are not affected.
- **Purge.** The worker's `account-deletion` pass queues every known object key and every object under the user prefix, deletes the rows in a fixed order in one transaction (the profile stays as a tombstone), deletes the Auth user, and completes the receipt only when the prefix is empty and no cleanup job is open. `get_account_deletion_backlog` reports pending and overdue (more than 24 hours) deletions.
- **Retention.** A review batch idle for 30 days is cancelled and purged; an export snapshot is emptied when the PDF expires or 24 hours after a failure; *Retry* is refused when the CV changed, is blocked, or the snapshot is gone.
- **Not proven locally.** The 30-day backup window is a policy until it is checked on the hosted project; see the [retention runbook](docs/verification/T23-retention-runbook.md).

See [decision 0029](docs/decisions/0029-t23-account-deletion-retention.md).

T24 adds product events for the pilot measures and measures the PRD performance targets. There is no UI change.
- **Events.** `AFTER` triggers on the canonical tables write one row to `internal.product_events` per saved activity, created career record, confirmed achievement, committed import and finished export, in the same transaction as the change. Properties are allowlisted enums and bounded integers: no text, record id, file name or email. No API role can read the table.
- **Pilot cohort.** The operator enrolls consenting accounts with `set_pilot_participant` and reads `get_pilot_metrics(now())`; both are service-role only. Targets are pilot hypotheses. See the [pilot metrics runbook](docs/verification/T24-pilot-metrics-runbook.md).
- **Performance.** `pnpm test:perf` seeds two accounts with the PRD dataset and measures the services the pages call. Across four local runs, every p95 stayed between 78 and 206 ms (targets: 2 s for reads, 1 s for saves). This is one development machine, not the hosted service.

Run the perf suite with the local stack up and nothing else running in the checkout, with `SUPABASE_SECRET_KEY` and the `.env.local` values in the process env:

```powershell
pnpm test:perf
```

See [decision 0030](docs/decisions/0030-t24-instrumentation-performance.md).

## Local database (Supabase)

Docker Desktop must be running.

```powershell
pnpm db:start    # docker pull + local Supabase stack
pnpm db:status   # URLs and local development keys (terminal only)
pnpm db:stop     # stops containers; data volumes are kept
```

`db:stop` never passes `--no-backup`, so local data survives a stop. Local development
uses this CLI stack exclusively: no hosted project, no production credential, and no
production login fixture.

Migrations (`supabase/migrations/`), the local-only seed (`supabase/seed.sql`), and
pgTAP tests (`supabase/tests/database/`) are part of T02. Database quality checks use
the pinned Supabase CLI and target only the local stack:

```powershell
$env:SUPABASE_TELEMETRY_DISABLED = "1"
pnpm db:start
pnpm db:reset    # rebuilds local Postgres from migrations, then applies seed.sql
pnpm db:test     # runs pgTAP via supabase test db
pnpm db:lint     # checks local database at error severity
pnpm db:status
pnpm db:stop     # stops containers without deleting volumes
```

`pnpm db:reset` is destructive to local database contents. It is intentionally not
configured to target a linked/hosted project. `supabase/config.toml` pins the local
stack definition and loads the seed after migrations.

### Local authentication and profile

T03 and T05 use the same local Supabase stack. After `pnpm db:start`, copy the local API
URL and publishable key reported by `pnpm db:status` into `.env.local` as
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Also set
`SUPABASE_URL` to the local API URL and `SUPABASE_SECRET_KEY` to the local secret key
reported by `pnpm db:status`. The secret key stays in `.env.local` and must never use a
`NEXT_PUBLIC_` name. Keep `WORKPULSE_SITE_URL=http://127.0.0.1:3000`; confirmation and
recovery redirects use this trusted origin. Apply pending migrations incrementally with
`pnpm exec supabase migration up --local`, then start the app with `pnpm dev`.

The T05 Storage integration check is `pnpm test:integration:storage`. It uses temporary
local accounts and an object, then removes them in cleanup. It verifies owner-authorized
attachment downloads, short URL expiry, private bucket behavior, denied user-token signing
and upload, and that user-token delete attempts leave the stored object unchanged.

The T06 Activity integration check is `pnpm test:integration:activity`. It uses two temporary
authenticated accounts and local PostgreSQL to verify exact raw-text persistence, Chat create,
idempotent replay, revision conflicts, owner isolation, context lifecycle, and 30-row keyset
pagination. Both integration scripts read the local Supabase URL and keys from the process
environment or `.env.local`; they remove their temporary accounts during cleanup. The Activity
test uses `SUPABASE_SECRET_KEY` only for fixture setup/cleanup; assertions use authenticated
user clients. Keep that key server/test-only and out of browser configuration and source control.

The T08 Project integration and browser checks use the same local stack and temporary authenticated
fixtures. Project mutations use the authenticated session and Project RPCs; direct client Project
INSERT is intentionally revoked. The Project workflow supports standalone or Experience-linked
Projects, three statuses, partial dates, revision conflicts, Activity context propagation, safe
relink/detach, dependency-aware deletion, and paginated candidate loading. The Docker-dependent
active and disposable checks are recorded in
[`docs/verification/T08-projects-context.md`](docs/verification/T08-projects-context.md).

The T10/T11 Evidence checks use the same local stack plus a local ClamAV container described in the
[T10 scanner runbook](docs/verification/T10-scanner-runbook.md). Evidence stays in private buckets,
downloads use owner-authorized signed URLs of at most five minutes, and a file becomes `ready` only
after real screening. The T11 lifecycle integration test (collection list, move, parent-delete
counts) runs with
`pnpm exec vitest run --config vitest.integration.config.ts --configLoader native tests/integration/evidence-lifecycle.test.ts`.
Results are recorded in
[`docs/verification/T11-evidence-ui-lifecycle.md`](docs/verification/T11-evidence-ui-lifecycle.md).

Local signup and recovery emails are captured by Supabase's Mailpit at
`http://127.0.0.1:54324`. The full auth/profile flow can be exercised with
`pnpm test:e2e:auth`; it requires Docker Desktop, the local Supabase stack, Mailpit,
and the Chromium browser installed above. The authenticated application-frame suite
uses the same local services through `pnpm test:e2e:ui`. The configured templates are
for local verification only. Production email delivery still needs a configured SMTP
provider and an allowlisted hosted redirect origin.

The active Auth service must report `mailer_autoconfirm=false` for signup confirmation
to be tested. If `supabase/config.toml` changed after the stack was started, run
`pnpm db:stop` and `pnpm db:start` to reload its local Auth settings; this preserves
the database volume. Avoid `pnpm db:reset` unless you intend to reset local database
contents.

## Conventions

- TypeScript strict, no floating dependency versions (`save-exact=true`), one lockfile.
- Server-side validation and ownership rules live in the server layer and the database,
  never in the browser.
- Keep `src/domain/` free of UI and adapter code; adapters (`AuthAdapter`,
  `StorageAdapter`, `AIProvider`, `DocumentParser`, `MalwareScanner`, `PdfRenderer`) are
  added when a task first needs them.
- Decision records live in `docs/decisions/`, acceptance evidence in
  `docs/verification/`.
- Do not commit secrets, `.env.local`, database dumps or generated caches.

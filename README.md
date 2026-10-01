# WorkPulse

Private career workspace (MVP v0.1). A user records activities, reviews and confirms
achievements, selects data into one master CV, and downloads a PDF. The manual path must
keep working with AI unavailable.

Status: **T01–T19 done locally; Gates M2 and M3 passed; T20 (CV freshness and deletion) next.** Auth/profile,
app frame, Activity capture, Projects and context, manual Achievements/Skills, Evidence,
Dashboard/Timeline, AI jobs with consent, detection/refinement review, and CV import (staging, commit, and the S03 review screen) are
implemented. Evidence covers atomic slot/byte reservation, private Storage, signature/MIME/size
checks, real ClamAV screening through the durable worker (T10), and the attachment UI on Activity,
Achievement, and Project detail screens with upload/scan polling, retry, authorized download,
named remove, and atomic move of `ready` Activity evidence to its derived Achievement (T11).
Unit, pgTAP, PostgreSQL/Storage/scanner integration, browser/Axe, worker, lint, typecheck, and
production build checks pass locally; nothing is deployed. The master CV (T18 schema and selection, T19 S13 builder with wording overrides) is implemented; CV freshness, export, and account deletion
remain deferred to their feature tasks. See
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

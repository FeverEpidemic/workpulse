# WorkPulse

Private career workspace (MVP v0.1). A user records activities, reviews and confirms
achievements, selects data into one master CV, and downloads a PDF. The manual path must
keep working with AI unavailable.

Status: **T01–T11 done locally; T12 (Dashboard and Timeline) next; Gate M2 open.** Auth/profile,
app frame, Activity capture, Projects and context, manual Achievements/Skills, and Evidence are
implemented. Evidence covers atomic slot/byte reservation, private Storage, signature/MIME/size
checks, real ClamAV screening through the durable worker (T10), and the attachment UI on Activity,
Achievement, and Project detail screens with upload/scan polling, retry, authorized download,
named remove, and atomic move of `ready` Activity evidence to its derived Achievement (T11).
Unit, pgTAP, PostgreSQL/Storage/scanner integration, browser/Axe, worker, lint, typecheck, and
production build checks pass locally; nothing is deployed. Dashboard, timeline, AI, import, and CV
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
| `pnpm test:integration:ai` | AI jobs, consent, lease/stale/attempt guards, worker process log hygiene, and the OpenAI adapter against a local stub (no network) |
| `pnpm test:ai:live` | Opt-in live OpenAI smoke with synthetic fixtures; skipped unless `WORKPULSE_AI_LIVE=1` and `.env.ai.local` is configured |
| `pnpm test:e2e` | Playwright health/anonymous smoke suite; builds and starts the production server on port 3100 |
| `pnpm test:e2e:auth` | Local Supabase Auth/Profile acceptance through Mailpit |
| `pnpm test:e2e:ui` | Authenticated app-frame, theme, filter, keyboard, responsive, and Axe checks |
| `pnpm test:e2e:activity` | Activity capture/list/detail/edit acceptance against local Supabase; fixtures are cleaned up |
| `pnpm test:e2e:projects` | Project list/detail/create, linked Activity, delete retention, responsive, and Axe checks against local Supabase |
| `pnpm test:e2e:achievements` | Manual Achievement lifecycle, Activity source handoff, responsive, and Axe checks against local Supabase |
| `pnpm test:e2e:evidence` | Evidence API and attachment UI, plus Activity/Project/Achievement regression specs, against local Supabase |
| `pnpm test:e2e:ai` | S12 AI consent card and dialog: decline, allow, withdraw, conflict, id copy, responsive, and Axe checks |
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
settings live in `.env.ai.local` (see `.env.example`); the default mode is `unavailable`, and
the worker prints only counts and error codes, never note text, provider output or keys.

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

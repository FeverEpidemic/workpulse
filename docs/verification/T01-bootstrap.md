# T01 acceptance evidence — Bootstrap

Task: T01 (Bootstrap dan kontrak proyek). Dependency: none.
Date: 2026-09-14. Environment: Windows (win32-x64), Node.js 24.18.0, pnpm 11.19.0
(Corepack shim), Docker 29.6.1 (Docker Desktop), Supabase CLI 2.117.0.

Every result below is a command that actually ran in this workspace; nothing is
inferred from documentation.

## 1. Install and lockfile

| Command | Result |
| --- | --- |
| `pnpm install` | exit 0, 501 packages resolved, `pnpm-lock.yaml` written |
| `pnpm install --frozen-lockfile` | exit 0 — `Already up to date`, so the lockfile matches `package.json` |

The first install attempt exited 1 with `ERR_PNPM_IGNORED_BUILDS: unrs-resolver@1.12.2`.
pnpm 11 does not read settings from `package.json`; the allow-list entry was moved to
`pnpm-workspace.yaml` and the install is clean from then on.

## 2. Quality gates

| Command | Result |
| --- | --- |
| `pnpm lint` | exit 0, no output (`eslint . --max-warnings 0`) |
| `pnpm typecheck` | exit 0, no output (`tsc --noEmit`) |
| `pnpm test` | exit 0 — 3 files, 8 tests passed |
| `pnpm build` | exit 0 — compiled, TypeScript check passed, 3 routes emitted |

Unit suite (Vitest 5.0.0):

- `tests/unit/home-page.test.ts` — the shell page renders the WorkPulse heading and the
  bootstrap notice, and contains no fixture/placeholder career data (2 tests).
- `tests/unit/health-route.test.ts` — HTTP 200, the exact contract body, `no-store`
  caching, and the reported version matching `package.json` (4 tests).
- `tests/unit/worker-bootstrap.test.ts` — the payload shape, plus the real CLI
  entrypoint executed with `node workers/check.ts`: empty stderr, exact stdout, exit 0
  (2 tests).

## 3. Health endpoint on the production build

`pnpm build` then `pnpm start --port 3100`, requested with `Invoke-WebRequest`:

```text
GET /api/health
STATUS: 200
CACHE-CONTROL: no-store
CONTENT-TYPE: application/json
BODY: {"status":"ok","service":"workpulse-web","version":"0.1.0"}

GET /
ROOT-STATUS: 200
ROOT-HAS-HEADING: True
```

The build output marks `/api/health` as `ƒ (Dynamic)` and `/` as `○ (Static)`, matching
the intended contract (health is never prerendered).

## 4. Playwright smoke suite

`pnpm exec playwright install chromium` — Chromium downloaded to the Playwright cache.

`pnpm test:e2e` starts the production build itself (`pnpm build && pnpm start --port
3100`) and then runs:

```text
Running 2 tests using 2 workers
  ok 1 [chromium] › tests\e2e\smoke.spec.ts:3:1 › root page serves the WorkPulse shell
  ok 2 [chromium] › tests\e2e\smoke.spec.ts:11:1 › GET /api/health keeps its public contract
  2 passed (9.3s)
```

## 5. Local Supabase stack

Docker Desktop was started; the daemon reports `29.6.1`.

| Command | Result |
| --- | --- |
| `pnpm db:start` | exit 0 — images pulled, `Starting database...`, stack up |
| `pnpm db:status` | exit 0 — `supabase local development setup is running.`, Studio on `http://127.0.0.1:54323`, Mailpit on `http://127.0.0.1:54324` |
| `pnpm db:stop` | exit 0 — `Stopped supabase local development setup.` / `Local data are backed up to docker volume.` |

Container state during the run (`docker ps --filter name=supabase`): db, kong, auth,
rest, storage, realtime, pg_meta, studio, inbucket and analytics all `Up (healthy)`.
`supabase_vector_WorkPulse` was in a restart loop; it is the optional log collector and
did not affect `supabase status`. Recorded as an observation, not a blocker.

Volume persistence after `pnpm db:stop` (`docker volume ls`):

```text
before stop: supabase_db_WorkPulse, supabase_edge_runtime_WorkPulse, supabase_storage_WorkPulse
after  stop: supabase_db_WorkPulse, supabase_edge_runtime_WorkPulse, supabase_storage_WorkPulse
```

No `supabase_WorkPulse` container remained after the stop, and all three volumes
survived — `db:stop` does not delete data.

No database schema, migration or fixture was created: that is T02 scope.

## 6. Repository hygiene

- `.env.local` does not exist; `git check-ignore` confirms `.env`, `.env.*`,
  `.next/`, `next-env.d.ts`, `*.tsbuildinfo` and `supabase/.temp` are ignored.
- A pattern scan over every non-ignored file for `sb_secret_…`, `sb_publishable_…`,
  `service_role`, `eyJhbGciOi` (JWT) and `PRIVATE KEY` produced one hit: a comment in
  the Supabase-generated `supabase/config.toml` that mentions the `anon` /
  `service_role` role names. No credential value is present anywhere in the tree.
- `.env.example` lists variable names only (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
  `DATABASE_URL`, `WORKPULSE_WORKER_ID`, `LOG_LEVEL`) with empty values.
- No commit was created and no remote is configured: Git has no configured identity in
  this environment, which is the assumption recorded for T01.

## 7. Deviations from the brief

1. `typescript` is pinned to `6.0.3`, not `7.0.2`. `typescript-eslint@8.70.0`
   (through `eslint-config-next@16.3.5`) aborts with
   `typescript-eslint does not support TS 7.0.` when TS 7 is installed, so `pnpm lint`
   exited 2. Approved by the user; details in `docs/decisions/0001-foundation-stack.md`.
2. `eslint` stays on `9.39.1`. The requested `10.10.0` was installed and verified:
   `pnpm lint` crashed with `TypeError: scopeManager.addGlobals is not a function` from
   ESLint 10 against Next's bundled `@babel/eslint-parser`. ESLint 9.39.1 is deprecated
   upstream, so this pin is carried as an open risk.

## 8. Checks not run

- No deployment, hosting or hosted-Supabase verification: out of T01 scope and no
  production credential or authorization exists.
- No integration, RLS, concurrency or PDF tests: they belong to T02+.
- No `supabase test`/`db reset`: there are no migrations or seed data yet.
- The Playwright suite was run only in Chromium; the brief asks for a smoke test, and
  responsive/theme coverage is T04 work.

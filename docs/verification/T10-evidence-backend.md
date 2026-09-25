# T10 Evidence backend — verification

Execution: 25–26 September 2026. Status: **DONE — local implementation and acceptance verified**.
Dependencies T05/T09 DONE; T11/T12 TODO; M2 open. Scope R07/F05, Database §4/§6.
S06/S08/S10 evidence UI and move remain T11.
[Plan](T10-implementation-plan.md), [decision](../decisions/0016-t10-evidence-backend.md), [operations](T10-scanner-runbook.md).

## Implemented

- Atomic owner-scoped reservation: exactly one typed parent, three slots/parent, 50 MiB/account,
  0 < file bytes <= 10 MiB, 15-minute expiry, revisions and idempotency receipts.
- Authenticated HTTP reserve/status/upload/download/delete; same-origin mutations, bounded
  request reads, safe localized errors, session-derived identity and deleting-account guard.
- Immutable private uploads with exact bytes, declared MIME, signatures and SHA-256;
  bounded DOCX ZIP inspection; lost-finalize retry only reuses identical stored bytes.
- Durable ClamAV screening: atomic claim, 120-second lease, attempt tokens, persisted retries,
  account/state/hash rechecks, terminal payload scrubbing. Unavailable scanner cannot mark ready.
- Ready-only owner download, attachment signed URL <=300 seconds. Generic storage signing
  and deletion cannot bypass evidence authorization.
- Expiry, orphan reconciliation and verified physical deletion. Receipts survive parent/account
  deletion; evidence workers cannot consume import/export cleanup jobs.
- Separate Node worker daemon/one-pass command, environment configuration and runbook.

Files: src/features/evidence/, src/app/api/evidence/, src/server/storage/, workers/evidence-worker.ts,
workers/supabase-evidence-gateway.ts, workers/run.ts, generated database types, package scripts,
.env.example, README, tests and documentation. No evidence UI or production deployment is claimed.

## Migrations and environment

Four forward-only migrations applied to existing local WorkPulse (API 54321 / DB 54322):

1. 20260925100000_t10_evidence_backend.sql — schema, quotas, lifecycle and durable queues.
2. 20260925110000_t10_finalize_qualification.sql — qualified finalize RETURNING column.
3. 20260925120000_t10_terminal_scan_constraints.sql — permit terminal queue payload scrubbing.
4. 20260925130000_t10_cleanup_claim_scope.sql — evidence-only cleanup claims.

The active database was never reset. Migration parity is 19/19. A separate stack
workpulse-t10-disposable-20260925 on ports 55420–55429 rebuilt all 19 migrations and seed.
On 26 September, restarting it was blocked by Windows port 55422 binding; its successful
25 September rebuild/integration results remain distinct from the latest active tests.

Real scanner: official ClamAV container workpulse-t10-clamav, localhost 13310:3310,
4 GiB memory limit, no workspace mount. Pinned image digest:
sha256:0e31ce089574268aefa0b543767d66b70240ab51ed49eec53e07f18d5629d817.
Observed engine/signatures: ClamAV 1.5.4/28129/Sun Sep 20 06:26:26 2026;
clamd and FreshClam processes present. These are local facts, not hosted operations evidence.

## Commands and results

Commands used installed lockfile binaries. Supabase credentials were supplied through process
environment. Docker-backed checks required host execution.

| Check / command | Actual result |
| --- | --- |
| node node_modules/vitest/vitest.mjs run --configLoader native | Unit: 36 files / 176 tests passed (25 September). |
| node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --configLoader native | 7 files / 33 tests passed on active and disposable stacks (25 September). Includes 14 T10 tests plus parent/storage regressions. |
| node node_modules/supabase/dist/supabase.js test db --local | Active: 6 files / 340 assertions passed (26 September). Disposable: 336 passed before final four orphan/queue-scope assertions; those four verified on active only. |
| node node_modules/supabase/dist/supabase.js db lint --local --level error | Empty error results on active and disposable. Active repeated 26 September. |
| node node_modules/supabase/dist/supabase.js migration list --local | Active 19/19 match (26 September). |
| node node_modules/supabase/dist/supabase.js db reset --local --workdir .tmp/supabase-t10-disposable-20260925 | Disposable only: all 19 migrations plus seed passed (25 September). |
| node node_modules/typescript/bin/tsc --noEmit --incremental false | Exit 0 (26 September). |
| node node_modules/eslint/bin/eslint.js . --max-warnings 0 | Exit 0 (26 September). |
| node node_modules/next/dist/bin/next build | Exit 0; evidence API routes included. Subsequent browser runs also built production successfully. |
| node workers/run.ts --once | Exit 0; standalone durable-worker sweep (25 September). |
| node node_modules/@playwright/test/cli.js test --config playwright.evidence.config.ts | Achievement 3/3, Activity 1/1, Project 1/1 passed on 26 September. Evidence fixture failed, corrected and rerun below. |
| node node_modules/@playwright/test/cli.js test --config playwright.evidence.config.ts tests/e2e/evidence-api.spec.ts | Exit 0, 1/1 passed (26 September): authenticated reserve/upload/quarantine, real scanner, ready download, deletion and CSRF. |

Database/integration acceptance covers owner isolation/RLS/composite FK, denied client lifecycle
writes, concurrent slots/account bytes, idempotency/revision replay, expiry/finalize and parent
deletion races. Worker checks cover stale tokens, lease expiry/reclaim, authorization revocation
before/after read, hash mutation, retry after outage and verified cleanup. Pipeline tests use actual
private Storage and real ClamAV: clean PDF, harmless EICAR inside DOCX, spoof rejection,
lost-finalize recovery and signed attachment download.

Initial browser failures were test setup/timing: evidence profile lacked completed onboarding
and a real display name; Activity asserted URL before navigation settled. Fixed fixtures and
Playwright URL waiting, then reran affected tests. An attempted run while database was stopped
failed environment setup; the active stack was restarted before successful runs.
Node NO_COLOR and Next.js destination-stream warnings were non-blocking in passing browser runs.
A scoped database query confirmed no evidence/pipeline integration fixture accounts remained.
Final tracked diff whitespace check passed (LF/CRLF conversion warnings only). The temporary
ClamAV container was stopped/removed and the disposable stack stopped with no backup; active
WorkPulse database/auth/storage containers remain running. Local status was synchronized to
the Notion project page on 26 September, preserving earlier checkpoints.

## Acceptance boundary and next step

On 26 September 2026 the user explicitly selected local-only execution and prohibited external
services. Therefore the verified local Supabase, private Storage, real ClamAV and separate worker
matrix closes T10. No hosted scanner connectivity, hosted supervisor, production rollout or hosted
retention guarantee is claimed. No Supabase project, Render service, billing resource, cloud
migration or deployment was created; existing external projects were not modified and Render OAuth
was not authorized. The next task is T11 Evidence UI and lifecycle on the local environment.

The prior PARTIAL checkpoint was synchronized to Notion before the external-service prohibition.
This DONE update remains local only and was not sent to Notion, following the user's instruction.

Three GPT-6 Luna Max coders reached usage limits during implementation; the main agent completed
integration and verification. Astra Medium was requested for orchestration; an active-model switch
is not claimed. Existing T07–T09 workspace changes were preserved.

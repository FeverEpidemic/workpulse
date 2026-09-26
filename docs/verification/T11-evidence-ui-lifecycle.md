# T11 Evidence UI and lifecycle verification

Execution: 26 September 2026. Status: **DONE — local implementation and acceptance verified**.
Dependencies T05, T09, and T10 remain DONE; T12 is next and Gate M2 remains open. Scope: R07,
F05, S06/S08/S10, Database Schema sections 4 and 6. This record proves the local WorkPulse stack,
private Storage, real ClamAV, worker, and browser flows; it does not claim hosted or production
readiness.

## Implemented

- One reusable attachment control is mounted on Activity, Achievement, and Project detail screens.
  It renders server states `uploading`, `scanning`, `ready`, `failed`, and `deleting` as text and
  color, polls only pending rows, and pauses while the tab is hidden.
- Upload reserves capacity before sending bytes. Successful upload remains `scanning`; only the
  worker can make it `ready`. Retry creates a new reservation row and idempotency key. Ready files
  can be downloaded through a short-lived attachment URL. Remove requires filename-specific
  confirmation and leaves `deleting` visible until cleanup completes.
- Owner-scoped collection GET returns only direct rows for the selected parent, in stable
  creation/id order, including `deleting`, without object key, hash, job, or user fields.
- A forward-only RPC moves only `ready` Activity evidence to the derived Achievement from that same
  Activity. It locks profile, source Activity, target Achievement, then evidence; validates evidence
  and target revisions and the three-active-slot limit; and preserves object identity, hash, bytes,
  quota, initial timestamp, and scan job.
- Parent-delete previews use direct attachment counts. Delete is disabled while that count is
  unavailable, avoiding a false zero during a delayed or failed list request. Project evidence is
  neither displayed nor counted as direct Achievement evidence.
- The UI includes bilingual copy, keyboard/focus handling, polite lifecycle announcements, long
  Unicode filename wrapping, reduced-motion compatibility, and responsive layouts at 360 and
  1440 pixels in light and dark themes.

## Migration and review

`20260926100000_t11_evidence_lifecycle.sql` was applied forward-only to the active local database;
the database was not reset. Generated Supabase types add only `list_evidence_files` and
`move_activity_evidence_to_achievement`. Migration parity is 20/20 and database lint reports no
errors.

The Explorer audit confirmed the existing Activity, Achievement, and Project `BEFORE DELETE`
triggers enqueue durable cleanup receipts before parent/source removal. Its integrated review found
no P0/P1. Two P2 findings were fixed: delete previews now distinguish an unknown count, and real
authenticated HTTP/Storage/ClamAV acceptance now complements the mocked UI state test. A repository
bug found by that real test was fixed: collection RPC results use `callAll` instead of discarding all
but the first row.

## Commands and actual results

Commands used installed lockfile binaries directly because invoking `pnpm` attempted a registry
metadata/install check and failed in the restricted noninteractive environment. Credentials were
read from the local Supabase status only into process environment and were not written to files.

| Check | Actual result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run --configLoader native` | 38 files, 181 tests passed. |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Exit 0. |
| `node node_modules/eslint/bin/eslint.js . --max-warnings 0` | Exit 0. |
| `node workers/check.ts` | Ready; evidence scan and cleanup jobs registered. |
| `node node_modules/supabase/dist/supabase.js test db --local --workdir .` | 6 files, 348 assertions passed. |
| `node node_modules/supabase/dist/supabase.js db lint --local --level error --workdir .` | No findings. |
| `node node_modules/supabase/dist/supabase.js migration list --local --workdir .` | 20/20 local migrations applied. |
| T11 `evidence-lifecycle.test.ts` against local PostgreSQL | 5/5 passed: exact direct lists, owner isolation, ready move, stale/full/foreign rejection, concurrent last slot, and move/delete race. |
| T10/T11 PostgreSQL evidence regression | `evidence-backend.test.ts` 7/7 passed. |
| Real scanner and Storage pipeline | 2 files, 7/7 passed with ClamAV 1.5.4 signatures 28129: clean, malware, unavailable/retry, download, and cleanup. |
| `evidence-ui.spec.ts` | 1/1 passed: host UI states/actions, new retry key/row, named remove/focus, move, Project isolation, axe, 360/1440, light/dark. Network is mocked only in this UI-state spec. |
| `evidence-api.spec.ts` | 1/1 passed with authenticated real HTTP, local private Storage, real ClamAV, Activity list → move → Achievement list → signed byte download → remove → worker drain → row/object unavailable. |
| Activity browser regression | Initial run failed a filter URL timing assertion; immediate rerun passed 1/1. |
| Achievement browser regression | 3/3 passed; non-blocking Next.js destination-stream warnings were observed. |
| Project browser regression | 1/1 passed. |
| `node node_modules/next/dist/bin/next build` | Sandbox run compiled but failed writing `.next` cache; rerun with workspace write access passed and includes the move route. |
| `git diff --check` | Exit 0; line-ending conversion warnings only. |

## Acceptance boundary and handoff

All seven core outcomes in the T11 execution plan have local evidence. The manual Activity,
Achievement, and Project regressions remain functional without depending on scanner availability;
the mocked UI test covers outage/pending states, while separate real-scanner tests prove readiness
is worker-controlled. No external project, deployment, billing resource, or production scanner was
created. The temporary loopback-only ClamAV container was stopped and removed after verification;
the pinned image remains cached. T12 should count missing evidence as confirmed Achievements with
zero direct `ready` evidence only; Activity, Project, pending, failed, and deleting rows do not count.
Notion synchronization was attempted after the local checkpoint, but the connector rejected the
external write because transmitting private implementation details requires explicit user
authorization. No Notion content was changed; this local record remains authoritative.

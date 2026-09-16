# T03 Remediation Plan for Luna

Date: 16 September 2026

Status: ready for implementation. This document plans fixes only; no implementation
or T03 status change is included here.

## Execution profile

- Model: `gpt-5.6-luna`.
- Reasoning effort: `max`.
- Work sequentially in the phases below. Finish and verify one phase before starting
  the next so failures remain easy to localize.
- Do not start T04, change source DOCX files, redesign the application shell, or
  refactor unrelated T01/T02 code.
- Preserve existing user changes. The repository currently has no commit baseline,
  so inspect the current files instead of assuming a clean diff.

## Objective and completion condition

Repair the three findings from the T03 review:

1. Unsaved drafts must not cross account boundaries in the same browser tab.
2. Reloading the server version after a revision conflict must produce a form that
   can be saved, including experience-kind mapping.
3. Foundation creates must be idempotent across retry, replay, and concurrent requests.

The remediation is complete only when:

- lint, typecheck, unit tests, and production build pass;
- database migration, pgTAP, and Auth/Mailpit E2E pass on a real local Supabase stack;
- the new regression scenarios below pass;
- `docs/verification/T03-auth-profile.md` and `docs/IMPLEMENTATION_STATUS.md` contain
  the actual commands and results;
- T03 remains `PARTIAL` if any database or Auth E2E acceptance is not executed.

## Required reading before edits

Read these sources in order:

1. Root `AGENTS.md` and `docs/AGENTS.md`.
2. `docs/IMPLEMENTATION_STATUS.md`, especially Checkpoint T03.
3. `docs/IMPLEMENTATION_PLAN.md` lines covering §3 ownership/concurrency, §4
   `operation_requests`, and T03 acceptance.
4. `docs/verification/T03-auth-profile.md` and
   `docs/decisions/0003-auth-session.md`.
5. Relevant R01/F01/S01/S12/profile-foundation sections from the source DOCX files
   using document extraction tooling.
6. The current implementation and tests named in each phase below.

Before editing, report the active phase, files expected to change, invariants being
preserved, and checks that will prove the phase.

## Phase 1 Account-scoped and safe session drafts

### Files to inspect and likely change

- `src/components/forms/session-draft.ts`
- `src/features/profile/onboarding-form.tsx`
- `src/features/profile/profile-editor.tsx`
- `src/features/profile/foundation-editors.tsx`
- `src/features/profile/profile-workspace.tsx`
- `src/app/dashboard/page.tsx`
- `src/server/auth/actions.ts`
- New shared client sign-out component if needed, for example
  `src/features/auth/sign-out-form.tsx`
- Unit and E2E tests under `tests/unit/` and `tests/e2e/auth-profile.spec.ts`

### Required implementation behavior

1. Namespace every stored draft with a version and authenticated owner ID, for
   example `workpulse:draft:v2:<user-id>:<form-key>`. Do not use email as identity.
2. Pass the current profile/auth user ID into every profile, onboarding, and
   foundation draft hook. A missing owner must disable restoration rather than fall
   back to an unscoped key.
3. Persist only user-editable controls. Exclude at least password, file, submit,
   button, reset, and all hidden controls. In particular, never persist `id`, `kind`,
   `expected_revision`, or an owner ID as ordinary draft data.
4. Remove legacy unscoped `workpulse:draft:<form-key>` entries instead of migrating
   them, because their owner cannot be established safely.
5. Preserve the existing requirement that an expired session can restore the same
   user's non-password fields after sign-in.
6. Clear drafts for the current owner during an intentional sign-out before the
   server sign-out action navigates away. Do not clear another owner's namespace.
7. Keep storage failures non-fatal and do not place field content in logs.

### Regression tests

- Unit-test draft key construction, owner separation, legacy-key removal, and the
  allow/deny rule for persisted field names/types. Extract pure helpers where this
  avoids adding a browser-DOM test dependency.
- E2E: user A enters unsaved profile and new-foundation values, the session expires,
  and user A signs in again; the values are restored.
- E2E: after the same setup, user B signs in in the same tab; no value from user A is
  visible in user B's onboarding, profile, or new-foundation forms.
- E2E: an intentional sign-out clears user A's drafts.
- Confirm passwords are never present in session storage.

### Phase acceptance

- Same-user expiry recovery still works.
- Cross-account draft disclosure and accidental cross-account save are impossible.
- Hidden identity, discriminator, and revision controls always come from the current
  server render.

## Phase 2 Correct conflict reload and retry

### Files to inspect and likely change

- `src/components/forms/conflict-controls.tsx`
- `src/features/profile/foundation-editors.tsx`
- `src/features/profile/profile-editor.tsx`
- `src/features/profile/onboarding-form.tsx`
- `tests/e2e/auth-profile.spec.ts`
- A focused unit test if mapping is extracted into pure helpers

### Required implementation behavior

1. Do not copy arbitrary server-record keys into matching form controls.
2. Reload Server Version must update only editable controls, then set hidden
   `expected_revision` from `latestRecord.revision` through a dedicated assignment.
3. Treat immutable/server fields as protected: `id`, `user_id`, timestamps,
   `revision`, generated fields, lifecycle fields, and the form discriminator.
4. Map an experience row's database field `kind` to the editable control
   `experience_kind`; never overwrite hidden `kind="experience"`.
5. Keep the existing explicit partial-date mapping. Unknown dates remain empty with
   precision `unknown`; year/month/day values remain canonical.
6. Reload must replace the draft with the server version and allow a subsequent edit
   and save without another conflict.
7. Review and Retry My Changes must retain local editable values, advance only
   `expected_revision`, and resubmit exactly once.

### Regression tests

- Create a profile conflict in two tabs. Choose Reload Server Version, verify the
  server value appears, edit it, save, and assert success without a repeated conflict.
- Create an experience conflict where the server changes `kind`. Reload, verify the
  correct `experience_kind` option, verify hidden `kind` is still `experience`, then
  save successfully.
- Retain the existing retry-local-draft scenario and assert that local fields remain.
- Add a partial-date conflict case so reload cannot fabricate or expose placeholder
  dates.

### Phase acceptance

- Both conflict actions terminate in a valid, saveable form.
- No server field can mutate record identity, ownership, or the form discriminator.

## Phase 3 Idempotent foundation create operations

This phase changes a cross-feature database contract. Keep it small and record the
final transaction design in a new decision log.

### Files to inspect and likely change

- New migration, suggested name:
  `supabase/migrations/20260916170000_t03_foundation_create_idempotency.sql`
- `supabase/tests/database/foundation.test.sql`
- `src/features/profile/foundation-actions.ts`
- `src/features/profile/foundation-editors.tsx`
- `src/components/forms/session-draft.ts` or a focused operation-key helper
- `src/server/supabase/database.types.ts`
- New decision: `docs/decisions/0004-foundation-create-idempotency.md`
- Unit and E2E tests

### Database contract

1. Add an internal operation ledger compatible with the plan's
   `operation_requests` extension. At minimum store:
   - authenticated `user_id`;
   - allowlisted operation kind;
   - client operation UUID;
   - input revision (`0` for a create with no existing source revision, documented
     explicitly);
   - canonical payload hash;
   - result table/type and result row ID;
   - creation/completion timestamps.
2. Enforce uniqueness on `(user_id, operation_kind, operation_key)`. The same UUID is
   allowed for a different user or a different operation kind.
3. Keep the table and helper functions outside the exposed PostgREST schema. Revoke
   access from `public`, `anon`, and `authenticated`; only narrow public RPC wrappers
   are callable by `authenticated`.
4. Prefer typed public RPCs for experience, education, certification, and skill
   creation. Each wrapper must derive the owner from `auth.uid()`, validate an exact
   payload allowlist, and execute the ledger plus domain insert in one transaction.
5. Use a canonical JSONB representation when hashing. If `pgcrypto` is introduced,
   install it explicitly in the `extensions` schema and schema-qualify `digest`.
6. Transaction behavior:
   - first request claims the operation key and creates one record;
   - concurrent identical requests wait/resolve to the same committed result;
   - a later identical request returns the original owned row;
   - the same key with a different payload raises a stable safe error and creates
     nothing;
   - rollback leaves neither a completed ledger entry nor a partial domain record.
7. Never trust `user_id` from the client payload. Retain RLS and database constraints
   as defense in depth.

### Application contract

1. New-record forms obtain a random operation UUID scoped to owner and form key.
2. Keep that UUID across validation errors, session expiry, ambiguous network failure,
   and retries. Rotate/remove it only after a confirmed successful response.
3. Do not reuse an operation UUID after the user changes the create payload following
   a completed operation. A payload change before completion may retain the UUID only
   if the prior request is known not to have committed; otherwise generate a new key.
   Prefer a simple UI rule that rotates after success and relies on the server's
   different-payload rejection for ambiguous cases.
4. Validate the UUID in the Server Action. Route creates through the new RPCs instead
   of direct `.insert(...)`; updates and deletes continue using their current
   revision-checked RPCs.
5. Map reused-key/different-payload and ownership failures to localized safe action
   results. Do not expose raw database messages.

### Database and application tests

- Same user + same kind + same key + same payload twice returns the same ID and leaves
  exactly one domain row.
- Same key + different payload is rejected and leaves the first row unchanged.
- Same key for two users is isolated and creates one owned row per user.
- Same key for two operation kinds does not collide.
- An unauthenticated call creates neither ledger nor domain row.
- Existing RLS, duplicate-skill, partial-date, and revision tests remain green.
- Add a concurrency test if the local PostgreSQL harness supports two sessions; do
  not claim concurrent idempotency verified from a sequential test.
- E2E or integration test an ambiguous/replayed create and assert only one record is
  visible.

### Phase acceptance

- Foundation create is atomic and safely repeatable.
- No direct non-idempotent create remains in `saveFoundationAction`.
- Generated database types match the migrated local schema before T03 can become
  `DONE`.

## Phase 4 Integrated verification and documentation

Run checks in this order and record exact exit status and counts:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:status
pnpm db:reset
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm typecheck
pnpm test:e2e:auth
```

After `pnpm db:types`, inspect and check in the generated
`src/server/supabase/database.types.ts`; do not retain a manually guessed signature.
Use the repository's local Supabase/Auth/Mailpit stack only. Do not access a hosted
project or production account.

If Docker or child-process execution is blocked:

- finish independent code and unit/build checks;
- record the exact blocked command and error;
- do not mark database concurrency, Mailpit recovery, or two-account E2E as passed;
- keep T03 `PARTIAL` with a concrete next command for an environment that can run it.

Update:

- `docs/verification/T03-auth-profile.md` with new files, migration, decision,
  regression evidence, and actual commands;
- `docs/IMPLEMENTATION_STATUS.md` with the remediation status and remaining blockers.

Do not modify the PRD, flow, wireframe, or database-schema DOCX files.

## Final handoff format

Luna's final response must include:

1. outcome first;
2. files and migration added or changed;
3. the three repaired invariants and their evidence;
4. commands actually run with results;
5. commands not run and the concrete blocker;
6. whether T03 remains `PARTIAL` or is now `DONE`, without overstating acceptance.

## Copyable execution prompt for Luna

```text
Implement the remediation in docs/verification/T03-remediation-plan.md for
WorkPulse T03. Use gpt-5.6-luna with max reasoning. Read the repository instructions,
current T03 checkpoint, required source sections, and current code before editing.

Work sequentially through Phase 1 draft isolation, Phase 2 conflict handling,
Phase 3 idempotent foundation create, and Phase 4 verification. Complete and verify
each phase before starting the next. Keep changes within T03; do not begin T04 or
modify source DOCX files.

Preserve these invariants: owner identity comes from the authenticated server session;
drafts never cross account boundaries or persist passwords/server-controlled fields;
conflict reload/retry preserve the intended version semantics; foundation creates are
atomic and idempotent for retry and concurrent replay; database and action errors are
localized and do not disclose foreign records.

Run every available check in the plan. If Docker/Supabase/Mailpit is unavailable,
finish independent work, record the exact blocker, and leave T03 PARTIAL. Update the
T03 verification and implementation status with evidence only after implementation.
Finish with changed files, migration/decision, test results, remaining limitations,
and the truthful T03 status.
```

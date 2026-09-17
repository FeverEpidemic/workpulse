# T03 Auth and profile verification

Date: 16 September 2026

Status: **DONE.** All T03 local acceptance gates pass: generated database types match
the local schema; clean reset on a disposable Supabase project applied all migrations
and seed; pgTAP passes 117/117; DB lint reports no schema errors; and the
Mailpit-backed Auth/Profile Playwright flow passes. Lint, typecheck, 43 unit tests, and
production build also pass. The original WorkPulse DB volume was preserved and
restarted. Hosted SMTP and production email readiness are not claimed.

## T03 remediation completed

The remediation follows the four phases in
[T03-remediation-plan.md](T03-remediation-plan.md) without starting T04:

1. Draft storage now uses versioned keys scoped by authenticated profile ID and form
   key. Legacy unscoped keys are removed; only editable content controls are stored;
   passwords, hidden/server fields, and record identity/revision fields are excluded.
   Sign-out clears the current owner's drafts.
2. Conflict reload/retry uses an allowlist per form. Reload maps experience database
   kind to the experience-kind control and copies only recognized partial-date fields.
   It updates expected revision through a separate check. Retry preserves local input,
   advances only expected revision, and submits once.
3. Experience, education, certification, and skill creates now use authenticated
   typed RPCs. The owner comes from auth.uid(); operation UUIDs persist across failed
   and ambiguous attempts and rotate after success. An internal ledger hashes
   canonical JSONB and commits with the domain row. Same-payload replays return the
   original owned result; different payloads receive a stable localized conflict.
4. Phase 4 checks now pass for lint, typecheck, unit tests, build, generated type parity,
   local DB lint, pgTAP, Auth/Profile Playwright, and clean reset on a disposable local
   Supabase project. A separate two-session concurrency check confirms identical replay
   returns one owned row; the existing WorkPulse volume was preserved.
5. Fixed the test defects behind the prior failures: pgTAP table/column checks now use
   SQL boolean expressions instead of combining TAP text with `AND`; Playwright waits
   for stable save/delete results and opens disclosures idempotently; successful
   onboarding draft cleanup runs after the dashboard redirect. Recovery accepts the
   local Auth `otp` AMR only after a verified `type=recovery` callback.

## Scope and source mapping

| Source contract | T03 implementation |
| --- | --- |
| PRD R01 | Email/password sign-in and sign-up, confirmation, neutral recovery response, password update, session-expiry draft recovery, locale and profile settings. |
| User Flow F01 | Lifecycle routing for anonymous/provisional/completed users, safe return path, manual onboarding, and import-unavailable state pending T17. |
| Wireframe S01 | Sign-in, create-account, verification pending, recovery, and password update screens. |
| Wireframe S12 | Name-only provisional onboarding and complete profile/foundation workspace. |
| Database Schema profile/foundation contract | Owner from server session, profile expected-revision RPCs, atomic onboarding migration, and T02 revision-checked foundation update/delete RPCs. |
| Implementation Plan T03 | Cookie SSR, request-scoped AuthAdapter, `src/proxy.ts`, local email templates, en/id messages, safe action results, and profile/foundation editors. |

The source DOCX files and `Design.md` were read for this task and were not changed.

## Implementation scope

- Supabase SSR clients are created per request/action. The proxy refreshes auth cookies
  and optimistically redirects protected document GET/HEAD requests; Server Components
  and Server Actions check the current server session, and RLS/RPCs enforce ownership.
- `/`, `/sign-in`, `/auth/confirm`, `/update-password`, `/onboarding/import`,
  `/settings/profile`, and `/dashboard` implement the T03 route lifecycle. Return paths
  are allowlisted, callback secrets are removed before redirect, and auth redirects use
  `WORKPULSE_SITE_URL` rather than a request host.
- Onboarding requires only display name. Locale is `en`/`id` with a pre-login cookie
  fallback; the profile is canonical after authentication. Timezone is detected from
  the browser with `UTC` fallback and can be edited.
- A full profile editor saves all T02 editable profile fields using `expected_revision`.
  Conflicts retain the local draft and expose server reload or explicit retry. Session
  expiry preserves form values in `sessionStorage` and excludes passwords.
- Foundation create/list/edit/delete is wired for experience, education,
  certification, and skill. Inserts derive `user_id` from the authenticated server
  session. Existing-row changes use T02 revision-checked RPCs. Date inputs normalize
  unknown/year/month/day values to the database representation. Experience deletion
  shows linked project count and context-retention behavior.
- Local confirmation and recovery templates use `token_hash`; local email capture is
  configured through Mailpit. Production SMTP readiness is not claimed.
- Added a Playwright flow covering confirmation, onboarding, sign-in/out, safe return,
  profile locale/revision conflicts, expired-session draft recovery, all four
  foundation editors, password recovery, and owner isolation.

## Files changed

- Root configuration: `.env.example`, `README.md`, `package.json`, `pnpm-lock.yaml`,
  `next.config.ts`, `vitest.config.ts`, `playwright.auth.config.ts`.
- App routes/layout: `src/app/layout.tsx`, `src/app/page.tsx`,
  `src/app/sign-in/page.tsx`, `src/app/auth/confirm/route.ts`,
  `src/app/update-password/page.tsx`, `src/app/onboarding/import/page.tsx`,
  `src/app/settings/profile/page.tsx`, `src/app/dashboard/page.tsx`,
  `src/app/globals.css`, `src/proxy.ts`.
- UI and domain: `src/components/forms/`, `src/domain/auth/route-state.ts`,
  `src/domain/dates/partial-date.ts`, `src/domain/routes/safe-return.ts`,
  `src/features/auth/`, `src/features/profile/`, `src/i18n/messages.ts`.
- Server boundary: `src/server/action-result.ts`, `src/server/auth/`,
  `src/server/locale/`, `src/server/supabase/` including the checked-in
  `database.types.ts` contract.
- Supabase: `supabase/config.toml`,
  `supabase/migrations/20260916150000_auth_onboarding_locale_timezone.sql`,
  `supabase/templates/confirmation.html`, `supabase/templates/recovery.html`,
  `supabase/tests/database/foundation.test.sql`.
- Tests: `tests/e2e/auth-profile.spec.ts`, `tests/e2e/smoke.spec.ts`,
  `tests/unit/action-result.test.ts`, `tests/unit/auth-errors.test.ts`,
  `tests/unit/auth-routing.test.ts`, `tests/unit/partial-date.test.ts`,
  `tests/unit/recovery-session.test.ts`, `tests/unit/profile-validation.test.ts`;
  removed the T01 root-shell test whose
  assertion became obsolete when `/` gained lifecycle routing.
- Records: `docs/decisions/0003-auth-session.md`,
  `docs/verification/T03-auth-profile.md`, `docs/IMPLEMENTATION_STATUS.md`.

Additional T03 remediation files:

- src/components/forms/session-draft.ts, src/components/forms/conflict-controls.tsx,
  and new src/components/forms/operation-key.ts.
- New src/features/auth/sign-out-form.tsx; updated src/app/dashboard/page.tsx and
  src/app/settings/profile/page.tsx; new
  src/features/profile/onboarding-draft-cleanup.tsx and
  src/server/auth/recovery-session.ts.
- Updated src/features/profile/onboarding-form.tsx,
  src/features/profile/profile-editor.tsx, src/features/profile/foundation-editors.tsx,
  src/features/profile/foundation-actions.ts, src/i18n/messages.ts, and
  src/server/supabase/database.types.ts.
- New tests/unit/session-draft.test.ts, tests/unit/conflict-mapping.test.ts, and
  tests/unit/operation-key.test.ts; expanded tests/e2e/auth-profile.spec.ts and
  supabase/tests/database/foundation.test.sql.
- New migration supabase/migrations/20260916170000_t03_foundation_create_idempotency.sql
  and decision docs/decisions/0004-foundation-create-idempotency.md.
- Updated this verification record and docs/IMPLEMENTATION_STATUS.md.

## Migration and decisions

Migration `20260916150000_auth_onboarding_locale_timezone.sql` replaces
`complete_onboarding(text, integer)` with
`complete_onboarding(text, text, text, integer)`. It takes identity from `auth.uid()`,
uses the existing profile row lock/revision helper, validates the display name,
locale, and catalog timezone, then stores those fields and completion time in one
revision-checked update. `docs/decisions/0003-auth-session.md` records the SSR/session,
trusted redirect, lifecycle, recovery, draft, and local SMTP boundaries.

The migration is applied and recorded in the local migration history. `pnpm db:types`
was run against the local Supabase schema, and its output matches the checked-in
`src/server/supabase/database.types.ts` exactly after line-ending normalization. The
generated contract includes the T03 onboarding signature and foundation RPCs.

The T03 remediation migration is
`20260916170000_t03_foundation_create_idempotency.sql`. Local migration listing shows
version `20260916170000` on both the repository and local database; `supabase db push`
reports the local database is up to date. It creates the private operation ledger and
four authenticated create RPCs. Decision `0004-foundation-create-idempotency.md`
records the owner, payload-hash, conflict, and concurrency semantics. The RPC
signatures are present and exercised in the pgTAP suite and in the regenerated
database contract. `pnpm db:test` passes against the local Supabase database.

## Remediation acceptance

- [x] Draft keys are scoped by owner and form; passwords, hidden fields, and
      server-controlled fields are excluded. Unit coverage passes.
- [x] Conflict reload copies only explicit editable fields and known partial dates;
      retry preserves local values and changes only expected revision. Unit coverage
      passes. The Auth/Profile E2E flow also passes.
- [x] Foundation creates use typed authenticated RPCs and no direct insert remains in
      saveFoundationAction. The operation UUID survives unsuccessful/ambiguous
      attempts and rotates only after success.
- [x] Identical replay returns the original row; a changed payload with the same key
      is rejected; ownership and error privacy assertions are in pgTAP.
- [x] Local PostgreSQL pgTAP suite: 117/117 assertions pass. A separate two-session
      replay check confirms the competing call waits for commit, receives the same
      result ID, and leaves one skill and one ledger row; the test row was removed.
- [x] Phase 4 install, lint, typecheck, full unit suite, build, and local DB lint pass.
- [x] Generate the database type contract from the migrated local schema and verify
      exact parity with the checked-in generated file.
- [x] Run Auth/Mailpit Playwright acceptance with local email confirmation enabled.
- [x] Run `pnpm db:reset` against disposable project
      `workpulse-t03-disposable-20260916`; all five migrations and the seed script
      completed from zero, followed by pgTAP and DB lint. The existing WorkPulse volume
      was preserved.

## Acceptance checklist

Code and static evidence:

- [x] Exact requested dependency versions are pinned in the manifest and lockfile.
- [x] Cookie-based request-scoped SSR and optimistic proxy refresh/redirect are
      implemented; actual writes still check server identity and use RLS/RPC ownership.
- [x] Safe-return sanitizer rejects external, malformed, callback, unsupported, and
      duplicate-filter destinations; unit tests cover these cases.
- [x] Signup, sign-in, confirmation, sign-out-local, neutral recovery, and
      recovery-session password update actions are implemented with safe error mapping.
      Token-hash recovery requires a verified `type=recovery` callback, a short-lived
      HttpOnly recovery-flow cookie, and recent verified `otp`/`recovery` AMR proof;
      PKCE without a callback type requires recent `recovery` proof.
- [x] Routes follow anonymous/provisional/completed lifecycle; import is unavailable
      pending T17; empty dashboard has no fabricated career rows.
- [x] Name-only onboarding submits the atomic locale/timezone/revision RPC; the new
      migration and pgTAP assertions are present.
- [x] Profile and four foundation editors use server validation, session-derived owner,
      expected revisions for existing rows, and canonical partial-date normalization.
- [x] en/id messages exist for auth, onboarding, profile, validation, and errors.
- [x] The Mailpit-backed Auth/Profile Playwright flow and updated T02/T03 pgTAP
      assertions execute successfully against the local Supabase stack.
- [x] `pnpm install --frozen-lockfile`, `pnpm lint`, and `pnpm typecheck` exit 0.
- [x] Full `pnpm test` passes: 11 files, 43/43 tests.
- [x] T03 migration is applied and recorded in the local database; the onboarding
      RPC has the new four-argument signature.
- [x] The actual foundation pgTAP file runs against local PostgreSQL: 117 assertions,
      zero failures, plan `1..117`, and the test transaction rolled back.
- [x] `pnpm db:lint` exits 0 with no schema errors.

Local runtime acceptance:

- [x] `pnpm db:types` generated a contract matching the checked-in
      `src/server/supabase/database.types.ts` after line-ending normalization.
- [x] `pnpm test:e2e:auth` passes signup/confirmation, onboarding, recovery/password
      update, two-user isolation, profile conflicts, draft restore, foundation CRUD,
      partial dates, and sign-out using local Supabase Auth and Mailpit.
- [x] Local Auth reports signup enabled and `mailer_autoconfirm=false`; actual
      confirmation and recovery emails were read from Mailpit during Playwright.
- [x] Tested application callbacks use `WORKPULSE_SITE_URL`.
- [x] Clean reset on disposable project `workpulse-t03-disposable-20260916` applied
      all five migrations and seed. A SQL assertion verified fixture counts: 2 auth
      users, 2 completed profiles, 1 education, 2 experiences, 1 project, and 2 skills.
      The following pgTAP and DB lint runs passed on that fresh database.
- [x] The disposable containers and volumes were removed afterward; the original
      `supabase_db_WorkPulse` volume remained present and its stack was restarted.
- No production SMTP or hosted redirect acceptance has been attempted.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; lockfile is consistent and dependencies already installed. |
| `pnpm lint` | Exit 0; zero warnings. |
| `pnpm typecheck -- --incremental false` | Exit 0; TypeScript check passed. |
| `pnpm test` | Exit 0; 11 files, 43 tests passed using native config loading. |
| `pnpm build` | Exit 0; Next production build and route generation completed. |
| `node workers/check.ts` | Exit 0; emitted the expected worker readiness JSON. |
| `supabase db push --db-url <local PostgreSQL> --yes` | Exit 0; local database reports up to date. |
| `supabase migration list --db-url <local PostgreSQL>` | Exit 0; local and database both include migration `20260916170000`. |
| Temporary Node PostgreSQL protocol runner over `foundation.test.sql` | Exit 0; 117 pgTAP assertions, 0 failures, plan `1..117`; transaction rolled back. Temporary runner removed. |
| Two-session local PostgreSQL replay check | Exit 0; second same-key request waited for first commit, both returned the same ID, and counts were one skill and one ledger row; test data was removed. |
| `pnpm db:lint` | Exit 0; no schema error output. |
| `pnpm db:types` | Exit 0; generated output compared to checked-in types and matched exactly after line-ending normalization. |
| `pnpm db:test` | Exit 0; 1 file, 117 assertions, zero failures. |
| `pnpm test:e2e:auth` | Exit 0; 1 Playwright test passed (22.1s test, 37.6s total) against local Supabase Auth and Mailpit. |
| Local Auth settings `GET /auth/v1/settings` | Signup enabled, `mailer_autoconfirm=false`; confirmation and recovery emails were consumed from Mailpit. |
| `pnpm run db:reset -- --local --workdir <disposable project> --yes` | Exit 0; applied all five migrations and `supabase/seed.sql` from zero. Disposable project ID: `workpulse-t03-disposable-20260916`. |
| Seed fixture assertion on the disposable database | Exit 0; 2 auth users, 2 completed profiles, 1 education, 2 experiences, 1 project, and 2 skills. Any mismatch would raise a SQL exception. |
| `pnpm run db:test -- --workdir <disposable project>` | Exit 0; 1 file, 117 assertions, zero failures after clean reset. |
| `supabase db lint --level error --workdir <disposable project>` | Exit 0; no schema errors after clean reset. |
| WorkPulse stack restoration | Exit 0; DB/Auth/Kong healthy, all five migrations remain applied, Auth reports `mailer_autoconfirm=false`, and `supabase_db_WorkPulse` still exists. |

No hosted database, hosted Supabase project, production SMTP, or real user account was
accessed; the E2E flow used synthetic accounts in the local Supabase stack.

## Closeout

All T03 local acceptance gates are complete, so T03 is DONE. The original WorkPulse
volume remains intact. Hosted SMTP, hosted redirect configuration, and production
email delivery remain separate integration work before deployment; this verification
does not claim production email readiness.

## T03 review remediation completed — 17 September 2026

Status: **DONE for local T03 acceptance.** This dated checkpoint extends the earlier
117-assertion evidence above; the original checkpoint remains historical.

- Migration `20260916190000_t03_foundation_contract_hardening.sql` revokes direct
  authenticated `INSERT` on experiences, education, certifications, and skills. It
  adds matching profile/foundation database limits and URL/canonical-null checks after
  a data preflight. Incompatible existing values stop migration instead of being
  truncated or rewritten. Shared Zod/UI limits live in
  `src/domain/profile/field-contract.ts`; SQLSTATE `23514` maps to a safe localized
  validation result.
- `internal.operation_requests.result_payload` stores the first create result in the
  same transaction as its domain row. Identical replay returns that snapshot after
  edit/delete; a different payload for the same key returns the stable conflict. Owned
  live rows are backfilled. A previously deleted legacy result receives the explicit
  unavailable marker instead of invented data.
- The expanded pgTAP suite verifies the four INSERT revokes, rejected direct inserts,
  successful typed create RPCs, oversized create/update rejection, invalid URLs,
  ownership, and replay after edit/delete. The first run found two test-fixture
  mismatches (padded duplicate skill and an experience row deleted earlier in the test);
  those assertions were corrected to reach the intended uniqueness/length constraints.
  The final suite passes **139/139** on both the original local database and the clean
  disposable database.
- A two-session replay check held the first authenticated create transaction open while
  the second session submitted the same owner, key, and payload. Both returned the same
  ID. The database contained one skill and one ledger row; the ledger snapshot matched
  the row. The exact test fixture was removed afterward.
- Disposable reset project `workpulse_t03_t04_20260917` ran all six migrations and
  `supabase/seed.sql` from zero. Seed counts were 2 auth users, 2 completed profiles,
  2 experiences, 1 education, 1 project, and 2 skills. pgTAP passed 139/139 and DB lint
  reported no schema errors. Its containers, volume, network, and temporary project
  folder were removed after confirming the original `supabase_db_WorkPulse` remained.
- The new local typegen output is byte-equivalent to
  `src/server/supabase/database.types.ts` after line-ending normalization. No generated
  public RPC signature changed, so that file did not need editing.
- Final Auth/Mailpit Playwright acceptance passes **1/1** with synthetic local accounts,
  including sign-in/onboarding error association, profile conflict recovery, partial
  date correction, foundation CRUD, duplicate-skill field error, cross-account Quick
  log draft isolation, password recovery, and sign-out cleanup.

### Remediation commands and results

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; lockfile consistent, dependencies already installed. |
| `pnpm lint` | Exit 0; zero warnings. |
| `pnpm typecheck -- --incremental false` | Exit 0. |
| `pnpm test` | Exit 0; 15 files, 55/55 tests. |
| `pnpm build` | Exit 0; production build and route generation completed. |
| `pnpm db:status` | Exit 0; `linked_project: null`. Only the local WorkPulse stack was used. |
| `supabase migration list --local` | Exit 0; all six repository migrations, including `20260916190000`, are recorded locally. |
| `pnpm db:test` | Exit 0; 1 file, 139/139 assertions. |
| `pnpm db:lint` | Exit 0; no schema errors. |
| `pnpm db:types` parity comparison | Exit 0; generated output matches `database.types.ts` exactly after line-ending normalization. |
| `pnpm db:reset -- --local --workdir <disposable project> --yes` | Exit 0; all six migrations and seed completed from zero on the unique disposable project. |
| `pnpm db:test -- --workdir <disposable project>` | Exit 0; 1 file, 139/139 assertions. |
| `pnpm db:lint -- --workdir <disposable project>` | Exit 0; no schema errors. |
| `pnpm test:e2e:auth` | Exit 0; 1 Auth/Profile test passed against local Supabase Auth and Mailpit. |

No hosted Supabase, production SMTP, production redirect, or real user account was
accessed. The local Auth/Mailpit run does not establish production email readiness.

# T02 Foundation schema verification

Date: 16 September 2026

Status: DONE — the foundation schema and review follow-up migrations are applied
to local PostgreSQL 17. All 94 pgTAP assertions pass and database lint reports no
schema errors.

## Scope and source mapping

| Source contract | Implementation |
| --- | --- |
| Database Schema §1, ownership | `profiles.id` references `auth.users.id`; every other foundation table owns a `user_id` profile FK and `UNIQUE(user_id, id)`. Project context uses a composite `(user_id, experience_id)` FK. |
| Database Schema §1, dates and revisions | Partial dates preserve canonical precision and unknown values. Existing-row updates lock the owned record, compare `expected_revision`, and advance revision exactly once. |
| Database Schema §2, profiles and indexes | Auth trigger plus idempotent backfill provision a neutral profile; six foundation tables and the requested date/status/context indexes are present. |
| Database Schema §6, access and migration order | RLS remains enabled on all six tables. Authenticated users cannot directly `UPDATE` or `DELETE`; owner-scoped RPCs enforce the revision contract. `anon` has no table or RPC privileges. |
| PRD R01, shared validation | Display name gates onboarding completion; contact fields are optional; locale is `en`/`id`; timezone names are checked against `pg_timezone_names`; career required names are nonblank. |
| User Flow F01 | A fresh graduate can finish onboarding without employment or CV; education dates can remain unknown. The two-user fixture has that graduate and an employee with overlapping experiences. |
| Implementation Plan §4 | T02 finalizes provisional profile lifecycle. Jobs/idempotency, import, cleanup, evidence, activities/achievements, and CV data remain deferred to their task owners. |

## Review follow-up

1. Direct table `UPDATE` and `DELETE` grants for `authenticated` were revoked.
   Profile and foundation edits use RPCs that derive the owner from `auth.uid()`,
   lock the row, compare `expected_revision`, and reject stale writes. RPC patches
   reject IDs, owner IDs, timestamps, revisions, and other non-editable fields.
2. `update_profile` accepts only profile content and preferences. Onboarding
   completion assigns its timestamp in the database. AI consent and account
   deletion state are writable only through narrow `internal` operations granted
   to `service_role`; the browser role cannot execute them.
3. Timezone validation now accepts exact names present in PostgreSQL's timezone
   catalog, including `CET` and `Japan`, and rejects unknown names.

The row-count check for dynamic SQL uses `GET DIAGNOSTICS ... ROW_COUNT`; PL/pgSQL's
`FOUND` flag is not updated by `EXECUTE ... INTO`.

## Files changed

- `supabase/migrations/20260916090000_foundation_schema.sql`
- `supabase/migrations/20260916120000_secure_foundation_mutations.sql`
- `supabase/migrations/20260916124500_fix_foundation_rpc_row_checks.sql`
- `supabase/seed.sql`
- `supabase/tests/database/foundation.test.sql`
- `package.json`
- `README.md`
- `docs/decisions/0002-foundation-schema.md`
- `docs/verification/T02-foundation-schema.md`
- `docs/IMPLEMENTATION_STATUS.md`

No new package was added; `pnpm-lock.yaml` is unchanged. Source DOCX files, `Design.md`,
and `IMPLEMENTATION_PLAN.md` were not edited.

## Acceptance checklist

- [x] Auth insert creates a provisional profile; the backfill is idempotent; onboarding
      completion requires a real display name and is a revision-checked operation.
- [x] Partial-date, URL, enum, timezone, and normalized-skill constraints are defined.
- [x] Composite ownership FK, required indexes, six-table RLS, and owner policies are
      present; anonymous table access is revoked.
- [x] Authenticated direct `UPDATE` and `DELETE` on profiles and foundation rows are
      denied by grants. User-editable updates use allowlisted, revision-checked RPCs.
- [x] Profile consent, onboarding, and deletion lifecycle fields cannot be changed by
      profile content patches. Consent/deletion operations are limited to `service_role`.
- [x] `delete_experience` retains its ordered related-project locks, context clearing,
      owner scoping, and expected-revision check. Education, certification, project,
      and skill deletion RPCs also require an expected revision.
- [x] `CET` and `Japan` are accepted from the PostgreSQL timezone catalog; an unknown
      timezone name is rejected.
- [x] Two deterministic local-only auth fixtures cover a graduate with unknown
      education dates and an employee with overlapping employment.
- [x] The pgTAP transaction/rollback suite covers schema, isolation, cross-owner writes
      and FK, date/skill constraints, direct-mutation rejection, profile lifecycle,
      revision conflicts, timezone names, and atomic deletion: 94/94 assertions pass.
- [x] `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass; Vitest reports 8/8 tests.
- [x] `pnpm db:lint` reports no schema errors.
- [x] The base migration previously passed a clean PostgreSQL 17 reset with seed. Both
      review migrations applied in order with `supabase migration up` to the running
      local database, then pgTAP and database lint passed.

## Commands and results

Review follow-up verification:

- `pnpm lint`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm test`: exit 0; all 3 unit files and 8/8 tests passed.
- `pnpm exec supabase migration up`: exit 0; applied
  `20260916120000_secure_foundation_mutations.sql` and
  `20260916124500_fix_foundation_rpc_row_checks.sql` to the local database.
- `pnpm db:test`: exit 0; 1 file, 94 assertions, 0 failures.
- `pnpm db:lint`: exit 0; `extensions`, `internal`, and `public` report no schema
  errors.
- `pnpm db:status`: exit 0; `linked_project: null`, confirming no hosted project was
  linked or contacted.
- `pnpm build`: exit 0 at the prior T02 checkpoint. It was not rerun because the
  review follow-up changed only SQL, pgTAP, and documentation.

The shell sandbox blocked Vitest child-process spawning and Docker named-pipe access;
the relevant local checks were rerun with local process access. No hosted database was
used.

## Open limitation and next step

`pnpm db:reset` was not repeated after the review migrations because it would replace
the contents of the active local database. The earlier clean reset verified the base
schema and seed; the two follow-up migrations applied successfully in order to that
database and passed pgTAP plus database lint. The optional vector container remains
unavailable and is not used by T02. T03 (Auth and profile) is next.

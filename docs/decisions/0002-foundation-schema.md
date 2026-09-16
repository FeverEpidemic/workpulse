# Decision 0002 Foundation schema and profile lifecycle

Date: 16 September 2026

Status: accepted for WorkPulse MVP v0.1

## Context

T02 needs a root profile for every Supabase Auth user before onboarding or import can
complete. The database contract also requires partial career dates, optimistic
revisions, and tenant-safe context links. The source schema leaves the exact
provisional-profile lifecycle open, and implementation-plan §4 defers several
cross-feature tables to their owning tasks.

## Decisions

1. A trigger on `auth.users` creates `public.profiles` with `display_name = 'Pending
   onboarding'`, locale `en`, timezone `UTC`, and no onboarding timestamp. A migration
   backfill inserts any missing profiles with `ON CONFLICT DO NOTHING`; it does not
   alter existing user-authored fields. The provisional row supports foreign keys but
   is not a completed workspace profile and must not be used as a CV/export name.
   Completion requires a non-placeholder display name and
   `onboarding_completed_at IS NOT NULL`. Import and onboarding flows must preserve
   that invariant when they arrive.
2. `internal` is the unexposed helper schema. It contains database-side skill
   normalization, canonical partial-date and date-bound checks, timezone validation
   against `pg_timezone_names`, and shared revision/context and lifecycle helpers. The
   PostgREST schema list stays `public, graphql_public`; lifecycle operations are
   granted only to the trusted service role.
3. Partial dates are stored canonically: January 1 for `year`, day 1 for `month`, and
   the actual date for `day`. Unknown values are `(NULL, NULL)`. A range is rejected
   only when the latest possible end date is earlier than the earliest possible start
   date. This preserves valid overlapping history and avoids inventing certainty from
   partial dates. A current row must have a null end date and precision.
4. Every mutable update keeps its original ID and creation timestamp, ignores a
   revision supplied by the caller, sets `updated_at`, and advances revision exactly
   once. Authenticated edits use RPCs that derive owner from `auth.uid()`, lock the
   target row, and compare `expected_revision`; a stale revision raises
   `STALE_REVISION`. Direct `UPDATE` and `DELETE` table privileges are revoked from
   `authenticated` so a caller cannot omit the compare-and-swap condition.
5. Projects reference experiences through `(user_id, experience_id)`. Experience
   deletion is exposed as `public.delete_experience(id, expected_revision)`, which
   checks `auth.uid()`, locks the owned experience, rejects a stale revision, locks
   linked projects in ID order, clears context through normal project updates, and
   deletes the experience in the same transaction. A foreign/missing ID returns no
   row. The foreign key's delete action also nulls only `experience_id` as a final
   integrity guard; revision triggers apply to each changed project. Education,
   certification, project, and skill updates/deletes also use owner-scoped RPCs with
   expected revisions.
6. Skill labels are trimmed, whitespace runs are collapsed, and text is lowercased
   for `normalized_name`; uniqueness is per user. We do not add transliteration,
   stemming, aliases, or proficiency.
7. Profile content updates use `public.update_profile(expected_revision, patch)` with
   an allowlist for user-editable content and preferences. We do not grant direct
   profile column updates to `authenticated`: even a column-only grant would let a
   caller bypass revision comparison. Onboarding has a dedicated operation that sets
   its completion timestamp in the database. AI consent and account-deletion lifecycle
   state use narrow `internal` operations available only to `service_role`.

Authenticated clients may select foundation rows and insert new user-owned career rows.
They cannot directly update or delete base rows; edits use revision-checked functions
and deletes use the table-specific operation (experience deletion retains its context
cleanup semantics). The profile is auth-provisioned and has no direct client write
privilege. Account-deletion orchestration, cleanup queueing, and session revocation
remain T23 scope; `internal.mark_account_deleting` only changes the guarded lifecycle
flag. Existing RLS owner policies remain in place, and `anon` has no table/RPC access.
The trusted `service_role` retains its server-side table privileges.

## Scope boundary

This migration contains only profiles, experiences, education, certifications,
projects, and skills, plus their tenant and lifecycle primitives. The implementation
plan's extension points for operation idempotency, durable jobs/leases, import staging
and commit, cleanup queues, evidence, activities/achievements, and CV snapshots remain
owned by T05–T23 as applicable. T02 does not create placeholder tables or change source
DOCX documents.

## Consequences

- Auth sessions may exist while onboarding is incomplete; T03 must gate workspace and
  CV behavior on the profile lifecycle rather than assuming profile existence means
  onboarding is complete.
- T02 can create foundation records and exercise revision-checked mutation paths
  without an application client. Direct client updates/deletes and writes to profile
  lifecycle state are unavailable; T03 and T13 integrate the intended operations.
- Foundation CRUD and two-account isolation can be verified in pgTAP against the local
  PostgreSQL stack before the later UI tasks are integrated.

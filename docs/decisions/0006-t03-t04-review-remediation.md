# 0006 — T03/T04 review remediation

- Status: accepted
- Date: 17 September 2026
- Scope: T03/T04, R01/R04, F01/F02, S01/S05/S12

## Context

The post-acceptance review found four gaps: authenticated clients could insert
foundation records outside the idempotent create RPCs; create replay read a live row;
browser Back/Forward could discard Quick log input; and field errors were not always
referenced by their controls. The remediation keeps T03/T04 scope and uses local-only
verification.

## Decisions

1. **Make the typed create RPCs the foundation insert boundary.** Revoke direct
   `INSERT` from `authenticated` on experiences, education, certifications, and skills.
   Keep existing owner checks, RLS, and revision-checked update/delete RPCs. Put the
   profile and foundation field limits in shared TypeScript constants and matching
   database constraints. A migration preflight rejects incompatible existing values
   without rewriting them. Credential and website URLs must use HTTP(S). Map SQLSTATE
   `23514` and other input constraint failures to localized validation results without
   returning PostgreSQL messages. Mutation identity continues to come from
   `auth.uid()` and the server session.
2. **Store the create result in the private operation ledger.** On first success, write
   `result_table`, `result_id`, and `result_payload` in the same transaction as the
   domain insert. Identical replay returns this snapshot after later edits or deletion;
   the same key with a different canonical payload returns the existing stable conflict.
   Migration backfills snapshots only when the owned result row still exists. A legacy
   ledger entry whose row is already gone receives an explicit
   `{"__legacy_replay":"unavailable"}` marker and returns a deterministic unavailable
   result; the migration does not invent deleted data.
3. **Guard same-document Back/Forward with the existing unsaved form contract.** Wrap
   the standard History API while preserving App Router state and track traversals that
   would leave a dirty form. Stay restores the source URL and focus; Continue performs
   the pending traversal once. Link navigation and `beforeunload` checks remain in place.
4. **Use the existing owner-scoped session draft for Quick log.** The draft key uses
   the authenticated profile UUID and form key, never an email or global key. It stores
   only `raw_text`; sign-out clears the current owner's drafts. Quick log remains
   unsaved while its save action is unavailable, and its draft remains until Activity
   persistence is implemented in T07.
5. **Require a deterministic ID for every field error.** Each control references its
   error through `aria-describedby` while retaining help-text references. Invalid
   controls set `aria-invalid`; validation text stays outside the label, and field
   errors use polite status announcements. Session drafts are restored after all action
   errors so correcting a partial date does not lose its other parts.
6. **Run Axe against WCAG A/AA tags without severity filtering.** The Playwright helper
   checks WCAG 2.0, 2.1, and 2.2 A/AA tags on representative routes and real validation
   or conflict states. No violation waiver was needed.

## Consequences

- Forward-only migration
  `supabase/migrations/20260916190000_t03_foundation_contract_hardening.sql`
  hardens field constraints and stores replay snapshots. It was applied to the original
  local WorkPulse database and verified from zero on a separate disposable local
  project. No T01–T04 migration was edited.
- The shared field contract lives in `src/domain/profile/field-contract.ts`; error
  bindings and browser-history state transitions have focused unit tests.
- Verification and acceptance evidence are recorded in
  `docs/verification/T03-auth-profile.md`,
  `docs/verification/T04-design-system-app-frame.md`, and
  `docs/IMPLEMENTATION_STATUS.md`.
- Hosted Supabase, production SMTP, and deployment remain outside this local
  remediation. T05 remains the next implementation task; Gate M1 remains open until its
  acceptance is complete.

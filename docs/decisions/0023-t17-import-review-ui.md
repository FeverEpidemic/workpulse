# Decision 0023 — T17 import review UI and onboarding

Date: 30 September 2026

Status: accepted for WorkPulse MVP v0.1 (local acceptance; see `docs/verification/T17-import-review-ui.md`)

References: PRD R02, §3, *Shared validation*, release scenario *Import an Indonesian CV with overlapping employment dates*; User Flow F01 steps 3–6,
*Import exceptions*, manual path S02 → S12 → S04; Wireframe S02, S03 (`/imports/:id/review`), S04, S12; Database Schema §4 (through the T16 RPCs, unchanged);
implementation plan §1, §3, §5 T17; handoff `docs/verification/T17-implementation-plan.md`; gate review `docs/verification/T17-review-remediation-plan.md`.

## Context

T16 persists review choices and commits a batch atomically, but nothing rendered them. T17 adds S03 on top of those RPCs so a user can correct candidates,
choose Create/Map/Skip, confirm achievements one by one, finish onboarding in the same commit, and reach the dashboard; returning users must be able to import too.

## Decisions

1. **No migration.** `import_items` and `import_batches.commit_result` are owner-readable through RLS; writes go only through `update_import_item`, `validate_import_batch`,
   `commit_import_batch` and `cancel_import_batch`. Parity stays 26/26. Purge of abandoned `review` batches stays with T23; S03 offers *Cancel import* so the user can end one.
   Approved by the user on 30 September 2026.
2. **S03 lives outside the workspace frame** at `src/app/imports/[id]/review/page.tsx`, because `requireCompletedWorkspace` redirects provisional accounts and F01 puts S03 before S04.
   Own guard: no session → `/sign-in?returnTo=` (allowlisted as `/imports/<uuid>/review` in `safe-return.ts`); no profile → `serviceUnavailable`; provisional allowed. `/imports` is a
   protected proxy path. Approved on 30 September 2026.
3. **S02 is open to returning users.** The onboarded redirect on `/onboarding/import` is gone; returning users get `import.titleReturning`, *Back to dashboard*, and *Start manually*
   → `/settings/profile`. Approved on 30 September 2026.
4. **Read model with the session client only.** `createImportReviewViewService` reads batch, items (minimal columns), profile, and up to 200 owned map options per type; validation is
   read only for `review` batches. Rows are parsed with Zod; a bad row is `UNAVAILABLE`, a missing, foreign or malformed id is the same `NOT_FOUND`. `GET /api/imports/[id]/review`
   serves the same view with `no-store` for reloads.
5. **Pure view model** `toImportReviewView` (`src/domain/import/review-view.ts`): group order profile → experience → education → certification → skill → achievement, required
   fields per type (achievement title/contribution/outcome/achieved_on only while confirm is requested, as in SQL), duplicate hints, summary, and commit blockers
   `validation`, `unsaved`, `saving`, `onboarding`. An all-skip batch only warns (*Nothing will be created*).
6. **Save model.** Action, map target, confirm and profile field selection save immediately with a visible per-candidate status; text and date edits save through an explicit
   *Save changes* per candidate (one patch of changed keys). No debounced text autosave. Unsaved or invalid edits block the commit and trigger the unsaved-navigation dialog.
   After each save, validation is refreshed. Approved on 30 September 2026.
7. **Commit token.** The token sent as `expected_revision` is the batch revision the tab last loaded plus its own successful saves (`RevisionTracker` in
   `src/domain/import/review-edit.ts`). A save receipt showing a higher batch revision once the tab's saves settle means the batch changed elsewhere: the tab shows
   `import.review.changedElsewhere` and reloads before it may commit; the token is never raised to a receipt's revision. *Alternative rejected (gate finding RV1):* taking the
   highest receipt revision, which let a tab commit choices made in another tab that it never displayed.
8. **Conflicts keep local input.** A stale item save shows the conflict state, keeps local edits, and *Reload latest* shows the saved server value beside them until Save or Discard.
   A stale commit shows a conflict notice, reloads and never retries automatically; `NOT_REVIEWABLE`/`NOT_COMMITTABLE` reload the view.
9. **Dates** reuse `normalizePartialDate` (the S12 rule) in a local editor; the S12 component is not extracted, so S12 behaviour is unchanged. `achieved_on` is an exact date.
10. **Map** uses a labelled select of owned records of the same type with short labels (no ids); map candidates are read-only (*Existing record is kept unchanged*); profiles have no Map.
11. **Duplicates.** Skill `DUPLICATE` + `existing_id` offers one-click Map; experience/education/certification/achievement get a non-blocking exact normalized-match hint
    (lower-case, trimmed, collapsed spaces); no fuzzy matching, no auto-map.
12. **Achievement confirmation is per candidate**, enabled only when the saved title, contribution, outcome and achieved_on are present; default unchecked; no *Confirm all*.
13. **Onboarding inside S03** only while `onboarding_completed_at` is NULL: name (≤ 80, never prefilled with `Pending onboarding`, prefilled from the profile candidate's
    `display_name` otherwise), locale, timezone (browser zone when the profile still says UTC). Kept in session storage until the commit; the server decides validity.
14. **Result from the server.** The committed state renders `commit_result` (response or stored `import_batches.commit_result`, `storedCommitResultSchema`); without a stored result it shows
    *Import saved* with no numbers. *Open dashboard* is the primary action; focus moves to the result heading.
15. **Entry points only.** Dashboard empty state and S12 link to `/onboarding/import`; S02 `review_ready` links to S03 and `committed` shows *Import saved*. Unused
    `*.importUnavailable*` copy was removed.
16. **Not-found semantics.** Because `loading.tsx` streams first, S03 answers HTTP 200 with the generic 404 content for missing and foreign ids alike (no distinction); the API route
    answers 404. Accepted at the gate (N2).
17. **Numbers.** Decision 0023, scripts `test:integration:import-review` and `test:e2e:import-review` (`playwright.import-review.config.ts`, port 3010).

## Test assertion changes

Intended, not weakening: `tests/unit/import-start-ui.test.tsx` and `tests/e2e/import-onboarding.spec.ts` (S03 link now required), `tests/e2e/dashboard-timeline.spec.ts` and
`tests/e2e/m2-manual-journey.spec.ts:181` (Import CV is now an active link; the M2 one was outside the handoff list and accepted at the gate as N3), and the T17 unit test that encoded
the RV1 token behaviour (replaced by tracker tests).

## Seams and follow-ups

- **T18–T20:** profile fields and records created by an import commit must feed CV selection and freshness.
- **T23:** purge/retention of abandoned `review` batches.
- P3 follow-ups: the review GET route still builds an unused admin client through `importHttp` (N4); no labels for `metrics`/`experience_item_id` errors (N5);
  `ONBOARDING_INVALID` from commit shows a general notice rather than a field error (N6); clearing a profile field while selecting it sends `""` rather than `null` (N8).

## Not promised

Live `extractImport` smoke, commit stress races, and production behaviour are not verified; evidence is local with the fake AI provider and real ClamAV/Gotenberg.

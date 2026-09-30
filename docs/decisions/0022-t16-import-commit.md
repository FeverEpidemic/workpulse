# Decision 0022 — T16 import commit transaction

Date: 30 September 2026

Status: accepted for WorkPulse MVP v0.1 (local acceptance; see `docs/verification/T16-import-commit.md`)

References: PRD R02, §3, §4, *Shared validation*, release scenario *Import an Indonesian CV with overlapping employment dates*;
User Flow F01 steps 3–4, *Import exceptions*; Wireframe S03 (UI is T17), S08; Database Schema §1, §2, §3 `achievements`, §4
*Import commit transaction* and *File retention*, §6; implementation plan §3, §4, §5 T16; handoff `docs/verification/T16-implementation-plan.md`.

## Context

T15 stages candidates only. The user must edit and choose Create/Map/Skip per candidate, confirm achievements explicitly, and commit once,
atomically and idempotently. Imported achievements stay drafts unless the user asks to confirm; mapping reuses records and never overwrites them;
provenance must survive the 24-hour purge of staged text.

## Decisions

1. **Review choices are persisted on `import_items`** through `public.update_import_item(item, expected_revision, action, target_id, payload_patch, confirm_requested)`,
   the only write path for `action/target_id/payload/confirm_requested`. Commit reads the stored state. *Alternative rejected:* sending all choices with the commit
   (refresh would lose choices; the polymorphic target trigger needs a writer that lives with it). Approved by the user on 29 September 2026.
2. **Batch revision is the review token.** `update_import_item` bumps the item and batch revisions; `commit_import_batch(batch, expected_revision, onboarding)` compares the batch revision.
3. **Idempotency comes from batch state**, not `operation_requests`: the batch row is locked first; `status = committed` returns the stored `commit_result` (plus `batch_id`, `committed_at`)
   before any revision check. *Alternative rejected:* `internal.operation_requests` (the batch is already a unique per-user scope).
4. **Explicit confirmation is a column**, `import_items.confirm_requested` (only valid for achievement + `create`, enforced by `import_items_confirm_check`). `payload.status` stays `draft`,
   so the T15 invariant "staging is never confirmed" is untouched. Confirmed rows need title, contribution, outcome, achieved_on; an empty `cv_bullet` uses `internal.factual_cv_bullet`.
5. **Imported achievements keep their excerpt.** `achievements_source_pair_check` now requires the excerpt/revision pair for `manual`/`activity` and only forbids an activity revision for
   `origin = 'import'`. Foundation rows (experience, education, certification, skill) store no excerpt; their provenance is the retained `import_items` mapping. *Alternative rejected:*
   new excerpt columns on foundation tables. Approved by the user on 29 September 2026.
6. **Onboarding completes inside the commit** through `p_onboarding {display_name, locale, timezone}`, validated like `complete_onboarding` (real name ≤ 80 characters, `en`/`id`, known timezone).
   It is required only while `onboarding_completed_at` is empty and ignored afterwards. The name is never written through `selected_fields`. Approved on 29 September 2026.
7. **Profile: `create` applies the selected fields only** (allowlist `headline`, `summary`, `contact_email`, `phone`, `location`, `website`); `map` on a profile is rejected; a selected NULL field is `REQUIRED`.
8. **Map per entity type.** `map` needs `target_id`; `create`/`skip` need none. `committed_id` is set only for rows the commit creates. Map never changes the target (verified by row snapshots).
9. **Duplicate skills are errors, not auto-map.** A `create` skill whose normalized name exists (or repeats earlier in the batch) is `DUPLICATE` with `existing_id`; the user chooses Map. Approved on 29 September 2026.
10. **One validator in SQL.** `internal.import_item_errors(user, batch)` returns `(item_id, field, code, existing_id)` and backs both `validate_import_batch` and commit; it mirrors every canonical constraint
    (T02/T03/T09). AI `validation_errors` from T15 are informational only. Constraint violations that still slip through are caught, rolled back, and mapped to `IMPORT_ITEM_INVALID` without database text.
    `validate_import_batch` is volatile (not `stable`) because `internal.import_actor()` takes `FOR SHARE`.
11. **Patch allowlist per type** (`IMPORT_PATCH_FIELDS` in `src/domain/import/commit-contracts.ts`, identical to the SQL list); `experience_item_id` must be NULL or an experience item of the same batch.
12. **Lock order:** profile → import batch → import items (`entity_type`, `ordinal`) → map targets `FOR SHARE` (per table, by id) → inserts. `update_import_item` uses profile share → batch → item.
    This extends decision 0021's order and is compatible with `cancel_import_batch` and `delete_experience`.
13. **Result:** `import_batches.commit_result` (`import-commit.v1`: per-type created/mapped/skipped, `confirmed_achievements`, `profile_fields_applied`, `onboarding_completed`; numbers and booleans only, ≤ 4096 bytes),
    readable by the owner. Errors carry ids, fields and codes only.
14. **Retention:** commit sets `expires_at = committed_at`; the unchanged T15 purge clears staged text and the object. A guard on `import_items` makes `committed_id` writable only by the commit (transaction-local flag
    `workpulse.import_commit`) and, once the batch is committed, allows only the purge (payload and excerpt cleared together).
15. **Type-aware target trigger** `import_items_validate_target`: `map` ⇔ `target_id`, profile never has a target or committed id, `committed_id` only for `create`, and targets must exist for the owner in the table of the entity type
    (`IMPORT_TARGET_INVALID` without distinguishing missing from foreign).
16. **Consent is not checked at commit**: nothing is sent to an AI provider, so withdrawn consent must not close the manual path.
17. **No CV invalidation yet**: CV tables arrive in T18. Seam for T20: profile fields written by an import commit must feed CV freshness.

## Error codes

`IMPORT_ITEM_INVALID` (detail: JSON `[{item_id, field, code, existing_id?}]`, first 100), `IMPORT_NOT_COMMITTABLE`, `IMPORT_NOT_REVIEWABLE`, `IMPORT_TARGET_INVALID`, `INVALID_IMPORT_ITEM_INPUT`,
`ONBOARDING_REQUIRED`, `INVALID_DISPLAY_NAME`, `INVALID_LOCALE`, `INVALID_TIMEZONE`, `STALE_REVISION`, `IMPORT_NOT_FOUND`, `AUTH_REQUIRED`. Field codes: `REQUIRED`, `INVALID`, `TOO_LONG`, `DATE_RANGE`, `DUPLICATE`,
`TARGET_UNAVAILABLE`, `INVALID_ACTION`.

## Seams

- **T17:** S03 renders the batch using `updateImportItemAction`, `validate_import_batch`, `commitImportAction`; `existing_id` offers Map for duplicate skills; `payload.display_name` only prefills `p_onboarding.display_name`;
  a skill unique-race can yield `IMPORT_ITEM_INVALID` with an empty list (show a generic message and re-validate); purge of abandoned `review` batches stays open (T17/T23).
- **T20:** CV freshness for profile fields changed by a commit.

## Not promised

Retention beyond the app's own purge (backups, Storage provider) and production behaviour are not verified here; evidence is local.

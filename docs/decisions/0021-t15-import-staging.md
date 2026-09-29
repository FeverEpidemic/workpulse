# Decision 0021 — T15 import upload and extraction staging

Date: 29 September 2026

Status: accepted for WorkPulse MVP v0.1 (local acceptance; see `docs/verification/T15-import-staging.md`)

References: PRD §1 *Import*, R02, §3, §4; User Flow F01 and *Import exceptions*; Wireframe S02 (S03 is T17);
Database Schema §1, §3 `ai_jobs`, §4, §6; implementation plan §2 *Parsing*, §3 *Jobs dan data privat*, §4 *pages import*,
§5 T15, §8; handoff `docs/verification/T15-implementation-plan.md`.

## Context

New users can start from a CV. The source documents require: PDF/DOCX up to 10 MiB and 20 pages; consent before AI
extraction; malware screening before use; trusted page counts (DOCX metadata is not authoritative); candidates only in
staging with excerpts; no canonical writes, OCR, or auto-confirm; cancel, leave-return, same-batch retry, duplicate-hash
warning; raw file and text purged within 24 hours of a terminal state. T13 already defined `ai_jobs`; decision 0019/0020
reserved kind `import` and `import_batch_id` for T15.

## Decisions

1. **Consent before upload.** Import exists only to send CV text to the AI provider, so `begin_import_batch` requires the
   current consent (`ai-processing-v1`). Consent is rechecked when the AI job is enqueued, when its input is read, and at
   completion. Scanning and parsing are local and need no consent. The consent version is unchanged; the dialog gains an
   import-specific description (`purpose="import"`) and S02 always shows what is sent before upload. Whether a separate
   consent version for import is wanted is a product question left open (see *Open*).
2. **Single-request upload, three database steps.** `POST /api/imports` reads a bounded body, checks signature and MIME,
   hashes, then `begin_import_batch` (idempotent per user key; same key with different bytes → `IDEMPOTENCY_KEY_REUSED`),
   uploads the private object `user/import/batch`, and `finalize_import_upload` (service role, owner from the session)
   enqueues screening. A lost response is replayed by reusing the immutable object after comparing size and hash.
   Batches stuck in `uploading` for 15 minutes fail as `UPLOAD_INCOMPLETE`.
3. **DB status enum unchanged; progress in `stage`.** `status` keeps DB §4 values; `stage`
   (`uploading/screening/parsing/extracting/done`) only drives progress copy. A guard trigger enforces the F01 transitions
   (plus `failed → queued/running` for retry) and batch identity immutability.
4. **Separate scan+parse queue.** `internal.import_jobs` mirrors the T10 scan queue: atomic claim, 120 second lease,
   attempt token, compare-and-set completion, at most 5 transient attempts with backoff. Scanning always precedes parsing.
5. **AI job kind `import`.** `ai_jobs.activity_id` becomes nullable, `import_batch_id` is added with a composite FK, and a
   check enforces exactly one target. Key `import:<batch>:r1`, one job per batch, `input_revision = 1`. The job stores only
   a small `import.v1` summary; candidates are staged as `import_items`. T13/T14 functions that locked the activity
   (`expire_ai_job_leases`, `fail_ai_job`) now lock the job's target (activity or batch) first; `get_ai_job_input` and
   `complete_ai_job` ignore import jobs; `retry_ai_job` refuses them (`AI_JOB_NOT_APPLICABLE`). An import job failure fails
   its batch with the same code.
6. **Atomic staging.** `complete_import_ai_job` validates structure (≤300 items, ≤60 per type, ≤1 profile, achievement
   payload `status = draft`), resolves `experience_ref` to the staged experience item id, inserts items, succeeds the job,
   and opens `review` in one transaction. A cancelled batch makes late completions `stale` with no items.
7. **Retry on the same batch.** `retry_import_batch` resumes the failed stage (scan/parse job or the same AI job),
   is a no-op while the batch is already queued/running, allows 3 retries, refuses permanent codes, and refuses purged or
   expired batches. AI attempts stay capped at 3 by the T13 constraint.
8. **Cancel and retry without `expected_revision`.** The worker advances the batch revision on every stage change, so a
   revision-checked cancel would routinely conflict with a user's click. Both operations lock the batch and are idempotent
   by state instead (deviation from the handoff §3.1, recorded here).
9. **Isolated parsing.** Parsing runs in `worker_threads` with a 256 MB heap limit, empty environment, discarded stdio and a
   30 second hard timeout (`PARSER_TIMEOUT`); a crash or heap exhaustion is `CORRUPT_FILE` and the worker keeps running.
   - PDF: `pdfjs-dist@6.3.289` (Apache-2.0, pure JavaScript). Its optional native `@napi-rs/canvas` (rendering only) is
     excluded with `ignoredOptionalDependencies`; pdf.js v6 no longer compiles code with `eval`. Password-protected →
     `ENCRYPTED_FILE` (owner-password-only PDFs that open without a password are accepted); fewer than 200 non-whitespace
     characters → `SCANNED_PDF`; more than 20 pages → `TOO_MANY_PAGES` before reading text.
   - DOCX text: the bounded T10 ZIP/OOXML reader moved to `src/server/documents/ooxml-zip.ts` (evidence behavior and tests
     unchanged). Macro-enabled packages and legacy/encrypted CFB files are rejected at upload.
   - Text over 60,000 characters → `IMPORT_TEXT_TOO_LONG`.
10. **DOCX page count by an isolated renderer.** Gotenberg 8.37.0 (LibreOffice) in a loopback-only container, pinned by digest
    (`docs/verification/T15-renderer-runbook.md`). Only the bytes are sent as `document.docx`; the rendered PDF is counted in
    the parser thread. Default mode `unavailable` → retriable `PAGE_COUNT_UNAVAILABLE`. The test fake counts explicit page
    breaks and is refused outside development/test. The renderer is not a PDF export abstraction (T21 decides its own).
11. **Grounding (`import.v1`).** Schema failure → `AI_OUTPUT_INVALID`. A candidate whose excerpt is not in the extracted text
    is dropped (`dropped_ungrounded`). Facts (organization, role, institution, qualification, names, issuer, contacts) must
    appear in the candidate's own excerpt or are cleared with `UNGROUNDED`. Reworded fields may not introduce numbers;
    metrics need numbers from the excerpt. Dates are never more precise than the excerpt (year required; month by number or
    en/id name; day only when written). Impossible ranges get `DATE_RANGE`; overlapping roles are valid. Achievement dates
    are kept only when day-precise because the canonical column is an exact date. Missing required fields get `REQUIRED`.
12. **Retention.** Cancelled, committed and permanently failed batches are purge-eligible immediately; retriable failures after
    23 hours so purge completes within the PRD's 24 hours even with worker delay. Purge enqueues the object delete in
    `internal.storage_jobs`, clears text and object key, deletes uncommitted items, and for committed batches keeps
    `entity_type/action/target_id/committed_id` while clearing payload and excerpt. Import cleanup has its own claim scoped to
    the `import` prefix; object deletion is verified by absence. Orphan import objects older than an hour are queued.
13. **Private columns.** `extracted_text`, `file_key`, `idempotency_key` and `payload_hash` are not readable by clients. Owners
    can read their items (T17 needs them); T15 routes return only counts. The owner's own filename appears in the S02 view
    ("Saved import: …") but never in logs, worker summaries, errors, or AI payloads.
14. **S02 UI.** Keyboard-operable drop area, consent before upload, honest per-stage status, specific failure reasons,
    Retry only for transient codes, *Try another file* and *Start manually* on every failure, candidate counts without a
    review link (T17), non-blocking duplicate warning. The pre-onboarding locale comes from the cookie (T03 behavior).

## Error codes

Permanent (no retry): `FILE_EMPTY`, `FILE_TOO_LARGE`, `FILE_TYPE_MISMATCH`, `UNSUPPORTED_FORMAT`, `ENCRYPTED_FILE`,
`SCANNED_PDF`, `CORRUPT_FILE`, `EMPTY_DOCUMENT`, `TOO_MANY_PAGES`, `IMPORT_TEXT_TOO_LONG`, `PARSER_TIMEOUT`,
`MALWARE_DETECTED`, `UPLOAD_INCOMPLETE`, `ACCOUNT_DELETING`, `INVALID_IMPORT_JOB`.
Transient (retriable): `SCANNER_UNAVAILABLE`, `STORAGE_UNAVAILABLE`, `PAGE_COUNT_UNAVAILABLE`, `IMPORT_WORKER_TIMEOUT`,
`CONSENT_REQUIRED`, `CONSENT_WITHDRAWN`, and the AI codes (`AI_*`).
Request errors: `IMPORT_NOT_FOUND`, `IMPORT_NOT_RETRIABLE`, `IMPORT_NOT_CANCELLABLE`, `IMPORT_RETRY_EXHAUSTED`,
`IMPORT_EXPIRED`, `IDEMPOTENCY_KEY_REUSED`, `CONSENT_REQUIRED`.

## Lock order

profile (`for share`) → import batch (`for update`) → import job or AI job (`for update`) → items. AI functions shared with
activities lock the job's target first (activity or batch), then the job.

## Alternatives rejected

- Counting DOCX pages from `docProps/app.xml`: not authoritative (plan §4).
- LibreOffice installed on the worker host: not isolated and platform-dependent.
- Letting `@napi-rs/canvas` install: native code in the parser thread without need.
- A second consent version for import: would force every existing user to re-consent for activity analysis; left as an
  explicit open product question instead.
- Storing all candidates in `ai_jobs.result`: exceeds the 32 KB result cap and duplicates staging.

## Seams for later tasks

- **T16** commit: `import_items.action/target_id/committed_id` already exist; resolve `payload.experience_item_id` to the
  created experience; set `status = committed`, `committed_at`, `expires_at = now()` so purge keeps only mappings.
- **T17** review UI and returning-user entry (S12/dashboard); decide the retention of abandoned `review` batches.
- **T23** account deletion must include import objects and batches.

## Open

- Abandoned batches in `review` are not purged (not a terminal state). Decide in T17/T23.
- Whether import needs its own consent version or copy approval (product decision).
- Live provider smoke for `extractImport` has not been run (needs explicit user approval).

# T17 Fase 1 — Model view domain (30 September 2026)

Tujuan: model view murni untuk S03 (`toImportReviewView`) tanpa I/O.

## File berubah

- Baru: `src/domain/import/review-view.ts`, `tests/unit/import-review-view.test.ts`.
- Diubah: `src/domain/import/commit-contracts.ts` (menambah `storedCommitResultSchema` = `commitResultSchema` tanpa `batch_id`/`committed_at`).

## Yang dibuktikan (13 test)

Urutan grup dan `ordinal`; field wajib per tipe dan `missing`; pemetaan error validasi ke field, item `skip` dan item tak dikenal diabaikan; `canConfirmAchievement` beserta alasan; field achievement wajib hanya saat confirm diminta; duplikat (validasi untuk skill, heuristik ternormalisasi untuk experience/education/certification/achievement, tidak untuk `map`/`skip`); profile tanpa Map dan tidak pernah memilih `display_name`; ringkasan per tipe; blocker `validation`/`unsaved`/`saving`/`onboarding` dan peringatan non-blocking semua-skip; state `review`/`review_empty`/`committed`/`processing`/`failed`/`cancelled`; view tidak menambah data di luar payload/excerpt yang dikenal.

## Commands (hasil aktual)

- `pnpm test tests/unit/import-review-view.test.ts` — 13 PASS.
- `pnpm typecheck`, `pnpm lint` — exit 0.

Catatan desain: field achievement `title/contribution/outcome/achieved_on` ditandai wajib hanya ketika `confirm_requested` (sesuai SQL `import_achievement_errors`); blocker berasal dari error validasi server, bukan dari tanda wajib di klien.

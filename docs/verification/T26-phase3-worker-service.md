# T26 Fase 3: worker, thread, service, route

Tanggal: 18 Oktober 2026. Pelaksana: Claude (Opus 5.5).

## Tujuan

Mode `rules` dari header upload sampai staging: parser thread menjalankan extractor, worker memvalidasi dan men-stage tanpa AI, service/route meneruskan mode, view model S02/S03 membawa `extractionMode`.

## File berubah

- `src/domain/import/contracts.ts`: `IMPORT_RULES_FAILED` di daftar permanen (cermin `internal.is_permanent_import_error`), `IMPORT_EXTRACTION_MODES` + tipe.
- `src/domain/import/import-view.ts`: `ImportBatchRow.extraction_mode?` (tanpa nilai → `ai`), `ImportView.extractionMode` (`null` tanpa batch); `retryBlockReason: "consent"` hanya untuk batch `ai`.
- `src/domain/import/review-view.ts`: `ReviewBatch.extraction_mode?`, `ImportReviewView.extractionMode`.
- `src/server/documents/parser-thread.ts`: dengan `extract`, `extractImportByRules` dijalankan atas teks final di thread yang sama; throw → `extraction: null, extractionFailed: true`, pesan error tidak keluar dari thread.
- `src/server/documents/parse-in-thread.ts`: opsi `extract`, field hasil `extraction?`/`extractionFailed?`, pemeriksaan tipe `extractionFailed`.
- `workers/import-worker.ts`: `ImportJob.extraction_mode` (mode tak dikenal → `INVALID_IMPORT_JOB`); batch `rules` di-parse dengan `{ extract: true }`, cek halaman dan panjang teks tetap lebih dulu, lalu `validateImportResult`; gagal/throw → `fail("IMPORT_RULES_FAILED", final)`; sukses → `completeImportParse(…, items)`. Ringkasan baru `importRulesStaged` (juga dihitung di `importParsed`). Batch `ai` memanggil `parse` dan `completeImportParse` dengan argumen yang persis sama seperti sebelumnya.
- `workers/supabase-import-gateway.ts`: `extraction_mode` dari claim; `p_items` hanya dikirim bila ada item.
- `src/features/import/import-service.ts`: `extractionMode` opsional (header hilang → `ai`, nilai lain → `VALIDATION` sebelum RPC/storage apa pun), `p_extraction_mode` ke `begin_import_batch`, kolom `extraction_mode` dibaca untuk view.
- `src/app/api/imports/route.ts`: header `x-extraction-mode`.
- `src/features/import/import-review-view-service.ts`: kolom `extraction_mode` dibaca (default `ai`).
- Test: `tests/unit/{import-worker,parse-in-thread,import-service,import-view,import-review-view,import-review-view-service}.test.ts`, `tests/integration/{import-staging,import-commit,account-deletion}.test.ts`, `tests/import-fixtures.ts` (`RULES_CV_PDF_LINES`, `rulesCvPdf`).

## Catatan kontrak

- Header tidak valid menghasilkan HTTP 400 dengan kode service `VALIDATION`, sama seperti kode database `INVALID_IMPORT_UPLOAD` yang sudah dipetakan ke `VALIDATION` sejak T15. Rencana menyebut "400 `INVALID_IMPORT_UPLOAD`"; statusnya sama, nama kode mengikuti pemetaan yang ada.
- Fixture PDF `rules` memakai baris ASCII karena penulis PDF minimal hanya Latin-1. Sentinel privat `WP-RULES-PRIVATE-SENTINEL` diletakkan di bawah heading penutup *References*, jadi tersimpan di teks tetapi tidak pernah menjadi kandidat; sentinel ini dicari di ringkasan worker dan error.

## Perubahan assertion

- `tests/unit/import-review-view-service.test.ts`: string daftar kolom `import_batches` yang dikunci test bertambah `extraction_mode`. View S03 memang membutuhkan kolom itu (catatan `rules` di Fase 4); assertion tetap mengunci daftar kolom yang persis.
- `tests/unit/import-worker.test.ts`: fixture `jobFor` mendapat `extraction_mode` (default `ai`); tidak ada assertion lama yang diubah.
- `tests/integration/import-staging.test.ts` dan `import-commit.test.ts`: helper `upload` menerima mode opsional; `createAccount` di suite commit menerima `consent: false`. Test hygiene akhir mendapat assertion tambahan (sentinel `rules`, nama perusahaan fiktif).

## Commands dan hasil

| Command | Hasil |
| --- | --- |
| 5 file unit baru/diubah sebelum implementasi | 12 gagal, 40 lulus (merah sesuai harapan) |
| sama, setelah implementasi | 52/52 lulus |
| `pnpm test` | **120 file / 1133 test lulus** (1 gagal di run pertama karena daftar kolom terkunci, lihat di atas) |
| `pnpm typecheck` | exit 0 (setelah tipe `Result` di thread diperluas) |
| `pnpm lint` | exit 0 |
| `pnpm worker:check` | exit 0 |
| `pnpm test:integration:account-deletion` | **15/15** (baseline 14 + 1 T26) |
| `pnpm test:integration:import` | **25/25** (baseline 21 + 4 T26) |
| `pnpm test:integration:import-commit` | **12/12** (baseline 11 + 1 T26) |
| `pnpm test:integration:import-review` | 6/6 |
| `pnpm test:integration:m3` | 7/7 |
| `pnpm test:integration:release` | 12/12 |
| `pnpm test:integration:ai-usage` | 9/9 |

Lingkungan: Supabase lokal (image yang dipin, lihat Fase 0), ClamAV `workpulse-t10-clamav`, Gotenberg `workpulse-t15-gotenberg`, `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` di env proses.

## Acceptance yang terbukti

- **7 (bagian thread):** `parseInThread("pdf", …, { extract: true })` mengembalikan kandidat dari thread terisolasi; tanpa `extract` hasilnya identik dengan sebelumnya (tanpa field baru); `timeoutMs: 1` dengan `extract` tetap `PARSER_TIMEOUT`. DOCX juga diekstrak di thread.
- **8:** `extractionFailed`, output yang gagal skema, atau extraction yang hilang → `failImportJob(IMPORT_RULES_FAILED, final: true)` tanpa `completeImportParse`; penolakan database `failed:IMPORT_RULES_FAILED` dihitung gagal; ringkasan worker hanya berisi hitungan dan kode.
- **12 (bagian integration):** upload `rules` tanpa consent → ClamAV → parser thread + aturan → `review/done` dengan profil, experience, education, dua skill; setiap excerpt ada di teks tersimpan; nol `ai_jobs`, nol panggilan provider; tidak ada record kanonis sebelum commit. Review → patch `kind` → commit dengan onboarding → 4 record kanonis, consent tetap kosong → purge menghapus teks, `file_key`, dan objek. Hasil kosong → `review_empty`. Retry transien `rules` tanpa consent → kembali ke review. Penghapusan akun menghapus batch, item, dan objek `rules`.
- **13:** akun B mendapat `NOT_FOUND` untuk view, cancel, retry, dan tidak melihat item batch `rules`; ringkasan worker dan error di dua suite tidak memuat `WP-RULES-PRIVATE-SENTINEL`, nama file sentinel, atau nama perusahaan fiktif.
- Header: nilai tak dikenal (`ocr`, `AI`, kosong, `" rules"`) → `VALIDATION` tanpa RPC/storage; `rules`/`ai`/hilang diteruskan sebagai `p_extraction_mode`. View S02/S03 membawa `extractionMode`; baris tanpa kolom dibaca `ai`.

## Warning

Tidak ada.

## Blocker

Tidak ada.

## Berikutnya

Fase 4: dialog pilihan netral, `focusTitle` pada `Dialog`, catatan dan copy `rules` di S02/S03.

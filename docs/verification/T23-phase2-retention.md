# T23 Fase 2 — Database: retensi import, snapshot export, dan retry dijaga

- Tanggal: 9 Oktober 2026
- Eksekutor: Claude Sonnet 5.5

## File berubah

| File | Perubahan |
| --- | --- |
| `supabase/migrations/20261009100000_t23_retention.sql` | baru: `expire_abandoned_import_reviews`, kolom `cv_exports.snapshot_purged_at` + check, `guard_cv_export_row` (ganti), `expire_cv_exports` (ganti), `redact_cv_export_snapshots`, `retry_cv_export` (ganti) |
| `supabase/tests/database/retention.test.sql` | baru: 46 assertion |
| `src/server/supabase/database.types.ts` | regenerasi (+11 baris: kolom baru dan dua fungsi) |

## Command (hasil nyata)

| Command | Hasil |
| --- | --- |
| pgTAP baru sebelum migration | gagal (`expire_abandoned_import_reviews` tidak ada) — merah terbukti |
| `pnpm exec supabase migration up --local` | exit 0; parity **33/33** |
| `pnpm db:test` | **17 file / 1439 assertion**, Result: PASS (`cv_export.test.sql` dan `import_staging.test.sql` lama lulus **tanpa perubahan**) |
| `pnpm db:lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 104 file / 962 test lulus |

## Perilaku yang terbukti

- **Batch review.**
  - Batch `review` idle ≥ 30 hari menjadi `cancelled` dengan `cancelled_at` dan `expires_at` terisi, sama dengan `cancel_import_batch`.
  - Batch dengan item yang diubah kemarin dan batch yang idle 10 hari tidak tersentuh.
  - Batas `p_idle_days` di luar 7–365 dan limit 0 ditolak (`22023 INVALID_IMPORT_HOUSEKEEPING`).
  - Jalur pass kedua idempotent; jendela 7 hari membatalkan batch 10 hari.
  - `purge_expired_import_batches` T15 lalu menghapus teks dan file key, menghapus item staging, dan mengantrekan key file.
- **Snapshot.**
  - `expire_cv_exports` mengosongkan snapshot ke `'{}'` dengan `snapshot_purged_at` bersamaan dengan `purged_at`; status, `cv_revision`, `page_count`, `byte_size`, `expires_at` tetap.
  - `redact_cv_export_snapshots` mengosongkan export `failed` > 24 jam dan tidak menyentuh yang lebih baru atau export sukses yang belum kedaluwarsa. Keduanya idempotent.
- **Immutability.** Perubahan snapshot ke konten lain, mengosongkan tanpa `snapshot_purged_at`, mengisi `snapshot_purged_at` tanpa mengosongkan, mengisi ulang snapshot yang sudah kosong, dan mengubah `cv_revision` semuanya tetap `P0001 CV_EXPORT_IMMUTABLE`. Hanya transisi `snapshot → '{}'` bersamaan dengan `snapshot_purged_at` yang lolos.
- **Retry dijaga.** `retry_cv_export` menolak dengan `P0001 EXPORT_RETRY_UNAVAILABLE` bila snapshot sudah kosong, revision CV berubah, atau CV punya blocker (`NAME_REQUIRED`). Kasus sah (revision sama, siap, attempt < 3) tetap `queued` dengan snapshot dan jumlah attempt yang sama. Penolakan membiarkan export tetap `failed`. Akun lain mendapat `CV_EXPORT_NOT_FOUND`.

## Catatan untuk reviewer

1. **Kode error.** Plan membekukan nama `EXPORT_RETRY_UNAVAILABLE`; pesan tanpa awalan `CV_` itu dipertahankan persis. Pemetaan ke union error domain dan i18n masuk Fase 3.
2. **Assertion lama T21 tentang retry tidak bertentangan.** Tidak ada assertion lama yang diubah; plan mengizinkan perubahan hanya bila bertentangan dengan §2.4.7, dan itu tidak terjadi.
3. **Helper cancel.** Fase 0 tidak menemukan helper internal untuk transisi cancel (logika ada di dalam RPC `cancel_import_batch` yang terikat `import_actor()`). `expire_abandoned_import_reviews` menulis transisi identik dan dicatat di sini sesuai §2.2.14.
4. **Race retry.** `retry_cv_export` mengunci dokumen CV, lalu export, lalu sumber (`cv_export_lock_sources`) sebelum menghitung blocker, mengikuti urutan `request_cv_export`.
5. Diff migration T02–T22: **nol**. Dua migration T23 adalah satu-satunya perubahan di `supabase/migrations`.

## Acceptance Fase 2 yang terbukti

§1.15 (pgTAP; integration dan notice S03 di fase berikut), §1.16 (pgTAP; integration di Fase 6), §1.17 (pgTAP; unit `export-view` dan E2E di fase berikut).

## Langkah berikutnya

Fase 3: domain, reautentikasi, service, dan action (TDD unit).

# T15 Fase 1 — Database (receipt)

Tanggal: 29 September 2026.

Tujuan: tabel staging import, queue scan+parse, perluasan `ai_jobs` kind `import`, RPC user/worker, purge, dan cleanup berprefix `import`, dibuktikan dengan pgTAP.

## File berubah

- `supabase/tests/database/import_staging.test.sql` (baru, 128 assertion)
- `supabase/migrations/20260930090000_t15_import_staging.sql` (baru)
- `src/server/supabase/database.types.ts` (`pnpm db:types`)

## TDD

1. Test ditulis lebih dulu; `pnpm db:test` → **FAIL** (`relation "public.import_batches" does not exist`).
2. Migration diterapkan dengan `pnpm exec supabase migration up --local` (tanpa reset).
3. Run pertama: 127/128. Satu kegagalan adalah bug test (`now()` = awal transaksi, bukan `clock_timestamp()`); assertion diperbaiki, bukan implementasinya.
4. `pnpm db:test` → PASS, 10 file / 668 assertion (540 lama tidak diubah + 128 baru).

## Checks

| Command | Hasil |
| --- | --- |
| `pnpm db:test` | 10 file / 668, PASS |
| `pnpm db:lint` | exit 0, tanpa error |
| `pnpm db:types` | exit 0 (tipe `import_batches`, `import_items`, `ai_jobs.import_batch_id`) |
| Parity | 25/25 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:integration:ai` | 13/13 (regresi T13) |
| `pnpm test:integration:ai-review` | 21/21 (regresi T14) |

## Isi migration (ringkas)

- `public.import_batches`, `public.import_items`, `internal.import_jobs` sesuai §3.1 plan; RLS, grant kolom (tanpa `extracted_text`, `file_key`, `idempotency_key`, `payload_hash` untuk `authenticated`), guard identitas dan transisi F01.
- `ai_jobs`: `activity_id` nullable, `import_batch_id` + FK komposit, check target tepat satu, kind/key `import:<batch>:r1`, unique satu job per batch, check kind↔`schema_version` hasil.
- Fungsi T13/T14 yang diganti (body disalin lalu diubah minimal): `is_valid_ai_result` (menerima ringkasan `import.v1`), `guard_ai_job_row` (+`import_batch_id` immutable), `fail_ai_job_locked` (gagal job import menggagalkan batch), `expire_ai_job_leases` dan `fail_ai_job` (mengunci target activity **atau** batch sebelum job lewat `internal.lock_ai_job_target`), `get_ai_job_input` dan `complete_ai_job` (menolak job `import` sebelum mengunci apa pun; `complete_ai_job` juga mewajibkan `detect.v1`), `retry_ai_job` (menolak job `import` dengan `AI_JOB_NOT_APPLICABLE`). Grant kolom `ai_jobs` ditambah `import_batch_id`.
- RPC user: `begin_import_batch`, `cancel_import_batch`, `retry_import_batch`. RPC server/worker: `finalize_import_upload`, `expire_import_uploads`, `claim_import_jobs`, `advance_import_job`, `complete_import_parse`, `fail_import_job`, `get_import_ai_job_input`, `complete_import_ai_job`, `purge_expired_import_batches`, `claim/complete/fail/retry_import_cleanup_job(s)`, `reconcile_orphan_import_objects`.

## Penyimpangan dari plan (dicatat untuk decision 0021)

1. `cancel_import_batch(uuid)` dan `retry_import_batch(uuid)` **tanpa** `expected_revision`. Worker menaikkan revisi batch setiap perubahan stage, sehingga cancel/retry dengan revisi akan sering konflik saat pengguna menekan tombol. Keduanya idempoten berdasarkan state di bawah lock batch: cancel ulang mengembalikan `cancelled`; retry saat batch sudah `queued/running` mengembalikan state saat ini tanpa enqueue kedua.
2. `finalize_import_upload(p_user_id, p_batch_id)` tanpa expected revision; replay idempoten berdasarkan `stage`.
3. `fail_import_job` memakai parameter `p_final` (berhenti retry sekarang) terpisah dari permanensi kode; `PAGE_COUNT_UNAVAILABLE` yang dilaporkan final tetap retriable oleh pengguna.
4. `reconcile_orphan_import_objects` mengembalikan jumlah (integer), bukan tabel.
5. `expire_import_uploads(p_limit, p_min_age_seconds)` menerima umur minimum agar pgTAP tidak perlu memanipulasi `created_at` yang immutable; worker memakai 900 detik.

## Acceptance yang terbukti di level DB

§1.3 (hitungan canonical tetap), §1.8 (consent begin/parse/retry), §1.10 (payload achievement selalu draft, validation_errors tersimpan), §1.11 (replay key, key sama byte beda, key akun lain), §1.12 (duplikat per akun), §1.13 (cancel queued/running/review, completion terlambat `stale`), §1.15 (retry per tahap, no-op saat running, batas 3, permanen, expired), §1.16 (purge cancelled/failed/committed, receipt object, klaim cleanup terpisah), §1.18 (isolasi dan kolom privat), serta regresi T13/T14.

Belum terbukti di fase ini: parser, renderer, worker, route, UI (Fase 2–6).

Berikutnya: Fase 2 (inspeksi dan parser).

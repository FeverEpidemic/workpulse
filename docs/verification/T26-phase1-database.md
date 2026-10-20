# T26 Fase 1: database

Tanggal: 18 Oktober 2026. Pelaksana: Claude (Opus 5.5). Basis: `claude/eloquent-jones-3c0191` (lihat receipt Fase 0).

## Tujuan

Migration `extraction_mode`, consent dan charge hanya untuk mode `ai`, staging bersama `internal.stage_import_items`, dan jalur `rules` di `complete_import_parse` tanpa `ai_jobs`. pgTAP ditulis lebih dulu.

## File berubah

- Baru: `supabase/migrations/20261019090000_t26_import_rules_extraction.sql`, `supabase/tests/database/import_rules.test.sql`.
- Diubah: `src/server/supabase/database.types.ts` (via `pnpm db:types`: kolom `extraction_mode` pada `import_batches`, `p_extraction_mode?` pada `begin_import_batch`, `extraction_mode` pada hasil `claim_import_jobs`, `p_items?` pada `complete_import_parse`).
- Diubah: `supabase/tests/database/import_staging.test.sql`, tiga string signature saja (lihat *Perubahan assertion*).

## Isi migration

- Kolom `extraction_mode text not null default 'ai'` + check `ai|rules` di `public.import_batches` dan `internal.import_jobs`; grant `select (extraction_mode)` ke `authenticated` (kolom batch di-grant per kolom sejak T15).
- `internal.is_permanent_import_error`: tambah `IMPORT_RULES_FAILED`.
- `internal.guard_import_batch_row`: body T15 + `extraction_mode` di baris identitas immutable.
- `internal.stage_import_items(batch, items, allowed_types)`: validasi struktur dan insert dipindah dari `complete_import_ai_job` apa adanya. Validasi summary (`is_valid_ai_result`) tetap di `complete_import_ai_job`, dievaluasi sebelum helper sehingga urutan dan hasil sama.
- `begin_import_batch`: signature 5 parameter di-drop, versi 6 parameter dengan `p_extraction_mode text default 'ai'`. Body dari versi usage limits (decision 0032). Consent dan `charge_ai_usage(…, 'import')` hanya untuk `ai`. Mode masuk payload idempotency: hash `ai` sama persis dengan T15 (replay lintas migration tetap cocok), hash `rules` diberi akhiran `:rules`, plus pembandingan kolom `extraction_mode` saat replay.
- `retry_import_batch`: body usage limits; consent dan charge hanya untuk `ai`.
- `finalize_import_upload`: menyalin mode ke `internal.import_jobs`.
- `claim_import_jobs`: di-drop dan dibuat ulang dengan kolom hasil `extraction_mode`.
- `complete_import_parse`: signature 4 parameter di-drop, versi `(…, p_items jsonb default null)`. `ai` + item → `22023 INVALID_IMPORT_PARSE`; `rules` tanpa array → `22023`. `rules` valid: job `succeeded`, teks + `page_count` disimpan, batch `running → review` dengan `stage = 'done'`, satu transaksi, tanpa cek consent dan tanpa `ai_jobs`. `rules` invalid: job dan batch `failed` dengan `IMPORT_RULES_FAILED`, teks tidak disimpan, return `'failed:IMPORT_RULES_FAILED'`.
- `complete_import_ai_job`: body T15 dengan staging lewat helper (enam tipe).
- Grant/revoke/comment untuk setiap signature baru mengikuti pola T15 dan decision 0032.

### Deviasi kecil dari rencana §3.1

1. `p_extraction_mode` diberi default `'ai'` (rencana menyebut 6 parameter tanpa menyebut default). Alasan: setiap test dan pemanggil lama dengan 5 argumen tetap berjalan tanpa diubah, sesuai §2.2.1 (header hilang → `ai`).
2. Untuk output `rules` yang gagal validasi struktur, job ditutup `failed` (bukan `succeeded`) dan teks tidak disimpan. Rencana menyebut urutan "tutup job succeeded, simpan teks, lalu stage". Hasil yang terlihat pengguna sama (batch `failed/IMPORT_RULES_FAILED`, permanen); job dan batch jadi konsisten, dan teks yang tidak akan dipakai tidak tersimpan sampai purge.

## Perubahan assertion

`import_staging.test.sql` baris 52, 55, 63: string signature di `has_function_privilege` diganti ke `begin_import_batch(uuid,text,bigint,text,text,text)` dan `complete_import_parse(uuid,uuid,text,integer,jsonb)`. Assertion-nya tetap sama (authenticated boleh, anon tidak, service_role boleh); hanya signature yang memang berubah. Tanpa ini fungsi lama tidak ditemukan dan file berhenti. `release_catalog.test.sql` dan `test:integration:release` tidak perlu diubah.

## Commands dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm db:test` sebelum migration | gagal: `import_rules.test.sql` 4/4 gagal lalu berhenti (kolom belum ada) |
| `pnpm exec supabase migration up --local` | exit 0, `Applying migration 20261019090000_t26_import_rules_extraction.sql` |
| `pnpm db:test` run pertama | 1 gagal (test menghitung unit day + month, `have: 2 want: 1`) dan error grant temp table di test; keduanya kesalahan test, diperbaiki di test |
| `pnpm db:test` | **21 file / 1725 test, `Result: PASS`** (baseline 20/1638; `import_rules` menambah 87) |
| `pnpm db:lint` | exit 0, `results: []` |
| `pnpm db:types` | exit 0, diff 6 baris tambahan |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 119 / 1084 lulus |
| `pnpm test:integration:account-deletion` | 14/14 |
| `pnpm test:integration:release` | 12/12 |
| `pnpm test:integration:import` | 21/21 |
| `pnpm test:integration:import-commit` | 11/11 |
| `pnpm test:integration:import-review` | 6/6 |
| `pnpm test:integration:ai-usage` | 9/9 |

Parity lokal: 38 migration di DB lokal bersama, 38 file di branch.

## Acceptance yang terbukti (pgTAP `import_rules.test.sql`)

- **1:** `rules` tanpa consent berhasil; `ai` (eksplisit atau tanpa mode) tanpa consent `CONSENT_REQUIRED`; mode tidak dikenal/null `INVALID_IMPORT_UPLOAD`.
- **2:** update `extraction_mode` → `INVALID_IMPORT_BATCH_MUTATION`; check kolom menolak mode lain; key sama dengan mode berbeda → `IDEMPOTENCY_KEY_REUSED`; replay dengan mode sama mengembalikan batch yang sama.
- **3:** `rules` → `review/done`, empat item, teks dan `page_count` tersimpan, nol `ai_jobs`; batch yang di-cancel saat parsing → `stale`, tanpa item dan teks.
- **4 (bagian DB):** batch `ai` tetap ke `extracting` dengan satu AI job; AI staging lewat helper tetap menerima sertifikasi; seluruh `import_staging.test.sql` dan `import_commit.test.sql` lulus.
- **8 (bagian DB):** `IMPORT_RULES_FAILED` permanen; `achievement`, `certification`, dan > 60 item per tipe pada batch `rules` → `failed:IMPORT_RULES_FAILED`, tanpa item; `fail_import_job(…, 'IMPORT_RULES_FAILED', true)` membuat batch langsung purge-eligible; retry ditolak `IMPORT_NOT_RETRIABLE`.
- **9:** retry `rules` yang gagal transien berjalan tanpa consent dan melanjutkan job parse yang sama; retry `ai` tanpa consent `CONSENT_REQUIRED`; consent yang diberikan setelah upload tidak mengubah mode.
- Tambahan basis 0032: lima batch `rules` dalam sehari di paket free diterima dan tidak ada unit tercatat; batch `ai` baru di-charge sekali, replay gratis.
- Privilege: signature lama tidak ada; `begin` hanya `authenticated`; `complete_import_parse` dan `claim_import_jobs` hanya `service_role`; `stage_import_items` tidak dapat dipanggil peran API; semua `security definer` dengan `search_path=pg_catalog` dan ber-comment.

## Warning dan catatan

- DB lokal dipakai bersama worktree lain. Migration T26 sudah diterapkan di sana; fungsi lama tetap kompatibel bagi pemanggil 5 argumen, dan `claim_import_jobs` hanya menambah satu kolom hasil.
- `pnpm build` belum dijalankan di fase ini (tidak ada perubahan web).

## Blocker

Tidak ada.

## Berikutnya

Fase 2: fixture teks CV sintetis dan `extractImportByRules` (unit, TDD).

# Gate M5 Fase 4: integration lintas domain

- Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5).
- Tujuan: kriteria §1.4–§1.7 handoff dengan PostgreSQL, Storage, ClamAV, Gotenberg DOCX, dan renderer PDF nyata. Hanya provider AI yang memakai fake bertanda (`ExplicitTestFakeAIProvider` di dalam penghitung teks).
- File berubah: `tests/integration/m5-pilot-readiness.test.ts` (baru), `package.json` (`test:integration:m5`, juga `test:e2e:m5` untuk Fase 3). Commit `d375b0e`.
- Pola: akun lewat `createAccount` (`account-deletion-support.ts`, sign-in nyata), service layer nyata, worker nyata (`runImportWorkerOnce`, `runAiWorkerOnce`, `runExportWorkerOnce`, `runEvidenceWorkerOnce`, `runAccountDeletionWorkerOnce`), `sql()` hanya untuk pemajuan waktu, satu job yang lease-nya ditahan, dan pembacaan internal. Teardown lewat jalur penghapusan T23.

## Skenario dan hasil

| # | Skenario handoff | Test | Yang dibuktikan |
| --- | --- | --- | --- |
| 1 | Metrik pilot end-to-end | `1. pilot metrics…` | Empat akun terdaftar (`set_pilot_participant`) dan satu akun luar. p1 aktif hanya lewat commit import `rules` (event `import_committed` dengan `created > 0`, tanpa `activity_saved`). p2 record manual, achievement terkonfirmasi, export sukses (renderer nyata). p3 activity di dua minggu berbeda (event dimajukan 10 hari) dan satu export gagal terminal. p4 tidak aktif. Selisih `get_pilot_metrics(now + 29 hari)` sebelum dan sesudah pendaftaran: activation 4/4/3 (cohort/eligible/achieved), value completion 3/1, return capture 3/1, export reliability 2/1. Akun luar punya event export tetapi tidak terhitung. Selisih dipakai karena database lokal bersama bisa berisi peserta lain |
| 2 | Rules tanpa unit | `2. rules imports past the daily import limit…` | Paket `free` (import 3/hari). Empat upload `rules` diterima, `internal.ai_usage` 0 baris, `ai_jobs` 0. Setelah consent, tiga upload `ai` → unit import hari ini 3. Upload `ai` keempat ditolak `QUOTA_EXCEEDED`, jumlah batch dan unit tidak berubah. Upload `rules` sesudah batas tetap diterima tanpa unit. Catatan manual tetap tersimpan; `get_ai_usage` melaporkan jendela `daily` |
| 3 | Penghapusan saat semua job aktif | `3–4. deletion while every kind of job is active…` | Akun memegang batch `rules` `queued`, batch `ai` di stage `extracting` dengan job AI `running` dan lease 120 detik yang ditahan, job analisis `queued`, export `running` dengan lease ditahan, evidence `scanning` dengan job scan, dan reservasi `uploading`. Setelah `deleteThroughService`: penyelesaian job AI dan export dengan token lama tidak menghasilkan `succeeded`; pass AI, import, dan evidence tidak menambah baris (jumlah `ai_jobs` sukses, `import_items`, `achievements` beku) dan tidak mengirim teks akun ke provider. Worker penghapusan berhenti di tengah (lease dikedaluwarsakan) lalu dilanjutkan sampai `completed`. Semua tabel ber-`user_id` di `public` dan `internal` kosong, prefix Storage kosong, profil dan user Auth hilang, tidak ada job cleanup terbuka, `account_deletion_overdue` dan `storage_cleanup_failed` tidak naik |
| 4 | Tabel baru ikut terhapus | sama | `internal.ai_usage`, `ai_plan_assignments` (paket `free` sengaja dipasang), `product_events`, `pilot_participants` milik akun = 0. Akun bystander dengan unit AI dan event tidak berubah (unit, event, dan semua baris). `internal.ai_capacity_usage` tanpa kolom `user_id` dan tanpa nilai negatif |
| 5 | Retensi import | `5. committed, cancelled and terminally failed batches…` | Batch `rules` commit, `rules` batal, `rules` gagal terminal oleh EICAR (ClamAV nyata, `MALWARE_DETECTED`), dan `ai` commit. Waktu terminal dimajukan 25 jam, pass worker import berjalan: keempat batch `purged_at` terisi, `extracted_text` null, prefix `import/` kosong. Batch commit menyisakan baris item sebagai provenance dengan `payload` dan `source_excerpt` null (desain T15, `20260930090000_t15_import_staging.sql:1486-1492`); batch lain kehilangan item. Record hasil import (education, skill, experience) tetap ada |
| 6 | Penarikan consent | `6. consent withdrawn while an analysis is queued…` | Request analisis membebankan 1 unit. Consent ditarik, pass AI menutup job `failed:CONSENT…`; teks catatan tidak pernah sampai ke provider. Unit tetap 1, sesuai decision 0032 (unit tidak dikembalikan). Import `rules` sesudahnya sampai `review` tanpa unit baru |
| 7 | Isolasi baru | `7. another account gets the same answer…` | Akun lain memanggil `getView`, `cancel`, `retry` (service), `retry_import_batch`, `validate_import_batch`, `update_import_item` (RPC mentah) dengan ID batch/item `rules` milik A dan dengan ID acak: jawaban identik. `get_ai_usage` tidak menerima ID dan tidak memuat ID A. Batch A tetap `review`. Route upload dengan `x-extraction-mode` tidak menerima ID batch, jadi tidak ada ID asing yang bisa diuji di sana; isolasinya melekat pada `begin_import_batch` yang membaca `auth.uid()` |
| 8 | Health | `8. a rules job with an expired lease and a failed cleanup…` | Ambang `ops:check` = hitungan saat ini (database lokal berisi backlog lama). Job import `rules` dengan lease kedaluwarsa 11 menit dan satu job cleanup gagal menaikkan `jobs_expired_lease` dan `storage_cleanup_failed` tepat 1; `node workers/ops-check.ts` (script `pnpm ops:check`) exit 2. Setelah dibereskan (job diantrekan ulang lalu diproses worker, job cleanup dihapus) exit 0 |

## Command

| Run | Command | Exit | Hasil | Penyebab |
| --- | --- | ---: | --- | --- |
| 1 | `pnpm test:integration:m5` | 1 | 4/7 | Kesalahan test: (a) re-queue batch lewat SQL ditolak guard transisi `INVALID_IMPORT_TRANSITION`; (b) asersi "nol item" salah membaca desain purge T15 untuk batch commit; (c) baris `storage_jobs` gagal tidak memenuhi `storage_jobs_state_check` |
| 2 | sama | 1 | 6/7 | Kesalahan test: baris evidence `scanning` tidak memenuhi `evidence_files_state_check`; diperbaiki dengan urutan finalize (reservasi → job scan → `scanning`) |
| 3 | sama | 0 | **7/7** (85 detik) | |

Tidak ada asersi yang dilemahkan untuk perilaku produk. Perubahan (b) mengganti asersi yang keliru dengan asersi yang lebih tepat: teks staging hilang dan item batch non-commit terhapus.

Lingkungan: Supabase lokal (38/38), ClamAV 1.5.4, Gotenberg 8.37.0 di 13400 dan 13401, `SUPABASE_SECRET_KEY` di env proses, tanpa variabel AI.

## Temuan

Tidak ada P0–P2. Tidak ada data tersisa setelah purge, tidak ada unit untuk `rules`, metrik tepat.

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| M5-N4 | P3 | Pass worker dengan `claimLimit` di database lokal bersama dapat ikut memproses job akun sesi lain (berlaku juga untuk suite lama). Tidak memengaruhi hasil gate karena setiap asersi dibatasi per akun | Catat |

## Langkah berikutnya

Fase 3 (journey browser) dan Fase 5.

# Gate M5 Fase 2: review kode lintas domain (read-only)

- Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5), satu sesi.
- Worktree `.claude/worktrees/m5-gate-review`, branch `claude/m5-gate-review`, basis `origin/main` `973e886`.
- Tujuan: membaca kode nyata pada sambungan pasca-rencana (decision 0032, 0033) ke invariant M5, sesuai checklist handoff §5 Fase 2.
- File berubah: hanya receipt ini. Tidak ada perubahan kode di fase ini.

## Hasil per butir checklist

| # | Butir | Hasil | Bukti (file:line) |
| --- | --- | --- | --- |
| 1 | Penghapusan akun × tabel baru | Tercakup lewat FK, bukan lewat `purge_account_data` | `internal.ai_plan_assignments.user_id` dan `internal.ai_usage.user_id` memakai `references public.profiles(id) on delete cascade` (`supabase/migrations/20261018090000_ai_usage_limits.sql:39`, `:62`). `public.profiles.id` memakai `references auth.users(id) on delete cascade` (`20260916090000_foundation_schema.sql:183`). Jalur T23 menyisakan profil sebagai tombstone lalu worker menghapus user Auth, sehingga kedua tabel ikut terhapus pada langkah itu, sama seperti `internal.product_events` (T24). `internal.ai_capacity_usage` tidak punya `user_id` (`:76-80`). T26 hanya menambah kolom `extraction_mode`, tanpa tabel baru. Dibuktikan runtime di Fase 3 langkah 8 dan Fase 4 skenario 4 |
| 1b | Guard `zz_guard_account_writable` | Tercakup | Trigger dipasang pada setiap tabel `public` ber-`user_id` (`20261009090000_t23_account_deletion.sql:64-87`). Tabel 0032 ada di skema `internal`, tanpa grant API, dan hanya ditulis `charge_ai_usage` di dalam RPC yang juga menyisipkan baris `public` yang dijaga trigger, jadi transaksi akun `deleting` gagal sebelum commit. `release_catalog.test.sql` gagal bila tabel `public` baru tanpa trigger |
| 2 | Worker × `deleting` | Tercakup, sama untuk kedua mode | `claim_import_jobs` menyaring `profile.deleting_at is null` (`20261019090000_t26_import_rules_extraction.sql:391`). `finalize_import_upload` sama (`:318`). `complete_import_parse` memeriksa `o_deleting` dan menutup job `failed:ACCOUNT_DELETING` (`:454-457`) **sebelum** cabang `rules` men-stage item (`:460`). Worker memakai RPC yang sama untuk kedua mode (`workers/import-worker.ts:165`, `:190`, `:192`) |
| 3 | Unit AI | Tercakup | `charge_ai_usage` dipanggil dari `internal.enqueue_ai_job` (`20261018090000_ai_usage_limits.sql:295`), `public.retry_ai_job` (`:385`), dan versi T26 `begin_import_batch` hanya untuk baris baru mode `ai` (`20261019090000_…sql:214-215`) serta `retry_import_batch` hanya di stage `extracting` (`:275`) atau mode `ai` (`:283-285`). Batch `rules` tidak pernah masuk `extracting` (komentar `:230`, cabang `:460`). Kunci idempotensi menolak pergantian mode (`:210-211`), jadi retry `rules` tidak bisa menjadi `ai` |
| 4 | Event produk | Tercakup | Trigger `product_event_import_committed` memicu pada transisi status ke `committed` tanpa melihat mode (`20261011090000_t24_product_events.sql:309-312`). Allowlist `import_committed` hanya `created`, `mapped`, `skipped`, `confirmed_achievements` (`:59-62`); `extraction_mode` tidak masuk properti. Activation menghitung `import_committed` dengan `created + mapped > 0` (`:423-424`), jadi import `rules` mengaktifkan akun |
| 5 | Katalog dan isolasi | Tercakup | `release_catalog.test.sql` membaca `pg_class`/`pg_proc` untuk skema `public` **dan** `internal` (`:36-48`, `:52-56`), sehingga tabel 0032 di `internal` ikut diperiksa (tanpa grant API). Fungsi baru lolos aturan `search_path` (run `db:test` Fase 0 dan 5). Isolasi RPC ber-ID dibaca dari katalog oleh `release-ownership.test.ts` (12/12 Fase 0); `get_ai_usage` tidak menerima ID dan membaca `auth.uid()` |
| 6 | Health operasional | Tercakup | `jobs_expired_lease` menghitung `internal.import_jobs` tanpa melihat mode (`20261012090000_t25_operational_health.sql:72-74`); batch gagal masuk `jobs_failed_24h` (`:63-64`) |
| 7 | Logging | Bersih | `grep console.` di `src/` dan `workers/`: hanya `parser-thread.ts:7-11` yang membungkam console. Worker hanya menulis ringkasan hitungan (`workers/run.ts:56-65`) dan `WORKER_UNAVAILABLE` |
| 8 | Health endpoint dan bundle | Bersih | `/api/health` hanya `status`, `service`, `version` statis (`src/app/api/health/route.ts:17-19`). Pemindaian bundle browser ada di `release-a11y.spec.ts` (bagian `test:e2e:release`) |

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| M5-N1 | P3 | `/api/health` tidak memuat commit atau tag image. Kecocokan image pilot dengan HEAD gate (kriteria §1.11) hanya bisa dibaca dari host, bukan dari luar | Dicatat di daftar periksa Fase 6 |
| M5-N2 | P3 | Baris `internal.ai_usage`, `internal.ai_plan_assignments`, dan `internal.product_events` bertahan di antara purge baris dan penghapusan user Auth (tombstone decision 0029). Bila `deleteUser` gagal terus, receipt tertahan dan terlihat sebagai `account_deletion_overdue` | Diterima: perilaku sama dengan event T24 dan terpantau `ops:check` |

Tidak ada P0–P2 dari review kode. Temuan P2 tooling (versi Playwright) dicatat di [Fase 0](M5-gate-phase0-baseline.md).

## Langkah berikutnya

Fase 3 dan 4 membuktikan butir 1–6 secara runtime.

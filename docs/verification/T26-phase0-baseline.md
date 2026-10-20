# T26 Fase 0: baseline

Tanggal: 18 Oktober 2026. Pelaksana: Claude (Opus 5.5), worktree `wizardly-thompson-18c6a2`, branch `claude/wizardly-thompson-18c6a2`.

## Tujuan

Mencatat kondisi awal sebelum kode T26 diubah: working tree, parity migration, angka checks, dan rujukan file:baris di §3 rencana.

## Basis branch (deviasi dari rencana)

- Worktree dibuat dari `main` (`4db01aa`). Dua commit dokumen T26 di-cherry-pick dari `claude/cd-docker-images` (`9df9d16`, `d6b2cf5`).
- Supabase lokal (dipakai bersama semua worktree) sudah berisi migration `20261018090000_ai_usage_limits.sql` dari branch lokal `claude/eloquent-jones-3c0191` (`c8a7901`, `65293cb`; belum di-push, tanpa PR). Migration itu mengganti `begin_import_batch` dan `retry_import_batch` untuk men-charge unit `import`, dan memakai nomor decision 0032.
- Pengguna memutuskan T26 berbasis branch itu. Branch T26 di-rebase ke `claude/eloquent-jones-3c0191` (`git rebase --onto`), decision T26 diganti nomor menjadi **0033**, dan rencana §2.2.14 mencatat aturan charge: batch `ai` tetap di-charge, batch `rules` tidak (`22c9868`).
- Akibatnya parity awal **37/37** (bukan 36/36), dan parity setelah T26 **38/38**.

## Lingkungan

- `git status` bersih sebelum dan sesudah rebase. Tidak ada file lain yang kotor.
- `pnpm install --frozen-lockfile` di worktree (403 paket dari store).
- Docker Desktop dinyalakan; `pnpm db:start` tanpa reset; container `workpulse-t15-gotenberg`, `workpulse-t10-clamav`, `workpulse-t21-pdf` di-`docker start`.
- **Drift image Storage.** Worktree baru tidak punya pin versi di `supabase/.temp`, sehingga CLI menjalankan `storage-api:v1.72.1`. Skema `storage` lokal sudah dimigrasi oleh v1.80.2 (pin di checkout utama), jadi setiap upload gagal `42P10` dan semua suite integration yang meng-upload gagal. Perbaikan: salin `storage-version`, `rest-version`, `gotrue-version`, `postgres-version`, `storage-migration` dari `D:\Project\WorkPulse\supabase\.temp` (tanpa `linked-project.json`, jadi tidak ada link ke project hosted), lalu `pnpm db:stop` + `pnpm db:start` tanpa reset. Setelah itu image `storage-api:v1.80.2`. File `.temp` di-ignore git.
- `.env.local` disalin dari checkout utama (di-ignore git). `SUPABASE_SECRET_KEY` diambil dari `SERVICE_ROLE_KEY` `supabase status -o env` hanya di env proses; `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan.

## Hasil checks

| Command | Hasil |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm worker:check` | exit 0, 9 job terdaftar |
| `pnpm test` (di `main`, sebelum rebase) | 118 file / 1068 test lulus (sesuai harapan rencana) |
| `pnpm test` (basis usage limits) | **119 file / 1084 test lulus** |
| `pnpm db:test` | **20 file / 1638 test**, `Result: PASS` |
| `pnpm db:lint` | exit 0, `results: []` |
| `supabase migration list --local` | 37 local / 37 remote, terakhir `20261018090000` |
| `pnpm test:integration:account-deletion` | 14/14 (setelah perbaikan image; sebelumnya 13 gagal karena `42P10`) |
| `pnpm test:integration:import` | 21/21 |
| `pnpm test:integration:import-commit` | 11/11 |
| `pnpm test:integration:import-review` | 6/6 |
| `pnpm test:e2e:import` | 7/7 |
| `pnpm test:e2e:import-review` | run 1: 9 lulus, 1 gagal (`page.waitForEvent: Timeout 15000ms ... "filechooser"`); run 2: **10/10** |

Kegagalan `filechooser` pada run pertama terjadi saat server dev baru dikompilasi; run ulang tanpa perubahan lulus. Dicatat sebagai flaky lingkungan, bukan regresi.

## Rujukan file:baris §3

Semua definisi fungsi import hanya ada di dua migration: `20260930090000_t15_import_staging.sql` dan `20261018090000_ai_usage_limits.sql`.

| Rujukan rencana | Kondisi aktual |
| --- | --- |
| `t15:9` `is_permanent_import_error` | cocok |
| `t15:221` `guard_import_batch_row` | cocok |
| `t15:841` `v_hash` | cocok di T15; **body berlaku** ada di `ai_usage_limits.sql:444` |
| `t15:908`, `:941` `retry_import_batch` | definisi berlaku `ai_usage_limits.sql:479`, cek consent `:512`, charge `:523` dan `:531` |
| `begin_import_batch` | definisi berlaku `ai_usage_limits.sql:401`, charge `:463` (hanya batch baru) |
| `t15:976`, `:1002-1003` `finalize_import_upload` | cocok |
| `t15:1043` `claim_import_jobs` | cocok |
| `t15:1219-1233` `complete_import_parse` | cocok (fungsi mulai `:1186`) |
| `t15:1392-1446` validasi + insert item | cocok; validasi summary (`is_valid_ai_result`) digabung dalam `if` yang sama di `:1393` |
| `t15:1661-1664`, `:1697` grant/comment | cocok; grant ulang juga di `ai_usage_limits.sql:558-561` |
| `extract-result.ts:91-97`, `:185-193`, `:224`, `:144` | cocok |
| `import-start.tsx:24` `FAILURE_KEYS` | cocok |
| `dialog.tsx:29` `showModal()` | cocok |
| `import-worker.ts:160-173` | bergeser satu baris (`:160-172`) |

Catatan tambahan untuk Fase 1: kolom `import_batches` di-grant per kolom ke `authenticated` (`t15:288-292`), jadi `extraction_mode` perlu ditambahkan ke grant agar view S02/S03 dapat membacanya.

## Blocker

Tidak ada setelah keputusan basis. Risiko: bila branch usage limits berubah lagi sebelum merge, T26 perlu rebase.

## Berikutnya

Fase 1: pgTAP `import_rules.test.sql` lalu migration `20261019090000_t26_import_rules_extraction.sql`.

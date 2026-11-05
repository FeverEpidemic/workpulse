# T33 Fase 0: baseline

- Tanggal: 5 November 2026
- Pelaksana: Claude Sonnet 5.5 (`claude-sonnet-5-5`), satu agent, tanpa sub-agent.
- Worktree: `D:\Project\WorkPulse\.claude\worktrees\t33-cv-multi-select-288f9f`
- Branch sebenarnya: **`claude/t33-cv-multi-select-288f9f`** (dibuat app). Plan menyebut `claude/t33-cv-multi-select`; yang berlaku branch ini. Base `f3a8847` (plan T33), di atas `e3e522a` (merge T32).
- antislop: mode during (session override, dipilih pengguna 5 November 2026).

## Tujuan

Mencatat kondisi awal sebelum kode T33 diubah: status repo, parity migration, angka lint/typecheck/unit/E2E CV, dan kebenaran klaim file:baris di plan.

## File berubah

Hanya receipt ini. Tidak ada kode.

## Lingkungan

- `pnpm install --frozen-lockfile`: exit 0 (599 paket).
- `.env.local` dan lima file `supabase/.temp` (`storage-version`, `postgres-version`, `gotrue-version`, `rest-version`, `storage-migration`) disalin dari checkout utama. Keduanya ter-ignore git (`git check-ignore` cocok). Isi tidak dicetak. Checkout utama tidak disentuh selain dibaca untuk menyalin.
- `SUPABASE_SECRET_KEY` diambil dari `SERVICE_ROLE_KEY` hasil `supabase status -o env` ke env proses saja. `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan.
- Docker Desktop mati saat sesi mulai (named pipe tidak ada). Percobaan pertama menyalakannya gagal ("unable to start", proses keluar sendiri); percobaan kedua berhasil (daemon 29.8.2). Tiga container renderer (`workpulse-t10-clamav`, `-t15-gotenberg`, `-t21-pdf`) berstatus Exited dan dinyalakan dengan `docker start`. Stack Supabase dinyalakan dengan `pnpm db:start` ("Starting database from backup", data lama utuh). Tanpa `db:reset`.
- `supabase_vector_WorkPulse` berstatus Restarting (sudah begitu di baseline T32, tidak dipakai test).

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `git status --short` | 0 | Bersih |
| Parity: `select count(*), max(version) from supabase_migrations.schema_migrations` | 0 | 38 baris, terakhir `20261019090000`; repo 38 file. Sesuai harapan |
| `pnpm lint` | 0 | Tanpa warning |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | **163 file / 1562 test** lulus (118 s). Sama dengan harapan |
| `pnpm test:e2e:cv` | 0 | **8 lulus**, 0 gagal, 0 flaky (1,6 menit). Log server berisi `Error: The destination stream closed early` dari Next.js; tidak menggagalkan test |

## Verifikasi klaim plan

Semua cocok dengan kode di `f3a8847`:

- `cv-section.tsx:160-190` `PoolRow`, `:214-221` daftar.
- `cv-builder.tsx:157-174` `fail`, `:176-206` `runOperation`, `:214-220` `onAdd`, `:461` wiring.
- `cv-view.ts:6-12` `PoolOption`, `:45-49` `resolveHighlight`.
- `select_cv_source` di `20261004090000_t20_cv_freshness_deletion.sql:897`.
- `tests/unit/cv-builder-ui.test.tsx:45` dan `tests/e2e/cv-builder.spec.ts:173` memuat assertion tanpa "Add all". `cv-builder.spec.ts:369` adalah klik "Add SQL to CV".
- `selectCvSourceAction` (`actions.ts:98`) memanggil `service.select`, yang mengembalikan `{ cvRevision, itemIds, parentItemIds }` (`cv-service.ts:172-185`). `run()` membungkusnya dengan `actionSuccess(undefined, data)`, jadi setiap jawaban sukses membawa `data.cvRevision` numerik dari `receipt.data.cv_revision`. Stop condition §8 butir 3 tidak kena.

## Pemakai tombol Add lama (untuk migrasi Fase 3)

`#cv-add-<id>` dipakai di `cv-export.spec.ts:330`, `m4-cv-journey.spec.ts:333,424`, `m5-pilot-journey.spec.ts:469`. Nama `Add ... to CV` dipakai di `cv-builder.spec.ts:369,388,446`, `cv-freshness.spec.ts:403,411`, `release-keyboard.spec.ts:175`. Unit: `cv-builder-ui.test.tsx:44,56`.

## Acceptance yang terbukti

Tidak ada (baseline). Parity 38/38 dan suite CV hijau tercatat sebagai titik awal.

## Warning

- Docker harus dinyalakan manual dua kali. Sesi lain yang memakai stack ini sebaiknya tahu container sempat mati.
- Log `destination stream closed early` muncul di server Playwright pada baseline; bukan regresi T33.

## Blocker

Tidak ada.

## Berikutnya

Fase 1: aturan state dan copy (TDD unit).

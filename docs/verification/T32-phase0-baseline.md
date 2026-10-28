# T32 Fase 0: baseline

- Tanggal: 28 Oktober 2026
- Pelaksana: Claude (Opus 5.5), branch `claude/t32-landing` di checkout utama `D:\Project\WorkPulse` (pilihan pengguna: eksekusi dari branch sekarang, bukan worktree terpisah). Base `0eaa9f1` (plan + motion dari interview animasi).
- antislop: mode during (session override, dipilih pengguna 28 Oktober 2026).

## Tujuan

Mencatat kondisi awal sebelum kode T32 diubah: status repo, parity migration, angka lint/typecheck/unit/E2E, test yang bergantung pada redirect tamu dari `/`, dan komponen app yang bisa dipakai di landing.

## File berubah

- `docs/verification/T32-implementation-plan.md` §2.2.7: acuan mockup, label kecil sentence case, bentuk section Data kamu, persona contoh (menyamakan plan dengan mockup yang disetujui pengguna).
- Receipt ini.

## Lingkungan

- Node v24.18.0, pnpm 11.19.0, `pnpm install --frozen-lockfile` exit 0.
- Docker Desktop dinyalakan dari sesi ini. Supabase lokal sudah berjalan. Container `workpulse-t10-clamav`, `-t15-gotenberg`, dan `-t21-pdf` dinyalakan oleh sesi fork (lihat Warning).
- `SUPABASE_SECRET_KEY` diambil dari `SERVICE_ROLE_KEY` di `supabase status -o env` ke env proses saja, dan `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan (pola memory lokal).

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `git status --short --branch` | 0 | Bersih kecuali `.claude/launch.json` dan `.claude/setting.local.json` (lokal, tidak di-commit) |
| Parity migration (`supabase_migrations.schema_migrations`) | 0 | 38 baris, terakhir `20261019090000`; repo 38 file. Sesuai harapan. |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | Tanpa warning |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | 154 file / 1448 test lulus. Sesuai harapan. |
| `pnpm test:e2e:auth` | 0 | 1 lulus |
| `pnpm test:e2e:release` (percobaan 1) | 1 | Port 3017 dipakai server lain (run release sesi fork) |
| `pnpm test:e2e:release` (percobaan 2) | 1 | 4 gagal, 39 tidak jalan: "Local Supabase fixture credentials are required" (env belum dimuat) |
| `pnpm test:e2e:release` (percobaan 3, env dimuat) | 0 | **43 lulus** (8,8 menit). Sesuai harapan. |

Screenshot T25/T27/T30/T31 yang ditulis ulang oleh run release dikembalikan dengan `git restore`.

## Inventaris test yang bergantung pada redirect tamu dari `/`

- `tests/e2e/smoke.spec.ts:3-10` membuka `/` sebagai tamu dan mengharapkan `/sign-in`. Perlu diubah di Fase 5 (tamu kini mendapat landing).
- Kecocokan `toHaveURL(/\/sign-in/)` lain (`auth-profile`, `account-deletion`, `m5-pilot-journey`, `app-frame:308-310`, `cv-export:302`, `achievements-ui:159`, `auth-google:184`, `import-onboarding:161`) berasal dari sign out, path terlindungi, atau notice. Tidak bergantung pada `/`.

## Inventaris komponen untuk potongan UI

| Komponen | Bisa dipakai? | Catatan |
| --- | --- | --- |
| `CvPreview` (`src/features/cv/cv-preview.tsx:52`) | Ya, apa adanya | Hanya props `model`, `locale`, `dirty`, dan `action` opsional; tanpa link bila `action` kosong. Model dari `CvPreviewModel` (`src/domain/cv/preview`). |
| `ActivityList` (`src/features/activity/activity-list.tsx:17`) | Tidak, apa adanya | Selalu merender link `/activity/new` (`:61`), link baris `/activity/[id]` (`:72`), `role="status"` jumlah, dan `JustAddedHighlight`. |
| `AchievementList` (`src/features/achievement/achievement-list.tsx:10`) | Tidak, apa adanya | Selalu merender link baris `/achievements/[id]` (`:44`). |
| `Badge`, `Card`, `Button`, kelas `field-input` dan `achievement-source-preview` | Ya | Primitive bersama tanpa aksi bawaan. |

Usulan dari sesi fork, yang menurut laporannya sudah dipilih pengguna: pecah `ActivityListRow` dan `AchievementListRow` dengan `href` opsional, dipakai daftar di app dan di landing. Ini mengubah komponen app sehingga menyentuh stop condition §8 butir 3. Dikonfirmasi ke pengguna bersama persetujuan copy (Fase 1) sebelum Fase 3.

Panel Quick log dan kartu review Achievement di mockup tidak punya komponen app berbasis props yang sama persis (`QuickLog` dan form review terikat server action). Potongan itu disusun dari primitive di atas dengan kelas yang sama dengan app.

## Verifikasi rujukan plan

`src/app/page.tsx:5-10`, `src/proxy.ts:8-18` dan `:68-84`, `src/server/auth/context.ts:50-60`, `src/i18n/messages.ts:2252-2255`, `src/features/auth/sign-in-client.tsx:32` dan `:103`, `src/styles/tokens.css:5-20` dan `:109-113`, `src/app/layout.tsx:25-29` dicek dan cocok. `tokens.css:84-85` (shadow) tidak dicek di fase ini.

## Warning

- Sesi fork "Landing Page progress check (fork)" sempat menjalankan Fase 0 dan Fase 1 paralel di checkout yang sama. Pengguna memilih sesi ini untuk melanjutkan, dan fork dihentikan. Run release fork menulis ulang screenshot T30/T31 (sudah dikembalikan) dan menyalakan tiga container renderer/scanner.
- `supabase_vector_WorkPulse` berstatus restarting. Tidak dipakai test T32.

## Blocker

Tidak ada untuk Fase 1.

## Berikutnya

Fase 1: copy deck dan terjemahan legal, lalu berhenti untuk persetujuan pengguna.

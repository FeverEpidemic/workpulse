# T29 Fase 0: baseline

Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5). Worktree `D:\Project\WorkPulse-t29`, branch `claude/t29-google-oauth`, HEAD `7cf2a6f` (turunan `466b2f8`). Tanpa edit kode.

## Tujuan

Memastikan titik awal bersih, mencatat angka baseline nyata, mengecek rujukan file:baris di plan, dan mencoba konfigurasi provider Google di Supabase lokal.

## File berubah

- `docs/verification/T29-phase0-baseline.md` (receipt ini).
- `.env.local` disalin dari checkout utama ke worktree (git-ignored, tidak di-commit).

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `git status --short` (worktree) | bersih |
| `pnpm install --frozen-lockfile` | exit 0 |
| `supabase migration list --local` | 38/38, setiap baris `local` = `remote`, terakhir `20261019090000` |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, 135 file / 1262 test lulus (sama dengan harapan) |
| `pnpm test:e2e:auth` | exit 0, 1 lulus (1,2 menit) |
| `pnpm test:e2e:ui` | exit 0, 1 lulus (46 detik) |
| spike `amr` (skrip sementara di luar repo, Admin API lokal) | exit 0, lihat di bawah |

`pnpm db:test` tidak dijalankan: Fase 0 tidak mengubah database dan plan sudah mencatat 3 assertion gagal di database bersama (M5-N3).

## Rujukan file:baris

Semua rujukan di plan cocok dengan `origin/main`: `actions.ts:70-74` (tolak `deleting_at`), `route.ts:36-40` (tukar code) dan `:63-64` (alasan SameSite=Lax), `recovery-session.ts:4` (`hasRecentMethod`), `config.ts:82-84` (`getAuthCallbackUrl`), `config.toml:164-168` (allowlist URL persis), trigger profil `foundation_schema.sql:415` dan `:430-432`, `deletion-service.ts:86-95` (jalur password), peta notice `sign-in/page.tsx:11-18`. Blok `[auth.external.apple]` ada di `config.toml:330`; belum ada blok Google. Route S12 `src/app/(workspace)/settings/profile/page.tsx` ada. Notice `accountDeleting` sudah ada di peta, jadi callback Fase 3 dapat memakainya tanpa key baru.

## Spike

Bagian yang dijalankan (tanpa restart stack):

- `GET /auth/v1/settings`: `external.google = false`, `external.email = true`.
- User password lokal sementara (dibuat lalu dihapus, cleanup `ok`):
  - `amr` = `[{ "method": "password", "timestamp": <detik epoch> }]`. Bentuknya sama dengan yang dibaca `hasRecentMethod`, jadi `hasRecentOAuthProof` dapat memakai helper yang sama dengan method `oauth`.
  - `user.identities[].provider` = `["email"]` dan `app_metadata.providers` = `["email"]`. Keduanya terisi; plan §3.2 memakai `identities` dengan fallback `app_metadata.providers`, dan itu tetap.

Bagian yang **tertunda**: blok `[auth.external.google]`, restart stack, dan `curl -I /auth/v1/authorize?provider=google`. Stack Supabase lokal dipakai bersama; saat Fase 0 sesi lain sedang menjalankan `playwright.release.config.ts` (proses node dengan `next start --port 3017` dan worker Playwright). Restart akan memutus suite itu. Belum terbukti juga bahwa `amr` login Google berisi `method = oauth`; itu hanya bisa dilihat dengan login Google nyata (smoke staging atau credential lokal).

## Acceptance terbukti

Belum ada acceptance T29; Fase 0 hanya baseline.

## Warning

- Log web server E2E berisi `Error: The destination stream closed early.` beberapa kali, dengan suite tetap lulus. Ini ada sebelum perubahan T29 dan dicatat sebagai pembanding untuk Fase 5.
- `src/server/auth/adapter.ts` di worktree berbeda hash dengan checkout utama, tanpa beda isi di git (`git diff origin/main claude/t28-import-mode-choice` kosong). Penyebabnya CRLF dari `core.autocrlf=true` pada worktree baru.

## Blocker

Spike authorize Google menunggu jendela restart stack Supabase lokal yang tidak memutus sesi lain. Butuh persetujuan pengguna untuk waktunya.

## Langkah berikutnya

Setelah restart disetujui: tambahkan blok Google dengan placeholder env, `supabase stop` lalu `pnpm db:start` (tanpa `db:reset`), catat status dan host `Location` dari authorize, lalu lanjut Fase 1. Bila CLI menolak start, ikuti §8.

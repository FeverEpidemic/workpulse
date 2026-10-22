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

Bagian authorize sempat tertunda: stack Supabase lokal dipakai bersama, dan saat itu sesi lain sedang menjalankan `playwright.release.config.ts`. Pengguna meminta menunggu suite itu selesai. Setelah tidak ada proses Playwright/Next yang berjalan:

- Blok `[auth.external.google]` (plan §3.1) ditambahkan ke `config.toml` worktree, belum di-commit (masuk commit Fase 1).
- `supabase stop` exit 0, `pnpm db:start` exit 0, tanpa `db:reset`. Kedua env Google **tidak diset**: CLI tetap start, jadi placeholder tidak diperlukan.
- `GET /auth/v1/settings`: `external.google = true`.
- `GET /auth/v1/authorize?provider=google&redirect_to=http://127.0.0.1:3000/auth/confirm&code_challenge=…&code_challenge_method=s256` (redirect manual): **302** ke `accounts.google.com/o/oauth2/v2/auth`, parameter `client_id` (kosong), `redirect_to`, `redirect_uri`, `response_type`, `scope`, `state`. `redirect_uri` = `http://127.0.0.1:54321/auth/v1/callback`, `scope` = `email profile`.

> **Koreksi (22 Oktober 2026, remediation P3 RV4):** `client_id` tidak kosong. Saat env tidak diset, Supabase CLI meneruskan teks literal `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)`. Ditemukan di Fase 5 ([receipt](T29-phase5-e2e-regression.md), *Kegagalan di tengah jalan* butir 3).

Temuan untuk plan: `code_challenge` **tidak** diteruskan ke Google. PKCE berlaku antara app dan Supabase; Supabase ke Google memakai `state`. Acceptance 3 dan Fase 5 diperbaiki: E2E memeriksa `code_challenge` pada request ke `/auth/v1/authorize` Supabase, dan memeriksa `redirect_uri` serta `state` pada request ke Google.

Belum terbukti: bahwa `amr` login Google berisi `method = oauth`. Itu hanya bisa dilihat dengan login Google nyata (smoke staging atau credential lokal).

Risiko lingkungan: checkout utama (T28) belum punya blok Google. Bila sesi lain me-restart stack dari checkout itu, provider Google lokal mati lagi sampai T29 di-merge.

## Acceptance terbukti

Belum ada acceptance T29; Fase 0 hanya baseline.

## Warning

- Log web server E2E berisi `Error: The destination stream closed early.` beberapa kali, dengan suite tetap lulus. Ini ada sebelum perubahan T29 dan dicatat sebagai pembanding untuk Fase 5.
- `src/server/auth/adapter.ts` di worktree berbeda hash dengan checkout utama, tanpa beda isi di git (`git diff origin/main claude/t28-import-mode-choice` kosong). Penyebabnya CRLF dari `core.autocrlf=true` pada worktree baru.

## Blocker

Tidak ada. (Sempat menunggu jendela restart stack; selesai setelah suite T28 berhenti.)

## Langkah berikutnya

Fase 1: helper `oauth-session.ts`, flag `isGoogleAuthEnabled()`, commit blok `config.toml` dan `.env.example`.

# T29 Fase 1: konfigurasi dan helper murni

Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5). Worktree `D:\Project\WorkPulse-t29`, branch `claude/t29-google-oauth`, mulai dari `caf3d58`.

## Tujuan

Menyiapkan provider Google di Supabase lokal, flag server, dan helper murni yang dipakai action (Fase 2), callback, dan hapus akun (Fase 3). Belum ada perubahan perilaku yang terlihat pengguna.

## File berubah

- `supabase/config.toml`: blok `[auth.external.google]` (plan §3.1), credential dari env.
- `.env.example`: `WORKPULSE_AUTH_GOOGLE_ENABLED=false` di bagian server, dan dua variabel Supabase CLI di bagian sendiri.
- `docs/verification/T25-release-runbook.md` §2: tiga baris tabel variabel untuk nama baru (lihat Warning).
- `src/server/auth/recovery-session.ts`: `hasRecentMethod` diekspor dengan parameter `windowSeconds` (default 15 menit, jadi dua fungsi recovery tidak berubah).
- `src/server/auth/oauth-session.ts` (baru): `OAUTH_RETURN_COOKIE`, `REAUTH_INTENT_COOKIE`, `OAUTH_COOKIE_MAX_AGE_SECONDS` (600), `oauthCookieOptions(production)`, `readOAuthReturn`, `readReauthIntent`, `hasRecentOAuthProof` (jendela 300 detik), `googleDisplayNameSuggestion`.
- `src/server/supabase/config.ts`: `isGoogleAuthEnabled()`.
- `tests/unit/oauth-session.test.ts` (baru, 10 test).

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/oauth-session.test.ts` sebelum implementasi | exit 1, suite gagal: `Cannot find package '@/server/auth/oauth-session'` (gagal yang diharapkan) |
| `vitest run tests/unit/oauth-session.test.ts tests/unit/recovery-session.test.ts` | exit 0, 2 file / 14 test |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` (pertama) | exit 1, 1 gagal: `release-docs.test.ts` "list in the runbook exactly the variables of .env.example" |
| `pnpm test` (setelah baris runbook) | exit 0, 136 file / 1272 test (baseline 135 / 1262) |

Stack Supabase lokal sudah berjalan dengan blok Google sejak Fase 0 (restart tanpa `db:reset`).

## Acceptance terbukti

Belum ada acceptance §1 yang lengkap. Bagian yang sudah dijaga test:

- Acceptance 1 (bagian flag): hanya string persis `true` yang menyalakan `isGoogleAuthEnabled()`; `""`, `false`, `1`, `yes`, `TRUE`, dan `" true "` mematikan.
- Acceptance 2 dan 4 (bagian cookie): atribut cookie (HttpOnly, Lax, path `/`, 600 detik, Secure di production), dan return path disanitasi ulang saat dibaca (URL absolut, protocol-relative, dan `/auth/confirm` jatuh ke fallback).
- Acceptance 8 (bagian helper): `full_name` lalu `name`, spasi dirapikan, non-string dan kosong menjadi `null`, dipotong per code point tanpa memecah emoji.
- Acceptance 9 (bagian klaim): `oauth` ≤ 300 detik diterima, 301 detik, method lain, dan bentuk rusak ditolak, skew 60 detik ditoleransi.

## Warning

- `tests/unit/release-docs.test.ts` (guard T25) mewajibkan setiap nama di `.env.example`, termasuk baris yang dikomentari, ada tepat sekali di tabel runbook T25 §2, dengan kolom proses yang diawali `web|worker|web dan worker|ops|tes`. Dua variabel CLI dicatat sebagai `tes (Supabase CLI lokal)` karena tidak dibaca proses aplikasi mana pun. Ini menyentuh dokumen T25, tetapi hanya menambah baris; plan §2.1 belum menyebut file ini dan saya catat di sini.
- Server client Supabase memakai `SUPABASE_URL` lebih dulu, lalu `NEXT_PUBLIC_SUPABASE_URL` (`src/server/supabase/config.ts:19`). URL authorize dari `signInWithOAuth` dibangun dari URL itu, jadi `SUPABASE_URL` di web harus dapat dijangkau browser. Di hosted keduanya URL `*.supabase.co`. Fase 2 memeriksa origin URL authorize terhadap URL publik; bila berbeda, action gagal tertutup dengan `UNAVAILABLE`, sesuai plan §3.2.

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 2: `signInWithGoogle` dan `getUser` yang diperluas di `AuthAdapter`, `signInWithGoogleAction`, dan `startGoogleReauthAction`, dimulai dari test gagal `auth-google-action.test.ts`.

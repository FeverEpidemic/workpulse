# T29 Fase 2: adapter dan action Google

Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5). Worktree `D:\Project\WorkPulse-t29`, branch `claude/t29-google-oauth`, mulai dari `283738a`.

## Tujuan

`AuthAdapter` dapat memulai OAuth Google dan melaporkan provider identitas serta nama dari Google. Dua Server Action baru: masuk dengan Google di S01, dan reautentikasi Google untuk hapus akun di S12. Belum ada UI yang memanggilnya.

## File berubah

- `src/server/auth/adapter.ts`: tipe `AuthUser` (`providers`, `fullName`), `getUser()` membaca `identities[].provider` dengan fallback `app_metadata.providers`, `signInWithGoogle({ redirectTo, selectAccount })` memanggil `signInWithOAuth` dengan `skipBrowserRedirect: true` dan, untuk reauth, `queryParams.prompt = "select_account"`.
- `src/server/auth/actions.ts`: `signInWithGoogleAction`, `startGoogleReauthAction`, helper `trustedAuthorizeUrl`.
- `src/server/supabase/config.ts`: `getBrowserSupabaseOrigin()` dari `NEXT_PUBLIC_SUPABASE_URL`.
- `src/server/auth/oauth-session.ts`: `reauthIntentValue(userId)`; `readReauthIntent(value, userId)` sekarang mencocokkan pengguna.
- `tests/unit/auth-google-action.test.ts` (baru, 14 test); `tests/unit/oauth-session.test.ts` (test niat diganti).
- `docs/verification/T29-implementation-plan.md` §2.2 butir 4 dan tabel §3.3: nilai cookie niat.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run auth-google-action.test.ts oauth-session.test.ts` sebelum implementasi | exit 1: 14/14 test action gagal (export belum ada), 1 test niat gagal (`reauthIntentValue` belum ada) |
| sama, setelah implementasi | exit 0, 2 file / 24 test |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, 137 file / 1286 test (Fase 1: 136 / 1272) |

## Acceptance terbukti

- **Acceptance 1 (bagian action):** flag mati mengembalikan `UNAVAILABLE` tanpa memanggil Auth dan tanpa cookie.
- **Acceptance 2:** `signInWithOAuth` dipanggil dengan `provider: "google"`, `redirectTo` persis `http://127.0.0.1:3000/auth/confirm`, `skipBrowserRedirect: true`, tanpa scope tambahan. Redirect hanya ke URL dengan origin `NEXT_PUBLIC_SUPABASE_URL`; origin lain, `javascript:`, URL relatif, dan `null` ditolak tanpa cookie. Cookie `wp-oauth-return` berisi return path tersanitasi (URL asing jatuh ke `/dashboard`) dengan atribut plan. Cookie `wp-reauth` lama dihapus. Error Auth dipetakan tanpa membawa pesan aslinya.
- **Acceptance 9 (bagian action):** reauth butuh session dan identitas `google` (akun hanya `email` ditolak `VALIDATION` tanpa cookie), memakai `prompt=select_account`, dan menyimpan `wp-reauth = delete-account.<user id>`.

## Perubahan dari plan

1. **Cookie niat diikat ke `user.id`.** Plan menulis nilai `delete-account` saja. Bila pengguna memilih akun Google lain di layar Google, session berganti ke akun itu, dan cookie tanpa ID akan membuka dialog hapus untuk akun yang tidak meminta. Callback Fase 3 hanya membuka dialog bila ID di cookie sama dengan user session. Plan §2.2 butir 4 dan §3.3 sudah disesuaikan.
2. **Reauth tidak bergantung pada flag.** Plan tidak menyebut ini. Bila flag dimatikan lagi setelah ada pengguna Google, mereka tetap harus bisa menghapus akun. Masuk dengan Google tetap bergantung pada flag.
3. **Origin dibandingkan dengan `NEXT_PUBLIC_SUPABASE_URL`.** Server client memakai `SUPABASE_URL` lebih dulu. Bila keduanya berbeda (misalnya URL internal), URL authorize tidak dapat dibuka browser, jadi action gagal tertutup dengan `UNAVAILABLE` (test "fails closed when the server Supabase URL is not the browser one").

## Warning

- `pnpm test:integration:account-deletion` tidak dijalankan di fase ini. Bentuk `getUser()` hanya bertambah field, dan suite itu dijadwalkan di Fase 3, yang mengubah service hapus akun.
- Bahwa `signInWithOAuth` di client SSR menyimpan code verifier PKCE di cookie belum dibuktikan dengan browser. Fase 5 (E2E) memeriksa `code_challenge` di request authorize.

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 3: cabang OAuth di `/auth/confirm` (parameter `error`, cookie return dan niat, `deleting_at`) dan metode `google` di service hapus akun, dimulai dari test gagal `auth-confirm-oauth.test.ts`.

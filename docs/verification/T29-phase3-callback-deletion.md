# T29 Fase 3: callback OAuth dan hapus akun metode Google

Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5). Worktree `D:\Project\WorkPulse-t29`, branch `claude/t29-google-oauth`, mulai dari `0afde78`. antislop: mode **during**, dipilih pengguna di sesi ini untuk T29 (copy Fase 3 dan UI Fase 4).

## Tujuan

`/auth/confirm` menangani hasil login Google: gagal atau batal di provider, akun yang sedang dihapus, return path dari cookie, dan niat reautentikasi hapus akun. Service hapus akun menerima metode `google` untuk akun tanpa password, dengan bukti login Google ≤ 5 menit.

## File berubah

- `src/app/auth/confirm/route.ts`: notice `oauthFailed` untuk parameter `error` tanpa token/code; deteksi sesi OAuth (`code` tanpa `type`, bukan recovery, `amr` berisi `oauth` segar); cek `deleting_at` khusus sesi OAuth; niat reauth dibaca dengan `readReauthIntent(cookie, user.id)`; return path dari cookie `wp-oauth-return`; setiap redirect menghapus `wp-oauth-return` dan `wp-reauth`.
- `src/app/sign-in/page.tsx`: notice `oauthFailed`.
- `src/i18n/messages.ts`: `auth.oauthFailed` dan `account.delete.error.reauthRequired`, en dan id.
- `src/domain/account/deletion.ts`: kode `REAUTH_REQUIRED`; input menjadi union `{ password, confirmation }` atau `{ method: "google", confirmation }`, keduanya strict.
- `src/features/account/deletion-service.ts`: dependensi `readAmr`; metode `google` hanya untuk akun dengan identitas `google` dan tanpa `email`; urutan cek: input, session, konfirmasi email, bukti OAuth.
- `src/features/account/actions.ts`: field form `method=google` melewati syarat password; `readAmr` dari `getClaims()`; `REAUTH_REQUIRED` menjadi state `VALIDATION` dengan pesannya sendiri.
- `src/server/auth/adapter.ts`: `providersOf` diekspor sebagai `authProviders` dan dipakai service.
- `tests/integration/account-deletion-support.ts`: dependensi `readAmr` untuk helper `deleteThroughService` (jalur password tidak memanggilnya).
- Test: `tests/unit/auth-confirm-oauth.test.ts` (baru, 12), tambahan di `account-deletion-domain.test.ts` (1 baru, 1 daftar kode diperbarui), `account-deletion-service.test.ts` (7 baru), `account-deletion-actions.test.ts` (3 baru).

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run auth-confirm-oauth.test.ts` sebelum implementasi | exit 1, 6 gagal / 6 lulus (6 yang lulus menguji perilaku lama yang dipertahankan) |
| sama, setelah implementasi | exit 0, 12/12 |
| `vitest run` domain, service, actions hapus akun sebelum implementasi | exit 1, 8 gagal / 30 lulus |
| lima file test auth dan hapus akun setelah implementasi | exit 0, 5 file / 64 test |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` (pertama) | exit 2: `account-deletion-support.ts` tidak memberi `readAmr` |
| `pnpm typecheck` (setelah perbaikan helper) | exit 0 |
| `pnpm test` | exit 0, 138 file / 1286 + 23 = 1309 test |
| `pnpm test:integration:account-deletion` | exit 0, 2 file / 15 test (sama dengan angka Gate M5, tanpa perubahan assertion) |
| `pnpm test:e2e:auth` | exit 0, 1 lulus |

## Acceptance terbukti

- **4:** pengguna baru (profil provisional) ke `/onboarding/import`, pengguna lama ke return path dari cookie, return path asing jatuh ke `/dashboard`, cookie OAuth dihapus di setiap hasil.
- **5:** sesi OAuth untuk profil `deleting_at` melakukan sign-out lokal, menghapus cookie auth, dan redirect ke `/sign-in?notice=accountDeleting`. Konfirmasi email untuk profil yang sama tidak berubah perilakunya (test eksplisit).
- **6:** `?error=access_denied&error_description=…` ke `/sign-in?notice=oauthFailed` tanpa menukar code, deskripsi provider tidak muncul di URL.
- **9:** metode `google` lulus hanya dengan `oauth` ≤ 5 menit dan konfirmasi email cocok, tanpa memanggil cek password. `oauth` 301 detik, `password`, atau klaim kosong menghasilkan `REAUTH_REQUIRED` tanpa `begin_account_deletion`. Akun dengan identitas `email`, dan akun tanpa identitas `google`, ditolak `VALIDATION`. Niat reauth membuka `/settings/profile?reauth=delete-account` hanya untuk user yang memulainya dan hanya bila profil complete.
- **10:** jalur password tidak berubah: test lama lulus tanpa diubah, akun dengan dua identitas tetap memakai password, integration `account-deletion` 15/15.
- **11 (bagian callback):** URL akhir tidak berisi `code=`, `state=`, `error`, atau `token`, dan `Cache-Control: no-store`.

## Copy (antislop during)

| Key | en | id |
| --- | --- | --- |
| `auth.oauthFailed` | Signing in with Google did not finish. Try again, or sign in with your email and password. | Masuk dengan Google tidak selesai. Coba lagi, atau masuk dengan email dan kata sandi. |
| `account.delete.error.reauthRequired` | Confirm with Google again. A confirmation lasts 5 minutes. | Konfirmasi dengan Google sekali lagi. Konfirmasi hanya berlaku 5 menit. |

Audit copy: tidak ada em/en dash; nada dan register mengikuti key `auth.*` dan `account.delete.*` yang ada (kalimat pendek yang menyebut langkah berikutnya, `Anda` tidak diperlukan di sini); tidak ada klaim baru selain angka 5 menit, yang sama dengan `OAUTH_REAUTH_WINDOW_SECONDS`. `auth.oauthFailed` tidak menyalahkan pengguna dan tidak membedakan batal dan gagal, karena callback memang tidak membedakannya. Delivery Gate lengkap dijalankan di receipt Fase 4 bersama UI.

## Warning

- Tujuan pengguna provisional adalah `/onboarding/import`, bukan `/onboarding` seperti tebakan awal test; dua assertion test dikoreksi sebelum implementasi, sesuai `destinationForLifecycle`.
- Cek `deleting_at` hanya berjalan untuk sesi OAuth, sesuai plan §3.3. Konfirmasi email dan recovery tetap seperti T03/T23.
- Sesi OAuth dikenali lewat `amr` `oauth` ≤ 5 menit. Exchange code yang baru selalu menghasilkan timestamp sekarang, jadi jendela ini tidak menolak login Google yang sah; bila jam server jauh meleset (> 60 detik ke depan), callback memperlakukannya sebagai login biasa dan cek `deleting_at` tidak jalan. Gate review perlu menilai apakah risiko ini cukup kecil.
- Bentuk `amr` login Google nyata (`method = oauth`) masih asumsi dari dokumentasi Supabase; dibuktikan di smoke staging (Fase 6, runbook).

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 4 (UI, antislop during): tombol Google di S01, nilai awal nama di onboarding, kartu hapus akun versi Google di S12, dimulai dari test markup yang gagal.

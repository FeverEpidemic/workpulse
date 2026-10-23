# T29 Fase 4: UI S01, onboarding, dan S12

Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5). Worktree `D:\Project\WorkPulse-t29`, branch `claude/t29-google-oauth`, mulai dari `c83c6bb`. antislop: mode **during** (pilihan pengguna di sesi ini); skill yang dibaca: core, `antislop-ui`, `antislop-copywriting`, `antislop-human`.

## Tujuan

Tombol masuk dengan Google di S01, isian awal nama dari Google di onboarding, dan dialog hapus akun versi Google di S12.

## File berubah

- `src/features/auth/sign-in-client.tsx`: prop `googleEnabled`; form `google-sign-in-form` (hidden `returnTo`, `SubmitButton` varian secondary, `ActionFeedback`) di atas form email untuk mode *Sign in* dan *Create account*, tidak untuk recovery; pemisah `auth-divider`.
- `src/app/sign-in/page.tsx`: `googleEnabled={isGoogleAuthEnabled()}`.
- `src/features/profile/onboarding-form.tsx`: prop `initialDisplayName`; hanya dipakai saat nama masih `Pending onboarding`; catatan sumber `onboarding-display-name-source` dihubungkan lewat `aria-describedby`. Draft `sessionStorage` tetap menang karena hook draft mengisi field setelah mount.
- `src/features/account/delete-account-state.ts`: tipe `DeletionReauth` dan fungsi murni `deletionReauthView`.
- `src/features/account/delete-account-card.tsx`: prop `reauth` dan `openOnLoad`. Ringkasan data dan alert sekarang di luar form, karena dialog punya dua form: `delete-account-google-form` (penjelasan dan *Confirm with Google*) atau `delete-account-form` (password, atau `method=google` dengan teks konfirmasi Google, lalu email dan tombol hapus). Fokus saat dialog terbuka: field password, tombol Google, atau field email.
- `src/features/profile/profile-workspace.tsx`: meneruskan `deletionReauth` dan `openDeleteDialog`.
- `src/app/(workspace)/settings/profile/page.tsx`: provider dari `authProviders`; nama awal hanya untuk akun dengan identitas `google`; untuk akun Google saja, kesegaran dari `getClaims()` + `hasRecentOAuthProof`; dialog dibuka otomatis hanya bila `?reauth=delete-account` dan konfirmasi masih segar.
- `src/app/globals.css`: `.auth-google .button-secondary` (lebar penuh), `.auth-divider`, `.delete-account-form-step`; hanya token yang ada.
- `src/i18n/messages.ts`: 6 key baru en/id (tabel di bawah).
- `tests/unit/auth-google-ui.test.tsx` (baru, 13 test).
- `D:\Project\WorkPulse\.claude\launch.json` (di luar repo, untracked): konfigurasi `web-t29` untuk cek visual.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/auth-google-ui.test.tsx` sebelum implementasi | exit 1, 10 gagal / 3 lulus (3 yang lulus menguji keadaan tanpa Google) |
| sama, setelah implementasi | exit 0, 13/13 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | exit 0, 139 file / 1322 test (Fase 3: 138 / 1309) |
| grep em dash di `messages.ts` | 0 |
| cek browser `next dev` port 3029, flag menyala | S01 dark 800 px dan light 375 px: tombol tampil, `scrollWidth` 375 = `clientWidth` 375, tombol 286 px di kartu 335 px, tanpa error console |

## Acceptance terbukti (sebagian)

- **1:** tombol absen saat flag mati, ada saat menyala di mode *Sign in* (markup), dan di atas form email.
- **8:** nama Google mengisi field, dengan catatan sumber yang dibacakan pembaca layar; tanpa nama Google, field kosong dan tidak ada catatan. Profil tidak disimpan sebelum submit (tidak ada aksi baru).
- **9 (UI):** akun Google saja tanpa konfirmasi segar melihat penjelasan dan tombol Google, tanpa field password, field email, atau tombol hapus. Dengan konfirmasi segar: field email, hidden `method=google`, teks konfirmasi, tombol hapus. Saat server menjawab `REAUTH_REQUIRED`, dialog kembali ke tombol Google. Akun password tidak berubah.
- **12 (sebagian):** copy en/id lengkap tanpa em dash; tombol memakai varian secondary yang ada; tanpa logo.

Belum: mode *Create account* (state klien, tidak terjangkau markup statis), klik sampai redirect Google, tampilan S12 dan onboarding versi Google di browser, axe 360/1440 light/dark. Semuanya dijadwalkan di E2E Fase 5, dengan fixture akun Google (plan §6).

## Copy (antislop during)

| Key | en | id |
| --- | --- | --- |
| `auth.google.continue` | Continue with Google | Lanjutkan dengan Google |
| `auth.google.divider` | or use your email | atau pakai email |
| `onboarding.displayNameFromGoogle` | Filled in from your Google account. You can change it. | Diisi dari akun Google Anda. Anda bisa mengubahnya. |
| `account.delete.googleExplain` | You sign in with Google, so there is no password to check. Confirm with Google, and this dialog opens again so you can finish. | Anda masuk dengan Google, jadi tidak ada kata sandi untuk diperiksa. Konfirmasi dengan Google, lalu dialog ini terbuka lagi agar Anda bisa menyelesaikannya. |
| `account.delete.googleConfirm` | Confirm with Google | Konfirmasi dengan Google |
| `account.delete.googleConfirmed` | Google confirmed it is you. Finish within 5 minutes by typing your email below. | Google sudah memastikan ini Anda. Selesaikan dalam 5 menit dengan mengetik email Anda di bawah. |

Audit: "Continue with Google" adalah label tombol yang dikenal pengguna untuk aksi ini, bukan CTA generik. Pemisah menyebut alternatifnya ("or use your email"), bukan hanya "or". Setiap kalimat punya pelaku (Anda, Google, dialog). Angka 5 menit sama dengan `OAUTH_REAUTH_WINDOW_SECONDS`. Tidak ada em/en dash.

## Delivery Gate antislop (perantara, sebelum E2E)

Design Read: halaman auth dan S12 yang sudah ada mengikuti `Design.md` (muted sage, satu aksi utama per layar, progressive disclosure). T29 menambah elemen di dalam pola itu, tidak membuat layout baru. Dial dipertahankan dari layar yang ada: ENERGY 2 / RHYTHM 2 / MOTION 1.

**Block 1 Hard Gate**
- R-02 PASS: 0 em dash di `messages.ts`; copy baru diperiksa manual.
- R-03 PASS (S01): 375 px tanpa overflow (`scrollWidth` = `clientWidth`). S12 dan onboarding versi Google: **menunggu Fase 5**.
- R-17, R-18, R-36, R-38 PASS: tidak ada angka, testimoni, atau klaim baru; "5 menit" bersumber dari kode.
- R-23 PASS: tidak ada logo Google atau aset baru; tombol teks saja (plan §2.2 butir 8 menyebut ikon opsional; logo butuh instruksi eksplisit).
- R-24 PASS: tidak ada link navigasi baru.
- R-25: teks pemisah memakai `--color-text-secondary`, token yang sudah dipakai teks sekunder di seluruh app; pengukuran kontras di render nyata lewat axe **menunggu Fase 5**.
- R-26 PASS: tombol Google di S01 dan S12 adalah form dengan Server Action nyata (`signInWithGoogleAction`, `startGoogleReauthAction`), diuji unit di Fase 2.
- R-27 PASS: pending (`SubmitButton` loading), error (`ActionFeedback`, alert dialog), keadaan kedaluwarsa (`REAUTH_REQUIRED` kembali ke tombol Google).
- R-32: tombol dan field memakai komponen yang ada dengan fokus terlihat; urutan fokus dialog ditentukan di kode. Uji keyboard nyata **menunggu Fase 5**.
- R-33 PASS: semua di source.
- R-34: light dan dark S01 dilihat; tema S12 versi Google **menunggu Fase 5**.
- R-35 **PARTIAL**: build dev berjalan dan S01 dilihat; klik sampai Google dan alur S12 diuji di Fase 5.
- R-37 PASS: arah desain dari `Design.md`.

**Block 2 Purpose-Gate:** tidak ada gradient, ikon, monospace, grid, panah, badge, glass, shadow, glow, atau animasi baru. PASS.

**Block 3 Liveliness:** dial dinyatakan di atas; fokus S01 tetap tombol *Sign in* primer, tombol Google secondary; pemisah memakai garis token yang ada, bukan dekorasi baru. PASS.

**Block 4 Craftsmanship:** C-1 setiap keputusan punya alasan di atas; C-2 tidak ada kontrol mati; C-3 tidak ada bagian pengisi; C-4 **menunggu Fase 5** untuk tema/breakpoint S12; C-5 tidak ada klaim. R-11, R-15, R-16, R-20, R-21, R-29, R-30, R-31 PASS (tidak ada bentuk, warna, atau CTA generik baru).

Status gate: belum siap dikirim sampai item "menunggu Fase 5" lulus. Gate dijalankan ulang di receipt Fase 5.

## Warning

- `useEffect` fokus di dialog memakai `eslint-disable-next-line react-hooks/exhaustive-deps`: fokus hanya berpindah saat dialog dibuka atau ditutup, tidak saat tampilan berganti setelah error (efek error memindahkan fokus sendiri).
- Klik tombol Google di browser tidak diuji di fase ini supaya browser tidak membuka situs Google; Fase 5 mencegat request itu di Playwright.

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 5: `tests/e2e/auth-google.spec.ts` (flag mati/menyala, mode *Create account*, redirect authorize dengan `code_challenge`, cegat Google, notice `oauthFailed`, onboarding dan S12 dengan fixture akun Google, axe 360/1440 light/dark), lalu regresi §7 dan gate review.

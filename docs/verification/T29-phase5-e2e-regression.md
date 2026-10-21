# T29 Fase 5: E2E dan regresi penuh

Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5). Worktree `D:\Project\WorkPulse-t29`, branch `claude/t29-google-oauth`, mulai dari `b72b7b4`. antislop: mode **during**.

## Tujuan

Membuktikan alur Google di browser nyata terhadap Supabase lokal tanpa memuat Google, lalu menjalankan regresi penuh dengan flag mati dan menyala.

## File berubah

- `tests/e2e/auth-google.spec.ts` (baru, 13 test) dan `playwright.auth-google.config.ts` (baru, port 3016, `WORKPULSE_AUTH_GOOGLE_ENABLED=true`).
- `package.json`: script baru `test:e2e:auth-google`.
- `tests/e2e/auth-profile.spec.ts`: dua assertion bahwa tombol Google tidak ada saat flag mati.
- `docs/verification/T29-screenshots/` (8 PNG): S01 dan dialog S12 versi Google, 360/1440 px, light/dark.
- `docs/verification/T29-implementation-plan.md` §7: catatan script baru.

## Cara uji alur Google tanpa Google

- Request authorize ke Supabase dicegat dengan `page.route`, diteruskan dengan `route.fetch({ maxRedirects: 0 })`, header `Location` dari Supabase (URL Google) dicatat, lalu dibalas halaman stub. Request ke `accounts.google.com` di-abort.
- Akun Google saja dibuat lewat Admin API, lalu identitas `email` diubah menjadi `google` dan `raw_app_meta_data.providers` menjadi `["google"]` di database lokal. Session diperoleh dengan password, sehingga `amr` = `password` dan tidak pernah dihitung sebagai konfirmasi Google segar.
- Akun dihapus di `afterAll`.

## Command dan hasil

| Command | Flag | Hasil |
| --- | --- | --- |
| `pnpm test:e2e:auth-google` (akhir) | menyala (config) | exit 0, 13 lulus |
| `pnpm lint` | mati | exit 0 |
| `pnpm typecheck` | mati | exit 0 |
| `pnpm test` | mati | exit 0, 139 file / 1322 test |
| `pnpm build` | mati | exit 0 |
| `pnpm worker:check` | mati | exit 0 |
| `pnpm test:e2e:auth` | mati | exit 0, 1 lulus (termasuk assertion tombol tersembunyi) |
| `pnpm test:e2e:ui` | mati / menyala | exit 0, 1 / exit 0, 1 |
| `pnpm test:e2e:release` | mati / menyala | exit 0, 21 / exit 0, 21 (setelah perbaikan Storage) |
| `pnpm test:e2e:m5` | mati / menyala | exit 0, 1 / exit 0, 1 (setelah perbaikan Storage) |
| `pnpm test:e2e:account-deletion` | mati | exit 0, 7 (setelah perbaikan Storage) |
| `pnpm test:integration:account-deletion` | mati | exit 0, 15/15 (setelah perbaikan Storage) |
| grep `console.`/`logger` di `src/server/auth`, `src/app/auth`, `src/features/{account,auth}`, `src/app/sign-in`, S12 | - | 0 baris |

`test:e2e:auth` tidak dijalankan dengan flag menyala: suite itu sekarang memastikan tombol tersembunyi saat flag mati, sedangkan keadaan menyala diuji `auth-google`. Suite `release` menulis ulang screenshot T23, T25, dan T27 di repo; semuanya dikembalikan dengan `git checkout`.

## Kegagalan di tengah jalan dan penyebabnya

1. **Provider Google lokal mati.** Run pertama `auth-google`: Supabase menjawab `Unsupported provider: provider is not enabled`. Sesi T28 me-restart stack dari checkout utama, yang `config.toml`-nya belum punya blok Google. Saya menunggu suite `m2` sesi itu selesai, lalu me-restart lagi dari worktree.
2. **Browser test sempat membuka Google.** Stub pertama mencegat `https://accounts.google.com/**`, tetapi Playwright tidak mencegat request yang dimulai redirect 302, jadi browser test memuat halaman error Google `invalid_client` dua kali. Tidak ada kredensial atau data pengguna yang dikirim. Diperbaiki dengan cara di atas.
3. **`client_id` literal.** Halaman error itu menunjukkan bahwa saat env tidak diset, Supabase CLI mengirim `client_id=env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` apa adanya. Receipt Fase 0 menulis "kosong"; yang benar adalah teks literal. Tidak berdampak pada test, karena Google tidak pernah dimuat lagi.
4. **Cookie `Secure` tersaring di test.** `next start` berjalan sebagai production, jadi `wp-oauth-return` dan `wp-reauth` ber-atribut `Secure`; `context.cookies("http://…")` menyembunyikannya. Test diubah membaca semua cookie. Chrome tetap mengirim cookie `Secure` ke `127.0.0.1`.
5. **Storage rusak setelah restart dari worktree (`42P10`).** Regresi pertama: `account-deletion` (integration 14 gagal, E2E 1 gagal), `release` 1 gagal, `m5` 1 gagal. Penyebab: Supabase CLI memilih image dari `supabase/.temp/*-version` (git-ignored, ada di checkout utama: `storage-api v1.80.2`, `postgres 17.11.0.003`). Worktree tidak punya file itu, jadi restart memakai image default yang lebih lama (`storage-api v1.72.1`, `postgres 17.6.1.167`), sedangkan skema Storage sudah dimigrasikan image baru (migrasi #72 `drop-bucketid-objname-index`); setiap upload gagal `ON CONFLICT (name, bucket_id)`. Perbaikan: lima file versi disalin ke `.temp` worktree (tanpa `project-ref` dan `linked-project.json`), stack di-restart tanpa `db:reset`, upload uji berhasil, dan keempat suite lulus. Ini masalah lingkungan, bukan kode T29.

## Acceptance terbukti

- **1:** flag mati: tidak ada tombol (E2E `auth`, unit). Flag menyala: tombol di *Sign in* dan *Create account*, tidak di recovery (E2E).
- **2:** cookie `wp-oauth-return` = `%2Fprojects`, HttpOnly, SameSite Lax; cookie code verifier PKCE dari `@supabase/ssr` tersimpan (E2E, ditambah unit Fase 2).
- **3:** request ke `/auth/v1/authorize` membawa `provider=google`, `code_challenge`, `code_challenge_method=s256`, `redirect_to=http://127.0.0.1:3016/auth/confirm`; Supabase meneruskan ke Google dengan `redirect_uri=http://127.0.0.1:54321/auth/v1/callback` dan `state` (E2E).
- **6:** `/auth/confirm?error=access_denied&error_description=…` sampai di `/sign-in?notice=oauthFailed`, pesan netral tampil, teks provider tidak tampil, cookie return terhapus (E2E).
- **8:** onboarding akun Google: field berisi nama Google, catatan sumber terhubung `aria-describedby`, profil di database tetap `Pending onboarding` dan belum complete (E2E).
- **9 (yang dapat diuji lokal):** akun Google saja dengan session password: `?reauth=delete-account` tidak membuka dialog; dialog tanpa field password, field email, atau tombol hapus; fokus di *Confirm with Google*; Esc menutup dan fokus kembali ke pemicu; Enter memulai reauth dengan `prompt=select_account`; cookie `wp-reauth` = `delete-account.<id user>`, HttpOnly; tidak ada baris `internal.account_deletions` (E2E). Langkah setelah konfirmasi segar dibuktikan unit (Fase 3 dan 4).
- **10:** jalur password tidak berubah: E2E dan integration `account-deletion` lulus tanpa perubahan assertion.
- **11:** tidak ada logging di kode auth; URL akhir callback bersih (unit Fase 3, E2E notice).
- **12:** axe tanpa pelanggaran WCAG 2.2 AA pada S01 (mode *Sign in* dan *Create account*) dan dialog S12 versi Google di 360 dan 1440 px, light dan dark, tanpa overflow halaman maupun dialog; onboarding versi Google bersih (E2E).
- **13:** regresi di tabel di atas lulus dengan flag mati dan menyala.

Belum terbukti dan menunggu smoke staging (Fase 6, runbook): **7** (penautan akun email dan Google ke satu `user.id`), bentuk `amr` login Google nyata (`method = oauth`), dialog yang terbuka otomatis setelah kembali dari Google, dan penghapusan akun Google sampai selesai.

## Delivery Gate antislop (final)

Design Read dan dial sama dengan Fase 4 (ENERGY 2 / RHYTHM 2 / MOTION 1, mengikuti `Design.md`).

**Block 1 Hard Gate**
- R-02 PASS: 0 em dash di copy.
- R-03 PASS: tanpa overflow di S01 (dua mode) dan dialog S12 versi Google, 360/1440 px, light/dark (E2E `horizontalOverflow`).
- R-17, R-18, R-36, R-38 PASS: tidak ada angka, testimoni, atau klaim baru; "5 menit" bersumber dari kode.
- R-23 PASS: tidak ada logo atau aset baru.
- R-24 PASS: tidak ada navigasi baru.
- R-25 PASS: axe bersih di 8 kombinasi S01 dan 4 kombinasi S12 versi Google, termasuk aturan kontras.
- R-26 PASS: tombol Google di S01 dan S12 diklik di E2E dan menghasilkan redirect nyata ke Supabase Auth.
- R-27 PASS: pending, error, dan keadaan kedaluwarsa ada (unit Fase 3/4, notice `oauthFailed` di E2E).
- R-32 PASS: dialog S12 dioperasikan dengan keyboard (Enter membuka, fokus di tombol Google, Esc menutup, fokus kembali, Enter memulai reauth).
- R-33 PASS: semua di source.
- R-34 PASS: light dan dark diuji di S01 dan S12.
- R-35 PASS: build production dijalankan dan setiap kontrol baru diklik di E2E.
- R-37 PASS: arah dari `Design.md`.

**Block 2 Purpose-Gate:** tidak ada teknik dekoratif baru. PASS.

**Block 3 Liveliness:** dial dinyatakan; S01 tetap punya satu aksi primer (*Sign in*), Google secondary (screenshot `s01-google-1440-light.png`); dialog S12 versi Google punya satu aksi primer (*Confirm with Google*). PASS.

**Block 4 Craftsmanship:** C-1 sampai C-5 PASS; R-05, R-11, R-15, R-16, R-20, R-21, R-29, R-30, R-31 PASS.

**Human checklist:** kontras diukur axe pada render nyata; fokus terlihat lewat komponen yang ada; keyboard dan Esc diuji; state ada dan tidak hanya warna; layout 360 px tanpa overflow. PASS.

Status gate: PASS untuk cakupan lokal. Item yang butuh Google nyata dicatat di atas sebagai smoke staging.

## Warning

- Suite `auth-google` bergantung pada blok `[auth.external.google]` di `config.toml`. Sampai T29 di-merge, setiap restart stack dari checkout lain mematikan provider itu, dan suite akan gagal dengan `provider is not enabled`.
- Restart stack dari worktree baru harus memakai file versi image dari `supabase/.temp` checkout utama; tanpa itu Storage rusak (`42P10`). Dicatat juga di memori lokal pelaksana.
- Plan §7 menyatakan tanpa script baru dan menambahkan spec ke `test:e2e:auth`. Itu tidak bisa, karena flag dibaca server dan suite `auth` harus berjalan dengan flag mati. Jadi ada config dan script `test:e2e:auth-google` sendiri.

## Blocker

Tidak ada untuk cakupan lokal.

## Langkah berikutnya

Gate review Claude (plan §9), read-only di worktree bersih pada commit ujung fase ini. Setelah gate: Fase 6 (decision record, runbook provider, dokumen bukti).

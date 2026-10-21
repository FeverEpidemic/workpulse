# T29 Gate review: Masuk dengan Google

Tanggal: 22 Oktober 2026. Reviewer: Claude (Opus 5.5). Diperiksa: branch `claude/t29-google-oauth`, ujung `363293f` (10 commit sejak `466b2f8`, 48 file, +2275/−93). Verifikasi ulang di worktree bersih terpisah `D:\Project\WorkPulse-t29-review` (detached `363293f`, `pnpm install --frozen-lockfile`).

## Verdict

**PASS untuk cakupan lokal.** Tidak ada temuan P0, P1, atau P2. Delapan P3 dicatat (N1–N8). Fase 6 (draft dokumen) boleh dimulai.

Batas: pelaksana Fase 0–5 dan reviewer adalah agen yang sama, sehingga independensi review terbatas. Untuk mengurangi risikonya, semua check diulang di worktree bersih, dan diff kode sumber dibaca ulang per file terhadap §9 dan §10 plan. Login Google nyata, penautan akun (acceptance 7), dan bentuk `amr` OAuth belum terbukti; semuanya menunggu smoke staging di runbook Fase 6. Keberhasilan lokal bukan bukti production.

## Checklist plan §9

| Item | Hasil | Bukti |
| --- | --- | --- |
| Ulangi lint, typecheck, unit, `test:e2e:auth`, integration `account-deletion` | PASS, angka cocok dengan receipt | tabel command di bawah |
| `route.ts`: cabang `token_hash` dan recovery identik secara perilaku | PASS | diff hanya menambah `deleting_at` ke select dan cabang `isOAuthSession`; test lama dan 5 test "keeps the email and recovery paths" di `auth-confirm-oauth.test.ts` |
| Semua cabang callback menghapus cookie OAuth | PASS | `redirectTo()` men-set `wp-oauth-return` dan `wp-reauth` `maxAge: 0` pada setiap respons |
| Tidak ada redirect dari input request selain return path tersanitasi | PASS | tujuan callback: konstanta, `destinationForLifecycle(..., readOAuthReturn(cookie))`, atau `sanitizeReturnTo(next)` lama |
| `redirect()` di action hanya ke origin Supabase | PASS | `trustedAuthorizeUrl` membandingkan origin dengan `NEXT_PUBLIC_SUPABASE_URL`; unit menolak origin lain, `javascript:`, relatif, `null`, dan URL internal |
| Metode `google` tidak bisa dipakai akun ber-password, tidak lolos tanpa `amr` segar | PASS | `deletion-service.ts`: `providers.includes("email") \|\| !includes("google")` → `VALIDATION`; `hasRecentOAuthProof` → `REAUTH_REQUIRED`; 7 unit service, 3 unit action |
| Flag mati menyembunyikan tombol dan menolak action | PASS | unit action, markup, dan E2E `auth` (assertion baru) |
| Tidak ada secret di repo | PASS | `GOCSPX`, `apps.googleusercontent.com`, `client_secret` hanya cocok di teks checklist plan |
| Copy en/id dan axe | PASS | 0 em dash; axe bersih di S01 (dua mode) dan dialog S12 versi Google, 360/1440 px, light/dark; onboarding versi Google |

## Review focus §10

1. **Open redirect atau credential bocor.** Aman. `data.url` dibatasi ke origin Supabase publik. Return path disanitasi saat disimpan dan saat dibaca. URL akhir callback tidak membawa `code`, `state`, `error`, atau token (unit), dan `error_description` tidak tampil (E2E).
2. **Akun `deleting` masuk lewat Google.** Callback OAuth memeriksa `deleting_at`, lalu sign-out dan menghapus cookie auth (unit). Pertahanan tambahan yang sudah ada: ban saat `begin_account_deletion` dan `getRequestContext` yang memperlakukan akun `deleting` sebagai keluar. Lihat N1 untuk celah klasifikasi.
3. **Reautentikasi palsu.** Query `reauth` hanya membuka dialog bila konfirmasi segar, dan cookie niat hanya mengarahkan. Keputusan ada di service lewat `amr` dari `getClaims()`. E2E membuktikan session password dengan `?reauth=delete-account` tidak membuka dialog dan tidak membuat baris `internal.account_deletions`.
4. **Recovery salah klasifikasi.** `isOAuthSession` mensyaratkan `!isRecoverySession`; unit "PKCE code with a recovery claim" mengarah ke `/update-password`.
5. **Akun ganda karena penautan.** Tidak dapat dibuktikan lokal (N5).
6. **Konfigurasi hosted mengenai pilot.** Flag default mati di `.env.example` dan runbook T25; flag mati dibuktikan E2E.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| N1 | P3 | Callback mengenali sesi OAuth hanya bila `amr` berisi `oauth` ≤ 300 detik dengan toleransi skew 60 detik (`route.ts`, `isOAuthSession`). Bila jam server meleset lebih jauh, login Google diperlakukan sebagai login biasa: cek `deleting_at` dilewati dan cookie return diabaikan. Dampak dibatasi ban akun `deleting` dan `getRequestContext`. Test yang membuktikan perbaikan: unit callback dengan `amr` oauth berumur 400 detik yang tetap terklasifikasi OAuth, bila klasifikasi diubah ke "method oauth ada" tanpa jendela waktu. | follow-up |
| N2 | P3 | Pada reautentikasi S12, bila pengguna memilih akun Google lain di layar Google, session berganti ke akun itu tanpa pemberitahuan. Dialog hapus tidak terbuka (cookie niat terikat ke `user.id`, terbukti unit), tetapi pengguna mendarat di dashboard akun lain. Perbaikan: notice khusus saat cookie niat ada tetapi `user.id` berbeda; test unit callback. | follow-up |
| N3 | P3 | `test:e2e:auth-google` tidak hermetis: butuh blok `[auth.external.google]` di stack lokal bersama (hilang setiap kali stack di-restart dari checkout tanpa blok itu) dan file versi image `supabase/.temp/*-version` saat restart dari worktree baru (tanpa itu Storage rusak `42P10`). Hilang dengan sendirinya setelah merge ke `main`, kecuali soal file versi image. | follow-up |
| N4 | P3 | `T25-release-runbook.md` dan plan merujuk `T29-google-oauth-runbook.md` yang belum ada; dibuat di Fase 6. | tutup di Fase 6 |
| N5 | P3 | Acceptance 7 (penautan email dan Google ke satu `user.id`), bentuk `amr` login Google nyata, dialog hapus yang terbuka otomatis setelah kembali dari Google, dan penghapusan akun Google sampai selesai belum terbukti. Butuh smoke staging dengan OAuth client nyata. | smoke staging |
| N6 | P3 | Receipt Fase 0 menulis `client_id` "kosong" saat env tidak diset; yang benar adalah teks literal `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)`. Sudah dikoreksi di receipt Fase 5; receipt Fase 0 tidak diubah. | catatan |
| N7 | P3 | Saat menulis E2E, browser test sempat memuat halaman error Google (`invalid_client`) dua kali sebelum stub diperbaiki. Tidak ada kredensial atau data pengguna yang terkirim. | catatan |
| N8 | P3 | Nama dari Google hanya mengisi form onboarding manual di S12. Jalur onboarding lewat import (draft S03) tetap memakai nama dari CV. Sesuai plan, tetapi perlu disebut di decision record. | catatan untuk Fase 6 |

## Command, exit, hasil (worktree review `363293f`)

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 139 file / 1322 test |
| `pnpm build` | 0 | compiled |
| `pnpm worker:check` | 0 | bersih |
| `git diff --check 466b2f8..HEAD` | 0 | kosong |
| `pnpm test:e2e:auth-google` | 0 | 13 lulus |
| `pnpm test:e2e:auth` | 0 | 1 lulus |
| `pnpm test:e2e:account-deletion` | 0 | 7 lulus |
| `pnpm test:integration:account-deletion` | 0 | 2 file / 15 test |

Run pertama keempat suite terakhir gagal sebelum test pertama karena Docker Desktop tidak berjalan (`failed to connect to the docker API`). Docker dinyalakan, container Supabase pulih dengan konfigurasi yang sama (Google aktif, `storage-api v1.80.2`, upload uji `ok`), lalu suite dijalankan ulang tanpa perubahan kode dan semuanya lulus.

Tidak dijalankan ulang oleh reviewer: `test:e2e:release`, `test:e2e:m5`, `test:e2e:ui`. Receipt Fase 5 mencatat ketiganya lulus dengan flag mati dan menyala di `363293f`, dan tidak ada commit kode sejak itu. `pnpm db:test` dan `db:lint` tidak dijalankan: T29 tanpa migration (parity 38/38), dan database lokal bersama gagal 3 assertion karena M5-N3.

## Yang dibutuhkan dari pengguna

Smoke staging (N5) mengikuti runbook Fase 6: OAuth client di Google Cloud Console, provider Google di dashboard Supabase hosted, dan Redirect URL `https://myworkpulse.my.id/auth/confirm`. Credential tidak dikirim ke chat.

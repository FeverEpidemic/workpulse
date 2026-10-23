# T29 remediation P3 Fase 2: notice akun berganti

Tanggal: 22 Oktober 2026. antislop during (session override).

## Tujuan dan file

RV2: callback mengarahkan cookie niat nonkosong milik akun lain ke S12 switched, profil provisional tetap onboarding. S12 meneruskan hanya query persis switched ke ProfileWorkspace dan DeleteAccountCard. Notice role=status memakai accountEmail dari context.user.email server. Tidak membaca email dari query/cookie, membuka dialog, atau menulis data. File: route callback, halaman S12, ProfileWorkspace, DeleteAccountCard, messages en/id, unit callback/markup, E2E auth-google.

## Commands dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| Unit callback + markup, percobaan pertama | 1 | 2 gagal / 15 lulus, 1 suite parse error pada regex test baru |
| Unit sama, regex diperbaiki | 1 | 5 gagal / 28 lulus; satu assertion baru terlalu luas karena status loading dialog lama |
| Unit sama, assertion dibatasi pada luar dialog | 1 | 4 gagal / 29 lulus |
| Unit sama, setelah implementasi | 0 | 2 file / 33 test lulus |
| pnpm typecheck | 0 | bersih |
| pnpm test:e2e:auth-google, run pertama RV2 | 1 | 15 lulus / 2 gagal, overflow 360 px |
| pnpm test:e2e:auth-google, setelah wrapping email | 0 | 17 lulus |
| git diff --check | 0 | bersih |

## Acceptance dan desain

RV2 §2.3–4 dan copy §2.7: cookie sendiri tetap delete-account, cookie akun lain switched dan kedua cookie dihapus, tanpa/intent kosong tetap dashboard, provisional tetap onboarding. Unit en/id menunjukkan email session dan tidak ada dialog terbuka. E2E memakai session delete yang ada: switched tampil, other/kosong tidak, dialog tertutup, antrean deletion tetap nol. Axe WCAG dan overflow lulus 360/1440 × light/dark × en/id.

Design Read: S12 untuk pemilik workspace karier privat, tenang dan terarah mengikuti Design.md, ENERGY 2 / RHYTHM 2 / MOTION 1. Notice memakai surface subtle, font dan spacing yang ada agar informasi akun terbaca dekat aksi hapus, tanpa ikon/aset/motion baru. Copy draft plan dipertahankan: fakta akun aktif dan tidak ada yang dihapus, nada Anda konsisten account.delete.*, tanpa em dash. Pembungkusan overflow-wrap:anywhere diperlukan karena email fixture panjang terbukti overflow pada dua test 360 px.

## Penyimpangan yang diizinkan

Pengguna menyetujui perubahan satu assertion lama /dashboard menjadi /settings/profile?reauth=switched. Lima test email/recovery tidak diubah.

## Warning, blocker, berikutnya

Warning stream Next ditutup awal saat navigasi dan warna terminal sama dengan baseline; suite lulus. Tidak ada blocker. Berikutnya Fase 3 RV3/RV4, lalu regresi Fase 4.

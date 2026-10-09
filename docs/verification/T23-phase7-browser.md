# T23 Fase 7 — Browser acceptance

- Tanggal: 9 Oktober 2026
- Eksekutor: Claude Sonnet 5.5
- Mode antislop: during (pilihan pengguna di sesi ini)

## File berubah

| File | Perubahan |
| --- | --- |
| `playwright.account-deletion.config.ts` | baru: port 3015, server web tanpa env AI, renderer, dan worker |
| `tests/e2e/account-deletion.spec.ts` | baru: 7 test |
| `tests/e2e/helpers/account-deletion-worker.ts` | baru: menjalankan worker nyata sebagai proses anak dengan env yang disaring, dan helper `sql` |
| `package.json` | script `test:e2e:account-deletion` |
| `src/app/globals.css` | `.ui-dialog { margin: auto }` (lihat temuan visual) |
| `docs/verification/T23-screenshots/*.png` | 12 screenshot |

## Command (hasil nyata)

| Command | Hasil |
| --- | --- |
| `pnpm test:e2e:account-deletion` | **7 passed** (1,4 menit), dijalankan dua kali: sebelum dan sesudah perbaikan CSS dialog |
| `pnpm test:e2e:cv-export` | **12 passed** (2,3 menit); test "a failed export offers Retry for the same snapshot; after the CV changed only Regenerate is offered" lulus tanpa diubah |
| `pnpm typecheck`, `pnpm lint` | exit 0 |

Keluaran `[WebServer] Error: The destination stream closed early` muncul selama `test:e2e:cv-export` (unduhan PDF yang diputus oleh browser). Tidak ada test yang gagal karenanya; tidak diselidiki lebih jauh karena bukan bagian T23.

## Klik-through (R-35), per skenario

| Skenario | Hasil |
| --- | --- |
| Tombol *Delete account* diaktifkan dengan Enter (fokus lewat keyboard) | dialog terbuka, fokus di field password |
| Pratinjau | menampilkan `Activities: 1` dan `Master CV: none`; teks sentinel tidak ada di dialog |
| Tombol danger pada awal | nonaktif |
| Password salah, email benar dalam huruf besar, Enter di field | pesan *That password is not correct.* di field, `aria-invalid="true"`, fokus kembali ke password, password kosong, konfirmasi tetap terisi, profil tidak `deleting`, tidak ada receipt |
| Password benar, email lain | tombol danger tetap nonaktif; tidak ada receipt |
| Password benar, email benar, Enter | redirect ke `/sign-in?notice=accountDeleted` dengan teks notice; profil `deleting`; receipt `queued` |
| `/dashboard` setelahnya | diarahkan ke `/sign-in` |
| Konteks browser kedua (user sama, masuk sebelum penghapusan) membuka `/activity` | diarahkan ke `/sign-in` |
| Sign-in ulang dengan password benar | *Email or password is incorrect.* dan tetap di `/sign-in` |
| Worker nyata dikuras | receipt `completed`; user Auth, profil, aktivitas, dan objek Storage hilang; keluaran worker tidak memuat sentinel atau email |
| Email yang sama didaftarkan ulang lalu masuk lewat UI | masuk ke `/onboarding`, nol aktivitas |
| Akun lain | objeknya masih ada, dapat masuk, dan aktivitasnya tampil |
| Escape | dialog tertutup, fokus kembali ke tombol pemicu |
| Cancel dengan keyboard | dialog tertutup, fokus kembali ke pemicu |
| `prefers-reduced-motion: reduce` | tidak ada animasi berjalan saat dialog terbuka; perilaku sama |
| Email yang diketik lalu dialog ditutup dan dibuka lagi | field konfirmasi kosong |
| S03 dengan batch `review` | notice tanggal pembatalan otomatis (30 hari dari aktivitas terakhir) dalam en dan id, sama dengan format UTC yang diharapkan |

## Aksesibilitas dan responsive

- Axe (WCAG A dan AA, wcag2a sampai wcag22aa) tanpa pelanggaran pada: S12 tertutup, dialog terbuka, error password, konfirmasi belum cocok, serta matriks 360 dan 1440 px × light dan dark untuk keadaan tertutup, terbuka, dan error (12 pemindaian), dan notice S03.
- Nol overflow horizontal pada halaman dan pada dialog di 12 kombinasi tersebut.
- Fokus masuk ke field password saat dialog dibuka dan kembali ke pemicu saat ditutup (Escape dan Cancel), diuji.

## Screenshot dan temuan visual

12 file `s12-delete-{closed,open,error}-{360,1440}-{light,dark}.png` di `docs/verification/T23-screenshots/` (hanya data fixture; email di screenshot adalah akun uji `@workpulse.test`).

Inspeksi visual mengubah satu hal:

1. **Dialog menempel di pojok kiri atas** pada run pertama (360 dan 1440 px). Penyebabnya reset `margin: 0` Tailwind v4 yang membatalkan `margin: auto` bawaan `<dialog>`; `.ui-dialog` tidak mengembalikannya. Ini cacat lama komponen `Dialog` bersama, bukan khusus T23. Diperbaiki dengan `margin: auto` pada `.ui-dialog` dan screenshot diambil ulang; dialog kini di tengah dan test tetap lulus. Dialog lain di aplikasi ikut terpusat. Regresi penuh di Fase 8 memeriksa suite lain.

Temuan lain yang tidak diubah:

2. Di 360 px, setelah error, dialog menggulir ke field yang bermasalah sehingga tombol *Delete account permanently* berada di bawah lipatan dialog; tombol tetap terjangkau dengan menggulir dan lewat Tab. Kinerja ini wajar untuk dialog tinggi di layar kecil, dicatat sebagai pengamatan.
3. Email panjang pada field konfirmasi terpotong secara visual di 1440 px (nilai tetap utuh dan teks bantuan memuat email lengkap yang membungkus).

## Delivery Gate antislop

| Item | Status | Bukti |
| --- | --- | --- |
| R-26 setiap kontrol berfungsi | PASS | tabel klik-through di atas |
| R-27 empty, loading, error | PASS | pratinjau loading dan hasil; error password, konfirmasi, dan alert dialog |
| R-32 keyboard, fokus, Escape | PASS | alur utama lewat keyboard; Escape dan Cancel; fokus masuk dan kembali |
| R-25 kontras | PASS | Axe 0 pelanggaran di light dan dark, 360 dan 1440 |
| R-03 mobile | PASS | nol overflow di 360 px; target interaktif memakai `--touch-target-min` |
| R-34 kedua tema | PASS | screenshot dan Axe light dan dark |
| R-35 dijalankan | PASS | build, server produksi di port 3015, klik-through di atas, tanpa error konsol yang diperiksa tes |
| R-02 em dash | PASS | `account-deletion-i18n.test.ts` |
| R-17, R-36 klaim | PASS dengan catatan | jendela 24 jam dan 30 hari ditulis sebagai kebijakan; klaim backup belum terbukti dan dicatat *belum terverifikasi* di runbook (Fase 9) |
| Dial dan Design Read | ENERGY 1 / RHYTHM 1 / MOTION 1 | layar pengaturan yang ada; tanpa ikon, badge, glow, atau animasi baru |

## Acceptance Fase 7 yang terbukti

§1.1 (reautentikasi: password salah, E2E), §1.2 (konfirmasi dan tombol, E2E), §1.4 (dua konteks dan sign-in ulang, E2E), §1.9 dan §1.14 (purge, pendaftaran ulang, isolasi, E2E), §1.15 (notice S03, E2E), §1.17 (S14, E2E), §1.18 (Axe, overflow, fokus, screenshot).

## Langkah berikutnya

Fase 8: regresi penuh seluruh §7, pemeriksaan diff, dan receipt regresi.

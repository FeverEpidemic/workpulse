# WorkPulse — screen mockups

16 September 2026. Deliverable desain terarah; bukan implementasi fitur T02–T25.

Buka `index.html` untuk galeri; `S01.html` sampai `S14.html` untuk masing-masing screen. Navigasi Next membuka screen berikutnya. Tombol Light / dark mengubah tema; mobile menggunakan menu dialog. Data Maya Pratama adalah ilustrasi. Aksi penyimpanan, AI, autentikasi, upload dan ekspor tidak terhubung backend; tombol aksi menampilkan pemberitahuan preview atau menavigasi antarcontoh.

## Acuan

- `../Design.md`: muted sage, token light/dark, Plus Jakarta Sans, radius, spacing, hierarchy dan density.
- `../docs/WorkPulse_Wireframe_Screen_by_Screen_v0.1.docx`: S01–S14, R01–R10, F01–F07.
- `../docs/IMPLEMENTATION_PLAN.md` §1: keputusan konflik scope. Enam navigasi utama; planned/active/completed; skill tanpa proficiency; satu master CV tanpa target job/readiness.

## Hasil

14 halaman HTML, galeri, CSS bersama, font lokal dan lisensi OFL; 56 PNG di `screenshots/`, dengan pola `S01-desktop-light.png`, `S01-desktop-dark.png`, `S01-mobile-light.png`, `S01-mobile-dark.png`.

| Screen | Isi |
| --- | --- |
| S01 | Account / sign in |
| S02 | Import CV / manual entry |
| S03 | Review imported career data |
| S04 | Career dashboard |
| S05 | Capture work |
| S06 | Activity list and detail |
| S07 | Achievements |
| S08 | Review achievement |
| S09 | Projects |
| S10 | Project detail |
| S11 | Career timeline |
| S12 | Profile and settings |
| S13 | Master CV builder |
| S14 | PDF preview and export |

## Verifikasi

`node design-mockups/build.mjs` menghasilkan HTML. `node design-mockups/render.mjs` menggunakan Playwright lokal untuk screenshot dan memeriksa horizontal overflow serta font pada 1440 dan 360 px untuk kedua tema. Hasil ada di `verification.json`. Menu mobile dan fokus textarea setelah Quick log diperiksa. Inspeksi visual terperinci: S01 desktop light, S04 desktop light, S08 mobile dark, S13 desktop dark.

Mockup menampilkan state representatif per screen, bukan seluruh variasi recovery/error/empty dalam spesifikasi. Belum merupakan audit WCAG lengkap, validasi backend, atau acceptance implementasi fitur. Form dan preview CV memakai isi statis. Font asli Plus Jakarta Sans disertakan dari google/fonts, dengan lisensi OFL.

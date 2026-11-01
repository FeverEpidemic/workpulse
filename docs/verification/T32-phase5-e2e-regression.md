# T32 Fase 5: E2E, regresi, aksesibilitas, Delivery Gate

- Tanggal: 30 Oktober 2026
- Pelaksana: Claude (Opus 5.5), branch `claude/t32-landing`, checkout utama `D:\Project\WorkPulse`.
- antislop: mode during (session override).

## Tujuan

Membuktikan acceptance 1-8 dan 14-18 lewat E2E di production build, menjalankan regresi penuh, mengambil screenshot, klik-tembus, dan Delivery Gate antislop. Fase ini berakhir dengan stop untuk gate review Claude.

## File berubah

- `tests/e2e/landing.spec.ts` (baru), dimasukkan ke `testMatch` `playwright.release.config.ts`.
- `docs/verification/T32-screenshots/`: 19 PNG (hero dan panel demo di 360/1440, light/dark, en/id, `/privacy` 360 light/dark id, form daftar 360 id). Ditulis ulang hanya bila `T32_WRITE_SCREENSHOTS=1`, supaya run release biasa tidak mengotori tree.

## Fixture

`beforeAll` membuat satu akun yang sudah onboarding dengan locale `id` (`createUser`) dan satu akun provisional (auth user tanpa `complete_onboarding`). `afterAll` menghapus keduanya lewat `removeUsers` (alur hapus akun asli).

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `playwright ... landing.spec.ts` (percobaan 1) | 1 | Gagal di `beforeAll`: Docker mati, env tidak termuat. Docker Desktop dinyalakan dari sesi ini, Supabase hidup sendiri, container clamav/gotenberg/pdf di-`docker start`. |
| Sama (percobaan 2) | 1 | 19 lulus, 4 gagal. Ketiganya karena test, bukan kode. (a) Chromium mengganti `Accept-Language` dengan locale context, jadi header dari `extraHTTPHeaders` tidak sampai ke server. Matriks header sekarang lewat `request.get`, dan browser `id-ID` lewat `locale` context. (b) Hitungan `<header>` ikut menghitung header kertas CV di dalam `<article>`, yang bukan landmark. Sekarang dihitung per role. Test "cookie mengalahkan header" lulus di percobaan ini hanya karena header tidak pernah terkirim, jadi diperbaiki supaya browser benar-benar mengirim `id-ID`. |
| Sama (percobaan 3, `T32_WRITE_SCREENSHOTS=1`) | 0 | **24 lulus** |
| `pnpm build` | 0 | 34 s |
| `pnpm test` | 0 | **163 file / 1558 test** |
| `pnpm test:e2e:release` | 1 | **77 lulus, 2 gagal, 1 skip** (rekaman video). Lihat Flaky. |
| `pnpm test:e2e:auth` | 0 | 1 lulus |
| `pnpm test:e2e:ui` | 0 | 1 lulus |
| `pnpm test:e2e:m2` | 0 | 1 lulus |
| Dua test yang gagal, sendirian, `--repeat-each 3` | 0 | **6/6 lulus** |

Release baseline Fase 0: 43. Sekarang 80 = 43 lama + 12 `landing-motion` (1 skip) + 24 `landing`.

Screenshot T25, T30, dan T31 yang ditulis ulang oleh run release dikembalikan dengan `git restore`.

## Flaky

1. `landing.spec.ts:302` (layout 360/768/1440): satu kali melaporkan "/ @360: small targets halo@myworkpulse.my.id". Lulus di semua run lain (run sendiri 3/3, run Fase 5 percobaan 3). Kedua link email di landing punya `min-height: 44px` (`.landing-text-link`, `.landing-footer-nav a`), dan penyebabnya belum ketemu. Pesan kegagalan sekarang memuat ukuran dan kelas elemen, supaya kegagalan berikutnya bisa didiagnosis.
2. `motion-loading.spec.ts:61` (T30, entri halaman workspace): satu animasi entri tercatat padahal harapannya 0. Test lama ini lulus di baseline Fase 0 dan 3/3 saat dijalankan sendiri. T32 tidak menyentuh template entri workspace. Perubahan T32 di app hanya pemecahan `ActivityListRow` yang markup-nya sama. Dicatat untuk gate review.

## Acceptance terbukti (E2E production build)

| # | Bukti |
| --- | --- |
| 1 | Tamu `GET /` 200 tanpa redirect, `main#main-content`, h1 dari copy. |
| 2 | Akun onboarding dari `/` ke `/dashboard`, akun provisional ke `/onboarding/import`, keduanya tanpa `.landing`. Sesi tanpa profil di unit `root-destination.test.ts`. |
| 3 | Header `id-ID` jadi `lang="id"`. `en-US`, `ms-MY`, dan kosong jadi `en`. Browser `id-ID` jadi Indonesia. Cookie `en` mengalahkan browser `id-ID`. Profil `id` mengalahkan cookie `en` dan browser `en-US` (dicek di `/privacy` saat login). |
| 4 | Toggle dipakai dengan keyboard (Enter), `aria-pressed` dan `lang` per tombol, cookie `wp-locale=id` tersimpan, reload tetap `id`, `/sign-in` setelahnya "Masuk ke WorkPulse". |
| 5 | Minimal 3 link ke `/sign-in?mode=create-account`. CTA membuka "Create account" dengan `#sign-up-email`. Link Syarat/Privasi ada di form. Header "Sign in" membuka mode masuk. `mode=recovery` diabaikan. `test:e2e:auth` lulus. |
| 6 | Urutan `main > section` sesuai §3.2. Teks halaman en dan id bebas pola terlarang. Tanpa `video`/`iframe`, tanpa FAQ. Crawl link internal di `/`, `/privacy`, `/terms`: tepat `/`, `/privacy`, `/terms`, `/sign-in`, `/sign-in?mode=create-account`, semuanya 200. |
| 7 | 5 frame contoh: `role="group"`, badge "Example", satu anak `inert`, tanpa form/submit. Link di `main` tidak ada yang ke path terlindungi. Tanpa email selain kontak. Data contoh fiktif terlihat. |
| 8 | Tiap tab `aria-controls` ke panelnya, dan panel `aria-labelledby` ke tab. Keyboard dan gerak di `landing-motion.spec.ts`. |
| 9-13 | `landing-motion.spec.ts` 12 lulus di run release (Fase 3b). |
| 14 | Hero dan Data kamu memakai warm `rgb(246, 243, 236)` / dark `rgb(28, 27, 23)`, penutup memakai warm-subtle. CTA memakai `--color-action-primary`. Nol elemen landing dengan `background-image` gradient, di light dan dark. Kontras di axe dan di receipt Fase 3. |
| 15 | Section pembuat: nama dan `mailto`. Footer: Privacy Policy, Terms of Service, dan `mailto`. |
| 16 | `/privacy` dan `/terms` 200 untuk tamu, untuk en dan id, dan untuk akun login (tetap di halaman, mengikuti locale profil). 12 `h2`, `role="note"` draf, `meta robots` noindex, nama pengelola, `<mark>` isian kosong. |
| 17 | 360, 768, dan 1440 untuk `/`, `/privacy`, `/terms`: tanpa scroll horizontal, tanpa target di bawah 44 px (link inline di paragraf legal dikecualikan, WCAG 2.5.8), tanpa teks terpotong, satu h1, satu banner/main/contentinfo, skip link fokus lalu pindah ke `#main-content`. CTA hero di atas lipatan pada 360×800. Axe WCAG 2.2 AA: **nol temuan di 24 kombinasi** (3 halaman × 360/1440 × light/dark × en/id), diukur setelah cerita hero selesai dan semua section ter-reveal. |
| 18 | Title dan description `/` per locale. |
| 19 | Lihat Commands dan Flaky. Tidak ada assertion lama yang dilemahkan. `smoke.spec.ts` diubah di Fase 2-3 dengan alasan di receipt masing-masing. |

## Klik-tembus manual

- Dari Fase 3 (dev server, panel terlihat): landing dibaca dari atas ke bawah di 1440 light, 360 light, dan 360 dark. Toggle ID/EN diklik, ketiga tab diklik dan dipindah dengan panah, cerita hero diamati (Fase 3b). `/privacy` 1440 dan `/terms` 360 dark dibaca, dan "Di halaman ini" dibuka-tutup (Fase 4).
- Fase 5 (dev server, 360): footer "Privacy Policy" ke `/privacy` dengan `aria-current`. Kembali, CTA "Join the free pilot" di penutup ke form "Create account". "Terms of Service" di form ke `/terms` dengan 12 bagian.
- **Tidak bisa dikerjakan di fase ini:** scroll cepat bolak-balik secara visual. Panel browser sedang tersembunyi, sehingga `requestAnimationFrame` tidak jalan dan reveal tidak maju. Ini perilaku tab latar yang benar, bukan bug. Skenario ini dibuktikan oleh `landing-motion.spec.ts` ("reveals each section once…", scroll roda 20.000 px bolak-balik) di production build.

## Delivery Gate antislop

Dial: ENERGY 2 / RHYTHM 2 / MOTION 3 (MOTION 3 hanya landing). Design Read ada di plan §2.2.12.

### Core, Block 1 (Hard Gate): semua "tidak"

| Item | Hasil | Bukti |
| --- | --- | --- |
| R-02 em dash | PASS | Tidak ada `—` di `src/features/marketing`, `src/features/legal`, atau key `landing.*`/`legal.*`. Rentang tanggal CV memakai en dash dari `CvPreview`. |
| R-03 overflow mobile | PASS | E2E 360/768/1440 tanpa scroll horizontal dan tanpa teks terpotong. |
| R-17 statistik tanpa sumber | PASS | Tidak ada angka, persen, atau jumlah pengguna (scan unit dan E2E). |
| R-18 testimoni fiktif | PASS | Tidak ada testimoni. Kutipan pembuat dari pemilik asli. |
| R-23 aset tanpa konfirmasi | PASS | Logo memakai `BrandSymbol` yang sudah ada. Tanpa foto atau avatar. Persona "Rani Prameswari" dan "PT Contoh …" disetujui di mockup dan copy deck, dengan label "Contoh". |
| R-24 link ke halaman tidak ada | PASS | Crawl: kelima path internal 200. |
| R-25 kontras | PASS | Axe 24 kombinasi nol temuan. Tabel rasio di receipt Fase 3. Placeholder legal 6,24:1 / 8,02:1. |
| R-26 kontrol mati | PASS (dikoreksi) | Tombol "Simpan activity"/"Konfirmasi" di contoh ada di dalam `inert` dan berlabel "Contoh", bukan kontrol. Semua kontrol nyata (toggle, tab, replay, CTA, daftar isi) diuji E2E. **Koreksi gate review (RV1):** di `/privacy` dan `/terms`, toggle bahasa tidak berfungsi untuk akun yang sudah onboarding, karena locale profil menang atas cookie. Klaim PASS di sini salah untuk keadaan itu. Diperbaiki di `T32-review-remediation.md`. |
| R-27 state kosong/loading/error | PASS | Landing dan legal statis tanpa data view. Toggle bahasa tanpa JS tetap form biasa. Fallback hydration hero 3 s diuji. |
| R-28 FAQ generik | PASS | Tidak ada FAQ. |
| R-32 keyboard dan fokus | PASS | `:focus-visible` global (`globals.css:60`), ring 6,48:1 light / 9,74:1 dark. Skip link, toggle, tab (panah/Home/End), dan replay (Enter) diuji E2E. |
| R-33 patch eksternal | PASS | Semua di source. Skrip inline hero adalah bagian source (`motion.ts`). |
| R-34 tema rusak | PASS | Light dan dark diuji axe dan dicek di browser. |
| R-35 dijalankan dan klik-tembus | PASS dengan catatan | Build, E2E, dan klik-tembus di atas. Scroll cepat visual hanya via E2E (lihat Klik-tembus). |
| R-36 klaim karangan | PASS | Klaim produk sama dengan fakta yang sudah disusun dari kode di `docs/legal/legal-facts-and-gaps.md` dan draf Kebijakan Privasi: AI mati sampai diizinkan (bagian 4), usulan baru tersimpan setelah disetujui (bagian 4), hapus akun sendiri dari Profil (bagian 7). PDF teks asli: renderer PDF T21. Impor dengan atau tanpa AI: plan §3.2 (T26/T28). |
| R-37 tanpa arah | PASS | Dial dan Design Read di plan. |
| R-38 konten realistis karangan | PASS | Data contoh berlabel "Contoh"/"Example", perusahaan "PT Contoh", tanpa email. |

### Core, Block 2 (Purpose-Gate)

| Item | Hasil | Alasan tertulis |
| --- | --- | --- |
| R-01 gradient | PASS | Tidak ada (E2E: 0 elemen). |
| R-04 ikon | PASS | `lucide-react` sudah dipakai di seluruh app. Tiap ikon menandai isinya: ShieldCheck untuk izin AI, ScrollText untuk catatan asli, Trash2 untuk hapus akun, FileUp untuk impor, Mail untuk kontak, Download untuk PDF, ArrowDown untuk alur catatan ke usulan, Check untuk disetujui, RotateCcw untuk putar ulang, Info untuk label draf, ChevronDown untuk buka-tutup. Tidak ada sparkle atau robot. |
| R-06 uppercase/monospace | PASS | Label kecil sentence case (keputusan Fase 0). Uppercase hanya di heading kertas CV, sesuai design system. |
| R-07 pola latar | PASS | Tidak ada. |
| R-08 panah | PASS | Panah hanya di dua CTA daftar (maju ke form), tidak di tombol lain. |
| R-09 badge kapsul | PASS | Label di atas h1 berupa teks, bukan pill, dan isinya ("Pilot gratis udah buka") tidak mengulang judul. Badge di contoh adalah badge app (Catatan, Tersimpan, Usulan AI, Disetujui), dan badge "Contoh" berfungsi sebagai label. |
| R-10 glass | PASS | Tidak ada. |
| R-12 bayangan | PASS | `--shadow-md`/`-lg` hanya di kartu contoh, supaya UI terlihat melayang di atas permukaan hangat (plan §2.2.7). Section lain tanpa bayangan. |
| R-13 glow | PASS | Tidak ada. |
| R-14 kartu seragam | PASS | Data kamu berupa tiga baris bergaris, bukan kartu. Contoh di tiap tab berbeda bentuk (form, kartu review, kertas CV). |
| R-19 animasi template | PASS | Tiap gerak punya alasan (§2.2.12), tanpa loop, dan sesuai MOTION 3. |
| R-22 ilustrasi generik | PASS | Tidak ada ilustrasi. Visualnya UI app asli. |

### Core, Block 3 (Liveliness): semua "ya"

| Item | Hasil | Bukti |
| --- | --- | --- |
| Dial dinyatakan | PASS | ENERGY 2 / RHYTHM 2 / MOTION 3. |
| Konsisten dengan dial | PASS | Ritme section bergantian kanvas dan hangat, dengan satu komposisi judul-kiri isi-kanan (impor). Gerak tenang 240 ms. |
| Titik fokus per layar | PASS | Hero: judul dan cerita UI. Demo: panel aktif. Legal: h1 dan label draf. |
| Whitespace struktural | PASS | Padding section `clamp(56px, 8vw, 112px)` memisahkan ritme. |
| Satu aksen | PASS | Sage hanya di CTA, label kecil, tab aktif, titik aktif, dan ikon Data kamu. |
| Motif identitas | PASS | Ritme lima titik: logo, titik langkah lima, dan tanda di penutup. Permukaan hangat. |
| Design Read | PASS | Plan §2.2.12. |

### Core, Block 4 (Craftsmanship): semua "tidak"

| Item | Hasil | Bukti |
| --- | --- | --- |
| C-1 keputusan default AI | PASS | Keputusan visual punya alasan di plan §2.2 dan di receipt fase. |
| C-2 elemen interaktif mati | PASS (dikoreksi) | Lihat R-26 dan RV1. |
| C-3 section pengisi template | PASS | Setiap section dari brief §3.2. Tanpa "Trusted by", pricing, atau FAQ. |
| C-4 rusak di state, tema, breakpoint, atau tanpa mouse | PASS | Tanpa JS, reduced motion, sentuh, keyboard, dua tema, dan tiga lebar diuji E2E. |
| C-5 klaim karangan | PASS | Lihat R-36. |
| R-05 template AI | PASS | "Cara kerja" berupa panel bertab dengan UI asli, bukan tiga kartu bernomor. Tanpa bento atau logo bar. Footer satu baris. |
| R-11 semua pill | PASS | Radius bervariasi: tombol 8, tablist 12, kartu 16, badge full. |
| R-15 CTA generik | PASS | "Daftar pilot gratis" / "Join the free pilot", "Udah punya akun? Masuk". |
| R-16 buzzword | PASS | Scan copy Fase 1. |
| R-20 generik bila nama diganti | PASS | Contoh UI app WorkPulse sendiri dan copy reels berbahasa santai. |
| R-21 dark dipaksa | PASS | Tema mengikuti preferensi yang sudah ada, dan kedua tema didukung. |
| R-29 palet | PASS | Token design system: sage, netral, dua permukaan hangat, dan warna semantik app (info, success, warning) di badge dan label draf. |
| R-30 klon produk lain | PASS | Hanya mengambil pola dari referensi Parloa (UI di atas latar, label kecil, panel tab). Bahasa visual tetap WorkPulse. |
| R-31 alasan satu baris | PASS | Tercatat di plan dan receipt. |

### antislop-ui

| Item | Hasil | Bukti |
| --- | --- | --- |
| Palet dari design system | PASS | `tokens.css`, dua token baru tercatat. |
| Aksen di momen kunci | PASS | Lihat Block 3. |
| Tanpa emoji dekoratif | PASS | Tidak ada. |
| Komposisi bervariasi | PASS | Lihat R-05. |
| Tanpa bentuk default AI | PASS | Tanpa bento, terminal, tiga kolom harga, atau garis tepi berwarna tanpa makna. Garis kiri di kutipan sumber adalah komponen app `achievement-source-preview`. |
| Ruang di atas h1 bebas pill | PASS | Lihat R-09. |
| Navigasi punya tujuan | PASS | Crawl link. |
| Motion sesuai dial, tanpa loop | PASS | `landing-css.test.ts` (tanpa `infinite`). |
| Glass, glow, shadow, radius dalam dosis | PASS | Lihat R-10 sampai R-13. |
| Titik berwarna = state nyata | PASS | Titik langkah menandai langkah aktif, dengan teks. Tanpa pulse. |
| Layar app dibangun sekitar keputusan | N/A | Landing, bukan layar app. |
| Angka dan baris nyata atau placeholder | PASS | Tanggal dan tahun di contoh berlabel "Contoh". Tanpa metrik. |
| Field kosong jujur | PASS | Field contoh berisi catatan fiktif berlabel "Contoh". Persona jelas fiktif. |
| State kosong/loading/error | PASS | Lihat R-27. |
| Tahan di breakpoint, tema, keyboard | PASS | E2E. |

### antislop-human

| Item | Hasil | Bukti |
| --- | --- | --- |
| Kontras teks terverifikasi | PASS | Skrip rasio (Fase 3 dan 4), axe 24 kombinasi. |
| Non-text 3:1 | PASS | Border toggle dan tombol sekunder 3,31:1 (light) / 3,76:1 (dark). Ring fokus 6,48 / 9,74. Titik aktif 4,24 / 6,62. Titik nonaktif rendah, tapi langkahnya juga disebut di teks status, jadi titik bukan satu-satunya informasi. |
| Fokus terlihat di semua tema | PASS | `:focus-visible` global, ring khusus di toggle dan tab. |
| Operable dengan keyboard | PASS | E2E. Tidak ada dialog di landing. |
| State terlihat, tidak hanya warna | PASS | Titik langkah punya teks. Badge "Disetujui" punya ikon dan teks. |
| Teks 200% tanpa terpotong | PASS | Zoom 200% di 1440 sama dengan tata letak 720 px CSS, di antara 360 dan 768 yang lulus tanpa overflow atau teks terpotong. Tidak ada input di landing. Input di form daftar adalah komponen lama. |

### antislop-layoutmobile

| Item | Hasil | Bukti |
| --- | --- | --- |
| Mobile berbeda dari desktop | PASS | Hero teks di atas UI, panel demo menumpuk, daftar isi legal dilipat. |
| State di lebar menengah | PASS | 768 diuji. Flex-wrap dengan basis 320-480 px memberi susunan antara. |
| Skala mobile | PASS | `clamp()` untuk judul dan padding. |
| Grid runtuh | PASS | Flex-wrap tanpa tabrakan (E2E overflow). |
| Tanpa overflow | PASS | E2E. |
| Target 44 px | PASS | E2E (lihat Flaky 1). |
| Hover punya padanan tap | PASS | Hover hanya mengangkat kartu (dekoratif), dan tidak ada informasi yang hanya muncul saat hover. |
| Navigasi mobile | PASS | Header empat kontrol turun jadi dua baris. Tidak perlu menu. |
| Bar tetap tidak menutupi | PASS | Tidak ada bar tetap di landing. Daftar isi legal sticky hanya dari 768 px. |
| Dicek di breakpoint mobile | PASS | 360 diuji E2E dan di browser. |

### antislop-copywriting

Gate copy lulus di Fase 1 (receipt `T32-phase1-copy.md`). Teks baru di Fase 3-4 adalah label aksesibilitas contoh, `legal.*.description`, dan `legal.draftNotice` dari copy deck. Ketiganya dibaca ulang: tanpa buzzword, em dash, klaim, atau caps.

**Hasil gate: tidak ada FAIL.** Satu catatan di R-35 (scroll cepat visual hanya lewat E2E).

## Warning

- Dua test flaky di atas.
- Log WebServer berisi "Error: The destination stream closed early" di beberapa run, termasuk spec lama (`mobile-tab-bar`). Tidak ada test yang gagal karenanya.
- Panel browser tersembunyi saat klik-tembus Fase 5.

## Blocker

Tidak ada.

## Berikutnya

**Stop: gate review Claude** (plan §9). Setelah lulus: Fase 6 (Design.md, decision 0042, update brief, verification doc).

# Handoff T32 Landing page dan halaman legal: eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [x]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Fase 1 berakhir dengan persetujuan pengguna atas copy; jangan mulai Fase 2 sebelum itu. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 28 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Dependensi: T03 (auth dan locale), T04 (design system), T23 (hapus akun), T29 (Google), T30 (motion), T31 (tab bar) **DONE** di `main` (`19caca7`).
- Asal task: permintaan terarah pengguna. T32 **tidak ada** di `IMPLEMENTATION_PLAN.md` §5. Keputusan produk berasal dari interview 20 Oktober 2026 (`docs/marketing/landing-page-brief-v1.md`), jawaban item terbuka, interview referensi parloa.com, dan interview animasi pada 28 Oktober 2026 (semuanya dicatat di brief yang sama).
- Eksekutor: satu agent Claude; model ditetapkan pengguna saat mulai. Semua fase berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus 5.5). Gate review read-only wajib setelah Fase 5; Fase 6 (draft dokumen) setelah gate.
- antislop: mode **during** (dipilih pengguna 28 Oktober 2026). Pelaksana membaca `antislop`, `antislop-ui`, `antislop-copywriting`, `antislop-human`, dan `antislop-layoutmobile` dari `.claude/skills/<nama>/SKILL.md`. Delivery Gate dijalankan di Fase 1 (copy) dan Fase 5 (UI).
- Acuan:
  - `docs/marketing/landing-page-brief-v1.md` (seluruhnya mengikat), `docs/marketing/reels-30s-v1.md` (cerita dan aturan klaim).
  - `docs/legal/privacy-policy-id-draft.md`, `docs/legal/terms-of-service-id-draft.md`, `docs/legal/legal-facts-and-gaps.md`.
  - `docs/Design.md` §16.1 (tanpa gradient), §16.2 (logo lima titik), §17 (warna), §18 (tipografi), §28 (motion, §28.4 reduced motion, §28.5 token), §31 (target sentuh), §35 (voice), §37 (aksesibilitas).
  - Kode saat ini: `src/app/page.tsx:5-10` (root selalu redirect), `src/proxy.ts:8-18` (daftar path terlindungi, `/` tidak termasuk) dan `:68-84` (matcher), `src/server/auth/context.ts:50-60` (`getRequestLocale`: profil lalu cookie), `src/i18n/messages.ts:2252-2255` (`resolveLocale` tanpa `Accept-Language`), `src/server/locale/actions.ts` (`saveLocalePreference`), `src/server/locale/cookie.ts` (cookie `wp-locale`), `src/app/sign-in/page.tsx`, `src/features/auth/sign-in-client.tsx:32` (mode awal selalu `sign-in`, `create-account` hanya lewat klik di `:103`), `src/components/ui/brand-logo.tsx` (`BrandLogo`, `BrandSymbol`), `src/features/activity/activity-list.tsx:17`, `src/features/achievement/achievement-list.tsx:10`, `src/features/cv/cv-preview.tsx:52` (komponen berbasis props, tanpa import `@/server`), `src/styles/tokens.css:5-20` dan `:109-113` (ramp sage dan permukaan), `src/app/layout.tsx:25-29` (metadata).

**Goal:** Pengunjung yang belum login dan membuka `/` melihat landing page WorkPulse, bukan redirect ke `/sign-in`. Landing bercerita seperti reels (mau update CV, lupa setahun kemarin ngerjain apa), menunjukkan potongan UI asli dengan data contoh berlabel "contoh", dan mengajak daftar pilot gratis di `/sign-in` dalam mode buat akun. Pengguna yang sudah login tetap diarahkan seperti sekarang. Halaman `/privacy` dan `/terms` tersedia dalam Indonesia dan English, ditandai draf sampai isian legal lengkap.

**Architecture:** `src/app/page.tsx` merender landing bila `context.user` kosong; cabang login tidak berubah. Landing adalah Server Component di `src/features/marketing/` yang memakai `t(locale, ...)` dan komponen app yang sudah ada (`ActivityList`, `AchievementList`, `CvPreview`) dengan data fiktif statis. Gerak ditangani beberapa Client Component kecil: cerita hero, panel demo bertab dengan titik langkah, reveal bertahap saat scroll, dan toggle bahasa. Semuanya memakai CSS transition dan `IntersectionObserver`; server selalu merender keadaan akhir, jadi tanpa JavaScript atau dengan reduced motion halaman tampil lengkap. Locale kunjungan pertama ditambah dari header `Accept-Language` di `getRequestLocale` (profil, lalu cookie, lalu header). Toggle bahasa memakai `saveLocalePreference` yang ada. Halaman legal adalah route statis yang merender konten terstruktur dari modul TS. Tidak ada migration, worker, atau dependency baru.

**Tech stack:** Next.js 16.3.5 App Router, React 19.3.0, CSS di `globals.css` dengan token `tokens.css`, Plus Jakarta Sans saja, lucide-react, Vitest env `node` (`renderToStaticMarkup` dan CSS sebagai teks), Playwright + axe-core. **Tidak ada dependency baru** (tanpa parser Markdown, tanpa library animasi, tanpa font tambahan).

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md`, brief landing dan reels, kedua draf legal beserta `legal-facts-and-gaps.md`, `docs/Design.md` bagian di atas, file antislop di atas, lalu `docs/verification/T31-implementation-plan.md` sebagai contoh gaya receipt.

Kutipan sumber yang mengikat (parafrase ringkas):

- **Brief, Keputusan:** landing di `/` untuk tamu; bahasa `en`/`id`, kunjungan pertama ikut bahasa browser (Indonesia dapat `id`, sisanya `en`) dengan toggle; status "Pilot gratis" tanpa menyebut freemium; CTA daftar langsung tanpa waitlist atau kuota; section video disembunyikan sampai file ada; bukti visual dari komponen app dengan data fiktif berlabel "contoh"; AI tidak mengubah apa pun tanpa persetujuan, catatan asli tetap tersimpan, akun bisa dihapus; nama provider AI dan lokasi server tidak disebut; tanpa FAQ.
- **Brief, Pembuat:** Ilham Aisy Rasyid, paragraf pembuat dari pengguna: "Semoga dengan adanya tools ini, kalian jadi tidak lupa apa aja sih yang pernah dikerjakan selama kalian bekerja". Email `halo@myworkpulse.my.id`. Teks paragraf boleh dirapikan ejaannya untuk versi `id` dan diterjemahkan untuk `en`, tapi maknanya tetap; tampilkan hasilnya ke pengguna di Fase 1.
- **Brief, Referensi parloa.com:** ambil UI asli melayang di hero, label kecil di atas judul, panel demo produk bertab. Jangan ambil foto/video sinematik, serif, aksen oranye, testimoni, rating, angka hasil, daftar alasan bernomor.
- **Brief, Motion (interview animasi):** cerita hero sekali jalan dengan tombol putar ulang; tab panel demo geser mengikuti arah; isi section muncul bertahap; lima titik langkah terpisah dari logo; tempo tenang 200-300 ms; kartu UI terangkat saat hover, panah CTA bergeser, indikator toggle meluncur. Reduced motion dan tanpa JavaScript menampilkan keadaan akhir.
- **Brief, Yang tidak boleh muncul:** klaim "lolos ATS" (yang boleh: satu kolom, teks asli); angka hasil, jumlah user, testimoni; nama merek pembanding; link nav ke halaman yang belum ada.
- **Design.md §16.1:** tanpa gradient. **§16.2:** jangan animasikan titik logo dalam loop, jangan isi titik kosong. **§28.4:** reduced motion mematikan gerak, status tetap terbaca.
- **AGENTS.md:** WCAG 2.2 AA, target sentuh 44 px, verifikasi 360 px dan 1440 px light/dark. Batas MVP tidak berubah; landing tidak menambah fitur produk.

Pertahankan perubahan lokal pengguna. Saat plan ditulis, checkout utama `D:\Project\WorkPulse` punya perubahan belum di-commit di `docs/legal/*` dan `docs/marketing/landing-page-brief-v1.md` (bagian dari commit plan ini), serta `.claude/launch.json` dan `.claude/setting.local.json` (lokal, jangan di-commit). Kerjakan T32 di worktree terpisah dari `main`. Jangan menandai T32 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T32-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T32

T32 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Tamu melihat landing.** `GET /` tanpa sesi membalas 200 dengan `<main>` landing (heading level 1 dari copy Fase 1), bukan redirect. Dibuktikan E2E.
2. **Pengguna login tetap diarahkan.** Akun onboarding selesai yang membuka `/` mendarat di `/dashboard`; akun provisional di `/onboarding/import`; sesi tanpa profil tetap ke `/sign-in?notice=serviceUnavailable`. Dibuktikan E2E (dua akun) dan unit pada keputusan route.
3. **Locale kunjungan pertama.** Tanpa cookie `wp-locale`, `Accept-Language: id-ID,id;q=0.9` merender `lang="id"` dan copy `id`; `en-US`, `ms-MY`, dan header kosong merender `en`. Cookie `wp-locale` mengalahkan header; locale profil pengguna onboarding selesai mengalahkan keduanya. Dibuktikan unit (`resolveLocale`) dan E2E (`extraHTTPHeaders`).
4. **Toggle bahasa.** Toggle di header mengganti bahasa halaman dan menyimpan cookie `wp-locale`; reload tetap di bahasa itu; `/sign-in` setelahnya memakai bahasa yang sama. Toggle bisa dipakai dengan keyboard dan menyebut bahasa tujuan untuk screen reader. Dibuktikan E2E.
5. **CTA daftar.** Setiap CTA daftar menuju `/sign-in?mode=create-account`, dan halaman itu langsung menampilkan form buat akun (heading "Create account"/"Buat akun", input `#sign-up-email` terlihat). `/sign-in` tanpa parameter tetap mode masuk; nilai `mode` lain diabaikan. Link "Masuk" menuju `/sign-in`. Dibuktikan E2E dan unit parsing parameter; `test:e2e:auth` tetap lulus.
6. **Isi sesuai brief.** Urutan section §3.2 terpenuhi. Teks halaman (en dan id) tidak memuat "ATS", "testimoni"/"testimonial", angka persen atau "x lebih", jumlah pengguna, nama provider AI, nama region/negara server, kata "freemium"/"berbayar"/"premium", "waitlist", atau "kuota". Section video tidak ada di DOM. Tidak ada FAQ. Setiap link internal di landing menuju route yang membalas 200. Dibuktikan unit (scan string pesan landing) dan E2E (crawl link).
7. **Bukti visual dari komponen app.** Hero dan panel demo merender `ActivityList`, `AchievementList`, dan `CvPreview` (atau komponen app lain yang tercatat di Fase 0) dengan data fiktif, masing-masing dengan label "contoh"/"example" yang terlihat dan diumumkan screen reader. Data contoh tidak memuat nama orang nyata, perusahaan nyata, atau email nyata. Potongan UI tidak bisa memicu aksi app (tidak ada form, tombol submit, atau link ke route terlindungi di dalamnya). Dibuktikan unit (markup) dan E2E.
8. **Panel demo bertab.** Tab Activity, Achievement, CV mengikuti pola ARIA tabs: `role="tablist"`, panah kiri/kanan berpindah tab, Home/End, `aria-selected`, satu panel terlihat. Pindah ke tab di kanan membuat panel baru masuk dari kanan (dan sebaliknya) dengan fade, `--motion-slow`; perpindahan cepat beruntun tidak menyisakan dua panel terlihat setelah transisi selesai. Fokus tetap di tab. Tanpa JavaScript, ketiga panel tetap terbaca berurutan. Dibuktikan E2E (keyboard, arah `transform` awal panel) dan unit (markup server).
9. **Reveal bertahap.** Saat section masuk layar, anak bertanda `data-reveal-item` (judul, teks, UI) muncul berurutan dengan fade dan geser vertikal ≤ 16 px, jeda 80 ms antar item, durasi `--motion-slow` dan `--ease-out`, sekali per section. Section yang sudah di viewport saat mount langsung terlihat tanpa animasi. Tanpa JavaScript semua item terlihat (opacity 1). Logo tidak beranimasi. Dibuktikan E2E (computed style, urutan `transition-delay`, `javaScriptEnabled: false`) dan unit CSS.
10. **Cerita hero.** Setelah load (JavaScript aktif, tanpa reduced motion), hero menjalankan urutan sekali: teks catatan Activity muncul seperti diketik, status tersimpan, kartu Achievement usulan AI masuk, lalu tanda disetujui. Total ≤ 3,5 detik, tidak berulang sendiri. Setelah selesai muncul tombol "Putar ulang"/"Replay" (≥ 44 × 44 px, bisa dengan keyboard) yang menjalankan urutan sekali lagi. Screen reader hanya menerima teks akhir (lapisan ketik `aria-hidden`, teks lengkap tersedia sejak awal); tidak ada `aria-live` yang mengumumkan tiap karakter. Server merender keadaan akhir; urutan dimulai dari keadaan awal hanya setelah hydration, tanpa kedip konten akhir ke awal yang terlihat (cerita dimulai sebelum paint pertama setelah hydration atau hero disembunyikan maksimal satu frame). Dibuktikan E2E (timeline lewat `page.clock`, keadaan akhir, tombol replay, aksesibilitas nama) dan unit (reducer urutan).
11. **Titik langkah.** Deretan lima titik terpisah dari logo (bukan `BrandSymbol`) di panel demo menandai lima langkah alur: catat, AI usulkan, setujui, pilih ke CV, PDF. Tab Activity menyalakan titik 1, Achievement titik 1-3, CV titik 1-5; titik yang menyala berganti dengan transisi warna/ukuran `--motion-slow`. Status langkah juga tersedia sebagai teks (misalnya "Langkah 2-3 dari 5") dan tidak hanya lewat warna. Titik tidak bergerak dalam loop. Dibuktikan E2E dan unit markup.
12. **Interaksi mikro.** Di pointer `hover: hover`, potongan UI naik 2 px dengan bayangan satu tingkat lebih tebal dari token yang ada; panah di CTA daftar bergeser 2-4 px saat hover dan `:focus-visible`; indikator toggle bahasa meluncur ke pilihan baru. Di perangkat sentuh kartu tidak terangkat. Dibuktikan unit CSS (media query, token) dan E2E (computed style setelah hover).
13. **Reduced motion dan tanpa JavaScript.** Dengan `reducedMotion: "reduce"`: hero langsung di keadaan akhir tanpa efek ketik dan tanpa tombol replay, tab berganti tanpa geser, reveal tidak terjadi, titik berganti tanpa transisi, kartu tidak terangkat; durasi transisi ≤ 0,01 ms. Dengan `javaScriptEnabled: false`: hero di keadaan akhir, semua panel dan section terlihat. Dibuktikan E2E.
14. **Permukaan hangat tanpa aksen baru.** Hero dan minimal satu section jeda memakai token permukaan hangat §2.2.6 di light dan dark; CTA utama memakai `--color-action-primary`; tidak ada gradient, warna oranye, atau token aksen baru. Kontras teks di atas permukaan hangat ≥ 4,5:1 di kedua tema. Dibuktikan unit CSS, axe, dan pengukuran kontras di receipt.
15. **Pembuat dan kontak.** Section pembuat menampilkan "Ilham Aisy Rasyid", paragraf yang disetujui di Fase 1, dan link `mailto:halo@myworkpulse.my.id`. Footer memuat Privasi, Syarat, dan kontak yang sama. Dibuktikan E2E.
16. **Halaman legal.** `/privacy` dan `/terms` membalas 200 untuk tamu dan pengguna login, mengikuti locale yang sama dengan landing, merender seluruh bagian draf (12 bagian masing-masing) dengan heading berurutan, dan menampilkan label draf yang terlihat selama ada isian kosong (§2.2.9). Selama berstatus draf, kedua halaman punya `robots` `noindex`. Nama dan email pengelola sudah terisi. Dibuktikan unit (parity jumlah bagian dengan draf ID) dan E2E.
17. **Responsif dan aksesibilitas.** Tanpa scroll horizontal dan tanpa teks terpotong di 360, 768, dan 1440 px; target sentuh ≥ 44 px; satu `h1`; landmark `header`, `main`, `footer`; link skip ke konten; axe tanpa pelanggaran WCAG 2.2 AA di landing, `/privacy`, dan `/terms` pada 360 dan 1440 px, light dan dark, en dan id. Dibuktikan E2E (masuk ke `test:e2e:release`).
18. **Metadata.** `/` untuk tamu punya `title` dan `description` per locale dari copy Fase 1; Open Graph tetap memakai `src/app/opengraph-image.tsx`. Dibuktikan unit `generateMetadata` atau E2E membaca `<head>`.
19. **Tidak ada regresi.** `test:e2e:release`, `test:e2e:auth`, `test:e2e:ui`, `test:e2e:m2`, dan unit yang ada lulus tanpa assertion dilemahkan. Test yang dulu mengandalkan redirect `/` → `/sign-in` untuk tamu diperbarui dengan alasan di receipt.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Landing di `/` untuk tamu: header, hero, panel demo, import CV lama, kendali data, pembuat, penutup, footer.
- Fallback locale `Accept-Language` dan toggle bahasa di landing.
- Parameter `mode=create-account` di `/sign-in`.
- `/privacy` dan `/terms` (id dan en), termasuk terjemahan English draf legal di `docs/legal/`.
- Token permukaan hangat dan CSS landing.
- Motion landing: cerita hero dengan replay, tab bergeser, reveal bertahap, titik langkah, interaksi mikro (§2.2.8).
- Copy en/id di `messages.ts`.
- Unit, E2E, screenshot, Design.md, decision record.

### 2.2 Keputusan implementasi

1. **Cabang route.** `src/app/page.tsx` merender `<LandingPage locale={locale} />` bila `!context.user`; dua `redirect` lain tidak berubah. `/` tetap di matcher `proxy.ts` (refresh sesi) dan tetap bukan path terlindungi. Logika keputusan ditaruh di fungsi murni kecil (misalnya `rootDestination(context)` di `src/domain/routes/`) agar bisa diuji unit. Alasan: brief meminta root tetap mengarahkan pengguna login; perubahan sekecil mungkin.
2. **Locale.** `resolveLocale(profileLocale, cookieLocale, acceptLanguage?)`: profil, lalu cookie valid, lalu `id` bila tag bahasa utama dengan q tertinggi adalah `id` atau `in`, selain itu `en`. Parser `Accept-Language` murni di `src/i18n/` atau `src/domain/`, menangani q-value, wildcard, dan header rusak tanpa melempar. `getRequestLocale` membaca header lewat `headers()`. Alasan: brief, "Indonesia dapat `id`, sisanya `en`". Perubahan ini juga berlaku untuk `/sign-in` dan halaman tamu lain; itu sengaja dan dicatat di decision. Test lama berjalan dengan locale Playwright `en-US`, jadi perilakunya tidak berubah.
3. **Toggle bahasa.** Form kecil dengan dua tombol (`en`, `id`) yang memanggil `saveLocalePreference` lalu `router.refresh()` atau redirect ke path yang sama. Label tombol menyebut bahasanya dalam bahasa itu sendiri ("English", "Bahasa Indonesia"); tombol aktif punya `aria-pressed="true"`. Tidak ada action baru di server bila yang ada cukup.
4. **CTA dan mode sign-in.** `SignInClient` menerima `initialMode` (`"sign-in" | "create-account"`), diisi `sign-in/page.tsx` dari `query.mode === "create-account"`. Route tetap `/sign-in` (pilihan pengguna 28 Oktober 2026). `returnTo` tidak berubah.
5. **Komponen dan data contoh.** Data fiktif di `src/features/marketing/sample-data.ts`: satu persona fiktif yang jelas fiktif (nama, perusahaan, peran), tiga sampai lima activity, satu achievement yang berasal dari salah satu activity, dan model CV preview kecil. Bentuk datanya mengikuti tipe props komponen yang dipakai, bukan tipe baru. Komponen dibungkus `ExampleFrame` yang memberi label "contoh", `inert` pada potongan UI, dan `aria-label` deskriptif. Bila komponen membutuhkan props aksi, isi dengan nilai kosong atau no-op yang tidak merender kontrol; bila tidak bisa tanpa mengubah komponen, **stop** (§8). Alasan: brief meminta UI asli, bukan screenshot atau skeleton.
6. **Permukaan hangat.** Dua token baru di `tokens.css`: `--color-bg-warm` dan `--color-bg-warm-subtle`, light dan dark. Nilai awal light sekitar `#f6f3ec`/`#efeadf`, dark sekitar `#1c1b17`/`#23211c`; pelaksana boleh menyesuaikan agar kontras `--color-text-primary` dan `--color-text-secondary` di atasnya ≥ 4,5:1, lalu mencatat nilai akhir dan rasio di receipt. Hanya permukaan; aksen tetap sage. Alasan: jawaban "Sage + permukaan hangat".
7. **Komposisi (Design Read brief: ENERGY 2 / RHYTHM 2 / MOTION 3).** Acuan visual: [mockup canvas](https://claude.ai/artifact/D1ugHFSU15aeh6bCG2mK9G) (disetujui pengguna 28 Oktober 2026; artboard desktop light, mobile 360, desktop dark, `/privacy`). Bila plan dan mockup berbeda soal tata letak, mockup yang dipakai; soal perilaku, plan yang dipakai.
   - Hero: blok permukaan hangat full-width; teks (label kecil, h1, satu kalimat, CTA utama, link Masuk sekunder) dan potongan UI melayang (Activity lalu Achievement, dengan elevasi `--shadow-md` yang ada). Di 360 px teks di atas, UI di bawah, CTA terlihat tanpa scroll.
   - Label kecil di atas judul section: Plus Jakarta Sans, sentence case, 14 px weight 600, `--color-action-primary`. Bukan uppercase (design system WorkPulse memakai uppercase hanya di heading preview CV) dan bukan monospace.
   - Section "Data kamu": tiga baris dipisah garis `--color-border-strong`, ikon Lucide di kiri judul baris, penjelasan di kanan; bukan tiga kartu.
   - Data contoh mengikuti mockup: persona "Rani Prameswari", Operations Analyst di "PT Contoh Logistik"; achievement "Analisis penyebab retur pengiriman" (dari reels); tanpa angka hasil.
   - Panel demo: panel lebar berlatar `--color-bg-warm-subtle` berisi tablist dan satu panel UI. Ini menggantikan "satu alur yang mengalir" di urutan brief butir 3; urutan tab mengikuti alur (Activity, Achievement, CV), dan teks pendek di tiap tab menyebut langkahnya. Bukan tiga kartu bernomor.
   - Ritme: section bergantian antara kanvas dan permukaan hangat; minimal satu section dengan komposisi beda (judul kiri, isi kanan) sebagai jeda.
   - Tidak ada gradient, foto, ilustrasi, kartu testimoni, deretan logo, atau angka.
8. **Motion landing (interview animasi 28 Oktober 2026).** Prinsip bersama: server merender keadaan akhir; gerak hanya ditambahkan setelah mount bila `matchMedia("(prefers-reduced-motion: reduce)")` tidak cocok; tempo tenang memakai `--motion-slow` (240 ms) dan `--ease-out` yang sudah ada, tanpa token durasi baru; jeda dan kecepatan ketik adalah konstanta TS di `src/features/marketing/motion.ts`, bukan durasi literal di CSS. Tanpa library animasi.
   - **Reveal bertahap.** Atribut `data-reveal` pada section dan `data-reveal-item` pada judul, teks, dan UI di dalamnya. CSS default: terlihat. `RevealOnScroll` menambah kelas `is-reveal-ready` ke `<html>` setelah mount; hanya di bawah kelas itu item mulai `opacity: 0; transform: translateY(12px)`, dan `transition-delay: calc(var(--reveal-index) * 80ms)` dihitung dari `--reveal-index` yang diisi server. Section yang sudah di viewport saat mount langsung terlihat tanpa animasi. Satu kali per section; observer dilepas setelahnya. Alasan: konten tidak boleh hilang bila JavaScript gagal; hindari kedip seperti P2 RV1 T30.
   - **Cerita hero.** `HeroStory` (client) memegang state `idle | typing | saved | suggested | approved | done` lewat reducer murni yang diuji unit. Urutan: ketik catatan Activity (sekitar 25-30 ms per karakter, catatan contoh ≤ 90 karakter), jeda, status tersimpan, kartu Achievement usulan AI masuk (fade + geser, `--motion-slow`), jeda, tanda disetujui, lalu tombol "Putar ulang" muncul. Total ≤ 3,5 detik. Teks lengkap ada di DOM sejak server render untuk screen reader; lapisan yang diketik `aria-hidden="true"`. Tombol replay memulai ulang dari `idle`; tombol tetap di DOM dengan `aria-disabled="true"` selama cerita berjalan sehingga fokus tidak hilang. Untuk mencegah kedip keadaan akhir ke awal, hero di-mount dengan atribut `data-story="pending"` yang disembunyikan CSS hanya di bawah `.is-reveal-ready`, lalu langsung di-set ke `idle` pada effect pertama. Cerita berhenti (langsung ke `done`) bila tab disembunyikan (`visibilitychange`) agar tidak berjalan di latar.
   - **Tab bergeser.** `DemoTabs` mencatat indeks tab sebelumnya; panel baru masuk dari `translateX(±24px)` sesuai arah, dengan fade, `--motion-slow`; panel lama keluar tanpa menahan layout (diposisikan absolut selama transisi). Tinggi wadah tidak dianimasikan. Perpindahan beruntun membatalkan transisi sebelumnya.
   - **Titik langkah.** `StepDots` merender lima `span` dengan `data-on` dan satu teks visually hidden yang menyebut langkah aktif. Titik menyala memakai `--color-primary-600`/`--color-primary-400` (dark) dan sedikit membesar (`scale(1.15)`), transisi `--motion-slow`. Komponen terpisah dari `BrandSymbol`; tidak ada titik "kosong" permanen karena ini bukan logo.
   - **Interaksi mikro.** Di dalam `@media (hover: hover) and (pointer: fine)`: `.landing-example:hover` naik `translateY(-2px)` dengan `box-shadow` naik dari `--shadow-md` ke `--shadow-lg` (keduanya sudah ada di `tokens.css:84-85`). Panah CTA (`lucide-react` `ArrowRight`) `translateX(3px)` saat hover dan `:focus-visible` (yang terakhir berlaku juga di perangkat sentuh). Toggle bahasa: indikator absolut di belakang tombol aktif yang bergeser dengan `transform`.
   - Blok reduced motion global `globals.css` sudah memaksa `transition-duration: 0.01ms`; selain itu JavaScript tidak menambah `is-reveal-ready` dan `HeroStory` langsung `done` tanpa tombol replay saat reduced motion.
9. **Halaman legal.**
   - Konten di `src/features/legal/content/{privacy,terms}.{id,en}.ts` sebagai data terstruktur (`{ title, effectiveDate, sections: { heading, blocks: ({ type: "p", text } | { type: "ul", items })[] }[] }`), disalin dari `docs/legal/*-draft.md`. Draf Markdown di `docs/legal/` tetap sumber; tidak ada parser Markdown.
   - Isian `[KURUNG SIKU]` yang belum diisi tetap ditampilkan apa adanya. Halaman menampilkan label "Draf, belum berlaku" / "Draft, not yet in effect" dan `robots: { index: false }` selama konstanta `LEGAL_DRAFT` bernilai `true`. Unit test gagal bila `LEGAL_DRAFT` `false` sementara konten masih memuat `[`. Alasan: link legal dibutuhkan di footer dan halaman daftar, tapi teksnya belum boleh terbaca sebagai berlaku.
   - Link Privasi dan Syarat juga dipasang di bawah form buat akun di `sign-in-client.tsx` (rekomendasi `legal-facts-and-gaps.md` butir 7), tanpa checkbox persetujuan baru.
   - Terjemahan English: pelaksana menulis `docs/legal/privacy-policy-en-draft.md` dan `docs/legal/terms-of-service-en-draft.md` di Fase 1, setara bagian per bagian dengan versi ID, dengan catatan draf yang sama. Pengguna me-review di akhir Fase 1.
10. **Copy.** Semua teks landing dan legal UI di `messages.ts` dengan prefix `landing.` dan `legal.`. Copy deck ditulis dulu di `docs/marketing/landing-copy-v1.md` (en dan id berdampingan) dan disetujui pengguna di akhir Fase 1. Gaya: Indonesia santai seperti reels untuk `id`, English polos untuk `en`; satu ide per section; CTA "Daftar pilot gratis" / setara English. Antislop-copywriting berlaku.
11. **Section video.** Tidak ada komponen video atau placeholder di T32. Section ditambah setelah file video ada (di luar scope).
12. **Dial antislop.** Design Read brief: *landing produk personal untuk karyawan aktif, fresh graduate, dan freelancer di Indonesia; bahasa visual app (sage, tenang); ENERGY 2 / RHYTHM 2 / MOTION 3*. MOTION 3 hanya berlaku di landing; app tetap MOTION 2 (Design.md §16.1). Setiap gerak punya alasan: cerita hero menjelaskan alur produk, tab bergeser menunjukkan arah langkah, reveal bertahap mengatur urutan baca, titik langkah menandai posisi dalam alur, interaksi mikro memberi umpan balik. Tidak ada loop, parallax, atau gerak yang terikat posisi scroll. Logo tidak beranimasi.
13. **Nomor.** Decision memakai nomor bebas berikutnya saat Fase 6 (0041 terakhir di `main`, perkiraan **0042**). Tidak ada migration (parity tetap 38/38). Script npm baru: tidak ada; spec E2E baru masuk ke `testMatch` `playwright.release.config.ts`.

### 2.3 Di luar scope

- Section video dan file video.
- FAQ, testimoni, rating, angka hasil, deretan logo.
- Foto, ilustrasi, font serif, aksen warna baru.
- Mengisi isian legal yang kosong (pemilik produk) dan review hukum.
- Setup forwarding email `halo@myworkpulse.my.id`.
- Analytics landing, cookie banner, A/B test.
- Halaman marketing lain (pricing, blog, about terpisah).
- Deploy ke staging atau production (ikut alur T25).

## 3. Kontrak teknis

### 3.1 Route

| Route | Tamu | Login, onboarding selesai | Login, provisional |
| --- | --- | --- | --- |
| `/` | landing (200) | redirect `/dashboard` | redirect `/onboarding/import` |
| `/privacy`, `/terms` | 200 | 200 | 200 |
| `/sign-in?mode=create-account` | form buat akun | redirect seperti sekarang | redirect seperti sekarang |

`/privacy` dan `/terms` tidak ditambahkan ke `protectedPaths`. Tidak perlu masuk matcher `proxy.ts`.

### 3.2 Urutan landing

1. Link skip ke konten, header: `BrandLogo`, toggle bahasa, Masuk, Daftar.
2. Hero: masalah (dua baris cerita reels), satu kalimat jawaban, CTA daftar pilot gratis, UI melayang.
3. Panel demo bertab: Activity, Achievement (AI usulkan, user setujui), CV (pilih, PDF satu kolom teks asli).
4. Import CV lama: tidak mulai dari kosong; boleh menyebut bisa dengan atau tanpa AI (T26/T28).
5. Kendali atas data: AI butuh persetujuan, catatan asli tetap ada, akun dan data bisa dihapus.
6. Dari pembuat.
7. Penutup: CTA daftar.
8. Footer: Privasi, Syarat, `halo@myworkpulse.my.id`.

### 3.3 Server dan domain

- `src/domain/routes/root-destination.ts` (baru): keputusan `/` dari context.
- `src/i18n/accept-language.ts` (baru) dan `resolveLocale` dengan parameter ketiga.
- `src/server/auth/context.ts`: `getRequestLocale` membaca `accept-language`.
- `src/app/sign-in/page.tsx` dan `sign-in-client.tsx`: `initialMode`, link legal di bawah form buat akun.

### 3.4 UI

- `src/features/marketing/`: `landing-page.tsx`, `landing-header.tsx`, `locale-toggle.tsx` (client), `hero-story.tsx` (client), `hero-story-state.ts` (reducer murni), `demo-tabs.tsx` (client), `step-dots.tsx`, `reveal-on-scroll.tsx` (client), `motion.ts` (konstanta jeda dan kecepatan ketik), `example-frame.tsx`, `sample-data.ts`.
- `src/features/legal/`: `legal-page.tsx`, `content/*.ts`, `legal-status.ts` (`LEGAL_DRAFT`).
- `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` dengan `generateMetadata`.
- `src/app/page.tsx` dengan `generateMetadata` untuk tamu.
- CSS: blok `/* T32 landing */` di `globals.css` memakai token; kelas berprefix `landing-` dan `legal-`.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Modify | `src/app/page.tsx`, `src/app/sign-in/page.tsx`, `src/features/auth/sign-in-client.tsx`, `src/server/auth/context.ts`, `src/i18n/messages.ts`, `src/styles/tokens.css`, `src/app/globals.css`, `playwright.release.config.ts` |
| Create | `src/domain/routes/root-destination.ts`, `src/i18n/accept-language.ts`, `src/features/marketing/*`, `src/features/legal/*`, `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` |
| Create | `tests/unit/{root-destination,accept-language,landing-copy,landing-markup,legal-content,landing-css,hero-story-state}.test.ts`, `tests/e2e/landing.spec.ts`, `tests/e2e/landing-motion.spec.ts` |
| Modify | test lama yang mengandalkan redirect tamu `/` → `/sign-in` (inventaris Fase 0) |
| Create | `docs/marketing/landing-copy-v1.md`, `docs/legal/privacy-policy-en-draft.md`, `docs/legal/terms-of-service-en-draft.md` (Fase 1) |
| Modify | `Design.md`, `docs/Design.md` (Fase 6: permukaan hangat, pola landing) |
| Create | `docs/verification/T32-phase{0..5}-*.md`, `docs/verification/T32-screenshots/`, `docs/verification/T32-landing-legal.md`, `docs/decisions/0042-t32-landing-legal.md` (nomor dicek di Fase 6) |

## 5. Fase eksekusi

### Fase 0: Baseline (tanpa edit kode)

- [ ] Worktree baru dari `main` (`19caca7` atau lebih baru, termasuk commit plan ini), `git status` bersih.
- [ ] `pnpm install --frozen-lockfile` di worktree.
- [ ] Parity migration (harapan **38/38**, terakhir `20261019090000_t26_import_rules_extraction.sql`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`. Harapan dari closeout T31: unit **154 file / 1448 test**; catat angka aktual.
- [ ] `pnpm test:e2e:release` (harapan **43**) dan `pnpm test:e2e:auth`; catat angka.
- [ ] Inventaris test yang membuka `/` sebagai tamu atau mengharapkan redirect ke `/sign-in` dari root (`grep -rn "goto(\"/\")\|goto('/')\|toHaveURL(/\\/sign-in" tests/`). Catat tiap file dan apakah ia perlu diubah.
- [ ] Inventaris props `ActivityList`, `AchievementList`, `CvPreview`: props wajib, apakah ada callback atau kontrol aksi yang selalu dirender, dan tipe data yang dibutuhkan. Bila salah satunya tidak bisa dirender tanpa kontrol aksi, catat alternatif komponen app yang bisa (misalnya baris activity tunggal); bila tidak ada, **stop** (§8).
- [ ] Verifikasi rujukan file:baris di dokumen ini; selisih dicatat.
- [ ] Receipt `T32-phase0-baseline.md`.

### Fase 1: Copy dan terjemahan legal (dokumen, persetujuan pengguna)

- [ ] Tulis `docs/marketing/landing-copy-v1.md`: per section §3.2, teks `id` dan `en` berdampingan, termasuk label kecil, CTA, label "contoh", isi data contoh (persona fiktif, activity, achievement), teks tab, label lima langkah dan teks status titik, catatan Activity yang diketik di hero (≤ 90 karakter), label tombol putar ulang, paragraf pembuat (§0), metadata title/description, label toggle, label draf legal.
- [ ] Tulis `docs/legal/privacy-policy-en-draft.md` dan `docs/legal/terms-of-service-en-draft.md` dari draf ID: bagian sama, isian kosong tetap dalam kurung siku English (misal `[CITY]`), catatan draf di atas.
- [ ] Delivery Gate `antislop-copywriting` atas copy deck dan kedua terjemahan, PASS/FAIL dengan bukti di receipt. Cek manual daftar kata terlarang acceptance 6.
- [ ] Receipt `T32-phase1-copy.md`, commit. **Stop: minta pengguna menyetujui copy deck dan terjemahan.** Catat revisi pengguna di receipt; Fase 2 memakai versi yang disetujui.

### Fase 2: Route, locale, sign-in (TDD unit)

- [ ] Test gagal `root-destination.test.ts` (tamu, onboarding selesai, provisional, tanpa profil) dan `accept-language.test.ts` (acceptance 3, termasuk q-value, `in`, wildcard, header rusak, prioritas profil > cookie > header).
- [ ] Implementasi §2.2.1, §2.2.2; `page.tsx` sementara merender placeholder landing minimal (h1 dari copy) agar route bisa diuji.
- [ ] Test gagal untuk parsing `mode` dan render awal `SignInClient` (`renderToStaticMarkup` dengan `initialMode="create-account"` memuat `sign-up-form`). Implementasi §2.2.4 dan link legal di bawah form buat akun.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus; `test:e2e:auth` lulus.
- [ ] Receipt `T32-phase2-route-locale.md`, commit.

### Fase 3: Landing UI (TDD unit)

- [ ] Copy ke `messages.ts` (en dan id, key paritas dicek test yang ada untuk dictionary).
- [ ] Test gagal `landing-copy.test.ts` (kata terlarang acceptance 6 pada semua key `landing.*` di kedua locale; tidak ada key `landing.video*`) dan `landing-markup.test.ts` (urutan section, satu `h1`, label contoh, potongan UI tanpa `form`/`button[type=submit]`/link ke path terlindungi, tablist server markup menampilkan tiga panel).
- [ ] Token §2.2.6 dan test gagal `landing-css.test.ts` (token warm di light dan dark, tanpa `gradient`, reveal hanya di bawah `.is-reveal-ready`, durasi dari token).
- [ ] Implementasi §2.2.3, §2.2.5, §2.2.7 dan §3.2 dalam keadaan akhir (tanpa gerak; `HeroStory`, `DemoTabs`, dan `StepDots` merender keadaan akhir/tab pertama).
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus; `motion-tokens.test.ts` tetap lulus.
- [ ] Receipt `T32-phase3-landing-ui.md`, commit.

### Fase 3b: Motion landing (TDD unit dan E2E)

- [ ] Test gagal `hero-story-state.test.ts`: urutan state, total durasi dari konstanta `motion.ts` ≤ 3500 ms, replay kembali ke `idle`, reduced motion dan `visibilitychange` langsung ke `done`.
- [ ] Perluas `landing-css.test.ts`: item reveal hanya disembunyikan di bawah `.is-reveal-ready`, `transition-delay` memakai `--reveal-index`, durasi `--motion-slow`, hover kartu di dalam `(hover: hover) and (pointer: fine)`, tanpa `@keyframes` berulang (`infinite`), logo tanpa animasi, tanpa durasi literal baru (`motion-tokens.test.ts` tetap lulus).
- [ ] Implementasi §2.2.8 (reveal bertahap, cerita hero, tab bergeser, titik langkah, interaksi mikro).
- [ ] `tests/e2e/landing-motion.spec.ts` untuk acceptance 9-13 dengan `page.clock` untuk timeline hero, `reducedMotion: "reduce"`, `javaScriptEnabled: false`, dan pengecekan tidak ada kedip (snapshot opacity hero pada frame pertama setelah load). Tambah ke `testMatch` `playwright.release.config.ts`.
- [ ] Rekam satu video Playwright (`video: "on"` untuk test cerita hero saja) dan simpan di `docs/verification/T32-screenshots/hero-story.webm` sebagai bukti tempo; catat kesan tempo di receipt.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus.
- [ ] Receipt `T32-phase3b-motion.md`, commit.

### Fase 4: Halaman legal (TDD unit)

- [ ] Test gagal `legal-content.test.ts`: jumlah bagian tiap konten TS sama dengan jumlah heading `##` di draf Markdown masing-masing (ID dan EN), nama dan email pengelola terisi, guard `LEGAL_DRAFT` §2.2.9.
- [ ] Implementasi §2.2.9, route `/privacy` dan `/terms`, metadata `noindex` selama draf.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus.
- [ ] Receipt `T32-phase4-legal.md`, commit.

### Fase 5: E2E, regresi, aksesibilitas, Delivery Gate

- [ ] `tests/e2e/landing.spec.ts` untuk acceptance 1-8 dan 14-18 (dua akun fixture untuk acceptance 2, `extraHTTPHeaders` untuk locale, `javaScriptEnabled: false` untuk tab, crawl link internal, axe per kombinasi, termasuk setelah cerita hero selesai). Tambah ke `testMatch` `playwright.release.config.ts`. Acceptance 9-13 sudah di `landing-motion.spec.ts` (Fase 3b).
- [ ] Perbarui test dari inventaris Fase 0 hanya bila gagal karena landing; alasan di receipt.
- [ ] Screenshot `docs/verification/T32-screenshots`: landing 360 dan 1440 px, light dan dark, id dan en (minimal hero dan panel demo), `/privacy` 360 px, `/sign-in?mode=create-account` 360 px.
- [ ] `pnpm build`, `pnpm test`, `pnpm test:e2e:release`, `pnpm test:e2e:auth`, `pnpm test:e2e:ui`, `pnpm test:e2e:m2`; catat angka.
- [ ] Klik-tembus manual di 360 dan 1440 px: baca landing dari atas ke bawah di kedua bahasa, ganti bahasa, ketuk tiap tab, scroll cepat bolak-balik (reveal tidak berkedip), ikuti CTA sampai form buat akun, buka legal dari footer dan dari form daftar. Tulis pengamatan.
- [ ] Delivery Gate antislop (core + `antislop-ui`, `antislop-human`, `antislop-layoutmobile`, `antislop-copywriting`) dengan PASS/FAIL dan bukti di receipt.
- [ ] Receipt `T32-phase5-e2e-regression.md`, commit. **Stop: gate review Claude.**

### Fase 6: Draft dokumen (setelah gate lulus)

- [ ] `docs/Design.md` dan `Design.md`: token permukaan hangat di §17, pola landing (hero UI melayang, label kecil, panel demo bertab, reveal sekali) sebagai bagian baru atau di §16.3 bila termasuk pola yang sengaja. Jaga kedua salinan identik.
- [ ] Draft decision `0042-t32-landing-legal.md` (nomor dicek): root untuk tamu, fallback `Accept-Language` untuk semua halaman tamu, `mode=create-account`, konten legal sebagai data TS dan guard draf, token warm, MOTION 2 hanya untuk landing.
- [ ] Update `docs/marketing/landing-page-brief-v1.md`: centang item yang selesai, catat yang tersisa (forwarding email, isian legal, video).
- [ ] `docs/verification/T32-landing-legal.md` (ringkasan acceptance dan bukti) tanpa klaim DONE.
- [ ] Commit.

## 6. Fixture

- Dua akun test dibuat di `beforeAll` `landing.spec.ts` dan dibersihkan di `afterAll` (pola spec lain): satu onboarding selesai, satu provisional.
- Data contoh landing statis di `sample-data.ts`; persona dan perusahaan fiktif yang jelas fiktif, tanpa email.
- Tidak ada AI, key live, atau data hosted.

## 7. Commands

Semua script sudah ada di `package.json`:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:release
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:m2
```

`pnpm lint` di checkout yang punya `.claude/worktrees/*/.next` bisa gagal karena file build di sana; jalankan dengan `--ignore-pattern ".claude/**"` dan catat.

## 8. Stop conditions

Berhenti dan laporkan bila:

- Path yang akan diubah T32 berisi perubahan pengguna yang belum di-commit di worktree kerja.
- Pengguna belum menyetujui copy deck dan terjemahan legal (akhir Fase 1).
- `ActivityList`, `AchievementList`, atau `CvPreview` hanya bisa dirender di landing dengan mengubah perilaku komponen itu di app, dan tidak ada komponen app lain yang cocok.
- Fallback `Accept-Language` mengubah hasil test lama di luar halaman tamu.
- Kontras teks di atas permukaan hangat tidak bisa mencapai 4,5:1 tanpa mengubah token teks yang ada.
- Reveal saat scroll atau cerita hero hanya bisa dibuat dengan menyembunyikan konten sebelum JavaScript jalan, atau cerita hero berkedip (keadaan akhir terlihat lalu kembali ke awal) dan tidak bisa dicegah dengan §2.2.8.
- Cerita hero tidak muat dalam 3,5 detik dengan tempo tenang; tanyakan pengguna apakah mempersingkat catatan contoh atau memperpanjang batas.
- Gerak landing hanya bisa dibuat dengan library animasi, `@keyframes` berulang, atau token durasi baru.
- Butuh migration, dependency (termasuk font atau parser Markdown), atau perubahan copy app di luar `landing.*`, `legal.*`, dan link legal di form daftar.
- Copy memerlukan klaim yang dilarang brief, atau pengguna meminta testimoni/angka tanpa data nyata.
- Scope bocor ke §2.3.

## 9. Gate review Claude

Read-only setelah Fase 5. P0–P2 memblokir, P3 follow-up.

- [ ] Receipt Fase 0–5 lengkap dengan angka aktual; ulang `lint`, `typecheck`, `test`, `test:e2e:release`, `test:e2e:auth` di worktree bersih.
- [ ] Copy di `messages.ts` sama dengan copy deck yang disetujui; tidak ada kata terlarang.
- [ ] Pengguna login tidak pernah melihat landing; tamu tidak pernah di-redirect dari `/`.
- [ ] Prioritas locale profil > cookie > header; header rusak tidak melempar.
- [ ] Potongan UI tidak punya kontrol aksi dan berlabel contoh; data contoh fiktif.
- [ ] Konten terlihat tanpa JavaScript dan dengan reduced motion; tidak ada kedip reveal atau kedip hero.
- [ ] Cerita hero sekali jalan ≤ 3,5 detik, replay bisa dengan keyboard, screen reader hanya menerima teks akhir; tab bergeser sesuai arah; titik langkah punya teks; tidak ada loop, parallax, atau gerak terikat scroll; logo diam.
- [ ] Legal: semua bagian terender di kedua bahasa, label draf dan `noindex` aktif, guard `LEGAL_DRAFT` diuji.
- [ ] Tanpa gradient, foto, serif, aksen baru; token warm lulus kontras di kedua tema.
- [ ] Delivery Gate antislop tercatat tanpa FAIL.

## 10. Review focus

1. **Landing bocor ke pengguna login atau redirect hilang.** Mengubah `page.tsx` mudah membuat sesi tanpa profil jatuh ke landing. Dijaga acceptance 2 dan `root-destination.test.ts`.
2. **Konten hilang karena reveal.** Opacity 0 sebelum hydration, observer yang tidak terpicu di section terakhir, atau kedip saat hydration (pola P2 T30). Dijaga §2.2.8 dan acceptance 9 (tanpa JS, reduced motion, scroll cepat).
3. **Klaim terlarang lewat copy atau data contoh.** Angka "contoh" di achievement bisa terbaca sebagai hasil produk, dan nama contoh bisa mirip orang nyata. Dijaga acceptance 6 dan 7, scan string, dan persetujuan copy di Fase 1.
4. **Locale header mengubah perilaku lama.** Fallback baru berlaku di `/sign-in` dan halaman tamu lain. Dijaga acceptance 3 dan 19.
5. **Halaman legal terbaca berlaku.** Isian kosong tanpa label draf, atau terindeks mesin pencari. Dijaga acceptance 16 dan guard `LEGAL_DRAFT`.
6. **Potongan UI memicu aksi.** Komponen app yang merender link atau tombol ke route terlindungi di landing. Dijaga §2.2.5 (`inert`) dan acceptance 7.
7. **Cerita hero mengganggu.** Efek ketik yang dibacakan per karakter, kedip keadaan akhir ke awal setelah hydration, atau cerita yang terus berjalan di tab latar. Dijaga §2.2.8, acceptance 10 dan 13, serta video tempo Fase 3b.

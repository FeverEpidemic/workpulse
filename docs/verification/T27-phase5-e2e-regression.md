# T27 Fase 5: E2E, aksesibilitas, regresi, Delivery Gate

- Tanggal: 20 Oktober 2026
- Eksekutor: Claude (Opus 5.5), branch `claude/t27-mobile-tab-bar`.

## File berubah

- Baru: `tests/e2e/mobile-tab-bar.spec.ts` (6 test, akun "Rina Wulandari" + `seedCareer` + 20 aktivitas tambahan lewat RPC produk, dihapus lewat jalur penghapusan akun asli).
- Ubah: `playwright.release.config.ts` (`testMatch` + `mobile-tab-bar.spec.ts`; tanpa script npm baru).
- Ubah: `tests/e2e/app-frame.spec.ts` (blok drawer 259-278 diganti bar: lima kontrol, tab Activity, + membuka sheet dengan catatan terfokus dan draft yang sama, Esc mengembalikan fokus ke +).
- Ubah: `tests/e2e/release-keyboard.spec.ts` (blok drawer diganti: sheet Quick log dan Menu lainnya dibuka dengan Enter dan Space lewat Tab saja, Esc menutup, fokus kembali ke pemicu, cincin fokus diperiksa di setiap elemen yang dilewati).
- Ubah: `src/components/layout/mobile-chrome.tsx` (perbaikan: toast ganda, lihat temuan).
- Ubah: `src/app/globals.css` (perbaikan: label tab aktif terpotong, lihat temuan).
- Baru: `docs/verification/T27-screenshots/*.png` (8 screenshot 360 px).

`release-a11y.spec.ts` tidak diubah: matriks 360 px light/dark sudah melewati semua layar S01-S14 dengan bar baru (axe, landmark, satu `h1`, tanpa scroll samping), dan uji axe untuk bar, kedua sheet, dan Profile di 360 px light/dark ada di spec baru. Snapshot aria terkunci diambil di 1440 px, tempat chrome mobile `display: none`, jadi tidak ada golden yang berubah.

## Temuan saat E2E dan perbaikannya

1. **Toast ganda setelah simpan dari composer.** `ActionFeedback` milik form sudah memanggil toast `activity.saved`; `onCreated` di `MobileChrome` menambah toast kedua. Toast di `onCreated` dihapus. Test kini memeriksa tepat satu `.ui-toast` "Activity saved.".
2. **Label tab aktif "Dashboa…" terpotong di 360 px** (bobot 700 di slot ~66 px). Gutter list jadi `var(--space-1)` dan `gap: 0`, slot ~70 px. Test memeriksa tidak ada label terlihat dengan `scrollWidth > clientWidth`.
3. Perbaikan test (bukan kode produk): hit-test kontrol di bagian bawah `/settings/profile` kini menyertakan `summary` (bagian bawah halaman itu berisi `<details>` tertutup); `scrollBy` menunggu `networkidle` agar wheel tidak terjadi sebelum hidrasi; cookie tema memakai origin.

## Command dan hasil (setelah perbaikan)

| Command | Hasil |
| --- | --- |
| `pnpm lint --ignore-pattern .claude/**` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, **134 file / 1261 test** |
| `pnpm build` | exit 0 |
| `test:e2e:ui` (`app-frame.spec.ts`, port 3000) | 1 passed |
| `test:e2e:auth` | 1 passed |
| `test:e2e:activity` | 1 passed |
| `test:e2e:release` (release-a11y + release-keyboard + mobile-tab-bar) | **21 passed** (run kedua). Run pertama: 20 passed, 1 gagal di `matrix 1440px dark` karena Windows menolak menulis `docs/verification/T25-screenshots/s09-projects-1440-dark.png` (`UNKNOWN: open`), bukan assertion. |
| `test:e2e:m2` | 1 passed |
| `test:e2e:dashboard` | 1 passed |

Screenshot T25 yang ditulis ulang oleh `release-a11y` dikembalikan dengan `git checkout` dan tidak di-commit, karena itu bukti T25.

Tidak ada assertion lama yang dilemahkan. Yang diganti hanya langkah yang menguji drawer (`Open navigation menu`, dialog `Primary navigation`, link Quick log di header mobile), dan penggantinya menguji perilaku setara pada bar dan sheet.

## Acceptance dan bukti E2E

| # | Bukti |
| --- | --- |
| 1 | `mobile-tab-bar` test 1: urutan `a:Dashboard, a:Activity, button:Quick log, a:Projects, a:Profile`; tidak ada tombol hamburger/dialog drawer. Test 5: 1440 px bar dan header tersembunyi, sidebar 6 link, link Quick log topbar tetap. |
| 2 | `aria-current="page"` di Dashboard/Activity, `"true"` di Projects untuk `/projects/<id>` dan Profile untuk `/timeline`; tidak ada tab aktif di `/activity/new`; `font-weight` 700 pada tab aktif. |
| 3 | Wheel 600 px: `data-compact="true"`, 5 label `sr-only`, nama aksesibel "Activity" tetap, tinggi list 52 px; wheel -200 px: expanded, 64 px; klik tepi bar: expanded tanpa navigasi; tab di state compact bernavigasi dan halaman baru expanded. |
| 4 | Header `data-hidden="true"` dan `bottom <= 0` saat compact; fokus ke tombol Menu lainnya di header tersembunyi memunculkannya (`transform: none`). Header `data-hidden="false"` saat composer terbuka. |
| 5 | Tap + di `/projects`: dialog "Quick log", catatan `toBeFocused`, URL tetap; tanpa fieldset mode dan `project_id`. Simpan: sheet tertutup, satu toast, URL tetap, aktivitas muncul di `/activity`. Kosong: `valueMissing`, sheet tetap terbuka; > 10.000: pesan batas tampil. |
| 6 | Draft sama setelah Esc, tombol tutup, dan klik backdrop; dipulihkan saat dibuka lagi; "Open full form" membuka `/activity/new?returnTo=%2Fprojects` dengan teks sama; draft hilang setelah simpan. + di `/activity/new` memfokus form penuh, tidak membuka sheet kedua. Sentinel tidak muncul di console. |
| 7 | Tombol Menu lainnya hanya di Profile, berteks "More"; sheet berisi link Achievements, Timeline, CV, toggle tema, Sign out, tanpa Profile; Esc mengembalikan fokus ke tombol; pilih Timeline menutup sheet dan bernavigasi. `release-keyboard`: Enter/Space/Esc untuk kedua sheet. |
| 8 | Lingkaran "RW" `aria-hidden="true"`, nama tab "Profile". Fallback email hanya di unit (onboarding mewajibkan nama, jadi akun bernama kosong tidak bisa dibuat lewat produk). |
| 9 | Di 360 × 640 untuk `/activity`, `/projects`, `/settings/profile`, `/dashboard`, `/projects/<id>`: tidak ada kontrol yang dirender di bawah bar saat halaman di ujung bawah, padding bawah `main` ≥ 64 px, overflow horizontal 0. Toast berada di atas bar. |
| 10 | `prefers-reduced-motion: reduce`: `transition-duration` `.workspace-tab-list`, `.workspace-mobile-header`, `.workspace-tab` ≤ 0,01 ms. |
| 11 | Semua kontrol bar, header, dan sheet ≥ 44 × 44 px. Axe tanpa pelanggaran di `/dashboard`, sheet composer, `/settings/profile`, sheet Menu lainnya, 360 px light dan dark; matriks `release-a11y` 360 px light/dark lulus. `release-keyboard` memeriksa cincin fokus pada setiap elemen yang dilewati Tab. |
| 12 | Unit Fase 4. |

## WebKit / iOS

Config Playwright repo hanya memakai Desktop Chrome dan browser WebKit tidak terpasang di mesin ini. Fokus sinkron di handler tap (keputusan §2.2.8) dibuktikan di Chromium saja; **perilaku keyboard iOS Safari belum terbukti di WebKit maupun perangkat nyata** dan tetap risiko terbuka.

## Delivery Gate antislop (mode during)

Design Read: app shell mobile untuk workspace karier privat, bahasa visual tenang sesuai Design.md, dial ENERGY 1 / RHYTHM 1 / MOTION 2.

### Block 1: Hard Gate

- R-02 PASS: copy baru tanpa U+2014 (unit `mobile-navigation-i18n`).
- R-03 PASS: tanpa overflow horizontal di 360 px (spec T27 test 2, matriks `release-a11y` 360 px), label tab tidak terpotong, target ≥ 44 px.
- R-17, R-18, R-36, R-38 PASS: tidak ada angka, testimoni, atau klaim baru; data di screenshot berasal dari fixture test.
- R-23 PASS: tidak ada aset baru. Tab Profile memakai inisial (placeholder yang disetujui pengguna); foto ditunda.
- R-24 PASS: kelima tab dan tiga link Menu lainnya menuju route yang ada (E2E bernavigasi ke masing-masing).
- R-25 PASS: tanpa token baru; semua pasangan ada di `theme-contrast.test.ts` (Fase 4); axe 360 px light/dark tanpa pelanggaran.
- R-26 PASS: setiap kontrol punya perilaku: link bernavigasi, + membuka sheet, ≡ membuka sheet, tombol tutup menutup, tap tepi bar mengembangkan label.
- R-27 PASS: composer memakai state error/validasi/pending form yang sama (pesan batas, `valueMissing`, `SubmitButton` pending, `ActionFeedback`); bar dan sheet tidak menampilkan data yang perlu state kosong/loading.
- R-28 PASS: tidak ada FAQ.
- R-32 PASS: `release-keyboard` membuka kedua sheet dengan Enter/Space, menutup dengan Esc, fokus kembali, cincin fokus diperiksa; header muncul saat fokus masuk.
- R-33 PASS: semua perubahan di source.
- R-34 PASS: light dan dark diperiksa (axe + screenshot).
- R-35 PASS: build dijalankan dan setiap kontrol diklik di 360 px: Dashboard → `/dashboard`; Activity → `/activity`; + → sheet terbuka, catatan terfokus; Esc/tombol tutup/backdrop → sheet tertutup; Open full form → `/activity/new?returnTo=…`; Save kosong → validasi; Save → toast + tetap di halaman; Projects → `/projects`; Profile → `/settings/profile`; More → sheet terbuka; Achievements (browser pane) → `/achievements`; Timeline → `/timeline`; toggle tema terlihat di sheet (fungsinya sama dengan sidebar dan diuji `app-frame`); Sign out terlihat (fungsi diuji `app-frame` via sidebar). Console tanpa error (pemeriksaan browser pane Fase 3; matriks `release-a11y` mengumpulkan console error dan lulus).
- R-37 PASS: arah dari Design.md, dial dideklarasikan.

### Block 2: Purpose-Gate

- R-01 PASS: tanpa gradient/glow.
- R-04 PASS: ikon lucide yang sama dengan sidebar (satu keluarga ikon di AGENTS.md); + dan ≡ adalah tanda aksi yang dikenal, ≡ disertai teks "More".
- R-06, R-07, R-08, R-09 PASS: tanpa tipografi baru, latar pola, panah, badge.
- R-10 PASS: tanpa blur pada bar/header (alasan: kontras label).
- R-12 PASS: tanpa bayangan baru; sheet memakai bayangan dialog yang ada sebagai penanda elevasi.
- R-13, R-14, R-22 PASS: tidak ada.
- R-19 PASS: dua transisi (tinggi bar, `translateY` header) 180 ms `ease-out`, tujuan: menunjukkan chrome yang berubah; dimatikan reduced motion; sesuai MOTION 2.

### Block 3: Liveliness

- Dial dideklarasikan dan konsisten: YES.
- Satu titik fokus per layar: konten halaman; di bar, kotak +: YES.
- Whitespace struktural: header 52 px dan bar 64/52 px ringkas, konten dominan: YES.
- Satu aksen: kotak + `--color-action-primary`, tab lain netral: YES.
- Identity motif: latar sage tab aktif yang sama dengan sidebar: YES.
- Design Read sebelum generate: YES (receipt Fase 2).

### Block 4: Craftsmanship & Quality Locks

Semua NO: tidak ada keputusan "default AI" tanpa alasan, tidak ada kontrol mati, tidak ada bagian template, tidak rusak di tema/breakpoint/keyboard, tidak ada klaim palsu, radius bervariasi (sm tab, md kotak +, lg atas sheet, full inisial), tanpa CTA generik atau buzzword, palet tetap token Design.md, bukan klon (pola tab bawah diminta pengguna; bentuk mengikuti token WorkPulse), setiap keputusan punya alasan tertulis di receipt Fase 2 dan decision 0034.

### Checklist antislop-layoutmobile

Semua YES: state mobile tersendiri (bar + header + sheet, bukan sidebar menyusut); rentang lebar: ≤ 880 px bar, > 880 px sidebar, label tetap muat di 360 px; skala mobile (header 52 px, label 12 px); tanpa overflow; target ≥ 44 px dengan jarak; tanpa interaksi hover-only (bar dan sheet merespons tap, `:active` pada tab); navigasi primer di bar bawah, sekunder di menu berlabel; bar tidak menutup konten dan memakai safe-area; diverifikasi di 360 px.

Hasil Delivery Gate: **PASS**, tanpa FAIL.

## Screenshot 360 px

`docs/verification/T27-screenshots/`: `bar-expanded-360-{light,dark}.png`, `bar-compact-360-{light,dark}.png`, `composer-360-{light,dark}.png`, `more-360-{light,dark}.png`.

## Lingkungan

- Worker `workers/run.ts` sesi lain dihentikan atas persetujuan pengguna (Fase 0). `next dev` sesi lain di port 3000 sudah berhenti saat regresi, jadi `test:e2e:ui` dan `test:e2e:auth` berjalan di port 3000 seperti biasa.
- Container `workpulse-t10-clamav`, `workpulse-t15-gotenberg`, `workpulse-t21-pdf` berjalan.

## Blocker

Tidak ada. **Stop: gate review Claude.**

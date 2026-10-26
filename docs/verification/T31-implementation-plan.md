# Handoff T31 Floating tab bar mobile: eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [x]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 26 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Status plan: **DONE**, 27 Oktober 2026 ([bukti](T31-floating-tab-bar.md), [decision 0041](../decisions/0041-t31-floating-tab-bar.md)). Gutter akhir 8 px, bukan 12 px (pilihan pengguna di Fase 0).
- Dependensi: T27 (bottom tab bar mobile) dan T30 (motion dan loading) **DONE** di `main` (`97ee13c`).
- Asal task: permintaan terarah pengguna pada 26 Oktober 2026 ("Navigation Bar untuk mobile layout itu Floating dengan animation yang sama"). T31 **tidak ada** di `IMPLEMENTATION_PLAN.md` §5. Semua keputusan di §2.2 berasal dari interview di chat pada tanggal yang sama.
- Eksekutor: satu agent **Claude Sonnet 5.5** (`claude-sonnet-5-5`), ditetapkan pengguna 26 Oktober 2026. Semua fase berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus 5.5). Gate review read-only wajib setelah Fase 3; Fase 4 (draft dokumen) setelah gate.
- antislop: mode **during** (dipilih pengguna 26 Oktober 2026 untuk sesi interview). Pelaksana membaca `antislop`, `antislop-ui`, `antislop-human`, dan `antislop-layoutmobile` dari `.claude/skills/<nama>/SKILL.md`, lalu menjalankan Delivery Gate di Fase 3.
- Acuan:
  - `docs/Design.md` §4.3 (navigasi mobile), §28 (motion, token §28.5), §28.4 (reduced motion), §31 (target sentuh 44 px), *Compact width* (sekitar baris 1255).
  - [Decision 0035](../decisions/0035-t27-mobile-tab-bar.md) keputusan 4 (label mengikuti scroll, 64 → 52 px) dan 7 (bar solid tanpa blur, ruang bawah konten).
  - `AGENTS.md` *UI dan aksesibilitas* (WCAG 2.2 AA, reduced motion, 360 px dan 1440 px light/dark).
  - Kode saat ini: `src/components/layout/mobile-tab-bar.tsx`, `src/components/layout/use-scroll-chrome.ts`, `src/app/globals.css` (`:419-440` tab bar dan list, `:448-471` tab, `:1175-1190` posisi fixed dan ruang bawah konten, `:1498-1503` toast di atas bar, `:1807-1815` blok reduced motion global), `src/styles/tokens.css` (`:76-87` radius, shadow, target sentuh).

**Goal:** Bottom tab bar mobile tidak lagi menempel full-width di tepi bawah. Ia menjadi kapsul yang melayang 12 px dari kiri, kanan, dan bawah. Animasi scroll T27 tetap: scroll ke bawah menyusutkan bar 64 → 52 px dan menyembunyikan label. Yang baru: saat compact kapsul juga menyempit ke tengah sampai pas lima ikon, lalu melebar lagi saat label kembali. Header mobile, sheet, dan desktop tidak berubah.

**Architecture:** Murni CSS. `<nav class="workspace-tab-bar">` sendiri menjadi kapsul (bukan wrapper transparan full-width), sehingga area di kiri dan kanan kapsul tetap meneruskan tap ke konten. State `data-compact` dari `useScrollChrome` sudah ada dan tidak berubah. Lebar kapsul dan tinggi list ditransisikan bersama dengan `--motion-normal` `--ease-out`. Reduced motion sudah ditangani blok global `globals.css:1807-1815` (durasi 0,01 ms), jadi state tetap berganti tanpa transisi. Tidak ada migration, route, server action, komponen, copy, atau dependency baru.

**Tech stack:** Next.js 16.3.5 App Router, React 19.3.0, CSS di `globals.css` dengan token dari `tokens.css`, Vitest env `node` (CSS dibaca sebagai teks, pola `tests/unit/motion-tokens.test.ts`; markup lewat `renderToStaticMarkup`), Playwright + axe-core di config `release`. **Tidak ada dependency baru.**

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md`, decision 0035, `docs/Design.md` §4.3 dan §28, file antislop di atas, lalu `docs/verification/T27-implementation-plan.md` sebagai konteks bar.

Kutipan sumber yang mengikat (parafrase ringkas):

- **Design.md §4.3:** lima slot tetap; + satu-satunya aksen di bar; label tampil di puncak dan saat scroll ke atas atau bar diketuk; scroll ke bawah menyusutkan bar menjadi ikon; label tetap ada untuk screen reader.
- **Design.md *Compact width*:** Quick log adalah slot + di tab bar, **bukan** floating button. T31 tidak memisahkan +.
- **Decision 0035 #7:** bar solid tanpa blur agar kontras label tidak bergantung pada konten di bawahnya; konten mendapat ruang bawah setinggi bar + safe area.
- **Design.md §28.5:** `--motion-normal` 180 ms untuk perubahan state. T31 tidak menambah token durasi.
- **AGENTS.md:** target sentuh 44 px, status tidak bergantung pada warna, verifikasi 360 px dan 1440 px light/dark.

Pertahankan perubahan lokal pengguna. Saat plan ditulis, checkout utama `D:\Project\WorkPulse` punya perubahan belum di-commit di `Design.md`, `docs/Design.md`, `docs/IMPLEMENTATION_STATUS.md`, dan `docs/decisions/0039-t29-google-oauth.md`. Kerjakan T31 di worktree terpisah dari `main`; jangan menyentuh checkout utama. Jangan menandai T31 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T31-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T31

T31 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Kapsul expanded.** Di 360 × 640 pada puncak halaman, kotak `nav[aria-label="Main tabs"]` berada di `left = 12`, `right = 348`, dan `bottom = 640 - 12` (± 1 px), dengan border 1 px di keempat sisi, `border-radius` = `--radius-lg`, dan `box-shadow` bukan `none`. Tidak ada `backdrop-filter`. Dibuktikan E2E (bounding box dan computed style).
2. **Kapsul compact.** Setelah scroll ke bawah melewati ambang T27, `data-compact="true"`, tinggi list 52 px (assertion T27 tetap), lebar kapsul sama dengan `--tab-bar-compact-width` (§2.2.3, 268 px ± 1), dan kapsul terpusat (selisih jarak kiri dan kanan ≤ 1 px). Scroll ke atas atau tap di area kapsul di luar tab mengembalikan lebar dan tinggi expanded. Dibuktikan E2E.
3. **Animasi.** Di luar reduced motion, `transition-property` kapsul mencakup `width` dan list mencakup `height`, keduanya 180 ms dengan easing `--ease-out`. Dibuktikan unit (CSS) dan E2E (computed style).
4. **Reduced motion.** Dengan `reducedMotion: "reduce"`, durasi transisi kapsul, list, header, dan tab ≤ 0,01 ms, dan state compact tetap berganti (lebar 268 px setelah scroll). Dibuktikan E2E.
5. **Tap di luar kapsul sampai ke konten.** Titik di gutter kiri (x = 4) setinggi tengah kapsul mengenai elemen konten atau `body`, bukan `nav` atau turunannya. Dibuktikan E2E (`elementFromPoint`).
6. **Label tidak terpotong.** Di 360 px expanded, setiap `.workspace-tab-label` yang terlihat, termasuk label tab aktif yang tebal, punya `scrollWidth ≤ clientWidth` (assertion T27 tetap). Dibuktikan E2E.
7. **Target sentuh.** Setiap link dan tombol di bar ≥ 44 × 44 px di expanded dan compact, dan jarak horizontal antar target di compact ≥ `--space-2`. Dibuktikan E2E.
8. **Konten tidak tertutup.** Di akhir halaman `/activity`, `/projects`, `/settings/profile`, `/dashboard`, dan detail proyek, kontrol terbawah berakhir di atas tepi atas kapsul, padding bawah `main` ≥ 64 + 12 px, dan tidak ada scroll horizontal. Toast setelah simpan Quick log berada di atas kapsul. Dibuktikan E2E (test T27 diperbarui).
9. **Tidak ada regresi perilaku.** Urutan lima slot, tab aktif, + membuka sheet dengan catatan terfokus, Menu lainnya, header sembunyi saat scroll, pending link T30, dan sidebar di 1440 px tetap seperti sebelumnya. Dibuktikan `test:e2e:release` dan unit T27 tanpa assertion dilemahkan.
10. **Aksesibilitas.** Axe tanpa pelanggaran WCAG 2.2 AA pada dashboard, composer, Profile, dan Menu lainnya di 360 px light dan dark, expanded dan compact. Dibuktikan E2E.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- CSS tab bar mobile di `globals.css`: posisi, lebar, bentuk, elevasi, transisi, ruang bawah konten, posisi toast.
- Pembaruan `tests/e2e/mobile-tab-bar.spec.ts` dan unit CSS baru.
- Update Design.md §4.3 (dua salinan) dan decision record baru yang menggantikan sebagian decision 0035.

### 2.2 Keputusan implementasi

1. **`nav` adalah kapsulnya.** `.workspace-tab-bar` di blok `@media (max-width: 880px)` (`globals.css:1175-1185`) berubah dari `left: 0; right: 0; bottom: 0` menjadi `left: 50%; bottom: var(--tab-bar-offset); width: var(--tab-bar-width); transform: translateX(-50%)`. Alasan: wrapper full-width yang transparan akan menelan tap di gutter, dan handler `onClick` di `mobile-tab-bar.tsx:49-52` akan memperlakukannya sebagai tap "bar" lalu me-expand. Markup `mobile-tab-bar.tsx` tidak berubah.
2. **Jarak dari tepi.** Token lokal di blok mobile: `--tab-bar-gutter: var(--space-3)` (12 px, dipilih pengguna) dan `--tab-bar-offset: calc(var(--tab-bar-gutter) + env(safe-area-inset-bottom))`. `padding-bottom: env(safe-area-inset-bottom)` di nav dihapus karena safe area kini masuk ke `bottom`. Tab dan + tidak lagi berada di dalam area safe inset.
3. **Lebar.**
   - Expanded: `--tab-bar-width: min(calc(100% - 2 * var(--tab-bar-gutter)), 480px)`. Batas 480 px menjaga lima slot tetap rapat di lebar tablet 600-880 px, alih-alih kapsul 850 px dengan ikon yang berjauhan (antislop-layoutmobile, *Two-State Layout*). Batas ini bukan jawaban interview; konfirmasi ke pengguna di Fase 0 bila ragu.
   - Compact: `--tab-bar-compact-width: calc(5 * var(--touch-target-min) + 6 * var(--space-2))` = 268 px (lima target 44 px, empat gap 8 px, padding 8 px kiri dan kanan). `.workspace-tab-bar[data-compact="true"]` mengganti `--tab-bar-width` ke nilai ini dan `.workspace-tab-list` memakai `column-gap: var(--space-2)` dan padding `0 var(--space-2)` saat compact.
   - Alasan pilihan "pas ikon": dipilih pengguna; 44 px dan gap 8 px memenuhi R-03 (*Targets Too Close*).
4. **Animasi.** Kapsul: `transition: width var(--motion-normal) var(--ease-out)`. List: transisi `height` yang ada (`globals.css:435`) tetap, ditambah `column-gap` dan `padding` dengan durasi dan easing yang sama, agar slot bergeser bersamaan dengan kapsul. Tidak ada transisi `transform`, `opacity`, atau `bottom`; kapsul tidak naik/turun. Alasan: "animation yang sama" berarti shrink T27 yang diperpanjang ke lebar, bukan gerak baru (MOTION 2). Catatan: `width` adalah properti layout; dampaknya terbatas pada subtree kapsul yang `position: fixed`. `transform: scaleX` ditolak karena mengubah bentuk ikon dan label, `clip-path` ditolak karena slot tidak ikut bergeser.
5. **Permukaan.** `background: var(--color-bg-surface)`, `border: 1px solid var(--color-border-default)` di keempat sisi (mengganti `border-top`), `border-radius: var(--radius-lg)` (16 px), `box-shadow: var(--shadow-md)`. Tanpa `backdrop-filter`. Alasan: dipilih pengguna; solid mempertahankan decision 0035 #7; satu shadow adalah penanda elevasi satu-satunya di chrome mobile (R-12); radius 16 px, bukan pill penuh, agar kapsul tetap sejalan dengan skala radius yang dipakai kartu dan dialog (R-11). Tidak ada token warna atau shadow baru; di dark mode border yang membawa tepi, dan shadow token yang sama dibiarkan.
6. **Ruang bawah konten.** `.workspace-content` di blok mobile (`globals.css:1189`) menjadi `calc(64px + var(--tab-bar-offset) + var(--space-10))`. Toast region (`globals.css:1501`) menjadi `calc(64px + var(--tab-bar-offset) + var(--space-3))`. Ruang dihitung dari tinggi expanded agar kontrol terakhir tidak pernah berada di bawah kapsul saat label kembali.
7. **Reduced motion.** Tidak ada aturan baru. Blok global `globals.css:1807-1815` sudah memaksa `transition-duration: 0.01ms`. Bila assertion acceptance 4 gagal karena specificity, tambahkan selector kapsul ke blok `@media (prefers-reduced-motion: reduce)` yang terdekat, bukan mematikan state compact.
8. **Tidak berubah.** `use-scroll-chrome.ts` (ambang 24/8 px), `mobile-tab-bar.tsx`, `mobile-header.tsx`, sheet composer dan Menu lainnya (tetap menutupi bar), desktop > 880 px, copy en/id.
9. **Dial antislop.** Design Read: *workspace karier privat, bahasa visual tenang Design.md, ENERGY 1 / RHYTHM 1 / MOTION 2* (`docs/Design.md` §16). Satu-satunya gerak baru adalah perubahan lebar yang dipicu scroll pengguna; tidak ada loop atau animasi masuk.
10. **Nomor.** Decision memakai nomor bebas berikutnya saat Fase 4 (0040 terakhir di `main`, perkiraan **0041**). Tidak ada migration (parity tetap 38/38). Tidak ada script npm baru.

### 2.3 Di luar scope

- Memisahkan + menjadi tombol bulat terpisah (bertentangan dengan Design.md *Compact width*; butuh keputusan desain baru).
- Header mobile floating.
- Blur/glass, gesture, haptic, sembunyi total saat scroll.
- Perubahan ambang scroll atau logika `useScrollChrome`.
- Foto profil (follow-up T27).
- Deploy ke staging (ikut alur T25).

## 3. Kontrak teknis

### 3.1 CSS

- Blok mobile `@media (max-width: 880px)` di `globals.css`: token lokal `--tab-bar-gutter`, `--tab-bar-offset`, `--tab-bar-width`, `--tab-bar-compact-width` didefinisikan sekali di `.workspace-tab-bar` (atau `:root` di dalam media query, pilih satu dan catat).
- `.workspace-tab-bar`: §2.2.1, §2.2.3, §2.2.4, §2.2.5.
- `.workspace-tab-list`: tinggi 64/52 px tetap lewat `--tab-bar-height`; gap dan padding compact §2.2.3.
- `.workspace-content` dan `.ui-toast-region` mobile: §2.2.6.
- Komentar CSS di `:419` diperbarui agar tetap benar (solid tanpa blur, kini kapsul).

### 3.2 Komponen

Tidak ada perubahan. Bila Fase 1 ternyata butuh perubahan markup, **stop** (§8).

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Modify | `src/app/globals.css` |
| Create | `tests/unit/floating-tab-bar-css.test.ts` |
| Modify | `tests/e2e/mobile-tab-bar.spec.ts` (screenshot ke `docs/verification/T31-screenshots`) |
| Modify | `Design.md`, `docs/Design.md` §4.3 (Fase 4) |
| Create | `docs/verification/T31-phase{0..3}-*.md`, `docs/verification/T31-floating-tab-bar.md`, `docs/decisions/0041-t31-floating-tab-bar.md` (nomor dicek di Fase 4) |

## 5. Fase eksekusi

### Fase 0: Baseline (tanpa edit kode)

- [ ] Worktree baru dari `main` (`97ee13c` atau lebih baru), `git status` bersih. `.claude/launch.json` dan `.claude/setting.local.json` tetap lokal; jangan di-commit.
- [ ] `pnpm install --frozen-lockfile` di worktree.
- [ ] Parity migration (harapan **38/38**, terakhir `20261019090000_t26_import_rules_extraction.sql`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`. Harapan dari closeout T30: unit **153 file**; catat angka aktual.
- [ ] `pnpm test:e2e:release` (harapan **42**); catat angka.
- [ ] Ukur di 360 × 640 (dev atau build): lebar render label "Dashboard" dengan `font-weight: 700` dan lebar slot yang tersedia bila kapsul 336 px (harapan kira-kira (336 - 8) / 5 ≈ 65,6 px, saat ini sekitar 70 px). Bila label tebal lebih lebar dari slot, **stop** dan tanya pengguna (§8).
- [ ] Inventaris: semua test unit dan E2E yang membaca posisi, `border-top`, atau padding bar (`grep -n "workspace-tab-bar\|Main tabs" tests/`; saat plan ditulis: `app-frame`, `mobile-tab-bar`, `motion-loading`, `release-keyboard`).
- [ ] Verifikasi rujukan file:baris di dokumen ini; selisih dicatat.
- [ ] Receipt `T31-phase0-baseline.md`.

### Fase 1: CSS kapsul (TDD unit)

- [ ] Test gagal `floating-tab-bar-css.test.ts` (baca `globals.css` sebagai teks, pola `motion-tokens.test.ts`): di blok mobile, `.workspace-tab-bar` punya `left: 50%`, `width: var(--tab-bar-width)`, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-md)`, border empat sisi, transisi `width` `--motion-normal` `--ease-out`; tidak ada `backdrop-filter`; `[data-compact="true"]` memakai `--tab-bar-compact-width`; padding `.workspace-content` dan bottom toast region memakai `--tab-bar-offset`.
- [ ] Implementasi §2.2 di `globals.css`.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus; `motion-tokens.test.ts` tetap lulus (tidak ada durasi literal baru).
- [ ] Receipt `T31-phase1-css.md`, commit.

### Fase 2: E2E

- [ ] Perbarui `mobile-tab-bar.spec.ts` untuk acceptance 1-8: bounding box expanded dan compact, computed style, gutter tap (`elementFromPoint`), jarak antar target compact, padding ≥ 76 px, reduced motion pada kapsul. Assertion T27 yang ada tidak dilemahkan; yang berubah hanya ekspektasi padding (≥ 64 menjadi ≥ 76) dan posisi, dengan alasan di receipt.
- [ ] Tap di area kapsul di luar tab (`box.x + 2`, baris 131) tetap me-expand: kini titik itu berada di padding kapsul, bukan tepi layar. Catat hasilnya.
- [ ] Perbarui spec lain dari inventaris Fase 0 hanya bila gagal karena posisi bar.
- [ ] Screenshot `docs/verification/T31-screenshots`: expanded dan compact, light dan dark, 360 px; expanded di 768 px (batas 480 px); composer terbuka di atas kapsul.
- [ ] Receipt `T31-phase2-e2e.md`, commit.

### Fase 3: Regresi, aksesibilitas, Delivery Gate

- [ ] `pnpm build`, `pnpm test:e2e:ui`, `pnpm test:e2e:release`, `pnpm test:e2e:activity`, `pnpm test:e2e:m2`; catat angka.
- [ ] Axe acceptance 10 (sudah di `mobile-tab-bar.spec.ts`, tambah state compact light).
- [ ] Klik-tembus manual di 360 px dan 768 px, light dan dark: scroll bolak-balik di `/activity`, tap gutter, tap +, Menu lainnya, navigasi dari compact. Tulis pengamatan, termasuk apakah perubahan lebar terlihat patah di Chromium.
- [ ] Delivery Gate antislop (core + checklist `antislop-ui`, `antislop-human`, `antislop-layoutmobile`) dengan PASS/FAIL dan bukti di receipt.
- [ ] Receipt `T31-phase3-regression.md`, commit. **Stop: gate review Claude.**

### Fase 4: Draft dokumen (setelah gate lulus)

- [ ] `docs/Design.md` dan `Design.md` §4.3: tambahkan kapsul floating, menyempit saat compact, solid + satu shadow. Jaga kedua salinan identik. Bila checkout utama pengguna masih punya perubahan belum di-commit di kedua file, edit hanya di worktree dan catat potensi konflik merge di receipt.
- [ ] Draft decision `0041-t31-floating-tab-bar.md` (nomor dicek): mengganti posisi full-width di decision 0035 #7, alasan `nav` sebagai kapsul, batas 480 px, `width` vs `transform`, + tetap di dalam bar.
- [ ] `docs/verification/T31-floating-tab-bar.md` (ringkasan acceptance dan bukti) tanpa klaim DONE.
- [ ] Commit.

## 6. Fixture

- Akun dan 20 aktivitas dari `beforeAll` di `mobile-tab-bar.spec.ts` (nama "Rina Wulandari"), cukup panjang untuk scroll di 360 × 640.
- Sentinel privat di catatan Quick log tetap dicek tidak muncul di console (test composer T27).
- Tidak ada AI, key live, atau data hosted.

## 7. Commands

Semua script sudah ada di `package.json`:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:ui
pnpm test:e2e:release
pnpm test:e2e:activity
pnpm test:e2e:m2
```

`pnpm lint` di checkout yang punya `.claude/worktrees/*/.next` bisa gagal karena file build di sana; jalankan dengan `--ignore-pattern ".claude/**"` dan catat.

## 8. Stop conditions

Berhenti dan laporkan bila:

- Path yang akan diubah T31 berisi perubahan pengguna yang belum di-commit di worktree kerja.
- Label tebal "Dashboard" tidak muat di slot kapsul 336 px pada 360 px (Fase 0). Pilihan untuk pengguna: gutter 8 px, atau label lebih kecil; jangan memilih sendiri.
- Kapsul hanya bisa dibuat dengan mengubah markup `mobile-tab-bar.tsx` atau logika `useScrollChrome`.
- Tap di gutter tidak bisa diteruskan ke konten tanpa `pointer-events` trik yang mematahkan tap di kapsul.
- Test T27/T30 di luar ekspektasi posisi dan padding hanya lulus dengan melemahkan assertion.
- Kontras atau axe gagal di dark mode dan perbaikannya butuh token warna atau shadow baru.
- Butuh migration, dependency, atau perubahan copy.
- Scope bocor ke §2.3.

## 9. Gate review Claude

Read-only setelah Fase 3. P0–P2 memblokir, P3 follow-up.

- [ ] Receipt Fase 0–3 lengkap dengan angka aktual; ulang `lint`, `typecheck`, `test`, `test:e2e:release` di worktree bersih.
- [ ] Diff hanya `globals.css`, test, receipt, dan screenshot; tidak ada perubahan TSX atau copy.
- [ ] Gutter meneruskan tap; tap di dalam kapsul di luar tab tetap me-expand.
- [ ] Label tidak terpotong di 360 px; target ≥ 44 px dengan gap di compact.
- [ ] Kontrol terakhir dan toast tidak di bawah kapsul; tidak ada scroll horizontal.
- [ ] Reduced motion: state berganti tanpa transisi.
- [ ] Tanpa blur; satu shadow; radius dari token; tanpa token baru.
- [ ] Delivery Gate antislop tercatat tanpa FAIL.

## 10. Review focus

1. **Label tebal terpotong.** Kapsul 336 px mengurangi slot sekitar 4 px dibanding bar full-width, dan T27 pernah punya P2 label aktif terpotong di 360 px. Dijaga Fase 0 (ukur dulu) dan acceptance 6.
2. **Gutter menelan tap.** Bila kapsul dibuat sebagai child dari wrapper full-width, tap di gutter memicu expand dan tidak sampai ke konten. Dijaga §2.2.1 dan acceptance 5.
3. **Konten di bawah kapsul.** Offset 12 px + safe area mudah lupa dihitung di padding `main` dan toast. Dijaga acceptance 8 (hit-test kontrol terakhir dan posisi toast).
4. **Slot melompat saat menyempit.** Bila gap/padding list tidak ditransisikan bersama lebar kapsul, ikon bergeser patah di tengah animasi. Dijaga §2.2.4, unit CSS, dan klik-tembus Fase 3.
5. **Tablet 600-880 px.** Tanpa batas lebar, kapsul hampir 850 px di tablet. Dijaga §2.2.3 dan screenshot 768 px.

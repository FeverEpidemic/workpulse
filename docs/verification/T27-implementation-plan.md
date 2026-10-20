# Handoff T27 Bottom tab bar mobile: eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 20 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Dependensi: T04 (app frame), T07 (Quick log), T25 aksesibilitas **selesai secara lokal** (T25 masih PARTIAL hanya karena staging; T27 tidak menyentuh staging). T26 dan batas pemakaian AI sudah ada di branch; T27 tidak menyentuh import atau AI.
- Asal task: permintaan terarah pengguna pada 20 Oktober 2026 ("Navigation Bar untuk mobile seperti Instagram iOS"). T27 **tidak ada** di `IMPLEMENTATION_PLAN.md` §5. Semua keputusan §2.2 berasal dari interview di chat dan sudah dijawab pengguna.
- Eksekutor: satu agent **Claude**. Semua fase berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 5; Fase 6 (draft dokumen) setelah gate.
- antislop: mode **during** (dipilih pengguna untuk sesi interview). Pelaksana membaca `.claude/skills/antislop/SKILL.md`, `antislop-ui`, `antislop-layoutmobile`, dan `antislop-human`, lalu menjalankan Delivery Gate di Fase 5.
- Acuan:
  - `docs/Design.md` §4.1–§4.3 (navigasi), §31 Mobile UX (alur **Open → Add Activity → Type**, target sentuh ≥ 44 px).
  - `AGENTS.md` *UI dan aksesibilitas* (baris 120 masih menyebut "mobile memakai drawer").
  - Kode saat ini: `src/components/layout/workspace-navigation.tsx`, `src/components/layout/application-frame.tsx`, `src/components/layout/quick-log-link.tsx`, `src/features/activity/activity-capture-form.tsx`, `src/app/globals.css:397-426` dan `:1012-1107`.

**Goal:** Di lebar ≤ 880 px, navigasi workspace berpindah dari hamburger + drawer ke bottom tab bar lima slot: Dashboard, Activity, **+** (Quick log), Projects, Profile. Bar menampilkan label saat halaman di puncak, saat bar ditap, atau saat scroll ke atas, dan menyusut menjadi ikon saja saat scroll ke bawah. Header atas yang ringkas menampilkan judul halaman dan sembunyi saat scroll ke bawah. Tombol **+** membuka bottom sheet composer dengan keyboard langsung aktif. Achievements, Timeline, CV, Theme, dan Sign out pindah ke sheet "Menu lainnya" yang dibuka dari tombol ≡ di header halaman Profile. Desktop (> 880 px) tidak berubah.

**Architecture:** Murni perubahan UI client. Tidak ada migration, route API, atau dependency baru. `WorkspaceNavigation` tetap merender sidebar desktop; `MobileNavigation` diganti tiga komponen: `MobileHeader` (judul + aksi kontekstual), `MobileTabBar` (lima slot), dan dua sheet berbasis primitive `Dialog` yang ada. Satu hook `useScrollChrome` menghitung arah scroll dan menghasilkan state `expanded`/`compact` untuk bar dan `visible`/`hidden` untuk header. Composer memakai ulang `ActivityCaptureForm` lewat varian `sheet`, sehingga validasi, server action `createActivityAction`, operation key, dan draft sessionStorage `quick-log-note` tetap satu sumber.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, ikon `lucide-react` (keluarga ikon yang sudah dipakai, sesuai *satu keluarga ikon* di `AGENTS.md`), Vitest + Testing Library, Playwright + axe-core, pnpm dari lockfile. **Tidak ada dependency baru.**

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md`, `docs/Design.md` §4 dan §31, file antislop di atas, lalu `docs/verification/T26-implementation-plan.md` sebagai pola format.

Kutipan sumber yang mengikat (parafrase ringkas):

- **Design.md §4.1:** navigasi primer kecil; jangan mempromosikan setiap kemampuan ke navigasi primer.
- **Design.md §4.3 (lama):** mobile memakai drawer dan aksi mengambang Add Activity. T27 **mengganti** poin ini (decision 0034); alur Open → Add Activity → Type tetap wajib.
- **Design.md §31:** tiga use case mobile utama: tambah aktivitas, lihat aktivitas terbaru, kelola proyek. Keyboard fokus otomatis saat capture dibuka. Target sentuh ≥ 44 × 44 px.
- **AGENTS.md:** WCAG 2.2 AA, focus management/return, reduced motion, status tidak bergantung pada warna; verifikasi 360 px dan 1440 px light/dark.

Pertahankan perubahan lokal pengguna. Jangan menandai T27 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T27-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T27

T27 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Lima slot, urutan tetap.** Di 360 px, bar berisi tepat lima kontrol: Dashboard, Activity, Quick log (+), Projects, Profile. Tombol hamburger dan dialog "Primary navigation" tidak ada lagi di mobile. Di 1440 px bar tidak terlihat dan sidebar tidak berubah. Dibuktikan unit UI dan E2E.
2. **Tab aktif.** Tab untuk route saat ini memakai latar sage yang sama dengan `.workspace-nav-link.is-current` dan `aria-current="page"`. Route detail (mis. `/projects/<id>`) mengaktifkan tab induknya. `/achievements`, `/timeline`, `/cv`, dan `/settings/profile` mengaktifkan tab Profile (§2.2.4). Status aktif tidak hanya bergantung pada warna (bobot ikon/label juga berubah). Dibuktikan unit (`isCurrent`/pemetaan route) dan E2E.
3. **Label mengikuti scroll.** Label tampil saat `scrollY` di puncak; scroll ke bawah melewati ambang menyusutkan bar menjadi ikon saja; scroll ke atas melewati ambang atau tap pada area bar menampilkan label lagi. Nama aksesibel setiap tab selalu berisi label, di kedua state. Dibuktikan unit hook dan E2E.
4. **Header ikut scroll.** Header ringkas menampilkan judul halaman (§2.2.6), sembunyi saat scroll ke bawah dan muncul saat scroll ke atas. Header tidak pernah sembunyi selama fokus keyboard ada di dalamnya atau sebuah sheet terbuka. Dibuktikan unit hook dan E2E.
5. **Composer sekali tap.** Tap **+** membuka bottom sheet; textarea catatan langsung terfokus tanpa layar tambahan. Simpan memakai `createActivityAction`, menutup sheet, menampilkan toast sukses, dan halaman asal tetap di tempat. Validasi kosong dan > 10.000 karakter sama dengan form penuh. Dibuktikan unit UI dan E2E (aktivitas tersimpan dan muncul di `/activity`).
6. **Draft tidak hilang.** Teks di composer dan form `/activity/new` memakai draft sessionStorage `quick-log-note` yang sama. Menutup sheet (Esc, tombol tutup, backdrop) tidak menghapus draft; link "Detail lengkap" membuka `/activity/new` dengan teks yang sama. Setelah simpan sukses draft dibersihkan. Dibuktikan unit dan E2E.
7. **Menu lainnya.** Di halaman Profile, header menampilkan tombol ≡ berlabel. Tombol itu membuka sheet berisi link Achievements, Timeline, CV, `ThemeToggle`, dan `SignOutForm`. Memilih link menutup sheet dan bernavigasi; Esc menutup sheet dan fokus kembali ke tombol ≡. Dibuktikan E2E.
8. **Tab Profile.** Ikon tab Profile adalah lingkaran inisial dari `displayName` (maks. dua huruf, huruf besar, fallback satu huruf dari email bila nama kosong). Inisial disembunyikan dari screen reader; nama aksesibel tab tetap label Profile. Dibuktikan unit.
9. **Konten tidak tertutup.** `main` memberi ruang bawah setinggi bar + `env(safe-area-inset-bottom)`; tombol atau baris terakhir di `/activity`, `/projects`, dan `/settings/profile` dapat diklik di 360 × 640. Tidak ada overflow horizontal di 360 px untuk route responsif yang ada. Dibuktikan E2E.
10. **Reduced motion.** Dengan `prefers-reduced-motion: reduce`, perubahan state bar dan header terjadi tanpa transisi (durasi ≤ 0,01 ms), sama seperti pola `app-frame.spec.ts:299-304`. Dibuktikan E2E.
11. **Keyboard dan aksesibilitas.** Urutan tab: skip link, header, konten, bar. Semua kontrol bar dan sheet ≥ 44 × 44 px dengan fokus terlihat. Axe tanpa pelanggaran WCAG 2.2 AA pada `/dashboard`, `/settings/profile`, sheet composer, dan sheet Menu lainnya di 360 px light dan dark. Kontras label tab tidak aktif ≥ 4,5:1 di kedua tema. Dibuktikan E2E (`release-a11y`, `release-keyboard`, `app-frame`) dan `tests/unit/theme-contrast.test.ts` bila token baru dipakai.
12. **Copy.** Semua teks baru lewat `src/i18n/messages.ts` (en dan id), tanpa string literal di komponen dan tanpa em dash. Dibuktikan unit.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Komponen navigasi mobile, hook scroll, varian `sheet` pada `ActivityCaptureForm`, copy en/id, CSS di `globals.css` dengan token yang ada.
- Pembaruan test E2E yang mengasumsikan drawer (`app-frame.spec.ts:259-278`, `release-keyboard.spec.ts:193-202`).
- `docs/Design.md` §4.3 dan `Design.md` (root) §4.3, `AGENTS.md` dan `docs/AGENTS.md` baris 120, draft decision 0034.

### 2.2 Keputusan implementasi

1. **Breakpoint tetap ≤ 880 px.** Bottom bar memakai media query yang sama dengan header mobile sekarang (`globals.css:1012`). Tidak ada state tablet terpisah.
2. **Lima slot.** Urutan: Dashboard (`LayoutDashboard`), Activity (`NotebookTabs`), Quick log (`Plus`), Projects (`FolderKanban`), Profile (lingkaran inisial). Ikon sama dengan sidebar agar pengguna mengenali tujuan yang sama di kedua ukuran.
3. **Tombol + adalah satu-satunya aksen.** Kotak 44 × 44 px dengan latar `--color-action-primary` (token yang dipakai `.button-primary`) dan radius sedang, sejajar dengan tab lain, bukan FAB mengambang. Alasan: Quick log adalah satu aksi utama (Design.md §31); tab lain tetap netral. Elemen ini `button` (membuka dialog), bukan link.
4. **Tab aktif memakai latar sage**, sama dengan sidebar. Pemetaan: Dashboard hanya `/dashboard`; Activity `/activity` dan turunannya kecuali `/activity/new`; Projects `/projects/*`; Profile `/settings/profile`, `/achievements/*`, `/timeline`, `/cv/*`. Alasan Profile: ketiga halaman itu dicapai dari Menu lainnya di Profile, jadi pengguna tetap tahu posisi mereka. `aria-current="page"` hanya pada route yang persis sama dengan `href` tab; untuk halaman turunan pakai `aria-current="true"`.
5. **Perilaku label.**
   - State `expanded` (ikon + label) dan `compact` (ikon saja). Label di `compact` menjadi `sr-only`, bukan dihapus.
   - Ambang: `compact` bila `scrollY > 24` dan delta ke bawah ≥ 8 px; `expanded` bila delta ke atas ≥ 8 px, `scrollY ≤ 24`, atau pengguna mengetuk area bar di luar kontrol. Listener scroll `passive`, dibatasi `requestAnimationFrame`.
   - Tap pada tab langsung bernavigasi di kedua state (tidak ada "tap pertama hanya membuka label"). Halaman baru mulai di puncak, sehingga label tampil lagi dengan sendirinya.
   - Tinggi bar: `expanded` 64 px, `compact` 52 px (keduanya tetap memberi target 44 px), ditambah `env(safe-area-inset-bottom)`.
6. **Header.** Tinggi 52 px, sticky, latar `--color-bg-surface`, garis bawah 1 px. Judul dari pemetaan prefix route ke key i18n yang sudah ada (`workspace.dashboard`, `workspace.activity`, `workspace.projects`, `workspace.achievements`, `workspace.timeline`, `workspace.cv`, `profile.title`, `quickLog.title` untuk `/activity/new`). Route tanpa pemetaan menampilkan `BrandLogo`. Judul header adalah teks biasa (`p`), bukan `h1`, karena tiap halaman sudah punya `h1` sendiri. Header sembunyi dengan `transform: translateY(-100%)` mengikuti state scroll yang sama dengan bar; tetap tampil bila fokus di dalamnya (`:focus-within`) atau sheet terbuka.
7. **Bar solid.** Latar `--color-bg-surface`, garis atas 1 px `--color-border-default`, tanpa blur dan tanpa bayangan besar. Alasan: Design.md meminta navigasi yang tenang; blur juga menurunkan kontras label di atas konten.
8. **Composer sheet.**
   - Primitive `Dialog` dengan kelas `workspace-sheet-dialog`: menempel di bawah, lebar penuh, radius atas `--radius-lg`, tinggi maks. `85dvh`, konten bisa di-scroll.
   - Isi: `ActivityCaptureForm` dengan prop baru `variant="sheet"`. Varian ini hanya merender textarea catatan, field tanggal (default hari ini sesuai `profile.timezone`), tombol Simpan, dan link "Detail lengkap" ke `/activity/new?returnTo=<route saat ini>`. Fieldset mode, konteks, dan detail tidak dirender. Default `variant="full"` tidak mengubah perilaku form yang ada.
   - Fokus awal ke textarea dipanggil sinkron di handler klik tombol + agar keyboard iOS Safari ikut terbuka (iOS hanya membuka keyboard bila `focus()` terjadi dalam gesture pengguna). Bila `showModal()` mencuri fokus, panggil ulang di efek pembukaan dan catat di receipt hasil uji di WebKit Playwright.
   - Sukses: pakai callback `onSaved` yang sudah ada (`activity-capture-form.tsx:267`) untuk menutup sheet, menampilkan toast, dan `router.refresh()`; tidak redirect.
   - `ApplicationFrame` menerima `timezone` dari layout workspace untuk menghitung tanggal default dengan `activityDateInTimeZone`.
   - Desktop tetap memakai `QuickLogLink` ke `/activity/new`.
9. **Menu lainnya.** Tombol ≡ (`Menu`) hanya dirender di header saat route `/settings/profile`. Sheet memakai pola dialog yang sama dengan composer, judul `workspace.moreMenu`. Isi: link Achievements, Timeline, CV (komponen link yang sama dengan sidebar), `ThemeToggle`, `SignOutForm`. Link Profile tidak diulang karena pengguna sudah di Profile.
10. **Foto profil ditunda.** Skema saat ini tidak punya kolom foto atau avatar (tidak ada `avatar`/`photo` di `src/`). T27 memakai inisial saja (disetujui pengguna 20 Oktober 2026). Foto + fallback inisial menjadi follow-up yang butuh migration dan storage.
11. **Drawer dihapus.** `MobileNavigation`, kelas `.workspace-drawer*`, dan key `workspace.openMenu`/`workspace.closeMenu`/`workspace.mobileNavigationDescription` dihapus bila tidak dipakai lagi (cek dengan grep). Sidebar desktop tidak disentuh.
12. **Copy baru** (en / id):
    - `workspace.tabBar`: "Main tabs" / "Tab utama" (label `nav` bar).
    - `workspace.moreMenu`: "More" / "Menu lainnya".
    - `workspace.openMoreMenu`: "Open more menu" / "Buka menu lainnya".
    - `workspace.closeMoreMenu`: "Close more menu" / "Tutup menu lainnya".
    - Judul sheet composer memakai `workspace.quickLog` yang sudah ada ("Quick log" / "Catatan cepat").
    - `quickLog.closeSheet`: "Close quick log" / "Tutup catatan cepat".
    - `quickLog.openFullForm`: "Open full form" / "Detail lengkap".
    - Label tab Quick log memakai `workspace.quickLog` yang sudah ada.
13. **Dial antislop.** Design Read: *app shell mobile untuk workspace karier privat, bahasa visual tenang sesuai Design.md, dial ENERGY 1 / RHYTHM 1 / MOTION 2.* MOTION 2 karena dua transisi (label dan header) membantu pengguna melihat chrome yang berubah; durasi ≤ 200 ms, `ease-out`, dimatikan oleh reduced motion.
14. **Nomor.** Decision `docs/decisions/0034-t27-mobile-tab-bar.md` (0032 dan 0033 sudah dipakai batas AI dan T26). Tidak ada migration (parity tetap 38/38). Tidak ada script npm baru; test baru masuk ke `pnpm test` dan suite E2E yang ada.

### 2.3 Di luar scope

- Foto profil dan upload avatar (follow-up, butuh migration dan storage).
- Tombol kembali atau navigasi bertumpuk ala iOS di header.
- Perubahan sidebar desktop, collapsible rail, atau search/command.
- Halaman di luar app frame workspace (`/imports/*`, `/onboarding/*`, auth).
- Gesture swipe antar tab, haptics, atau PWA standalone.
- Deploy ke staging (ikut alur T25).

## 3. Kontrak teknis

### 3.1 Hook

- `src/components/layout/use-scroll-chrome.ts`: `useScrollChrome(): { compact: boolean; headerHidden: boolean; expand(): void }`. Murni berbasis `window.scrollY` dan ambang §2.2.5. Reset ke `expanded` saat `pathname` berubah. Tidak menyentuh DOM selain membaca scroll.

### 3.2 Komponen

- `src/components/layout/mobile-tab-bar.tsx`: `nav` berlabel `workspace.tabBar`, lima slot, atribut `data-compact`. Klik pada area kosong bar memanggil `expand()`.
- `src/components/layout/mobile-header.tsx`: judul dari `mobileTitleKey(pathname)`, tombol ≡ di `/settings/profile`, atribut `data-hidden`.
- `src/components/layout/mobile-sheets.tsx` (atau dua file bila > ~200 baris): `QuickLogSheet` dan `MoreMenuSheet` di atas `Dialog`.
- `src/components/layout/navigation-routes.ts`: pindahkan array `navigation` dan `isCurrent` dari `workspace-navigation.tsx:28-41`, tambah `mobileTabFor(pathname)` dan `mobileTitleKey(pathname)`. Fungsi murni agar mudah diuji unit.
- `src/components/ui/initials-avatar.tsx`: `initialsFrom(name, fallback)` + komponen lingkaran, `aria-hidden`.
- `src/features/activity/activity-capture-form.tsx`: prop `variant?: "full" | "sheet"`.
- `src/components/layout/application-frame.tsx`: prop `timezone`; pemanggil di layout workspace ikut diperbarui.

### 3.3 CSS

- `globals.css`: hapus `.workspace-drawer*` dan aturan `.workspace-mobile-header` lama; tambah `.workspace-tab-bar`, `.workspace-mobile-header` baru, `.workspace-sheet-dialog`, padding bawah `.workspace-content` di media query 880 px. Hanya token yang ada di `src/styles/tokens.css`; token baru hanya bila kontras membutuhkannya, dan tambahkan pasangan itu ke `theme-contrast.test.ts`.
- `src/app/layout.tsx`: ekspor `viewport` dengan `viewportFit: "cover"` agar `env(safe-area-inset-*)` bernilai di iOS. Saat plan ditulis belum ada ekspor `viewport` di file itu.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `src/components/layout/{navigation-routes.ts,use-scroll-chrome.ts,mobile-tab-bar.tsx,mobile-header.tsx,mobile-sheets.tsx}`, `src/components/ui/initials-avatar.tsx` |
| Modify | `src/components/layout/{workspace-navigation.tsx,application-frame.tsx}`, `src/app/(workspace)/layout.tsx`, `src/app/layout.tsx` |
| Modify | `src/features/activity/activity-capture-form.tsx`, `src/i18n/messages.ts`, `src/app/globals.css` |
| Create | `tests/unit/{navigation-routes,use-scroll-chrome,mobile-navigation-ui,initials-avatar}.test.ts(x)` |
| Modify | `tests/unit/` test form activity yang ada (varian `sheet`), `tests/e2e/app-frame.spec.ts`, `tests/e2e/release-keyboard.spec.ts`, `tests/e2e/release-a11y.spec.ts`, golden aria snapshot terkait bila berubah |
| Modify | `docs/Design.md`, `Design.md`, `AGENTS.md` dan `docs/AGENTS.md` (baris 120) |
| Create | `docs/verification/T27-phase{0..5}-*.md`, `docs/verification/T27-mobile-tab-bar.md`, `docs/decisions/0034-t27-mobile-tab-bar.md` |

## 5. Fase eksekusi

### Fase 0: Baseline (tanpa edit kode)

- [ ] `git status` bersih untuk path T27 (logo brand dan Storybook sudah di-commit pada 20 Oktober 2026). Bila ada path T27 yang kotor, **stop** (§8). Jangan stash atau menimpa. `.claude/launch.json` dan `.claude/setting.local.json` sengaja tetap lokal; jangan di-commit.
- [ ] Branch kerja baru dari `main` setelah branch yang memuat logo brand, Storybook, dan plan ini sudah merge.
- [ ] Catat parity migration (harapan **38/38**, terakhir `20261019090000_t26_import_rules_extraction.sql`).
- [ ] Jalankan `pnpm lint`, `pnpm typecheck`, `pnpm test`. Harapan dari receipt T26 Fase 5: unit **121/1151** (bisa berbeda karena Storybook ikut dikonfigurasi di Vitest); catat angka aktual. `pnpm lint` di checkout yang punya `.claude/worktrees/*/.next` gagal karena file build di sana; jalankan dengan `--ignore-pattern ".claude/**"` dan catat.
- [ ] Jalankan `pnpm test:e2e:ui` dan `pnpm test:e2e:release`; catat angka.
- [ ] Verifikasi rujukan file:baris di dokumen ini masih benar; selisih dicatat.
- [ ] Receipt `T27-phase0-baseline.md`.

### Fase 1: Rute dan state murni (unit)

- [ ] Test gagal: `navigation-routes.test.ts` (acceptance 2 pemetaan, §2.2.4, judul §2.2.6 termasuk fallback logo), `use-scroll-chrome.test.ts` (acceptance 3 dan 4: ambang, puncak, reset saat pathname berubah, `expand()`), `initials-avatar.test.ts` (acceptance 8).
- [ ] Implementasi §3.1 dan fungsi murni §3.2; `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus.
- [ ] Receipt `T27-phase1-routes-state.md`, commit.

### Fase 2: Tab bar dan header

- [ ] Test gagal `mobile-navigation-ui.test.tsx`: lima slot dan urutan, `aria-current`, label `sr-only` di `compact`, tap area bar memanggil `expand`, tombol ≡ hanya di Profile, header `data-hidden` tidak aktif saat fokus di dalam.
- [ ] Implementasi `mobile-tab-bar.tsx`, `mobile-header.tsx`, CSS bar dan header, `viewport` di `layout.tsx`, padding bawah konten. Hapus drawer (§2.2.11).
- [ ] Receipt `T27-phase2-tab-bar.md`, commit.

### Fase 3: Composer dan Menu lainnya

- [ ] Test gagal: varian `sheet` merender hanya field §2.2.8; default `full` tidak berubah (test form lama lulus tanpa diubah); draft `quick-log-note` dipakai bersama; `onSaved` menutup sheet; link Detail lengkap membawa `returnTo`.
- [ ] Test gagal: sheet Menu lainnya berisi tiga link + theme + sign out; Esc mengembalikan fokus ke ≡.
- [ ] Implementasi §3.2 (`mobile-sheets.tsx`, varian form, prop `timezone`).
- [ ] Receipt `T27-phase3-sheets.md`, commit.

### Fase 4: Copy dan aksesibilitas unit

- [ ] Test gagal: key §2.2.12 ada di en dan id, tanpa em dash; key drawer yang dihapus tidak dirujuk lagi.
- [ ] Bila ada token baru, tambahkan pasangan ke `theme-contrast.test.ts`.
- [ ] Receipt `T27-phase4-copy-a11y.md`, commit.

### Fase 5: E2E, aksesibilitas, regresi, Delivery Gate

- [ ] Perbarui `app-frame.spec.ts:259-278`: ganti skenario drawer dengan bar (acceptance 1, 2, 3, 4, 5, 6, 7, 9, 10). Scroll diuji dengan `page.mouse.wheel` di halaman yang cukup panjang (seed aktivitas lewat helper yang ada).
- [ ] Perbarui `release-keyboard.spec.ts:193-202` untuk sheet Menu lainnya dan composer (Enter/Space membuka, Esc menutup, fokus kembali).
- [ ] Tambah halaman dan sheet ke `release-a11y.spec.ts` (acceptance 11). Perbarui golden aria snapshot hanya untuk bagian navigasi mobile; catat diff-nya di receipt.
- [ ] Jalankan composer di proyek WebKit Playwright bila tersedia di config; bila tidak, catat bahwa perilaku keyboard iOS belum terbukti di perangkat nyata.
- [ ] Regresi §7 lengkap. Tidak ada assertion lama yang dilemahkan selain yang memang menguji drawer; setiap perubahan disertai alasan.
- [ ] Jalankan Delivery Gate antislop (core + checklist `antislop-layoutmobile`) dan tulis laporan PASS/FAIL dengan bukti di receipt, termasuk click-through setiap kontrol bar dan sheet di 360 px light/dark.
- [ ] Screenshot 360 px: bar `expanded`, bar `compact`, composer terbuka, Menu lainnya terbuka, light dan dark.
- [ ] Receipt `T27-phase5-e2e-regression.md`, commit. **Stop: gate review Claude.**

### Fase 6: Draft dokumen (setelah gate lulus)

- [ ] `docs/Design.md` dan `Design.md` §4.3: ganti drawer dengan bottom tab bar lima slot, composer sheet, dan Menu lainnya; alur Open → Add Activity → Type tetap.
- [ ] `AGENTS.md` dan `docs/AGENTS.md` baris 120: "mobile memakai bottom tab bar; Quick log membuka sheet dengan input terfokus".
- [ ] Draft decision `0034-t27-mobile-tab-bar.md` (alasan mengganti drawer, keputusan §2.2, follow-up foto profil).
- [ ] `docs/verification/T27-mobile-tab-bar.md` (ringkasan acceptance dan bukti) tanpa klaim DONE.
- [ ] Commit.

## 6. Fixture

- Satu akun test dengan `displayName` dua kata (inisial dua huruf) dan satu akun dengan nama kosong untuk fallback, dibuat dan dibersihkan oleh helper E2E yang ada (`tests/e2e/app-frame.spec.ts`).
- Seed ≥ 20 aktivitas agar `/activity` cukup panjang untuk uji scroll di 360 × 640.
- Sentinel privat di catatan composer; pastikan tidak muncul di console browser.

## 7. Commands

Semua script sudah ada di `package.json`:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:ui
pnpm test:e2e:auth
pnpm test:e2e:activity
pnpm test:e2e:release
pnpm test:e2e:m2
pnpm test:e2e:dashboard
```

`pnpm build` wajib di Fase 5 karena `layout.tsx` mendapat ekspor `viewport`.

## 8. Stop conditions

Berhenti dan laporkan bila:

- Path yang akan diubah T27 masih berisi perubahan pengguna yang belum di-commit (lihat Fase 0).
- Varian `sheet` hanya bisa dibuat dengan mengubah perilaku form penuh atau server action.
- Test lama di luar skenario drawer hanya lulus dengan melemahkan assertion.
- Perlu migration, kolom foto profil, atau dependency baru.
- Scope bocor ke §2.3 (back stack, desktop, halaman luar frame).
- Kontras label atau fokus tidak bisa memenuhi AA dengan token yang ada tanpa mengubah palet Design.md.

## 9. Gate review Claude

Read-only setelah Fase 5. P0–P2 memblokir, P3 follow-up.

- [ ] Receipt Fase 0–5 lengkap dengan angka aktual; ulang `lint`, `typecheck`, `test`, `test:e2e:ui`, `test:e2e:release` di worktree bersih.
- [ ] Desktop 1440 px identik dengan sebelum T27 (sidebar, topbar, Quick log link).
- [ ] Lima slot, pemetaan aktif §2.2.4, `aria-current` benar.
- [ ] Label selalu ada di nama aksesibel; state `compact` tidak menghapus label dari DOM.
- [ ] Header tidak sembunyi saat fokus di dalamnya atau sheet terbuka.
- [ ] Composer: fokus langsung, draft bersama, simpan tanpa redirect, form penuh tidak berubah.
- [ ] Tidak ada konten tertutup bar di 360 × 640; safe-area dipakai.
- [ ] Copy en/id sesuai §2.2.12, tanpa em dash. Delivery Gate antislop tercatat tanpa FAIL.

## 10. Review focus

1. **Varian `sheet` merusak form penuh.** Prop baru diam-diam mengubah fieldset, draft key, atau redirect `/activity/new`. Dijaga test form lama tanpa perubahan dan skenario Quick log di `app-frame.spec.ts:185-226`.
2. **Keyboard iOS tidak terbuka.** `focus()` dipanggil di efek setelah render sehingga Safari menolak membuka keyboard. Dijaga keputusan §2.2.8 dan catatan WebKit di receipt Fase 5; perangkat nyata tetap risiko terbuka.
3. **Label hilang dari screen reader.** Mode `compact` memakai `display: none` pada label. Dijaga unit acceptance 3 (nama aksesibel di kedua state) dan Axe.
4. **Bar menutup konten.** Padding bawah lupa safe-area atau sheet/toast tertutup bar. Dijaga E2E acceptance 9.
5. **Scroll listener boros atau berkedip.** Ambang terlalu kecil membuat bar berganti state saat momentum scroll iOS. Dijaga unit ambang dan rAF di acceptance 3.
6. **Fokus hilang saat header sembunyi.** Pengguna keyboard Tab ke tombol ≡ yang sedang `translateY(-100%)`. Dijaga acceptance 4 (`:focus-within`) dan `release-keyboard`.

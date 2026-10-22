# Handoff T30 Animasi dan loading: eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [x]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 22 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Dependensi: T04 (app frame), T07 (Quick log), T27 (tab bar dan sheet mobile) **DONE** di `main`. T28 (import mode choice) dan T29 (Google OAuth) belum merge; T30 tidak menyentuh pilihan mode import atau auth. Bila keduanya merge lebih dulu, rebase dan ulang Fase 0.
- Asal task: permintaan terarah pengguna pada 21 Oktober 2026 ("nambahin animasi dan loading animation"). T30 **tidak ada** di `IMPLEMENTATION_PLAN.md` §5. Semua keputusan berasal dari interview di chat dan tercatat di [T30-motion-loading-design.md](T30-motion-loading-design.md).
- Eksekutor: satu agent **ChatGPT Sol 6.1** (reasoning medium), ditetapkan pengguna 22 Oktober 2026. Semua fase berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 5; Fase 6 (draft dokumen) setelah gate.
- antislop: mode **during** (dipilih pengguna 21 Oktober 2026). Pelaksana membaca `antislop`, `antislop-ui`, `antislop-human`, `antislop-copywriting`, dan `antislop-layoutmobile` dari `.codex/skills/<nama>/SKILL.md` (salinan identik ada di `.claude/skills/`), lalu menjalankan Delivery Gate di Fase 5.
- Acuan:
  - `docs/Design.md` §16.1 (tanpa gradient), §16.2 (logo tidak dianimasikan berulang), §24 (state komponen), §28 (motion), §29 (skeleton), §37 (reduced motion).
  - `AGENTS.md` *UI dan aksesibilitas* (WCAG 2.2 AA, reduced motion, 360 px dan 1440 px light/dark).
  - Kode saat ini: `src/styles/tokens.css:88-89`, `src/app/globals.css` (`:132-136`, `:1258-1272`, `:1322-1363`, `:1394-1433`, `:1696-1705`), `src/components/ui/{button,skeleton,dialog,toast}.tsx`, `src/components/forms/submit-button.tsx`, `src/components/layout/mobile-chrome.tsx:75-78`, `src/features/ai/activity-analysis-panel.tsx`, `src/features/cv/cv-export-page.tsx`, `src/features/activity/activity-list.tsx`, sembilan `src/app/**/loading.tsx`.

**Goal:** App tidak lagi terasa kaku, loading tidak lagi terlihat seperti crash, dan setiap klik tombol terasa diterima. Tiga pola loading: skeleton yang bergerak untuk pindah halaman, spinner di dalam tombol untuk aksi simpan, dan `ProgressStatus` (tahap + waktu menunggu + peringatan bila lama) untuk job AI, import, dan export. Modal, sheet, toast, item baru di daftar aktivitas, accordion, dan konten halaman mendapat transisi masuk/keluar singkat. Semua tetap terbaca dengan `prefers-reduced-motion: reduce`.

**Architecture:** Murni perubahan UI client dan CSS. Tidak ada migration, route API, perubahan server action, atau dependency baru. Token motion dan easing ditambah di `tokens.css`. Animasi ditulis di `globals.css`. Masuk/keluar dialog memakai `@starting-style` dan `transition-behavior: allow-discrete` pada `<dialog>` native. Transisi halaman memakai `src/app/(workspace)/template.tsx` yang di-remount Next pada setiap navigasi segmen, dengan animasi masuk CSS (§2.2.9). `Button` menjadi satu-satunya sumber state pending. `ProgressStatus` adalah komponen client baru dengan logika waktu murni yang diuji unit.

**Tech stack:** Next.js 16.3.5 App Router (`useLinkStatus` tersedia di `next/link`, `node_modules/next/dist/client/link.d.ts:117`), React 19.3.0, TypeScript 6 strict, CSS di `globals.css`, `lucide-react` untuk ikon spinner (`LoaderCircle`), Vitest dengan env `node` tanpa DOM (UI diuji lewat `renderToStaticMarkup`, logika waktu dan state di fungsi murni dengan fake timers), Storybook 10 dengan addon a11y, Playwright + axe-core, pnpm dari lockfile. **Tidak ada dependency baru.**

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md`, [T30-motion-loading-design.md](T30-motion-loading-design.md), `docs/Design.md` §16, §24, §28, §29, §37, file antislop di atas, lalu `docs/verification/T27-implementation-plan.md` sebagai pola format.

Kutipan sumber yang mengikat (parafrase ringkas):

- **Design.md §16.1:** tidak ada gradient. Ini juga berlaku untuk skeleton (§2.2.4).
- **Design.md §16.2:** titik logo tidak boleh dianimasikan berulang.
- **Design.md §28:** motion untuk konfirmasi simpan, item baru di timeline, drawer, modal, proses AI, dan perubahan state; tanpa loop dekoratif. §28.1: item muncul dengan gerak halus lalu toast. §28.2: indikator AI kecil yang bergerak, tanpa loading layar penuh. §28.3: transisi halaman cepat dan tidak menunda interaksi. §28.4: hormati reduced motion.
- **Design.md §29:** skeleton adalah pola utama; spinner hanya untuk aksi yang hasilnya tidak bisa diwakili skeleton.
- **AGENTS.md:** status tidak bergantung pada warna; verifikasi 360 px dan 1440 px light/dark. Status project tanpa persentase progress (tidak terkait langsung, tetapi menegaskan: T30 tidak membuat angka progress).

Pertahankan perubahan lokal pengguna. Jangan menandai T30 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T30-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T30

T30 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Token.** `tokens.css` punya `--motion-instant`, `--motion-slow`, `--ease-out`, `--ease-in`, `--ease-standard` (§2.2.1) di samping `--motion-fast`/`--motion-normal` yang ada. Tidak ada `transition` atau `animation` interaksi di `globals.css` yang memakai durasi literal di atas 240 ms. Dibuktikan unit (parse CSS).
2. **Efek tekan.** `.button-primary`, `.button-secondary`, `.button-danger`, `.ui-button-ghost`, dan `.ui-icon-button` di `:active` memakai `scale(0.97)` dengan transisi `transform` `--motion-instant`, menggantikan `translateY(1px)` di `globals.css:1258-1263`. Dibuktikan E2E (computed style saat `mouse.down`).
3. **Tombol pending terlihat sibuk, bukan mati.** `Button` dengan `loading` merender spinner + label asli, `aria-busy="true"`, `disabled`, dan lebar tidak berubah. Opacity tidak turun ke 0.58 seperti tombol disabled. Spinner terlihat setelah 150 ms. Tanpa `loadingLabel` tombol tetap menampilkan spinner. Dibuktikan unit dan E2E (lebar sebelum/sesudah sama ± 1 px).
4. **Tidak ada submit ganda.** Klik dua kali cepat pada Save activity hanya membuat satu aktivitas. Dibuktikan E2E.
5. **Satu sumber pending.** Semua tombol yang memakai `useFormStatus` sendiri (daftar di Fase 0) memakai `Button`/`SubmitButton`. Dibuktikan grep di receipt dan unit.
6. **Skeleton bergerak tanpa gradient.** `.ui-skeleton` berdenyut lewat `opacity` (§2.2.4), muncul setelah 150 ms, dan berhenti saat konten datang (elemen dilepas). Di reduced motion skeleton diam. Setiap `loading.tsx` punya teks memuat yang terlihat. Dibuktikan unit (setiap `loading.tsx` merender teks) dan E2E (computed `animation-name`).
7. **Loading lama.** Setelah 8 detik, `loading.tsx` menampilkan teks "masih memuat" dan tombol muat ulang yang berfungsi. Dibuktikan unit (fake timers) dan klik-tembus.
8. **Pending navigasi.** Link sidebar dan tab bar yang diklik menampilkan state pending (`data-pending`, spinner kecil setelah 150 ms) sampai navigasi selesai. Dibuktikan unit (mock `useLinkStatus`) dan E2E (route lambat).
9. **`ProgressStatus`.** Untuk AI, import, dan export: tahap antre/memproses, waktu menunggu muncul setelah 3 detik, peringatan setelah ambang per jenis (§2.2.11), dan error/coba lagi yang ada tetap. Screen reader hanya diberi tahu saat tahap berganti dan saat peringatan muncul, tidak tiap detik. Dibuktikan unit (fake timers) dan E2E AI dengan fake provider.
10. **Transisi masuk/keluar.** Dialog, sheet, backdrop, dan toast punya animasi masuk dan keluar sesuai §2.2.8. Escape dan tombol tutup tetap menutup, fokus tetap kembali ke pemicu. Dibuktikan E2E di Chromium.
11. **Item baru.** Setelah simpan dari Quick log sheet, baris aktivitas baru di `/activity` dan daftar aktivitas terbaru di dashboard mendapat highlight sekali (§2.2.10), dan satu toast "Activity saved" muncul. Dibuktikan E2E.
12. **Transisi halaman.** Konten utama workspace mendapat animasi masuk saat pindah route; sidebar, tab bar, dan header mobile tidak ikut bergerak. Perubahan filter di URL yang sama tidak memicu animasi. Dibuktikan E2E.
13. **Reduced motion.** Dengan `reducedMotion: "reduce"`: tidak ada animasi berjalan, spinner diganti ikon statis, dan teks status (memuat, tahap, waktu menunggu) tetap terlihat. Dibuktikan E2E dan Storybook.
14. **Aksesibilitas dan copy.** Axe tanpa pelanggaran WCAG 2.2 AA pada state pending, `ProgressStatus`, dan skeleton di 360 px dan 1440 px, light dan dark. Copy baru lewat `src/i18n/messages.ts` (en dan id), tanpa em dash. Dibuktikan E2E dan unit.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Token, CSS animasi, `Button`, `SubmitButton`, `Skeleton`, `Dialog`, `ToastProvider`, komponen baru `ProgressStatus` dan `SlowLoadingNotice`, `template.tsx` workspace, pending link di navigasi, highlight item baru, copy en/id.
- Pemasangan `ProgressStatus` di panel AI, halaman export CV, dan status import.
- Story Storybook untuk state baru.
- Pembaruan E2E yang mengukur transisi atau mengasumsikan teks tombol berganti saat pending.

### 2.2 Keputusan implementasi

1. **Token.** `--motion-instant: 100ms`, `--motion-slow: 240ms`, `--ease-out: cubic-bezier(0.2, 0, 0, 1)`, `--ease-in: cubic-bezier(0.4, 0, 1, 1)`, `--ease-standard: cubic-bezier(0.4, 0, 0.2, 1)`. `--motion-fast` (120 ms) dan `--motion-normal` (180 ms) tidak berubah. Alasan: semua durasi tetap di bawah ambang yang terasa menunda interaksi (§28.3).
2. **Reduced motion.** Blok global `globals.css:1696-1705` tetap. Indikator loading tidak boleh hanya bergerak: spinner punya pasangan ikon statis yang tampil di `@media (prefers-reduced-motion: reduce)`, dan setiap indikator disertai teks yang terlihat. Alasan: blok global membuat animasi berhenti di frame pertama, sehingga spinner akan terlihat macet.
3. **Tombol.**
   - Tekan: `transform: scale(0.97)` pada `:active:not(:disabled)`, `transition: transform var(--motion-instant) var(--ease-standard)` ditambahkan ke daftar transisi `globals.css:132-136`.
   - Pending: `Button` merender `<span class="ui-button-spinner" aria-hidden>` + label asli. `loadingLabel` tidak lagi mengganti label; nilainya menjadi teks `sr-only` di dalam tombol sehingga nama aksesibel memberi tahu bahwa tombol sedang bekerja. Kelas `[aria-busy="true"]` menjaga opacity 1 dan `cursor: progress`, mengalahkan aturan disabled `:1265-1272`.
   - Anti-kedip: spinner memakai `animation-delay: 150ms` pada opacity; `disabled` berlaku langsung saat pending.
   - Alasan: label yang berganti mengubah lebar tombol dan hilang bila `loadingLabel` lupa diisi; opacity 0.58 membuat tombol sibuk terlihat mati.
4. **Skeleton berdenyut, bukan shimmer.** Spec awal menulis shimmer kiri ke kanan. Shimmer memerlukan `linear-gradient`, dan Design.md §16.1 melarang gradient. Keputusan: `@keyframes ui-skeleton-pulse` mengubah `opacity` 1 → 0.55 → 1 dalam 1.6 s, `ease-in-out`, berulang hanya selama elemen ada. Muncul dengan `animation-delay: 150ms` dan `opacity: 0` sebagai awal. Pengguna diberi tahu perubahan ini di chat 22 Oktober 2026 sebelum eksekusi.
5. **Teks memuat terlihat.** Setiap `loading.tsx` merender satu baris teks kecil `--color-text-secondary` (key `common.loadingPage`) di samping `sr-only` yang ada. Alasan: skeleton diam di reduced motion harus tetap terbaca sebagai loading.
6. **Loading lama.** Komponen client `SlowLoadingNotice` (8 s, fake timers di test) dipasang di setiap `loading.tsx`. Isi: teks `common.stillLoading` dan tombol `common.reload` yang memanggil `window.location.reload()`. Alasan: navigasi yang benar-benar macet tidak bisa dipulihkan dengan `router.refresh()`. Tidak ada `error.tsx` di `src/app/` saat plan ditulis; menambah error boundary di luar scope (§2.3).
7. **Pending navigasi.** `useLinkStatus` di komponen link sidebar (`workspace-navigation.tsx`) dan tab bar (`mobile-tab-bar.tsx`). `pending` → `data-pending="true"` pada link dan spinner 14 px pengganti ikon setelah 150 ms. Bila Fase 0 menemukan `useLinkStatus` tidak memberi `pending` pada build dev/prod, **stop** (§8), jangan mengganti dengan state buatan sendiri.
8. **Dialog, sheet, toast.**

   | Elemen | Masuk | Keluar |
   | --- | --- | --- |
   | `.ui-dialog` | opacity 0 → 1, `scale(0.98)` → 1, `--motion-normal` `--ease-out` | opacity, `--motion-fast` `--ease-in` |
   | `.workspace-sheet-dialog` | `translateY(100%)` → 0, `--motion-slow` `--ease-out` | ke `translateY(100%)`, `--motion-normal` `--ease-in` |
   | `::backdrop` | opacity, `--motion-normal` | opacity, `--motion-fast` |
   | `.ui-toast` | `translateY(8px)` + opacity, `--motion-normal` | opacity, `--motion-fast` |

   - Dialog: `@starting-style` untuk masuk; `transition` pada `display` dan `overlay` dengan `allow-discrete` untuk keluar. `Dialog` tidak berubah perilakunya (`close()` tetap langsung). Browser tanpa `overlay` (Firefox) menutup tanpa animasi keluar; itu diterima.
   - Toast: `ToastProvider` menandai entry `leaving` 120 ms sebelum dihapus (4 380 ms dari 4 500 ms yang ada), lalu CSS `[data-leaving]` memudarkannya.
9. **Transisi halaman lewat `template.tsx`.** Spec menulis View Transitions. Saat plan ditulis `next.config.ts` tidak punya flag `viewTransition`, dan opsi itu tidak ditemukan di `node_modules/next/dist/server/config-schema.js`. Keputusan: `src/app/(workspace)/template.tsx` membungkus `children` dengan `<div class="workspace-page-enter">`; animasi masuk opacity + `translateY(4px)`, `--motion-normal` `--ease-out`. Tanpa animasi keluar. Template berada di dalam layout, jadi sidebar, tab bar, dan header tidak ikut di-remount. Alasan: tidak bergantung pada flag eksperimental, jalan di semua browser, dan tidak menunda interaksi.
10. **Highlight item baru.** Hanya untuk jalur Quick log sheet (`mobile-chrome.tsx:75-78`, `onCreated`), karena form penuh sudah berpindah ke halaman detail (`activity-capture-form.tsx:278-279`).
    - `onCreated(activityId)` menyimpan `{ id, at }` di sessionStorage key `workpulse-just-added`, menampilkan toast `activity.saved` (cek di Fase 0 apakah toast sudah muncul dari tempat lain; hasil akhir harus tepat satu toast), lalu `router.refresh()`.
    - Baris di `activity-list.tsx` dan daftar aktivitas terbaru dashboard mendapat `data-activity-id`. Komponen client kecil `JustAddedHighlight` membaca key itu (berlaku 10 detik), memberi `data-just-added` pada baris yang cocok, lalu menghapus key.
    - CSS: `@keyframes ui-just-added` latar `--color-primary-100` (dark: `--color-primary-800`) memudar ke transparan dalam 1.2 s + geser 4px, sekali jalan.
11. **`ProgressStatus`.**
    - Props: `stage: "queued" | "running"`, `kind: "ai" | "import" | "export"`, `startedAt?: number`.
    - `startedAt` default waktu mount di client, karena payload AI saat ini tidak membawa timestamp (tidak ada `created_at`/`started_at` di `activity-analysis-panel.tsx`). Copy waktu memakai kata "menunggu" agar jujur bahwa yang diukur adalah lama menunggu di layar ini.
    - Fungsi murni `progressStatusView(nowMs, startedAt, kind, stage)` di `src/components/ui/progress-status-view.ts` mengembalikan `{ showElapsed, elapsedSeconds, slow }`. Ambang: waktu muncul ≥ 3 s; `slow` pada AI ≥ 30 s, export ≥ 45 s, import ≥ 60 s. Ambang adalah hipotesis dan ditulis sebagai konstanta satu tempat; Fase 0 mencatat durasi job fake lokal dan, bila tersedia, catatan durasi staging di receipt T25.
    - Region `role="status"` hanya berisi teks tahap dan peringatan; teks waktu berada di elemen terpisah dengan `aria-hidden="true"` agar tidak dibacakan tiap detik.
    - Interval 1 s dihentikan saat komponen dilepas atau tab tersembunyi (`visibilitychange`), sejalan dengan `pollingPlan` di `cv-export-page-state.ts:38`.
12. **Tidak dianimasikan.** Stagger isi list, animasi scroll, kartu terangkat saat hover, logo, angka dashboard, dan accordion yang belum punya struktur `details`/`summary` (lihat Fase 0). Alasan: template animation tanpa tujuan (R-19) dan §16.2.
13. **Copy baru** (en / id, draf; teks final lewat `antislop-copywriting` di Fase 4):
    - `common.loadingPage`: "Loading this page" / "Memuat halaman ini"
    - `common.stillLoading`: "Still loading. If it stays like this, reload the page." / "Masih memuat. Bila tetap begini, muat ulang halaman."
    - `common.reload`: "Reload" / "Muat ulang"
    - `progress.queued`: "Waiting in line" / "Menunggu giliran"
    - `progress.running.ai`: "Reading your activity" / "Membaca aktivitasmu"
    - `progress.running.import`: "Reading your CV" / "Membaca CV-mu"
    - `progress.running.export`: "Building your PDF" / "Menyusun PDF-mu"
    - `progress.elapsed`: "Waiting {seconds}s" / "Menunggu {seconds} dtk"
    - `progress.slow`: "This is taking longer than usual. You can keep working; we'll update this when it's done." / "Ini lebih lama dari biasanya. Kamu bisa lanjut bekerja; status ini akan berubah saat selesai."
    - Key yang sudah ada (`ai.analysis.queued`, `ai.analysis.running`, dan padanannya di export/import) dipakai ulang bila maknanya sama; jangan menggandakan copy. Fase 0 memetakan key yang ada.
14. **Dial antislop.** Design Read: *workspace karier privat untuk pengguna individu, bahasa visual tenang sesuai Design.md, dial ENERGY 1 / RHYTHM 1 / MOTION 2.* MOTION 2 karena transisi masuk/keluar dan loading yang bergerak menjawab keluhan "kaku" dan "seperti crash"; tanpa parallax atau koreografi.
15. **Nomor.** Decision memakai nomor bebas berikutnya saat Fase 6 (0037 terakhir di `main`; 0038 dipakai T28 yang belum merge, jadi perkiraan **0039**). Tidak ada migration (parity tetap 38/38). Tidak ada script npm baru.

### 2.3 Di luar scope

- `error.tsx` / error boundary per route (follow-up; saat ini tidak ada di `src/app/`).
- Persentase progress atau ETA untuk job.
- Library animasi (`motion`) atau flag eksperimental Next.
- Animasi untuk halaman di luar app frame workspace (`/imports/*` kecuali `ProgressStatus`, `/onboarding/*`, auth).
- Perubahan alur, server action, atau layout halaman.
- Deploy ke staging (ikut alur T25).

## 3. Kontrak teknis

### 3.1 Komponen dan fungsi

- `src/components/ui/button.tsx`: API `ButtonProps` tetap (`loading`, `loadingLabel` opsional). Render pending sesuai §2.2.3.
- `src/components/forms/submit-button.tsx`: tetap membungkus `Button`; tidak berubah kecuali bila Fase 0 menemukan perbedaan perilaku.
- `src/components/ui/progress-status-view.ts`: fungsi murni §2.2.11, tanpa React.
- `src/components/ui/progress-status.tsx`: komponen client.
- `src/components/ui/slow-loading-notice.tsx`: komponen client §2.2.6.
- `src/components/ui/just-added-highlight.tsx`: komponen client §2.2.10, plus helper `rememberJustAdded(id)`.
- `src/components/ui/toast.tsx`: state `leaving` per entry.
- `src/app/(workspace)/template.tsx`: baru, §2.2.9.
- `src/components/layout/{workspace-navigation,mobile-tab-bar,mobile-chrome}.tsx`: pending link dan `onCreated`.

### 3.2 CSS

- `src/styles/tokens.css`: token §2.2.1.
- `src/app/globals.css`: tekan dan pending tombol, `.ui-button-spinner`, `@keyframes ui-skeleton-pulse`, `ui-spin`, `ui-just-added`, `ui-page-enter`, masuk/keluar dialog, sheet, backdrop, toast, dan aturan reduced motion per komponen. Hanya token dari `tokens.css`; token warna baru hanya bila kontras membutuhkannya, dan pasangannya ditambahkan ke `tests/unit/theme-contrast.test.ts`.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `src/components/ui/{progress-status-view.ts,progress-status.tsx,slow-loading-notice.tsx,just-added-highlight.tsx}`, `src/app/(workspace)/template.tsx` |
| Modify | `src/components/ui/{button,skeleton,toast}.tsx`, `src/components/layout/{workspace-navigation,mobile-tab-bar,mobile-chrome}.tsx`, `src/features/activity/activity-list.tsx`, daftar aktivitas terbaru dashboard (path dicek di Fase 0) |
| Modify | `src/features/ai/activity-analysis-panel.tsx`, `src/features/cv/cv-export-page.tsx`, status import (path dicek di Fase 0), file dengan `useFormStatus` sendiri (daftar Fase 0) |
| Modify | sembilan `src/app/**/loading.tsx`, `src/styles/tokens.css`, `src/app/globals.css`, `src/i18n/messages.ts` |
| Create | `tests/unit/{progress-status-view,progress-status,slow-loading-notice,just-added-highlight,motion-tokens}.test.ts(x)` |
| Modify | `tests/unit/` test `Button` dan `loading.tsx` yang ada, `src/components/ui/button.stories.tsx`, story baru `progress-status.stories.tsx` dan `skeleton.stories.tsx` |
| Modify | `tests/e2e/{app-frame,activity-ui,mobile-tab-bar,release-a11y,release-keyboard,ai-review,cv-export}.spec.ts` sesuai kebutuhan acceptance |
| Create | `docs/verification/T30-phase{0..5}-*.md`, `docs/verification/T30-motion-loading.md`, `docs/decisions/00xx-t30-motion-loading.md` |

## 5. Fase eksekusi

### Fase 0: Baseline (tanpa edit kode)

- [ ] `git status` bersih di worktree `claude/t30-motion-loading`. `.claude/launch.json` dan `.claude/setting.local.json` sengaja tetap lokal; jangan di-commit. Checkout utama `D:\Project\WorkPulse` sedang berada di tengah merge T28 milik pengguna; jangan disentuh.
- [ ] `pnpm install --frozen-lockfile` di worktree (worktree belum punya `node_modules`).
- [ ] Parity migration (harapan **38/38**, terakhir `20261019090000_t26_import_rules_extraction.sql`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`. Harapan dari receipt M5 Fase 5: unit **129 file / 1181**; catat angka aktual.
- [ ] `pnpm test:e2e:ui` dan `pnpm test:e2e:release`; catat angka.
- [ ] Inventaris dan catat di receipt:
  - semua pemakaian `useFormStatus` di luar `submit-button.tsx` (saat plan ditulis: `conflict-controls.tsx`, `action-feedback.tsx`, `activity-analysis-panel.tsx`, `ai-consent-card.tsx`) dan apakah masing-masing tombol bisa memakai `Button` tanpa mengubah perilaku;
  - test unit/E2E yang mengharapkan teks tombol berganti ke `loadingLabel` (grep `loadingLabel`, `pendingLabel`, dan teks pending di `tests/`);
  - path status import yang menampilkan `queued`/`running`/`processing`, dan path daftar aktivitas terbaru dashboard;
  - key i18n status yang sudah ada untuk AI, import, export;
  - apakah save dari Quick log sheet sudah menampilkan toast dari tempat lain (catatan: `ActionFeedback` di `src/components/forms/action-feedback.tsx` sudah menampilkan toast saat sukses; bila form sheet memakainya, `onCreated` **tidak** boleh menambah toast);
  - accordion/collapsible yang ada (`details`/`summary` atau komponen sendiri).
- [ ] Cek `useLinkStatus` memberi `pending: true` saat navigasi lambat di `pnpm dev` (route dengan `loading.tsx`). Catat hasilnya. Bila tidak, **stop** (§2.2.7).
- [ ] Catat durasi job fake lokal (AI, import, export) dari suite E2E yang sudah ada untuk konteks ambang §2.2.11.
- [ ] Verifikasi rujukan file:baris di dokumen ini; selisih dicatat.
- [ ] Receipt `T30-phase0-baseline.md`.

### Fase 1: Pondasi

- [ ] Test gagal `motion-tokens.test.ts`: token §2.2.1 ada; tidak ada durasi literal > 240 ms pada `transition`/`animation` interaksi di `globals.css` (pengecualian bernama: `ui-skeleton-pulse`, `ui-just-added`, `ui-spin`).
- [ ] Implementasi token di `tokens.css`; ganti `ease` di transisi tombol dan navigasi dengan token easing.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus.
- [ ] Receipt `T30-phase1-foundation.md`, commit.

### Fase 2: Loading

- [ ] Test gagal: `progress-status-view.test.ts` (ambang 3 s dan per jenis, `startedAt` di masa depan → 0, kind tak dikenal ditolak tipe), `progress-status.test.tsx` (`renderToStaticMarkup` untuk tiap hasil `progressStatusView`: teks tahap di region `status`, teks waktu `aria-hidden`, peringatan; keputusan "interval jalan atau berhenti" untuk unmount dan tab tersembunyi diuji sebagai fungsi murni, perilaku nyata dibuktikan E2E Fase 5), `slow-loading-notice.test.tsx` (fungsi murni ambang 8 s dengan fake timers, markup tombol muat ulang), test bahwa setiap `loading.tsx` merender `common.loadingPage`.
- [ ] Implementasi `Skeleton` pulse (§2.2.4), `ProgressStatus`, `SlowLoadingNotice`, teks memuat di sembilan `loading.tsx`.
- [ ] Pasang `ProgressStatus` di panel AI, export CV, dan status import. State error dan tombol coba lagi yang ada tidak berubah.
- [ ] Pending link di sidebar dan tab bar (§2.2.7) dengan unit yang me-mock `useLinkStatus`.
- [ ] Story `progress-status.stories.tsx` dan `skeleton.stories.tsx` (normal, lama, reduced motion, dark).
- [ ] Receipt `T30-phase2-loading.md`, commit.

### Fase 3: Tombol

- [ ] Test gagal `Button`: spinner + label asli saat `loading`, `aria-busy`, `disabled`, `loadingLabel` sebagai `sr-only`, spinner tetap ada tanpa `loadingLabel`.
- [ ] Implementasi §2.2.3 di `button.tsx` dan CSS.
- [ ] Ganti tombol `useFormStatus` sendiri dari inventaris Fase 0 ke `Button`/`SubmitButton`.
- [ ] Perbarui test yang mengharapkan teks tombol berganti; setiap perubahan assertion dicatat alasannya di receipt.
- [ ] Perbarui `button.stories.tsx` (pending, pending tanpa label, ditekan).
- [ ] Receipt `T30-phase3-buttons.md`, commit.

### Fase 4: Transisi dan copy

- [ ] Test gagal: `toast` menandai `leaving` 120 ms sebelum dihapus; `just-added-highlight.test.ts` (fungsi murni parse/cocokkan entry `{ id, at }`: ID cocok, entry kedaluwarsa 10 s diabaikan, JSON rusak diabaikan; sessionStorage dan DOM dibuktikan E2E); urutan `onCreated` (simpan key, toast tepat satu, `router.refresh()`) dibuktikan E2E acceptance 11.
- [ ] Implementasi CSS dialog/sheet/backdrop/toast (§2.2.8), `template.tsx` (§2.2.9), highlight (§2.2.10), accordion yang ada bila Fase 0 menemukannya.
- [ ] Copy §2.2.13: tulis final dengan `antislop-copywriting`, en dan id, tanpa em dash; test key ada di kedua locale.
- [ ] Bila ada token warna baru, tambahkan pasangan ke `theme-contrast.test.ts`.
- [ ] Receipt `T30-phase4-transitions-copy.md`, commit.

### Fase 5: E2E, aksesibilitas, regresi, Delivery Gate

- [ ] E2E baru atau diperbarui untuk acceptance 2, 3, 4, 6, 8, 10, 11, 12, 13. Route lambat untuk acceptance 8 memakai mekanisme yang sudah ada di suite (cek helper); jangan menambah endpoint produksi.
- [ ] E2E AI dengan fake provider untuk acceptance 9 (`pnpm test:e2e:ai-review`), export (`pnpm test:e2e:cv-export` bila renderer tersedia; bila tidak, catat dan buktikan lewat unit + Storybook).
- [ ] Tambah state pending, `ProgressStatus`, dan skeleton ke `release-a11y.spec.ts` (acceptance 14) di 360 px dan 1440 px, light dan dark.
- [ ] Ganti assertion reduced motion yang hanya mengukur `transitionDuration` bila perlu, tanpa melemahkan: tetap ≤ 0,01 ms, ditambah cek teks status terlihat.
- [ ] Regresi §7 lengkap. Tidak ada assertion lama yang dilemahkan selain yang mengharapkan label tombol berganti; setiap perubahan disertai alasan.
- [ ] Jalankan Delivery Gate antislop (core + checklist `antislop-ui`, `antislop-human`) dan tulis laporan PASS/FAIL dengan bukti di receipt, termasuk klik-tembus setiap tombol pending, dialog, sheet, toast, navigasi, dan `ProgressStatus` di 360 px dan 1440 px light/dark.
- [ ] Screenshot: tombol pending, skeleton, `SlowLoadingNotice`, `ProgressStatus` normal dan lambat, dialog terbuka, highlight item baru; light dan dark; plus versi reduced motion.
- [ ] Receipt `T30-phase5-e2e-regression.md`, commit. **Stop: gate review Claude.**

### Fase 6: Draft dokumen (setelah gate lulus)

- [ ] `docs/Design.md` dan `Design.md` §28: tambahkan token motion, aturan spinner + teks, dan pola `ProgressStatus`. Jaga kedua salinan identik.
- [ ] Perbarui [T30-motion-loading-design.md](T30-motion-loading-design.md) bila ada keputusan yang berubah saat eksekusi.
- [ ] Draft decision `00xx-t30-motion-loading.md` (alasan pulse vs shimmer, `template.tsx` vs View Transitions, `ProgressStatus` tanpa persentase, follow-up `error.tsx`).
- [ ] `docs/verification/T30-motion-loading.md` (ringkasan acceptance dan bukti) tanpa klaim DONE.
- [ ] Commit.

## 6. Fixture

- Akun test dan seed aktivitas lewat helper E2E yang ada (`tests/e2e/app-frame.spec.ts`, `tests/e2e/activity-ui.spec.ts`).
- AI memakai fake provider yang sudah dipakai `ai-review.spec.ts`; tidak ada key live.
- Sentinel privat di catatan Quick log; pastikan tidak muncul di console browser atau di sessionStorage selain ID aktivitas.

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
pnpm test:e2e:dashboard
pnpm test:e2e:ai-review
pnpm test:e2e:import
pnpm test:e2e:cv-export
pnpm test:e2e:m2
pnpm test:e2e:m5
pnpm build-storybook
```

`pnpm build` wajib di Fase 5 karena `template.tsx` baru. `pnpm lint` di checkout yang punya `.claude/worktrees/*/.next` bisa gagal karena file build di sana; jalankan dengan `--ignore-pattern ".claude/**"` dan catat.

## 8. Stop conditions

Berhenti dan laporkan bila:

- Path yang akan diubah T30 berisi perubahan pengguna yang belum di-commit.
- `useLinkStatus` tidak memberi `pending` di Next 16.3.5 (§2.2.7).
- Tombol `useFormStatus` sendiri hanya bisa dipindah ke `Button` dengan mengubah perilaku form atau server action.
- Test lama di luar ekspektasi label pending hanya lulus dengan melemahkan assertion.
- Perlu migration, dependency baru, flag eksperimental Next, atau perubahan server action.
- Animasi keluar dialog membuat Escape atau fokus kembali gagal di salah satu browser yang diuji.
- Kontras teks status atau highlight tidak bisa memenuhi AA dengan token yang ada tanpa mengubah palet Design.md.
- Scope bocor ke §2.3.

## 9. Gate review Claude

Read-only setelah Fase 5. P0–P2 memblokir, P3 follow-up.

- [ ] Receipt Fase 0–5 lengkap dengan angka aktual; ulang `lint`, `typecheck`, `test`, `test:e2e:ui`, `test:e2e:release` di worktree bersih.
- [ ] Tidak ada gradient baru dan tidak ada animasi berulang selain skeleton dan spinner yang hanya hidup selama loading.
- [ ] Reduced motion: semua indikator punya teks terlihat; spinner diganti ikon statis.
- [ ] Tombol pending: label tetap, lebar tetap, opacity tidak turun, tidak bisa submit ganda.
- [ ] `ProgressStatus` tidak membacakan waktu tiap detik dan tidak menampilkan angka progress.
- [ ] Dialog: Escape, tombol tutup, backdrop, dan fokus kembali tetap benar dengan animasi keluar.
- [ ] Sidebar, tab bar, dan header tidak ikut animasi halaman; filter URL tidak memicu animasi.
- [ ] Tepat satu toast setelah simpan dari Quick log.
- [ ] Copy en/id tanpa em dash. Delivery Gate antislop tercatat tanpa FAIL.

## 10. Review focus

1. **Spinner membeku di reduced motion.** Blok global menghentikan animasi di frame pertama sehingga pengguna reduced motion kembali melihat "crash". Dijaga acceptance 13 dan story reduced motion.
2. **Test lama bergantung pada teks pending.** Banyak E2E mungkin menunggu tombol berganti ke `loadingLabel`. Dijaga inventaris Fase 0 dan aturan di Fase 3: hanya assertion label pending yang boleh berubah, dengan alasan.
3. **Animasi keluar dialog merusak fokus.** `allow-discrete` menunda `display: none`; pemicu bisa kehilangan fokus kembali atau Escape tertahan. Dijaga acceptance 10 dan `release-keyboard`.
4. **`template.tsx` me-remount terlalu banyak.** Bila template diletakkan di level yang salah, chrome ikut di-remount dan state scroll T27 hilang. Dijaga acceptance 12 dan `mobile-tab-bar.spec.ts`.
5. **Interval `ProgressStatus` bocor.** Timer terus berjalan setelah unmount atau saat tab tersembunyi. Dijaga fungsi murni keputusan interval di unit dan E2E Fase 5 (pindah halaman saat job berjalan, lalu cek tidak ada error console).
6. **Toast ganda setelah Quick log.** Toast baru di `onCreated` bertumpuk dengan toast yang sudah ada di jalur lain. Dijaga inventaris Fase 0 dan acceptance 11.

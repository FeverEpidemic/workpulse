# Rencana Implementasi T04 Design System dan Application Frame

Tanggal perencanaan: 16 September 2026  
Status: selesai; T04 `DONE` per 16 September 2026. Hasil acceptance dan bukti aktual ada di
[`T04-design-system-app-frame.md`](T04-design-system-app-frame.md).  
Dependensi: T01, T02, dan T03 `DONE`.

## Hasil yang dituju

T04 menghasilkan fondasi antarmuka untuk seluruh workspace privat: token visual light/dark,
komponen aksesibel yang saat ini benar-benar dibutuhkan, application frame desktop dan mobile,
navigasi enam tujuan, Quick log global, string `en`/`id`, state bersama, dan kontrak filter berbasis
URL. Implementasi harus mempertahankan semua alur Auth/Profile T03 dan tidak mengambil scope
persistence atau fitur bisnis T05 ke atas.

Rujukan utama:

- `IMPLEMENTATION_PLAN.md` §1, §3, §4, dan acceptance T04.
- Wireframe UI §1 Application frame: sidebar desktop, header/menu mobile, enam tujuan, profile di
  bawah, Quick log sebagai aksi global, shared dialogs, dan Record unavailable.
- `Design.md` §16–38: token, tema, tipografi, spacing, radius, surfaces, iconography, states,
  forms, feedback, responsive, mobile, privacy, aksesibilitas, dan empty state.
- R01/F01/S12 untuk memastikan application frame tidak merusak auth, onboarding, profil,
  locale, session expiry, draft recovery, atau revision conflict yang sudah lulus pada T03.

## Keputusan scope

### Termasuk dalam T04

- Token CSS lengkap untuk muted sage, semantic colors, light/dark surfaces, type scale, spacing
  4 px, radius, shadow, focus ring, touch target, dan motion duration.
- Theme switch light/dark dengan preferensi tersimpan dan penerapan sebelum paint agar tidak ada
  flash tema yang salah. Default pertama mengikuti preferensi sistem.
- Satu keluarga ikon Lucide sesuai keputusan T01; paket Radix ditambahkan hanya untuk primitive
  yang konkret diperlukan, seperti Dialog/AlertDialog, Toast, dan Tooltip.
- Application frame untuk pengguna yang sudah onboarding: skip link, sidebar desktop, drawer
  mobile, top bar, area konten, profile/settings di bagian bawah, theme switch, sign out, dan
  Quick log.
- Navigasi utama yang tepat: Dashboard, Activity, Achievements, Projects, Timeline, dan CV.
- Route aman untuk keenam tujuan dan `/activity/new`. Tujuan yang belum diimplementasikan memakai
  state `Feature unavailable`/empty yang jujur, bukan data contoh atau aksi sukses palsu.
- Quick log satu aksi menuju `/activity/new` dan memindahkan fokus ke input catatan. Sampai T06/T07,
  tidak ada tombol save aktif dan tidak ada klaim bahwa data tersimpan.
- Shared UI yang dibutuhkan sekarang: button, icon button, field controls, card, badge, tooltip,
  dialog/drawer, toast, skeleton, empty state, inline error, unsaved dialog, named delete dialog,
  revision conflict, dan record unavailable.
- Kontrak filter melalui query string pada route Activity placeholder, termasuk back/forward dan
  reload. Komponen/utility yang sama menjadi dasar filter nyata T07 dan paket setelahnya.
- Perapihan Dashboard dan Profile S12 agar memakai frame/primitives baru tanpa mengubah kontrak
  server, ownership, revision, operation key, atau session draft T03.

### Tidak termasuk

- Migration database atau perubahan schema.
- Persistence Activity, dashboard counts nyata, CRUD Projects/Achievements, Timeline events, CV
  builder, AI, storage, import, atau export.
- Search global, command palette, evidence library terpisah, job readiness, target job, streak,
  proficiency, coaching, atau fitur lain yang dikeluarkan oleh keputusan scope §1.
- Data karier contoh pada aplikasi production.
- Perubahan desain terhadap halaman auth/onboarding di luar penyelarasan token dan primitive yang
  diperlukan untuk mencegah regresi visual atau aksesibilitas.

## Arsitektur yang direncanakan

### 1 Tema dan token

- Tambahkan `src/styles/tokens.css` sebagai sumber token semantic. `src/app/globals.css` tetap
  menjadi reset/global styles dan mengimpor token tersebut.
- Gunakan atribut `data-theme="light|dark"` pada `<html>`. Root layout membaca cookie preferensi;
  tanpa cookie, bootstrap script kecil memilih `prefers-color-scheme` sebelum paint.
- Theme toggle memperbarui atribut, cookie, dan `color-scheme`. Label aksesibel menyebut tema yang
  akan dipilih dan string tersedia dalam `en`/`id`.
- Semua warna komponen memakai token semantic. Semantic status selalu disertai text/icon/label;
  tidak ada gradient dan tidak ada status yang hanya mengandalkan warna.
- Pertahankan Plus Jakarta Sans dari `next/font`; tidak memuat font pihak ketiga kedua.

### 2 Route group dan application frame

- Pindahkan route workspace yang sudah selesai ke route group tanpa mengubah URL publik, misalnya
  `src/app/(workspace)/dashboard/page.tsx` dan route workspace lainnya.
- `src/app/(workspace)/layout.tsx` mengambil request context. Pengguna completed mendapatkan
  `ApplicationFrame`; pengguna provisional tetap menerima child onboarding tanpa sidebar sehingga
  alur name-only T03 tidak berubah. Page/action tetap melakukan pemeriksaan session sendiri.
- `ApplicationFrame` dibagi menjadi server wrapper untuk data profile/locale dan client navigation
  untuk pathname aktif, drawer, theme, toast, serta unsaved-navigation guard.
- Active navigation memakai `aria-current="page"`. Desktop memakai sidebar tetap/collapsible;
  compact width memakai drawer berlabel dengan Escape, focus trap, body scroll lock, dan focus
  return ke tombol menu.
- Main content memiliki skip target, landmark yang benar, lebar yang tidak memaksa horizontal
  scroll, dan padding 16 px pada 360 px serta spacing lebih lapang pada 1440 px.

### 3 Route sementara yang jujur

| URL | Perilaku T04 |
| --- | --- |
| `/dashboard` | Empty workspace yang sudah ada, dibungkus frame dan primitive baru. |
| `/activity` | Empty/unavailable list shell dan filter GET/query string yang dapat dipulihkan. |
| `/activity/new` | Input Quick log langsung fokus; save tidak tersedia sampai T06/T07. |
| `/achievements` | Empty/unavailable state tanpa count/data rekaan. |
| `/projects` | Empty/unavailable state tanpa CRUD palsu. |
| `/timeline` | Empty/unavailable state tanpa event rekaan. |
| `/cv` | Empty/unavailable state tanpa builder/export palsu. |
| `/settings/profile` | S12 T03 dipertahankan dan dibungkus frame hanya setelah onboarding selesai. |

Placeholder harus menggunakan bahasa produk, bukan menyebut nomor task internal. CTA hanya menuju
alur yang benar-benar tersedia, misalnya Profile/settings atau Quick log input yang belum dapat
disimpan.

### 4 Primitive dan state bersama

- `Button`/`IconButton`: variant primary, secondary, ghost, destructive; disabled/loading; minimum
  touch target 44×44 px untuk kontrol icon/mobile.
- `Dialog`/`Drawer`: title dan description wajib, Escape, overlay, initial focus, focus trap, dan
  focus return. Drawer mobile memakai primitive dialog yang sama.
- `Toast`: success/error dengan live region; status save penting tetap mempunyai status inline agar
  screen reader dan test T03 tidak bergantung pada toast yang temporer.
- `Skeleton`: mempertahankan bentuk layout pada `loading.tsx`, dengan motion dinonaktifkan saat
  `prefers-reduced-motion`.
- `EmptyState`: title, description, dan maksimal satu primary CTA.
- `InlineError`: `role="alert"`, optional field mapping, correlation ID bila tersedia, dan pesan
  aman yang sudah dilokalisasi.
- `UnsavedChangesDialog`: provider mencatat form yang dirty; guarded internal navigation membuka
  dialog, Cancel mengembalikan fokus ke link pemicu, Continue membuang state dirty untuk navigasi,
  dan `beforeunload` menangani keluar/reload browser. Draft sessionStorage T03 tidak dihapus.
- `NamedDeleteDialog`: menggantikan disclosure delete foundation dengan nama record dan dependency
  count yang sudah ada. Action/RPC tidak berubah.
- `RevisionConflict`: mengemas `ConflictControls` yang ada; Reload server dan Review/retry tetap
  mempertahankan allowlist, revision, dan draft behavior T03.
- `RecordUnavailable`: satu copy aman untuk missing/unauthorized records tanpa membedakan penyebab
  atau membocorkan keberadaan record akun lain.

## Paket kerja

### T04.1 Baseline dan dependency gate

1. Jalankan `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck -- --incremental false`,
   `pnpm test`, dan `pnpm build` sebelum perubahan.
2. Verifikasi paket resmi yang diperlukan terhadap Next 16/React 19, lalu exact-pin hanya
   `lucide-react`, primitive Radix yang benar-benar dipakai, dan `@axe-core/playwright` untuk audit
   E2E. Jangan menjalankan generator shadcn.
3. Catat pilihan dependency, persistence tema, dan batas placeholder pada
   `docs/decisions/0005-design-system-application-frame.md`.

Acceptance subtask: clean install tetap lulus; tidak ada floating version; lockfile tunggal; tidak
ada component library generik yang tidak dipakai.

### T04.2 Token, tema, dan fondasi styling

1. Tambahkan `src/styles/tokens.css`; sederhanakan token sementara di `globals.css`.
2. Implement bootstrap/persistence tema serta `ThemeToggle`.
3. Migrasikan class global lama (`app-card`, field, button) ke primitive/token tanpa mengubah label,
   name, id, atau semantics form yang dipakai test T03.
4. Tambahkan reduced-motion override dan aturan overflow dasar.

Acceptance subtask: light/dark dapat dipilih, bertahan setelah reload, default mengikuti sistem,
tidak ada flash tema yang terlihat pada production build, dan kombinasi penggunaan token yang
dites memenuhi contrast AA.

### T04.3 Primitive bersama

1. Buat folder `src/components/ui/` dengan primitive terkecil yang diperlukan oleh T04.
2. Adaptasikan `ActionFeedback`, `SubmitButton`, dan `ConflictControls` untuk memakai primitive
   tanpa mengubah action contract.
3. Integrasikan toast, unsaved guard, named delete, conflict, skeleton, empty, dan unavailable state
   pada Dashboard/Profile serta route sementara.

Acceptance subtask: state default/hover/pressed/focus/disabled/loading/error tersedia bila relevan;
dialog dan drawer lolos keyboard/focus; save, conflict, dan delete T03 masih berfungsi.

### T04.4 Application frame dan navigasi

1. Tambahkan route group/layout dan komponen shell di `src/components/layout/`.
2. Implement sidebar, top bar, mobile menu, active state, profile/settings bottom section, sign out,
   theme switch, dan Quick log.
3. Tambahkan enam route tujuan serta `/activity/new` tanpa fitur bisnis palsu.
4. Pindahkan Dashboard/Profile ke frame dengan perubahan minimum pada server data fetching.

Acceptance subtask: semua link menuju URL canonical; deep link dan session redirect tetap aman;
provisional onboarding tidak terbungkus workspace; Quick log satu click dan input aktif menerima
fokus.

### T04.5 Filter URL dan state navigasi

1. Buat utility typed untuk membaca/menulis query string yang hanya mengubah key filter allowlisted.
2. Gunakan GET/query navigation pada Activity placeholder untuk menunjukkan filter tersimpan dalam
   URL; omit default/empty values dan pertahankan query yang dikenal.
3. Unit test encoding, removal, unknown-key handling, back/forward, dan reload.

Acceptance subtask: filter tidak hanya berada di state React; URL yang disalin membuka state yang
sama dan tidak menerima return URL eksternal atau query tak dikenal sebagai state aplikasi.

### T04.6 Responsive dan accessibility hardening

1. Audit 360 px dan 1440 px dalam light/dark untuk Dashboard, Activity, Quick log, dan Profile.
2. Jalankan keyboard-only flow: skip link, sidebar/drawer, theme switch, Quick log, profile form,
   unsaved dialog, conflict, named delete, dan sign out.
3. Jalankan Axe pada halaman representatif; verifikasi focus visible, accessible names, landmarks,
   headings, error association, contrast, touch target, dan status non-color-only.
4. Emulasikan `prefers-reduced-motion: reduce` dan pastikan animation/transition non-esensial
   ditiadakan.

Acceptance subtask: tidak ada horizontal overflow; drawer dan dialog mengembalikan fokus; tidak ada
violation Axe serious/critical pada route representatif; temuan minor yang tidak dapat ditutup harus
dicatat dengan alasan dan owner, bukan diabaikan.

### T04.7 Regression dan dokumentasi

1. Tambahkan unit/component tests untuk theme, URL filters, dan state helper; tambahkan
   `tests/e2e/app-frame.spec.ts` serta config/script `test:e2e:ui`.
2. Jalankan ulang `test:e2e:auth` karena Profile, conflict, delete, toast, dan navigation berubah.
3. Jalankan quality gates penuh dan production build.
4. Tulis hasil aktual di `docs/verification/T04-design-system-app-frame.md`, perbarui README yang
   masih menyebut T03 partial, lalu perbarui `IMPLEMENTATION_STATUS.md`. Tandai T04 `DONE` hanya jika
   semua acceptance di bawah terbukti.

Acceptance subtask: checkpoint baru menyebut file, dependency/decision, commands dan hasil aktual,
checks yang tidak dijalankan beserta alasan, blocker, serta T05 sebagai next task. Jangan menandai
Gate M1 selesai karena T05 masih TODO.

## Perkiraan file

Daftar ini adalah batas kerja, bukan kewajiban membuat semua file bila implementasi lebih kecil.

### File baru yang mungkin diperlukan

- `src/styles/tokens.css`
- `src/components/layout/application-frame.tsx`
- `src/components/layout/workspace-navigation.tsx`
- `src/components/layout/mobile-navigation.tsx`
- `src/components/layout/quick-log-link.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/toast.tsx`
- `src/components/ui/tooltip.tsx`
- `src/components/ui/skeleton.tsx`
- `src/components/ui/empty-state.tsx`
- `src/components/ui/inline-error.tsx`
- `src/components/ui/unsaved-changes.tsx`
- `src/components/ui/named-delete-dialog.tsx`
- `src/components/ui/revision-conflict.tsx`
- `src/components/ui/record-unavailable.tsx`
- `src/domain/routes/url-filters.ts`
- `src/app/(workspace)/layout.tsx`
- `src/app/(workspace)/loading.tsx`
- route pages untuk enam tujuan dan `/activity/new`
- `tests/unit/theme-preference.test.ts`
- `tests/unit/url-filters.test.ts`
- `tests/e2e/app-frame.spec.ts`
- `playwright.ui.config.ts`
- `docs/decisions/0005-design-system-application-frame.md`
- `docs/verification/T04-design-system-app-frame.md`

### File yang diperkirakan berubah

- `package.json`, `pnpm-lock.yaml`
- `src/app/layout.tsx`, `src/app/globals.css`
- `src/app/dashboard/page.tsx` dan `src/app/settings/profile/page.tsx` saat dipindahkan ke route group
- `src/features/profile/profile-workspace.tsx`
- `src/features/profile/profile-editor.tsx`
- `src/features/profile/foundation-editors.tsx`
- `src/components/forms/action-feedback.tsx`
- `src/components/forms/conflict-controls.tsx`
- `src/components/forms/submit-button.tsx`
- `src/features/auth/sign-out-form.tsx`
- `src/i18n/messages.ts`
- `tests/e2e/auth-profile.spec.ts` hanya bila locator perlu disesuaikan tanpa mengurangi coverage
- `README.md`, `docs/IMPLEMENTATION_STATUS.md`

Tidak ada file di `supabase/migrations/`, schema, generated database types, atau worker yang
seharusnya berubah untuk T04.

## Matriks acceptance dan bukti

| Acceptance T04 | Bukti otomatis | Pemeriksaan tambahan |
| --- | --- | --- |
| Enam tujuan navigasi benar | Playwright memeriksa label, href, URL, dan `aria-current` | Review desktop sidebar dan mobile drawer |
| 360/1440 px tidak overflow | Assertion `scrollWidth <= clientWidth` pada empat tema/viewport | Screenshot implementasi dibandingkan arah visual mockup, bukan pixel-perfect |
| Keyboard dan focus return | Playwright Tab/Escape/activeElement untuk drawer/dialog/Quick log | Keyboard-only pass pada Profile |
| Reduced motion | Playwright `emulateMedia({ reducedMotion: "reduce" })` dan computed style | Pastikan tidak ada loop dekoratif |
| Theme switch | Toggle, reload, cookie/DOM assertion, light/dark screenshots | Pastikan tidak ada flash pada production start |
| Quick log satu aksi | Satu click, URL `/activity/new`, textarea menjadi `activeElement` | Save tidak aktif dan copy unavailable jelas |
| Shared states tersedia | Unit/component tests dan penggunaan nyata Dashboard/Profile/placeholders | Review copy en/id dan live regions |
| Named delete aman | T03 E2E delete memakai nama record/dependency count | Tidak mengubah RPC/ownership |
| Revision conflict tetap benar | Unit conflict tests dan T03 two-tab E2E | Draft lokal tidak hilang |
| Unsaved guard | E2E edit lalu navigasi/cancel/continue/reload | sessionStorage owner isolation tetap berlaku |
| Filter tersimpan di URL | Unit query utility dan Playwright reload/back/forward | Default tidak memenuhi URL dengan nilai kosong |
| WCAG 2.2 AA target | Axe serious/critical = 0 pada route representatif | Manual focus, labels, touch targets, contrast nyata |
| Auth/Profile tidak regresi | `pnpm test:e2e:auth` | Provisional onboarding tetap tanpa app shell |

## Perintah verifikasi yang harus dijalankan

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
pnpm build
pnpm test:e2e
pnpm test:e2e:auth
pnpm test:e2e:ui
```

`test:e2e:auth` dan `test:e2e:ui` memerlukan Supabase lokal, Mailpit, env development, dan Chromium
yang sama dengan bukti T03. Tidak perlu `db:reset`, `db:test`, `db:lint`, atau `db:types` bila T04
benar-benar tidak mengubah database; keputusan tidak menjalankannya harus dicatat sebagai
scope-based, bukan diklaim lulus.

## Risiko dan mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Route group mengubah lifecycle T03 | Pertahankan URL, redirect, dan action; test provisional/completed/expired session sebelum closeout. |
| Hydration mismatch atau theme flash | Resolve tema sebelum paint, pakai satu sumber atribut, dan uji production build + reload. |
| Drawer/dialog kehilangan fokus | Gunakan primitive aksesibel, test Escape/Tab/focus return, dan sediakan title/description. |
| Unsaved guard menghapus draft atau memblokir save | Pisahkan dirty-navigation state dari sessionStorage; success reset guard, bukan owner draft lintas form. |
| Toast membuat status tidak terbaca | Pertahankan inline/live status; toast hanya feedback tambahan. |
| Placeholder terlihat seperti fitur selesai | Tidak ada fake data, fake success, atau tombol save aktif; copy menyatakan ketidaktersediaan. |
| Styling baru mematahkan locator T03 | Pertahankan accessible name, field id/name, heading penting, dan semantics; ubah test hanya bila UI contract memang berubah. |
| Terlalu banyak primitive spekulatif | Implementasikan hanya daftar yang dipakai T04; inventory lain menunggu feature pemakai. |

## Definition of Done

T04 dapat ditandai `DONE` hanya jika:

1. Dependency T03 tetap lulus tanpa pengurangan coverage.
2. Semua route workspace dilindungi session dan memakai frame hanya untuk profile completed.
3. Navigasi enam tujuan, Profile/settings, theme switch, sign out, dan Quick log bekerja pada desktop
   dan mobile.
4. Quick log mencapai input terfokus dalam satu aksi tanpa mengklaim persistence.
5. Token light/dark, string `en`/`id`, shared states, dan URL filter contract digunakan oleh UI
   nyata, bukan hanya file mati.
6. 360/1440 px light/dark tidak overflow; keyboard, focus return, reduced motion, contrast, dan
   Axe checks memiliki bukti aktual.
7. `lint`, `typecheck`, `test`, `build`, smoke E2E, Auth/Profile E2E, dan UI E2E lulus.
8. Verification record dan implementation status diperbarui; T05 dicatat sebagai langkah berikutnya
   dan Gate M1 tetap terbuka sampai T05 selesai.

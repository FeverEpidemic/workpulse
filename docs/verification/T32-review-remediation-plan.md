# T32 gate review dan rencana remediasi

- Tanggal: 31 Oktober 2026
- Reviewer: Claude (Opus 5.5). Read-only atas kode, ditambah run ulang independen.
- Catatan: reviewer adalah sesi yang sama dengan pelaksana Fase 0-5. Karena itu review ini memeriksa ulang setiap klaim receipt dari kode dan dari run baru, bukan dari ingatan.
- Branch `claude/t32-landing`, HEAD `4b747fb`, base handoff `19caca7`. Checkout utama `D:\Project\WorkPulse`, bukan worktree bersih terpisah. Working tree bersih kecuali `.claude/launch.json` dan `.claude/setting.local.json` (lokal, tidak di-commit).

## Verdict

**Review pertama: belum lulus** (satu P2, RV1). **Setelah remediasi: lulus.** Lihat "Review ulang RV1" di bawah.

## Yang diperiksa

- Plan §1 (19 acceptance), §8 (stop conditions), §9 (checklist gate), §10 (review focus).
- Receipt `T32-phase0-baseline.md` sampai `T32-phase5-e2e-regression.md`.
- Diff `19caca7..HEAD`: 61 file, +6.556 / -58. Semua perubahan ke file app lama dibaca baris per baris: `src/app/page.tsx`, `src/app/sign-in/page.tsx`, `src/features/auth/sign-in-client.tsx`, `src/features/activity/activity-list.tsx`, `src/server/auth/context.ts`, `src/i18n/messages.ts`, `src/styles/tokens.css`. File baru di `src/features/marketing`, `src/features/legal`, dan `src/app/{privacy,terms}` juga dibaca.
- Paritas copy: skrip sekali jalan, tidak di-commit, membandingkan setiap baris key di `docs/marketing/landing-copy-v1.md` dengan `t()` di kedua locale. **62 baris, 0 selisih.**
- Tidak ada CSP di `next.config` atau `src/proxy.ts` yang bisa memblokir skrip inline hero. Skrip itu konstanta statis tanpa input pengguna.

## Checklist §9

| Butir | Hasil |
| --- | --- |
| Receipt Fase 0-5 lengkap dengan angka; ulang checks | PASS dengan catatan: checks diulang di checkout utama, bukan worktree terpisah (lihat Commands). |
| Copy di `messages.ts` sama dengan copy deck; tanpa kata terlarang | PASS: 62/62. Scan unit dan E2E. |
| Pengguna login tidak melihat landing; tamu tidak di-redirect | PASS: E2E dua akun dan unit `root-destination`. Catatan F1. |
| Prioritas locale profil > cookie > header; header rusak aman | PASS: unit dan E2E. Catatan F2. |
| Potongan UI tanpa kontrol aksi, berlabel contoh, data fiktif | PASS |
| Konten terlihat tanpa JS dan dengan reduced motion; tanpa kedip | PASS: E2E `landing-motion`. |
| Cerita hero, replay, screen reader, tab, titik, tanpa loop, logo diam | PASS: E2E. Catatan F4c. |
| Legal: semua bagian, label draf, noindex, guard diuji | PASS |
| Tanpa gradient, foto, serif, aksen baru; kontras warm | PASS |
| Delivery Gate tanpa FAIL | **FAIL**: R-26 dan C-2 tidak berlaku untuk akun login di halaman legal. Lihat RV1. |

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV1 | P2 | Toggle bahasa di `/privacy` dan `/terms` tidak berfungsi untuk akun yang sudah onboarding | **Selesai** (`T32-review-remediation.md`, review ulang di bawah) |
| F1 | P3 | Akun yang sedang dihapus melihat landing di `/`, bukan pemberitahuan penghapusan | Follow-up |
| F2 | P3 | `Accept-Language` juga menentukan bahasa akun provisional (onboarding), bukan hanya tamu | Catat di decision Fase 6 |
| F3 | P3 | Tombol putar ulang baru muncul setelah hydration, jadi hero bergeser sedikit (layout shift) | Follow-up |
| F4 | P3 | Tiga test flaky, masing-masing gagal sekali (a, b, c di bawah) | Follow-up. c diperbaiki di RV2 (selesai). |
| F8 | P3 | Axe hanya menguji header tamu di halaman legal; varian header akun login (RV1) tidak masuk matriks axe | Follow-up |
| F5 | P3 | Plan §2.2.8 menyebut blok reduced motion global yang tidak ada | Perbaiki teks di Fase 6 |
| F6 | P3 | Dua teks data contoh tidak ada di copy deck: bullet CV kedua (dari mockup) dan format meta Activity di hero (dirender komponen app) | Catat di copy deck Fase 6 |
| F7 | P3 | Scroll cepat bolak-balik di Fase 5 tidak dicek visual (panel browser tersembunyi), hanya lewat E2E | Catatan |

### RV1 (P2): toggle bahasa mati di halaman legal untuk akun login

- **Gejala.** Akun yang sudah onboarding membuka `/privacy` atau `/terms` dan mendapat header landing: toggle ID/EN, "Masuk", dan "Daftar". Klik toggle hanya menyimpan cookie `wp-locale`. `getRequestLocale` memakai locale profil lebih dulu (`src/server/auth/context.ts`, `resolveLocale(profileLocale, cookieLocale, …)`), jadi bahasa halaman tidak berubah dan `aria-pressed` tetap. Ini kontrol yang tidak melakukan apa-apa (R-26, C-2). Receipt Fase 5 menulis R-26 PASS, dan klaim itu salah untuk keadaan ini. "Masuk" dan "Daftar" untuk akun yang sudah masuk juga menyesatkan, meskipun `/sign-in` mengalihkan mereka ke dashboard.
- **Penyebab.** `src/features/legal/legal-page.tsx:55` selalu merender `LandingHeader`. Route `src/app/privacy/page.tsx` dan `src/app/terms/page.tsx` tidak membaca sesi.
- **Kenapa P2.** Acceptance 16 (halaman 200 untuk tamu dan login) tetap terpenuhi, tapi klaim Delivery Gate yang wajib bersih ternyata tidak benar untuk keadaan yang bisa dicapai.

### F4: flaky

- a. `landing.spec.ts:302` (layout): sekali "small targets halo@myworkpulse.my.id" di 360 (Fase 5). Di run gate ini lulus. Pesan gagalnya sudah memuat ukuran dan kelas.
- b. `motion-loading.spec.ts:61` (T30, test lama): sekali di Fase 5. Lulus di run gate ini dan 3/3 saat dijalankan sendiri.
- c. `landing-motion.spec.ts:39` (cerita hero): gagal di run gate ini. Log fase berisi `idle` lalu langsung `done` (946 ms), dan satu-satunya event yang bisa begitu adalah `finish` dari `visibilitychange` saat `document.hidden`. Halaman test pertama di run itu sempat dianggap tersembunyi oleh Chromium, dan cerita berhenti sesuai desain (§2.2.8). Test-nya tidak hermetik, kodenya bekerja seperti seharusnya. Lulus di run release Fase 5 dan di run lain.

## Commands (run ulang independen, 31 Oktober 2026)

| Command | Exit | Hasil |
| --- | --- | --- |
| `git diff --check 19caca7..HEAD` | 0 | |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | 163 file / 1558 test |
| `pnpm build` | 0 | |
| `pnpm test:e2e:release`, `test:e2e:auth`, `test:e2e:m2` (percobaan 1) | 1 | Docker mati (0 container), env tanpa `SERVICE_ROLE_KEY`. Bukan hasil kode. |
| Docker Desktop dinyalakan, Supabase hidup, clamav/gotenberg/pdf di-`docker start` | 0 | |
| `pnpm test:e2e:release` | 1 | **78 lulus, 1 gagal (F4c), 1 skip** (rekaman video) |
| `pnpm test:e2e:auth` | 0 | 1 lulus |
| `pnpm test:e2e:m2` | 0 | 1 lulus |

`test:e2e:ui` tidak diulang di gate ini. Hasil Fase 5: lulus. Screenshot T25, T30, dan T31 yang ditulis ulang run release dikembalikan dengan `git restore`. Pengujian ini lokal di production build, bukan staging atau production.

## Remediasi

### RV1: header halaman legal mengikuti sesi

1. **Test gagal dulu.**
   - `tests/unit/legal-markup.test.tsx`: `LegalPage` dengan `signedIn` merender link "Open dashboard"/"Buka dashboard" ke `/dashboard`, tanpa tombol `name="locale"`, tanpa link `/sign-in` atau `/sign-in?mode=create-account`. Tanpa `signedIn` (tamu) markup tetap seperti sekarang.
   - `tests/e2e/landing.spec.ts`, test legal bagian akun login: tidak ada tombol "English"/"Bahasa Indonesia", ada link ke `/dashboard`.
2. **Perbaikan minimal.**
   - `src/app/privacy/page.tsx` dan `src/app/terms/page.tsx` membaca `getRequestContext()` dan meneruskan `signedIn = Boolean(context.user && context.profile?.onboarding_completed_at)` ke `LegalPage`.
   - `LegalPage` meneruskannya ke `LandingHeader`. Untuk akun login, header berisi logo dan satu link ke `/dashboard` dengan key `import.openDashboard` yang sudah ada ("Open dashboard"/"Buka dashboard"), tanpa copy baru.
   - Akun provisional tetap mendapat header tamu, karena untuk mereka cookie masih menentukan bahasa dan toggle berfungsi.
3. **Receipt.** Koreksi baris R-26 di `T32-phase5-e2e-regression.md` dan catat RV1.

### RV2 (opsional, test saja): hermetisitas test cerita hero (F4c)

Sebelum `goto`, panggil `page.bringToFront()`. Setelah load, pastikan `document.visibilityState === "visible"`. Kalau log fase hanya `idle, done`, pesan gagalnya menyebut visibilitas, supaya bisa dibedakan dari bug tempo.

### Checks yang harus diulang setelah remediasi

`pnpm lint --ignore-pattern ".claude/**"`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e:release` (restore screenshot T25/T30/T31 setelahnya), `pnpm test:e2e:auth`, `git diff --check`. Lalu review ulang RV1 oleh Claude.

## Review ulang RV1 (31 Oktober 2026)

- **Diff dibaca:** `landing-header.tsx`, `legal-page.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`. Penyebab di `legal-page.tsx:55` sudah ditangani. Header akun onboarding tidak lagi punya toggle atau link Masuk/Daftar, dan punya satu link ke `/dashboard` dengan key yang sudah ada.
- **Kasus yang dicek:**
  - Akun onboarding: header dashboard.
  - Akun provisional: header tamu, dan toggle berfungsi karena cookie yang menentukan bahasa.
  - Sesi tanpa profil: header tamu, cookie yang menentukan bahasa.
  - Akun yang sedang dihapus (`user` null): header tamu.
  - Tamu: header tidak berubah. Test markup tamu tetap lulus.
- **Bukti:** unit 3 test baru (merah 2 sebelum perbaikan). E2E akun login di halaman legal. Run ulang lengkap di `T32-review-remediation.md`: lint, typecheck, unit 163/1562, build, release 79 lulus 0 gagal, auth 1 lulus. `git diff --check` bersih.
- **Sisa:** F8 (axe untuk header akun login), P3.

**Verdict setelah remediasi: tidak ada P0-P2 terbuka. T32 lulus gate review** dan boleh lanjut ke Fase 6 (dokumen) dan closeout. Status DONE baru ditandai di closeout, bukan di dokumen ini.

## Yang dibutuhkan dari pengguna

- Persetujuan menjalankan RV1, dan RV2 bila diinginkan.
- Docker Desktop mati dua kali selama T32. Sebelum run E2E berikutnya, pastikan Docker tetap menyala.

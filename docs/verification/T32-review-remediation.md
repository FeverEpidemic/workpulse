# T32 remediasi gate review (RV1, RV2)

- Tanggal: 31 Oktober 2026
- Pelaksana: Claude (Opus 5.5), branch `claude/t32-landing`, checkout utama `D:\Project\WorkPulse`. Base `e40d2e2` (dokumen gate review).
- Acuan: `T32-review-remediation-plan.md`. Pengguna memilih RV1 dan RV2.
- antislop: mode during (session override).

## RV1 (P2): header halaman legal mengikuti sesi

### File berubah

- `src/features/marketing/landing-header.tsx`: prop `signedIn`. Untuk akun login, header berisi logo dan satu link `button-secondary` ke `/dashboard` dengan key `import.openDashboard` yang sudah ada ("Open dashboard"/"Buka dashboard"). Tanpa toggle bahasa dan tanpa link Masuk/Daftar. Landing di `/` tidak memakai prop ini, karena akun login tidak pernah melihat landing.
- `src/features/legal/legal-page.tsx`: prop `signedIn`, dan fungsi `legalPageSignedIn(context)` yang hanya `true` untuk akun dengan `onboarding_completed_at`.
- `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`: membaca `getRequestContext()` dan meneruskan `legalPageSignedIn(context)`.
- `tests/unit/legal-markup.test.tsx`: tiga test baru. Header akun login di en dan id; `legalPageSignedIn` untuk onboarding selesai, provisional, tanpa profil, dan tamu; header tamu tidak berubah.
- `tests/e2e/landing.spec.ts`: test legal untuk akun login sekarang memastikan tidak ada tombol `name="locale"`, tidak ada link `/sign-in…` di banner, dan link "Buka dashboard" membawa ke `/dashboard`.

### Keputusan

Akun provisional tetap mendapat header tamu. `getRequestLocale` hanya memakai locale profil setelah onboarding selesai, jadi untuk akun provisional cookie masih menentukan bahasa dan toggle-nya berfungsi.

### TDD

Test unit RV1 dijalankan sebelum perbaikan: 2 gagal (header akun login, en dan id), 12 lulus. Setelah perbaikan: 28 lulus (`legal-markup` dan `landing-markup`). Assertion E2E RV1 ditulis sebelum perbaikan tapi tidak dijalankan merah dulu; ia lulus di run release setelah perbaikan.

## RV2 (P3, test saja): hermetisitas test cerita hero

`tests/e2e/landing-motion.spec.ts`: `page.bringToFront()` sebelum `goto`, cek `document.visibilityState === "visible"` setelah load, dan pesan gagal khusus kalau log fase hanya `idle,done` ("story finished early: the page was hidden while it ran"). Kode cerita hero tidak diubah.

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `git diff --check` (working tree) | 0 | |
| `git diff --check 19caca7..HEAD` | 0 | |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | **163 file / 1562 test** (gate: 1558, +4) |
| `pnpm build` | 0 | |
| `pnpm test:e2e:release` | 0 | **79 lulus, 1 skip** (rekaman video), 0 gagal |
| `pnpm test:e2e:auth` | 0 | 1 lulus |

Screenshot T25, T30, dan T31 yang ditulis ulang run release dikembalikan dengan `git restore`.

## Koreksi receipt

`T32-phase5-e2e-regression.md`, baris R-26 dan C-2: untuk akun login di halaman legal, klaim PASS tidak benar sampai RV1 ini. Baris itu sekarang merujuk ke receipt ini.

## Berikutnya

Review ulang RV1 oleh Claude, lalu Fase 6.

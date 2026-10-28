# T32 Fase 2: route, locale, mode sign-in

- Tanggal: 29 Oktober 2026
- Pelaksana: Claude (Opus 5.5), branch `claude/t32-landing`, checkout utama `D:\Project\WorkPulse`.
- antislop: mode during (session override).

## Tujuan

Tamu mendapat halaman di `/` (sementara placeholder h1), pengguna login tetap diarahkan seperti sebelumnya, locale kunjungan pertama membaca `Accept-Language`, dan `/sign-in?mode=create-account` langsung membuka form buat akun dengan catatan legal di bawahnya.

## File berubah

- `src/domain/routes/root-destination.ts` (baru): `rootDestination(context)`, §2.2.1.
- `src/i18n/accept-language.ts` (baru): `localeFromAcceptLanguage(header)`, §2.2.2.
- `src/i18n/messages.ts`: `resolveLocale` menerima parameter ketiga; cookie hanya dipakai bila `en`/`id`. Kunci baru `landing.hero.title`, `legal.privacy.title`, `legal.terms.title`, `legal.signUpNote` (teks dari copy deck yang disetujui).
- `src/server/auth/context.ts`: `getRequestLocale` membaca header `accept-language`.
- `src/domain/auth/route-state.ts`: `SignInMode` dan `signInModeFromQuery`.
- `src/app/sign-in/page.tsx`, `src/features/auth/sign-in-client.tsx`: prop `initialMode`, dan `SignUpLegalNote` di bawah tombol buat akun (link `/terms` dan `/privacy`, tanpa checkbox).
- `src/app/page.tsx`: memakai `rootDestination`; tamu mendapat `<main>` dengan h1 `landing.hero.title`. Fase 3 menggantinya dengan landing.
- `tests/unit/root-destination.test.ts`, `tests/unit/accept-language.test.ts`, `tests/unit/sign-in-mode.test.tsx` (baru).
- `tests/e2e/smoke.spec.ts`: lihat bagian Test lama.

## TDD

Ketiga file test baru dijalankan sebelum implementasi: 3 file gagal (modul belum ada, `initialMode` diabaikan). Setelah implementasi: 41 test lulus.

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | Tanpa warning |
| `pnpm typecheck` | 0 | Percobaan pertama exit 2 (`rawTag` mungkin `undefined`), diperbaiki |
| `pnpm test` | 0 | **157 file / 1489 test** lulus (baseline 154 / 1448, +3 file / +41 test) |
| `pnpm test:e2e:auth` | 0 | 1 lulus |
| `pnpm exec playwright test --config playwright.config.ts` (`test:e2e`) | 0 | 2 lulus (smoke) |

## Acceptance terbukti (sebagian)

- 2 (unit): tamu ke landing, onboarding selesai ke `/dashboard`, provisional ke `/onboarding/import`, tanpa profil ke `/sign-in?notice=serviceUnavailable`. E2E dua akun di Fase 5.
- 3 (unit): `id-ID,id;q=0.9`, `id`, `in-ID` jadi `id`; `en-US`, `ms-MY`, kosong, `null` jadi `en`; q-value tertinggi menang, seri memakai urutan; `q=0` diabaikan; wildcard bukan `id`; header rusak dan header 5000 karakter tidak melempar. Prioritas profil, lalu cookie valid, lalu header. E2E `extraHTTPHeaders` di Fase 5.
- 5 (unit): `mode=create-account` membuka `sign-up-form` dengan heading "Create account"; nilai lain, termasuk array dan huruf besar, tetap sign-in. Catatan legal muncul di form buat akun dalam en dan id, tidak di form masuk. E2E di Fase 5.

## Test lama

`tests/e2e/smoke.spec.ts:3` dulu mengharapkan tamu di `/` dialihkan ke `/sign-in`. Sesuai inventaris Fase 0, test ini sekarang mengharapkan URL tetap `/` dengan h1 landing. Diubah di fase ini, bukan Fase 5, supaya `test:e2e` tidak merah di antara fase. Assertion `title` "WorkPulse" belum diubah; Fase 3 menyesuaikannya bersama `generateMetadata`.

## Warning

- Log WebServer `test:e2e:auth` memuat beberapa "Error: The destination stream closed early". Test tetap lulus. Belum dibandingkan dengan log baseline.
- `Accept-Language` sekarang juga berlaku di `/sign-in` dan halaman tamu lain (§2.2.2, sengaja). Playwright memakai locale `en-US`, jadi test lama tidak berubah.

## Blocker

Tidak ada.

## Berikutnya

Fase 3: landing UI.

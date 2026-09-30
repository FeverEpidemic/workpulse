# T17 Fase 4 — Entry point S02, S04, S12 (30 September 2026)

Tujuan: menghubungkan S02, dashboard kosong (S04) dan S12 ke S03, dan membuka S02 untuk pengguna lama (keputusan §2.2.3).

## File berubah

- `src/features/import/import-start.tsx`: `review_ready` → link *Review candidates* (`/imports/<id>/review`, `button-primary`); `committed` → copy *Import saved* + *Open dashboard* (bukan copy cancelled); prop `onboarded` (manual → `/settings/profile` untuk pengguna lama).
- `src/app/onboarding/import/page.tsx`: redirect pengguna onboarded ke `/dashboard` dihapus; judul `import.titleReturning` dan link *Back to dashboard* untuk pengguna lama; tetap butuh session dan profil.
- `src/features/dashboard/dashboard-view.tsx`: tombol nonaktif diganti link aktif ke `/onboarding/import`.
- `src/features/profile/profile-workspace.tsx`: kartu *Import from a CV* → `/onboarding/import`.
- `src/i18n/messages.ts`: `import.readyBody` (tanpa klaim "belum tersedia"), dihapus 10 baris kunci tak terpakai (`dashboard.importUnavailable`, `onboarding.importUnavailable`, `onboarding.importUnavailableLabel`, `import.review.notFoundTitle/Body`, en+id).

## Perubahan assertion test lama (§1.16), dengan alasan

| Test | Perubahan | Alasan |
| --- | --- | --- |
| `tests/unit/import-start-ui.test.tsx` (ready) | "tanpa `/imports/`" → link *Review candidates* wajib | S03 kini ada |
| `tests/e2e/import-onboarding.spec.ts:155` | `a[href*="/imports/"]` count 0 → link *Review candidates* ke `/imports/<uuid>/review` | idem |
| `tests/e2e/dashboard-timeline.spec.ts:349-350` | tombol *Import CV* disabled + teks "belum tersedia" → link aktif ke `/onboarding/import` | Import CV kini aktif |
| **`tests/e2e/m2-manual-journey.spec.ts:181`** (tidak tercantum di §1.16) | tombol *Import CV* disabled → link aktif ke `/onboarding/import` | asersi identik dengan dashboard-timeline pada dashboard kosong; tidak ada pelemahan, hanya mengikuti kontrak baru. **Penyimpangan dari daftar §1.16 — mohon reviewer memeriksa.** |

Tidak ada test yang mengasersi redirect pengguna onboarded dari `/onboarding/import` (grep `tests/`).

## Test baru

- `tests/unit/import-start-ui.test.tsx`: committed (copy + dashboard primary, tanpa Start manually), pengguna lama (manual → `/settings/profile`).
- `tests/unit/import-entry-points.test.tsx` (2): dashboard kosong en/id dan kartu S12 en/id.

## Commands (hasil aktual)

- `pnpm typecheck`, `pnpm lint` exit 0.
- `pnpm test`: 76 file / 495 test PASS.

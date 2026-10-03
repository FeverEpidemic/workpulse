# T20 Fase 3 — Service, action, dashboard backend (receipt)

- Tanggal: 2 Oktober 2026
- Tujuan: batas service/action CV untuk freshness dan data check dashboard (tanpa UI), TDD.

## File berubah

- `src/features/cv/cv-errors.ts` (`SOURCE_CHANGED` → `cv.error.sourceChanged`, `RESOLUTION_INVALID` → `cv.error.resolutionInvalid`; `CV_SOURCE_CHANGED`/`CV_RESOLUTION_INVALID` dipetakan).
- `src/features/cv/cv-service.ts` (`getFreshness()`, `resolveFreshness(input)` + receipt `{ cvRevision, addedParentItemIds }`).
- `src/features/cv/actions.ts` (`resolveCvFreshnessAction`; `run()` menerima daftar path tambahan; `RESOLUTION_INVALID` → `VALIDATION`, `SOURCE_CHANGED` → `CONFLICT` lewat default).
- `src/domain/dashboard/{contracts,links}.ts`, `src/features/dashboard/dashboard-service.ts` (`cvReview: { hasCv, reviewCount, availableCount }`, RPC `get_cv_review_summary` paralel; gagal/malformed → `UNAVAILABLE`, nol baris → `UNAUTHENTICATED` seperti summary utama; `get_dashboard_summary` tidak diubah). Tautan `dashboardLinks.cvReview()` = `/cv#cv-review`, `cvAvailable()` = `/cv#cv-pool-achievements`.
- `src/i18n/messages.ts`: kunci en **dan** id untuk error, badge, ringkasan/panel review, aksi, aria, notice, announce, dan empat check dashboard (bentuk One/Other). Paritas dipaksa tipe (`id` harus memuat setiap `MessageKey`).
- Test: `tests/unit/{cv-service,cv-actions,dashboard-service}.test.ts` diperluas (fixture `makeService` dashboard mendapat respons default `get_cv_review_summary`).

## Temuan Fase 0 yang dikoreksi

Plan menyebut `revalidatePath('/')` untuk dashboard; route dashboard sebenarnya `/dashboard` (`src/app/(workspace)/dashboard/page.tsx`). Action me-revalidate `/cv` dan `/dashboard` hanya setelah sukses.

## Commands dan hasil aktual

| Command | Hasil |
| --- | --- |
| `vitest` tiga file sebelum implementasi | gagal: 18 test baru (fungsi/field belum ada) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | exit 0 — **88 file / 680 test** |

## Blocker / langkah berikutnya

Tidak ada. Fase 4 — UI S13 (badge, ringkasan, panel review) dan check dashboard S04.
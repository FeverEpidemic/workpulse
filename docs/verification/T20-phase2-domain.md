# T20 Fase 2 — Domain murni (receipt)

- Tanggal: 2 Oktober 2026
- Tujuan: kontrak Zod dan aturan murni freshness (§3.2), dikerjakan TDD.

## File berubah

- Diubah: `src/domain/cv/contracts.ts` (`CV_ERROR_CODES` + `CV_SOURCE_CHANGED`, `CV_RESOLUTION_INVALID`; `CV_FRESHNESS_STATES`, `CV_RESOLUTION_ACTIONS`, `cvProfileLiveSchema`, `cvFreshnessRowSchema`, `cvReviewSummarySchema`, `resolveCvFreshnessInput`), `tests/unit/cv-contracts.test.ts` (daftar kode error kini lima belas; blok kontrak T20), `tests/integration/cv-selection.test.ts` (perbaikan narrowing tipe pada penyesuaian Fase 1).
- Baru: `src/domain/cv/freshness.ts` (`indexFreshness`, `needsReview`, `reviewCount`, `availableActions`, `primaryAction`, `bulkRefreshResolutions`, `diffDisplayFields`, `diffProfileFields`), `tests/unit/cv-freshness.test.ts`.

## Keputusan kecil

- `availableActions` mengembalikan `ReviewChoice { id, action, primary }`: item/profil changed tanpa wording → `refresh` (primary) + `keep_saved` (action `keep`); changed dengan wording → `keep_mine` (action `refresh`, primary) + `replace`; kept → `refresh` opsional; selain itu kosong. Replace tidak pernah primary.
- `diffDisplayFields` memakai `buildCvPreviewEntry` T19 sehingga tanggal mengikuti locale CV dan konten tidak diterjemahkan; `contextChanged` menandai perubahan tautan parent yang tidak terlihat (relink achievement).
- `bulkRefreshResolutions` hanya `changed` tanpa override, membawa `live_revision`, tidak menyertakan profil, maksimal 200.

## Commands dan hasil aktual

| Command | Hasil |
| --- | --- |
| `vitest` `cv-contracts` + `cv-freshness` sebelum implementasi | gagal (modul/ekspor belum ada; 9 test kontrak gagal) |
| `vitest` dua file itu sesudah | exit 0 — 54/54 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | exit 0 — **88 file / 662 test** (sebelumnya 87 / 635) |

## Blocker / langkah berikutnya

Tidak ada blocker. Fase 3 — service, action, dashboard backend, i18n.
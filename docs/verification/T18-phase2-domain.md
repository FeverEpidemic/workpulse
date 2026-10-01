# T18 Fase 2 — Domain murni

- Tanggal: 30 September 2026
- Eksekutor: Claude Sonnet 5.5

## Tujuan

Kontrak, aturan parent, dan outline CV sebagai domain TypeScript murni (tanpa I/O) untuk dipakai service T18, preview T19, dan snapshot T21.

## File berubah

- `src/domain/cv/contracts.ts` — `CV_SECTION_KEYS`, `CV_SOURCE_TYPES`, `SECTION_FOR_SOURCE_TYPE`, `CV_ERROR_CODES`, `cvSourceSnapshotSchema` (discriminated union `.strict()`), skema baris dokumen/item, input RPC, `parseChildItemsDetail`.
- `src/domain/cv/selection.ts` — `requiredParent`, `isValidSectionOrder`, `isValidReorder`.
- `src/domain/cv/outline.ts` — `buildCvOutline` (achievement di bawah project terpilih, lalu experience, lalu section `achievements`; sekali render; item terhapus diberi flag).
- `tests/unit/cv-contracts.test.ts`, `cv-selection.test.ts`, `cv-outline.test.ts`.

## Command dan hasil aktual

| Command | Hasil |
| --- | --- |
| `pnpm test` | exit 0; 79 file / 541 test lulus (76/501 baseline + 3 file / 40 test baru) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |

## Catatan proses

- Implementasi ditulis bersamaan dengan test (bukan red-first per file); run pertama menemukan dua kesalahan pada **test** (rotasi `section_order` yang ternyata permutasi valid, dan indeks array di bawah `noUncheckedIndexedAccess`). Test diperbaiki; tidak ada assertion dilemahkan dan kode domain tidak berubah.
- `buildCvOutline` mengidentifikasi parent lewat `source_snapshot.source_id` sehingga parent yang sumbernya sudah terhapus (kolom sumber NULL) tetap menampung child.

## Acceptance yang dibuktikan

§1.6 (sisi domain: section order), §1.10 (validasi reorder/layout), §1.4 (aturan parent murni), §1.12 (snapshot `.strict()` menolak `raw_text`, `source_excerpt`, `contribution`, `scope`, `metrics`, `activity_id`, `origin`), serta render tanpa ganda (§2.2.6).

## Warning / blocker

Tidak ada.

## Langkah berikutnya

Fase 3: `cv-service.ts`, `cv-errors.ts`, `actions.ts`, kunci pesan error en/id, dan unit test service/action.

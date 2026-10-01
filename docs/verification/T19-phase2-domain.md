# T19 Fase 2 — Domain murni (30 September 2026)

- Tujuan: domain CV builder tanpa I/O: `labels`, `resolve`, `preview`, `draft`, dan perluasan `contracts`.
- File: `src/domain/cv/{labels,resolve,preview,draft}.ts` (baru), `src/domain/cv/contracts.ts` (`CV_OVERRIDE_UNSUPPORTED`, `cvProfileSnapshotSchema` strict dengan `display_overrides`, `saveCvEditsInput`, batas panjang, `isValidProfileOverride`), tes baru `cv-labels`, `cv-resolve`, `cv-preview`, `cv-draft`, fixture `cv-fixtures.ts`, tes `cv-contracts` diperluas.
- Draft = peta datar (`title`, `summary`, `profile.<key>`, `item.<id>`); kosong = tanpa override. `reconcileDraft` mengembalikan `unchanged`/`mine`/`conflict` per field. `computeItemMove` menukar item dengan saudara sebaris (achievement anak hanya di grup parent-nya).
- Perubahan pada tes lama: satu assertion daftar kode error di `cv-contracts.test.ts` diperluas dari 12 ke 13 kode (memang diwajibkan menambah `CV_OVERRIDE_UNSUPPORTED`); tidak ada assertion yang dilemahkan. Skema profil dibuat dengan semua field opsional agar fixture `cv-service.test.ts` tidak berubah.

| Command | Hasil |
| --- | --- |
| `pnpm exec vitest run tests/unit/cv-` | 9 file / 100 test PASS |
| `pnpm test` | 85 file / 601 test PASS (sebelum perbaikan tipe; hanya tes yang diubah setelahnya) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |

Acceptance terbukti: poin 3 (preview: achievement sekali), 4 (unit `computeItemMove`/`computeSectionMove`), 5 (unit locale), 6–7 (resolve, kontrak), 9 (unit `reconcileDraft`). Berikutnya: Fase 3.

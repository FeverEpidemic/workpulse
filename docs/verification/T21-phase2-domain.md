# T21 Fase 2 — Domain murni (snapshot, kontrak, paritas model)

- Tanggal: 6 Oktober 2026
- Status: **PASSED**
- Commit: `feat(t21): add CV export snapshot domain`

## Tujuan

Menyediakan kontrak dan fungsi murni yang dipakai worker dan service: skema snapshot `cv-export.v1`, model render yang
sama dengan preview T19, nama efektif, aturan error permanen, dan kedaluwarsa, serta skema Zod untuk readiness,
baris export aman, dan input.

## File berubah

- `src/domain/cv/contracts.ts` (tambah kode error export, `CV_EXPORT_BLOCKER_CODES`, `CV_EXPORT_STATUSES`,
  `CV_EXPORT_ERROR_CODES`, `cvExportBlockerSchema`, `cvExportReadinessSchema`, `cvExportRowSchema`,
  `requestCvExportInput`, `retryCvExportInput`, `downloadCvExportInput`, `parseExportBlockersDetail`)
- `src/domain/cv/export.ts` (baru; import relatif `.ts` agar dapat dipakai worker)
- `tests/unit/cv-export-domain.test.ts` (baru, 15 test), `tests/unit/cv-contracts.test.ts` (diperluas),
  `tests/unit/cv-fixtures.ts` (tambah `exportSnapshotFrom`, aditif)
- `docs/verification/T21-implementation-plan.md` (checkbox Fase 2), receipt ini

## Command dan hasil

| Command | Exit | Hasil aktual |
| --- | --- | --- |
| `vitest run … cv-contracts.test.ts cv-export-domain.test.ts` (sebelum implementasi) | 1 | **FAIL**: 9 failed / 34 passed (modul `export` dan skema baru belum ada) |
| `vitest run … cv-contracts.test.ts cv-export-domain.test.ts` (sesudah) | 0 | 2 file, **58 passed** (43 + 15) |
| `pnpm test` | 0 | **90 file / 729 test passed** (baseline 89 / 706) |
| `pnpm typecheck` | 0 | tanpa error |
| `pnpm lint` | 0 | tanpa warning |

## Acceptance yang terbukti pada fase ini

- §1.17 paritas: `buildExportRenderModel(snapshot)` sama persis (`toEqual`) dengan `buildCvPreviewModel` atas
  dokumen/item tersimpan yang sama, locale `en` dan `id`, dengan tanggal parsial (bulan, tahun, hari),
  achievement bersarang dan standalone, override item, override summary dan override profil display; achievement
  muncul sekali; tidak ada entry bertanda deleted; model tidak berubah bila CV tersimpan berubah setelah snapshot.
- Kontrak snapshot strict: key asing, versi lain, template lain, locale lain, key privat pada `source_snapshot`
  (mis. `raw_text`), item dengan key tambahan, section tidak cocok dengan tipe sumber, ID/posisi ganda, profil dengan
  key asing, `section_order` rusak, dan judul kosong ditolak.
- `cvExportRowSchema` menolak `snapshot`, `attempt_token`, `lease_expires_at`, `object_key`, `idempotency_key`, `user_id`;
  kode error di luar allowlist, error pada baris bukan-failed, dan failed tanpa error ditolak.
- `cvExportReadinessSchema`: `ready` harus konsisten dengan `has_cv` dan daftar blocker; kode/key tak dikenal ditolak.
- `requestCvExportInput` (key `^[A-Za-z0-9_-]{1,200}$` setelah trim, revision ≥ 1 bulat), `retry/downloadCvExportInput`
  (hanya `export_id` UUID).
- Allowlist error worker, kode blocker, status, batas (20 halaman, 10 MiB, 3 attempt, 24 jam, URL 300 detik) terkunci
  oleh test.

## Catatan

- Test pinned `lists the fifteen database error codes` di `cv-contracts.test.ts` diperluas (bukan dilemahkan) ke 23
  kode karena T21 menambah delapan kode error database ke `CV_ERROR_CODES` (§2.2.18; `IDEMPOTENCY_KEY_REUSED` ikut
  ditambahkan agar service CV dapat memetakannya). Ini perubahan yang dibolehkan plan ("perluas
  `cv-contracts.test.ts`") dan dicatat di sini.
- `isExportExpired` memperlakukan tanggal yang tidak dapat dibaca sebagai kedaluwarsa (fail safe).
- Tidak ada UI, route, dependency, atau perubahan perilaku T18–T20.

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 3: template cetak `single_column_v1` (`src/server/export/cv-print-template.ts`) dan adapter `PdfRenderer`
(`src/server/export/pdf-renderer.ts`), test unit lebih dulu.

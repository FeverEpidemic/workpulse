# T19 Fase 0 — Baseline (30 September 2026)

- Tujuan: baseline sebelum edit kode T19. HEAD awal `f109992` (branch `claude/clever-archimedes-gbu7qd`); working tree bersih kecuali `.claude/`.
- Persetujuan pengguna atas §2.4 (override terbatas experience/project/achievement/education, CV baru kosong tanpa auto-selection, override profil di `profile_snapshot.display_overrides`, preview S13 dari data tersimpan) dicatat pada 30 September 2026 (commit `f109992`); tidak ditanyakan ulang.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0, up to date |
| `pnpm exec supabase migration list --local` | parity 27/27, terakhir `20261002090000` |
| `pnpm lint` / `pnpm typecheck` | exit 0 / exit 0 |
| `pnpm test` | 575 passed (81 file) |
| `pnpm db:test` | baseline 12 file / 909 assertion (angka T18); run baseline di sesi ini bersamaan dengan file test T19 baru sehingga gagal sebagaimana diharapkan (red) |

`test:integration:cv` dan `test:integration:achievements` tidak diulang di Fase 0 (bergantung pada receipt T18; diulang di Fase 5).

## Temuan dari source

- `cv-service.ts`: `ensure/getCv/getSelectionPool/select/remove/reorder/updateLayout`; `CvView { document, items, outline }`; `CvSelectionPool` per enam section dengan `PoolEntry { row, selected }`.
- `cv-errors.ts`: `mapCvDatabaseError` membaca `error.message`; `CV_ERROR_MESSAGE_KEYS`.
- `actions.ts`: `run()` membuat `correlationId` untuk service, tetapi `failure()` memanggil `toCvServiceError(error, crypto.randomUUID())` — ID baru hanya dipakai bila error bukan `CvServiceError` (P3 F2 berlaku untuk jalur itu; diperbaiki di Fase 3).
- Migration T18: RPC memakai errcode `22023` untuk `INVALID_CV_INPUT`, `P0001` untuk kode domain, `42501` untuk `AUTH_REQUIRED`; `cv_documents_a_guard` + `cv_documents_touch_mutable_row` menaikkan revision pada setiap UPDATE; `profile_snapshot` dibatasi 8192 byte.
- Batas kolom profil (T03, `20260916190000`): `display_name` 1–80 (rencana menyebut 120; diikuti profil = **80**), `headline` 120, `contact_email` 320 + regex, `phone` 40, `location` 120, `website` 2048 + `^https?://`.
- Tidak ada formatter tanggal parsial siap pakai di `src/domain/dates` (hanya `normalizePartialDate`); `labels.ts` memakai `Intl.DateTimeFormat` sendiri.
- Fixture unit lama `tests/unit/cv-service.test.ts:77` memakai `profile_snapshot: { display_name: "Ani" }`; skema profil baru dibuat dengan semua field opsional agar suite lama tidak berubah.

## Berikutnya

Fase 1 (migration `save_cv_edits`).

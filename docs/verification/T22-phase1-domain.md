# T22 Fase 1 — Domain murni `export-view`

- Tanggal: 7 Oktober 2026
- Pelaksana: Claude Sonnet 5.5
- Basis: `c37f527` (receipt Fase 0).
- Status: **selesai** (acceptance §1.4 bagian tautan, §1.7 nama file, §1.8 matriks aksi dibuktikan di level unit; level E2E menyusul Fase 6).

## 1. Tujuan

Menetapkan aturan murni S14 sebelum UI: status tampilan, aksi yang sah (Export/Download/Retry/Regenerate/Open builder), tautan blocker ke S13, nama file unduhan generik, dan jadwal polling. Tanpa I/O, tanpa UI, tanpa migration.

## 2. File berubah

| Aksi | File |
| --- | --- |
| Create | `src/domain/cv/export-view.ts` |
| Create | `tests/unit/cv-export-view.test.ts` |
| Update | `docs/verification/T22-implementation-plan.md` (checkbox Fase 1) |

`export-view.ts` memakai import relatif (`./contracts.ts`, `./export.ts`, tipe `MessageKey` dari `../../i18n/messages.ts`), sesuai plan §3.1. Tidak ada kunci i18n baru: alasan nonaktif memakai kunci T21 yang sudah ber-parity en/id (`cv.export.error.blocked`, `cv.export.blocker.cvNotFound`); label status memakai `cv.export.status.*`.

## 3. Kontrak yang diimplementasikan

- `EXPORT_POLL_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000] as const`.
- `exportStatusView(row, now)` → `{ state: queued|running|succeeded|failed|expired, messageKey }`; `succeeded` yang lewat 24 jam, di-purge, atau `expires_at` null/tak terbaca → `expired` (memakai `isExportExpired` T21, batas `expires_at <= now`).
- `exportActions({ row, savedRevision, readiness, now })` → `{ primary, secondary, disabledReason }`. Tabel keputusan:

| Keadaan baris | primary | secondary |
| --- | --- | --- |
| tanpa export | `export` | — |
| `queued` / `running` | — (tidak ada aksi) | — |
| `succeeded`, belum kedaluwarsa, revision = tersimpan | `download` | — |
| `succeeded`, belum kedaluwarsa, revision lama | `regenerate` | `download` |
| `succeeded` kedaluwarsa / purged | `regenerate` | — |
| `failed`, kode retriable, `attempt_count < 3`, revision = tersimpan | `retry` | — |
| `failed`, retriable tetapi attempt ke-3, atau revision lama (semua kode) | `regenerate` | — |
| `failed`, kode permanen, revision = tersimpan | `openBuilder` | `regenerate` |

  `disabledReason` bernilai `cv.export.error.blocked` (CV ada tetapi terblokir) atau `cv.export.blocker.cvNotFound` (belum ada CV) **tepat bila** `export` atau `regenerate` ditawarkan dan `readiness.ready` false; `retry`, `download`, `openBuilder` tidak pernah dinonaktifkan oleh blocker. Regenerate selalu melewati readiness (plan §2.2.6).
- `blockerLink(blocker)`: `ITEM_CHANGED|ITEM_DELETED|ITEM_UNCONFIRMED` → `/cv#cv-item-<id>` (id wajib UUID; tanpa id atau id tidak valid → `/cv#cv-review`, sehingga tidak ada karakter tak tepercaya masuk ke anchor); `PROFILE_CHANGED` → `/cv#cv-review`; `NAME_REQUIRED` → `/cv#cv-profile`; `CONTENT_REQUIRED` dan `CV_NOT_FOUND` → `/cv`.
- `exportDownloadName(finishedAt)` → `WorkPulse-CV-<YYYY-MM-DD>.pdf` dari hari UTC `finished_at`; null/tak terbaca/di luar rentang tahun empat digit → `WorkPulse-CV.pdf`. Selalu cocok `^[A-Za-z0-9._-]{1,80}\.pdf$`.

## 4. Keputusan yang saya ambil di dalam plan (untuk reviewer)

Plan §2.2.6 menetapkan aturan Retry dan Regenerate, tetapi tidak merinci setiap sel matriks. Pilihan saya:

1. **`queued`/`running` tanpa aksi.** Request baru akan ditolak backend (`CV_EXPORT_IN_PROGRESS`); halaman hanya menampilkan status. Tautan "Back to CV builder" ada di header halaman, bukan aksi.
2. **Retry tidak bergantung pada readiness.** Sesuai plan dan backend (`retry_cv_export` tidak memvalidasi ulang; snapshot sama). Pelindungnya adalah syarat `cv_revision === savedRevision` (N2). Konsekuensi: bila CV sedang punya blocker `ITEM_CHANGED` yang tidak menaikkan revision CV, Retry tetap tersedia untuk snapshot tersimpan yang sama. Reviewer dapat menilai apakah ini cukup.
3. **`download` untuk revision tersimpan tetap tersedia walau CV terblokir sekarang** (file sudah ada; PRD: PDF yang sudah diunduh tidak berubah). Untuk revision lama, `download` hanya sekunder dan primary adalah `regenerate`.
4. **Kegagalan permanen pada revision tersimpan → primary `openBuilder`** (alasan + tautan S13, plan §1.8), `regenerate` sekunder. Setelah pengguna mengubah CV, revision berubah dan primary menjadi `regenerate`.

## 5. TDD dan bukti

RED: `pnpm exec vitest run tests/unit/cv-export-view.test.ts` sebelum implementasi → `Test Files 1 failed`, `Cannot find package '@/domain/cv/export-view'`, "no tests".

GREEN: setelah implementasi → `Test Files 1 passed (1)`, `Tests 29 passed (29)`.

Isi test (29): status (3), aksi (tanpa export 3, queued/running 2, succeeded 4, failed 5, invarian matriks 5), tautan blocker (3), nama file (3), jadwal polling (1). Matriks invarian menyapu 2 revision tersimpan × 3 readiness × (null + 6 baris non-failed + 8 kode × 3 attempt × 2 revision = 48 baris failed) dan menegaskan: Retry hanya untuk `failed` + revision tersimpan + kode retriable + attempt < 3; Download hanya untuk `succeeded` yang belum kedaluwarsa; paling banyak satu primary tanpa duplikat; `disabledReason` terisi tepat pada kondisi di atas.

Uji kekuatan test (mutasi sementara pada `export-view.ts`, lalu dikembalikan; file akhir identik dengan yang diuji):

| Mutasi | Hasil |
| --- | --- |
| `attempt_count < 3` → `<= 3` | `2 failed | 27 passed` |
| cek revision Retry diganti `true` | `2 failed | 27 passed` |
| file dipulihkan | `29 passed` |

## 6. Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm exec vitest run tests/unit/cv-export-view.test.ts` | exit 0, 1 file / **29** test lulus |
| `pnpm test` | exit 0, **99 file / 874 test** lulus (sebelumnya 98 / 845: +1 file, +29 test, tanpa perubahan test lama) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (`--max-warnings 0`) |

Catatan lingkungan: percobaan `typecheck` pertama gagal dengan `.next/types/validator.ts ... Cannot find module '../../src/app/probe-pdfjs/page.js'`. Itu sisa stub tipe dari build probe Fase 0 yang halamannya sudah saya hapus. `.next/` adalah output build yang di-ignore git; saya menghapusnya dan `typecheck` lulus. Bukan perubahan kode.

## 7. Acceptance §1 yang dibuktikan di fase ini

- **§1.4 (sebagian):** pemetaan blocker → tautan per kode, termasuk fallback aman (unit). Tampilan dan E2E menyusul Fase 3/6; anchor `#cv-profile` belum ada di S13 (ditambah Fase 3).
- **§1.5 (sebagian):** `EXPORT_POLL_DELAYS` sama dengan `EVIDENCE_POLL_DELAYS`; perilaku polling di Fase 3.
- **§1.7 (sebagian):** nama file generik tanpa data pengguna, tanggal UTC, pola aman (unit). Penerbitan URL dan header di Fase 2.
- **§1.8:** matriks Retry/Regenerate (unit, lengkap). E2E menyusul Fase 6.

Belum dibuktikan: semua poin lain §1 (fase berikutnya).

## 8. Warning dan blocker

Tidak ada kegagalan, tidak ada blocker, tidak ada stop condition. Tidak ada perubahan pada suite lama, migration, RPC, atau worker.

## 9. Langkah berikutnya

Fase 2: adapter storage aditif (`disposition` + `filename`), `getExport(id)` dan `issueDownload({ export_id, disposition })` di service, `disposition` pada action unduhan, route `GET /api/cv/exports/[id]`, dengan test unit dan integration lebih dulu.

# T17 Fase 2 — Service baca, route dan action (30 September 2026)

Tujuan: sisi server S03 tanpa migration: loader `getReviewView`, route `GET /api/imports/[id]/review`, action `validateImportAction`, dan allowlist route S03.

## File berubah

- Baru: `src/features/import/import-review-view-service.ts`, `src/app/api/imports/[id]/review/route.ts`, `tests/unit/import-review-view-service.test.ts`, `tests/unit/import-review-route.test.ts`, `tests/integration/import-review-ui.test.ts`.
- Diubah: `src/features/import/http.ts` (callback menerima `{client, actorId}`; pemanggil lama tidak berubah), `src/features/import/actions.ts` (`validateImportAction`; commit kini juga me-revalidate `/timeline` dan `/settings/profile`), `src/domain/routes/safe-return.ts` (allowlist `/imports/<uuid>/review`), `src/proxy.ts` (`/imports` dilindungi dan masuk matcher), `package.json` (script `test:integration:import-review`), `tests/unit/import-review-actions.test.ts`, `tests/unit/auth-routing.test.ts`.

## Yang dibuktikan

- Unit service (6): UUID invalid/batch tidak ada → `NOT_FOUND` yang sama; row rusak → `UNAVAILABLE`; target dan validasi hanya untuk batch `review`, maksimal 200 baris per tipe, kolom minimal; `commit_result` tersimpan dibaca, kosong/rusak → tanpa angka; error tidak memuat teks kandidat.
- Unit route (3): 401 generik, 404 identik untuk id asing/tidak ada/bukan UUID, `no-store`, 200 untuk pemilik.
- Unit action: `validateImportAction` memakai session, tanpa `revalidatePath`; commit me-revalidate dashboard/timeline/profile hanya saat sukses.
- Integration nyata (6): grup, excerpt, revision; opsi map hanya milik pemilik (skill dan experience akun B tidak muncul); pilihan (action, map target, patch, confirm) bertahan pada pembacaan baru dan revision batch naik; edit ganda pada revision sama → `STALE`, nilai tersimpan tidak tertimpa; commit menampilkan `commit_result` sama dengan selisih row nyata, ulang commit identik tanpa row baru, target map tidak berubah; akun lain mendapat `NOT_FOUND` identik; sentinel isi CV dan nama file = 0 pada error, output worker dan console.

## Commands (hasil aktual)

- `pnpm test` (file terkait) PASS; `pnpm typecheck`, `pnpm lint` exit 0.
- `pnpm test:integration:import-review` — 6 PASS (env lokal dimuat dalam command yang sama).

Catatan: tidak ada migration; parity tetap 26/26.

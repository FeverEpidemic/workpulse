# T17 Fase 3 — Layar S03 (30 September 2026)

Tujuan: layar `/imports/[id]/review` di atas RPC T16, tanpa migration.

## File berubah

- Baru: `src/app/imports/[id]/review/{page,loading}.tsx`, `src/features/import/import-review.tsx`, `src/features/import/import-review-candidate.tsx`, `src/domain/import/review-edit.ts` (helper murni: draft/patch, `applyChange`, `withReceipt`), `tests/unit/import-review-ui.test.tsx`, `tests/unit/import-review-edit.test.ts`.
- Diubah: `src/i18n/messages.ts` (121 kunci en/id, `import.review.*`, `import.reviewCandidates`, `import.committed*`, `import.openDashboard`, `profile.importCv*`), `src/app/globals.css` (kelas `import-review-*`, token existing saja), perbaikan enkoding pada beberapa file test (lihat catatan).

## Perilaku

- Route di luar `(workspace)`: tanpa session → `/sign-in?returnTo=…`; tanpa profil → `serviceUnavailable`; profil provisional diizinkan; id asing/hilang/bukan UUID → `notFound()` (halaman 404 generik yang sama). `UnsavedChangesProvider` dipasang di page.
- Model simpan (keputusan §2.2.6): action, target map, confirm, dan pilihan field profil langsung tersimpan lewat `updateImportItemAction`; edit teks/tanggal lewat *Save changes* per kandidat (satu `payload_patch` berisi key yang berubah). Setiap sukses memperbarui `revision` item dan token commit (maksimum batch revision), lalu `validateImportAction` mengganti error.
- Status persistensi per kandidat (*Saving… / Saved / Not saved / Unsaved edits / Changed elsewhere*) sebagai teks.
- Konflik (`STALE`): kandidat masuk state konflik, input lokal dipertahankan, nilai server ditampilkan berdampingan, *Reload latest* memuat `GET /api/imports/[id]/review`. Commit `STALE` → pesan konflik + reload, tanpa commit ulang otomatis. `NOT_REVIEWABLE`/`NOT_COMMITTABLE` → reload.
- Confirm achievement hanya per kandidat, nonaktif dengan alasan sampai title/contribution/outcome/achieved_on tersimpan; tidak ada *Confirm all*. Tombol *Confirm import* satu-satunya aksi utama, nonaktif dengan alasan (validasi, edit belum tersimpan, sedang menyimpan, onboarding); `commitLock` + `pending` mencegah submit ganda.
- Onboarding hanya untuk profil provisional; nilai tetap lokal (sessionStorage via `useSyncExternalStore`, aman untuk hydration), placeholder `Pending onboarding` tidak pernah diprefill.
- Editor tanggal S03 memakai aturan domain `normalizePartialDate` yang sama dengan S12 tanpa mengubah S12 (komponen S12 terikat `ActionState`; ekstraksi tidak dilakukan agar perilaku S12 tidak berubah).

## Commands (hasil aktual)

- `pnpm typecheck`, `pnpm lint`, `pnpm build` exit 0 (rute `/imports/[id]/review` dan `/api/imports/[id]/review` terdaftar).
- `pnpm test`: 75 file / 491 test PASS (dari 70/449 pada baseline).

## Catatan

- Insiden enkoding: satu perintah PowerShell (`Get-Content -Raw` + `Set-Content`) merusak karakter non-ASCII dan menambah BOM pada 5 file test/sumber baru; dipulihkan dengan skrip Node sebelum test dijalankan ulang, lalu diverifikasi (`leftover: 0`).
- Label duplikat "Optional" pada field achievement yang belum diminta konfirmasi mengikuti aturan SQL (title/contribution/outcome wajib hanya saat confirm).
- Kunci copy `import.review.notFoundTitle/notFoundBody` tidak dipakai (404 generik memakai halaman root); dihapus pada Fase 4.

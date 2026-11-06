# T33 Fase 3b: remediasi gate review (RV1, RV2)

- Tanggal: 6 November 2026
- Pelaksana: Claude Sonnet 5.5, satu agent. Branch `claude/t33-cv-multi-select-288f9f`.
- Sumber: `docs/verification/T33-review-remediation-plan.md` (commit `0674f8c`), disetujui pengguna di sesi reviewer.
- antislop: mode during (session override). Tidak ada perubahan visual, copy, atau CSS; hanya perilaku dan state.

## Tujuan

Menutup RV1 (P1, batch gagal di record pertama jadi jalan buntu) dan RV2 (P2, induk yang masuk otomatis kembali tercentang setelah dihapus). N1 dan N2 tidak dikerjakan (follow-up P3).

## File berubah

- `src/features/cv/cv-builder-state.ts`: fungsi murni `pruneChosen(chosen, pool)`.
- `src/features/cv/cv-builder.tsx`:
  - RV1: pada jalur gagal, `cv.notice.partialAdd` tampil bila `options.length > 1` (juga "0 of 3 added"), dan `router.refresh()` selalu berjalan kecuali `fail()` sudah me-refresh karena konflik (`isSourceChangedConflict` atau `isStaleConflict`), jadi tidak ada refresh ganda.
  - RV2: saat `savedKey` berubah, `chosen` dipangkas dengan `pruneChosen` terhadap pool terbaru. State `chosen` dipindah di atas blok sinkron render agar bisa dipakai di sana.
- `tests/unit/cv-builder-state.test.ts`: dua test `pruneChosen`.
- `tests/e2e/cv-builder.spec.ts`: dua test baru.

Tidak berubah: `supabase/migrations`, `package.json`, `pnpm-lock.yaml`, `src/features/cv/actions.ts`.

## TDD: gagal lalu lulus

1. Unit dan E2E ditulis dulu; perubahan `src/` disimpan sebagai patch dan di-checkout supaya test jalan tanpa perbaikan.
2. Tanpa perbaikan: unit `2 failed | 24 passed (26)` (`pruneChosen` belum ada). E2E RV1 gagal di `toHaveText("0 of 3 added. ...")` (notice tidak ada). E2E RV2 gagal di `expect(Proyek Pilihan).not.toBeChecked()` (diterima: tercentang). Satu percobaan awal RV2 gagal karena kesalahan setup test (daftar Projects sudah terbuka, klik ringkasan menutupnya); setup dibetulkan lalu gagal pada assertion yang benar.
3. Perbaikan diterapkan kembali: unit 26 lulus, E2E 15 lulus.

## Test baru

- Unit: `pruneChosen` membuang id yang record-nya sudah di CV, menyimpan sisanya termasuk id yang tidak ada di pool, dan mengembalikan objek Set yang sama bila tidak ada perubahan.
- E2E RV1 ("a batch whose first record is gone..."): record pertama dalam daftar dihapus lewat `delete_achievement` sebelum tombol ditekan. Hasil: info "0 of 3 added. The rest stay selected so you can try again.", notice "This record is no longer available", `cv_items` = 0, checkbox record yang hilang count 0, dua sisanya tercentang, tombol "Add 2 to CV", fokus bukan BODY/HTML, klik ulang menghasilkan `cv_items` = 2 dan dua baris Added.
- E2E RV2 ("a parent that came in with its achievement..."): project dan achievement anaknya dicentang, ditambah lewat tombol Achievements, project dihapus lewat "Remove parent and its achievements". Hasil: checkbox project dan anak tidak tercentang, tombol Projects "Add to CV" dengan `aria-disabled`.

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | Tanpa warning |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | **163 file / 1577 test** lulus (Fase 3: 1575, +2) |
| `pnpm test:e2e:cv` | 0 | **15 lulus** (Fase 3: 13, +2) |
| `pnpm test:e2e:cv-freshness` | 0 | 11 lulus |
| `pnpm test:e2e:release` | 0 | **79 lulus**, 0 gagal, 1 skip (11,3 menit). `landing.spec.ts:308` (N1) lulus di run ini |
| `git diff --check` | 0 | Bersih |

Aria S13 tidak dikunci ulang: markup daftar tidak berubah, dan `release-a11y` "accessibility tree ... is locked" lulus.

Commit kode: `fix(t33): reload the pool after any failed batch and prune the choice`.

## Catatan lingkungan dan run release

- Docker Desktop mati lagi sebelum sesi ini; dinyalakan ulang, kontainer renderer dinyalakan, `pnpm db:start` ("Starting database from backup"), tanpa `db:reset`.
- Dua run release pertama tidak valid: yang pertama berhenti segera karena port 3017 dipakai `next start` dari checkout utama `D:\Project\WorkPulse` (sesi lain, mulai 11:08, tidak saya hentikan). Yang kedua menunggu port bebas, tetapi 26 tes gagal beruntun dalam sekitar 1 detik (36 lulus, 17 tidak jalan), pola gangguan fixture bersama saat sesi lain juga memakai DB. Run ketiga, tanpa proses lain, lulus penuh. Hanya run ketiga yang dilaporkan sebagai bukti.
- Screenshot tracked yang ditimpa suite dikembalikan dengan `git checkout`.

## Batas bukti

Chromium pada build produksi lokal. Tampilan Indonesia hanya dibuktikan unit. Belum diuji di Safari, Firefox, perangkat nyata, staging, atau production.

## Follow-up (tidak dikerjakan)

- N1: `landing.spec.ts:308` flaky di base juga (milik T32/landing).
- N2: tombol tambah masih bisa diklik selama refresh setelah jawaban stale; data tidak rusak.

## Berikutnya

Berhenti. Gate ulang oleh reviewer. Fase 4 menunggu gate ulang lulus.

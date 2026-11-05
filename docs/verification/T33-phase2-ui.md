# T33 Fase 2: UI

- Tanggal: 5 November 2026
- Pelaksana: Claude Sonnet 5.5, satu agent. Branch `claude/t33-cv-multi-select-288f9f`.
- antislop: mode during (session override). Design Read: halaman app internal untuk pengguna yang menyusun CV, bahasa visual yang sudah ada di app, dial ENERGY 1 / RHYTHM 1 / MOTION 1 (repo tidak punya arahan baru; plan §2.2.14 menetapkan checkbox native dan token yang ada).

## Tujuan

Mengganti tombol Add per baris di "Available to add" dengan checkbox per record dan satu tombol tambah per section, yang menjalankan `selectCvSourceAction` berurutan lewat `runSequentialAdds`.

## File berubah

- `src/features/cv/cv-section.tsx`: `PoolRow` menjadi `<li>` berisi `<label>` selebar baris (record tersedia) atau teks Added (record sudah di CV). `CvSection` menampilkan tombol dan keterangan setelah `<ul>`. `SectionHandlers` kehilangan `onAdd`, mendapat `busy`, `chosen`, `adding`, `onTogglePoolOption`, `onAddSelected`.
- `src/features/cv/cv-builder.tsx`: state `chosen` (`Set<sourceId>`, diinisialisasi dari `highlightId` yang sudah divalidasi `resolveHighlight`), state `adding` untuk label progres, `onTogglePoolOption`, `onAddSelected(sectionKey)`. `onAdd` dihapus. `runOperation` tidak diubah.
- `src/app/globals.css`: `.cv-pool-label`, `.cv-pool-added`, `.cv-pool-actions`. Tidak ada token, warna, ikon, atau animasi baru. `accent-color` memakai `--color-action-primary`.
- `src/i18n/messages.ts`: `cv.action.add` dan `cv.aria.add` dihapus di en dan id (tidak terpakai lagi; grep `src` kosong).
- `tests/unit/cv-builder-ui.test.tsx`: assertion tombol Add per baris diganti padanan checkbox; enam test baru.

## Keputusan UI dan alasan (R-31)

| Keputusan | Alasan satu baris |
| --- | --- |
| Checkbox native, tanpa komponen kustom | Pola yang sudah dipakai di `import-review-candidate.tsx`; fokus, Space, dan screen reader gratis |
| Seluruh baris adalah `<label>` dengan tinggi minimal `--touch-target-min` | Target sentuh 44 px (R-03), klik di mana saja men-toggle |
| `aria-labelledby` ke nama record, `aria-describedby` ke detail | Badge Suggested dan detail tidak masuk nama accessible (review focus 6) |
| Baris Added: teks "Added" disembunyikan dari AT, kalimat `cv.aria.added` sr-only | Status tidak bergantung warna; AT mendengar "X is already on the CV" |
| `aria-disabled` dan guard di handler, bukan `disabled` | Temuan T19 Fase 5: `disabled` membuang fokus |
| Tombol tanpa ikon, tanpa panah, varian `secondary` yang sudah ada | Tombol lain di baris/section memakai varian yang sama; ikon tidak membawa informasi (R-04, R-08) |
| Tombol dan keterangan di bawah daftar, bukan sticky | Sticky ada di luar scope §2.3 |
| Daftar berubah dari tombol per baris ke satu tombol: satu focal point per section | Aksi utama section menjadi jelas |

## Aliran `onAddSelected`

1. Keluar bila `busyRef` aktif atau pilihan kosong. Set `busyRef` dan `busy`, kosongkan notice.
2. `runSequentialAdds` dengan `revision` saat klik, `add` membentuk `FormData` per record, `onProgress` mengisi `adding` dan live region (hanya bila total > 1).
3. `setLocalRevision(result.revision)`; record yang masuk keluar dari `chosen`.
4. Semua berhasil: `pendingFocus` ke `cv-section-heading-<section>`, umumkan `cv.announce.added` (satu) atau `cv.announce.addedMany`, `router.refresh()` sekali.
5. Gagal: `pendingFocus = null`; `fail(failure)` bila jawaban error server, selain itu `error.unavailable` dengan correlation ID klien. Bila ada yang sudah masuk: `infoNotice` `cv.notice.partialAdd` dan `router.refresh()` tetap berjalan. Fokus ke notice lewat `setNoticeFocus`.
6. `finally`: lepas `busyRef`, `busy`, `adding`.

## Urutan TDD

Test markup diperbarui lebih dulu. Run pertama: 8 test gagal (tidak ada checkbox, tombol Add lama masih ada). Sesudah implementasi: 32 lulus pada `cv-builder-ui.test.tsx`.

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `vitest run tests/unit/cv-builder-ui.test.tsx` (sebelum) | 1 | 8 gagal |
| `vitest run tests/unit/cv-builder-ui.test.tsx` (sesudah) | 0 | 32 lulus |
| `pnpm lint` | 0 | Tanpa warning |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | **163 file / 1575 test** lulus (Fase 1: 1569, +6) |

Commit kode: `feat(t33): select several records from the CV pool`.

## Acceptance yang terbukti (unit/markup)

- 1 Checkbox per record, tanpa Add per baris: test "gives every record not yet on the CV one checkbox...". E2E menyusul Fase 3.
- 2 Record di CV tanpa checkbox, teks Added, keterangan "On the CV under ...": test "shows a record already on the CV as text...".
- 4 Tombol: satu per section yang masih punya record, `aria-disabled` + keterangan terlihat di 0 centang, "Add 1 to CV" dengan satu centang, tidak ada tombol untuk section tanpa record tersedia; lokalisasi id.
- 9 (sebagian) Highlight valid: checkbox tercentang. Highlight tidak valid: tidak ada centang.
- 12 Tanpa "Add all" dan tanpa "Select all" (assertion lama dipertahankan, ditambah satu).

Belum dibuktikan (menunggu browser dan DB di Fase 3): 3, 5, 6, 7, 8, 10, 11, 13, dan sisi E2E dari 1, 2, 4, 9.

## Warning

- Kontras batas checkbox native dan label tombol nonaktif (`opacity: 0.75`) belum diukur; dilakukan di Fase 3 dengan `contrast-check.py` dan axe.
- Test E2E yang masih memakai `#cv-add-<id>` dan nama "Add X to CV" akan gagal sampai dimigrasikan di Fase 3: `cv-builder`, `cv-export`, `cv-freshness`, `m4`, `m5`, `release-keyboard`.
- Kasus "sukses tanpa `cvRevision`" memberi `error.unavailable` walau server mungkin sudah menambah record. Tidak terjadi dengan action sekarang (Fase 0), dan record itu gugur dari pilihan setelah refresh.

## Blocker

Tidak ada.

## Berikutnya

Fase 3: migrasi E2E, E2E baru, lock ulang aria, regresi, Delivery Gate.

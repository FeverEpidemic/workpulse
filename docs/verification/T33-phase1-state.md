# T33 Fase 1: aturan state dan copy

- Tanggal: 5 November 2026
- Pelaksana: Claude Sonnet 5.5, satu agent. Branch `claude/t33-cv-multi-select-288f9f`.
- antislop: mode during (session override).

## Tujuan

Menaruh aturan seleksi daftar "Available to add" sebagai fungsi murni yang diuji unit (decision 0025 #12), dan menambah copy en dan id untuk tombol tambah per section.

## File berubah

- `src/features/cv/cv-builder-state.ts`: `addableSelection`, `poolAddButton`, `SequentialAddResult`, `runSequentialAdds`. Tanpa import React; satu import tipe dari `./cv-view`.
- `src/i18n/messages.ts`: enam kunci baru di en dan id (`cv.pool.addSelected`, `cv.pool.addNone`, `cv.pool.selectHint`, `cv.pool.adding`, `cv.announce.addedMany`, `cv.notice.partialAdd`) dengan teks persis dari tabel §2.2.12, tanpa em dash. `cv.action.add` dan `cv.aria.add` belum dihapus: `cv-section.tsx` masih memakainya sampai Fase 2.
- `tests/unit/cv-builder-state.test.ts`: tujuh test baru (blok "T33 pool multi-select rules").

## Urutan TDD

1. Test ditulis dulu. Run pertama: `7 failed | 17 passed (24)`, semua gagal dengan `... is not a function`.
2. Implementasi minimal. Run kedua: `24 passed (24)`.

## Perilaku `runSequentialAdds`

- Tiap `add` menerima revision dari jawaban sebelumnya, bukan state React. Test "adds in order" membuktikan rantai 10, 12, 14 dan revision akhir 16.
- Berhenti di kegagalan pertama. `added` memuat yang berhasil, `failed` item yang berhenti, `failure` jawaban error server.
- `add` yang melempar: `failure: null`, `revision` tetap revision terakhir yang sah.
- Jawaban sukses tanpa `cvRevision` numerik: berhenti, `failure: null`, item itu tidak masuk `added`, revision tidak ditebak.
- Daftar kosong: tidak memanggil `add`, hasil `{ added: [], failed: null, failure: null, revision }`.
- `onProgress(current, total)` dipanggil sebelum tiap panggilan, mulai dari 1.

Catatan untuk reviewer: pada kasus "sukses tanpa revision", server mungkin sudah menambah record tetapi UI menganggapnya gagal dan membiarkannya tercentang. Setelah `router.refresh()` record itu gugur dari pilihan (diturunkan dari pool, §2.2.11). Kasus ini tidak muncul dari `selectCvSourceAction` yang sekarang (Fase 0 membuktikan `cvRevision` selalu ada), jadi ini hanya pagar pengaman.

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `vitest run tests/unit/cv-builder-state.test.ts` (sebelum implementasi) | 1 | 7 gagal, 17 lulus |
| `vitest run tests/unit/cv-builder-state.test.ts` (sesudah) | 0 | 24 lulus |
| `pnpm lint` | 0 | Tanpa warning |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | **163 file / 1569 test** lulus (baseline 1562, +7) |
| Cek em dash di `messages.ts` | 0 | 0 kemunculan |

Commit kode: `feat(t33): add pool selection rules and copy`.

## Acceptance yang terbukti

Bagian unit dari acceptance 4 (label dan disabled tombol), 5 (urutan daftar dan revision berantai) dan 7 (berhenti di kegagalan pertama, throw, tanpa revision). Bukti markup dan E2E menyusul di Fase 2 dan 3.

## Warning dan blocker

Tidak ada.

## Berikutnya

Fase 2: UI (`cv-section.tsx`, `cv-builder.tsx`, CSS) dengan test markup lebih dulu.

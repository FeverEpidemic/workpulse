# T31 Fase 1: CSS kapsul

- Tanggal: 26 Oktober 2026
- Eksekutor: Claude Sonnet 5.5
- Tujuan: bottom tab bar mobile menjadi kapsul floating, menyempit saat compact, tanpa mengubah markup atau logika scroll.

## File berubah

- `src/app/globals.css`
- `tests/unit/floating-tab-bar-css.test.ts` (baru, 7 test)

## Yang dilakukan

1. Test dulu: `floating-tab-bar-css.test.ts` ditulis, dijalankan, **6 dari 7 gagal** pada CSS lama (satu lulus karena transisi kapsul belum ada, jadi tidak ada transform/opacity di dalamnya).
2. `globals.css`, blok `@media (max-width: 880px)`:
   - `:root` mendefinisikan `--tab-bar-gutter: var(--space-2)` dan `--tab-bar-offset: calc(var(--tab-bar-gutter) + env(safe-area-inset-bottom))`. Dipilih `:root` di dalam media query (bukan di `.workspace-tab-bar`) karena `.workspace-content` dan `.ui-toast-region` di luar nav membacanya juga.
   - `.workspace-tab-bar`: `left: 50%`, `bottom: var(--tab-bar-offset)`, `width: var(--tab-bar-width)`, `transform: translateX(-50%)`, border 1 px di empat sisi, `--radius-lg`, `--shadow-md`, tanpa `right`, `border-top`, `padding-bottom`, `backdrop-filter`. Transisi hanya `width` 180 ms `--ease-out`.
   - `--tab-bar-width: min(calc(100% - 2 * var(--tab-bar-gutter)), 480px)`; compact memakai `--tab-bar-compact-width: calc(5 * var(--touch-target-min) + 6 * var(--space-2))` = 268 px.
   - Compact: `column-gap: var(--space-2)` dan `padding: 0 calc(var(--space-2) - 1px)` pada `.workspace-tab-list`.
   - `.workspace-content` dan `.ui-toast-region`: `var(--tab-bar-offset)` menggantikan `env(safe-area-inset-bottom)`.
3. `.workspace-tab-list` (aturan global): transisi `height`, `column-gap`, `padding` dengan `--motion-normal` `--ease-out`.
4. Komentar CSS diperbarui (kapsul, gutter 8 px, slot 66,8 px).

## Penyimpangan dari plan (dengan alasan)

- **Gutter 8 px, bukan 12 px**: keputusan pengguna setelah stop condition Fase 0 (`T31-phase0-baseline.md`). Dampak: kapsul expanded 344 px di 360 px, ruang konten bawah `64 + 8 + 40` px.
- **Padding list compact 7 px, bukan 8 px per sisi**: `box-sizing: border-box` membuat lebar 268 px sudah termasuk border 1 px per sisi. Isi dalam 266 px; 266 - 14 = 252 = 5 × 44 + 4 × 8. Dengan padding 8 px lima target akan 43,2 px dan gagal acceptance 7. Lebar kapsul tetap 268 px sesuai acceptance 2.
- Pengecekan "tanpa `backdrop-filter`" dibatasi ke aturan tab bar dan list. `globals.css` sudah punya `backdrop-filter: blur(2px)` di `.ui-dialog::backdrop` (bukan bar).

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/floating-tab-bar-css.test.ts` (sebelum implementasi) | exit 1, 6 gagal, 1 lulus |
| `pnpm test` (sesudah) | exit 0, **154 file, 1446 test lulus** (baseline 153/1439; +1 file, +7 test) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |

`motion-tokens.test.ts` tetap lulus: tidak ada durasi literal baru.

## Acceptance yang terbukti di fase ini

Hanya sisi CSS-sebagai-teks (acceptance 1, 2, 3 bagian unit). Bukti browser ada di Fase 2.

## Blocker

Tidak ada. File scratch `tests/e2e/zz-t31-measure.spec.ts` dan `playwright.t31tmp.config.ts` tidak di-commit.

## Berikutnya

Fase 2: perbarui `mobile-tab-bar.spec.ts` (bounding box, compact, gutter tap, reduced motion, padding ≥ 72), jalankan, ambil screenshot ke `docs/verification/T31-screenshots`.

# Decision 0041: T31 tab bar mobile mengambang

Date: 27 Oktober 2026

Status: Accepted. Desain dari interview pengguna di chat pada 26 Oktober 2026; gutter 8 px dipilih pengguna di Fase 0 pada tanggal yang sama. Dieksekusi Claude Sonnet 5.5 (Fase 0 sampai 3); gate review Claude Opus 5.5 pada 27 Oktober 2026 PASS tanpa P0-P2 dengan empat P3. Task: T31 (permintaan terarah pengguna, tidak ada di `IMPLEMENTATION_PLAN.md` §5). [Rencana](../verification/T31-implementation-plan.md), [bukti](../verification/T31-floating-tab-bar.md), [gate review](../verification/T31-gate-review.md). Tanpa migration (parity tetap 38), tanpa dependency, tanpa perubahan TSX atau copy.

## References

- **Design.md** §4.3 (navigasi mobile, diperbarui oleh decision ini), §28 (motion), *Compact width* (+ tetap slot tab bar, bukan floating button).
- **Decision 0035** keputusan 4 (label mengikuti scroll, 64 → 52 px) dan 7 (bar solid tanpa blur, ruang bawah konten). Decision ini mengganti posisi full-width dari keputusan 7; bagian solid tanpa blur tetap berlaku.
- **Decision 0040** (token `--motion-normal`, `--ease-out`, blok reduced motion global).

## Context

Pengguna meminta tab bar mobile yang mengambang dengan animasi yang sama. Bar T27 menempel full-width di tepi bawah dengan `border-top` dan `padding-bottom: env(safe-area-inset-bottom)`.

## Decisions

1. **`nav` sendiri adalah kapsulnya.** `.workspace-tab-bar` di blok `@media (max-width: 880px)` memakai `left: 50%`, `bottom: var(--tab-bar-offset)`, `width: var(--tab-bar-width)`, `transform: translateX(-50%)`. Markup `mobile-tab-bar.tsx` dan `useScrollChrome` tidak berubah. *Alasan:* wrapper full-width yang transparan akan menangkap tap di gutter dan handler klik bar akan me-expand alih-alih meneruskan tap ke konten.
2. **Gutter 8 px, bukan 12 px.** `--tab-bar-gutter: var(--space-2)` dan `--tab-bar-offset: calc(var(--tab-bar-gutter) + env(safe-area-inset-bottom))`, didefinisikan di `:root` dalam media query. *Alasan:* pada kapsul 336 px label tebal "Dashboard" (64,5 px) melebihi isi tab 63,2 px dan terpotong; pengguna memilih gutter 8 px (kapsul 344 px, isi tab 64,8 px) dari tiga opsi yang diukur.
3. **Lebar expanded maksimal 480 px.** `--tab-bar-width: min(calc(100% - 2 * var(--tab-bar-gutter)), 480px)`. *Alasan:* di tablet 600-880 px lima slot tetap rapat, bukan tersebar di kapsul 850 px.
4. **Compact menyempit ke lima target.** `--tab-bar-compact-width: calc(5 * var(--touch-target-min) + 6 * var(--space-2))` (268 px); list memakai `column-gap: var(--space-2)` dan padding `0 calc(var(--space-2) - 1px)`, 1 px dikurangi untuk border. *Alasan:* target 44 px dengan jarak 8 px memenuhi aturan target sentuh, dan kapsul tetap terpusat.
5. **Animasi memperpanjang shrink T27 ke lebar.** Kapsul `transition: width var(--motion-normal) var(--ease-out)`; list mentransisikan `height`, `column-gap`, dan `padding` dengan durasi dan easing yang sama. Tidak ada transisi `transform`, `opacity`, atau `bottom`. *Alasan:* "animasi yang sama" berarti gerak T27 yang diperluas, bukan gerak baru. `transform: scaleX` ditolak karena merusak bentuk ikon, `clip-path` ditolak karena slot tidak ikut bergeser. `width` memicu layout, tetapi hanya di subtree `position: fixed`.
6. **Permukaan solid dengan satu shadow.** `background: var(--color-bg-surface)`, `border: 1px solid var(--color-border-default)` di empat sisi, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-md)`, tanpa `backdrop-filter`. *Alasan:* kontras label tetap tidak bergantung pada konten di bawahnya (0035 #7); radius 16 px mengikuti kartu dan dialog, bukan pill penuh; tanpa token warna atau shadow baru.
7. **Ruang bawah dari tinggi expanded.** `.workspace-content` mobile memakai `calc(64px + var(--tab-bar-offset) + var(--space-10))` dan `.ui-toast-region` `calc(64px + var(--tab-bar-offset) + var(--space-3))`. *Alasan:* kontrol terakhir dan toast tidak boleh berada di bawah kapsul saat label kembali.
8. **+ tetap di dalam bar.** Memisahkan + menjadi tombol bulat bertentangan dengan Design.md *Compact width* dan butuh keputusan desain baru.

## Not promised

- `env(safe-area-inset-bottom)` dan gestur sentuh belum diuji di perangkat nyata; Chromium desktop mengembalikan 0.
- Belum diuji di Safari, Firefox, staging, atau production.

## Follow-up (P3 dari gate review)

- G1: label tebal "Dashboard" hanya bersisa 0,3 px; font fallback atau teks diperbesar bisa memotongnya.
- G2: E2E tap di dalam kapsul hanya memeriksa `data-compact`, bukan lebar 344 px.
- G3: di dark mode tepi kapsul hanya ditopang border; `--shadow-md` hampir tak terlihat.
- G4: safe area di perangkat nyata (lihat di atas).

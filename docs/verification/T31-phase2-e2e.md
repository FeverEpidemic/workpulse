# T31 Fase 2: E2E

- Tanggal: 26 Oktober 2026
- Eksekutor: Claude Sonnet 5.5
- Tujuan: membuktikan acceptance 1-8 dan 10 di browser terhadap build produksi (config `release`, port 3017).

## File berubah

- `tests/e2e/mobile-tab-bar.spec.ts`
- `docs/verification/T31-screenshots/` (10 PNG baru). `SHOTS` di spec pindah dari `T27-screenshots` ke `T31-screenshots`, jadi bukti T27 tidak tertimpa.

## Perubahan spec

Assertion T27 yang ada tidak dilemahkan atau dihapus. Yang berubah:

| Perubahan | Alasan |
| --- | --- |
| Padding bawah `main` ≥ `64 + 8` (sebelumnya ≥ 64) | Offset kapsul 8 px (gutter dipilih pengguna di Fase 0). Plan menyebut 76 untuk gutter 12 px; angka itu jadi 72. |
| Durasi transisi diukur di `.workspace-tab-bar` selain list, header, tab | Kapsul kini punya transisi `width`. Untuk list dengan beberapa properti dipakai nilai maksimum, karena `transition-duration` berupa daftar. |

Yang ditambah:

- Expanded 360 × 640 (acceptance 1): `left` = 8, `right` = 352, `bottom` = 632 (toleransi pembulatan), border `1px` di empat sisi, radius sama dengan `--radius-lg`, `box-shadow` bukan `none`, `backdrop-filter` `none`.
- Transisi (acceptance 3): kapsul `width`, `0.18s`, `cubic-bezier(0.2, 0, 0, 1)`; list `height`, `column-gap`, `padding`, semua `0.18s`.
- Gutter (acceptance 5): `elementFromPoint(4, bawah - 32)` tidak berada di dalam `.workspace-tab-bar`.
- Compact (acceptance 2, 7): lebar 268 px, terpusat (selisih kiri/kanan ≤ 1), `bottom` = tinggi viewport - 8; target ≥ 44 × 44 dan jarak antar target ≥ 8 px. Setelah scroll naik, lebar kembali 344 px.
- Target di expanded (acceptance 7): ≥ 44 × 44.
- Reduced motion (acceptance 4): durasi kapsul, list, header, tab ≤ 0,01 ms; setelah scroll ke bawah state compact tetap berganti (268 px, terpusat, jarak 8 px).
- Test baru 768 × 800: lebar 480 px, terpusat, `bottom` = 792; compact tetap menyempit ke 268 px.
- Axe compact (acceptance 10): `expectNoWcagViolations` pada `/dashboard` compact, light dan dark (sebelumnya compact hanya screenshot di dark).

Tap di area kapsul di luar tab (`box.x + 2`, spec baris lama 131) tetap me-expand bar: titik itu kini di dalam border/padding kapsul compact (x = 46) dan test lulus tanpa perubahan.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `playwright test --config playwright.release.config.ts tests/e2e/mobile-tab-bar.spec.ts` | exit 0, **7 lulus** (1,2 menit); sebelumnya 6 test di file ini |

Run pertama langsung hijau; tidak ada assertion yang diubah setelah melihat hasil.

## Acceptance yang terbukti

1 (kapsul expanded), 2 (kapsul compact), 3 (transisi), 4 (reduced motion), 5 (gutter), 6 (label tidak terpotong, assertion T27 `scrollWidth ≤ clientWidth` lulus, termasuk Dashboard aktif tebal), 7 (target 44 px dan jarak), 8 (kontrol terbawah di atas kapsul, padding, tanpa scroll horizontal, toast di atas bar), 10 (axe, kecuali Menu lainnya compact yang tidak relevan karena sheet menutupi bar). Acceptance 9 menunggu `test:e2e:release` penuh di Fase 3.

## Screenshot (`docs/verification/T31-screenshots`)

`bar-expanded-360-light|dark.png`, `bar-compact-360-light.png` (di `/activity`), `bar-compact-360-light-dashboard.png`, `bar-compact-360-dark-dashboard.png`, `bar-expanded-768-light.png`, `composer-360-light|dark.png` (sheet menutupi kapsul sesuai keputusan 0035), `more-360-light|dark.png`.

Pengamatan: di 360 px tab Dashboard aktif menempel hampir ke tepi dalam kapsul (sisa 0,3 px untuk label tebal, konsekuensi gutter 8 px). Nama dan email pengguna di-mask oleh helper `shot`.

## Warning dan blocker

Log server menampilkan `The destination stream closed early` (digest `113424711`) dari Next saat tab ditutup. Muncul juga di baseline Fase 0 sebelum perubahan, bukan regresi.

Tidak ada blocker.

## Berikutnya

Fase 3: `pnpm build`, `test:e2e:ui`, `test:e2e:release`, `test:e2e:activity`, `test:e2e:m2`, klik-tembus manual, Delivery Gate antislop.

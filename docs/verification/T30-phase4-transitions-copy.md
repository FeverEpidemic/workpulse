# T30 Fase 4: transisi dan copy

- Tanggal: 22 Oktober 2026. Status: COMPLETE untuk implementasi dan unit. DOM, Escape/fokus dan satu toast dibuktikan Fase 5.
- Tujuan: menandai perubahan lapisan, konteks halaman dan lokasi catatan tersimpan dengan gerak singkat.

## File

globals.css, toast.tsx, mobile-chrome.tsx, activity-list.tsx, dashboard-view.tsx; baru workspace/template.tsx dan ui/just-added-highlight.tsx; test toast-lifecycle, just-added-highlight, motion-copy, tambahan pasangan di theme-contrast; plan dan receipt ini. Tidak ada token warna baru.

| Command | Exit | Hasil |
| --- | --- | --- |
| tiga test baru sebelum implementasi | 1 | 2 test toast fail, 2 suite gagal import template/helper yang belum ada |
| tiga test baru plus motion-tokens setelah implementasi | 0 | 4 file / 21 test pass |
| `pnpm test -- tests/unit/theme-contrast.test.ts` | 0 | 6 test pass, termasuk teks primary/secondary pada highlight dua tema |
| `pnpm test` | 0 | 147 file / 1335 test pass, 0 fail |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | 0 error / warning lint |
| `git diff --check` | 0 | tanpa whitespace error |

## Bukti dan alasan

- Toast diberi data-leaving pada 4380 ms dan dilepas 4500 ms. Dua timer dibersihkan saat unmount. Fake timers membuktikan batas 4379/4380/4499/4500 ms.
- Dialog native memakai starting-style, display/overlay allow-discrete, masuk 180 ms dan keluar 120 ms. Sheet bergerak searah asalnya dari bawah, masuk 240 ms dan keluar 180 ms. Close tetap native, tanpa perubahan Dialog atau penundaan close JS.
- Template berada di dalam layout workspace untuk menganimasikan hanya konten halaman. Unit membuktikan wrapper tepat; remount saat route dan tidak saat filter masih E2E.
- Marker Quick log menyimpan hanya ID dan waktu sebelum close/refresh. ActionFeedback tetap satu sumber toast. Parser marker menolak JSON rusak, tipe salah, timestamp masa depan, ID berbeda dan umur 10 detik atau lebih. Daftar /activity dan recent dashboard menandai row yang cocok lalu menghapus key. Effect membaca ulang saat daftar IDs berubah setelah refresh.
- Highlight sage menghubungkan catatan baru dengan posisinya. Teks pada primary-100 light dan primary-800 dark diukur >=4.5:1. Tidak mengubah palet.
- Accordion yang sudah berupa details/summary dalam workspace memakai details-content dengan tinggi/opacity singkat. Browser yang belum mendukung interpolate-size tetap membuka/menutup native. Details import di luar frame tidak diberi transisi.
- Reduced motion mematikan animasi halaman, toast, highlight dan transisi details-content; aturan global serta indikator statis Fase 2 tetap.

## Audit copy antislop-copywriting

Lima key baru dari Fase 2 menjadi copy final: Loading this page, Still loading dan Reload; waktu tunggu dan peringatan proses lama. En/id berada di messages.ts dan diuji tanpa U+2014. Key tahap lama dipakai ulang sehingga tidak menggandakan label atau mengganti kontrak job. Bahasa langsung menyebut memuat, menunggu dan tindakan muat ulang, tanpa angka progress/ETA atau klaim baru. Draf tidak memerlukan revisi setelah audit.

Tidak ada assertion lama diubah pada fase ini. Warning MDX/mock hook sama dengan baseline. Tidak ada blocker atau perubahan keputusan plan. Berikutnya Fase 5, native E2E, screenshot, aksesibilitas, regresi seluruh daftar, lalu Delivery Gate antislop sebelum berhenti untuk review Claude.

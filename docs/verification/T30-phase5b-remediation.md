# T30 Fase 5b: remediasi gate review

- Tanggal: 23 Oktober 2026.
- Pelaksana: **Claude** (Opus), atas permintaan pengguna ("Lanjut remediasi RV1"). Pelaksana Fase 0 sampai 5 adalah ChatGPT Sol 6.1; perbaikan ini ditulis oleh reviewer yang sama, jadi independensi review ulang terbatas (lihat bagian akhir).
- Branch: `claude/t30-motion-loading`, dasar `511714e`.
- antislop: during (session override).
- Rujukan: [T30-review-remediation-plan.md](T30-review-remediation-plan.md) RV1 dan N3.

## Tujuan

Menutup RV1 (P2): animasi masuk halaman tidak boleh diputar ulang setelah hydration pada pemuatan dokumen penuh. Mencatat konfirmasi N3.

## Perubahan

- `src/app/(workspace)/template.tsx`: keputusan animasi pindah dari `useLayoutEffect` + sessionStorage/`document.referrer` ke render. `useSyncExternalStore` dengan snapshot server `true` menandai mount saat hydration; `useState` menyimpan keputusan sekali per mount. HTML server sekarang membawa `data-page-enter="false"`, sehingga halaman yang sudah ter-paint tidak pernah diputar ulang. Template yang di-mount oleh navigasi client membawa `"true"`. Filter GET memuat ulang dokumen, jadi tetap tidak beranimasi. `shouldEnterWorkspace(hydrating)` menggantikan versi berbasis path.
- `tests/unit/motion-copy.test.tsx`: test keputusan baru dan markup server dengan `data-page-enter="false"`.
- `tests/e2e/motion-loading.spec.ts`: test page entry kini me-reset counter setelah sign-in, memuat `/activity` sebagai dokumen penuh, dan mengharapkan **0** animasi, filter GET tetap 0, klik sidebar Projects tepat 1 dengan `data-page-enter="true"`. Versi lama mengharapkan animasi setelah pemuatan penuh, yang mengunci bug.
- `tests/e2e/helpers/accessibility.ts`: komentar disesuaikan; logika tunggu tidak berubah.

## TDD

| Langkah | Command | Exit | Hasil |
| --- | --- | --- | --- |
| Test diubah, sebelum implementasi | `pnpm exec vitest run --configLoader native tests/unit/motion-copy.test.tsx` | 1 | 2 gagal / 2 lulus (keputusan dan markup) |
| Setelah implementasi | command yang sama | 0 | 4 lulus |

## Verifikasi

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 149 file / 1347 test |
| `pnpm build` | 0 | compiled |
| probe `.tmp/t30-review-probe.spec.ts` (build baru) | 0 | `/activity` FCP 428 ms tanpa `animationstart ui-page-enter`; `/dashboard` FCP 308 ms tanpa animasi. Sebelumnya `/activity` beranimasi di 428.5 ms setelah FCP 380 ms |
| release suite (`.tmp/playwright.t30-reuse-build.config.ts`, testMatch sama dengan `playwright.release.config.ts`) | 1 | 41 passed, 1 failed (9.1 menit). Yang gagal test page entry baru: `Expected: 0, Received: 1`, karena counter sessionStorage ikut menghitung navigasi client dari sign-in ke `/dashboard` (animasi yang memang benar). Kesalahan ada di test, bukan di perbaikan |
| test page entry setelah counter di-reset sebelum `page.goto("/activity")` (`-g "page entry"`, build yang sama) | 0 | 1 passed (8.0 dtk) |
| `pnpm test:e2e:ui` | 0 | 1 passed (55.3 dtk) |
| `pnpm lint --ignore-pattern ".claude/**"`, `pnpm typecheck` setelah perbaikan test | 0 | bersih |

Perbaikan terakhir hanya mengubah satu test E2E. Ke-41 test lain di run release penuh berjalan dengan kode produk yang sama, jadi run penuh tidak diulang.

Env Supabase lokal hanya di proses; env var AI dikosongkan; screenshot T25/T27/T30 yang ditulis ulang suite dipulihkan dari HEAD.

## Acceptance

- Acceptance 12 tetap terbukti, kini dengan syarat tambahan: pemuatan dokumen penuh tidak memutar animasi (E2E page entry).
- Checklist §9 "Chrome tidak ikut animasi; filter URL tidak memicu animasi": PASS untuk navigasi client dan pemuatan dokumen penuh.
- Delivery Gate antislop butir yang terdampak: R-19 (motion bertujuan, tanpa replay) dan C-4 (resilience saat pemuatan penuh) PASS dengan bukti probe dan E2E di atas. Butir lain tidak tersentuh perubahan ini.

## N3

Pengguna mengonfirmasi di chat reviewer pada 23 Oktober 2026: "Ya, persetujuan perubahan kontrak navigasi pending itu dari gue." N3 ditutup.

## Batas

Perbaikan dan review ulangnya dikerjakan oleh orang yang sama. Untuk mengimbangi, bukti utamanya adalah probe yang menangkap bug sebelum perbaikan dan lolos sesudahnya, plus unit yang dijalankan gagal dulu. E2E page entry yang baru tidak dijalankan terhadap kode lama; ekspektasinya (0 animasi pada pemuatan penuh) bertentangan langsung dengan hasil probe pada kode lama. Belum diuji di Safari/Firefox atau perangkat fisik.

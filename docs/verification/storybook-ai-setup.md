# Storybook AI setup: bukti lokal

Tanggal: 10 Oktober 2026. Status: **DONE** untuk scope tooling yang diminta pengguna.

## Hasil

Preview memuat CSS WorkPulse, Plus Jakarta Sans, `ToastProvider` dan `UnsavedChangesProvider` dalam urutan aplikasi. Globals menyediakan tema light/dark dan locale en/id. Story props berbahasa tertentu tetap eksplisit; locale tidak otomatis menerjemahkan args. Framework menyediakan App Router mock.

MSW addon terdaftar di main config dan memakai `mswLoader()` serta hook `beforeEach`. Worker disajikan dari public. Handler array kosong karena semua target tidak memanggil endpoint; tidak ada fetch mock, catch-all, browser-state seed, portal tambahan atau tanggal tiruan.

Tujuh file story memakai komponen asli: Button (7), Badge (5), Input (4), Textarea (3), Select (4), Dialog (3), RevisionConflict (3). Total **29**. Semua metadata bertag `ai-generated`; seluruh `needs-work` dihapus setelah file masing-masing lulus. Tepat satu `CssCheck` di Button membuktikan warna primary **rgb(86, 118, 87)** dan min-height **44px** dari token CSS.

Play functions menguji aktivasi tombol lewat keyboard, disabled/aria-busy saat loading, input teks, accessible error description, pilihan status, accessible group label, native close request, dismiss dialog dan focus return. Variant statis tidak menambah play redundan.

## Checks aktual

| Command/check | Hasil |
| --- | --- |
| `npx storybook ai setup` | Exit 0, instruksi setup dicetak; command deprecated |
| `npx storybook add msw-storybook-addon@3` | Addon terdaftar setelah perbaikan build allowlist |
| `pnpm add -D -E msw@2.15.0 msw-storybook-addon@3.0.3` | Exit 0; package dan lockfile akhirnya dipin exact |
| `pnpm exec msw init ./public --save` | Exit 0; worker dan workerDirectory dibuat |
| `pnpm exec playwright install chromium` | Exit 0; Chromium 1248 tersedia |
| `npx vitest --project storybook run` final | Exit 0; 7 file, 29 test lulus |
| `pnpm typecheck` final | Exit 0 |
| `pnpm lint` final | Exit 0 |
| `pnpm build-storybook` | Exit 0; static bundle berhasil |
| QA Playwright terhadap static bundle | 28 render, light/dark, 360/1440px; tanpa horizontal overflow |
| Native Escape/focus return | Lulus pada empat kombinasi viewport/tema |
| Inspeksi screenshot | Delapan screenshot input invalid dan dialog; label, error text, focus ring, reflow dan kedua tema terbaca |
| Contrast checker primary | White/#567657: 5,09:1; #111613/#8faf87: 7,53:1; keduanya AA normal text |
| `git diff --check` | Exit 0 |

## Failure yang diselesaikan

- Sandbox registry DNS unavailable: install diteruskan dengan akses jaringan yang disetujui automatic review.
- CLI memakai pnpm sesuai repo walaupun prompt menyebut npm. Tidak membuat lockfile npm. Build script esbuild yang semula belum dipilih diizinkan; postinstall MSW dinonaktifkan karena worker dibuat eksplisit.
- MSW latest 3 tidak cocok peer Vitest mocker. Dipin ke MSW 2.15.0; addon tetap 3.0.3.
- Batch pertama berhenti sebelum test karena executable Chromium belum ada. Browser dipasang lalu seluruh story diuji bersama.
- Synthetic `userEvent.keyboard` tidak menjalankan native Escape default browser. Play memakai `HTMLDialogElement.requestClose()` dan explicit dismiss; Escape keyboard nyata diuji terpisah dengan Playwright. Komponen aplikasi tidak diubah.
- Lint awal melaporkan contoh scaffold `Page.tsx` dan eslint-disable pada vendored worker. Contoh scaffold dihapus setelah story aplikasi lulus; vendored worker dan static build dikecualikan dari lint.
- QA awal memakai locator tombol terlalu luas dan ikut cocok tombol pada dialog provider yang tertutup. Locator diperjelas; 28 render final lulus.

Script evaluasi dan screenshot sementara dibersihkan setelah inspeksi, sesuai cleanup CLI. Tidak ada debug mocks/dependency tanggal yang tersisa.

## Delivery gate antislop

- **Hard Gate PASS:** 29 story lulus, CSS computed check lulus, 28 render tanpa overflow, Escape/focus nyata lulus, label status dan error berupa teks; tidak ada konten karier atau klaim pelanggan buatan.
- **Purpose-Gate PASS:** warna sage, font, spacing 4px dan radius menggunakan CSS aplikasi; tidak menambahkan dekorasi, gradient, icon family, layout halaman atau motion baru. Alasannya: katalog harus menampilkan primitives WorkPulse yang nyata.
- **Liveliness PASS:** ENERGY 1 / RHYTHM 1 / MOTION 1, satu target per story, field/dialog sesuai komposisi asli; sage menandai aksi utama dan typography/radius konsisten dengan Design.md.
- **Craftsmanship PASS:** TypeScript, lint dan static build lulus; input, select, keyboard tombol, native close/dismiss dan focus return diverifikasi; screenshot light/dark pada 360/1440px telah diinspeksi. UI produk tidak diubah.

## Batas

Ini katalog shared primitives lokal, bukan story seluruh halaman produk atau integrasi Supabase. Handler MSW belum memiliki endpoint sampai story yang memerlukan data jaringan ditambahkan. Tidak mengklaim release readiness, production integration, perangkat fisik/on-screen keyboard atau audit WCAG seluruh produk.

Warning nonfatal masih berasal dari bootstrap/tooling: `__dirname` dengan native Vite config, Vite mock-interceptor hook, pola MDX yang belum berisi file, directive `use client` di static bundle, ukuran chunk dan peer TypeScript 6 versus `tsconfck` ^5. Tidak mengganti dependency TypeScript aplikasi. Build dan checks yang dicatat tetap lulus.

Jalankan katalog dengan `pnpm storybook`, atau build ulang memakai `pnpm build-storybook`. Regresi Next.js/database/worker/PDF tidak dijalankan karena scope perubahan hanya tooling, konfigurasi preview, dan story. Rujukan S01-S14 dan Design.md berlaku sebagai sumber primitives; hasil ini tidak menggantikan gate R01-R10/F01-F07.

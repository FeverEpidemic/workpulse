# T22 Fase 3 — Halaman S14 `/cv/preview` dan tautan S13

- Tanggal: 7 Oktober 2026
- Pelaksana: Claude Sonnet 5.5
- Basis: `8c4908e` (Fase 2).
- Status: **selesai di level unit, lint, typecheck, dan build produksi**. Perilaku di browser (polling, halaman PDF di canvas, unduhan, fokus, Axe) dibuktikan di Fase 6; sampai itu belum ada bukti browser untuk komponen ini.

## 1. Tujuan

Halaman S14 yang menampilkan revision tersimpan yang persis, blocker dengan tautan ke S13, satu aksi utama eksplisit, status job yang diperbarui otomatis, halaman PDF nyata setelah export, riwayat ringkas, serta tautan *Preview and export* dari S13.

## 2. File berubah

| Aksi | File |
| --- | --- |
| Create | `src/app/(workspace)/cv/preview/page.tsx`, `src/app/(workspace)/cv/preview/loading.tsx` |
| Create | `src/features/cv/cv-export-page.tsx` (klien), `src/features/cv/cv-pdf-pages.tsx` (klien), `src/features/cv/cv-export-page-state.ts` (murni), `src/features/cv/pdfjs-build.d.ts` |
| Modify | `src/features/cv/cv-preview.tsx` (slot `action`, komponen `CvExportLink`), `src/features/cv/cv-builder.tsx`, `src/features/cv/cv-builder-state.ts` (`previewLinkState`), `src/features/cv/cv-panels.tsx` (`id="cv-profile"`) |
| Modify | `src/domain/routes/safe-return.ts` (`/cv/preview` diizinkan sebagai `returnTo`), `src/i18n/messages.ts` (en dan id), `src/app/globals.css` |
| Create (test) | `tests/unit/cv-export-page-state.test.ts`, `tests/unit/cv-export-page-ui.test.tsx` |
| Modify (test) | `tests/unit/cv-export-i18n.test.ts` (blok baru untuk kunci S14, tanpa mengubah test T21) |

## 3. Perilaku yang diimplementasikan

- **Route.** `requireCompletedWorkspace("/cv/preview")`; membaca `getCv()` (tanpa `ensure()`, jadi tidak pernah membuat CV), `getReadiness()`, dan `listExports(5)` secara paralel. Tanpa CV → `EmptyState` dengan tautan ke `/cv`. Gagal → `InlineError` dengan correlation ID dan *Try again*. Model preview = `buildCvPreviewModel({ document, items })` dari baris tersimpan; draft S13 tidak pernah sampai ke S14. `nowIso` dari server dipakai untuk menentukan kedaluwarsa agar server dan browser sepakat.
- **Header panel.** *Saved revision N* (dari `cv_documents.revision`), badge bahasa CV, judul CV, tautan *Back to CV builder*.
- **Blocker.** Daftar tautan berlabel teks per blocker sesuai `blockerLink`; *Export PDF* tetap fokusable dengan `aria-disabled="true"` dan `aria-describedby` ke alasan terlihat (`cv.export.error.blocked`).
- **Satu aksi utama** dari `exportActions` untuk export terbaru (Export/Download/Retry/Regenerate/Open builder). `expected_revision` = revision yang ditampilkan; kunci idempotency baru dibuat `crypto.randomUUID()` per klik; klik ulang saat berjalan diabaikan (`inFlight`) dan tombol `loading`.
- **Hasil aksi.** `classifyExportResult` memetakan hasil action: `started` (langsung polling status), `download` (anchor sementara + klik, URL tidak disimpan), `stale` (notice + *Reload*, tanpa request ulang), `inProgress` (notice + refresh), `blocked` (memperbarui daftar blocker dari `latestRecord`), `gone` (alasan + refresh), `signedOut` (refresh → redirect server), `failed` (kode + correlation ID).
- **Polling.** `GET /api/cv/exports/[id]` dengan jeda `[1000, 2000, 4000, 8000, 16000, 30000]`; berhenti saat terminal, saat tab tersembunyi (`useSyncExternalStore` pada `visibilitychange`), dan saat unmount; kegagalan jaringan mempertahankan status terakhir; saat berubah ke terminal memanggil `router.refresh()`. Status dibaca lewat `role="status"` `aria-live="polite"` (teks + ikon, bukan warna saja); fokus dipindahkan ke area status setelah request berhasil dan ke notice setelah galat.
- **Riwayat.** Maksimal lima export: revision, label *Earlier revision*, status (teks), waktu di timezone profil (`formatExportTime`, `suppressHydrationWarning`), jumlah halaman, serta hanya aksi *Download*/*Retry* yang sah per baris.
- **Halaman PDF.** `CvPdfPages` hanya untuk export `succeeded` yang belum kedaluwarsa (yang terbaru). Mengambil URL `inline` lewat action, `fetch(url, { cache: "no-store", credentials: "omit" })`, memuat `pdfjs-dist/build/pdf.mjs` secara dinamis dengan worker `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`, lalu menggambar halaman ke satu `canvas` `role="img"` berlabel *Page n of N of the exported PDF* dengan skala sesuai lebar kolom (DPR ≤ 2). Kontrol *Previous page*/*Next page* (`aria-disabled` di ujung, fokus dipindah ke tombol lain saat mencapai ujung) dan *Page n of N* (`aria-live`). Gagal → pesan + *Try again* tanpa menyentuh *Download PDF*. `destroy()` saat unmount; byte tidak disimpan. Export revision lama diberi *Earlier revision* dan penjelasan.
- **S13.** Tautan *Preview and export* di header preview S13 (`CvExportLink`); selama `status !== "saved"` (unsaved, saving, conflict) menjadi tombol `aria-disabled` dengan alasan terlihat *Save your changes first.* lewat `aria-describedby`. Panel profil mendapat `id="cv-profile"` (anchor `NAME_REQUIRED`).
- **Navigasi dan returnTo.** `isCurrent("/cv/preview","/cv")` sudah benar (tanpa perubahan); proxy sudah melindungi `/cv/:path*`.

## 4. Penyimpangan dari plan (untuk reviewer)

1. **Halaman PDF ditampilkan satu per satu.** Plan §2.2.2 menyebut satu canvas per halaman dengan render lazily aktif ± 1. Saya memakai satu canvas untuk halaman aktif dengan *Previous*/*Next*: lebih sederhana, memori terkendali, dan semua halaman dapat dicapai dan di-screenshot satu per satu. Implikasi: acceptance §1.6 "setiap halaman ke canvas berlabel" dipenuhi berurutan lewat navigasi; E2E Fase 6 akan melewati setiap halaman. Nama komponen, test id, dan kunci i18n tidak berubah. Reviewer dapat menolak dan meminta tampilan bertumpuk.
2. **`id="cv-profile"` di `cv-panels.tsx`**, bukan di `cv-builder.tsx`/`cv-preview.tsx` seperti tertulis §3.3 (panel profil memang ada di `cv-panels.tsx`).
3. **`src/domain/routes/safe-return.ts`** tidak tercantum di §4, tetapi acceptance §1.1 ("Anonim → sign-in dengan `returnTo` yang aman") memerlukan `/^\/cv(?:\/preview)?$/` (temuan G1 Fase 0). Perubahan satu baris dan aditif; test baru ada di `cv-export-page-state.test.ts` (tanpa mengubah `auth-routing.test.ts`).
4. **`src/features/cv/pdfjs-build.d.ts`** (G2): shim tipe untuk `pdfjs-dist/build/pdf.mjs`, bukan dependency.
5. **`isEvalSupported` tidak dikirim** (G3): opsi itu tidak ada di pdfjs-dist 6.3.289.
6. **File test tambahan** `tests/unit/cv-export-page-ui.test.tsx` (render statis keadaan S14) di luar daftar §4; polanya sama dengan `cv-builder-ui.test.tsx`.
7. **Perubahan `cv-builder-state.ts`** (fungsi `previewLinkState`) termasuk pengecualian stop condition §8 untuk state builder tautan S13.

## 5. TDD dan bukti

RED: `vitest run cv-export-page-state cv-export-i18n` → modul `cv-export-page-state` tidak ada, 3 test i18n gagal (`undefined.trim`).

GREEN: `cv-export-page-state` (29), `cv-export-i18n` (+3), `auth-routing` tetap lulus (62 test pada tiga file); `cv-export-page-ui` 17 test render statis.

Uji kekuatan test UI (mutasi sementara pada `cv-export-page.tsx`, lalu dipulihkan):

| Mutasi | Hasil |
| --- | --- |
| tombol Export tidak lagi `aria-disabled` saat blocked | `2 failed | 15 passed` |
| halaman PDF juga ditampilkan untuk export kedaluwarsa | `1 failed | 16 passed` |
| dipulihkan | `17 passed` |

## 6. Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm test` | exit 0, **103 file / 953 test** (sebelumnya 101 / 904: +2 file, +49 test) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (`--max-warnings 0`) |
| `pnpm build` | exit 0 (`Compiled successfully`), route `ƒ /cv/preview` dan `ƒ /api/cv/exports/[id]` terdaftar |

Dua temuan selama pengerjaan, keduanya diperbaiki sebelum commit: `Button` tidak menerima `ref` (tombol navigasi halaman memakai `<button className="button-secondary">`), dan aturan lint `react-hooks` melarang menutup `run` yang membaca ref di dalam helper render (aksi dipindah ke komponen modul `ActionButton`).

## 7. Acceptance §1 yang dibuktikan di fase ini (unit/statis saja)

- **§1.1:** `returnTo=/cv/preview` aman dan sekitarnya ditolak (unit); navigasi aktif (baca source). E2E menyusul.
- **§1.2:** halaman hanya memakai baris tersimpan dan `expected_revision` = revision yang ditampilkan (baca source + render statis); konflik dua tab menyusul E2E.
- **§1.3:** state tautan S13 (unit) dan teks alasan; E2E menyusul.
- **§1.4:** tautan blocker per kode (render statis), tombol dengan alasan.
- **§1.5:** aturan polling dan klasifikasi hasil (unit); perilaku nyata menyusul E2E.
- **§1.8, §1.9:** aksi dan riwayat (render statis); E2E menyusul.
- **§1.18:** tidak ada `console.` pada kode baru (lihat §8).

Belum dibuktikan: §1.6 (canvas berpiksel di browser), §1.7 sisi browser (event download), §1.15, §1.16 E2E, dan lainnya.

## 8. Warning dan blocker

Tidak ada blocker dan tidak ada stop condition. Belum ada pengamatan di browser nyata untuk S14; risiko terbesar yang akan diuji Fase 6 adalah polling/fokus dan penggambaran canvas. `grep console.` pada `src/features/cv`, `src/app/(workspace)/cv`, `src/app/api/cv`, `src/domain/cv`, `src/server/export`: 0 hit.

## 9. Langkah berikutnya

Fase 4: QA PDF nyata di `tests/pdf/` (fixture, helper analisis posisi teks pdf.js, sapuan ≥ 24 varian, `vitest.pdf.config.ts`, script `test:pdf`) terhadap renderer `workpulse-t21-pdf`; ubah template hanya bila test membuktikan perlu.

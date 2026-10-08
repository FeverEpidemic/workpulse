# T21 Fase 3 — Template cetak dan adapter PdfRenderer

- Tanggal: 6 Oktober 2026
- Status: **PASSED**
- Commit: `feat(t21): add single-column print template and PDF renderer adapter`

## Tujuan

Template HTML cetak `single_column_v1` yang murni dan aman (escape penuh, tanpa script/resource), serta adapter
`PdfRenderer` (Gotenberg Chromium, unavailable default, fake khusus dev/test) dengan resolusi fail-closed.

## File berubah

- `src/server/export/cv-print-template.ts` (baru; `renderCvPrintHtml(model)`)
- `src/server/export/pdf-renderer.ts` (baru; `PdfRenderer`, `UnavailablePdfRenderer`, `ExplicitTestFakePdfRenderer`,
  `GotenbergPdfRenderer`, `resolvePdfRenderer`)
- `tests/unit/cv-print-template.test.ts` (13 test), `tests/unit/pdf-renderer.test.ts` (11 test)
- `tests/unit/cv-fixtures.ts` (tambah `richCvFixture`, dipindahkan dari test Fase 2), `tests/unit/cv-export-domain.test.ts`
  (memakai fixture bersama)
- `docs/verification/T21-implementation-plan.md` (checkbox Fase 3), receipt ini

## Command dan hasil

| Command | Exit | Hasil aktual |
| --- | --- | --- |
| `vitest run … cv-print-template.test.ts pdf-renderer.test.ts` (sebelum implementasi) | 1 | **FAIL**: 2 file gagal dimuat (modul belum ada), domain 15 passed |
| `vitest run … cv-print-template.test.ts pdf-renderer.test.ts` (run pertama setelah implementasi) | 1 | 2 failed / 22 passed — keduanya kesalahan test (substring "Analis" bertabrakan dengan "Analis Data Senior"; `nodeEnv: undefined` jatuh ke `NODE_ENV=test` vitest) |
| idem (setelah perbaikan test) | 0 | **24 passed** (13 + 11) |
| `pnpm typecheck` | 0 | tanpa error (setelah mengetik instance sebagai `PdfRenderer` di test) |
| `pnpm lint` | 0 | tanpa warning |
| `pnpm test` | 0 | **92 file / 753 test passed** (Fase 2: 90 / 729) |
| `node scratchpad/smoke-template.mjs` (di luar suite, renderer nyata `workpulse-t21-pdf`) | 0 | template fixture `id` → `GotenbergPdfRenderer` → PDF 23.640 byte, 1 halaman, teks Indonesia utuh, bullet `Rp1,5 miliar — “tepat waktu”` terekstrak |
| `grep console. src/server/export` | — | 0 kecocokan |

## Acceptance yang terbukti pada fase ini

- Template: `<html lang>` mengikuti locale CV; CSP `default-src 'none'; style-src 'unsafe-inline'`; tanpa `script`,
  `link`, `img`, `iframe`, `object`, `embed`, `form`, `a`, `svg`, `href/src/action=`, `url(`, `@import`, `@font-face`;
  website tercetak sebagai teks; semua nilai di-escape (judul, nama, headline, summary, phone, location, judul dan
  bullet achievement, nama skill; payload `<script>` tidak pernah mentah); heading section sesuai `CV_LABELS` locale CV;
  nama, headline, kontak (`email · phone · location · website`), summary tepat sekali dan berurutan; setiap entry dan
  child tepat sekali dengan wording efektif (override menggantikan sumber); achievement bersarang di project; entry
  deleted tidak dicetak; `credential_url`, item id, source id, dan kata `evidence` tidak pernah tercetak; bagian kosong
  tidak menghasilkan tag kosong; tanpa nama → tanpa `<h1>`; `@page { size: A4; margin: 16mm 18mm; }`, font stack
  `'Noto Sans', sans-serif`, `break-after: avoid` pada `h2`, `break-inside: avoid` pada `.entry` dan `.child`,
  `white-space: pre-line`; deterministik.
- Renderer: default `unavailable`; mode asing, URL tidak valid (ftp, kredensial, query, fragment, host publik http,
  string bukan URL), dan timeout di luar 1.000–90.000 ms atau bukan bilangan bulat → `unavailable` (fail closed);
  loopback, localhost, host tanpa titik, dan https diterima; fake ditolak untuk `production`, `staging`, dan tanpa
  `NODE_ENV`, diterima untuk `development`/`test`; Gotenberg mengirim tepat satu part `files` bernama `index.html`
  (`text/html`) dengan field `paperWidth=8.27`, `paperHeight=11.7`, `preferCssPageSize=true`, `printBackground=false` ke
  `/forms/chromium/convert/html` (trailing slash dinormalkan); respons non-OK dan kegagalan jaringan →
  `RENDERER_UNAVAILABLE` (isi respons tidak dibawa); timeout sendiri dan abort pemanggil → `RENDERER_TIMEOUT`; bukan
  `%PDF-`, kosong, tanpa body, atau melebihi batas → `EXPORT_RENDER_INVALID`.
- Fake: PDF A4 (`/MediaBox [0 0 595 842]`) yang lolos `parseInThread("pdf")` dengan nama non-ASCII, bullet Indonesia,
  dan heading Indonesia utuh; dokumen panjang menjadi banyak halaman; entitas HTML didekode dan blok style/tag dibuang.

## Catatan

- Fake menulis teks Helvetica WinAnsi (cp1252); karakter di luar cp1252 menjadi `?`. Ini hanya alat uji pipeline,
  bukan bukti layout/font (QA visual milik T22).
- `readLimited` disalin secara privat ke `pdf-renderer.ts`; `docx-renderer.ts` (T15) tidak disentuh.
- Template memakai `<h3>` untuk judul entry (struktur tagged-PDF yang wajar); inspeksi visual (heading yatim,
  clipping) tetap milik T22.
- Belum dibuktikan: render panjang/multipage dan A4 nyata lewat renderer nyata (Fase 6, test renderer nyata).

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 4: worker `workers/export-worker.ts`, gateway Supabase, pendaftaran di `workers/run.ts` dan
`workers/bootstrap.ts`, `.env.example`; termasuk keputusan verifikasi teks tanpa ambang import (lihat receipt Fase 0).

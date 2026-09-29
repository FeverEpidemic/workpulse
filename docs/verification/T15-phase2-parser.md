# T15 Fase 2 — Inspeksi dan parser (receipt)

Tanggal: 29 September 2026.

Tujuan: inspeksi upload, reader OOXML bersama, parser PDF/DOCX di `worker_threads` dengan timeout dan batas memori, dan adapter renderer DOCX.

## File berubah

- Baru: `src/domain/import/contracts.ts`, `src/server/documents/{ooxml-zip,import-file-inspection,docx-text,pdf-text,parser-thread,parse-in-thread,docx-renderer}.ts`
- Baru (test): `tests/import-fixtures.ts`, `tests/unit/{import-file-inspection,docx-text,parse-in-thread,docx-renderer}.test.ts`, `tests/unit/fixtures/parser-{hang,oom}-thread.ts`, `tests/integration/import-renderer-real.test.ts`
- Diubah: `src/features/evidence/file-inspection.ts` (reader ZIP dipindah ke `ooxml-zip.ts`; perilaku dan kode error sama), `package.json`/`pnpm-lock.yaml` (`pdfjs-dist` 6.3.289 exact), `pnpm-workspace.yaml` (`ignoredOptionalDependencies: @napi-rs/canvas`)

## Dependency

- `pdfjs-dist@6.3.289` (Apache-2.0, `engines.node >=22.13.0 || >=24`), dipasang dengan `pnpm add -E`.
- pdf.js mendeklarasikan `@napi-rs/canvas` sebagai optional dependency dan memanggil `require()` padanya saat dimuat di Node, hanya untuk polyfill `DOMMatrix`/`Path2D` (rendering). Ekstraksi teks tidak membutuhkannya. Supaya parser tetap murni JavaScript (stop condition plan: tanpa binary native), paket itu dikecualikan lewat `ignoredOptionalDependencies`; setelah reinstall `@napi-rs/canvas` tidak dapat di-resolve dari pdf.js. Peringatan pdf.js dibisukan di thread parser sebelum library dimuat.
- pdf.js v6 tidak lagi mengompilasi kode dengan `eval`/`new Function` (tidak ada di `pdf.worker.mjs`), sehingga opsi `isEvalSupported` tidak ada lagi di tipe `DocumentInitParameters`. Opsi yang dipakai: `enableXfa: false`, `isImageDecoderSupported: false`, `disableFontFace`, `useSystemFonts: false`, `useWorkerFetch: false`, `isOffscreenCanvasSupported: false`, `disableAutoFetch`, `disableStream`, `stopAtErrors`, verbosity ERRORS.

## Hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/{import-file-inspection,docx-text,parse-in-thread}.test.ts` | 21/21 (setelah perbaikan di bawah) |
| `vitest run tests/unit/evidence-file-inspection.test.ts` | 4/4, assertion tidak diubah |
| `vitest run tests/unit/docx-renderer.test.ts` | 5/5 (server HTTP lokal palsu) |
| `vitest run --config vitest.integration.config.ts tests/integration/import-renderer-real.test.ts` | 2/2 terhadap Gotenberg 8.37.0 nyata: DOCX 2 halaman → 2 (metadata 9), DOCX 21 halaman → 21 (metadata 1) |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 61 file / 383 test |

## Kegagalan yang ditemukan dan diperbaiki

1. Semua jalur PDF di thread menghasilkan `CORRUPT_FILE`. Penyebab: `PDFDocumentProxy.destroy()` tidak ada di pdf.js v6; exception di `finally` membuat thread melaporkan kegagalan. Diganti `loadingTask.destroy()`. Didiagnosis dengan entry thread debug sementara yang sudah dihapus.
2. Lint: directive `eslint-disable no-control-regex` yang tidak diperlukan dihapus.
3. Typecheck: opsi `isEvalSupported` dihapus (lihat di atas).

## Acceptance yang terbukti

- §1.4 inspeksi upload: kosong, >10 MiB, PNG/JPEG/teks, ZIP non-Word, DOCX macro (`vbaProject.bin` dan content type `macroEnabled`), CFB `EncryptedPackage` → `ENCRYPTED_FILE`, CFB lain → `UNSUPPORTED_FORMAT`, DOCX terpotong → `CORRUPT_FILE`.
- §1.5 parser: PDF teks (2 halaman), 21 halaman → `TOO_MANY_PAGES`, terenkripsi → `ENCRYPTED_FILE`, image-only → `SCANNED_PDF`, terpotong → `CORRUPT_FILE`, DOCX kosong → `EMPTY_DOCUMENT`.
- §1.6 batas: ZIP bomb (51 MiB deklarasi) → `FILE_TOO_LARGE` sebelum inflate penuh; ukuran nyata melebihi deklarasi → ditolak; thread tanpa jawaban dihentikan (`PARSER_TIMEOUT` < 5 detik); thread kehabisan heap (32 MB) → `CORRUPT_FILE` dan proses test tetap hidup lalu parse berikutnya berhasil.
- §1.2 bagian renderer: jumlah halaman DOCX dari rendering LibreOffice nyata, bukan `docProps/app.xml`. (Alur batch penuh DOCX → review dibuktikan di Fase 4.)
- Thread parser berjalan dengan `env: {}` (tidak mewarisi secret worker) dan stdout/stderr dibuang.

## Catatan

- TDD tidak sepenuhnya urut pada fase ini: modul parser ditulis sebelum test-nya dijalankan pertama kali. Kegagalan nyata (butir 1) tetap tertangkap test sebelum commit.
- Renderer fake menghitung `1 + jumlah <w:br w:type="page"/>` (bukan penanda `WP-FAKE-PAGES` di plan) agar fixture yang sama berperilaku sama di fake dan di LibreOffice nyata.
- URL renderer `http://` diizinkan untuk loopback dan hostname tanpa titik (nama service Docker internal); selain itu wajib `https://`.

Berikutnya: Fase 3 (domain import dan provider).

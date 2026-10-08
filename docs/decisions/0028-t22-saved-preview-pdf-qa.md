# Decision 0028 — T22 Saved preview dan PDF QA

Date: 8 Oktober 2026

Status: accepted for WorkPulse MVP v0.1 (local acceptance; see `docs/verification/T22-saved-preview-pdf-qa.md`)

## References

- **PRD:**
  - R10 (*export the saved CV revision as searchable A4 text with correct page breaks; failure preserves the draft and supports retry; evidence is not embedded or linked*);
  - *CV freshness contract*;
  - release scenario *graduate … export a useful CV* dan *delete its source and verify export is blocked until resolved*;
  - *validate PDF text extraction, Indonesian characters, long bullets, and multipage output*.
- **User Flow:** F07 langkah 4–6.
- **Wireframe:** S14 `/cv/preview`.
- **Database Schema:** §5 `cv_exports` (unduhan owner-authorized dan kedaluwarsa).
- **Implementation plan:** §5 T22 dan Gate M4, §6 (matriks R10).
- **Handoff dan review:** handoff `docs/verification/T22-implementation-plan.md`; gate review dan remediasi `docs/verification/T22-review-remediation-plan.md`.
- **Decision terkait:** 0025, 0026, 0027.

## Context

T21 menyediakan backend export tanpa UI: readiness, snapshot immutable, job, renderer Chromium, unduhan pemilik, dan retensi. T22 menambahkan tiga hal:

- layar S14 yang menampilkan revision CV tersimpan yang persis, blocker, aksi export eksplisit, status job, halaman PDF nyata, dan unduhan;
- suite QA PDF terhadap renderer nyata;
- penyesuaian aturan break template yang dibuktikan suite itu.

Tidak ada migration. RPC, SQL, dan worker T18–T21 tidak diubah.

Keenam keputusan produk §2.4 handoff disetujui pengguna pada 6 Oktober 2026 ("Setuju semua"):

1. batas halaman hanya dari PDF nyata, dirender pdf.js di browser setelah export;
2. nama file unduhan generik `WorkPulse-CV-<YYYY-MM-DD>.pdf`;
3. *Retry* hanya untuk revision tersimpan saat ini;
4. riwayat lima export terakhir;
5. polling otomatis dengan jeda bertahap sampai 30 detik;
6. template boleh diubah hanya pada aturan break/spacing.

Verdict gate review dan perbaikan RV1 oleh reviewer disetujui pengguna pada 8 Oktober 2026.

## Keputusan

1. **Dua lapis preview yang tidak dicampur.**
   - **HTML.** `CvPreview` T19 atas `buildCvPreviewModel` dari baris tersimpan selalu tampil sebagai alternatif teks yang dapat diakses.
   - **Halaman PDF.** Tampil hanya untuk export `succeeded` yang belum kedaluwarsa, dengan label *Pages of the PDF for revision N*; *Earlier revision* bila N ≠ revision tersimpan.

   Batas halaman tidak pernah ditaksir dari HTML. *Alasan:* S14 menuntut snapshot persis dan batas halaman, sedangkan HTML layar tidak dipaginasi seperti Chromium cetak.
2. **S14 hanya membaca.** `src/app/(workspace)/cv/preview/page.tsx` memakai `requireCompletedWorkspace("/cv/preview")`, lalu membaca `getCv()` (tanpa `ensure`, sehingga tidak pernah membuat CV), `getReadiness()`, dan `listExports(5)`. Tanpa CV, S14 menampilkan empty state dengan tautan ke `/cv`. Halaman tidak pernah memulai export sendiri. `/^\/cv(?:\/preview)?$/` ditambahkan ke `safe-return.ts` agar `returnTo` dari sign-in aman. *Alasan:* AGENTS (request export adalah aksi eksplisit) dan F07 (preview memakai revision tersimpan yang persis).
3. **Request terikat revision yang ditampilkan.** *Export PDF* dan *Regenerate* mengirim `expected_revision` = revision yang ditampilkan dan idempotency key `crypto.randomUUID()` baru per klik. Klik ulang selama pending ditahan. Hasil `reused: true` diperlakukan seperti sukses. Respons dipetakan sebagai berikut:
   - `STALE_REVISION` → notice *Your CV changed since this page loaded.* + *Reload*, tanpa request ulang otomatis;
   - `EXPORT_IN_PROGRESS` → tampilkan export aktif;
   - `EXPORT_BLOCKED` → daftar blocker diperbarui dari `latestRecord.blockers`.
4. **Aturan aksi murni** (`src/domain/cv/export-view.ts`).
   - `exportActions({ row, savedRevision, readiness, now })` menghasilkan satu aksi utama per keadaan.
   - **Retry:** hanya untuk `failed` dengan kode retriable, `attempt_count < 3`, dan `cv_revision === savedRevision`.
   - **Kode permanen pada revision saat ini:** *Open CV builder* + *Regenerate*.
   - **Regenerate:** untuk export kedaluwarsa atau purged, gagal yang tidak boleh di-retry, dan export revision lama. Aksi ini selalu melewati readiness; bila CV terblokir, tombol `aria-disabled` dengan alasan terlihat.

   *Alasan:* retry mencetak snapshot lama, sehingga setelah CV berubah (sumber dapat sudah dihapus) pengguna harus membuat request baru (0027 N2). Export reuse yang lalu `EXPORT_EXPIRED` kembali menjadi *Regenerate* (0027 N6).
5. **Tautan blocker.** `blockerLink` memetakan kode ke S13:
   - `ITEM_CHANGED`, `ITEM_DELETED`, `ITEM_UNCONFIRMED` → `/cv#cv-item-<id>`;
   - `PROFILE_CHANGED` → `/cv#cv-review`;
   - `NAME_REQUIRED` → `/cv#cv-profile` (anchor baru pada panel profil di `cv-panels.tsx`);
   - kode lain → `/cv`.
6. **Tautan S13 → S14.** *Preview and export* ditempatkan di header preview S13 (`CvExportLink`). Selama status builder ≠ `saved`, tautan menjadi tombol `aria-disabled` dengan alasan terlihat *Save your changes first.* lewat `aria-describedby` (`previewLinkState`).
7. **Route status.** `GET /api/cv/exports/[id]` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, `Cache-Control: no-store`).
   - Memakai sesi server dan `createCvExportService().getExport(id)`: UUID Zod, select kolom aman dengan filter `user_id` di atas RLS, lalu `cvExportRowSchema`.
   - Respons sukses adalah baris itu + `expired`.
   - ID asing, acak, atau bukan UUID mendapat 404 generik yang identik; anonim mendapat 401.
   - Error berisi kode, pesan terlokalisasi, dan correlation ID saja. `object_key`, `attempt_token`, `snapshot`, dan `idempotency_key` tidak pernah dikembalikan.
8. **Polling.** `EXPORT_POLL_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]` ms; nilai terakhir diulang.
   - Polling berhenti di status terminal, saat tab tersembunyi (lanjut pada `visibilitychange`), dan saat unmount.
   - Kegagalan jaringan mempertahankan status terakhir.
   - Saat menjadi terminal, halaman memanggil `router.refresh()`.
   - Status diumumkan di `role="status"` `aria-live="polite"` dengan teks dan ikon, tidak hanya warna.
   - Fokus pindah ke status setelah request dan ke notice setelah galat, setelah render yang menampilkan target.
9. **Signed URL dan nama file (aditif).**
   - `StorageAdapter.createSignedDownloadUrl(objectKey, ttl, options?)` menerima `{ disposition?: "attachment" | "inline"; filename?: string }`. `filename` hanya pola `^[A-Za-z0-9._-]{1,80}\.pdf$`.
   - Tanpa opsi, pemanggil lama tetap memanggil adapter dengan dua argumen (`{ download: true }`).
   - `inline` memakai `createSignedUrl` tanpa `download`.
   - Export service `issueDownload({ export_id, disposition })`: `attachment` (default) diberi nama `exportDownloadName(finished_at)` = `WorkPulse-CV-<YYYY-MM-DD>.pdf` (UTC; tanggal tidak terbaca → `WorkPulse-CV.pdf`), sedangkan `inline` tanpa nama. Nama dan objek tidak dapat dipilih dari form. TTL tetap 300 detik.
   - URL dibuat saat klik dan tidak pernah ada di HTML awal maupun state yang tersisa.

   *Alasan:* objek tanpa ekstensi diunduh sebagai UUID, dan nama pribadi tidak boleh masuk query string signed URL.
10. **Halaman PDF di browser.** `src/features/cv/cv-pdf-pages.tsx` memuat `pdfjs-dist/build/pdf.mjs` secara dinamis dengan worker `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`; probe Fase 0 membuktikan worker terbundel dan bukan *fake worker*.
    - PDF diambil dengan `fetch(inlineUrl, { cache: "no-store", credentials: "omit" })` dan ukurannya dicek ≤ `CV_EXPORT_MAX_BYTES`.
    - `getDocument({ data, useSystemFonts: false, enableXfa: false })`. Opsi `isEvalSupported` tidak ada di pdfjs-dist 6.3.289, dan build browser serta worker-nya tidak memakai `eval`/`new Function`.
    - **Satu canvas untuk halaman aktif** (`role="img"`, *Page n of N*) dengan *Previous page* / *Next page*. Ini penyimpangan kecil dari "satu canvas per halaman" di handoff §2.2.2; reviewer menerimanya sebagai P3 N2.
    - Canvas diberi `aria-busy` selama digambar dan `data-rendered` setelah halaman lengkap.
    - Byte hanya di memori; dokumen di-destroy saat unmount.
    - Gagal → pesan + *Try again*, tanpa memblokir *Download PDF*.
11. **Aturan break template** (`src/server/export/cv-print-template.ts`; hanya aturan break, tanpa perubahan font, warna, struktur, atau model).
    - **`body { overflow-wrap: anywhere }`.** Token tanpa spasi yang lebih lebar dari kolom (URL panjang) sebelumnya membuat Chromium menyusutkan seluruh dokumen sekitar 2/3 dan memotong token. Bukti di receipt Fase 4: font 20 pt tercetak 13,3 pt.
    - **`entry-flow` (RV1).** Entry teratas yang taksiran tinggi minimumnya (`minEntryHeightPt`: 120 karakter per baris, `line-height` 1,45, meta 9 pt, dan margin template, sehingga menjadi batas bawah untuk teks biasa) melebihi area teks A4 (≈ 751 pt) diberi `class="entry entry-flow"`. CSS-nya:

      ```css
      .entry-flow { break-inside: auto; }
      .entry-flow > .entry-meta, .entry-flow > .entry-text { break-after: avoid; }
      ```

      Entry lain tetap `break-inside: avoid`, `.child` tetap utuh, dan `h2`/`h3` tetap `break-after: avoid`.

    *Alasan:* `break-inside: avoid` pada entry yang tidak mungkin muat membuat Chromium memindahkannya utuh ke halaman berikutnya. Pada CV tanpa summary dengan project panjang, halaman 1 hanya berisi nama (celah 732 pt). Experience dengan banyak achievement kontekstual memicu hal yang sama. Uji mutasi membuktikan ketiga bagian aturan diperlukan (receipt Fase 7b).
12. **QA PDF nyata (`tests/pdf/`, `pnpm test:pdf`).**
    - **Jalur render:** fixture → `exportSnapshotFrom` → `buildExportRenderModel` → `renderCvPrintHtml` → `GotenbergPdfRenderer` nyata (`WORKPULSE_PDF_GOTENBERG_URL`, gagal keras tanpa fallback) → pdf.js legacy `getTextContent` dengan posisi.
    - **Analisis:** item dikelompokkan per baris (y ± 1 pt). Heading dikenali dari teks label `CV_LABELS` dan headline model, bukan ukuran font.
    - **Yang dibuktikan:**
      - teks hasil ekstraksi = string model berurutan tanpa sisa;
      - tanpa evidence, `credential_url`, id, atau placeholder tanggal;
      - A4 dan margin ± 2 pt;
      - font tidak diskalakan;
      - sapuan 60 varian tanpa heading yatim dan tanpa entry yang muat terbelah;
      - setiap bullet panjang utuh;
      - celah dasar halaman ≤ child terpanjang + 72 pt;
      - sapuan 36 varian kepala entry yang mengalir;
      - hanya entry > 1 halaman yang ditandai.
    - Suite ini tidak memakai database. Inspeksi piksel ada di E2E: canvas S14 per halaman, dan screenshot diinspeksi reviewer.
13. **Batas searchability Unicode (0027 N4).**
    - Teks Indonesia, aksen Latin, dan kutip melengkung dapat dicari setelah NFKC.
    - Nama Han, Arab, dan Devanagari terender dan lolos cek nama worker `exportTextShowsName`, tetapi tidak cocok maju di teks PDF (Han sebagai radikal, Arab dalam urutan visual, Devanagari lossy). Sisa CV tetap dapat dicari.
    - Tidak diklaim lebih.
14. **Nomor.**
    - Tanpa migration (parity 31/31).
    - Route `ƒ /cv/preview` dan `ƒ /api/cv/exports/[id]`.
    - Kunci i18n `cv.exportPage.*` dan `cv.builder.previewAndExport*` en/id.
    - Unit: `cv-export-view`, `cv-export-page-state`, `cv-export-page-ui`, `cv-export-status-route`, `storage-download-options`, plus perluasan suite T21.
    - Integration `tests/integration/cv-export-preview.test.ts` (masuk `test:integration:cv-export`).
    - QA `tests/pdf/` + `vitest.pdf.config.ts` (`test:pdf`).
    - E2E `tests/e2e/cv-export.spec.ts` + `playwright.cv-export.config.ts` (port 3014) + helper `tests/e2e/helpers/export-worker.ts`.
    - Screenshot `docs/verification/T22-screenshots/`.

## Hal yang diterima dari gate review (P3)

- **N1:** pada keadaan *failed*, kalimat *Your CV is unchanged.* tampil dua kali (badge dan alasan). Follow-up copy.
- **N2:** satu canvas untuk halaman aktif, bukan tumpukan canvas (poin 10).
- **N3:** setiap run `test:e2e:cv-export` menulis ulang screenshot yang di-track. Follow-up: tulis hanya bila diminta env.
- **N4:** *Retry* tidak memeriksa readiness. Sumber yang diedit atau di-unconfirm tanpa menaikkan revision CV tetap dicetak dari snapshot lama; delete sumber menaikkan revision sehingga Retry hilang. Ditinjau di T23 bersama retensi snapshot.
- **N5:** S14 membaca CV, readiness, dan export dengan tiga query paralel. Readiness bisa sesaat milik revision lain, tetapi request dijaga `expected_revision`.
- **N6:** *Retry*, *Regenerate*, dan *Download* di E2E diklik dengan pointer, bukan keyboard. Follow-up test.
- **N7:** flaky bawaan `activity-ui.spec.ts:356`.
- **N8:** kolom preview sticky (warisan S13) memotong screenshot `fullPage`.

## Alternatif yang ditolak

- Estimasi page break dari HTML (tidak akurat).
- Rasterisasi PDF di server (dependency/runtime baru).
- Render PDF preview otomatis saat membuka S14 (job tanpa aksi eksplisit).
- Nama pengguna di nama file (masuk query string).
- *Retry* untuk semua export gagal yang retriable (dapat mencetak sumber yang sudah dihapus).
- Tombol *Check status* manual.
- Mempertahankan template tanpa perubahan dan mencatat pelanggaran sebagai P3.
- Untuk RV1:
  - menghapus `break-inside: avoid` dari semua entry (entry yang muat dapat terbelah);
  - ambang berbasis jumlah child dengan `:has()`/`nth-child` (jumlah child tidak mewakili tinggi).

## Seam

- **Gate M4:** F07 end-to-end, snapshot/provenance/override terjaga, dan PDF dapat dibaca serta dicari. Rencana `M4-gate-review-plan.md`.
- **T23:** objek dan baris export saat akun dihapus, retensi snapshot dan Retry (0027 N2, P3 N4), event export terminal.
- **T24:** p95 render dan biaya reconcile (0027 N7).
- **T25:** hardening container renderer dan deployment (0027 N5).

## Batas

Bukti lokal saja, tanpa deployment.

- Renderer adalah container lokal `workpulse-t21-pdf`.
- Storage dan Auth adalah Supabase lokal.
- Browser adalah Playwright Chromium.
- Taksiran `entry-flow` adalah batas bawah untuk teks prosa; teks patologis dari glyph sangat sempit dapat membuat satu entry terbelah di antara child.
- Review ulang RV1 tidak independen penuh karena reviewer juga mengerjakan perbaikannya; perbaikan itu ditopang test yang terbukti gagal tanpa perbaikan.

# Handoff T22 Saved preview dan PDF QA — eksekusi single-agent

> **Untuk agen pelaksana:**
> - Kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai.
> - Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit.
> - Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.
> - Semua nama route, komponen, fungsi, kode error, key i18n, script, port, dan path di dokumen ini **dibekukan**; jangan mengganti namanya.

- Tanggal: 6 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Dependensi:
  - T21 **DONE**: backend export, decision 0027, `docs/verification/T21-cv-export-backend.md`, runbook renderer `docs/verification/T21-pdf-renderer-runbook.md`.
  - T20 **DONE**: freshness dan tautan review `/cv#cv-review`.
  - T19 **DONE**: S13, `CvPreview`, `buildCvPreviewModel`.
  - T05 **DONE**: `PrivateStorageService`.
  - Gate M3 **PASSED**.
- Eksekutor: satu agent **Claude Sonnet 5.5**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 7; Fase 8 (draft dokumen) dikerjakan setelah gate. Checkpoint Claude setelah Fase 0 dianjurkan (hasil probe pdf.js dan probe page break).
- Keputusan produk: pengguna **menyetujui** (6 Oktober 2026, "Setuju semua") keenam keputusan §2.4 sesuai rekomendasi. Semuanya dibekukan; pelaksana tidak perlu menanyakannya ulang dan tidak perlu berhenti di akhir Fase 0 untuk persetujuan. Probe Fase 0 tetap wajib dan stop condition-nya tetap berlaku.
- Acuan:
  - **PRD:** R10 (*Export the saved CV revision as searchable A4 text with correct page breaks. Failure preserves the draft and supports retry. Evidence is not embedded or linked.*), *CV freshness contract* (deleted/unconfirmed memblokir export; PDF yang sudah diunduh tidak berubah), aturan durable job, release scenario *graduate … export a useful CV*, *delete its source and verify export is blocked until resolved*, *Validate PDF text extraction, Indonesian characters, long bullets, and multipage output*, kriteria M4 *Source provenance survives editing and export; layout fixtures pass*.
  - **User Flow F07** langkah 4–6.
  - **Wireframe:** S14 `/cv/preview`; aturan umum Wireframe (label terlihat, fokus, input dipertahankan, 360/1440 px).
  - **Database Schema** §5 `cv_exports` (unduhan owner-authorized dan kedaluwarsa).
  - **`IMPLEMENTATION_PLAN.md`:** blok T22 dan Gate M4 di §5, §6 (matriks R10).
  - **Decision:** 0027 (*Seam* T22 dan P3 N2, N4, N6), 0025 (preview dari data tersimpan), 0026 (*Seam* T22).
  - **`Design.md`:** token, Badge/Status Chip, Skeleton, status tidak bergantung warna.

**Goal:** Pengguna membuka S14 `/cv/preview` dari S13 setelah menyimpan CV. S14 menampilkan:

- revision tersimpan yang persis;
- blocker dengan tautan ke S13;
- satu aksi utama *Export PDF*, lalu status job yang diperbarui otomatis;
- untuk export yang sudah jadi: halaman PDF nyata dengan batas halaman dan navigasi halaman, *Download PDF* lewat URL bertanda tangan ≤ 5 menit, *Retry* untuk snapshot yang sama bila sah, dan *Regenerate* saat kedaluwarsa atau saat CV sudah berubah.

Template cetak diperketat sampai suite QA PDF nyata (`tests/pdf/`) membuktikan:

- teks hasil ekstraksi cocok dengan snapshot;
- heading tidak yatim di dasar halaman;
- entry yang muat satu halaman tidak terpotong;
- tidak ada teks terpotong di tepi;
- halaman yang dirender diinspeksi sebagai gambar.

**Architecture:** Tanpa migration.

- **Route.** Route server baru `src/app/(workspace)/cv/preview/page.tsx` memuat CV tersimpan (`createCvService().getCv()`), readiness, dan daftar export (`createCvExportService`), lalu merender komponen klien `src/features/cv/cv-export-page.tsx`.
- **Preview HTML.** Sebelum ada PDF, preview memakai `CvPreview` T19 atas model tersimpan yang sama, tanpa klaim batas halaman.
- **Halaman PDF.** Setelah ada export `succeeded`, `src/features/cv/cv-pdf-pages.tsx` mengambil PDF lewat signed URL `inline` dan merender tiap halaman dengan `pdfjs-dist` (sudah terpasang) ke canvas dengan navigasi halaman.
- **Polling.** Status diambil dari route baru `GET /api/cv/exports/[id]` dengan jeda bertahap.
- **Aturan aksi.** Aturan Retry/Regenerate/Download ada di domain murni `src/domain/cv/export-view.ts`.
- **Storage.** Adapter storage diperluas secara aditif untuk `inline` dan nama file unduhan generik.
- **QA PDF.** QA PDF berjalan di `tests/pdf/` terhadap renderer Chromium nyata (`workpulse-t21-pdf`), dengan analisis posisi teks pdf.js dan screenshot halaman lewat Playwright.

**Tech stack:** Next.js 16 App Router + React 19 (server component + client component), `pdfjs-dist` 6.3.289 (sudah terpasang; build browser `pdfjs-dist/build/pdf.mjs` + worker), Zod 4, Tailwind 4 + token `Design.md`, lucide-react, Vitest (unit, integration, config PDF baru), Playwright + axe-core (config baru port **3014**), Gotenberg Chromium T21. Tidak ada dependency npm baru dan tidak ada migration.

---

## 0. Cara memakai handoff ini

**Urutan baca.** Baca dokumen ini sampai selesai sebelum mengubah kode, lalu:

1. `AGENTS.md`.
2. Entry teratas `docs/IMPLEMENTATION_STATUS.md` (T21, T20, T19).
3. `docs/IMPLEMENTATION_PLAN.md` blok M4 (T21, T22, Gate M4) dan §6.
4. Decision 0025, 0026, 0027.
5. `docs/verification/T21-pdf-renderer-runbook.md`.
6. `docs/verification/T20-implementation-plan.md` sebagai pola fase UI dan E2E.
7. `Design.md` bagian status chip, skeleton, tombol, dan aksesibilitas.

Ekstrak ulang PRD R10, *CV freshness contract*, release scenarios, F07, dan S14 dengan alat ekstraksi DOCX (`python` + `zipfile` atas `word/document.xml`; `python-docx` tidak terpasang). Jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R10:** ekspor revision CV tersimpan sebagai teks A4 yang dapat dicari dengan page break yang benar. Kegagalan mempertahankan draft dan mendukung retry. Evidence tidak di-embed atau ditautkan.
- **PRD freshness:** sumber deleted/unconfirmed memblokir export sampai item dihapus atau diperbaiki. PDF yang sudah diunduh tidak berubah.
- **PRD release:**
  - graduate tanpa CV/employment mengekspor CV yang berguna;
  - hapus sumber terpilih → export terblokir sampai diselesaikan;
  - validasi ekstraksi teks PDF, karakter Indonesia, bullet panjang, dan output multipage.
- **F07:**
  - Simpan CV, lalu buka S14. Preview memakai revision tersimpan yang persis.
  - Validasi memblokir CV tanpa nama atau tanpa minimal satu experience, project, education, atau confirmed achievement terpilih.
  - Sumber berubah → review di S13. Item stale yang valid boleh diekspor setelah Keep saved wording. Sumber hilang atau unconfirmed harus dihapus atau diperbaiki.
  - Export mengantre job terikat snapshot immutable. Sukses menawarkan *Download PDF*; gagal menawarkan *Retry* snapshot yang sama; edit yang sedang berjalan tidak mengubah export.
- **S14:**
  - Tampilkan snapshot tersimpan yang persis, batas halaman, navigasi halaman, dan status export.
  - Wajib nama dan minimal satu record karier substantif.
  - Teks dapat dicari dalam bahasa label pilihan. Heading tetap bersama kontennya; bullet tidak terbelah bila memungkinkan.
  - Blokir sumber deleted/unconfirmed dan perubahan yang belum diakui dengan tautan ke S13.
  - Retry memakai snapshot sama. Unduhan tersedia 24 jam lewat URL berumur pendek yang diotorisasi; file kedaluwarsa menawarkan *Regenerate*. Evidence tidak pernah ada di PDF.
- **Rencana §5 T22 (kalimat selesai):**
  - Fixture: id/en, bullet panjang, Unicode, multipage, tanggal tidak diketahui, peran tumpang tindih, achievement kontekstual dan standalone, override.
  - Selesai jika ekstraksi PDF cocok snapshot, heading tidak terpisah sendirian, bullet tidak terbelah bila muat satu halaman, teks tidak terpotong, dan URL unduhan owner-scoped ≤ 5 menit.
  - Inspeksi halaman hasil render, bukan sekadar file ada.
- **Gate M4 (setelah T22, task terpisah):** F07 end-to-end lolos; snapshot, provenance, dan override terjaga; PDF dapat dibaca dan dicari.

**Aturan kerja:**

- Pertahankan perubahan lokal pengguna.
- Jangan menandai T22 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`.
- Pada akhir setiap fase, tulis **receipt** di `docs/verification/T22-phaseN-<slug>.md` berisi:
  - tujuan dan file berubah;
  - command beserta hasil aktual (exit code dan angka pass/fail);
  - acceptance yang terbukti;
  - warning/kegagalan dan blocker;
  - langkah berikutnya.
- Angka di receipt harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T22

T22 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Route dan akses.** `/cv/preview` hanya untuk workspace yang selesai onboarding (`requireCompletedWorkspace("/cv/preview")`). Anonim → sign-in dengan `returnTo` yang aman. Akun tanpa CV → empty state dengan tautan ke S13 (tanpa membuat CV). Navigasi utama menandai *CV* aktif. Dibuktikan E2E + unit.
2. **Revision tersimpan yang persis.** S14 menampilkan judul, bahasa label, dan *Saved revision N* dari `cv_documents.revision`. Preview HTML dibangun dengan `buildCvPreviewModel` dari baris tersimpan; draft S13 yang belum disimpan tidak pernah tampil. Edit tersimpan dari tab lain lalu *Export PDF* di tab basi → pesan konflik (`STALE_REVISION`) + *Reload*, tanpa export baru. Dibuktikan unit + E2E dua tab.
3. **Entry dari S13.** S13 punya tautan *Preview and export* ke `/cv/preview`. Saat ada wording yang belum disimpan, tautan nonaktif dengan alasan terlihat (*Save your changes first.*, `aria-describedby`). Dibuktikan unit state + E2E.
4. **Blocker dengan tautan.** Setiap blocker readiness tampil sebagai daftar berlabel teks dan *Export PDF* nonaktif dengan alasan:
   - `ITEM_CHANGED`, `ITEM_DELETED`, `ITEM_UNCONFIRMED` → `/cv#cv-item-<id>`;
   - `PROFILE_CHANGED` → `/cv#cv-review`;
   - `NAME_REQUIRED` → `/cv#cv-profile`;
   - `CONTENT_REQUIRED` → `/cv`;
   - `CV_NOT_FOUND` → `/cv`.

   Release scenario PRD (delete sumber terpilih) terlihat terblokir di S14, lalu lolos setelah item dihapus di S13. Dibuktikan unit + E2E.
5. **Request eksplisit dan status.**
   - *Export PDF* memanggil `requestCvExportAction` dengan `expected_revision` yang ditampilkan dan idempotency key baru per klik. Klik ganda tidak membuat dua job.
   - Status `queued` → `running` → `succeeded`/`failed` diperbarui lewat polling `GET /api/cv/exports/[id]` dengan jeda `[1000, 2000, 4000, 8000, 16000, 30000]` ms dan berhenti di status terminal.
   - Status diumumkan di live region `role="status"` dan tidak bergantung pada warna.
   - Dibuktikan unit + E2E (worker dikuras di antara langkah).
6. **Halaman PDF nyata.**
   - Untuk export `succeeded` yang belum kedaluwarsa, S14 merender setiap halaman PDF ke canvas berlabel (`role="img"`, *Page n of N*) dari signed URL `inline`.
   - Navigasi *Previous page* / *Next page* / *Page n of N* bekerja dengan keyboard; jumlah halaman = `page_count`.
   - Preview HTML tetap tersedia sebagai alternatif teks yang dapat diakses.
   - Gagal memuat pdf.js atau PDF → pesan + *Try again*, tanpa memblokir *Download PDF*.
   - Dibuktikan E2E (piksel non-kosong per canvas) + unit navigasi.
7. **Unduhan.** *Download PDF* menerbitkan URL baru lewat action dengan `disposition: "attachment"` (TTL ≤ 300 detik) dan nama file `WorkPulse-CV-<YYYY-MM-DD>.pdf` (tanggal UTC `finished_at`). URL tidak pernah dirender ke HTML sebelum diklik dan tidak disimpan di state yang tersisa. Export akun lain atau ID acak → `EXPORT_NOT_FOUND`. Dibuktikan integration (header `content-disposition`, klaim `exp`) + E2E (event download, isi `%PDF-`).
8. **Retry vs Regenerate (N2, N6).**
   - *Retry* tampil hanya untuk export `failed` dengan kode retriable, `attempt_count < 3`, dan `cv_revision` = revision tersimpan saat ini. Hasilnya snapshot yang sama.
   - *Regenerate* (request baru, validasi ulang) tampil untuk export kedaluwarsa/purged, export gagal yang tidak boleh di-retry, export dari revision lama, dan `EXPORT_EXPIRED` setelah reuse.
   - Kode permanen (`EXPORT_TOO_LONG`) menampilkan alasan + tautan ke S13.
   - Dibuktikan unit `export-view` (matriks lengkap) + E2E (gagal → Retry → sukses; kedaluwarsa → Regenerate).
9. **Riwayat ringkas.** Maksimal lima export terbaru ditampilkan dengan revision, status, waktu dalam timezone profil, dan aksi sah per baris. Export revision lama diberi label *Earlier revision*. Dibuktikan unit + E2E.
10. **QA PDF nyata: ekstraksi cocok snapshot** (`tests/pdf/`, Chromium nyata). Untuk setiap fixture §6, teks hasil ekstraksi (dinormalisasi NFKC + whitespace) memuat setiap baris model yang dicetak, dengan urutan section dan entry sama dengan model. Fixture memuat:
    - nama, headline, kontak, summary;
    - heading section sesuai locale;
    - headline, subline, tanggal, dan teks entry/child;
    - override menggantikan teks sumber.

    Tidak ada teks di luar model: tidak ada evidence, `credential_url`, `http` dari data, id item, atau object key. Tanggal tidak diketahui tidak menghasilkan placeholder.
11. **QA PDF nyata: page break.** Untuk sapuan ≥ 24 varian panjang isi (filler bertambah agar heading jatuh di setiap posisi dekat dasar halaman), di setiap halaman:
    - heading section (`h2`) dan judul entry (`h3`) tidak menjadi baris teks terakhir halaman, dengan toleransi ditetapkan dari posisi y item pdf.js;
    - entry yang tingginya muat satu halaman tidak terbelah antarhalaman: seluruh teks entry berada di satu halaman;
    - entry yang lebih panjang dari satu halaman boleh terbelah dan dicatat.

    Bila CSS template harus diubah, perubahannya hanya aturan break/spacing di `cv-print-template.ts`, dengan unit test template diperbarui.
12. **QA PDF nyata: tanpa clipping dan A4.** Setiap item teks berada di dalam MediaBox A4 (595 × 842 ± 1 pt) dan di dalam area margin `@page` ± 2 pt. Awal dan akhir setiap bullet panjang (≥ 600 karakter) ada di teks. Fixture multipage menghasilkan > 1 dan ≤ 20 halaman.
13. **Inspeksi halaman hasil render.** Suite E2E menyimpan screenshot canvas setiap halaman PDF fixture panjang `id` dan `en` di `docs/verification/T22-screenshots/` (data fixture saja, tanpa sentinel). Reviewer menginspeksi gambar itu; receipt Fase 6 mencatat jumlah halaman, nama file, dan temuan visual. Assertion keberadaan file saja **tidak** cukup.
14. **Unicode (N4).** Fixture `id` dengan `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”`, `Ç Ñ ś ñ`, dan kutip melengkung → teks hasil ekstraksi cocok. Fixture nama Han/Arab/Devanagari → export `succeeded`. Dokumen verifikasi mencatat batas searchability per aksara dari decision 0027 (tidak diklaim lebih).
15. **Aksesibilitas dan responsive.**
    - Axe tanpa pelanggaran *serious*/*critical* di S14 untuk keadaan blocked, ready, running, succeeded (halaman PDF tampil), failed, dan expired.
    - Viewport 360 px dan 1440 px dalam light dan dark, tanpa overflow horizontal.
    - Seluruh aksi dapat dijalankan dengan keyboard; fokus kembali ke tombol aksi atau status setelah aksi.
    - `prefers-reduced-motion` dihormati.
    - Screenshot di `docs/verification/T22-screenshots/`.

    Dibuktikan E2E.
16. **Owner dan privasi.**
    - Akun B tidak dapat melihat status (`GET /api/cv/exports/<id A>` → 404 generik yang sama dengan ID acak), tidak dapat mengunduh, dan tidak dapat me-retry export A.
    - Respons route, action, HTML, dan log tidak memuat object key, attempt token, snapshot, atau teks CV di luar halaman pemilik.
    - Sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>` tidak muncul di respons error, console, atau network selain PDF milik pemilik.

    Dibuktikan integration + E2E.
17. **Tanpa perubahan perilaku lama.** Seluruh suite T02–T21 dan gate M2/M3 tetap lulus tanpa melemahkan assertion. Tidak ada migration. RPC T18–T21 tidak diubah. Perluasan adapter storage aditif: default `download: true` tetap untuk pemanggil lama. Dibuktikan regresi penuh + diff review.
18. **Log hygiene.** Tidak ada `console.` di `src/features/cv`, `src/app/(workspace)/cv`, `src/app/api/cv`, `src/domain/cv`, `src/server/export`. Error UI memakai kode + correlation ID. Dibuktikan grep + unit.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Route `/cv/preview` (server page + `loading.tsx`), komponen klien S14, tampilan halaman PDF, dan tautan dari S13.
- Route status `GET /api/cv/exports/[id]` dan method service `getExport(id)`.
- Perluasan action unduhan: `disposition` `attachment`/`inline` dan nama file.
- Perluasan aditif adapter storage (`createSignedDownloadUrl` dengan opsi).
- Domain murni `src/domain/cv/export-view.ts` (aturan aksi, label status, nama file).
- Penyesuaian aturan break/spacing template cetak bila suite QA membuktikannya perlu.
- Suite `tests/pdf/` + `vitest.pdf.config.ts`; unit; integration; E2E `cv-export.spec.ts` + `playwright.cv-export.config.ts` (port 3014).
- Kunci i18n en/id, screenshot, decision 0028, dan receipt.

### 2.2 Keputusan implementasi

1. **Dua lapis preview.** Lapis HTML dan lapis halaman PDF memakai sumber data yang berbeda dan tidak boleh dicampur.
   - **HTML.** `CvPreview` T19 atas model tersimpan selalu ada. Lapis ini adalah alternatif teks yang dapat diakses dan berlaku sebelum PDF ada.
   - **Halaman PDF.** Tampil hanya untuk export `succeeded` yang belum kedaluwarsa. Label *Pages of the PDF for revision N*; bila N ≠ revision tersimpan → *Earlier revision*.

   Batas halaman **hanya** diklaim dari PDF nyata. *Alasan:* S14 menuntut snapshot persis dan batas halaman, sedangkan HTML layar tidak dipaginasi seperti Chromium cetak; estimasi akan menyesatkan.
2. **Render halaman di browser dengan pdf.js terpasang.**
   - `pdfjs-dist/build/pdf.mjs` dimuat dinamis hanya di `cv-pdf-pages.tsx`, dengan worker lewat `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`. Fase 0 membuktikan bahwa build Next 16 membundel worker ini; bila tidak, **stop**.
   - Satu canvas per halaman dengan skala menyesuaikan lebar kolom (DPR dibatasi 2). Halaman dirender lazily: halaman aktif ± 1.
   - `isEvalSupported: false`, tanpa `useSystemFonts`.
   - PDF diambil dengan `fetch(url, { cache: "no-store", credentials: "omit" })` dari signed URL `inline`. Probe reviewer 6 Oktober 2026 menunjukkan Storage lokal mengizinkan CORS (`access-control-allow-origin: *`) dan preflight 200; Fase 0 mengulangnya.
   - Byte PDF tidak disimpan di storage browser.
3. **Signed URL dan nama file.**
   - `StorageAdapter.createSignedDownloadUrl(objectKey, ttl, options?: { disposition?: "attachment" | "inline"; filename?: string })` diperluas secara aditif. Default `attachment` tanpa nama tetap sama dengan sekarang (`{ download: true }`).
   - `filename` hanya pola `^[A-Za-z0-9._-]{1,80}\.pdf$`. `inline` memakai `createSignedUrl` tanpa opsi `download`.
   - `PrivateStorageService.issueDownload(objectKey, ttl, options?)` meneruskan opsi.
   - Export service: `issueDownload({ export_id, disposition })`. Nama file dari `exportDownloadName(finished_at)` = `WorkPulse-CV-<YYYY-MM-DD>.pdf` (UTC).
   - *Alasan:* objek tanpa ekstensi diunduh sebagai UUID. Nama pribadi tidak boleh masuk query string URL (aturan privasi), jadi nama file generik.
4. **Route status.** `src/app/api/cv/exports/[id]/route.ts` (`GET`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `Cache-Control: no-store`). Route mengembalikan `cvExportRowSchema` + `expired: boolean`, atau 404 generik untuk ID invalid, asing, atau tidak ada. Polanya mengikuti `src/app/api/imports/[id]/route.ts` (sesi server, kode + correlation ID, tanpa body error mentah). Method `getExport(id)` di `export-service.ts` memakai select RLS kolom aman.
5. **Polling.** Jeda `[1000, 2000, 4000, 8000, 16000, 30000]` ms (pola `EVIDENCE_POLL_DELAYS`). Polling berhenti di status terminal, saat tab tersembunyi (lanjut saat `visibilitychange`), dan saat unmount. Kegagalan jaringan mempertahankan status terakhir dan mencoba lagi. Setelah status terminal, `router.refresh()` memuat ulang riwayat.
6. **Aturan aksi murni** (`export-view.ts`). Masukan: baris export, revision tersimpan, readiness, dan `now`. Keluaran: label status (`queued`, `running`, `succeeded`, `failed`, `expired`), aksi utama dan sekunder (`export`, `download`, `retry`, `regenerate`, `openBuilder`), dan alasan nonaktif. Aturan:
   - **Retry:** `failed` ∧ kode retriable (`!isPermanentExportError`) ∧ `attempt_count < 3` ∧ `cv_revision === savedRevision`.
   - **Regenerate:** semua kasus lain yang membutuhkan PDF baru. Regenerate selalu melewati readiness; bila terblokir, aksi nonaktif dengan alasan blocker.
   - Satu aksi utama per keadaan (`Design.md`).
7. **Idempotency key per klik.** `crypto.randomUUID()` dibuat saat klik dan disimpan di ref sampai respons tiba. Klik ulang selama pending dinonaktifkan. Hasil `reused: true` diperlakukan sama dengan sukses.
8. **Konflik revision.** `STALE_REVISION` dari request → notice *Your CV changed since this page loaded.* + *Reload* (`router.refresh()`), tanpa request ulang otomatis. `EXPORT_IN_PROGRESS` → tampilkan export aktif dan lanjutkan polling. `EXPORT_BLOCKED` → perbarui daftar blocker dari `latestRecord.blockers`.
9. **Tautan blocker.** Tautan item memakai anchor yang sudah ada di S13 (`#cv-item-<id>`, `#cv-review`). Bila `#cv-profile` belum ada, tambahkan `id="cv-profile"` pada panel profil S13 (perubahan markup minimal). Fase 0 mencatat anchor nyata.
10. **Tautan S13 → S14.** Tautan sekunder *Preview and export* ditempatkan di header preview S13. Saat `dirty`, tautan dirender sebagai tombol nonaktif dengan `aria-describedby` ke alasan. Tidak ada auto-export.
11. **Template cetak.** Perubahan hanya pada aturan break/spacing yang dibuktikan suite §1.11, misalnya:
    - membungkus `h2` + entry pertama dalam satu blok `break-inside: avoid`;
    - `orphans`/`widows`;
    - `break-after: avoid` pada `h3`/meta.

    Tidak ada perubahan font, warna, struktur konten, atau model. `renderCvPrintHtml` tetap murni, dan unit test template diperbarui sesuai aturan baru.
12. **Suite QA PDF.**
    - `vitest.pdf.config.ts` (environment node, include `tests/pdf/**/*.test.ts`, `maxWorkers: 1`, timeout 120 detik). Script baru `test:pdf`.
    - Fixture dibangun dari snapshot TypeScript (`exportSnapshotFrom` + fixture §6) → `buildExportRenderModel` → `renderCvPrintHtml` → `GotenbergPdfRenderer` nyata (`WORKPULSE_PDF_GOTENBERG_URL`, gagal keras bila tidak terjangkau) → pdf.js (legacy build, `getTextContent` dengan `transform`).
    - Suite ini tidak memakai database.
13. **Klasifikasi baris dalam analisis PDF.** Item pdf.js dikelompokkan per baris (y sama ± 1 pt). Heading dikenali dari teks label locale (`CV_LABELS`) dan headline entry model; ini bukan heuristik ukuran font. Baris terakhir halaman = baris dengan y terkecil di atas margin bawah.
14. **Screenshot halaman.** E2E membuka S14 untuk export fixture panjang `id` dan `en`, menunggu semua canvas selesai render, lalu `locator.screenshot()` per halaman ke `docs/verification/T22-screenshots/pdf-<locale>-page-<n>.png`. Screenshot S14 per keadaan disimpan sebagai `s14-<state>-<360|1440>-<light|dark>.png`.
15. **Kunci i18n.** Kunci baru di bawah `cv.exportPage.*` (UI S14) dan `cv.builder.previewAndExport*` (tautan S13), en **dan** id. Kunci T21 `cv.export.*` dipakai ulang untuk status, error, dan blocker.
16. **Nomor.**
    - Decision `docs/decisions/0028-t22-saved-preview-pdf-qa.md`.
    - E2E `tests/e2e/cv-export.spec.ts`, `playwright.cv-export.config.ts`, port **3014**.
    - Helper E2E `tests/e2e/helpers/export-worker.ts`.
    - Integration `tests/integration/cv-export-preview.test.ts`, ditambahkan ke script `test:integration:cv-export`.
    - QA `tests/pdf/cv-pdf-layout.test.ts` + `tests/pdf/pdf-layout.ts` (helper analisis).
    - Tidak ada migration (parity tetap **31/31**).

### 2.3 Di luar scope

- **T23:** penghapusan akun dan objek export saat akun dihapus, serta retensi snapshot (N2).
- **T23/T24:** event analytics export terminal.
- **T24:** p95 render dan biaya reconcile (N7).
- **T25:** hardening container renderer dan deployment (N5).
- **Gate M4:** gate review terpisah setelah T22 DONE, dengan rencana `M4-gate-review-plan.md`.
- **Tidak diubah:** RPC T18–T21, kolom/tabel, `request_cv_export`/`retry_cv_export`, worker export, verifikasi nama RV1. Perubahan semacam itu → **stop**.
- **Bukan v0.1:** template lain, variant CV, target job, AI, evidence di PDF, hyperlink, foto, warna aksen, watermark, editor di S14, berbagi publik, unduhan tanpa login.

### 2.4 Keputusan produk yang sudah disetujui pengguna (6 Oktober 2026)

Keenamnya disetujui sesuai rekomendasi. Catat persetujuan ini di receipt Fase 0 dan lanjutkan tanpa bertanya ulang. Bila implementasi menuntut penyimpangan dari salah satunya, **stop** (lihat §8).

1. **Sumber batas halaman** (§2.2.1–2): halaman PDF nyata dirender pdf.js di browser setelah export, dan HTML tersimpan sebelum export. Alternatif:
   - estimasi page break di HTML (tidak akurat);
   - rasterisasi di server (dependency atau runtime baru);
   - render PDF preview otomatis saat membuka S14 (membuat job tanpa aksi eksplisit, ditolak AGENTS).
2. **Nama file unduhan** (§2.2.3): `WorkPulse-CV-<YYYY-MM-DD>.pdf`, generik tanpa nama pengguna. Alternatif: nama pengguna di nama file (masuk query string signed URL, sehingga melanggar aturan privasi URL).
3. **Retry hanya untuk revision tersimpan saat ini** (§2.2.6, N2): export gagal dari revision lama hanya mendapat *Regenerate*. Alternatif: Retry untuk semua export gagal yang retriable, sesuai backend (dapat mencetak sumber yang sudah dihapus).
4. **Riwayat ringkas lima export terakhir** (§1.9). Alternatif: hanya export terbaru.
5. **Polling otomatis dengan jeda bertahap sampai 30 detik** (§2.2.5). Alternatif: tombol *Check status* manual.
6. **Template boleh diubah hanya pada aturan break/spacing** (§2.2.11) untuk memenuhi QA. Alternatif: tidak mengubah template dan mencatat pelanggaran sebagai P3 (tidak memenuhi kalimat selesai T22).

## 3. Kontrak teknis

### 3.1 Domain murni `src/domain/cv/export-view.ts` (baru, import relatif)

- `exportStatusView(row, now)`: `{ state: "queued" | "running" | "succeeded" | "failed" | "expired", messageKey }`. Memakai `isExportExpired` T21.
- `exportActions({ row, savedRevision, readiness, now })`: `{ primary: Action | null, secondary: Action[], disabledReason: MessageKey | null }`. `Action` = `"export" | "download" | "retry" | "regenerate" | "openBuilder"`. Aturan §2.2.6.
- `blockerLink(blocker)`: href S13 per kode, sesuai §1.4.
- `exportDownloadName(finishedAt)`: string, pola §2.2.3.
- `EXPORT_POLL_DELAYS` = `[1000, 2000, 4000, 8000, 16000, 30000] as const`.

### 3.2 Server

- `src/server/storage/adapter.ts`, `supabase-storage-adapter.ts:64`, `private-storage-service.ts:79`: opsi aditif §2.2.3. Default tidak berubah, dan test storage lama tetap lulus tanpa diubah.
- `src/features/cv/export-service.ts`:
  - `getExport(id)` (UUID Zod → select kolom aman + RLS → `null` bila tidak ada);
  - `issueDownload({ export_id, disposition })`: `disposition` default `attachment`; nama file hanya untuk `attachment`.
- `src/domain/cv/contracts.ts`: `downloadCvExportInput` diperluas aditif dengan `disposition: z.enum(["attachment","inline"]).default("attachment")`.
- `src/features/cv/actions.ts`: `issueCvExportDownloadAction` membaca `disposition`, tanpa revalidate. `requestCvExportAction`/`retryCvExportAction` tetap.
- `src/app/api/cv/exports/[id]/route.ts`: §2.2.4.

### 3.3 UI

- `src/app/(workspace)/cv/preview/page.tsx`: server.
  - `requireCompletedWorkspace("/cv/preview")`.
  - Memuat paralel: `createCvService().getCv()` (tanpa `ensure`; `null` → empty state), `createCvExportService().getReadiness()`, `listExports(5)`.
  - Membangun model tersimpan dan merender `CvExportPage`. Gagal → `InlineError` + correlation ID + *Retry*.
- `src/app/(workspace)/cv/preview/loading.tsx`: skeleton.
- `src/features/cv/cv-export-page.tsx` (client):
  - header (judul, bahasa, *Saved revision N*, tautan *Back to CV builder*);
  - panel status/aksi (satu aksi utama, live region);
  - daftar blocker;
  - riwayat;
  - kolom preview: halaman PDF bila ada, lalu HTML `CvPreview` dengan `dirty={false}`.
- `src/features/cv/cv-pdf-pages.tsx` (client): pdf.js, canvas berlabel, navigasi halaman, state loading/error/retry, dan pembersihan (`destroy()` saat unmount).
- `src/features/cv/cv-builder.tsx` + `cv-preview.tsx`: tautan *Preview and export* (§2.2.10) dan `id="cv-profile"` bila perlu.
- `src/app/globals.css`: kelas S14 dengan token yang ada, tanpa warna baru.

### 3.4 Template

`src/server/export/cv-print-template.ts`: hanya §2.2.11, dengan alasan per aturan dicatat di receipt Fase 4.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `src/domain/cv/export-view.ts` |
| Create | `src/app/(workspace)/cv/preview/{page,loading}.tsx`, `src/app/api/cv/exports/[id]/route.ts` |
| Create | `src/features/cv/{cv-export-page,cv-pdf-pages}.tsx` |
| Modify | `src/features/cv/{export-service,actions,cv-builder,cv-preview}.ts(x)`, `src/domain/cv/contracts.ts`, `src/i18n/messages.ts`, `src/app/globals.css` |
| Modify | `src/server/storage/{adapter,supabase-storage-adapter,private-storage-service}.ts` (aditif) |
| Modify (bila dibuktikan QA) | `src/server/export/cv-print-template.ts`, `tests/unit/cv-print-template.test.ts` |
| Create | `tests/unit/{cv-export-view,cv-export-page-state}.test.ts`; perluas `tests/unit/{cv-export-service,cv-export-actions,cv-export-i18n}.test.ts` dan test storage unit yang ada |
| Create | `tests/integration/cv-export-preview.test.ts` |
| Create | `tests/pdf/{cv-pdf-layout.test.ts,pdf-layout.ts,fixtures.ts}`, `vitest.pdf.config.ts` |
| Create | `tests/e2e/cv-export.spec.ts`, `tests/e2e/helpers/export-worker.ts`, `playwright.cv-export.config.ts` |
| Modify | `package.json` (script `test:pdf`, `test:e2e:cv-export` baru; `test:integration:cv-export` ditambah file), `README.md` (Fase 8) |
| Create | `docs/verification/T22-screenshots/*.png` (Fase 6) |
| Create (Fase 8) | `docs/decisions/0028-t22-saved-preview-pdf-qa.md`, `docs/verification/T22-saved-preview-pdf-qa.md` |

Script baru:

- `test:pdf` → `vitest run --config vitest.pdf.config.ts --configLoader native`
- `test:e2e:cv-export` → `playwright test --config playwright.cv-export.config.ts`
- `test:integration:cv-export` (ubah) → tambahkan `tests/integration/cv-export-preview.test.ts`.

## 5. Fase eksekusi

### Fase 0 — Baseline, probe, dan persetujuan (tanpa edit kode)

- [x] Catat `git status --short --branch` dan HEAD (harapan `fe64466` atau turunannya). Working tree harus bersih kecuali `.claude/`; jika tidak, **stop**.
- [x] Siapkan environment:
  - `pnpm install --frozen-lockfile`.
  - `pnpm exec supabase migration list --local`: parity harus **31/31** dengan migration terakhir `20261005090000_t21_cv_export_backend.sql`.
  - Bila Docker mati, nyalakan dan jalankan `pnpm db:start` (tanpa reset).
  - Pastikan `workpulse-t21-pdf`, ClamAV T10, dan Gotenberg T15 hidup sesuai runbook masing-masing.
- [x] Jalankan baseline dengan harapan berikut:

  | Command | Harapan |
  | --- | --- |
  | `pnpm lint`, `pnpm typecheck`, `pnpm worker:check` | lulus |
  | `pnpm test` | 98 file / 845 test |
  | `pnpm db:test` | 15 file / 1290 assertion |
  | `pnpm test:integration:cv-export` | 2 file / 27 test |
  | `pnpm test:e2e:cv` | 8 |
  | `pnpm test:e2e:cv-freshness` | 10 |

- [x] Verifikasi dari source dan catat file:baris untuk:
  - **Route dan halaman:** `src/app/(workspace)/cv/page.tsx`, `requireCompletedWorkspace`, `src/app/api/imports/[id]/route.ts` + `src/features/import/http.ts` (pola route).
  - **Komponen CV:** `src/features/cv/{cv-builder,cv-preview,cv-panels,cv-section}.tsx`, yaitu anchor `#cv-review`, `#cv-item-<id>`, dan ada/tidaknya anchor panel profil; `cv-builder.tsx:111` (model) dan `:506` (kolom preview).
  - **Export T21:** `src/features/cv/{export-service,actions}.ts` (`issueDownload :145`, action `:185`); `src/domain/cv/{export,contracts,preview,labels}.ts`.
  - **Storage:** `src/server/storage/{adapter.ts:8,supabase-storage-adapter.ts:64,private-storage-service.ts:79}`.
  - **Polling dan worker:** `EVIDENCE_POLL_DELAYS` (`src/features/evidence/evidence-attachments.tsx:17`), `tests/e2e/helpers/import-worker.ts` (pola menguras worker), `workers/run.ts` (pass export, env `WORKPULSE_PDF_*`).
  - **Template:** `src/server/export/cv-print-template.ts` (aturan break saat ini).
- [x] **Probe pdf.js browser.** Di branch scratch atau stash (jangan di-commit), buat halaman uji minimal yang memuat `pdfjs-dist/build/pdf.mjs` dengan worker `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`, lalu jalankan `next build` + `next start`. Render satu PDF dari renderer T21 (diambil dari signed URL `inline` Storage lokal) ke canvas di Playwright Chromium. Catat:
  - build sukses;
  - worker termuat (bukan *fake worker*);
  - `fetch` lintas origin berhasil (header ACAO);
  - canvas berpiksel non-kosong.

  Bila worker tidak dapat dibundel, **stop** dan laporkan alternatif (salinan worker versi terpin di `public/` dengan alasan, atau pendekatan lain). Hapus halaman uji setelah probe.
- [x] **Probe page break.** Dengan template saat ini, render 24 varian filler (heading section bergeser di sekitar dasar halaman) ke renderer nyata dan analisis dengan pdf.js (baris terakhir per halaman). Catat apakah heading yatim atau entry terbelah terjadi. Ini menentukan kebutuhan §2.2.11; bila terjadi, pilihan aturan CSS dicatat untuk Fase 4.
- [x] Catat di receipt bahwa pengguna menyetujui §2.4 (6 Oktober 2026). Tulis receipt Fase 0 `docs/verification/T22-phase0-baseline.md`. Commit `docs(t22): add phase 0 baseline receipt`. Lanjut ke Fase 1 bila tidak ada stop condition.

### Fase 1 — Domain murni (TDD unit)

- [x] Test gagal lebih dulu di `tests/unit/cv-export-view.test.ts`:
  - matriks `exportActions` untuk setiap status × revision sama/lama × readiness siap/terblokir × kode retriable/permanen × `attempt_count` 1–3 × kedaluwarsa/purged;
  - `exportStatusView`;
  - `blockerLink` untuk setiap kode;
  - `exportDownloadName` (UTC, pola, tanggal invalid → nama tanpa tanggal yang aman);
  - `EXPORT_POLL_DELAYS`.
- [x] Implementasi §3.1. Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t22): add export view rules`, lalu receipt Fase 1.

### Fase 2 — Storage, service, route, action (TDD unit + integration)

- [x] Test gagal lebih dulu:
  - **Unit adapter/service storage:** default `{ download: true }` tetap; `inline` tanpa opsi download; `filename` invalid ditolak; TTL > 300 ditolak.
  - **Unit `cv-export-service`:** `getExport` (UUID invalid → `null`, kolom aman, Zod) dan `issueDownload` dengan `disposition`.
  - **Unit `cv-export-actions`:** `disposition` dari form; default `attachment`.
  - **Integration `cv-export-preview.test.ts`** (pola `cv-export-support.ts`):
    - URL `attachment` → `content-disposition` memuat `WorkPulse-CV-<date>.pdf`;
    - URL `inline` → tanpa `attachment`, `access-control-allow-origin` ada;
    - klaim `exp` ≤ 305 detik;
    - route `GET /api/cv/exports/[id]` lewat handler langsung dengan sesi A (row aman + `expired`) dan sesi B/ID acak/bukan UUID (404 identik, tanpa body sensitif);
    - sentinel tidak muncul.
- [x] Implementasi §3.2. Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:integration:cv-export`, dan `pnpm test:integration:storage`. Commit `feat(t22): add export status route and named or inline downloads`, lalu receipt Fase 2.

### Fase 3 — UI S14 dan tautan S13 (TDD unit state, lalu komponen)

- [ ] Test gagal lebih dulu:
  - `tests/unit/cv-export-page-state.test.ts`: reducer/state klien murni untuk alur klik → pending → receipt → polling → terminal, `STALE_REVISION`, `EXPORT_IN_PROGRESS`, `EXPORT_BLOCKED`, navigasi halaman (batas 1..N), dan polling berhenti saat terminal/hidden.
  - `tests/unit/cv-export-i18n.test.ts`: parity kunci baru en/id.
  - Unit state builder: tautan *Preview and export* nonaktif saat `dirty`.
- [ ] Implementasi §3.3 (route, loading, komponen, CSS, i18n, tautan S13). Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Commit `feat(t22): add S14 saved preview and export page`, lalu receipt Fase 3.

### Fase 4 — QA PDF nyata (TDD dengan renderer nyata)

- [ ] Tulis `tests/pdf/{fixtures,pdf-layout,cv-pdf-layout.test}.ts` dan `vitest.pdf.config.ts` + script `test:pdf`. Jalankan dengan template saat ini dan catat test yang **gagal** (bila ada) sebagai bukti kebutuhan §2.2.11. Assertion minimum:
  - §1.10: ekstraksi = model, urutan, tanpa teks asing, tanpa placeholder tanggal;
  - §1.11: sapuan ≥ 24 varian, tanpa heading yatim, entry yang muat tidak terbelah;
  - §1.12: MediaBox A4, margin, awal/akhir bullet panjang, halaman > 1 dan ≤ 20;
  - §1.14: Unicode `id`, dan nama Han/Arab/Devanagari terender dengan cek nama worker (`exportTextShowsName`) lolos.
- [ ] Bila gagal, ubah template sesuai §2.2.11 (satu aturan per langkah, ulangi suite), lalu perbarui `tests/unit/cv-print-template.test.ts`. Jalankan `pnpm test:pdf`, `pnpm test`, `pnpm test:integration:cv-export` (renderer nyata ikut). Commit `test(t22): add real-renderer PDF layout QA` (dan `fix(t22): …` untuk perubahan template), lalu receipt Fase 4 berisi tabel varian, halaman, dan hasil.

### Fase 5 — Integration nyata lintas lapis

- [ ] Perluas `cv-export-preview.test.ts` dengan:
  - jalur penuh service + route dengan worker nyata (renderer fake untuk status, renderer nyata untuk satu kasus `inline` yang di-parse pdf.js);
  - polling route melihat `queued` → `running` (lewat seam `onRendered`) → `succeeded`;
  - export revision lama + edit CV → aturan `exportActions` menghasilkan `regenerate`;
  - kedaluwarsa → `expired: true`.
- [ ] Jalankan `pnpm test:integration:cv-export`. Commit `test(t22): add preview integration`, lalu receipt Fase 5.

### Fase 6 — Browser acceptance

- [ ] `playwright.cv-export.config.ts`: port 3014, pola `playwright.cv-freshness.config.ts`. Web server tanpa env `WORKPULSE_AI_*`, `WORKPULSE_OPENAI_*`, `WORKPULSE_DOCX_*`, `WORKPULSE_GOTENBERG_*`, `WORKPULSE_PDF_*`.
- [ ] `tests/e2e/helpers/export-worker.ts`: menguras `workers/run.ts --once` dengan env anak `NODE_ENV=test` dan `WORKPULSE_PDF_RENDERER_MODE=gotenberg` (renderer nyata `http://127.0.0.1:13401`) atau `fake` per skenario. Polanya `tests/e2e/helpers/import-worker.ts`; env renderer hanya di proses anak.
- [ ] Skenario `tests/e2e/cv-export.spec.ts` (akun fixture dibersihkan):
  1. **Graduate PRD:** keyboard saja, S13 pilih education + project + achievement → Save → *Preview and export* → S14 *Saved revision N* → *Export PDF* → status `queued` → worker (renderer nyata) → `succeeded` → halaman PDF tampil (*Page 1 of N*, piksel non-kosong) → *Download PDF* (event download, nama `WorkPulse-CV-*.pdf`, isi `%PDF-`).
  2. **Unsaved:** wording diketik di S13 tanpa Save → tautan nonaktif dengan alasan; S14 lewat URL langsung tetap menampilkan revision tersimpan tanpa teks draft.
  3. **Release scenario delete:** hapus achievement terpilih (UI S07) → S14 blocker `ITEM_DELETED` + tautan `/cv#cv-item-<id>` → Remove di S13 → S14 siap.
  4. **Changed + Keep saved wording:** blocker `ITEM_CHANGED` → S13 *Keep saved wording* → S14 siap → export memuat wording tersimpan.
  5. **Gagal → Retry → sukses:** renderer fake yang gagal, lalu renderer nyata. Lalu edit CV sesudah kegagalan → hanya *Regenerate*.
  6. **Kedaluwarsa:** majukan `expires_at` lewat SQL admin → *Download expired* + *Regenerate* → export baru.
  7. **Konflik dua tab:** Save di tab B → *Export PDF* di tab A → notice konflik + *Reload*, 0 export baru.
  8. **Isolasi:** akun B → status/route/unduhan export A → 404/`EXPORT_NOT_FOUND` generik. Sentinel tidak ada di console/network selain PDF pemilik.
  9. **Aksesibilitas dan screenshot:** Axe untuk enam keadaan §1.15, 360/1440 × light/dark tanpa overflow, keyboard dan fokus, reduced motion; screenshot keadaan dan halaman PDF fixture panjang `id`/`en` (§2.2.14).
- [ ] Jalankan `pnpm test:e2e:cv-export` (dua kali; run kedua menyimpan screenshot). Inspeksi setiap screenshot halaman PDF dan catat temuan visual (heading yatim, clipping, tumpang tindih, glyph hilang) di receipt. Commit `test(t22): add S14 browser acceptance and screenshots`, lalu receipt Fase 6.

### Fase 7 — Regresi penuh

- [ ] Jalankan seluruh §7. `test:e2e:m2` dan `test:e2e:m3` wajib lulus tanpa melemahkan assertion env (kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk run itu). ClamAV, Gotenberg T15, dan renderer T21 wajib berjalan untuk suite yang membutuhkannya; bila tidak, catat **tidak dijalankan** beserta alasan. Flaky bawaan `activity-ui.spec.ts:356` dicatat sebagai flaky bila lulus saat diulang tanpa perubahan.
- [ ] Periksa diff dan hygiene:
  - `git diff fe64466 -- supabase/migrations` harus kosong;
  - `git diff fe64466 --stat` hanya menyentuh file §4;
  - grep `console.` sesuai §1.18;
  - `git diff --check fe64466..HEAD`.
- [ ] Tulis receipt Fase 7 `docs/verification/T22-phase7-regression.md` dan commit `test(t22): record regression receipt`. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–7, output command, screenshot, dan daftar acceptance yang belum terbukti.

### Fase 8 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0028-t22-saved-preview-pdf-qa.md` berisi:
  - keputusan §2.2 dan persetujuan §2.4;
  - aturan aksi Retry/Regenerate;
  - aturan template yang diubah beserta bukti;
  - batas searchability Unicode (rujuk 0027 N4);
  - alternatif yang ditolak;
  - seam Gate M4 dan T23.
- [ ] `docs/verification/T22-saved-preview-pdf-qa.md`: pass/fail/warning/tidak dijalankan, trace ke R10, F07, S14, DB §5, dan setiap poin §1, serta daftar screenshot.
- [ ] README: S14, script baru, dan tabel quality gates.
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- **Owner A (employee, `en` dan varian `id`), timezone `Asia/Jakarta`:**
  - Experience current dan experience lama dengan tanggal **tumpang tindih**; experience dengan tanggal **tidak diketahui** (NULL) dan satu dengan precision `year`.
  - Project ber-experience dan achievement confirmed kontekstual ber-override; achievement standalone (*Selected achievements*).
  - Education, skill `SQL`, certification dengan `credential_url` (tidak boleh tercetak), override profil `headline`/`website`.
  - Bullet `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”` dan nama `Siti Nurhaliza Ç. Ñuñez`.
- **Owner A-long:** ≥ 12 achievement dengan bullet ≥ 600 karakter dan satu entry yang lebih panjang dari satu halaman (boleh terbelah, dicatat), ≤ 20 halaman.
- **Sapuan page break (`tests/pdf/` saja):** ≥ 24 varian dengan filler 1..N baris pendek di section pertama, sehingga heading section kedua dan judul entry bergeser melewati dasar halaman 1.
- **Owner G (graduate):** tanpa experience; education, project akademik, satu achievement confirmed.
- **Owner N (nama non-Latin, `tests/pdf/` + satu E2E opsional):** `李小龙`, `محمد عبدالله`, `प्रिया शर्मा`.
- **Owner B:** CV dan export sendiri untuk isolasi; sesi kedua untuk konflik dua tab.
- **Sentinel privat:** `WP-PRIVATE-CV-SENTINEL-<uuid>` di judul CV, override, dan bullet A. Sentinel boleh muncul di PDF dan halaman A sendiri, tidak boleh di respons error, route milik orang lain, console, atau log.
- Setiap test membersihkan akun fixture dan objek Storage-nya seperti suite lain. Screenshot hanya memakai data fixture tanpa sentinel.

## 7. Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm exec supabase migration list --local
pnpm test:pdf
pnpm test:integration:cv-export
pnpm test:integration:cv-freshness
pnpm test:integration:cv-builder
pnpm test:integration:cv
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:activity
pnpm test:integration:dashboard
pnpm test:integration:import-commit
pnpm test:integration:import-review
pnpm test:integration:import
pnpm test:integration:m2
pnpm test:integration:m3
pnpm test:integration:ai
pnpm test:integration:ai-review
pnpm test:integration:evidence
pnpm test:integration:storage
pnpm test:e2e:cv-export
pnpm test:e2e:cv-freshness
pnpm test:e2e:cv
pnpm test:e2e:achievements
pnpm test:e2e:projects
pnpm test:e2e:dashboard
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:import
pnpm test:e2e:import-review
pnpm test:e2e:ai
pnpm test:e2e:ai-review
pnpm test:e2e:evidence
pnpm test:e2e:m2
pnpm test:e2e:m3
pnpm worker:check
pnpm build
git diff --check
```

`test:pdf` dan `test:e2e:cv-export` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan.

Aturan menjalankan suite:

- **Secret key.** `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan. Di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong.
- **Env per command.** Muat env Supabase lokal (`.env.local` + key) dan `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` dalam command yang sama dengan suite, karena env PowerShell tidak bertahan antar command.
- **Output.** Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`.
- **Edit file.** Untuk file ber-karakter non-ASCII gunakan tool Edit, bukan `Set-Content`.
- **Container.** Jangan menghentikan container Supabase, ClamAV T10, Gotenberg T15, atau `workpulse-t21-pdf`.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, atau parity bukan 31/31.
- Implementasi menuntut penyimpangan dari keputusan §2.4 yang disetujui.
- Probe pdf.js gagal: worker tidak dapat dibundel, CORS Storage ditolak, atau canvas kosong.
- Penyelesaian memerlukan migration, perubahan RPC/SQL T18–T21, perubahan worker export atau aturan cek nama RV1, atau `db reset`.
- Perbaikan page break membutuhkan perubahan di luar aturan break/spacing template (font, struktur, model) atau perubahan perilaku preview S13.
- Implementasi terasa memerlukan dependency npm baru, aset biner baru, auto-export, AI, evidence di PDF, atau fitur T23–T25.
- Test membutuhkan key nyata, renderer jatuh ke fake di suite renderer nyata, atau sentinel muncul di output/log/route orang lain.
- Perubahan pada suite lama (T02–T21) diperlukan agar lulus, selain perubahan unit template yang dibuktikan §1.11 dan perubahan state builder untuk tautan S13 (dicatat di receipt).

## 9. Gate review Claude (setelah Fase 7)

Review read-only mencakup:

- **Revision tersimpan:**
  - S14 hanya membaca baris tersimpan;
  - `expected_revision` = revision yang ditampilkan;
  - konflik dua tab tanpa export;
  - draft S13 tidak pernah tampil.
- **Aksi:**
  - matriks Retry/Regenerate sesuai §2.4.3;
  - Retry tidak pernah untuk revision lama;
  - satu aksi utama;
  - klik ganda tanpa job ganda.
- **Unduhan dan halaman PDF:**
  - signed URL ≤ 300 detik, dibuat saat klik, tidak dirender di HTML awal;
  - nama file generik;
  - `inline` hanya untuk pemilik;
  - pdf.js tanpa eval, worker terbundel, byte tidak dipersist.
- **Route status:** owner-only, 404 identik, kolom aman, `no-store`.
- **QA PDF:**
  - analisis memakai posisi teks pdf.js dari renderer nyata;
  - sapuan varian benar-benar menggeser heading melewati dasar halaman;
  - screenshot halaman diinspeksi (reviewer membuka gambar);
  - perubahan template minimal dan beralasan.
- **Aksesibilitas:** Axe, keyboard, fokus, live region, 360/1440 light/dark, reduced motion, status tidak bergantung warna.
- **Batas scope:**
  - tidak ada migration atau perubahan RPC/worker T21;
  - adapter storage aditif dan pemanggil lama tidak berubah;
  - tidak ada fitur T23–T25, AI, atau evidence.
- **Log/error hygiene:** tidak ada `console.`; angka receipt cocok dengan hasil ulang.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Preview yang bukan revision tersimpan.** Komponen S14 membaca state draft S13, atau tombol export mengirim revision terbaru alih-alih yang ditampilkan. Dijaga oleh unit state, E2E 2 dan 7, dan review sumber data page.
2. **Page break yang "lulus" karena test lemah.** Sapuan tidak benar-benar menempatkan heading di dasar halaman, klasifikasi baris salah, atau screenshot tidak diinspeksi. Dijaga oleh receipt Fase 4 (tabel varian dengan posisi y heading terakhir per halaman), Fase 6 (temuan visual), dan reviewer membuka gambar.
3. **Retry mencetak data lama.** Retry ditawarkan untuk export revision lama setelah sumber dihapus (N2). Dijaga oleh unit matriks dan E2E 5.
4. **URL unduhan bocor atau berumur panjang.** URL dibuat saat render server, masuk HTML/riwayat, atau memuat nama pengguna. Dijaga oleh integration (klaim `exp`, header), E2E (HTML awal tanpa `token=`), dan review.
5. **pdf.js di browser.** Worker jatuh ke *fake worker* di main thread (UI macet), eval aktif, atau canvas kosong tidak terdeteksi. Dijaga oleh probe Fase 0, assertion piksel E2E, dan review konfigurasi.
6. **Adapter storage tidak aditif.** Default `download: true` berubah dan unduhan evidence ikut berubah. Dijaga oleh test storage lama tanpa perubahan dan `test:e2e:evidence`.

# Decision 0027 — T21 Immutable export backend

Date: 6 Oktober 2026

Status: accepted for WorkPulse MVP v0.1 (local acceptance; see `docs/verification/T21-cv-export-backend.md`)

References: PRD R10 (*export the saved CV revision as searchable A4 text … failure preserves the draft and supports retry; evidence is not embedded or linked*), *CV freshness contract*, aturan durable job (*queued, running, succeeded, failed; timeout 120 detik; explicit retry; avoid duplicate jobs*), release scenario *delete its source and verify export is blocked until resolved*, *graduate … export a useful CV*, *validate PDF text extraction, Indonesian characters, long bullets, multipage output*; User Flow F07 langkah 3–6; Wireframe S14 (batas T22); Database Schema §4 (*Storage protocol*), §5 `cv_exports` dan *Deletion and export consistency*, §6; implementation plan §2, §3 *Jobs dan data privat* dan *CV*, §4, §5 T21, §8 *Chromium PDF runtime*; handoff `docs/verification/T21-implementation-plan.md`; gate review `docs/verification/T21-review-remediation-plan.md`; decision 0019, 0021, 0024, 0025, 0026.

## Context

T18 menyiapkan tabel `cv_exports` (struktur saja), T19 builder dengan override dan `buildCvPreviewModel`, T20 freshness dan protokol lock. T21 menambahkan backend export: validasi kesiapan, snapshot immutable, job tahan banting, render PDF A4 lewat Chromium terisolasi, unduhan pemilik, dan retensi 24 jam. Tidak ada UI; halaman S14 `/cv/preview` dan tombolnya milik T22.

Kelima keputusan produk §2.4 handoff disetujui pengguna pada 6 Oktober 2026: (1) renderer Chromium Gotenberg di container terpisah, (2) font Noto Sans dari image terpin, (3) satu export aktif per CV, (4) retry eksplisit snapshot sama maksimal tiga attempt, (5) batas 20 halaman / 10 MiB. Verdict dan klasifikasi gate review, termasuk perbaikan RV1, disetujui pengguna pada hari yang sama.

## Keputusan

1. **Snapshot = data CV tersimpan, bukan model render.** `internal.cv_export_snapshot(cv_documents)` menghasilkan `cv-export.v1`: sepuluh key (`schema_version`, `template_key`, `locale`, `title`, `cv_id`, `cv_revision`, `section_order`, `profile_snapshot` termasuk `display_overrides`, `summary_override`, `items`). Setiap item punya lima key (`id`, `section_key`, `position`, `source_snapshot`, `override_text`), diurutkan per section, position, lalu id. Snapshot tidak memuat `raw_text`, `contribution`, metrics, activity, atau evidence, dan ukurannya ≤ 4 MiB. Worker membangun model dengan `buildExportRenderModel` → `buildCvPreviewModel` T19. *Alasan:* DB §5 menuntut snapshot seluruh CV tersimpan; satu fungsi model untuk preview dan PDF menjamin paritas. Konsekuensinya, format tanggal mengikuti kode worker saat render.
2. **Snapshot dari baris tersimpan.** `source_snapshot` dan `override_text` disalin apa adanya, dan item `kept` memakai wording tersimpan. Freshness hanya menentukan apakah export boleh dilakukan.
3. **Satu definisi kesiapan.** `internal.cv_export_blockers(cv_documents)` menghasilkan kode berikut:
   - `NAME_REQUIRED`: nama efektif = `display_overrides.display_name` ?? `profile_snapshot.display_name`, kosong setelah trim.
   - `CONTENT_REQUIRED`: tidak ada item non-deleted di experience, projects, education, atau achievements. Skill atau certification saja tidak cukup.
   - `ITEM_CHANGED`, `ITEM_DELETED`, `ITEM_UNCONFIRMED`: per item, dengan `item_id`, memakai `internal.cv_item_state` T20.
   - `PROFILE_CHANGED`: memakai `internal.cv_profile_state`.

   Item dan profil berstatus `kept` lolos. Definisi ini dipakai `get_cv_export_readiness` (tanpa lock) dan `request_cv_export` (di bawah lock).
4. **Protokol lock request.** `request_cv_export` berjalan dalam satu transaksi dengan urutan:
   1. `internal.cv_actor()` mengunci profil `for share`; akun deleting → `AUTH_REQUIRED`.
   2. Cek onboarding.
   3. Validasi input.
   4. `cv_documents for update` tanpa cek revision.
   5. Lookup idempotency.
   6. Cek revision → `STALE_REVISION`.
   7. `internal.cv_export_lock_sources`: sumber live `for share` dengan urutan kanonik decision 0026 (experience → project → achievement → education → skill → certification, masing-masing urut id).
   8. Hitung blocker.
   9. Dedup.
   10. Insert.

   `retry_cv_export` mengunci profil → `cv_documents` → export. RPC worker mengunci profil `for share` → export `for update` dan tidak pernah menunggu dokumen atau sumber. *Alasan:* jalur edit sumber mengunci sumber `for update` dengan urutan kanonik yang sama tanpa menyentuh CV, dan jalur delete mengunci CV lebih dulu (decision 0026 poin 7). Akibatnya edit atau delete yang menang lebih dulu terlihat sebagai blocker atau `STALE_REVISION`, sedangkan yang kalah menunggu.
5. **Idempotency.** Key 1–200 karakter `^[A-Za-z0-9_-]+$`, di-trim, `UNIQUE(user_id, idempotency_key)`, lookup dilakukan di bawah lock dokumen. Key sama dengan revision sama mengembalikan export itu (`reused = true`), bahkan bila CV kini terblokir. Key sama dengan revision lain → `IDEMPOTENCY_KEY_REUSED`. Dalam request paralel, hanya request yang membuat export yang menyimpan key-nya.
6. **Dedup setelah validasi (penyimpangan kecil dari urutan butir §2.2.4 handoff, diterima reviewer).** Partial unique index `cv_exports_one_active_key (cv_id) where status in ('queued','running')`. Bila ada export aktif dengan revision sama, export itu dikembalikan; bila revisionnya berbeda → `CV_EXPORT_IN_PROGRESS`. Export `succeeded` dengan revision sama yang belum kedaluwarsa dan belum dipurge juga dikembalikan tanpa render ulang. *Alasan:* CV yang kini terblokir tidak boleh mendapat export lama sebagai jalan pintas (§2.2.6).
7. **State machine.** Kolom baru: `page_count` (1–20), `byte_size` (1–10 MiB), dan `purged_at`. Constraint `cv_exports_state_check` mengatur empat status:
   - `queued`: semua kolom attempt kosong.
   - `running`: token dan lease terisi, `attempt_count > 0`.
   - `succeeded`: object, halaman, byte, dan `expires_at` terisi.
   - `failed`: `error_code` dan `finished_at` terisi, tanpa object.

   `purged_at` hanya berlaku untuk `succeeded`. `cv_exports_object_key_owner_check` mewajibkan key `^<user_id>/export/<uuid>$`.
8. **Imutabilitas.** Trigger `cv_exports_a_guard` (`internal.guard_cv_export_row`, berjalan sebelum trigger touch T18) menolak perubahan `user_id`, `cv_id`, `cv_revision`, `snapshot`, `idempotency_key`, dan `created_at` → `CV_EXPORT_IMMUTABLE`. Grant tabel T18 tidak diubah: klien hanya bisa select miliknya, tanpa write; service role tanpa grant tabel.
9. **Durable job.**
   - `claim_cv_export_jobs` (1–10, `for update skip locked`, lease 120 detik, token baru, `attempt_count + 1`) diawali `expire_cv_export_leases`. Lease yang lewat → `failed` `EXPORT_TIMEOUT`.
   - `get_cv_export_input` hanya mengembalikan snapshot untuk token aktif dengan lease hidup. Akun deleting → `failed` `ACCOUNT_DELETING`.
   - `complete_cv_export` dan `fail_cv_export` adalah CAS atas token dan lease. Key wajib `<user>/export/<token>`; hasilnya `succeeded`, `stale`, atau `failed:ACCOUNT_DELETING`.
   - Worker dari lease lama mendapat `stale` dan menghapus objeknya sendiri.
   - Allowlist kode worker: `EXPORT_TIMEOUT`, `RENDERER_UNAVAILABLE`, `RENDERER_TIMEOUT`, `EXPORT_RENDER_INVALID`, `EXPORT_TOO_LONG`, `EXPORT_SNAPSHOT_INVALID`, `STORAGE_UNAVAILABLE`, `ACCOUNT_DELETING`.
10. **Retry eksplisit tanpa retry otomatis (disetujui).** `retry_cv_export` mengubah export `failed` milik pemanggil menjadi `queued` dengan snapshot, `cv_revision`, dan key identik, tanpa validasi freshness ulang. Retry ditolak dengan `CV_EXPORT_NOT_RETRYABLE` bila kode permanen (`EXPORT_SNAPSHOT_INVALID`, `EXPORT_TOO_LONG`, `ACCOUNT_DELETING`), bila `attempt_count ≥ 3`, atau bila status bukan `failed`. Export akun lain atau ID acak → `CV_EXPORT_NOT_FOUND`. Bila ada export aktif lain → `CV_EXPORT_IN_PROGRESS`. Setelah tiga attempt, jalan pengguna adalah request baru (Regenerate) yang melewati validasi ulang.
11. **Object key per attempt.** Objek disimpan di `<user_id>/export/<attempt_token>` (key kanonik T05, tanpa nama file), diunggah dengan `upsert: false`. Metadata hanya berisi `category` dan `schema`.
12. **Retensi 24 jam.**
    - Saat sukses, `expires_at = finished_at + 24 jam`.
    - `expire_cv_exports` (1–500) mengantrekan `internal.enqueue_storage_delete` dan menyetel `purged_at`.
    - Cleanup objek memakai `claim_export_cleanup_jobs`, `complete_export_cleanup_job`, `fail_export_cleanup_job`, dan `retry_export_cleanup_job`, khusus kategori `export`, dengan backoff.
    - `reconcile_orphan_export_objects` (ambang umur ≥ 900 detik; worker memakai 3.600) mengantrekan objek `export` yang tidak dimiliki baris non-purged.
    - Baris export, CV, dan item tidak pernah dihapus atau diubah oleh export.
13. **Unduhan.** `get_cv_export_download` (authenticated, `stable`) mengembalikan key hanya untuk export `succeeded` milik pemanggil yang belum kedaluwarsa. Export kedaluwarsa atau purged → `CV_EXPORT_EXPIRED`; belum sukses → `CV_EXPORT_NOT_READY`; akun lain atau ID acak → `CV_EXPORT_NOT_FOUND`. Service menerbitkan URL lewat `PrivateStorageService.issueDownload(key, 300)` setelah owner dan kategori dicek ulang. Action hanya mengembalikan `{ url, expiresInSeconds }`.
14. **Renderer Chromium terisolasi (disetujui).** `GotenbergPdfRenderer` mengirim satu part `index.html` ke `/forms/chromium/convert/html` (`paperWidth=8.27`, `paperHeight=11.7`, `preferCssPageSize=true`, `printBackground=false`). Respons dibatasi 10 MiB dan wajib diawali `%PDF-`. Container `workpulse-t21-pdf` memakai digest image T15 dan flag `--chromium-disable-javascript=true --chromium-allow-list="^file:///tmp/.*" --webhook-deny-list=".*" --api-timeout=60s`, port loopback 13401, memori 2 GiB. Flag container T15 tidak diubah.
    - Env worker-only: `WORKPULSE_PDF_RENDERER_MODE` (default `unavailable`), `WORKPULSE_PDF_GOTENBERG_URL`, `WORKPULSE_PDF_RENDER_TIMEOUT_MS` (1.000–90.000). Konfigurasi buruk → `unavailable`.
    - `fake` ditolak di luar `NODE_ENV=development|test` dan ditandai `pdfRenderer: "explicit-test-fake"`.
15. **Template `single_column_v1` (font disetujui).** Template berupa HTML murni dengan CSS inline dan CSP `default-src 'none'; style-src 'unsafe-inline'`, tanpa script, `url()`, `@import`, gambar, atau hyperlink. Semua nilai di-escape dan karakter kontrol dibuang. Font `'Noto Sans', sans-serif` dari image. Aturan halaman: `@page { size: A4; margin: 16mm 18mm }`; heading memakai `break-after: avoid`; entry dan bullet `break-inside: avoid`. Website dicetak sebagai teks; `credential_url` dan evidence tidak pernah ada di model.
16. **Verifikasi output di worker.**
    - Byte: `%PDF-` dan ukuran ≤ 10 MiB.
    - Halaman dan teks: lewat parser thread terisolasi jenis `pdf-export`. Jenis ini tambahan aditif di `src/server/documents/{parse-in-thread,parser-thread,pdf-text}.ts` tanpa ambang 200 karakter impor, sehingga CV pendek tidak dianggap "scanned"; jenis `pdf`, `docx`, dan `pdf-pages` tidak berubah.
    - Lebih dari 20 halaman → `EXPORT_TOO_LONG` (permanen).
    - Teks harus memperlihatkan nama efektif; selain itu `EXPORT_RENDER_INVALID`. Anggaran render worker 80 detik di dalam lease 120 detik.
17. **Cek nama yang memperhitungkan aksara (penyempurnaan §2.2.16, gate review RV1).** Fungsi `exportTextShowsName(text, name, headings)` ada di `src/domain/cv/export.ts`.
    - Nama yang seluruh hurufnya Latin, Yunani, atau Sirilik dicek ketat: NFKC, whitespace diciutkan, substring maju.
    - Nama beraksara lain diterima bila muncul maju atau terbalik (tanpa whitespace), atau bila setiap katanya muncul maju atau terbalik. Bila tetap tidak cocok, diterima hanya bila teks memuat setiap heading section yang dicetak (label en/id).

    *Alasan:* Chromium mencetak Han sebagai radikal Kangxi/CJK, Arab dan Ibrani dalam urutan visual, dan Devanagari secara lossy. Cek NFC murni membuat pengguna dengan nama seperti itu tidak pernah dapat mengekspor. Fallback heading tetap membuktikan bahwa PDF berlapis teks.
18. **Kode error dan pemetaan.** Pemetaan DB → service / action:
    - `CV_EXPORT_BLOCKED` → `EXPORT_BLOCKED` / `VALIDATION`, membawa `blockers` dari `detail` JSON `{"blockers":[{code,item_id?}]}` yang diparse Zod; detail rusak → daftar kosong.
    - `CV_EXPORT_IN_PROGRESS` → `EXPORT_IN_PROGRESS` / `CONFLICT`.
    - `CV_EXPORT_NOT_FOUND` → `EXPORT_NOT_FOUND` / `NOT_FOUND`.
    - `CV_EXPORT_NOT_RETRYABLE`, `CV_EXPORT_NOT_READY`, `CV_EXPORT_EXPIRED` → `CONFLICT`.
    - `IDEMPOTENCY_KEY_REUSED` → `CONFLICT`.
    - `CV_EXPORT_IMMUTABLE` hanya internal.
    - Kode housekeeping (`INVALID_CV_EXPORT_*`, `INVALID_EXPORT_*`, errcode `22023`) tanpa data pengguna. Snapshot > 4 MiB → `INVALID_CV_INPUT`.

    Kunci i18n en/id tersedia untuk `cv.export.error.*`, `cv.export.blocker.*`, dan `cv.export.status.*`. Action `requestCvExportAction`, `retryCvExportAction`, dan `issueCvExportDownloadAction` memakai satu correlation ID per request; `/cv` di-revalidate hanya setelah request atau retry sukses.
19. **Nomor.**
    - Migration `20261005090000_t21_cv_export_backend.sql`: forward-only, parity 31/31, 22 fungsi bernama baru, tanpa perubahan fungsi T18–T20.
    - pgTAP `cv_export.test.sql` (175 assertion).
    - Integration `cv-export.test.ts` dan `cv-export-renderer-real.test.ts` (`test:integration:cv-export`).
    - Worker job `cv-export` dan `export-cleanup`.
    - Runbook `docs/verification/T21-pdf-renderer-runbook.md`.

## Hal yang diterima dari gate review (P3)

- **N2: retry snapshot lama.** Retry tidak memvalidasi ulang, sehingga PDF dari snapshot lama dapat memuat teks sumber yang sudah dihapus atau diedit setelah request. Baris `cv_exports` dan snapshot-nya tidak pernah dipurge; hanya objeknya. Tindak lanjut: T22 menawarkan *Retry* hanya bila `cv_revision` export sama dengan revision CV saat ini, selain itu *Regenerate*. T23 meninjau retensi snapshot.
- **N3: pemilik membaca kolom export sendiri.** Pemilik dapat membaca `snapshot`, `object_key`, `attempt_token`, dan `idempotency_key` export miliknya lewat PostgREST (grant select T18). Policy restriktif `workpulse_private_server_only` menutup bucket untuk `anon`/`authenticated`, sehingga key tidak berguna tanpa signed URL. Kalimat "object key tidak pernah sampai ke browser" berlaku di lapisan aplikasi. Grant kolom berarti mengubah grant T18 dan tidak dilakukan.
- **N4: teks PDF aksara non-Latin.** Kemampuan cari teks terverifikasi untuk Latin (termasuk Indonesia dan Vietnam), Yunani, Sirilik, Thai, dan Hangul. Han tercetak sebagai radikal, Arab dan Ibrani dalam urutan visual, dan Devanagari lossy. Ini milik QA PDF Unicode di T22.
- **N5: hardening container.** Container renderer masih membuka rute LibreOffice yang tidak dipakai. Timeout env sampai 90 detik dibatasi efektif oleh anggaran worker 80 detik. Keduanya dicatat di runbook untuk T25.
- **N6: export reuse hampir kedaluwarsa.** Dedup dapat mengembalikan export sukses yang tinggal beberapa detik. T22 menawarkan *Regenerate* saat `EXPORT_EXPIRED` muncul setelah `reused`.
- **N7: biaya reconcile.** `reconcile_orphan_export_objects` berjalan setiap pass tanpa index `object_key`. Diukur di T24.
- **N8: trim nama berbeda.** Trim nama SQL hanya untuk spasi ASCII, sedangkan TS memakai whitespace Unicode. Nama berisi NBSP saja (hanya mungkin lewat RPC langsung) lolos `NAME_REQUIRED` tetapi gagal permanen `EXPORT_SNAPSHOT_INVALID`.

## Alternatif yang ditolak

- Snapshot berupa model render (SQL tidak menjalankan formatter TS; paritas preview hilang).
- Worker membaca sumber live.
- Retry otomatis.
- Objek per export id (worker lama dapat menimpa).
- `playwright-core`/Chromium di proses worker (dependency dan runtime baru).
- Mengubah flag container T15.
- Menulis CV saat export gagal.
- Validasi di luar lock.
- Dedup sebelum validasi.
- Mempertahankan cek nama NFC murni.

## Seam

- **T22 (S14 `/cv/preview`):**
  - Memakai `get_cv_export_readiness` / `getReadiness`, `listExports`, `requestCvExportAction` (idempotency key per klik, `expected_revision` tersimpan), `retryCvExportAction`, `issueCvExportDownloadAction`, dan `buildExportRenderModel` / `buildCvPreviewModel` agar preview sama dengan PDF.
  - Blocker ditautkan ke `/cv#cv-review` atau `#cv-item-<id>`; `NAME_REQUIRED` dan `CONTENT_REQUIRED` ke S13.
  - Polling status, nama file unduhan, QA visual (heading yatim, clipping, inspeksi halaman), `tests/pdf/`, serta N2, N4, dan N6.
- **T23:** objek dan baris export saat penghapusan akun, retensi snapshot (N2), event export terminal.
- **T24:** p95 render, biaya reconcile (N7).
- **T25:** deployment renderer di jaringan privat tanpa egress, route yang tidak dipakai dimatikan (N5).

## Batas

Bukti lokal saja, tanpa deployment. Race diuji dengan dua koneksi nyata, lima skenario × 3 putaran (plus 40 putaran stres oleh pelaksana) pada satu proses Node; itu bukan beban berskala. Renderer adalah container lokal; isolasi jaringan staging belum terbukti.

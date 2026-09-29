# Handoff T15 Import upload dan extraction staging — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan, buat implementasi minimal, jalankan ulang, lalu commit. Jangan membuat sub-agent.

- Tanggal: 29 September 2026
- Status saat plan ditulis: **TODO**. T15 belum dimulai.
- Dependensi: T13 **DONE** (dependensi resmi). T05 (storage privat), T10 (scanner/cleanup), dan T14 (kontrak `ai_jobs` terbaru) juga **DONE**. Gate M2 **PASSED**. Suite ClamAV nyata lulus pada `7f39e81` (`test:integration:evidence` 14/14, `test:e2e:evidence` 8/8, `test:e2e:m2` 1/1).
- Eksekutor: satu agent **GPT-6 Luna**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude**. Gate review read-only wajib setelah Fase 6; Fase 7 (draft dokumen) dikerjakan setelah gate. Checkpoint setelah Fase 4 bersifat opsional.
- Acuan:
  - PRD §1 baris *Import*, R02, §4 *AI disclosure / File safety / Data minimization / Failures*, dan release scenario *Import an Indonesian CV with overlapping employment dates*.
  - User Flow F01 (langkah 2–3), *Import exceptions*, dan state transition *Import batch*.
  - Wireframe S02 (`/onboarding/import`) dan batas S03 (`/imports/:id/review`, milik T17).
  - Database Schema §1 (relasi `import_batches` → `import_items`), §3 `ai_jobs`, §4 `import_batches`/`import_items`, *Storage protocol and quotas*, *File retention*, dan §6 aturan RLS.
  - `IMPLEMENTATION_PLAN.md` §2 baris *Parsing*, §3 *Jobs dan data privat*, §4 baris *pages import* dan *profil provisional*, blok T15 di §5, dan §8 baris *Malware scanner dan parser sandbox* serta *DOCX pagination renderer*.
  - `docs/decisions/0002-foundation-schema.md` poin 1, `0007-private-storage-foundation.md`, `0016-t10-evidence-backend.md`, `0019-t13-ai-jobs-consent.md` bagian *Seam*, `0020-t14-detection-review.md` baris T15.

**Goal:** Pengguna baru di S02 memberi consent AI, lalu mengunggah satu CV PDF/DOCX (maksimal 10 MiB dan 20 halaman). Server memvalidasi signature dan ukuran, menyimpan file di prefix privat `import`, lalu membuat satu import batch. Worker memindai malware, mengekstrak teks dalam thread terisolasi (timeout dan batas memori), menghitung halaman (PDF lewat parser, DOCX lewat renderer terisolasi), lalu menjalankan job AI kind `import` yang menghasilkan kandidat terstruktur dengan excerpt sumber ke `import_items`. Batch berakhir di `review`, atau `failed` dengan alasan spesifik. File terenkripsi, hasil scan, rusak, tidak didukung, terlalu besar, atau terlalu panjang selalu menawarkan *Try another file* dan *Start manually*. Pengguna dapat meninggalkan layar dan kembali, membatalkan, atau me-retry batch yang sama. Ekstraksi **tidak pernah** menulis record canonical. Tidak ada OCR dan tidak ada auto-confirm. File mentah dan teks ekstraksi dihapus dalam 24 jam setelah status terminal.

**Architecture:** Semua state di PostgreSQL. Migration forward-only menambah `public.import_batches`, `public.import_items`, dan queue internal `internal.import_jobs` (scan + parse, pola `internal.evidence_scan_jobs`). `ai_jobs` diperluas dengan `import_batch_id` dan kind `import` (tepat satu target). Upload berjalan dalam satu request server (pola route evidence T10): begin (idempotent) → upload object → finalize. Worker punya pass import baru: claim → download dan verifikasi hash → ClamAV → parse dalam `worker_threads` → `complete_import_parse` (menyimpan teks, `page_count`, meng-enqueue job AI `import` dalam transaksi yang sama). Pass AI T13 bercabang per kind: `import` membaca teks lewat RPC input khusus, memanggil `AIProvider.extractImport`, memvalidasi dan membumikan hasil di domain TypeScript, lalu `complete_import_ai_job` menulis item dan membuka `review` secara atomik. Housekeeping mem-purge batch terminal lewat `internal.storage_jobs`. UI S02 membaca status lewat route GET owner-scoped dengan polling backoff. Tabel canonical (`profiles`, `experiences`, `education`, `certifications`, `skills`, `achievements`) **tidak** disentuh.

**Tech stack:** Next.js App Router, TypeScript strict, Supabase PostgreSQL/RLS/Storage, Zod 4, worker Node 24 (`.ts` type stripping, `node:worker_threads`), ClamAV (T10), `pdfjs-dist` (dependency baru, lihat §2.2.9), renderer DOCX terisolasi Gotenberg/LibreOffice di container loopback (lihat §2.2.10), Vitest, pgTAP, Playwright + Axe, dan pnpm dari lockfile.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `IMPLEMENTATION_STATUS.md` (T14), `IMPLEMENTATION_PLAN.md` §1–§4 dan blok M3, decision 0002/0007/0016/0019/0020, `docs/verification/T10-scanner-runbook.md`, serta `docs/verification/T14-implementation-plan.md` sebagai pola. Ekstrak PRD, F01, S02/S03, dan DB §1/§3/§4/§6 memakai alat ekstraksi DOCX (mis. `python` + `zipfile` atas `word/document.xml`); jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD §1 Import:** PDF dan DOCX berbasis teks, maksimal 10 MiB dan 20 halaman. Scan, file berpassword, dan format tidak didukung diarahkan ke entri manual.
- **PRD R02:** ekstrak profil, pendidikan, pengalaman, skill, sertifikasi, dan kandidat achievement ke staging. Pengguna mengedit dan memilih sebelum satu commit atomik. Retry tidak menduplikasi data.
- **PRD §3:** klaim achievement hasil import tetap kandidat sampai pengguna memilih *Confirm* saat review. Wording tidak boleh mengarang angka, senioritas, kausalitas, employer, atau hasil.
- **PRD §4:** jelaskan sebelum aksi AI pertama bahwa teks terpilih dikirim ke pemroses eksternal; catat versi dan waktu consent. Validasi signature, MIME, ukuran, dan kepemilikan di server; karantina sampai screening lulus. Kirim hanya teks yang dibutuhkan. Hapus file import asli dan teks staging dalam 24 jam setelah commit, pembatalan, atau kegagalan terminal. Job durable punya state queued/running/succeeded/failed, timeout 120 detik, dan retry eksplisit.
- **F01 langkah 2–3:** import menerima PDF/DOCX dalam 10 MiB dan 20 halaman; jelaskan pemrosesan AI dan minta consent sebelum ekstraksi. Validasi file, simpan import batch, antrekan ekstraksi. Tampilkan progres dan izinkan meninggalkan layar; kembali melanjutkan batch yang sama.
- **F01 Import exceptions:** file tidak didukung, terenkripsi, hasil scan, rusak, atau terlalu besar menampilkan alasan spesifik dengan *Try another file* dan *Start manually*. Ekstraksi parsial membuka review dengan field kurang disorot. Tidak ada hasil ekstraksi yang auto-confirm. Submit ganda mengembalikan hasil batch yang sudah ada. Session kedaluwarsa meminta sign-in dan hanya melanjutkan state server yang sudah tersimpan.
- **F01 state *Import batch*:** queued → running → review → committed; queued/running/review → cancelled; running → failed. Commit sekali; retry kegagalan pada batch yang sama.
- **S02:** file picker dan drop area menerima satu PDF atau DOCX. Tampilkan batas format dan ukuran sebelum upload. Consent AI sebelum ekstraksi. *Start manually* membuka S12. Selama proses tampilkan batch tersimpan dan progres dengan *Leave and return later*. Retry memakai batch yang sama; cancel tidak menyisakan record karier.
- **S03 (T17):** kandidat dikelompokkan per profile, experience, education, certifications, skills, achievements, dengan excerpt dan error validasi. Ekstraksi kosong menawarkan entri manual.
- **DB §4 `import_batches`:** `file_key`, `filename`, `bytes`, `sha256`, `status`, `extracted_text`, `committed_at`, `expires_at`, `error_code`. Status queued/running/review/committed/failed/cancelled. `bytes` ≤ 10 MiB; halaman ≤ 20 divalidasi saat parsing. File/teks terminal kedaluwarsa dalam 24 jam. Hash hanya memberi peringatan untuk import sebelumnya, tidak melarang pemakaian ulang.
- **DB §4 `import_items`:** `batch_id`, `entity_type` (profile/experience/education/certification/skill/achievement), `payload`, `source_excerpt`, `action` (create/map/skip), `target_id`, `committed_id`, `validation_errors` default `[]`. Payload boleh mereferensikan ID item sementara; commit (T16) me-resolve menjadi ID canonical milik pengguna.
- **DB §3 `ai_jobs`:** kind import/detect/refine, `activity_id` **atau** `import_batch_id`, tepat satu target yang kompatibel.
- **DB §4 Storage/Retention:** prefix privat terpisah `user_id/category/object_uuid`. Hanya evidence yang dihitung ke 50 MiB. Excerpt import yang disalin ke row karier menjaga provenance setelah teks staging dipurge. Mapping import dan metadata status minimal tetap ada sampai akun dihapus.
- **DB §6:** RLS di semua tabel pengguna; tolak write klien langsung ke state worker, hasil AI mentah, dan import commit.
- **Rencana §4:** simpan `page_count` setelah parsing/rendering terpercaya; metadata halaman DOCX bukan sumber otoritatif. Batasi waktu parsing, memori, dan ukuran ZIP tanpa kompresi.

Pertahankan perubahan lokal pengguna. Jangan menandai T15 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T15-phaseN-<slug>.md`. Receipt berisi tujuan, file yang berubah, command beserta hasil aktual (exit code dan angka), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya.

## 1. Acceptance inti T15

T15 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Alur utama PDF.** Consent → upload PDF teks 2 halaman → batch `queued` → worker: scan bersih, parse (`page_count = 2`), job AI `import` `succeeded` → batch `review` dengan item per `entity_type`, masing-masing punya `source_excerpt` yang merupakan substring teks ekstraksi. Dibuktikan integration dan E2E.
2. **Alur utama DOCX dengan renderer nyata.** DOCX teks → `page_count` dari renderer terisolasi (bukan `docProps/app.xml`) → `review`. DOCX 21 halaman menurut renderer → `failed/TOO_MANY_PAGES`, walaupun metadata DOCX menyebut 1 halaman. Dibuktikan integration nyata terhadap container renderer (§2.2.10).
3. **Ekstraksi tidak menulis record canonical.** Jumlah row `experiences`, `education`, `certifications`, `skills`, `achievements`, `projects`, `activities`, serta `profiles.revision` identik sebelum dan sesudah seluruh pipeline, termasuk jalur gagal, cancel, dan retry. Dibuktikan pgTAP dan integration.
4. **Validasi upload di server.** File kosong, >10 MiB, `Content-Length` tidak cocok dengan body, signature bukan PDF/DOCX (PNG, JPEG, teks), DOCX dengan macro (`vbaProject.bin` atau content type macro-enabled), dan DOCX yang gagal validasi ZIP ditolak dengan kode spesifik sebelum object dibuat. Container CFB dengan stream `EncryptedPackage` → `ENCRYPTED_FILE`; CFB lain (mis. `.doc` lama) → `UNSUPPORTED_FORMAT`. Dibuktikan unit dan E2E API.
5. **Deteksi saat parsing.** PDF berpassword → `ENCRYPTED_FILE`; PDF tanpa text layer → `SCANNED_PDF`; PDF rusak/terpotong → `CORRUPT_FILE`; DOCX tanpa teks → `EMPTY_DOCUMENT`; lebih dari 20 halaman → `TOO_MANY_PAGES`; teks melebihi batas AI → `IMPORT_TEXT_TOO_LONG`. Semua kode ini permanen: tanpa Retry, dengan *Try another file* dan *Start manually*. Dibuktikan unit (parser) dan integration (worker).
6. **Batas parser.** ZIP bomb DOCX (rasio kompresi ekstrem atau total uncompressed > batas) ditolak tanpa mengalokasikan output penuh. Parse yang melewati timeout menghentikan thread dan menghasilkan `PARSER_TIMEOUT`. Thread melewati batas memori → `CORRUPT_FILE` atau `PARSER_TIMEOUT` tanpa menjatuhkan proses worker. Dibuktikan unit (thread helper) dan integration.
7. **Malware screening wajib.** EICAR di dalam PDF → `failed/MALWARE_DETECTED`, object dijadwalkan dihapus, dan tidak ada teks yang diekstrak. Scanner `unavailable` tidak pernah melewatkan scan: job di-retry (maksimal 5 attempt, backoff), lalu batch `failed/SCANNER_UNAVAILABLE` yang dapat di-retry. Dibuktikan integration nyata (ClamAV) dan unit.
8. **Consent.** Tanpa consent terkini, upload ditolak `CONSENT_REQUIRED` tanpa object atau batch. Consent ditarik setelah upload: parse tetap boleh (lokal), tetapi enqueue AI menghasilkan batch `failed/CONSENT_REQUIRED` yang retriable setelah consent diberikan lagi; `get_import_ai_job_input` dan `complete_import_ai_job` juga menolak. Teks tidak pernah dikirim tanpa consent. Dibuktikan pgTAP dan integration (fake provider berpenghitung = 0 panggilan).
9. **Grounding kandidat.** Kandidat dengan excerpt yang bukan substring teks (setelah normalisasi whitespace) dibuang. Field kunci (`organization`, `role_title`, `institution`, `qualification`, `name`) yang tidak muncul di excerpt dikosongkan dan diberi `validation_errors` `UNGROUNDED`. Angka di teks achievement yang tidak ada di excerpt dikosongkan. Tanggal tidak pernah dibuat lebih presisi daripada sumber (tahun saja tetap `year`). Output gagal skema → `AI_OUTPUT_INVALID`. Dibuktikan unit (validator) dan integration (fake scenario).
10. **Ekstraksi parsial dan kosong.** Kandidat dengan field wajib hilang tetap disimpan dengan `validation_errors` `REQUIRED` per field. Hasil tanpa kandidat membuat batch `review` dengan nol item (S02 menawarkan entri manual). Tidak ada item yang disimpan sebagai confirmed; payload achievement selalu `status: "draft"`. Dibuktikan pgTAP dan integration.
11. **Upload idempoten.** Request upload ganda dengan idempotency key dan byte yang sama mengembalikan batch yang sama (satu row, satu object). Key sama dengan byte berbeda → `IDEMPOTENCY_KEY_REUSED`. Response yang hilang setelah object terunggah dapat di-replay tanpa object kedua. Dibuktikan integration (paralel ×3).
12. **Peringatan hash duplikat.** Upload byte yang sama dengan batch sebelumnya milik pengguna yang sama (key berbeda) tetap membuat batch baru, dan view memuat `duplicateOf` (tanggal batch terakhir dan statusnya). Hash milik akun lain tidak pernah memicu peringatan. Dibuktikan integration dan E2E.
13. **Cancel.** Cancel pada `queued`, `running` (saat scan, parse, dan AI berjalan), dan `review` menghasilkan `cancelled`; completion worker yang terlambat berakhir `stale` tanpa menulis item, dan item yang sudah ada dihapus saat purge. Cancel ganda idempoten; cancel pada `committed`/`failed` ditolak. Dibuktikan pgTAP dan integration (race dengan hook worker).
14. **Leave-return dan session.** Menutup halaman saat `running` lalu kembali ke `/onboarding/import` menampilkan batch yang sama beserta progresnya; tidak ada batch baru. Setelah session kedaluwarsa, sign-in dengan `returnTo` melanjutkan batch tersimpan. Dibuktikan E2E.
15. **Retry pada batch yang sama.** Kegagalan transient (`SCANNER_UNAVAILABLE`, `STORAGE_UNAVAILABLE`, `PAGE_COUNT_UNAVAILABLE`, `AI_UNAVAILABLE`, `AI_PROVIDER_TIMEOUT`, `AI_OUTPUT_INVALID`, `CONSENT_REQUIRED`) dapat di-retry dan melanjutkan dari tahap yang gagal pada batch yang sama. Retry ganda paralel hanya meng-enqueue satu job. Batas retry tercapai → `IMPORT_RETRY_EXHAUSTED` dengan jalur manual. Kode permanen menolak retry `IMPORT_NOT_RETRIABLE`. Dibuktikan pgTAP dan integration.
16. **Retensi terminal.** Batch `cancelled` segera eligible purge; `failed` eligible setelah jendela retry 23 jam; purge menghapus object (lewat `internal.storage_jobs` dengan verifikasi ketiadaan object), mengosongkan `extracted_text`/`file_key`, dan menghapus item batch yang tidak di-commit. Metadata minimal (`status`, `sha256`, `bytes`, `page_count`, `error_code`, timestamp) tetap ada. Retry setelah purge → `IMPORT_EXPIRED`. Batch `committed` yang dibuat fixture (T16 belum ada) juga dipurge: teks, object, payload, dan excerpt item dikosongkan, sedangkan `action/target_id/committed_id` tetap. Dibuktikan pgTAP dan integration (waktu dimanipulasi lewat fixture, bukan sleep).
17. **Status jujur.** *Uploading*, *Checking file*, *Reading document*, *Extracting career data*, *Ready for review*, *Failed*, dan *Cancelled* ditampilkan sesuai state server. Tanpa worker, batch tetap `queued` dan UI menampilkan *Waiting to start* tanpa klaim hasil. Polling berhenti di status terminal atau `review`. Dibuktikan unit (view model) dan E2E.
18. **Isolasi dua akun.** Akun B tidak dapat membaca status, item, atau teks batch A, tidak dapat cancel/retry, dan tidak dapat memakai idempotency key A untuk mendapat batch A. Semua error generik `NOT_FOUND`. Kolom `extracted_text` dan `file_key` tidak dapat dibaca klien mana pun. Dibuktikan pgTAP dan integration.
19. **Log hygiene.** Sentinel di isi CV, nama file, dan key palsu tidak muncul di stdout/stderr worker, pesan error, `error_code`, response route, maupun receipt. Response route tidak memuat teks ekstraksi atau payload item. Dibuktikan integration dan grep.
20. **UI aksesibel.** S02 dapat dioperasikan dengan keyboard (file picker, drop area juga dapat diaktifkan dengan Enter/Space, dialog consent dan cancel mengembalikan fokus), status dibacakan (`role="status"`), Axe WCAG 2.2 A/AA bersih, tanpa overflow di 360/1440 px light/dark, copy en/id, tanpa sparkle atau gradient. Dibuktikan E2E.
21. **Regresi.** Suite T06–T14 tetap lulus tanpa melemahkan assertion, termasuk `test:integration:ai`, `test:integration:ai-review`, `test:integration:evidence` (ClamAV nyata), `test:e2e:ai-review`, dan `test:e2e:m2` (assertion env AI-free tidak diubah).

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration forward-only: `import_batches`, `import_items`, `internal.import_jobs`, perluasan `ai_jobs` untuk kind `import`, RPC user dan worker, purge, cleanup claim prefix `import`, dan pgTAP.
- Domain: kontrak dan kode error import, skema `import.v1`, validator plus grounding, view model S02, klasifikasi error permanen vs transient.
- Server: inspeksi upload, reader OOXML bersama, parser PDF/DOCX dalam `worker_threads`, adapter renderer DOCX (`gotenberg`/`fake`/`unavailable`), prompt dan skema `import.prompt.v1`, `AIProvider.extractImport`, fake scenario import.
- Feature: `import-service.ts`, route upload dan status, server action cancel/retry.
- Worker: pass import (scan, parse, cleanup import, purge) dan cabang kind `import` pada pass AI.
- UI S02: consent, pilih/drop file, upload, progres, leave-return, cancel, gagal permanen/transient, retry, ringkasan jumlah kandidat saat `review`, dan peringatan duplikat. Copy en/id dan CSS token.
- Test unit/pgTAP/integration/E2E, generator fixture, script baru, runbook renderer, decision 0021, receipt.

### 2.2 Keputusan implementasi

1. **Import memerlukan consent AI dan dicek sebelum upload.** `begin_import_batch` menolak `CONSENT_REQUIRED` bila consent tidak terkini. UI membuka `AiConsentDialog` (T13) sebelum file dikirim; *Continue manually* membuka `/settings/profile?mode=onboarding`. Alasan: F01/S02 meminta consent sebelum ekstraksi, dan tanpa ekstraksi AI tidak ada gunanya menyimpan file pengguna. Consent dicek ulang saat enqueue AI, saat input AI dibaca, dan saat completion (pola T13). Parse dan scan tidak butuh consent karena tidak keluar sistem.
2. **Upload satu request, tiga langkah DB** (pola `src/features/evidence/evidence-service.ts:73-117`). `POST /api/imports` membaca body terbatas (`readBoundedBody`, `src/features/evidence/file-inspection.ts:287`), menjalankan inspeksi signature, menghitung SHA-256, lalu:
   - `begin_import_batch(p_idempotency_key uuid, p_filename text, p_bytes bigint, p_mime text, p_sha256 text)` membuat batch `queued` dengan `stage = 'uploading'`, `file_key = <user>/import/<batch_id>`, dan mengembalikan receipt (replay dengan payload identik mengembalikan batch yang sama beserta stage-nya).
   - Route mengunggah object (object sudah ada dengan metadata cocok = replay sah, pola `StorageObjectAlreadyExistsError`).
   - `finalize_import_upload(p_batch_id, p_expected_revision)` mengubah `stage` menjadi `screening` dan meng-enqueue `internal.import_jobs` dalam satu transaksi.
   Batch yang tertahan di `uploading` lebih dari 15 menit menjadi `failed/UPLOAD_INCOMPLETE` lewat housekeeping. Nama file disanitasi (trim, tanpa karakter kontrol, maksimal 255 karakter), tidak dikirim ke AI, dan tidak dilog.
3. **Status DB tidak ditambah; progres memakai kolom `stage`.** `status` tetap enum DB §4. Kolom teknis `stage` (`uploading`/`screening`/`parsing`/`extracting`/`done`) hanya untuk progres UI. `queued` berarti belum diklaim worker; worker mengubah ke `running` saat klaim pertama; `review` saat item tersimpan. Alasan: DB §4 dan state transition F01 tidak boleh diubah diam-diam.
4. **Queue scan+parse terpisah dari `ai_jobs`.** `internal.import_jobs` (satu row per batch, unique `batch_id`) meniru `internal.evidence_scan_jobs` (`20260925100000_t10_evidence_backend.sql:8`): claim `for update skip locked`, lease 120 detik, `attempt_token`, maksimal 5 attempt untuk kegagalan transient dengan backoff, completion compare-and-set. Satu job melakukan scan lalu parse; bila scan bersih dan parse transient gagal, retry mengulang scan (murah, dan hash diverifikasi ulang). Alasan: scan/parse bukan operasi AI, dan batas 3 attempt `ai_jobs` tidak cocok untuk outage scanner.
5. **Job AI kind `import`.** `ai_jobs.activity_id` menjadi nullable; tambah `import_batch_id` dengan composite FK `(user_id, import_batch_id)` → `import_batches(user_id, id)` on delete cascade; check tepat satu target dan `kind = 'import'` ⇔ `import_batch_id is not null`; kind `in ('detect','refine','import')`; key `import:<batch_id>:r1`; unique parsial satu job per batch. `input_revision = 1` karena teks ekstraksi immutable. `ai_jobs.result` untuk import hanya ringkasan kecil `{schema_version:'import.v1', counts:{...}, dropped_ungrounded:n}`; kandidat disimpan sebagai `import_items`. Alasan: staging adalah tempat hasil ekstraksi menurut DB §4, dan check ukuran result T13 (32 KB) tetap berlaku.
6. **Materialisasi atomik.** `complete_import_ai_job(p_job_id, p_attempt_token, p_summary jsonb, p_items jsonb)` (service_role): validasi token/lease/consent/owner tidak deleting, batch `running` dan `stage = 'extracting'`; bila batch sudah `cancelled` → job `failed/IMPORT_CANCELLED`, return `'stale'`. Lalu insert semua item (maksimal 300 total, per tipe maksimal 60, profile maksimal 1), job `succeeded`, batch `review`/`done` dalam satu transaksi. Ref sementara di payload (`ref`, `experience_ref`) di-resolve menjadi `import_items.id` di dalam fungsi ini (`payload.experience_item_id`). Item achievement tanpa experience yang cocok tetap standalone.
7. **Kegagalan AI merambat ke batch.** Jalur gagal T13 (`internal.fail_ai_job_locked`, `20260928090000_t13_ai_jobs_consent.sql:228`, dan lease expiry di `expire_ai_job_leases`) diperluas: bila job kind `import`, batch menjadi `failed` dengan `error_code` yang sama dan `expires_at = now() + 23 jam`. `retry_ai_job` dan `request_ai_analysis` menolak kind `import` (`AI_JOB_NOT_APPLICABLE`). Retry import hanya lewat `retry_import_batch`.
8. **Retry batch.** `retry_import_batch(p_batch_id, p_expected_revision)` (authenticated) untuk batch `failed` dengan kode transient dan belum purge: tahap scan/parse → requeue `import_jobs` (attempt direset, `batch.retry_count + 1`); tahap AI → requeue job AI yang sama bila `attempt_count < 3`, jika tidak `IMPORT_RETRY_EXHAUSTED`. `retry_count` maksimal 3 → `IMPORT_RETRY_EXHAUSTED`. Kode permanen → `IMPORT_NOT_RETRIABLE`. Setelah purge → `IMPORT_EXPIRED`. Retry paralel dikunci pada row batch.
9. **Parser di `worker_threads` dengan batas keras.** `src/server/documents/parse-in-thread.ts` menjalankan `parser-thread.ts` dengan `resourceLimits` (`maxOldGenerationSizeMb: 256`, `maxYoungGenerationSizeMb: 32`), timeout 30 detik (`terminate()` lalu `PARSER_TIMEOUT`), dan input `Uint8Array` yang ditransfer. Output hanya `{ text, pageCount }` atau `{ code }`.
   - **PDF:** dependency baru `pdfjs-dist` (build legacy untuk Node), dipin exact lewat `pnpm add -E`. Opsi: `isEvalSupported: false`, `disableFontFace: true`, `useSystemFonts: false`, `stopAtErrors: true`, tanpa worker pdf.js tambahan di dalam thread. `PasswordException` → `ENCRYPTED_FILE` (PDF yang hanya memakai owner password tetapi dapat dibuka tanpa password diterima, dicatat di decision). `pageCount = numPages`. Teks per halaman digabung dengan pemisah halaman. Total karakter non-whitespace < 200 → `SCANNED_PDF`.
   - **DOCX teks:** tanpa dependency baru. Reader ZIP T10 (`readDocxParts`, `file-inspection.ts:80`) dipindah ke `src/server/documents/ooxml-zip.ts` dan diekspor dengan parameter daftar part yang dibutuhkan; evidence memakai modul yang sama dengan perilaku identik (test `tests/unit/evidence-file-inspection.test.ts` harus tetap lulus tanpa perubahan assertion). Teks diambil dari `word/document.xml`: `w:t`, `w:tab` → tab, `w:br`/`w:cr` → newline, akhir `w:p` → newline, sel tabel dipisah tab. Header/footer/komentar tidak diambil. Teks kosong → `EMPTY_DOCUMENT`.
   - Batas teks untuk AI: 60.000 karakter setelah normalisasi → di atasnya `IMPORT_TEXT_TOO_LONG`.
   - Alasan: parser pihak ketiga pada input tak tepercaya harus bisa dihentikan tanpa menjatuhkan worker; pdf.js adalah parser PDF murni JS tanpa binary native.
10. **Jumlah halaman DOCX lewat renderer terisolasi.** Adapter `DocxPageRenderer` (`src/server/documents/docx-renderer.ts`) dengan mode `WORKPULSE_DOCX_RENDERER_MODE=gotenberg|fake|unavailable` (default `unavailable`):
    - `gotenberg`: `POST {WORKPULSE_GOTENBERG_URL}/forms/libreoffice/convert` berisi byte DOCX saja (nama part generik, bukan filename pengguna), timeout `WORKPULSE_DOCX_RENDER_TIMEOUT_MS` (default 30000), respons dibatasi 50 MiB, lalu PDF hasil dihitung halamannya dengan parser thread yang sama. Container dijalankan hanya di `127.0.0.1:13400`, image dipin digest (Fase 0), tanpa mount file.
    - `fake`: hanya bila `NODE_ENV` `test`/`development`; jumlah halaman dari penanda fixture `WP-FAKE-PAGES:<n>` di teks, default 1. Ditandai jelas di output worker.
    - `unavailable` atau renderer error → retry transient pada `import_jobs`, lalu `failed/PAGE_COUNT_UNAVAILABLE` (retriable) dengan *Start manually*.
    - `docProps/app.xml` tidak pernah dipakai sebagai jumlah halaman.
    - Alasan: rencana §2/§4/§8 meminta rendering terisolasi; LibreOffice dalam container sejalan dengan pola ClamAV T10 dan tidak memasang binary di host. Pilihan runtime ini perlu konfirmasi pengguna (lihat §8).
11. **Inspeksi upload** (`src/features/import/import-file-inspection.ts`): PDF (`%PDF-`), DOCX (validasi ZIP/OOXML bersama; tolak `word/vbaProject.bin` dan content type `macroEnabled`), CFB (`D0 CF 11 E0 A1 B1 1A E1`: cari nama stream `EncryptedPackage` dalam UTF-16LE → `ENCRYPTED_FILE`, selain itu `UNSUPPORTED_FORMAT`), lainnya `UNSUPPORTED_FORMAT`. MIME dari header harus cocok dengan hasil inspeksi (`FILE_TYPE_MISMATCH`). Ukuran 1..10 MiB (`FILE_TOO_LARGE`/`FILE_EMPTY`). Jumlah halaman **tidak** dihitung di web.
12. **Skema `import.v1` dan grounding** (`src/domain/import/extract-result.ts`). Output mentah AI: `profile` (opsional: `display_name`, `headline`, `summary`, `contact_email`, `phone`, `location`, `website`, `excerpt`), `experiences[]` (`ref`, `organization`, `role_title`, `kind` employment/internship/volunteer atau null, `description`, `start`/`end` `{date, precision}` atau null, `is_current`, `excerpt`), `education[]` (`institution`, `qualification`, `field_of_study`, `description`, `start`, `end`, `is_current`, `excerpt`), `certifications[]` (`name`, `issuer`, `issued`, `credential_url`, `excerpt`), `skills[]` (`name`, `excerpt`), `achievements[]` (`title`, `contribution`, `outcome`, `achieved_on`, `experience_ref`, `cv_bullet`, `metrics`, `excerpt`). Nama field mengikuti kolom canonical (`20260916090000_foundation_schema.sql:182-354`, `20260922100000_t09_achievements_skills.sql:127`). Validator:
    - Skema Zod gagal → `AI_OUTPUT_INVALID` (seluruh output).
    - `excerpt` wajib, ≤ 1.000 karakter, dan harus substring teks setelah normalisasi whitespace dan case → jika tidak, kandidat dibuang dan dihitung `dropped_ungrounded`.
    - Field kunci yang tidak muncul di excerpt dikosongkan dan diberi `{field, code:'UNGROUNDED'}`. Field wajib canonical yang kosong diberi `{field, code:'REQUIRED'}`.
    - Angka pada `title/contribution/outcome/cv_bullet/metrics` harus muncul di excerpt (pakai `numbersIn` di `src/domain/ai/detect-result.ts:139`, yang saat ini privat; ekspor tanpa mengubah perilakunya); jika tidak, field/metric dihapus dan diberi `UNGROUNDED`.
    - Tanggal: presisi `year`/`month`/`day` harus bisa dibaca dari excerpt (tahun empat digit wajib ada di excerpt); jika tidak, tanggal dikosongkan (unknown = NULL). Interval yang pasti terbalik diberi `DATE_RANGE`. Overlap antar pengalaman **tidak** ditolak.
    - `credential_url`/`website` harus http/https; selain itu dikosongkan.
    - Payload achievement selalu `status: "draft"`; confirm hanya di T16/T17.
    - `display_name` placeholder (`internal.is_real_display_name` false) dikosongkan.
13. **Prompt `import.prompt.v1`** (`src/server/ai/import-prompt.ts`): ekstrak hanya fakta yang tertulis, excerpt disalin verbatim, jangan menerjemahkan, jangan menyimpulkan senioritas/impact/angka, gunakan null untuk yang tidak ada. `OpenAIProvider.extractImport` memakai `json_schema` strict (skema dari `import.v1`), dengan payload hanya `{ text }` (tanpa filename, email akun, atau ID). `max_tokens` cukup untuk 300 kandidat; timeout `AI_PROVIDER_TIMEOUT_MS` (90 detik, lebih kecil dari lease 120 detik).
14. **Fake scenario import** (development/test saja): `import_valid` (kandidat deterministik dari baris fixture berformat `EXP|Org|Role|2019|2021`, dsb., dengan excerpt baris itu), `import_empty`, `import_partial` (role hilang), `import_ungrounded` (excerpt dan organization rekaan), `import_numbers` (angka rekaan di achievement), `import_malformed`, `import_timeout`.
15. **Peringatan duplikat.** `begin_import_batch` mengembalikan `duplicate_of_created_at` dan `duplicate_of_status` dari batch terakhir pengguna yang sama dengan `sha256` sama (berbeda id). Index `(user_id, sha256, created_at desc)`. Tidak memblokir.
16. **Cancel.** `cancel_import_batch(p_batch_id, p_expected_revision)`: `queued`/`running`/`review` → `cancelled`, `expires_at = now()`; job import terbuka ditutup (`failed/IMPORT_CANCELLED` untuk AI, status `cancelled` untuk `import_jobs`). Idempoten untuk `cancelled`. `committed`/`failed` → `IMPORT_NOT_CANCELLABLE`. Tidak ada record canonical yang pernah ditulis, jadi tidak ada rollback karier.
17. **Purge dan cleanup.** `purge_expired_import_batches(p_limit)` (service_role) memilih batch terminal dengan `expires_at <= now()` dan `purged_at is null`, lalu: enqueue `internal.storage_jobs` untuk `file_key`, `extracted_text = null`, `file_key = null`, hapus item batch `cancelled`/`failed`, kosongkan `payload` (menjadi NULL) dan `source_excerpt` item batch `committed` sambil mempertahankan `entity_type/action/target_id/committed_id`, lalu set `purged_at`. Cleanup object import memakai RPC baru `claim_import_cleanup_jobs` dan pasangan complete/retry/fail yang dibatasi prefix `import` (T10 membatasi evidence ke prefix `evidence`, `20260925130000_t10_cleanup_claim_scope.sql:24`). Object dianggap terhapus hanya setelah metadata tidak ada. Housekeeping juga menandai orphan object import (object tanpa batch hidup, umur ≥ 1 jam) untuk cleanup. Jendela `failed` = 23 jam supaya purge selesai sebelum batas 24 jam PRD walau worker tertunda. Batch `review` yang ditinggalkan **tidak** dipurge pada T15 (bukan state terminal); dicatat sebagai keputusan terbuka untuk T17/T23.
18. **Kolom privat.** `extracted_text`, `file_key`, dan `idempotency_key` tidak di-grant ke `authenticated` (column-level grant). Item dapat dibaca pemilik (T17 membutuhkannya), tetapi route T15 hanya mengembalikan jumlah per `entity_type`.
19. **UI S02** (`src/features/import/import-start.tsx`, client) menggantikan halaman placeholder `src/app/onboarding/import/page.tsx`:
    - Page server memuat batch aktif terbaru (`queued`/`running`/`review`, atau `failed` yang belum purge) untuk leave-return; guard redirect onboarding yang ada dipertahankan (pengguna yang sudah onboarding masuk lewat S12 di T17).
    - Pilih file: tombol *Choose file* dan drop area (dapat diaktifkan keyboard), teks batas *PDF or DOCX, up to 10 MiB and 20 pages*, *Start manually*.
    - Consent: `AiConsentDialog` sebelum upload.
    - Uploading → *Uploading…*; setelah itu progres per `stage`: *Waiting to start*, *Checking file*, *Reading document*, *Extracting career data* (`role="status"`, teks jelas, bukan spinner tak berujung), dengan catatan *You can leave this page. Progress is saved.* dan *Cancel import* (dialog konfirmasi).
    - Gagal permanen: alasan per kode, *Try another file*, *Start manually*. Gagal transient: alasan, *Retry* (nonaktif dengan alasan bila habis/expired), *Start manually*.
    - `review`: *Extraction finished* dengan jumlah kandidat per kelompok. Nol kandidat → *We couldn't find career data in this file* + *Start manually*. Link ke S03 **tidak** dirender sampai T17; copy tidak menjanjikan fitur yang belum ada.
    - Peringatan duplikat nonblokir setelah upload.
    - Polling memakai pola `EVIDENCE_POLL_DELAYS` (`src/features/evidence/evidence-attachments.tsx:17`) dan berhenti di `review`/terminal.
20. **Route dan action.** `POST /api/imports` (runtime nodejs, CSRF/origin memakai pola `src/features/evidence/http.ts`, header `x-idempotency-key`, `content-type`, `x-file-name` URI-encoded, `content-length`), `GET /api/imports/[id]` (owner session, `no-store`, view model tanpa teks/payload). Cancel dan retry lewat server action di `src/features/import/actions.ts` (Zod, correlation ID, `revalidatePath('/onboarding/import')`).
21. **Worker.** `workers/import-worker.ts` (pass baru: housekeeping upload kedaluwarsa, purge, orphan, claim `import_jobs`, cleanup import) dan cabang kind `import` di `workers/ai-worker.ts`. `workers/run.ts` menjalankan pass import terisolasi seperti evidence/AI (kegagalan satu pass tidak menghentikan pass lain). Ringkasan stdout hanya angka dan kode.
22. **Nomor dan port.** Decision: `docs/decisions/0021-t15-import-staging.md` (nomor 0017 memang tidak dipakai; jangan diisi). Migration: `supabase/migrations/20260930090000_t15_import_staging.sql`; parity menjadi 25/25. Port E2E: 3009.

### 2.3 Di luar scope

- Commit import (`create`/`map`/`skip` menjadi row canonical), resolusi `target_id`, confirm achievement import, dan onboarding selesai lewat import → **T16**.
- UI review S03 (`/imports/:id/review`), edit kandidat, persist pilihan review, entry import dari S12/dashboard untuk pengguna lama, dan result counts ke S04 → **T17**. Tombol *Import CV* di dashboard tetap nonaktif.
- Purge batch `review` yang ditinggalkan dan orkestrasi penghapusan akun → T17/T23 (dicatat di decision).
- OCR, auto-confirm, penerjemahan, import job description, kuota AI per pengguna, dan semua fitur roadmap Design.md.
- Rendering PDF CV (T21). Renderer T15 hanya untuk menghitung halaman DOCX; jangan membangun abstraksi PDF export.
- Perubahan perilaku T06–T14 selain perluasan `ai_jobs` (§2.2.5–§2.2.7) dan pemindahan reader ZIP (§2.2.9).

## 3. Kontrak teknis

### 3.1 Migration `20260930090000_t15_import_staging.sql`

**`public.import_batches`**

| Kolom | Definisi |
| --- | --- |
| `id` | uuid PK default `gen_random_uuid()` |
| `user_id` | uuid not null, FK `profiles(id)` on delete cascade |
| `idempotency_key` | uuid not null; `unique (user_id, idempotency_key)` |
| `payload_hash` | bytea not null, `octet_length = 32` (hash dari sha256 + bytes + mime + filename) |
| `file_key` | text; pola `^<user_id>/import/<id>$` bila tidak NULL |
| `filename` | text not null, 1–255 karakter, tanpa karakter kontrol |
| `mime_type` | text not null, PDF atau DOCX |
| `bytes` | bigint not null, `> 0 and <= 10485760` |
| `sha256` | text not null, `^[0-9a-f]{64}$` |
| `status` | text not null default `'queued'`, check enum DB §4 |
| `stage` | text not null default `'uploading'`, check `uploading/screening/parsing/extracting/done` |
| `page_count` | integer, `between 1 and 20` bila ada |
| `extracted_text` | text, `char_length <= 60000` |
| `error_code` | text, `^[A-Z][A-Z0-9_]{0,63}$` |
| `retry_count` | integer not null default 0, `between 0 and 3` |
| `committed_at`, `cancelled_at`, `failed_at`, `expires_at`, `purged_at` | timestamptz |
| `created_at`, `updated_at` | timestamptz not null default `clock_timestamp()` |
| `revision` | integer not null default 1 |

- `unique (user_id, id)`. Index `(user_id, created_at desc)`, `(user_id, sha256, created_at desc)`, `(expires_at) where purged_at is null`.
- Check state: `failed` ⇔ `error_code` terisi dan `failed_at` terisi; `cancelled` ⇔ `cancelled_at`; `committed` ⇔ `committed_at`; `review` mewajibkan `stage = 'done'` dan `page_count` terisi; `purged_at` hanya pada status terminal dan mewajibkan `extracted_text is null and file_key is null`.
- Trigger guard: identitas (`id`, `user_id`, `idempotency_key`, `payload_hash`, `sha256`, `bytes`, `mime_type`, `filename`, `created_at`) immutable; transisi status hanya sesuai F01 (queued→running/cancelled/failed; running→review/failed/cancelled; review→committed/cancelled; failed→queued/running lewat retry); `revision + 1`; `updated_at`.
- RLS enable, policy select own. `revoke all` dari `public, anon, authenticated, service_role`; `grant select` kolom aman (tanpa `extracted_text`, `file_key`, `idempotency_key`, `payload_hash`) ke `authenticated`.

**`public.import_items`**

| Kolom | Definisi |
| --- | --- |
| `id` | uuid PK |
| `user_id` | uuid not null |
| `batch_id` | uuid not null; composite FK `(user_id, batch_id)` → `import_batches(user_id, id)` on delete cascade |
| `entity_type` | text not null, check enum DB §4 |
| `ordinal` | integer not null `>= 0`; `unique (user_id, batch_id, entity_type, ordinal)` |
| `payload` | jsonb; object, `pg_column_size <= 16384`; NULL hanya setelah purge |
| `source_excerpt` | text, ≤ 1000 karakter; NULL hanya setelah purge |
| `action` | text not null default `'create'`, check create/map/skip |
| `target_id` | uuid (validasi polimorfik milik T16; T15 tidak pernah mengisinya) |
| `committed_id` | uuid (T16) |
| `validation_errors` | jsonb not null default `'[]'`, array |
| `purged_at` | timestamptz; `(purged_at is null) = (payload is not null and source_excerpt is not null)` |
| `created_at`, `updated_at`, `revision` | standar |

- `unique (user_id, id)`, index `(user_id, batch_id, entity_type, ordinal)`.
- RLS select own; tanpa write klien. Trigger guard identitas dan revisi.
- Kolom `action`/`target_id`/`committed_id` sudah ada agar T16 tidak perlu mengubah bentuk tabel; T15 tidak menyediakan RPC untuk mengubahnya.

**`internal.import_jobs`**: `id`, `user_id`, `batch_id` (composite FK cascade, `unique (batch_id)`), `object_key`, `expected_bytes`, `mime_type`, `sha256`, `status` (`queued/running/succeeded/failed/cancelled`), `attempt_count` (0..5), `attempt_token`, `lease_expires_at`, `next_attempt_at`, `error_code`, timestamps. Check state seperti `evidence_scan_jobs`. RLS enable, revoke semua dari semua role (akses hanya lewat fungsi).

**Perluasan `public.ai_jobs`** (§2.2.5): drop not null `activity_id`, tambah `import_batch_id` + FK, check target, kind, key, unique parsial `(user_id, import_batch_id) where import_batch_id is not null`. Perluas `internal.is_valid_ai_result` untuk ringkasan `import.v1` (object kecil, tanpa teks). Perbarui `internal.guard_ai_job_row` agar `import_batch_id` immutable. Grant kolom select `authenticated` ditambah `import_batch_id`.

**Fungsi** (semua `security definer`, `set search_path = pg_catalog`, identifier ter-qualify, error `raise exception using errcode, message = '<CODE>'` tanpa teks sumber atau nama file):

| Fungsi | Grant | Perilaku |
| --- | --- | --- |
| `public.begin_import_batch(uuid, text, bigint, text, text)` | authenticated | §2.2.1, §2.2.2, §2.2.15. `auth.uid()` wajib, profil tidak deleting (`AUTH_REQUIRED`), consent terkini (`CONSENT_REQUIRED`). Replay key sama + hash sama → receipt sama; hash beda → `IDEMPOTENCY_KEY_REUSED`. Return: `batch_id`, `revision`, `status`, `stage`, `file_key`, `duplicate_of_created_at`, `duplicate_of_status`. |
| `public.finalize_import_upload(p_user_id uuid, p_batch_id uuid, p_expected_revision integer)` | service_role | Dipanggil route setelah object terunggah, dengan server credential dan `p_user_id` dari session (pola `finalize_evidence_upload`, `20260925110000_t10_finalize_qualification.sql:2`). `stage uploading → screening`, insert `import_jobs`. Replay idempoten. |
| `public.cancel_import_batch(uuid, integer)` | authenticated | §2.2.16. |
| `public.retry_import_batch(uuid, integer)` | authenticated | §2.2.8. |
| `public.claim_import_jobs(integer)` | service_role | Claim atomik, lease 120 detik; batch `queued → running`, `stage = screening`; lewati akun deleting dan batch cancelled. |
| `public.advance_import_job(uuid, uuid, text)` | service_role | Stage `screening → parsing` setelah scan bersih (CAS token). |
| `public.complete_import_parse(uuid, uuid, text, integer)` | service_role | Simpan teks + `page_count`, `stage = extracting`, job `succeeded`, insert job AI `import` bila consent terkini; bila tidak, batch `failed/CONSENT_REQUIRED`. Batch cancelled → `'stale'`. |
| `public.fail_import_job(uuid, uuid, text, boolean)` | service_role | Permanen → batch `failed`; transient → retry dengan `next_attempt_at` sampai attempt 5, lalu `failed`. |
| `public.get_import_ai_job_input(uuid, uuid)` | service_role | Hanya `{ text }` untuk job `import` running dengan token cocok, consent terkini, batch `running/extracting`. |
| `public.complete_import_ai_job(uuid, uuid, jsonb, jsonb)` | service_role | §2.2.6. |
| `public.expire_import_uploads(integer)` | service_role | §2.2.2 (15 menit). |
| `public.purge_expired_import_batches(integer)` | service_role | §2.2.17. |
| `public.claim_import_cleanup_jobs(integer)` dan pasangan complete/retry/fail | service_role | Prefix `import` saja. |
| `public.reconcile_orphan_import_objects(integer, integer)` | service_role | Pola `reconcile_orphan_evidence_objects`. |

Fungsi user me-revoke `execute` dari `public, anon, service_role` lalu grant ke `authenticated`; fungsi worker me-revoke dari `public, anon, authenticated` lalu grant ke `service_role`. Batch/job milik akun lain → `IMPORT_NOT_FOUND` (tidak membedakan tidak ada vs milik orang lain). Tambahkan `comment on` untuk tabel dan setiap fungsi.

Catatan eksekutor:

- Salin body T13/T14 yang diganti (`fail_ai_job_locked`, `expire_ai_job_leases`, `claim_ai_jobs`, `retry_ai_job`, `request_ai_analysis`, `is_valid_ai_result`, `guard_ai_job_row`) dari definisi **terbaru** (T14 mengganti `request_ai_analysis` dan `retry_ai_job`, `20260929090000_t14_ai_review.sql:183/246`), lalu ubah hanya bagian yang disebut. Lampirkan diff body di receipt Fase 1.
- Bila `claim_ai_jobs` perlu kolom `import_batch_id` di return type, `drop function` + `create` dalam migration yang sama dan perbarui `workers/supabase-ai-gateway.ts`. Catat di receipt.
- pgTAP T13/T14 yang mengasersi kind/key/`activity_id not null` boleh disesuaikan **hanya** untuk perluasan `import`; catat setiap assertion yang diubah beserta alasannya.

### 3.2 Domain dan server

- `src/domain/import/contracts.ts`: status, stage, entity type, kode error (`FILE_EMPTY`, `FILE_TOO_LARGE`, `FILE_TYPE_MISMATCH`, `UNSUPPORTED_FORMAT`, `ENCRYPTED_FILE`, `SCANNED_PDF`, `CORRUPT_FILE`, `EMPTY_DOCUMENT`, `TOO_MANY_PAGES`, `IMPORT_TEXT_TOO_LONG`, `PARSER_TIMEOUT`, `MALWARE_DETECTED`, `SCANNER_UNAVAILABLE`, `STORAGE_UNAVAILABLE`, `PAGE_COUNT_UNAVAILABLE`, `UPLOAD_INCOMPLETE`, `IMPORT_CANCELLED`, `IMPORT_NOT_FOUND`, `IMPORT_NOT_RETRIABLE`, `IMPORT_NOT_CANCELLABLE`, `IMPORT_RETRY_EXHAUSTED`, `IMPORT_EXPIRED`, plus kode AI T13 yang relevan), `isPermanentImportError(code)`, batas (`IMPORT_MAX_BYTES`, `IMPORT_MAX_PAGES`, `IMPORT_MAX_TEXT_CHARS`, `IMPORT_PARSE_TIMEOUT_MS`).
- `src/domain/import/extract-result.ts`: skema raw `import.v1`, JSON schema strict untuk provider, `validateImportResult(raw, text)` → `{ items, summary }` atau `AI_OUTPUT_INVALID` (§2.2.12).
- `src/domain/import/import-view.ts`: `toImportView({ batch, counts, consent })` → union state `choose | uploading | waiting | screening | parsing | extracting | review_ready | review_empty | failed_permanent | failed_retriable | cancelled` dengan `canRetry`, `retryBlockReason`, `canCancel`, `duplicateWarning`.
- `src/server/documents/{ooxml-zip,docx-text,pdf-text,parser-thread,parse-in-thread,docx-renderer}.ts` (§2.2.9–§2.2.10).
- `src/features/import/import-file-inspection.ts` (§2.2.11).
- `src/server/ai/import-prompt.ts`; `provider.ts` menambah `extractImport(input: { text: string }, signal): Promise<AIProviderResult>`; `openai-provider.ts`, `fake-provider.ts`, dan `UnavailableAIProvider` mengimplementasikannya.
- `src/features/import/import-service.ts`: `upload(request)`, `getView(batchId)`, `getActiveView()`, `cancel`, `retry`; `import-errors.ts` memetakan kode DB → kode service + `messageKey` + correlation ID; kepemilikan asing → `NOT_FOUND`.
- `src/features/import/actions.ts`, `src/app/api/imports/route.ts`, `src/app/api/imports/[id]/route.ts`.

### 3.3 Worker

- `workers/import-worker.ts`: `runImportWorkerOnce({ database, storage, scanner, parser, renderer })`. Urutan per job: validasi claim (UUID, pola key `<user>/import/<batch>`, MIME, bytes ≤ 10 MiB, sha) → download → verifikasi bytes + sha → scan (infected → permanen `MALWARE_DETECTED`, lalu enqueue cleanup; failed → transient) → `advance_import_job` → parse di thread → DOCX: render + hitung halaman → cek batas halaman/teks → `complete_import_parse`. Setiap tahap mengecek hasil CAS; `false` → `stale`, berhenti tanpa write lain.
- `workers/supabase-import-gateway.ts`: gateway RPC import.
- `workers/ai-worker.ts`: claim kind `import` → `get_import_ai_job_input` → `provider.extractImport` → `validateImportResult` → `complete_import_ai_job`; `failAiJob` untuk kode error. Cabang detect/refine tidak berubah.
- `workers/run.ts`: tambah pass import; `workers/check.ts` memverifikasi konfigurasi renderer tanpa mencetak URL internal secara penuh bila berisi kredensial.

### 3.4 UI

- `src/app/onboarding/import/page.tsx` memuat batch aktif dan consent profil, lalu merender `ImportStart`.
- Komponen di `src/features/import/`: `import-start.tsx`, `import-dropzone.tsx`, `import-progress.tsx`, `import-failure.tsx`. Gunakan primitives bersama (`Button`, `Card`, `InlineError`, `AiConsentDialog`, dialog konfirmasi yang ada) dan lucide-react.
- Copy `import.*` en/id di `src/i18n/messages.ts`; hapus/ganti kunci `onboarding.importUnavailable*` hanya untuk halaman S02 (kunci dashboard tetap).

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20260930090000_t15_import_staging.sql`, `supabase/tests/database/import_staging.test.sql` |
| Modify | `supabase/tests/database/{ai_jobs,ai_review}.test.sql` (hanya perluasan `import`), `src/server/supabase/database.types.ts` (`db:types`) |
| Create | `src/domain/import/{contracts,extract-result,import-view}.ts` |
| Create | `src/server/documents/{ooxml-zip,docx-text,pdf-text,parser-thread,parse-in-thread,docx-renderer}.ts`, `src/server/ai/import-prompt.ts` |
| Modify | `src/features/evidence/file-inspection.ts` (pakai `ooxml-zip`), `src/server/ai/{provider,openai-provider,fake-provider,resolve-provider}.ts`, `src/domain/ai/contracts.ts` (kind `import`), `src/domain/ai/detect-result.ts` (ekspor `numbersIn` saja) |
| Create | `src/features/import/{import-file-inspection,import-service,import-errors,actions,import-start,import-dropzone,import-progress,import-failure}.ts(x)`, `src/app/api/imports/route.ts`, `src/app/api/imports/[id]/route.ts` |
| Modify | `src/app/onboarding/import/page.tsx`, `src/i18n/messages.ts`, `src/app/globals.css` |
| Create | `workers/import-worker.ts`, `workers/supabase-import-gateway.ts` |
| Modify | `workers/{ai-worker,supabase-ai-gateway,run,check}.ts`, `package.json`, `pnpm-lock.yaml`, `.env.example`, `README.md` |
| Create | `tests/import-fixtures.ts`, `tests/unit/{import-file-inspection,ooxml-zip,docx-text,pdf-text,parse-in-thread,docx-renderer,import-extract-result,import-view,import-service,import-actions,import-worker,import-start-ui}.test.ts(x)` |
| Modify | `tests/unit/{ai-worker,openai-provider,evidence-file-inspection}.test.ts` (evidence: hanya import path bila perlu, assertion tidak diubah) |
| Create | `tests/integration/{import-staging,import-renderer-real}.test.ts`, `tests/e2e/import-onboarding.spec.ts`, `tests/e2e/helpers/import-worker.ts`, `playwright.import.config.ts` (PORT 3009) |
| Create | `docs/verification/T15-renderer-runbook.md` |
| Create (Fase 7) | `docs/decisions/0021-t15-import-staging.md`, `docs/verification/T15-import-staging.md` |

Script baru:

- `test:integration:import` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/import-staging.test.ts tests/integration/import-renderer-real.test.ts`
- `test:e2e:import` → `playwright test --config playwright.import.config.ts tests/e2e/import-onboarding.spec.ts`

`tests/import-fixtures.ts` membangun semua file uji di memori (tanpa biner di-commit): PDF teks 2 dan 21 halaman (objek teks minimal), PDF tanpa text layer (hanya image XObject), PDF dengan `/Encrypt` standard handler dan user password nonkosong, PDF terpotong, PDF berisi string EICAR, DOCX teks (memakai `docxFixture`/`zipFixture` dari `tests/evidence-fixtures.ts`), DOCX kosong, DOCX dengan `vbaProject.bin`, DOCX ZIP bomb, DOCX panjang untuk renderer (cukup paragraf dan page break eksplisit sehingga LibreOffice merender 21 halaman, sementara `docProps/app.xml` menyebut `1`), CFB dengan `EncryptedPackage`, dan CFB polos. Setiap fixture diverifikasi di unit test (mis. pdf.js memang melempar `PasswordException` untuk fixture terenkripsi).

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD. Working tree harus bersih kecuali `.claude/`. Jika ada perubahan lain, **stop**.
- [ ] `pnpm install --frozen-lockfile`, `pnpm db:status`, `pnpm exec supabase migration list --local`. Parity harus **24/24** dengan migration terakhir `20260929100000_t14_answer_lock_order.sql`.
- [ ] Baseline `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan 57 file / 357 test), `pnpm db:test` (harapan 9 file / 540 assertion), `pnpm test:integration:ai` (harapan 13), `pnpm test:integration:ai-review` (harapan 21).
- [ ] ClamAV: jalankan atau periksa container `workpulse-t10-clamav` sesuai `docs/verification/T10-scanner-runbook.md`, lalu `pnpm test:integration:evidence` (harapan 14/14).
- [ ] Renderer: `docker pull` image Gotenberg versi stabil terbaru dari registry resmi, catat **digest** dan versi LibreOffice-nya, jalankan di `127.0.0.1:13400` tanpa mount, dan cek health endpoint. Konversi satu DOCX sintetis dan catat jumlah halaman. Jika image tidak dapat dipull atau dijalankan, **stop** dan laporkan (§8).
- [ ] `pdfjs-dist`: catat versi stabil terbaru, lisensi, dukungan Node 24, dan path build legacy dari dokumentasi resmi paket. Belum dipasang pada fase ini.
- [ ] Verifikasi dari source dan catat file:baris untuk: `readDocxParts`/`inspectEvidenceBytes`/`readBoundedBody` (`src/features/evidence/file-inspection.ts`); upload evidence (`evidence-service.ts:73`) dan helper CSRF (`src/features/evidence/http.ts`); `createStorageObjectKey` (`src/server/storage/object-key.ts:49`) mendukung kategori `import`; definisi terbaru `request_ai_analysis`, `retry_ai_job` (T14), `claim_ai_jobs`, `get_ai_job_input`, `fail_ai_job`, `internal.fail_ai_job_locked`, `expire_ai_job_leases`, `is_valid_ai_result`, `guard_ai_job_row` (T13); constraint `ai_jobs` T14 (`ai_jobs_one_per_revision_key`, `ai_jobs_questions_check`) tetap valid dengan `activity_id` NULL; `internal.storage_jobs` dan `claim_evidence_cleanup_jobs` (T10); `internal.is_real_display_name`; `numbersIn`; `AiConsentDialog`; pola polling evidence; port 3009 belum dipakai.
- [ ] Tulis receipt Fase 0. **Jangan** memanggil provider AI nyata.

### Fase 1 — Database (TDD pgTAP)

- [ ] Tulis `supabase/tests/database/import_staging.test.sql` yang gagal lebih dulu (pola `begin; … no_plan(); … finish(); rollback;`, `pg_temp.set_jwt_subject`, langkah worker dijalankan sebagai `service_role`). Assertion minimum:
  1. Struktur: tabel, kolom, check, FK komposit, unique, index, RLS, grant (authenticated tanpa write dan tanpa kolom privat; `internal.import_jobs` tertutup), `prosecdef`, perluasan `ai_jobs` (target tepat satu, kind/key, unique per batch).
  2. `begin_import_batch`: tanpa consent → `CONSENT_REQUIRED` tanpa row; sukses → `queued/uploading`; replay → id sama; hash beda → `IDEMPOTENCY_KEY_REUSED`; hash sama key beda → batch baru dengan `duplicate_of_*`; hash akun B tidak memicu peringatan A; profil deleting → `AUTH_REQUIRED`.
  3. Transisi: finalize → `screening` + satu `import_jobs`; claim → `running`; advance → `parsing`; `complete_import_parse` → `extracting` + satu job AI `import`; tanpa consent → `failed/CONSENT_REQUIRED`; `complete_import_ai_job` → item + `review`; transisi ilegal ditolak trigger.
  4. Token/lease: token lama atau lease kedaluwarsa → `false`/`stale` tanpa write, pada setiap RPC worker.
  5. `complete_import_ai_job`: ref sementara di-resolve ke `import_items.id`; >300 item atau >1 profile ditolak; payload achievement `status` selain `draft` ditolak; batch cancelled → job `failed/IMPORT_CANCELLED`, nol item.
  6. Tidak ada write canonical: hitung row tabel canonical dan `profiles.revision` sebelum/sesudah setiap skenario.
  7. Cancel dari `queued`/`running`/`review`; idempoten; `committed`/`failed` → `IMPORT_NOT_CANCELLABLE`.
  8. Retry: kode transient per tahap; paralel (dua panggilan berurutan dalam transaksi berbeda disimulasikan lewat revision) → satu job; batas 3 → `IMPORT_RETRY_EXHAUSTED`; permanen → `IMPORT_NOT_RETRIABLE`; purged → `IMPORT_EXPIRED`; `retry_ai_job`/`request_ai_analysis` atas job import → `AI_JOB_NOT_APPLICABLE`.
  9. Kegagalan AI (`fail_ai_job`, lease expiry) → batch `failed` dengan kode sama dan `expires_at` 23 jam.
  10. Purge: cancelled langsung; failed setelah `expires_at` (dimanipulasi); committed fixture; `storage_jobs` ter-enqueue sekali; metadata minimal tetap; cleanup claim hanya prefix `import` dan claim evidence tidak mengambil job import.
  11. Isolasi: akun B → `IMPORT_NOT_FOUND` untuk cancel/retry, tidak melihat batch/item A, tidak dapat memilih `extracted_text`.
  12. Regresi `ai_jobs`: detect/refine T13/T14 tetap berperilaku sama.
- [ ] Pastikan `pnpm db:test` **FAIL**. Tulis migration §3.1, lalu `pnpm exec supabase migration up --local`. **Dilarang** `db reset`.
- [ ] `pnpm db:test` (PASS; catat total), `pnpm db:lint`, `pnpm db:types`, migration list (25/25).
- [ ] Commit `feat(t15): add import staging tables, queue and ai_jobs import kind`, lalu tulis receipt.

### Fase 2 — Inspeksi dan parser (TDD unit)

- [ ] Tulis `tests/import-fixtures.ts` dan test gagal lebih dulu:
  - `import-file-inspection`: setiap kasus §1.4.
  - `ooxml-zip`: perilaku reader T10 identik (jalankan juga `tests/unit/evidence-file-inspection.test.ts` tanpa mengubah assertion), part tambahan dapat dibaca, ZIP bomb ditolak sebelum alokasi penuh.
  - `docx-text`: paragraf, tab, break, tabel, karakter Indonesia (UTF-8), dokumen kosong.
  - `pdf-text` (dalam thread): teks 2 halaman, 21 halaman → `pageCount = 21`, terenkripsi → `ENCRYPTED_FILE`, tanpa text layer → `SCANNED_PDF`, terpotong → `CORRUPT_FILE`.
  - `parse-in-thread`: timeout → `PARSER_TIMEOUT` dan thread berhenti; batas memori (fixture thread uji yang mengalokasi berlebihan) tidak menjatuhkan proses test; output hanya `text/pageCount/code`.
  - `docx-renderer`: mode `unavailable` → `PAGE_COUNT_UNAVAILABLE`; `fake` ditolak di `NODE_ENV=production`; `gotenberg` dengan server HTTP lokal palsu: request multipart tanpa filename pengguna, timeout, respons >50 MiB ditolak, respons bukan PDF → `PAGE_COUNT_UNAVAILABLE`.
- [ ] Pasang `pdfjs-dist` exact (`pnpm add -E`), catat versi di receipt. Implementasi hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit per kelompok, receipt.

### Fase 3 — Domain import dan provider (TDD unit)

- [ ] Test gagal lebih dulu:
  - `import-extract-result`: skema valid; setiap aturan grounding §2.2.12 (excerpt bukan substring → dibuang; organization rekaan → `UNGROUNDED`; angka rekaan dihapus; tahun tidak ada di excerpt → tanggal NULL; interval terbalik → `DATE_RANGE`; overlap diterima; URL non-http dikosongkan; placeholder display name dikosongkan; achievement selalu draft); output rusak → `AI_OUTPUT_INVALID`; ref `experience_ref` yang tidak ada → standalone.
  - `import-view`: setiap state §2.2.19, `canRetry` per kode/batas/expiry, `canCancel`, peringatan duplikat.
  - `openai-provider`: `extractImport` memakai instruksi `import.prompt.v1` dan JSON schema strict; payload hanya `{ text }`; kode error dipetakan seperti `detect`.
  - Fake: semua scenario §2.2.14; `import_valid` hanya menghasilkan excerpt dari baris input.
- [ ] Implementasi hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit, receipt.

### Fase 4 — Worker, service, route, dan integration nyata

- [ ] Unit `import-worker` dengan fake database/storage/scanner/parser/renderer: urutan tahap, CAS `stale` di setiap tahap, scanner failed → transient, infected → permanen + cleanup, hash mismatch → `CORRUPT_FILE`, claim tidak valid tidak menghasilkan parse.
- [ ] Unit `ai-worker` cabang `import`: input RPC khusus, validator import, `complete_import_ai_job`, kode error.
- [ ] Unit `import-service`/`import-actions`/route: tanpa session → 401 generik; batch asing → 404 generik; pemetaan kode + `messageKey` + UUID `correlationId`; CSRF/origin ditolak; body melebihi `content-length` ditolak; response tanpa teks/payload/filename di pesan error.
- [ ] `tests/integration/import-staging.test.ts` (setup seperti `tests/integration/ai-review.test.ts` dan `evidence-pipeline.test.ts`: admin, owner A/B sign-in nyata, Storage lokal, ClamAV nyata, parser thread nyata, renderer `fake` kecuali disebut lain, fake AI berpenghitung). Skenario wajib:
  1. Alur utama PDF dan DOCX sampai `review`, termasuk hitungan canonical sebelum/sesudah (§1.1, §1.3).
  2. Validasi upload lewat service (§1.4).
  3. Deteksi parsing per kode (§1.5) dan batas parser (§1.6).
  4. EICAR dalam PDF → `MALWARE_DETECTED`, object terhapus setelah cleanup; scanner `unavailable` → retry lalu `SCANNER_UNAVAILABLE`, retry setelah scanner kembali → `review` (§1.7).
  5. Consent: tanpa consent → tidak ada object/batch; withdraw sebelum AI → `CONSENT_REQUIRED`, provider 0 panggilan; consent lagi + retry → `review` (§1.8).
  6. Grounding lewat fake `import_ungrounded`/`import_numbers`/`import_partial`/`import_empty`/`import_malformed` (§1.9, §1.10).
  7. Idempotensi upload paralel ×3, replay setelah object ada, key sama byte beda (§1.11).
  8. Duplikat hash dan isolasi hash antar akun (§1.12).
  9. Cancel di setiap tahap memakai hook worker (sebelum scan, saat parse, saat provider berjalan); completion terlambat `stale`, nol item (§1.13).
  10. Retry per tahap, retry paralel ×3, batas retry, AI attempt habis (§1.15).
  11. Purge terminal dengan `expires_at` dimanipulasi; object tidak ada lagi di Storage; retry setelah purge → `IMPORT_EXPIRED` (§1.16).
  12. Isolasi dua akun lewat service, route, dan query langsung klien (§1.18).
  13. Log hygiene: tangkap stdout/stderr worker dan pesan error selama semua skenario; sentinel isi CV, nama file, dan key palsu = 0 (§1.19).
- [ ] `tests/integration/import-renderer-real.test.ts`: dijalankan terhadap container Gotenberg nyata (skip **tidak** diizinkan diam-diam: bila renderer tidak tersedia, test gagal dengan pesan jelas). DOCX 2 halaman → `review`; DOCX 21 halaman dengan `docProps/app.xml = 1` → `TOO_MANY_PAGES` (§1.2).
- [ ] Tambah script `test:integration:import` dan jalankan. Regresi: `test:integration:ai`, `ai-review`, `evidence`, `storage`, `activity`, `achievements`, `m2`.
- [ ] `pnpm worker:check` dan `pnpm worker:once` dengan mode default (`unavailable` untuk AI dan renderer): tidak crash, ringkasan hanya angka/kode.
- [ ] Tulis `docs/verification/T15-renderer-runbook.md` (pola runbook T10: perintah run dengan digest, env, health check, stop/remove, catatan isolasi jaringan untuk staging).
- [ ] Commit per kelompok, receipt. Checkpoint Claude opsional di sini.

### Fase 5 — UI S02

- [ ] Implementasi §2.2.19 dan §3.4 dengan primitives bersama dan satu keluarga ikon.
- [ ] Unit render `import-start-ui` (pola `tests/unit/evidence-attachments-ui.test.tsx`): tiap state view model menampilkan teks yang benar; tidak ada klaim hasil saat `waiting`; Retry nonaktif beserta alasan; gagal permanen tanpa Retry; *Start manually* selalu tampil saat gagal; tidak ada link S03; tidak ada gradient/sparkle.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e:auth` (regresi onboarding). Commit, receipt.

### Fase 6 — Browser acceptance dan regresi penuh

- [ ] Buat `playwright.import.config.ts` (PORT 3009, `webServer.env` tanpa variabel AI) dan `tests/e2e/import-onboarding.spec.ts`. Helper `tests/e2e/helpers/import-worker.ts` menjalankan `node workers/run.ts --once` sebagai child process dengan env **khusus child** (`NODE_ENV=test`, `WORKPULSE_AI_MODE=fake`, scenario, `WORKPULSE_DOCX_RENDERER_MODE`, scanner ClamAV lokal, URL Supabase lokal, `SUPABASE_SECRET_KEY` dari env proses test). Skenario:
  1. Pengguna baru: consent ditolak → *Continue manually* → S12; tidak ada batch.
  2. Consent → pilih PDF (keyboard-only) → *Waiting to start* tanpa worker → jalankan helper `import_valid` → progres → *Extraction finished* dengan jumlah per kelompok.
  3. Leave-return: tutup tab saat `running`, buka `/onboarding/import` → batch yang sama; tidak ada batch baru di DB.
  4. Session kedaluwarsa (hapus cookie) → sign-in dengan `returnTo` → batch tersimpan tampil.
  5. File tidak didukung dan terenkripsi (permanen) → alasan spesifik, *Try another file*, *Start manually*.
  6. Transient (`AI_UNAVAILABLE`) → *Retry* → `review`.
  7. Cancel saat `running` → dialog → fokus kembali → *Cancelled*; worker selanjutnya tidak menulis item.
  8. Upload byte yang sama dua kali → peringatan duplikat nonblokir.
  9. Ekstraksi kosong → *Start manually*.
  10. Locale `id` untuk seluruh state utama.
  11. Axe pada setiap state utama; 360×800 dan 1440×900 light/dark tanpa overflow; screenshot dilampirkan.
- [ ] Jalankan suite §7 lengkap. `test:e2e:m2` wajib lulus tanpa melemahkan assertion env (bersihkan env harness `AI_AGENT`/`ANTHROPIC_BASE_URL` per run bila ada). ClamAV dan renderer wajib berjalan untuk suite yang membutuhkannya; bila tidak, catat sebagai **tidak dijalankan** beserta alasan (ini memblokir DONE untuk §1.2 dan §1.7).
- [ ] Opsional, hanya dengan persetujuan eksplisit pengguna: satu smoke live `extractImport` lewat `worker:once` atas CV sintetis bahasa Indonesia dengan pengalaman kerja yang overlap. Catat model, latency, jumlah kandidat, `dropped_ungrounded`, dan status, tanpa key dan tanpa isi CV. Tanpa persetujuan, catat *tidak dijalankan*.
- [ ] Receipt. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–6, output command, screenshot, hasil Axe/keyboard, digest image renderer dan ClamAV, versi `pdfjs-dist`, dan daftar acceptance yang belum terbukti.

### Fase 7 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0021-t15-import-staging.md`: keputusan §2.2 poin 1–22, kode error, pilihan `pdfjs-dist` dan renderer (versi/digest, alasan, alternatif yang ditolak), jendela retensi 23 jam, keputusan terbuka batch `review` yang ditinggalkan, dan seam T16/T17 (kolom `action/target_id/committed_id`, resolusi ref, purge committed).
- [ ] `docs/verification/T15-import-staging.md`: pass/fail/warning/tidak dijalankan, trace ke R02, F01, S02, DB §3/§4/§6, dan setiap poin §1.
- [ ] README (bagian Worker, Import, renderer, env baru, tabel quality gates, script baru) dan `.env.example` (nama variabel dan placeholder saja).
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- Owner A: locale `en`, timezone `Asia/Jakarta`, consent NULL di awal.
  - CV PDF/DOCX sintetis berbahasa Indonesia dan Inggris dengan baris berformat fake scenario, misalnya:
    - `EXP|PT Sentinel Nusantara|Analis Data|2019|2022`
    - `EXP|WP Labs|Data Lead|2021|` (overlap dengan baris sebelumnya, current)
    - `EDU|Universitas Contoh|S1 Statistika|2014|2018`
    - `ACH|Menurunkan waktu laporan dari 5 ke 2 jam|PT Sentinel Nusantara`
  - Sentinel privat di isi CV: `WP-PRIVATE-IMPORT-SENTINEL-<uuid>`. Nama file: `cv-WP-FILENAME-SENTINEL-<uuid>.pdf`.
- Owner B: consent sendiri, dipakai untuk isolasi dan hash yang sama.
- Key palsu log: `sk-test-WP-SENTINEL-KEY`.
- Setiap test membersihkan akun fixture (termasuk object Storage prefix `import`) seperti suite T10/T14.

## 7. Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm exec supabase migration list --local
pnpm test:integration:import
pnpm test:integration:ai
pnpm test:integration:ai-review
pnpm test:integration:evidence
pnpm test:integration:storage
pnpm test:integration:activity
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:dashboard
pnpm test:integration:m2
pnpm test:e2e:import
pnpm test:e2e:ai-review
pnpm test:e2e:ai
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:projects
pnpm test:e2e:achievements
pnpm test:e2e:dashboard
pnpm test:e2e:evidence
pnpm test:e2e:m2
pnpm worker:check
pnpm worker:once
pnpm build
git diff --check
```

`test:integration:import` dan `test:e2e:import` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan. Muat env Supabase lokal dalam command yang sama dengan suite (env PowerShell tidak bertahan antar command).

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, atau parity bukan 24/24.
- Penyelesaian memerlukan `db reset`, rewrite migration lama, perubahan kolom tabel canonical, atau perubahan daftar schema yang di-expose.
- Image renderer tidak dapat dipull, dipin digest, atau dijalankan secara lokal; atau pengguna menolak Gotenberg/LibreOffice sebagai runtime renderer. Laporkan alternatif (mis. LibreOffice headless di container sendiri) dan tunggu keputusan pengguna.
- `pdfjs-dist` tidak kompatibel dengan Node 24/type stripping di worker, butuh binary native, atau tidak dapat berjalan di `worker_threads` tanpa akses jaringan/eval.
- Perluasan `ai_jobs` merusak perilaku detect/refine T13/T14 (pgTAP atau integration T13/T14 gagal) dan tidak bisa diperbaiki tanpa mengubah kontrak mereka.
- Pemindahan reader ZIP mengubah hasil test evidence T10.
- Implementasi terasa memerlukan commit canonical, auto-confirm, OCR, UI review S03, entry import untuk pengguna lama, purge batch `review`, atau kuota AI (T16/T17/T23).
- Test membutuhkan key nyata, atau sentinel/key/nama file muncul di output.
- Smoke live opsional gagal karena akun/billing/kuota; jangan mencoba model lain tanpa persetujuan.

## 9. Gate review Claude (setelah Fase 6)

Review read-only mencakup:

- Tidak ada write langsung klien ke `import_batches`, `import_items`, `internal.import_jobs`, atau `ai_jobs`; RLS, grant, dan kolom privat sesuai.
- Tidak ada jalur ekstraksi yang menulis tabel canonical; tidak ada item berstatus confirmed.
- Screening wajib sebelum parse; scanner unavailable tidak pernah dianggap bersih; hash dan bytes diverifikasi ulang di worker.
- Parser berjalan di thread dengan timeout dan batas memori; ZIP bomb dan PDF terenkripsi ditangani; jumlah halaman DOCX dari renderer, bukan metadata.
- Consent dicek di begin, enqueue AI, input AI, dan completion; payload AI hanya teks.
- Grounding: excerpt substring, field kunci dan angka dibumikan, tanggal tidak dibuat lebih presisi.
- Token/lease CAS di setiap RPC worker; cancel dan completion terlambat tidak menulis item.
- Idempotensi upload, retry satu job, batas retry, dan jendela retensi 23 jam; purge menghapus object dengan verifikasi.
- UI jujur: progres sesuai state server, tidak ada link S03 atau klaim hasil sebelum `review`, jalur manual selalu terlihat saat gagal.
- Tidak ada isi CV, nama file, teks ekstraksi, atau key di log, error, atau response route.
- Aksesibilitas dan responsif sesuai §1.20; tidak ada fitur roadmap.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **File tak tepercaya menjatuhkan atau menggantung worker.** Parser berjalan di thread utama, timeout tidak menghentikan thread, atau ZIP bomb menginflate penuh sebelum dicek. Dijaga unit `parse-in-thread`/`ooxml-zip` dan integration 3.
2. **Hasil AI rekaan lolos ke staging.** Excerpt yang diparafrasekan, organization yang tidak ada di sumber, atau angka dan tanggal yang dipresisikan. Dijaga unit `import-extract-result` dan integration 6.
3. **Completion terlambat menulis setelah cancel atau retry.** Worker lama (scan, parse, atau AI) menyelesaikan attempt yang sudah digantikan dan menulis teks atau item. Dijaga pgTAP 4/5 dan integration 9/10.
4. **Retensi tidak benar-benar menghapus.** Purge hanya mengosongkan kolom tanpa menghapus object, cleanup evidence mengambil job import (atau sebaliknya), atau failed tidak pernah kedaluwarsa. Dijaga pgTAP 10 dan integration 11 (cek ketiadaan object di Storage).
5. **Perluasan `ai_jobs` merusak T13/T14.** `activity_id` nullable membuat unique per revisi, cek pertanyaan, atau `retry_ai_job` berperilaku lain untuk detect/refine. Dijaga pgTAP 12 dan regresi `test:integration:ai`/`ai-review`.
6. **Kebocoran data lewat nama file atau route.** Nama file masuk log/error, atau route mengembalikan teks/payload. Dijaga integration 13, unit route, dan grep sentinel.

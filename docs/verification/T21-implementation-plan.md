# Handoff T21 Immutable export backend — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi. Semua nama tabel, kolom, fungsi, kode error, key i18n, env var, dan path di dokumen ini **dibekukan**; jangan mengganti namanya.

- Tanggal: 6 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Dependensi: T20 **DONE** (`internal.cv_item_state`/`internal.cv_profile_state`, protokol lock decision 0026, jalur delete mengunci CV lebih dulu; `docs/verification/T20-cv-freshness-deletion.md`), T19 **DONE** (`buildCvPreviewModel`, `save_cv_edits`), T18 **DONE** (`cv_exports` struktur saja, decision 0024 poin 12), T05 **DONE** (bucket privat `workpulse-private`, kategori `export`, `internal.storage_jobs`), T13 **DONE** (pola durable job: claim atomik, lease 120 detik, attempt token, CAS completion). Pola worker storage cleanup T15 **DONE**; Gate M3 **PASSED**.
- Eksekutor: satu agent **Claude Sonnet 5.5**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 7; Fase 8 (draft dokumen) dikerjakan setelah gate. Checkpoint setelah Fase 1 dianjurkan (protokol lock request export dan state machine job).
- Keputusan produk: lima keputusan §2.4 **menunggu persetujuan pengguna**. Pelaksana berhenti di akhir Fase 0 bila persetujuan belum dicatat di dokumen ini.
- Acuan:
  - PRD R10 (*Export the saved CV revision as searchable A4 text with correct page breaks. Failure preserves the draft and supports retry. Evidence is not embedded or linked.*), *CV freshness contract* (deleted/unconfirmed memblokir export; PDF yang sudah diunduh tidak berubah), aturan durable job (*queued, running, succeeded, failed; timeout 120 detik; explicit retry; avoid duplicate jobs*), release scenario *edit selected achievement … delete its source and verify export is blocked until resolved*, *graduate … export a useful CV*, *Validate PDF text extraction, Indonesian characters, long bullets, and multipage output*, metrik *Export reliability*.
  - User Flow F07 langkah 3–6 (save → S14 memakai revision tersimpan yang persis; validasi nama + minimal satu experience/project/education/confirmed achievement; Keep saved wording membuka item stale yang valid; export mengantre job terikat snapshot immutable dan revision CV; gagal → Retry snapshot yang sama; edit berikutnya tidak mengubah export yang berjalan).
  - Wireframe S14 `/cv/preview` (hanya sebagai batas T22: snapshot tersimpan, status, blokir dengan tautan ke S13, Retry snapshot sama, unduhan 24 jam via URL singkat, Regenerate, evidence tidak pernah di PDF).
  - Database Schema §5 `cv_exports` (*immutable snapshot of the whole saved CV, including overrides, ordering, and template version*; `UNIQUE(user_id, idempotency_key)`; PDF kedaluwarsa 24 jam, regenerasi tetap tersedia), *Deletion and export consistency* (lock CV, validasi setiap sumber dan acknowledgement, simpan snapshot dan antrekan job dalam transaksi yang sama; worker tidak pernah membaca ulang career records; kegagalan/kedaluwarsa tidak menghapus CV), §4 *Storage protocol* (prefix export terpisah `user_id/export/object_uuid`), §6 (klien tidak boleh menulis export snapshot; test *source deletion and reversion to draft during export*).
  - `IMPLEMENTATION_PLAN.md` §2 (PDF = HTML print template + Chromium worker; adapter `PdfRenderer`; fake dilarang di production), §3 *Jobs dan data privat* dan *CV*, §4 baris *Lease disebut tanpa lease field*, blok T21 dan T22 di §5, §8 risiko *Chromium PDF runtime*.
  - `docs/decisions/0024-t18-cv-schema-selection.md` (poin 12 dan *Seam* T21), `0026-t20-cv-freshness-deletion.md` (poin 2, 6, 7 dan *Seam* T21), `0019-t13-ai-jobs-consent.md` (pola job), `0021-t15-import-staging.md` (renderer Gotenberg terisolasi), `docs/verification/T15-renderer-runbook.md`.

**Goal:** Pengguna dapat meminta export PDF dari revision master CV yang tersimpan. Satu RPC mengunci CV dan semua sumber terpilih dengan urutan decision 0026, memvalidasi kesiapan (nama efektif, minimal satu record substantif, tidak ada item `changed`/`deleted`/`unconfirmed`, profil tidak `changed`; `kept` lolos), lalu menyimpan snapshot immutable dan mengantrekan job dalam satu transaksi. Worker mengklaim job dengan lease 120 detik, membangun model render dari snapshot saja, merender HTML print template `single_column_v1` menjadi PDF A4 ber-teks lewat Chromium terisolasi, memverifikasi hasilnya, mengunggahnya ke prefix `export`, dan menyelesaikan job dengan CAS. Kegagalan tidak menyentuh CV; Retry eksplisit memakai snapshot yang sama; export sukses kedaluwarsa 24 jam lalu objeknya dibersihkan; request baru setelah kedaluwarsa melewati validasi ulang. Tanpa UI: halaman `/cv/preview` dan tombolnya milik T22.

**Architecture:** Satu migration forward-only menambah tiga kolom operasional dan constraint state pada `cv_exports`, trigger imutabilitas snapshot, helper SQL `internal.cv_export_blockers` dan `internal.cv_export_snapshot`, RPC authenticated (`get_cv_export_readiness`, `request_cv_export`, `retry_cv_export`, `get_cv_export_download`), dan RPC service-role untuk worker (`expire_cv_export_leases`, `claim_cv_export_jobs`, `get_cv_export_input`, `complete_cv_export`, `fail_cv_export`, `expire_cv_exports`, cleanup storage berkategori `export`, `reconcile_orphan_export_objects`). Domain murni `src/domain/cv/export.ts` memvalidasi snapshot dan memetakannya ke `buildCvPreviewModel` T19 (paritas preview–export). `src/server/export/` berisi template HTML murni dan adapter `PdfRenderer` (Gotenberg Chromium, fake khusus dev/test, unavailable). Worker `workers/export-worker.ts` + gateway Supabase didaftarkan di `workers/run.ts`. Service `src/features/cv/export-service.ts` dan server action menyediakan request, retry, readiness, daftar, dan URL unduhan bertanda tangan ≤ 5 menit.

**Tech stack:** PostgreSQL 17 lewat Supabase (plpgsql `security definer`, pgTAP), Supabase Storage privat, worker Node 24 TypeScript (`node workers/*.ts`, import relatif), Gotenberg 8.37.0 (image yang sama dengan T15, dipin digest) rute Chromium, `pdfjs-dist` yang sudah terpasang untuk verifikasi teks/halaman di parser thread, Zod 4, Next.js server action, Vitest (unit dan integration nyata). Tidak ada dependency npm baru.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md` (T20, T19, T18), `docs/IMPLEMENTATION_PLAN.md` §1–§4 serta blok M4 (T21, T22, Gate M4), decision 0019, 0021, 0024, 0026, `docs/verification/T15-renderer-runbook.md`, `docs/verification/T20-implementation-plan.md` sebagai pola fase, dan `Design.md` hanya untuk tipografi template. Ekstrak ulang PRD R10/*CV freshness contract*/aturan job/release scenarios, F07, S14, dan DB §4/§5/§6 dengan alat ekstraksi DOCX (mis. `python` + `zipfile` atas `word/document.xml`; `python-docx` tidak terpasang); jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R10:** ekspor revision CV tersimpan sebagai teks A4 yang dapat dicari dengan page break yang benar. Kegagalan mempertahankan draft dan mendukung retry. Evidence tidak di-embed atau ditautkan.
- **PRD job:** job export punya status queued/running/succeeded/failed, timeout 120 detik, retry eksplisit, simpanan tetap, tanpa job ganda.
- **PRD freshness:** sumber deleted/unconfirmed memblokir export sampai item dihapus atau diperbaiki; PDF yang sudah diunduh tidak berubah.
- **PRD release:** graduate tanpa CV/employment dapat mengekspor CV yang berguna; hapus sumber terpilih → export terblokir sampai diselesaikan; validasi ekstraksi teks PDF, karakter Indonesia, bullet panjang, dan output multipage.
- **F07:** preview memakai revision tersimpan yang persis. Validasi memblokir CV tanpa nama atau tanpa minimal satu experience, project, education, atau confirmed achievement terpilih. Item stale yang valid boleh diekspor setelah Keep saved wording eksplisit; sumber hilang/unconfirmed harus dihapus atau diperbaiki. Export mengantre job terikat snapshot immutable dan revision CV. Sukses menawarkan Download; gagal menawarkan Retry snapshot yang sama; edit yang sedang berjalan tidak mengubah export.
- **S14 (batas T22):** snapshot tersimpan, batas halaman, status export; blokir dengan tautan ke S13; Retry snapshot sama; unduhan 24 jam lewat URL berumur pendek; file kedaluwarsa menawarkan Regenerate; evidence tidak pernah tampil di PDF.
- **DB §5:** `cv_exports` menyimpan snapshot immutable seluruh CV tersimpan termasuk override, urutan, dan versi template. Saat request: lock CV, validasi setiap sumber terpilih dan acknowledgement, simpan snapshot dan antrekan job dalam transaksi yang sama. Worker tidak pernah membangun export dengan membaca ulang career records. URL unduhan owner-authorized dan kedaluwarsa. Kegagalan atau kedaluwarsa export tidak menghapus CV atau item terpilih.
- **DB §4/§6:** prefix privat terpisah untuk export (`user_id/export/object_uuid`); klien tidak boleh menulis export snapshot; uji penghapusan sumber dan reversion ke draft selama export → export konsisten atau conflict yang dapat ditindaklanjuti.
- **Rencana §5 T21 (kalimat selesai):** edit/delete/reopen sumber yang berlomba dengan export memberi snapshot konsisten atau conflict yang dapat ditindaklanjuti; render gagal mempertahankan CV; lease timeout, duplicate export, dan kedaluwarsa 24 jam bekerja.

Pertahankan perubahan lokal pengguna. Jangan menandai T21 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T21-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka yang ditulis harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T21

T21 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Kesiapan dari satu definisi.** `internal.cv_export_blockers` mengembalikan blocker `NAME_REQUIRED` (nama efektif = `display_overrides.display_name` ?? `profile_snapshot.display_name` kosong), `CONTENT_REQUIRED` (tidak ada item non-deleted di experience/projects/education dan tidak ada item achievement), `ITEM_CHANGED`, `ITEM_DELETED`, `ITEM_UNCONFIRMED` (per item, memakai `internal.cv_item_state` T20), dan `PROFILE_CHANGED` (`internal.cv_profile_state`). Item `kept` dan profil `kept` tidak memblokir; skill/certification saja tidak memenuhi `CONTENT_REQUIRED`. Dibuktikan pgTAP.
2. **Request atomik.** `request_cv_export` yang lolos menyimpan satu baris `cv_exports` (`queued`, `cv_revision` = revision CV, snapshot `cv-export.v1`) dalam transaksi yang sama dengan validasi; yang terblokir → `CV_EXPORT_BLOCKED` dengan `detail` JSON berisi kode blocker dan `item_id` milik pemanggil saja, tanpa write. Dibuktikan pgTAP + integration.
3. **Snapshot immutable dan lengkap.** Snapshot memuat `template_key`, `locale`, `title`, `section_order`, `profile_snapshot` (termasuk `display_overrides`), `summary_override`, dan semua item (`id`, `section_key`, `position`, `source_snapshot`, `override_text`) dalam urutan posisi; tidak memuat evidence, `raw_text`, `contribution`, `source_excerpt`, metrics, atau activity id. Kolom `snapshot`, `cv_id`, `cv_revision`, `user_id`, `idempotency_key` tidak dapat diubah setelah insert (trigger), dan klien tidak punya grant tulis. Dibuktikan pgTAP.
4. **Worker tidak membaca career rows.** Worker merender hanya dari `get_cv_export_input` (snapshot). Edit, delete, atau reopen sumber setelah request tidak mengubah PDF hasil export itu. Dibuktikan integration (sentinel teks lama tetap ada di PDF setelah sumber diedit sebelum worker berjalan) + review gateway.
5. **Race request vs mutasi sumber.** Dua koneksi nyata ×3 putaran tanpa `40P01`: (a) `save_achievement` edit sumber terpilih vs `request_cv_export`; (b) `delete_achievement` vs request; (c) reopen achievement ke draft vs request; (d) `save_cv_edits` vs request; (e) `update_profile` (nama) vs request. Setiap putaran berakhir pada salah satu: export dibuat dengan snapshot sebelum mutasi, atau `CV_EXPORT_BLOCKED`/`STALE_REVISION` setelah mutasi. Dibuktikan integration.
6. **Idempotency dan tanpa job ganda.** Key sama + revision sama → export yang sama (`reused = true`); key sama + revision berbeda → `IDEMPOTENCY_KEY_REUSED`. Maksimal satu export `queued`/`running` per CV (partial unique index): request revision sama saat ada yang aktif → export aktif dikembalikan; revision berbeda → `CV_EXPORT_IN_PROGRESS`. Export `succeeded` belum kedaluwarsa dengan revision sama dikembalikan tanpa render ulang. Dua request paralel dengan key berbeda menghasilkan satu export. Dibuktikan pgTAP + integration.
7. **Durable job.** `claim_cv_export_jobs` atomik (`for update skip locked`), lease 120 detik, `attempt_token` baru per attempt, `attempt_count` ≤ 3. `complete_cv_export`/`fail_cv_export` hanya berhasil dengan token aktif dan lease belum lewat; worker dari lease lama mendapat `stale` dan menghapus objeknya sendiri. Lease lewat → `failed` dengan `EXPORT_TIMEOUT`. Dibuktikan pgTAP + integration.
8. **Render gagal mempertahankan CV.** Renderer unavailable/timeout/output invalid → export `failed` dengan kode aman; `cv_documents` dan `cv_items` (revision, snapshot, override) tidak berubah. Dibuktikan integration.
9. **Retry snapshot yang sama.** `retry_cv_export` atas export `failed` milik pemanggil dengan kode retriable dan `attempt_count < 3` → `queued` dengan snapshot dan `cv_revision` identik, tanpa validasi freshness ulang. Kode permanen, `attempt_count = 3`, status lain, atau export akun lain → error sesuai §2.2.9. Dibuktikan pgTAP + integration.
10. **PDF A4 yang dapat dicari (renderer nyata).** Dengan Gotenberg Chromium nyata: halaman A4 (MediaBox 595 × 842 pt ± 1), teks yang diekstrak memuat nama efektif, heading section sesuai locale, override, dan bullet berkarakter Indonesia (mis. `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”`); fixture panjang menghasilkan > 1 halaman; tidak ada evidence/URL evidence. Dibuktikan integration renderer nyata (gagal keras bila renderer tidak terjangkau, tidak pernah jatuh ke fake).
11. **Verifikasi output di worker.** Worker menolak hasil renderer yang bukan `%PDF-`, > 10 MiB, > 20 halaman (`EXPORT_TOO_LONG`), atau tanpa teks yang memuat nama efektif (`EXPORT_RENDER_INVALID`), memakai parser thread terisolasi. Dibuktikan unit + integration.
12. **Kedaluwarsa 24 jam.** Sukses → `expires_at = finished_at + 24 jam`. `expire_cv_exports` mengantrekan penghapusan objek (`internal.storage_jobs`) dan menyetel `purged_at`; cleanup worker kategori `export` menghapus objek; `get_cv_export_download` setelah kedaluwarsa → `CV_EXPORT_EXPIRED`; request baru dengan revision sama setelah kedaluwarsa membuat export baru setelah validasi ulang. Baris export dan CV tetap ada. Dibuktikan pgTAP + integration.
13. **Unduhan owner-authorized ≤ 5 menit.** `get_cv_export_download` hanya untuk export `succeeded`, belum kedaluwarsa, milik pemanggil; service menerbitkan signed URL lewat `PrivateStorageService.issueDownload` dengan TTL ≤ 300 detik. Export akun lain atau ID acak → `CV_EXPORT_NOT_FOUND` (tak terbedakan). Dibuktikan integration.
14. **Orphan dan objek stale.** Objek `*/export/*` tanpa baris `cv_exports.object_key` yang cocok dan berumur ≥ 1 jam diantrekan untuk dihapus oleh `reconcile_orphan_export_objects`. Dibuktikan integration.
15. **Akun deleting.** Request saat `deleting_at` terisi → `AUTH_REQUIRED`; worker yang mendapati akun deleting di `get_cv_export_input`/`complete_cv_export` → `failed` `ACCOUNT_DELETING` tanpa upload/penyelesaian. Dibuktikan pgTAP + integration.
16. **Fake hanya dev/test.** `resolvePdfRenderer` default `unavailable`; `fake` ditolak di luar `NODE_ENV=development|test`; konfigurasi Gotenberg invalid → unavailable (fail closed); ringkasan worker menandai `pdfRenderer: "explicit-test-fake"`. Dibuktikan unit.
17. **Paritas preview–export.** Model render dari snapshot (`buildExportRenderModel`) sama persis dengan `buildCvPreviewModel` atas dokumen/item tersimpan revision yang sama; template merender seluruh entry model tanpa entry ganda dan tanpa field di luar model. Dibuktikan unit.
18. **Tanpa perubahan perilaku lama.** Seluruh suite T02–T20, gate M2/M3 tetap lulus tanpa melemahkan assertion. RPC CV T18–T20, RPC update/delete sumber, dan `get_dashboard_summary` tidak diubah. Tidak ada UI/route baru. Dibuktikan regresi penuh + diff review.
19. **Log hygiene.** Error, `detail`, respons service/action, ringkasan worker, dan log tidak memuat teks CV/sumber, nama file, object key, atau secret (sentinel = 0); correlation ID respons error action = ID service. Tidak ada `console.` di `src/features/cv`, `src/server/export`, dan `workers/export-worker.ts`. Dibuktikan integration + unit + grep.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration forward-only T21 dan pgTAP `cv_export.test.sql`.
- Domain `src/domain/cv/export.ts` dan perluasan `contracts.ts`.
- `src/server/export/{cv-print-template,pdf-renderer}.ts`.
- Worker `workers/export-worker.ts`, `workers/supabase-export-gateway.ts`, pendaftaran di `workers/run.ts` dan `workers/bootstrap.ts`.
- Service `src/features/cv/export-service.ts`, pemetaan error, server action, kunci i18n en/id untuk error dan status (dipakai T22).
- Integration `cv-export.test.ts` dan `cv-export-renderer-real.test.ts`, script baru, runbook renderer PDF, `.env.example`, decision 0027, receipt.

### 2.2 Keputusan implementasi

1. **Snapshot = data CV tersimpan, bukan model render.** `internal.cv_export_snapshot(p_document public.cv_documents) returns jsonb` membangun `{ schema_version: 'cv-export.v1', template_key, locale, title, cv_id, cv_revision, section_order, profile_snapshot, summary_override, items: [{ id, section_key, position, source_snapshot, override_text }] }` dari baris tersimpan, urut `section_key` lalu `position` lalu `id`. Worker membangun model render dengan `buildCvPreviewModel` T19 (lewat `buildExportRenderModel`). *Alasan:* DB §5 "snapshot of the whole saved CV, including overrides, ordering, and template version"; SQL tidak dapat menjalankan formatter TypeScript; satu fungsi model untuk preview S13/S14 dan PDF menjamin paritas (decision 0025 *Seam*). Konsekuensi: format tanggal mengikuti kode worker saat render; snapshot tetap sama untuk retry.
2. **Snapshot dibangun dari baris tersimpan, bukan sumber live.** `source_snapshot` dan `override_text` disalin apa adanya; item `kept` memakai wording tersimpan (F07 Keep saved wording). Freshness hanya menentukan boleh/tidaknya export. *Alasan:* preview menunjukkan revision tersimpan yang sama dengan export (AGENTS, F07).
3. **Satu definisi blocker.** `internal.cv_export_blockers(p_document public.cv_documents) returns table (code text, item_id uuid)`; dipakai `get_cv_export_readiness` (tanpa lock) dan `request_cv_export` (di bawah lock). `CONTENT_REQUIRED` dihitung dari item non-deleted di section `experience`, `projects`, `education`, atau `achievements`. *Alasan:* F07 dan rencana §3 *CV*; decision 0026 *Seam* T21.
4. **Urutan lock request (decision 0026 poin 6).** `internal.cv_actor()` (profil `for share`, akun deleting → `AUTH_REQUIRED`) → cek onboarding (`ONBOARDING_REQUIRED`) → `cv_documents for update` **tanpa** cek revision → lookup idempotency → cek revision (`STALE_REVISION`) → cek export aktif/sukses untuk dedup → kunci semua sumber item non-deleted `for share` dengan urutan kanonik experience → project → achievement → education → skill → certification, masing-masing urut `id` → hitung blocker → insert `cv_exports`. Item tidak dikunci terpisah karena setiap mutasi item mengambil lock dokumen lebih dulu (T18–T20). *Alasan:* RPC update sumber mengunci sumber `for update` tanpa menyentuh CV (decision 0026 poin 1), sehingga lock `for share` pada sumber menserialisasi request dengan edit/reopen: mutasi yang menang lebih dulu membuat item `changed`/`unconfirmed` → blokir; request yang menang lebih dulu membuat edit menunggu commit. Jalur delete mengambil lock dokumen lebih dulu (decision 0026 poin 7) sehingga terserialisasi di dokumen.
5. **Idempotency.** `p_idempotency_key` 1–200 karakter, trim, `^[A-Za-z0-9_-]+$`. Key sudah ada dengan `cv_revision = p_expected_revision` → kembalikan export itu (`reused = true`) bahkan bila kini terblokir; key sudah ada dengan revision lain → `IDEMPOTENCY_KEY_REUSED`. Lookup dilakukan setelah lock dokumen agar dua request key sama terserialisasi. *Alasan:* AGENTS (key scoped user + operasi + input revision; payload berbeda ditolak); pola T03/T06.
6. **Dedup tanpa job ganda.** Partial unique index `cv_exports_one_active_key on cv_exports (cv_id) where status in ('queued','running')`. Di request: ada export aktif dengan revision sama → kembalikan (`reused = true`); revision berbeda → `CV_EXPORT_IN_PROGRESS`; export `succeeded` dengan revision sama, `expires_at > now()` dan `purged_at is null` → kembalikan. Dedup dilakukan **setelah** validasi blocker sehingga CV yang kini terblokir tidak mendapat export lama sebagai jalan pintas. *Alasan:* PRD "avoid duplicate jobs"; revision sama berarti snapshot identik (keputusan 1–2).
7. **State machine dan kolom baru.** Tambah `page_count integer`, `byte_size bigint`, `purged_at timestamptz`. Constraint `cv_exports_state_check` meniru `internal.storage_jobs`: `queued` (token/lease/finished/error/object NULL), `running` (`attempt_count > 0`, token dan lease terisi), `succeeded` (token terisi, lease NULL, `finished_at`, `object_key`, `page_count` 1–20, `byte_size` 1–10 MiB, `expires_at` terisi, `error_code` NULL), `failed` (token terisi, lease NULL, `finished_at`, `error_code` terisi, `object_key` NULL). `purged_at` hanya untuk `succeeded`. Snapshot ≤ 4 MiB (`pg_column_size`). *Alasan:* rencana §4 (lease field + CAS); constraint database, bukan pemeriksaan UI.
8. **Imutabilitas.** Trigger `cv_exports_a_guard` (`internal.guard_cv_export_row`) menolak perubahan `user_id`, `cv_id`, `cv_revision`, `snapshot`, `idempotency_key`, `created_at` → `CV_EXPORT_IMMUTABLE`. Grant tabel T18 tetap (select own, tanpa write). *Alasan:* DB §6 "deny direct client writes to … export snapshots"; snapshot immutable sepanjang retry.
9. **Retry eksplisit, tanpa retry otomatis.** Lease lewat → `failed` `EXPORT_TIMEOUT` (pola `expire_ai_job_leases`). Worker tidak mengantre ulang sendiri. `retry_cv_export(p_export_id uuid)` (authenticated): profil `for share` → `cv_documents for update` → export `for update`; bukan milik/ID acak → `CV_EXPORT_NOT_FOUND`; status bukan `failed` → `CV_EXPORT_NOT_RETRYABLE`; kode permanen (`EXPORT_SNAPSHOT_INVALID`, `EXPORT_TOO_LONG`, `ACCOUNT_DELETING`) atau `attempt_count >= 3` → `CV_EXPORT_NOT_RETRYABLE`; ada export aktif lain → `CV_EXPORT_IN_PROGRESS`. Sukses → `queued`, token/lease/error/finished dibersihkan, snapshot tetap. *Alasan:* PRD "allow an explicit retry"; F07 "Retry for the same snapshot"; T13 maksimal tiga attempt. Setelah tiga attempt, jalan pengguna adalah request baru (Regenerate) dengan validasi ulang.
10. **Kode error worker (allowlist).** `EXPORT_TIMEOUT`, `RENDERER_UNAVAILABLE`, `RENDERER_TIMEOUT`, `EXPORT_RENDER_INVALID`, `EXPORT_TOO_LONG`, `EXPORT_SNAPSHOT_INVALID`, `STORAGE_UNAVAILABLE`, `ACCOUNT_DELETING`. Disimpan di `error_code`; tidak pernah teks CV.
11. **Object key per attempt.** Objek diunggah ke `<user_id>/export/<attempt_token>` (key kanonik T05, tanpa nama file). `complete_cv_export(p_export_id, p_attempt_token, p_object_key, p_page_count, p_byte_size)` memeriksa key = `<user_id>/export/<attempt_token>`, token, lease, dan akun tidak deleting dalam CAS; hasil `stale` → worker menghapus objeknya sendiri (best effort) dan `reconcile_orphan_export_objects` menangkap sisanya. *Alasan:* worker dari lease lama tidak boleh menimpa objek attempt baru; key immutable T05 menolak overwrite.
12. **Kedaluwarsa dan cleanup.** `expires_at = finished_at + interval '24 hours'`. `expire_cv_exports(p_limit)` (service_role) memilih `succeeded` dengan `expires_at <= now()` dan `purged_at is null` (`for update skip locked`), memanggil `internal.enqueue_storage_delete`, dan menyetel `purged_at`. Cleanup objek memakai `internal.storage_jobs` lewat `claim_export_cleanup_jobs`/`complete_export_cleanup_job`/`fail_export_cleanup_job`/`retry_export_cleanup_job` berkategori `export` (salinan pola T15 `20260930090000_t15_import_staging.sql:1503–1600`). `reconcile_orphan_export_objects(p_min_age_seconds, p_limit)` meniru `reconcile_orphan_import_objects` (`:1602`). *Alasan:* rencana §3 (export object kedaluwarsa 24 jam, CV tetap); DB §4 storage protocol.
13. **Unduhan.** `get_cv_export_download(p_export_id uuid) returns text` (authenticated, `stable`): object key bila milik pemanggil, `succeeded`, `expires_at > now()`, `purged_at is null`; milik sendiri tetapi kedaluwarsa/purged → `CV_EXPORT_EXPIRED`; bukan milik/ID acak/belum sukses → `CV_EXPORT_NOT_FOUND` (status belum sukses milik sendiri → `CV_EXPORT_NOT_READY`). Service menerbitkan URL lewat `createPrivateStorageService(...).issueDownload(objectKey, 300)` (`src/server/storage/private-storage-service.ts:79`). Object key tidak pernah dikembalikan ke browser; action hanya mengembalikan URL dan `expiresInSeconds`.
14. **Renderer: rute Chromium Gotenberg terisolasi (menunggu persetujuan, §2.4.1).** `GotenbergPdfRenderer` mengirim multipart `files=index.html` (HTML lengkap, CSS inline, tanpa script, tanpa resource eksternal, CSP `default-src 'none'; style-src 'unsafe-inline'`) ke `/forms/chromium/convert/html` dengan ukuran kertas A4 dan `preferCssPageSize=true`; respons dibatasi 10 MiB, wajib `%PDF-`. Container terpisah `workpulse-t21-pdf` (digest image sama dengan T15) di `127.0.0.1:13401`, JavaScript Chromium dimatikan, allow-list hanya `file:///tmp/`, webhook ditolak, tanpa jaringan keluar di staging. Env worker-only: `WORKPULSE_PDF_RENDERER_MODE` (`unavailable` default, `gotenberg`, `fake`), `WORKPULSE_PDF_GOTENBERG_URL`, `WORKPULSE_PDF_RENDER_TIMEOUT_MS` (1.000–90.000, default 60.000). Validasi URL dan pola fail-closed menyalin `resolveDocxRenderer` (`src/server/documents/docx-renderer.ts:126–163`). *Alasan:* rencana §2 (HTML print template + Chromium), tanpa dependency npm baru, image dan pola isolasi T15 sudah terverifikasi; container T15 memakai `--chromium-deny-list=".*"` yang dapat menolak halaman HTML lokal sehingga flag T15 tidak diubah.
15. **Tipografi template (menunggu persetujuan, §2.4.2).** Font **Noto Sans** yang tersedia di image Gotenberg terpin (diverifikasi Fase 0 dengan `fc-list`), fallback `sans-serif`; tanpa font eksternal atau aset biner baru. Template `single_column_v1`: `@page { size: A4; margin: 16mm 18mm; }`, nama sebagai `h1`, baris kontak teks biasa (tanpa hyperlink), heading section `h2` dengan `break-after: avoid`, entry `break-inside: avoid`, bullet `li` `break-inside: avoid`, `lang` dari locale CV, warna hitam/abu netral. Inspeksi visual layout (heading yatim, clipping) milik T22.
16. **Verifikasi PDF di worker.** Setelah render: cek `%PDF-` dan ukuran ≤ 10 MiB, hitung halaman lewat `parseInThread("pdf-pages", …)` (1–20, selain itu `EXPORT_TOO_LONG`), ekstrak teks lewat `parseInThread("pdf", …)` dan pastikan memuat nama efektif ternormalisasi (`EXPORT_RENDER_INVALID` bila tidak). Fase 0 memverifikasi batas halaman/ukuran parser `src/server/documents/pdf-text.ts`; bila parser menolak 20 halaman, **stop**.
17. **Satu export aktif = tidak ada edit yang ikut.** Edit CV setelah request tidak mengubah export berjalan (snapshot immutable). Request revision baru saat export lama masih aktif ditolak `CV_EXPORT_IN_PROGRESS` (keputusan 6) — menunggu persetujuan bersama keputusan 6 (§2.4.3).
18. **Kode error DB baru dan pemetaan.** `CV_EXPORT_BLOCKED` (service `EXPORT_BLOCKED`, action `VALIDATION`, membawa daftar blocker aman), `CV_EXPORT_IN_PROGRESS` (`EXPORT_IN_PROGRESS`, `CONFLICT`), `CV_EXPORT_NOT_FOUND` (`EXPORT_NOT_FOUND`, `NOT_FOUND`), `CV_EXPORT_NOT_RETRYABLE` (`EXPORT_NOT_RETRYABLE`, `CONFLICT`), `CV_EXPORT_NOT_READY` (`EXPORT_NOT_READY`, `CONFLICT`), `CV_EXPORT_EXPIRED` (`EXPORT_EXPIRED`, `CONFLICT`), `CV_EXPORT_IMMUTABLE` (internal; tidak pernah dari jalur normal). `IDEMPOTENCY_KEY_REUSED`, `STALE_REVISION`, `CV_NOT_FOUND`, `ONBOARDING_REQUIRED`, `AUTH_REQUIRED`, `INVALID_CV_INPUT` dipakai ulang. Kunci i18n `cv.export.error.*` dan `cv.export.status.*` en/id.
19. **Nomor.** Migration `supabase/migrations/20261005090000_t21_cv_export_backend.sql` (parity 31/31). Decision `docs/decisions/0027-t21-cv-export-backend.md`. pgTAP `supabase/tests/database/cv_export.test.sql`. Integration `tests/integration/cv-export.test.ts` dan `tests/integration/cv-export-renderer-real.test.ts` (script baru `test:integration:cv-export`). Runbook `docs/verification/T21-pdf-renderer-runbook.md`. Tidak ada Playwright config baru (tanpa UI).

### 2.3 Di luar scope

- Halaman `/cv/preview`, navigasi halaman, tombol Export/Retry/Download/Regenerate, tautan blokir ke S13, polling status di UI, nama file unduhan yang terlihat pengguna, dan QA PDF visual (heading yatim, clipping, inspeksi halaman, `tests/pdf/`) → **T22**.
- Pembersihan objek export saat penghapusan akun dan rekonsiliasi lintas kategori setelah akun dihapus → **T23**. Event analytics export terminal → **T23/T24**. Pengukuran p95 render → **T24**. Deployment renderer staging/production → **T25**.
- Perubahan RPC CV T18–T20, RPC update/delete sumber, `get_dashboard_summary`, atau UI S13.
- Template lain, CV variants, target job, AI, evidence/tautan evidence di PDF, hyperlink, foto, warna aksen, enkripsi PDF, watermark.

### 2.4 Keputusan produk yang menunggu persetujuan pengguna

Catat persetujuan (tanggal dan pilihan) di dokumen ini sebelum Fase 1. Bila implementasi menuntut penyimpangan dari keputusan yang disetujui, **stop** (lihat §8).

1. **Renderer** (§2.2.14): rute Chromium Gotenberg di container terpisah `workpulse-t21-pdf` (image T15, loopback, JavaScript mati). Alternatif ditolak: `playwright-core`/Chromium di proses worker (dependency dan runtime browser baru di worker), mengubah flag container T15.
2. **Font PDF** (§2.2.15): Noto Sans dari image terpin. Alternatif: vendoring file Plus Jakarta Sans (OFL) agar seragam dengan UI — menambah aset biner dan lisensi yang harus dicatat.
3. **Dedup dan export aktif** (§2.2.6, §2.2.17): satu export aktif per CV; revision sama → hasil yang ada dipakai ulang; revision baru saat masih aktif → `CV_EXPORT_IN_PROGRESS`.
4. **Retry** (§2.2.9): tanpa retry otomatis; Retry eksplisit snapshot sama maksimal tiga attempt per export; setelah itu request baru dengan validasi ulang.
5. **Batas output** (§2.2.16): PDF maksimal 20 halaman dan 10 MiB (`EXPORT_TOO_LONG`, permanen).

## 3. Kontrak teknis

### 3.1 Migration `20261005090000_t21_cv_export_backend.sql`

Forward-only. Pola errcode/`detail`, `security definer`, `set search_path = pg_catalog`, identifier ter-qualify, revoke/grant, dan `comment on function` mengikuti T18–T20.

1. **Tabel.** `alter table public.cv_exports add column page_count integer, add column byte_size bigint, add column purged_at timestamptz;` constraint `cv_exports_state_check`, `cv_exports_snapshot_size_check` (≤ 4.194.304 byte), `cv_exports_page_count_check`, `cv_exports_byte_size_check`, `cv_exports_object_key_owner_check` (`object_key` NULL atau `^<user_id>/export/<uuid>$`); partial unique index `cv_exports_one_active_key`; index `cv_exports_expiry_idx (expires_at) where status = 'succeeded' and purged_at is null`; index `cv_exports_claim_idx (created_at, id) where status = 'queued'`. Trigger `cv_exports_a_guard` (sebelum trigger touch T18). Comment tabel diperbarui.
2. **Helper.** `internal.cv_export_effective_name(public.cv_documents) returns text`; `internal.cv_export_blockers(public.cv_documents)` (§2.2.3); `internal.cv_export_snapshot(public.cv_documents)` (§2.2.1); `internal.cv_export_lock_sources(p_user_id uuid, p_cv_id uuid)` (urutan §2.2.4); `internal.fail_cv_export_locked(public.cv_exports, text)`; `internal.is_permanent_export_error(text)`. Semua revoke dari `public, anon, authenticated, service_role`.
3. **RPC authenticated** (execute hanya `authenticated`):
   - `public.get_cv_export_readiness() returns table (has_cv boolean, cv_revision integer, ready boolean, blockers jsonb)` — `stable`, tanpa lock, `blockers` array `{code, item_id}`; tanpa CV → `has_cv = false`, `ready = false`, `blockers = [{code: 'CV_NOT_FOUND'}]`.
   - `public.request_cv_export(p_expected_revision integer, p_idempotency_key text) returns table (export_id uuid, status text, cv_revision integer, reused boolean)` (§2.2.4–§2.2.6). Blokir → errcode `P0001`, message `CV_EXPORT_BLOCKED`, `detail` = JSON `{"blockers":[{"code":…,"item_id":…}]}` (hanya kode dan ID milik pemanggil).
   - `public.retry_cv_export(p_export_id uuid) returns table (export_id uuid, status text, attempt_count integer)` (§2.2.9).
   - `public.get_cv_export_download(p_export_id uuid) returns text` (§2.2.13).
4. **RPC service-role** (execute hanya `service_role`; pola `20260928090000_t13_ai_jobs_consent.sql:442–691`):
   - `public.expire_cv_export_leases() returns integer` (profil `for share skip locked` → export `for update skip locked`; `EXPORT_TIMEOUT`).
   - `public.claim_cv_export_jobs(p_limit integer default 1) returns table (id uuid, user_id uuid, cv_revision integer, attempt_count integer, attempt_token uuid)` — memanggil `expire_cv_export_leases`, batas 1–10.
   - `public.get_cv_export_input(p_export_id uuid, p_attempt_token uuid) returns table (snapshot jsonb, cv_revision integer)` — profil `for share` → export `for update`; token/lease invalid → tanpa baris; akun deleting → `fail` `ACCOUNT_DELETING`, tanpa baris.
   - `public.complete_cv_export(p_export_id uuid, p_attempt_token uuid, p_object_key text, p_page_count integer, p_byte_size bigint) returns text` → `succeeded` | `stale` | `failed:ACCOUNT_DELETING`.
   - `public.fail_cv_export(p_export_id uuid, p_attempt_token uuid, p_error_code text) returns boolean` (allowlist §2.2.10).
   - `public.expire_cv_exports(p_limit integer default 100) returns integer` (§2.2.12).
   - `public.claim_export_cleanup_jobs`, `public.complete_export_cleanup_job`, `public.fail_export_cleanup_job`, `public.retry_export_cleanup_job`, `public.reconcile_orphan_export_objects` (§2.2.12; signature sama dengan padanan import).
5. Tidak ada perubahan pada fungsi T18–T20. `pnpm db:types` memperbarui `src/server/supabase/database.types.ts`.

### 3.2 Domain

- `contracts.ts` (ubah): `CV_ERROR_CODES` + kode §2.2.18; `CV_EXPORT_BLOCKER_CODES = ['CV_NOT_FOUND','NAME_REQUIRED','CONTENT_REQUIRED','ITEM_CHANGED','ITEM_DELETED','ITEM_UNCONFIRMED','PROFILE_CHANGED']`; `CV_EXPORT_STATUSES`; `CV_EXPORT_ERROR_CODES` (allowlist §2.2.10); `cvExportReadinessSchema`; `cvExportRowSchema` (kolom aman tanpa `snapshot`/`attempt_token`/`lease_expires_at`/`object_key`); `requestCvExportInput` (`expected_revision` int ≥ 1, `idempotency_key` pola §2.2.5); `retryCvExportInput`; `downloadCvExportInput`.
- `export.ts` (baru, murni, import relatif agar dapat dipakai worker): `cvExportSnapshotSchema` (strict; item memakai skema `source_snapshot` dan profil yang sudah ada); `buildExportRenderModel(snapshot)` → `CvPreviewModel` lewat `buildCvPreviewModel`; `effectiveExportName(snapshot)`; `isPermanentExportError(code)`; `isExportExpired(row, now)`.

### 3.3 Server export dan worker

- `src/server/export/cv-print-template.ts` (murni): `renderCvPrintHtml(model: CvPreviewModel): string` — escape HTML untuk setiap nilai, struktur §2.2.15, tanpa `<script>`, tanpa URL eksternal, tanpa entry `deleted`.
- `src/server/export/pdf-renderer.ts`: `PdfRenderer` (`kind`, `render(html, signal) → { status: 'ok', pdf } | { status: 'error', code: 'RENDERER_UNAVAILABLE' | 'RENDERER_TIMEOUT' | 'EXPORT_RENDER_INVALID' }`), `UnavailablePdfRenderer`, `ExplicitTestFakePdfRenderer` (PDF minimal valid ber-teks, hanya dev/test), `GotenbergPdfRenderer`, `resolvePdfRenderer(options)` (§2.2.14).
- `workers/export-worker.ts`: `runExportWorkerOnce(options)` — housekeeping (`expireCvExports`, `reconcileOrphanExportObjects`), claim, input, validasi snapshot (`EXPORT_SNAPSHOT_INVALID`), model → HTML → render → verifikasi §2.2.16 → upload `uploadObject(key, pdf, { contentType: 'application/pdf', metadata })` → complete (stale → hapus objek sendiri) → cleanup jobs kategori `export`. Ringkasan hanya hitungan dan kode: `exportJobsClaimed`, `exportSucceeded`, `exportFailed`, `exportStale`, `exportExpired`, `exportOrphansQueued`, `exportCleanupClaimed`, `exportCleanupCompleted`, `exportCleanupRetried`. Test seam `onRendered` untuk race.
- `workers/supabase-export-gateway.ts`: pemanggilan RPC §3.1.4 dan Storage dengan secret key server.
- `workers/run.ts`: pass export terisolasi seperti pass lain; `workers/bootstrap.ts`: `registeredJobs` + `"cv-export"`, `"export-cleanup"` (perbarui test bootstrap yang ada).

### 3.4 Service, action, i18n

- `src/features/cv/export-service.ts`: `createCvExportService({ supabase, storage, correlationId })` dengan `getReadiness()`, `listExports(limit)` (kolom aman, terbaru dulu, maks 10), `requestExport(input)`, `retryExport(input)`, `issueDownload(input)` (RPC + `issueDownload(key, 300)`); error lewat `cv-errors.ts` dengan `correlationId`; blocker `CV_EXPORT_BLOCKED` di-parse dari `detail` dengan Zod dan dibawa sebagai `blockers`.
- `src/features/cv/cv-errors.ts`: kode §2.2.18.
- `src/features/cv/actions.ts`: `requestCvExportAction`, `retryCvExportAction`, `issueCvExportDownloadAction` lewat `run()` T19 (correlation ID tunggal; `revalidatePath('/cv')` hanya setelah request/retry sukses). Tidak ada komponen UI.
- `src/i18n/messages.ts`: kunci en **dan** id untuk `cv.export.error.*`, `cv.export.blocker.*`, `cv.export.status.*`.
- `.env.example`: tiga env renderer PDF (worker-only, default `unavailable`).

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20261005090000_t21_cv_export_backend.sql`, `supabase/tests/database/cv_export.test.sql` |
| Modify | `src/server/supabase/database.types.ts` (`db:types`) |
| Create | `src/domain/cv/export.ts`, `src/server/export/cv-print-template.ts`, `src/server/export/pdf-renderer.ts` |
| Modify | `src/domain/cv/contracts.ts`, `src/features/cv/{cv-errors,actions}.ts`, `src/i18n/messages.ts` |
| Create | `src/features/cv/export-service.ts` |
| Create | `workers/export-worker.ts`, `workers/supabase-export-gateway.ts` |
| Modify | `workers/run.ts`, `workers/bootstrap.ts`, `.env.example` |
| Create | `tests/unit/{cv-export-domain,cv-print-template,pdf-renderer,export-worker,cv-export-service}.test.ts`; perluas `tests/unit/{cv-contracts,cv-actions}.test.ts` dan test bootstrap worker yang ada (Fase 0 mencatat namanya) |
| Create | `tests/integration/cv-export.test.ts`, `tests/integration/cv-export-renderer-real.test.ts` |
| Modify | `package.json` (script baru), `README.md` (Fase 8) |
| Create | `docs/verification/T21-pdf-renderer-runbook.md` (Fase 0/3) |
| Create (Fase 8) | `docs/decisions/0027-t21-cv-export-backend.md`, `docs/verification/T21-cv-export-backend.md` |

Script baru:

- `test:integration:cv-export` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/cv-export.test.ts tests/integration/cv-export-renderer-real.test.ts`

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD. Working tree harus bersih kecuali `.claude/`. Jika tidak, **stop**.
- [ ] `pnpm install --frozen-lockfile`, `pnpm db:status`, `pnpm exec supabase migration list --local`. Parity harus **30/30** dengan migration terakhir `20261004090000_t20_cv_freshness_deletion.sql`. Bila Docker mati, nyalakan dan `pnpm db:start` (tanpa reset).
- [ ] Baseline `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan 89 file / 706 test), `pnpm db:test` (harapan 14 file / 1115 assertion), `pnpm worker:check`, `pnpm test:integration:cv-freshness` (harapan 11), `pnpm test:integration:cv` (harapan 10).
- [ ] Verifikasi dari source dan catat file:baris untuk:
  - `cv_exports` (`20261002090000_t18_cv_schema_selection.sql:169–205`, trigger `:293`, RLS/grant `:301–315`) dan bahwa belum ada baris di database lokal yang melanggar constraint baru (`select count(*) from public.cv_exports`).
  - `internal.cv_actor` (`:413`), `internal.cv_lock` (`:435`), `internal.cv_lock_source` (`:461`), `internal.cv_source_snapshot` (`:349`); `internal.cv_item_state` (`20261004090000_t20_cv_freshness_deletion.sql:62`), `internal.cv_profile_state` (`:120`), `internal.cv_lock_for_source_change` (`:157`); cek onboarding di `save_cv_edits` (`20261003090000_t19_cv_builder_overrides.sql:103`).
  - Urutan lock `save_achievement` (edit/reopen/confirm) dan `update_profile`: keduanya mengunci sumber/profil `for update` tanpa menunggu `cv_documents`. Bila ada yang menunggu `cv_documents` setelah mengunci sumber, **stop**.
  - Pola job T13 (`20260928090000_t13_ai_jobs_consent.sql:442–691`), storage jobs T05 (`20260917090000_t05_private_storage_foundation.sql:56–180`, `complete_storage_job`/`fail_storage_job` `:231`/`:263`), cleanup/reconcile import T15 (`20260930090000_t15_import_staging.sql:1461–1640`), dan kolom `last_error_code` pada `internal.storage_jobs` (migration yang menambahkannya).
  - `src/domain/cv/{preview,outline,labels,resolve,contracts}.ts`, `src/features/cv/{cv-service,cv-errors,actions}.ts` (`run()`, correlation ID), `src/server/storage/{adapter,private-storage-service,supabase-storage-adapter,object-key}.ts` (perilaku `uploadObject` pada key yang sudah ada, `createSignedDownloadUrl` dan disposition attachment), `src/server/documents/{docx-renderer,parse-in-thread,parser-thread,pdf-text}.ts` (batas halaman/ukuran `pdf`/`pdf-pages`), `workers/{run,bootstrap,import-worker,supabase-import-gateway}.ts`, dan test bootstrap worker.
- [ ] **Probe renderer Chromium.** Jalankan container `workpulse-t21-pdf` sesuai §2.2.14 dengan digest T15 (`docs/verification/T15-renderer-runbook.md`), flag kandidat `--chromium-disable-javascript=true --chromium-allow-list="^file:///tmp/.*" --webhook-deny-list=".*" --api-timeout=60s`, port `127.0.0.1:13401`, memori 2 GiB. Catat `/health` (`chromium: up`), versi, dan hasil POST HTML kecil ber-teks Indonesia ke `/forms/chromium/convert/html` (A4): `%PDF-`, MediaBox, teks terekstrak. Catat `docker exec workpulse-t21-pdf fc-list | findstr /i "Noto"`. Catat nama field form yang benar untuk versi ini (ukuran kertas, margin, `preferCssPageSize`). Bila HTML lokal ditolak oleh flag isolasi apa pun atau Noto Sans tidak ada, **stop** dan laporkan alternatif.
- [ ] Tulis draft `docs/verification/T21-pdf-renderer-runbook.md` (perintah container, flag, env, verifikasi, stop) dari hasil probe.
- [ ] Pastikan persetujuan §2.4 tercatat. Bila belum, **stop** setelah receipt.
- [ ] Tulis receipt Fase 0 `docs/verification/T21-phase0-baseline.md`. Commit `docs(t21): add phase 0 baseline receipt and renderer runbook`.

### Fase 1 — Database (TDD pgTAP)

- [ ] Tulis `supabase/tests/database/cv_export.test.sql` yang gagal lebih dulu (pola `cv_freshness.test.sql`). Assertion minimum:
  1. Struktur: kolom baru, constraint, index, trigger, fungsi `prosecdef`; RPC authenticated hanya `authenticated`, RPC worker hanya `service_role`, helper internal tanpa grant; `authenticated` tetap tanpa insert/update/delete pada `cv_exports`.
  2. Blocker (§1.1): CV siap → tanpa blocker; nama kosong (snapshot dan override) → `NAME_REQUIRED`; hanya skill/certification → `CONTENT_REQUIRED`; item `changed`/`deleted`/`unconfirmed` → kode per item dengan `item_id`; profil `changed` → `PROFILE_CHANGED`; `kept` (item dan profil) → lolos.
  3. Request (§1.2–§1.3): baris `queued` dengan snapshot `cv-export.v1` lengkap dan urut; snapshot tanpa key privat (`raw_text`, `contribution`, `source_excerpt`, `metrics`, `activity_id`, evidence); `CV_EXPORT_BLOCKED` dengan `detail` JSON tanpa write; `STALE_REVISION`, `CV_NOT_FOUND`, `ONBOARDING_REQUIRED`, `INVALID_CV_INPUT` (key invalid) tanpa write.
  4. Imutabilitas (§1.3): update `snapshot`/`cv_revision`/`idempotency_key` sebagai service_role → `CV_EXPORT_IMMUTABLE`.
  5. Idempotency dan dedup (§1.6): key sama → `reused`; key sama revision lain → `IDEMPOTENCY_KEY_REUSED`; aktif revision sama → dikembalikan; aktif revision lain → `CV_EXPORT_IN_PROGRESS`; sukses belum kedaluwarsa → dikembalikan; sukses kedaluwarsa/purged → export baru; partial unique index menolak insert aktif kedua.
  6. Job (§1.7): claim mengisi token/lease/attempt; claim kedua tidak mengambil job yang sama; complete dengan token salah/lease lewat → `stale`; complete benar → `succeeded`, `expires_at = finished_at + 24 jam`, key harus `<user>/export/<token>`; lease lewat → `EXPORT_TIMEOUT`; fail dengan kode di luar allowlist → `22023`.
  7. Retry (§1.9): failed retriable → `queued`, snapshot identik; permanen/attempt 3/bukan failed/akun lain → kode §2.2.9.
  8. Kedaluwarsa dan cleanup (§1.12, §1.14): `expire_cv_exports` mengantre storage job dan menyetel `purged_at`; claim cleanup hanya kategori `export`; reconcile hanya objek `export` yatim ≥ ambang umur.
  9. Unduhan (§1.13): milik sendiri sukses → key; kedaluwarsa → `CV_EXPORT_EXPIRED`; belum sukses → `CV_EXPORT_NOT_READY`; akun B/ID acak → `CV_EXPORT_NOT_FOUND`.
  10. Akun deleting (§1.15): request → `AUTH_REQUIRED`; `get_cv_export_input` → tanpa baris dan job `failed` `ACCOUNT_DELETING`.
  11. Regresi: file pgTAP lama lulus tanpa perubahan (khususnya `cv_selection.test.sql` bagian grant `cv_exports`).
- [ ] Pastikan `pnpm db:test` **FAIL** karena test baru. Tulis migration §3.1, lalu `pnpm exec supabase migration up --local`. **Dilarang** `db reset`.
- [ ] `pnpm db:test` (PASS; catat total), `pnpm db:lint`, `pnpm db:types`, migration list (31/31).
- [ ] Commit `feat(t21): add CV export request, job lifecycle and retention RPCs`, lalu receipt Fase 1. Checkpoint Claude dianjurkan.

### Fase 2 — Domain murni (TDD unit)

- [ ] Test gagal lebih dulu:
  - `cv-contracts`: kode error, blocker, status, allowlist error worker; `requestCvExportInput` (pola key, revision ≥ 1); `cvExportRowSchema` menolak key privat.
  - `cv-export-domain`: `cvExportSnapshotSchema` menerima snapshot dari fixture dan menolak key asing/versi lain; `buildExportRenderModel` **sama persis** dengan `buildCvPreviewModel` atas dokumen/item yang sama (en dan id, tanggal parsial, override, achievement bersarang dan standalone); `effectiveExportName`; `isPermanentExportError`; `isExportExpired`.
- [ ] Implementasi §3.2 hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t21): add CV export snapshot domain`, receipt Fase 2.

### Fase 3 — Template dan PdfRenderer (TDD unit)

- [ ] Test gagal lebih dulu:
  - `cv-print-template`: escape (`<script>`, `&`, kutip) di setiap field; tanpa `<script>`/`http`/`src=`/`url(` eksternal; `lang` sesuai locale; heading section sesuai `CV_LABELS`; semua entry dan child model muncul tepat sekali; tanpa field di luar model (mis. `credential_url`); aturan CSS `@page` A4 dan `break-*` ada.
  - `pdf-renderer`: resolve default unavailable; fake ditolak di production; URL invalid/timeout di luar batas → unavailable; Gotenberg mengirim satu part `index.html` dan field A4 yang tercatat di Fase 0 (fetch palsu); respons non-OK → `RENDERER_UNAVAILABLE`, abort timeout → `RENDERER_TIMEOUT`, bukan `%PDF-`/terlalu besar → `EXPORT_RENDER_INVALID`; fake menghasilkan PDF yang lolos `parseInThread("pdf")`.
- [ ] Implementasi §3.3 (template + renderer). `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t21): add single-column print template and PDF renderer adapter`, receipt Fase 3.

### Fase 4 — Worker (TDD unit dengan fake gateway)

- [ ] Test gagal lebih dulu (`export-worker`): jalur sukses (claim → input → render → verifikasi → upload key `<user>/export/<token>` → complete); snapshot invalid → `EXPORT_SNAPSHOT_INVALID`; renderer gagal → kode renderer; halaman > 20 → `EXPORT_TOO_LONG`; teks tanpa nama → `EXPORT_RENDER_INVALID`; upload gagal → `STORAGE_UNAVAILABLE`; input tanpa baris (stale/deleting) → tidak render; complete `stale` → hapus objek sendiri; housekeeping dipanggil; cleanup retry/backoff; ringkasan tanpa teks/key/nama; satu job gagal tidak menghentikan job lain; bootstrap mendaftarkan `cv-export` dan `export-cleanup`.
- [ ] Implementasi worker, gateway, `run.ts`, `bootstrap.ts`, `.env.example`. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm worker:check`. Commit `feat(t21): add CV export worker`, receipt Fase 4.

### Fase 5 — Service dan action (TDD unit)

- [ ] Test gagal lebih dulu:
  - `cv-export-service`: readiness dan daftar divalidasi Zod; setiap kode DB → kode service + `messageKey` + `correlationId`; `CV_EXPORT_BLOCKED` membawa blocker dari `detail` (detail rusak → blocker kosong, tetap `EXPORT_BLOCKED`); `issueDownload` memakai TTL 300 dan tidak mengembalikan object key; pesan error tanpa sentinel.
  - `cv-actions`: validasi input tiga action; `revalidatePath('/cv')` hanya setelah request/retry sukses; correlation ID error = ID service.
  - Parity kunci i18n en/id.
- [ ] Implementasi §3.4. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Commit `feat(t21): add CV export service and actions`, receipt Fase 5.

### Fase 6 — Integration nyata

- [ ] `tests/integration/cv-export.test.ts` (setup seperti `cv-freshness.test.ts`: admin, owner A/B nyata, onboarding dan sumber lewat RPC nyata, Storage lokal nyata, worker lewat `runExportWorkerOnce` dengan gateway Supabase nyata dan renderer **fake** kecuali disebut lain). Skenario wajib:
  1. Jalur utama: CV siap → readiness ready → request → worker → `succeeded` → objek ada di `<user>/export/<token>` → `issueDownload` menghasilkan URL yang mengunduh `%PDF-` dengan TTL ≤ 300.
  2. Release scenario PRD: achievement terpilih ber-override → edit sumber → readiness `ITEM_CHANGED`, request `CV_EXPORT_BLOCKED` → Keep saved wording (`resolve_cv_freshness` keep) → export lolos dengan wording override → delete achievement → `ITEM_DELETED` diblokir → remove item → lolos.
  3. Graduate (PRD): tanpa experience, dengan education + project akademik + achievement confirmed → export sukses; akun dengan skill saja → `CONTENT_REQUIRED`; nama override kosong dan snapshot kosong tidak mungkin dibuat lewat RPC → dibuktikan di pgTAP saja (catat).
  4. Snapshot tidak membaca career rows (§1.4): request → edit `cv_bullet` sumber dengan sentinel baru sebelum worker berjalan → PDF/teks render memuat wording lama, tidak memuat sentinel baru.
  5. Race (§1.5): skenario (a)–(e) dengan dua client paralel ×3 putaran; catat hasil tiap putaran; tanpa `40P01`; setiap export yang terbentuk memiliki snapshot konsisten dengan keadaan sebelum mutasi.
  6. Idempotency/dedup (§1.6): dua request paralel key berbeda revision sama → satu export; key sama revision lain → `IDEMPOTENCY_KEY_REUSED`; request revision baru saat aktif → `CV_EXPORT_IN_PROGRESS`.
  7. Lease (§1.7): claim, majukan lease ke masa lalu lewat admin SQL, `expire_cv_export_leases` → `EXPORT_TIMEOUT`; worker lama menyelesaikan → `stale`, objeknya terhapus; retry → attempt baru sukses dengan snapshot sama.
  8. Render gagal (§1.8): renderer unavailable → `failed` `RENDERER_UNAVAILABLE`; revision/snapshot/override CV tidak berubah; retry setelah renderer tersedia → sukses; tiga attempt gagal → retry `CV_EXPORT_NOT_RETRYABLE`, request baru sukses.
  9. Kedaluwarsa (§1.12): majukan `expires_at` lewat admin → worker housekeeping mengantre dan cleanup menghapus objek → unduhan `CV_EXPORT_EXPIRED` → request baru revision sama membuat export baru.
  10. Orphan (§1.14): objek `export` tanpa baris berumur ≥ ambang → diantrekan dan dihapus.
  11. Ownership, deleting, log hygiene (§1.13, §1.15, §1.19): B tidak melihat/me-retry/mengunduh export A (`CV_EXPORT_NOT_FOUND`); akun deleting di tengah job → `ACCOUNT_DELETING`; sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>` (nama, override, bullet, judul) tidak muncul di error/`detail`/respons service/ringkasan worker.
- [ ] `tests/integration/cv-export-renderer-real.test.ts` (renderer Gotenberg nyata dari env `WORKPULSE_PDF_GOTENBERG_URL`; gagal keras bila tidak terjangkau, tanpa fallback fake): fixture en dan id dengan karakter Indonesia dan bullet panjang → request → worker → unduh objek → `pdfjs-dist` di test: MediaBox A4 ± 1 pt, teks memuat nama efektif, heading locale, override, bullet Indonesia; fixture panjang → > 1 halaman dan ≤ 20; teks tidak memuat ID item, object key, atau kata `evidence` dari data uji.
- [ ] Tambah script `test:integration:cv-export`, jalankan. Commit `test(t21): add CV export integration suites`, receipt Fase 6.

### Fase 7 — Regresi penuh

- [ ] Jalankan seluruh §7. `test:e2e:m2`, `test:e2e:m3` wajib lulus tanpa melemahkan assertion env (kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk run itu). ClamAV, Gotenberg T15, dan renderer PDF T21 wajib berjalan untuk suite yang membutuhkannya; bila tidak, catat **tidak dijalankan** beserta alasan. Flaky bawaan `activity-ui.spec.ts:356` dicatat sebagai flaky bila lulus saat diulang tanpa perubahan.
- [ ] `git diff 5ebf1b2 -- supabase/migrations` hanya menambah file T21; tidak ada file migration lama berubah. Grep `console.` sesuai §1.19.
- [ ] Receipt Fase 7 `docs/verification/T21-phase7-regression.md`. Commit `test(t21): record regression receipt`. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–7, output command, dan daftar acceptance yang belum terbukti.

### Fase 8 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0027-t21-cv-export-backend.md`: keputusan §2.2 poin 1–19 dan persetujuan §2.4, kode error baru, protokol lock request/retry/worker, state machine, alternatif yang ditolak (snapshot berupa model render, membaca sumber live di worker, retry otomatis, objek per export id, Chromium di proses worker, mengubah flag container T15, menulis CV saat export gagal), seam T22 (S14 memakai `get_cv_export_readiness`, `listExports`, action request/retry/download, `buildExportRenderModel` untuk preview yang sama, blocker → `/cv#cv-review` dan `#cv-item-<id>`; QA visual dan `tests/pdf/`) dan T23 (objek export saat penghapusan akun, event export terminal).
- [ ] `docs/verification/T21-cv-export-backend.md`: pass/fail/warning/tidak dijalankan, trace ke R10, F07, S14 (batas), DB §4/§5/§6 dan setiap poin §1.
- [ ] Finalisasi `docs/verification/T21-pdf-renderer-runbook.md`; README (export backend, renderer PDF, script baru, tabel quality gates). `AGENTS.md` dan salinannya di `docs/` tetap identik bila disentuh (biasanya oleh `workpulse-task-closeout`).
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- Owner A (employee): onboarding selesai, locale CV `en`, timezone `Asia/Jakarta`. Experience current, project ber-experience, achievement confirmed ber-project dengan override, achievement confirmed standalone, education, skill `SQL`, certification; override profil `headline`. Varian locale `id` dengan bullet `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”` dan nama `Siti Nurhaliza Ç. Ñuñez` (karakter non-ASCII).
- Owner A-long: ≥ 12 experience/project dengan bullet panjang (≥ 600 karakter) untuk output multipage ≤ 20 halaman.
- Owner G (graduate): tanpa experience; education, project akademik, satu achievement confirmed.
- Owner S: hanya skill dan certification terpilih (untuk `CONTENT_REQUIRED`).
- Owner B: CV dan export sendiri untuk isolasi; sesi kedua untuk race.
- Sentinel privat: `WP-PRIVATE-CV-SENTINEL-<uuid>` di nama override, judul CV, `cv_bullet`, dan override item A (sentinel boleh muncul di PDF A sendiri, tidak boleh di error/log/ringkasan).
- Setiap test membersihkan akun fixture dan objek Storage-nya seperti suite lain.

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

`test:integration:cv-export` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan (di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong). Muat env Supabase lokal (`.env.local` + key) dan `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` dalam command yang sama dengan suite (env PowerShell tidak bertahan antar command). Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`. Untuk edit file ber-karakter non-ASCII gunakan tool Edit, bukan `Set-Content`. Container renderer hanya dikelola dengan nama `workpulse-t21-pdf`; jangan menghentikan container Supabase, ClamAV T10, atau Gotenberg T15.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, parity bukan 30/30, atau persetujuan §2.4 belum tercatat sebelum Fase 1.
- Probe Fase 0 gagal: rute Chromium menolak HTML lokal dengan flag isolasi, Noto Sans tidak ada, atau parser thread tidak menerima PDF 20 halaman/10 MiB.
- Penyimpangan dari keputusan §2.4 yang disetujui.
- Penyelesaian memerlukan `db reset`, rewrite migration lama, perubahan fungsi T18–T20, RPC update/delete sumber, `get_dashboard_summary`, atau grant tabel `cv_exports` T18.
- Fase 0 menemukan jalur mutasi sumber/profil yang menunggu `cv_documents` setelah mengunci sumber, atau race memicu `40P01` yang tidak hilang dengan urutan §2.2.4.
- Implementasi terasa memerlukan route/komponen UI, AI, dependency npm baru, font/aset biner baru (kecuali disetujui di §2.4.2), atau data dari luar snapshot di worker.
- Test membutuhkan key nyata, renderer jatuh ke fake di suite renderer nyata, atau sentinel muncul di output/log/ringkasan.
- Perubahan pada suite lama (T02–T20) diperlukan agar lulus, selain penyesuaian bootstrap worker dan kunci i18n yang dicatat di receipt.

## 9. Gate review Claude (setelah Fase 7)

Review read-only mencakup:

- `request_cv_export`: `security definer`/`search_path`/grant; urutan lock §2.2.4 (profil → dokumen → sumber kanonik → insert); idempotency setelah lock; dedup setelah validasi; blocker memakai fungsi T20 yang sama; `detail` hanya kode dan ID milik pemanggil; satu transaksi.
- Snapshot: isi persis §2.2.1 dari baris tersimpan; tidak ada field privat; imutabilitas trigger; ukuran dibatasi.
- State machine dan CAS: claim/complete/fail/expire dengan token dan lease; tidak ada jalan worker lama menulis; `attempt_count ≤ 3`; retry hanya snapshot sama; kode permanen.
- Worker: hanya membaca `get_cv_export_input`; verifikasi `%PDF-`/ukuran/halaman/teks; key per attempt; objek stale dihapus; ringkasan tanpa teks/key; fake tidak mungkin aktif di production.
- Renderer: HTML tanpa script/resource eksternal; escape lengkap; container terisolasi sesuai runbook; timeout dan batas respons.
- Retensi: `expires_at` 24 jam, `purged_at`, cleanup kategori `export`, reconcile orphan; CV tidak pernah terhapus atau berubah karena export.
- Unduhan: owner-authorized, TTL ≤ 300, object key tidak sampai ke browser, foreign/acak tak terbedakan.
- Race tanpa `40P01`, hasil konsisten; PDF valid dari snapshot lama tidak berubah oleh edit berikutnya.
- Tidak ada fitur T22/T23 prematur, UI, AI, evidence, atau roadmap; T18–T20 tidak berubah.
- Log/error hygiene; tidak ada `console.`; semua suite lama lulus; angka di receipt cocok dengan hasil ulang.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Snapshot yang tidak benar-benar immutable atau worker yang membaca sumber live.** Gateway memanggil tabel CV/sumber, atau retry membangun ulang snapshot. Dijaga pgTAP 4, integration 4 dan 7, review gateway.
2. **Validasi di luar lock.** Blocker dihitung sebelum sumber dikunci sehingga edit yang commit di sela-sela lolos ke snapshot. Dijaga integration 5 (lima skenario ×3) dan review urutan statement.
3. **Worker lease lama menyelesaikan atau menimpa hasil.** Complete tanpa cek lease/token, atau objek dari attempt lama dirujuk. Dijaga pgTAP 6, integration 7, key per attempt.
4. **Job ganda atau idempotency longgar.** Dedup sebelum lock, key sama dengan revision lain diterima, atau export lama dipakai saat CV kini terblokir. Dijaga pgTAP 5 dan integration 6.
5. **PDF yang tampak sukses tetapi tidak dapat dicari atau bukan A4.** Renderer fake ikut di suite nyata, atau verifikasi teks/halaman dilewati. Dijaga integration renderer nyata dan unit worker.
6. **Kebocoran data.** Teks CV, object key, atau nama di error/`detail`/ringkasan worker; evidence atau URL di template. Dijaga sentinel integration 11, unit template, dan grep.

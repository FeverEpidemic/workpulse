# T21 Immutable export backend — bukti acceptance

- Tanggal: 6 Oktober 2026
- Status: **DONE** (acceptance lokal; gate review menemukan satu P2 (RV1), sudah diperbaiki, review ulang tanpa P0–P2; closeout 6 Oktober 2026).
- Pelaksana: Claude Sonnet 5.5 (Fase 0–7). Reviewer: Claude (Opus), gate review [`T21-review-remediation-plan.md`](T21-review-remediation-plan.md). Remediasi RV1/N1 [`T21-phase7b-remediation.md`](T21-phase7b-remediation.md) dan Fase 8 (dokumen ini, decision 0027, runbook final, README) dikerjakan reviewer atas instruksi pengguna, sehingga review ulang tidak independen penuh.
- Trace:
  - PRD: R10, *CV freshness contract*, aturan durable job, release scenario *delete its source … export blocked until resolved*, *graduate … useful CV*, *PDF text extraction, Indonesian characters, long bullets, multipage*.
  - Flow dan screen: F07 langkah 3–6; S14 hanya sebagai batas T22.
  - DB: §4 (prefix `export`), §5 `cv_exports` dan *Deletion and export consistency*, §6 (klien tidak menulis snapshot; race sumber vs export).
- Dokumen terkait: decision [0027](../decisions/0027-t21-cv-export-backend.md), runbook [renderer PDF](T21-pdf-renderer-runbook.md), receipt [Fase 0](T21-phase0-baseline.md), [1](T21-phase1-database.md), [2](T21-phase2-domain.md), [3](T21-phase3-template-renderer.md), [4](T21-phase4-worker.md), [5](T21-phase5-service-actions.md), [6](T21-phase6-integration.md), [7](T21-phase7-regression.md), [7b](T21-phase7b-remediation.md).

## Acceptance §1

| # | Poin | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | Kesiapan dari satu definisi | PASS | pgTAP `cv_export` (setiap kode blocker; `kept` lolos; skill/certification saja → `CONTENT_REQUIRED`); integration (`ITEM_CHANGED`, `ITEM_DELETED`, `CONTENT_REQUIRED`) |
| 2 | Request atomik; terblokir tanpa write | PASS | pgTAP; integration (fingerprint CV tidak berubah, 0 baris export) |
| 3 | Snapshot immutable dan lengkap, tanpa field privat | PASS | pgTAP (10 key, item 5 key, trigger `CV_EXPORT_IMMUTABLE`, tanpa grant tulis); integration (`update`/`delete` klien ditolak) |
| 4 | Worker tidak membaca career rows | PASS | integration (edit sumber dan judul setelah request, juga edit di antara render dan complete, tidak mengubah PDF); service key tidak dapat membaca tabel CV/career; review gateway (hanya RPC) |
| 5 | Race request vs mutasi (a)–(e) tanpa `40P01` | PASS | integration 5 skenario × 3 putaran, kedua urutan teramati; pelaksana +40 putaran stres; review urutan lock jalur edit lama oleh reviewer |
| 6 | Idempotency; tanpa job ganda | PASS | pgTAP (partial unique index, `IDEMPOTENCY_KEY_REUSED`, `CV_EXPORT_IN_PROGRESS`, reuse sukses); integration (dua request paralel → satu export) |
| 7 | Durable job: claim, lease, token, CAS, `EXPORT_TIMEOUT` | PASS | pgTAP; integration (worker kehilangan lease → `stale`, objek dihapus, timeout, retry sukses) |
| 8 | Render gagal mempertahankan CV | PASS | integration (`RENDERER_UNAVAILABLE`/`RENDERER_TIMEOUT`/`EXPORT_RENDER_INVALID`, revision dan fingerprint CV tetap, tanpa objek) |
| 9 | Retry snapshot sama, maksimal tiga, kode permanen | PASS | pgTAP; integration (hash snapshot identik, `EXPORT_NOT_RETRYABLE`, `EXPORT_TOO_LONG` permanen) |
| 10 | PDF A4 searchable dengan renderer nyata | PASS | integration Chromium nyata: setiap halaman 595 × 842 ± 1 pt; teks en/id memuat nama `Siti Nurhaliza Ç. Ñuñez`, heading locale, override, dan bullet `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”`; CV panjang > 1 dan ≤ 20 halaman, awal dan akhir setiap bullet utuh; tanpa id, object key, `http`, atau `evidence`; gagal keras tanpa renderer |
| 11 | Verifikasi output di worker | PASS | unit (non-PDF, kosong, > 10 MiB, 20/21 halaman, tanpa nama, parser gagal); integration `EXPORT_TOO_LONG`. Setelah RV1 ditambah nama Han/Arab/Devanagari nyata → `succeeded` |
| 12 | Kedaluwarsa 24 jam | PASS | pgTAP; integration (unduhan `EXPORT_EXPIRED`, cleanup menghapus objek, `purged_at`, request baru membuat export baru, CV tetap) |
| 13 | Unduhan owner-authorized ≤ 5 menit | PASS | integration (`{url, expiresInSeconds: 300}`, klaim JWT ≤ 305 detik, unduhan `%PDF-` = `byte_size`, akun lain/ID acak tidak terbedakan) |
| 14 | Orphan | PASS | pgTAP; integration (objek yatim 2 jam dihapus, objek baru dibiarkan) |
| 15 | Akun deleting | PASS | pgTAP; integration (sebelum claim dan di tengah render → `ACCOUNT_DELETING`, tanpa objek; request → `UNAUTHENTICATED`) |
| 16 | Fake hanya dev/test | PASS | unit `resolvePdfRenderer`; proses worker nyata (`production` → `WORKER_UNAVAILABLE`, `test` → `explicit-test-fake`) |
| 17 | Paritas preview–export | PASS | unit (`buildExportRenderModel` `toEqual` `buildCvPreviewModel`, en/id) |
| 18 | Tanpa perubahan perilaku lama | PASS | regresi penuh Fase 7 (17 suite integration, 15 suite E2E); migration hanya file baru; tanpa UI/route; lockfile tetap; jenis parser lama tidak berubah |
| 19 | Log hygiene | PASS | integration sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>` = 0 di error/`detail`/ringkasan/log race; unit; grep `console.` = 0 |

Tambahan dari gate review: export dengan skill, certification ber-`credential_url`, dan achievement ber-skill lolos tanpa URL tercetak (N1, integration).

## Command

Hasil pelaksana (Fase 7, HEAD `525a9ee`), semuanya exit 0:

- **Gate dasar:** lint, typecheck, build, `worker:check`, `db:lint`, `db:types` (tanpa drift), migration 31/31. Unit 97 / 836, pgTAP 15 / 1290.
- **Integration:**
  - CV dan sumber: cv-export 23, cv-freshness 11, cv-builder 7, cv 10, achievements 5, projects 7, activity 6, dashboard 4.
  - Import: import-commit 11, import-review 6, import 21.
  - Gate dan lainnya: m2 8, m3 7, ai 13, ai-review 21, evidence 14, storage 1.
- **E2E:** cv-freshness 10, cv 8, achievements 4, projects 1, dashboard 1, auth 1, ui 1, activity 1, import 7, import-review 10, ai 2, ai-review 11, evidence 8, m2 1, m3 2.

Hasil reviewer:

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint`, `typecheck`, `build`, `worker:check` | 0 | bersih (HEAD `c0f5d41` dan setelah remediasi `663ec9d`) |
| `pnpm test` | 0 | 97 / 836 di `c0f5d41`; **98 / 845** setelah remediasi |
| `pnpm db:test` | 0 | 15 file / 1290 assertion |
| `pnpm db:lint` / `gen types` vs `database.types.ts` | 0 | `results: []` / identik |
| `supabase migration list --local` | 0 | 31/31 |
| `git diff --check 5ebf1b2..HEAD` | 0 | bersih |
| `test:integration:cv-export` | 0 | 23 di `c0f5d41`; **27** setelah remediasi (+3 nama non-Latin dengan Chromium nyata, +1 N1) |
| `test:integration:` cv-freshness, cv-builder, cv, achievements, projects, import, import-commit, m3 | 0 | 11, 7, 10, 5, 7, 21, 11, 7 |
| `test:e2e:` m2, m3, cv, cv-freshness | 0 | 1, 2, 8, 10 |
| Probe nama (22 nama, Chromium nyata) dan probe skill/certification | 0 | lihat rencana remediasi §2 dan §4 |

Lingkungan: Supabase lokal (Docker Desktop), ClamAV `workpulse-t10-clamav`, Gotenberg T15 `workpulse-t15-gotenberg`, renderer T21 `workpulse-t21-pdf`. Flag container diverifikasi dengan `docker inspect`. `supabase_vector` dalam restart-loop dan tidak dipakai suite apa pun.

## Flaky, tidak dijalankan, batas

- **Flaky:** tidak ada pada run pelaksana maupun reviewer. Flaky bawaan `activity-ui.spec.ts:356` tidak muncul.
- **Tidak dijalankan:**
  - `test:e2e` gabungan.
  - `test:ai:live`, karena T21 tidak memakai AI.
  - Stres race berskala.
  - Pengukuran p95 render (T24).
  - QA PDF visual seperti heading yatim, clipping, dan inspeksi gambar halaman (T22, `tests/pdf/`).
  - Staging/production.
  - Reviewer tidak mengulang integration activity, dashboard, import-review, m2, ai, ai-review, evidence, storage, maupun E2E di luar m2/m3/cv/cv-freshness. T21 tidak menyentuh domain itu; untuk suite tersebut berlaku hasil pelaksana Fase 7.
- **Follow-up P3:** N2–N8, dicatat di decision 0027 bagian *Hal yang diterima dari gate review*.
- **Batas:** semua bukti lokal. Fallback heading pada cek nama membuktikan PDF berlapis teks, tetapi tidak membuktikan bahwa nama Han atau Devanagari dapat dicari dengan benar (N4). UI S14 milik T22. Objek export saat penghapusan akun milik T23.

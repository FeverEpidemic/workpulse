# T21 Fase 0 — Baseline dan probe renderer

- Tanggal: 6 Oktober 2026
- Status: **PASSED** (tanpa edit kode; tidak ada stop condition §8 yang terpenuhi)
- Branch/HEAD: `claude/clever-archimedes-gbu7qd` @ `e3effde` (memuat `d8ac9ff` dan `e3effde`)

## Tujuan

Mencatat baseline lokal, memverifikasi source yang akan disentuh T21, dan membuktikan bahwa renderer Chromium
terisolasi, font Noto Sans, serta parser thread memenuhi kontrak plan sebelum Fase 1.

## Persetujuan keputusan produk

Pengguna menyetujui kelima keputusan §2.4 pada 6 Oktober 2026 sesuai rekomendasi: (1) renderer Chromium Gotenberg
terpisah `workpulse-t21-pdf`, (2) font Noto Sans, (3) satu export aktif per CV, (4) retry eksplisit maksimal tiga
attempt, (5) batas 20 halaman/10 MiB. Tidak ada penyimpangan dari kelimanya sampai akhir fase ini.

## File berubah

- `docs/verification/T21-pdf-renderer-runbook.md` (baru, draft)
- `docs/verification/T21-phase0-baseline.md` (baru, receipt ini)

Tidak ada kode, migration, atau dependency yang berubah.

## Command dan hasil

| Command | Exit | Hasil aktual |
| --- | --- | --- |
| `git status --short --branch` | 0 | `## claude/clever-archimedes-gbu7qd...origin/claude/clever-archimedes-gbu7qd [ahead 2]`, hanya `?? .claude/` |
| `pnpm install --frozen-lockfile` | 0 | `Already up to date` |
| `pnpm db:start` (tanpa reset; Docker sebelumnya Exited) | 0 | database lokal naik dari backup |
| `pnpm exec supabase migration list --local` | 0 | 30 local = 30 remote (paritas 30/30), terakhir `20261004090000` |
| `pnpm lint` | 0 | tanpa warning |
| `pnpm typecheck` | 0 | tanpa error |
| `pnpm test` | 0 | **89 file / 706 test passed** |
| `pnpm db:test` | 0 | **14 file / 1115 assertion, Result: PASS** |
| `pnpm worker:check` | 0 | `status: ready`, registeredJobs: evidence-scan, evidence-cleanup, ai-detect, import-scan-parse, import-cleanup, ai-import |
| `pnpm test:integration:cv-freshness` | 0 | **11 passed** |
| `pnpm test:integration:cv` | 0 | **10 passed** |
| `select count(*) from public.cv_exports` | 0 | `0` (tidak ada baris yang dapat melanggar constraint baru); `cv_documents` = 4 |

Env suite integration dimuat per command: `.env.local`, `SERVICE_ROLE_KEY` (JWT) dari `supabase status -o env` ke env
proses saja, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`. Key tidak dicetak ke receipt. Catatan: output
`pnpm db:start` dan `pnpm db:status` mencetak key lokal-demo Supabase ke konsol sesi; itu key demo CLI lokal, bukan secret
proyek, dan tidak disalin ke file mana pun.

## Verifikasi source (file:baris)

- `cv_exports`: `supabase/migrations/20261002090000_t18_cv_schema_selection.sql:169–205` (tabel, UNIQUE
  `(user_id, idempotency_key)`, FK `(user_id, cv_id)` cascade, `attempt_count between 0 and 3`), trigger touch `:293`,
  RLS `:301`, policy select-own `:309`, revoke/grant `:313–315` (authenticated hanya SELECT). Belum ada kolom
  `page_count`/`byte_size`/`purged_at`.
- Helper T18: `internal.cv_source_snapshot` `:349`, `internal.cv_actor` `:413` (profil `for share`, deleting →
  `AUTH_REQUIRED`), `internal.cv_lock` `:435` (dokumen `for update` + cek revision dalam satu fungsi — request export
  perlu memisahkan lock dan cek revision, lihat catatan), `internal.cv_lock_source` `:461` (`for share`).
- T20: `internal.cv_item_state` `20261004090000_t20_cv_freshness_deletion.sql:62`, `internal.cv_profile_state` `:120`,
  `internal.cv_lock_for_source_change` `:157`. Prioritas state `deleted > unconfirmed > fresh > kept > changed`.
- Cek onboarding `save_cv_edits`: `20261003090000_t19_cv_builder_overrides.sql:103` (`ONBOARDING_REQUIRED`, errcode
  `22023`).
- Urutan lock jalur mutasi sumber (stop condition §8): `save_achievement`
  (`20260922110000_t09_achievement_null_patch.sql:59–62, 160–173`) mengunci achievement `for update`, lalu skill
  `for update` (urut nama ternormalisasi); tidak menyebut `cv_documents`. `update_profile` →
  `internal.lock_profile_revision` (`20260916120000_secure_foundation_mutations.sql:21–57`) mengunci profil `for update`;
  tidak menyebut `cv_documents`. `grep cv_documents` pada seluruh migration non-T18 hanya menemukan T19 dan T20.
  **Tidak ada jalur yang menunggu `cv_documents` setelah mengunci sumber/profil.** Urutan kanonik request
  (experience → project → achievement → education → skill → certification) konsisten dengan `save_achievement`
  (achievement sebelum skill): request tidak pernah memegang skill sambil menunggu achievement yang dipegang
  `save_achievement`, karena achievement yang terpilih dikunci lebih dulu.
- Pola job T13 `20260928090000_t13_ai_jobs_consent.sql:442–691` (expire/claim/input/complete/fail; lock profil → target →
  job; CAS token + lease). Storage jobs T05 `20260917090000_t05_private_storage_foundation.sql:56–180`,
  `complete_storage_job` `:231`, `fail_storage_job` `:263`, `retry_storage_job` `:299`; `enqueue_storage_delete`
  `:146` menerima kategori `export`. `last_error_code` pada `internal.storage_jobs`:
  `20260925100000_t10_evidence_backend.sql:241–245`. Cleanup/reconcile import T15
  `20260930090000_t15_import_staging.sql:1503–1646` (disalin pola untuk kategori `export`).
- TypeScript: `src/domain/cv/preview.ts:74` (`buildCvPreviewModel`), `outline.ts:35`, `resolve.ts`, `contracts.ts`
  (`CV_ERROR_CODES :25`, `cvProfileSnapshotSchema :131`, `cvSourceSnapshotSchema :52`), `src/features/cv/cv-errors.ts:58`
  (`mapCvDatabaseError`), `actions.ts:43` (`run()`; **selalu** `revalidatePath("/cv")` saat sukses — action unduhan
  perlu opsi tanpa revalidate), `cv-service.ts:70`. `src/server/storage/private-storage-service.ts:79`
  (`issueDownload`, TTL ≤ 300), `supabase-storage-adapter.ts:48` (`uploadObject`, `upsert:false`, 409 →
  `StorageObjectAlreadyExistsError`) memakai alias `@/` sehingga **tidak dapat diimpor worker**; gateway export memakai
  client Supabase langsung seperti `workers/supabase-import-gateway.ts:66`. `src/server/storage/constants.ts` memuat
  kategori `export`.
- Parser: `src/server/documents/{parse-in-thread,parser-thread,pdf-text}.ts`; `docx-renderer.ts:126–163`
  (`resolveDocxRenderer`, pola fail-closed), `workers/{run,bootstrap,import-worker,supabase-import-gateway}.ts`.
- Test bootstrap worker: `tests/unit/worker-bootstrap.test.ts` (daftar `JOBS` enam entri; akan menjadi delapan).

## Probe renderer (hasil lengkap di runbook)

- Container `workpulse-t21-pdf` (image digest T15 `sha256:f29984bd1e226bf1b93ba90af06000afa8b315853e99d27b9aaa41b93f15c769`, Gotenberg 8.37.0), `127.0.0.1:13401`, memori
  2 GiB, flag `--api-timeout=60s --chromium-disable-javascript=true --chromium-allow-list="^file:///tmp/.*"
  --webhook-deny-list=".*"`. `/health`: `chromium: up`.
- HTML lokal **diterima** dengan flag isolasi (HTTP 200, `%PDF-`, MediaBox 594.96 × 841.92, teks Indonesia utuh).
- Field form yang berlaku: `files` (`index.html`), `paperWidth=8.27`, `paperHeight=11.7`, `preferCssPageSize=true`,
  `printBackground=false`; margin ditentukan `@page`.
- `fc-list`: Noto Sans Regular/Bold/Italic/BoldItalic tersedia; `fc-match "Noto Sans"` dan `sans-serif` →
  `NotoSans-Regular.ttf`.
- Parser thread: PDF 20 halaman → `pdf-pages` 20 dan `pdf` ok 20; 21 halaman → `pdf-pages` 21 (worker memetakan ke
  `EXPORT_TOO_LONG`), `pdf` → `TOO_MANY_PAGES`; PDF 9,26 MiB → diterima. JavaScript tidak dijalankan; resource
  `http://` dan `file:///etc/passwd` tidak dimuat dan tidak menggagalkan konversi.

## Acceptance yang terbukti pada fase ini

Hanya prasyarat Fase 0: baseline hijau, paritas 30/30, tidak ada jalur lock yang melanggar §2.2.4, probe renderer
memenuhi kontrak (tidak ada stop condition §1–§8 yang terpenuhi). Acceptance T21 §1 belum dikerjakan.

## Temuan / warning untuk fase berikutnya

1. **Ambang teks parser.** `parseInThread("pdf")` mengembalikan `SCANNED_PDF` bila teks < 200 karakter non-blank
   (`src/server/documents/pdf-text.ts`, `IMPORT_MIN_TEXT_CHARS`). Verifikasi worker §2.2.16 (teks memuat nama efektif)
   tidak boleh menolak CV pendek yang sah. Rencana Fase 4: tambahan **aditif** pada parser thread (jenis parse
   baru khusus verifikasi export tanpa ambang import) tanpa mengubah perilaku `pdf`/`docx`/`pdf-pages`; dicatat di
   receipt Fase 4 dan ditandai untuk gate review karena menyentuh berkas bersama T15.
2. **`internal.cv_lock` memeriksa revision di dalam fungsi.** Protokol §2.2.4 butuh lock dokumen tanpa cek revision
   (supaya lookup idempotency mendahului `STALE_REVISION`). Fase 1 memakai `select … for update` langsung dalam
   `request_cv_export`; `internal.cv_lock` T18 tidak diubah.
3. **Upload dari worker.** Adapter storage T05 memakai alias `@/` sehingga gateway export memakai klien Supabase
   langsung (`upload(..., { upsert: false })`), mengikuti gateway import.
4. `actions.ts` `run()` selalu merevalidasi `/cv`; Fase 5 menambah opsi agar action unduhan tidak merevalidasi.

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 1: tulis `supabase/tests/database/cv_export.test.sql` (harus gagal), lalu migration
`20261005090000_t21_cv_export_backend.sql`.

# WorkPulse Implementation Status

## T19 — CV builder dan overrides, acceptance lokal — 1 Oktober 2026

Status T19: **DONE** (acceptance lokal) — seluruh acceptance §1 terbukti lokal. Gate review Claude (Opus) pada HEAD `03207fb` tanpa temuan P0–P2 dan tujuh P3; F1–F7 diperbaiki reviewer di `58d1f25` atas instruksi pengguna (review ulang tidak independen penuh). Dependensi T18, T04, T08, T09, T12 **DONE**; Gate M3 PASSED. Rujukan: R09, F07 langkah 1–2, F03, S13, DB §5/§6.
[Rencana](verification/T19-implementation-plan.md), [bukti](verification/T19-cv-builder-overrides.md), [gate review](verification/T19-gate-review.md), [decision 0025](decisions/0025-t19-cv-builder-overrides.md), receipt [Fase 0](verification/T19-phase0-baseline.md)–[5](verification/T19-phase5-integration-browser-regression.md).

Yang selesai:

- RPC `save_cv_edits` (judul, summary, `profile_snapshot.display_overrides`, `override_text` per item) dalam satu transaksi dan satu kenaikan revision; no-op tanpa write; `CV_OVERRIDE_UNSUPPORTED` untuk skill/certification; snapshot sumber dan record canonical tidak pernah ditulis.
- Domain `src/domain/cv/{labels,resolve,preview,draft}.ts`: label/tanggal locale CV (UTC, tanpa placeholder), nilai efektif override, `buildCvPreviewModel` (basis T21/T22), draft/rekonsiliasi konflik/move.
- Service `saveEdits`, `saveCvEditsAction`, correlation ID tunggal per action (menutup T18 F2).
- UI S13 `/cv`: selection pool per section, parent otomatis, move aksesibel, locale CV, editor profil/summary/wording, Save eksplisit, panel konflik *Keep mine*/*Use saved*, dialog hapus parent, preview hanya dari data tersimpan, state loading/empty/error/unsaved/manual/deleted; tautan *Add to CV* dari detail achievement confirmed.
- Perbaikan P3 gate: whitespace (F1), revoke grant helper internal (F2), aturan state editor sebagai modul murni teruji `cv-builder-state.ts` (F3), keterangan "On the CV under …" di pool achievements (F4), correlation ID untuk error klien (F5), notice wording yang dibuang karena item dihapus di sesi lain (F6), verifikasi apply migration dari nol (F7).

File berubah: 2 migration, `cv_builder.test.sql`, `database.types.ts`, `src/domain/cv/{contracts,labels,resolve,preview,draft}.ts`, `src/features/cv/{cv-service,cv-errors,actions,cv-view,cv-builder-state,cv-builder,cv-section,cv-panels,cv-preview}.ts(x)`, `src/app/(workspace)/cv/{page,loading}.tsx`, `src/features/achievement/achievement-detail.tsx`, `src/app/globals.css`, `src/i18n/messages.ts`, 6 test unit baru (`cv-labels`, `cv-resolve`, `cv-preview`, `cv-draft`, `cv-builder-ui`, `cv-builder-state`) + `cv-fixtures.ts`, 3 diperluas (`cv-contracts`, `cv-service`, `cv-actions`), `tests/integration/cv-builder.test.ts`, `tests/e2e/cv-builder.spec.ts`, `playwright.cv.config.ts`, `package.json` (2 script), screenshot dan dokumen.

Migration dan keputusan: `20261003090000_t19_cv_builder_overrides.sql`, `20261003100000_t19_cv_override_helper_grants.sql` (forward-only, tanpa reset, parity 29/29); decision 0025 (override terbatas, CV kosong tanpa auto-selection, override profil di `display_overrides`, preview dari saved — disetujui pengguna 30 September 2026; `display_name` 80 mengikuti profil).

Checks (hasil aktual): gate `03207fb` — lint, typecheck, build, `worker:check`, `db:lint` exit 0; `git diff --check` exit 2 (F1); unit 86/626; pgTAP 13/978; integration cv-builder 7, cv 10, achievements 5, projects 7, activity 6, dashboard 4, import-commit 11, import-review 6, import 21, m2 8, m3 7, ai 13, ai-review 21, evidence 14, storage 1; E2E cv 7, achievements 4, projects 1, dashboard 1, auth 1, ui 1, activity 1, import 7, import-review 10, ai 2, ai-review 11, evidence 8, m2 1, m3 2. Setelah `58d1f25` — lint, typecheck, build, `git diff --check`, `db:lint`, `db:types` exit 0; unit 87/635; pgTAP 13/979; migration 29/29; `supabase db diff --local` tanpa perubahan; integration cv-builder 7, cv 10; E2E cv 8, achievements 4, m2 1, m3 2.

Belum dijalankan: `test:e2e` gabungan, `test:ai:live`, stres race berskala; setelah `58d1f25` suite di luar CV/achievements/M2/M3 tidak diulang (perubahan terbatas pada S13, domain draft, i18n, grant helper).

Risiko/batas: test komponen tanpa DOM (interaksi via E2E); flaky bawaan `activity-ui.spec.ts:356` pada run pertama pelaksana; race dua session satu proses Node. Bukan bukti production.

Berikutnya: **T20 CV freshness dan deletion** (state changed/unconfirmed, Keep/Refresh/Replace, invalidasi revision CV saat sumber berubah, profile freshness), lalu T21/T22 export.

## T18 — CV schema dan selection, acceptance lokal — 30 September 2026

Status T18: **DONE** (acceptance lokal) — seluruh acceptance §1 terbukti lokal. Gate review Claude (Opus) pada HEAD `1a56484` tanpa temuan P0–P2 dan tiga P3. Dependensi T09, T03, T08, T16, T17 **DONE**; Gate M3 PASSED. Rujukan: R09, F07 langkah 1–2, F03, S13 (backend), DB §1/§5/§6.
[Rencana](verification/T18-implementation-plan.md), [bukti](verification/T18-cv-schema-selection.md), [gate review](verification/T18-gate-review.md), [decision 0024](decisions/0024-t18-cv-schema-selection.md), receipt [Fase 0](verification/T18-phase0-baseline.md)–[4](verification/T18-phase4-integration-regression.md).

Yang selesai:

- Migration `20261002090000_t18_cv_schema_selection.sql` (forward-only, tanpa reset, parity 27/27): `cv_documents` (`UNIQUE(user_id)`), `cv_items` (composite FK sumber `on delete set null`, unique per tipe, posisi deferrable), `cv_exports` (struktur saja), RLS select own tanpa grant write, `internal.cv_source_snapshot`, dan RPC `ensure_cv_document`, `select_cv_source`, `remove_cv_item`, `reorder_cv_section`, `update_cv_layout`.
- Domain `src/domain/cv/` (contracts, aturan parent, `buildCvOutline`), service `cv-service.ts`, pemetaan error, dan server action (belum dirender; `/cv` tetap `WorkspaceUnavailable` sampai T19).
- Confirm achievement tidak memasukkannya ke CV; hapus sumber lama tetap berhasil dan item menjadi `source_deleted` dengan snapshot utuh.

File berubah: 1 migration, `cv_selection.test.sql`, `database.types.ts`, `src/domain/cv/{contracts,selection,outline}.ts`, `src/features/cv/{cv-service,cv-errors,actions}.ts`, `src/i18n/messages.ts`, 5 test unit, `tests/integration/cv-selection.test.ts`, `package.json` (script `test:integration:cv`), dokumen.

Migration dan keputusan: satu migration; decision 0024 (parent wajib, duplikat = error, safety net hapus sumber, `cv_exports` struktur saja disetujui pengguna).

Checks (hasil aktual): lint, typecheck, build, `worker:check`, `db:lint`, `git diff --check` exit 0; unit 81 file / 575; pgTAP 12 file / 909; integration cv 10, achievements 5, projects 7, activity 6, dashboard 4, import-commit 11, import-review 6, import 21, m2 8, m3 7, ai 13, ai-review 21, evidence 14, storage 1; E2E achievements 4, projects 1, dashboard 1, auth 1, ui 1, activity 1, import 7, import-review 10, ai 2, ai-review 11, evidence 8, m2 1, m3 2. Reviewer mengulang lint, typecheck, unit, build, `worker:check`, pgTAP, `db:lint`, integration cv/achievements/projects/import-commit/m2/m3, dan E2E m2/m3/achievements/activity dengan hasil sama.

Belum dijalankan: `test:e2e` gabungan, `test:ai:live`; suite lain di luar daftar ulang reviewer hanya bersandar pada receipt pelaksana.

Risiko/batas: `test:e2e:activity` gagal sekali pada run pertama pelaksana (lulus saat diulang, penyebab tidak terkonfirmasi). Race diuji dua session tanpa stres berskala. Bukan bukti production. P3: F1 flaky, F2 correlation ID di `actions.ts` (T19), F3 race tidak deterministik.

Berikutnya: **T19 CV builder dan overrides** (UI S13, override wording, tombol *Add to CV*); freshness di T20, export di T21/T22.

## Gate M3 — Assisted entry, integration review — 30 September 2026

Status Gate M3: **PASSED** (acceptance lokal). Verdict awal pada HEAD `42bab36` adalah BELUM LULUS karena satu P2 (RV1). RV1 diperbaiki di `1da020a` atas persetujuan pengguna, lalu checks remediasi diulang dan semuanya exit 0 (unit 76/501, `test:integration:m3` 7/7, `test:e2e:import` 7/7, `test:e2e:m3` 2/2, lint, typecheck, build, `git diff --check`). Reviewer: Claude (Opus); review ulang tidak sepenuhnya independen. Kalimat gate: F01 import dan F02 assisted bersama malformed file, retry, consent withdrawal, AI unavailable, stale result. Dependensi T13–T17 **DONE**.
[Laporan gate](verification/M3-gate-review.md), [rencana remediasi](verification/M3-review-remediation-plan.md).

Yang dikerjakan: test lintas alur `tests/integration/m3-assisted-entry.test.ts` (7/7, script `test:integration:m3`) dan journey browser `tests/e2e/m3-assisted-journey.spec.ts` (2/2, script `test:e2e:m3`, `playwright.m3.config.ts` port 3011). Tanpa perubahan kode produk, tanpa migration.

Hasil: 9 dari 10 kriteria PASS. Regresi penuh exit 0: lint, typecheck, unit 76/500, pgTAP 11/779, `db:lint`, `worker:check`, build, semua integration (m3 7, import 21, import-commit 11, import-review 6, ai 13, ai-review 21, activity 6, achievements 5, projects 7, dashboard 4, m2 8, storage 1, evidence 14), E2E m3 2, import 7, import-review 10, ai 2, ai-review 11, m2 1, auth 1, ui 1, activity 1, projects 1, achievements 4, dashboard 1. Pengecualian: `test:e2e:evidence` 7/8 dua kali, karena flaky bawaan `activity-ui.spec.ts:356` (N4, race hydration di test).

Temuan: **RV1 (P2, fixed `1da020a`)**. Untuk batch `CONSENT_WITHDRAWN`, S02 dulu menulis "teks tidak dikirim", padahal teks sudah diterima provider. Sekarang tampil copy en/id tersendiri (`import.failed.CONSENT_WITHDRAWN`). File berubah: `src/features/import/import-start.tsx`, `src/i18n/messages.ts`, `tests/unit/import-start-ui.test.tsx`. P3: N1 (ai-worker skip tanpa fail, tidak terjangkau), N2 (copy S06 generik), N3 (stdout `drainAiWorker`), N4 (flaky).

Belum dijalankan: smoke live `refine`/`extractImport`, stres race commit, staging/production. Bukti lokal saja.

Berikutnya: **T18 CV schema dan selection** (milestone M4). Follow-up P3 N1–N4 tidak memblokir. [Handoff T18 single-agent](verification/T18-implementation-plan.md) untuk Claude Sonnet 5.5 tersedia (30 September 2026); T18 tetap **TODO**, hanya dokumen rencana yang ditambahkan.

## T17 — Import review UI dan onboarding lengkap, acceptance lokal — 30 September 2026

Status T17: **DONE** (acceptance lokal) — seluruh acceptance §1 terbukti lokal. Gate review Claude (HEAD `58e0183`) menemukan 1 P2 (RV1: token commit menyerap revision dari tab lain) dan 9 P3; RV1, N1 dan N7 diperbaiki di `2c81c02` oleh reviewer atas instruksi pengguna, lalu review ulang tanpa P0–P2 (tidak independen penuh; ditopang test yang terbukti gagal tanpa perbaikan). Dependensi T16, T15, T04, T03, T12 **DONE**; Gate M2 PASSED. Rujukan: R02, F01, S02, S03, S04, S12, DB §4 (lewat RPC T16).
[Rencana](verification/T17-implementation-plan.md), [bukti](verification/T17-import-review-ui.md), [gate review dan remediasi](verification/T17-review-remediation-plan.md), [decision 0023](decisions/0023-t17-import-review-ui.md), receipt [Fase 0](verification/T17-phase0-baseline.md)–[5](verification/T17-phase5-browser-regression.md), [5b](verification/T17-phase5b-remediation.md).

Yang selesai:

- S03 `/imports/[id]/review` di luar workspace frame (provisional diizinkan; anonim → sign-in dengan return aman; id asing/tidak ada = not-found generik), loader session-client `import-review-view-service.ts`, route `GET /api/imports/[id]/review`, `validateImportAction`.
- View model murni `review-view.ts` (grup, field wajib, duplikat, ringkasan, blocker) dan `review-edit.ts` (draft/patch, `RevisionTracker` untuk token commit).
- UI: Create/Map/Skip tersimpan langsung dengan status persistensi, edit field lewat *Save changes*, konflik mempertahankan input lokal, confirm achievement per kandidat, onboarding (nama/locale/timezone) dalam commit, hasil dari `commit_result`, cancel, jalur manual.
- Entry point: S02 *Review candidates* dan copy *Import saved*, S02 terbuka untuk pengguna lama, dashboard kosong dan S12 *Import CV* aktif.

File berubah: `src/app/imports/[id]/review/{page,loading}.tsx`, `src/app/api/imports/[id]/review/route.ts`, `src/app/onboarding/import/page.tsx`, `src/app/globals.css`, `src/domain/import/{review-view,review-edit,commit-contracts}.ts`, `src/domain/routes/safe-return.ts`, `src/proxy.ts`, `src/features/import/{import-review,import-review-candidate,import-review-view-service,actions,http,import-start}.ts(x)`, `src/features/dashboard/dashboard-view.tsx`, `src/features/profile/profile-workspace.tsx`, `src/i18n/messages.ts`, 7 test unit baru + 2 diubah, `tests/integration/import-review-ui.test.ts`, `tests/e2e/import-review.spec.ts`, `playwright.import-review.config.ts`, helper E2E `import_partial`, 3 assertion E2E lama (disengaja), `package.json` (2 script), dokumen.

Migration dan keputusan: tanpa migration (parity 26/26). Decision 0023.

Checks (hasil aktual, lihat bukti): gate HEAD `58e0183` — lint, typecheck, build, `worker:check`, `db:lint` exit 0; unit 76/495; pgTAP 11/779; integration import-review 6, import-commit 11, import 21, achievements 5, dashboard 4, activity 6, projects 7, m2 8, ai 13, ai-review 21, evidence 14, storage 1; E2E import-review 9, import 7, dashboard 1, m2 1, auth 1, ui 1, achievements 4, ai 2, activity 1, projects 1, ai-review 11, evidence 8 (rerun; run pertama 7/8 flaky `activity-ui.spec.ts:356`). Setelah remediasi HEAD `2c81c02` — lint, typecheck, build, `worker:check` exit 0; unit 76/500; integration import-review 6, import-commit 11; E2E import-review `--repeat-each 2` 20/20, import 7, m2 1, dashboard 1; `git diff --check d4bd39f..HEAD` exit 0.

Belum dijalankan: smoke live `extractImport`, uji stres race commit, `db:test` dan regresi penuh setelah remediasi (perubahan hanya komponen S03, helper domain, copy).

Terbuka (P3): admin client tak terpakai di route GET review (N4); label error `metrics`/`experience_item_id` (N5); `ONBOARDING_INVALID` hanya notice umum (N6); nilai profil kosong dikirim `""` (N8); flaky `activity-ui.spec.ts:356` (N9); purge batch `review` yang ditinggalkan (T23); CV freshness perubahan profil lewat import (T20).

Batas: bukti lokal dengan fake AI provider, ClamAV dan Gotenberg nyata; tidak ada deployment.

Berikutnya: **Gate M3 (Assisted entry)** — integration review F01 import dan F02 assisted (malformed file, retry, consent withdrawal, AI unavailable, stale result) dalam sesi terpisah; setelah itu T18.

## T16 — Import commit transaction, acceptance lokal — 30 September 2026

Status T16: **DONE** (acceptance lokal) — seluruh acceptance §1 terbukti lokal; gate review Claude (HEAD `6a8dd06`) tanpa temuan P0–P2 (review dilakukan oleh sesi yang sama dengan pelaksana, tidak independen). Dependensi T15, T09, T02/T03, T12 **DONE**; Gate M2 PASSED. Rujukan: R02, F01, S03 (backend), S08, DB §1–§4/§6.
[Rencana](verification/T16-implementation-plan.md), [bukti](verification/T16-import-commit.md), [gate review](verification/T16-gate-review.md), [decision 0022](decisions/0022-t16-import-commit.md), receipt [Fase 0](verification/T16-phase0-baseline.md)–[4](verification/T16-phase4-provenance-regression.md).

Yang selesai:

- Migration `20261001090000_t16_import_commit.sql` (forward-only, tanpa reset, parity 26/26): `import_items.confirm_requested`, `import_batches.commit_result`, trigger target type-aware, guard item setelah commit, relaksasi `achievements_source_pair_check` untuk `origin = 'import'`, `internal.import_item_errors`, dan RPC `update_import_item`, `validate_import_batch`, `commit_import_batch` (authenticated saja, security definer).
- Commit atomik dan idempotent: lock profile → batch → item → target map; foundation dulu lalu achievement (draft, atau confirmed hanya bila `confirm_requested` dan field wajib lengkap); profil hanya field terpilih; onboarding lewat `p_onboarding`; map tidak mengubah target; excerpt achievement bertahan setelah purge.
- Server: `commit-contracts.ts`, `import-review-service.ts`, kode error baru, `updateImportItemAction`/`commitImportAction` (belum dirender; UI S03 = T17). S08 menampilkan "Imported from CV" untuk achievement import.

File berubah: 1 migration, `import_commit.test.sql` (baru), `import_staging.test.sql` (fixture), `database.types.ts`, `src/domain/import/commit-contracts.ts`, `src/features/import/{import-review-service,import-errors,actions}.ts`, `src/features/achievement/{achievement-source-card,achievement-detail}.tsx`, `src/i18n/messages.ts`, 4 test unit, `tests/integration/import-commit.test.ts`, `package.json` (script `test:integration:import-commit`), dokumen.

Checks (hasil aktual): lint, typecheck, build, `worker:check`, `db:lint`, `git diff --check` exit 0; unit 70 file / 449; pgTAP 11 file / 779; integration import-commit 11, import 21, achievements 5, dashboard 4, activity 6, projects 7, m2 8, ai 13, ai-review 21, evidence 14, storage 1; E2E achievements 4, import 7, m2 1, dashboard 1, auth 1, ui 1, activity 1, projects 1, ai 2, ai-review 11, evidence 8. Gate review mengulang sebagian (lint, typecheck, test, db:test, db:lint, worker:check, integration import-commit/import/achievements) dengan angka sama.

Perubahan test lama (bukan pelemahan): fixture "committed purge" di `import_staging.test.sql` kini menulis `committed_id` lewat flag commit dengan skill nyata (lalu dihapus); assertion tidak berubah.

Belum terbukti atau terbuka:

- Race commit hanya satu putaran per skenario (hasil serial sah, tanpa deadlock); tidak ada uji stres.
- P3: assertion pgTAP profile `skip` dan `validate` akun deleting; unique-race skill menghasilkan `IMPORT_ITEM_INVALID` dengan daftar kosong (UI T17 harus menangani); batch `review` yang ditinggalkan belum dipurge (T17/T23); CV freshness untuk perubahan profil via commit (T20).
- Smoke live `extractImport` dan `refine` serta suite scanner ClamAV penuh masih belum dijalankan.

Batas: bukti lokal dengan fake AI provider, ClamAV dan Gotenberg nyata; tidak ada deployment.

Berikutnya: **T17 Import review UI dan onboarding lengkap**.

## T15 — Import upload dan extraction staging — 29 September 2026

Status T15: **DONE** (acceptance lokal) — seluruh acceptance §1 terbukti lokal; gate review Claude (29 September 2026, HEAD `5399fba`) tanpa temuan P0–P2 setelah verifikasi ulang independen. Pelaksana dan reviewer sama-sama Claude atas permintaan pengguna. Dependensi T13 (dan T05/T10/T14) **DONE**. Rujukan: R02, F01, S02, DB §1/§3/§4/§6.
[Rencana](verification/T15-implementation-plan.md), [bukti dan tinjauan gate](verification/T15-import-staging.md), [decision 0021](decisions/0021-t15-import-staging.md), [runbook renderer](verification/T15-renderer-runbook.md), receipt [Fase 0](verification/T15-phase0-baseline.md)–[6](verification/T15-phase6-browser-regression.md).

Yang selesai:

- Migration `20260930090000_t15_import_staging.sql` (forward-only, tanpa reset, parity 25/25): `import_batches`, `import_items`, `internal.import_jobs`; `ai_jobs` kind `import` + `import_batch_id` (tepat satu target); RPC begin/finalize/cancel/retry, scan+parse queue, input/completion AI import, purge, cleanup berprefix `import`, orphan. Fungsi T13/T14 yang mengunci activity kini mengunci target job (activity atau batch).
- Upload S02 satu request: validasi signature/MIME/ukuran, object privat, idempotensi per key, peringatan hash duplikat. Consent wajib sebelum upload.
- Worker: ClamAV sebelum parsing; parser PDF (`pdfjs-dist` 6.3.289, tanpa binary native) dan DOCX di `worker_threads` terisolasi; halaman DOCX dari renderer Gotenberg/LibreOffice terisolasi; kandidat AI dibumikan ke teks (excerpt, fakta, angka, presisi tanggal) sebelum staging; achievement selalu draft; tidak ada write canonical.
- Cancel, leave-return, retry pada batch yang sama, purge terminal (24 jam; retriable 23 jam), UI S02 en/id aksesibel.

Checks (hasil aktual, HEAD `7864b69` + penyesuaian assertion M2): lint, typecheck, build exit 0; unit 66 file / 424 test; pgTAP 10 file / 668; integration import 21, ai 13, ai-review 21, activity 6, achievements 5, projects 7, dashboard 4, m2 8, evidence 14, storage 1; E2E import 7, ai-review 11, ai 2, auth 1, ui 1, activity 1, projects 1, achievements 4, dashboard 1, m2 1, evidence 8; `worker:check`, `worker:once` exit 0.

Verifikasi ulang gate review (HEAD `5399fba`, env AI harness dibersihkan): lint, typecheck, build, `worker:check`, `db:lint`, `git diff --check` exit 0; unit 66 / 424; pgTAP 10 / 668 PASS; integration import 21, ai 13, ai-review 21, evidence 14, m2 8; E2E import 7, ai-review 11, ai 2, m2 1, evidence 8 (run pertama 7/8: `activity-ui.spec.ts` T06 gagal sekali, lulus 8/8 saat diulang tanpa perubahan — flaky, bukan regresi T15).

Perubahan test lama (bukan pelemahan): `tests/e2e/m2-manual-journey.spec.ts:170` mengasersi placeholder S02 lama → kini tombol upload nonaktif sebelum ada file; contoh "kind tak dikenal" di `tests/unit/ai-worker.test.ts` diganti dari `import` ke `summarize`; `registeredJobs` worker bertambah tiga handler.

Belum terbukti atau terbuka:

- Smoke live `extractImport` ke provider nyata belum dijalankan (butuh persetujuan pengguna).
- Keputusan produk: import memakai versi consent yang sama (`ai-processing-v1`) dengan copy dialog khusus import; perlu dikonfirmasi apakah cukup.
- Batch `review` yang ditinggalkan tidak dipurge (bukan state terminal) — T17/T23.
- P3: klien dapat membuat batch `uploading` miliknya sendiri tanpa upload (kedaluwarsa 15 menit); `GET /api/imports` belum dipakai client; worker tidak memperpanjang lease sehingga scan + parse (30 s) + render DOCX (60 s) + hitung halaman (30 s) terburuk dapat melewati lease 120 s (attempt menjadi stale lalu diulang, maksimal 5, kemudian gagal retriable `IMPORT_WORKER_TIMEOUT`; tidak ada write ganda karena CAS); `activity-ui` E2E sekali flaky.
- Docker lokal sempat berhenti di tengah sesi; stack dinyalakan ulang tanpa reset. Renderer dan scanner staging belum diverifikasi.

Batas: bukti lokal dengan fake AI provider dan (untuk E2E/integration utama) fake renderer; renderer dan ClamAV nyata dibuktikan terpisah; tidak ada deployment.

Berikutnya: **T16 Import commit transaction**. [Handoff T16 single-agent](verification/T16-implementation-plan.md) untuk Claude Sonnet 5.5 tersedia (29 September 2026); T16 tetap **TODO**, hanya dokumen rencana yang ditambahkan.

## T14 — Detection, refinement dan review — 29 September 2026

Status authoritative T14: **DONE** (acceptance lokal), ditetapkan oleh pengguna setelah gate review Claude dan perbaikan satu temuan P2. Dependensi T06/T09/T13 tetap **DONE**, Gate M2 **PASSED**. Rujukan: R04, R05, F02, F03, S05, S06, S08, DB §3/§6.
[Rencana](verification/T14-implementation-plan.md), [bukti dan gate review](verification/T14-detection-review.md), [decision 0020](decisions/0020-t14-detection-review.md), receipt [Fase 0](verification/T14-phase0-baseline.md)–[5](verification/T14-phase5-browser-regression.md).

Yang selesai:

- Analisis diminta eksplisit dari S06 (Save di S05 tidak meng-enqueue). Satu job AI per revisi activity, lintas kind `detect`/`refine`, ditegakkan unique index; request ganda mengembalikan job yang sama.
- Maksimal tiga pertanyaan follow-up ditegakkan constraint tabel. Jawaban membuat revisi input baru, menambah pasangan chat bila capture chat, dan meng-enqueue `refine` bila consent masih berlaku. Skip dan dismiss tidak butuh consent dan idempoten.
- Tabel `ai_suggestion_reviews` dan RPC `answer_ai_questions`, `skip_ai_questions`, `dismiss_ai_suggestion`, `apply_ai_suggestion`. Apply hanya membuat atau menyegarkan **draft**; tidak ada auto-confirm, dan draft yang sudah diedit, Achievement confirmed/dismissed, saran stale, atau consent hilang ditolak.
- Grounding diperluas (angka dan metric harus ada di input); saran tersimpan yang gagal validasi tidak dapat di-apply.
- UI: panel analisis S06 (status jujur: queued, running, failed, stale, no potential, suggestion, suppressed, applied) dan aside saran read-only di S08. Status dibaca lewat `GET /api/ai/activities/[id]/analysis` (owner session, `no-store`).
- Perbaikan gate review (P2): `answer_ai_questions` semula mengunci job → review → activity, kebalikan `apply_ai_suggestion`, sehingga bisa deadlock (`40P01`). Migration `20260929100000_t14_answer_lock_order.sql` menyeragamkan urutan lock; test race `11d` menjaga regresi.

Migration forward-only `20260929090000_t14_ai_review.sql` dan `20260929100000_t14_answer_lock_order.sql` diterapkan tanpa reset (parity 24/24). Kontrak T13 berubah: `request_ai_analysis`/`retry_ai_job` mengembalikan `kind`, `complete_ai_job` memvalidasi pertanyaan (rinci di decision 0020).

Checks (hasil aktual):

- Setelah perbaikan P2: integration `ai-review` 21/21, `ai` 13, `activity` 6, `achievements` 5; E2E `ai-review` 11/11; pgTAP 9 file / 540 assertion; `db:lint`, `lint`, `typecheck` bersih.
- Dari Fase 5 (commit `6bc054d`, sebelum migration perbaikan): unit 57 file / 357 test, `build`, `worker:check`, integration projects/dashboard/m2, E2E ai/auth/ui/activity/projects/achievements/dashboard, `ai-review --repeat-each 2` 22/22.

Belum terbukti atau terbuka (tidak menghalangi DONE lokal, atas keputusan pengguna):

- ~~`test:e2e:m2` dan `test:e2e:evidence` gagal karena scanner ClamAV tidak berjalan.~~ Terselesaikan 29 September 2026 (tanpa perubahan kode): container ClamAV 1.5.4 (image pinned runbook T10, signature 28129) dijalankan di `127.0.0.1:13310`, env Supabase lokal dimuat ke proses. Hasil pada HEAD `507aaa5`: `test:integration:evidence` 14/14 (termasuk EICAR dan pipeline Storage→ClamAV→cleanup), `test:e2e:evidence` 8/8, `test:e2e:m2` 1/1. Kegagalan sebelumnya murni environment, bukan regresi T14.
- Smoke live `refine` pada provider nyata belum dijalankan (butuh persetujuan pengguna); perilaku model nyata terhadap `refine.prompt.v1` belum terbukti.
- Unit/build tidak dijalankan ulang penuh setelah migration perbaikan (hanya satu fungsi SQL yang berubah, tanpa kode TypeScript). Test `11d` tidak dibuktikan gagal terhadap urutan lock lama.
- Definisi `retry_ai_job` dari Fase 3 diterapkan ke DB lokal via psql; verifikasi dari database kosong sebelum environment bersama.
- P3: log hygiene diuji pada return value, bukan stdout/stderr worker atau log server Next; `mapAiErrorCode` memetakan kode tak dikenal ke `CONFLICT`; jawaban dikirim tanpa `trim()`. Dialog consent: Enter tepat setelah Escape butuh jeda ~300 ms (akar penyebab tidak dibuktikan). `supabase_vector` restart terus di lokal.

Batas: pelaksana sekaligus reviewer adalah Claude; bukti hanya dari stack lokal dengan fake provider (tanpa panggilan provider nyata untuk T14); tidak ada deployment.

Berikutnya: **T15 Import staging**.

## T13 — Durable AI jobs dan consent, acceptance lokal dan smoke live — 27 September 2026

Status authoritative T13: **DONE**. Dasarnya acceptance lokal dan smoke live pada endpoint OpenAI-compatible yang dipilih pengguna. Dependensi T05/T06 tetap **DONE**, dan Gate M2 **PASSED**. Rujukan: R05, PRD §3/§4, F02, S12, serta DB §2/§3/§6.
[Rencana](verification/T13-implementation-plan.md), [bukti dan gate review](verification/T13-ai-jobs-consent.md), [decision 0019](decisions/0019-t13-ai-jobs-consent.md), receipt [Fase 0](verification/T13-phase0-baseline.md)–[6](verification/T13-phase6-live-smoke.md).

Yang selesai:

- `public.ai_jobs` hanya bisa ditulis lewat RPC. Klaim job memakai lease 120 detik, attempt token, dan maksimal 3 attempt tanpa retry otomatis. Lease yang kedaluwarsa menjadi `AI_TIMEOUT`. Key idempotency diturunkan per revisi activity.
- Consent disimpan dengan versi dan timestamp (`ai-processing-v1`). Consent diperiksa sebelum enqueue, sebelum teks dirilis ke worker, dan sebelum hasil disimpan. Pengecekan revisi menghasilkan `STALE_INPUT` bila activity berubah. Akun yang sedang dihapus diblokir.
- Adapter OpenAI-compatible memakai `fetch` (default Chat Completions, json_schema strict; Responses dan JSON mode bisa dipilih lewat env). Ada juga fake yang dibatasi ke development/test.
- Skema hasil `detect.v1` divalidasi dengan grounding metric. Worker `ai-detect` hanya mencetak angka dan kode.
- Kartu consent S12 memakai `AiConsentDialog` bersama, dengan copy generik "penyedia AI eksternal" dalam en/id. Hasil AI **tidak** diterapkan ke Achievement; itu tugas T14.

Migration forward-only `20260928090000_t13_ai_jobs_consent.sql` diterapkan tanpa reset (parity 22/22). Types sudah diperbarui.

Checks:

- Unit 51 file / 274 test; pgTAP 8 file / 470 assertion; DB lint bersih.
- Integration: ai 13, activity 6, achievements 5, projects 7, dashboard 4, m2 8, storage 1, evidence 14 (ClamAV nyata).
- E2E: ai 2 (stabil 12/12 run), auth, ui, activity, projects, achievements 4, dashboard, evidence 8, m2 1.
- `worker:check`, build, lint, typecheck, dan diff check lulus.
- Smoke live `https://ai.sumopod.com/v1` dengan model `gpt-6-luna`: fixture sintetis en/id valid, dan satu job end-to-end melalui `node workers/run.ts --once` berakhir `succeeded`.

Temuan saat eksekusi, semuanya sudah diperbaiki:

- Worker crash karena *parameter properties* TypeScript.
- Race fokus pada dialog consent.
- Overflow email di S12 pada 360 px (bawaan T03).

Tidak ada P0–P2 yang terbuka. Follow-up P3 R1–R6 ada di laporan. Satu di antaranya perlu tindakan pengguna: tambahkan `WORKPULSE_OPENAI_BASE_URL=https://ai.sumopod.com/v1` ke `.env.ai.local`.

Batas:

- Pelaksana sekaligus reviewer adalah Claude.
- Bukti hanya dari stack lokal, ditambah satu smoke eksternal dengan data sintetis. Tidak ada deployment.
- Retensi di pemroses pihak ketiga mengikuti kebijakan pemroses tersebut, karena `store:false` hanya dikirim ke api.openai.com.

Berikutnya (saat T13 ditutup): T14 Detection, refinement dan review; sekarang **DONE** (lihat entri T14 di atas).

## Gate M2 — integration review Capture dan penggunaan manual — 27 September 2026

Verdict authoritative Gate M2: **PASSED** (acceptance lokal), ditetapkan Claude setelah verifikasi ulang
independen. T06–T12 tetap **DONE**. Rujukan: kalimat Gate M2 di `IMPLEMENTATION_PLAN.md` §5, R03–R08,
F02–F06, S04–S12. [Laporan gate](verification/M2-gate-review.md),
[handoff](verification/M2-gate-review-plan.md), receipt [Fase 0](verification/M2-gate-phase0-baseline.md)–[5](verification/M2-gate-phase5-regression.md).

Bukti baru: `tests/e2e/m2-manual-journey.spec.ts` (`pnpm test:e2e:m2`, port 3006). Satu graduate tanpa
CV/employment menjalankan note → project → derived achievement confirm tanpa metrics/evidence → evidence
privat `ready` lewat ClamAV nyata (download byte identik, URL ≤ 300 detik) → Dashboard → Timeline → deep
link canonical, sebagian keyboard-only, tanpa AI, dengan isolasi akun B dan Axe/360 dark.
`tests/integration/m2-cross-domain.test.ts` (`pnpm test:integration:m2`) berisi 8 skenario sebelum/sesudah
(delete activity/project/experience, relink, reopen, move/delete evidence, isolasi dua akun) dan mengasersi
count Dashboard = row filter link di setiap snapshot.

Temuan: satu **P1 (F1)**, yaitu create Achievement kedua di tab yang sama ditolak `IDEMPOTENCY_KEY_REUSED`
setelah create derived. Sudah diperbaiki di `107b32c` dengan key create di-scope per sumber, plus regresi di
`achievements-ui.spec.ts`. Tidak ada P0/P2. Follow-up P3 (F1-a, G1 script `evidence-lifecycle`, G4, C1–C3,
N1–N2, dan P3 bawaan T12) tercatat di laporan §4. Juga di-commit atas persetujuan pengguna:
`845375c` (Axe menunggu animasi finite; flaky T12 tidak muncul lagi).

Checks akhir (Fase 5 dan verifikasi ulang Fase 7): lint, typecheck, unit 44/203, pgTAP 7/386, DB lint,
parity 21/21 (tanpa migration baru, tanpa reset), integration activity 6, projects 7, achievements 5,
storage 1, evidence 14 (ClamAV 1.5.4/28135), evidence-lifecycle 5, dashboard 4, m2 8; E2E auth 1, ui 1,
activity 1, projects 1, achievements 4, dashboard 1, evidence 8, m2 1; worker check, build, diff check.
`SUPABASE_SECRET_KEY` hanya di env proses. Container ClamAV dihentikan/dihapus setelah Fase 7.

Batas: hanya lokal (Supabase Docker, Storage, ClamAV, worker sekali jalan). Tidak ada deployment atau
layanan eksternal. Berikutnya: **T13 Durable AI jobs dan consent**.

[Handoff T13 single-agent](verification/T13-implementation-plan.md) untuk GPT-6 Luna sudah tersedia (27 September
2026). Keputusan pengguna: provider OpenAI (Responses API via `fetch`, `store: false`), satu smoke live dengan
fixture sintetis wajib untuk DONE, dan UI T13 terbatas pada kartu consent S12 serta dialog consent bersama.
T13 tetap **TODO**; hanya dokumen rencana yang ditambahkan, tanpa perubahan kode atau hasil test.

## T12 — Dashboard dan Timeline, acceptance lokal — 26 September 2026

Status authoritative T12: **DONE** — implementasi dan acceptance lokal selesai setelah gate review
Claude. Dependensi T07, T09, dan T11 tetap **DONE**. Rujukan R03/R08, F06 (F03 untuk missing
evidence), S04/S11 dan deep link S12, Database Schema §1/§6.
[Rencana](verification/T12-implementation-plan.md), [bukti aktual](verification/T12-dashboard-timeline.md),
[decision 0018](decisions/0018-t12-dashboard-timeline.md).

Selesai: empat fungsi baca `SECURITY INVOKER` (tanpa perubahan tabel) sebagai satu predikat untuk
count dan list; filter URL `evidence=missing`, `skill`, `outcome=missing`, Timeline `type`/`project`,
dan `record` pada S12, terdaftar di reader, safe-return, service, chip/Clear; Dashboard S04 (stat,
check, recent `occurred_on`, current projects, skill distinct confirmed, empty jujur dengan Import
CV disabled, loading, error/Retry); Timeline S11 dari record canonical (grup tahun, *Date not set*,
*Present*, precision, overlap, filter, notice truncated) dengan deep link ke editor canonical; copy
en/id dan CSS token.

Migration forward-only `20260927090000_t12_dashboard_timeline.sql` diterapkan ke database lokal aktif
tanpa reset; parity 21/21 dan generated types diperbarui. Gate review tidak menemukan P0–P2; lima P3
UI/copy diperbaiki pada review (tombol Apply sekunder, label project tanpa tanggal, opsi project
tidak tersedia, affordance link check, wrap chip skill). Checks akhir: unit 44 file/203 test, pgTAP
7 file/386 assertion, integration Dashboard 4/4, Achievement 5/5, Project 7/7, Activity 6/6, E2E
Dashboard/Timeline 1/1, UI 1/1, Auth 1/1, Activity 1/1, Achievement 3/3 (satu run awal flaky pada
test konflik T09, lihat bukti), Project 1/1, worker check, typecheck, lint, DB lint, build, dan diff
check lulus. Evidence integration/E2E tidak dijalankan karena ClamAV lokal tidak aktif; T12 tidak
mengubah kode evidence. Follow-up P3 tercatat pada bukti.

Tidak ada layanan, deployment, atau resource eksternal. Berikutnya: integration review **Gate M2**
(T06–T12) sesuai §6 rencana, lalu T13 AI jobs dan consent.
[Handoff Gate M2](verification/M2-gate-review-plan.md) sudah tersedia (26 September 2026); gate tetap
**terbuka** sampai verdict Claude tercatat.

## T11 — Evidence UI dan lifecycle, acceptance lokal — 26 September 2026

Status authoritative T11: **DONE** — implementasi dan acceptance lokal selesai. Dependensi T05,
T09, dan T10 tetap **DONE**; T12 menjadi task berikutnya dan Gate M2 tetap terbuka. Rujukan R07,
F05, S06/S08/S10, Database Schema §4/§6. [Rencana](verification/T11-implementation-plan.md) dan
[bukti aktual](verification/T11-evidence-ui-lifecycle.md).

Selesai: collection list owner-scoped untuk direct evidence, move atomik `ready` Activity → derived
Achievement yang sama, reusable attachment control pada tiga detail screen, upload/scanning/polling,
retry reservation baru, authorized download, named remove, direct evidence count pada parent delete,
id/en, keyboard/focus/ARIA, 360/1440 px light/dark, serta unit/PostgreSQL/Storage/ClamAV/browser
acceptance. Project evidence tidak diwariskan atau dihitung sebagai direct Achievement evidence.

Migration forward-only `20260926100000_t11_evidence_lifecycle.sql` diterapkan ke database lokal
aktif tanpa reset; parity 20/20 dan generated types diperbarui. Checks akhir: unit 38 file/181 test,
pgTAP 6 file/348 assertion, T11 PostgreSQL 5/5, evidence backend 7/7, real scanner/Storage 7/7,
Evidence UI 1/1, authenticated Evidence API 1/1, Activity rerun 1/1, Achievement 3/3, Project 1/1,
worker check, typecheck, lint, DB lint, production build, dan diff check lulus. Rincian kegagalan
awal, rerun, warning, serta batas acceptance tercatat pada bukti T11.

Tidak ada layanan, deployment, billing, atau resource production eksternal dibuat. Container ClamAV
lokal sementara dihentikan/dihapus setelah test; Supabase lokal aktif dipertahankan. Berikutnya:
T12 Dashboard dan Timeline, dengan `missing evidence` berarti Achievement confirmed tanpa direct
`ready` evidence; Activity/Project/pending/failed/deleting tidak dihitung.
[Handoff T12 single-agent](verification/T12-implementation-plan.md) sudah tersedia untuk GPT-6 Luna
(26 September 2026). T12 tetap **TODO**; hanya dokumen rencana yang ditambahkan, tanpa perubahan kode
atau hasil test.

Sinkronisasi checkpoint T11 ke Notion sudah dicoba setelah status lokal diperbarui, tetapi konektor
menolak external write karena detail implementasi privat memerlukan otorisasi eksplisit pengguna.
Tidak ada konten Notion yang berubah; status lokal ini tetap authoritative.

## T10 — backend evidence, acceptance lokal — 26 September 2026

Status authoritative T10: **DONE** — implementasi dan acceptance lokal selesai. Atas instruksi
pengguna 26 September 2026, acceptance T10 dibatasi ke environment lokal dan tidak memakai layanan
eksternal. T05/T09 **DONE**; T11/T12 TODO, Gate M2 terbuka. Rujukan R07/F05; UI S06/S08/S10
tetap T11. [Plan T10](verification/T10-implementation-plan.md),
[bukti dan perintah](verification/T10-evidence-backend.md), [decision 0016](decisions/0016-t10-evidence-backend.md).

Selesai: reservation/quota atomik, ownership/RLS, immutable upload dan validasi bytes/MIME/hash,
ClamAV nyata, worker durable dengan lease/token/retry, expiry/orphan cleanup, deletion receipt,
ready-only download 300 detik dan penutupan bypass storage generik. File utama: src/features/evidence/,
src/app/api/evidence/, src/server/storage/, workers/, generated database types, tests, package scripts,
.env.example, README dan runbook. Empat migration forward-only 20260925100000–20260925130000;
19/19 parity. Database aktif tidak di-reset; rebuild dilakukan pada stack disposable.

Hasil aktual: unit 176/176; integration 33/33 pada aktif dan disposable; pgTAP aktif 340/340,
disposable 336/336 sebelum empat assertion tambahan; DB lint bersih; typecheck, ESLint, build dan
worker sekali jalan lulus. Browser Achievement 3/3, Activity 1/1, Project 1/1 lulus; Evidence API
1/1 lulus pada rerun terpisah setelah perbaikan fixture onboarding. Detail kegagalan awal dan
perbaikannya ada pada bukti. Ulang disposable 26 September terhalang binding port Windows 55422;
rebuild 19 migration dan suite integration sudah lulus 25 September.

Tiga coder GPT-6 Luna Max mencapai usage limit saat implementasi; integrasi dan verifikasi
dituntaskan agen utama. Astra Medium adalah setting orchestrator yang diminta, bukan klaim
pergantian model task aktif. Perubahan T07–T09 yang sudah ada dipertahankan.

Tidak ada resource, billing, migration, atau deployment eksternal yang dibuat. Render OAuth tidak
diotorisasi. Project Supabase yang sudah ada tidak disentuh. Status DONE ini membuktikan kontrak dan
operasi pada stack lokal nyata, bukan production readiness atau retention hosted. Sinkronisasi Notion
untuk perubahan DONE ini tidak dilakukan karena pengguna melarang penggunaan layanan luar.
Pada checkpoint T10, langkah berikutnya adalah T11 Evidence UI dan lifecycle pada environment lokal
dan statusnya masih TODO. [Handoff T11 single-agent](verification/T11-implementation-plan.md)
menggantikan plan multi-agent: satu GPT-6 Luna mengerjakan fase berurutan dan Claude melakukan gate
review setelah Fase 5; checkpoint setelah Fase 2 bersifat opsional.
Riwayat checkpoint sebelumnya di bawah dipertahankan.

## Remediasi review T09 — acceptance lokal — 25 September 2026

Status authoritative T09: **DONE**. Dependensi T08 tetap **DONE**; T10 tetap **TODO**; Gate M2
masih terbuka sampai task M2 berikutnya selesai. Scope dan bukti terperinci ada di
[rencana remediasi T09](verification/T09-review-remediation-plan.md) dan
[verification T09](verification/T09-manual-achievements-skills.md), dengan keputusan di
[decision 0015](decisions/0015-t09-review-remediation.md).

Lingkup remediasi: retry mempertahankan lifecycle action/input; dated cursor mencakup row NULL-date;
metrics helper unused dihapus sambil menjaga blank validation; existing Achievement redirect,
sign-in resume, dan Activity/Achievement return diperbaiki. File utama mencakup
`src/features/achievement/achievement-form.tsx`, `achievement-action-contract.ts`, `actions.ts`,
`metrics-editor.tsx`, `achievement-service.ts`, `src/domain/achievement/transition.ts`,
`metrics.ts`, `src/server/action-result.ts`, `src/app/(workspace)/achievements/new/page.tsx`,
`src/domain/routes/safe-return.ts`, dan `src/i18n/messages.ts`. Regresi mencakup unit,
Achievement/Project integration, dan browser Achievement/Auth/Activity/Project; E2E Achievement
diperbarui agar menunggu navigasi sebelum memeriksa URL. Retry intent kini dikembalikan secara aman
sebagai bagian hasil conflict server. Tidak ada schema/RPC change, migration, backfill, atau reset
database. Perintah suite lengkap dicatat pada verification T09.

| Check | Hasil aktual |
| --- | --- |
| Achievement/Project database integration | Exit 0; 5/5 dan 7/7 tests. |
| Achievement browser E2E | Exit 0; 3/3 tests. |
| Auth/Activity/Project browser E2E | Exit 0; masing-masing 1/1 test. |
| Unit | Exit 0; 32 file / 159 tests dengan binary Vitest terpasang. |
| TypeScript | Exit 0; `node node_modules/typescript/bin/tsc --noEmit --incremental false`. |
| ESLint | Exit 0; `node node_modules/eslint/bin/eslint.js . --max-warnings 0`. |
| Production build | Exit 0; `node node_modules/next/dist/bin/next build`. |
| `git diff --check` | Exit 0; tracked diff bersih, hanya warning normal konversi LF/CRLF. File T09 baru/untracked dicek tanpa temuan baru; dua spasi pada baris tanggal dipertahankan sebagai hard-break Markdown. |

Docker Desktop server 29.6.1 tersedia. Local Supabase melaporkan `imgproxy` dan `pooler` berhenti,
namun keduanya tidak dibutuhkan oleh suites di atas. Build pertama di sandbox gagal menulis `.next`
(`EPERM`); production build berhasil saat dijalankan dengan akses workspace. E2E mencatat warning
non-blocking Node `NO_COLOR` dan Next.js `destination stream closed early`, tanpa test gagal.
`pgTAP`, DB lint, migration parity, dan disposable rebuild tidak diulang karena remediasi tidak
mengubah SQL; hasil sebelumnya tetap tercatat pada bukti historis T09. Gate M2 tidak ditutup dan
T10 tidak dimulai. Catatan Docker belum tersedia di checkpoint 24 September tetap historis.

### Checkpoint perencanaan awal (historis, sebelum eksekusi remediasi)

Rencana remediasi awal hanya memeriksa kode dan memperbarui dokumen, belum mengubah implementasi atau
menjalankan test aplikasi. Pada tahap tersebut lima defect alur aktif telah dicatat dan klaim metric
blank-to-zero dikoreksi karena helper tidak memiliki pemanggil. Eksekusi dan hasil aktual dicatat
setelah checkpoint ini.

## Eksekusi T09 sebelum review — 24 September 2026

Status historis T09: **DONE sebelum review; dibuka kembali menjadi PARTIAL di atas**.
Hard gate T08 sudah **DONE** sebelum implementasi dimulai.
Jalur manual Achievement/Skills, lifecycle, source provenance, optimistic revision, dan seam
Activity/Project sudah diimplementasikan secara forward-only. Rincian acceptance dan bukti aktual ada
di [verification T09](verification/T09-manual-achievements-skills.md), decision di
[decision 0014](decisions/0014-t09-achievement-lifecycle.md), dan rencana sumber di
[T09 implementation plan](verification/T09-implementation-plan.md).

Migration `20260922100000_t09_achievements_skills.sql` dan patch forward-only
`20260922110000_t09_achievement_null_patch.sql` diterapkan ke active local stack tanpa reset.
Perubahan mencakup S07/S08, standalone/derived Achievement, draft/confirmed/dismissed/reopen,
strict metrics, distinct confirmed skill counts, factual CV-bullet fallback, source retention,
Activity/Project attach-move-detach, context propagation, dan deletion receipts. T09 tidak memulai
AI, Evidence, import, Dashboard/Timeline, CV selection/invalidation, export, PDF, atau worker jobs.

Automated local evidence lulus: unit 32 file/150 test, Achievement integration 3/3, Project 7/7,
Activity 6/6, private Storage 1/1, pgTAP 312 assertions, DB lint, 15/15 migration match, production
build, worker check, ESLint, TypeScript, Auth/UI E2E masing-masing 1/1, dan Achievement browser/Axe
1/1 termasuk viewport 360px.
Gate T09.8 juga lulus pada stack disposable terpisah: seluruh 15 migration dan seed diterapkan dari
nol, pgTAP 312/312, DB lint, Achievement 3/3, Project 7/7, Activity 6/6, Storage 1/1, Achievement
E2E 1/1, Activity browser regression 1/1, dan Project browser regression 1/1; Axe serta assertion
viewport 360px tetap lulus. Resource disposable dihentikan dengan `--no-backup` dan folder temporary
dihapus setelah bukti dicatat. Stack WorkPulse aktif diverifikasi tetap hidup dan tidak di-reset.
Hosted/production checks dan T24 performance tetap di luar scope.

## Eksekusi remediasi review T08 — 22 September 2026

Status authoritative saat ini: **DONE**. Empat defect review ditutup: completed Project
mempertahankan end date valid di service; replay create membaca receipt ledger sebelum dependency
live; `update_project` memakai lock hierarchy Experience → Project → Activity ketika context
berubah; dan candidate attach difilter di database sebelum keyset pagination.

Rencana test-first dan Definition of Done tersedia di
[T08 review remediation plan](verification/T08-review-remediation-plan.md). Eksekusi memakai
migration forward-only baru dan tidak mengubah tiga migration T08 yang sudah diterapkan. Scope tetap
T08: preservation partial date, stable idempotent replay, hierarchy lock Experience → Project →
Activity, serta candidate pagination owner-scoped. Achievement, Evidence, AI, CV, dan T09+ tetap di
luar scope.

Migration `20260921090000_t08_review_remediation.sql` diterapkan incremental ke active local stack
tanpa reset. Unit/static, active/disposable database, integration, browser, build, worker, dan
diff checks lulus; rincian angka, file, serta limitation ada di
[verification T08](verification/T08-projects-context.md) dan
[decision 0013](decisions/0013-t08-review-remediation.md). Pada checkpoint T08 tersebut T09 masih
`TODO` dan menjadi langkah berikutnya; status T09 terkini dicatat pada bagian authoritative di atas.

## Eksekusi T08 sebelum review — 21 September 2026

Status historis pada akhir implementasi awal: **DONE sebelum review; kemudian dibuka kembali untuk
remediasi**. Dependensi T01–T07 dan remediasi review T07 sudah DONE.
Setelah Docker Desktop aktif kembali, seluruh Project/Activity/Storage integration, Auth/UI/Activity/
Project browser suites, active-stack database checks, dan clean disposable migration rebuild lulus.

Scope yang selesai mencakup migration forward-only untuk Project create idempotent, revocation direct
Project INSERT, owner-scoped update/relink/delete RPC, context propagation ke Activity, Project
service/actions, cursor dan safe-return contract, route `/projects`, `/projects/new`, dan
`/projects/[id]`, linked Activity attach/detach, restored-draft revision guard, dependency preview,
dan bilingual responsive states. Achievement, Evidence, Dashboard/Timeline, AI, dan CV tetap di luar
scope. Seam T09/T11/T20 dicatat pada decision dan verification T08.

Migration yang diterapkan forward-only ke stack lokal tanpa reset database aktif:
`20260920100000_t08_projects_context.sql`, `20260920101500_t08_project_patch_compatibility.sql`,
dan `20260920102000_t08_project_create_lint.sql`. Tidak ada reset database aktif. Generated Supabase
types diperbarui untuk RPC T08. Rincian file dan trace acceptance ada di
[verification T08](verification/T08-projects-context.md) dan [decision 0012](decisions/0012-t08-project-context.md).

### Bukti aktual T08

| Check | Hasil aktual |
| --- | --- |
| `pnpm lint` | Exit 0; zero warnings setelah route/UI/test T08 ditambahkan. |
| `pnpm typecheck -- --incremental false` | Exit 0. |
| `pnpm test` | Exit 0; 31 file / 141 unit tests pada run terakhir. |
| `pnpm test:integration:projects` | Exit 0; 4/4 terhadap active stack dan 4/4 pada disposable stack. |
| `pnpm test:integration:activity` | Exit 0; 6/6 terhadap active stack dan 6/6 pada disposable stack. |
| `pnpm test:integration:storage` | Exit 0; 1/1 terhadap active stack dan 1/1 pada disposable stack. |
| `pnpm db:test` | Exit 0; 268/268 pgTAP assertions pada active stack dan 268/268 pada disposable rebuild. |
| `pnpm db:lint` | Exit 0; tidak ada error severity `error` pada fungsi/migration yang diterapkan. |
| `pnpm exec supabase migration list --local` | Exit 0; 12/12 migration local/remote cocok pada active stack. |
| `pnpm db:types` | Exit 0; generated public types merefleksikan RPC Project; hanya warning MaxListeners dari CLI. |
| `pnpm test:e2e:auth` | Exit 0; 1/1. |
| `pnpm test:e2e:ui` | Exit 0; 1/1. |
| `pnpm test:e2e:activity` | Exit 0; 1/1. |
| `pnpm test:e2e:projects` | Exit 0; 1/1 dengan Axe dan mobile overflow assertion. |
| `pnpm build` | Exit 0; production build dengan route `/projects`, `/projects/new`, dan `/projects/[id]`. |
| `pnpm worker:check` | Exit 0; worker ready dan belum ada registered jobs. |
| `git diff --check` | Exit 0; hanya warning line-ending LF/CRLF. |

Clean rebuild memakai project ID/path/port disposable terpisah; migration dari nol, pgTAP, DB lint,
dan tiga integration suite lulus. Resource Docker disposable dihentikan dengan `--no-backup`; stack
WorkPulse aktif tetap berjalan dan tidak di-reset. Warning Next.js `destination stream closed early`
pada sebagian navigasi Auth/UI tidak menyebabkan assertion gagal. Hosted/staging/production checks dan
T24 performance tetap di luar scope. Pada checkpoint historis ini T09 menjadi langkah berikutnya;
status T09 terkini dicatat pada bagian authoritative di atas.

## Rencana T08 sebelum implementasi — 20 September 2026

Status pada saat rencana ditulis adalah **TODO**; implementasi belum dimulai. Rencana eksekusi lengkap untuk
Project dan context propagation tersedia di
[T08 implementation plan](verification/T08-implementation-plan.md). Plan ditujukan untuk GPT-5.6
Luna dengan reasoning `MAX` dan memecah pekerjaan menjadi T08.1-T08.9: baseline/decision, migration,
domain/types, service/actions, S09, S10, linked work/delete, browser/accessibility, dan verification.

Scope mengacu ke PRD R06, Flow F04/shared recovery, Wireframe S09-S10, Database Schema §§1-3/6,
Design.md dengan resolusi konflik §1 rencana, serta kontrak T06-T07. Plan menetapkan create Project
idempotent, owner/revision boundary, status `planned`/`active`/`completed`, partial dates, list cursor,
Activity relink yang menurunkan Experience dari Project, propagation context atomik, dan delete yang
mempertahankan Activity/Chat/Experience. Achievement, Evidence, Dashboard/Timeline, AI, dan CV tetap
deferred ke task pemiliknya; seam T09/T11/T20 dicatat eksplisit.

Perubahan pada sesi perencanaan hanya dokumen plan dan checkpoint status. Bagian ini bersifat historis;
implementasi aktual dicatat pada bagian Eksekusi T08 di atas. Tidak ada aplikasi,
migration, schema/RPC/RLS/grant, generated type, dependency, lockfile, worker, atau test result yang
berubah/diklaim. Dirty changes remediasi T07 yang sudah ada harus dipertahankan saat eksekusi. Gate M2
tetap terbuka sampai T08-T12 selesai.

## Remediasi review T07 — 20 September 2026

Status authoritative saat ini: **DONE**. Tiga gap review pasca-T07 sudah ditutup: restored edit
draft kini terikat pada base revision dan memerlukan review/rebase eksplisit bila stale/unknown;
edit Note/Chat mempertahankan structured fields canonical yang sudah ada; dan kegagalan context
options memiliki safe code, localized message key, serta correlation ID yang diteruskan konsisten
ke fatal/degraded UI.

Implementasi hanya menyentuh session draft, Activity action/form/context/page boundaries, i18n, unit
tests, dan Activity browser regression. Tidak ada migration, schema/RPC/RLS/grants, generated DB
types, dependency, worker, atau scope T08 yang berubah. Decision record ada di
[decision 0011](decisions/0011-t07-review-remediation.md); rencana dan bukti lengkap ada di
[T07 review remediation plan](verification/T07-review-remediation-plan.md) dan
[verification T07](verification/T07-activity-ui.md).

Quality gates remediasi lulus: install frozen, lint, typecheck, 27 file/130 unit tests, Activity
integration 6/6, Storage integration 1/1, production build, worker check, pgTAP 240/240, DB lint,
local migration ledger 9/9, Auth/UI/Activity E2E masing-masing 1/1, Axe, responsive 360/1440,
reduced motion, dan `git diff --check`. Supabase yang diuji hanya stack lokal; nilai credential tidak
dicatat dalam artefak dan database aktif tidak di-reset. Warning Next.js `destination stream closed
early` pada sebagian navigasi E2E tidak menyebabkan assertion gagal.

Tidak dijalankan: `pnpm db:types`, clean disposable rebuild, hosted/staging/production checks, dan
T24 performance; schema/RPC tidak berubah dan item tersebut berada di luar acceptance T07. T08 belum
dimulai. Gate M2 tetap terbuka sampai T08–T12 selesai.

## Eksekusi T07 — 18 September 2026

Status historis pada 18 September: **DONE sebelum review; kemudian dibuka kembali untuk remediasi**.
T07 menghubungkan S05–S06 ke persistence T06: Quick log Note/Form/Chat,
owner-scoped Activity list dan detail, URL filters/cursor, edit dengan optimistic revision dan
conflict recovery, serta bilingual/responsive/accessibility states. Acceptance ditrace ke PRD R04,
Flow F02/shared recovery, Wireframe S05–S06, Database Schema §§1–3/6, dan Design.md.

Tidak ada migration, perubahan schema/RPC/generated DB types, dependency, AI, Achievement, Evidence,
Project CRUD, atau Activity delete dalam scope T07. Seluruh perubahan T05–T06 yang belum di-commit
tetap dipertahankan. Rincian scope/file/acceptance dan hasil aktual ada di
[verification T07](verification/T07-activity-ui.md) dan [rencana eksekusi](verification/T07-implementation-plan.md).

Quality gates akhir lulus: install frozen, lint, typecheck, 25 file/124 unit tests, Activity
integration 6/6, Storage integration 1/1, production build, worker check, pgTAP 240/240, DB lint,
local migration ledger 9/9, Auth/UI/Activity E2E masing-masing 1/1, Axe WCAG 2.2 A/AA, responsive
360/1440 light/dark, dan `git diff --check`. Supabase yang diuji hanya stack lokal; output key
`db:status` disembunyikan dan tidak ada hosted project yang tertaut. Database aktif tidak di-reset.

Langkah berikutnya adalah mengeksekusi remediasi T07. T08 Projects dan context menunggu remediasi
selesai. Gate M2 tetap terbuka sampai T07 kembali DONE dan T08–T12 selesai.

## Rencana remediasi review T06 — 17 September 2026

Status authoritative saat ini: **DONE**. Remediasi review menutup tiga gap boundary service Activity:
missing/invalid session sekarang menjadi `UNAUTHENTICATED`, create replay mengembalikan receipt
immutable dari RPC, dan setiap `ActivityServiceError` memiliki localized message key serta UUID
correlation ID.

Rencana lengkap dan hasil aktual ada di
[T06 review remediation plan](verification/T06-review-remediation-plan.md). Acceptance dan command
terakhir dicatat dalam [verification T06](verification/T06-activity-persistence.md) dan
[decision 0010](decisions/0010-t06-activity-service-contract.md). Perubahan hanya pada service/domain
contract, tests, dan dokumen. Tidak ada perubahan RPC, schema, migration, RLS, grants, package
version, lockfile, generated database types, atau UI.

Sebelum perbaikan, regression unit baru gagal 8/8: missing session menjadi `UNAVAILABLE`, error
tidak memiliki `messageKey`/`correlationId`, dan create mengembalikan row live revision 2 melalui
query tambahan. Setelah perbaikan, lint, typecheck, 23 file / 112 unit tests, Activity integration
6/6, Storage integration 1/1, build, worker check, pgTAP 240/240, DB lint, migration list 9/9, dan
`git diff --check` lulus.

T07 tetap `TODO` dan belum dimulai. T07 — Capture dan Activity UI — menjadi task berikutnya setelah
T06 selesai. Gate M2 tetap terbuka sampai T06–T12 selesai.

## T06 Activity persistence — 17 September 2026

Status akhir: **DONE** setelah remediasi review. UI Capture, list/detail, dan feedback save belum
dimulai; semua itu tetap pada T07. Scope mengikuti T06 implementation plan dan trace PRD R04 / Content
and AI behavior, Flow F02 / shared recovery, Screens S05/S06, dan Database Schema §§1–3/6.

Migration `20260917160000_t06_activity_persistence.sql` diterapkan forward-only ke Supabase lokal
aktif tanpa reset; `migration up` selanjutnya menghasilkan `applied: []`. Clean rebuild pada
project disposable `workpulse_t06clean202609171620` menerapkan sembilan migration plus seed.
pgTAP 240/240, Activity integration 6/6, dan Storage integration 1/1 lulus pada stack aktif saat
remediasi; tidak ada reset atau migration baru. Clean rebuild sebelumnya tetap menjadi bukti T06 SQL
dan tidak diulang karena remediasi ini hanya mengubah TypeScript. Container, volume, network, dan
folder clean rebuild sudah dihapus; stack aktif tetap tidak linked ke hosted.

Acceptance mencakup raw text persis tanpa trimming/truncation, Chat first message atomik, idempotent
replay, batas Unicode 10.000, exact date/timezone, owner isolation dan direct mutation denial,
revision conflict, context lifecycle, serta keyset pagination 30 baris. Detail per-case, file,
replay receipt setelah edit dan project experience propagation, batas Unicode 10.000, exact
date/timezone, owner isolation dan direct mutation denial, revision conflict, context lifecycle,
serta keyset pagination 30 baris. Detail ada pada [verification T06](verification/T06-activity-persistence.md),
[decision 0009](decisions/0009-activity-persistence.md), dan [decision 0010](decisions/0010-t06-activity-service-contract.md).

Perubahan remediasi ada pada `src/features/activity/activity-service.ts`,
`src/domain/activity/contracts.ts`, `src/domain/database-types.ts`, unit/integration tests, decision
0010, verification T06, status, dan rencana remediasi. `createActivity()` mengembalikan lima-field
receipt yang frozen; current Activity/Chat dibaca melalui `getActivity()`. Error service memakai
key dictionary yang sudah ada, field errors bertipe `MessageKey`, pesan diagnostics generik, dan
UUID baru per instance.

### Quality gates akhir remediasi

| Command | Hasil aktual |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; dependencies sudah tersedia, lockfile tidak berubah. |
| `pnpm lint` | Exit 0; zero warnings. |
| `pnpm typecheck -- --incremental false` | Exit 0. |
| `pnpm test` | Exit 0; 23 file / 112 tests. |
| `pnpm test:integration:activity` | Exit 0; 6/6 terhadap stack lokal, termasuk anonymous session dan replay setelah edit/context propagation. |
| `pnpm test:integration:storage` | Exit 0; 1/1 terhadap stack lokal. |
| `pnpm build` | Exit 0; production build. Sandbox awal menolak write ke `.next`; rerun dengan akses workspace berhasil. |
| `pnpm worker:check` | Exit 0; worker ready, belum ada registered jobs seperti yang diharapkan pada T06. |
| `pnpm db:test` | Exit 0; 240/240 pgTAP assertion. |
| `pnpm db:lint` | Exit 0; tidak ada error pada severity `error`. |
| `pnpm exec supabase migration list --local` | Exit 0; 9 migration lokal cocok dengan ledger database. |
| `git diff --check` | Exit 0; peringatan line-ending LF/CRLF saja. |

Integration menggunakan key dari status Supabase lokal hanya sebagai process environment; secret tidak
dicetak atau disimpan. Account fixture dibersihkan oleh test, dan database aktif tidak di-reset.
`db:types` tidak dijalankan karena schema/RPC tidak berubah. Browser E2E tidak dijalankan karena
tidak ada route/component UI yang berubah. Clean rebuild tidak diulang karena tidak ada SQL; hosted
migration, staging performance, dan production tetap di luar scope. Advisory PL/pgSQL lama tentang
`v_revision` tercatat pada verification T06; konfigurasi repo `pnpm db:lint` tidak melaporkan error.

Dependensi: T01–T05 DONE. Langkah berikutnya T07 Capture dan Activity UI. Gate M2 tetap terbuka
sampai seluruh T06–T12 selesai.

## Review T05 private storage policy (checkpoint sebelum T06) — 17 September 2026

Status saat ini: **DONE**. Temuan review P1 ditutup dengan migration forward-only
`20260917134500_t05_storage_policy_hardening.sql`, policy `workpulse_private_server_only` yang
restriktif untuk `anon`/`authenticated`, dan regression pgTAP broad-policy. Migration T05 historis
tidak diubah. Detail bukti ada di [verification T05](verification/T05-private-storage-foundation.md),
[decision 0008](decisions/0008-private-storage-restrictive-policy.md), dan
[rencana remediasi](verification/T05-review-remediation-plan.md).

Reproduksi sebelum perbaikan membuat satu row WorkPulse terlihat oleh `authenticated` meskipun
cleanup lama tidak mendeteksi policy generik. Seluruh policy dan object fixture hilang sesudah
`ROLLBACK`. Sesudah perbaikan, pgTAP lulus 185/185; Storage integration dua akun tetap menolak
signing langsung 3.600 detik, mempertahankan owner URL attachment TTL 3 detik sampai expiry, dan
membuktikan upload/delete user-token tidak mengubah object.

Migration diterapkan forward-only ke database Supabase lokal aktif tanpa reset. Clean rebuild pada
project disposable `workpulse_t05_hardening_20260917_1345` menerapkan delapan migration dan seed,
lalu pgTAP, DB lint, dan Storage integration lulus. Project disposable beserta folder, container,
volume, dan network sudah dibuang; database aktif tetap sehat dan project tidak linked ke hosted.
Gate M1 ditutup kembali. T06 menjadi task berikutnya dan belum dimulai.

Dependensi: T02 minimum selesai; T01–T04 tetap DONE. Scope: hardening Storage boundary T05 untuk PRD R01/R07 dan Database Schema §4/§6; tidak memulai T06 atau T10+.

File remediasi: migration baru `supabase/migrations/20260917134500_t05_storage_policy_hardening.sql`, regression `supabase/tests/database/private_storage.test.sql`, decision 0008, verification T05, rencana remediasi ini, dan checkpoint status ini. `tests/integration/private-storage.test.ts` sudah memiliki coverage langsung TTL 3.600 detik dan tidak memerlukan perubahan.

Quality gates aktual lulus: install, lint, typecheck, unit 19 file/88 test, Storage integration 1/1, production build, worker check, pgTAP 185/185, DB lint, migration list delapan migration, clean disposable rebuild, dan `git diff --check`. Rincian perintah dan batasan test DELETE SQL ada di verification T05.

Checks tidak dijalankan: browser E2E, karena UI tidak berubah; hosted Storage/production deployment, karena scope hanya stack lokal dan tidak ada migrasi hosted yang diminta. Blocker T05/M1: tidak ada. Scanner nyata, quota/reservation, dan lifecycle evidence tetap scope task berikutnya.

## Deliverable desain — 16 September 2026

Permintaan terarah mockup S01–S14: DONE untuk 14 screen representatif, bukan implementasi fitur. Acuan: Design.md root, wireframe S01–S14 (R01–R10/F01–F07), keputusan scope IMPLEMENTATION_PLAN §1. Catatan desain ini terpisah dari status implementasi T01–T25.

File: `design-mockups/` di root, berisi galeri `index.html`, S01–S14 HTML, CSS, font lokal berlisensi OFL, 56 PNG desktop/mobile light/dark, generator dan catatan verifikasi. `node design-mockups/build.mjs` berhasil; `node design-mockups/render.mjs` berhasil untuk 56 render pada 1440/360 px, tanpa horizontal overflow, font terpasang, menu mobile dan autofocus Quick log lolos. Bukti: `design-mockups/verification.json` dan `design-mockups/README.md`.

Keterbatasan: data ilustrasi dan aksi simulasi; belum semua state alternatif, audit aksesibilitas menyeluruh, atau integrasi produk. Build/test aplikasi tidak dijalankan karena deliverable terpisah dari aplikasi. Langkah berikutnya: review desain; implementasi berikutnya tetap mengikuti dependensi task tracker.

Terakhir diperbarui untuk desain: 16 September 2026.

## Remediasi review T03–T04 — 17 September 2026

Status: **DONE.** Empat temuan pada [rencana remediasi](verification/T03-T04-review-remediation-plan.md) sudah ditutup dengan acceptance database, replay, history guard, draft isolation, field-error association, dan Axe pada error state. Checkpoint T03/T04 bertanggal 16 September di bawah tetap menjadi catatan historis; status saat ini ada pada checkpoint remediasi bertanggal 17 September.

Scope: direct INSERT foundation dan validasi database (R01, F01, S12), immutable create replay, perlindungan Quick log pada Back/Forward (R04, F02, S05), serta hubungan field error dan kontrol dengan audit Axe WCAG A/AA. Tidak memulai T05 atau fitur bisnis berikutnya.

Baseline sebelum perubahan, semua exit 0: `pnpm install --frozen-lockfile`; `pnpm lint`; `pnpm typecheck -- --incremental false`; `pnpm test` (13 file / 51 test); `pnpm build`; `pnpm db:test` (117 assertion); `pnpm db:lint`; `pnpm test:e2e:auth` (1 test); `pnpm test:e2e:ui` (1 test). Baseline lengkap tetap pada bagian historis. Final acceptance dan file list tercatat di [checkpoint remediasi](#checkpoint-remediasi-t03t04) serta [verification T03](verification/T03-auth-profile.md) dan [verification T04](verification/T04-design-system-app-frame.md).

Supabase hanya lokal; `linked_project: null`. Migration baru diterapkan secara forward-only pada database WorkPulse lokal tanpa reset volume tersebut. Clean reset dijalankan pada project disposable terpisah, lalu container, volume, network, dan foldernya dihapus setelah verifikasi. Hosted SMTP, project hosted, dan deployment tidak digunakan.

Pada saat checkpoint remediasi ini ditulis, task berikutnya adalah T05 Private storage foundation; Gate M1 masih terbuka sampai acceptance T05 selesai.

## Task tracker

| ID | Paket | Status |
| --- | --- | --- |
| T01 | Bootstrap | DONE |
| T02 | Schema dan tenant boundary | DONE |
| T03 | Auth dan profil | DONE |
| T04 | Design system dan app frame | DONE |
| T05 | Private storage foundation | DONE |
| T06 | Activity persistence | DONE |
| T07 | Capture dan activity UI | DONE |
| T08 | Projects dan context | DONE |
| T09 | Manual achievements dan skills | DONE |
| T10 | Evidence reservation dan screening | DONE |
| T11 | Evidence UI dan lifecycle | DONE |
| T12 | Dashboard dan timeline | DONE |
| T13 | AI jobs dan consent | DONE |
| T14 | Detection dan review | DONE |
| T15 | Import staging | DONE |
| T16 | Import commit | DONE |
| T17 | Import review UI | DONE |
| T18 | CV schema dan selection | DONE |
| T19 | CV builder dan overrides | DONE |
| T20 | CV freshness dan deletion | TODO |
| T21 | Export backend | TODO |
| T22 | Preview dan PDF QA | TODO |
| T23 | Account deletion dan retention | TODO |
| T24 | Instrumentation dan performance | TODO |
| T25 | Regression dan release handoff | TODO |

Status yang digunakan: TODO, IN_PROGRESS, PARTIAL, BLOCKED, DONE. DONE hanya setelah acceptance task memiliki bukti. BLOCKED harus mencantumkan dependensi konkret dan pekerjaan independen yang sudah diselesaikan.

## Checkpoint T05 sebelum review policy

Task / tanggal / status saat checkpoint:
T05 Private storage foundation / 17 September 2026 / DONE saat checkpoint; status terkini
dibuka kembali sementara untuk review policy lalu ditutup kembali sesuai remediasi di bagian atas.

Dependensi DONE:
T02 minimum; T01–T04 seluruhnya DONE.

Scope yang selesai:
- Bucket private `workpulse-private`, key owner/category/object kanonik, module admin server-only, authorization dari server auth context, validasi metadata, safe errors, dan signed download 1–300 detik dengan attachment disposition.
- Durable `internal.storage_jobs`: idempotent enqueue, atomic claim, 120-second lease, attempt-token guard, explicit retry, serta tanpa FK ke parent/profile.
- Scanner contract fail-closed; belum ada real vendor atau status file `ready`. Upload UI, quota reservation, evidence domain schema, dan worker daemon tetap pada task setelah T05.
- Gate M1 ditinjau dan ditutup. Detail acceptance, file list, perintah, hasil, dan limitation ada di [verification T05](verification/T05-private-storage-foundation.md) dan [decision 0007](decisions/0007-private-storage-foundation.md).

Migration dan keputusan:
`20260917090000_t05_private_storage_foundation.sql` diterapkan forward-only ke Supabase lokal; tidak reset database aktif. `internal.storage_jobs` tidak mengubah public schema atau `database.types.ts`. Decision 0007 menjelaskan provider-owned ACL yang tidak dapat dicabut role migrasi; RLS tanpa WorkPulse policy dan direct user-token denial diverifikasi lewat test lokal.

Acceptance dan perintah:
Lint, typecheck, 19 file / 88 unit tests, local storage integration dua akun 1/1, production build, worker check, pgTAP aktif 174/174, DB lint, migration list, clean disposable rebuild (174/174 + DB lint), serta `git diff --check` lulus. Catatan rinci ada di verification record T05.

Batasan / langkah berikutnya:
Tidak ada hosted storage, production deployment, scanner malware nyata, reservation/quota, signature/actual-byte validation, atau upload UI pada T05. Container/volume/network disposable sudah dibuang; working folder sementara masih ada di `%TEMP%` setelah penghapusan folder ditolak policy shell. Langkah berikutnya T06 Activity persistence.

## Checkpoint remediasi T03–T04

Task / tanggal / status:
Remediasi review setelah T03/T04 / 17 September 2026 / DONE.

Dependensi DONE:
T01 Bootstrap, T02 Schema dan tenant boundary, T03 Auth dan profil, serta T04 Design system dan application frame.

Scope yang selesai:
- Direct authenticated INSERT pada experiences, education, certifications, dan skills dicabut. Database limits/URL/canonical-null checks disejajarkan dengan contract TypeScript, dengan data preflight yang menolak incompatibility tanpa mengubah nilai lama.
- `internal.operation_requests.result_payload` menyimpan hasil create immutable dalam transaksi yang sama. Replay identik tetap mengembalikan snapshot setelah row diubah/dihapus; key dengan payload berbeda mendapat conflict stabil.
- Back/Forward pada form dirty menampilkan konfirmasi dan menjaga URL serta draft. Quick log memakai owner UUID pada key session draft dan tetap mempertahankan note sampai persistence Activity tersedia di T07.
- Semua `FieldError` memakai ID deterministic dan hubungan ARIA langsung; draft form dipulihkan untuk semua action errors. Axe memeriksa tag WCAG 2.0/2.1/2.2 A/AA tanpa filter severity.
- Tidak ada T05+ dimulai, tidak ada schema lama atau dokumen sumber yang diubah, dan tidak ada dependency baru.

File yang berubah:
- Migration/test database: `supabase/migrations/20260916190000_t03_foundation_contract_hardening.sql`, `supabase/tests/database/foundation.test.sql`.
- Domain/UI: `src/domain/profile/field-contract.ts`, `src/domain/routes/unsaved-navigation.ts`, `src/components/forms/field-error-binding.ts`, `src/components/forms/session-draft.ts`, `src/components/forms/action-feedback.tsx`, `src/components/ui/unsaved-changes.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/inline-error.tsx`, `src/features/activity/quick-log-capture.tsx`, `src/app/(workspace)/activity/new/page.tsx`, `src/features/auth/sign-in-client.tsx`, `src/features/auth/update-password-form.tsx`, `src/features/profile/foundation-actions.ts`, `src/features/profile/foundation-editors.tsx`, `src/features/profile/onboarding-form.tsx`, `src/features/profile/profile-editor.tsx`, `src/features/profile/schemas.ts`.
- Tests: `tests/unit/field-error-binding.test.ts`, `tests/unit/unsaved-navigation.test.ts`, `tests/e2e/helpers/accessibility.ts`, `tests/e2e/app-frame.spec.ts`, `tests/e2e/auth-profile.spec.ts`.
- Records: `docs/decisions/0006-t03-t04-review-remediation.md`, `docs/verification/T03-auth-profile.md`, `docs/verification/T04-design-system-app-frame.md`, and this file.

Migration dan keputusan:
`20260916190000_t03_foundation_contract_hardening.sql` adalah migration forward-only keenam, diterapkan pada local WorkPulse DB. Preflight menghentikan migration bila nilai existing melanggar contract; tidak ada truncation atau rewrite. Decision `0006-t03-t04-review-remediation.md` mencatat mutation boundary, snapshot/legacy marker, history guard, Quick log owner scope, dan error accessibility. `database.types.ts` tidak berubah karena typegen parity identik.

Acceptance checklist serta bukti:
- [x] pgTAP membuktikan empat INSERT revoke, direct insert rejection, typed create success, constraints create/update, URL/duplicate/date/revision/ownership semantics: 139/139 assertions pada DB asli dan disposable.
- [x] Replay setelah update dan delete mengembalikan snapshot; changed payload memakai stable error; row tidak dibuat kembali.
- [x] Two-session replay mengembalikan ID sama, menyimpan satu skill dan satu ledger row dengan snapshot cocok ke row; fixture dibersihkan.
- [x] Clean reset disposable `workpulse_t03_t04_20260917` menerapkan enam migration dan seed; seed count 2 auth users, 2 completed profiles, 2 experiences, 1 education, 1 project, 2 skills; pgTAP dan DB lint lulus. Resources disposable dihapus dan `supabase_db_WorkPulse` dipertahankan.
- [x] Typegen output dari local DB identik dengan `src/server/supabase/database.types.ts` setelah normalisasi line ending.
- [x] Auth E2E lulus 1/1: invalid sign-in/onboarding, field errors, profile conflict, partial-date recovery, foundation CRUD, owner-isolated Quick log draft, recovery, and sign-out cleanup.
- [x] UI E2E lulus 1/1: Back/Stay/Continue/Forward, mobile Quick log focus, filter history, keyboard/drawer focus, WCAG A/AA Axe error states, 360/1440 viewport dan light/dark tanpa overflow.
- [x] Default Playwright smoke lulus 2/2; lint, typecheck, 15 file/55 unit tests, build, DB status, migration list, pgTAP, DB lint, type parity, dan `git diff --check` berhasil.

Perintah verifikasi dan hasil aktual:
- `pnpm install --frozen-lockfile` — exit 0; dependencies sudah tersedia.
- `pnpm lint` — exit 0; zero warnings. `pnpm typecheck -- --incremental false` — exit 0. `pnpm test` — exit 0; 15 files / 55 tests. `pnpm build` — exit 0.
- `pnpm db:status` — exit 0; `linked_project: null`. `supabase migration list --local` — exit 0; enam migration tersinkron termasuk versi `20260916190000`.
- `pnpm db:test` — exit 0; 139/139. `pnpm db:lint` — exit 0; no schema errors. `pnpm db:types` — exit 0 dan parity identik.
- Disposable: `pnpm db:reset -- --local --workdir <disposable> --yes` exit 0; `pnpm db:test -- --workdir <disposable>` exit 0 (139/139); `pnpm db:lint -- --workdir <disposable>` exit 0. Setelah cek project ID/path, stop dengan `--no-backup`; container, volume, network, dan folder disposable sudah tidak ada.
- `pnpm test:e2e` — exit 0; 2 smoke tests. `pnpm test:e2e:auth` — exit 0; 1 test. `pnpm test:e2e:ui` — exit 0; 1 test. Screenshots desktop/mobile light/dark telah ditinjau.
- `git diff --check` — exit 0; Git hanya memberi notifikasi konversi LF/CRLF pada working tree.

Checks yang belum dijalankan beserta alasan:
Hosted Supabase, production SMTP/redirect delivery, dan deployment tidak dijalankan karena di luar scope remediasi serta tidak ada klaim readiness production. Checks lokal yang diwajibkan plan semuanya dijalankan.

Risiko atau blocker konkret:
Tidak ada blocker untuk T03/T04. `pnpm db:status` mencatat imgproxy dan pooler pada stack WorkPulse asli berhenti; PostgreSQL/Auth/API/Mailpit yang dipakai acceptance tetap berfungsi. Hosted email dan deployment masih menjadi integration work sebelum production.

Langkah berikutnya:
T05 Private storage foundation. Gate M1 tetap terbuka sampai acceptance T05 selesai.

## Checkpoint T04

Task / tanggal / status:
T04 Design system dan application frame / 16 September 2026 / DONE.

Dependensi DONE:
T01 Bootstrap, T02 Schema dan tenant boundary, dan T03 Auth dan profil.

Scope yang selesai:
- Token semantic sage untuk light/dark, control border dan focus contrast, warna status,
  typography, spacing, radius, shadows, focus, touch targets, dan reduced motion.
- Theme switch menyimpan pilihan `light`/`dark` dalam cookie `wp-theme`; tanpa pilihan
  eksplisit, tema sistem dipakai. Root bootstrap menerapkan atribut sebelum workspace paint.
- Route group workspace tetap memakai URL canonical. Server layout hanya membungkus
  profile yang sudah selesai; onboarding provisional tetap melalui flow T03.
- Frame desktop/mobile menyediakan skip link, enam navigasi canonical, profile/settings,
  sign out, theme switch, dan Quick log. Drawer memakai native dialog dengan Escape dan
  mengembalikan fokus ke tombol pemicu.
- Route Activity menerima filter GET `from`, `to`, `project`, memulihkan state dari URL,
  mendukung back/forward, menghilangkan nilai kosong, dan tidak memperlakukan query lain
  sebagai state filter. `/activity/new` memfokuskan input; save tetap unavailable.
- Achievements, Projects, Timeline, dan CV memakai unavailable state tanpa data contoh,
  fake success, maupun persistence yang belum ada.
- Shared UI states dipakai oleh frame, placeholder, Dashboard, dan Profile: controls,
  card/badge, tooltip, dialog, toast, skeleton, empty/unavailable/error, unsaved guard,
  named delete, dan revision conflict. T03 server action, owner, revision, operation key,
  dan session draft contracts tetap berlaku.
- Copy dan accessible names untuk navigasi, tema, Activity, Quick log, placeholder, serta
  state bersama tersedia dalam locale `en` dan `id` melalui dictionary produk.
- Keputusan token/control contrast, cookie tema, native dialog, package pins, filter
  allowlist, dan placeholder scope ada di
  [0005-design-system-application-frame.md](decisions/0005-design-system-application-frame.md).

File T04 yang ditambah atau disesuaikan:
`README.md`, `package.json`, `pnpm-lock.yaml`, `playwright.config.ts`,
`playwright.ui.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`,
`src/app/(workspace)/` (layout, loading, Dashboard/Profile, dan lima destination pages
beserta Quick log), `src/styles/tokens.css`, `src/components/layout/`,
`src/components/ui/`, `src/components/forms/` (feedback, submit, conflict),
`src/features/profile/` (frame/form adaptation), `src/features/auth/sign-out-form.tsx`,
`src/domain/routes/url-filters.ts`, `src/domain/theme/theme-preference.ts`,
`src/server/supabase/server.ts`, `src/i18n/messages.ts`,
`tests/unit/theme-preference.test.ts`, `tests/unit/url-filters.test.ts`,
`tests/unit/session-draft.test.ts`, `tests/e2e/app-frame.spec.ts`,
`tests/e2e/auth-profile.spec.ts`, dan decision/verification records T04.
Tidak ada migration, schema, database type, atau worker yang diubah.

Acceptance checklist serta bukti:
- [x] Clean install `pnpm install --frozen-lockfile` berhasil; lockfile pnpm tunggal,
      `lucide-react` 1.46.0 dan `@axe-core/playwright` 4.12.1 dipin exact.
- [x] `pnpm lint` lulus dengan zero warnings; `pnpm typecheck -- --incremental false`
      lulus.
- [x] `pnpm test` lulus: 13 files, 51/51 tests, termasuk tema/token contrast, URL
      filters, dan draft-key isolation.
- [x] `pnpm build` menghasilkan production build. E2E UI juga membangun dan menjalankan
      production server sebelum pengujian.
- [x] `pnpm test:e2e` lulus: 2 smoke tests (health dan anonymous root).
- [x] `pnpm test:e2e:auth` lulus: 1 end-to-end test meliputi signup/confirmation,
      onboarding, recovery, profile, draft/conflict, CRUD foundation, named delete,
      dan sign out pada Supabase lokal/Mailpit.
- [x] `pnpm test:e2e:ui` lulus: 1 authenticated test meliputi enam route/active states,
      explicit dan system theme, URL filter/reload/back/forward, Quick log focus, unsaved
      guard, skip link, drawer/Escape/focus return, reduced motion, sign out, serta
      viewport 360/1440 di light/dark untuk Dashboard, Activity, Quick log, dan Profile.
- [x] Axe route scans Dashboard, Activity, dan Profile melaporkan 0 serious/critical
      violations. Screenshot light/dark desktop, mobile, serta mobile drawer ditinjau;
      tidak terlihat clipping atau horizontal overflow.
- [x] Tidak ada fake success, placeholder records, database migration, atau business
      persistence yang diperkenalkan. T05 berikutnya; Gate M1 masih terbuka.

Perintah dan hasil aktual terakhir:
`pnpm install --frozen-lockfile` exit 0; `pnpm lint` exit 0; `pnpm typecheck -- --incremental false`
exit 0; `pnpm test` exit 0 (13 files / 51 tests); `pnpm build` exit 0;
`pnpm test:e2e` exit 0 (2 tests); `pnpm test:e2e:auth` exit 0 (1 test);
`pnpm test:e2e:ui` exit 0 (1 test, Axe serious/critical 0). Bukti E2E menggunakan
Supabase lokal, Auth email confirmation, Mailpit, dan Chromium; tidak ada hosted account
atau production service yang diakses.

Checks yang tidak dijalankan beserta alasan:
`pnpm db:reset`, `pnpm db:test`, `pnpm db:lint`, dan `pnpm db:types` tidak dijalankan
untuk T04 karena tidak ada migration/schema/type changes dan suite database tidak
termasuk acceptance task ini. `pnpm db:status` tidak dijadikan bukti; status container
lokal diperiksa secara read-only. Hosted SMTP dan deployment tidak diuji karena bukan
scope T04.

Blocker: tidak ada untuk T04. Activity/project/achievement/timeline/CV masih state
unavailable sampai task bisnis terkait; itu adalah batas scope yang direncanakan.

Langkah berikutnya:
T05 Private storage foundation sesuai dependency plan. Jangan menutup Gate M1 sampai
acceptance T05 selesai.

## Checkpoint T03

Task / tanggal / status:
T03 Auth dan profil / 16 September 2026 / DONE.

Dependensi DONE:
T01 Bootstrap dan kontrak proyek; T02 Schema dasar dan tenant boundary.

Scope yang selesai:
- Auth SSR, lifecycle routing, confirmation/recovery actions, profile/onboarding, dan
  empat foundation editor tetap pada scope T03. Identitas mutation berasal dari
  session server, RLS, dan RPC; client tidak dipercaya mengirim owner ID.
- Phase 1: sessionStorage draft memakai key versi baru per authenticated profile ID
  dan form. Legacy key tanpa owner dibuang. Password, hidden/server fields, identity,
  revision, file, serta field tak dikenal tidak disimpan. Sign-out membersihkan draft
  milik akun aktif.
- Phase 2: conflict reload/retry memakai field allowlist per form. Record identity,
  owner, revision, timestamps, lifecycle, dan discriminator terlindungi. Experience
  kind dipetakan ke control experience_kind; tanggal memakai mapping precision.
  Reload mengganti field editable dan expected_revision; retry mempertahankan input
  lokal, mengubah expected_revision saja, dan melakukan satu resubmit.
- Phase 3: create experience, education, certification, dan skill menggunakan typed
  authenticated RPCs dan tidak memakai direct insert di saveFoundationAction.
  Operation key UUID tersimpan per owner/form sampai success; error/ambiguous retry
  mempertahankan key. Private operation_requests menggunakan unique
  (user_id, operation_kind, operation_key), input_revision 0, hash SHA-256 atas
  canonical JSONB, dan owned result. Ledger + row create terjadi pada satu transaksi.
  Identik replay mengembalikan row yang sama; payload berbeda untuk key sama ditolak.
  Update/delete tetap memakai RPC revision-checked yang sudah ada.
- Migration, action, dan conflict errors memakai safe localized results tanpa raw
  database message atau data record akun lain.
- E2E Auth/profile dijalankan terhadap Supabase lokal dengan confirmation dan Mailpit:
  signup/verification, manual onboarding, dashboard, recovery/password update,
  isolation dua akun, revision conflict, draft restore, CRUD foundation, partial dates,
  dan sign-out lulus.
- Recovery token-hash lokal menghasilkan AMR `otp`; password update mengharuskan
  callback `type=recovery` yang sudah diverifikasi, cookie flow HttpOnly, dan bukti AMR
  terbaru. PKCE tanpa type tetap mengharuskan AMR `recovery`.
- Scope tetap T03; T04 belum dimulai.

File yang berubah pada remediation:
src/components/forms/session-draft.ts, src/components/forms/conflict-controls.tsx,
src/components/forms/operation-key.ts, src/features/auth/sign-out-form.tsx,
src/app/dashboard/page.tsx, src/app/settings/profile/page.tsx,
src/features/profile/onboarding-form.tsx, src/features/profile/profile-editor.tsx,
src/features/profile/foundation-editors.tsx, src/features/profile/foundation-actions.ts,
src/features/profile/onboarding-draft-cleanup.tsx,
src/server/auth/recovery-session.ts, src/server/supabase/database.types.ts,
src/i18n/messages.ts,
tests/unit/session-draft.test.ts, tests/unit/conflict-mapping.test.ts,
tests/unit/operation-key.test.ts, tests/unit/recovery-session.test.ts,
tests/e2e/auth-profile.spec.ts,
supabase/tests/database/foundation.test.sql,
supabase/migrations/20260916170000_t03_foundation_create_idempotency.sql,
docs/decisions/0003-auth-session.md, docs/decisions/0004-foundation-create-idempotency.md,
docs/verification/T03-auth-profile.md, docs/IMPLEMENTATION_STATUS.md.
Daftar T03 baseline sebelumnya tetap dirinci di verification record.

Migration dan keputusan:
Migration 20260916170000_t03_foundation_create_idempotency.sql membuat private
operation ledger dan empat authenticated typed create RPCs. Supabase migration list
menunjukkan versi 20260916170000 pada repository dan database lokal; db push
melaporkan local database up to date. Keputusan transaction/key/hash/error tercatat
di docs/decisions/0004-foundation-create-idempotency.md. `database.types.ts` dihasilkan
ulang dari schema lokal dan dibandingkan dengan output typegen baru; hasilnya identik.

Acceptance checklist serta bukti:
- [x] Draft isolation dan allowlist unit test: tests/unit/session-draft.test.ts.
- [x] Conflict field/date mapping unit test: tests/unit/conflict-mapping.test.ts.
- [x] Create-key UUID/storage unit test: tests/unit/operation-key.test.ts.
- [x] Full pnpm test lulus: 11 files, 43/43 tests.
- [x] Local foundation pgTAP: 117/117 assertions, zero failures, plan 1..117,
      transaction rollback.
- [x] Two-session local PostgreSQL replay check: concurrent second call menunggu
      first commit; kedua call menerima ID sama; satu skill dan satu ledger row.
      Row test dihapus setelah check.
- [x] pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm test, pnpm build,
      pnpm db:lint, pnpm db:test, pnpm db:types, dan pnpm test:e2e:auth lulus.
- [x] Generated `database.types.ts` identik dengan output baru dari schema Supabase
      lokal.
- [x] Auth lokal menggunakan email confirmation (`mailer_autoconfirm=false`); signup,
      verification, recovery, dan update password terbukti melalui Mailpit.
- [x] `pnpm db:reset` dijalankan dari nol pada stack Supabase disposable dengan
      project ID `workpulse-t03-disposable-20260916`; kelima migration dan seed lulus.
      `db:test` (117/117) dan `db:lint` lulus pada database hasil reset. Volume asli
      `supabase_db_WorkPulse` dipertahankan dan stack WorkPulse dinyalakan kembali.

Perintah verifikasi terakhir:
1. pnpm lint — exit 0, zero warnings.
2. pnpm typecheck -- --incremental false — exit 0.
3. pnpm test — exit 0, 11 files / 43 tests.
4. pnpm build — exit 0, production build dan route generation selesai.
5. pnpm db:types — exit 0; output baru dibandingkan dengan
   src/server/supabase/database.types.ts dan identik.
6. pnpm db:test — exit 0, 1 file / 117 assertions, zero failures.
7. pnpm db:lint — exit 0, no schema errors.
8. pnpm test:e2e:auth — exit 0, 1 test passed; 22.1s test / 37.6s total.
9. Supabase Auth `GET /auth/v1/settings` — signup enabled dan
   mailer_autoconfirm=false; confirmation/recovery email ditangkap Mailpit.
10. `pnpm run db:reset -- --local --workdir <disposable project> --yes` — exit 0;
    semua lima migration diterapkan berurutan dan seed dijalankan. Seed assertion
    membuktikan 2 auth users, 2 profil selesai, 1 education, 2 experience, 1 project,
    dan 2 skill fixture. `pnpm run db:test -- --workdir <disposable project>` — exit 0
    (117/117); `supabase db lint --level error` — exit 0.
11. Stack WorkPulse asli dinyalakan kembali; DB/Auth/Kong healthy, lima migration
    masih tercatat, `mailer_autoconfirm=false`, dan volume DB asli tetap ada.
Tidak ada hosted database, production SMTP, atau data akun produksi yang diakses.

Checks yang belum dijalankan beserta alasan:
Hosted SMTP dan redirect configuration tidak diuji; pekerjaan tersebut berada di
luar acceptance lokal T03 dan tidak ada klaim email production siap.

Langkah berikutnya:
Pada checkpoint T03, langkah berikutnya adalah T04. T04 selesai dan dicatat di atas;
task berikutnya saat ini T05. Hosted SMTP tetap menjadi integration item sebelum production.

## Checkpoint T02 (sebelumnya)

Task / tanggal / status:
T02 Schema dasar dan tenant boundary / 16 September 2026 / DONE.

Dependensi DONE:
T01 Bootstrap dan kontrak proyek.

Scope yang selesai:
- Migration foundation untuk profiles, experiences, education, certifications, projects, dan skills beserta dua migration follow-up; auth profile trigger/backfill; partial dates; timezone dari katalog PostgreSQL; normalized skill; owner constraints; indexes; dan RLS.
- Semua update/delete record foundation yang sudah ada melewati RPC revision-checked dan scoped ke `auth.uid()`; grant `UPDATE`/`DELETE` langsung untuk `authenticated` dicabut. Patch profile hanya menerima field editable; onboarding, consent, dan deletion state memiliki operasi sempit.
- Seed deterministik local-only untuk fresh graduate dengan unknown education dates dan employee dengan overlapping experiences.
- Suite pgTAP transaction/rollback untuk schema, constraints, RLS dua akun, revision, direct-mutation rejection, profile lifecycle, timezone catalog, dan atomic deletion.
- Scripts `db:reset`, `db:test`, `db:lint`; README local database workflow; decision 0002; verification record.

File yang berubah:
`supabase/migrations/20260916090000_foundation_schema.sql`, `supabase/migrations/20260916120000_secure_foundation_mutations.sql`, `supabase/migrations/20260916124500_fix_foundation_rpc_row_checks.sql`, `supabase/seed.sql`, `supabase/tests/database/foundation.test.sql`, `package.json`, `README.md`, `docs/decisions/0002-foundation-schema.md`, `docs/verification/T02-foundation-schema.md`, `docs/IMPLEMENTATION_STATUS.md`. Tidak ada dependency baru atau perubahan lockfile.

Migration dan keputusan:
Keputusan ada di [0002-foundation-schema.md](decisions/0002-foundation-schema.md). Profile provisional hanya valid untuk workspace/CV setelah nama nyata dan onboarding timestamp; helper berada di schema `internal` yang tidak diekspos PostgREST. Migration follow-up mengunci update/delete dengan compare-and-swap, mengisolasi state lifecycle, dan menerima timezone yang terdaftar di `pg_timezone_names`. Extension §4 untuk jobs, import, cleanup, evidence, activities/achievements, dan CV tetap pada task terkait.

Acceptance checklist serta bukti:
Implementasi, source mapping, acceptance checklist, dan runtime evidence tercatat di [T02-foundation-schema.md](verification/T02-foundation-schema.md). Baseline PostgreSQL 17 sebelumnya dibangun ulang dengan seed; dua migration review kemudian diterapkan incremental pada database lokal. Seluruh 94 assertion pgTAP lulus dan DB lint melaporkan tidak ada schema error. `db:status` mengonfirmasi `linked_project: null`.

Perintah verifikasi dan hasil aktual:
Pada review follow-up: `pnpm lint` exit 0 · `pnpm typecheck` exit 0 · `pnpm test` exit 0 (3 file, 8/8 test) · `pnpm exec supabase migration up` exit 0 (dua migration baru diterapkan ke DB lokal) · `pnpm db:test` exit 0 (1 file, 94 assertion) · `pnpm db:lint` exit 0 (extensions/internal/public, no schema errors) · `pnpm db:status` exit 0 (`linked_project: null`). `pnpm build` exit 0 pada checkpoint T02 sebelumnya; tidak dijalankan ulang karena perubahan follow-up hanya SQL, pgTAP, dan dokumentasi. Perintah database dan Vitest dijalankan dengan akses proses lokal karena batas child-process/Docker pada shell sandbox; tidak ada database hosted yang diakses.

Checks yang belum dijalankan beserta alasan:
`pnpm db:reset` tidak diulang setelah migration review karena akan mengganti isi database lokal yang sedang dipakai. Base migration dan seed sudah pernah lolos clean reset; dua migration follow-up berhasil diterapkan berurutan dengan `migration up`, lalu pgTAP dan DB lint dijalankan pada database tersebut.

Risiko atau blocker konkret:
Container `supabase_vector_WorkPulse` sebelumnya restart-loop dan `db:status` saat ini juga mencatat `imgproxy` serta `pooler` berhenti; PostgreSQL, API, pgTAP, dan lint yang dipakai T02 tetap berfungsi. T02 tidak bergantung pada layanan tersebut.

Langkah berikutnya:
T02 selesai. Task implementasi berikutnya sesuai tracker adalah T03 (Auth dan profil); T03 belum dimulai pada checkpoint ini.

## Checkpoint T01 (sebelumnya)

Task / tanggal / status:
T01 Bootstrap dan kontrak proyek / 14 September 2026 / DONE.

Dependensi DONE:
Tidak ada (task pertama).

Scope yang selesai:
- Git lokal pada branch `main`, tanpa commit dan tanpa remote, dengan `.gitignore`, `.editorconfig`, `.npmrc` (dependency exact).
- Single-package pnpm project (bukan monorepo) di root: `pnpm@11.19.0` via Corepack, Node 24.18.0, satu `pnpm-lock.yaml`, `save-exact` + `strict-peer-dependencies`.
- Aplikasi Next.js 16.3.5 App Router, React 19.3.0, TypeScript strict, Tailwind CSS 4.3.3 melalui `@tailwindcss/postcss`, halaman root shell tanpa data karier palsu.
- `GET /api/health`: HTTP 200, `Cache-Control: no-store`, body tetap `{"status":"ok","service":"workpulse-web","version":"0.1.0"}`, `force-dynamic`, tanpa probe dependency dan tanpa echo konfigurasi.
- Worker bootstrap satu proses di `workers/`; `pnpm worker:check` mencetak satu baris JSON lalu exit 0. Queue, lease dan job handler tetap milik T13.
- Supabase CLI 2.117.0 diinisialisasi (`supabase/config.toml`), scripts `db:start`, `db:status`, `db:stop` (tanpa `--no-backup`, volume tidak dihapus).
- `.env.example` berisi nama variabel saja tanpa nilai rahasia.
- Quality gate scripts `dev`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `build`, `worker:check`, `db:start`, `db:status`, `db:stop`.
- Unit test Vitest (halaman shell, kontrak health, output worker) dan smoke test Playwright (halaman root + `/api/health`).
- Dokumentasi: `README.md`, `docs/decisions/0001-foundation-stack.md`, `docs/verification/T01-bootstrap.md`.

File yang berubah (semua file baru, tidak ada dokumen sumber atau file pengguna yang ditimpa):
`.npmrc`, `.editorconfig`, `.gitignore`, `.env.example`, `README.md`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/api/health/route.ts`, `workers/bootstrap.ts`, `workers/check.ts`, `tests/unit/home-page.test.ts`, `tests/unit/health-route.test.ts`, `tests/unit/worker-bootstrap.test.ts`, `tests/e2e/smoke.spec.ts`, `supabase/config.toml`, `supabase/.gitignore`, `docs/decisions/0001-foundation-stack.md`, `docs/verification/T01-bootstrap.md`, `IMPLEMENTATION_STATUS.md`. `AGENTS.md`, `Design.md`, `IMPLEMENTATION_PLAN.md` dan dokumen `.docx` tidak diubah.

Migration dan keputusan:
Belum ada migration (T02). Keputusan tercatat di `docs/decisions/0001-foundation-stack.md`: (1) `typescript` 6.0.3, bukan 7.0.2 — `typescript-eslint` menolak TS 7.0, deviasi disetujui pengguna; (2) `eslint` tetap 9.39.1 — 10.10.0 gagal dengan parser bawaan `eslint-config-next`; (3) settings pnpm 11 dipindah ke `pnpm-workspace.yaml` tanpa key `packages`; (4) `"type": "module"` pada package; (5) Tailwind hanya memuat token font, palet/tema menyusul di T04; (6) health endpoint liveness statis; (7) worker bootstrap hanya readiness check; (8) `db:stop` tidak menghapus volume.

Acceptance checklist serta bukti:
- [x] Install bersih dari lockfile — `pnpm install --frozen-lockfile` exit 0 ("Already up to date").
- [x] `pnpm lint` exit 0 tanpa warning.
- [x] `pnpm typecheck` exit 0.
- [x] `pnpm test` exit 0, 8 test lulus (3 file).
- [x] `pnpm build` exit 0; route `/` statis, `/api/health` dinamis.
- [x] Health endpoint pada production build: 200, `no-store`, `application/json`, body sesuai kontrak.
- [x] Smoke test Playwright 2/2 lulus terhadap production build.
- [x] `pnpm db:start` → `pnpm db:status` (setup running) → `pnpm db:stop`; volume `supabase_db_WorkPulse`, `supabase_storage_WorkPulse`, `supabase_edge_runtime_WorkPulse` tetap ada setelah stop.
- [x] Tidak ada `.env.local`, nilai key, credential, atau cache generated pada daftar file Git.
- [x] `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `Design.md`, dan dokumen sumber tidak diubah.
Bukti lengkap dengan perintah dan output: `docs/verification/T01-bootstrap.md`.

Perintah verifikasi dan hasil aktual:
`pnpm install --frozen-lockfile` (exit 0) · `pnpm lint` (exit 0) · `pnpm typecheck` (exit 0) · `pnpm test` (8/8 lulus) · `pnpm build` (exit 0) · `pnpm start --port 3100` + `Invoke-WebRequest /api/health` (200, `no-store`, body kontrak) · `pnpm test:e2e` (2/2 lulus) · `pnpm db:start` (exit 0) · `pnpm db:status` (exit 0, "supabase local development setup is running.") · `pnpm db:stop` (exit 0, volume tetap).

Checks yang belum dijalankan beserta alasan:
- Deployment/hosting dan Supabase hosted: di luar scope T01 dan tidak ada otorisasi atau credential.
- Integration test PostgreSQL, RLS, composite FK, concurrency, PDF: scope T02+ dan belum ada schema.
- `supabase test`/`db reset`: belum ada migration atau seed.
- Playwright hanya Chromium; viewport 360/1440, light/dark dan aksesibilitas adalah acceptance T04.
- Unit test tidak memakai DOM environment; halaman shell dirender ke static markup (`renderToStaticMarkup`). Environment DOM/jsdom belum dibutuhkan.

Risiko atau blocker konkret:
1. `eslint@9.39.1` sudah deprecated/EOL di hulu. Naik ke ESLint 10 baru bisa dilakukan setelah `eslint-config-next` mengirim parser yang kompatibel dengan scope API ESLint 10, atau setelah config berhenti memakai parser Next (berarti `typescript-eslint` menjadi dependency langsung).
2. `typescript` masih 6.0.3 karena `typescript-eslint` belum mendukung TS 7.0 (typescript-eslint#10940). Jadi TypeScript 6 tetap dipakai sampai dukungan TS ≥7.1 ada atau pola side-by-side resmi diterapkan.
3. Container `supabase_vector_WorkPulse` (log collector opsional) sempat restart loop saat stack lokal dinyalakan; stack utama dan `supabase status` tetap sehat. Perlu dipantau pada T02 saat stack dipakai untuk migration.
4. `@types/node` 24.13.4 mengikuti jalur Node 24, sedangkan patch mesin 24.18.0; tidak ada mismatch yang terdeteksi pada `pnpm typecheck`.
5. Belum ada commit Git karena identitas Git belum dikonfigurasi pada environment ini; branch `main` masih kosong tanpa remote.
6. Dependensi besar (Playwright browser, image Docker Supabase) terunduh di level mesin, bukan bagian repository.

Langkah berikutnya:
T02 Schema dasar dan tenant boundary — selesaikan lifecycle profile awal dan extension §4 rencana, buat migration `profiles`, `experiences`, `education`, `certifications`, `projects`, `skills` dengan check partial date, normalisasi skill, index, revision dan RLS, plus fixtures dua akun dan DB test harness. Jalankan Docker Desktop sebelum `pnpm db:start`.

## Format checkpoint per task

Salin format berikut ketika task dikerjakan:

```text
Task / tanggal / status:
Dependensi DONE:
Scope yang selesai:
File yang berubah:
Migration dan keputusan:
Acceptance checklist serta bukti:
Perintah verifikasi dan hasil aktual:
Checks yang belum dijalankan beserta alasan:
Risiko atau blocker konkret:
Langkah berikutnya:
```


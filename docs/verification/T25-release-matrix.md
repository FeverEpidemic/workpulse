# T25 Matriks acceptance rilis (R01–R10, skenario rilis, PRD §4)

- Tanggal: 10 Oktober 2026. Status: **Fase 1, draf audit**; kolom "Run Fase 8" diisi pada Fase 8.
- Sumber: `docs/WorkPulse_PRD_v0.1.docx` §2, §3, §4, §5 dan `docs/WorkPulse_Wireframe_Screen_by_Screen_v0.1.docx` (diekstrak ulang dari `word/document.xml`), `docs/IMPLEMENTATION_PLAN.md` §6 dan blok T25.
- Nama test dikutip dari source: `tests/integration/*.test.ts`, `tests/e2e/*.spec.ts`, `tests/unit/*.test.ts`, `supabase/tests/database/*.test.sql`. Jenis: **U** unit, **P** pgTAP, **I** integration (PostgreSQL nyata), **E** E2E (Playwright, build produksi).
- Status: **tercakup** (acceptance dibuktikan oleh test yang ada), **sebagian** (sebagian dibuktikan, sisanya jadi defect), **gap** (tanpa test). Setiap *sebagian*/*gap* punya defect `D<n>` (daftar di bagian akhir).
- Kolom "Run terakhir": **Fase 0** berarti suite itu dijalankan ulang di baseline Fase 0 (unit 114/1041, pgTAP 18/1577, product-events 9, account-deletion 14). Suite lain lulus pada receipt task asalnya (T10–T24, Gate M2–M4) dan **dijalankan ulang di Fase 8**; Fase 1 tidak menjalankannya.

## 1. R01–R10 (PRD §2)

| ID | Acceptance condition (ringkas) | Test yang menjalankan | Jenis | Run terakhir | Status |
| --- | --- | --- | --- | --- | --- |
| R01 | Sign in, sign out, recovery, locale, session expiry | `e2e/auth-profile.spec.ts` › "email auth, onboarding, profile recovery, conflict recovery, and foundation ownership" (kirim tautan recovery → `/update-password`, tombol Sign out, `locale` id/en, draft bertahan setelah session expiry); `unit/recovery-session.test.ts`, `unit/auth-errors.test.ts`, `unit/auth-routing.test.ts` | E, U | Fase 0 (unit); E2E Fase 8 | tercakup |
| R01 | Akun lain tidak dapat membaca atau mengubah record atau file apa pun | Tersebar per domain: `foundation.test.sql`, `activity.test.sql`, `evidence.test.sql`, `ai_jobs.test.sql`, `import_staging.test.sql`, `cv_*.test.sql`; I: `activity-persistence` › "enforces two-account ownership and denies direct table mutations", `evidence-backend` › "rejects client lifecycle writes, foreign parents and cross-account reads", `ai-jobs` › "11. another account cannot read, request or retry A's jobs", `import-staging` › "13. two-account isolation for views, actions, items and private columns", `cv-selection` › "isolates accounts, denies direct writes…", `cv-builder` › "does not let another account edit or see this CV", `cv-export` › "isolates owners…", `m4-cv-output` › "12. isolation…", `m2-cross-domain` › "8. account B cannot read, count, filter, mutate or deep-link account A records", `account-deletion` › "rejects user RPCs of every domain with 42501…" | P, I | Fase 0 (account-deletion) | **sebagian** (D1, D2) |
| R02 | Staging, edit, pilih, satu commit atomik, retry tanpa duplikat | `import-commit` › "1. Indonesian CV with overlapping employment: edit, map, confirm once…", "2. three parallel commits…", "3. one invalid selected item rolls everything back…"; `import-staging` › "8. idempotent upload…", "11. retry on the same batch…"; `e2e/import-review.spec.ts` › "R02 release scenario…", "double click on Confirm import and reloading…"; `import_commit.test.sql`, `import_staging.test.sql` | P, I, E | Fase 8 | tercakup |
| R03 | Aktivitas terbaru, project aktif, hitungan achievement terkonfirmasi, skill, completeness checks; setiap item membuka sumbernya | `dashboard-timeline` › "returns owner-scoped Dashboard counts and executes its canonical filter links", "paginates authenticated skill and missing-evidence filter results…", "updates check counts immediately after evidence becomes ready…"; `cv-freshness` › "reports the dashboard CV checks with separate counts…"; `e2e/dashboard-timeline.spec.ts`, `e2e/cv-freshness.spec.ts` › "the dashboard shows the two CV checks…"; `unit/dashboard-links.test.ts`, `unit/dashboard-service.test.ts`; `dashboard_timeline.test.sql` | P, I, E, U | Fase 8 | tercakup |
| R04 | Quick note cukup teks tidak kosong + tanggal; structured menambah konteks; Chat menyimpan catatan sebelum AI | `activity-persistence` › "persists raw text exactly, creates Chat history atomically, and accepts the Unicode limit", "deduplicates concurrent create retries…"; `ai-jobs` › "1. without consent nothing is queued and the manual path still confirms"; `e2e/activity-ui.spec.ts` › "Activity capture, list, detail, context, and revision recovery…"; `unit/activity-validation.test.ts`, `unit/activity-date.test.ts`; `activity.test.sql` | P, I, E, U | Fase 8 | tercakup |
| R05 | AI menyarankan, ≤ 3 pertanyaan opsional per revisi; sumber disimpan; hanya konfirmasi eksplisit yang membuat draft eligible | `unit/detect-result.test.ts` › "four questions" (ditolak); `ai-review` › "1. main flow: request, succeed, apply creates zero achievements until reviewed…", "2. a succeeded job with no review action creates or changes no achievement", "6. an edit while queued and while running makes the job stale…", "11a/11b…"; `ai-jobs` › "4./5." (stale); `cv-selection` › "keeps drafts out of the pool and the CV until they are confirmed"; `e2e/ai-review.spec.ts` (11 test, termasuk "S08 a newer suggestion never overwrites an edited draft") | U, I, E | Fase 8 | tercakup |
| R06 | Create/edit project, tautan activity/achievement ke ≤ 1 project, standalone didukung | `project-context` › "creates standalone and completed Projects…", "derives context on attach, preserves it on detach, propagates Project edits, and deletes with a receipt"; `m2-cross-domain` › "2./4."; `e2e/projects-ui.spec.ts`; `project.test.sql` | P, I, E | Fase 8 | tercakup |
| R07 | Lampiran privat dalam kuota, validasi tipe/ukuran, unduh/hapus butuh kepemilikan, tidak dikirim ke AI | `evidence-backend` › "serializes competing last-slot uploads…", "serializes the 50 MiB account boundary…"; `evidence-pipeline` › "rejects MIME spoofing…", "real malware screening prevents ready…"; `evidence-lifecycle`; `private-storage` › "authorizes two accounts, returns an attachment URL, blocks direct access, and enforces expiry"; `e2e/evidence-api.spec.ts` › "…enforce quarantine, ownership and CSRF"; `unit/ai-minimize.test.ts` (nama file sentinel tidak dikirim); `m4-cv-output` › "7. evidence … never reaches the snapshot or the PDF" | I, E, U | Fase 8 | tercakup |
| R08 | Periode perusahaan/role, awal project, tanggal achievement terkonfirmasi, pendidikan, project standalone; tanpa karier fiktif | `dashboard-timeline` › "groups canonical career events, precision dates, unknown dates, and owner-safe deep links"; `unit/timeline-build.test.ts`, `unit/partial-date.test.ts`; `m2-cross-domain` › "5. reopening a confirmed Achievement removes it from counts and Timeline…"; `e2e/dashboard-timeline.spec.ts` | I, U, E | Fase 0 (unit) | tercakup |
| R09 | Pilih/urutkan, edit ringkasan dan kata, refresh sumber bisa ditinjau | `cv-selection` (10 test), `cv-builder` (7), `cv-freshness` (11), `m4-cv-output` › "3. override, source edit, refresh and Replace…"; `e2e/cv-builder.spec.ts` (8), `e2e/cv-freshness.spec.ts` (11); `cv_selection/cv_builder/cv_freshness.test.sql` | P, I, E | Fase 8 | tercakup |
| R10 | Export revisi tersimpan, A4 searchable, page break benar, gagal menjaga draft dan bisa retry, evidence tidak disematkan | `cv-export` › "exports a ready CV end to end…", "render failures keep the CV, retry the same snapshot, stop after three attempts…", "renders the snapshot, not the career rows…"; `cv-export-renderer-real` › "paginates a long CV into several A4 pages…"; `m4-cv-output` › "11. a long Indonesian CV with long bullets exports to several searchable A4 pages…"; `pnpm test:pdf`; `e2e/cv-export.spec.ts` (12 test), `e2e/m4-cv-journey.spec.ts` | I, E | Fase 8 | tercakup |

Aturan validasi bersama (PRD §2 *Shared validation*): `partial-date.test.ts`, `profile-validation.test.ts`, `project-validation.test.ts`, `activity-validation.test.ts`, konflik revisi per domain (`conflict-mapping.test.ts`, "…returns an actionable revision conflict" di `activity-persistence`, `e2e/cv-builder.spec.ts` › "a stale save in a second session…"). Tercakup.

## 2. Enam skenario rilis PRD dan empat skenario lintas subsistem

| # | Skenario | Rangkaian test | Status |
| --- | --- | --- | --- |
| 1 | Import CV Indonesia dengan masa kerja tumpang tindih, koreksi, konfirmasi sekali, tanpa duplikat saat retry | I `import-commit` › "1. Indonesian CV with overlapping employment: edit, map, confirm once, then commit atomically and idempotently" + "2. three parallel commits…"; E `import-review.spec` › "R02 release scenario: …shown on dashboard and timeline (keyboard only)" | tercakup |
| 2 | Graduate tanpa CV dan employment: education + project akademik, hasil, konfirmasi, export CV berguna | I `cv-export` › "graduate scenario: no employment still exports a useful CV; skills alone are blocked"; I `cv-builder` › "lets a graduate without employment compose a CV…"; E `cv-builder.spec` › "graduate journey: first open is empty, records are added, moved with the keyboard…"; E `cv-export.spec` › "graduate journey with the keyboard: select, save, open S14, export with the real renderer…"; E `m2-manual-journey` (note → project → achievement). Tidak ada satu test UI yang memulai dari onboarding sampai PDF; rangkaian di atas menutup setiap langkah | tercakup (rangkaian) |
| 3 | Note saat AI unavailable, edit, retry, output basi tidak menimpa | I `ai-jobs` › "10. an unavailable provider fails the job and an explicit retry succeeds later", "4./5." stale; I `ai-review` › "4. AI_UNAVAILABLE fails the job with retry…", "6. an edit while queued and while running makes the job stale…"; E `ai-review.spec` › "S06 provider outage offers Retry and manual creation; Retry recovers", "S06 editing the note while a job is queued marks the result stale"; E `m3-assisted-journey` | tercakup (rangkaian) |
| 4 | Dua upload bersamaan di batas kuota, hapus lampiran, URL dicabut bila didukung dan kedaluwarsa ≤ 5 menit | I `evidence-backend` › "serializes competing last-slot uploads and preserves idempotency", "serializes the 50 MiB account boundary…"; I `m2-cross-domain` › "7. deleting the only ready evidence restores the check and closes new download URLs"; I `private-storage` › "…enforces expiry"; I `cv-export` › "…signed URL of at most five minutes" | tercakup (rangkaian) |
| 5 | Edit achievement terpilih setelah override, refresh tanpa kehilangan override, hapus sumber, export terblokir | I `cv-freshness` › "edits a selected achievement after manual wording, refreshes without losing the override, keeps per revision, then reports the deletion"; I `cv-export` › "release scenario: an edited source blocks export until Keep saved wording, a deleted source blocks until the item is removed"; E `cv-export.spec` › "release scenario: deleting a selected source blocks the export with a link to the item…"; E `m4-cv-journey` | tercakup |
| 6 | Uji kepemilikan setiap tabel dan path storage dengan dua akun; ekstraksi teks PDF, karakter Indonesia, bullet panjang, multipage | PDF: I `m4-cv-output` › "11. a long Indonesian CV with long bullets…", I `cv-export-renderer-real`, `pnpm test:pdf`. **Kepemilikan setiap tabel dan path storage: tersebar per domain, tidak ada suite yang membaca katalog** | **sebagian** (D1, D2) |
| X1 | Export bersamaan mutasi sumber | I `cv-export` › "renders the snapshot, not the career rows: an edit after the request does not reach the PDF", "is not affected by a source edit that lands after rendering but before completion"; I `m4-cv-output` › "9. an edit and a CV save after the request do not reach the export…" | tercakup |
| X2 | Consent withdrawal | I `m3-assisted-entry` › "2. consent withdrawal stops a queued import extraction and a queued analysis…", "2b. consent withdrawn while a provider call is in flight discards the result…"; I `ai-jobs` › "6."; E `ai-consent.spec` | tercakup |
| X3 | Lease expiration | I `cv-export` › "lease: a worker that loses its lease cannot complete and removes its own object; the job times out and a retry succeeds…"; I `import-staging` › "10. cancel while queued, during parsing, and during AI; late completions write nothing"; I `evidence-backend` › "reclaims abandoned reservations…" | tercakup |
| X4 | Cleanup setelah penghapusan akun | I `account-deletion` › "never marks a receipt completed while an object or an open cleanup job is left", "requeues a failed cleanup job for a key of the deleted account, reports the backlog, and finishes", "resumes after a crash…" (3 test); `retention` (3 test); `account_deletion.test.sql`, `retention.test.sql` | tercakup |

## 3. PRD §4 (keandalan dan validasi rilis)

| Area | Perilaku wajib | Bukti yang ada | Status |
| --- | --- | --- | --- |
| Privacy | Akses owner-scoped untuk setiap tabel, relasi, operasi worker, permintaan file; kunci AI server-side; tanpa profil publik atau tautan berbagi | Lihat R01 (tersebar). Kunci AI: `ai-jobs` › "12. the worker process never prints source text or the API key", `unit/supabase-admin-config.test.ts`. Tanpa profil publik/tautan berbagi: tidak ada route semacam itu di §Phase 0 inventaris (tidak ada test yang mengunci ketiadaannya). **Tidak ada pemeriksaan bahwa bundle browser bebas dari rahasia server.** | **sebagian** (D1, D2, D6) |
| AI disclosure | Penjelasan sebelum aksi AI pertama; versi dan waktu persetujuan dicatat; menolak menyisakan manual | `e2e/ai-consent.spec.ts` (2), `ai-jobs` › "1.", `ai_jobs.test.sql`, `import-staging` › "6. consent: none before upload, withdrawn before extraction, then retry" | tercakup |
| File safety | Validasi signature/MIME/ukuran/kepemilikan, karantina sampai malware lolos, URL ≤ 5 menit, tanpa pratinjau inline dokumen aktif | `evidence-pipeline` (5), `evidence-scanner-real` (2), `evidence-http.test.ts`, `evidence-file-inspection.test.ts`, `e2e/evidence-api.spec.ts`; ClamAV nyata tersedia lokal | tercakup |
| Data minimization | Kirim hanya teks yang perlu; file evidence tidak dikirim; file import dan staging dihapus ≤ 24 jam sesudah commit/batal/gagal | `unit/ai-minimize.test.ts`, `import-staging` › "12. terminal retention purges text, items and the object while keeping minimal metadata", `retention` (3), `import-commit` › "7. after commit the purge clears staged text…", `product-events` › "keeps private text, file names, ids and emails out of every event column…" | tercakup (lokal; ≤ 24 jam pada hosted belum terukur) |
| Failures | AI dan export punya status queued/running/succeeded/failed, timeout 120 detik, retry eksplisit, tanpa job ganda | `ai-jobs` (12), `cv-export` › "never creates a second job…", "lease:…", `import-staging` › "11.", `cv_export.test.sql`, `ai_jobs.test.sql` | tercakup |
| Performance | p95 baca < 2 detik, simpan < 1 detik pada dataset 1.000/200/50 | T24 `pnpm test:perf` (`docs/verification/T24-phase5-p95.md`): baca maksimum 169,8 ms, simpan 121,3 ms. Satu mesin, loopback; staging belum diukur (T24 G5) | tercakup lokal; staging **tidak diukur** (blocker B1) |
| Usability | Kontrol dapat dioperasikan keyboard, focus terlihat, error berlabel, kontras terbaca, layout 360 dan 1440 px, isi form dipertahankan setelah save gagal | 19 spec memakai `expectNoWcagViolations`/viewport (lihat Phase 0); error berlabel `expectEveryFieldErrorAssociated`. **Belum ada**: matriks S01–S14 × 360/1440 × light/dark dalam satu suite, perhitungan kontras token, journey keyboard penuh, teks 200%, snapshot accessibility tree | **sebagian** (D3, D4, D5) |
| Deletion | Hapus record menampilkan pratinjau tautan; akun: sesi dicabut seketika, data aktif dan objek ≤ 24 jam, backup kedaluwarsa ≤ 30 hari | `account-deletion` (11), `account_deletion.test.sql`, `e2e/account-deletion.spec.ts` (4), `projects-ui.spec`, `m2-cross-domain` (1–3). **Backup ≤ 30 hari tidak diverifikasi** (T23 runbook §3); prosedur replay setelah restore hanya rancangan, tanpa test | sebagian (D8, blocker B2) |

## 4. Cakupan layar (S01–S14) pada suite yang ada

Axe WCAG A/AA, overflow, tema, dan viewport pada spec yang ada. Pemetaan ini berdasarkan nama spec dan route yang dikunjungi (`expectNoWcagViolations`, `setViewportSize`, `colorScheme`); Fase 4 memverifikasinya per layar sebelum menulis matriks baru:

| Layar | Spec yang menyentuhnya | Catatan |
| --- | --- | --- |
| S01 sign-in | `auth-profile`, `app-frame` | tidak ada pemeriksaan 360/1440 × light/dark yang eksplisit |
| S02 | `import-onboarding` (layouts 360/1440 light/dark) | |
| S03 | `import-review` (layouts 360/1440 light/dark), `account-deletion` | |
| S04 | `dashboard-timeline`, `app-frame`, `cv-freshness` | layar kosong dan berisi |
| S05, S06 | `activity-ui`, `ai-review` (layouts), `app-frame` | |
| S07, S08 | `achievements-ui`, `ai-review`, `evidence-ui` | |
| S09, S10 | `projects-ui`, `evidence-ui` | |
| S11 | `dashboard-timeline` | |
| S12 | `account-deletion` (states 360/1440 light/dark), `ai-consent`, `auth-profile` | |
| S13 | `cv-builder` (layout/theme), `cv-freshness` | |
| S14 | `cv-export` (accessibility, responsive, themes) | |

Tidak ada satu suite yang menyatakan matriks lengkap, jadi tidak ada penjaga yang gagal bila layar baru ditambahkan tanpa pemeriksaan. Itu isi Fase 4.

## 5. Daftar defect dan keputusan fase

| ID | Prio | Temuan | Fase tujuan |
| --- | --- | --- | --- |
| D1 | P2 | Tidak ada penjaga katalog. pgTAP memeriksa RLS, grant, dan `search_path` per domain dengan daftar tulisan tangan; tabel `public` baru, fungsi `security definer` tanpa `search_path`, privilege `anon`, tabel `internal` dengan grant API, atau bucket publik tidak membuat suite gagal. | Fase 2 (`release_catalog.test.sql`) |
| D2 | P2 | Isolasi dua akun tidak sistematis: tidak ada suite yang membaca katalog untuk setiap tabel `public`, RPC ber-ID, path storage, route unduh, dan RPC worker. Skenario rilis 6 dan R01 bergantung padanya. | Fase 2 (`release-ownership.test.ts`) |
| D3 | P2 | Tidak ada pemeriksaan kontras token terhadap tema light/dark (hanya Axe pada halaman yang disampel). | Fase 4 (`theme-contrast.test.ts`) |
| D4 | P2 | Tidak ada matriks S01–S14 × 360/1440 × light/dark, tanpa pemeriksaan teks 200%, tanpa snapshot accessibility tree sebagai proxy screen reader. | Fase 4 (`release-a11y.spec.ts`) |
| D5 | P2 | Tidak ada journey keyboard tanpa mouse dari sign-in sampai preview, dan tidak ada pemeriksaan focus indicator terukur serta focus kembali ke pemicu untuk semua dialog. | Fase 4 (`release-keyboard.spec.ts`) |
| D6 | P2 | Tidak ada pemeriksaan bahwa bundle `.next/static` tidak memuat kunci atau nama variabel rahasia server. | Fase 4 (tes di `release-a11y.spec.ts`, memakai build suite itu) |
| D7 | P2 | Pemberitahuan event produk di S12 belum ada (keputusan T24 §2.4.2 menundanya ke T25; disetujui §2.4.3). | Fase 4 |
| D8 | P2 | Prosedur penghapusan ulang setelah restore (T23 runbook §4) hanya rancangan; tidak ada test yang menunjukkan `begin_account_deletion` dapat dipanggil ulang untuk akun "dipulihkan". Tidak ada alert operasional untuk backlog selain `get_account_deletion_backlog`. | Fase 2 (`release-restore.test.ts`), Fase 3 (`ops:check`) |
| O1 | P3 | 13 fungsi `internal` dapat dieksekusi `anon` lewat default `PUBLIC`; tanpa `USAGE` skema. | Dicatat (Fase 0) |
| O2 | P3 | `supabase_vector_WorkPulse` restart-loop lokal. | Dicatat |
| O3 | P3 | Database lokal berisi 229 profil (akun bocor suite lama). `ops:check` dapat melaporkan non-nol dari data lama. | Dicatat; tidak dibersihkan |
| O4 | P3 | Auth lokal membatasi `sign_in_sign_ups = 30` per 5 menit per IP (T23 F9). Matriks E2E memakai satu akun per spec dan `storageState` agar tidak terkena batas. | Desain Fase 4 |

### Penilaian ulang P3 lama (§2.3)

| P3 lama | Penilaian terhadap PRD | Hasil |
| --- | --- | --- |
| T24 G1 (`p_as_of` lampau) | Diperbaiki oleh `20261011100000_t24_pilot_metrics_as_of.sql` (PR #16, masuk lewat merge Fase 0). | **Tertutup** |
| T24 G5 (batas metode perf) | Staging tidak tersedia. | Tetap P3, bergantung Fase 7 (B1) |
| T24 G7 (N+1 `get_cv_review_summary`; `loadSkills` terpotong `max_rows = 1000`) | Dataset PRD 200 achievement di bawah 1.000; `get_cv_review_summary` 38,7 ms. Tidak melanggar acceptance. | Tetap P3 |
| T23 F6 (retensi backup ≤ 30 hari tidak terverifikasi; access token berlaku sampai `exp`) | Klaim PRD §4 *Deletion* belum terbukti. | Bukan defect kode; **blocker B2** di release checklist |
| T23 F9 (rate limit Auth lokal) | Mempengaruhi desain E2E T25. | O4 |

### Blocker rilis (bukan defect kode)

| ID | Blocker | Penutup |
| --- | --- | --- |
| B1 | Staging belum disediakan: integrasi nyata (Auth email, scanner, renderer, p95) tidak terverifikasi. | Fase 7, bergantung pengguna |
| B2 | Retensi backup ≤ 30 hari dan replay penghapusan setelah restore belum terverifikasi pada proyek hosted. | Fase 7 §retensi; release checklist |
| B3 | Otorisasi deploy production, domain, `WORKPULSE_SITE_URL`, SMTP Auth nyata. | Pengguna/operator |

## 6. Kolom Run Fase 8

Diisi pada Fase 8 dengan hasil aktual per suite (exit code dan angka pass/fail). Sampai itu, baris di atas hanya membuktikan bahwa test **ada dan relevan**, bukan bahwa test lulus hari ini.

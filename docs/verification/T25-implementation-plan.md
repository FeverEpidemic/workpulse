# Handoff T25 Regression, aksesibilitas dan release handoff — eksekusi single-agent

> **Untuk agen pelaksana:**
> - Kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai.
> - Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Untuk test penjaga (guard) yang langsung lulus pada kode sekarang, buktikan test itu **dapat gagal** dengan pelanggaran sintetis (lihat §2.2.4) sebelum commit.
> - Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.
> - Semua nama migration, fungsi SQL, kode error, script, port, dan path di dokumen ini **dibekukan**; jangan mengganti namanya.
> - Migration bersifat forward-only. Migration yang sudah diterapkan tidak boleh diedit. Jangan pernah `db:reset` database lokal aktif.
> - Jangan deploy ke environment apa pun tanpa otorisasi tertulis pengguna di chat untuk environment itu.

- Tanggal: 10 Oktober 2026
- Status saat plan ditulis: **TODO**. Status plan: **DONE** (20 Oktober 2026, [decision 0034](../decisions/0034-t25-staging-closeout.md)).
- Dependensi:
  - T24 **DONE** (10 Oktober 2026): `internal.product_events`, `get_pilot_metrics`, `pnpm test:perf`, decision 0030. P3 terbuka G1, G2, G5, G7.
  - T23 **DONE**: `get_account_deletion_backlog`, runbook retensi dengan dua klaim *belum terverifikasi* (backup ≤ 30 hari, replay penghapusan setelah restore).
  - Gate M4 **PASSED**, Gate M3 **PASSED**, Gate M2 **PASSED**.
  - CI01 (GitHub Actions) **belum dieksekusi**; `.github/` tidak ada. Bukan dependensi T25.
- Eksekutor: satu agent **Claude Sonnet 5.5** (pola T23/T24). Bila pengguna menunjuk eksekutor lain, ikuti pengguna.
- Reviewer: **Claude** (Opus). Checkpoint Claude setelah Fase 1 **wajib** (daftar gap acceptance menentukan isi Fase 2–5). Gate review read-only wajib setelah Fase 8; Fase 9 (draft dokumen) dikerjakan setelah gate.
- Keputusan produk: pengguna **menyetujui** (10 Oktober 2026, "Setuju semua") keenam keputusan §2.4 sesuai rekomendasi. Semuanya dibekukan; pelaksana tidak perlu menanyakannya ulang. Staging belum disediakan saat persetujuan, jadi Fase 7 berstatus BLOCKED kecuali pengguna kemudian menyediakan environment dan otorisasi.
- Mode antislop: **during** (dipilih pengguna untuk sesi plan ini, 10 Oktober 2026). Setiap perubahan UI atau copy di T25 mengikuti `.claude/skills/antislop/SKILL.md`, `antislop-human`, `antislop-layoutmobile`, dan `antislop-copywriting`, termasuk Delivery Gate dan Human Skill Checklist.
- Acuan:
  - **PRD §2** R01–R10 (acceptance condition per requirement) dan *Shared validation*.
  - **PRD §4** *Privacy*, *File safety*, *Failures*, *Usability* (keyboard, focus terlihat, error berlabel, kontras terbaca, layout 360 px dan 1440 px, form tetap terisi setelah save gagal), *Deletion* (backup kedaluwarsa ≤ 30 hari), *Release scenarios* (enam skenario).
  - **PRD §5** M5 *Pilot*: exit gate "All R01–R10 conditions pass; no critical privacy or data loss defects".
  - **`IMPLEMENTATION_PLAN.md`:** blok T25 dan Gate M5 (§5 M5), §6 matriks verifikasi, §8 baris *Worker host, storage retention dan backup policy* dan *Production domain/hosting/secret provisioning*.
  - **`AGENTS.md`:** *UI dan aksesibilitas* (WCAG 2.2 AA, 360/1440 light/dark), *Verifikasi*, langkah 7 (lokal bukan bukti production).
  - **Decision:** 0001 (stack), 0029 (penghapusan, tombstone, receipt 30 hari), 0030 (event, keputusan §2.4.2 yang menunda kalimat pemberitahuan event ke T25).
  - **Runbook:** `T10-scanner-runbook.md`, `T15-renderer-runbook.md`, `T21-pdf-renderer-runbook.md`, `T23-retention-runbook.md` §3–§4, `T24-pilot-metrics-runbook.md`.

**Goal:** WorkPulse v0.1 punya bukti rilis yang dapat diaudit: setiap R01–R10 dan keenam skenario rilis PRD ditelusuri ke test yang benar-benar dijalankan; isolasi dua akun dibuktikan untuk setiap tabel milik pengguna, path storage, dan RPC worker lewat suite yang membaca katalog (bukan daftar tulisan tangan); aksesibilitas dan layout diperiksa pada matriks layar × 360/1440 px × light/dark; migration dibangun ulang dari nol di stack sekali pakai; operator punya runbook deploy/migrate/worker/rollback/restore, daftar env, health check, alert backlog, dan release checklist. Integrasi nyata diverifikasi di staging **hanya bila** pengguna menyediakan environment dan otorisasi; tanpa itu T25 berakhir **PARTIAL** dengan blocker yang jelas, bukan DONE.

**Architecture:** T25 terutama task verifikasi. Perubahan kode dibatasi pada:

- **Satu migration** `20261012090000_t25_operational_health.sql` (parity 34 → **35**): RPC service-role `get_operational_health()` yang mengembalikan hitungan backlog tanpa konten.
- **Satu pass operasional** `workers/ops-check.ts` (script baru `ops:check`) yang membaca RPC itu, membandingkan dengan ambang, dan keluar non-zero bila ada alert. Cocok dipanggil cron atau monitor eksternal.
- **Suite penjaga rilis:** pgTAP `release_catalog.test.sql`, integration `release-ownership.test.ts`, unit `theme-contrast.test.ts`, E2E `release-a11y.spec.ts` dengan config sendiri.
- **Satu kalimat copy S12** (pemberitahuan event produk tanpa konten), en dan id.
- **Perbaikan defect** yang ditemukan Fase 1–5, masing-masing dengan test gagal lebih dulu. Defect P0–P2 diperbaiki di T25; P3 dicatat.

**Tech stack:** Supabase PostgreSQL (plpgsql, pgTAP), Vitest (unit, integration), Playwright + `@axe-core/playwright` (sudah terpasang, `tests/e2e/helpers/accessibility.ts`), Supabase CLI devDependency untuk stack rebuild sekali pakai, Node 24 untuk `ops:check`. Tidak ada dependency npm baru.

---

## 0. Cara memakai handoff ini

**Urutan baca.** Baca dokumen ini sampai selesai sebelum mengubah apa pun, lalu:

1. `AGENTS.md` (*Batas MVP*, *Invariant data dan keamanan*, *UI dan aksesibilitas*, *Verifikasi*).
2. Entry teratas `docs/IMPLEMENTATION_STATUS.md` (T24, T23, Gate M4).
3. `docs/IMPLEMENTATION_PLAN.md` §1, §3, blok M5, §6, §8.
4. `docs/verification/T23-retention-runbook.md` dan `T24-pilot-metrics-runbook.md`.
5. `docs/verification/M4-gate-review-plan.md` sebagai pola audit acceptance, dan `T24-implementation-plan.md` sebagai pola fase database + integration.
6. Skill antislop: core, `antislop-human`, `antislop-layoutmobile`, `antislop-copywriting` (path di `CLAUDE.md`).

Ekstrak ulang PRD §2, §4, §5 dan Wireframe S01–S14 (route dan state) dengan alat ekstraksi DOCX (`python -I` + `zipfile` atas `word/document.xml`; `python-docx` tidak terpasang). Jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R01:** sign in, sign out, recovery, pilihan locale, dan session expiry berfungsi. Akun lain tidak dapat membaca atau mengubah record atau file apa pun.
- **PRD Usability:** kontrol dapat diakses keyboard, focus terlihat, error berlabel, kontras terbaca, layout 360 px dan 1440 px; isi form bertahan setelah save gagal.
- **PRD Deletion:** penghapusan akun mencabut sesi seketika, menghapus data aktif dan objek ≤ 24 jam, dan backup kedaluwarsa ≤ 30 hari.
- **PRD Release scenarios:** (1) import CV Indonesia dengan masa kerja tumpang tindih, koreksi, konfirmasi sekali, tanpa duplikat saat retry; (2) graduate tanpa CV dan employment sampai export CV yang berguna; (3) note saat AI unavailable, edit, retry, output basi tidak menimpa; (4) dua upload bersamaan di batas kuota, hapus lampiran, URL dicabut bila didukung dan kedaluwarsa ≤ 5 menit; (5) edit achievement terpilih setelah override, refresh tanpa kehilangan override, hapus sumber, export terblokir; (6) uji kepemilikan setiap tabel dan path storage dengan dua akun, ekstraksi teks PDF, karakter Indonesia, bullet panjang, multipage.
- **PRD M5:** semua kondisi R01–R10 lulus; tidak ada defect privasi atau kehilangan data yang kritis.
- **Rencana T25:** jalankan matriks §6, production build, clean migration rebuild, dua akun untuk seluruh tabel/storage/worker, responsive 360/1440 light/dark, pemeriksaan keyboard/screen reader, scan kontras. Buat runbook deploy/migrate/worker/rollback/restore, daftar env, health check, alert failed jobs/cleanup backlog, release checklist. Jangan rollback dengan menghapus data pengguna; forward fix bila schema sudah berisi data. Selesai jika R01–R10 lulus dengan bukti, tidak ada defect kritis, dan integrasi nyata diverifikasi di staging. Jangan menyebut production live hanya karena lokal lulus.
- **Rencana Gate M5:** target pilot 60/40/30/98% baru dievaluasi dari 20 pengguna pilot; bukan syarat sebelum pilot.

**Aturan kerja:**

- Pertahankan perubahan lokal pengguna.
- Jangan menandai T25 DONE, jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`, dan jangan menulis verdict Gate M5.
- Pada akhir setiap fase, tulis **receipt** di `docs/verification/T25-phaseN-<slug>.md` berisi:
  - tujuan dan file berubah;
  - command beserta hasil aktual (exit code dan angka pass/fail);
  - acceptance yang terbukti;
  - warning/kegagalan, defect yang ditemukan beserta prioritas, dan blocker;
  - langkah berikutnya.
- Setiap defect diberi ID `D<n>` dan prioritas P0–P3 menurut §9. Defect P0–P2 diperbaiki di fase tempat ditemukan atau fase yang ditunjuk §5, selalu dengan test gagal lebih dulu.

## 1. Acceptance inti T25

T25 lulus hanya jika setiap poin berikut dibuktikan dengan hasil nyata:

1. **Matriks R01–R10 tertelusur.** `docs/verification/T25-release-matrix.md` memetakan setiap acceptance condition PRD §2 dan setiap baris rencana §6 ke test nyata (`file` + nama test + jenis: pgTAP/unit/integration/E2E/PDF) dan ke hasil run Fase 8. Tidak ada baris tanpa test kecuali ditandai *gap* dengan defect ID. Dibuktikan dokumen + review reviewer.
2. **Enam skenario rilis PRD.** Setiap skenario punya satu test atau rangkaian test bernama yang menjalankan seluruh skenario, bukan potongannya. Skenario yang belum tertutup ditambah test di Fase 2 atau Fase 4. Dibuktikan matriks §1.1 + run Fase 8.
3. **Katalog database aman.** pgTAP membaca katalog dan gagal bila:
   - tabel di skema `public` tanpa RLS;
   - tabel `public` ber-`user_id` tanpa trigger `zz_guard_account_writable` (sudah ada di T23; ditegaskan ulang lintas seluruh tabel);
   - privilege tabel apa pun untuk `anon`;
   - tabel skema `internal` dengan privilege untuk `anon`, `authenticated`, atau `service_role`;
   - fungsi `security definer` di `public` atau `internal` tanpa `search_path` yang diset;
   - fungsi `public` yang dapat dieksekusi `anon` di luar allowlist yang dicatat di test (dengan alasan per fungsi);
   - bucket Storage `public = true`.

   Setiap pemeriksaan dibuktikan dapat gagal dengan objek pelanggar sintetis dalam transaksi yang di-rollback. Dibuktikan pgTAP.
4. **Isolasi dua akun untuk setiap tabel.** Integration memakai daftar tabel dari katalog (bukan daftar tetap). Untuk setiap tabel `public` ber-`user_id`, akun B lewat PostgREST `authenticated`:
   - `select` baris A → nol baris;
   - `update` dan `delete` baris A → nol baris terdampak, baris A utuh;
   - `insert` dengan `user_id` A → ditolak.

   Tabel yang tidak dapat diisi untuk A lewat jalur sah dicatat dengan alasan, dan suite gagal bila tabel baru muncul tanpa fixture atau alasan. Dibuktikan `pnpm test:integration:release`.
5. **Isolasi RPC.** Untuk setiap RPC `public` yang menerima ID record, panggilan B dengan ID milik A menghasilkan error yang sama dengan ID acak (tidak membocorkan keberadaan). Daftar RPC dibaca dari katalog; RPC tanpa parameter ID dicatat. Dibuktikan integration.
6. **Isolasi storage dan worker.** B tidak dapat membuat signed URL, mengunduh, menimpa, atau menghapus objek di prefix A untuk kategori evidence, import, dan export; route `/api/evidence/[id]/download`, `/api/cv/exports/[id]`, dan `/api/imports/[id]` milik A mengembalikan respons yang sama dengan ID acak untuk B. RPC worker (`claim_*`, `complete_*`, `fail_*`) tidak dapat dipanggil `authenticated`. Dibuktikan integration.
7. **Kontras token terukur.** Unit test membaca token warna dari `src/app/globals.css` untuk tema light dan dark, lalu menghitung rasio WCAG untuk daftar pasangan pemakaian nyata (teks utama, teks sekunder, teks pada tombol primer, link, error, status, border input, focus ring) yang dibekukan di test. Teks normal ≥ 4,5:1, teks besar dan non-teks ≥ 3:1. Pasangan yang gagal menjadi defect. Dibuktikan `pnpm test`.
8. **Matriks aksesibilitas dan layout.** Untuk setiap layar di §6 (S01–S14 yang dapat dicapai) × viewport 360×800 dan 1440×900 × tema light dan dark:
   - axe WCAG 2.2 A/AA tanpa pelanggaran (`expectNoWcagViolations`);
   - tidak ada scroll horizontal dokumen (`scrollWidth <= clientWidth`);
   - satu `h1`, landmark `main`, dan `lang` sesuai locale;
   - screenshot tersimpan di `docs/verification/T25-screenshots/`.

   Dibuktikan `pnpm test:e2e:release` + screenshot.
9. **Keyboard dan focus.** Journey keyboard tanpa mouse: sign-in → Quick log → simpan activity → buka achievement → konfirmasi → CV → preview. Drawer mobile dan setiap dialog (delete bernama, unsaved, konflik revisi, penghapusan akun) dibuka dengan Enter/Space, ditutup dengan Escape, dan focus kembali ke pemicu. Focus indicator terlihat (outline tidak `none` dan kontras ≥ 3:1) pada setiap elemen yang difokus di journey. Dibuktikan E2E.
10. **Teks 200%.** Pada 360 dan 1440 px dengan `font-size` root 200%, layar S04, S05, S08, S13 tidak memotong teks (`scrollWidth <= clientWidth` per elemen teks yang dipilih) dan tidak menambah scroll horizontal dokumen. Dibuktikan E2E.
11. **Proxy screen reader + pemeriksaan manual.** Snapshot accessibility tree (`locator.ariaSnapshot()`) untuk S04, S05, S08, S13, S14 disimpan dan dikunci di E2E (nama tombol, label field, status live region). Pemeriksaan screen reader nyata (NVDA di Windows) mengikuti checklist §6.4 dan dicatat sebagai **dijalankan** hanya bila dilakukan manusia; bila tidak, dicatat **belum dijalankan** di laporan. Dibuktikan snapshot E2E + checklist.
12. **Pemberitahuan event di S12.** Detail privasi S12 memuat satu kalimat (en dan id) bahwa WorkPulse mencatat jenis aksi tanpa isinya untuk mengukur keandalan produk. Unit parity i18n lulus; E2E S12 menampilkan kalimat itu; copy lolos antislop-copywriting. Dibuktikan unit + E2E.
13. **Health operasional.** `get_operational_health()` (service role saja) mengembalikan hitungan tanpa konten (§3.1). `pnpm ops:check` keluar 0 bila semua di bawah ambang, 2 bila ada alert, 1 bila konfigurasi atau backend tidak tersedia; keluaran hanya nama metrik, angka, dan ambang. Dibuktikan pgTAP + unit + satu run nyata terhadap stack lokal.
14. **Clean migration rebuild.** Semua 35 migration diterapkan dari nol pada stack Supabase sekali pakai (§2.2.6), lalu `supabase test db` lulus di stack itu dan `gen types` identik dengan `database.types.ts`. Stack aktif tidak disentuh. Dibuktikan receipt Fase 5.
15. **Production build.** `pnpm build` lulus, `pnpm start` melayani `/api/health` 200 dengan payload `workpulse-web`, dan `pnpm worker:check` lulus dengan konfigurasi `unavailable` (fail-closed) maupun dengan renderer/scanner nyata. Dibuktikan receipt Fase 5.
16. **Runbook dan checklist.** `T25-release-runbook.md` dan `T25-release-checklist.md` ada dengan isi §3.4. Setiap env var di `.env.example` muncul di daftar env runbook, dan sebaliknya. Dibuktikan unit `release-docs.test.ts` (perbandingan nama variabel) + review.
17. **Backup dan restore jujur.** Runbook restore mengikuti §2.2.9. Klaim backup ≤ 30 hari ditandai **terverifikasi** hanya bila Fase 7 mencatat paket, retensi, tautan dokumentasi resmi, dan tanggal akses dari proyek hosted. Bila tidak, release checklist memuat item pemblokir production yang terbuka. Dibuktikan dokumen + review.
18. **Staging (bersyarat).** Bila pengguna menyediakan environment staging dan otorisasi: migration diterapkan, web dan worker berjalan, dan smoke §5 Fase 7 lulus (auth email nyata, scanner, renderer PDF, export, penghapusan akun, `ops:check`, p95 baca/simpan). Bila tidak tersedia, Fase 7 dicatat **BLOCKED** dan status rekomendasi T25 adalah **PARTIAL**. Dibuktikan receipt Fase 7.
19. **Tanpa regresi.** Seluruh suite T02–T24 dan Gate M2/M3/M4 lulus tanpa melemahkan assertion. Dibuktikan regresi penuh Fase 8.
20. **Privasi output.** Tidak ada sentinel, email fixture, password, atau key di receipt, screenshot, snapshot aria, keluaran `ops:check`, atau runbook. Dibuktikan grep Fase 8.

## 2. Scope dan keputusan

### 2.1 Dalam scope

- Audit acceptance dan matriks rilis.
- Migration `get_operational_health`, pgTAP katalog dan health, regenerasi tipe.
- Integration isolasi lintas tabel, RPC, storage, worker.
- Unit kontras token, parity env/runbook, ambang `ops:check`.
- E2E matriks aksesibilitas/layout, keyboard, teks 200%, snapshot aria.
- Kalimat S12 (en/id).
- Perbaikan defect P0–P2 yang ditemukan, dengan test.
- Clean rebuild di stack sekali pakai, production build.
- Runbook rilis, release checklist, decision 0031, laporan verifikasi, README.
- Staging (Fase 7) hanya dengan environment dan otorisasi pengguna.

### 2.2 Keputusan implementasi yang dibekukan

1. **T25 bukan task fitur.** Perubahan perilaku hanya untuk memperbaiki defect yang melanggar PRD/rencana, kalimat S12 (§2.4.3), dan `get_operational_health`/`ops:check`. Refactor, optimasi, dan perapian di luar itu dicatat P3.
   - *Alasan:* rilis membutuhkan perubahan sekecil mungkin setelah regresi penuh.
2. **Penjaga berbasis katalog, bukan daftar tulisan tangan.** pgTAP dan integration membaca `pg_class`, `pg_policies`, `information_schema`, `pg_proc`, dan `storage.buckets`. Pengecualian ditulis eksplisit di test dengan alasan satu baris.
   - *Alasan:* tabel atau RPC baru setelah T25 otomatis tercakup; daftar statis basi diam-diam.
3. **Integration isolasi memakai fixture lewat jalur sah.** Data akun A dibuat lewat service/RPC (dan helper yang sudah ada: `tests/integration/cv-export-support.ts`, `account-deletion-support.ts`), bukan INSERT superuser, kecuali tabel yang hanya ditulis worker (dicatat). Akun dibersihkan lewat `begin_account_deletion` + `runUntilCompleted` karena `admin.deleteUser` langsung gagal untuk akun dengan experience + project (lihat catatan T24 Fase 0).
4. **Bukti test penjaga dapat gagal.** pgTAP: dalam `begin … rollback`, buat tabel `public` tanpa RLS, fungsi `security definer` tanpa `search_path`, atau bucket publik, lalu pastikan fungsi pemeriksa melaporkannya. Integration dan unit: jalankan fungsi pemeriksa terhadap input sintetis yang melanggar. E2E matriks: satu test unit atas helper overflow dengan DOM sintetis. Bukti dicatat di receipt.
5. **Matriks aksesibilitas memakai satu config baru** `playwright.release.config.ts`, port **3017** (port 3000–3016 sudah dipakai), `next build && next start` seperti config lain, `workers: 1`. Akun fixture dibuat per suite dan dibersihkan.
6. **Clean rebuild di stack sekali pakai.** Salin `supabase/` ke direktori scratch di luar repo, ganti `project_id` menjadi `workpulse-t25-rebuild` dan port ke blok 55320–55329 (`api` 55321, `db` 55322, `shadow` 55320, `pooler` 55329, `studio` 55323, `inbucket` 55324), jalankan `supabase start --workdir <scratch>` (tanpa seed tambahan), `supabase test db --workdir <scratch>`, `supabase gen types typescript --local --schema public --workdir <scratch>` lalu bandingkan dengan `src/server/supabase/database.types.ts`, kemudian `supabase stop --no-backup --workdir <scratch>`. Sebelum mulai, periksa `netsh int ipv4 show excludedportrange protocol=tcp`; bila blok 55320–55329 tereservasi, pilih blok 56320–56329 dan catat.
   - *Alasan:* rencana mewajibkan rebuild bersih, AGENTS melarang `db:reset` database aktif.
7. **Health tanpa endpoint web baru.** `/api/health` tetap liveness tanpa dependency (kontrak `src/app/api/health/route.ts:13-19`). Readiness dan backlog dibaca operator lewat `ops:check` dengan service role dari host worker, sehingga endpoint publik tidak membuka info internal.
8. **Ambang alert dibekukan** (dapat diubah env, default di kode):

   | Metrik | Ambang alert default | Env |
   | --- | --- | --- |
   | `account_deletion_overdue` (lewat 24 jam) | > 0 | `WORKPULSE_ALERT_DELETION_OVERDUE` |
   | `storage_cleanup_failed` | > 0 | `WORKPULSE_ALERT_CLEANUP_FAILED` |
   | `storage_cleanup_overdue` (queued/running > 24 jam) | > 0 | `WORKPULSE_ALERT_CLEANUP_OVERDUE` |
   | `import_purge_overdue` (terminal > 24 jam, belum dipurge) | > 0 | `WORKPULSE_ALERT_IMPORT_PURGE_OVERDUE` |
   | `export_purge_overdue` (sukses > 24 jam, belum dipurge) | > 0 | `WORKPULSE_ALERT_EXPORT_PURGE_OVERDUE` |
   | `evidence_stuck` (`uploading`/`scanning` > 1 jam) | > 0 | `WORKPULSE_ALERT_EVIDENCE_STUCK` |
   | `jobs_failed_24h` (AI, import, export gagal 24 jam terakhir) | > 20 | `WORKPULSE_ALERT_JOBS_FAILED_24H` |
   | `jobs_expired_lease` (running dengan lease habis > 10 menit) | > 0 | `WORKPULSE_ALERT_JOBS_EXPIRED_LEASE` |

   Nama kolom status dan tabel harus diverifikasi di Fase 0 terhadap migration nyata; bila satu metrik tidak dapat dihitung dari kolom yang ada, **stop** dan laporkan (jangan menambah kolom).
9. **Restore tanpa ledger terpisah.** Receipt `internal.account_deletions` disimpan 30 hari setelah `completed` (decision 0029), sama dengan batas retensi backup yang dijanjikan. Jadi sebelum restore, operator mengekspor user id dengan `requested_at` setelah titik restore dari database **yang sedang berjalan**, lalu setelah restore memanggil `begin_account_deletion` untuk setiap id. Syaratnya: retensi backup ≤ 30 hari terverifikasi. Bila retensi backup lebih panjang, prosedur ini tidak cukup dan release checklist memblokir restore produksi tanpa persetujuan pemilik produk. Integration membuktikan bahwa `begin_account_deletion` dapat dipanggil ulang untuk akun yang "dipulihkan" (fixture: akun dengan data, receipt dihapus superuser untuk mensimulasikan restore) dan menyelesaikan penghapusan.
10. **Rollback = forward fix.** Runbook: rollback aplikasi berarti deploy ulang build sebelumnya, hanya bila migration sejak build itu kompatibel mundur (aditif). Migration yang sudah berisi data tidak di-revert; perbaikan lewat migration baru. Tidak ada langkah yang menghapus data pengguna.
11. **Staging bersifat bersyarat.** Pelaksana tidak membuat akun cloud, tidak menempel key di chat, dan tidak deploy tanpa otorisasi tertulis. Key staging hanya disebut nama variabelnya dan dibaca dari env proses.
12. **Nomor:**
    - Migration `supabase/migrations/20261012090000_t25_operational_health.sql` (parity **35/35**).
    - pgTAP `supabase/tests/database/release_catalog.test.sql`, `supabase/tests/database/operational_health.test.sql`.
    - Integration `tests/integration/release-ownership.test.ts`, `tests/integration/release-restore.test.ts`; script baru `test:integration:release`.
    - Unit `tests/unit/theme-contrast.test.ts`, `tests/unit/ops-check.test.ts`, `tests/unit/release-docs.test.ts`.
    - E2E `tests/e2e/release-a11y.spec.ts`, `tests/e2e/release-keyboard.spec.ts`, config `playwright.release.config.ts`; script baru `test:e2e:release`.
    - Worker `workers/ops-check.ts`; script baru `ops:check`.
    - Decision `docs/decisions/0031-t25-release-handoff.md`.
    - Dokumen `docs/verification/T25-release-matrix.md`, `T25-release-runbook.md`, `T25-release-checklist.md`, `T25-release-handoff.md`, `T25-screenshots/`.

### 2.3 Di luar scope

- **Gate M5:** integration review milestone dan verdict ditulis terpisah setelah T25 (`M5-gate-review-plan.md`), hanya oleh Claude.
- **CI01:** workflow GitHub Actions tetap task terpisah (`CI01-implementation-plan.md`). Release checklist boleh merujuknya sebagai rekomendasi.
- **Production deploy:** tidak dilakukan di T25. Runbook menyiapkannya; publish production butuh otorisasi terpisah.
- **Evaluasi target pilot** (60/40/30/98%): pasca-pilot, lewat runbook T24.
- **P3 lama:** T24 G1 (`p_as_of` lampau), G7 (N+1 `get_cv_review_summary`, `loadSkills` terpotong `max_rows = 1000`), T23 F4/F6/F9, kebocoran akun suite lama. Dicatat ulang di laporan; diperbaiki hanya bila audit Fase 1 menaikkannya ke P2 dengan bukti.
- **Bukan v0.1:** fitur roadmap `Design.md`, SDK analitik, dashboard metrik di aplikasi, status page publik, readiness endpoint publik.

### 2.4 Keputusan produk yang sudah disetujui pengguna (10 Oktober 2026)

Keenamnya disetujui sesuai rekomendasi (pilihan pertama di setiap poin). Catat persetujuan ini di receipt Fase 0 dan lanjutkan tanpa bertanya ulang. Bila implementasi menuntut penyimpangan dari salah satunya, **stop** (§8).

1. **Staging.** *Rekomendasi:* T25 menyiapkan semuanya secara lokal dan runbook; Fase 7 dijalankan hanya bila pengguna menyediakan proyek Supabase hosted + host web + host worker dan memberi otorisasi tertulis. Tanpa itu, T25 ditutup **PARTIAL** dengan blocker "staging belum tersedia", dan Gate M5 tidak dapat PASSED. Alternatif:
   - pengguna menyediakan staging sekarang (sebutkan penyedia; Fase 7 menjadi wajib);
   - menerima T25 **DONE (lokal)** dengan staging dipindah ke task release terpisah (menyimpang dari kalimat selesai rencana, harus dicatat di decision 0031).
2. **Screen reader.** *Rekomendasi:* proxy otomatis (snapshot aria) dikunci di E2E, ditambah checklist NVDA §6.4 yang dijalankan pengguna atau penguji manusia; laporan menulis **belum dijalankan** bila tidak ada yang menjalankannya. Alternatif: menganggap snapshot aria cukup (lebih lemah dari rencana).
3. **Kalimat pemberitahuan event di S12.** *Rekomendasi:* tambah satu kalimat di detail privasi S12, draf en: "WorkPulse records which actions happen, such as saving an activity or exporting a CV, without their content, to measure how reliably the product works." Draf id: "WorkPulse mencatat jenis aksi yang terjadi, seperti menyimpan aktivitas atau mengekspor CV, tanpa isinya, untuk mengukur keandalan produk." Pelaksana boleh memperhalus lewat antislop-copywriting tanpa mengubah makna. Alternatif: tidak menambah kalimat; transparansi hanya lewat formulir persetujuan pilot (keputusan T24 §2.4.2 berlaku permanen).
4. **Copy backup S12** (`account.delete.privacy`, `src/i18n/messages.ts:33,1095`) yang menjanjikan backup dihapus dalam 30 hari. *Rekomendasi:* copy tidak diubah di T25; release checklist memblokir production sampai Fase 7 atau operator memverifikasi retensi ≤ 30 hari. Alternatif: melunakkan copy sekarang ("…sesuai jadwal retensi backup penyedia") sampai terverifikasi.
5. **Alert.** *Rekomendasi:* `ops:check` + ambang §2.2.8, dijalankan cron/monitor di host worker; integrasi notifikasi (email, Slack) di luar T25 dan cukup ditulis di runbook sebagai langkah operator. Alternatif: tambahkan pengiriman notifikasi di T25 (butuh credential dan keputusan kanal).
6. **Defect yang ditemukan di T25.** *Rekomendasi:* P0–P2 diperbaiki di T25 dengan test; bila satu perbaikan butuh lebih dari satu migration baru atau mengubah kontrak RPC lama, **stop** dan minta keputusan. Alternatif: semua defect dicatat dan diperbaiki di task remediasi terpisah.

Persetujuan pengguna: **tercatat** — 10 Oktober 2026, "Setuju semua".

## 3. Kontrak teknis

### 3.1 Migration `20261012090000_t25_operational_health.sql`

- `public.get_operational_health(p_now timestamptz default pg_catalog.now()) returns table (metric text, value integer)`; `security definer`, `stable`, `set search_path = pg_catalog`, grant execute hanya ke `service_role`, `comment on function` berlabel `T25`.
- Satu baris per metrik §2.2.8, urutan tetap seperti tabel. Hanya hitungan; tanpa user id, email, nama, key objek, atau teks error bebas.
- `account_deletion_overdue` memakai definisi yang sama dengan `get_account_deletion_backlog` (`20261009090000_t23_account_deletion.sql`; baris diverifikasi di Fase 0) agar dua angka tidak berbeda.
- Tidak mengganti fungsi T02–T24.

### 3.2 `workers/ops-check.ts`

- Membaca `SUPABASE_URL` dan `SUPABASE_SECRET_KEY` dari env (pola `workers/bootstrap.ts`), memanggil RPC, membandingkan dengan ambang (default §2.2.8, override env integer ≥ 0; nilai env tidak valid → exit 1 dengan kode `OPS_CONFIG_INVALID`).
- Keluaran satu baris JSON: `{"status":"ok"|"alert"|"unavailable","metrics":[{"metric","value","threshold","alert"}]}`. Tanpa URL, key, atau stack trace.
- Exit code: 0 ok, 2 alert, 1 unavailable/config invalid.
- Logika ambang dipisah ke fungsi murni yang diuji `tests/unit/ops-check.test.ts`.
- Script: `ops:check` → `node --env-file-if-exists=.env.local workers/ops-check.ts`.

### 3.3 Test

- `release_catalog.test.sql`: fungsi bantu dalam test (bukan migration) yang mengembalikan pelanggaran per aturan §1.3; assertion `is_empty` untuk katalog nyata dan `isnt_empty` untuk objek sintetis dalam blok rollback.
- `operational_health.test.sql`: grant (`authenticated`/`anon` ditolak), urutan dan nama metrik, setiap metrik naik tepat 1 dengan fixture yang dimundurkan waktunya, dan nol kolom selain `metric`/`value`.
- `release-ownership.test.ts`: §1.4–1.6. Fixture A lengkap (§6.1). Laporan per tabel/RPC/route ditulis ke attachment test, bukan stdout.
- `release-restore.test.ts`: §2.2.9.
- `theme-contrast.test.ts`: parser token sederhana untuk blok `:root`/`html[data-theme="dark"]` di `globals.css` dan daftar pasangan dibekukan; format warna yang tidak dapat diparse → test gagal dengan nama token (jangan diam-diam dilewati).
- `release-docs.test.ts`: nama variabel `.env.example` (termasuk yang dikomentari `# NAME=`) = nama variabel di tabel env `T25-release-runbook.md`, plus env ambang §2.2.8.
- `release-a11y.spec.ts`: matriks §1.8, §1.10, §1.11. `release-keyboard.spec.ts`: §1.9, §1.12.

### 3.4 Isi dokumen rilis

`T25-release-runbook.md`:

1. Topologi: web (Next.js `next start`), worker long-running (`worker:run`), Supabase hosted (DB, Auth, Storage privat), ClamAV T10, Gotenberg T15 (DOCX), Gotenberg T21 (PDF) di jaringan privat; AI provider eksternal opsional.
2. Daftar env per proses (web/worker), sumber nilai, rahasia atau publik, default fail-closed.
3. Deploy: urutan migrate → worker → web; `supabase db push` ke proyek hosted dengan verifikasi `migration list` parity; build dari lockfile.
4. Worker: proses tunggal atau beberapa instance (claim atomik aman), restart, graceful stop, `worker:check`.
5. Health: `/api/health` (liveness), `worker:check`, `ops:check` beserta ambang dan tindakan per metrik (merujuk `T23-retention-runbook.md` §2).
6. Rollback: §2.2.10.
7. Backup dan restore: §2.2.9, langkah verifikasi retensi dari `T23-retention-runbook.md` §3.
8. Insiden privasi: cabut key, rotasi secret, catat tanpa menyalin data pengguna.

`T25-release-checklist.md`: item bercentang dengan pemilik (pelaksana, reviewer, operator, pemilik produk) dan bukti; item pemblokir production ditandai **BLOCKER** (minimal: staging Fase 7, retensi backup, otorisasi deploy, domain dan `WORKPULSE_SITE_URL`, SMTP Auth nyata, scanner nyata, renderer nyata, AI mode dan consent wording).

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20261012090000_t25_operational_health.sql` |
| Create | `supabase/tests/database/release_catalog.test.sql`, `supabase/tests/database/operational_health.test.sql` |
| Modify | `src/server/supabase/database.types.ts` (`pnpm db:types`; harapan satu fungsi `public` baru) |
| Create | `workers/ops-check.ts` |
| Create | `tests/integration/release-ownership.test.ts`, `tests/integration/release-restore.test.ts` |
| Create | `tests/unit/theme-contrast.test.ts`, `tests/unit/ops-check.test.ts`, `tests/unit/release-docs.test.ts` |
| Create | `tests/e2e/release-a11y.spec.ts`, `tests/e2e/release-keyboard.spec.ts`, `playwright.release.config.ts` |
| Modify | `src/i18n/messages.ts` (kalimat S12 en/id), komponen detail privasi S12 bila kalimat butuh elemen baru |
| Modify (bersyarat) | file `src/` atau `workers/` yang terkait defect P0–P2, masing-masing tercatat di receipt |
| Modify | `package.json` (tiga script baru), `.env.example` (env ambang, dikomentari), `README.md` (Fase 9) |
| Create | `docs/verification/T25-release-matrix.md` (Fase 1, diperbarui Fase 8), `T25-screenshots/` |
| Create | `docs/verification/T25-release-runbook.md`, `T25-release-checklist.md` (Fase 6) |
| Create (Fase 9) | `docs/decisions/0031-t25-release-handoff.md`, `docs/verification/T25-release-handoff.md` |

Script baru:

- `test:integration:release` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/release-ownership.test.ts tests/integration/release-restore.test.ts`
- `test:e2e:release` → `playwright test --config playwright.release.config.ts`
- `ops:check` → `node --env-file-if-exists=.env.local workers/ops-check.ts`

## 5. Fase eksekusi

### Fase 0 — Baseline dan inventaris (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD (harapan `3c16211` atau turunannya, termasuk commit plan ini). Working tree harus bersih kecuali `.claude/`; jika tidak, **stop**.
- [ ] Siapkan environment:
  - `pnpm install --frozen-lockfile`;
  - `pnpm exec supabase migration list --local`: parity harus **34/34** dengan migration terakhir `20261011090000_t24_product_events.sql`;
  - container ClamAV T10, Gotenberg T15, `workpulse-t21-pdf` hidup (runbook masing-masing).
- [ ] Jalankan baseline dengan harapan berikut:

  | Command | Harapan |
  | --- | --- |
  | `pnpm lint`, `pnpm typecheck`, `pnpm worker:check` | lulus |
  | `pnpm test` | 114 file / 1041 test |
  | `pnpm db:test` | 18 file / 1573 assertion |
  | `pnpm test:integration:product-events` | 9 test |
  | `pnpm test:integration:account-deletion` | 14 test |

- [ ] Inventaris dari source (catat file:baris):
  - **Route S01–S14** ke URL nyata dari `src/app/**/page.tsx` (mis. S04 `/dashboard`, S06 `/activity`, S13 `/cv`, S14 `/cv/preview`, S03 `/imports/[id]/review`, S12 `/settings/profile`). Layar yang tidak punya route sendiri (mis. dialog) dicatat bersama layar induknya.
  - **Tabel `public` ber-`user_id`** (harapan 17 + `profiles`, sesuai katalog guard T23) dan tabel `internal`.
  - **RPC `public`** beserta role yang dapat mengeksekusi; tandai yang menerima ID record.
  - **Bucket** (`workpulse-private`, `supabase/config.toml:119`) dan prefix kategori.
  - **Kolom status dan waktu** untuk setiap metrik §2.2.8 (`storage_jobs`, `import_batches`, `cv_exports`, `evidence_files`, `ai_jobs`, `internal.account_deletions`) dan definisi `get_account_deletion_backlog`.
  - **Cakupan aksesibilitas yang ada:** spec yang memanggil `expectNoWcagViolations` dan viewport/tema yang dipakai (19 spec memakai helper aksesibilitas atau viewport).
  - **Token warna** di `src/app/globals.css` untuk light dan dark.
- [ ] Periksa `netsh int ipv4 show excludedportrange protocol=tcp` untuk blok port §2.2.6.
- [ ] Catat di receipt bahwa pengguna menyetujui §2.4 (10 Oktober 2026), dan apakah environment staging sudah disediakan sejak itu.
- [ ] Tulis receipt `docs/verification/T25-phase0-baseline.md`, commit `docs(t25): add phase 0 baseline receipt`.

### Fase 1 — Audit acceptance dan matriks rilis (tanpa edit kode)

- [ ] Ekstrak ulang PRD §2/§4/§5 dan Wireframe S01–S14.
- [ ] Tulis `docs/verification/T25-release-matrix.md`:
  - tabel R01–R10: acceptance condition PRD → test (`file` › nama test, jenis) → run terakhir yang tercatat → status (*tercakup*, *sebagian*, *gap*);
  - tabel enam skenario rilis PRD dan empat skenario lintas subsistem rencana §6 (export bersamaan mutasi sumber, consent withdrawal, lease expiration, cleanup setelah penghapusan akun);
  - tabel PRD §4 (*Privacy*, *AI disclosure*, *File safety*, *Data minimization*, *Failures*, *Performance*, *Usability*, *Deletion*).
- [ ] Setiap *gap* atau *sebagian* menjadi defect `D<n>` dengan prioritas dan fase tujuan (Fase 2 untuk isolasi/database, Fase 4 untuk UI/aksesibilitas, atau P3 follow-up).
- [ ] Nilai ulang P3 lama (§2.3) terhadap PRD; naikkan ke P2 hanya dengan bukti pelanggaran acceptance.
- [ ] Commit `docs(t25): add release acceptance matrix`, tulis receipt Fase 1. **Checkpoint Claude** sebelum Fase 2: serahkan matriks dan daftar defect.

### Fase 2 — Penjaga katalog dan isolasi dua akun (TDD)

- [ ] `release_catalog.test.sql` (§1.3, §3.3) termasuk bukti dapat gagal. Pelanggaran nyata yang ditemukan = defect; perbaikan butuh migration → **stop** dan laporkan kecuali sudah disetujui lewat §2.4.6.
- [ ] `release-ownership.test.ts` (§1.4–1.6) dengan fixture §6.1. Jalankan, catat jumlah tabel/RPC/route yang diuji dan pengecualian beserta alasan.
- [ ] `release-restore.test.ts` (§2.2.9).
- [ ] Test untuk gap skenario rilis yang ditugaskan ke Fase 2 oleh Fase 1.
- [ ] Tambah script `test:integration:release`. Jalankan suite itu, `pnpm db:test`, `pnpm db:lint`.
- [ ] Commit `test(t25): add catalog guards and two-account isolation`, receipt Fase 2.

### Fase 3 — Health operasional (TDD)

- [ ] pgTAP `operational_health.test.sql` gagal lebih dulu.
- [ ] Migration §3.1, terapkan dengan `pnpm exec supabase migration up --local` (parity **35/35**). `pnpm db:test`, `pnpm db:lint`, `pnpm db:types`, `pnpm typecheck`.
- [ ] Unit `ops-check.test.ts` gagal lebih dulu, lalu `workers/ops-check.ts` dan script `ops:check`. Tambah env ambang ke `.env.example` (dikomentari).
- [ ] Run nyata `pnpm ops:check` terhadap stack lokal; catat exit code dan keluaran (sudah dipastikan tanpa rahasia). Bila ada metrik ≠ 0 akibat akun bocor suite lama, catat apa adanya; jangan "membersihkan" data agar hijau tanpa mencatatnya.
- [ ] Commit `feat(t25): add operational health report and ops check`, receipt Fase 3.

### Fase 4 — Aksesibilitas, responsive, dan copy S12 (TDD)

- [ ] Unit `theme-contrast.test.ts` (§1.7). Pasangan yang gagal = defect; perbaikan token mengikuti `Design.md` dan antislop-human, dengan screenshot sebelum/sesudah.
- [ ] `playwright.release.config.ts` (port 3017), `release-a11y.spec.ts` (§1.8, §1.10, §1.11), `release-keyboard.spec.ts` (§1.9). Jalankan dan catat pelanggaran sebagai defect sebelum memperbaiki apa pun.
- [ ] Kalimat S12 (§2.4.3) dengan unit parity i18n dan assertion E2E gagal lebih dulu. Jalankan antislop-copywriting atas kalimat final.
- [ ] Perbaiki defect P0–P2 Fase 1 dan Fase 4 yang berada di UI, satu commit per defect: `fix(t25): <ringkas>`, test gagal lebih dulu.
- [ ] Jalankan Delivery Gate antislop dan Human Skill Checklist untuk setiap layar yang diubah; catat jawaban di receipt.
- [ ] Tambah script `test:e2e:release`. Jalankan `pnpm test:e2e:release`, `pnpm test`, `pnpm lint`, `pnpm typecheck`.
- [ ] Simpan screenshot matriks ke `docs/verification/T25-screenshots/` (nama `<screen>-<width>-<theme>.png`; tanpa email atau sentinel terlihat).
- [ ] Commit `test(t25): add accessibility and responsive release matrix` (dan commit fix terpisah), receipt Fase 4.

### Fase 5 — Clean rebuild dan production build

- [ ] Clean rebuild §2.2.6. Catat: jumlah migration diterapkan (harapan 35), hasil `supabase test db` di stack rebuild (harapan sama dengan stack aktif: 20 file), diff tipe (harapan kosong), lalu stop stack rebuild. Pastikan stack aktif tetap 35/35 dan hidup.
- [ ] `pnpm build`, lalu `pnpm start` pada port bebas dan `GET /api/health` → 200, payload `{"status":"ok","service":"workpulse-web",…}`, header `Cache-Control: no-store`. Hentikan server.
- [ ] `pnpm worker:check` dua kali: env default (`unavailable` semua) dan env renderer/scanner nyata lokal. Catat ringkasan worker (tanpa key).
- [ ] Receipt `docs/verification/T25-phase5-rebuild-build.md`, commit `docs(t25): add phase 5 rebuild and build receipt`.

### Fase 6 — Runbook dan release checklist

- [ ] `T25-release-runbook.md` dan `T25-release-checklist.md` sesuai §3.4. Copy runbook ringkas, kalimat pendek, tanpa janji yang belum terverifikasi.
- [ ] Unit `release-docs.test.ts` gagal lebih dulu (runbook belum memuat semua env), lalu lengkapi tabel env sampai lulus.
- [ ] Commit `docs(t25): add release runbook and checklist`, receipt Fase 6.

### Fase 7 — Staging (bersyarat §2.4.1)

Kerjakan hanya bila pengguna menyediakan environment dan menulis otorisasi di chat untuk environment itu. Bila tidak, tulis receipt `T25-phase7-staging.md` berstatus **BLOCKED** dengan daftar kebutuhan konkret, lalu lanjut ke Fase 8.

- [ ] Catat penyedia, region, paket Supabase, dan versi build (tanpa key, tanpa URL internal yang sensitif).
- [ ] `supabase db push` ke proyek staging; `migration list` parity 35/35.
- [ ] Deploy worker lalu web sesuai runbook; `/api/health` 200; `worker:check` dengan adapter nyata.
- [ ] Smoke dengan akun uji staging yang dibuat untuk T25 (bukan akun pribadi):
  - signup + verifikasi email nyata, recovery, sign-out;
  - capture activity, confirm achievement, upload evidence dengan scanner nyata sampai `ready`;
  - export CV dengan renderer nyata, unduh PDF, ekstraksi teks cocok;
  - AI hanya bila pengguna menyetujui pemakaian key di staging;
  - penghapusan akun sampai `completed`, `ops:check` exit 0;
  - p95 baca/simpan dengan `WORKPULSE_PERF_OUT` ke file staging terpisah (bila dataset staging boleh di-seed; jika tidak, catat tidak dijalankan).
- [ ] Retensi backup: ikuti `T23-retention-runbook.md` §3; catat paket, retensi, tautan, tanggal akses, pemeriksa.
- [ ] Bersihkan akun uji staging lewat jalur penghapusan; catat nol sisa.
- [ ] Receipt `T25-phase7-staging.md`, commit `docs(t25): add staging verification receipt`.

### Fase 8 — Regresi penuh

- [ ] Jalankan seluruh §7. `test:e2e:m2` dan `test:e2e:m3` dengan env AI dikosongkan (`AI_AGENT`, `ANTHROPIC_BASE_URL`). Jangan menjalankan dua suite E2E bersamaan. `test:perf` dijalankan sendirian. Flaky dicatat flaky hanya bila lulus saat diulang tanpa perubahan.
- [ ] Perbarui kolom "run Fase 8" di `T25-release-matrix.md` dengan hasil aktual.
- [ ] Diff dan hygiene:
  - `git diff <HEAD Fase 0> -- supabase/migrations` hanya migration §2.2.12;
  - `git diff <HEAD Fase 0> --stat` hanya file §4 dan file defect yang tercatat;
  - grep sentinel, email fixture, `sb_secret_`, `eyJ` di `docs/verification/T25-*` dan `T25-screenshots/` (nama file) nihil;
  - `git diff --check <HEAD Fase 0>..HEAD`.
- [ ] Bersihkan fixture; catat nol akun `t25-*` tersisa.
- [ ] Receipt `T25-phase8-regression.md`, commit `test(t25): record regression receipt`. Serahkan ke Claude: hash commit, receipt Fase 0–8, matriks, daftar defect dan statusnya, acceptance yang belum terbukti.

### Fase 9 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0031-t25-release-handoff.md`: keputusan §2.2, jawaban §2.4, alasan penjaga berbasis katalog, prosedur restore tanpa ledger dan syaratnya, ambang alert, status staging.
- [ ] `docs/verification/T25-release-handoff.md`: pass/fail/warning/tidak dijalankan per poin §1, trace ke R01–R10, enam skenario, PRD §4, dan status klaim T23 (*backup*, *restore*) yang diperbarui.
- [ ] Perbarui `T23-retention-runbook.md` §1 hanya bila Fase 7 memberi bukti baru.
- [ ] README: tiga script baru, `ops:check`, tautan runbook rilis.
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

### 6.1 Akun integration

- **A dan B** (`t25-release-<uuid>@example.test`), password acak per run (`randomBytes`, tidak dicetak). A punya minimal satu baris di setiap tabel `public` ber-`user_id` yang dapat diisi lewat jalur sah: profile, experience, education, certification, skill, project, activity (+ chat), achievement (+ skill, metric), evidence `ready` (scanner fake hanya di integration, ditandai), import batch + item, AI job, CV + item + export `succeeded`, consent.
- **Sentinel privat:** `WP-PRIVATE-T25-SENTINEL-<uuid>` di raw activity, judul achievement, judul project, summary CV, dan nama file import A. Respons ke B tidak pernah memuat sentinel; output test, receipt, dan screenshot juga tidak.

### 6.2 Akun E2E

- Satu akun per spec (`t25-a11y-<uuid>@example.test`) dengan data cukup agar setiap layar §1.8 tidak kosong: 3 activity, 2 achievement (satu confirmed), 1 project, 1 experience, CV dengan 3 item tersimpan dan satu export `succeeded` (renderer nyata). Layar kosong (empty state S04/S06) diuji dengan akun kedua tanpa data.
- Locale en untuk matriks; satu putaran id untuk S04, S05, S12, S13 (cek `lang="id"` dan teks tidak terpotong).

### 6.3 Layar matriks aksesibilitas

S01 sign-in, S02 onboarding import, S03 import review (batch fixture), S04 dashboard (berisi dan kosong), S05 activity baru (Note dan Form), S06 daftar activity, S07 daftar achievement, S08 detail achievement, S09 daftar project, S10 detail project, S11 timeline, S12 settings/profile (termasuk dialog penghapusan akun terbuka), S13 CV builder, S14 preview. Dialog delete bernama, unsaved, dan konflik revisi diperiksa di layar induknya. Route final mengikuti inventaris Fase 0.

### 6.4 Checklist screen reader manual (NVDA + Chrome atau Edge)

Dijalankan manusia; pelaksana menyiapkan akun dan mencatat hasil yang dilaporkan.

1. S01: label email/password dibacakan; error sign-in dibacakan tanpa memindah fokus secara tak terduga.
2. Quick log: tombol dibacakan dengan nama; fokus pindah ke input; simpan diumumkan setelah commit, bukan sebelumnya.
3. S08: status draft/confirmed dibacakan sebagai teks, bukan hanya warna; field wajib saat konfirmasi gagal dibacakan.
4. S13: tombol move up/down menyebut nama item; konflik revisi dibacakan.
5. S14: status job export dibacakan saat berubah (live region); tombol Download punya nama jelas.
6. S12: dialog penghapusan akun mengumumkan judul, data yang hilang, dan error password.

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
pnpm exec supabase migration up --local
pnpm test:integration:release
pnpm test:e2e:release
pnpm ops:check
pnpm test:integration:product-events
pnpm test:perf
pnpm test:integration:account-deletion
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
pnpm test:integration:m4
pnpm test:integration:ai
pnpm test:integration:ai-review
pnpm test:integration:evidence
pnpm test:integration:storage
pnpm test:e2e:account-deletion
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
pnpm test:e2e:m4
pnpm worker:check
pnpm build
git diff --check
```

`test:integration:release`, `test:e2e:release`, dan `ops:check` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `test:ai:live` tidak dijalankan kecuali pengguna menyetujuinya secara eksplisit untuk run itu.

Aturan menjalankan suite (sama dengan T24 §7):

- **Secret key.** `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan. Di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong. Output `db:start`/`db:status` memuat key; selalu saring.
- **Env per command.** Muat `.env.local` + key (dan `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` untuk suite export) dalam command yang sama dengan suite.
- **Output.** Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`.
- **Edit file.** Untuk file ber-karakter non-ASCII (termasuk `messages.ts`) gunakan tool Edit, bukan `Set-Content`.
- **Container.** Jangan menghentikan container Supabase aktif, ClamAV T10, Gotenberg T15, atau `workpulse-t21-pdf`. Stack rebuild §2.2.6 dihentikan setelah dipakai.
- **Port tereservasi.** Bila Supabase "healthy" tetapi port tidak mendengar, cek `netsh int ipv4 show excludedportrange protocol=tcp`; perbaikannya butuh shell admin, jadi laporkan ke pengguna.
- **Perf.** `test:perf` dijalankan sendirian.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0 atau parity tidak **34/34**.
- Implementasi menuntut penyimpangan dari keputusan §2.4 yang disetujui.
- Penyelesaian memerlukan:
  - mengedit migration yang sudah diterapkan atau `db reset` pada stack aktif;
  - lebih dari satu migration baru selain §2.2.12, atau mengubah kontrak RPC T02–T24, tanpa persetujuan §2.4.6;
  - menambah kolom agar metrik §2.2.8 dapat dihitung;
  - DML langsung ke skema `auth` atau `storage` selain lewat Admin API dan baris uji pgTAP.
- Defect **P0** ditemukan (kebocoran data lintas akun, kehilangan data, secret di browser atau log). Laporkan segera ke pengguna dan reviewer sebelum memperbaiki.
- Deploy, pembuatan akun cloud, atau pemakaian key staging/AI diperlukan tanpa otorisasi tertulis pengguna untuk langkah itu.
- Scope bocor ke Gate M5, CI01, production deploy, fitur roadmap, atau perapian di luar defect tercatat.
- Test membutuhkan key nyata di repo, akun produksi, data pengguna nyata, atau sentinel/password/key muncul di output, receipt, screenshot, atau snapshot.
- Suite lama perlu diubah agar lulus (selain pembaruan snapshot yang memang disebabkan kalimat S12 atau perbaikan defect tercatat, dan itu harus disebut per file di receipt).

## 9. Gate review Claude (setelah Fase 8)

Review read-only mencakup:

- **Matriks:** setiap R01–R10, enam skenario rilis, dan baris PRD §4 punya test nyata yang dijalankan di Fase 8; reviewer mengambil sampel minimal lima baris dan membaca test-nya.
- **Isolasi:**
  - penjaga katalog membaca katalog, punya bukti dapat gagal, dan pengecualiannya beralasan;
  - integration mencakup setiap tabel `public` ber-`user_id` (reviewer membandingkan dengan query katalog sendiri);
  - respons untuk ID milik akun lain identik dengan ID acak;
  - reviewer menjalankan ulang `pnpm test:integration:release` dan `pnpm db:test`.
- **Health:** `get_operational_health` hanya service role, tanpa kolom identitas, definisi overdue konsisten dengan `get_account_deletion_backlog`; `ops:check` exit code dan keluaran tanpa rahasia.
- **Aksesibilitas:** reviewer menjalankan ulang `pnpm test:e2e:release`, membuka sampel screenshot 360/1440 light/dark, dan menjalankan Delivery Gate antislop + Human Skill Checklist atas layar yang diubah. Pasangan kontras dihitung ulang dengan `contrast-check.py` untuk sampel token.
- **Copy S12:** kalimat sesuai jawaban §2.4.3, en dan id setara, tidak menjanjikan hal yang tidak dilakukan sistem.
- **Rebuild dan build:** angka receipt Fase 5 masuk akal; stack aktif tidak di-reset.
- **Runbook dan checklist:** env lengkap, rollback forward-fix, restore mengikuti §2.2.9, klaim yang belum terverifikasi tertulis sebagai BLOCKER.
- **Staging:** klaim staging hanya bila receipt Fase 7 punya bukti; jika BLOCKED, rekomendasi status T25 **PARTIAL**.
- **Hygiene:** hanya file §4 dan file defect tercatat, tanpa dependency baru, grep rahasia nihil.

Prioritas temuan:

- **P0:** kebocoran data lintas akun, kehilangan data, secret terekspos.
- **P1:** acceptance R01–R10 atau skenario rilis gagal; pelanggaran WCAG AA yang memblokir tugas inti (tidak dapat dioperasikan keyboard, kontras teks utama gagal).
- **P2:** acceptance terbukti sebagian; pelanggaran AA non-blokir; runbook yang salah secara operasional.
- **P3:** perapian, dokumen, dan risiko yang diterima.

P0–P2 memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative dan merekomendasikan Gate M5.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Penjaga yang tidak pernah bisa gagal.** Query katalog dengan filter salah (mis. hanya skema `public`, melewatkan tabel tanpa kolom `user_id` yang tetap berisi data pengguna seperti tabel join) lulus selamanya. Dijaga oleh bukti pelanggar sintetis §2.2.4 dan perbandingan reviewer dengan query katalog independen.
2. **Isolasi yang hanya diuji untuk `select`.** RLS `using` benar tetapi `with check` longgar, sehingga B dapat menyisipkan baris ber-`user_id` A atau memindahkan baris lewat update. Dijaga oleh §1.4 (insert/update/delete per tabel) dan §1.5.
3. **Matriks aksesibilitas yang memeriksa layar kosong.** Axe lulus karena halaman hanya berisi empty state atau skeleton. Dijaga oleh fixture §6.2 yang mengisi setiap layar, assertion konten sebelum axe, dan `waitForFiniteAnimations`.
4. **Kontras token lulus di test tetapi pemakaian nyata berbeda.** Pasangan diuji pada token yang tidak dipakai komponen, atau dark theme mewarisi warna light. Dijaga oleh daftar pasangan dari pemakaian nyata (verifikasi kelas komponen di Fase 0), axe `color-contrast` di kedua tema, dan sampel `contrast-check.py` reviewer.
5. **Runbook yang menjanjikan lebih dari bukti.** Backup ≤ 30 hari, restore aman, atau staging disebut terverifikasi tanpa receipt. Dijaga oleh status klaim eksplisit, item BLOCKER di checklist, dan aturan status PARTIAL §2.4.1.
6. **Alert yang diam.** `ops:check` mengembalikan 0 saat RPC gagal atau env salah, atau definisi overdue berbeda dari backlog T23. Dijaga oleh exit code 1 untuk unavailable/config invalid, unit test ambang, dan pgTAP yang menaikkan tiap metrik tepat 1.

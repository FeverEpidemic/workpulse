# Handoff T24 Instrumentation dan performance — eksekusi single-agent

> **Untuk agen pelaksana:**
> - Kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai.
> - Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit.
> - Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.
> - Semua nama migration, tabel, fungsi SQL, nama event, kode error, script, dan path di dokumen ini **dibekukan**; jangan mengganti namanya.
> - Migration bersifat forward-only. Migration yang sudah diterapkan ke database lokal tidak boleh diedit; perbaikan masuk migration baru. Jangan pernah `db:reset`.

- Tanggal: 10 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Dependensi:
  - T23 **DONE** (10 Oktober 2026): guard tulis `zz_guard_account_writable`, `purge_account_data`, `internal.account_deletions`, `get_account_deletion_backlog`, decision 0029. Follow-up F4/F9 sudah masuk (`d950073`).
  - Gate M4 **PASSED** (verdict 10 Oktober 2026, `M4-gate-review.md`).
  - T21/T22 **DONE**: lifecycle `cv_exports` (`complete_cv_export`, `internal.fail_cv_export_locked`), worker `cv-export`.
  - T16 **DONE**: `commit_import_batch` menulis `commit_result` berisi hitungan.
  - T12 **DONE**: `get_dashboard_summary`, `filter_achievements`, `filter_projects`, `list_demonstrated_skills`, layanan dashboard/timeline.
  - T06/T08/T09 **DONE**: RPC simpan activity, project, achievement.
- Eksekutor: satu agent **Claude Sonnet 5.5** (pola T23). Bila pengguna menunjuk eksekutor lain, ikuti pengguna. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 6; Fase 7 (draft dokumen) dikerjakan setelah gate. Checkpoint Claude setelah Fase 0 **wajib**: angka baseline performa dan query plan menentukan apakah Fase 4 menambah migration indeks.
- Keputusan produk §2.4: **menunggu persetujuan pengguna**. Fase 0 berhenti bila persetujuan belum tercatat di dokumen ini.
- Acuan:
  - **PRD §4** baris *Performance targets* (dataset staging 1.000 activities, 200 achievements, 50 projects; p95 dashboard dan list read < 2 detik; save < 1 detik, tanpa network dan AI) dan *Privacy*.
  - **PRD §5** *Pilot measures*: event tanpa teks catatan, teks CV, nama file, atau isi lampiran; definisi Activation, Value completion, Return capture, Export reliability; target adalah hipotesis, ditinjau ulang setelah 20 pengguna pilot yang memberi persetujuan. M5 *Instrumentation, access review, deletion, regression*.
  - **Database Schema** §1 (timestamp audit UTC), §5 `cv_exports` (status `queued`/`running`/`succeeded`/`failed`), §6 *Delete account* dan *Access policy pattern*.
  - **`IMPLEMENTATION_PLAN.md`:** blok T24 (§5 M5), §3 *Jobs dan data privat*, Gate M5 (target pilot dievaluasi dari 20 pengguna pilot, bukan syarat sebelum pilot).
  - **`AGENTS.md`:** *Verifikasi* poin Performance T24; *Files, import, dan cleanup* (jangan mencatat note/CV text, filename, attachment content, atau secret ke log/analytics).
  - **Decision:** 0029 (purge akun, tombstone profil, receipt), 0027 (state export), 0022/0023 (import commit dan review).

**Goal:** WorkPulse mencatat event produk minimal di database, dalam transaksi yang sama dengan perubahan domain, sehingga empat ukuran pilot PRD dapat dihitung untuk kohort pilot yang memberi persetujuan, terpisah dari akun fixture. T24 juga membuktikan target performa PRD pada dataset 1.000/200/50 dengan metode yang tercatat, dan menambah indeks hanya bila query plan membuktikan perlu. Angka target pilot (60/40/30/98%) tetap ditulis sebagai hipotesis.

**Architecture:** Satu migration wajib (parity 33 → **34**), satu migration indeks bersyarat (→ **35** hanya bila Fase 4 membuktikannya).

- **Event.** Tabel `internal.product_events` (tanpa grant ke role API) diisi oleh trigger `AFTER` pada tabel kanonis: `activities`, `achievements`, `projects`, `experiences`, `education`, `certifications`, `import_batches`, `cv_exports`. Trigger memanggil `internal.record_product_event`, yang memvalidasi nama event dan properti terhadap allowlist. Tidak ada RPC yang diganti; semua jalur tulis (service, import commit, AI apply, worker export) otomatis tercatat, dan rollback domain ikut membatalkan event.
- **Kohort pilot.** Tabel `internal.pilot_participants` diisi operator lewat RPC service-role `set_pilot_participant`. Akun fixture dan test tidak pernah didaftarkan, sehingga tidak masuk perhitungan.
- **Ukuran.** RPC service-role `get_pilot_metrics(p_as_of)` menghitung keempat ukuran dari event untuk kohort aktif, termasuk jumlah akun yang jendelanya belum selesai.
- **Penghapusan akun.** Event dan baris peserta ber-FK ke `public.profiles(id) on delete cascade`, sehingga hilang saat `deleteUser` T23 menghapus tombstone profil. Fungsi T23 tidak diubah.
- **Performa.** Suite baru `tests/perf/` (Vitest, config sendiri) men-seed dataset lewat RPC dengan klaim JWT di psql, lalu mengukur layanan yang dipakai halaman (dashboard, list, timeline, save) lewat client `authenticated` nyata, dan menyimpan hasil ke `docs/verification/T24-perf-results.json`.

**Tech stack:** Supabase PostgreSQL (plpgsql, pgTAP), Vitest (unit, integration, config perf baru), `@supabase/supabase-js` yang sudah terpasang, `psql` lewat `docker exec` (helper `sql()` yang ada). Tidak ada dependency npm baru, tidak ada UI baru, tidak ada worker pass baru.

---

## 0. Cara memakai handoff ini

**Urutan baca.** Baca dokumen ini sampai selesai sebelum mengubah kode, lalu:

1. `AGENTS.md` (bagian *Verifikasi* dan *Files, import, dan cleanup*).
2. Entry teratas `docs/IMPLEMENTATION_STATUS.md` (T23, Gate M4).
3. `docs/IMPLEMENTATION_PLAN.md` §3, blok M5 (T24, Gate M5), §6.
4. Decision 0029 dan `docs/verification/T23-retention-runbook.md`.
5. `docs/verification/T23-implementation-plan.md` sebagai pola fase database + integration.
6. `docs/verification/T21-pdf-renderer-runbook.md` (renderer untuk integration export dan regresi).

Ekstrak ulang PRD §4 dan §5 dengan alat ekstraksi DOCX (`python -I` + `zipfile` atas `word/document.xml`; `python-docx` tidak terpasang). Jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD Performance targets:** pada dataset staging yang disepakati (1.000 activities, 200 achievements, 50 projects), p95 baca dashboard dan list di bawah 2 detik; save di bawah 1 detik, tidak termasuk network dan AI.
- **PRD Pilot measures:** event dicatat tanpa teks catatan, teks CV, nama file, atau isi lampiran. Ukuran adalah hipotesis pilot, bukan hasil produk; target ditinjau setelah 20 pengguna pilot pertama yang memberi persetujuan.
  - *Activation:* akun baru yang mengonfirmasi record impor atau menyimpan satu record karier manual dalam 24 jam.
  - *Value completion:* akun teraktivasi yang mengonfirmasi achievement dan mengekspor CV dalam 7 hari.
  - *Return capture:* akun teraktivasi yang menyimpan activity pada minggu kedua yang berbeda dalam 28 hari.
  - *Export reliability:* export sukses dibagi job export terminal, tanpa pembatalan pengguna.
- **PRD Privacy:** akses owner-scoped pada setiap tabel, relasi, operasi worker, dan file.
- **PRD Deletion:** penghapusan akun menghapus data aktif dalam 24 jam.
- **Rencana §5 T24 (kalimat selesai):** event dapat menghitung activation 24 jam, value completion 7 hari, return capture 28 hari, dan export reliability; angka target PRD disebut hipotesis. Catat lingkungan, jumlah sampel, perlakuan warm/cold, dan hasil; optimasi indeks berdasarkan query plan.

**Aturan kerja:**

- Pertahankan perubahan lokal pengguna.
- Jangan menandai T24 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`.
- Pada akhir setiap fase, tulis **receipt** di `docs/verification/T24-phaseN-<slug>.md` berisi:
  - tujuan dan file berubah;
  - command beserta hasil aktual (exit code dan angka pass/fail);
  - acceptance yang terbukti;
  - warning/kegagalan dan blocker;
  - langkah berikutnya.
- Angka di receipt dan di file hasil performa harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T24

T24 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Event tercatat dari semua jalur tulis.** Satu baris `internal.product_events` per kejadian:
   - `activity_saved` saat activity dibuat (Note, Form, Chat);
   - `career_record_created` saat achievement, project, experience, education, atau certification dibuat, termasuk lewat import commit dan apply AI;
   - `achievement_confirmed` saat achievement menjadi `confirmed` (insert langsung `confirmed` atau transisi dari status lain), tidak untuk edit achievement yang sudah `confirmed`;
   - `import_committed` saat batch berpindah ke `committed`;
   - `cv_export_finished` saat export berpindah dari `running` ke `succeeded` atau `failed`.

   Edit activity, edit project, reorder CV, dan baca data tidak menghasilkan event. Dibuktikan pgTAP per trigger + integration lewat service nyata.
2. **Atomik dengan domain.** Bila transaksi domain gagal atau rollback (misalnya import commit dengan satu item invalid, save dengan `STALE_REVISION`), tidak ada event. Retry idempotent (`create_activity_idempotent` dengan key sama, commit import kedua) tidak menambah event. Dibuktikan pgTAP + integration.
3. **Metadata minimal.** Kolom event hanya `id`, `user_id`, `event_name`, `occurred_at`, `local_date`, `properties`. `properties` divalidasi CHECK terhadap allowlist §2.2.3: hanya enum pendek dan bilangan bulat, tanpa ID record, tanpa teks bebas. Sentinel privat di raw activity, judul achievement, judul CV, dan nama file import tidak pernah muncul di tabel event. Dibuktikan pgTAP (properti tak dikenal ditolak) + integration (pencarian sentinel lintas kolom).
4. **Tidak dapat diakses klien.** `internal.product_events`, `internal.pilot_participants`, dan `internal.product_event_epoch` tidak punya privilege untuk `anon`, `authenticated`, atau `service_role`. `set_pilot_participant` dan `get_pilot_metrics` hanya `service_role`; `authenticated` dan `anon` ditolak. Dibuktikan pgTAP + integration lewat PostgREST.
5. **Kohort pilot terpisah dari fixture.**
   - Hanya akun yang didaftarkan lewat `set_pilot_participant` dan belum menarik diri yang masuk `get_pilot_metrics`.
   - Akun yang dibuat sebelum epoch instrumentasi ditolak (`PILOT_ACCOUNT_PREDATES_INSTRUMENTATION`).
   - Penarikan diri bersifat final (`PILOT_PARTICIPANT_WITHDRAWN` saat didaftarkan ulang).
   - Akun integration, E2E, dan perf tidak pernah terdaftar; dataset perf tidak mengubah hasil metrik.

   Dibuktikan pgTAP + integration.
6. **Activation 24 jam.** Untuk akun kohort dengan `profiles.created_at + 24 jam <= p_as_of`: teraktivasi bila punya `activity_saved`, `career_record_created`, atau `import_committed` dengan `created + mapped > 0` sebelum `created_at + 24 jam`. Batas diuji di 23:59:59 (masuk) dan 24:00:00 (tidak masuk). Akun yang jendelanya belum selesai dihitung sebagai `pending`, bukan gagal. Dibuktikan pgTAP dengan event yang waktunya dimundurkan.
7. **Value completion 7 hari.** Dari akun teraktivasi dengan jendela 7 hari selesai: tercapai bila ada `achievement_confirmed` **dan** `cv_export_finished` dengan `outcome = succeeded` sebelum `created_at + 7 hari`. Export gagal tidak dihitung. Dibuktikan pgTAP.
8. **Return capture 28 hari.** Dari akun teraktivasi dengan jendela 28 hari selesai: tercapai bila `activity_saved` sebelum `created_at + 28 hari` jatuh di minimal dua minggu ISO berbeda menurut `local_date` (zona waktu profil saat event). Dua save di Minggu dan Senin berikutnya = dua minggu; dua save Senin dan Minggu yang sama = satu minggu; zona `Asia/Jakarta` memindahkan save 23:30 UTC Minggu ke Senin. Dibuktikan pgTAP.
9. **Export reliability.** Rasio `cv_export_finished` `succeeded` terhadap semua `cv_export_finished` kohort sampai `p_as_of`. Kegagalan `ACCOUNT_DELETING` dikeluarkan sebagai setara pembatalan pengguna. Setiap transisi ke terminal dihitung (gagal lalu retry sukses = 1/2). Dibuktikan pgTAP + integration dengan worker export nyata (renderer fake sukses dan fake gagal).
10. **Laporan jujur.** `get_pilot_metrics` mengembalikan per ukuran: `eligible`, `achieved`, `pending`, `rate` (NULL bila `eligible = 0`), `target` (0.60/0.40/0.30/0.98), dan `cohort_size`. Tidak ada angka yang disebut tercapai; runbook menyebut target sebagai hipotesis dan memperingatkan ukuran sampel kecil. Dibuktikan pgTAP + review runbook.
11. **Ikut terhapus bersama akun.** Setelah jalur penghapusan T23 penuh (purge → `deleteUser` → verify), nol baris `internal.product_events` dan `internal.pilot_participants` untuk akun itu. Akun lain utuh. Dibuktikan integration (perluasan suite T24, bukan suite T23).
12. **Dataset performa nyata.** Seed membuat untuk akun P: 1.000 activities, 200 achievements, 50 projects, ditambah konteks §6. Jumlah diverifikasi dengan `count(*)` sebelum pengukuran dan dicatat di hasil. Akun Q dengan volume yang sama ada di database yang sama agar plan dibuat pada tabel berisi data akun lain. Seed lewat RPC (trigger dan constraint aktif), bukan INSERT langsung ke tabel. Dibuktikan output seed + receipt.
13. **p95 baca < 2 detik.** Untuk akun P, minimal 50 sampel warm per operasi setelah 5 pemanasan yang dibuang:
    - S04 `createDashboardService(client).getDashboard()`;
    - S06 `listActivities` halaman pertama, halaman ketiga (cursor), dan filter project;
    - S07 `listAchievements` tanpa filter, `confirmed`, dan filter *missing evidence*;
    - S09 `listProjects` tanpa filter dan filter *outcome missing*;
    - S11 `getTimeline` tanpa filter.

    p95 nearest-rank masing-masing < 2.000 ms. Dibuktikan `pnpm test:perf` + `T24-perf-results.json`.
14. **p95 save < 1 detik.** Minimal 50 sampel per operasi:
    - `createActivity` (Note);
    - `updateActivity`;
    - save draft achievement lalu confirm (diukur terpisah);
    - `createProject`;
    - `updateProject`.

    p95 < 1.000 ms, dengan trigger event T24 aktif. Dibuktikan `pnpm test:perf`.
15. **Metode tercatat.** Hasil mencatat:
    - lingkungan (OS, CPU, core, RAM, versi Docker, versi PostgreSQL dari `select version()`, Node, Supabase CLI, HEAD git);
    - jumlah sampel, sampel warm/cold, p50/p95/max per operasi;
    - lapisan yang diukur (service Node → Kong/PostgREST loopback → PostgreSQL, tanpa render React);
    - perlakuan cold: sampel pertama per operasi dengan client baru; buffer PostgreSQL tidak dikosongkan (alasan §2.2.11).

    Dibuktikan file hasil + receipt Fase 5.
16. **Query plan dan indeks berbasis bukti.** `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` untuk setiap query baca §1.13 dicatat sebelum optimasi. Indeks ditambahkan hanya bila memenuhi kriteria §2.2.12, dengan plan dan p95 sebelum/sesudah. Bila tidak ada yang memenuhi, tidak ada migration indeks dan receipt menyebut alasannya. Dibuktikan receipt Fase 4.
17. **Privasi dan log.** Tidak ada `console.` di file baru `tests/perf/` selain reporter hasil yang hanya mencetak nama operasi dan angka. Tidak ada teks pengguna, email, atau key di hasil perf, receipt, atau properti event. Dibuktikan grep + review.
18. **Tanpa regresi.** Seluruh suite T02–T23 dan Gate M2/M3/M4 tetap lulus tanpa melemahkan assertion. Perilaku lama tidak berubah; satu-satunya efek samping tulis adalah baris event internal. Dibuktikan regresi penuh + diff review.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration event/kohort/metrik, pgTAP baru, regenerasi `database.types.ts`.
- Migration indeks bersyarat (Fase 4).
- Integration `tests/integration/product-events.test.ts`.
- Suite perf `tests/perf/` + `vitest.perf.config.ts` + helper statistik dengan unit test.
- Runbook metrik pilot, decision 0030, laporan verifikasi, receipt, README.

### 2.2 Keputusan implementasi

1. **Event lewat trigger `AFTER` di tabel kanonis, bukan panggilan di setiap RPC.**
   - *Alasan:* `create_activity_idempotent` (`20260917160000_t06_activity_persistence.sql:610`, helper `internal.create_activity` `:459`), `commit_import_batch` (`20261001090000_t16_import_commit.sql:690`, insert foundation/achievement `:815-889`, transisi `committed` `:943-946`), apply AI (`20260929090000_t14_ai_review.sql:791`), dan `complete_cv_export`/`internal.fail_cv_export_locked` (`20261005090000_t21_cv_export_backend.sql:559`, `:233`) adalah jalur tulis yang berbeda. Mengganti setiap fungsi berisiko terlewat dan mengubah fungsi T06–T21. Trigger menangkap semua jalur, berjalan dalam transaksi yang sama, dan tidak mengubah fungsi lama (pola guard T23).
   - Trigger tidak pernah melempar error karena event: validasi properti dilakukan dengan data yang dibentuk trigger sendiri. Bila CHECK tetap gagal, itu bug trigger dan test harus menangkapnya, bukan diredam dengan `exception when others`.
2. **Tabel `internal.product_events`:**

   | Kolom | Tipe | Catatan |
   | --- | --- | --- |
   | `id` | `bigint generated always as identity primary key` | |
   | `user_id` | `uuid not null references public.profiles(id) on delete cascade` | |
   | `event_name` | `text not null` | CHECK enum §2.2.3 |
   | `occurred_at` | `timestamptz not null default pg_catalog.clock_timestamp()` | UTC |
   | `local_date` | `date not null` | tanggal di zona `profiles.timezone` saat event |
   | `properties` | `jsonb not null default '{}'` | CHECK `internal.product_event_properties_valid(event_name, properties)` |

   - Indeks `(user_id, event_name, occurred_at)`.
   - RLS aktif. Semua privilege dicabut dari `public`, `anon`, `authenticated`, `service_role`.
   - Tidak ada kolom ID record, teks, nama file, email, atau correlation ID.
3. **Allowlist event dan properti.** `internal.product_event_properties_valid` menolak kunci di luar daftar, tipe yang salah, dan nilai di luar enum.

   | Event | Sumber trigger | Properti |
   | --- | --- | --- |
   | `activity_saved` | `activities` AFTER INSERT | `capture_mode`: `note`/`form`/`chat` |
   | `career_record_created` | AFTER INSERT pada `achievements`, `projects`, `experiences`, `education`, `certifications` | `record_type`: `achievement`/`project`/`experience`/`education`/`certification`; `origin` hanya untuk achievement: `manual`/`activity`/`import` |
   | `achievement_confirmed` | `achievements` AFTER INSERT atau UPDATE OF `status`, bila `new.status = 'confirmed'` dan (INSERT atau `old.status <> 'confirmed'`) | `origin` |
   | `import_committed` | `import_batches` AFTER UPDATE OF `status`, bila `new.status = 'committed'` dan `old.status <> 'committed'` | `created`, `mapped`, `skipped`, `confirmed_achievements`: integer 0–1000, dijumlah dari `new.commit_result` |
   | `cv_export_finished` | `cv_exports` AFTER UPDATE OF `status`, bila `old.status = 'running'` dan `new.status in ('succeeded','failed')` | `outcome`: `succeeded`/`failed`; `error_code`: kode allowlist `fail_cv_export` (`20261005090000_t21_cv_export_backend.sql:621-622`) atau NULL; `attempt`: integer 1–10; `page_count`: integer 1–20 atau NULL |

   Skill tidak menjadi `career_record_created`: skill adalah label, bukan record karier (PRD *Canonical records*). Update activity tidak menjadi event (keputusan §2.4.3).
4. **`internal.record_product_event(p_user_id uuid, p_event_name text, p_properties jsonb)`** (`security definer`, `search_path = pg_catalog`, revoke dari semua role) membaca `profiles.timezone` tanpa lock dan menulis `local_date = (clock_timestamp() at time zone timezone)::date`. Bila profil tidak ada, fungsi tidak menulis apa pun (tidak terjadi pada jalur sah; dicatat di pgTAP).
5. **Epoch instrumentasi.** Tabel satu baris `internal.product_event_epoch (started_at timestamptz not null)` diisi migration dengan `clock_timestamp()`. Akun yang dibuat sebelum epoch tidak punya event dari awal, jadi tidak boleh masuk kohort.
6. **Kohort `internal.pilot_participants`:**

   | Kolom | Tipe | Catatan |
   | --- | --- | --- |
   | `user_id` | `uuid primary key references public.profiles(id) on delete cascade` | |
   | `consent_version` | `text not null` | pola `^[a-z0-9][a-z0-9._-]{0,31}$` |
   | `enrolled_at` | `timestamptz not null` | |
   | `withdrawn_at` | `timestamptz` | |

   RLS aktif, tanpa privilege role API.
7. **`public.set_pilot_participant(p_user_id uuid, p_consent_version text, p_enrolled boolean) returns table (user_id uuid, enrolled_at timestamptz, withdrawn_at timestamptz)`**, hanya `service_role`:
   - profil tidak ada atau `deleting` → `22023 PILOT_ACCOUNT_UNAVAILABLE`;
   - `profiles.created_at < epoch` → `22023 PILOT_ACCOUNT_PREDATES_INSTRUMENTATION`;
   - `p_enrolled = true`: insert; panggilan ulang dengan versi sama mengembalikan baris yang ada; versi berbeda memperbarui `consent_version` tanpa mengubah `enrolled_at`; peserta yang sudah menarik diri → `22023 PILOT_PARTICIPANT_WITHDRAWN`;
   - `p_enrolled = false`: isi `withdrawn_at` sekali (idempotent); belum terdaftar → `22023 PILOT_PARTICIPANT_UNKNOWN`.
8. **`public.get_pilot_metrics(p_as_of timestamptz default pg_catalog.now()) returns table (measure text, cohort_size integer, eligible integer, achieved integer, pending integer, rate numeric, target numeric)`**, hanya `service_role`, `stable`. Empat baris dengan `measure` `activation`, `value_completion`, `return_capture`, `export_reliability`. Definisi persis §1.6–1.9; jendela dihitung dari `profiles.created_at`; minggu = `date_trunc('week', local_date)` (ISO, Senin). Untuk `export_reliability`, `eligible` = jumlah export terminal yang dihitung dan `pending` = 0. `rate` dibulatkan 4 desimal.
9. **Hapus akun.** FK cascade ke `profiles` menghapus event dan baris peserta saat `deleteUser` menghapus tombstone profil (decision 0029). `purge_account_data` dan fungsi T23 lain tidak diubah. Tidak ada event `account_deleted`: event itu akan langsung ikut terhapus, dan observability penghapusan sudah ada di `get_account_deletion_backlog` (runbook T23).
10. **Seed performa lewat RPC dengan klaim JWT di psql** (pola `tests/e2e/account-deletion.spec.ts:56`: `set_config('request.jwt.claims', …, true)` dalam satu transaksi per batch). Dengan begitu seed tidak memakai sign-in Auth (rate limit `supabase/config.toml:212`), dan trigger serta constraint tetap berjalan. Akun P dan Q dibuat dengan Admin API sekali; pengukuran memakai satu sign-in password untuk P. Setelah seed: `analyze` pada tabel yang di-seed (dicatat sebagai bagian metode).
11. **Lapisan dan perlakuan pengukuran.**
    - Diukur di layanan yang dipanggil halaman (`src/features/*/…-service.ts`) dengan client `authenticated` dari `@supabase/supabase-js` ke Supabase lokal. Termasuk hop Kong/PostgREST loopback (konservatif), tidak termasuk render React, network publik, dan AI.
    - Timer: `performance.now()` di sekitar satu panggilan layanan.
    - Urutan operasi diacak per putaran dengan seed tetap agar cache tidak berpihak.
    - *Cold:* sampel pertama per operasi dengan client baru, dicatat terpisah dan tidak masuk p95 warm. Buffer PostgreSQL tidak dikosongkan; restart container dihindari karena masalah port tereservasi di mesin ini (§7). Ini batas metode yang ditulis di hasil.
    - p95 nearest-rank: `sorted[ceil(0.95 × n) − 1]`.
12. **Kriteria indeks.** Indeks baru hanya bila salah satu terbukti di plan akun P:
    - `Seq Scan` pada tabel dengan > 1.000 baris untuk query yang difilter `user_id`;
    - `Sort` eksplisit > 50 ms yang dapat dilayani indeks;
    - p95 operasi > 50% target (> 1.000 ms baca, > 500 ms save) dan plan menunjukkan sumbernya.

    Setiap indeks: satu baris alasan di migration, plan dan p95 sebelum/sesudah di receipt, `pnpm db:test` tetap lulus. Indeks tidak boleh mengubah semantik query atau constraint.
13. **Nomor:**
    - Migration `supabase/migrations/20261011090000_t24_product_events.sql` (Fase 1, parity **34/34**) dan bila perlu `supabase/migrations/20261011100000_t24_performance_indexes.sql` (Fase 4, parity **35/35**). Diterapkan dengan `pnpm exec supabase migration up --local`.
    - pgTAP `supabase/tests/database/product_events.test.sql`.
    - Integration `tests/integration/product-events.test.ts`, script baru `test:integration:product-events`.
    - Perf `tests/perf/{perf-support,seed,stats}.ts`, `tests/perf/read-write.test.ts`, `vitest.perf.config.ts`, script baru `test:perf`.
    - Unit `tests/unit/perf-stats.test.ts`.
    - Decision `docs/decisions/0030-t24-instrumentation-performance.md`.
    - Runbook `docs/verification/T24-pilot-metrics-runbook.md`, hasil `docs/verification/T24-perf-results.json`, laporan `docs/verification/T24-instrumentation-performance.md`.

### 2.3 Di luar scope

- **T25:** dashboard/alert operasional (failed jobs, backlog cleanup dan penghapusan), pengukuran di staging/hosted, performa yang dirasakan browser (render, LCP), regresi aksesibilitas penuh, release checklist.
- **Pasca-pilot:** retensi atau agregasi event setelah pilot selesai, ekspor laporan ke alat analitik eksternal.
- **Tidak dibuat:** SDK analitik pihak ketiga, event dari browser/klien, tracking pageview atau klik, session replay, fingerprinting, UI consent analitik di aplikasi, dashboard metrik di aplikasi, event untuk AI job, evidence, atau penghapusan akun.
- **Tidak diubah:** fungsi RPC T02–T23, state machine job, worker, UI, dan i18n.
- **Bukan v0.1:** billing, team, public profile, dan fitur roadmap `Design.md`.

### 2.4 Keputusan produk yang perlu disetujui pengguna

Rekomendasi adalah pilihan pertama di setiap poin. Setelah pengguna menyetujui, catat tanggal dan kutipan persetujuan di bawah, lalu bekukan. Bila implementasi menuntut penyimpangan, **stop** (§8).

1. **Event dicatat untuk semua akun; ukuran hanya untuk kohort yang didaftarkan operator.** Persetujuan pilot dikumpulkan di luar aplikasi (formulir pilot), lalu operator memanggil `set_pilot_participant` dengan versi persetujuan. Event tanpa konten tetap tercatat untuk akun non-pilot, tetapi tidak pernah dilaporkan. Alternatif:
   - event hanya dicatat untuk akun yang sudah terdaftar (lebih minim, tetapi aktivitas sebelum pendaftaran hilang sehingga jendela 24 jam sering tidak terukur);
   - toggle persetujuan analitik di S12/onboarding (butuh UI, copy, versi persetujuan, dan E2E; lebih cocok untuk rilis publik).
2. **Tidak ada perubahan UI di T24.** Transparansi untuk peserta pilot lewat formulir persetujuan pilot. Kalimat pemberitahuan event di detail privasi S12 ditinjau di T25 bersama copy rilis. Alternatif: tambah satu kalimat di S12 sekarang (menambah i18n, screenshot, dan review copy).
3. **"Record karier manual" untuk Activation = activity, achievement, project, experience, education, certification.** Skill, nama profil, dan edit record tidak dihitung; import commit dihitung bila `created + mapped > 0`. Alternatif: hanya activity dan achievement (lebih sempit dari kalimat PRD *career record*).
4. **Semua jendela dihitung dari pembuatan akun** (`profiles.created_at`, dibuat trigger `on_auth_user_created_workpulse_profile`, `20260916090000_foundation_schema.sql:430`): 24 jam, 7 hari, 28 hari. Alternatif: jendela 7 dan 28 hari dihitung dari waktu aktivasi (lebih panjang bagi akun yang lambat aktif, tetapi definisi PRD tidak menyebutnya).
5. **Minggu = minggu kalender ISO (Senin) di zona waktu profil saat save.** Alternatif: blok 7 hari bergulir dari pembuatan akun (bebas zona waktu, tetapi kurang sesuai kata *week*).
6. **Export reliability dihitung per transisi terminal**; kegagalan `ACCOUNT_DELETING` dikeluarkan sebagai setara pembatalan pengguna. Alternatif: per export dengan status akhir saja (gagal lalu retry sukses = sukses; menyembunyikan kegagalan yang dilihat pengguna).
7. **Event dan baris peserta ikut terhapus saat akun dihapus.** Peserta yang menghapus akun keluar dari kohort; selisihnya terlihat dari daftar persetujuan di luar sistem. Alternatif: menyimpan baris peserta tanpa event sebagai penanda "keluar" (menyisakan UUID akun yang sudah dihapus).
8. **Event disimpan selama akun ada**, tanpa purge berkala di T24; kebijakan setelah pilot diputuskan bersama hasil pilot. Alternatif: purge otomatis event > 180 hari (butuh langkah worker baru).

Persetujuan pengguna: **belum tercatat**.

## 3. Kontrak teknis

### 3.1 Migration Fase 1 `20261011090000_t24_product_events.sql`

- Tabel `internal.product_events`, `internal.product_event_epoch` (isi satu baris), `internal.pilot_participants` (§2.2.2, §2.2.5, §2.2.6), RLS aktif, revoke semua privilege.
- Fungsi `internal.product_event_properties_valid(text, jsonb) returns boolean` (`immutable`), `internal.record_product_event(uuid, text, jsonb)`.
- Fungsi trigger per sumber (§2.2.3), satu per tabel sumber atau satu per event dengan `TG_TABLE_NAME`; nama trigger diawali `product_event_` dan semuanya `AFTER … FOR EACH ROW`. Revoke fungsi trigger dari semua role.
- Fungsi `public.set_pilot_participant`, `public.get_pilot_metrics` (§2.2.7–8), `security definer`, `set search_path = pg_catalog`, grant hanya ke `service_role`, `comment on function` berlabel `T24`.
- Tidak mengganti fungsi T02–T23.

### 3.2 Migration Fase 4 (bersyarat) `20261011100000_t24_performance_indexes.sql`

Hanya `create index` yang memenuhi §2.2.12, masing-masing dengan komentar SQL satu baris berisi alasan dan operasi yang dilayani.

### 3.3 Test dan alat ukur

- `tests/perf/stats.ts`: `percentileNearestRank(values, p)`, `summarize(samples) → { n, p50, p95, max }`. Unit di `tests/unit/perf-stats.test.ts`.
- `tests/perf/perf-support.ts`: pembuatan akun P/Q lewat Admin API, `sql()` (pakai ulang dari `tests/integration/cv-export-support.ts:61` lewat import atau salinan minimal), pengumpulan info lingkungan, penulisan hasil ke `WORKPULSE_PERF_OUT` (default `docs/verification/T24-perf-results.json`).
- `tests/perf/seed.ts`: SQL seed per batch lewat RPC dengan klaim JWT (§2.2.10, §6), idempotent per label akun, dan pembersihan akun di akhir suite.
- `tests/perf/read-write.test.ts`: pengukuran §1.13–1.14, assertion p95 terhadap target, lalu tulis hasil.
- `vitest.perf.config.ts`: pola `vitest.pdf.config.ts`, `include: ["tests/perf/**/*.test.ts"]`, `maxWorkers: 1`, timeout 600 detik. Tidak masuk `pnpm test` (`vitest.config.ts` hanya `tests/unit/**`).

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20261011090000_t24_product_events.sql` |
| Create (bersyarat) | `supabase/migrations/20261011100000_t24_performance_indexes.sql` |
| Create | `supabase/tests/database/product_events.test.sql` |
| Modify | `src/server/supabase/database.types.ts` (`pnpm db:types`; harapannya hanya dua fungsi `public` baru) |
| Create | `tests/integration/product-events.test.ts` |
| Create | `tests/perf/{perf-support,seed,stats}.ts`, `tests/perf/read-write.test.ts`, `vitest.perf.config.ts` |
| Create | `tests/unit/perf-stats.test.ts` |
| Modify | `package.json` (dua script baru), `README.md` (Fase 7) |
| Create | `docs/verification/T24-perf-results.json` (Fase 5) |
| Create (Fase 7) | `docs/decisions/0030-t24-instrumentation-performance.md`, `docs/verification/T24-pilot-metrics-runbook.md`, `docs/verification/T24-instrumentation-performance.md` |

Tidak ada perubahan di `src/` selain `database.types.ts`, dan tidak ada perubahan di `workers/`.

Script baru:

- `test:integration:product-events` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/product-events.test.ts`
- `test:perf` → `vitest run --config vitest.perf.config.ts --configLoader native`

## 5. Fase eksekusi

### Fase 0 — Baseline, persetujuan, dan pengukuran awal (tanpa edit kode)

- [ ] Pastikan §2.4 berisi persetujuan pengguna yang tercatat. Bila belum, **stop**.
- [ ] Catat `git status --short --branch` dan HEAD (harapan `d950073` atau turunannya, termasuk commit plan ini). Working tree harus bersih kecuali `.claude/`; jika tidak, **stop**.
- [ ] Siapkan environment:
  - `pnpm install --frozen-lockfile`.
  - `pnpm exec supabase migration list --local`: parity harus **33/33** dengan migration terakhir `20261009100000_t23_retention.sql`.
  - Bila Docker mati, nyalakan dan jalankan `pnpm db:start` (tanpa reset).
  - Pastikan `workpulse-t21-pdf` hidup (integration export). ClamAV T10 dan Gotenberg T15 dibutuhkan Fase 6.
- [ ] Jalankan baseline dengan harapan berikut:

  | Command | Harapan |
  | --- | --- |
  | `pnpm lint`, `pnpm typecheck`, `pnpm worker:check` | lulus |
  | `pnpm test` | 113 file / 1035 test |
  | `pnpm db:test` | 17 file / 1439 assertion |
  | `pnpm test:integration:account-deletion` | 2 file / 14 test |
  | `pnpm test:integration:dashboard`, `test:integration:import-commit`, `test:integration:cv-export` | lulus; catat angka (cv-export harapan 35) |

- [ ] Verifikasi dari source dan catat file:baris untuk:
  - **Jalur tulis yang memicu event:** insert `activities` (`20260917160000_t06_activity_persistence.sql:459`), insert achievement (`20260922100000_t09_achievements_skills.sql:474,501,513`, `20260929090000_t14_ai_review.sql:791`, `20261001090000_t16_import_commit.sql:889`), insert foundation dan project (definisi terakhir `create_*_idempotent`), transisi status achievement (`save_achievement` terakhir di `20260922110000_t09_achievement_null_patch.sql:3`), `committed` dan `commit_result` (`20261001090000_t16_import_commit.sql:925-946`), transisi export (`20261005090000_t21_cv_export_backend.sql:233,559-608`).
  - **Trigger yang ada** pada delapan tabel sumber (nama dan urutan), termasuk `zz_guard_account_writable`. Catat apakah ada test pgTAP yang mengunci daftar trigger secara persis.
  - **FK cascade** `profiles.id → auth.users on delete cascade` (`20260916090000_foundation_schema.sql:183`) dan pembuatan profil saat signup (`:415-432`).
  - **Layanan yang diukur:** `src/features/dashboard/dashboard-service.ts:101-130`, `src/features/activity/activity-service.ts:179-311`, `src/features/achievement/achievement-service.ts:139,322`, `src/features/project/project-service.ts:209,379`, `src/features/timeline/timeline-service.ts:62-98`; tanda tangan input filter dan cursor masing-masing.
  - **Indeks yang ada** untuk `activities`, `achievements`, `projects`, `achievement_skills`, `evidence_files` (mis. `activities_user_occurred_on_id_idx`, `achievements_user_status_date_id_idx`).
  - **Helper test:** `tests/integration/cv-export-support.ts:61` (`sql()`), `createAccount`, `drain`, dan helper import commit yang dipakai `tests/integration/import-commit.test.ts`.
- [ ] **Probe performa awal** (tanpa commit kode; skrip sementara di luar repo atau dihapus sebelum commit): seed akun P dan Q dengan volume §6, jalankan `EXPLAIN (ANALYZE, BUFFERS)` untuk query utama dashboard, list, dan timeline, dan ukur 20 sampel per operasi baca. Catat angka sebagai **baseline sebelum T24** (tanpa trigger event). Bersihkan akun probe.
- [ ] Catat persetujuan §2.4 di receipt.
- [ ] Tulis receipt `docs/verification/T24-phase0-baseline.md` dan commit `docs(t24): add phase 0 baseline receipt`. Serahkan angka probe dan plan ke checkpoint Claude sebelum Fase 1.

### Fase 1 — Database: event, kohort, metrik (TDD pgTAP)

- [ ] Test gagal lebih dulu di `supabase/tests/database/product_events.test.sql`:
  - **Katalog dan grant:** tiga tabel internal dengan RLS dan tanpa privilege `anon`/`authenticated`/`service_role`; `set_pilot_participant`/`get_pilot_metrics` ditolak untuk `authenticated` dan `anon`; FK cascade ke `profiles`.
  - **Trigger per event (§1.1):** satu RPC per jalur sebagai `authenticated` (klaim JWT) → tepat satu event dengan properti yang diharapkan; edit activity, edit confirmed achievement, reorder CV → nol event baru.
  - **Atomik dan idempotent (§1.2):** RPC yang gagal karena `STALE_REVISION` dan import commit yang rollback → nol event; `create_activity_idempotent` dengan key sama dua kali → satu event.
  - **Allowlist (§1.3):** insert langsung (superuser) dengan kunci tak dikenal, string bebas, atau ID record → CHECK gagal.
  - **`local_date`:** profil `Asia/Jakarta`, event pada 23:30 UTC → `local_date` hari berikutnya.
  - **Kohort (§1.5):** empat kode error §2.2.7, idempotensi enroll, penarikan diri final, akun sebelum epoch ditolak (`created_at` dimundurkan).
  - **Metrik (§1.6–1.10):** fixture event dengan `occurred_at` dimundurkan: batas 24 jam, 7 hari, 28 hari; minggu ISO dan zona waktu; export gagal lalu sukses = 0,5; `ACCOUNT_DELETING` dikeluarkan; akun non-kohort dan peserta yang menarik diri tidak dihitung; `pending` untuk jendela belum selesai; `rate` NULL saat `eligible = 0`.
  - **Cascade:** `delete from auth.users` akun uji → nol event dan nol baris peserta.
- [ ] Implementasi §3.1. Terapkan dengan `pnpm exec supabase migration up --local`. Jalankan `pnpm db:test`, `pnpm db:lint`, `pnpm db:types`, `pnpm typecheck`.
- [ ] Bila test lama gagal karena trigger baru (misalnya daftar trigger persis), **stop** dan laporkan. Jangan melemahkan test lama.
- [ ] Commit `feat(t24): add product events, pilot cohort and pilot metrics`, lalu receipt Fase 1.

### Fase 2 — Integration event lintas domain

- [ ] `tests/integration/product-events.test.ts` dengan Supabase + Auth nyata (fixture §6):
  - service activity (Note, Form, Chat), achievement (draft → confirm, standalone), project, foundation → event sesuai §1.1;
  - import commit lewat service/RPC nyata dengan batch staging fixture → `import_committed` dengan hitungan, `career_record_created` per record yang dibuat, `achievement_confirmed` untuk item yang dikonfirmasi;
  - export lewat worker nyata dengan renderer fake sukses dan fake gagal (`drain`) → `cv_export_finished` per transisi; retry sukses → dua event;
  - sentinel §6 tidak muncul di `internal.product_events` (query `sql()` atas `properties::text`);
  - PostgREST: `authenticated` tidak dapat membaca tabel internal maupun memanggil dua RPC baru;
  - kohort: daftarkan akun A, tidak daftarkan B, `get_pilot_metrics` hanya menghitung A (waktu event dimundurkan lewat `sql()` agar jendela selesai);
  - penghapusan akun A lewat jalur T23 (begin → worker deletion → verify) → nol event dan nol baris peserta; event B utuh.
- [ ] Tambah script `test:integration:product-events`. Jalankan suite itu, `pnpm test:integration:account-deletion`, dan `pnpm test:integration:import-commit`.
- [ ] Commit `test(t24): add product event integration across domains`, lalu receipt Fase 2.

### Fase 3 — Alat ukur dan seed performa (TDD unit)

- [ ] Test gagal lebih dulu di `tests/unit/perf-stats.test.ts`: nearest-rank untuk n = 1, 20, 50, 51; nilai tidak terurut; array kosong → error; p di luar 0–100 → error.
- [ ] Implementasi `tests/perf/stats.ts`, `perf-support.ts`, `seed.ts`, `vitest.perf.config.ts`, script `test:perf`.
- [ ] Seed diverifikasi: `count(*)` per tabel akun P sesuai §6, Q sama, dan seed kedua dengan label yang sama tidak menggandakan data.
- [ ] Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `test(t24): add performance seed and percentile helpers`, lalu receipt Fase 3.

### Fase 4 — Query plan dan indeks (bersyarat)

- [ ] Dengan dataset §6 dan trigger T24 aktif, catat `EXPLAIN (ANALYZE, BUFFERS)` untuk setiap query baca §1.13. Untuk RPC (`get_dashboard_summary`, `get_cv_review_summary`, `list_demonstrated_skills`, `filter_achievements`, `filter_projects`) gunakan `auto_explain` sesi (`load 'auto_explain'; set auto_explain.log_nested_statements = on; …`) atau `EXPLAIN` atas query di badan fungsi; catat metode yang dipakai.
- [ ] Nilai setiap plan terhadap §2.2.12. Bila ada yang memenuhi:
  - tulis pgTAP yang mengunci keberadaan indeks (`has_index`);
  - buat `20261011100000_t24_performance_indexes.sql`, terapkan, ulangi plan dan 20 sampel;
  - `pnpm db:test`, `pnpm db:lint`, `pnpm db:types` (harapan tanpa diff tipe);
  - commit `perf(t24): add indexes proven by query plans`.
- [ ] Bila tidak ada yang memenuhi: jangan membuat migration; tulis alasan per query di receipt.
- [ ] Receipt Fase 4 berisi plan ringkas (node utama, waktu, buffers) sebelum/sesudah.

### Fase 5 — Pengukuran p95

- [ ] Implementasi `tests/perf/read-write.test.ts` (§1.13–1.15, §2.2.11). Jalankan `pnpm test:perf` dengan stack lokal tanpa suite lain berjalan bersamaan.
- [ ] Bila p95 melewati target: catat angka apa adanya, kembali ke Fase 4 sekali dengan bukti plan; bila tetap gagal, **stop** dan laporkan (jangan melonggarkan target atau mengurangi dataset).
- [ ] Simpan `docs/verification/T24-perf-results.json`. Ringkas tabel operasi × (n, p50, p95, max, cold) di receipt, bersama lingkungan dan batas metode.
- [ ] Jalankan `pnpm test:perf` sekali lagi dan catat variasi p95 antar run.
- [ ] Commit `test(t24): add p95 read and save measurements`, lalu receipt Fase 5.

### Fase 6 — Regresi penuh

- [ ] Jalankan seluruh §7. `test:e2e:m2` dan `test:e2e:m3` wajib lulus tanpa melemahkan assertion env (kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk run itu). ClamAV, Gotenberg T15, dan renderer T21 wajib berjalan untuk suite yang membutuhkannya; bila tidak, catat **tidak dijalankan** beserta alasan. Jangan menjalankan dua suite E2E bersamaan (keduanya memakai `.next` dan kuota sign-in yang sama). Flaky bawaan dicatat sebagai flaky hanya bila lulus saat diulang tanpa perubahan.
- [ ] Periksa diff dan hygiene:
  - `git diff <HEAD Fase 0> -- supabase/migrations` hanya berisi migration §2.2.13;
  - `git diff <HEAD Fase 0> --stat` hanya menyentuh file §4;
  - `git diff <HEAD Fase 0> -- src workers` hanya `database.types.ts`;
  - grep `console.` di `tests/perf` sesuai §1.17;
  - grep sentinel, email, dan key di receipt dan `T24-perf-results.json` nihil;
  - `git diff --check <HEAD Fase 0>..HEAD`.
- [ ] Bersihkan akun P, Q, dan fixture; catat nol user `t24-*` tersisa.
- [ ] Tulis receipt `docs/verification/T24-phase6-regression.md` dan commit `test(t24): record regression receipt`. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–6, output command, file hasil perf, dan daftar acceptance yang belum terbukti.

### Fase 7 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0030-t24-instrumentation-performance.md`: keputusan §2.2 dan persetujuan §2.4, alasan trigger vs RPC, allowlist event, alternatif yang ditolak (SDK pihak ketiga, event browser, event `account_deleted`, toggle consent di aplikasi), hasil indeks (ditambah atau tidak, dengan bukti), dan batas metode perf.
- [ ] `docs/verification/T24-pilot-metrics-runbook.md`:
  - langkah operator mendaftarkan dan menarik peserta (`set_pilot_participant` dengan service role, tanpa menempel key di dokumen);
  - query laporan `select * from public.get_pilot_metrics(now())` dan arti setiap kolom;
  - peringatan: target adalah hipotesis; n ≤ 20 sehingga satu akun mengubah rasio 5 poin;
  - akun yang dibuat sebelum epoch tidak dapat didaftarkan;
  - peserta yang menghapus akun keluar dari kohort;
  - observability penghapusan memakai `get_account_deletion_backlog` (runbook T23).
- [ ] `docs/verification/T24-instrumentation-performance.md`: pass/fail/warning/tidak dijalankan, trace ke PRD §4 *Performance targets*, PRD §5 *Pilot measures*, rencana T24, dan setiap poin §1, dengan tabel p95.
- [ ] README: script baru, cara menjalankan `test:perf`, dan tabel quality gates.
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- **Akun integration A dan B** (`t24-events-<uuid>@example.test`), timezone A `Asia/Jakarta`, B `UTC`. A memakai semua jalur §1.1; B hanya activity dan export.
- **Sentinel privat:** `WP-PRIVATE-T24-SENTINEL-<uuid>` di raw activity, judul achievement, judul project, judul CV, dan nama file batch import A. Sentinel tidak boleh muncul di tabel event, hasil `get_pilot_metrics`, receipt, atau file hasil perf.
- **Fixture metrik pgTAP:** akun sintetis dengan `profiles.created_at` dan `occurred_at` event yang dimundurkan (superuser) untuk batas §1.6–1.9; satu akun non-kohort dengan event yang memenuhi semua ukuran (harus tidak terhitung).
- **Dataset perf akun P** (`t24-perf-p@example.test`), timezone `Asia/Jakarta`:
  - 5 experiences (2 overlapping), 2 education, 3 certifications, 40 skills;
  - 50 projects: 30 terhubung experience, 20 standalone; status 10 `planned`, 20 `active`, 20 `completed` (5 tanpa outcome);
  - 1.000 activities tersebar merata selama 36 bulan; 300 terhubung project; capture mode campuran; panjang raw text 200–2.000 karakter (teks sintetis, tanpa data nyata);
  - 200 achievements: 120 derived dari activity, 80 standalone; 150 `confirmed`, 40 `draft`, 10 `dismissed`; 1–3 skill per achievement; metrics pada 60 achievement;
  - CV dengan 40 item terpilih lintas enam section;
  - tanpa evidence (pipeline scanner tidak dipakai di perf); batas ini dicatat, dan check *missing evidence* tetap dihitung atas 150 achievement confirmed.
- **Akun Q** (`t24-perf-q@example.test`): volume sama dengan P untuk realisme plan; tidak diukur.
- Password fixture dibuat acak per run (`randomBytes`) dan tidak dicetak. Setiap suite membersihkan akun dan objek Storage-nya.

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

`test:integration:product-events` dan `test:perf` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `test:ai:live` tidak dijalankan (T24 tanpa AI).

Aturan menjalankan suite:

- **Secret key.** `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan. Di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong. Output `db:start`/`db:status` memuat key; selalu saring.
- **Env per command.** Muat `.env.local` + key (dan `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` untuk suite export) dalam command yang sama dengan suite, karena env PowerShell tidak bertahan antar command.
- **Output.** Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`.
- **Edit file.** Untuk file ber-karakter non-ASCII gunakan tool Edit, bukan `Set-Content`.
- **Container.** Jangan menghentikan container Supabase, ClamAV T10, Gotenberg T15, atau `workpulse-t21-pdf`. Bila semua container berhenti bersamaan, `pnpm db:start` lalu `docker start` container tambahan (tanpa reset).
- **Port tereservasi.** Bila Supabase "healthy" tetapi port 54321/54322 tidak mendengar, cek `netsh int ipv4 show excludedportrange protocol=tcp`; perbaikannya butuh shell admin, jadi laporkan ke pengguna.
- **Perf.** Jalankan `test:perf` sendirian: tanpa suite lain, `next build`, atau `next dev` yang berjalan di checkout yang sama.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- §2.4 belum disetujui, working tree tidak bersih di Fase 0, atau parity tidak **33/33**.
- Implementasi menuntut penyimpangan dari keputusan §2.4 yang disetujui.
- Penyelesaian memerlukan:
  - mengedit migration yang sudah diterapkan atau `db reset`;
  - mengganti fungsi RPC T02–T23, mengubah state machine job, worker, atau UI;
  - DML langsung ke skema `auth` atau `storage` selain lewat Admin API dan baris uji pgTAP;
  - menyimpan ID record, teks, nama file, email, atau correlation ID di event.
- Trigger baru membuat suite lama gagal karena perilaku sah (bukan daftar trigger yang dikunci persis; kasus itu tetap dilaporkan sebelum test lama diubah).
- p95 tetap melewati target setelah satu putaran Fase 4; atau target hanya tercapai dengan mengurangi dataset, sampel, atau lapisan yang diukur.
- Scope bocor ke T25 (alert, staging, deploy, performa browser), UI consent, SDK analitik, atau fitur roadmap.
- Test membutuhkan key nyata, akun produksi, data pengguna nyata, atau sentinel/password muncul di output, log, receipt, atau file hasil.
- Perubahan pada suite lama (T02–T23, gate) diperlukan agar lulus.

## 9. Gate review Claude (setelah Fase 6)

Review read-only mencakup:

- **Event:**
  - semua jalur tulis §1.1 tertangkap, termasuk import commit, apply AI, dan worker export;
  - tidak ada event untuk edit, baca, atau retry idempotent;
  - atomik dengan transaksi domain;
  - allowlist ketat, tanpa ID record atau teks; sentinel nihil;
  - trigger tidak meredam error.
- **Akses:** tabel internal tanpa privilege; dua RPC baru hanya `service_role`; spot-check PostgREST.
- **Metrik:**
  - definisi §1.6–1.9 sesuai PRD dan §2.4;
  - batas jendela inklusif/eksklusif konsisten;
  - minggu ISO dan zona waktu;
  - `pending` dan `rate` NULL;
  - kohort hanya peserta aktif setelah epoch;
  - target ditulis sebagai hipotesis di runbook.
- **Penghapusan:** cascade dari `profiles`, tanpa perubahan fungsi T23, dan integration membuktikan nol baris.
- **Performa:**
  - dataset sesuai §6 dan dihitung ulang;
  - lapisan, sampel, warm/cold, dan lingkungan tercatat;
  - p95 dihitung benar (reviewer menghitung ulang dari sampel mentah di `T24-perf-results.json`);
  - reviewer menjalankan ulang `pnpm test:perf` dan membandingkan dengan hasil pelaksana;
  - indeks hanya dengan bukti plan sebelum/sesudah.
- **Batas scope dan hygiene:** hanya file §4, tanpa dependency baru, tanpa perubahan `src/` selain tipe, tanpa `console.` yang mencetak data, dan angka receipt cocok dengan hasil ulang.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Event yang hilang atau ganda.** Jalur tulis yang tidak lewat tabel yang diberi trigger, retry idempotent yang menyisipkan baris lagi, atau transisi `confirmed → draft → confirmed` yang dihitung ganda sebagai aktivasi. Dijaga oleh pgTAP per jalur, test idempotensi, dan definisi metrik "minimal satu event" (bukan jumlah event).
2. **Kebocoran konten lewat properti.** Properti `jsonb` yang tampak aman tetapi menerima string bebas (mis. `error_code` yang tidak dibatasi allowlist), atau ID record yang dapat di-join ke konten. Dijaga oleh CHECK allowlist, pgTAP penolakan, dan pencarian sentinel di integration.
3. **Metrik yang salah di batas.** Off-by-one di 24 jam/7 hari/28 hari, minggu dihitung dari UTC padahal PRD bicara pengguna, atau akun yang jendelanya belum selesai dihitung gagal sehingga rasio tampak buruk. Dijaga oleh fixture batas pgTAP dan kolom `pending`.
4. **Fixture tercampur ke laporan.** Akun test, perf, atau akun yang dibuat sebelum epoch masuk kohort. Dijaga oleh pendaftaran eksplisit, penolakan epoch, dan test bahwa akun non-kohort yang memenuhi semua ukuran tidak terhitung.
5. **Angka performa yang tidak dapat dipercaya.** Dataset lebih kecil dari target, cache hangat yang menutupi plan buruk, p95 dari sampel terlalu sedikit, atau hanya waktu SQL yang diukur padahal halaman memanggil beberapa query. Dijaga oleh `count(*)` dataset, minimal 50 sampel, pengukuran di lapisan service, plan `EXPLAIN ANALYZE`, dan run ulang reviewer.
6. **Trigger event memperlambat save atau mengubah perilaku lama.** Lookup timezone per event, lock yang tidak perlu pada `profiles`, atau error trigger yang menggagalkan save sah. Dijaga oleh pengukuran save dengan trigger aktif (§1.14), pgTAP, dan regresi penuh tanpa perubahan suite lama.

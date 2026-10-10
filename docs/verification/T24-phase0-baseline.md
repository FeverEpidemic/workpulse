# T24 Fase 0 — Baseline, verifikasi source, dan probe performa

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `f6b5237` (`docs(t24): record user approval of frozen decisions`), branch `claude/clever-archimedes-gbu7qd`
- Tidak ada edit kode atau migration di fase ini. Satu-satunya file baru adalah receipt ini.

## Pemeriksaan awal

| Item | Hasil |
| --- | --- |
| HEAD memuat `f6b5237` | Ya (`git merge-base --is-ancestor f6b5237 HEAD` exit 0; HEAD sendiri adalah `f6b5237`) |
| Working tree | bersih kecuali `.claude/setting.local.json` (untracked, diizinkan) |
| Parity migration | **33/33**, `supabase migration list --local` (33 file di `supabase/migrations`, semua `local = remote`), terakhir `20261009100000_t23_retention.sql` |
| `pnpm install --frozen-lockfile` | exit 0 ("Already up to date") |
| Container | Supabase hidup kecuali `supabase_vector_WorkPulse` (restart-loop; tidak berdampak pada suite yang dijalankan, semuanya lulus), `workpulse-t10-clamav` (healthy), `workpulse-t15-gotenberg`, `workpulse-t21-pdf` hidup |
| Persetujuan §2.4 | **Tercatat.** Pengguna menyetujui kedelapan keputusan produk pada 10 Oktober 2026 ("Setuju semua"); commit `f6b5237`. Tidak ada penyimpangan yang ditemukan di fase ini. |

## Baseline (command nyata)

`SUPABASE_SECRET_KEY` diambil dari `SERVICE_ROLE_KEY` hasil `supabase status -o env` ke env proses saja dan tidak dicetak. `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan. Env dimuat dalam command yang sama dengan suite.

| Command | Hasil | Harapan plan |
| --- | --- | --- |
| `pnpm lint` | exit 0 | lulus |
| `pnpm typecheck` | exit 0 | lulus |
| `pnpm worker:check` | exit 0 (`status: ready`, 9 job terdaftar) | lulus |
| `pnpm test` | exit 0, **113 file / 1035 test** | 113 / 1035 |
| `pnpm db:test` | exit 0, **17 file / 1439 assertion**, `Result: PASS` | 17 / 1439 |
| `pnpm test:integration:account-deletion` | exit 0, **2 file / 14 test** (151 detik) | 2 / 14 |
| `pnpm test:integration:dashboard` | exit 0, **1 file / 4 test** | lulus |
| `pnpm test:integration:import-commit` | exit 0, **1 file / 11 test** | lulus |
| `pnpm test:integration:cv-export` | exit 0, **3 file / 35 test** | 35 |

Catatan: suite `cv-export` mencetak `Warning: Cannot load "@napi-rs/canvas"`; suite tetap lulus. Warning ini sudah ada sebelum T24.

## Verifikasi source (file:baris)

Semua baris di bawah dibuka dan dicocokkan dengan isi file pada HEAD `f6b5237`.

### Jalur tulis yang memicu event

| Jalur | Lokasi terverifikasi | Catatan |
| --- | --- | --- |
| Insert `activities` | `20260917160000_t06_activity_persistence.sql:459` di `internal.create_activity` (`:354`); wrapper `public.create_activity_idempotent` `:610` | `capture_mode` dibatasi CHECK `note`/`form`/`chat` (`:105`); chat menyisipkan `chat_messages` terpisah (`:468`), tidak menambah activity |
| Insert achievement kosong | `20260922100000_t09_achievements_skills.sql:474` (turunan activity), `:501` (project), `:513` (experience atau tanpa konteks), di `create_achievement_idempotent` (`:336`) | **Menyisipkan draft kosong** (semua field NULL). Lihat temuan T1. `origin` CHECK `manual`/`activity`/`import` (`:149`) |
| Insert achievement dari AI | `20260929090000_t14_ai_review.sql:791` di `apply_ai_suggestion` (`:677`), `status = 'draft'`, `origin = 'activity'` | Cabang update draft kosong (`:835`) tidak menyentuh `status` |
| Insert achievement dari import | `20261001090000_t16_import_commit.sql:889`, `status` `confirmed` atau `draft` menurut `confirm_requested` (`:896`), `origin = 'import'` | Satu baris per item `create` |
| Insert experiences/education/certifications | definisi **terakhir** `internal.create_foundation_record` di `20260916190000_t03_foundation_contract_hardening.sql:388`; insert `:548`, `:567`, `:586`. Wrapper `create_{experience,education,certification}_idempotent` di `20260916170000_t03_foundation_create_idempotency.sql:318`, `:364`, `:410` | Plan menyebut "definisi terakhir `create_*_idempotent`"; yang menulis adalah fungsi internal ini |
| Insert experiences/education/certifications dari import | `20261001090000_t16_import_commit.sql:815`, `:833`, `:851` | |
| Insert `projects` | definisi terakhir `create_project_idempotent` di `20260921090000_t08_review_remediation.sql:5`, insert `:170` | Versi lebih lama: `20260920100000:95/:241`, `20260920102000:3/:149` |
| Transisi status achievement | definisi terakhir `save_achievement` di `20260922110000_t09_achievement_null_patch.sql:3`; pemetaan aksi → status `:112-134`; `update ... set status = v_status` `:199-211` | `UPDATE` selalu menyertakan kolom `status` walau tidak berubah; trigger harus memeriksa `old.status <> 'confirmed'` |
| Import commit | `commit_import_batch` `20261001090000_t16_import_commit.sql:690`; `commit_result` dibangun `:925-940`; update ke `committed` `:943-946`; handler exception `:947-951` | Blok `begin … exception` membuat subtransaksi, sehingga event dari trigger ikut batal saat `IMPORT_ITEM_INVALID` |
| Transisi export ke terminal | sukses: `complete_cv_export` `20261005090000_t21_cv_export_backend.sql:559-608` (update `:601-605`); gagal: `internal.fail_cv_export_locked` `:233-246` | Lihat temuan T5 |

Pemanggil `fail_cv_export_locked` (semuanya mensyaratkan status lama `running`): `expire_cv_export_leases` `:482` (`EXPORT_TIMEOUT`, seleksi `:467/:477`), `get_cv_export_input` `:552` (`ACCOUNT_DELETING`, cek `:547`), `complete_cv_export` `:593` (`ACCOUNT_DELETING`, cek `:588`), `fail_cv_export` `:635` (cek `:631`). Klaim memindahkan `queued → running` di `:509`. Tidak ada jalur `queued → failed` di T21; `retry_cv_export` dan `expire_cv_exports` versi T23 (`20261009100000_t23_retention.sql:119,150,210`) tidak mengubah status ke terminal. Allowlist kode error: `:621-622` (`EXPORT_TIMEOUT`, `RENDERER_UNAVAILABLE`, `RENDERER_TIMEOUT`, `EXPORT_RENDER_INVALID`, `EXPORT_TOO_LONG`, `EXPORT_SNAPSHOT_INVALID`, `STORAGE_UNAVAILABLE`, `ACCOUNT_DELETING`).

Bentuk `commit_result` (`:938-940`): `{ schema_version: "import-commit.v1", counts: { profile|experience|education|certification|skill|achievement: { created, mapped, skipped } }, confirmed_achievements, profile_fields_applied, onboarding_completed }`.

### Trigger yang ada pada sumber event (query `pg_trigger` di database lokal)

| Tabel | Trigger (BEFORE kecuali disebut) |
| --- | --- |
| `activities` | `activities_enforce_context` (I/U), `activities_evidence_cleanup_before_delete` (D), `activities_guard_row` (U), `zz_guard_account_writable` (I/U/D); AFTER: `activities_sync_achievement_context` (U) |
| `achievements` | `achievements_enforce_context` (I/U), `achievements_evidence_cleanup_before_delete` (D), `achievements_guard_row` (U), `zz_guard_account_writable` (I/U/D) |
| `projects` | `projects_evidence_cleanup_before_delete` (D), `projects_touch_mutable_row` (U), `zz_guard_account_writable`; AFTER: `projects_sync_achievement_experience` (U), `projects_sync_activity_experience` (U) |
| `experiences` | `experiences_clear_project_context` (D), `experiences_touch_mutable_row` (U), `zz_guard_account_writable` |
| `education` | `education_touch_mutable_row` (U), `zz_guard_account_writable` |
| `certifications` | `certifications_touch_mutable_row` (U), `zz_guard_account_writable` |
| `import_batches` | `import_batches_guard_row` (U), `zz_guard_account_writable` |
| `cv_exports` | `cv_exports_a_guard` (U), `cv_exports_touch_mutable_row` (U), `zz_guard_account_writable` |

Tidak ada trigger AFTER INSERT atau AFTER UPDATE OF `status` yang sudah ada pada delapan tabel, jadi nama `product_event_*` tidak bertabrakan.

**Test pgTAP yang menyentuh daftar trigger:** tidak ada yang mengunci daftar persis.

- `account_deletion.test.sql:13-34` menghitung trigger bernama `zz_guard_account_writable` pada tabel `public` ber-`user_id` (+ `profiles`). Tabel `internal` baru T24 tidak masuk hitungan itu.
- `cv_export.test.sql:34-36` memeriksa dua trigger bernama ada (`= 2`).
- `import_commit.test.sql:24` memeriksa `import_items_validate_target` ada.

### FK cascade

- `profiles.id → auth.users(id) on delete cascade` di `20260916090000_foundation_schema.sql:183`. Pembuatan profil saat signup: `internal.handle_auth_user_created` `:415-428`, trigger `on_auth_user_created_workpulse_profile` `:430-432`. `profiles.created_at` bertipe `timestamptz not null default now()` (`:197`), `timezone text not null default 'UTC'` (`:192`).
- Query katalog: 15 tabel domain punya `user_id → profiles(id)` dengan `ON DELETE CASCADE` (achievements, activities, ai_jobs, ai_suggestion_reviews, certifications, chat_messages, cv_documents, cv_exports, cv_items, education, evidence_files, experiences, import_batches, projects, skills).

### Layanan yang diukur

| Layanan | Lokasi terverifikasi | Input |
| --- | --- | --- |
| `createDashboardService().getDashboard` | `src/features/dashboard/dashboard-service.ts:101-130` | tanpa argumen; 1 `auth.getUser()` + 5 query paralel: RPC `get_dashboard_summary`, `get_cv_review_summary`, `list_demonstrated_skills(12)`, 5 activity terbaru, 5 project aktif |
| `createActivityService().listActivities` | `src/features/activity/activity-service.ts:276-309` (factory `:179`) | `{ from?, to?, projectId?, cursor? }` (strict, `schemas.ts:60`); halaman 30 (`ACTIVITY_LIST_PAGE_SIZE`), cursor `occurred_on.lt…and(…id.lt…)` |
| `createAchievementService().listAchievements` | `src/features/achievement/achievement-service.ts:322-354` (factory `:139`) | `{ status?, projectId?, skillId?, missingEvidence?: true, cursor? }` (`schemas.ts:50`); halaman 30; `missingEvidence`/`skillId` lewat RPC `filter_achievements`; enrich memuat semua achievement confirmed milik akun (`loadSkills` `:158-200`) |
| `createProjectService().listProjects` | `src/features/project/project-service.ts:379-416` (factory `:209`) | `{ status?, outcomeMissing?: true, cursor? }` (`schemas.ts:95`); halaman 30; `outcomeMissing` lewat RPC `filter_projects` |
| `createTimelineService().getTimeline` | `src/features/timeline/timeline-service.ts:62-114` | `{ type: "", project: "" }` (`TimelineFilters`); 4 query paralel, `TIMELINE_SOURCE_LIMIT + 1 = 501` |
| Save | `createActivity` (`activity-service.ts:204`), `updateActivity` (`:240`), `createProject` (`project-service.ts:322`), `updateProject` (`:353`), `createAchievement` (`achievement-service.ts:237`), `saveAchievement` (`:255`) | |

Setiap operasi layanan memanggil `client.auth.getUser()` lebih dulu (satu hop HTTP ke Auth), lalu satu atau lebih hop PostgREST. Semuanya termasuk dalam angka layanan.

PostgREST `max_rows = 1000` (`supabase/config.toml:18`).

### Indeks yang ada (query `pg_indexes`)

| Tabel | Indeks relevan |
| --- | --- |
| `activities` | `activities_user_occurred_on_id_idx (user_id, occurred_on desc, id desc)`, `activities_user_project_occurred_on_id_idx (user_id, project_id, occurred_on desc, id desc)`, `activities_user_id_id_key` |
| `achievements` | `achievements_user_status_date_id_idx (user_id, status, achieved_on desc nulls last, id desc)`, `achievements_user_project_date_id_idx`, `achievements_user_activity_idx`, `achievements_one_derived_activity_idx`, `achievements_user_id_id_key` |
| `projects` | `projects_user_status_updated_at_id_idx (user_id, status, updated_at desc, id)`, `projects_experience_fk_idx`, `projects_user_id_id_key` (tidak ada indeks `(user_id, updated_at, id)` atau `(user_id, start_date, id)`) |
| `achievement_skills` | `achievement_skills_pkey (user_id, achievement_id, skill_id)`, `achievement_skills_skill_idx (user_id, skill_id, achievement_id)` |
| `evidence_files` | `evidence_files_achievement_idx`, `_activity_idx`, `_project_idx`, `_quota_idx`, `_user_id_id_key` |
| `experiences` | `experiences_user_start_date_id_idx` |

### Helper test

`tests/integration/cv-export-support.ts:61` (`sql()`, `docker exec … psql -c`), `createAccount` `:77`, `drain` (worker export), dan helper import commit di `tests/integration/import-commit.test.ts`. Untuk cleanup akun yang berisi data, helper yang benar adalah `tests/integration/account-deletion-support.ts` (`runUntilCompleted`, `receipt`, `teardownHarness` `:283-297`), karena `deleteUser` biasa gagal pada akun berpopulasi (komentar `:286`).

## Probe performa awal (tanpa trigger event, tanpa commit kode)

### Metode

- Skrip sementara berupa file Vitest di direktori untracked `tests/_t24_probe_tmp/` dengan config sendiri. Direktori itu **dihapus sebelum commit**; salinannya disimpan di luar repo. Tidak ada file probe yang masuk commit.
- Dua akun dibuat lewat Admin API (`t24-probe-p-*@workpulse.test`, `t24-probe-q-*@workpulse.test`), profil `Asia/Jakarta`, lalu di-seed **lewat RPC** (bukan INSERT langsung) dengan klaim JWT di psql (`set local role authenticated` + `set_config('request.jwt.claims', …)`) agar trigger dan constraint berjalan dan tanpa sign-in Auth. Setelah seed: `analyze` pada tabel yang di-seed.
- Seed memakai `create_experience/education/certification/skill/project/activity/achievement_idempotent`, `save_achievement`, `ensure_cv_document`, `select_cv_source`. Waktu seed dua akun: 5 detik.
- Hitungan diverifikasi dengan `count(1)` per akun (tabel di bawah). Akun Q memiliki volume sama dengan P di database yang sama.
- Pengukuran: layanan Node nyata (`createDashboardService` dst.) dengan client `authenticated` yang login password sekali, melalui Kong/PostgREST loopback ke PostgreSQL 17.6. `performance.now()` di sekitar satu panggilan layanan. Urutan operasi diacak per putaran (seed 24). Sampel pertama per operasi dicatat sebagai `first`; lalu 3 putaran pemanasan dibuang; lalu 20 sampel. p95 nearest-rank `sorted[ceil(0.95 × n) − 1]`.
- `first` **bukan** cold sejati: client sudah login dan buffer PostgreSQL hangat dari seed. Container tidak di-restart (alasan §2.2.11).
- `EXPLAIN (ANALYZE, BUFFERS)` dijalankan di psql sebagai `authenticated` dengan klaim akun P (RLS berlaku). Untuk tiga RPC dipakai `auto_explain` sesi dengan `log_nested_statements = on` dan `client_min_messages = log`; `auto_explain` ditolak untuk role `postgres` (`access to library "auto_explain" is not allowed`), sehingga sesi RPC dijalankan sebagai `supabase_admin` (superuser lokal, hanya untuk membaca plan; `set local role authenticated` sebelum memanggil RPC).
- Tiga percobaan gagal karena cacat skrip probe, bukan karena produk: `TypeError` pembacaan keluaran psql (sebelum run 1), `auto_explain` ditolak untuk `postgres` (sebelum run 1), dan validasi input `saveAchievement` pada bagian simpan (antara run 1 dan run 2). Akun terhapus oleh `afterAll` pada tiap percobaan. Hanya dua run yang berhasil yang dilaporkan di bawah.

### Lingkungan

| Item | Nilai |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 x64 |
| CPU / core / RAM | AMD Ryzen 7 PRO 5850U, 16 thread logis, 15 GiB |
| Docker | 29.6.1 (Docker Desktop, WSL2) |
| PostgreSQL | 17.6 on x86_64-pc-linux-gnu |
| Node | v24.18.0 |
| Supabase CLI | 2.117.0 |
| Vitest | 5.0.0 |
| HEAD | `f6b5237` |

### Dataset (dari `count(1)` setelah seed)

| Tabel | Akun P | Akun Q | Target §6 |
| --- | --- | --- | --- |
| activities | 1.000 | 1.000 | 1.000 |
| achievements | 200 | 200 | 200 |
| — confirmed / draft / dismissed | 150 / 40 / 10 | 150 / 40 / 10 | 150 / 40 / 10 |
| — turunan activity | 120 | 120 | 120 |
| — dengan metrics | **57** | **57** | 60 |
| projects | 50 | 50 | 50 |
| — terhubung experience | 30 | 30 | 30 |
| activities terhubung project | 300 | 300 | 300 |
| experiences / education / certifications / skills | 5 / 2 / 3 / 40 | sama | 5 / 2 / 3 / 40 |
| achievement_skills | 401 | 401 | 1–3 per achievement |
| chat_messages | 333 | 333 | (capture mode `chat`) |
| cv_items | 43 | 45 | 40 selected (+ parent otomatis) |

Selisih `metrics` 57 vs 60 berasal dari skrip probe (pola `k mod 10 < 3` jatuh pada tiga achievement `dismissed` yang tidak diberi metrics). Seed Fase 3 harus menaruh metrics pada 60 achievement termasuk pilihan yang pasti. Evidence: nol baris (sesuai §6).

### Hasil p95 baca (20 sampel warm per operasi; dua run)

| Operasi | first run 1 / run 2 (ms) | p50 run 1 / run 2 | **p95 run 1 / run 2** | max run 1 / run 2 | Target |
| --- | --- | --- | --- | --- | --- |
| S04 `getDashboard` | 90,5 / 101,8 | 82,3 / 84,0 | **114,2 / 104,1** | 127,1 / 112,7 | < 2.000 |
| S06 `listActivities` halaman 1 | 63,9 / 105,0 | 77,4 / 78,2 | **94,0 / 119,9** | 122,2 / 122,8 | < 2.000 |
| S06 `listActivities` halaman 3 (cursor) | 87,5 / 94,4 | 76,9 / 76,7 | **94,7 / 98,6** | 95,7 / 109,2 | < 2.000 |
| S06 `listActivities` filter project | 78,2 / 98,8 | 75,1 / 76,1 | **92,1 / 91,4** | 92,9 / 91,6 | < 2.000 |
| S07 `listAchievements` semua | 147,8 / 252,7 | 131,8 / 141,3 | **156,3 / 169,8** | 184,5 / 174,6 | < 2.000 |
| S07 `listAchievements` confirmed | 126,5 / 149,8 | 132,1 / 137,2 | **145,0 / 164,0** | 155,5 / 173,6 | < 2.000 |
| S07 `listAchievements` missing evidence | 143,9 / 167,0 | 137,1 / 139,1 | **154,0 / 167,5** | 158,1 / 185,4 | < 2.000 |
| S09 `listProjects` semua | 114,5 / 158,5 | 106,9 / 107,2 | **124,0 / 125,9** | 154,0 / 140,4 | < 2.000 |
| S09 `listProjects` outcome missing | 90,9 / 130,4 | 106,3 / 107,0 | **132,7 / 124,1** | 137,9 / 137,8 | < 2.000 |
| S11 `getTimeline` | 87,9 / 103,5 | 76,3 / 76,0 | **93,3 / 93,0** | 108,0 / 103,5 | < 2.000 |

Dengan n = 20, nearest-rank p95 = sampel urut ke-19, bukan estimasi yang stabil. Fase 5 memakai minimal 50 sampel.

### Baseline simpan sebelum trigger event (suplementer, run 2 saja, 20 sampel)

Di luar permintaan checkpoint (yang hanya meminta operasi baca), diukur karena baseline ini tidak dapat diambil lagi setelah trigger T24 terpasang dan risiko §10.6 membandingkannya.

| Operasi | p50 (ms) | **p95 (ms)** | max (ms) | Target |
| --- | --- | --- | --- | --- |
| `createActivity` (note) | 92,3 | **121,3** | 122,7 | < 1.000 |
| `updateActivity` | 77,9 | **92,9** | 93,8 | < 1.000 |
| `createProject` | 77,3 | **92,1** | 92,2 | < 1.000 |
| `updateProject` | 78,4 | **112,5** | 114,6 | < 1.000 |
| `saveAchievement` `save_draft` | 73,3 | **99,9** | 145,2 | < 1.000 |
| `saveAchievement` `confirm` | 74,2 | **106,4** | 121,7 | < 1.000 |

### Query plan (run 1, akun P, `EXPLAIN (ANALYZE, BUFFERS)`)

| Query | Node utama | Waktu eksekusi |
| --- | --- | --- |
| dashboard: 5 activity terbaru | Index Scan `activities_user_occurred_on_id_idx` | 0,098 ms |
| dashboard: 5 project aktif | Seq Scan `projects` (20 baris dari tabel ±100) + top-N heapsort | 0,139 ms |
| activities halaman 1 | Index Scan `activities_user_occurred_on_id_idx` | 0,078 ms |
| activities halaman 3 (cursor) | Index Scan `activities_user_occurred_on_id_idx` | 0,102 ms |
| activities filter project | Index Scan `activities_user_project_occurred_on_id_idx` | 0,182 ms |
| achievements semua | Seq Scan `achievements` (200 baris, cost 154) + top-N heapsort 71 kB | 0,763 ms |
| achievements confirmed | Index Scan `achievements_user_status_date_id_idx` | 0,149 ms |
| achievements missing evidence | Function Scan `filter_achievements` (200 baris) + top-N heapsort; 538 buffer hit | 3,338 ms |
| enrich: id achievement confirmed | Seq Scan `achievements` (150 baris) | 0,263 ms |
| enrich: link skill (150 id) | Seq Scan `achievement_skills` (300 baris) | 0,183 ms |
| projects semua | Seq Scan `projects` (50 baris) + quicksort 36 kB | 0,179 ms |
| projects outcome missing | Function Scan `filter_projects` + quicksort 30 kB | 0,634 ms |
| projects: hitung activity terkait (30 id) | Bitmap Index Scan `activities_user_project_occurred_on_id_idx` | 0,342 ms |
| timeline: experiences / education | Seq Scan (5 / 2 baris) + quicksort 25 kB | 0,055 / 0,041 ms |
| timeline: projects / achievements | Seq Scan (50 / 150 baris) + quicksort 31 / 38 kB | 0,078 / 0,278 ms |
| RPC `get_dashboard_summary` (auto_explain) | `Seq Scan on activities … rows=1` pada cek `exists`, plus Seq Scan achievements/achievement_skills/projects | **12,172 ms** |
| RPC `get_cv_review_summary` | loop plpgsql: `internal.cv_item_state` per item CV (43 item, ±150 sub-query) | **38,744 ms** |
| RPC `list_demonstrated_skills(12)` | agregasi atas 401 link + 150 achievement, 394 buffer hit | 3,221 ms |

Total tabel saat plan dibuat: `activities` 2.001 baris (P + Q + 1 lama), `achievements` 400, `projects` ±102, `achievement_skills` 802.

### Evaluasi terhadap kriteria indeks §2.2.12 (usulan untuk reviewer)

| Kriteria | Hasil probe |
| --- | --- |
| 1. Seq Scan pada tabel > 1.000 baris untuk query yang difilter `user_id` | Hanya `activities` melewati 1.000 baris (2.001). Query baca halaman memakai Index Scan. **Satu kemunculan literal:** `exists(select 1 from activities where user_id = actor.id)` di dalam `get_dashboard_summary` memakai Seq Scan (`rows=1`, 0,008 ms) karena estimasi 667 baris per pemilik pada tiga pemilik. Indeks `activities_user_occurred_on_id_idx` sudah ada dan dapat melayaninya; yang menentukan adalah pilihan planner pada statistik ini, bukan indeks yang hilang. Indeks baru tidak mengubah plan itu. Tabel lain (`achievements` 400, `projects` ±102, `achievement_skills` 802) di bawah 1.000 baris. |
| 2. Sort eksplisit > 50 ms yang dapat dilayani indeks | **Tidak ada.** Seluruh `EXPLAIN` query baca selesai di bawah 3,4 ms (terbesar: missing evidence 3,338 ms, yang waktunya ada di Function Scan 3,2 ms), sehingga tidak ada Sort yang dapat mendekati 50 ms. Sort terbesar adalah top-N heapsort 71 kB. |
| 3. p95 > 50% target (> 1.000 ms baca, > 500 ms save) | **Tidak ada.** p95 baca tertinggi 169,8 ms (run 2), p95 simpan tertinggi 121,3 ms. |

Kesimpulan awal: **belum ada query plan yang membenarkan migration indeks** (Fase 4 kemungkinan menghasilkan 33 → 34, tanpa migration 35). Yang berpotensi memenuhi kriteria 1 secara literal hanya cek `exists` pada `activities` di `get_dashboard_summary`, dan indeks baru tidak memperbaikinya. Keputusan akhir tetap di Fase 4 dengan trigger T24 aktif dan dataset §6 utuh.

## Temuan dan pertanyaan untuk reviewer (belum ada yang mengubah keputusan beku)

| ID | Temuan | Dampak pada plan | Usulan |
| --- | --- | --- | --- |
| T1 | `create_achievement_idempotent` menyisipkan draft **kosong** (`t09:474/:501/:513`). Dengan trigger AFTER INSERT sesuai §1.1, mengklik "new achievement" tanpa isi sudah menghasilkan `career_record_created`, yang menghitung Activation ("save one manual career record"). | Sesuai kalimat §1.1 ("saat achievement … dibuat"); tidak menyimpang. Membuat Activation bisa terpenuhi oleh draft kosong pada akun tanpa activity. | Pertahankan sesuai plan; tulis di runbook sebagai batas definisi. Reviewer yang memutuskan bila ingin penajaman (itu akan mengubah §1.1). |
| T2 | `commit_result.counts` memuat tipe `profile` dan `skill` di samping experience/education/certification/achievement. Menjumlahkan semua tipe untuk `created`/`mapped`/`skipped` membuat import yang hanya mengisi profil atau skill lolos `created + mapped > 0`, bertentangan dengan §2.4.3 ("Skill, nama profil … tidak dihitung"). | §2.2.3 hanya menulis "dijumlah dari `new.commit_result`" tanpa menyebut tipe. | Jumlahkan hanya `experience`, `education`, `certification`, `achievement`. Mohon konfirmasi sebelum Fase 1. |
| T3 | Pengguna bisa mengonfirmasi lewat `reopen → confirm` berkali-kali; `achievement_confirmed` ditulis per transisi. Ukuran memakai "minimal satu event", jadi tidak menggandakan metrik. | Sudah dicakup §10.1. | Tidak ada tindakan. |
| T4 | `delete from auth.users` / `profiles` gagal pada akun yang punya experience + project (probe T23, decision 0029; trigger `experiences_clear_project_context`). Test pgTAP "Cascade" Fase 1 harus memakai akun tanpa experience atau dengan purge terlebih dulu; kalau tidak, ia gagal bukan karena T24. Integration Fase 2 sudah memakai jalur T23. | Mengubah isi fixture test cascade, bukan desain. | Fixture cascade pgTAP: akun dengan event tetapi tanpa experience/project. |
| T5 | Semua transisi terminal export berasal dari `running` (lihat verifikasi). Kondisi trigger `old.status = 'running'` sudah lengkap. | Tidak ada. | Tidak ada tindakan. |
| T6 | Suite lama membocorkan akun: database lokal berisi **226 profil** padahal hanya sebagian dipakai; `deleteUser` biasa gagal pada akun berpopulasi (`account-deletion-support.ts:286`) dan beberapa suite (mis. `dashboard-timeline.test.ts:413-418`) memanggil `deleteUser` tanpa memeriksa hasil. | Di luar scope T24. Suite T24 sendiri wajib memakai jalur penghapusan T23 agar tidak menambah kebocoran, dan hitungan "nol user `t24-*` tersisa" (Fase 6) bergantung pada itu. | Pelaksana memakai `begin_account_deletion` + `runUntilCompleted` (seperti probe). Pembersihan 226 profil lama tidak dikerjakan. |
| T7 | Layanan memanggil `auth.getUser()` pada setiap operasi; angka layanan didominasi hop HTTP (≈75–170 ms), bukan waktu SQL (< 1 ms hingga 38 ms). `get_cv_review_summary` (38,7 ms DB) adalah komponen DB terlambat; itu loop N+1 di dalam plpgsql, bukan masalah indeks. | Tidak mempengaruhi target; relevan bila dataset tumbuh. | Catat di laporan T24; bukan lingkup indeks. |
| T8 | Seed probe memberi metrics pada 57 bukan 60 achievement (lihat dataset). | Hanya probe. | Seed Fase 3 memperbaiki distribusi. |

## Cleanup dan hygiene

- Akun probe dihapus lewat jalur T23 (`begin_account_deletion` → pass worker sampai receipt `completed` → `deleteUser` → hapus receipt uji).
- Verifikasi setelah run terakhir: `auth.users` dengan `t24-probe-%` = **0**; `public.profiles` = **226** (sama dengan sebelum probe); `internal.account_deletions` tidak `completed` = **0**; `internal.storage_jobs` terbuka = **0**.
- Direktori probe `tests/_t24_probe_tmp/` dihapus; `git status` setelah penghapusan hanya menampilkan `.claude/setting.local.json` (untracked) dan receipt ini.
- Tidak ada secret, email penuh, password, atau teks pengguna di receipt ini.

## Acceptance Fase 0

- Baseline: terbukti, semua angka sesuai harapan plan.
- Verifikasi file:baris dan inventaris trigger/FK/indeks: terbukti; satu klarifikasi (fungsi tulis experience/education/certification adalah `internal.create_foundation_record`).
- Probe performa: terbukti; semua p95 jauh di bawah target (baca ≤ 169,8 ms dari 2.000 ms; simpan ≤ 121,3 ms dari 1.000 ms).
- Persetujuan §2.4: tercatat.
- Stop condition §8: tidak ada yang terpicu.

## Blocker dan catatan

- Tidak ada blocker. Menunggu persetujuan reviewer Claude sebelum Fase 1, termasuk jawaban atas T2 (tipe entitas yang dijumlahkan) dan konfirmasi T1.
- `@napi-rs/canvas` warning di suite `cv-export` dan `supabase_vector_WorkPulse` restart-loop sudah ada sebelum T24.

## Langkah berikutnya

Setelah reviewer menyetujui: Fase 1 (migration `20261011090000_t24_product_events.sql`, parity 34/34) dengan test pgTAP lebih dulu.

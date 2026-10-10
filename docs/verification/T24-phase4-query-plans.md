# T24 Fase 4 — Query plan dan indeks

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `3ee27e8`
- Hasil: **tidak ada migration indeks**. Parity tetap **34/34**; `20261011100000_t24_performance_indexes.sql` tidak dibuat.
- Tidak ada perubahan kode di fase ini. Satu-satunya file baru adalah receipt ini.

## Metode

- Skrip sementara (Vitest di direktori untracked `tests/_t24_p4_tmp/`, dihapus sebelum commit) memakai `tests/perf/{perf-support,seed}.ts` dari Fase 3: akun P dan Q di-seed lewat RPC dengan dataset §6 dan **sepuluh trigger T24 aktif**.
- Tabel saat plan dibuat: `activities` 2.001, `achievements` 400, `projects` 102, `achievement_skills` 802, `internal.product_events` 2.820 baris.
- `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` per query baca §1.13, dijalankan sebagai `authenticated` dengan klaim akun P (RLS berlaku). Query halaman meniru SQL yang dikirim PostgREST (`select *` + filter `user_id` + order + limit 31, cursor halaman ketiga dari baris ke-60).
- Tiga RPC (`get_dashboard_summary`, `get_cv_review_summary`, `list_demonstrated_skills`) lewat `auto_explain` sesi dengan `log_nested_statements = on`, `log_analyze = on`, `log_buffers = on`, `client_min_messages = log`. `auto_explain` ditolak untuk role `postgres`, sehingga sesi itu memakai `supabase_admin` hanya untuk membaca plan, lalu `set local role authenticated`.
- 20 sampel layanan per operasi baca dan simpan setelah 3 putaran pemanasan dibuang, untuk perbandingan sebelum/sesudah trigger. Akun P dan Q dihapus lewat jalur T23 (0 user `t24-perf-*` tersisa, 0 event yatim).
- Lingkungan: sama dengan Fase 0 (Windows 11, Ryzen 7 PRO 5850U, 15 GiB, Docker 29.6.1, PostgreSQL 17.6, Node v24.18.0).

## Plan (dengan trigger T24 aktif)

| Query | Node utama | Waktu | Buffer (exec) |
| --- | --- | --- | --- |
| dashboard: 5 activity terbaru | Index Scan `activities_user_occurred_on_id_idx` | 0,113 ms | 3 hit |
| dashboard: 5 project aktif | Seq Scan `projects` (20 baris dari 102) + top-N heapsort 25 kB | 0,113 ms | 8 hit |
| activities halaman 1 | Index Scan `activities_user_occurred_on_id_idx` | 0,079 ms | 6 hit |
| activities halaman 3 (cursor) | Index Scan `activities_user_occurred_on_id_idx` | 0,140 ms | 19 hit |
| activities filter project | Bitmap Index Scan `activities_user_project_occurred_on_id_idx` + quicksort 59 kB (20 baris) | 0,190 ms | 25 hit |
| achievements semua | Seq Scan `achievements` (200 dari 400) + top-N heapsort 74 kB | 0,491 ms | 74 hit |
| achievements confirmed | Index Scan `achievements_user_status_date_id_idx` | 0,065 ms | 12 hit |
| achievements missing evidence | Function Scan `filter_achievements` (200 baris) + top-N heapsort 74 kB | 2,942 ms | 571 hit |
| enrich: id confirmed | Seq Scan `achievements` (150 baris) | 0,177 ms | 74 hit |
| enrich: link skill (150 id) | Seq Scan `achievement_skills` (300 baris) | 0,136 ms | 9 hit |
| projects semua | Seq Scan `projects` (50 baris) + quicksort 36 kB | 0,074 ms | 2 hit |
| projects outcome missing | Function Scan `filter_projects` (25 baris) + quicksort 30 kB | 0,352 ms | 29 hit |
| projects: hitung activity (30 id) | Bitmap Index Scan `activities_user_project_occurred_on_id_idx` | 0,473 ms | 110 hit |
| timeline: experiences / education | Seq Scan (5 / 2 baris) + quicksort 25 kB | 0,044 / 0,035 ms | 2 / 1 hit |
| timeline: projects / achievements | Seq Scan (50 / 150 baris) + quicksort 31 / 38 kB | 0,055 / 0,284 ms | 2 / 74 hit |
| RPC `get_dashboard_summary` | cek `exists(activities)` memakai Seq Scan `rows=1`; hitungan achievements/projects/skills memakai Seq Scan | **10,498 ms** | |
| RPC `get_cv_review_summary` | loop plpgsql: `internal.cv_item_state` per item CV (≥ 40 item, ±150 sub-query, masing-masing < 1,5 ms) | **30,292 ms** | |
| RPC `list_demonstrated_skills(12)` | agregasi 401 link + 150 achievement | **2,554 ms** | |

Bentuk node sama dengan plan Fase 0 (tanpa trigger). Nomor biaya berbeda karena statistik tabel berbeda, bukan karena trigger: trigger T24 hanya menulis ke `internal.product_events`, tabel yang tidak dibaca query halaman mana pun.

## Penilaian terhadap §2.2.12

| Kriteria | Hasil |
| --- | --- |
| 1. Seq Scan pada tabel > 1.000 baris untuk query yang difilter `user_id` | Hanya `activities` melewati 1.000 baris. Semua query halaman dan filter project memakai Index Scan atau Bitmap Index Scan pada indeks yang sudah ada. **Satu kemunculan literal:** `exists (select 1 from activities where user_id = actor.id)` di `get_dashboard_summary` memakai Seq Scan (`rows=1`, 0,007 ms). **Ditolak sebagai alasan indeks:** `user_id` sudah menjadi kolom pertama dua indeks `activities` dan planner memilih Seq Scan murni karena estimasi biaya (667 baris cocok dari 2.001, `limit 1` berhenti di baris pertama). Indeks baru tidak mengubah keputusan itu, dan plan ini menghabiskan 0,007 ms. Tabel lain di bawah 1.000 baris. |
| 2. Sort eksplisit > 50 ms yang dapat dilayani indeks | **Tidak ada.** Total waktu eksekusi query baca terbesar 2,942 ms (missing evidence, yang waktunya di Function Scan 2,8 ms); sort terbesar top-N heapsort 74 kB. |
| 3. p95 > 50% target (> 1.000 ms baca, > 500 ms simpan) dan plan menunjukkan sumbernya | **Tidak ada.** p95 baca tertinggi 155,8 ms; p95 simpan tertinggi 120,6 ms. |

Keputusan: **tidak ada query yang memenuhi kriteria indeks secara substantif**, jadi tidak ada migration. Per query: seluruhnya sudah dilayani indeks yang ada (activities, achievements confirmed, filter project) atau membaca tabel kecil milik satu akun (< 1.000 baris total) dengan waktu < 1 ms; dua Function Scan (`filter_achievements`, `filter_projects`) membaca baris akun itu sendiri dan selesai di bawah 3 ms.

Catatan untuk reviewer (di luar kriteria, tidak dikerjakan di T24):

- `get_cv_review_summary` (30 ms DB) adalah komponen database terlambat dan berupa loop N+1 di dalam plpgsql; bukan masalah indeks. Dengan 40 item CV ia jauh di bawah target; bila item CV tumbuh, waktunya tumbuh linear.
- `loadSkills` di `achievement-service.ts:158-200` membaca **semua** achievement confirmed milik akun (tanpa limit halaman) pada setiap list. PostgREST `max_rows = 1000` memotongnya di atas 1.000 confirmed. Tidak relevan untuk dataset 200, dicatat sebagai batas.

## p95 layanan: sebelum (Fase 0, tanpa trigger) dan sesudah (trigger T24 aktif)

Baca, 20 sampel warm, p95 (ms):

| Operasi | Fase 0 run 1 / run 2 | Fase 4 (trigger aktif) |
| --- | --- | --- |
| S04 `getDashboard` | 114,2 / 104,1 | 98,0 |
| S06 halaman 1 | 94,0 / 119,9 | 80,7 |
| S06 halaman 3 (cursor) | 94,7 / 98,6 | 96,1 |
| S06 filter project | 92,1 / 91,4 | 90,4 |
| S07 semua | 156,3 / 169,8 | 155,8 |
| S07 confirmed | 145,0 / 164,0 | 152,8 |
| S07 missing evidence | 154,0 / 167,5 | 141,1 |
| S09 semua | 124,0 / 125,9 | 122,7 |
| S09 outcome missing | 132,7 / 124,1 | 109,9 |
| S11 timeline | 93,3 / 93,0 | 89,8 |

Simpan, 20 sampel, p95 (ms) (Fase 0 hanya run 2):

| Operasi | Fase 0 | Fase 4 (trigger aktif) | p50 Fase 0 → Fase 4 |
| --- | --- | --- | --- |
| `createActivity` (note) | 121,3 | 93,7 | 92,3 → 77,4 |
| `updateActivity` | 92,9 | 93,0 | 77,9 → 78,0 |
| `createProject` | 92,1 | 85,9 | 77,3 → 77,2 |
| `updateProject` | 112,5 | 120,6 (max 160,3) | 78,4 → 68,7 |
| `saveAchievement` `save_draft` | 99,9 | 73,5 | 73,3 → 65,1 |
| `saveAchievement` `confirm` | 106,4 | 85,4 | 74,2 → 64,4 |

Tidak ada kenaikan p50 yang dapat diatribusikan ke trigger. Perbedaan p95 antar run sebanding dengan variasi antara run 1 dan run 2 Fase 0 (sampai ±25 ms), karena hop HTTP (≈75 ms per operasi) mendominasi. Trigger menambah satu `INSERT` ke tabel internal berindeks tunggal per kejadian; overhead SQL-nya jauh di bawah derau itu.

## Command dan hasil

| Item | Hasil |
| --- | --- |
| Probe sementara | exit 0; dihapus; `git status` hanya `.claude/setting.local.json` |
| `supabase migration list --local` | tetap 34/34 (tidak ada migration baru) |
| User `t24-perf-%` tersisa | 0 |

## Acceptance yang terbukti

- §1.16: `EXPLAIN` setiap query baca §1.13 dicatat (dengan trigger aktif, dataset utuh, akun lain berisi data); tidak ada indeks karena tidak ada yang memenuhi §2.2.12; alasan per query tertulis di atas.

## Belum terbukti

- p95 dengan ≥ 50 sampel dan metode lengkap di `T24-perf-results.json` (Fase 5).

## Blocker dan catatan

- Tidak ada stop condition §8 yang terpicu.
- Keputusan tidak membuat migration indeks bergantung pada penilaian reviewer atas kemunculan literal Seq Scan di `get_dashboard_summary`; alasan penolakannya tertulis di baris kriteria 1.

## Langkah berikutnya

Fase 5: `tests/perf/read-write.test.ts` dengan ≥ 50 sampel, pemanasan, cold, metode tercatat, dan `docs/verification/T24-perf-results.json`.

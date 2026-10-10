# T24 Gate review (Claude, read-only)

- Tanggal: 10 Oktober 2026
- Reviewer: Claude (Opus)
- HEAD yang direview: `0f5aeeb` (baseline Fase 0 `f6b5237`; 20 file, +4452/−7 baris; satu migration baru `20261011090000_t24_product_events.sql`, tanpa migration indeks)
- Lingkungan: Supabase lokal (migration **34/34**), `workpulse-t10-clamav`, `workpulse-t15-gotenberg`, `workpulse-t21-pdf` berjalan; `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal (hanya env proses); `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan; `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`. Run perf reviewer menulis ke scratchpad lewat `WORKPULSE_PERF_OUT`, jadi `T24-perf-results.json` di repo tidak tertimpa.

## Verdict

**Tidak ada temuan P0-P2. T24 lulus gate review** untuk Fase 0-6. Ada delapan temuan P3: dua butuh keputusan atau catatan di dokumen Fase 7 (G1, G2), sisanya diterima atau menjadi follow-up. Status tetap **PARTIAL** sampai Fase 7 (decision 0030, runbook metrik pilot, laporan verifikasi, README) selesai dan ditutup lewat closeout.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| G1 | P3 | `get_pilot_metrics` tidak sepenuhnya *point-in-time*. Subquery `is_activated` (`20261011090000_t24_product_events.sql:419-425`) hanya membatasi `occurred_at < created + 24h`, tidak `<= p_as_of`. Untuk `p_as_of` di masa lalu, akun yang jendela 24 jamnya masih terbuka pada `p_as_of` tetapi teraktivasi **sesudahnya** ikut dihitung di `pending` value completion dan return capture (`:459`, `:462`). Angka `eligible`/`achieved` tidak terpengaruh (jendela yang selesai selalu ≤ `p_as_of`), dan laporan dengan `now()` benar. Perbaikan bila dibutuhkan: tambah `and e.occurred_at <= v_as_of` di empat subquery, dengan pgTAP `p_as_of = created + 1h` dan event di `created + 5h` → `pending` value = 0. Butuh migration baru (parity 35), jadi tidak dikerjakan di T24. | Follow-up; runbook Fase 7 wajib menyebut bahwa laporan dibaca dengan `now()` |
| G2 | P3 | Activation dapat dipenuhi oleh draft achievement kosong. `createAchievement` membuat baris draft tanpa judul (lihat `tests/perf/read-write.test.ts:151`), dan trigger `product_event_career_record` mencatat `career_record_created` untuk setiap insert achievement. Ini sesuai kontrak beku §1.1 dan §2.4.3, jadi bukan pelanggaran, tetapi satu klik "achievement baru" sudah dihitung "menyimpan record karier manual". Pilihan: (a) terima dan tulis di runbook dan decision 0030; (b) ubah definisi di task lanjutan (mis. achievement dihitung saat `save_achievement` pertama dengan isi), yang berarti mengubah keputusan §2.4.3. | Diterima pengguna untuk pilot, opsi (a) (10 Oktober 2026); dicatat di decision 0030 dan runbook |
| G3 | P3 | Kode error tambahan `22023 INVALID_PILOT_PARTICIPANT` (`:333-336`) untuk input null atau versi persetujuan di luar pola. Tidak ada di §2.2.7, tetapi tidak bertentangan: tanpanya input buruk akan jatuh ke CHECK `23514` yang kurang jelas. | Diterima; catat di decision 0030 |
| G4 | P3 | `exists (select 1 from activities where user_id = …)` di `get_dashboard_summary` memakai Seq Scan literal (`rows=1`, 0,007 ms). Alasan penolakan indeks di receipt Fase 4 benar: kolom `user_id` sudah menjadi kolom pertama dua indeks, dan planner berhenti di baris pertama. | Diterima, tanpa migration indeks |
| G5 | P3 | Batas metode perf: satu mesin, satu pengguna, loopback, tanpa evidence, cold tanpa pengosongan buffer. Semuanya tertulis di file hasil dan receipt Fase 5. | Diterima; pengukuran staging di T25 |
| G6 | P3 | Pada import yang sekaligus menyelesaikan onboarding, `profiles.timezone` diperbarui **setelah** record diinsert (`20261001090000_t16_import_commit.sql:920`), jadi event `career_record_created` dari import itu memakai `local_date` zona lama (default `UTC`). Tidak ada ukuran yang membaca `local_date` event itu (return capture hanya `activity_saved`). | Diterima; catat di decision 0030 |
| G7 | P3 | Catatan di luar scope dari receipt Fase 4: `get_cv_review_summary` berupa loop N+1 (30 ms untuk 40 item CV), dan `loadSkills` di `achievement-service.ts:158-200` membaca semua achievement confirmed tanpa batas (terpotong `max_rows = 1000`). | Follow-up pasca-T24 |
| G8 | P3 | §1.10 baru sebagian: kolom laporan, `rate` NULL, dan target terbukti di pgTAP, tetapi runbook yang menyebut target sebagai hipotesis dan peringatan n ≤ 20 belum ada (Fase 7). | Fase 7 pelaksana |

## Penyimpangan pelaksana yang saya putuskan

| Penyimpangan | Keputusan | Alasan |
| --- | --- | --- |
| `INVALID_PILOT_PARTICIPANT` | **Diterima** | G3. |
| Definisi `pending`: value completion dan return capture hanya menghitung akun yang sudah teraktivasi dan jendelanya belum selesai; akun yang jendela 24 jamnya masih terbuka masuk `pending` activation saja | **Diterima** | Konsisten dengan "dari akun teraktivasi" di §1.7-1.8. Akun yang belum teraktivasi belum termasuk penyebut ukuran turunan, jadi menyebutnya `pending` di sana akan menggandakan hitungan. Runbook harus menjelaskan arti tiap `pending`. |
| Penjumlahan `import_committed` hanya dari `experience`, `education`, `certification`, `achievement` (tanpa `profile` dan `skill`) | **Diterima** | Sesuai §2.4.3 (skill dan profil bukan record karier). |
| Tidak ada migration indeks | **Diterima** | Tidak ada plan yang memenuhi §2.2.12 (G4); p95 tertinggi < 11% target. |
| `profiles` fixture perf diperbarui lewat service role (`tests/perf/perf-support.ts:87`) | **Diterima** | Hanya nama tampilan, locale, timezone, dan onboarding fixture. Data yang diukur tetap di-seed lewat RPC dengan klaim JWT (`tests/perf/seed.ts`), dan trigger serta constraint aktif. |

## Hasil review per area §9

- **Event.** Sepuluh trigger `product_event_*` terpasang di delapan tabel sumber (diperiksa di katalog). Semua `AFTER … FOR EACH ROW`. Achievement memakai dua trigger konfirmasi (insert dan update `status` dengan `old.status is distinct from 'confirmed'`). Import memakai transisi ke `committed`, export memakai `running → succeeded|failed`. Jalur import commit, apply AI, dan worker export tertangkap tanpa fungsi T02-T23 diganti. Trigger tidak meredam error. Bila CHECK event gagal di dalam import commit, handler T16 (`:947`) mengubahnya menjadi kegagalan commit, bukan sukses diam-diam.
- **Allowlist.** Kunci, tipe, enum, dan rentang integer dikunci per event. `error_code` disaring di trigger dan di CHECK dengan daftar yang sama persis dengan `fail_cv_export` (`20261005090000_t21_cv_export_backend.sql:621-622`). Tidak ada ID record, teks, atau nama file. pgTAP punya 18 kasus penolakan; integration mencari sentinel di seluruh baris event (`e::text`) dan di hasil laporan.
- **Akses.** Ketiga tabel internal hanya punya grant untuk `postgres`. `set_pilot_participant` dan `get_pilot_metrics` hanya dapat dieksekusi `service_role` (diperiksa reviewer dengan `has_function_privilege`).
- **Metrik.** Jendela `[created, created + N)`. Batas 23:59:59 masuk, 24:00:00 keluar, dan pola yang sama untuk 7 dan 28 hari. Minggu memakai `date_trunc('week', local_date)` (ISO, Senin). `rate` NULL saat `eligible = 0`. `ACCOUNT_DELETING` dikeluarkan. Gagal lalu retry sukses dihitung 1/2. Kohort hanya berisi peserta aktif, dan akun sebelum epoch ditolak. Catatan point-in-time ada di G1.
- **Penghapusan.** FK `on delete cascade` ke `profiles`, tanpa perubahan fungsi T23. Integration membuktikan nol event dan nol peserta setelah jalur T23 penuh, sementara akun lain tetap utuh.
- **Performa.** Dataset dihitung ulang dengan `count(1)` sebelum pengukuran (1.000/200/50, Q sama). Seed lewat RPC. p95 di `T24-perf-results.json` dihitung ulang reviewer dari `samplesMs` dengan nearest-rank: cocok untuk 16 operasi. Reviewer menjalankan ulang `pnpm test:perf` (tabel di bawah).
- **Scope dan hygiene.** Hanya file §4. `src/` hanya `database.types.ts`, tanpa perubahan `workers/`, tanpa dependency baru, dan tanpa `console.` di `tests/perf`. Reporter hanya mencetak nama operasi dan angka. Akun `t24-%` tersisa: 0.

## Run ulang perf reviewer (p95 ms, 50 sampel)

| Operasi | Pelaksana (file hasil) | Reviewer | Target |
| --- | --- | --- | --- |
| `getDashboard` | 103,6 | 114,2 | < 2.000 |
| activity halaman 1 / halaman 3 / filter project | 93,9 / 93,4 / 92,1 | 119,6 / 109,5 / 116,9 | < 2.000 |
| achievement semua / confirmed / missing evidence | 162,2 / 157,9 / 157,8 | 183,0 / 170,8 / 192,4 | < 2.000 |
| project semua / outcome missing | 122,8 / 125,9 | 137,0 / 124,5 | < 2.000 |
| `getTimeline` | 94,4 | 119,5 | < 2.000 |
| `createActivity` / `updateActivity` | 119,1 / 198,4 | 86,2 / 82,3 | < 1.000 |
| `save_draft` / `confirm` | 133,9 / 139,7 | 85,4 / 78,0 | < 1.000 |
| `createProject` / `updateProject` | 127,1 / 164,1 | 91,9 / 84,7 | < 1.000 |

Selisih antar run berada dalam rentang variasi yang dicatat pelaksana (run A-C). Semua operasi jauh di bawah target. p95 run reviewer juga dihitung ulang dari sampel mentah dan cocok.

## Command reviewer

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm worker:check` | 0 | |
| `pnpm test` | 0 | 114 file / 1041 test |
| `pnpm db:test` | 0 | 18 file / 1573 assertion, `Result: PASS` |
| `pnpm db:lint` | 0 | |
| `supabase migration list --local` | 0 | 34/34, terakhir `20261011090000` |
| `pnpm test:integration:product-events` | 0 | 1 file / 9 |
| `pnpm test:integration:account-deletion` | 0 | 2 file / 14 |
| `pnpm test:integration:import-commit` | 0 | 1 file / 11 |
| `pnpm test:integration:cv-export` | 0 | 3 file / 35 |
| `pnpm test:perf` (sendirian) | 0 | 1 file / 3, `pass: true` |
| `git diff --check f6b5237..HEAD` | 0 | |

**Tidak dijalankan ulang reviewer:** suite E2E dan sisa suite integration §7. T24 tidak mengubah `src/` (selain tipe), `workers/`, atau UI, dan receipt Fase 6 mencatat semuanya lulus (exit 0) pada `d77d27f`. `pnpm build` juga tidak diulang. `test:ai:live` tidak dijalankan (T24 tanpa AI).

## Yang masih dibutuhkan

1. ~~Keputusan pengguna untuk G2.~~ Pengguna menerima opsi (a) untuk pilot (10 Oktober 2026).
2. Fase 7 oleh pelaksana: decision 0030 (mencakup G1, G3, G6), runbook metrik pilot (target sebagai hipotesis, n ≤ 20, arti `pending`, laporan dengan `now()`, G2), laporan `T24-instrumentation-performance.md`, dan README.
3. Setelah Fase 7: review dokumen oleh reviewer, lalu closeout (entry `IMPLEMENTATION_STATUS.md`, DONE).

Batas: semua hasil di atas adalah lingkungan lokal, bukan staging atau production.

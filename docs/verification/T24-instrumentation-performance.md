# T24 Instrumentasi dan performa: laporan verifikasi

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (Fase 0-6); reviewer Claude (Opus): gate review dan dokumen Fase 7.
- Status: **T24 DONE (acceptance lokal).** Gate review tanpa P0-P2 ([T24-gate-review.md](T24-gate-review.md)).
- HEAD yang diuji: `0f5aeeb` (pelaksana, regresi Fase 6 pada `d77d27f`; reviewer pada `0f5aeeb`). HEAD Fase 0: `f6b5237`.

Rujukan: [handoff](T24-implementation-plan.md), [decision 0030](../decisions/0030-t24-instrumentation-performance.md), [runbook metrik pilot](T24-pilot-metrics-runbook.md), hasil mentah [T24-perf-results.json](T24-perf-results.json), receipt `T24-phase0-baseline.md` sampai `T24-phase6-regression.md`.

## Ringkasan

| Item | Hasil |
| --- | --- |
| Pass | seluruh command regresi §7 exit 0 di Fase 6 tanpa rerun (`test:perf` dijalankan tiga kali di Fase 5). Run ulang reviewer: lint, typecheck, worker:check, unit, pgTAP, db:lint, empat suite integration, dan `test:perf` exit 0 |
| Tidak dijalankan | `test:ai:live` (T24 tanpa AI). Reviewer tidak mengulang suite E2E dan `pnpm build` karena T24 tidak mengubah UI, worker, atau kode aplikasi selain tipe |
| Warning | tidak ada yang menggagalkan. Suite E2E menulis ulang PNG screenshot T22/T23 yang di-track; pelaksana mengembalikannya dan tidak meng-commit-nya |
| Fail | tidak ada |
| Angka | unit 114 file / 1041; pgTAP 18 file / 1573 (134 baru); integration product-events 9, account-deletion 14, import-commit 11, cv-export 35; perf 1 file / 3 test, 16 operasi x 50 sampel |
| Migration | 34/34; tidak ada migration indeks |

## Trace ke sumber

| Sumber | Butir | Bukti |
| --- | --- | --- |
| PRD §4 *Performance targets* | dataset 1.000 / 200 / 50 | `count(1)` sebelum pengukuran di file hasil; akun Q dengan volume sama |
| PRD §4 *Performance targets* | p95 baca dashboard dan list < 2 detik | 10 operasi; p95 tertinggi 162,2 ms (pelaksana) dan 192,4 ms (reviewer) |
| PRD §4 *Performance targets* | save < 1 detik tanpa network dan AI | 6 operasi dengan trigger aktif; p95 tertinggi 198,4 ms (pelaksana) dan 91,9 ms (reviewer) |
| PRD §4 *Privacy* | akses owner-scoped | tabel event tanpa privilege role API; RPC hanya `service_role`; PostgREST ditolak (integration) |
| PRD §5 *Pilot measures* | event tanpa teks catatan, teks CV, nama file, atau isi lampiran | CHECK allowlist (18 penolakan pgTAP); sentinel di lima jenis konten tidak ada di baris event maupun laporan |
| PRD §5 *Pilot measures* | Activation, Value completion, Return capture, Export reliability | `get_pilot_metrics` dengan fixture batas di pgTAP; integration kohort |
| PRD §5 *Pilot measures* | target adalah hipotesis, ditinjau setelah 20 peserta | kolom `target` tanpa klaim tercapai; runbook §5 |
| Rencana §5 T24 | event dapat menghitung keempat ukuran; target disebut hipotesis | pgTAP §9 dan runbook |
| Rencana §5 T24 | lingkungan, sampel, warm/cold, dan hasil tercatat; indeks berdasarkan query plan | file hasil, receipt Fase 4 dan 5 |

## Acceptance §1

| # | Butir | Status | Bukti |
| --- | --- | --- | --- |
| 1 | Event dari semua jalur tulis | Terbukti | pgTAP per trigger; integration lewat service activity (Note, Form, Chat), foundation, project, achievement, apply AI, import commit, dan worker export nyata |
| 2 | Atomik dan idempotent | Terbukti | pgTAP `STALE_REVISION`, `IMPORT_ITEM_INVALID`, key idempotensi sama, commit kedua; integration rollback import |
| 3 | Metadata minimal | Terbukti | enam kolom; CHECK allowlist; pencarian sentinel dan pola UUID di properti |
| 4 | Tidak dapat diakses klien | Terbukti | pgTAP privilege; integration PostgREST `authenticated`/`anon`; katalog diperiksa reviewer |
| 5 | Kohort terpisah dari fixture | Terbukti | pgTAP empat kode error, epoch, penarikan final, akun non-kohort; integration A terdaftar dan B tidak |
| 6 | Activation 24 jam | Terbukti | pgTAP 23:59:59 masuk, 24:00:00 keluar, `created + mapped > 0`, `pending` |
| 7 | Value completion 7 hari | Terbukti | pgTAP batas 7 hari, export gagal tidak dihitung |
| 8 | Return capture 28 hari | Terbukti | pgTAP Minggu-Senin dua minggu, Senin-Minggu satu minggu, zona profil, batas 28 hari |
| 9 | Export reliability | Terbukti | pgTAP gagal lalu sukses = 1/2, `ACCOUNT_DELETING` dikeluarkan; integration worker nyata dengan renderer fake sukses dan gagal |
| 10 | Laporan jujur | Terbukti | kolom, `rate` NULL, dan target di pgTAP; runbook menyebut target sebagai hipotesis dan memperingatkan n ≤ 20 |
| 11 | Ikut terhapus bersama akun | Terbukti | integration jalur T23 penuh: nol event dan nol peserta, akun lain utuh; pgTAP cascade |
| 12 | Dataset performa nyata | Terbukti | seed lewat RPC dengan trigger aktif; hitungan sama sebelum dan sesudah pembacaan; seed kedua tidak menggandakan |
| 13 | p95 baca < 2 detik | Terbukti | tabel di bawah |
| 14 | p95 simpan < 1 detik | Terbukti | tabel di bawah |
| 15 | Metode tercatat | Terbukti | `environment` dan `method` di file hasil; batas di decision 0030 |
| 16 | Query plan dan indeks berbasis bukti | Terbukti | receipt Fase 4; tidak ada migration indeks, alasan per query |
| 17 | Privasi dan log | Terbukti | tidak ada `console.` di `tests/perf`; reporter hanya mencetak nama operasi dan angka; grep sentinel, email, dan key nihil |
| 18 | Tanpa regresi | Terbukti | regresi Fase 6; tidak ada test lama yang diubah |

## p95 (ms, 50 sampel warm per operasi)

| Operasi | Layar | Pelaksana | Reviewer | Target |
| --- | --- | --- | --- | --- |
| `getDashboard` | S04 | 103,6 | 114,2 | 2.000 |
| activity halaman 1 | S06 | 93,9 | 119,6 | 2.000 |
| activity halaman 3 (cursor) | S06 | 93,4 | 109,5 | 2.000 |
| activity filter project | S06 | 92,1 | 116,9 | 2.000 |
| achievement semua | S07 | 162,2 | 183,0 | 2.000 |
| achievement confirmed | S07 | 157,9 | 170,8 | 2.000 |
| achievement missing evidence | S07 | 157,8 | 192,4 | 2.000 |
| project semua | S09 | 122,8 | 137,0 | 2.000 |
| project outcome missing | S09 | 125,9 | 124,5 | 2.000 |
| `getTimeline` | S11 | 94,4 | 119,5 | 2.000 |
| `createActivity` (note) | simpan | 119,1 | 86,2 | 1.000 |
| `updateActivity` | simpan | 198,4 | 82,3 | 1.000 |
| `saveAchievement` draft | simpan | 133,9 | 85,4 | 1.000 |
| `saveAchievement` confirm | simpan | 139,7 | 78,0 | 1.000 |
| `createProject` | simpan | 127,1 | 91,9 | 1.000 |
| `updateProject` | simpan | 164,1 | 84,7 | 1.000 |

Kolom pelaksana berasal dari `T24-perf-results.json`. Kolom reviewer berasal dari run terpisah yang ditulis ke luar repo. p95 kedua run dihitung ulang dari `samplesMs` dengan nearest-rank dan cocok. Lingkungan: Windows 11 Pro, AMD Ryzen 7 PRO 5850U (16 thread), 15 GiB, Docker 29.6.1, PostgreSQL 17.6, Node v24.18.0, Supabase CLI 2.117.0.

Lapisan yang diukur adalah layanan Node, lalu Kong/PostgREST loopback, lalu PostgreSQL, tanpa render React, network publik, dan AI. Sampel cold adalah panggilan pertama pada client baru, dan buffer PostgreSQL tidak dikosongkan. Hasil ini membuktikan target pada satu mesin pengembangan, bukan di layanan hosted (T25).

## Temuan terbuka

P3 dari gate review: G1 (laporan untuk tanggal lampau) sudah diperbaiki lewat migration `20261011100000_t24_pilot_metrics_as_of.sql`. G7 (N+1 di `get_cv_review_summary`, `loadSkills` tanpa batas) menjadi follow-up. G2 (draft achievement kosong menghitung Activation) diterima pengguna untuk pilot. G3-G6 diterima dan dicatat di decision 0030.

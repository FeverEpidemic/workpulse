# T24 Fase 5 — Pengukuran p95

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `972f40c`; commit: `437a4f0` (`test(t24): add p95 read and save measurements`)
- File hasil: [T24-perf-results.json](T24-perf-results.json) (run B di bawah)
- Tidak ada perubahan di `src/`, `workers/`, atau migration. Tidak ada migration indeks (Fase 4).

## Yang diukur

`tests/perf/read-write.test.ts` (dijalankan sendirian dengan `pnpm test:perf`, tanpa suite lain, `next build`, atau `next dev` di checkout yang sama):

| Item | Nilai |
| --- | --- |
| Lapisan | layanan Node (`src/features/*`) → Kong/PostgREST loopback → PostgreSQL; tanpa render React, tanpa network publik, tanpa AI |
| Timer | `performance.now()` di sekitar satu panggilan layanan (termasuk `auth.getUser()` yang dipanggil tiap operasi layanan) |
| Sampel | 50 sampel warm per operasi setelah 5 putaran pemanasan dibuang; p95 nearest-rank `sorted[ceil(0.95 × n) − 1]` |
| Urutan | operasi diacak per putaran dengan seed tetap (24); baca lebih dulu pada dataset §6 yang tepat, lalu simpan |
| Cold | panggilan pertama tiap operasi pada objek client baru yang memakai ulang sesi login; buffer PostgreSQL tidak dikosongkan dan container tidak di-restart (batas metode, §2.2.11) |
| Trigger | 10 trigger `product_event_*` aktif (diperiksa di test) |
| Akun | P diukur; Q punya volume sama di database yang sama dan tidak diukur; keduanya di-seed lewat RPC lalu `analyze` |
| Operasi baca | S04 dashboard; S06 daftar activity halaman 1, halaman 3 (cursor), filter project; S07 daftar achievement semua, confirmed, missing evidence; S09 daftar project semua dan outcome missing; S11 timeline |
| Operasi simpan | `createActivity` (note), `updateActivity`, `saveAchievement` `save_draft` dan `confirm` (diukur terpisah, persiapan di luar timer), `createProject`, `updateProject` |
| Dataset P sebelum baca | 1.000 activities (300 terhubung project), 200 achievements (150 confirmed / 40 draft / 10 dismissed; 120 turunan; 60 dengan metrics), 50 projects, 5 / 2 / 3 / 40 experiences / education / certifications / skills, 40 cv_items, 0 evidence; diverifikasi `count(1)` dan sama persis sebelum dan sesudah pembacaan |
| Dataset P setelah simpan | 1.056 activities, 312 achievements, 106 projects (penambahan oleh sampel simpan, dicatat di hasil) |

Lingkungan (dari hasil): Windows 11 Pro 10.0.26200 x64; AMD Ryzen 7 PRO 5850U, 16 thread; 15 GiB; Docker 29.6.1; PostgreSQL 17.6; Node v24.18.0; Supabase CLI 2.117.0; `head` tercatat `972f40c` (sebelum commit test ini; kode produk tidak berubah sesudahnya).

## Hasil (run B, tercatat di `T24-perf-results.json`)

| Operasi | n | p50 ms | **p95 ms** | max ms | cold ms | Target ms |
| --- | --- | --- | --- | --- | --- | --- |
| S04 `getDashboard` | 50 | 81,1 | **103,6** | 156,8 | 81,4 | < 2.000 |
| S06 daftar activity halaman 1 | 50 | 76,7 | **93,9** | 115,9 | 71,1 | < 2.000 |
| S06 halaman 3 (cursor) | 50 | 76,3 | **93,4** | 131,1 | 65,2 | < 2.000 |
| S06 filter project | 50 | 75,2 | **92,1** | 106,9 | 77,0 | < 2.000 |
| S07 achievement semua | 50 | 139,1 | **162,2** | 229,3 | 127,1 | < 2.000 |
| S07 achievement confirmed | 50 | 137,9 | **157,9** | 168,6 | 123,6 | < 2.000 |
| S07 achievement missing evidence | 50 | 131,7 | **157,8** | 211,7 | 124,4 | < 2.000 |
| S09 project semua | 50 | 106,5 | **122,8** | 123,9 | 104,7 | < 2.000 |
| S09 project outcome missing | 50 | 107,6 | **125,9** | 141,2 | 126,6 | < 2.000 |
| S11 `getTimeline` | 50 | 77,4 | **94,4** | 115,9 | 85,1 | < 2.000 |
| `createActivity` (note) | 50 | 77,9 | **119,1** | 152,5 | 72,3 | < 1.000 |
| `updateActivity` | 50 | 79,7 | **198,4** | 249,0 | 78,9 | < 1.000 |
| `saveAchievement` `save_draft` | 50 | 78,8 | **133,9** | 185,1 | 75,3 | < 1.000 |
| `saveAchievement` `confirm` | 50 | 80,8 | **139,7** | 163,9 | 122,8 | < 1.000 |
| `createProject` | 50 | 80,8 | **127,1** | 142,2 | 107,1 | < 1.000 |
| `updateProject` | 50 | 77,9 | **164,1** | 202,0 | 102,3 | < 1.000 |

Seluruh `p95` dihitung ulang dari `samplesMs` di file hasil dengan rumus nearest-rank: cocok untuk 16 operasi.

## Variasi antar run (tiga run penuh, p95 ms)

| Operasi | Run A | Run B (file hasil) | Run C |
| --- | --- | --- | --- |
| `getDashboard` | 97,8 | 103,6 | 136,4 |
| activity halaman 1 | 92,4 | 93,9 | 127,5 |
| activity halaman 3 | 93,5 | 93,4 | 131,0 |
| activity filter project | 91,2 | 92,1 | 136,4 |
| achievement semua | 144,9 | 162,2 | 187,4 |
| achievement confirmed | 156,2 | 157,9 | 183,2 |
| achievement missing evidence | 151,1 | 157,8 | 206,2 |
| project semua | 123,8 | 122,8 | 154,6 |
| project outcome missing | 121,4 | 125,9 | 162,2 |
| `getTimeline` | 100,7 | 94,4 | 130,8 |
| `createActivity` | 80,2 | 119,1 | 109,1 |
| `updateActivity` | 91,3 | 198,4 | 109,9 |
| `save_draft` | 87,6 | 133,9 | 93,6 |
| `confirm` | 78,9 | 139,7 | 123,5 |
| `createProject` | 95,1 | 127,1 | 110,3 |
| `updateProject` | 82,5 | 164,1 | 102,4 |

- Run A memakai kode test identik kecuali label permukaan (hasilnya tidak disimpan ke file). Run C ditulis ke file sementara di luar repo.
- Variasi p95 antar run mencapai sekitar 40 ms (baca, run C lebih lambat sekitar 25% pada p50, indikasi beban mesin) dan sekitar 110 ms (simpan, satu sampel ekor `updateActivity`). Semuanya jauh di bawah target; p95 tertinggi dari semua run adalah 206,2 ms (baca, target 2.000) dan 198,4 ms (simpan, target 1.000).
- Dengan n = 50, p95 nearest-rank adalah sampel urut ke-48, jadi dua sampel terburuk menentukan ekor; itu sebabnya angka antar run bergeser.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm test:perf` (run A, B, C) | exit 0 tiap run, **1 file / 3 test** (dataset, idempotensi seed, pengukuran), 110 / 124 / 132 detik |
| `pnpm typecheck`, `pnpm lint` | exit 0 |
| `grep console\.` di `tests/perf` | tidak ada (reporter memakai `process.stdout.write` dan hanya mencetak jalur file, nama operasi, dan angka) |
| File hasil | tanpa `@`, tanpa email, tanpa key, tanpa ID; 20 KB |
| User `t24-perf-%` tersisa | **0** setelah tiap run |

## Acceptance yang terbukti di fase ini

- §1.13 p95 baca < 2 detik: terbukti, 10 operasi × 50 sampel, p95 terburuk di file hasil 229,3 ms max / 162,2 ms p95.
- §1.14 p95 simpan < 1 detik dengan trigger T24 aktif: terbukti, 6 operasi × 50 sampel, p95 terburuk 198,4 ms.
- §1.15 metode tercatat: lingkungan, jumlah sampel, warm/cold, lapisan, dan batas (buffer tidak dikosongkan) ada di file hasil dan receipt ini.
- §1.12: hitungan dataset dicatat di file hasil sebelum pengukuran.

## Batas metode yang harus dibaca bersama angka

- Satu mesin pengembangan (Docker Desktop/WSL2), bukan staging; hasil lokal tidak membuktikan target di hosted (T25).
- Satu pengguna, tanpa konkurensi; tabel milik dua akun besar dan 226 profil lama yang hampir kosong.
- `auth.getUser()` pada tiap operasi dan hop Kong menyumbang sebagian besar waktu (±75 ms); itu konservatif untuk target yang mengecualikan network.
- Tanpa evidence; missing-evidence dihitung atas 150 achievement confirmed.
- "Cold" tidak mengosongkan buffer PostgreSQL.

## Blocker dan catatan

- Tidak ada p95 yang melewati target; stop condition §8 tidak terpicu. Target tidak dilonggarkan dan dataset tidak dikurangi.

## Langkah berikutnya

Fase 6: regresi penuh §7, pemeriksaan diff dan hygiene, pembersihan akun, receipt Fase 6.

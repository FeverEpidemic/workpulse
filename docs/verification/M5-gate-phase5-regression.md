# Gate M5 Fase 5: regresi penuh, rebuild, dan performance

- Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5).
- HEAD: `a789dc0` (regresi), sama dengan HEAD laporan draft kecuali dokumen. Tidak ada perubahan kode di fase ini.
- Lingkungan: Supabase lokal bersama (38/38), ClamAV 1.5.4 (13310), Gotenberg 8.37.0 untuk DOCX (13400) dan PDF (13401). `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` di env proses. `WORKPULSE_PDF_GOTENBERG_URL` dan `WORKPULSE_GOTENBERG_URL` diset di proses runner; config Playwright membuangnya dari web server. `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan. Tanpa `db reset`.

## Clean rebuild (stack sekali pakai)

Salinan `supabase/` di scratchpad (tanpa `.temp`, `.branches`), `project_id = workpulse-m5-rebuild`, port 55320–55329 dan inspector 8183 (blok tidak tereservasi `netsh`). Stack aktif tidak disentuh.

| Command | Exit | Hasil |
| --- | ---: | --- |
| `supabase start --workdir <scratch>` | 0 | **38 migration diterapkan dari nol**, terakhir `20261019090000_t26_import_rules_extraction.sql`; seed dan bucket `workpulse-private` |
| `supabase test db --workdir <scratch>` | 0 | **21 file / 1725 assertion, `Result: PASS`** |
| `supabase gen types typescript --local --schema public --workdir <scratch>` | 0 | identik dengan `src/server/supabase/database.types.ts` (82.663 karakter setelah normalisasi akhir baris) |
| `supabase stop --no-backup --workdir <scratch>` | 0 | kontainer `m5-rebuild` 0, volume 0 |

Log start memuat key demo lokal stack sekali pakai; log itu dihapus setelah stop dan tidak masuk repo.

## Regresi §7

Run pertama (52 command berurutan): 32 lulus, 20 merah. Docker Desktop berhenti saat `test:e2e:release` berjalan (backend keluar 09:51 dan baru hidup lagi 11:33; ketiga kalinya hari ini, sebelumnya 06:28 dan 06:32). Semua suite E2E sesudahnya gagal dalam 26–47 detik karena fixture, renderer, atau `docker exec` tidak terjangkau. Tidak ada event *resource exhaustion* Windows. Penyebab berhentinya Docker tidak diketahui; kemungkinan mesin tidur. Run ulang (runner kini mencatat status Docker setelah tiap command) menjalankan `db:test` dan 19 suite E2E itu dengan Docker hidup sepanjang run.

| Command | Exit | Hasil | Run |
| --- | ---: | --- | --- |
| `pnpm lint` | 0 | bersih | 1 |
| `pnpm typecheck` | 0 | bersih | 1 |
| `pnpm test` | 0 | 129 file / **1181** | 1 |
| `pnpm db:test` | 1 | 21 file / 1725; 3 gagal di `cv_export.test.sql` (M5-N3) | 1 dan ulang |
| `pnpm db:lint` | 0 | `results: []` | 1 |
| `pnpm exec supabase migration list --local` | 0 | 38/38, tanpa selisih | terpisah |
| `pnpm worker:check` | 0 | `ready`, 9 job | 1 |
| `pnpm build` | 0 | berhasil | 1 |
| `pnpm ops:check` | 0 | `status: ok` | 1 |
| `pnpm test:pdf` | 0 | 46 | 1 |
| `pnpm test:integration:m5` | 0 | 7 | 1 |
| `pnpm test:integration:release` | 0 | 12 | 1 |
| `pnpm test:integration:account-deletion` | 0 | 15 | 1 |
| `pnpm test:integration:product-events` | 0 | 9 | 1 |
| `pnpm test:integration:ai-usage` | 0 | 9 | 1 |
| `pnpm test:integration:m4` | 0 | 17 | 1 |
| `pnpm test:integration:m3` | 0 | 7 | 1 |
| `pnpm test:integration:m2` | 0 | 8 | 1 |
| `pnpm test:integration:cv-export` | 0 | 35 | 1 |
| `pnpm test:integration:cv-freshness` | 0 | 11 | 1 |
| `pnpm test:integration:cv-builder` | 0 | 7 | 1 |
| `pnpm test:integration:cv` | 0 | 10 | 1 |
| `pnpm test:integration:achievements` | 0 | 5 | 1 |
| `pnpm test:integration:projects` | 0 | 7 | 1 |
| `pnpm test:integration:activity` | 0 | 6 | 1 |
| `pnpm test:integration:dashboard` | 0 | 4 | 1 |
| `pnpm test:integration:import-commit` | 0 | 12 | 1 |
| `pnpm test:integration:import-review` | 0 | 6 | 1 |
| `pnpm test:integration:import` | 0 | 25 | 1 |
| `pnpm test:integration:ai` | 0 | 13 | 1 |
| `pnpm test:integration:ai-review` | 0 | 21 | 1 |
| `pnpm test:integration:evidence` | 0 | 14 | 1 |
| `pnpm test:integration:storage` | 0 | 1 | 1 |
| `pnpm test:e2e:m5` | 0 | 1 | 1 |
| `pnpm test:e2e:release` | 0 | **15** | ulang (run 1: 3 lulus sebelum Docker berhenti) |
| `pnpm test:e2e:account-deletion` | 0 | 7 | ulang |
| `pnpm test:e2e:m4` | 0 | 1 | ulang |
| `pnpm test:e2e:m3` | 0 | 2 | ulang |
| `pnpm test:e2e:m2` | 0 | 1 | ulang |
| `pnpm test:e2e:cv-export` | 0 | 12 | ulang |
| `pnpm test:e2e:cv-freshness` | 0 | 11 | ulang |
| `pnpm test:e2e:cv` | 0 | 8 | ulang |
| `pnpm test:e2e:achievements` | 0 | 4 | ulang |
| `pnpm test:e2e:projects` | 0 | 1 | ulang |
| `pnpm test:e2e:dashboard` | 0 | 1 | ulang |
| `pnpm test:e2e:auth` | 0 | 1 | ulang |
| `pnpm test:e2e:ui` | 0 | 1 | ulang |
| `pnpm test:e2e:activity` | 0 | 1 | ulang |
| `pnpm test:e2e:import` | 0 | 11 | ulang |
| `pnpm test:e2e:import-review` | 0 | 10 | ulang |
| `pnpm test:e2e:ai` | 0 | 2 | ulang |
| `pnpm test:e2e:ai-review` | 0 | 11 | ulang |
| `pnpm test:e2e:evidence` | 0 | 8 | ulang |
| `git diff --check 973e886 HEAD` | 0 | bersih | terpisah |

Angka sama dengan baseline task asalnya (T26 gate: `import` 25, `import-commit` 12, `release` 15, E2E `import` 11, `import-review` 10; T25: `account-deletion` E2E 7, `evidence` 8; M4: `m4` 17, `cv-export` 35). Tidak ada asersi yang diubah. Tidak ada flaky selain gangguan Docker; setiap suite yang merah di run 1 lulus pada run ulang pertama.

`db:test` gagal konsisten (run 1 dan ulang): `pg_temp.n_exports()` menghitung semua `cv_exports` di database bersama. Sisa export naik dari 2 (Fase 0) menjadi 5, kemungkinan dari akun `t25-*` milik run `test:e2e:release` yang terputus Docker. Clean rebuild di atas lulus 21/1725, jadi ini pencemaran data, bukan defect (M5-N3, P3).

## Performance

`pnpm test:perf` dijalankan sendirian (tanpa suite lain, `next build`, atau `next dev` di checkout ini), `WORKPULSE_PERF_OUT` ke scratchpad; `T24-perf-results.json` tidak berubah. Exit 0, 1 file / 3 test, 96 detik. Dataset T24 (1.000 activity, 200 achievement, 50 project), 50 sampel warm per operasi plus satu cold, lapisan service, loopback, satu mesin Windows lokal.

| Operasi | p95 (ms) |
| --- | ---: |
| S04 `getDashboard` | 99,6 |
| S06 `activities.list` halaman 1 / 3 / filter project | 90,7 / 101,7 / 99,7 |
| S07 `achievements.list` semua / confirmed / tanpa evidence | 154,7 / 150,2 / 151,5 |
| S09 `projects.list` semua / outcome kosong | 120,8 / 119,3 |
| S11 `getTimeline` | 108,3 |
| Simpan: `createActivity`, `updateActivity`, `saveAchievement` draft, confirm, `createProject`, `updateProject` | 72,2 / 80,4 / 91,2 / 77,6 / 75,3 / 80,5 |

p95 baca tertinggi **154,7 ms** (target 2.000), simpan tertinggi **91,2 ms** (target 1.000). Batas metode sama dengan T24 G5.

## Kebersihan

- Screenshot ter-track yang ditulis ulang suite lama (`T22-screenshots` 24 file, `T23-screenshots` 12, `T25-screenshots` 90) dikembalikan dengan `git restore` setelah tiap run (T22 N3). Suite gate tidak menulis ke direktori ter-track.
- Akun fixture tersisa di database lokal: `m5-*` dan `acd-m5-*` **0** (suite gate membersihkan akunnya). Suite lama: `wp-*` 244, `t25-*` 12, `m2-*` 3, `demo-*` 1; profil total 262. Sisa `t25-*` sebagian berasal dari run `test:e2e:release` yang terputus Docker (T25 O3).

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| M5-N3 | P3 | `cv_export.test.sql` gagal di database lokal bersama yang berisi export akun lain; lulus di clean rebuild | Catat; follow-up: hitung export milik akun test saja |
| M5-N7 | P3 | Docker Desktop berhenti tiga kali selama gate (06:28, 06:32, 09:51) dengan exit bersih; suite yang sedang jalan gagal dan membocorkan akun fixture | Catat sebagai keterbatasan lingkungan lokal; semua suite lulus saat Docker hidup |

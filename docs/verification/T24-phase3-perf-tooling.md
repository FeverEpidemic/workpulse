# T24 Fase 3 — Alat ukur dan seed performa

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `80cc2fc`; commit: `fed6ff8` (`test(t24): add performance seed and percentile helpers`)
- Tidak ada perubahan di `src/`, `workers/`, atau migration.

## Tujuan dan file berubah

| File | Isi |
| --- | --- |
| `tests/unit/perf-stats.test.ts` | 6 test unit untuk persentil dan ringkasan |
| `tests/perf/stats.ts` | `percentileNearestRank(values, p)` (p 0–100, tidak mengubah input, menolak kosong dan non-finite), `summarize(samples) → { n, p50, p95, max }` |
| `tests/perf/perf-support.ts` | `sql`/`sqlAsUser` (stdin ke `psql`), harness, `ensureAccount`, `signInClient`, `removeAccount` (jalur penghapusan T23), `environmentInfo`, `writeResults` (`WORKPULSE_PERF_OUT`, default `docs/verification/T24-perf-results.json`) |
| `tests/perf/seed.ts` | seed lewat RPC dengan klaim JWT, `countDataset`, `EXPECTED_DATASET`, idempotent per akun |
| `tests/perf/read-write.test.ts` | di fase ini hanya verifikasi dataset dan idempotensi seed; pengukuran ditambahkan di Fase 5 |
| `vitest.perf.config.ts` | `include: tests/perf/**/*.test.ts`, `maxWorkers: 1`, timeout 600 detik; tidak masuk `pnpm test` |
| `package.json` | script `test:perf` |

Berbeda dari urutan §4: `read-write.test.ts` sudah dibuat di fase ini sebagai tempat verifikasi seed (plan Fase 3 mewajibkan seed diverifikasi). Isinya tidak berubah arah; Fase 5 menambah pengukuran di file yang sama.

## TDD

1. `tests/unit/perf-stats.test.ts` ditulis lebih dulu; dijalankan sebelum `stats.ts` ada: **gagal** (`Cannot find module '../perf/stats'`).
2. Setelah `stats.ts`: **6 test lulus**. Nilai yang diuji: n = 1; n = 20 (p95 = urutan ke-19), n = 50 (ke-48), n = 51 (ke-49), n = 100 (ke-95); input tidak terurut; p0 = minimum, p100 = maksimum; input tidak berubah; array kosong, p di luar 0–100, NaN, dan nilai non-finite melempar error.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm exec vitest run tests/unit/perf-stats.test.ts` | exit 0, 1 file / 6 test |
| `pnpm test:perf` (dijalankan sendirian) | exit 0, **1 file / 2 test**, 14 detik; seed dua akun 7 detik |
| `pnpm test` | exit 0, **114 file / 1041 test** (113/1035 + 1/6) |
| `pnpm typecheck`, `pnpm lint` | exit 0 |
| Akun `t24-perf-%` tersisa setelah `test:perf` | **0** |

## Verifikasi seed (dihitung `count(1)` per akun, sama untuk P dan Q)

| Tabel | Hasil | Target §6 |
| --- | --- | --- |
| activities | 1.000 (300 terhubung project) | 1.000 / 300 |
| achievements | 200: 150 confirmed, 40 draft, 10 dismissed; 120 turunan activity; **60 dengan metrics** | 200 / 150 / 40 / 10 / 120 / 60 |
| projects | 50: 30 terhubung experience; 10 planned, 20 active, 20 completed (5 tanpa outcome) | sama |
| experiences / education / certifications / skills | 5 / 2 / 3 / 40 | sama |
| evidence_files | 0 | 0 (batas dicatat) |
| cv_items | ≥ 40 (parent ikut terpilih) | 40 terpilih lintas enam section |

Seed kedua untuk akun dengan label yang sama: `seeded: false`, hitungan identik. Dataset sebagian ditolak (tidak ditambal). `analyze` dijalankan setelah seed.

Koreksi dari probe Fase 0: achievement bermetrics kini 60 (probe 57).

## Acceptance yang terbukti

- §1.12 (dataset nyata): seed lewat RPC dengan trigger T24 aktif, hitungan diverifikasi, akun Q sama dengan P di database yang sama.
- Persentil nearest-rank dengan unit test (bagian dari §2.2.11 dan §3.3).

## Belum terbukti

- Pengukuran p95 (Fase 5), plan sesudah trigger T24 (Fase 4).
- Tidak ada `console.` di `tests/perf` pada fase ini; reporter hasil ditambahkan di Fase 5 dan dicek ulang di Fase 6.

## Blocker dan catatan

- Tidak ada stop condition §8 yang terpicu.
- Akun fixture memakai `t24-perf-p@example.test` dan `t24-perf-q@example.test` sesuai §6; password acak per run dan tidak dicetak. Akun yang tertinggal dari run yang crash dipakai ulang dengan password baru; bila datasetnya sebagian, seed menolak.

## Langkah berikutnya

Fase 4: catat `EXPLAIN (ANALYZE, BUFFERS)` dengan trigger T24 aktif dan nilai terhadap §2.2.12.

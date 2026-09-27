# Gate M2 — Fase 5 regresi penuh

- Tanggal: 27 September 2026 · Handoff §5 Fase 5 dan §7 · HEAD saat run: `e41b572`
  (termasuk perbaikan F1 `107b32c`).
- Environment: Supabase lokal aktif (tanpa reset); `SUPABASE_SECRET_KEY` hanya di env proses; ClamAV nyata
  `workpulse-t10-clamav` **1.5.4 / daily 28135 / Sat Sep 26 2026** di `127.0.0.1:13310`
  (`WORKPULSE_SCANNER_MODE=clamav`); variabel AI/agen harness dihapus dari proses.

## Hasil

| Command | Exit | Hasil aktual |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | up to date |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | **44 file / 203 test** (lihat catatan N1) |
| `pnpm db:test` | 0 | **7 file / 386 assertion**, PASS |
| `pnpm db:lint` | 0 | `results: []` |
| `pnpm exec supabase migration list --local` | 0 | **21/21**, terakhir `20260927090000` |
| `pnpm test:integration:activity` | 0 | 6/6 |
| `pnpm test:integration:projects` | 0 | 7/7 |
| `pnpm test:integration:achievements` | 0 | 5/5 |
| `pnpm test:integration:storage` | 0 | 1/1 |
| `pnpm test:integration:evidence` | 0 | **14/14** — backend 7, pipeline 5 (Storage privat + ClamAV nyata: clean, EICAR, spoof, lost finalize, outage/cleanup), scanner-real 2 (lihat N2) |
| `vitest … tests/integration/evidence-lifecycle.test.ts` (tanpa script, G1) | 0 | 5/5 |
| `pnpm test:integration:dashboard` | 0 | 4/4 |
| `pnpm test:integration:m2` | 0 | **8/8** |
| `pnpm test:e2e:auth` | 0 | 1/1 |
| `pnpm test:e2e:ui` | 0 | 1/1 |
| `pnpm test:e2e:activity` | 0 | 1/1 |
| `pnpm test:e2e:projects` | 0 | 1/1 |
| `pnpm test:e2e:achievements` | 0 | **4/4** (termasuk regresi F1 dan test konflik yang dulu flaky) |
| `pnpm test:e2e:dashboard` | 0 | 1/1 |
| `pnpm test:e2e:evidence` | 0 | **8/8** — evidence-api (HTTP + ClamAV nyata), evidence-ui, plus rerun activity/projects/achievements di port 3004 |
| `pnpm test:e2e:m2` | 0 | **1/1** |
| `pnpm worker:check` | 0 | `ready`, jobs `evidence-scan`, `evidence-cleanup` |
| `pnpm build` | 0 | compiled successfully |
| `git diff --check` | 0 | bersih |

Tidak ada test yang gagal konsisten. Tidak ada flaky pada run ini: test konflik Achievement
(`achievements-ui.spec.ts`, dulu `:199`, sekarang `:241`) lulus pada tiga eksekusi terpisah hari ini
(`test:e2e:achievements` Fase 3, Fase 5, dan di dalam `test:e2e:evidence`) setelah `845375c`.

## Catatan environment (bukan kegagalan produk)

- **N1:** run pertama `pnpm test` di proses yang sama dengan env scanner gagal 2/203
  (`tests/unit/malware-scanner.test.ts` "fails closed when no scanner is configured" dan "keeps ClamAV
  unavailable when the daemon endpoint is not configured"). Test membaca `WORKPULSE_SCANNER_MODE=clamav`
  dari env proses, lalu benar-benar memindai. Tanpa env scanner, hasilnya 203/203 (juga di Fase 0).
  Unit test ini tidak hermetik terhadap env proses → **P3** follow-up (stub `process.env` di test).
- **N2:** run pertama `test:integration:evidence` gagal setup `evidence-pipeline.test.ts` ("Local Supabase
  environment required") karena suite itu tidak memuat `.env.local` sendiri. Rerun dengan
  `SUPABASE_URL`/publishable key dari `.env.local` di env proses: 14/14. → **P3** (suite tidak konsisten
  dengan suite lain yang memanggil `process.loadEnvFile`).
- Warning non-blocking pada log E2E: Next.js `The destination stream closed early` 121 kali; Node
  `NO_COLOR` 153 kali. Keduanya P3 yang sudah tercatat sejak T07–T12.

## Container ClamAV

Handoff meminta container dihentikan di akhir Fase 5. Fase 6 (rerun `test:e2e:m2` setelah perbaikan) dan
Fase 7 (verifikasi independen `test:e2e:m2`) juga membutuhkan ClamAV nyata, sehingga container
**dipertahankan sampai akhir Fase 7** lalu dihentikan/dihapus sesuai runbook. Deviasi ini dicatat dan tidak
mengganti scanner dengan fake. Stack Supabase tidak dihentikan.

## Temuan

Tidak ada P0–P2 baru. P3 baru: N1, N2. G1 tetap P3 (lifecycle suite lulus 5/5 bila dijalankan eksplisit).

## Langkah berikutnya

Fase 6: pemetaan skenario rilis dan laporan draft `M2-gate-review.md`.

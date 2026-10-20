# T26 Import CV tanpa AI (parser aturan): bukti acceptance

Tanggal: 20 Oktober 2026. Status: **DONE** (acceptance lokal). Pelaksana Fase 0-5: Claude (Opus 5.5). Gate review: Claude (Opus 5.5), PASS tanpa P0-P2 ([gate review](T26-gate-review.md)). Fase 6 (dokumen ini, decision final, perbaikan N5) ditulis reviewer.

- [Rencana](T26-implementation-plan.md), [decision 0033](../decisions/0033-t26-import-rules-extraction.md), receipt [Fase 0](T26-phase0-baseline.md), [1](T26-phase1-database.md), [2](T26-phase2-domain.md), [3](T26-phase3-worker-service.md), [4](T26-phase4-ui.md), [5](T26-phase5-e2e-regression.md).
- Basis: batas pemakaian AI (decision 0032, branch `claude/eloquent-jones-3c0191`, [gate review](ai-usage-limits-gate-review.md) PASS). T26 harus di-merge setelah atau bersama branch itu.
- Migration ke-38 `20261019090000_t26_import_rules_extraction.sql`; parity lokal 38/38.

## Acceptance §1

| # | Poin | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | Upload tanpa consent dengan mode `rules` | Pass | pgTAP `import_rules`, integration import |
| 2 | Mode immutable, bagian identitas idempotency | Pass | pgTAP |
| 3 | Staging atomik tanpa AI, cancel → `stale` | Pass | pgTAP |
| 4 | Perilaku AI tidak berubah | Pass | suite T15-T17 lulus; hanya 3 string signature di `import_staging.test.sql` yang diganti |
| 5 | Kandidat grounded (`dropped_ungrounded === 0`) | Pass | unit `import-rules-extract` |
| 6 | Aturan ekstraksi §2.2.6 | Pass | unit, 35 test |
| 7 | Aman terhadap input jahat | Pass | unit waktu (maks. 0,57 ms/baris, CV 60k 9,1 ms), `parse-in-thread` |
| 8 | `IMPORT_RULES_FAILED` permanen, log hanya kode | Pass | unit worker, pgTAP |
| 9 | Retry `rules` tanpa consent | Pass | pgTAP, integration `T26-3` |
| 10 | Dialog pilihan netral | Pass | unit dialog, E2E keyboard/Esc/Cancel |
| 11 | Copy jujur en/id tanpa em dash | Pass | unit copy |
| 12 | Alur penuh upload → commit → purge, penghapusan akun | Pass | integration import, import-commit, account-deletion; E2E journey |
| 13 | Isolasi akun dan privasi log | Pass | integration akun B `NOT_FOUND`, sentinel 0 di worker, response, console |
| 14 | Aksesibilitas | Pass, dengan catatan | E2E Axe, 360/1440, light/dark, urutan tab; NVDA manusia tidak diuji |

## Trace

PRD R02 dan §3 (kandidat sampai *Confirm*), F01 *Import exceptions* (hasil kosong → `review_empty`), Wireframe S02 (dialog pilihan, disclosure, catatan `rules`) dan S03 (catatan di atas grup kandidat), Database Schema §4 (`import_batches.extraction_mode`, `internal.import_jobs.extraction_mode`).

## Commands (verifikasi ulang reviewer, 20 Oktober 2026, HEAD `650b375`)

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm worker:check`, `git diff --check` | 0 | |
| `pnpm test` | 0 | 121 file / 1151 test |
| `pnpm db:test` | 0 | 21 file / 1725 test |
| `pnpm db:lint` | 0 | |
| `pnpm build` | 0 | |
| `pnpm test:integration:account-deletion` | 0 | 15/15 |
| `pnpm test:integration:import` | 0 | 25/25 |
| `pnpm test:integration:import-commit` | 0 | 12/12 |
| `pnpm test:integration:import-review` | 0 | 6/6 |
| `pnpm test:integration:m3` | 0 | 7/7 |
| `pnpm test:integration:release` | 0 | 12/12 |
| `pnpm test:integration:ai-usage` | 0 | 9/9 |
| `pnpm test:integration:ai`, `ai-review`, `storage` | 0 | 13, 21, 1 |
| `pnpm test:e2e:import` | 0 | 11/11 |
| `pnpm test:e2e:import-review` | 0 | 10/10 |
| `pnpm test:e2e:m3` | 0 | 2/2 |
| `pnpm test:e2e:release` | 0 | 15/15 |
| `pnpm test:e2e:ai`, `ai-review` | 0 | 2, 11 |
| `pnpm test:e2e:m2` | 0 | lulus |

Setelah perbaikan N5 (spasi di `contracts.ts`) reviewer mengulang `pnpm lint` dan `pnpm typecheck` (lihat commit closeout).

## Flaky dan lingkungan

- Fase 0: `test:e2e:import-review` sekali gagal `filechooser` timeout saat server dev pertama kali dikompilasi; run ulang 10/10.
- Fase 5: run pertama gagal karena database masih `57P03` dan container helper berhenti; lulus setelah lingkungan siap tanpa perubahan kode.
- Log web server E2E memuat `The destination stream closed early.`; semua suite lulus.

## Tidak dijalankan

`test:e2e:evidence`, `test:e2e:account-deletion`, `test:pdf`, `test:perf`; uji kualitas ekstraksi pada CV nyata; NVDA manusia; run di clone segar.

## Follow-up P3

N1 urutan merge dengan branch usage limits; N2 deploy migration dan worker bersamaan; N3 fokus setelah *Pakai AI*; N6 em dash di ringkasan error S03 (sejak T17); N7 uji CV nyata dan NVDA. Detail di [gate review](T26-gate-review.md).

## Batas

Semua bukti lokal. Staging dan production belum menerima migration ini.

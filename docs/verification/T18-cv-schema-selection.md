# T18 CV schema dan selection — bukti acceptance

- Tanggal: 30 September 2026
- Status: **DONE** (acceptance lokal)
- Pelaksana: Claude Sonnet 5.5; reviewer: Claude (Opus), gate review `T18-gate-review.md` tanpa P0–P2.
- Trace: PRD R09 dan *CV freshness contract*; F07 langkah 1–2, F03; S13 (backend saja); DB §1, §5, §6. Decision [0024](../decisions/0024-t18-cv-schema-selection.md). Receipt [Fase 0](T18-phase0-baseline.md)–[4](T18-phase4-integration-regression.md).

## Acceptance §1

| # | Poin | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | Satu CV per akun | PASS | pgTAP; integration lima `ensure` paralel → satu row |
| 2 | Onboarding wajib | PASS | pgTAP; integration |
| 3 | Draft tidak eligible | PASS | pgTAP, unit service, integration |
| 4 | Child memasukkan parent | PASS | pgTAP, integration |
| 5 | Duplikat ditolak | PASS | pgTAP |
| 6 | Validasi section/sumber | PASS | pgTAP |
| 7 | Ownership | PASS | pgTAP, integration (query klien langsung) |
| 8 | Mutasi menaikkan revision tepat 1 | PASS | pgTAP |
| 9 | Edit bersamaan | PASS | integration dua session, 3 putaran, tanpa `40P01` |
| 10 | Reorder transaksional | PASS | pgTAP, unit, integration |
| 11 | Hapus parent eksplisit | PASS | pgTAP, integration |
| 12 | Snapshot sumber | PASS | pgTAP (key persis), unit skema `.strict()` |
| 13 | Hapus sumber tidak rusak | PASS | pgTAP, integration enam tipe |
| 14 | Tanpa perubahan perilaku lama | PASS | suite lama dan M2/M3 lulus |
| 15 | Log hygiene | PASS | integration sentinel; `console.` di `src/features/cv` = 0 |

## Command

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint`, `typecheck`, `build`, `worker:check`, `git diff --check` | 0 | bersih (diulang reviewer) |
| `pnpm test` | 0 | 81 file / 575 test (angka dari receipt) |
| `pnpm db:test` | 0 | 12 file / 909 assertion PASS (diulang reviewer) |
| `pnpm db:lint` | 0 | `results: []` |
| `pnpm exec supabase migration list --local` | 0 | 27/27 |
| `test:integration:cv` | 0 | 10/10 (dijalankan pelaksana 4 kali dan reviewer sekali) |
| `test:integration:` achievements / projects / import-commit / m2 / m3 | 0 | 5 / 7 / 11 / 8 / 7 (diulang reviewer) |
| `test:integration:` activity, dashboard, import-review, import, ai, ai-review, evidence, storage | 0 | 6, 4, 6, 21, 13, 21, 14, 1 (receipt pelaksana) |
| `test:e2e:` m2 / m3 / achievements / activity | 0 | 1 / 2 / 4 / 1 (diulang reviewer) |
| `test:e2e:` projects, dashboard, auth, ui, import, import-review, ai, ai-review, evidence | 0 | receipt pelaksana |

## Flaky, tidak dijalankan, batas

- **Flaky:** `test:e2e:activity` gagal pada run pertama pelaksana (test tidak tercatat), lulus saat diulang oleh pelaksana dan reviewer.
- **Tidak dijalankan:** `test:e2e` gabungan, `test:ai:live`.
- **Batas:** bukti lokal. Tidak ada UI S13 (T19), freshness dan invalidasi revision CV saat sumber berubah (T20), maupun export (T21/T22). Race diuji dengan dua session nyata tanpa stres berskala (T24). Bukan bukti production.

## Follow-up P3

F1 penyebab flaky tidak terkonfirmasi; F2 correlation ID di `actions.ts` (rapikan di T19); F3 race tidak deterministik (diterima).

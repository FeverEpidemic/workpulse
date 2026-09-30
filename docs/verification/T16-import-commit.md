# T16 — Import commit transaction: acceptance evidence

- Tanggal: 30 September 2026 (implementasi dan gate review 29 September 2026, HEAD gate `6a8dd06`)
- Rujukan: PRD R02, §3, §4; F01 langkah 3–4; S03 (backend saja), S08; DB §1–§4, §6; [decision 0022](../decisions/0022-t16-import-commit.md); [rencana](T16-implementation-plan.md);
  receipt [Fase 0](T16-phase0-baseline.md), [1](T16-phase1-database.md), [2](T16-phase2-service-actions.md), [3](T16-phase3-integration.md), [4](T16-phase4-provenance-regression.md); [gate review](T16-gate-review.md).
- Pelaksana dan reviewer sama-sama Claude (review tidak independen; lihat gate review).

## Acceptance §1

| # | Poin | Bukti | Hasil |
| --- | --- | --- | --- |
| 1 | Commit atomik campuran | pgTAP `import_commit.test.sql` §7; integration 1 | PASS |
| 2 | Foundation dulu, referensi di-resolve (create/map/skip) | pgTAP §7 | PASS |
| 3 | Double commit (berurutan, paralel ×3) | pgTAP §8; integration 2 | PASS |
| 4 | Satu item invalid me-rollback semua (termasuk constraint-only) | pgTAP §6; integration 3 | PASS |
| 5 | Map hanya reuse dan milik sendiri | pgTAP §4/§7; integration 4 | PASS |
| 6 | Draft default, confirm eksplisit | pgTAP §3/§7 | PASS |
| 7 | Profil hanya field terpilih | pgTAP §7 | PASS (skip profile tanpa assertion sendiri, P3) |
| 8 | Onboarding lewat commit | pgTAP §9; integration 5 | PASS |
| 9 | Provenance setelah purge | pgTAP §11; integration 7 | PASS |
| 10 | Persist + revision guard | pgTAP §3 | PASS |
| 11 | Validasi dry-run | pgTAP §5 | PASS (`INVALID_ACTION` tidak terjangkau lewat RPC) |
| 12 | Status dan isolasi | pgTAP §10; integration 8 | PASS |
| 13 | Race commit vs update/cancel/delete | integration 6a–6c (satu putaran) | PASS terbatas |
| 14 | Skenario PRD CV Indonesia overlap | integration 1 | PASS |
| 15 | S08 provenance import | unit render en/id; `test:e2e:achievements` | PASS |
| 16 | Log hygiene | integration 9; grep `console.` = 0 | PASS |
| 17 | Regresi T06–T15 | tabel di bawah | PASS |

## Command

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` / `typecheck` / `worker:check` / `db:lint` / `git diff --check` | 0 | bersih |
| `pnpm build` | 0 | Compiled successfully |
| `pnpm test` | 0 | 70 file / 449 test |
| `pnpm db:test` | 0 | Files=11, Tests=779 PASS |
| `pnpm test:integration:import-commit` | 0 | 11/11 |
| `test:integration:` import / achievements / dashboard / activity / projects / m2 / ai / ai-review / evidence / storage | 0 | 21 / 5 / 4 / 6 / 7 / 8 / 13 / 21 / 14 / 1 |
| `test:e2e:` achievements / import / m2 / dashboard / auth / ui / activity / projects / ai / ai-review / evidence | 0 | 4 / 7 / 1 / 1 / 1 / 1 / 1 / 1 / 2 / 11 / 8 |

Gate review mengulang lint, typecheck, test, db:test, db:lint, worker:check, integration import-commit/import/achievements (semua exit 0, angka sama). `pnpm exec supabase migration list --local`: 26/26.

## Flaky, tidak dijalankan, batas

- Tidak ada flaky. Log Playwright `The destination stream closed early` berasal dari Next dev server, tidak memengaruhi hasil.
- Tidak dijalankan: uji stres race berulang; smoke live provider; production.
- Fixture T15 `import_staging.test.sql` disesuaikan (guard `committed_id`), assertion tidak diubah.
- Batas: bukti lokal (Supabase lokal, ClamAV/Gotenberg nyata, fake AI); bukan bukti production.

## P3 follow-up

1. Assertion pgTAP untuk profile `skip` dan `validate` pada akun deleting (T17).
2. UI T17 harus menangani `IMPORT_ITEM_INVALID` dengan daftar kosong (unique-race skill).
3. Ulangi race berulang bila T24 membutuhkannya.

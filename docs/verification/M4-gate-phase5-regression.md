# Gate M4 — Fase 5: regresi penuh

- Tanggal: 9 Oktober 2026.
- Pelaksana: Claude Sonnet 5.5.
- HEAD yang diuji: sesudah `9c0cc25` (`test(m4): add CV output cross-domain integration`) dan commit receipt Fase 3–4; kode produk terakhir berubah di `3a6d8fb`, `e67b8a6`, `41c4af0`.
- Cara: satu skrip runner berurutan (di luar repository) menjalankan seluruh daftar §7 handoff, mencatat command, exit code, durasi, dan ringkasan; command yang gagal diulang satu kali. Hasil mentah: tidak ada command yang gagal, tidak ada rerun.
- Lingkungan: Supabase lokal (migration **31/31**, terakhir `20261005090000`), ClamAV `workpulse-t10-clamav`, Gotenberg T15 `workpulse-t15-gotenberg`, renderer export `workpulse-t21-pdf` (`WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` di env proses). `.env.local` dan `SUPABASE_SECRET_KEY` (JWT `SERVICE_ROLE_KEY` lokal) hanya di env proses; `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan. Tidak ada `db reset`.

## Hasil

| Command | Exit | Hasil |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | lockfile tidak berubah |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | **104 file / 962 test** (baseline 103 / 956; +6 = 4 `activity-before-input` + 2 `preview column`) |
| `pnpm db:test` | 0 | 15 file / 1290 assertion, PASS |
| `pnpm db:lint` | 0 | `results: []` |
| `pnpm exec supabase migration list --local` | 0 | 31/31 |
| `pnpm test:pdf` | 0 | 46 test |
| `pnpm test:integration:m4` | 0 | **17** (baru) |
| `test:integration:cv-export` | 0 | 35 (3 file) |
| `test:integration:cv-freshness` / `cv-builder` / `cv` | 0 | 11 / 7 / 10 |
| `test:integration:achievements` / `projects` / `activity` / `dashboard` | 0 | 5 / 7 / 6 / 4 |
| `test:integration:import-commit` / `import-review` / `import` | 0 | 11 / 6 / 21 |
| `test:integration:m2` / `m3` | 0 | 8 / 7 |
| `test:integration:ai` / `ai-review` | 0 | 13 / 21 |
| `test:integration:evidence` / `storage` | 0 | 14 / 1 |
| `pnpm test:e2e:m4` | 0 | **1** (baru; 1,3 menit) |
| `test:e2e:cv-export` | 0 | 12 |
| `test:e2e:cv-freshness` | 0 | **11** (baseline 10; +1 regresi T20 F1) |
| `test:e2e:cv` / `achievements` / `projects` / `dashboard` | 0 | 8 / 4 / 1 / 1 |
| `test:e2e:auth` / `ui` / `activity` | 0 | 1 / 1 / 1 |
| `test:e2e:import` / `import-review` | 0 | 7 / 10 |
| `test:e2e:ai` / `ai-review` | 0 | 2 / 11 |
| `test:e2e:evidence` | 0 | 8 |
| `test:e2e:m2` / `m3` | 0 | 1 / 2 (asersi env AI tidak dilemahkan) |
| `pnpm worker:check` | 0 | `ready`, 8 job terdaftar |
| `pnpm build` | 0 | berhasil |
| `git diff --check` | 0 | bersih |

## Flaky

Tidak ada. Flaky bawaan `activity-ui.spec.ts:356` (T22 N7) tidak muncul pada run ini (`test:e2e:activity` 1/1 dan `test:e2e:evidence` 8/8 lulus pada percobaan pertama).

## Working tree setelah regresi

`test:e2e:cv-export` menimpa 16 PNG `docs/verification/T22-screenshots/s14-*` yang di-track (T22 N3, sama seperti baseline). Dipulihkan dengan `git restore docs/verification/T22-screenshots`; working tree kembali hanya berisi `.claude/` yang tidak dilacak. E2E M4 tidak menulis ke direktori itu.

## Tidak dijalankan

- `test:e2e` gabungan dan `test:ai:live` (journey ini tanpa AI).
- Stres race berskala, p95 (T24), staging/production (T25).
- `db:types`: tanpa migration baru dan tanpa perubahan RPC.

## Temuan baru

Tidak ada. Temuan Fase 3 (RV-A11Y, RV-QL, RV-F1) sudah diperbaiki sebelum regresi ini; seluruh suite lama lulus tanpa diubah (satu-satunya perubahan pada suite lama adalah penambahan satu test di `cv-freshness.spec.ts` dan dua test unit baru di file unit CV yang sudah ada).

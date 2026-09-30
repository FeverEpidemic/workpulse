# T17 — Import review UI dan onboarding lengkap: bukti acceptance lokal

- Tanggal: 30 September 2026. Status: **DONE (acceptance lokal)**.
- HEAD akhir kode: `2c81c02` (baseline `d4bd39f`). Rencana: [T17-implementation-plan.md](T17-implementation-plan.md). Decision: [0023](../decisions/0023-t17-import-review-ui.md).
- Receipt: [Fase 0](T17-phase0-baseline.md), [1](T17-phase1-view-model.md), [2](T17-phase2-service-route-action.md), [3](T17-phase3-s03-screen.md), [4](T17-phase4-entry-points.md), [5](T17-phase5-browser-regression.md), [5b remediasi](T17-phase5b-remediation.md). Gate: [T17-review-remediation-plan.md](T17-review-remediation-plan.md).
- Pelaksana Fase 0–5: Claude Sonnet 5.5. Gate review dan remediasi RV1: Claude (Opus) — remediasi dikerjakan reviewer atas instruksi pengguna, sehingga review ulang tidak independen penuh.
- Trace: PRD R02, §3, *Shared validation*, release scenario import CV Indonesia; F01 langkah 3–6 dan *Import exceptions*; S02, S03, S04, S12; DB §4 lewat RPC T16 (tanpa migration).

## Acceptance §1

| # | Acceptance | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | S03 menampilkan grup, excerpt, field, pilihan, ringkasan | PASS | unit `import-review-view`, `import-review-ui`; integration 1; E2E R02 |
| 2 | Field kurang dan error validasi (en/id, `aria-describedby`, bukan warna saja) | PASS | unit; E2E partial extraction (`import_partial`) |
| 3 | Pilihan dipersist, status persistensi, refresh aman | PASS | integration 2; E2E refresh |
| 4 | Konflik tanpa kehilangan input; commit basi tidak commit | PASS | unit tracker (RV1); E2E dua tab + E2E RV1 |
| 5 | Map hanya ke record milik sendiri, target tidak berubah | PASS | integration 1/4; E2E pengguna lama (snapshot row) |
| 6 | Peringatan duplikat (skill Map satu klik, heuristik non-blocking) | PASS | unit heuristik; E2E R02 (`SQL`) |
| 7 | Konfirmasi achievement eksplisit per kandidat, tanpa *Confirm all* | PASS | unit; E2E R02 |
| 8 | Tombol final terblokir; double click/refresh tanpa row baru | PASS | unit blocker; E2E idempotensi (admin count) |
| 9 | Onboarding lewat import, tanpa placeholder | PASS | unit; E2E R02 (dashboard tanpa redirect) |
| 10 | Hasil dari `commit_result`, *Open dashboard*, fokus heading | PASS | integration 4; E2E R02/idempotensi |
| 11 | Status non-review dan not-found generik | PASS dengan catatan | unit; E2E isolasi. S03 menjawab HTTP 200 berkonten 404 generik (streaming `loading.tsx`), API 404 — diterima (decision 0023 poin 16) |
| 12 | Entry point S02/S04/S12; S02 untuk pengguna lama | PASS | unit `import-start-ui`, `import-entry-points`; E2E pengguna lama. Copy S02 `committed` hanya diuji unit |
| 13 | Skenario rilis PRD, keyboard-only jalur utama | PASS | E2E R02 |
| 14 | Axe WCAG 2.2 AA, 360/1440, light/dark, tanpa overflow | PASS | E2E layout + `snapshot()` Axe di tiap state |
| 15 | Privasi dan isolasi (sentinel = 0) | PASS | integration 5/6; E2E isolasi |
| 16 | Regresi T03–T16 | PASS | tabel di bawah; perubahan assertion disengaja tercatat di decision 0023 |

## Commands (hasil aktual)

Gate review (reviewer, HEAD `58e0183`):

| Command | Exit | Hasil |
| --- | --- | --- |
| lint, typecheck, build, `worker:check`, `db:lint` | 0 | — |
| `pnpm test` | 0 | 76 file / 495 |
| `pnpm db:test` | 0 | 11 file / 779, PASS |
| integration import-review, import-commit, import, achievements, dashboard, activity, projects, m2, ai, ai-review, evidence, storage | 0 | 6, 11, 21, 5, 4, 6, 7, 8, 13, 21, 14, 1 |
| E2E import-review, import, dashboard, m2, auth, ui, achievements, ai, activity, projects, ai-review | 0 | 9, 7, 1, 1, 1, 1, 4, 2, 1, 1, 11 |
| E2E evidence | 1 → 0 | 7/8 (flaky `activity-ui.spec.ts:356`), rerun 8/8 |
| `git diff --check d4bd39f..HEAD` | 2 | baris kosong EOF (N1, diperbaiki) |

Setelah remediasi (HEAD `2c81c02`):

| Command | Exit | Hasil |
| --- | --- | --- |
| lint, typecheck, build, `worker:check` | 0 | — |
| `pnpm test` | 0 | 76 file / 500 |
| integration import-review, import-commit | 0 | 6, 11 |
| `test:e2e:import-review --repeat-each 2` | 0 | 20/20 |
| E2E import, m2, dashboard | 0 | 7, 1, 1 |
| `git diff --check d4bd39f..HEAD` | 0 | — |

Lingkungan: Docker Desktop + Supabase lokal (parity 26/26), ClamAV `workpulse-t10-clamav`, Gotenberg `workpulse-t15-gotenberg`; fake AI provider; `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal di env proses saja; env AI harness dikosongkan untuk `test:e2e:m2`.

## Flaky dan tidak dijalankan

- Flaky pra-T17: `activity-ui.spec.ts:356` dalam `test:e2e:evidence` (juga tercatat di T15).
- Tidak dijalankan: smoke live `extractImport`, uji stres race commit, purge batch `review` yang ditinggalkan (T23), `db:test` dan regresi integration/E2E penuh setelah remediasi (perubahan remediasi terbatas pada komponen S03, helper domain, dan copy; tidak menyentuh SQL atau domain lain).

## Batas

Bukti lokal, bukan production. Tidak ada deployment.

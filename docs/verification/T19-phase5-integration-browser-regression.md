# T19 Fase 5 — Integration nyata, browser, dan regresi penuh (30 September 2026)

- Tujuan: bukti nyata untuk acceptance T19 §1 terhadap Supabase lokal, build produksi, ClamAV dan Gotenberg lokal yang berjalan.
- File baru: `tests/integration/cv-builder.test.ts` (7 skenario: graduate, override terpisah, edit bersamaan, parent removal, isolasi, delete sumber, log hygiene), `tests/e2e/cv-builder.spec.ts` (7 test: graduate journey keyboard, locale CV, parent removal, konflik dua sesi, Add to CV, responsive 360/1440 x light/dark + Axe, reduced motion), `playwright.cv.config.ts` (port 3012), script `test:integration:cv-builder` dan `test:e2e:cv`, screenshot di `docs/verification/T19-screenshots/` (`CV_SHOTS_DIR` opsional pada spec).
- Perbaikan yang ditemukan tes: preview/hapus tidak boleh memakai `disabled` saat operasi berjalan (fokus hilang) sehingga memakai `aria-disabled` + guard; list "Available to add" tidak menutup setelah item pertama ditambahkan (state awal); flag konflik hilang setelah pengguna mengedit atau menyimpan. Read fixture E2E memakai client pengguna (service_role tidak punya grant pada tabel karier).
- Catatan perilaku: satu perubahan struktural diproses sekali pada satu waktu; klik kedua saat operasi berjalan diabaikan (tes menunggu tiap Add).

## Hasil command (run regresi sesi ini)

| Command | Hasil |
| --- | --- |
| `lint` | exit=0 (22s)  |
| `typecheck` | exit=0 (5s)  |
| `test` | exit=0 (29s) Test Files  86 passed (86) | Tests  626 passed (626) |
| `db:test` | exit=0 (10s) Files=13, Tests=978,  6 wallclock secs ( 0.15 usr  0.08 sys +  0.19 cusr  0.28 csys =  0.70 CPU) | Result: PASS |
| `db:lint` | exit=0 (2s)  |
| `worker:check` | exit=0 (1s)  |
| `build` | exit=0 (25s)  |
| `test:integration:cv-builder` | exit=0 (16s) Test Files  1 passed (1) | Tests  7 passed (7) |
| `test:integration:cv` | exit=0 (25s) Test Files  1 passed (1) | Tests  10 passed (10) |
| `test:integration:achievements` | exit=0 (15s) Test Files  1 passed (1) | Tests  5 passed (5) |
| `test:integration:projects` | exit=0 (10s) Test Files  1 passed (1) | Tests  7 passed (7) |
| `test:integration:activity` | exit=0 (6s) Test Files  1 passed (1) | Tests  6 passed (6) |
| `test:integration:dashboard` | exit=0 (10s) Test Files  1 passed (1) | Tests  4 passed (4) |
| `test:integration:import-commit` | exit=0 (16s) Test Files  1 passed (1) | Tests  11 passed (11) |
| `test:integration:import-review` | exit=0 (8s) Test Files  1 passed (1) | Tests  6 passed (6) |
| `test:integration:import` | exit=0 (22s) Test Files  2 passed (2) | Tests  21 passed (21) |
| `test:integration:m2` | exit=0 (26s) Test Files  1 passed (1) | Tests  8 passed (8) |
| `test:integration:m3` | exit=0 (19s) Test Files  1 passed (1) | Tests  7 passed (7) |
| `test:integration:ai` | exit=0 (14s) Test Files  1 passed (1) | Tests  13 passed (13) |
| `test:integration:ai-review` | exit=0 (21s) Test Files  1 passed (1) | Tests  21 passed (21) |
| `test:integration:evidence` | exit=0 (17s) Test Files  3 passed (3) | Tests  14 passed (14) |
| `test:integration:storage` | exit=0 (6s) Test Files  1 passed (1) | Tests  1 passed (1) |
| `test:e2e:cv` | exit=0 (67s) 7 passed (1.1m) |
| `test:e2e:achievements` | exit=0 (66s) 4 passed (1.1m) |
| `test:e2e:projects` | exit=0 (41s) 1 passed (39.8s) |
| `test:e2e:dashboard` | exit=0 (67s) 1 passed (1.1m) |
| `test:e2e:auth` | exit=0 (81s) 1 passed (1.3m) |
| `test:e2e:ui` | exit=0 (49s) 1 passed (47.2s) |
| `test:e2e:activity` | exit=1 (48s) 1 failed |
| `test:e2e:import` | exit=0 (65s) 7 passed (1.1m) |
| `test:e2e:import-review` | exit=0 (95s) 10 passed (1.6m) |
| `test:e2e:ai` | exit=0 (45s) 2 passed (43.9s) |
| `test:e2e:ai-review` | exit=0 (104s) 11 passed (1.7m) |
| `test:e2e:evidence` | exit=1 (108s) 1 failed | 7 passed (1.8m) |
| `test:e2e:m2` | exit=0 (62s) 1 passed (1.0m) |
| `test:e2e:m3` | exit=0 (56s) 2 passed (54.6s) |
| `DONE` | DONE |

Ulang setelah gagal pada run pertama (flaky bawaan `activity-ui.spec.ts:356`, sama dengan catatan T18/M3): `test:e2e:activity` 1 passed, `test:e2e:evidence` 8 passed. `test:e2e:cv` diulang setelah menambah penyimpanan screenshot: 7 passed. `pnpm typecheck` dan `pnpm lint` exit 0 setelah perubahan terakhir. `git diff --check` dijalankan sebelum commit.

Tidak dijalankan: `test:e2e` gabungan, `test:ai:live`, uji stres race berskala, staging/production.

## Screenshot

`docs/verification/T19-screenshots/cv-360-light.png`, `cv-360-dark.png`, `cv-1440-light.png`, `cv-1440-dark.png` (Axe 0 pelanggaran A/AA pada keempatnya, tanpa overflow horizontal; preview di kanan pada 1440 px dan di bawah editor pada 360 px, diverifikasi lewat bounding box).

## Acceptance §1

| Poin | Bukti |
| --- | --- |
| 1 first open | integration graduate (3 ensure paralel, 1 CV), E2E graduate |
| 2, 3 selection, parent-child | unit markup, E2E graduate, integration outline |
| 4 move aksesibel | unit `computeItemMove`/markup, E2E keyboard (fokus, live region, disabled di tepi) |
| 5 locale CV | unit preview, E2E locale (UI dan profil tidak berubah) |
| 6, 7 override, summary/judul/contact | pgTAP 69, integration 1-2, E2E |
| 8 satu revision per batch | pgTAP, integration |
| 9 stale tidak menimpa | integration edit bersamaan (3 putaran, tanpa 40P01), unit `syncDraft`, E2E dua konteks (Keep mine, Use saved) |
| 10 parent removal | integration 4, E2E dialog + fokus |
| 11 preview dari saved | unit markup, E2E (preview tidak berubah sebelum Save) |
| 12 state | E2E/markup: empty, manual, deleted, unsaved, saved, conflict, error; loading.tsx (skeleton) |
| 13 Add to CV | E2E |
| 14 graduate journey | E2E + integration |
| 15 a11y/responsive | E2E Axe + bounding box + reduced motion |
| 16 tanpa regresi | tabel di atas |
| 17 log hygiene | integration 7 (sentinel), unit service/action, F2 ditutup; grep `console.` di `src/features/cv` tanpa hasil |

Belum terbukti sepenuhnya: perilaku interaktif tidak diuji di jsdom (tidak tersedia); dicakup E2E. Berikutnya: gate review Claude, lalu Fase 6.
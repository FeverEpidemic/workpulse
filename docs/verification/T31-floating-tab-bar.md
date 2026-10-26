# T31 Tab bar mobile mengambang: bukti acceptance

- Tanggal: 27 Oktober 2026
- Status: **DONE lokal**. Gate review Claude Opus 5.5 PASS tanpa P0-P2 ([gate review](T31-gate-review.md)).
- Pelaksana Fase 0-3: Claude Sonnet 5.5. Fase 4 dan closeout: Claude Opus 5.5.
- Keputusan: [decision 0041](../decisions/0041-t31-floating-tab-bar.md). Rencana: [T31-implementation-plan.md](T31-implementation-plan.md).
- Receipt: [Fase 0](T31-phase0-baseline.md), [Fase 1](T31-phase1-css.md), [Fase 2](T31-phase2-e2e.md), [Fase 3](T31-phase3-regression.md). Screenshot: `docs/verification/T31-screenshots/`.

## Penyimpangan dari plan

Gutter 8 px, bukan 12 px. Fase 0 berhenti di stop condition §8 karena label tebal "Dashboard" tidak muat di kapsul 336 px, dan pengguna memilih 8 px pada 26 Oktober 2026. Turunannya: kapsul 344 px di 360 px, `bottom` = tinggi viewport − 8, padding bawah `main` ≥ 72 px (plan menulis 76).

## Acceptance (§1 handoff)

| # | Poin | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | Kapsul expanded | PASS | E2E: left 8, right 352, bottom 632 di 360 × 640; border 1 px × 4; radius = `--radius-lg`; shadow ada; `backdrop-filter: none` |
| 2 | Kapsul compact | PASS | E2E: `data-compact="true"`, list 52 px, lebar 268 px, terpusat ≤ 1 px; kembali 344 px setelah scroll ke atas; tap di kapsul di luar tab mengembalikan expanded (lihat G2) |
| 3 | Animasi | PASS | Unit `floating-tab-bar-css.test.ts` dan E2E: kapsul `width` 0,18 s `cubic-bezier(0.2, 0, 0, 1)`; list `height`, `column-gap`, `padding` 0,18 s |
| 4 | Reduced motion | PASS | E2E: durasi ≤ 0,01 ms di kapsul, list, header, tab; compact tetap 268 px |
| 5 | Tap di gutter sampai ke konten | PASS | E2E `elementFromPoint(4, …)` di luar `.workspace-tab-bar`; klik-tembus Fase 3 membuka detail aktivitas |
| 6 | Label tidak terpotong | PASS (catatan G1) | E2E `scrollWidth ≤ clientWidth` untuk semua label, termasuk Dashboard aktif tebal (sisa 0,3 px) |
| 7 | Target sentuh | PASS | E2E: semua target ≥ 44 × 44 di expanded dan compact; jarak compact ≥ 8 px |
| 8 | Konten tidak tertutup | PASS | E2E di `/activity`, `/projects`, `/settings/profile`, `/dashboard`, detail proyek: kontrol terbawah di atas kapsul, padding ≥ 72, tanpa scroll horizontal; toast di atas kapsul |
| 9 | Tanpa regresi perilaku | PASS | `test:e2e:release` 43/43 (receipt dan run ulang reviewer); `ui`, `activity`, `m2` lulus di receipt Fase 3; unit T27 lulus |
| 10 | Aksesibilitas | PASS | Axe tanpa pelanggaran pada dashboard expanded dan compact, composer, Profile, Menu lainnya di 360 px light dan dark |

## Trace

- Design.md §4.3 (diperbarui), §28 (token motion), §31 (target 44 px), *Compact width* (+ tetap di bar).
- Decision 0035 #4 dan #7 (diganti sebagian oleh 0041), decision 0040 (token motion).
- PRD/Flow/DB: tidak ada perubahan; murni CSS satu komponen.

## Command

| Command | Exit | Hasil | Sumber |
| --- | --- | --- | --- |
| `pnpm lint` | 0 | bersih | receipt Fase 3, run ulang reviewer (`--ignore-pattern ".claude/**"`) |
| `pnpm typecheck` | 0 | bersih | receipt Fase 3, run ulang reviewer |
| `pnpm test` | 0 | 154 file, 1446 test | receipt Fase 3, run ulang reviewer |
| `pnpm build` | 0 | bersih | receipt Fase 3 |
| `pnpm test:e2e:ui` | 0 | 1 lulus | receipt Fase 3 |
| `pnpm test:e2e:release` | 0 | 43 lulus | receipt Fase 3 (8,8 menit), run ulang reviewer (8,9 menit) |
| `pnpm test:e2e:activity` | 0 | 1 lulus | receipt Fase 3 |
| `pnpm test:e2e:m2` | 0 | 1 lulus | receipt Fase 3 |
| `git diff --check f789e5b..8d1565f` | 0 | bersih | run ulang reviewer |
| Parity migration | - | 38/38 | receipt Fase 0 dan 3 |

Flaky: tidak ada. Log server `The destination stream closed early` muncul juga di baseline sebelum T31.

## Batas

- Hanya Chromium desktop dengan viewport diemulasi. Safe area, gestur sentuh, Safari, Firefox, staging, dan production belum diuji.
- Fase 4 hanya mengubah dokumen; tidak ada test yang diulang setelahnya.

## Follow-up P3

G1, G2, dan G3 ditutup 27 Oktober 2026: list expanded tanpa padding samping (ruang label Dashboard 1,9 px), E2E tap memeriksa lebar 344 px, dan border kuat di dark mode; unit 154 file / 1448 test dan `test:e2e:release` 43 lulus setelahnya. G4 (safe area di perangkat nyata) tetap terbuka. Rincian di [gate review](T31-gate-review.md).

# T20 CV freshness dan deletion — bukti acceptance

- Tanggal: 3 Oktober 2026
- Status: **DONE** (acceptance lokal; gate review tanpa P0–P2; closeout 3 Oktober 2026).
- Pelaksana: Claude Sonnet 5.5 (Fase 0–6); reviewer: Claude (Opus), gate review [`T20-gate-review.md`](T20-gate-review.md) dengan tujuh P3 (F1–F7) sebagai follow-up. Fase 7 (dokumen ini, decision 0026, README) ditulis reviewer.
- Trace: PRD R03 (*CV needs review*), R09, *CV freshness contract*, release scenario *edit a selected achievement after manual CV wording changes; refresh without losing the override; delete its source* (bagian freshness; blokir export = T21); F03 (edit/reopen/delete achievement terpilih), F07 langkah 5; S04 (check CV), S13 (state *changed source*, *manual override*, *deleted source*, *unconfirmed source*; Keep/Replace); DB §2 (profil), §5 (freshness, acknowledgement, deletion consistency), §6 (atomic delete + invalidasi CV, *simultaneous CV edits*). Decision [0026](../decisions/0026-t20-cv-freshness-deletion.md). Receipt [Fase 0](T20-phase0-baseline.md), [1](T20-phase1-database.md), [2](T20-phase2-domain.md), [3](T20-phase3-service-dashboard.md), [4](T20-phase4-ui.md), [5](T20-phase5-integration.md), [6](T20-phase6-browser-regression.md).

## Acceptance §1

| # | Poin | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | State item dari revision live; revision naik tanpa perubahan tampilan = fresh | PASS | pgTAP `cv_freshness` (metrics/skill link → fresh); unit `cv-freshness` |
| 2 | Edit sumber tidak menulis CV (enam tipe) | PASS | pgTAP fingerprint + revision; integration enam tipe (`cvFingerprint` sama) |
| 3 | Keep per revision live; edit kedua → changed tanpa write | PASS | pgTAP; integration release scenario; E2E (3) |
| 4 | Refresh mempertahankan override; parent baru ditambahkan | PASS | pgTAP; integration release scenario + konteks; E2E (2) |
| 5 | Replace eksplisit; tanpa override → `CV_RESOLUTION_INVALID` | PASS | pgTAP; integration; E2E (2) |
| 6 | Review basi ditolak tanpa write | PASS | pgTAP (`CV_SOURCE_CHANGED`, `STALE_REVISION`, `CV_RESOLUTION_INVALID`, `CV_SOURCE_INELIGIBLE`, input invalid); integration |
| 7 | Batch atomik, revision +1 | PASS | pgTAP; integration batch enam tipe |
| 8 | Profile freshness (tujuh field; locale/timezone fresh; keep/refresh/replace; commit import) | PASS | pgTAP (termasuk `commit_import_batch` nyata); integration; E2E (5) |
| 9 | Delete sumber = invalidasi + revision CV dalam transaksi delete (enam jalur) | PASS | pgTAP; integration release scenario; diff fungsi delete oleh reviewer (hanya sisipan yang diizinkan) |
| 10 | Reopen/dismiss → unconfirmed; konfirmasi ulang dengan perubahan → changed | PASS | pgTAP; integration. Konfirmasi ulang tanpa perubahan field tampilan → `fresh` sesuai keputusan §2.2.2 (isi CV sama); diuji eksplisit |
| 11 | Edit activity sumber (relink → changed; raw text dan delete activity → fresh) | PASS | integration konteks |
| 12 | Protokol lock tanpa deadlock (a)–(d) ×3 | PASS | integration *real concurrency* (pelaksana 3 run bersih; reviewer 1 run), tanpa `40P01`/`40001` |
| 13 | Dashboard dua check terpisah, angka cocok, tanpa CV | PASS | integration `createDashboardService`; unit `dashboard-view`; E2E (8) |
| 14 | UI S13 (badge, ringkasan, panel, aksi, bulk, draft memblokir, `CV_SOURCE_CHANGED` reload, preview dari saved) | PASS | unit `cv-builder-state`, `cv-builder-ui`; E2E (1)–(7). Fokus pada jalur gagal `CV_SOURCE_CHANGED` = P3 F1 |
| 15 | Ownership | PASS | pgTAP; integration (akun lain/ID acak → `NOT_FOUND` sama) |
| 16 | Aksesibilitas dan responsive | PASS | E2E Axe 0 serious/critical pada `/cv` (4 panel terbuka) dan `/dashboard`, 360/1440 × light/dark, tanpa overflow, keyboard, live region, reduced motion; screenshot di bawah. Tabel review 360 px kurang terbaca = P3 F2 |
| 17 | Tanpa perubahan perilaku lama | PASS | semua suite T02–T19, M2, M3 lulus; tiga penyesuaian suite lama adalah konsekuensi keputusan yang disetujui, tanpa pelemahan (gate F5, decision 0026 *Konsekuensi*); confirm tidak menambah item CV |
| 18 | Log hygiene; correlation ID; tanpa `console.` | PASS | integration sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>`; unit action; grep = 0 |

## Command (reviewer, HEAD `8b1d4e9`)

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint`, `typecheck`, `build`, `worker:check` | 0 | bersih |
| `pnpm test` | 0 | 89 file / 706 test (baseline 87 / 635) |
| `pnpm db:test` | 0 | 14 file / 1115 assertion (baseline 13 / 979) |
| `pnpm db:lint` / `db:types` | 0 | `results: []` / tanpa diff |
| `supabase migration list --local` | 0 | 30/30 |
| `supabase db diff --local --schema public,internal` | 0 | "No schema changes found" |
| `git diff --check cd239d7..HEAD` | 0 | bersih |
| `test:integration:cv-freshness` | 0 | 11/11 |
| `test:integration:` cv-builder, cv, achievements, projects, activity, dashboard, import-commit, import-review, import, m2, m3, ai, ai-review, evidence, storage | 0 | 7, 10, 5, 7, 6, 4, 11, 6, 21, 8, 7, 13, 21, 14, 1 |
| `test:e2e:cv-freshness` | 0 | 10 passed (dua run; run kedua menyimpan screenshot) |
| `test:e2e:` cv, achievements, projects, dashboard, auth, ui, activity, import, import-review, ai, ai-review, evidence, m2, m3 | 0 | 8, 4, 1, 1, 1, 1, 1, 7, 10, 2, 11, 8, 1, 2 |

## Screenshot

`T20-screenshots/` (data fixture saja, tanpa sentinel): `cv-review-{360,1440}-{light,dark}.png` (ringkasan *4 items need review*, panel profil, item changed/deleted/unconfirmed dengan panel terbuka) dan `dashboard-cv-{360,1440}-{light,dark}.png` (check *4 CV items need review*). Full-page capture menampilkan sidebar/header fixed di tengah halaman; itu artefak screenshot, bukan tata letak.

## Flaky, tidak dijalankan, batas

- **Flaky:** tidak ada pada run reviewer. Pelaksana mencatat satu unhandled rejection dari desain test integration (diperbaiki sebelum commit).
- **Tidak dijalankan:** `test:e2e` gabungan, `test:ai:live` (T20 tanpa AI), stres race berskala, pengukuran performa freshness (T24, gate F6), staging/production.
- **Follow-up P3:** F1 fokus setelah `CV_SOURCE_CHANGED`, F2 tabel review 360 px, F3 copy unconfirmed/parentAdded, F4 assertion ganda M2, F6 biaya baca freshness.
- **Batas:** bukti lokal saja. Validasi/request export dan blokir export memakai `internal.cv_item_state`/`cv_profile_state` = T21; S14 dan tautan blokir ke `/cv#cv-review` = T22.

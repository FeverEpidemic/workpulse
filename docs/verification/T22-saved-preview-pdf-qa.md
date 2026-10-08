# T22 — Saved preview dan PDF QA: bukti acceptance lokal

## Ringkasan

- **Tanggal:** 8 Oktober 2026.
- **Status:** **DONE (acceptance lokal)**. Seluruh 18 poin acceptance §1 handoff terbukti lokal.
- **Pelaksana:** Claude Sonnet 5.5, Fase 0–7.
- **Gate review:** Claude (Opus) pada HEAD `d68ad3e`.
  - Menemukan satu P2 (RV1: entry yang lebih tinggi dari satu halaman meninggalkan halaman kosong) dan delapan P3 (N1–N8).
  - RV1 diperbaiki reviewer di `369b016` atas instruksi pengguna.
  - Review ulang lulus tanpa P0–P2. Review ulang ini tidak independen penuh karena reviewer juga mengerjakan perbaikannya.
- **Fase 8** ditulis reviewer.
- **Rujukan:** R10, F07 langkah 4–6, S14, DB §5 `cv_exports`. Decision `docs/decisions/0028-t22-saved-preview-pdf-qa.md`.

Dokumen terkait:

- Rencana: `T22-implementation-plan.md`.
- Gate review dan remediasi: `T22-review-remediation-plan.md`.
- Receipt: `T22-phase0-baseline.md`, `T22-phase1-domain.md`, `T22-phase2-storage-route.md`, `T22-phase3-s14-ui.md`, `T22-phase4-pdf-qa.md`, `T22-phase5-integration.md`, `T22-phase6-browser.md`, `T22-phase7-regression.md`, dan `T22-phase7b-remediation.md`.

## Trace ke sumber

| Sumber | Kebutuhan | Bukti |
| --- | --- | --- |
| PRD R10 | Revision tersimpan sebagai teks A4 yang dapat dicari dengan page break benar; gagal mempertahankan draft dan dapat di-retry; tanpa evidence | §1.2, §1.8, §1.10–§1.14; `test:pdf` 46; E2E skenario 2, 6, dan 12 |
| PRD *CV freshness contract* | Sumber deleted/unconfirmed memblokir export; PDF yang sudah diunduh tidak berubah | §1.4; integration skenario blocker; E2E skenario 4–5; snapshot T21 immutable |
| PRD release scenarios | Graduate mengekspor CV yang berguna; hapus sumber → terblokir sampai diselesaikan; ekstraksi teks, Indonesia, bullet panjang, multipage | E2E 2 dan 4; `test:pdf` (fixture graduate, Indonesia, 38 bullet panjang, 8–9 halaman) |
| User Flow F07 langkah 4–6 | Simpan lalu buka S14 di revision persis; validasi; review di S13; job terikat snapshot; Download/Retry; edit tidak mengubah export berjalan | §1.2–§1.8; E2E 2, 3, 5, 6, dan 9 |
| Wireframe S14 | Snapshot persis, batas dan navigasi halaman, status export, blocker dengan tautan ke S13, unduhan 24 jam lewat URL pendek, *Regenerate* saat kedaluwarsa | §1.4–§1.9; E2E 2, 7, dan 8 |
| DB §5 `cv_exports` | Unduhan owner-authorized dan kedaluwarsa | §1.7 dan §1.16; integration Fase 2/5; E2E 10 |

## Acceptance §1

| # | Poin | Status | Bukti |
| ---: | --- | --- | --- |
| 1 | Route dan akses | PASS | E2E 1: anonim → `/sign-in?returnTo=%2Fcv%2Fpreview` dan kembali; tanpa CV → empty state, `cv_documents` tetap 0; nav *CV* aktif; route anonim 401. Unit `safe-return` |
| 2 | Revision tersimpan persis | PASS | E2E 2 (`Saved revision N` dari DB), E2E 3 (draft tidak tampil), E2E 9 (dua tab: notice `stale` + *Reload*, 0 export baru); unit state |
| 3 | Entry dari S13 | PASS | Unit `previewLinkState`; E2E 2 dan 3 (tombol `aria-disabled` dengan alasan *Save your changes first.* via `aria-describedby`) |
| 4 | Blocker dengan tautan | PASS | Unit `blockerLink` (semua kode); integration skenario 6 (`ITEM_DELETED` + `item_id`, request ditolak tanpa job); E2E 4 (release delete → tautan `/cv#cv-item-<id>` → Remove → siap) dan E2E 5 (`ITEM_CHANGED` → Keep saved wording) |
| 5 | Request eksplisit dan status | PASS | Unit polling/klasifikasi; integration skenario 1 (`queued` → `running` → `succeeded`) dan 4 (klik ganda → satu export); E2E 2 (live region `role="status"`, fokus ke status) |
| 6 | Halaman PDF nyata | PASS (P3 N2) | E2E 2 (*Page 1 of N*, N = `page_count`, piksel tidak kosong, tinta di dalam margin), E2E 8 (gagal muat → *Try again*, Download tetap aktif), E2E 12 (setiap halaman digambar penuh). Satu canvas untuk halaman aktif, bukan tumpukan |
| 7 | Unduhan | PASS | Integration Fase 2 (`content-disposition` `WorkPulse-CV-<date>.pdf`, `inline` tanpa attachment + ACAO, klaim `exp` ≤ 305 detik, akun lain/acak → `EXPORT_NOT_FOUND`) dan Fase 5 (hash byte = objek tersimpan); E2E 2 (event download, nama, isi `%PDF-`, HTML awal tanpa `token=`) |
| 8 | Retry vs Regenerate | PASS | Unit `cv-export-view` (29 test, termasuk matriks `exportActions`); integration skenario 2, 3, dan 5; E2E 6 (gagal → hanya Retry → sukses; edit → hanya Regenerate) dan E2E 7 (kedaluwarsa → Regenerate → export baru) |
| 9 | Riwayat ringkas | PASS | Unit `listExports(5)`; render statis lima baris dan *Earlier revision*; E2E 6 dan 7 (dua baris, aksi per baris) |
| 10 | Ekstraksi cocok snapshot | PASS | `test:pdf`: lima fixture, string model berurutan dengan sisa kosong; tanpa evidence, `credential_url`, UUID, object key, atau placeholder tanggal; override menggantikan sumber |
| 11 | Page break | PASS (sesudah RV1) | Sapuan 60 varian: 0 heading yatim, 0 entry terbelah (`headingsNearBottom=71`, `headingsPushedToNextPage=102`). CV multipage: bullet utuh. RV1: celah halaman ≤ child terpanjang + 72 pt, sapuan kepala 36 varian, dan hanya entry > 751 pt yang ditandai. Mutasi Fase 4 dan 7b membuktikan kekuatan suite |
| 12 | Tanpa clipping dan A4 | PASS | `test:pdf`: setiap halaman 594,96 × 841,92 pt, setiap item di dalam margin ± 2 pt, font tidak diskalakan; token 150 karakter terbungkus (`overflow-wrap: anywhere`); multipage 1 < n ≤ 20 |
| 13 | Inspeksi halaman hasil render | PASS | Screenshot `pdf-{en,id}-page-{1..8}.png` sesudah RV1. Reviewer membuka `pdf-en-page-1`, `pdf-en-page-2`, `pdf-id-page-7`, dan `pdf-id-page-9` sebelum perbaikan (halaman 1 hanya nama), lalu `pdf-en-page-1`, `pdf-id-page-6`, dan `pdf-id-page-8` sesudahnya: halaman 1 kini memuat awal project. Pelaksana membuka 18 gambar versi sebelum perbaikan (F1 = RV1) |
| 14 | Unicode (N4) | PASS (batas dicatat) | `test:pdf`: `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”`, `Ç Ñ ś ñ`, kutip melengkung, dan nama Latin berdiakritik cocok setelah NFKC. Han/Arab/Devanagari terender dan lolos `exportTextShowsName`, tetapi `forwardMatch=false` (decision 0028 poin 13) |
| 15 | Aksesibilitas dan responsive | PASS (P3 N6) | E2E 11: Axe tanpa pelanggaran WCAG A/AA (lebih ketat dari serious/critical) pada enam keadaan × 360/1440 × terang/gelap, tanpa overflow horizontal; outline fokus, Enter mengantre, status `aria-live`; reduced motion → transisi 0 s. Retry/Regenerate/Download diklik dengan pointer |
| 16 | Owner dan privasi | PASS | Integration Fase 2 (404 identik, tanpa body sensitif, sentinel tidak bocor); E2E 10 (akun B: status/route/unduhan export A → 404/`EXPORT_NOT_FOUND`; sentinel tidak ada di respons, halaman, dan konsol B) |
| 17 | Tanpa perubahan perilaku lama | PASS | `git diff fe64466 -- supabase workers pnpm-lock.yaml` kosong; adapter storage aditif (pemanggil tanpa opsi tetap dua argumen); E2E evidence 8, m2 1, m3 2; regresi Fase 7 lengkap |
| 18 | Log hygiene | PASS | grep `console.` pada `src/features/cv`, `src/app/(workspace)/cv`, `src/app/api/cv`, `src/domain/cv`, `src/server/export` = 0; error UI memakai kode + correlation ID |

## Command dan hasil

### Reviewer

Dijalankan 8 Oktober 2026. Docker hidup, parity migration 31/31, dan `workpulse-t21-pdf`, Gotenberg T15, serta ClamAV T10 berjalan. Env dimuat per proses: `.env.local`, `SERVICE_ROLE_KEY` sebagai `SUPABASE_SECRET_KEY` di env proses saja, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`, dan `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan.

| Command | HEAD | Exit | Hasil |
| --- | --- | ---: | --- |
| `pnpm exec supabase migration list --local` | `d68ad3e` | 0 | 31/31 |
| `pnpm db:test` | `d68ad3e` | 0 | 15 file / 1290 assertion |
| `pnpm db:lint` | `d68ad3e` | 0 | bersih |
| `pnpm test:integration:storage` | `d68ad3e` | 0 | 1 / 1 |
| `pnpm test:integration:evidence` | `d68ad3e` | 0 | 3 / 14 |
| `pnpm test:integration:cv-freshness` | `d68ad3e` | 0 | 1 / 11 |
| `pnpm test:integration:cv-builder` | `d68ad3e` | 0 | 1 / 7 |
| `pnpm test:e2e:cv` | `d68ad3e` | 0 | 8 passed |
| `pnpm test:e2e:cv-freshness` | `d68ad3e` | 0 | 10 passed |
| `pnpm test:e2e:evidence` | `d68ad3e` | 0 | 8 passed |
| `pnpm test:e2e:m2` | `d68ad3e` | 0 | 1 passed |
| `pnpm test:e2e:m3` | `d68ad3e` | 0 | 2 passed |
| `pnpm test:pdf` (template lama, test RV1 baru) | `93174e8` | 1 | 9 gagal / 36 lulus (bukti RED RV1) |
| `pnpm lint` | `369b016` | 0 | lulus |
| `pnpm typecheck` | `369b016` | 0 | lulus |
| `pnpm test` | `369b016` | 0 | 103 file / **956 test** |
| `pnpm worker:check` | `369b016` | 0 | lulus |
| `pnpm build` | `369b016` | 0 | `ƒ /cv/preview`, `ƒ /api/cv/exports/[id]` |
| `pnpm test:pdf` | `369b016` | 0 | 1 file / **46 test** |
| `pnpm test:integration:cv-export` | `369b016` | 0 | 3 file / **35 test** |
| `pnpm test:e2e:cv-export` | `369b016` | 0 | **12 passed** |
| `git diff --check` | `369b016` | 0 | bersih |

Pada `d68ad3e`, reviewer juga menjalankan lint, typecheck, unit (954), worker:check, build, `test:pdf` (36), `test:integration:cv-export` (35), dan `test:e2e:cv-export` (12); semuanya exit 0.

### Pelaksana (Fase 7, `80f552b`)

Seluruh daftar §7 handoff dijalankan dan exit 0, kecuali flaky bawaan:

- 17 suite integration, 187 test;
- 16 suite E2E, 80 test;
- unit 103/954, pgTAP 15/1290, `test:pdf` 36.

Detail per command ada di `T22-phase7-regression.md`. Reviewer tidak mengulang suite domain yang tidak disentuh T22; untuk suite itu berlaku hasil pelaksana.

## Flaky

`activity-ui.spec.ts:356` (`pnpm test:e2e:activity`) gagal pada run regresi pelaksana, lalu lulus 3 dari 5 percobaan ulang tanpa perubahan (P3 N7). Suite itu tidak menyentuh `/cv/preview` atau route export. Tingkat flake pada baseline tidak diukur.

## Tidak dijalankan

- `test:e2e` gabungan.
- `test:ai:live` (T22 tanpa AI).
- p95 render dan performa S14 (T24).
- Staging/production dan isolasi jaringan renderer (T25).
- Setelah perbaikan RV1, suite domain lain tidak diulang, karena RV1 hanya menyentuh template cetak dan test PDF.

## Screenshot

Semua screenshot ada di `docs/verification/T22-screenshots/` dan hanya memuat data fixture tanpa sentinel.

- **Halaman PDF.** `pdf-en-page-1..8.png` dan `pdf-id-page-1..8.png`: CV panjang 12 achievement standalone dan 24 achievement di satu project, dirender Chromium nyata lalu digambar canvas S14 sesudah RV1.
- **Keadaan S14.** `s14-<state>-<360|1440>-<light|dark>.png` untuk enam keadaan (`blocked`, `ready`, `running`, `succeeded`, `failed`, `expired`), total 24 file.

## Batas lingkungan

Bukti lokal saja: Supabase lokal, renderer container lokal, dan Playwright Chromium. Keadaan `running` di E2E diperoleh dengan memindahkan export ke `running` lewat SQL admin, karena worker selesai terlalu cepat untuk ditangkap. Keadaan `failed` memakai mode renderer `unavailable`, yang melewati jalur kode produksi yang sama. Ini bukan bukti production.

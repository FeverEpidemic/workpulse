# T22 Fase 7 — Regresi penuh

- Tanggal: 8 Oktober 2026
- Pelaksana: Claude Sonnet 5.5
- HEAD yang diuji: `80f552b` (Fase 6); semua file produksi sama dengan HEAD receipt ini.
- Status: **selesai**. Seluruh perintah §7 plan dijalankan. Semua lulus, kecuali satu suite E2E yang flaky bawaan (`activity-ui.spec.ts:356`), yang lulus saat diulang tanpa perubahan.
- Lingkungan: Docker Desktop + Supabase lokal, parity migration 31/31, container `workpulse-t21-pdf` (13401), `workpulse-t15-gotenberg` (13400), dan `workpulse-t10-clamav` (13310) hidup selama run. `.env.local` dimuat per proses, `SERVICE_ROLE_KEY` hanya di env proses sebagai `SUPABASE_SECRET_KEY`, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`, `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan untuk seluruh run (termasuk `test:e2e:m2` dan `test:e2e:m3`, tanpa melemahkan assertion env).

## 1. Hasil per command

Dijalankan berurutan oleh satu skrip (log per command di luar repo), tanpa pipe ke `Select-Object -First`:

| Command | Exit | Detik | Hasil aktual |
| --- | ---: | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | 1 | Already up to date |
| `pnpm lint` | 0 | 22 | lulus |
| `pnpm typecheck` | 0 | 5 | lulus |
| `pnpm test` | 0 | 36 | files 103 passed (103); tests 954 passed (954) |
| `pnpm db:test` | 0 | 12 | pgTAP files=15 tests=1290; pgTAP PASS |
| `pnpm db:lint` | 0 | 1 | tanpa error schema |
| `pnpm test:pdf` | 0 | 19 | files 1 passed (1); tests 36 passed (36) |
| `pnpm test:integration:cv-export` | 0 | 163 | files 3 passed (3); tests 35 passed (35) |
| `pnpm test:integration:cv-freshness` | 0 | 38 | files 1 passed (1); tests 11 passed (11) |
| `pnpm test:integration:cv-builder` | 0 | 13 | files 1 passed (1); tests 7 passed (7) |
| `pnpm test:integration:cv` | 0 | 21 | files 1 passed (1); tests 10 passed (10) |
| `pnpm test:integration:achievements` | 0 | 12 | files 1 passed (1); tests 5 passed (5) |
| `pnpm test:integration:projects` | 0 | 8 | files 1 passed (1); tests 7 passed (7) |
| `pnpm test:integration:activity` | 0 | 5 | files 1 passed (1); tests 6 passed (6) |
| `pnpm test:integration:dashboard` | 0 | 9 | files 1 passed (1); tests 4 passed (4) |
| `pnpm test:integration:import-commit` | 0 | 14 | files 1 passed (1); tests 11 passed (11) |
| `pnpm test:integration:import-review` | 0 | 7 | files 1 passed (1); tests 6 passed (6) |
| `pnpm test:integration:import` | 0 | 25 | files 2 passed (2); tests 21 passed (21) |
| `pnpm test:integration:m2` | 0 | 22 | files 1 passed (1); tests 8 passed (8) |
| `pnpm test:integration:m3` | 0 | 17 | files 1 passed (1); tests 7 passed (7) |
| `pnpm test:integration:ai` | 0 | 12 | files 1 passed (1); tests 13 passed (13) |
| `pnpm test:integration:ai-review` | 0 | 18 | files 1 passed (1); tests 21 passed (21) |
| `pnpm test:integration:evidence` | 0 | 15 | files 3 passed (3); tests 14 passed (14) |
| `pnpm test:integration:storage` | 0 | 6 | files 1 passed (1); tests 1 passed (1) |
| `pnpm test:e2e:cv-export` | 0 | 140 | 12 passed (2.3m) |
| `pnpm test:e2e:cv-freshness` | 0 | 73 | 10 passed (1.2m) |
| `pnpm test:e2e:cv` | 0 | 58 | 8 passed (56.7s) |
| `pnpm test:e2e:achievements` | 0 | 56 | 4 passed (54.8s) |
| `pnpm test:e2e:projects` | 0 | 34 | 1 passed (33.4s) |
| `pnpm test:e2e:dashboard` | 0 | 38 | 1 passed (37.1s) |
| `pnpm test:e2e:auth` | 0 | 54 | 1 passed (52.4s) |
| `pnpm test:e2e:ui` | 0 | 37 | 1 passed (35.6s) |
| `pnpm test:e2e:activity` | 1 | 42 | 1 failed (flaky `activity-ui.spec.ts:356`, lihat di bawah) |
| `pnpm test:e2e:import` | 0 | 56 | 7 passed (54.7s) |
| `pnpm test:e2e:import-review` | 0 | 77 | 10 passed (1.3m) |
| `pnpm test:e2e:ai` | 0 | 35 | 2 passed (34.2s) |
| `pnpm test:e2e:ai-review` | 0 | 88 | 11 passed (1.4m) |
| `pnpm test:e2e:evidence` | 0 | 99 | 8 passed (1.6m) |
| `pnpm test:e2e:m2` | 0 | 50 | 1 passed (48.7s) |
| `pnpm test:e2e:m3` | 0 | 47 | 2 passed (45.5s) |
| `pnpm worker:check` | 0 | 1 | worker ready |
| `pnpm build` | 0 | 21 | compiled |

Pemeriksaan tambahan di luar skrip:

| Check | Hasil |
| --- | --- |
| `pnpm exec supabase migration list --local` | **31/31** (`local == remote` pada 31 migration; terakhir `20261005090000_t21_cv_export_backend.sql`) |
| `git diff --check` (working tree) dan `git diff --check fe64466..HEAD` | exit 0 / exit 0 |

### Ringkasan angka

- **Unit:** 103 file / **954 test** (baseline Fase 0: 98 / 845; +5 file, +109 test: `cv-export-view` 29, `cv-export-page-state` 29, `cv-export-page-ui` 17, `storage-download-options` 10, `cv-export-status-route` 8, dan tambahan pada `cv-export-service` 9, `cv-export-actions` 3, `cv-export-i18n` 3, `cv-print-template` 1).
- **pgTAP:** 15 file / 1.290 assertion (tidak berubah; tanpa migration).
- **PDF QA nyata:** 1 file / 36 test.
- **Integration:** 17 suite, **187 test**, semua lulus.
- **E2E:** 16 suite, **80 test**, termasuk 12 skenario `cv-export` baru. Pada run regresi 79 lulus; satu test (`activity-ui`, suite Activity) gagal karena flaky bawaan dan lulus pada tiga dari lima percobaan ulang (di bawah).

### Flaky bawaan `activity-ui.spec.ts:356`

`pnpm test:e2e:activity` gagal pada run regresi dengan assertion yang dicatat plan: `expect(page).toHaveURL(url.searchParams.get("project") === projectId)`; URL yang diterima `/activity?from=2024-04-01&to=2024-04-01` (filter project belum terpasang). Diulang tanpa perubahan apa pun: percobaan berturut-turut **gagal, gagal, lulus, lulus, lulus** (5 percobaan, 3 lulus, assertion dan baris yang sama saat gagal). Dicatat sebagai **flaky bawaan**, bukan regresi T22: suite itu tidak membuka `/cv/preview` atau route export; satu-satunya kode T22 yang berada di jalur berbagi adalah pola `/cv/preview` pada `sanitizeReturnTo` yang tidak dipakai alur Activity. Saya tidak mengukur ulang tingkat flake ini pada `fe64466`; plan §7 sudah mendokumentasikannya sebagai flaky yang diketahui. Reviewer dapat menilai apakah tingkat gagal 2 dari 5 masih dapat diterima.

## 2. Diff dan hygiene

| Check | Hasil |
| --- | --- |
| `git diff fe64466 -- supabase/migrations` | **kosong** (tidak ada migration); `git diff fe64466 -- supabase workers` kosong (RPC T18–T21 dan worker export tidak diubah) |
| Dependency | `package.json` hanya menambah tiga script (`test:pdf`, `test:e2e:cv-export`, file baru pada `test:integration:cv-export`); `pnpm-lock.yaml` tidak berubah; tidak ada dependency atau aset biner baru (screenshot PNG adalah artefak bukti di `docs/verification/T22-screenshots/`) |
| `console.` pada `src/features/cv`, `src/app/(workspace)/cv`, `src/app/api/cv`, `src/domain/cv`, `src/server/export` | **0** |
| Dokumen authoritative | `docs/IMPLEMENTATION_STATUS.md`, `README.md`, `AGENTS.md`, `Design.md` tidak tersentuh sejak `3e3051f` |
| Perubahan `tests/` lama | dua assertion T21 diperluas (opsi unduhan, Fase 2, §5 receipt Fase 2) dan blok baru pada `cv-export-i18n.test.ts`, `cv-export-service.test.ts`, `cv-export-actions.test.ts`, `cv-print-template.test.ts`; tidak ada assertion yang dilemahkan |

### File yang berubah di luar tabel §4 plan (semuanya tercatat di receipt fase masing-masing)

| File | Alasan |
| --- | --- |
| `src/domain/routes/safe-return.ts` | `/cv/preview` sebagai `returnTo` yang aman (acceptance §1.1, temuan G1 Fase 0) |
| `src/features/cv/cv-panels.tsx` | `id="cv-profile"` (anchor `NAME_REQUIRED`); plan menyebut builder/preview, panel profil ada di file ini |
| `src/features/cv/cv-export-page-state.ts` | modul state murni S14 (plan §3.3 menyebut test `cv-export-page-state`, bukan nama modulnya) |
| `src/features/cv/pdfjs-build.d.ts` | shim tipe `pdfjs-dist/build/pdf.mjs` (G2) |
| `tests/unit/storage-download-options.test.ts`, `tests/unit/cv-export-status-route.test.ts`, `tests/unit/cv-export-page-ui.test.tsx` | test tambahan (test storage lama tidak diubah sesuai §3.2; route dan render statis S14) |

File di dalam §4 yang diubah di luar daftar "Modify": `src/features/cv/cv-builder-state.ts` (`previewLinkState`, dibolehkan stop condition §8), `src/server/export/cv-print-template.ts` dan `tests/unit/cv-print-template.test.ts` (satu aturan `overflow-wrap`, dibolehkan §2.2.11 dan dibuktikan §1.11).

## 3. Stop condition §8

Tidak ada yang terpicu: tidak ada migration, perubahan RPC/worker, dependency, auto-export, AI, atau evidence di PDF; renderer tidak jatuh ke fake pada suite nyata (suite gagal keras bila tidak terjangkau; Docker restart tiga kali selama sesi dan container dinyalakan kembali dengan `docker start`); tidak ada sentinel yang bocor; tidak ada suite lama yang dilemahkan. Catatan lingkungan awal (rentang port yang dicadangkan Windows) dicatat di receipt Fase 0 dan diselesaikan pengguna.

## 4. Serah-terima ke reviewer

Gate review Claude (Opus) atas Fase 0–7 dapat dimulai. Yang perlu perhatian:

1. **F1 (receipt Fase 6 §5):** halaman sebelum entry yang lebih panjang dari satu halaman menyisakan ruang kosong (halaman 1 hampir kosong pada fixture E2E; 436 pt atau 58% pada fixture QA). Tidak diperbaiki karena memerlukan logika di luar aturan break/spacing; opsi (a) terima sebagai P3, (b) kelas `entry-flow` untuk entry panjang.
2. Penyimpangan desain di Fase 3: halaman PDF ditampilkan satu per satu (bukan satu canvas per halaman dengan render aktif ± 1).
3. Retry tidak memeriksa readiness (aturan plan dan backend; pelindungnya adalah syarat revision tersimpan, N2).
4. Flaky bawaan `activity-ui.spec.ts:356` (2 dari 5 percobaan gagal).
5. Fase 8 (decision 0028, dokumen verifikasi, README) belum dikerjakan dan T22 belum ditandai DONE, sesuai instruksi.

## 5. Acceptance §1 yang belum terbukti sepenuhnya

| Poin | Status |
| --- | --- |
| §1.9 lima export terbaru di browser | dibuktikan dengan dua baris di E2E dan lima baris di render statis; batas lima pada query `listExports(5)` dibuktikan unit |
| §1.15 "Seluruh aksi dapat dijalankan dengan keyboard" | dibuktikan untuk Export, Next page, Save, tautan S13, dan Add; Retry, Regenerate, dan Download dijalankan dengan klik (tombol standar yang dapat difokuskan, tanpa jalur khusus pointer) |
| §1.15 fokus kembali setelah aksi | status mendapat fokus setelah request, notice setelah galat/konflik; setelah unduhan fokus tetap di tombol |
| Pengamatan produksi (renderer, jaringan, deployment) | di luar scope (T23–T25); semua bukti lokal |
| Tingkat flake `activity-ui.spec.ts:356` pada baseline | tidak diukur ulang |

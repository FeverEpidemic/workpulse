# T25 Release handoff WorkPulse v0.1

- Tanggal: 11 Oktober 2026.
- Status: **DONE** (20 Oktober 2026). Semua bukti lokal lulus, staging terverifikasi pada 16-20 Oktober 2026, dan p95 hosted dikecualikan oleh pemilik produk ([decision 0034](../decisions/0034-t25-staging-closeout.md), [review penutupan](T25-closeout-review.md)). Status 11 Oktober adalah **PARTIAL**: staging BLOCKED dan retensi backup belum terverifikasi.
- Bagian di bawah adalah laporan stack lokal 11 Oktober, kecuali baris 17 dan 18 yang diperbarui 20 Oktober. **Hasil lokal dan staging bukan bukti production.**
- Pelaksana Fase 0–8: Claude Sonnet 5.5. Gate review, remediasi RV1, dan Fase 9: Claude (Opus).
- HEAD terverifikasi: `617cae3` (perbaikan RV1) di atas regresi Fase 8 `4574d9a`.
- Keputusan: [decision 0031](../decisions/0031-t25-release-handoff.md). Detail per baris: [matriks](T25-release-matrix.md). Operator: [runbook](T25-release-runbook.md), [checklist](T25-release-checklist.md).

## 1. Acceptance §1 per poin

| # | Poin | Status | Bukti |
| --- | --- | --- | --- |
| 1 | Matriks R01–R10 tertelusur | **PASS** | [matriks](T25-release-matrix.md) bagian 1, 6, 7; reviewer mencocokkan enam nama test sampel dengan source |
| 2 | Enam skenario rilis | **PASS** (skenario 2 dan 3 lewat rangkaian test) | matriks bagian 2; regresi Fase 8 |
| 3 | Katalog database aman | **PASS** | `release_catalog.test.sql`: 8 aturan, 11 probe pelanggar, kontrol negatif; `pnpm db:test` 20 file / 1638 assertion |
| 4 | Isolasi dua akun per tabel | **PASS** | `release-ownership.test.ts`: 18 tabel dari katalog (cocok dengan query reviewer); select 0 baris, update/delete/insert ditolak, fingerprint A utuh |
| 5 | Isolasi RPC | **PASS** | 47 parameter pada 36 RPC: ID asing = ID acak; daftar dari katalog |
| 6 | Isolasi storage dan worker | **PASS** | 5 objek A × `authenticated`/`anon` ditolak; 3 route: ID asing = ID acak (404); 60 RPC worker ditolak untuk `authenticated` dan `anon` |
| 7 | Kontras token | **PASS** | `theme-contrast.test.ts` 37 pasangan dua tema; reviewer menghitung ulang 10 pasangan dengan `contrast-check.py` |
| 8 | Matriks aksesibilitas dan layout | **PASS** | `test:e2e:release`: 20 keadaan layar × 360/1440 × light/dark + 8 tampilan id, Axe bersih, tanpa overflow; 88 screenshot di `T25-screenshots/` |
| 9 | Keyboard dan focus | **PASS** | `release-keyboard.spec.ts`: journey sign-in → preview, empat dialog, ring ≥ 3:1 |
| 10 | Teks 200% | **PASS** | S04, S05, S08, S13 pada 720/360/320 px, setelah D11/D12 |
| 11 | Proxy screen reader + manual | **WARNING** | snapshot aria S04, S05, S08, S13, S14 terkunci (lulus juga pada checkout CRLF setelah RV1); **NVDA nyata belum dijalankan** |
| 12 | Kalimat event S12 | **PASS** | unit i18n en/id, E2E S12, Delivery Gate antislop |
| 13 | Health operasional | **PASS** | `operational_health.test.sql` 35 assertion; `ops-check.test.ts`; run nyata exit 0, dan exit 1 untuk env tidak valid, backend tidak terjangkau, key salah |
| 14 | Clean migration rebuild | **PASS** | Fase 5: 36 migration dari nol di stack sekali pakai, pgTAP 20/1638, tipe identik byte demi byte, stack aktif utuh |
| 15 | Production build | **PASS** | `pnpm build`, `/api/health` 200 `no-store`, `worker:check` dua konfigurasi |
| 16 | Runbook dan checklist | **PASS** | `release-docs.test.ts` (paritas env, ambang = kode, BLOCKER tidak bercentang); runbook §3 dilengkapi untuk konfigurasi Auth hosted dan pemeriksaan bucket (N7) |
| 17 | Backup dan restore jujur | **PASS (staging)** | prosedur restore terbukti lokal (`release-restore.test.ts`) dan pada salinan staging (17 Oktober); backup `pg_dump` harian dengan dua run cron dan uji prune (20 Oktober). Retensi production tetap BLOCKER |
| 18 | Staging | **PASS dengan pengecualian** | [Fase 7](T25-phase7-staging.md): migrasi, Auth email, scanner, renderer, export, penghapusan, `ops:check`; p95 hosted ditunda pemilik produk (BLOCKER) |
| 19 | Tanpa regresi | **PASS** | [Fase 8](T25-phase8-regression.md): 52 command lulus; reviewer mengulang sampel di worktree bersih |
| 20 | Privasi output | **PASS** | grep Fase 8 nihil; golden aria tanpa email, id, atau sentinel; email di-mask di screenshot; keluaran `ops:check` hanya nama metrik, angka, ambang |

## 2. Trace R01–R10

| ID | Status | Suite utama |
| --- | --- | --- |
| R01 auth dan sesi | tercakup | `e2e/auth-profile.spec.ts`, unit recovery/auth |
| R01 isolasi akun | tercakup | `release_catalog.test.sql`, `release-ownership.test.ts`, suite isolasi per domain |
| R02 import | tercakup | `import-commit`, `import-staging`, `e2e/import-review.spec.ts` |
| R03 dashboard | tercakup | `dashboard-timeline`, `cv-freshness` |
| R04 capture | tercakup | `activity-persistence`, `ai-jobs` 1, `e2e/activity-ui.spec.ts` |
| R05 AI | tercakup | `ai-review`, `ai-jobs`, `e2e/ai-review.spec.ts` |
| R06 project | tercakup | `project-context`, `m2-cross-domain`, `e2e/projects-ui.spec.ts` |
| R07 evidence | tercakup | `evidence-backend`, `evidence-pipeline`, `private-storage`, `e2e/evidence-api.spec.ts` |
| R08 timeline | tercakup | `dashboard-timeline`, unit timeline/partial-date |
| R09 CV builder | tercakup | `cv-selection`, `cv-builder`, `cv-freshness`, E2E S13 |
| R10 export | tercakup | `cv-export`, `cv-export-renderer-real`, `test:pdf`, `m4-cv-output`, E2E S14 |

Semuanya dijalankan ulang di Fase 8 terhadap stack lokal. Nama test lengkap ada di matriks bagian 1.

## 3. Enam skenario rilis PRD

| # | Skenario | Status |
| --- | --- | --- |
| 1 | Import CV Indonesia, masa kerja tumpang tindih, konfirmasi sekali, retry tanpa duplikat | tercakup |
| 2 | Graduate tanpa CV dan employment sampai export | tercakup (rangkaian test) |
| 3 | Note saat AI unavailable, edit, retry, output basi tidak menimpa | tercakup (rangkaian test) |
| 4 | Dua upload di batas kuota, hapus, URL ≤ 5 menit | tercakup |
| 5 | Edit achievement terpilih setelah override, refresh, hapus sumber, export terblokir | tercakup |
| 6 | Kepemilikan setiap tabel dan path, PDF Indonesia multipage | tercakup (T25 menutup bagian kepemilikan lewat katalog) |

## 4. PRD §4

| Area | Status |
| --- | --- |
| Privacy | tercakup lokal: isolasi berbasis katalog, bundle browser tanpa rahasia server |
| AI disclosure | tercakup |
| File safety | tercakup lokal dengan ClamAV nyata; scanner di host belum diverifikasi (BLOCKER) |
| Data minimization | tercakup lokal; purge ≤ 24 jam di hosted dipantau `ops:check` setelah deploy |
| Failures | tercakup |
| Performance | tercakup lokal (p95 baca ≤ 192,1 ms, simpan ≤ 130,6 ms; target 2 s / 1 s); **hosted belum diukur** |
| Usability | tercakup otomatis; NVDA nyata belum dijalankan |
| Deletion | sebagian: mekanisme ≤ 24 jam dan replay restore terbukti lokal; **retensi backup ≤ 30 hari belum terverifikasi** |

## 5. Status klaim T23

| Klaim | Status sebelum T25 | Status sekarang |
| --- | --- | --- |
| Backup yang memuat data pengguna kedaluwarsa ≤ 30 hari | belum terverifikasi | **tetap belum terverifikasi**: tidak ada proyek hosted untuk diperiksa. BLOCKER production |
| Penghapusan diterapkan ulang setelah restore | rancangan tanpa test | **terbukti lokal** (`release-restore.test.ts`); restore hosted dan objek Storage yang tidak ikut restore belum diuji |

`T23-retention-runbook.md` tidak diubah karena Fase 7 tidak memberi bukti baru.

## 6. Defect dan temuan

- Diperbaiki: D1–D8 (gap Fase 1), D9, D11, D12 (P2), D10 (P3), RV1 (P2, gate review), N7 (P2, temuan susulan: runbook §3 kini mencakup template email dan konfigurasi Auth hosted; klaim bahwa bucket tidak dibuat migration keliru dan sudah dikoreksi). Fase 7a hosted: lihat [review](T25-phase7a-review.md).
- Tidak ada P0 atau P1 sepanjang T25.
- P3 terbuka: O1–O13 di receipt fase, N3 (assertion insert belum spesifik `42501`), N5 (skenario 2/3 sebagai rangkaian), N6 (NVDA). N1, N2, dan N4 gate review ditutup di Fase 9 (checklist, angka receipt Fase 8, kalimat objek Storage di runbook §7).

## 7. Yang dibutuhkan untuk DONE

1. Proyek Supabase hosted, host web, host worker, SMTP nyata, dan satu pesan otorisasi tertulis untuk lingkungan itu, lalu Fase 7 dijalankan ([kebutuhan](T25-phase7-staging.md)). Migrasi hosted dikerjakan ChatGPT mengikuti [brief Fase 7 hosted](T25-phase7-hosted-migration-handoff.md).
2. Retensi backup diperiksa pada paket hosted sesuai T23 §3.
3. Pemeriksaan NVDA §6.4 rencana oleh manusia (bukan syarat DONE menurut §2.4.2, tetapi tetap tercatat terbuka).

Gate M5 tidak dapat PASSED sebelum poin 1 dan 2 terpenuhi.

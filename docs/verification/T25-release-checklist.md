# T25 Release checklist WorkPulse v0.1

Daftar ini menjaga agar tidak ada yang menyebut production live hanya karena stack lokal lulus.

- Item yang selesai dicentang dan punya bukti yang ditautkan.
- Item berlabel **BLOCKER** menghalangi publish production dan tidak boleh dicentang tanpa bukti dari lingkungan yang dimaksud.

- Tanggal: 10 Oktober 2026; diperbarui 11 Oktober 2026 setelah regresi Fase 8 dan gate review.
- Status: **tidak siap untuk production**. Delapan BLOCKER terbuka. Status T25 yang direkomendasikan reviewer: **PARTIAL** (staging belum tersedia, retensi backup belum terverifikasi).
- Pemilik: pelaksana (agen T25), reviewer (Claude), operator (menjalankan host), pemilik produk (keputusan dan otorisasi).

## 1. BLOCKER production

| Status | Item | Pemilik | Bukti yang dibutuhkan |
| --- | --- | --- | --- |
| [ ] | **BLOCKER** staging: proyek Supabase hosted, host web, dan host worker tersedia dan smoke §5 Fase 7 lulus | pemilik produk, operator | `T25-phase7-staging.md` dengan hasil nyata; sekarang berstatus BLOCKED |
| [ ] | **BLOCKER** retensi backup ≤ 30 hari diverifikasi pada paket hosted | operator | paket, retensi, tautan dokumentasi resmi, tanggal akses, pemeriksa (T23 §3); copy S12 menjanjikan 30 hari |
| [ ] | **BLOCKER** otorisasi deploy tertulis untuk lingkungan production | pemilik produk | pesan tertulis yang menyebut lingkungan itu |
| [ ] | **BLOCKER** domain production dan `WORKPULSE_SITE_URL` diisi domain sebenarnya (https) | operator | nilai terpasang di host web, redirect Auth berfungsi |
| [ ] | **BLOCKER** SMTP Auth nyata: email verifikasi dan recovery terkirim ke kotak masuk sungguhan | operator | bukti pengiriman pada staging (Fase 7) |
| [ ] | **BLOCKER** scanner nyata di host worker: `WORKPULSE_SCANNER_MODE=clamav` dan EICAR ditolak | operator | satu run `evidence-scanner-real` atau smoke staging |
| [ ] | **BLOCKER** renderer nyata (DOCX dan PDF) di host worker; PDF diunduh dan teksnya cocok | operator | smoke staging: export, unduh, ekstraksi teks |
| [ ] | **BLOCKER** mode AI dan wording persetujuan diputuskan pemilik produk (aktif dengan key, atau tetap `unavailable`) | pemilik produk | keputusan tertulis; bila aktif, smoke dengan key staging yang disetujui |

## 2. Bukti lokal yang sudah ada

| Status | Item | Pemilik | Bukti |
| --- | --- | --- | --- |
| [x] | Parity migration 36/36 dan tipe database terbaru | pelaksana | [Fase 3](T25-phase3-health.md), [Fase 5](T25-phase5-rebuild-build.md) |
| [x] | Clean rebuild dari nol: 36 migration, pgTAP 20 file / 1638 assertion, tipe identik | pelaksana | [Fase 5](T25-phase5-rebuild-build.md) |
| [x] | Penjaga katalog database (RLS, guard tulis, privilege `anon`, tabel `internal`, `search_path`, bucket) dengan bukti dapat gagal | pelaksana | [Fase 2](T25-phase2-isolation.md) |
| [x] | Isolasi dua akun: 18 tabel, 47 parameter RPC ber-ID, RPC worker, storage tiga kategori, tiga route | pelaksana | [Fase 2](T25-phase2-isolation.md) |
| [x] | Penghapusan akun diterapkan ulang setelah restore (prosedur dan test) | pelaksana | [Fase 2](T25-phase2-isolation.md), runbook §7 |
| [x] | Health operasional: `get_operational_health`, `pnpm ops:check` exit 0/2/1 | pelaksana | [Fase 3](T25-phase3-health.md) |
| [x] | Kontras token dua tema, matriks 20 keadaan layar × 360/1440 × light/dark, teks 200%, keyboard, kalimat S12 | pelaksana | [Fase 4](T25-phase4-accessibility.md) |
| [x] | Tidak ada rahasia server di bundle browser | pelaksana | [Fase 4](T25-phase4-accessibility.md) |
| [x] | Build produksi, `/api/health` 200, `worker:check` | pelaksana | [Fase 5](T25-phase5-rebuild-build.md) |
| [x] | Runbook rilis memuat setiap variabel `.env.example` (dijaga test) | pelaksana | [runbook](T25-release-runbook.md) |
| [x] | Regresi penuh T02–T24 dan Gate M2–M4 tanpa pelemahan assertion (52 command) | pelaksana | [Fase 8](T25-phase8-regression.md) |
| [x] | Gate review Claude atas Fase 0–8; RV1 (snapshot aria pada checkout CRLF) diperbaiki dan review ulang lulus | reviewer | [rencana remediasi](T25-review-remediation-plan.md), [Fase 8b](T25-phase8b-remediation.md) |

## 3. Belum dikerjakan atau menunggu

| Status | Item | Pemilik | Catatan |
| --- | --- | --- | --- |
| [ ] | Setelah restore hosted pertama: cleanup dan penghapusan akun untuk objek Storage yang tidak ikut restore (`storage_cleanup_failed`, `account_deletion_overdue` tetap 0) | operator | runbook §7; belum diuji terhadap restore hosted |
| [ ] | Pemeriksaan **screen reader nyata** (NVDA + Chrome atau Edge) mengikuti checklist plan §6.4 | pengguna atau penguji manusia | belum dijalankan; hanya proxy snapshot aria otomatis yang ada |
| [ ] | Ukuran p95 baca dan simpan pada dataset staging | operator | tergantung staging; lokal sudah di bawah target (T24) |
| [ ] | Pasang CI (GitHub Actions) | pelaksana task CI01 | di luar T25; direkomendasikan sebelum pilot |
| [ ] | Kanal notifikasi untuk exit `ops:check` ≠ 0 (email atau chat) | operator | di luar aplikasi; jadwalkan cron setiap 5 menit |
| [ ] | Evaluasi target pilot 60% / 40% / 30% / 98% | pemilik produk | pasca-pilot dari 20 pengguna (runbook T24); bukan syarat sebelum pilot |

## 4. Aturan

- Hasil lokal bukan bukti production. Item di bagian 1 hanya ditutup dengan receipt dari lingkungan yang bersangkutan.
- Hanya reviewer yang mengubah status authoritative dan merekomendasikan Gate M5.
- Daftar ini diperbarui bersama `T25-release-handoff.md` (Fase 9).

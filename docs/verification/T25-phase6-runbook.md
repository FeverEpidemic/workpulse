# T25 Fase 6 — Runbook rilis dan release checklist

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- Tidak ada edit source atau migration.

## File

| File | Aksi |
| --- | --- |
| `tests/unit/release-docs.test.ts` | create (7 test); **gagal lebih dulu**: kedua dokumen belum ada (7 gagal) |
| `docs/verification/T25-release-runbook.md` | create |
| `docs/verification/T25-release-checklist.md` | create |

## Isi

**Runbook** (8 bagian, sesuai plan §3.4): topologi; tabel variabel lingkungan (proses, jenis, default, sumber); deploy dengan urutan migrate → worker → web; worker; pemeriksaan kesehatan (`/api/health`, `worker:check`, `ops:check` dengan tindakan per metrik); rollback sebagai forward fix; backup dan restore (status klaim, verifikasi retensi, prosedur ekspor-lalu-terapkan-ulang dengan jawaban `P0002`); insiden privasi.

**Checklist**: delapan item **BLOCKER** terbuka (staging, retensi backup, otorisasi deploy, domain dan `WORKPULSE_SITE_URL`, SMTP Auth nyata, scanner nyata, renderer nyata, mode AI dan wording persetujuan), sepuluh item bukti lokal yang bercentang dan bertautan ke receipt, dan tujuh item yang belum dikerjakan atau menunggu (regresi Fase 8, gate review, NVDA nyata, p95 staging, CI01, kanal alert, evaluasi target pilot).

## Penjaga (`release-docs.test.ts`)

- Kedua dokumen ada.
- Nama variabel di `.env.example` (termasuk yang dikomentari `# NAME=`) sama persis dengan baris tabel variabel di runbook, tanpa duplikat. Kolom proses, jenis, dan default terisi dengan nilai dari daftar tertutup.
- Default delapan variabel alert di runbook sama dengan `DEFAULT_THRESHOLDS` di `workers/ops-check.ts`, jadi dokumen tidak dapat menyimpang dari kode.
- Setiap metrik `ops:check` disebut di runbook.
- Delapan judul bagian ada, urutan migrate → worker → web tertulis, "forward fix" tertulis, tidak ada `db reset`, dan tidak ada pola key atau JWT.
- Baris BLOCKER di checklist menyebut staging, retensi backup, otorisasi deploy, domain, SMTP, scanner, renderer, dan AI, dan tidak satu pun bercentang.

## Hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/release-docs.test.ts` sebelum dokumen | gagal, 7 test |
| `vitest run tests/unit/release-docs.test.ts` | exit 0, **7 test** |

## Catatan keputusan

- `DATABASE_URL`, `WORKPULSE_WORKER_ID`, dan `LOG_LEVEL` ada di `.env.example` tetapi **tidak dibaca kode v0.1**; runbook menulisnya apa adanya ("dicadangkan") alih-alih mengarang fungsinya.
- Runbook dan checklist **tidak** memuat klaim yang belum terverifikasi sebagai janji: retensi backup ≤ 30 hari, restore hosted, dan p95 hosted tertulis sebagai belum terverifikasi dan menjadi BLOCKER atau item terbuka.

## Langkah berikutnya

Fase 7 (staging) **BLOCKED**: pengguna belum menyediakan proyek Supabase hosted, host web, dan host worker, dan tidak ada otorisasi tertulis untuk deploy. Receipt `T25-phase7-staging.md` mencatat kebutuhan konkret, lalu Fase 8 (regresi penuh).

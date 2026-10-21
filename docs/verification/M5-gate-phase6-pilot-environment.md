# Gate M5 Fase 6: daftar periksa lingkungan pilot

- Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5).
- Tujuan: menyiapkan pemeriksaan kriteria §1.11 dan §1.12 untuk lingkungan pilot `myworkpulse.my.id`. Pelaksana tidak mengakses server, proyek hosted staging, maupun proyek hosted pilot.
- File berubah: [`M5-gate-pilot-environment.md`](M5-gate-pilot-environment.md) (baru) dan receipt ini.

## Status

Daftar periksa **siap** untuk operator. Sebelas butir sesuai handoff §5 Fase 6: urutan rilis (T26 N2), parity dan project ref, image `sha-<commit>`, Auth proyek pilot, smoke dengan akun uji khusus (termasuk EICAR, import `rules`, export dan teks PDF, penghapusan sampai hitungan nol, satu klik recovery dari kotak masuk nyata), backup dan retensi, mode AI, batas paket Free, ops, p95 (tidak di proyek pilot), dan query read-only untuk reviewer. Setiap bukti diberi label *dibaca balik* atau *dilaporkan*.

Satu nilai diverifikasi pelaksana secara lokal: `git show 6e35778:deploy/staging/backup.sh` memberi sha256 `e8e6dd099bc37293fda916187fbc1227ed4b48391439d5d42813e8c9ca7b3ad1`, sama dengan nilai di handoff, dan `deploy/staging/backup.sh` tidak berubah antara `6e35778` dan HEAD gate.

## Bukti staging yang sudah ada (tidak berlaku untuk pilot)

| Bukti | Sumber | Lingkungan |
| --- | --- | --- |
| Migrasi hosted 36/36, bucket privat, katalog, Site URL, redirect | [Fase 7a](T25-phase7-staging.md), [review 7a](T25-phase7a-review.md) | staging |
| Deploy web/worker, smoke §8 (evidence, impor DOCX, export, penghapusan), recovery Gmail, `ops:check` | [Fase 7b](T25-phase7-staging.md), [review 7b](T25-phase7b-review.md) | staging, image `sha-1de7318…` (tanpa migration 37–38) |
| `backup.sh` harian, dua `backup: ok` (18 dan 19 Oktober), uji prune, restore | [penutupan](T25-closeout-review.md), [runbook backup](T25-backup-runbook.md) | staging menurut laporan T25. Handoff M5 menyebut baris log yang sama sebagai log pilot; asalnya harus ditunjukkan operator (daftar periksa butir 6) |

## Bukti pilot yang masih ditunggu

Semua butir 1–9 daftar periksa. Tanpa butir 2, 3, 4, 5 (kriteria §1.11) dan butir 6 (kriteria §1.12), Gate M5 tidak dapat PASSED (§2.2 butir 3 handoff).

## Temuan

Tidak ada temuan baru di fase ini. M5-N1 (P3, `/api/health` tanpa commit) dipakai di butir 3 daftar periksa.

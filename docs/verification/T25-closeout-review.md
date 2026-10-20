# T25 Review penutupan (Fase 7 staging)

- Tanggal: 20 Oktober 2026.
- Reviewer: Claude (Opus 5.5). Read-only atas receipt dan bukti; satu uji aturan prune dijalankan reviewer.
- HEAD dasar: `181103f` (`main`, PR #29). Staging terpasang: image `sha-1de73187792325e948fbd08215733540968a15c4`, migration 36/36.
- Cakupan: sisa Fase 7 sejak [review 7b](T25-phase7b-review.md), yaitu retensi backup (§1.17) dan p95 hosted (§1.18). Fase 0-8 dan 8b sudah direview ([remediasi](T25-review-remediation-plan.md)), Fase 7a dan 7b juga ([7a](T25-phase7a-review.md), [7b](T25-phase7b-review.md)).

## Verdict

**PASS dengan satu pengecualian pemilik produk.** Tidak ada P0-P2. T25 dapat ditutup **DONE**.

- §1.17 terpenuhi untuk staging: backup sendiri berjalan harian, aturan prune benar, dan restore sudah dilatih.
- §1.18 terpenuhi kecuali p95 hosted. Pemilik produk menunda p95 secara tertulis (20 Oktober 2026: "p95 hosted saya tunda sebagai pengecualian pemilik produk, wajib diukur sebelum production"). Pengecualian ini dicatat di [decision 0034](../decisions/0034-t25-staging-closeout.md) dan menjadi BLOCKER production.
- Checklist tetap **tidak siap untuk production**: sepuluh BLOCKER terbuka.

## Acceptance yang dinilai ulang

| # | Poin | Sebelum | Sekarang | Bukti |
| --- | --- | --- | --- | --- |
| 17 | Backup dan restore jujur | WARNING | **PASS (staging)** | paket Free tanpa backup proyek; `backup.sh` harian dengan prune ≥ 29 hari; dua run cron `backup: ok` 18 dan 19 Oktober; uji aturan prune; restore 17 Oktober ([Fase 7](T25-phase7-staging.md#penutupan-20-oktober-2026-retensi-backup-dan-p95)) |
| 18 | Staging | sebagian | **PASS dengan pengecualian** | migrasi, Auth email, scanner, renderer, export, penghapusan, `ops:check` lulus 16-17 Oktober; p95 ditunda pemilik produk |

## Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| Dua baris `backup: ok` pada dua tanggal | Ada: `2026-10-18T12:30:53Z … copies=2`, `2026-10-19T12:30:53Z … copies=3`. Jumlah folder di `backups/` cocok |
| Aturan prune `backup.sh` baris 34 dan 36 | Reviewer menjalankan aturan yang sama di container GNU findutils atas folder tiruan: umur 0/1/27/28 hari tetap, 29/30/40 hari dihapus, `.partial` > 1 hari dihapus |
| Batas 30 hari | `-mtime +28` menghapus folder ≥ 29 hari penuh. Dengan run harian, umur maksimum di bawah 30 hari |
| Copy S12 (backup kedaluwarsa ≤ 30 hari) | Sesuai untuk staging selama cron berjalan; runbook backup §3 memuat pemeriksaan mingguan `backup.log` |
| Klaim receipt jujur | Bukti cron berasal dari tempelan pengguna, ditandai demikian. Percobaan p95 yang gagal dicatat beserta penyebabnya, tanpa angka |
| Privasi | Receipt tanpa URL koneksi, password, key, atau host pooler. Harness p95 meneruskan password lewat env container, bukan argumen |
| Checklist | BLOCKER tidak dicentang (dijaga `release-docs.test.ts`); p95 dipindah ke BLOCKER; kolom bukti diperbarui dengan hasil staging |

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| C1 | P3 | Penghapusan salinan pertama di server belum teramati. Aturan prune terbukti di container, tetapi run 16 November 2026 adalah bukti pertama di host | Follow-up operator: periksa `backup.log` dan `ls backups/` setelah 16 November |
| C2 | P3 | Folder `20261020T132654Z` tanpa baris log yang ditempel, dan `crontab -l` tidak ikut. Versi `backup.sh` di server (prune sebelum dump, `6e35778`) tidak terbukti dari bukti ini. Kedua versi menghapus salinan ≥ 29 hari; bedanya hanya urutan saat dump gagal | Follow-up operator, sekali |
| C3 | P3 | Run cron pukul 12:30 UTC, berbeda dari contoh 19:30 UTC di runbook §2. Tidak memengaruhi retensi | Diterima; dicatat di receipt |
| C4 | P3 | Harness p95 hosted (`claude/t25-perf-staging`, `004ce0d`) belum di-push dan belum direview; dasarnya `1de7318`, bukan `main` | Bawa ke pengukuran p95 sebelum production |
| B6 | P3 | Dari review 7b: satu klik recovery dari Gmail pada image `sha-1de7318…` | Tetap terbuka; tidak memblokir |

## Command reviewer

| Command | Exit | Hasil |
| --- | --- | --- |
| `docker run … postgres:17.11.0.003 bash /t/prune-test.sh` (aturan `find` dari `backup.sh`) | 0 | tersisa `.partial-new`, umur 0, 1, 27, 28 hari |
| `pnpm exec vitest run tests/unit/release-docs.test.ts` (setelah perubahan checklist) | 0 | 1 file / 7 test lulus |
| `pnpm test` | 0 | 1151/1151 test lulus |
| `git diff --check` | 0 | bersih |
| `diff AGENTS.md docs/AGENTS.md` | 0 | identik |

Tidak dijalankan: regresi lokal penuh (tidak ada perubahan kode sejak Fase 8 selain task yang punya gate sendiri, yaitu usage limits dan T26); p95 hosted (ditunda); pemeriksaan langsung server (reviewer tidak punya akses).

## Batas

Bukti staging bukan bukti production. Paket backup production, domain, otorisasi deploy, mode AI, EICAR di host, pencocokan teks PDF, dan p95 hosted tetap BLOCKER di [checklist](T25-release-checklist.md).

# Review T25 Fase 7b · Deploy server pribadi, smoke, dan backup

- Tanggal: 18 Oktober 2026.
- Reviewer: Claude (Opus 5.5), read-only terhadap staging. Deploy dan smoke browser dikerjakan pengguna; receipt, `backup.sh`, runbook backup, dan latihan restore ditulis Claude di sesi sebelumnya. Bagian itu **bukan review independen**.
- Scope: [receipt Fase 7](T25-phase7-staging.md) dari "Lanjutan 17 Oktober 2026" sampai akhir, [`deploy/staging/backup.sh`](../../deploy/staging/backup.sh), [runbook backup](T25-backup-runbook.md). Commit `65f9eee`, `0fbb225`, `490d6c9`.
- Verdict: **BELUM LULUS. Satu P2 (B1) di `backup.sh`; tanpa P0/P1.** B1 diperbaiki di repo pada hari yang sama (§5) dan masih harus dipasang di server. Smoke dan deploy diterima sebagai bukti staging dengan batas di §2. Retensi backup tetap belum terverifikasi (runbook §4 langkah 4 menunggu dua run cron). T25 tetap **PARTIAL**.

## 1. Verifikasi independen reviewer

| Pemeriksaan | Command | Hasil |
| --- | --- | --- |
| Sintaks script | `bash -n deploy/staging/backup.sh` (WSL) | exit 0 |
| Line ending di repo | `git ls-files --eol deploy/staging/backup.sh` | `i/lf w/lf`; aman untuk `curl` dari `main` (runbook §2 langkah 2) |
| Commit backup di remote | `git branch -r --contains 65f9eee` | ada di `origin/main`, jadi URL `raw.githubusercontent.com/.../main/...` valid. `490d6c9` (dokumen saja) belum di-push |
| Prune, dump sukses | harness WSL dengan CLI `supabase` palsu, direktori dibuat tua dengan `touch -d` | umur 30 hari dan 29 hari dihapus; 28 hari 23 jam dan 28 hari disimpan; salinan baru dibuat; exit 0 |
| Prune, dump gagal | harness yang sama, `FAKE_FAIL=1`, ditambah direktori umur 45 hari | exit 1; direktori 45 hari **tidak dihapus** (B1) |
| Sisa `.partial-*` | harness, direktori `.partial-…` umur 40 hari | tidak pernah dihapus (B2) |
| Sentinel rahasia | grep `sb_secret_`, `sb_publishable_`, `eyJ`, URI `postgres://` berisi kredensial, alamat Gmail di receipt dan runbook | nihil; dua URI di runbook adalah placeholder |
| `release-docs.test.ts` | `pnpm exec vitest run tests/unit/release-docs.test.ts` | 7/7 lulus |
| Hitungan hosted setelah akun uji ketiga dihapus | `execute_sql` select di proyek Workpulse | **tidak dijalankan**: query ditolak classifier izin sesi ini. Angka nol di receipt berasal dari pemeriksaan read-only sesi sebelumnya |

Tidak diulang: smoke browser, deploy server, isi `backup.log` dan cron di server, latihan restore. Reviewer tidak punya akses ke server; buktinya receipt dan laporan pengguna.

## 2. Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| B1 | P2 | Prune hanya berjalan setelah ketiga dump sukses. `set -e` dan `exit 1` di `dump()` (`backup.sh:39-46`) keluar sebelum `find … -exec rm` (`backup.sh:58-59`). Bila dump gagal terus, misalnya password database diganti atau pooler tidak terjangkau, salinan lama bertahan melewati 30 hari tanpa peringatan. Akibatnya janji copy S12 bisa dilanggar diam-diam. Runbook §3 hanya menyebut kasus cron mati, dan `ops:check` tidak memantau backup. Dibuktikan harness: direktori 45 hari tetap ada setelah run gagal | Diperbaiki di repo (§5); belum dipasang di server |
| B2 | P3 | Run yang mati oleh SIGKILL atau mati listrik meninggalkan `.partial-<stamp>`. Isinya bisa berupa dump data, tetapi direktori ini tidak cocok dengan pola prune `20*Z`, sehingga tidak pernah dihapus | Diperbaiki di repo (§5) |
| B3 | P3 | Batas umur bergantung pada jam cron. Salinan dihapus pada run pertama saat umurnya ≥ 29 × 24 jam. Bila durasi dump bergeser beberapa detik, penghapusan bisa mundur satu hari, sehingga umur maksimal mendekati 30 hari. Batas 30 hari masih terpenuhi pada jadwal normal, tetapi margin sebenarnya beberapa detik, bukan satu hari seperti tersirat di komentar `backup.sh:24-25` | Terbuka; opsional `keep_days=28` |
| B4 | P3 | `--db-url` berisi password muncul di argumen proses (`ps`) selama dump. Dapat diterima di server satu pengguna; catat di runbook §2 agar tidak dipindah ke host bersama | Dicatat di runbook §2 langkah 3 |
| B5 | P3 | Receipt menyisakan baris basi. "Dampak pada acceptance" §1.18 dan kalimat selesai (baris 255-256) masih menulis recovery menunggu PR #19. Tabel kebutuhan SMTP (baris 230) masih menulis DKIM tersisa. Keduanya sudah selesai menurut bagian "Uji ulang dan keputusan" | Perbaiki saat receipt berikutnya diperbarui |
| B6 | P3 | Uji ulang recovery dari Gmail tidak dikaitkan ke image. Receipt jujur bahwa tag tidak diperiksa, dan tag `sha-1de7318…` baru dipasang setelah uji itu (S2, 18 Oktober). Satu klik recovery dari Gmail pada image `sha-1de7318…` mengikat perbaikan S1 ke image yang terpasang | Terbuka; pengguna, sekali |
| B7 | P3 | Nilai rate limit pilot, penggantian tag (S2), dan baris cron server hanya dilaporkan pengguna; tidak dibaca balik | Diterima sebagai "dilaporkan" |

Diterima tanpa temuan: smoke §8 langkah 2-6 dengan adapter nyata, `/api/health` dan redirect dari luar, perbaikan S1 beserta E2E lintas origin, latihan restore dengan versi layanan yang disamakan dan batasnya (tanpa baris pengguna) yang tercatat jujur. Smoke memakai akun Gmail pribadi pengguna, bukan akun uji khusus seperti rencana §4, atas pilihan pengguna; akun itu sudah dihapus.

## 3. Rencana remediasi

**RV-B1 (wajib sebelum BLOCKER retensi dinilai ulang)**

1. Pindahkan kedua `find` prune ke fungsi `prune()` yang dipanggil sebelum dump, sehingga prune tetap berjalan walau dump gagal. Bila salinan baru gagal dibuat, tetap hapus yang ≥ 29 hari. Privasi penghapusan akun lebih penting daripada menyimpan salinan basi.
2. Tambahkan `.partial-*` berumur lebih dari 1 hari ke prune (B2).
3. Opsional B3: `keep_days=28`, lalu perbarui komentar dan runbook §3.
4. Runbook §3: tambahkan bahwa dump yang gagal tetap mem-prune, dan bahwa `backup.log` tanpa `backup: ok` hari itu berarti tidak ada salinan baru. Runbook §2: catatan B4.
5. Test regresi: harness reviewer (CLI palsu, `touch -d`). Run gagal harus menghapus direktori 45 hari dan `.partial` lama (sebelum perbaikan: gagal), sedangkan run sukses tetap menghasilkan pola hapus dan simpan seperti §1.
6. Deploy ulang script di server lewat `curl` dari `main` (runbook §2 langkah 2), lalu jalankan `./backup.sh` sekali secara manual.

**Ulangi setelah perbaikan:** `bash -n`, harness prune (dua skenario), `git diff --check`, `release-docs.test.ts`.

## 4. Yang masih dibutuhkan

1. RV-B1 di server: push ke `main`, unduh ulang `backup.sh` (runbook §2 langkah 2), lalu jalankan sekali secara manual.
2. Dua baris `backup: ok` dari cron (runbook §4 langkah 4). Run cron yang terjadi sebelum RV-B1 tetap dihitung, karena script lama juga membuat salinan dengan benar.
3. B6: satu klik recovery dari Gmail pada image `sha-1de7318…`.
4. p95 hosted, bila dataset staging boleh di-seed.

Gate M5 tetap tidak dapat PASSED sebelum retensi backup terverifikasi.

## 5. Remediasi RV-B1, 18 Oktober 2026

Dikerjakan Claude atas permintaan pengguna ("Ya, kerjakan RV-B1"). Reviewer dan pelaksana sama, jadi perbaikan ini tidak direview pihak independen.

- `backup.sh`: ketiga `find` prune dijalankan setelah lock dan sebelum dump. Prune baru untuk `.partial-*` berumur lebih dari satu hari (`-mtime +0`). `keep_days` tetap 29; B3 tidak diubah.
- Runbook §3: prune berjalan walau dump gagal, risiko `backups/` kosong bila dump gagal terus, dan `.partial-*`. Runbook §2 langkah 3: catatan B4.

| Check | Hasil |
| --- | --- |
| `bash -n deploy/staging/backup.sh` (WSL) | exit 0 |
| Harness pada script lama (`git show HEAD:…`) | 4 gagal: direktori 45 hari, dua `.partial` lama, dan `failed-*.err` 45 hari tetap ada |
| Harness pada script baru | 14/14 lulus, exit 0. Run sukses: umur 30 dan 29 hari dihapus, 28 hari 23 jam dan 28 hari disimpan, `.partial` 40 hari dihapus, `.partial` 2 jam disimpan, satu salinan baru. Run gagal (exit 1): direktori 45 hari, `.partial` 3 hari, dan `failed-*.err` 45 hari dihapus |
| `git ls-files --eol deploy/staging/backup.sh` | `i/lf w/lf` |

Harness disimpan di luar repo (scratchpad sesi) dan tidak di-commit.

# Decision 0037: Pengecualian pemilik produk untuk Gate M5

Date: 21 Oktober 2026

Status: Accepted. Task: Gate M5. Mengubah [rencana Gate M5](../verification/M5-gate-review-plan.md) §2.2 butir 3 (verdict hanya PASSED atau BLOCKED) untuk gate ini saja. Polanya mengikuti pengecualian p95 di [decision 0034](0034-t25-staging-closeout.md). [Laporan gate](../verification/M5-gate-review.md), [decision 0036](0036-shared-staging-pilot-project.md), [daftar periksa lingkungan pilot](../verification/M5-gate-pilot-environment.md).

## Context

Pada 21 Oktober 2026, kriteria 1–10 dan 13 Gate M5 lulus lokal dan diverifikasi ulang reviewer. Untuk lingkungan pilot (proyek `Workpulse`, `cotmocgufdxjtiuakwdh`, bersama staging menurut 0036), reviewer membaca balik parity 38/38, signup sampai verify dan login, bucket privat, satu job AI import `succeeded`, health operasional bernilai 0, dan image `sha-f9fff79…` di host, yang sama dengan ujung `main`.

Ada bukti yang tidak lengkap atau tidak didukung data:

- **Kriteria 12 (retensi backup).** Yang ada hanya dua baris `backup: ok` (18 dan 19 Oktober), sama dengan bukti T25. Baris run 20 Oktober 12:30 UTC tidak ditunjukkan. sha256 `backup.sh` dibanding `6e35778`, `crontab -l`, dan daftar salinan belum diberikan, sehingga catatan C2 decision 0034 (versi script terpasang tidak terbukti) tetap terbuka.
- **Kriteria 11 (smoke pilot).** Pemilik produk melaporkan sisa smoke sudah diuji langsung dan aman. Data hosted tidak memuat satu pun batch import mode `rules`, dan tidak ada penghapusan akun setelah 17 Oktober yang bisa menghapusnya. EICAR ditolak dan pencocokan teks PDF tidak meninggalkan jejak yang dapat dibaca. Nilai Site URL dan template email tidak terbaca lewat connector.

## Keputusan

1. **Gate M5 dinyatakan PASSED dengan pengecualian pemilik produk.** Kutipan, 21 Oktober 2026: "Catat sebagai pengecualian pemilik produk seperti p95 di 0034, lalu tulis verdict PASSED dengan pengecualian."
2. **Butir yang dikecualikan** (status bukti: dilaporkan, belum dibaca balik):
   - E1: baris `backup: ok` run 20 Oktober dan setelahnya, sha256 `backup.sh` = `e8e6dd09…3ad1` (`6e35778`), baris cron, dan daftar salinan tanpa yang berumur lebih dari 29 hari.
   - E2: import CV mode `rules` di lingkungan pilot.
   - E3: EICAR ditolak oleh scanner di host pilot.
   - E4: PDF export diunduh dari pilot dan teksnya cocok.
   - E5: nilai Site URL, redirect, dan dua template email di dashboard Auth.
3. **E1–E5 wajib dibuktikan sebelum production**, sama seperti p95 hosted di 0034. Kesepuluh BLOCKER di `T25-release-checklist.md` §1 tetap terbuka.
4. **Status bukti tidak dinaikkan.** Laporan gate menulis E1–E5 sebagai *dilaporkan* atau *menunggu*, bukan *terverifikasi*.

## Risiko yang diterima

- **Retensi backup.** Bila run 20 Oktober atau setelahnya gagal, atau script terpasang bukan versi RV-B1, janji S12 bahwa backup kedaluwarsa paling lama 30 hari tidak dapat dibuktikan, dan jalur pulih untuk migration berikutnya (0036 #2) melemah. Pemeriksaan mingguan runbook backup §4 tetap berlaku.
- **Import tanpa AI.** Pengguna pilot tanpa consent AI memakai jalur `rules` yang belum pernah berjalan di hosted. Kegagalan di sana tetap menyisakan entri manual.
- **Scanner dan PDF.** Bila scanner host tidak menolak file berbahaya atau PDF hosted terpotong, yang pertama melihatnya adalah pengguna pilot.

## Seam ke task berikutnya

- **Sebelum mendaftarkan peserta pilot pertama** (`set_pilot_participant`, saat ini 0): reviewer menyarankan E1 dan E2 ditutup dulu, karena keduanya menyentuh data dan jalur utama pengguna tanpa AI. Ini saran, bukan syarat gate.
- **Sebelum production:** E1–E5 bersama sepuluh BLOCKER checklist.

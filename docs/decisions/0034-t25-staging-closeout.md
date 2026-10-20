# Decision 0034: Penutupan T25 di staging

Date: 20 Oktober 2026

Status: Accepted. Task: T25 (PRD §2 R01–R10, §4 *Deletion*, §5 M5; rencana T25 §1.17 dan §1.18). Melengkapi [decision 0031](0031-t25-release-handoff.md), yang ditulis saat staging belum tersedia. [Rencana](../verification/T25-implementation-plan.md), [receipt Fase 7](../verification/T25-phase7-staging.md), [review penutupan](../verification/T25-closeout-review.md), [runbook backup](../verification/T25-backup-runbook.md), [checklist](../verification/T25-release-checklist.md).

## Context

Decision 0031 menutup bukti lokal dan menahan T25 di PARTIAL karena staging dan retensi backup belum terbukti. Antara 11 dan 20 Oktober 2026, staging dibangun: migrasi hosted (Fase 7a), SMTP dan template Auth, web dan worker di server pribadi, smoke §8, recovery dari Gmail, backup `pg_dump` harian, dan latihan restore. Dua hal tersisa: dua run cron backup, dan p95 hosted.

## Keputusan

1. **Retensi staging dipenuhi oleh backup sendiri, bukan oleh paket hosted.** Paket Free tidak punya backup proyek maupun PITR. `deploy/staging/backup.sh` berjalan harian dari cron di server, menghapus salinan berumur ≥ 29 hari sebelum dump, dan menulis satu baris status ke `backup.log`. §1.17 dianggap terverifikasi untuk staging dengan bukti dua run cron (18 dan 19 Oktober 2026), uji aturan prune, dan latihan restore 17 Oktober.
   - *Alasan:* pemilik produk memilih opsi ini pada 17 Oktober 2026. Copy S12 (backup kedaluwarsa ≤ 30 hari) benar selama cron berjalan, dan runbook menetapkan pemeriksaan mingguan.
2. **p95 hosted dikecualikan dari penutupan T25 atas keputusan pemilik produk.** Kutipan, 20 Oktober 2026: "tutup T25 sebagai DONE. p95 hosted saya tunda sebagai pengecualian pemilik produk, wajib diukur sebelum production." p95 hosted menjadi BLOCKER kesepuluh di checklist.
   - *Alasan:* p95 lokal (baca ≤ 206,2 ms, simpan ≤ 198,4 ms) berada jauh di bawah target 2.000 / 1.000 ms, dan pengukuran hosted butuh seed dataset di staging. Risiko yang diterima: latensi jaringan ke `ap-northeast-2` dan batas paket Free belum diukur.
3. **T25 DONE berarti staging terverifikasi, bukan production siap.** Kesepuluh BLOCKER di checklist tetap terbuka dan hanya ditutup dengan bukti dari lingkungan production.
4. **Harness p95 hosted disimpan di branch terpisah.** `claude/t25-perf-staging` (`004ce0d`, di atas `1de7318`) memberi `tests/perf` jalur `psql` lewat container dengan variabel `PG*` dan file env yang dapat dipilih. Default lokal tidak berubah. Branch itu belum di-push dan belum direview.

## Batas yang diterima

- Penghapusan salinan pertama di server baru terjadi pada run 16 November 2026 (C1).
- Versi `backup.sh` yang terpasang tidak terbukti dari bukti yang ditempel (C2).
- Salinan backup hanya ada di satu disk server, dan isi Storage tidak di-backup (runbook backup §6).
- NVDA nyata belum dijalankan (0031).

## Seam ke task berikutnya

- **Gate M5:** review milestone Claude setelah T25, sekarang dapat dijalankan.
- **Sebelum production:** p95 hosted, paket dan retensi backup production, EICAR di host, pencocokan teks PDF, domain, otorisasi deploy, mode AI.
- **Deploy staging berikutnya:** migration 37 (usage limits) dan 38 (T26) bersama image worker yang sesuai.

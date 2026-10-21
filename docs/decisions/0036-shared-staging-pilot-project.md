# Decision 0036: Staging dan pilot berbagi satu proyek Supabase

Date: 21 Oktober 2026

Status: Accepted. Task: Gate M5 (temuan M5-E1). Mengubah asumsi [rencana Gate M5](../verification/M5-gate-review-plan.md) §2.2 butir 4 dan kriteria §1.11 butir ketiga. [Laporan gate](../verification/M5-gate-review.md), [daftar periksa lingkungan pilot](../verification/M5-gate-pilot-environment.md), [decision 0034](0034-t25-staging-closeout.md), [runbook backup](../verification/T25-backup-runbook.md).

## Context

Rencana Gate M5 menganggap pilot `myworkpulse.my.id` memakai proyek Supabase sendiri, terpisah dari staging. Saat review Fase 8 terbukti bahwa proyek hosted `Workpulse` (`cotmocgufdxjtiuakwdh`, ap-northeast-2, paket Free) melayani domain pilot, dan pemilik produk mengonfirmasi bahwa proyek yang sama juga dipakai sebagai staging. Akibatnya, syarat "perubahan yang sama lebih dulu lulus smoke di staging" tidak bisa dipenuhi untuk database: setiap migration, smoke, dan akun uji langsung mengenai data pilot.

Memisahkan staging butuh proyek kedua. Paket Free membatasi dua proyek aktif per organisasi, dan slot kedua sudah dipakai proyek lain.

## Keputusan

1. **Pilot 20 pengguna dan staging memakai satu proyek Supabase `Workpulse`.** Pemilik produk menerima ini pada 21 Oktober 2026: "Terima satu proyek Supabase untuk pilot 20 pengguna."
2. **Migration hosted hanya diterapkan bila dua syarat terpenuhi.** Migration itu sudah lulus di lokal (clean rebuild, `pnpm db:test`, dan suite domain yang disentuh), dan `backup.log` hari itu berisi `backup: ok` yang lebih baru dari migration terakhir yang diterapkan. Migration dan image worker yang sesuai naik bersamaan (T26 N2).
3. **Akun uji tidak didaftarkan sebagai peserta pilot.** Smoke dan uji manual tidak memanggil `set_pilot_participant`, supaya `get_pilot_metrics` hanya menghitung pengguna pilot.
4. **Akun uji dihapus lewat S12 setelah smoke selesai.** Penghapusan berjalan sampai receipt `completed`, dan `get_operational_health` kembali ke 0 untuk `account_deletion_overdue` dan `storage_cleanup_failed`.
5. **Bukti staging dan bukti pilot dinilai sebagai satu lingkungan di sisi Supabase.** Parity, Auth, bucket, dan backup database dibuktikan sekali untuk proyek ini. Web dan worker tetap dibuktikan per host, lewat tag image `sha-<commit>` yang dibaca dari masing-masing server.

Alasan: skala pilot kecil, kuota paket Free tidak menyisakan slot proyek, dan syarat 2–4 menggantikan fungsi staging sebagai pengaman. Backup harian yang terbukti `ok` memberi jalur pulih bila migration merusak data, sedangkan aturan akun uji menjaga metrik dan data pilot tetap bersih.

## Batas yang diterima

- Kesalahan migration yang lolos uji lokal langsung berdampak ke pengguna pilot. Pemulihannya lewat restore `pg_dump` (runbook backup §5, *Latihan restore*), yang kehilangan perubahan sejak dump terakhir dan tidak memulihkan objek Storage.
- Smoke yang gagal di tengah jalan dapat meninggalkan akun uji sampai dihapus manual.
- Keputusan ini berlaku untuk pilot 20 pengguna saja. Rilis production butuh proyek sendiri (`T25-release-checklist.md` §1).

## Seam ke task berikutnya

- **Gate M5:** M5-E1 tertutup oleh decision ini. Kriteria §1.11 butir ketiga dibaca sebagai syarat 2 di atas. Image dan backup masih menunggu bukti dari host.
- **Production:** proyek Supabase terpisah dan paket backup diputuskan pemilik produk sebelum production.

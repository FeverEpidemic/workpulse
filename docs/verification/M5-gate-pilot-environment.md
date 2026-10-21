# Gate M5: daftar periksa lingkungan pilot (`myworkpulse.my.id`)

- Disiapkan: 21 Oktober 2026, pelaksana gate (Claude, Opus 5.5). Pelaksana **tidak** mengakses server, proyek hosted staging, atau proyek hosted pilot.
- Dipakai untuk kriteria §1.11 dan §1.12 [handoff Gate M5](M5-gate-review-plan.md). Operator menjalankan langkah di bawah dan menempelkan bukti di bagian **Isian operator** pada tiap butir. Reviewer (Fase 8) memeriksa isian itu dan boleh menjalankan query read-only di butir 11.
- Lingkungan pilot terpisah dari staging: proyek Supabase hosted paket Free sendiri, server pribadi sendiri, domain `myworkpulse.my.id`. Bukti staging (`T25-phase7-staging.md`, `T25-phase7b-review.md`, `T25-closeout-review.md`) **tidak** dipindahkan ke pilot.
- HEAD gate (diisi saat laporan draft ditulis): lihat [M5-gate-review.md](M5-gate-review.md). Image pilot harus memuat commit itu atau turunannya di `main`.

## Aturan bukti

- Setiap bukti diberi label **dibaca balik** (keluaran command atau query yang ditempel apa adanya, tanpa rahasia) atau **dilaporkan** (pernyataan operator tanpa keluaran).
- Kriteria §1.11–§1.12 hanya lulus dengan bukti *dibaca balik*, kecuali butir yang memang keputusan tertulis (butir 7).
- Jangan menempel password, `SUPABASE_SECRET_KEY`, URL koneksi database, host pooler, atau alamat email pribadi. Project ref boleh ditulis.
- Tulis **project ref pilot** dan **project ref staging** di butir 2. Reviewer memastikan ref yang sama muncul di bukti parity, Auth, smoke, dan backup.

## 1. Urutan rilis (T26 N2, decision 0032/0033)

Migration 37 (`20261018090000_ai_usage_limits.sql`) dan 38 (`20261019090000_t26_import_rules_extraction.sql`) harus naik **bersamaan** dengan worker yang memuat T26. Worker lama yang meng-claim job `rules` memanggil `complete_import_parse` tanpa `p_items` dan gagal berulang sampai `IMPORT_WORKER_TIMEOUT`. Acuan: [runbook rilis](T25-release-runbook.md) §3.

Langkah operator:

1. Konfirmasi perubahan ini lebih dulu lulus di **staging** (deploy + smoke butir 5 terhadap staging). Tempel tanggal dan tag image staging.
2. Catat waktu migration 37–38 diterapkan di proyek pilot dan waktu container worker dengan T26 mulai berjalan.
3. Bila ada jeda di antara keduanya, jalankan di proyek pilot:

   ```sql
   select b.extraction_mode, b.status, b.error_code, count(*)
   from public.import_batches b
   where b.created_at between '<waktu migration 38>' and '<waktu worker T26 hidup>'
   group by 1, 2, 3 order by 1, 2, 3;
   ```

   Hasil yang diharapkan: tidak ada baris, atau tidak ada batch `rules` berstatus `failed` dengan `IMPORT_WORKER_TIMEOUT`.

Isian operator: _(staging lebih dulu: tanggal, tag; waktu migration; waktu worker; hasil query; label)_

## 2. Parity migration dan project ref

```bash
pnpm exec supabase migration list --linked
```

Dijalankan dari checkout `main` yang ter-link ke **proyek pilot**. Harapan: 38 baris, kolom remote sama dengan lokal, terakhir `20261019090000`.

Isian operator: _(project ref pilot; project ref staging; keluaran `migration list`, dibaca balik)_

## 3. Image web dan worker

Di host pilot:

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
```

Harapan: web dan worker memakai `ghcr.io/…/workpulse-web:sha-<commit>` dan `ghcr.io/…/workpulse-worker:sha-<commit>`, dengan `<commit>` sama dengan HEAD gate atau turunannya di `main`. Tag `main` atau `latest` tidak diterima karena dapat berubah. `/api/health` tidak memuat commit (temuan M5-N1), jadi tag dari host adalah satu-satunya bukti.

Isian operator: _(keluaran `docker ps`, dibaca balik; `git merge-base --is-ancestor <HEAD gate> <commit image>` exit 0)_

## 4. Konfigurasi Auth proyek pilot

Paket Free tetap butuh SMTP kustom agar template email dipakai ([review 7a](T25-phase7a-review.md)).

| Butir | Harapan |
| --- | --- |
| Site URL | `https://myworkpulse.my.id` |
| Redirect URLs | memuat `https://myworkpulse.my.id/auth/confirm`; tanpa `127.0.0.1`/`localhost` dari `config.toml` |
| Template confirmation dan recovery | isi `supabase/templates/confirmation.html` dan `recovery.html` (tautan `{{ .RedirectTo }}?token_hash=…`) |
| SMTP kustom | aktif, MXroute, pengirim di domain pilot |
| Bucket `workpulse-private` | privat |
| `WORKPULSE_SITE_URL` di host web | `https://myworkpulse.my.id` |

Isian operator: _(tangkapan dasbor atau keluaran Management API per baris; label)_

## 5. Smoke di pilot

Pakai **akun uji khusus**, bukan akun pribadi. Akun ini **tidak** didaftarkan sebagai peserta pilot (`set_pilot_participant`), agar metrik pilot bersih. Catat user id akun uji.

1. Daftar lewat `https://myworkpulse.my.id`, konfirmasi email dari kotak masuk nyata, onboarding.
2. Evidence: unggah satu PDF sampai **Ready**. Unggah file EICAR (`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*` disimpan sebagai `.pdf`) dan pastikan ditolak, tidak pernah `ready`.
3. Import: S02, pilih **Baca tanpa AI** / *Read without AI*, unggah satu CV DOCX, review di S03, konfirmasi. Mode `ai` hanya bila butir 7 memutuskan AI aktif.
4. Export: pilih item di S13, simpan, export di S14, unduh PDF, buka dan pastikan teks dapat disalin (nama dan satu bullet).
5. Recovery: dari halaman masuk minta tautan reset, klik **satu kali** dari kotak masuk nyata, harus mendarat di `https://myworkpulse.my.id/update-password` (menutup T25 B6 untuk pilot).
6. Penghapusan akun: S12 *Privacy and account*, password dan email, lalu tunggu worker. Jalankan di proyek pilot dengan user id akun uji:

   ```sql
   select
     (select count(*) from auth.users where id = '<user id>') as auth_users,
     (select count(*) from public.profiles where id = '<user id>') as profiles,
     (select count(*) from storage.objects where bucket_id = 'workpulse-private' and starts_with(name, '<user id>/')) as objects,
     (select count(*) from internal.ai_usage where user_id = '<user id>') as ai_usage,
     (select count(*) from internal.product_events where user_id = '<user id>') as product_events,
     (select status from internal.account_deletions where user_id = '<user id>') as receipt;
   ```

   Harapan: semua hitungan 0, receipt `completed`.

Isian operator: _(hasil per langkah; hasil query butir 6, dibaca balik; jam tiap langkah)_

## 6. Backup dan retensi (kriteria §1.12)

| Butir | Command di host pilot | Harapan |
| --- | --- | --- |
| Versi script | `sha256sum <path>/backup.sh` | `e8e6dd099bc37293fda916187fbc1227ed4b48391439d5d42813e8c9ca7b3ad1`, sama dengan `git show 6e35778:deploy/staging/backup.sh \| sha256sum` (diverifikasi pelaksana pada 21 Oktober 2026; script tidak berubah sejak `6e35778`) |
| Target dump | baca `--db-url` di script atau wrapper | menunjuk project ref **pilot**. Tulis hanya project ref, tanpa password dan host |
| Jadwal | `crontab -l` | satu baris backup harian |
| Log | `grep -E 'backup: ok\|dump failed' <path>/backup.log` | minimal dua baris `backup: ok` dari **cron** pada dua tanggal berbeda, **setelah** script RV-B1 terpasang |
| Salinan | `ls -la --time-style=long-iso <path>/backups/` | tidak ada salinan atau `.partial-*` berumur lebih dari 29 hari |

Bila baris 18 dan 19 Oktober 2026 (`copies=2`, `copies=3`) dipakai sebagai bukti, operator wajib menunjukkan dua hal: keduanya berasal dari host pilot, dan script RV-B1 (`6e35778`) sudah terpasang sebelum run 18 Oktober (misalnya `stat backup.sh` dan riwayat shell). Bila tidak bisa, dua run cron berikutnya yang dipakai.

Jelaskan asal salinan pertama: run 18 Oktober melaporkan `copies=2`, artinya sudah ada satu salinan sebelumnya (run manual atau salinan dari host lain).

Perkiraan prune pertama: salinan tertua dihapus saat umurnya 29 hari. Bila salinan tertua bertanggal 17 Oktober 2026, prune pertama sekitar 15–16 November 2026. Pengamatan prune pertama di host pilot adalah follow-up P3, bukan syarat gate.

Isian operator: _(lima baris tabel, dibaca balik; penjelasan asal salinan pertama)_

## 7. Mode AI pilot

Keputusan tertulis pemilik produk: AI **aktif** dengan key, atau **`WORKPULSE_AI_MODE=unavailable`**. Bila aktif: satu smoke `analysis` dengan key yang disetujui, lalu tunjukkan unit terbebankan (`select bucket, window_kind, units from internal.ai_usage where user_id = '<user id akun uji>'`). Selain itu tidak ada panggilan provider.

Isian operator: _(kutipan keputusan dan tanggal; nilai `WORKPULSE_AI_MODE` di env worker, nama variabel saja bila AI aktif)_

## 8. Batas paket Free

Catat untuk pilot 20 pengguna, dengan sumber dokumentasi resmi Supabase dan tanggal akses:

- ukuran database terpakai dibanding kuota paket;
- Storage terpakai dibanding kuota paket;
- perilaku jeda proyek saat tidak aktif dan cara mencegah atau memulihkannya;
- paket Free tanpa backup proyek dan tanpa PITR, sehingga `backup.sh` adalah satu-satunya backup database. Objek Storage tidak ikut backup ([runbook backup](T25-backup-runbook.md) §6).

Isian operator: _(angka terpakai, kuota, tautan dokumentasi, tanggal akses)_

## 9. Ops

- `crontab -l` di host pilot: baris `ops:check` (disarankan setiap 5 menit).
- Kanal notifikasi untuk exit ≠ 0 (email atau chat), termasuk satu contoh notifikasi bila pernah terkirim.
- Satu keluaran terbaru `{"status":"ok", …}`.

Isian operator: _(baris cron, kanal, keluaran terbaru, dibaca balik)_

## 10. p95 di pilot

Tidak dijalankan di proyek pilot: dataset T24 (1.000/200/50) akan mencemari data pilot. Bila diukur, lakukan di staging dengan harness `claude/t25-perf-staging` dan catat sebagai bukti staging. Opsional bagi verdict; tetap BLOCKER production.

## 11. Query read-only untuk reviewer

Dijalankan reviewer terhadap **proyek pilot** (bukan staging) dengan koneksi read-only. Tidak ada key di dokumen ini; koneksi memakai variabel yang disimpan reviewer di environment prosesnya sendiri, misalnya `PILOT_DB_READONLY_URL`.

```sql
-- Butir 2: parity
select version from supabase_migrations.schema_migrations order by version desc limit 3;
select count(*) from supabase_migrations.schema_migrations;

-- Butir 4: bucket privat
select id, public from storage.buckets where id = 'workpulse-private';

-- Butir 5: akun uji terhapus (isi user id dari isian butir 5)
select (select count(*) from auth.users where id = '<user id>') as auth_users,
       (select count(*) from public.profiles where id = '<user id>') as profiles,
       (select count(*) from storage.objects where bucket_id = 'workpulse-private' and starts_with(name, '<user id>/')) as objects;

-- Kesehatan tanpa konten
select * from public.get_operational_health();
```

Harapan: versi terakhir `20261019090000`, hitungan 38, `public = false`, hitungan akun uji 0, `account_deletion_overdue` dan `storage_cleanup_failed` = 0.

# T25 Backup database staging (opsi B)

- Tanggal: 17 Oktober 2026
- Status: **siap dipasang, belum berjalan di server**. Klaim retensi ≤ 30 hari baru dianggap terverifikasi setelah §4 dan §5 dicatat di [receipt Fase 7](T25-phase7-staging.md).
- Keputusan pemilik produk (17 Oktober 2026): paket Supabase Free tetap dipakai, dan backup dibuat sendiri dengan `pg_dump` terjadwal di server pribadi, retensi di bawah 30 hari ("Retensi Backup kayaknya better di B deh").
- Script: [`deploy/staging/backup.sh`](../../deploy/staging/backup.sh).

## 1. Apa yang dicakup

| Dicakup | Tidak dicakup |
| --- | --- |
| Roles, schema, dan data database hosted, termasuk `public`, `internal`, `auth` (akun dan identitas), dan metadata `storage.objects` | **Isi file di Storage** (evidence, CV impor, PDF export). Setelah restore, baris dapat merujuk file yang tidak ada (runbook rilis §7). |
| Salinan harian, dihapus otomatis sebelum berumur 30 hari | Salinan di luar server. Bila disk server rusak, backup ikut hilang. |
| | Konfigurasi Auth di dashboard (SMTP, template, URL, rate limit). Dicatat di receipt Fase 7, dipasang ulang manual. |

Metodenya adalah backup lewat CLI dari dokumentasi Supabase (*Backup and restore using the CLI*): `supabase db dump` untuk roles, schema, dan data, lalu restore dengan `psql` dalam urutan itu.

File backup memuat data pengguna dan hash password. Script memakai `umask 077`, jadi direktori dan file hanya dapat dibaca pemiliknya.

## 2. Pasang di server

Semua langkah dijalankan di server sebagai user yang menjalankan compose (`ilham827`), di `/home/ilham827/workpulse`.

1. Pasang Supabase CLI dari paket `.deb` rilis resmi (`supabase_linux_amd64.deb` di GitHub `supabase/cli`), lalu pastikan `supabase --version` jalan. CLI menjalankan `pg_dump` di container, jadi user harus bisa menjalankan `docker` tanpa sudo.
2. Unduh script dari repo (bukan salinan dari checkout Windows, karena bisa ber-CRLF), lalu jadikan executable:

   ```bash
   curl -fsSLo backup.sh https://raw.githubusercontent.com/FeverEpidemic/workpulse/main/deploy/staging/backup.sh && chmod 700 backup.sh
   ```

3. Buat `backup.env` dengan mode 600. Ambil URL dari dashboard Supabase lewat **Connect → Session pooler** (port 5432, IPv4). Koneksi langsung `db.<ref>.supabase.co` di paket Free hanya IPv6. Password database harus di-*percent-encode* bila memuat karakter khusus.

   ```bash
   install -m 600 /dev/null backup.env && nano backup.env
   ```

   Isinya:

   ```bash
   WORKPULSE_BACKUP_DB_URL='postgresql://postgres.<ref>:<password>@<host pooler>:5432/postgres'
   ```

   Jangan tempel URL atau password ini di chat, repo, maupun receipt.

4. Jalankan sekali secara manual:

   ```bash
   ./backup.sh; echo "exit $?"
   ```

   Hasil yang diharapkan satu baris `backup: ok <stamp> size=… copies=1` dan exit 0. Di `backups/<stamp>/` ada `roles.sql.gz`, `schema.sql.gz`, `data.sql.gz`, dan `SHA256SUMS`. Bila gagal, detail error ada di `backups/failed-<stamp>-<nama>.err`. File itu dapat memuat host koneksi, jadi baca di server dan jangan ditempel utuh.

5. Pasang cron harian, misalnya pukul 19:30 UTC (02:30 WIB). Tambahkan lewat `crontab -e`:

   ```cron
   30 19 * * * /home/ilham827/workpulse/backup.sh >> /home/ilham827/workpulse/backup.log 2>&1
   ```

## 3. Retensi

- Script menghapus salinan yang berumur 29 hari atau lebih, setiap kali berjalan. Dengan cron harian, tidak ada salinan yang mencapai 30 hari.
- Penghapusan hanya terjadi saat script berjalan. Bila cron mati, salinan lama tidak terhapus. Periksa `backup.log` minimal mingguan; baris terakhir harus `backup: ok` dari hari itu.
- Paket Free tidak menyediakan backup proyek maupun PITR (dashboard Database → Backups, receipt Fase 7a). Jadi salinan di server ini satu-satunya backup, dan retensinya ditentukan script ini.

## 4. Bukti yang dicatat setelah pemasangan

Catat di receipt Fase 7:

1. Versi Supabase CLI di server.
2. Baris `backup: ok` pertama dan isi `SHA256SUMS` (hanya hash dan nama file).
3. `ls -la backups/<stamp>`: pemilik dan mode `-rw-------`.
4. Setelah cron berjalan minimal dua hari: dua baris `backup: ok` di `backup.log`.

## 5. Latihan restore

Restore tidak boleh diarahkan ke staging maupun ke stack lokal pengembangan bersama, karena keduanya akan tertimpa. Pakai stack Supabase sekali pakai:

1. Di mesin yang punya Supabase CLI dan Docker, buat direktori kosong, jalankan `supabase init`, lalu ubah `project_id` dan semua port di `supabase/config.toml` agar tidak bentrok dengan stack lain. Kemudian jalankan `supabase start`.
2. Salin satu direktori backup ke mesin itu, periksa dengan `sha256sum -c SHA256SUMS`, lalu `gunzip` ketiga file.
3. Restore sesuai dokumentasi Supabase:

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname 'postgresql://postgres:postgres@127.0.0.1:<port db>/postgres'
   ```

4. Periksa: tabel migration WorkPulse di `public` dan `internal` ada, hitungan `auth.users` dan `public.profiles` sama dengan staging saat backup dibuat, dan `select * from public.get_operational_health()` berjalan.
5. Hentikan dan hapus stack sekali pakai (`supabase stop --no-backup`), lalu hapus file SQL hasil `gunzip`.
6. Catat tanggal, stamp backup, hitungan, dan hasil tiap langkah di receipt Fase 7.

Setelah restore ke lingkungan yang dipakai pengguna, prosedur penerapan ulang penghapusan akun di [runbook rilis §7](T25-release-runbook.md) tetap wajib.

## 6. Batas yang tetap terbuka

- File Storage tidak di-backup. Kehilangan proyek Supabase berarti evidence dan file CV hilang meski barisnya dapat dipulihkan.
- Salinan hanya ada di satu disk. Salinan terenkripsi di luar server belum dirancang.
- Copy S12 menjanjikan backup kedaluwarsa ≤ 30 hari. Janji itu bergantung pada cron di §2 langkah 5 tetap berjalan.

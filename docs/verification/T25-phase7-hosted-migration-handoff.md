# Handoff T25 Fase 7a · Migrasi Supabase hosted ke staging

> **Untuk agen pelaksana (ChatGPT):**
> - Kerjakan langkah secara berurutan dan centang checkbox yang selesai.
> - Baca §2 (stop conditions) sebelum menyentuh proyek hosted. Bila ragu, berhenti dan laporkan; jangan berimprovisasi.
> - Jangan mengubah kode, migration, test, atau `supabase/config.toml`. Tugas ini hanya menerapkan dan memverifikasi.
> - Jangan pernah mencetak, menyalin ke chat, atau menulis ke file: access token, password database, secret key, atau JWT.

- Tanggal: 11 Oktober 2026.
- Eksekutor: ChatGPT (ditunjuk pengguna). Reviewer: Claude (Opus), read-only atas receipt.
- Commit acuan: HEAD branch `claude/clever-archimedes-gbu7qd` yang memuat dokumen ini. Migration terakhir `20261012090000_t25_operational_health.sql`, total **36**.
- Acuan wajib: [runbook rilis §3](T25-release-runbook.md) (langkah 1–3), [checklist](T25-release-checklist.md), [kebutuhan Fase 7](T25-phase7-staging.md), [T23 retention runbook §3](T23-retention-runbook.md).
- Status T25 sekarang: **PARTIAL**. Tugas ini menutup sebagian Fase 7; T25 tetap PARTIAL sampai seluruh Fase 7 dan retensi backup terbukti.

## 1. Scope

Dalam scope:

1. Skema: 36 migration ke proyek **staging** lewat `supabase db push`.
2. Bucket `workpulse-private` dari `config.toml` lewat `supabase seed buckets --linked`.
3. Konfigurasi Auth hosted: Site URL, redirect, konfirmasi email, rate limit, dan dua template email, diatur di dashboard. **Bukan** lewat `config push`.
4. Verifikasi read-only: parity, katalog (`release_catalog.test.sql`), tipe, bucket, `ops:check`.
5. Pencatatan retensi backup paket proyek (read-only, dari dashboard dan dokumentasi resmi).

Di luar scope (kecuali pengguna menulis perluasan scope di chat):

- Deploy web dan worker, smoke Auth email, scanner, renderer, export, penghapusan akun, p95 (sisa Fase 7).
- Proyek production atau proyek apa pun yang berisi data pengguna nyata.
- Mengubah file repo selain receipt di §5.

## 2. Stop conditions

Berhenti, jangan lanjutkan langkah berikutnya, dan laporkan ke pengguna bila:

- Tidak ada **otorisasi tertulis dari pengguna di chat ChatGPT** yang menyebut proyek staging itu (nama atau ref) dan mengizinkan migrate dan pengaturan Auth/Storage.
- Proyek target bukan proyek staging khusus, atau berisi data pengguna nyata.
- `migration list` sebelum push menunjukkan versi di remote yang **tidak ada** di `supabase/migrations/` lokal, atau urutan berbeda.
- `db push --dry-run` akan menerapkan sesuatu selain migration yang belum ada di remote, atau CLI meminta `--include-all`.
- Perintah apa pun meminta reset, drop, atau repair riwayat migration.
- `config diff` atau langkah lain akan menulis nilai lokal (`127.0.0.1`, `localhost`, rate limit 30) ke proyek hosted.
- Sebuah check di §4 gagal. Jangan "memperbaiki" dengan SQL manual, edit migration, atau mengubah test.
- Secret muncul di output yang akan disalin ke receipt.

## 3. Larangan tetap

- Jangan menjalankan reset database pada proyek hosted, dan jangan mengedit migration yang sudah ada.
- Jangan memakai `db push --include-seed`: `supabase/seed.sql` berisi baris `auth.users` khusus pengembangan lokal.
- Jangan memakai `db push --include-all` atau `migration repair` tanpa keputusan pengguna.
- Jangan menjalankan `supabase config push` dalam tugas ini. Nilai `config.toml` adalah nilai lokal (`site_url = "http://127.0.0.1:3000"`, redirect `127.0.0.1`/`localhost`, `sign_in_sign_ups = 30`), dan pada run non-interaktif CLI menulis tanpa konfirmasi.
- Jangan membuat akun pengguna uji di tugas ini (smoke ada di sisa Fase 7).
- Credential hanya lewat env proses: `SUPABASE_ACCESS_TOKEN` untuk CLI, `SUPABASE_DB_PASSWORD` untuk koneksi database, `SUPABASE_URL` dan `SUPABASE_SECRET_KEY` untuk `ops:check`. Pengguna yang mengisinya; jangan memintanya ditempel di chat.

## 4. Langkah

Semua perintah CLI lewat `pnpm exec supabase …` (versi devDependency repo, 2.117.0), dari root repo.

### 4.0 Persiapan

- [ ] Catat `git rev-parse HEAD` dan `git status --short`. Pastikan file di `supabase/` tidak punya perubahan lokal.
- [ ] `pnpm install --frozen-lockfile`.
- [ ] Hitung file `supabase/migrations/*.sql`: harus 36, terakhir `20261012090000_t25_operational_health.sql`.
- [ ] Catat otorisasi pengguna (kutip kalimatnya, tanpa secret), penyedia, region, dan paket proyek.

### 4.1 Tautkan proyek

- [ ] `pnpm exec supabase link --project-ref <ref>` dengan `SUPABASE_ACCESS_TOKEN` dan `SUPABASE_DB_PASSWORD` di env proses.
- [ ] `pnpm exec supabase migration list --linked`. Catat jumlah versi remote. Proyek baru: remote kosong. Bila ada versi remote yang tidak ada di lokal: **stop** (§2).

### 4.2 Skema

- [ ] `pnpm exec supabase db push --linked --dry-run`. Daftar yang akan diterapkan harus tepat versi lokal yang belum ada di remote, berurutan.
- [ ] `pnpm exec supabase db push --linked` (tanpa `--include-seed`, tanpa `--include-all`).
- [ ] `pnpm exec supabase migration list --linked`: **36 local = 36 remote**, terakhir `20261012090000`.

### 4.3 Bucket

- [ ] `pnpm exec supabase seed buckets --linked`.
- [ ] `pnpm exec supabase db query --linked "select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;"`. Harus memuat `workpulse-private`, `public = false`, `file_size_limit` 52428800 (50 MiB), MIME tepat `application/pdf`, `image/png`, `image/jpeg`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Tidak boleh ada bucket publik.

### 4.4 Konfigurasi Auth (dashboard)

- [ ] `pnpm exec supabase config diff --project-ref <ref>`. Simpan ringkasannya untuk receipt: **nama** bagian yang berbeda saja (mis. `auth.site_url`, `auth.rate_limit`), tanpa nilai yang berupa secret. Jangan menjalankan `config push`.
- [ ] Di dashboard proyek (Authentication):
  - Site URL = URL staging https yang ditetapkan pengguna (nilai `WORKPULSE_SITE_URL` staging). Bila pengguna belum menetapkannya: catat **belum diatur** dan lanjutkan; jangan memakai URL lokal.
  - Redirect URL: `<URL staging>/auth/confirm` saja. Konfirmasi dan recovery sama-sama lewat route itu.
  - Konfirmasi email: aktif.
  - Rate limit: nilai produksi yang dipilih pengguna; bukan 30 per 5 menit dari `config.toml`.
  - SMTP: catat **belum diatur** bila pengguna belum menyediakan penyedia; jangan memasang SMTP pribadi.
- [ ] Template email (Authentication › Email templates):
  - *Confirm signup*: isi `supabase/templates/confirmation.html`, subjek "Confirm your WorkPulse account".
  - *Reset password*: isi `supabase/templates/recovery.html`, subjek "Reset your WorkPulse password".
  - Pastikan link tetap `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email` dan `…&type=recovery`. Route `/auth/confirm` tidak menerima format link bawaan Supabase.

### 4.5 Verifikasi

- [ ] `pnpm exec supabase test db --linked supabase/tests/database/release_catalog.test.sql`: lulus. File berjalan dalam satu transaksi yang di-rollback; probe pelanggar tidak tersisa. Jangan menjalankan file pgTAP lain di proyek hosted. Bila gagal karena extension `pgtap` tidak dapat dibuat di proyek hosted, catat apa adanya dan jangan mengaktifkan extension secara manual; reviewer akan memutuskan pemeriksaan pengganti.
- [ ] `pnpm exec supabase gen types typescript --linked --schema public` ke file sementara di luar repo, bandingkan dengan `src/server/supabase/database.types.ts`: harus identik. Hapus file sementara.
- [ ] `pnpm exec supabase db query --linked "select has_function_privilege('anon', 'public.get_operational_health(timestamptz)', 'execute') as anon, has_function_privilege('authenticated', 'public.get_operational_health(timestamptz)', 'execute') as authenticated, has_function_privilege('service_role', 'public.get_operational_health(timestamptz)', 'execute') as service_role;"`: `false`, `false`, `true`.
- [ ] `pnpm ops:check` dengan `SUPABASE_URL` (https proyek) dan `SUPABASE_SECRET_KEY` staging di env proses: exit **0**, `status: ok`, delapan metrik 0. Keluaran aman disalin (tanpa URL atau key).

### 4.6 Retensi backup (read-only)

Ikuti T23 retention runbook §3:

- [ ] Paket proyek dan jenis backup (harian atau PITR) dari dashboard (Database › Backups).
- [ ] Retensi yang tertulis di dokumentasi resmi Supabase untuk paket itu: tautan dan tanggal akses.
- [ ] Bandingkan dengan 30 hari (janji copy S12 `account.delete.privacy`). Tulis **≤ 30 hari**, **> 30 hari**, atau **tidak dapat dipastikan**. Jangan mengubah paket atau pengaturan backup.

## 5. Receipt

Tulis ulang `docs/verification/T25-phase7-staging.md` (sekarang berstatus BLOCKED). Pertahankan bagian "Yang dibutuhkan" untuk sisa Fase 7, lalu tambahkan:

- Status: **SEBAGIAN · migrasi hosted selesai**; deploy web/worker dan smoke **belum dijalankan**.
- Otorisasi (kutipan), penyedia, region, paket, commit, versi CLI. Tanpa project ref bila pengguna menganggapnya sensitif; tanpa URL internal, key, atau password.
- Tabel command, exit code, dan hasil untuk setiap checkbox §4, termasuk output `migration list` sebelum dan sesudah (jumlah dan versi terakhir), hasil query bucket, ringkasan `config diff` (nama bagian), nilai Auth akhir (Site URL boleh ditulis bila bukan rahasia), template terpasang (ya/tidak), hasil `release_catalog`, diff tipe (kosong/tidak), privilege `get_operational_health`, keluaran `ops:check`.
- Retensi backup (§4.6) dengan tautan dan tanggal akses.
- Penyimpangan, kegagalan, dan stop condition yang terpicu, apa adanya.
- Item checklist yang **siap direview** (jangan centang BLOCKER; reviewer yang memutuskan): parity hosted, bucket dan konfigurasi Auth hosted, retensi backup.

Commit hanya file receipt, per path: `docs(t25): record hosted staging migration receipt`. Jangan ikut mengomit perubahan lain di working tree.

## 6. Fokus review Claude

- Parity 36/36 dibuktikan oleh output sebelum dan sesudah, bukan hanya pernyataan.
- Tidak ada `--include-seed`, `--include-all`, `config push`, reset, atau SQL manual yang mengubah skema.
- Bucket privat dengan nilai persis seperti `config.toml`; tidak ada bucket publik.
- Template email memakai link `token_hash`; Site URL dan redirect tidak berisi `127.0.0.1` atau `localhost`.
- Katalog hosted bersih (`release_catalog`), tipe identik, `get_operational_health` hanya `service_role`, `ops:check` exit 0.
- Klaim retensi backup punya tautan resmi dan tanggal; bila tidak dapat dipastikan, tertulis demikian.
- Receipt dan commit tanpa secret (grep `sb_secret_`, `sb_publishable_`, `eyJ`, `postgres://`, `password`).

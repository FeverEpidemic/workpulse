# T25 Runbook rilis WorkPulse v0.1

Untuk operator yang men-deploy, memeriksa, memulihkan, dan memutar balik WorkPulse. Tidak ada langkah di sini yang membaca isi karier pengguna atau menghapus data pengguna.

- Tanggal: 10 Oktober 2026
- Status: **draf operasional untuk gate M5**. Semua perintah dan angka sudah dijalankan terhadap stack lokal. **Belum ada satu pun langkah yang dijalankan terhadap layanan hosted.** Production tidak live.
- Terkait: [release checklist](T25-release-checklist.md), [retensi dan penghapusan akun](T23-retention-runbook.md), [metrik pilot](T24-pilot-metrics-runbook.md), [scanner](T10-scanner-runbook.md), [renderer DOCX](T15-renderer-runbook.md), [renderer PDF](T21-pdf-renderer-runbook.md)

## 1. Topologi

| Komponen | Peran | Catatan |
| --- | --- | --- |
| Web | Next.js, `pnpm build` lalu `pnpm start` (`next start`) | melayani UI dan route `/api/*`; hanya memegang key publik dan `SUPABASE_SECRET_KEY` server |
| Worker | proses panjang `pnpm worker:run` (satu pass: `pnpm worker:once`) | evidence scan dan cleanup, import, AI, export PDF, penghapusan akun; beberapa instance aman karena claim atomik dengan lease |
| Supabase hosted | PostgreSQL, Auth, Storage privat (bucket `workpulse-private`) | RLS di setiap tabel; semua objek lewat service role di server |
| ClamAV | pemindai malware untuk evidence dan impor | TCP clamd, hanya jaringan privat (runbook T10) |
| Gotenberg DOCX | jumlah halaman DOCX untuk impor | kontainer sendiri, jaringan privat (runbook T15) |
| Gotenberg PDF | render PDF export CV | kontainer sendiri, terpisah dari DOCX (runbook T21) |
| Penyedia AI | opsional, hanya dari worker | tanpa key, mode `unavailable`: job gagal dengan kode yang dapat diulang dan jalur manual tetap berfungsi |

`/api/health` hanya liveness. Kesiapan dan backlog dibaca dengan `pnpm ops:check` (bagian 5).

## 2. Variabel lingkungan

Setiap variabel di `.env.example` ada di tabel ini, dan sebaliknya (dijaga `tests/unit/release-docs.test.ts`). Nilai rahasia tidak pernah ditulis di dokumen atau repo. Default aman adalah fail-closed: tanpa konfigurasi, dependensi dianggap tidak tersedia.

| Variabel | Proses | Jenis | Default | Sumber dan catatan |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | web | publik | kosong | URL proyek Supabase; ikut build |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web | publik | kosong | key publishable (`sb_publishable_…`); ikut build |
| `SUPABASE_URL` | web dan worker | konfigurasi | kosong | URL proyek; server saja. https, atau http hanya untuk localhost |
| `SUPABASE_SECRET_KEY` | web dan worker | rahasia | kosong | key secret server (`sb_secret_…`); tidak boleh sampai ke browser (diuji: pemindaian bundle) |
| `WORKPULSE_SITE_URL` | web | konfigurasi | `http://127.0.0.1:3000` | origin tepercaya untuk redirect Auth dan pemeriksaan Origin; wajib diisi domain sebenarnya |
| `DATABASE_URL` | tes | rahasia | kosong | tidak dibaca aplikasi; migrasi hosted memakai `supabase db push` |
| `WORKPULSE_AUTH_GOOGLE_ENABLED` | web | konfigurasi | `false` | T29: hanya nilai persis `true` yang menampilkan tombol Google; nyalakan setelah provider hosted lulus smoke (`T29-google-oauth-runbook.md`) |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | tes (Supabase CLI lokal) | konfigurasi | kosong | dibaca `pnpm db:start` untuk `[auth.external.google]`; hosted memakai dashboard Supabase, bukan variabel ini |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | tes (Supabase CLI lokal) | rahasia | kosong | pasangan client ID di atas; jangan pernah di-commit |
| `WORKPULSE_WORKER_ID` | worker | konfigurasi | kosong | tidak dibaca kode v0.1 (dicadangkan) |
| `LOG_LEVEL` | worker | konfigurasi | info | tidak dibaca kode v0.1 (dicadangkan) |
| `NODE_ENV` | web dan worker | konfigurasi | production | mode `fake` untuk scanner, AI, dan renderer hanya diterima di `development` atau `test`; jangan set di production |
| `WORKPULSE_SCANNER_MODE` | worker | konfigurasi | unavailable | `clamav` untuk produksi; `unavailable` membuat evidence dan impor gagal tertutup |
| `WORKPULSE_CLAMD_HOST` | worker | konfigurasi | 127.0.0.1 | host clamd di jaringan privat |
| `WORKPULSE_CLAMD_PORT` | worker | konfigurasi | 13310 | port clamd |
| `WORKPULSE_CLAMD_TIMEOUT_MS` | worker | konfigurasi | 15000 | batas waktu pemindaian |
| `WORKPULSE_WORKER_POLL_INTERVAL_MS` | worker | konfigurasi | 5000 | 250 sampai 60000; di luar itu worker menolak start |
| `WORKPULSE_AI_MODE` | worker | konfigurasi | unavailable | `openai-compatible` memerlukan key dan model; `fake` hanya development dan test |
| `WORKPULSE_OPENAI_BASE_URL` | worker | konfigurasi | kosong | https (http hanya localhost); memilih pemroses AI |
| `WORKPULSE_OPENAI_API_KEY` | worker | rahasia | kosong | simpan di `.env.ai.local` atau secret host worker, bukan di env web |
| `WORKPULSE_AI_MODEL` | worker | konfigurasi | kosong | nama model |
| `WORKPULSE_AI_API` | worker | konfigurasi | chat_completions | atau `responses` |
| `WORKPULSE_AI_STRUCTURED_OUTPUT` | worker | konfigurasi | json_schema | atau `json_object` |
| `WORKPULSE_DOCX_RENDERER_MODE` | worker | konfigurasi | unavailable | `gotenberg` untuk produksi; `unavailable` membuat impor DOCX gagal dan dapat diulang |
| `WORKPULSE_GOTENBERG_URL` | worker | konfigurasi | kosong | Gotenberg DOCX, jaringan privat |
| `WORKPULSE_DOCX_RENDER_TIMEOUT_MS` | worker | konfigurasi | 30000 | batas waktu render DOCX |
| `WORKPULSE_PDF_RENDERER_MODE` | worker | konfigurasi | unavailable | `gotenberg` untuk produksi; `unavailable` membuat export gagal dan dapat diulang |
| `WORKPULSE_PDF_GOTENBERG_URL` | worker | konfigurasi | kosong | Gotenberg PDF, jaringan privat, terpisah dari DOCX |
| `WORKPULSE_PDF_RENDER_TIMEOUT_MS` | worker | konfigurasi | 60000 | batas waktu render PDF |
| `WORKPULSE_ALERT_DELETION_OVERDUE` | ops | konfigurasi | 0 | alert bila `account_deletion_overdue` di atas nilai ini |
| `WORKPULSE_ALERT_CLEANUP_FAILED` | ops | konfigurasi | 0 | untuk `storage_cleanup_failed` |
| `WORKPULSE_ALERT_CLEANUP_OVERDUE` | ops | konfigurasi | 0 | untuk `storage_cleanup_overdue` |
| `WORKPULSE_ALERT_IMPORT_PURGE_OVERDUE` | ops | konfigurasi | 0 | untuk `import_purge_overdue` |
| `WORKPULSE_ALERT_EXPORT_PURGE_OVERDUE` | ops | konfigurasi | 0 | untuk `export_purge_overdue` |
| `WORKPULSE_ALERT_EVIDENCE_STUCK` | ops | konfigurasi | 0 | untuk `evidence_stuck` |
| `WORKPULSE_ALERT_JOBS_FAILED_24H` | ops | konfigurasi | 20 | untuk `jobs_failed_24h` |
| `WORKPULSE_ALERT_JOBS_EXPIRED_LEASE` | ops | konfigurasi | 0 | untuk `jobs_expired_lease` |

Proses web tidak membutuhkan, dan sebaiknya tidak menerima, variabel `WORKPULSE_AI_*`, `WORKPULSE_OPENAI_*`, `WORKPULSE_DOCX_*`, `WORKPULSE_GOTENBERG_*`, `WORKPULSE_PDF_*`, scanner, dan alert. Konfigurasi E2E di repo menyaringnya dari server web; di deploy, jangan memasangnya pada proses web.

## 3. Deploy

Urutan: **migrate → worker → web**. Migrate mencakup langkah 1 sampai 3: skema, pemeriksaan bucket, dan konfigurasi Auth. Build dari lockfile (`pnpm install --frozen-lockfile`).

1. **Migrate.** Dari mesin operator dengan Supabase CLI (versi devDependency repo) yang sudah login, pada proyek yang sudah ditautkan dengan `supabase link --project-ref <ref>`:
   - `supabase migration list` (bandingkan lokal dan remote), lalu `supabase db push`;
   - ulangi `migration list`: jumlah dan versi terakhir harus sama (36 migration, terakhir `20261012090000`);
   - migration yang sudah diterapkan tidak pernah diedit, dan database proyek hosted tidak pernah diatur ulang.
2. **Bucket.** Migration T05 (`20260917090000_t05_private_storage_foundation.sql`) membuat bucket `workpulse-private` (privat, 50 MiB, PDF/PNG/JPEG/DOCX) dan `supabase/config.toml` mendeklarasikan nilai yang sama.
   - `supabase seed buckets --linked` tidak wajib; aman dijalankan karena hanya menyelaraskan nilai yang sama;
   - periksa dengan service role: `select id, public, file_size_limit, allowed_mime_types from storage.buckets;` harus memuat `workpulse-private` dengan `public = false` dan nilai yang sama dengan `config.toml`.
3. **Konfigurasi Auth dan API.** `config.toml` berisi nilai untuk pengembangan lokal (`site_url = "http://127.0.0.1:3000"`, redirect lokal, rate limit `sign_in_sign_ups = 30`). `supabase config push` menulis semua nilai yang dideklarasikan file itu, dan pada run non-interaktif (`--yes`, tanpa TTY, atau dijalankan agen) **langsung menulis tanpa konfirmasi**.
   - Jangan menjalankan `supabase config push` tanpa `supabase config diff` lebih dulu, dan jangan menjalankannya sama sekali bila diff memuat nilai lokal.
   - Atur di dashboard proyek: Site URL = `WORKPULSE_SITE_URL` (https); redirect URL `<WORKPULSE_SITE_URL>/auth/confirm` (konfirmasi dan recovery sama-sama lewat route ini, yang lalu mengarah ke `/update-password`); konfirmasi email aktif; SMTP nyata; rate limit produksi.
   - Pasang template email **Confirm signup** dan **Reset password** dari `supabase/templates/confirmation.html` dan `recovery.html`, dengan subjek dari `config.toml`. Route `/auth/confirm` hanya menerima link `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…`; template bawaan proyek hosted memakai format lain, sehingga tanpa langkah ini verifikasi email dan recovery gagal.
   - Catat nilai akhirnya (tanpa secret) di receipt.
4. **Worker.** Jalankan versi baru, lalu `pnpm worker:check` (JSON `status: ready`) dan satu `pnpm worker:once`. Hentikan instance lama dengan SIGTERM; pass yang berjalan selesai dulu dan lease yang tersisa diambil instance lain.
5. **Web.** `pnpm build`, `pnpm start`, lalu `GET /api/health` harus `200` dengan `Cache-Control: no-store` dan body `{"status":"ok","service":"workpulse-web","version":…}`.
6. **Verifikasi.** `pnpm ops:check` (bagian 5) harus exit 0.

Sebelum deploy pertama ke proyek hosted: daftar BLOCKER di release checklist harus punya bukti, dan pemilik produk memberi otorisasi tertulis untuk lingkungan itu.

## 4. Worker

- Satu proses cukup; beberapa instance aman. Claim memakai lease 120 detik dan token percobaan, jadi pekerjaan tidak diproses dua kali dan pekerjaan instance yang mati diambil setelah lease habis.
- Restart tidak kehilangan pekerjaan: antrean ada di database.
- Henti anggun dengan SIGINT atau SIGTERM.
- `pnpm worker:check` hanya mencetak bootstrap (tidak menghubungi dependensi). Satu pass nyata: `pnpm worker:once`; keluarannya satu baris JSON berisi hitungan, tanpa teks pengguna.
- Dependensi yang tidak tersedia tidak menghentikan pass lain: setiap domain diisolasi dan melaporkan `unavailable`.

## 5. Pemeriksaan kesehatan

| Pemeriksaan | Perintah | Arti |
| --- | --- | --- |
| Liveness web | `GET /api/health` | proses web melayani; tidak menyentuh dependensi |
| Worker | `pnpm worker:check`, `pnpm worker:once` | bootstrap; satu pass dan ringkasan |
| Backlog dan kegagalan | `pnpm ops:check` | satu baris JSON; exit 0 semua di dalam ambang, **2** ada alert, **1** pemeriksaan tidak dapat berjalan |

`pnpm ops:check` membaca `get_operational_health()` dengan `SUPABASE_URL` dan `SUPABASE_SECRET_KEY` dari host worker dan membandingkan dengan ambang di tabel variabel. Jalankan dari cron atau monitor setiap 5 menit dan kirim exit selain 0 ke kanal yang dipilih operator (email atau chat); pengiriman notifikasi bukan bagian aplikasi. Keluaran tidak memuat URL, key, atau teks pengguna dan aman disalin ke tiket.

| Metrik | Alert bila | Tindakan |
| --- | --- | --- |
| `account_deletion_overdue` | ada penghapusan akun lewat 24 jam | ikuti [T23 §2](T23-retention-runbook.md): `select … from internal.account_deletions where status <> 'completed'`, lihat `last_error_code`, pastikan worker hidup |
| `storage_cleanup_failed` | ada job cleanup `failed` | periksa `error_code`; `INVALID_OBJECT_KEY` perlu tindakan manual, selain itu pass worker akan mengulang |
| `storage_cleanup_overdue` | job cleanup menunggu lebih dari 24 jam | worker mati atau Storage tidak tersedia; periksa worker dan layanan Storage |
| `import_purge_overdue` | file impor dan teks staging tidak dihapus 24 jam setelah terminal | jalankan `pnpm worker:once`; bila bertahan, periksa job cleanup impor (PRD: data minimization ≤ 24 jam) |
| `export_purge_overdue` | PDF export tidak dihapus 24 jam setelah sukses | sama; periksa job cleanup export |
| `evidence_stuck` | file `uploading` atau `scanning` lebih dari 1 jam | pemindai tidak tersedia atau worker mati; periksa ClamAV dan `WORKPULSE_SCANNER_MODE` |
| `jobs_failed_24h` | lebih dari 20 job AI, export, atau impor gagal dalam 24 jam | lihat `error_code` agregat; penyedia AI atau renderer bermasalah |
| `jobs_expired_lease` | lease job habis lebih dari 10 menit | worker mati di tengah pass atau macet; restart worker |

Tidak ada metrik yang membaca isi catatan, CV, atau nama file.

## 6. Rollback

Rollback tidak pernah menghapus data pengguna.

- **Aplikasi (web dan worker).** Deploy ulang build sebelumnya dari lockfile dan tag-nya. Ini aman hanya bila migration sejak build itu **aditif dan kompatibel mundur** (kolom, fungsi, dan tabel baru yang tidak dibaca build lama). Periksa daftar migration di antara dua build sebelum memutuskan.
- **Skema.** Migration yang sudah diterapkan tidak di-revert dan tidak diedit. Bila skema berisi data pengguna, jalan keluarnya adalah **forward fix** (perbaikan maju): migration baru yang memperbaiki masalah, diuji dengan membangun ulang dari nol di stack lokal sekali pakai, lalu `db push`.
- **Tidak ada** langkah rollback yang menghapus tabel, mengosongkan tabel, atau mengatur ulang database proyek hosted.
- Setelah rollback aplikasi, jalankan `pnpm ops:check` dan satu `pnpm worker:once`.

## 7. Backup dan restore

Status klaim (jujur, dari [T23 §1](T23-retention-runbook.md)):

| Klaim | Status |
| --- | --- |
| Baris dan objek akun dihapus ≤ 24 jam setelah permintaan | terbukti lokal sebagai mekanisme; ukur di hosted dengan `ops:check` |
| Salinan backup yang memuat data pengguna kedaluwarsa ≤ 30 hari | **belum terverifikasi** (copy S12 menjanjikannya) |
| Penghapusan dapat diterapkan ulang setelah restore | terbukti lokal sebagai prosedur (di bawah); **belum diuji terhadap restore hosted** |

**Verifikasi retensi backup (wajib sebelum production).** Ikuti [T23 §3](T23-retention-runbook.md): catat paket dan jenis backup (harian atau PITR), retensi yang tertulis di dokumentasi resmi Supabase beserta tautan dan tanggal akses, bandingkan dengan 30 hari. Bila lebih panjang, ubah copy S12 `account.delete.privacy` atau konfigurasi sebelum rilis. Simpan hasilnya di dokumen verifikasi.

**Prosedur penghapusan setelah restore.** Receipt penghapusan disimpan 30 hari setelah `completed` (decision 0029), sama dengan batas retensi backup yang dijanjikan. Syarat prosedur ini: retensi backup ≤ 30 hari **terverifikasi**. Bila retensi lebih panjang, prosedur tidak cukup dan restore produksi memerlukan persetujuan pemilik produk.

1. **Sebelum restore**, dari database yang sedang berjalan, simpan di luar database daftar user id dengan `requested_at` setelah titik restore:
   ```sql
   select user_id, requested_at
   from internal.account_deletions
   where requested_at > '<titik restore>'::timestamptz
   order by requested_at, user_id;
   ```
   Daftar ini hanya berisi UUID dan waktu.
2. Lakukan restore.
3. **Sesudah restore**, untuk setiap user id di daftar, sebagai service role: `select public.begin_account_deletion('<user_id>'::uuid);`. Jawaban `P0002` berarti id itu tidak ada di database hasil restore (akun dibuat setelah titik restore atau sudah terhapus): lewati.
4. Jalankan `pnpm worker:once` sampai `pnpm ops:check` exit 0 dan receipt tiap id `completed`.

Prosedur ini dibuktikan oleh `tests/integration/release-restore.test.ts` (akun dengan data dan objek, receipt dan penanda `deleting` dikembalikan ke keadaan sebelum permintaan, penghapusan berjalan ulang sampai `completed`).

**Objek Storage tidak ikut restore.** Restore database memulihkan baris, bukan objek di bucket. Setelah restore, baris dapat merujuk objek yang sudah dihapus. Test di atas memakai objek yang masih ada, jadi perilaku cleanup dan penghapusan akun untuk objek yang hilang **belum diuji terhadap restore hosted**. Setelah langkah 4, periksa `storage_cleanup_failed` dan `account_deletion_overdue` di `pnpm ops:check`; bila salah satunya naik, lihat `error_code` job sebelum mengulang.

## 8. Insiden privasi

Bila ada dugaan kebocoran data, key, atau akses lintas akun:

1. Hentikan worker bila ada dugaan pemrosesan yang salah; web tetap dapat dibiarkan atau dibatasi di tingkat host.
2. **Cabut dan putar** `SUPABASE_SECRET_KEY` dan, bila terlibat, `WORKPULSE_OPENAI_API_KEY`. Putar secret JWT proyek bila key lama pernah berada di browser, log, atau repo. Deploy ulang web dan worker dengan key baru.
3. Catat waktu, komponen, dan akun yang terdampak **dengan id saja**. Jangan menyalin catatan, teks CV, nama file, atau isi evidence ke tiket atau chat.
4. Jalankan `pnpm test:integration:release` terhadap stack lokal dari commit yang sama untuk memeriksa bahwa isolasi dua akun masih lulus, dan `pnpm ops:check` untuk backlog.
5. Pemberitahuan kepada pengguna dan kewajiban hukum adalah keputusan pemilik produk; runbook ini tidak menggantikannya.

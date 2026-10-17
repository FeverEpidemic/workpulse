# T25 Fase 7 · Verifikasi staging

- Tanggal pemeriksaan hosted: 11 Oktober 2026.
- Status: **SEBAGIAN · migrasi hosted selesai, SMTP dan template terpasang**. Repair riwayat, parity 36/36, bucket, katalog, privilege health, dan ops terbukti. URL Auth tersimpan; konfirmasi email aktif. SMTP MXroute diatur pengguna pada 16 Oktober 2026; dua template terpasang dan kiriman nyata diterima di Gmail setelah DNS email diperbaiki (lihat [Lanjutan 16 Oktober](#lanjutan-16-oktober-2026-smtp-template-dan-kiriman-nyata)). Pada 17 Oktober 2026 web dan worker berjalan di server pribadi dan smoke §8 lulus kecuali recovery dari klien email, yang diperbaiki di PR #19 dan belum diuji ulang di staging (lihat [Lanjutan 17 Oktober](#lanjutan-17-oktober-2026-deploy-server-pribadi-dan-smoke)). Retensi backup belum dapat dipastikan.
- Eksekutor pemeriksaan ini: ChatGPT, mengikuti `T25-phase7-hosted-migration-handoff.md`. Receipt awal ditulis Claude Sonnet 5.5.
- Commit acuan handoff: `cccdc43a3a0ead21e1e440ae02cd390bae72358b`; commit awal sesi lanjutan: `19a0d194dea1433df74495b81dd8ce7f0964683c`.
- Target: Supabase Workpulse, region `ap-northeast-2`, PostgreSQL 17.11, paket Free (dashboard Database Backups).
- URL staging yang ditetapkan pengguna dan tersimpan pada Auth: `https://myworkpulse.my.id`.

## Alasan

Pengguna mengizinkan pekerjaan pada project Workpulse dalam percakapan yang sedang memeriksa project itu: "Terapkan Migration, konfigurasi Staging serta verifikasi Auth, Storage, Worker dan PDF yaa". Pengguna kemudian meminta "Eksekusi ulang sesuai dengan T25-phase7-hosted-migration-handoff.md". Scope percobaan ulang mengikuti Fase 7a pada handoff tersebut.

Pemeriksaan remote memicu stop condition handoff §2: versi remote tidak ada dalam daftar versi lokal. Eksekusi sebelumnya memakai MCP `apply_migration`, yang mencatat timestamp baru untuk SQL dari tiga file lokal. Pemeriksaan ulang tidak menerapkan migration tambahan.

Setelah pelaksana meminta persetujuan repair riwayat tiga migration tanpa mengulang SQL atau reset database, pengguna menjawab "Yes dan Antislop nya During aja". Credential belum tersedia pada percobaan awal. Pengguna kemudian menulis "Env sudah dipasang. Cek keberadaan keempat variabel tanpa mencetak nilainya, lalu lanjutkan repair." Pemeriksaan boolean sesi lanjutan membuktikan keempat variabel tersedia. URL env cocok dengan target Workpulse; nilai credential tidak dicetak atau ditulis ke file.

Repair melalui CLI berhasil, diikuti dry-run dan push tepat 33 migration tersisa. Riwayat akhir memuat seluruh 36 versi lokal tanpa versi tambahan. Stop condition riwayat telah ditutup dengan otorisasi pengguna. Stop condition berikutnya terpicu pada perbandingan tipe: hosted generator menambahkan metadata PostgREST yang tidak ada di file lokal. Setelah penjelasan dampak dan rekomendasi pengecualian terbatas pada metadata tersebut serta baris kosong akhir, pengguna menjawab "Gas". Pengecualian itu diterima sebagai otorisasi untuk melanjutkan. Tidak ada perubahan source, test, atau migration; perbedaan schema selain dua selisih tersebut tetap tidak dikecualikan.

T25 tetap **PARTIAL**. Gate M5 belum dinilai ulang. Tidak ada deployment web/worker atau smoke hosted pada percobaan ulang ini.

## Bukti pemeriksaan Fase 7a

### Persiapan dan command

| Pemeriksaan atau command | Hasil aktual |
| --- | --- |
| `git rev-parse HEAD` | Exit 0; commit acuan tercatat di atas. |
| `git status --short` | Exit 0; terdapat perubahan Storybook dan dokumentasi milik pengguna. Perubahan tersebut dipertahankan. |
| `git diff --name-only -- supabase` | Exit 0; kosong. |
| Jumlah dan file migration terakhir | 36 file; `20261012090000_t25_operational_health.sql`. |
| `pnpm --version` | 11.19.0. Cache ditemukan dengan `COREPACK_HOME` yang menunjuk cache pengguna; versi tidak diubah. |
| `pnpm exec supabase --version` pada sandbox | Gagal karena `EPERM` pada `realpath` workspace. Eksekusi di luar sandbox kemudian berhasil. |
| `pnpm install --frozen-lockfile` | Exit 0, `Already up to date`, pnpm 11.19.0. |
| `pnpm exec supabase --version` | Exit 0, 2.117.0. CLI memberi pemberitahuan versi baru; upgrade tidak dilakukan. |
| `pnpm exec supabase migration repair --help` | Exit 0; flag `--linked` dan status `applied`/`reverted` tersedia. Hanya help, belum menjalankan repair. |
| Pemeriksaan boolean env proses awal | Credential belum tersedia; pemeriksaan scope pengguna Windows juga negatif. |
| Pemeriksaan boolean env proses lanjutan | `SUPABASE_ACCESS_TOKEN=true`, `SUPABASE_DB_PASSWORD=true`, `SUPABASE_URL=true`, `SUPABASE_SECRET_KEY=true`. Hanya keberadaan dicetak. |
| MCP `list_migrations` | Berhasil; 3 versi remote, seluruhnya tidak cocok dengan versi lokal. Ini bukan output CLI `migration list --linked`. |
| MCP `execute_sql`, hitungan saja | Berhasil; 0 pengguna Auth, 3 migration, 0 bucket. Tidak membaca isi karier atau membuat akun uji. |
| Perbandingan SQL tersimpan dengan file lokal | Berhasil untuk ketiga migration: panjang karakter dan MD5 identik. |
| `git diff --check -- docs/verification/T25-phase7-staging.md` | Exit 0; Git hanya memberi warning normalisasi LF menjadi CRLF. |
| Pemindaian receipt untuk key, JWT, URI koneksi, dan assignment credential | Semua pemeriksaan false; hanya nama variabel dicatat. |

### Eksekusi lanjutan setelah env tersedia

Semua CLI menggunakan pnpm 11.19.0 dan Supabase CLI 2.117.0. Output CLI disaring di memori untuk menyembunyikan credential apabila tool mencetaknya. Semua command berikut exit 0 kecuali perbandingan tipe yang dicatat khusus.

| Command | Hasil |
| --- | --- |
| `pnpm exec supabase link --project-ref <ref Workpulse>` | Berhasil menautkan staging Workpulse. |
| `pnpm exec supabase migration list --linked`, sebelum repair | 36 lokal, 3 remote; remote terakhir `20261011054746`. Ketiga versi remote ada pada tabel riwayat sebelum repair di bawah. |
| MCP query ulang panjang dan MD5 SQL remote | Tetap cocok dengan ketiga file lokal sebelum repair. |
| `pnpm exec supabase migration repair --linked --status applied 20260916090000 20260916120000 20260916124500` | Ketiga versi lokal tercatat applied; hanya tracking riwayat berubah. |
| `pnpm exec supabase migration repair --linked --status reverted 20261011054646 20261011054733 20261011054746` | Tracking tiga versi MCP dihapus; tidak menjalankan SQL skema ulang. Penyimpangan repair telah disetujui pengguna. |
| `pnpm exec supabase migration list --linked`, setelah repair | 36 lokal, 3 remote yang cocok: `20260916090000`, `20260916120000`, `20260916124500`; 33 pending, tanpa versi remote tambahan. |
| `pnpm exec supabase db push --linked --dry-run` | Tepat 33 file lokal pending, dari `20260916150000_auth_onboarding_locale_timezone.sql` sampai `20261012090000_t25_operational_health.sql`, berurutan. Output `seeds=[]`, `roles=[]`; tidak meminta include-all. |
| `pnpm exec supabase db push --linked` | Semua 33 file di atas diterapkan, tanpa seed. |
| `pnpm exec supabase migration list --linked`, setelah push | Seluruh 36 baris memiliki versi lokal = remote; pertama `20260916090000`, terakhir `20261012090000`. |
| `pnpm exec supabase seed buckets --linked` | `buckets_updated=[workpulse-private]`; tidak mengunggah objek. Bucket telah dibuat oleh migration T05 aktual di checkout ini. |
| `pnpm exec supabase db query --linked`, query bucket pada handoff §4.3 | Satu bucket `workpulse-private`, `public=false`, limit 52428800; MIME persis PDF, PNG, JPEG, DOCX. Tidak ada bucket publik. |
| `pnpm exec supabase config diff --project-ref <ref Workpulse>` | Exit 0; 15 perubahan. Pemeriksaan lanjutan berhasil mencetak hanya path bagian (di bawah), tanpa nilai. Tidak menjalankan config push. |
| Dashboard Workpulse | Awalnya meminta login; pengguna kemudian menulis "udah login di browser codex nya ya". Dashboard menampilkan Healthy dan migration terakhir `t25_operational_health`. Pengaturan Auth kemudian diperiksa dan URL disimpan, sebagaimana bagian di bawah. |
| `pnpm exec supabase test db --linked supabase/tests/database/release_catalog.test.sql` | PASS, 1 file, 26 assertion. Extension pgtap sudah tersedia. Semua probe dijalankan dalam transaksi rollback. Tidak menjalankan pgTAP lain. |
| `pnpm exec supabase gen types typescript --linked --schema public` | Generator exit 0. Output disimpan sementara di luar repo, dibandingkan, lalu dihapus. |
| Perbandingan tipe setelah normalisasi CRLF ke LF | **FAIL**, wrapper exit 2. Hosted 82391 karakter, lokal 82184 karakter. |
| `git diff --no-index`, file tipe lokal vs hasil generate hosted | Exit diff 1, menunjukkan hanya metadata `__InternalSupabase.PostgrestVersion` dan satu baris kosong akhir berbeda. Wrapper diagnostik exit 0; kedua file sementara dihapus. |
| `pnpm exec supabase db query --linked`, query privilege health handoff §4.5 | Exit 0; `anon=false`, `authenticated=false`, `service_role=true`. |
| `pnpm ops:check` | Exit 0; `status=ok`, delapan metrik bernilai 0, seluruh `alert=false`. Env staging memiliki prioritas atas `.env.local` yang dibaca script. |

### Kegagalan check tipe dan batas diagnosis

Hosted generator menambahkan properti berikut pada `Database` sebelum `public`, beserta dua komentar generator:

```ts
__InternalSupabase: {
  PostgrestVersion: "14.18"
}
```

Diff juga menghapus satu baris kosong terakhir. Tidak ada perbedaan pada definisi `public` dalam diff lengkap. Hasil mentah tetap **tidak identik** menurut handoff §4.5. Pengguna telah menyetujui pengecualian spesifik setelah penjelasan dampak; hasil tidak dilabeli sebagai diff kosong. File lokal tidak diubah. Check privilege health dan `ops:check` kemudian lulus.

### Konfigurasi Auth dan ops setelah pengecualian

| Item | Hasil akhir yang teramati |
| --- | --- |
| Site URL | `https://myworkpulse.my.id`, disimpan melalui dashboard. Save changes kembali disabled setelah persist. |
| Redirect URL | Tepat satu: `https://myworkpulse.my.id/auth/confirm`, disimpan melalui dashboard dan terdaftar pada halaman. Tidak ada localhost atau wildcard. |
| Konfirmasi email | Switch Confirm email aktif; email provider Enabled. Tidak mengubah setting yang sudah aktif. |
| Rate limit signup/sign-in | Hosted menunjukkan 30 request/5 menit/IP; token refresh 150/5 menit/IP, verifikasi token 30/5 menit/IP. Tidak ada nilai diubah. Pelaksana menyatakan akan mempertahankan nilai hosted karena pengguna belum menentukan batas khusus; keputusan nilai production tetap terbuka. Kesamaan angka dengan config lokal bukan akibat config push. |
| SMTP | Belum diatur. Pengguna menjawab: "mxroute SMTP dan itu nanti biar gue aja yang setting SMTP nya". Halaman SMTP disiapkan di browser; pelaksana tidak memasukkan credential atau memasang provider lain. |
| Confirm signup template | Belum terpasang. Dashboard meminta custom SMTP untuk mengedit subjek dan isi. File lokal dan subjek yang ditentukan handoff sudah dibaca, tetapi tidak disimpan ke hosted. |
| Reset password template | Belum terpasang, dengan blocker SMTP yang sama. Link `token_hash` dalam template repo masih menunggu pemasangan hosted. |
| Bukti screenshot URL Auth | Disimpan di direktori artifact Codex di luar repo; URL dan satu redirect yang sudah persist terlihat. Tidak berisi key. |

Pembatasan template ini sesuai [changelog Supabase 3 Juni 2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier), diakses 11 Oktober 2026: project Free baru yang memakai email bawaan tidak dapat mengubah template, sementara custom SMTP memungkinkan customization. Tidak meng-upgrade paket atau membuat Send Email hook sebagai pengganti.

Path `config diff` yang teramati setelah URL Auth disimpan: `auth.additional_redirect_urls`, `auth.email.max_frequency`, `auth.email.otp_length`, `auth.email.template.confirmation.subject`, `auth.email.template.recovery.subject`, `auth.mfa.totp.enroll_enabled`, `auth.mfa.totp.verify_enabled`, `auth.minimum_password_length`, `auth.password_requirements`, `auth.site_url`, `auth.sms.twilio.enabled`, `db.pooler.default_pool_size`, `db.pooler.max_client_conn`, `storage.analytics.enabled`, `storage.image_transformation.enabled`. Nilai dari config lokal tidak diterapkan massal.

Output `ops:check` tanpa konten:

| Metrik | Nilai | Ambang | Alert |
| --- | --- | --- | --- |
| account_deletion_overdue | 0 | 0 | false |
| storage_cleanup_failed | 0 | 0 | false |
| storage_cleanup_overdue | 0 | 0 | false |
| import_purge_overdue | 0 | 0 | false |
| export_purge_overdue | 0 | 0 | false |
| evidence_stuck | 0 | 0 | false |
| jobs_failed_24h | 0 | 20 | false |
| jobs_expired_lease | 0 | 0 | false |

### Backup dan retensi

Dashboard Database Backups menyatakan Free Plan tidak mencakup project backups; tab Point in time menyatakan PITR adalah add-on Pro. Paket tidak diubah. Scheduled backups dan PITR tidak tersedia bagi project Free ini.

[Dokumentasi resmi Database Backups](https://supabase.com/docs/guides/platform/backups), diakses 11 Oktober 2026, menyebut backup harian bagi Pro/Team/Enterprise dan merekomendasikan export off-site untuk Free. Dokumen tersebut tidak memberikan angka retensi backup untuk paket Free yang dapat dipakai membuktikan janji S12 pada project ini. Backup manual/off-site tidak dibuat atau diperiksa dalam task ini. Kesimpulan retensi **tidak dapat dipastikan**; bukan bukti retensi 0 hari atau bukti ≤30 hari. BLOCKER backup tetap terbuka.

Dokumen handoff menyatakan bucket hanya berasal dari config; SQL migration T05 aktual juga membuatnya. Bukti `seed buckets` berupa update, lalu query nilai bucket lulus. Dokumen sumber tidak diubah dalam scope receipt ini.

### Riwayat sebelum repair

| Versi remote | Nama remote | Versi lokal yang sesuai | Karakter SQL | MD5 remote dan lokal |
| --- | --- | --- | --- | --- |
| `20261011054646` | `20260916090000_foundation_schema` | `20260916090000` | 20888 | `9c043fb1149cbc2f1447fe04dcc84aa0` |
| `20261011054733` | `20260916120000_secure_foundation_mutations` | `20260916120000` | 16942 | `740b83842b51666dd9e9998a5ca89a65` |
| `20261011054746` | `20260916124500_fix_foundation_rpc_row_checks` | `20260916124500` | 4901 | `8f769dfc47cd12f0d4fc79889524cee3` |

Setiap baris remote menyimpan satu elemen `statements` berisi SQL yang panjang dan hash-nya cocok dengan file lokal. Karena tiga perubahan skema sudah diterapkan, langkah pemulihan yang disetujui hanya mengubah tracking riwayat. SQL migration tersebut tidak boleh diterapkan ulang.

### Checkpoint handoff

- [x] Commit, working tree, jumlah migration, dan tidak adanya perubahan lokal pada `supabase/` diperiksa.
- [x] `pnpm install --frozen-lockfile` lulus.
- [x] Otorisasi pengguna, region, dan paket Free dicatat.
- [x] Isi tiga migration remote dibandingkan dengan file lokal sebelum repair.
- [x] Credential CLI staging tersedia di env proses; `link` dan `migration list --linked` dijalankan.
- [x] Repair CLI yang disetujui dijalankan dan diverifikasi. Repair mengubah riwayat saja.
- [x] `db push --linked --dry-run` menunjukkan tepat 33 migration tersisa, berurutan.
- [x] `db push --linked` dan parity akhir 36/36 terbukti.
- [x] `seed buckets --linked` dan query bucket terbukti sesuai handoff.
- [x] `config diff` diperiksa dan hanya nama path dicatat; tanpa config push.
- [x] Site URL dan satu redirect staging disimpan; konfirmasi email terverifikasi aktif.
- [ ] Rate limit production dipilih pengguna; nilai hosted saat ini dipertahankan.
- [x] SMTP MXroute diatur pengguna dan dua template Auth dipasang melalui dashboard (16 Oktober 2026, bagian lanjutan di bawah).
- [x] `release_catalog.test.sql` lulus, 26 assertion.
- [x] Perbandingan tipe ditinjau; pengecualian metadata generator dan baris kosong akhir disetujui pengguna. Diff mentah tetap tidak kosong.
- [x] Privilege health dan `ops:check` lulus.
- [x] Paket dan ketersediaan backup diperiksa dari dashboard serta dokumentasi resmi. Retensi ≤30 hari **tidak dapat dipastikan**; blocker belum ditutup.

Tidak ada reset, drop, `db push --include-seed`, `db push --include-all`, `config push`, atau SQL manual yang mengubah skema pada percobaan ulang ini. Skema hanya berubah melalui db push; repair riwayat memakai CLI dengan persetujuan pengguna. Tidak ada akun uji dibuat. Tidak ada secret ditulis ke receipt.

Parity hosted, bucket privat, katalog hosted, pengecualian tipe, privilege health, ops, dan konfigurasi URL Auth siap direview. SMTP, dua template, pilihan rate limit production, retensi backup, dan sisa smoke Fase 7 belum selesai. BLOCKER release tidak dicentang oleh pelaksana.

## Lanjutan 16 Oktober 2026: SMTP, template, dan kiriman nyata

- Pelaksana: Claude (Opus 5.5). Pengguna memasang SMTP MXroute sendiri lalu menulis "Nah di Supabase udah gue setting SMTP nya nih", kemudian "lanjut pasang template" setelah login dashboard di browser pane.
- Alamat uji dipilih pengguna: "kirim aja ke inbox <alamat Gmail pengguna>". Alamat tidak ditulis di receipt. Pengguna mengizinkan akun uji dibuat di staging lalu dihapus.

| Item | Hasil |
| --- | --- |
| SMTP | Tab SMTP Settings menampilkan custom SMTP dengan password tersimpan. Pelaksana tidak membaca, mengubah, atau mencatat host, username, maupun password. |
| Confirm sign up | Subjek `Confirm your WorkPulse account`; isi diketik dari `supabase/templates/confirmation.html`. Isi editor dibaca balik sebelum simpan dan identik dengan file. Dashboard: "Successfully updated email template". Setelah reload, subjek dan isi tetap sama. |
| Reset password | Subjek `Reset your WorkPulse password`; isi dari `supabase/templates/recovery.html`, dibaca balik identik, tersimpan, dan tetap sama setelah reload. |
| Signup lewat Auth API hosted | `POST /auth/v1/signup?redirect_to=https://myworkpulse.my.id/auth/confirm` dengan publishable key: HTTP 200, tanpa session (konfirmasi email aktif). Password akun uji dibuat acak di proses dan tidak dicetak. |
| Recovery lewat Auth API hosted | Lebih dari 60 detik setelah signup (batas frekuensi email per pengguna), `POST /auth/v1/recover` dengan redirect yang sama: HTTP 200. |
| Bukti di `auth.users` | Satu baris akun uji: `confirmation_sent_at` 09:54:45 UTC, `recovery_sent_at` 09:56:09 UTC, `email_confirmed_at` null. |
| Log Auth | `user_confirmation_requested` (`/signup`) dan `user_recovery_requested` (`/recover`), keduanya status 200 dengan durasi sekitar 3,8 detik. Tidak ada entri error mail pada jendela waktu tersebut. |
| Penerimaan di kotak masuk | **Gagal.** Pengguna melaporkan: "Ga nyampe nih emailnya". Auth tidak mencatat error, jadi server SMTP MXroute menerima kedua pesan; kegagalan terjadi setelahnya. |
| DNS domain pengirim | Pengirim `noreply@myworkpulse.my.id` lewat host MXroute port 465. Query ke 8.8.8.8: NS Cloudflare dan A ada, tetapi MX, TXT (SPF), `_dmarc`, dan `x._domainkey` (DKIM MXroute) tidak ada. Tanpa SPF dan DKIM, Gmail menolak atau membuang pesan dari domain ini. |

### Kirim ulang setelah DNS diperbaiki

| Item | Hasil |
| --- | --- |
| DNS authoritative Cloudflare (kedua NS) dan 8.8.8.8 | MX `10 blizzard.mxrouting.net`, `20 blizzard-relay.mxrouting.net`; SPF `v=spf1 include:mxroute.com -all`; DMARC `v=DMARC1; p=none;`. Sempat muncul tidak konsisten selama pengguna menyimpan record, lalu stabil. DKIM `x._domainkey` masih NXDOMAIN, begitu pula selector umum lain. |
| Kirim ulang konfirmasi | `POST /auth/v1/resend` `type=signup` dengan redirect yang sama: HTTP 200; `confirmation_sent_at` 11:19:07 UTC. |
| Kirim ulang recovery | `POST /auth/v1/recover` lebih dari 60 detik kemudian: HTTP 200; `recovery_sent_at` 11:20:32 UTC. |
| Penerimaan | Pengguna: "Sudah sampe kok". Bentuk link di email tidak dilaporkan terpisah oleh pengguna; isi template hosted identik dengan file repo (lihat atas), sehingga link mengikuti pola `{{ .RedirectTo }}?token_hash=…&type=…`. |

Sisa untuk SMTP: DKIM MXroute belum dipublikasikan di Cloudflare. SPF yang selaras dengan DMARC cukup untuk diterima Gmail dalam uji ini, tetapi DKIM tetap dipasang sebelum production agar tidak bergantung pada SPF saja. Link belum diklik sampai selesai karena web staging belum di-deploy; verifikasi `/auth/confirm` end-to-end termasuk smoke Fase 7 setelah deploy. Akun uji (belum terkonfirmasi, satu baris `profiles`, tanpa objek Storage) **dipertahankan** atas permintaan pengguna: "Simpan dulu aja buat smoke test". Akun ini dihapus lewat jalur penghapusan akun di akhir smoke.

## Lanjutan 17 Oktober 2026: deploy server pribadi dan smoke

- Pelaksana deploy dan smoke di browser: pengguna. Claude (Opus 5.5) memeriksa dari luar (`curl`), membaca Supabase staging lewat query read-only, dan mencatat receipt ini. Hasil yang hanya dilaporkan pengguna ditandai "dilaporkan".
- Akun uji: alamat Gmail pribadi pengguna, atas pilihan pengguna ("akun pribadi gue sendiri, ga masalah kan?"). Alamat tidak ditulis di receipt. Akun dihapus lewat aplikasi dua kali (lihat langkah 6).

### Deploy

| Item | Hasil |
| --- | --- |
| Topologi | Compose staging di server pribadi pengguna (`/home/ilham827/workpulse`, bukan `/opt/workpulse/staging` seperti contoh panduan). Domain lewat Cloudflare (`Server: cloudflare`). Proxy Pangolin di depan domain awalnya meminta login (`302` ke halaman auth Pangolin); pengguna mematikan auth itu sebelum pemeriksaan di bawah. |
| Image web | `ghcr.io/feverepidemic/workpulse-web:main`, image ID `3ffff0805ff0`, 395 MB, dibuat sekitar 2 jam sebelum pemeriksaan. |
| Image worker | `ghcr.io/feverepidemic/workpulse-worker:main`, image ID `d30301d7ef50`, 910 MB. |
| ClamAV | `clamav/clamav`, image ID `0e31ce089574`; engine `1.5.4`, database signature `28156` per Sat Oct 17 06:25:46 2026. |
| Gotenberg DOCX dan PDF | `gotenberg/gotenberg`, image ID `f29984bd1e22`, dua container terpisah. |
| `/api/health` dari luar | `curl -sS -D - https://myworkpulse.my.id/api/health`: `200`, `Content-Type: application/json`, `Cache-Control: no-store`, body `{"status":"ok","service":"workpulse-web","version":"0.1.0"}`, tanpa `X-Powered-By`. Memenuhi baris `/api/health` di tabel §4 panduan Fase 7b. |
| Route lain dari luar | `/` → `307` ke `https://myworkpulse.my.id/sign-in`; `/auth/confirm` tanpa token → `303` ke `/sign-in?notice=verificationFailed`. Redirect memakai domain publik, jadi `WORKPULSE_SITE_URL` benar. |
| Cron `ops:check` | Setiap 5 menit, log ke `/home/ilham827/workpulse/ops.log`. Percobaan pertama memakai path contoh panduan, sehingga `cd` gagal dan log tetap kosong; diperbaiki setelah path diganti. Baris terakhir log: `status: ok`, semua metrik di bawah ambang, `jobs_failed_24h` = 2 (ambang 20). |

Status worker di tabel §4 (`worker:check`, `run.ts --once`) tidak dicatat terpisah. Pemrosesan evidence, impor, export, dan penghapusan akun di bawah membuktikan worker berjalan dengan adapter nyata.

### Smoke §8

| Langkah | Hasil |
| --- | --- |
| 1. Konfirmasi email, recovery, sign-out | Konfirmasi signup lulus (dilaporkan). Recovery: `/verify` di log Auth `200` pada 12:20:12 UTC, session baru dengan metode `otp`, tetapi klik link dari Gmail berakhir di dashboard. Link yang sama ditempel ke address bar sampai ke `/update-password` (dilaporkan). Penyebab: cookie `wp-recovery-flow` `SameSite=Strict` tidak dikirim pada navigasi lintas situs. Perbaikan `SameSite=Lax` beserta E2E yang membuka link lewat klik lintas origin ada di commit `59c2d69`, [PR #19](https://github.com/FeverEpidemic/workpulse/pull/19). Image staging saat smoke belum memuat perbaikan ini. Tiga `/verify` berikutnya `403 otp_expired` karena link dipakai ulang. |
| 2. Aktivitas, achievement, evidence PDF sampai `ready` | Lulus (dilaporkan), dengan ClamAV di atas. |
| 3. Impor CV DOCX sampai jumlah halaman terbaca | Lulus (dilaporkan), dengan Gotenberg DOCX. Sebelum akun kedua dihapus, `storage.objects` = 2 (berkas impor dan PDF export). |
| 4. Export CV ke PDF dan unduh | Lulus (dilaporkan); render kurang dari 15 detik menurut pengguna, tidak diukur dengan alat. Pencocokan teks hasil ekstraksi tidak dicatat terpisah. |
| 5. AI | Dilewati; staging tetap `unavailable`. |
| 6. Hapus akun sampai `completed` | Dua kali, setelah langkah 1-2 dan setelah langkah 3-4. Query read-only setelah tiap penghapusan: `auth.users` 0, `profiles` 0, `storage.objects` 0. `ops:check` `status: ok`. |

Dua job gagal di `jobs_failed_24h`, menurut pengguna: impor CV berformat PDF saat AI belum aktif, dan satu export saat data profil belum lengkap. Keduanya ditolak dengan pesan di aplikasi, lalu langkahnya diulang dan lulus. Baris job terhapus bersama akun, jadi kode errornya tidak dapat diperiksa lagi; `get_operational_health()` sekarang mengembalikan 0.

### Temuan

- **S1, P2, diperbaiki di PR #19:** recovery dari klien email tidak sampai ke `/update-password`. E2E lama memakai `page.goto` tanpa initiator, sehingga cookie `Strict` tetap terkirim dan bug tidak tertangkap. Spec baru gagal di `/dashboard` dengan `Strict` dan lulus dengan `Lax`.
- **S2, P3:** compose memakai tag `main` yang dapat berubah. CI juga menerbitkan tag `sha-<commit>`; pakai tag itu untuk `WORKPULSE_TAG` agar rollback di panduan §7 menunjuk image yang pasti.
- **S3, P3:** contoh path panduan Fase 7b (`/opt/workpulse/staging`) dan placeholder alert di baris cron menyebabkan cron gagal tanpa jejak bila disalin apa adanya.

## Yang dibutuhkan agar Fase 7 dapat dijalankan

| Kebutuhan | Rincian |
| --- | --- |
| Proyek Supabase hosted | Workpulse di Supabase, region `ap-northeast-2`, paket Free; scheduled backups/PITR tidak tersedia. Auth berisi 0 pengguna pada pemeriksaan sebelum migration. |
| Host web | Terpenuhi 17 Oktober 2026: image `workpulse-web` di server pribadi, `/api/health` 200 dari luar. |
| Host worker | Terpenuhi 17 Oktober 2026: image `workpulse-worker` dan cron `ops:check` tiap 5 menit. |
| ClamAV, Gotenberg DOCX, Gotenberg PDF | Terpenuhi 17 Oktober 2026: tiga container di compose staging, dipakai smoke §8. |
| SMTP untuk Auth | MXroute terpasang, dua template tersimpan, dan email konfirmasi serta recovery diterima di Gmail (16 Oktober 2026); link diklik sampai selesai pada 17 Oktober. Tersisa DKIM di Cloudflare. |
| Penyediaan secret | key diberikan ke host lewat env proses atau secret manager; **tidak** ditempel di chat atau repo |
| Otorisasi tertulis | migrate dan konfigurasi staging telah diizinkan dalam konteks Workpulse; scope saat ini mengikuti handoff Fase 7a, tanpa membuat akun uji. |
| Keputusan AI | apakah pemakaian key AI di staging diizinkan; bila tidak, mode `unavailable` dan jalur manual saja |

## Yang akan dijalankan begitu semuanya ada

1. Catat penyedia, region, paket, dan versi build (tanpa key dan tanpa URL internal sensitif).
2. ~~`supabase db push` ke staging~~ selesai di Fase 7a: parity 36/36, terakhir `20261012090000`.
3. Deploy worker lalu web sesuai [runbook](T25-release-runbook.md); `/api/health` 200; `pnpm worker:check` dengan adapter nyata.
4. Smoke dengan akun uji yang dibuat untuk T25 (bukan akun pribadi):
   - signup dan verifikasi email nyata, recovery, sign-out;
   - capture activity, confirm achievement, upload evidence dengan pemindai nyata sampai `ready`;
   - export CV dengan renderer nyata, unduh PDF, ekstraksi teks cocok;
   - AI hanya bila diizinkan;
   - penghapusan akun sampai `completed`, `pnpm ops:check` exit 0;
   - p95 baca dan simpan dengan `WORKPULSE_PERF_OUT` ke file staging terpisah, bila dataset staging boleh di-seed.
5. Retensi backup mengikuti [T23 §3](T23-retention-runbook.md): paket, retensi, tautan dokumentasi resmi, tanggal akses, pemeriksa.
6. Bersihkan akun uji lewat jalur penghapusan; catat nol sisa.

## Dampak pada acceptance

| Acceptance (§1) | Status |
| --- | --- |
| §1.17 backup dan restore jujur | klaim retensi ≤ 30 hari **tetap belum terverifikasi**; checklist menahan production (BLOCKER) |
| §1.18 staging | **hampir terpenuhi**. Migrasi, SMTP, template, deploy web/worker, dan smoke §8 langkah 2-6 lulus; recovery dari klien email menunggu deploy PR #19. p95 hosted tidak diukur. |
| Rencana T25, kalimat selesai | "integrasi nyata diverifikasi di staging" terpenuhi untuk scanner, renderer, export, dan penghapusan; recovery menunggu uji ulang |

## Langkah berikutnya

Deploy dan smoke selesai 17 Oktober 2026; akun uji lama dan baru sudah dihapus. Tersisa:

1. Merge PR #19, set `WORKPULSE_TAG` ke tag `sha-<commit>` hasil CI (S2), deploy worker lalu web, dan ulangi recovery dengan klik link dari Gmail.
2. DKIM MXroute di Cloudflare.
3. Keputusan pemilik produk: retensi backup (paket Free tanpa backup proyek, BLOCKER release) dan rate limit production.
4. Reviewer memeriksa receipt ini, termasuk pengecualian tipe dan klaim backup yang tetap terbuka. Status authoritative T25 dan checklist release tidak diubah oleh receipt ini.

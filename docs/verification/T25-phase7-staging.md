# T25 Fase 7 · Verifikasi staging

- Tanggal pemeriksaan hosted: 11 Oktober 2026.
- Status: **SEBAGIAN · migrasi hosted selesai**. Repair riwayat dan parity 36/36 terbukti. Pemeriksaan berikutnya dihentikan pada check tipe yang tidak identik; konfigurasi Auth dan sisa verifikasi belum selesai.
- Eksekutor pemeriksaan ini: ChatGPT, mengikuti `T25-phase7-hosted-migration-handoff.md`. Receipt awal ditulis Claude Sonnet 5.5.
- Commit acuan handoff: `cccdc43a3a0ead21e1e440ae02cd390bae72358b`; commit awal sesi lanjutan: `19a0d194dea1433df74495b81dd8ce7f0964683c`.
- Target: Supabase Workpulse, region `ap-northeast-2`, PostgreSQL 17.11. Paket belum diperiksa.
- URL staging yang ditetapkan pengguna: `https://myworkpulse.my.id`. Konfigurasi Auth untuk URL ini belum diterapkan.

## Alasan

Pengguna mengizinkan pekerjaan pada project Workpulse dalam percakapan yang sedang memeriksa project itu: "Terapkan Migration, konfigurasi Staging serta verifikasi Auth, Storage, Worker dan PDF yaa". Pengguna kemudian meminta "Eksekusi ulang sesuai dengan T25-phase7-hosted-migration-handoff.md". Scope percobaan ulang mengikuti Fase 7a pada handoff tersebut.

Pemeriksaan remote memicu stop condition handoff §2: versi remote tidak ada dalam daftar versi lokal. Eksekusi sebelumnya memakai MCP `apply_migration`, yang mencatat timestamp baru untuk SQL dari tiga file lokal. Pemeriksaan ulang tidak menerapkan migration tambahan.

Setelah pelaksana meminta persetujuan repair riwayat tiga migration tanpa mengulang SQL atau reset database, pengguna menjawab "Yes dan Antislop nya During aja". Credential belum tersedia pada percobaan awal. Pengguna kemudian menulis "Env sudah dipasang. Cek keberadaan keempat variabel tanpa mencetak nilainya, lalu lanjutkan repair." Pemeriksaan boolean sesi lanjutan membuktikan keempat variabel tersedia. URL env cocok dengan target Workpulse; nilai credential tidak dicetak atau ditulis ke file.

Repair melalui CLI berhasil, diikuti dry-run dan push tepat 33 migration tersisa. Riwayat akhir memuat seluruh 36 versi lokal tanpa versi tambahan. Stop condition riwayat telah ditutup dengan otorisasi pengguna. Stop condition baru terpicu pada perbandingan tipe: hosted generator menambahkan metadata PostgREST yang tidak ada di file lokal. Tidak ada perubahan source untuk menutup kegagalan ini.

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
| `pnpm exec supabase config diff --project-ref <ref Workpulse>` | Exit 0; 15 perubahan. Nilai diff ditahan dalam memori; hanya nama struktur output dicetak. Daftar path bagian belum diekstrak lengkap sebelum stop. Tidak menjalankan config push. |
| Dashboard Workpulse | Awalnya meminta login; pengguna kemudian menulis "udah login di browser codex nya ya". Dashboard menampilkan Healthy dan migration terakhir `t25_operational_health`. Navigasi Authentication dibuka; pengaturan belum disimpan. |
| `pnpm exec supabase test db --linked supabase/tests/database/release_catalog.test.sql` | PASS, 1 file, 26 assertion. Extension pgtap sudah tersedia. Semua probe dijalankan dalam transaksi rollback. Tidak menjalankan pgTAP lain. |
| `pnpm exec supabase gen types typescript --linked --schema public` | Generator exit 0. Output disimpan sementara di luar repo, dibandingkan, lalu dihapus. |
| Perbandingan tipe setelah normalisasi CRLF ke LF | **FAIL**, wrapper exit 2. Hosted 82391 karakter, lokal 82184 karakter. |
| `git diff --no-index`, file tipe lokal vs hasil generate hosted | Exit diff 1, menunjukkan hanya metadata `__InternalSupabase.PostgrestVersion` dan satu baris kosong akhir berbeda. Wrapper diagnostik exit 0; kedua file sementara dihapus. |

### Kegagalan check tipe dan batas diagnosis

Hosted generator menambahkan properti berikut pada `Database` sebelum `public`, beserta dua komentar generator:

```ts
__InternalSupabase: {
  PostgrestVersion: "14.18"
}
```

Diff juga menghapus satu baris kosong terakhir. Tidak ada perbedaan pada definisi `public` yang terlihat dalam diff lengkap. Hal ini tetap **gagal terhadap syarat identik** handoff §4.5; diagnosis metadata bukan pengganti acceptance dan belum disetujui sebagai pengecualian. File lokal tidak diubah. Check privilege health, `ops:check`, dan backup belum dijalankan setelah stop ini.

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
- [x] Otorisasi pengguna dan region dicatat; paket belum diketahui.
- [x] Isi tiga migration remote dibandingkan dengan file lokal sebelum repair.
- [x] Credential CLI staging tersedia di env proses; `link` dan `migration list --linked` dijalankan.
- [x] Repair CLI yang disetujui dijalankan dan diverifikasi. Repair mengubah riwayat saja.
- [x] `db push --linked --dry-run` menunjukkan tepat 33 migration tersisa, berurutan.
- [x] `db push --linked` dan parity akhir 36/36 terbukti.
- [x] `seed buckets --linked` dan query bucket terbukti sesuai handoff.
- [ ] `config diff` diperiksa; Site URL, redirect, konfirmasi email, rate limit pilihan pengguna, dan dua template Auth diatur melalui dashboard.
- [x] `release_catalog.test.sql` lulus, 26 assertion.
- [ ] Perbandingan tipe identik: gagal pada metadata generator; perlu keputusan reviewer/pengguna sebelum langkah berikutnya.
- [ ] Privilege health dan `ops:check` lulus.
- [ ] Paket, jenis backup, dan retensi diperiksa dari dashboard serta dokumentasi resmi. Retensi ≤ 30 hari **tidak dapat dipastikan** saat ini.

Tidak ada reset, drop, `db push --include-seed`, `db push --include-all`, `config push`, atau SQL manual yang mengubah skema pada percobaan ulang ini. Skema hanya berubah melalui db push; repair riwayat memakai CLI dengan persetujuan pengguna. Tidak ada akun uji dibuat. Tidak ada secret ditulis ke receipt.

Parity hosted, bucket privat, dan katalog hosted siap direview berdasarkan hasil di atas. Konfigurasi Auth, tipe identik, privilege health, `ops:check`, dan retensi backup belum selesai. BLOCKER release tidak dicentang oleh pelaksana.

## Yang dibutuhkan agar Fase 7 dapat dijalankan

| Kebutuhan | Rincian |
| --- | --- |
| Proyek Supabase hosted | Workpulse di Supabase, region `ap-northeast-2`, telah ditetapkan; paket dan backup belum diperiksa. Auth berisi 0 pengguna pada pemeriksaan ini. |
| Host web | domain staging `myworkpulse.my.id` telah ditetapkan; penyedia host dan deployment `pnpm start` belum diverifikasi. |
| Host worker | menjalankan `pnpm worker:run` dan cron `pnpm ops:check`; jaringan privat ke ClamAV dan dua Gotenberg |
| ClamAV, Gotenberg DOCX, Gotenberg PDF | kontainer sesuai runbook T10, T15, T21 di jaringan privat host worker |
| SMTP untuk Auth | penyedia email nyata agar signup, verifikasi, dan recovery terkirim ke kotak masuk sungguhan |
| Penyediaan secret | key diberikan ke host lewat env proses atau secret manager; **tidak** ditempel di chat atau repo |
| Otorisasi tertulis | migrate dan konfigurasi staging telah diizinkan dalam konteks Workpulse; scope saat ini mengikuti handoff Fase 7a, tanpa membuat akun uji. |
| Keputusan AI | apakah pemakaian key AI di staging diizinkan; bila tidak, mode `unavailable` dan jalur manual saja |

## Yang akan dijalankan begitu semuanya ada

1. Catat penyedia, region, paket, dan versi build (tanpa key dan tanpa URL internal sensitif).
2. `supabase db push` ke staging; `migration list` harus 36/36, terakhir `20261012090000`.
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
| §1.18 staging | **tidak terpenuhi** (BLOCKED) |
| Rencana T25, kalimat selesai | "integrasi nyata diverifikasi di staging" belum terpenuhi |

## Langkah berikutnya

Reviewer atau pengguna memutuskan apakah selisih metadata generator boleh dicatat sebagai pengecualian syarat tipe identik, atau memerlukan task perbaikan tersendiri. Setelah keputusan itu, lanjutkan pengaturan Auth dan sisa pemeriksaan Fase 7a. Hanya receipt ini yang diubah untuk pencatatan; status authoritative T25 dan checklist release tidak diubah. Sisa deploy web/worker dan smoke hosted mengikuti Fase 7 berikutnya.

# T25 Fase 7 · Verifikasi staging

- Tanggal pemeriksaan hosted: 11 Oktober 2026.
- Status: **BLOCKED pada repair riwayat migration**. Tiga migration telah diterapkan pada eksekusi MCP sebelumnya; 33 migration tersisa. Migrasi hosted belum selesai.
- Eksekutor pemeriksaan ini: ChatGPT, mengikuti `T25-phase7-hosted-migration-handoff.md`. Receipt awal ditulis Claude Sonnet 5.5.
- Commit acuan: `cccdc43a3a0ead21e1e440ae02cd390bae72358b`.
- Target: Supabase Workpulse, region `ap-northeast-2`, PostgreSQL 17.11. Paket belum diperiksa.
- URL staging yang ditetapkan pengguna: `https://myworkpulse.my.id`. Konfigurasi Auth untuk URL ini belum diterapkan.

## Alasan

Pengguna mengizinkan pekerjaan pada project Workpulse dalam percakapan yang sedang memeriksa project itu: "Terapkan Migration, konfigurasi Staging serta verifikasi Auth, Storage, Worker dan PDF yaa". Pengguna kemudian meminta "Eksekusi ulang sesuai dengan T25-phase7-hosted-migration-handoff.md". Scope percobaan ulang mengikuti Fase 7a pada handoff tersebut.

Pemeriksaan remote memicu stop condition handoff §2: versi remote tidak ada dalam daftar versi lokal. Eksekusi sebelumnya memakai MCP `apply_migration`, yang mencatat timestamp baru untuk SQL dari tiga file lokal. Pemeriksaan ulang tidak menerapkan migration tambahan.

Setelah pelaksana meminta persetujuan repair riwayat tiga migration tanpa mengulang SQL atau reset database, pengguna menjawab "Yes dan Antislop nya During aja". Repair telah diizinkan, tetapi belum dijalankan. Handoff §3 mensyaratkan credential yang dipasang pengguna di env proses; pemeriksaan boolean menunjukkan credential CLI dan server staging belum tersedia. Nilainya tidak dibaca dari file atau dicetak.

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
| Pemeriksaan boolean env proses | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, dan `SUPABASE_SECRET_KEY` tidak tersedia. Scope pengguna Windows juga tidak memuat ketiga variabel tersebut. |
| MCP `list_migrations` | Berhasil; 3 versi remote, seluruhnya tidak cocok dengan versi lokal. Ini bukan output CLI `migration list --linked`. |
| MCP `execute_sql`, hitungan saja | Berhasil; 0 pengguna Auth, 3 migration, 0 bucket. Tidak membaca isi karier atau membuat akun uji. |
| Perbandingan SQL tersimpan dengan file lokal | Berhasil untuk ketiga migration: panjang karakter dan MD5 identik. |
| `git diff --check -- docs/verification/T25-phase7-staging.md` | Exit 0; Git hanya memberi warning normalisasi LF menjadi CRLF. |
| Pemindaian receipt untuk key, JWT, URI koneksi, dan assignment credential | Semua pemeriksaan false; hanya nama variabel dicatat. |

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
- [ ] Credential CLI staging tersedia di env proses; `link` dan `migration list --linked` dijalankan.
- [ ] Repair CLI yang disetujui dijalankan dan diverifikasi: tandai tiga versi lokal sebagai `applied`, hapus tracking tiga versi MCP dengan status `reverted`, lalu periksa daftar. Repair mengubah riwayat saja.
- [ ] `db push --linked --dry-run` menunjukkan tepat 33 migration tersisa, berurutan.
- [ ] `db push --linked` dan parity akhir 36/36 terbukti.
- [ ] `seed buckets --linked` dan query bucket terbukti sesuai handoff.
- [ ] `config diff` diperiksa; Site URL, redirect, konfirmasi email, rate limit pilihan pengguna, dan dua template Auth diatur melalui dashboard.
- [ ] `release_catalog.test.sql`, perbandingan tipe, privilege health, dan `ops:check` lulus.
- [ ] Paket, jenis backup, dan retensi diperiksa dari dashboard serta dokumentasi resmi. Retensi ≤ 30 hari **tidak dapat dipastikan** saat ini.

Tidak ada reset, drop, `db push --include-seed`, `db push --include-all`, `config push`, atau SQL manual yang mengubah skema pada percobaan ulang ini. Tidak ada akun uji dibuat. Tidak ada secret ditulis ke receipt.

Belum ada item parity hosted, bucket/Auth hosted, atau retensi backup yang siap diterima sebagai selesai. Reviewer tetap perlu memeriksa receipt setelah langkah yang tertahan dijalankan.

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

Pengguna memasang credential staging ke env proses host Codex. Lanjutkan dari repair riwayat yang sudah diizinkan, lalu ikuti urutan handoff Fase 7a. Hanya receipt ini yang diubah untuk pencatatan; status authoritative T25 dan checklist release tidak diubah. Sisa deploy web/worker dan smoke hosted mengikuti Fase 7 berikutnya.

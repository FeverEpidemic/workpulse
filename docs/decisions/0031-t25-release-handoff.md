# Decision 0031: T25 regression, aksesibilitas, dan release handoff

Date: 11 Oktober 2026

Status: Accepted untuk bukti lokal (11 Oktober 2026). T25 **PARTIAL**: staging belum tersedia dan retensi backup belum terverifikasi. Task: T25 (PRD §2 R01–R10, §4, §5 M5; rencana M5). [Rencana](../verification/T25-implementation-plan.md), [laporan handoff](../verification/T25-release-handoff.md), [matriks](../verification/T25-release-matrix.md), [runbook rilis](../verification/T25-release-runbook.md), [checklist](../verification/T25-release-checklist.md), [gate review](../verification/T25-review-remediation-plan.md).

## References

- **PRD §2** R01–R10 dan *Shared validation*; **PRD §4** *Privacy*, *File safety*, *Failures*, *Usability*, *Deletion*, *Release scenarios*; **PRD §5** M5 exit gate.
- **Implementation plan:** blok T25 dan Gate M5, §6 matriks verifikasi, §8 (worker host, retensi backup, hosting dan secret).
- **Decision terkait:** 0029 (penghapusan akun, receipt 30 hari), 0030 (event produk; kalimat pemberitahuan ditunda ke T25).
- **Receipt:** `docs/verification/T25-phase0-baseline.md` sampai `T25-phase8-regression.md`, `T25-phase8b-remediation.md`.

## Context

Sebelum T25, isolasi akun, kontras, dan layout sudah diuji per domain, tetapi tidak ada suite yang gagal ketika tabel, RPC, bucket, atau layar baru ditambahkan tanpa pemeriksaan. Operator juga tidak punya runbook deploy, alert backlog, atau prosedur restore.

T25 adalah task verifikasi. Perubahan perilaku dibatasi pada satu migration (`get_operational_health`), satu skrip operator (`ops:check`), satu kalimat copy S12, dan perbaikan defect yang ditemukan. Parity migration menjadi 36/36: merge `origin/main` di Fase 0 membawa fix T24 G1 (`20261011100000`), sehingga migration T25 adalah yang ke-36, bukan ke-35 seperti di rencana.

## Jawaban keputusan produk §2.4

Pengguna menyetujui keenam rekomendasi pada 10 Oktober 2026 ("Setuju semua"):

1. **Staging bersyarat.** T25 menyiapkan semuanya secara lokal. Fase 7 hanya berjalan bila pengguna menyediakan proyek Supabase hosted, host web, host worker, dan otorisasi tertulis. Tidak ada yang disediakan, jadi Fase 7 **BLOCKED** dan T25 **PARTIAL**.
2. **Screen reader.** Proxy otomatis (snapshot accessibility tree) dikunci di E2E. Pemeriksaan NVDA nyata dijalankan manusia; status sekarang **belum dijalankan**.
3. **Kalimat event S12.** Ditambahkan sesuai draf, en dan id.
4. **Copy backup S12 tidak diubah.** Checklist memblokir production sampai retensi ≤ 30 hari terverifikasi.
5. **Alert lewat `ops:check`.** Notifikasi (email, chat) adalah langkah operator, bukan bagian aplikasi.
6. **Defect P0–P2 diperbaiki di T25** dengan test gagal lebih dulu.

## Keputusan

1. **Penjaga berbasis katalog, bukan daftar tulisan tangan.** `release_catalog.test.sql` membaca `pg_class`, `pg_attribute`, `pg_trigger`, `pg_proc`, privilege, dan `storage.buckets`. Delapan aturan: tabel `public` tanpa RLS, tabel ber-`user_id` tanpa `zz_guard_account_writable`, privilege tabel atau kolom untuk `anon`, privilege tabel `internal` untuk peran API, fungsi `security definer` tanpa `search_path`, fungsi `public` yang dapat dieksekusi `anon` (allowlist kosong), `USAGE` skema `internal` untuk `anon`, dan bucket publik. Setiap aturan dibuktikan dapat gagal dengan objek pelanggar di subtransaksi yang di-rollback.
   - *Alasan:* tabel atau fungsi yang ditambahkan setelah T25 otomatis tercakup. Daftar statis akan basi tanpa ada yang gagal.
   - `release-ownership.test.ts` mengambil daftar tabel dan parameter RPC ber-ID dari katalog yang sama, dan gagal bila tabel `public` baru tidak punya kolom pemilik, tidak punya fixture, atau parameter `uuid` baru tidak punya kasus.
2. **ID asing dijawab sama dengan ID acak.** Untuk 47 parameter pada 36 RPC dan tiga route unduh, jawaban ke akun B untuk ID milik A identik dengan ID acak (kode, pesan, isi). Kontrol pemilik membuktikan jawaban itu bukan satu validasi umum untuk semua ID; satu pengecualian beralasan (`apply_ai_suggestion.p_job_id`).
3. **Fixture lewat jalur sah.** Data A dibuat lewat RPC dan jalur produk. Empat tabel yang hanya ditulis worker (`ai_suggestion_reviews`, `import_batches` status review, `import_items`, `cv_exports`) ditulis sebagai pemilik database, dengan alasan per tabel di test.
4. **Health tanpa endpoint web baru.** `public.get_operational_health(p_now)` (`security definer`, `search_path = pg_catalog`, hanya `service_role`) mengembalikan delapan hitungan tanpa konten. `/api/health` tetap liveness tanpa dependency. `pnpm ops:check` membaca RPC dari host worker dan keluar 0 (ok), 2 (alert), atau 1 (konfigurasi tidak valid atau backend tidak menjawab benar).
5. **Ambang alert** (default di kode, dapat diubah env `WORKPULSE_ALERT_*`):

   | Metrik | Alert bila |
   | --- | --- |
   | `account_deletion_overdue` (aturan sama dengan `get_account_deletion_backlog`) | > 0 |
   | `storage_cleanup_failed` | > 0 |
   | `storage_cleanup_overdue` (queued/running > 24 jam) | > 0 |
   | `import_purge_overdue` (terminal > 24 jam, belum dipurge) | > 0 |
   | `export_purge_overdue` (sukses > 24 jam, belum dipurge) | > 0 |
   | `evidence_stuck` (`uploading`/`scanning` > 1 jam) | > 0 |
   | `jobs_failed_24h` (AI, export, impor) | > 20 |
   | `jobs_expired_lease` (lease habis > 10 menit) | > 0 |

6. **Restore tanpa ledger terpisah.** Receipt `internal.account_deletions` disimpan 30 hari setelah `completed` (decision 0029). Sebelum restore, operator mengekspor user id dengan `requested_at` setelah titik restore dari database yang berjalan; sesudah restore, memanggil `begin_account_deletion` untuk tiap id (`P0002` = lewati). Prosedur ini hanya cukup bila retensi backup ≤ 30 hari; bila lebih panjang, restore produksi butuh persetujuan pemilik produk. Objek Storage tidak ikut restore database; perilaku cleanup untuk objek yang hilang belum diuji terhadap restore hosted.
7. **Rollback adalah forward fix.** Build sebelumnya hanya di-deploy ulang bila migration sejak build itu aditif. Migration yang sudah berisi data tidak di-revert; perbaikan lewat migration baru. Tidak ada langkah yang menghapus data pengguna.
8. **Kontras dari token nyata.** `theme-contrast.test.ts` membaca `src/styles/tokens.css` (bukan `globals.css` seperti di rencana) untuk tema light dan `[data-theme="dark"]`, dan mengukur 37 pasangan pemakaian nyata. Format warna yang tidak dapat diparse menggagalkan test dengan nama token.
9. **Matriks aksesibilitas pada build produksi.** `playwright.release.config.ts` (port 3017, `workers: 1`): 20 keadaan layar S01–S14 × 360/1440 × light/dark, plus 8 tampilan Indonesia; Axe WCAG 2.2 A/AA, satu `h1`, satu `main`, `lang`, tanpa scroll horizontal, konten data sebelum Axe. Teks 200% pada S04, S05, S08, S13. Journey keyboard sign-in sampai preview, empat dialog dibuka dengan Enter/Space dan ditutup dengan Escape, ring focus ≥ 3:1. Pemindaian bundle `.next/static` tanpa rahasia server.
10. **Snapshot aria dibandingkan tanpa line ending.** Golden ditulis LF; checkout Windows dengan `core.autocrlf=true` membacanya sebagai CRLF. Perbandingan menormalkan keduanya dan menyebut baris pertama yang berbeda (RV1). `.gitattributes` tidak ditambahkan, karena akan mengubah checkout seluruh repo.

## Copy S12

- en: "WorkPulse records which actions happen, such as saving an activity or exporting a CV, without their content, to measure how reliably the product works."
- id: "WorkPulse mencatat jenis aksi yang terjadi, seperti menyimpan aktivitas atau mengekspor CV, tanpa isinya, untuk mengukur keandalan produk."

Kalimat berada di kartu privasi S12 sebelum paragraf penghapusan. Isinya sesuai perilaku T24: trigger mencatat nama aksi dan properti allowlist, tanpa teks, nama file, id, atau email. Kalimat berlaku untuk semua akun karena trigger berlaku untuk semua akun.

## Defect yang diperbaiki

| ID | Prio | Perbaikan |
| --- | --- | --- |
| D9 | P2 | Tepi kontrol dark pada permukaan elevated 2,96:1 → `#6a796f` (3,18:1) |
| D10 | P3 | Teks terseleksi dark 1,25:1 → token `--color-selection-bg` (`#435e45`, 6,52:1) |
| D11 → D12 | P2 | Judul achievement dengan kata panjang membuat S08 410 px pada 320 px. Aturan global `overflow-wrap` (D11) membuat spec `activity-ui` gagal; diganti utility `wrap-anywhere` pada dua `h1` berisi judul pengguna (S08, S10) |
| RV1 | P2 | Snapshot aria gagal pada checkout CRLF (temuan gate review); perbandingan menormalkan line ending |

## Batas yang diterima

- **Staging tidak diverifikasi.** Auth email nyata, scanner dan renderer di host, p95 hosted, dan restore hosted belum dibuktikan. Sembilan BLOCKER di checklist menahan production.
- **Retensi backup ≤ 30 hari belum terverifikasi.** Copy S12 menjanjikannya; checklist memblokir production sampai operator mencatat paket, retensi, tautan dokumentasi resmi, dan tanggal akses.
- **NVDA nyata belum dijalankan.** Snapshot aria hanya proxy.
- **Skenario rilis 2 dan 3** dibuktikan oleh rangkaian test bernama, bukan satu journey dari awal sampai akhir.
- **Policy tulis tidak teruji lewat PostgREST.** `authenticated` tidak punya privilege tulis pada tabel `public` mana pun; enam policy tulis `_own` lama tidak terpakai (O5). Test insert lintas akun hanya memeriksa ada error, belum spesifik `42501`.

## Alternatif yang ditolak

- **Endpoint readiness publik.** Membuka info internal tanpa autentikasi; `ops:check` dengan service role dari host worker cukup.
- **Notifikasi alert di aplikasi.** Butuh credential dan keputusan kanal; ditulis sebagai langkah operator.
- **Ledger penghapusan di luar database.** Menambah penyimpanan dan rahasia baru; receipt 30 hari cukup selama retensi backup ≤ 30 hari.
- **Melunakkan copy backup S12 sekarang.** Pengguna memilih menahan production sampai retensi terverifikasi.
- **Aturan `overflow-wrap` global.** Menggeser timing hidrasi spec lama (D12); perbaikan sempit pada dua heading cukup.

## Seam ke task berikutnya

- **Fase 7 / release:** staging, smoke §5 Fase 7, retensi backup, p95 hosted, restore hosted dengan objek yang hilang.
- **Gate M5:** review milestone terpisah oleh Claude setelah T25; tidak dapat PASSED selama staging BLOCKED.
- **CI01:** jalankan suite rilis di CI; pertimbangkan `.gitattributes` untuk file golden.
- **Follow-up P3:** assertion `42501` per tabel di `release-ownership`, kebocoran akun `wp-*` suite lama (O3), landmark bersarang S04 (O9), ukuran font berbasis px (O10), T24 G7.

## Gate review

Gate review Claude (Opus) pada `4574d9a` menemukan satu P2 (RV1) dan enam P3. Reviewer menjalankan ulang lint, typecheck, unit, pgTAP, `db:lint`, `test:integration:release`, `ops:check` (exit 0 dan 1), `worker:check`, `test:e2e:release`, serta `test:e2e:m2`, `evidence`, dan `account-deletion` di worktree bersih, dan membandingkan cakupan tabel dengan query katalog sendiri. RV1 diperbaiki di `617cae3` dan review ulang lulus (15/15 pada checkout CRLF). Review ulang tidak independen penuh karena reviewer juga memperbaikinya.

Saat menyiapkan migrasi hosted, reviewer menemukan P2 kedua yang terlewat di gate review (N7): runbook §3 hanya menyebut `db push`, padahal template email Auth dan Site URL hanya dideklarasikan di `supabase/config.toml`, dan `config push` non-interaktif akan menimpa pengaturan hosted dengan nilai lokal. Runbook §3 dan checklist diperbaiki sebelum migrasi hosted dijalankan (BLOCKER kesembilan). Klaim awal N7 bahwa bucket `workpulse-private` juga tidak dibuat migration keliru: migration T05 membuatnya. Pelaksana Fase 7a menemukannya, dan reviewer mengoreksi dokumen.

Fase 7a (migrasi hosted ke staging Workpulse oleh ChatGPT) direview pada 13 Oktober 2026 tanpa P0–P2 ([review](../verification/T25-phase7a-review.md)): parity 36/36, bucket, katalog, privilege health, dan `ops:check` terbukti di hosted. Template email belum terpasang karena paket Free mensyaratkan SMTP kustom, dan paket Free tidak menyediakan backup proyek, sehingga prosedur restore §6 tidak dapat dijalankan pada paket itu.

## Perubahan pada test lama

Tidak ada assertion lama yang dilemahkan. Satu helper (`collectWcagViolations`) ditambahkan ke `tests/e2e/helpers/accessibility.ts`, dan `tests/unit/account-deletion-i18n.test.ts` mendapat satu test untuk kalimat S12.

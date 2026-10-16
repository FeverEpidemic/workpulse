# Review T25 Fase 7a · Migrasi Supabase hosted ke staging

- Tanggal: 13 Oktober 2026.
- Reviewer: Claude (Opus), read-only. Pelaksana: ChatGPT, mengikuti [brief Fase 7a](T25-phase7-hosted-migration-handoff.md).
- Receipt: [T25-phase7-staging.md](T25-phase7-staging.md), commit `19a0d19`, `baac83a`, `c1142a0` (hanya file receipt).
- Proyek: Workpulse, `ap-northeast-2`, PostgreSQL 17.11, paket Free.
- Verdict: **LULUS untuk scope Fase 7a yang selesai. Tidak ada P0–P2 dari pekerjaan pelaksana.** Fase 7 belum selesai (template email, deploy web/worker, smoke, retensi backup), jadi T25 tetap **PARTIAL**.

## 1. Verifikasi independen reviewer

Lewat connector Supabase, hanya query baca (`list_migrations`, `execute_sql` select, `get_advisors`). Tidak ada yang diubah di proyek hosted.

| Pemeriksaan | Hasil |
| --- | --- |
| Riwayat migration hosted | 36 versi, nama dan urutan sama persis dengan `supabase/migrations/`, terakhir `20261012090000 t25_operational_health`. Tidak ada versi MCP sisa |
| Bucket | satu bucket: `workpulse-private`, `public = false`, 52428800, MIME PDF/PNG/JPEG/DOCX |
| Tabel | 18 `public` (0 tanpa RLS), 9 `internal` |
| Akses `anon` | 0 fungsi `public` dapat dieksekusi; tanpa `USAGE` skema `internal` |
| `get_operational_health` | `anon` false, `authenticated` false, `service_role` true |
| Data | 0 pengguna Auth, 0 objek Storage |
| Advisor keamanan | tanpa ERROR. 52 WARN `authenticated_security_definer_function_executable` dan 9 INFO `rls_enabled_no_policy` pada tabel `internal`: keduanya desain (semua tulisan lewat RPC `security definer` yang memeriksa pemilik, dibuktikan `release-ownership.test.ts`; tabel `internal` tertutup untuk peran API). Jangan "memperbaiki" dengan mencabut `EXECUTE` |

Angka di atas cocok dengan receipt. Hasil `release_catalog.test.sql` (26 assertion) dan `ops:check` di hosted tidak diulang reviewer karena butuh credential di env proses; buktinya receipt, dan pemeriksaan katalog di atas mendukungnya.

## 2. Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| S1 | P3 (reviewer) | Brief dan runbook §3 (N7) menyatakan bucket hanya ada di `config.toml`. Keliru: `20260917090000_t05_private_storage_foundation.sql:6-29` membuatnya. Penyebab: grep reviewer memakai glob yang tidak cocok dengan file apa pun dan hasil kosongnya tidak dicek. Pelaksana menunjukkannya di receipt | Dikoreksi: runbook §3, checklist, README, decision 0031, rencana remediasi, laporan handoff, ralat di brief |
| S2 | P3 | Percobaan pertama (sebelum brief) menerapkan tiga migration lewat MCP `apply_migration`, yang mencatat versi baru (`20261011054646`, `…733`, `…746`). Pelaksana berhenti sesuai stop condition, membuktikan SQL tersimpan identik (panjang dan MD5) dengan file lokal, lalu dengan persetujuan pengguna me-repair riwayat (`applied` untuk tiga versi lokal, `reverted` untuk tiga versi MCP) tanpa menjalankan ulang SQL. Riwayat hosted kini bersih (§1) | Diterima. Brief berikutnya melarang `apply_migration` lewat MCP secara eksplisit |
| S3 | P3 | Tipe hasil generate hosted tidak identik: tambahan metadata `__InternalSupabase.PostgrestVersion` dan satu baris kosong akhir; definisi `public` sama. Pengecualian disetujui pengguna dan dicatat jujur sebagai "tidak identik" | Diterima; `database.types.ts` tidak diubah |
| S4 | P3 | Receipt menyisakan bagian lama yang basi: "Yang akan dijalankan" masih menulis `db push` sebagai langkah berikut, dan "Dampak pada acceptance" masih menyebut §1.18 BLOCKED tanpa menyebut 7a. Tiga commit memakai pesan yang sama | Perbaiki saat receipt berikutnya diperbarui |
| O1 | terbuka | Template konfirmasi dan recovery belum terpasang: paket Free yang memakai email bawaan tidak dapat mengedit template ([changelog Supabase](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier), dikutip pelaksana). Sampai SMTP kustom dan template terpasang, link email hosted tidak berformat `token_hash`, sehingga verifikasi signup dan recovery lewat `/auth/confirm` **akan gagal** di staging | BLOCKER konfigurasi Auth dan SMTP tetap terbuka; menunggu SMTP MXroute dari pengguna |
| O2 | terbuka | Paket Free tidak menyediakan backup proyek maupun PITR. Retensi ≤ 30 hari tidak dapat dipastikan, dan prosedur restore runbook §7 tidak dapat dijalankan di paket ini. Untuk staging tidak masalah; untuk production pemilik produk harus memilih paket dengan backup, lalu memverifikasi retensinya | BLOCKER retensi tetap terbuka; catatan ditambahkan di checklist |
| O3 | terbuka | Rate limit sign-in/sign-up hosted 30 per 5 menit per IP (nilai default hosted, bukan hasil `config push`). Nilai production belum dipilih | Keputusan pemilik produk |

## 3. Kepatuhan terhadap brief

- Tanpa `--include-seed`, `--include-all`, `config push`, reset, atau SQL yang mengubah skema selain `db push`. Repair riwayat hanya dengan persetujuan tertulis pengguna.
- Stop condition dipatuhi dua kali (riwayat remote, diff tipe), masing-masing dilanjutkan setelah pengguna memutuskan.
- Credential hanya diperiksa keberadaannya; receipt tanpa key, password, JWT, atau URI koneksi (grep reviewer: nihil untuk `sb_secret_`, `sb_publishable_`, `eyJ`, `postgres://`). Project ref tidak ditulis di receipt.
- Hanya file receipt yang di-commit.

## 4. Yang masih dibutuhkan

1. Pengguna memasang SMTP MXroute di proyek staging; lalu pelaksana memasang dua template dari `supabase/templates/` dan menguji kirim email nyata.
2. Sisa Fase 7: deploy worker dan web ke `myworkpulse.my.id`, `/api/health`, `worker:check` dengan adapter nyata, smoke §5 Fase 7 rencana dengan akun uji khusus, lalu hapus akun uji.
3. Keputusan pemilik produk: paket production (backup), rate limit production, mode AI di staging.

Gate M5 tetap tidak dapat PASSED sebelum Fase 7 selesai dan retensi backup production terverifikasi.

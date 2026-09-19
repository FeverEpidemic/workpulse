# Verifikasi T05 Private Storage Foundation

Tanggal: 17 September 2026.

Status: **DONE**. Dependensi T02 selesai; baseline T01–T04 tetap utuh. Review P1 pada Storage policy ditutup dengan migration hardening dan regression evidence di bawah. Gate M1 ditutup kembali; T06 Activity persistence menjadi task berikutnya.

## Remediasi review policy — 17 September 2026

### Acuan dan reproduksi

Scope mengikuti PRD R01/R07 dan Reliability §4, Database Schema §4 Storage protocol and quotas serta §6 Access policy pattern, T05.3, dan Gate M1. Dokumen sumber tidak diubah.

Sebelum remediasi, transaksi lokal menambahkan object fixture WorkPulse dan policy `FOR SELECT TO authenticated USING (true)` yang tidak menyebut nama bucket. Query cleanup migration lama tidak menemukan policy itu; role `authenticated` melihat satu row WorkPulse. `ROLLBACK` menghapus policy dan row; pemeriksaan sesudahnya menghasilkan nol fixture tersisa.

### Perbaikan dan regression

Migration baru `supabase/migrations/20260917134500_t05_storage_policy_hardening.sql` memasang `workpulse_private_server_only` pada `storage.objects` sebagai `AS RESTRICTIVE FOR ALL TO anon, authenticated`, dengan predicate `bucket_id <> 'workpulse-private'` pada `USING` dan `WITH CHECK`. Migration T05 historis tidak diubah. ACL/provider grants tidak diubah dan service role tetap memakai jalur server yang melakukan owner check serta TTL 1–300 detik.

`supabase/tests/database/private_storage.test.sql` kini memverifikasi nama tunggal, `RESTRICTIVE`, `ALL`, kedua role, serta predicate kedua clause. Dalam transaksi test, broad `SELECT`, `INSERT`, `UPDATE`, dan `DELETE` policies tanpa literal WorkPulse dipasang untuk `anon` dan `authenticated`. Kedua role tidak dapat membaca atau menulis ke bucket WorkPulse; update ke/dari bucket itu ditolak. Bucket fixture lain tetap menerima select, insert, dan update melalui policy generik. Fixture policy, bucket, object, dan perubahan data di-rollback.

Storage memasang `protect_objects_delete` sebagai trigger `BEFORE DELETE FOR EACH STATEMENT`, yang menolak raw SQL DELETE terlepas dari row policy. Karena itu pgTAP memeriksa bahwa policy restriktif berlaku untuk `ALL` dan memiliki `USING` yang membatasi WorkPulse, tanpa menonaktifkan trigger provider. Jalur Storage API nyata diuji terpisah: upaya remove dengan token owner dan akun kedua tidak menghapus object.

Storage integration dua akun lulus setelah migration. Service menghasilkan attachment URL TTL 3 detik yang dapat dipakai lalu expired; owner dan akun kedua gagal membuat signed URL langsung TTL 3.600 detik; direct upload ditolak; public URL tidak dapat dipakai; object tetap ada sesudah percobaan remove kedua akun. Queue, scanner contract, dan akses bucket server tetap lolos test yang ada.

### Upgrade dan clean rebuild

`pnpm exec supabase migration up --local` menerapkan migration baru secara forward-only pada stack WorkPulse aktif tanpa reset. Migration list aktif sinkron pada delapan migration dan workspace tidak linked ke hosted project.

Clean rebuild menggunakan project disposable `workpulse_t05_hardening_20260917_1345` di `.tmp`, port alternatif 54420–54429, dan tidak menyalin `.temp`/secret dari project aktif. `supabase db reset` menerapkan delapan migration dari nol dan menjalankan seed. pgTAP lulus 185/185, DB lint tidak menemukan error, dan Storage integration lulus 1/1. Setelah verifikasi, stack disposable dihentikan; container, volume, network, dan foldernya tidak tersisa. Database WorkPulse aktif tetap berjalan.

### File remediasi

- Migration: `supabase/migrations/20260917134500_t05_storage_policy_hardening.sql`.
- Regression database: `supabase/tests/database/private_storage.test.sql`.
- Keputusan: `docs/decisions/0008-private-storage-restrictive-policy.md`.
- Checkpoint: `docs/IMPLEMENTATION_STATUS.md`; rencana: `docs/verification/T05-review-remediation-plan.md`.

### Quality gates aktual

- `pnpm install --frozen-lockfile` — exit 0, already up to date.
- `pnpm lint` — exit 0.
- `pnpm typecheck -- --incremental false` — exit 0 setelah production build menghasilkan `.next/types`.
- `pnpm test` — exit 0, 19 file / 88 unit test.
- `pnpm test:integration:storage` — exit 0, 1/1 pada database WorkPulse lokal aktif dan 1/1 pada disposable.
- `pnpm build` — exit 0.
- `pnpm worker:check` — exit 0, `registeredJobs: []`.
- `pnpm db:test` — exit 0 pada database aktif, 185 assertion.
- `pnpm db:lint` — exit 0, tidak ada schema error.
- `pnpm exec supabase migration list --local` — exit 0, delapan migration lokal/database sinkron.
- Disposable: `pnpm exec supabase db reset --local --workdir <verified-disposable> --yes`, `pnpm exec supabase test db --workdir <verified-disposable>`, dan `pnpm exec supabase db lint --level error --workdir <verified-disposable>` — semuanya exit 0; clean rebuild menerapkan migration dan seed.
- `git diff --check` — exit 0.

E2E browser tidak dijalankan karena remediasi tidak mengubah UI. Hosted Storage, deployment production, scanner malware nyata, reservation/quota, signature/actual-byte validation, dan status file `ready` tetap di luar T05.

Bagian berikut mencatat implementasi dan acceptance awal T05 sebelum temuan policy P1. Untuk status, migration, file, dan hasil final setelah remediasi, gunakan bagian di atas.

## Hasil implementasi

- Bucket Supabase `workpulse-private` dikonfigurasi private dengan hard limit 50 MiB dan allowlist PDF, PNG, JPEG, serta DOCX. Konfigurasi lokal dan migration menggunakan nilai yang sama.
- Object key hanya menerima tiga segmen kanonik `owner_uuid/category/object_uuid`; kategori dibatasi ke `import`, `evidence`, dan `export`. Filename tidak masuk key.
- Admin client berada pada module server-only, memakai `SUPABASE_URL` dan `SUPABASE_SECRET_KEY`, serta mematikan session persistence/refresh. Request service mengambil actor dari auth context server; payload client tidak menentukan owner.
- Private storage service memvalidasi owner, category, metadata provider, error aman, dan TTL integer 1–300 detik. Signed URL memakai download disposition. Missing dan foreign object memiliki error code yang sama.
- `internal.storage_jobs` menyediakan enqueue idempotent, claim atomik dengan lease 120 detik, attempt token baru, completion/failure guard, explicit retry, serta tidak memiliki FK ke parent atau profile.
- Malware scanner contract mengembalikan `unavailable` tanpa dependency; fake clean scanner harus dipilih eksplisit untuk development/test dan ditolak di production.
- T05 tidak menambah upload UI, evidence/import domain tables, quota reservation, parser, scanner vendor, atau worker polling daemon. Actual-byte/signature checks dan karantina tetap acceptance T10/T15.

## File yang berubah untuk T05

- `src/server/supabase/config.ts`, `src/server/supabase/admin.ts`, `src/server/storage/`.
- `supabase/config.toml`, `supabase/migrations/20260917090000_t05_private_storage_foundation.sql`, `supabase/tests/database/private_storage.test.sql`.
- `tests/unit/storage-object-key.test.ts`, `tests/unit/private-storage-service.test.ts`, `tests/unit/malware-scanner.test.ts`, `tests/unit/supabase-admin-config.test.ts`.
- `tests/integration/private-storage.test.ts`, `vitest.integration.config.ts`, script `test:integration:storage` pada `package.json`.
- Instruksi local storage test pada `README.md`, decision record `docs/decisions/0007-private-storage-foundation.md`, dan checkpoint `docs/IMPLEMENTATION_STATUS.md`.

## Migration dan keputusan

Migration `20260917090000_t05_private_storage_foundation.sql` diterapkan secara forward-only ke database Supabase lokal yang aktif. Tidak ada `db:reset` pada database tersebut. Karena hanya `internal.storage_jobs` yang ditambahkan dan schema `internal` tidak diekspos, `database.types.ts` tidak berubah.

Pada checkpoint awal, Decision `0007-private-storage-foundation.md` mencatat bucket/key contract, server-only signed URL, queue durable, scanner fail-closed, dan batas ACL provider. Tabel Storage dibuat oleh `supabase_storage_admin`; role migrasi proyek tidak dapat mencabut ACL provider-level itu. RLS tetap aktif; policy restriktif WorkPulse ditambahkan pada remediasi review dan dicatat di Decision 0008. Test Storage lokal membuktikan direct user-token metadata/sign/upload ditolak dan delete tidak mengubah object; pemeriksaan metadata sesudah percobaan delete memastikan API yang tidak mengembalikan error tidak dianggap berhasil.

## Acceptance dan bukti

- [x] Bucket privat, MIME allowlist, dan batas ukuran cocok antara local config, migration, dan pgTAP. Public URL tidak dapat dipakai.
- [x] Builder/parser key dan unit test menolak owner/category/object/path yang tidak kanonik, traversal, segmen tambahan, atau kategori asing.
- [x] Unit service membuktikan path foreign berhenti sebelum adapter, error missing/foreign sama, metadata tidak valid ditolak, dan TTL di luar 1–300 tidak diteruskan.
- [x] Integration dua akun pada Supabase lokal membuktikan owner memperoleh attachment URL, dapat menggunakannya, URL TTL pendek benar-benar expired, akun lain tidak dapat sign/download, direct user-token signing/upload tidak memberi akses, dan percobaan delete user-token tidak mengubah object. Fixture dibersihkan pada `finally`.
- [x] Admin credential hanya dibaca pada server module. Unit config menolak URL/secret invalid; production build dan typecheck lulus.
- [x] pgTAP memverifikasi queue internal tidak memiliki FK parent/profile, client tidak memiliki akses Data API, enqueue identik mengembalikan row sama, parent deletion tidak menghapus job, lease/token lama tidak dapat menulis setelah reclaim, dan retry harus eksplisit.
- [x] Unit scanner membuktikan default unavailable bukan clean, fake hanya eksplisit untuk development/test, dan production menolak fake.
- [x] Diff review tidak menambahkan evidence UI/domain schema, quota, actual malware scanner, atau worker daemon.
- [x] Gate M1 review: T01–T05 selesai; dua-akun isolation dan lifecycle dasar lulus. T06 menjadi langkah berikutnya.

## Perintah dan hasil aktual

- Baseline sebelum perubahan: `pnpm install --frozen-lockfile`, lint, typecheck, unit, build, worker check, pgTAP, dan DB lint selesai dengan exit 0; pgTAP baseline 139/139.
- Final: `pnpm lint` exit 0; `pnpm typecheck -- --incremental false` exit 0; `pnpm test` exit 0 (19 file, 88 test); `pnpm test:integration:storage` exit 0 (1/1); `pnpm build` exit 0; `pnpm worker:check` exit 0 (`registeredJobs: []`).
- Database aktif: `pnpm exec supabase migration up --local` menerapkan migration T05; `pnpm db:test` exit 0 (174 assertion); `pnpm db:lint` exit 0 (`No schema errors found`); `pnpm exec supabase migration list --local` exit 0 dengan tujuh migration lokal/DB tersinkron. Local project tidak linked ke hosted project.
- Satu pemanggilan DB lint yang berjalan bersamaan dengan pgTAP menampilkan error introspeksi fungsi pgTAP; pemanggilan terpisah setelah pgTAP selesai exit 0 tanpa schema error.
- Clean rebuild disposable `workpulse_t05_a54ef4ce`: reset, tujuh migration, seed, pgTAP 174/174, dan DB lint exit 0. Stack disposable dihentikan; container, volume, dan network dengan project ID itu dikonfirmasi tidak tersisa. Folder kerja disposable di `%TEMP%` masih tersisa karena operasi penghapusan folder ditolak policy shell; tidak ada stack atau resource Docker aktif yang terkait.
- `git diff --check` exit 0; hanya notifikasi konversi line ending LF/CRLF.

## Batasan yang masih berlaku

- Belum ada Storage hosted/production, delivery SMTP hosted, deployment, atau backup/purge production yang diuji.
- Scanner malware nyata belum dipilih atau dihubungkan. Tidak ada klaim file menjadi `clean`/`ready`; T10 harus menambahkan scanner, quarantine lifecycle, reservation, signature, serta actual-byte validation.
- ACL provider-owned pada tabel Storage tetap sebagaimana dijelaskan di atas; enforcement user-token WorkPulse sudah diuji melalui RLS lokal. Service role hanya digunakan pada server setelah authorization domain.
- Folder kerja disposable tersisa di `%TEMP%`; container, volume, network, database aktif, dan source workspace tidak terkena penghapusan.

## Langkah berikutnya

T06 Activity persistence, mengikuti dependency plan. Tidak ada pekerjaan T06 yang dimulai dalam checkpoint T05.

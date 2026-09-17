# Verifikasi T05 Private Storage Foundation

Tanggal: 17 September 2026.

Status: **DONE**. Dependensi T02 selesai; baseline T01–T04 tetap utuh. Integration review Gate M1 menutup fondasi storage privat dan menjadikan T06 Activity persistence sebagai task berikutnya.

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

Decision `0007-private-storage-foundation.md` mencatat bucket/key contract, server-only signed URL, queue durable, scanner fail-closed, dan batas ACL provider. Tabel Storage dibuat oleh `supabase_storage_admin`; role migrasi proyek tidak dapat mencabut ACL provider-level itu. RLS tetap aktif tanpa policy WorkPulse untuk `anon`/`authenticated`. Test Storage lokal membuktikan direct user-token metadata/sign/upload ditolak dan delete tidak mengubah object; pemeriksaan metadata sesudah percobaan delete memastikan API yang tidak mengembalikan error tidak dianggap berhasil.

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

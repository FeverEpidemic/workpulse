# T23 Fase 1 — Database: guard tulis, antrean penghapusan, purge berurutan

- Tanggal: 9 Oktober 2026
- Eksekutor: Claude Sonnet 5.5

## File berubah

| File | Perubahan |
| --- | --- |
| `supabase/migrations/20261009090000_t23_account_deletion.sql` | baru: `internal.guard_account_writable()` + trigger, `internal.account_deletions`, sembilan fungsi `public` |
| `supabase/tests/database/account_deletion.test.sql` | baru: 103 assertion |
| `src/server/supabase/database.types.ts` | regenerasi (`supabase gen types`) |

Tidak ada migration T02–T22 yang diubah.

## Command (hasil nyata)

| Command | Hasil |
| --- | --- |
| pgTAP baru dijalankan sebelum migration | gagal (`internal.account_deletions` tidak ada) — TDD merah terbukti |
| `pnpm exec supabase migration up --local` | exit 0; `migration list --local` menunjukkan `20261009090000` lokal = remote (**32/32**) |
| `supabase/tests/database/account_deletion.test.sql` | **0 not ok** (`prove`: 103 assertion lulus; hitungan baris `ok` mentah psql lebih besar karena baris keluaran lain ikut cocok, jadi angka resmi adalah milik `pnpm db:test`) |
| `pnpm db:test` | **16 file / 1393 assertion**, Result: PASS (baseline 15 file / 1290; +103 assertion yang dihitung `prove` untuk file baru) |
| `pnpm db:lint` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` (setelah regenerasi types) | exit 0 |

## Desain yang terbukti

- **Guard katalog.** Trigger `zz_guard_account_writable` terpasang pada 17 tabel `public` ber-`user_id` + `profiles` lewat blok `do $$` atas katalog. Test membandingkan jumlah trigger dengan jumlah tabel ber-`user_id` + 1 dan memastikan tidak ada tabel tanpa trigger, sehingga tabel baru tanpa guard akan menggagalkan test.
- **Pesan dan kode.** Akun `deleting` yang menulis lewat RPC tanpa pemeriksaan sendiri (contoh `update_skill`) mendapat `42501|ACCOUNT_DELETING` dari trigger; RPC yang sudah memeriksa sendiri tetap `42501|AUTH_REQUIRED`. Test per domain menerima keduanya: profil, onboarding, foundation (create/update/delete), activity, project, achievement, mulai import, AI request, consent, pilih CV, edit CV, request export, retry export, unduh export, dan preview.
- **Akun lain tidak terpengaruh.** Akun `db` tetap dapat menulis; akun non-deleting tetap dapat `update_profile`.
- **Antrean tanpa FK.** `internal.account_deletions` tanpa constraint foreign key, RLS aktif, dan tanpa privilege tabel untuk `anon`/`authenticated`/`service_role`. Setelah `delete from auth.users`, baris `internal.storage_jobs` dan receipt tetap ada dan dapat di-claim.
- **Begin idempotent.** Panggilan kedua mengembalikan `already_requested = true` dan `requested_at` yang sama; hanya satu receipt. `authenticated` dan `anon` ditolak dengan `permission denied`.
- **Claim, lease, CAS.** Lease hidup tidak di-claim dua kali; lease kedaluwarsa di-claim ulang dengan `attempt_count = 2` dan token baru; token lama ditolak oleh `purge_account_data` (`P0001|ACCOUNT_PURGE_LEASE_LOST`), `mark_account_auth_deleted`, dan `retry_account_deletion_job`.
- **Purge.** Empat key berbeda diantrekan sebelum DELETE pertama: evidence, import, objek yatim, dan objek export tanpa baris. Semua baris di 21 tabel (17 `public` + empat `internal`) nol setelahnya; profil tersisa sebagai tombstone dan tetap `deleting`. Purge ulang tidak error. Akun lain tidak berubah (education, item CV, storage job).
- **Rollback.** Trigger paksa pada `education` membuat purge gagal di tengah (`FORCED_FAILURE`); `skills` dan `education` tetap ada dan `rows_purged_at` tetap NULL, sehingga transaksi terbukti ter-rollback penuh.
- **Selesai.** `verify_account_purges` tidak menandai `completed` selama objek prefix, job `queued`/`running`, atau job `failed` masih ada; `completed` setelah semuanya bersih dengan empat timestamp terisi. `get_account_deletion_backlog` melaporkan `pending` dan `overdue` (> 24 jam). `prune_account_deletion_receipts` hanya memangkas receipt `completed` yang lebih tua dari 30 hari.
- **Purge setelah user Auth hilang** (crash setelah `deleteUser`) adalah no-op sukses.

## Penyimpangan dari plan (perlu dilihat reviewer)

1. **Kondisi guard lebih ketat dari §2.2.1.** Plan: lewati bila `auth.uid()` NULL. Implementasi: guard aktif hanya bila `auth.uid()` terisi **dan** role DB aktif adalah `authenticated`.
   - *Alasan:* suite lama `ai_jobs.test.sql` dan `cv_export.test.sql` memanggil RPC worker sebagai owner DB dengan klaim JWT pengguna `deleting` yang tertinggal dari langkah sebelumnya, sehingga `auth.uid()` terisi. Dengan syarat plan murni, kedua suite lama gagal. Di produksi, PostgREST selalu menjalankan request pengguna sebagai role `authenticated`, dan worker/purge memakai `service_role`, jadi perilaku runtime sama dengan niat plan.
   - Suite lama tidak diubah dan lulus utuh. Test baru menjalankan bagian guard di bawah `set local role authenticated` dan membuktikan bahwa sesi owner dengan klaim usang serta role `service_role` tidak terkena guard.
   - Ini sebuah keputusan desain yang menyimpang dari teks plan; tolong ditinjau pada gate review.
2. **Migration diubah setelah diterapkan lokal (milik T23 sendiri, belum pernah di-commit).** Fungsi guard direvisi dua kali sebelum commit pertama. Perubahan diterapkan ke DB lokal dengan `create or replace function` berisi teks yang identik dengan file migration (bukan `db reset`); tidak ada migration lama yang disentuh.
3. **Purge tabel internal tambahan.** `internal.evidence_scan_jobs`, `internal.evidence_reservation_requests`, `internal.import_jobs` dihapus eksplisit (lihat receipt Fase 0).
4. **Jumlah key dalam test** adalah 4, bukan "≥ 5": `cv_exports.object_key` fixture NULL; export `succeeded` diwakili oleh objek prefix.
5. **Objek non-kanonis** di prefix `<user_id>/` tidak dapat diantrekan (CHECK `storage_jobs_key_owner_check`) dan akan menahan receipt di `purged` sehingga terlihat di backlog overdue; ini disengaja dan belum diuji karena tidak ada kode yang membuat objek non-kanonis.
6. **Race tulis** (§2.2.1 "Race") tidak diuji paralel di fase ini; argumen diserahkan ke decision 0029 dan review.

## Acceptance Fase 1 yang terbukti

§1.3 (begin atomik, idempotent, hanya service role), §1.5 (guard katalog + kode stabil, service role tidak terkena guard), §1.6 (unduhan ditolak: `get_cv_export_download`; unduhan evidence lewat `get_evidence_file` service role sudah memeriksa `deleting_at`, dibuktikan di Fase 6), §1.8 (urutan enqueue-lalu-delete dan rollback), §1.10 (antrean bertahan setelah FK hilang), §1.12 sebagian (verify, backlog; reconcile job `failed` dibuktikan di Fase 6).

## Belum terbukti di fase ini

§1.1–2 (UI dan reautentikasi), §1.4, §1.7, §1.9, §1.11, §1.13–§1.20.

## Langkah berikutnya

Fase 2: migration retensi (`20261009100000_t23_retention.sql`) dan `retention.test.sql`.

# Decision 0029 — T23 Account deletion dan retention

Date: 10 Oktober 2026

Status: Accepted (acceptance lokal, 10 Oktober 2026). Task: T23 (PRD R01, *Deletion*, *Data minimization*; Wireframe S12, S03, S14; DB §4/§5/§6). [Rencana](../verification/T23-implementation-plan.md), [bukti](../verification/T23-account-deletion-retention.md), [gate review](../verification/T23-gate-review.md).

## References

- **PRD:**
  - R01 (*another account cannot read or mutate any record or file*);
  - *Privacy and safety*: *Deletion* (*revokes sessions immediately, removes active data and objects within 24 hours, and expires backups within 30 days*), *Data minimization* (file import dan teks staging dihapus ≤ 24 jam setelah terminal), *Failures* (job durable);
  - M5 (*Instrumentation, access review, deletion, regression*).
- **Wireframe:** S12 `/settings/profile` (*reauthentication and a clear data loss confirmation, then revokes sessions and queues deletion; explain backup retention in the privacy detail*).
- **Database Schema:** §4 *Storage protocol*, *File retention*; §5 *Deletion and export consistency*; §6 *Delete account*.
- **Implementation plan:** §3 *Jobs dan data privat*, §4 baris *Cleanup account dapat kehilangan antrean*, blok T23 (M5), §8 *Worker host, storage retention dan backup policy*.
- **Handoff dan receipt:** `docs/verification/T23-implementation-plan.md`; receipt fase `docs/verification/T23-phase0-baseline.md` sampai `T23-phase8-regression.md`.
- **Decision terkait:** 0002 (lifecycle profil), 0021 (batch `review` ditinggalkan), 0023 (purge batch review milik T23), 0027 (N2 retensi snapshot), 0028 (N4 Retry tanpa cek readiness).

## Context

Sebelum T23, profil punya `deleting_at` dan `internal.mark_account_deleting`, antrean cleanup objek `internal.storage_jobs` tanpa FK, dan job import/export/evidence yang berhenti bila akun `deleting`. Tidak ada jalur bagi pengguna untuk menghapus akun, tidak ada yang menghapus baris akun, dan tiga utang retensi tertunda: batch `review` yang ditinggalkan (0021, 0023), snapshot export yang tinggal sampai akun dihapus (0027 N2), dan *Retry* export tanpa validasi ulang (0028 N4).

T23 menambah dua migration forward-only (parity 31 → 33), satu pass worker, S12, dan langkah retensi aditif pada pass import dan export.

Ketujuh keputusan produk §2.4 handoff disetujui pengguna pada 8 Oktober 2026 ("Setuju semua"):

1. reautentikasi dengan memasukkan ulang password;
2. konfirmasi dengan mengetik email akun, ditambah hitungan data yang hilang;
3. tanpa masa tenggang dan tanpa undo;
4. copy retensi backup menyatakan kebijakan *deleted within 30 days*;
5. batch `review` dibatalkan otomatis setelah 30 hari tanpa perubahan;
6. snapshot export dikosongkan saat PDF dipurge dan 24 jam setelah export gagal;
7. *Retry* ditolak bila CV berubah atau terblokir.

Eksekusi dimulai sebelum laporan Gate M4 memiliki verdict tertulis, berdasarkan perintah ulang pengguna ("Coba Eksekusi ulang Plan T23"); asumsi itu tercatat di receipt Fase 0. Pada gate review T23 (10 Oktober 2026) pengguna menegaskan Gate M4 sudah dikerjakan dan T23 boleh ditutup.

## Hasil probe Fase 0

- **Cascade dari `profiles` gagal.** `delete from auth.users` dan `delete from public.profiles` sama-sama gagal: trigger `clear_experience_context_before_delete` meng-update `projects` ketika profil sudah terhapus, sehingga FK `projects_user_id_fkey` dilanggar. Dugaan plan (CHECK `cv_items_source_check`) tidak menjadi penyebabnya, tetapi kesimpulannya sama. Urutan DELETE eksplisit dengan profil disisakan berhasil.
- **Auth lokal.** `signOut({ scope: "global" })` membuat access token lama gagal pada `getUser()` dan refresh token lama ditolak. Auth memeriksa ban sebelum password, jadi akun banned menerima `user_banned` untuk password benar maupun salah. `admin.deleteUser` menghapus profil lewat FK dan panggilan kedua mengembalikan 404. `auth.uid()` NULL untuk secret key. Client sekali pakai (`persistSession: false`) tidak mengubah sesi browser.

## Keputusan

1. **Guard tulis lewat trigger generik, bukan per-RPC.**
   - `internal.guard_account_writable()` dipasang sebagai trigger `zz_guard_account_writable` (BEFORE INSERT OR UPDATE OR DELETE, per baris) pada setiap tabel `public` ber-kolom `user_id` dan `profiles`, lewat blok `do` atas katalog. Test pgTAP gagal bila ada tabel ber-`user_id` tanpa trigger.
   - Penolakan: SQLSTATE `42501`, pesan `ACCOUNT_DELETING`. RPC yang sudah memeriksa sendiri tetap `42501 AUTH_REQUIRED`; layanan memetakan keduanya ke `UNAUTHENTICATED`.
   - *Alasan:* sekitar 27 RPC tulis pengguna tidak memeriksa `deleting_at` di badan fungsinya (matriks di receipt Fase 0). Mengedit setiap RPC berisiko terlewat; trigger menutup tabel masa depan.
2. **Syarat guard lebih sempit dari handoff.** Guard aktif hanya bila `auth.uid()` terisi **dan** role DB aktif adalah `authenticated`. Handoff menulis "lewati bila `auth.uid()` NULL".
   - *Alasan:* suite lama `ai_jobs.test.sql` dan `cv_export.test.sql` memanggil RPC worker sebagai owner DB dengan klaim JWT pengguna `deleting` yang tertinggal, sehingga `auth.uid()` terisi. Dengan syarat murni, keduanya gagal dan tidak boleh diubah. Di runtime, PostgREST selalu menjalankan request pengguna sebagai `authenticated`, sedangkan worker, purge, dan Auth admin memakai `service_role`; perilaku produksi sama dengan niat handoff.
   - *Konsekuensi:* guard tidak berlaku untuk sesi database yang bukan `authenticated`. Itu sesi owner atau service, yang memang tidak dapat dicapai pengguna.
3. **Antrean `internal.account_deletions` tanpa FK**, mengikuti `internal.storage_jobs`: claim `skip locked`, lease 120 detik, token attempt, CAS, status `queued` → `running` → `purged` → `completed`, dan CHECK state. Hanya memuat user id, timestamp, status, dan kode error allowlist. RLS aktif dan semua privilege tabel dicabut dari role API.
4. **Mulai penghapusan.** `begin_account_deletion` hanya untuk `service_role`: mengunci profil, mengisi `deleting_at`, dan membuat receipt dalam satu transaksi; idempotent. Server action memverifikasi password lewat client Auth sekali pakai dengan email dari sesi, membandingkan user id hasil verifikasi, lalu memanggil RPC, mem-ban user (`ban_duration: 876000h`), `signOut({ scope: "global" })`, dan menghapus cookie. Kegagalan ban atau sign-out sesudah `begin` dicatat sebagai `revokeDeferred`, bukan error: penghapusan sudah dikomit dan worker tetap menghapus user Auth.
5. **Purge berurutan dengan tombstone profil.** `purge_account_data(user, token)`, satu transaksi:
   - mengantrekan setiap key yang diketahui baris (`evidence_files.object_key`, `import_batches.file_key`, `cv_exports.object_key` yang belum dipurge) ditambah setiap objek kanonis di prefix `<user_id>/`, sehingga objek yatim ikut;
   - mengembalikan job `failed` (dan `succeeded` yang objeknya muncul lagi) ke `queued`;
   - menghapus baris dalam urutan: export, item CV, dokumen CV, review dan job AI, batch import, evidence beserta job scan dan reservasinya, chat, achievement-skill, achievement, activity, project, skill, certification, education, experience, `operation_requests`, `import_jobs`;
   - menyisakan profil sebagai tombstone `deleting`, sehingga sign-in pada jendela ini tetap melihat status deleting.
   - Kegagalan di tengah me-rollback seluruh transaksi (terbukti pgTAP). Objek non-kanonis di prefix tidak dapat diantrekan (CHECK `storage_jobs_key_owner_check`) dan menahan receipt di `purged`, sehingga terlihat di backlog overdue alih-alih hilang diam-diam.
6. **Hapus user Auth lewat Admin API** (`deleteUser(id, false)`, hard delete), 404 dianggap selesai; cascade `auth.users` → `profiles` menghapus tombstone. Tidak ada DML langsung ke skema `auth` dari migration. `mark_account_auth_deleted` (CAS) lalu mengisi `auth_deleted_at` dan status `purged`.
7. **Selesai hanya bila bersih.** `verify_account_purges` menandai `completed` bila tidak ada objek di prefix dan tidak ada storage job `queued`/`running`/`failed` untuk user itu. `get_account_deletion_backlog` melaporkan `pending` dan `overdue` (> 24 jam sejak `requested_at`). `prune_account_deletion_receipts` memangkas receipt `completed` yang lebih tua dari 30 hari.
8. **Worker.** Pass `account-deletion` (`workers/account-deletion-worker.ts`): verify dan prune, claim ≤ 5, lalu per job `purge` → `deleteUser` → `mark`. Error apa pun menjadi retry dengan kode allowlist (`ACCOUNT_PURGE_FAILED`, `AUTH_DELETE_FAILED`, `WORKER_BACKEND_UNAVAILABLE`) dan backoff 1, 5, 15, 60 menit, lalu 60 menit tanpa batas attempt. Pass terisolasi di `run.ts` seperti pass lain.
9. **Retensi aditif.**
   - `expire_abandoned_import_reviews` (30 hari tanpa perubahan batch atau item; batas 7 sampai 365) memakai transisi yang sama dengan `cancel_import_batch`; purge T15 lalu menghapus file dan teks. Pass import memanggilnya sebelum `purge_expired_import_batches`.
   - `cv_exports.snapshot_purged_at`: snapshot menjadi `'{}'` saat `expire_cv_exports` mempurge export sukses dan, lewat `redact_cv_export_snapshots`, 24 jam setelah `finished_at` export gagal. `guard_cv_export_row` hanya mengizinkan transisi itu; aturan immutable lain tidak berubah.
   - `retry_cv_export` menolak dengan `EXPORT_RETRY_UNAVAILABLE` bila revision CV berubah, CV terblokir, atau snapshot kosong. S14 hanya menawarkan *Retry* bila CV siap dan snapshot ada.
10. **S12.** Kartu *Privacy and account* dengan satu tombol sekunder; dialog `Dialog` bersama berisi hitungan dari `get_account_deletion_preview`, field password, field email konfirmasi, dan tombol danger yang nonaktif sampai email cocok. Copy privasi menyatakan 24 jam untuk data aktif dan berkas serta 30 hari untuk salinan cadangan sebagai kebijakan.
11. **Pesan sign-in.** Karena Auth memeriksa ban sebelum password, pesan `auth.accountDeleting` tidak dipilih dari error ban (akan membuka enumerasi akun); `user_banned` dipetakan ke pesan kredensial generik. Cabang `accountDeleting` pada `signInAction` hanya terjangkau bila ban gagal terpasang.

## Argumen race guard tulis

Sebuah tulisan yang membaca `deleting_at` NULL sebelum `begin_account_deletion` commit masih dapat commit. Baris yang lolos itu tetap terhapus oleh purge berikutnya, karena purge menghapus semua baris pemilik dan menunggu lock profil `for update`. Objek yang terunggah lewat signed URL setelah purge tertangkap oleh antrean prefix pada pass berikutnya, oleh reconcile orphan kategori, dan oleh `verify_account_purges` yang membaca `storage.objects`. Race ini belum diuji secara paralel; argumennya adalah urutan lock, bukan percobaan.

## Sisa risiko

- **Access token JWT** yang sudah terbit tetap diterima PostgREST sampai `exp` (`jwt_expiry = 3600`, `supabase/config.toml:170`). Test integration membuktikan bahwa penulisan dengan token itu ditolak guard (`42501`), tetapi pembacaan yang diizinkan RLS untuk akun `deleting` dapat berlanjut sampai token kedaluwarsa. Ban dan sign-out global mencabut refresh token dan sesi Auth segera.
- **Receipt tidak selamat dari restore backup yang lebih lama.** Receipt dipangkas 30 hari, tetapi restore ke titik sebelum penghapusan juga menghilangkan receipt-nya. Menerapkan ulang penghapusan setelah restore membutuhkan daftar user id yang disimpan di luar database; ini dicatat sebagai item T25 di runbook.
- **Retensi backup ≤ 30 hari belum terverifikasi.** Hanya kebijakan; bergantung pada konfigurasi layanan hosted (T25).
- **Export yang sudah dipurge sebelum T23** tidak dikosongkan oleh migration: `expire_cv_exports` hanya mengosongkan snapshot pada saat purge, dan `redact_cv_export_snapshots` hanya mencakup export gagal. README menyatakan belum ada deployment, jadi baris seperti itu hanya ada di database pengembangan; bila suatu hari ada, kosongkan dengan satu update terkontrol sebelum rilis.
- **Tanggal pembatalan di S03** diformat UTC; untuk zona waktu jauh dari UTC dapat berselisih paling banyak satu hari.

## Alternatif yang ditolak

- **Guard per RPC.** Menyisakan celah di RPC yang tidak diedit dan di tabel baru.
- **Cascade dari `profiles`.** Gagal pada probe Fase 0.
- **DML langsung ke skema `auth` atau `storage`.** Dilarang; Admin API dipakai untuk Auth dan antrean untuk Storage.
- **Reautentikasi OTP email.** Butuh mail sink dan langkah tambahan; password sudah tersedia.
- **Masa tenggang dan undo.** Bertentangan dengan "revokes sessions immediately" dan menambah state dan UI.
- **Memeriksa ban untuk memilih pesan sign-in.** Membuka enumerasi akun.

## Seam ke task berikutnya

- **T24:** event analytics (export terminal, penghapusan akun), p95, biaya reconcile, dan metrik backlog dari `get_account_deletion_backlog`.
- **T25:** verifikasi retensi backup dan purge ≤ 24 jam pada layanan hosted, alert backlog penghapusan dan cleanup, deployment worker, dan runbook restore yang menerapkan ulang penghapusan dari ledger di luar database.

## Gate review

Gate review Claude (Opus) pada `f29e682`: tidak ada P0–P2 di database, Auth, service, worker, dan retensi ([T23-gate-review.md](../verification/T23-gate-review.md)). Reviewer menerima penyimpangan keputusan 2 (guard hanya untuk role `authenticated`) setelah probe lewat PostgREST menghasilkan `42501 ACCOUNT_DELETING`.

Tinjauan UI antislop (mode *during*, dipilih pengguna) menemukan satu bug state yang diperbaiki reviewer di `7ad7d91`: error dari percobaan yang sudah ditutup tampil lagi saat dialog dibuka ulang, dan jawaban pratinjau yang terlambat dapat menimpa hitungan pembukaan baru. Bukti: unit `visibleDeletionState` dan langkah E2E baru, gagal pada kartu lama (`toHaveCount(0)` menerima 1) dan lulus sesudahnya.

P3 yang dibiarkan terbuka tercantum di gate review (F1, F4, F6, F9).

## Perubahan pada test lama

Tidak ada assertion yang dilemahkan. Yang berubah: daftar kunci ringkasan worker, daftar kode error dan kolom aman yang bertambah (`EXPORT_RETRY_UNAVAILABLE`, `snapshot_purged_at`), assertion Retry T22 yang bertentangan dengan keputusan 9 (Retry hanya saat CV siap), dan satu kolom `updated_at` pada select view service S03. Rinciannya ada di receipt Fase 2, 3, 5, dan 6.

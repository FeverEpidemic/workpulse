# Handoff T23 Account deletion dan retention — eksekusi single-agent

> **Untuk agen pelaksana:**
> - Kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai.
> - Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit.
> - Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.
> - Semua nama migration, tabel, fungsi SQL, kode error, route, komponen, key i18n, script, port, dan path di dokumen ini **dibekukan**; jangan mengganti namanya.
> - Migration bersifat forward-only. Migration yang sudah diterapkan ke database lokal tidak boleh diedit; perbaikan masuk migration baru. Jangan pernah `db:reset`.

- Tanggal: 8 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Dependensi:
  - T17 **DONE**: import review UI, `cancel_import_batch`, purge batch terminal T15.
  - T22 **DONE**: S14, aturan Retry/Regenerate `src/domain/cv/export-view.ts`, decision 0028 (P3 N4 ditunda ke T23).
  - T21 **DONE**: `cv_exports` lifecycle, `expire_cv_exports`, `reconcile_orphan_export_objects`, decision 0027 (N2 retensi snapshot ditunda ke T23).
  - T10/T11 **DONE**: `internal.storage_jobs`, cleanup evidence, `reconcile_orphan_evidence_objects`.
  - T05 **DONE**: `internal.enqueue_storage_delete` dan antrean tanpa FK.
  - T02/T03 **DONE**: `profiles.deleting_at`, `internal.mark_account_deleting` (decision 0002 poin 7: orkestrasi milik T23).
- **Gate M4: belum dijalankan saat plan ditulis** (`IMPLEMENTATION_STATUS.md` baris 80–87). T23 tidak boleh dimulai sebelum Gate M4 PASSED, kecuali pengguna mengizinkan secara eksplisit. Fase 0 memeriksanya.
- Eksekutor: satu agent **Claude Sonnet 5.5**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 8; Fase 9 (draft dokumen) dikerjakan setelah gate. Checkpoint Claude setelah Fase 0 **wajib** (hasil probe cascade dan probe auth menentukan desain Fase 1 dan 4).
- Keputusan produk: tujuh keputusan §2.4 **menunggu persetujuan pengguna**. Pelaksana berhenti di akhir Fase 0 bila persetujuan belum tercatat di plan ini.
- Acuan:
  - **PRD:** R01 (*Another account cannot read or mutate any record or file*), tabel *Privacy and safety*: *Deletion* (*Account deletion revokes sessions immediately, removes active data and objects within 24 hours, and expires backups within 30 days*), *Data minimization* (file import dan teks staging dihapus ≤ 24 jam setelah terminal), *Failures* (job durable), M5 (*Instrumentation, access review, deletion, regression*).
  - **Wireframe S12** `/settings/profile`: *Account deletion requires reauthentication and a clear data loss confirmation, then revokes sessions and queues deletion. Explain backup retention in the privacy detail.* Aturan umum: konfirmasi destruktif memakai nama record.
  - **Database Schema** §4 *Storage protocol*, *File retention* (antrean `storage_jobs` tanpa FK, bertahan sampai penghapusan objek terverifikasi; mapping import dan metadata status bertahan sampai akun dihapus), §5 *Deletion and export consistency*, §6 tabel *Delete account* (*Mark deleting, revoke sessions, deny writes, enqueue all objects before deleting account rows. Purge active data within 24 h; backups expire within 30 days. Worker checks deleting state before retries*).
  - **`IMPLEMENTATION_PLAN.md`:** blok T23 (§5 M5), §3 *Jobs dan data privat*, §4 baris *Cleanup account dapat kehilangan antrean*, §8 baris *Worker host, storage retention dan backup policy*.
  - **Decision:** 0002 (lifecycle profil), 0021 (T15 RV2 batch `review` ditinggalkan), 0023 (T17: purge batch review milik T23), 0027 (N2 retensi snapshot), 0028 (N4 Retry tanpa cek readiness).
  - **`Design.md`:** dialog destruktif, Button danger, status tidak bergantung warna.

**Goal:** Pengguna dapat menghapus akunnya dari S12. Setelah memasukkan ulang password dan mengetik email akun sebagai konfirmasi:

- akun ditandai `deleting` dan semua tulisan pengguna ditolak di database;
- semua session dicabut dan sign-in diblokir saat itu juga;
- worker yang tahan restart mengantrekan seluruh objek privat lebih dulu, lalu menghapus semua baris akun dan user Auth;
- antrean cleanup objek tetap hidup setelah baris akun hilang, dan penyelesaian purge tercatat dengan timestamp.

Selain itu, T23 menutup tiga utang retensi:

- batch import `review` yang ditinggalkan dibatalkan otomatis lalu dipurge;
- snapshot export dikosongkan setelah PDF kedaluwarsa atau gagal;
- *Retry* export ditolak bila CV sudah berubah atau terblokir.

Retensi backup ≤ 30 hari didokumentasikan sebagai kebijakan dengan runbook verifikasi. Klaim itu tidak boleh dinyatakan terbukti dari stack lokal.

**Architecture:** Dua migration forward-only (parity 31 → **33**).

- **Guard tulis.** Trigger generik `internal.guard_account_writable()` dipasang pada setiap tabel `public` milik pengguna. Trigger menolak INSERT/UPDATE/DELETE dari request pengguna (`auth.uid()` tidak NULL) bila profil pemilik sudah `deleting`. Request service role (worker, purge) tidak terpengaruh.
- **Antrean penghapusan.** Tabel `internal.account_deletions` tanpa FK (receipt per akun) dengan claim, lease 120 detik, attempt token, dan CAS, mengikuti pola `internal.storage_jobs`.
- **Mulai.** Server action S12 memverifikasi password lewat client Auth sekali pakai, memanggil RPC service-role `begin_account_deletion`, mem-ban user lewat Admin API, mencabut semua session (`signOut({ scope: "global" })`), menghapus cookie, lalu redirect ke `/sign-in?notice=accountDeleted`.
- **Purge.** Pass worker baru `account-deletion` menjalankan `purge_account_data`: mengantrekan semua objek, lalu menghapus baris dengan urutan aman dalam satu transaksi, dengan baris profil disisakan sebagai tombstone. Setelah itu worker memanggil `auth.admin.deleteUser`, `mark_account_auth_deleted`, dan akhirnya `verify_account_purges` menandai selesai bila prefix Storage kosong.
- **Retensi.** Pass import dan export yang ada mendapat langkah aditif: `expire_abandoned_import_reviews` dan `redact_cv_export_snapshots`.

**Tech stack:** Supabase PostgreSQL (plpgsql, pgTAP), Supabase Auth Admin API lewat `@supabase/supabase-js` yang sudah terpasang, Next.js 16 server action + React 19, Zod 4, Tailwind 4 + token `Design.md`, lucide-react, Vitest (unit, integration), Playwright + axe-core (config baru port **3015**). Tidak ada dependency npm baru.

---

## 0. Cara memakai handoff ini

**Urutan baca.** Baca dokumen ini sampai selesai sebelum mengubah kode, lalu:

1. `AGENTS.md` (bagian *Files, import, dan cleanup* dan *Ownership*).
2. Entry teratas `docs/IMPLEMENTATION_STATUS.md` (T22, T21) dan entry Gate M4 bila sudah ada.
3. `docs/IMPLEMENTATION_PLAN.md` §3, §4, blok M5 (T23), §8.
4. Decision 0002, 0021, 0023, 0027, 0028.
5. `docs/verification/T21-implementation-plan.md` sebagai pola fase database + worker + integration.
6. `docs/verification/T10-scanner-runbook.md`, `T15-renderer-runbook.md`, `T21-pdf-renderer-runbook.md` (container yang dibutuhkan regresi).

Ekstrak ulang PRD *Privacy and safety*, S12, dan DB §4/§6 dengan alat ekstraksi DOCX (`python -I` + `zipfile` atas `word/document.xml`; `python-docx` tidak terpasang). Jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD Deletion:** penghapusan akun mencabut session seketika, menghapus data aktif dan objek dalam 24 jam, dan backup kedaluwarsa dalam 30 hari.
- **PRD Data minimization:** file import asli dan teks staging dihapus dalam 24 jam setelah commit, cancel, atau gagal terminal.
- **S12:** penghapusan akun mewajibkan reautentikasi dan konfirmasi kehilangan data yang jelas, lalu mencabut session dan mengantrekan penghapusan. Detail privasi menjelaskan retensi backup.
- **DB §4:** antrean cleanup `storage_jobs` tidak punya FK ke parent, tidak dapat diakses client, dan disimpan sampai penghapusan objek terverifikasi. Mapping import dan metadata status minimal bertahan sampai akun dihapus.
- **DB §6 Delete account:** tandai deleting, cabut session, tolak tulisan, antrekan semua objek sebelum menghapus baris akun. Purge data aktif ≤ 24 jam; backup kedaluwarsa ≤ 30 hari. Worker memeriksa status deleting sebelum retry.
- **Rencana §4:** antrean cleanup internal tanpa FK cascade ke profil. Urutannya: antrekan semua objek, blokir tulisan, cabut session, purge baris. Simpan receipt minimal sampai penghapusan objek terverifikasi.
- **Rencana §5 T23 (kalimat selesai):** worker restart tidak kehilangan cleanup, akun terhapus tidak dapat me-retry job, antrean yang bertahan setelah FK dihapus teruji, dan bukti retensi tercatat. Retensi yang belum dapat dibuktikan tidak boleh dijanjikan.

**Aturan kerja:**

- Pertahankan perubahan lokal pengguna.
- Jangan menandai T23 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`.
- Pada akhir setiap fase, tulis **receipt** di `docs/verification/T23-phaseN-<slug>.md` berisi:
  - tujuan dan file berubah;
  - command beserta hasil aktual (exit code dan angka pass/fail);
  - acceptance yang terbukti;
  - warning/kegagalan dan blocker;
  - langkah berikutnya.
- Angka di receipt harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T23

T23 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Entry dan reautentikasi.** S12 punya bagian *Privacy and account* dengan aksi *Delete account*. Dialog meminta password akun saat ini.
   - Password diverifikasi server dengan email dari session, bukan dari form.
   - Password salah → error di field, tanpa perubahan state apa pun.
   - Rate limit Auth → pesan yang dapat dipulihkan.
   - Dibuktikan unit service + integration Auth nyata + E2E.
2. **Konfirmasi kehilangan data.** Dialog menampilkan jumlah data yang akan hilang dari `get_account_deletion_preview()`: activity, achievement, project, file evidence, import, dan status CV/export. Pengguna mengetik email akunnya (trim, tidak peka huruf besar). Tombol *Delete account permanently* nonaktif sampai cocok, dan server menolak bila tidak cocok. Dibuktikan unit domain + E2E.
3. **Mulai penghapusan atomik dan idempotent.**
   - `begin_account_deletion(p_user_id)` mengunci profil, mengisi `deleting_at`, dan membuat receipt `internal.account_deletions` dalam satu transaksi.
   - Panggilan kedua mengembalikan receipt yang sama tanpa error.
   - Hanya `service_role` yang dapat mengeksekusinya; `authenticated` dan `anon` ditolak, sehingga reautentikasi tidak dapat dilewati dengan memanggil RPC langsung.
   - Dibuktikan pgTAP.
4. **Session dicabut seketika.** Setelah action sukses:
   - browser yang sama ter-sign-out dan diarahkan ke `/sign-in?notice=accountDeleted`;
   - session kedua milik user yang sama (konteks browser lain) kehilangan akses pada navigasi berikutnya dan refresh token-nya ditolak;
   - sign-in ulang dengan password benar ditolak dengan pesan §2.2.8.

   Sisa risiko access token JWT (berlaku sampai `exp`, `jwt_expiry = 3600` di `supabase/config.toml:170`) untuk panggilan PostgREST langsung dicatat. Tulisan tetap ditolak oleh poin 5. Dibuktikan integration + E2E dua konteks.
5. **Tulisan ditolak di database.**
   - Trigger `guard_account_writable` terpasang pada **setiap** tabel `public` yang punya kolom `user_id`, ditambah `public.profiles`. Test katalog pgTAP gagal bila ada tabel baru tanpa trigger.
   - Untuk akun `deleting`, panggilan RPC pengguna per domain gagal dengan SQLSTATE `42501` dan pesan `ACCOUNT_DELETING`: profil, foundation, activity, achievement, project, reservasi evidence, mulai import, AI request/retry, CV select/save/request export/retry export.
   - Server action memetakan error itu ke `UNAUTHENTICATED`.
   - Request service role tidak terkena guard.
   - Dibuktikan pgTAP + integration.
6. **Unduhan ditolak.** Evidence, export CV, dan apa pun yang menerbitkan signed URL untuk akun `deleting` → ditolak dengan error generik yang sama dengan record tidak ada. Dibuktikan pgTAP/integration.
7. **Job tidak berjalan untuk akun deleting.** Untuk job AI, import, dan export yang masih `queued` saat penghapusan dimulai:
   - worker tidak memanggil provider AI, parser/renderer, atau upload Storage untuk akun itu;
   - retry pengguna ditolak (poin 5).

   Dibuktikan integration dengan worker nyata + adapter fake penghitung panggilan.
8. **Objek diantrekan sebelum baris dihapus.** Dalam transaksi `purge_account_data`, sebelum DELETE pertama, setiap object key yang diketahui baris diantrekan:
   - `evidence_files.object_key`;
   - `import_batches.file_key`;
   - `cv_exports.object_key` yang belum dipurge.

   Selain itu, setiap objek `storage.objects` di prefix `<user_id>/` ikut diantrekan, termasuk objek yatim tanpa baris. Job `failed` untuk key yang sama dikembalikan ke `queued`. Bila purge gagal di tengah, seluruh transaksi rollback dan tidak ada baris yang hilang. Dibuktikan pgTAP (urutan dan rollback) + integration (objek nyata di tiga kategori + satu objek yatim).
9. **Purge lengkap.** Setelah pass worker dan pass cleanup:
   - nol baris di setiap tabel ber-`user_id` (dicek dari katalog);
   - `public.profiles` dan `auth.users` untuk user itu tidak ada;
   - prefix Storage kosong;
   - receipt berstatus `completed` dengan `requested_at`, `rows_purged_at`, `auth_deleted_at`, `completed_at`.

   Dibuktikan integration.
10. **Antrean bertahan setelah FK hilang.** Setelah `delete from auth.users` (pgTAP, superuser), baris `internal.storage_jobs` dan `internal.account_deletions` milik user itu tetap ada dan dapat di-claim. Dibuktikan pgTAP.
11. **Worker restart tidak kehilangan pekerjaan.** Simulasi crash di tiga titik:
    - setelah claim;
    - setelah `purge_account_data`;
    - setelah `deleteUser` sebelum `mark_account_auth_deleted`.

    Setelah lease lewat, job di-claim ulang dan selesai. Setiap langkah idempotent: purge ulang tanpa error, `deleteUser` 404 dianggap selesai. Token attempt lama tidak dapat menyelesaikan job. Dibuktikan unit worker + integration.
12. **Rekonsiliasi cleanup.**
    - `verify_account_purges` tidak menandai `completed` selama masih ada objek di prefix atau storage job `queued`/`running`/`failed` milik user itu.
    - Job cleanup `failed` yang objeknya masih ada diantrekan ulang oleh reconcile kategori yang ada.
    - `get_account_deletion_backlog()` melaporkan jumlah pending dan overdue (> 24 jam sejak `requested_at`).

    Dibuktikan pgTAP + integration.
13. **Bukti retensi tercatat.**
    - Durasi `requested_at` → `completed_at` diukur di integration lokal dan dicatat (harapan: hitungan detik, jauh di bawah 24 jam).
    - `docs/verification/T23-retention-runbook.md` menjelaskan cara memverifikasi purge ≤ 24 jam (query backlog) dan retensi backup ≤ 30 hari pada layanan hosted.
    - Status backup ditulis **belum terverifikasi** sampai T25/staging, kecuali pelaksana mengutip dokumentasi resmi beserta tanggal akses **dan** konfigurasi proyek nyata.

    Dibuktikan oleh dokumen + angka integration.
14. **Isolasi dua akun.**
    - Penghapusan akun A tidak menyentuh baris, objek, storage job, atau session akun B.
    - B tidak dapat memulai penghapusan A: action memakai user dari session, dan RPC hanya service role.
    - Setelah A dihapus, email A dapat mendaftar ulang sebagai akun baru yang kosong.

    Dibuktikan integration + E2E.
15. **Batch import `review` yang ditinggalkan.**
    - `expire_abandoned_import_reviews` membatalkan batch `review` yang tidak berubah selama ≥ 30 hari, dengan status `cancelled` lewat jalur cancel T17. Purge T15 lalu menghapus file dan teks dalam 24 jam.
    - Batch dengan perubahan item terbaru tidak tersentuh.
    - S03 menampilkan tanggal pembatalan otomatis.

    Dibuktikan pgTAP + integration + unit.
16. **Retensi snapshot export (0027 N2).**
    - Snapshot dikosongkan menjadi `'{}'` dengan `snapshot_purged_at` saat `expire_cv_exports` mempurge export `succeeded`, dan 24 jam setelah `finished_at` export `failed`.
    - Metadata baris (status, revision, waktu, `page_count`, `error_code`) tetap.
    - Snapshot tetap immutable untuk semua perubahan lain (`CV_EXPORT_IMMUTABLE`).

    Dibuktikan pgTAP + integration.
17. **Retry export dijaga (0028 N4).**
    - `retry_cv_export` menolak dengan `EXPORT_RETRY_UNAVAILABLE` bila salah satu kondisi berikut benar:
      - revision CV saat ini ≠ `cv_revision` export;
      - readiness saat ini punya blocker;
      - snapshot sudah dikosongkan.
    - S14 hanya menawarkan *Retry* bila readiness siap dan snapshot ada; selain itu *Regenerate*.
    - Suite T21/T22 yang ada tetap lulus.

    Dibuktikan pgTAP + unit `export-view` + E2E `cv-export`.
18. **Aksesibilitas dan responsive S12.**
    - Axe tanpa pelanggaran *serious*/*critical* pada S12 dengan dialog tertutup, terbuka, error password, dan konfirmasi belum cocok.
    - Seluruh alur dapat dijalankan dengan keyboard. Fokus masuk ke field password saat dialog dibuka dan kembali ke tombol pemicu saat dibatalkan.
    - Viewport 360 px dan 1440 px dalam light/dark tanpa overflow.
    - Screenshot di `docs/verification/T23-screenshots/`.

    Dibuktikan E2E.
19. **Privasi dan log.**
    - Password, email, nama, dan isi karier tidak masuk log, URL, receipt, atau error code.
    - Receipt hanya berisi UUID user, timestamp, status, dan kode error allowlist.
    - Tidak ada `console.` di `src/features/account`, `src/domain/account`, `workers/account-deletion-worker.ts`, atau `workers/supabase-account-deletion-gateway.ts`.

    Dibuktikan grep + unit + review.
20. **Tanpa regresi.**
    - Seluruh suite T02–T22, Gate M2/M3, dan Gate M4 (bila sudah ada) tetap lulus tanpa melemahkan assertion.
    - Perubahan perilaku lama hanya yang dibekukan di §2.4 (retry export, retensi snapshot, batch review) dan guard tulis untuk akun `deleting`.

    Dibuktikan regresi penuh + diff review.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Dua migration, pgTAP baru, dan regenerasi `database.types.ts`.
- Domain murni `src/domain/account/deletion.ts`.
- Reautentikasi `src/server/auth/reauthenticate.ts` dan perluasan aditif `AuthAdapter` (`signOutGlobal`).
- Service, action, dan UI S12 `src/features/account/`.
- Penanganan profil `deleting` di `getRequestContext`, `signInAction`, dan halaman sign-in (notice).
- Pass worker `account-deletion` + gateway. Langkah retensi aditif di pass import dan export.
- Notice pembatalan otomatis di S03. Aturan Retry S14 di `export-view.ts`.
- Runbook retensi, decision 0029, dokumen verifikasi, dan receipt.

### 2.2 Keputusan implementasi

1. **Guard tulis lewat trigger, bukan per-RPC.**
   - `internal.guard_account_writable()` (BEFORE INSERT OR UPDATE OR DELETE, FOR EACH ROW).
   - Bila `auth.uid()` NULL → izinkan (service role, worker, purge, Auth admin).
   - Selain itu, ambil owner (`coalesce(new.user_id, old.user_id)`; untuk `profiles` pakai `old.id`/`new.id`) lalu baca `profiles.deleting_at` tanpa lock. Bila tidak NULL → `raise exception using errcode = '42501', message = 'ACCOUNT_DELETING'`.
   - Untuk `profiles`, yang dicek `old.deleting_at`, sehingga transisi NULL → nilai tetap sah.
   - Trigger dipasang lewat blok `do $$` yang mengiterasi katalog: setiap tabel `public` ber-kolom `user_id`, ditambah `profiles`. Nama trigger `zz_guard_account_writable` agar berjalan setelah trigger BEFORE lain.
   - *Alasan:* saat plan ditulis, definisi terakhir `internal.update_foundation_record` (`20260916124500_fix_foundation_rpc_row_checks.sql:4`), yang dipakai RPC update foundation dan profil, tidak memeriksa `deleting_at`. Create RPC foundation sudah memeriksanya (`20260916190000_t03_foundation_contract_hardening.sql:426-432`). Mengedit setiap RPC berisiko terlewat. Trigger generik ditambah test katalog menutup tabel masa depan.
   - Race: tulisan yang membaca `deleting_at` NULL sebelum `begin_account_deletion` commit masih dapat commit. Baris itu tetap terhapus oleh purge berikutnya (FK ke profil memaksa urutan), dan objek yang terunggah terlambat tertangkap oleh antrean prefix atau reconcile orphan. Dicatat di decision.
2. **`begin_account_deletion` hanya service role.** Fungsi `public.begin_account_deletion(p_user_id uuid) returns table (requested_at timestamptz, already_requested boolean)`.
   - Fungsi mengunci profil `for update`. Bila sudah `deleting`, fungsi mengembalikan receipt yang ada (`already_requested = true`).
   - Bila belum, fungsi mengisi `deleting_at = clock_timestamp()` (langsung; `internal.mark_account_deleting` butuh `expected_revision` sehingga tidak dipakai) lalu insert `internal.account_deletions` (`status = 'queued'`).
   - Grant hanya ke `service_role`.
   - Action memanggilnya dengan admin client dan `user.id` dari session yang sudah diverifikasi ulang (pola admin di `src/features/import/actions.ts:40`).
3. **Reautentikasi dengan password.** `verifyAccountPassword({ email, password, expectedUserId })` di `src/server/auth/reauthenticate.ts`:
   - membuat client Supabase **sekali pakai** dengan publishable key, `persistSession: false`, tanpa cookie;
   - memanggil `signInWithPassword` dengan email dari session;
   - memastikan `data.user.id === expectedUserId`, lalu `signOut({ scope: "local" })` pada client itu.

   Hasilnya `ok | invalid | rate_limited | unavailable`. Password tidak pernah disimpan atau dicatat.
4. **Urutan action `deleteAccountAction`:**
   1. Zod (password 1–200, konfirmasi).
   2. `getUser()` dari session, lalu cocokkan konfirmasi dengan email session (domain).
   3. `verifyAccountPassword`.
   4. `begin_account_deletion` (admin). Ini titik commit: setelah langkah ini, action selalu mengarah ke keluar.
   5. Ban user lewat `admin.auth.admin.updateUserById(id, { ban_duration: "876000h" })`.
   6. `signOutGlobal()` dengan client session.
   7. Hapus cookie lokal (`signOutLocal`).
   8. Redirect `/sign-in?notice=accountDeleted`.

   Kegagalan langkah 5–6 tidak membatalkan penghapusan dan dicatat sebagai kode saja (`AUTH_REVOKE_DEFERRED`); worker tetap menghapus user Auth. Kegagalan langkah 1–4 mengembalikan error tanpa efek samping.
5. **Antrean `internal.account_deletions`:**

   | Kolom | Tipe | Catatan |
   | --- | --- | --- |
   | `user_id` | `uuid primary key` | tanpa FK |
   | `status` | `text` | `queued`, `running`, `purged`, `completed` |
   | `requested_at` | `timestamptz not null` | |
   | `attempt_count` | `integer not null default 0` | |
   | `attempt_token` | `uuid` | |
   | `lease_expires_at` | `timestamptz` | |
   | `next_attempt_at` | `timestamptz not null` | |
   | `objects_enqueued_at` | `timestamptz` | |
   | `rows_purged_at` | `timestamptz` | |
   | `auth_deleted_at` | `timestamptz` | |
   | `completed_at` | `timestamptz` | |
   | `last_error_code` | `text` | pola `^[A-Z][A-Z0-9_]{0,63}$` |
   | `updated_at` | `timestamptz not null` | |

   - CHECK state mengikuti pola `storage_jobs_state_check` (`20260917090000_t05_private_storage_foundation.sql:86-119`).
   - RLS aktif. Semua privilege dicabut dari `public`, `anon`, `authenticated`, dan `service_role`; akses hanya lewat fungsi `security definer`.
   - Tidak ada email, nama, atau teks.
   - Retry tanpa batas attempt dengan backoff dari worker (`1, 5, 15, 60` menit, lalu 60 menit). Penghapusan tidak boleh berhenti diam-diam; backlog terlihat lewat `get_account_deletion_backlog`.
6. **Purge berurutan dengan tombstone profil.** `public.purge_account_data(p_user_id uuid, p_attempt_token uuid) returns integer` (jumlah key diantrekan):
   1. Verifikasi receipt `running` dengan token dan lease hidup. Kunci profil `for update`; profil wajib `deleting` atau sudah tidak ada (purge ulang setelah Auth terhapus = no-op sukses).
   2. Antrekan semua key §1.8 lewat `internal.enqueue_storage_delete`. Key dengan job `failed` dikembalikan ke `queued` (pola `reconcile_orphan_export_objects`, `20261005090000_t21_cv_export_backend.sql:805-813`). Isi `objects_enqueued_at`.
   3. DELETE baris dengan urutan yang ditetapkan Fase 0. Default: `cv_exports` → `cv_items` → `cv_documents` → tabel AI/import/evidence/chat/join → achievement → activity → project → skill/certification/education/experience → `operation_requests` dan sisa tabel ber-`user_id`. Profil **tidak** dihapus.
   4. Isi `rows_purged_at` dan `status` tetap `running`.

   *Alasan:* cascade dari `profiles` kemungkinan besar gagal. Contohnya `cv_items.*_fk ... on delete set null (...)` (`20261002090000_t18_cv_schema_selection.sql:108-119`) bertabrakan dengan CHECK `cv_items_source_check` (`:135-150`) bila sumber terhapus sebelum `cv_items`. Probe Fase 0 membuktikan atau membantah ini. Urutan eksplisit tetap dipakai dalam kedua kasus agar trigger cleanup evidence (`20260925100000_t10_evidence_backend.sql:348-437`) berjalan dalam keadaan yang diketahui. Profil disisakan supaya sign-in dalam jendela ini tetap melihat status `deleting`.
7. **Hapus user Auth lewat Admin API.** Worker memanggil `client.auth.admin.deleteUser(userId)` (hard delete). Respons 404 berarti sudah terhapus. Cascade `auth.users` → `profiles` (`20260916090000_foundation_schema.sql:183`) menghapus tombstone. Lalu `public.mark_account_auth_deleted(p_user_id, p_attempt_token) returns boolean` (CAS) mengisi `auth_deleted_at`, `status = 'purged'`, dan melepas lease. Tidak ada DML langsung ke skema `auth` dari migration.
8. **Pesan sign-in untuk akun deleting.** `getRequestContext` (`src/server/auth/context.ts:17`) mengembalikan `user: null, profile: null, accountDeleting: true` bila `profile.deleting_at` terisi. Dengan begitu `requireCompletedWorkspace` dan halaman sign-in (`src/app/sign-in/page.tsx:24`) tidak berputar redirect.
   - `signInAction` (`src/server/auth/actions.ts:64`): bila profil `deleting`, panggil `signOutLocal` lalu kembalikan `auth.accountDeleting`.
   - Error ban dari Auth: tampilkan `auth.accountDeleting` **hanya** bila probe Fase 0 membuktikan password diverifikasi sebelum cek ban. Selain itu tampilkan pesan kredensial generik yang ada (anti-enumerasi).
   - Notice baru di `noticeKeys`: `accountDeleted`, `accountDeleting`.
9. **Selesai dan pruning receipt.**
   - `public.verify_account_purges(p_limit integer) returns integer`: receipt `purged` menjadi `completed` bila tidak ada `storage.objects` dengan prefix `<user_id>/` dan tidak ada storage job `queued`/`running`/`failed` untuk user itu.
   - `public.prune_account_deletion_receipts(p_limit integer) returns integer` menghapus receipt `completed` yang lebih tua dari 30 hari. Jendela ini sama dengan jendela backup: receipt dipakai untuk menerapkan ulang penghapusan bila backup dipulihkan (runbook).
   - `public.get_account_deletion_backlog() returns table (pending integer, overdue integer)`.
   - Ketiganya hanya untuk service role.
10. **Claim/retry antrean penghapusan.** `public.claim_account_deletion_jobs(p_limit integer)` (skip locked, lease 120 detik, token baru, mengklaim `queued` atau `running` yang lease-nya habis; tidak mengembalikan email) dan `public.retry_account_deletion_job(p_user_id, p_attempt_token, p_error_code, p_next_attempt_at) returns boolean` (CAS → `queued`, isi `last_error_code`).
11. **Pass worker `account-deletion`** (`workers/account-deletion-worker.ts`, `runAccountDeletionWorkerOnce`):
    1. `verify_account_purges(100)` dan `prune_account_deletion_receipts(100)`.
    2. Claim maksimal 5.
    3. Per job: `purge_account_data` → `deleteUser` → `mark_account_auth_deleted`. Error apa pun → `retry_account_deletion_job` dengan kode allowlist (`ACCOUNT_PURGE_FAILED`, `AUTH_DELETE_FAILED`, `WORKER_BACKEND_UNAVAILABLE`).

    Pass ini didaftarkan di `workers/run.ts` (terisolasi seperti pass lain, `run.ts:40-49`) dan `buildWorkerBootstrap` (`registeredJobs` + `"account-deletion"`). Hasilnya `{ accountDeletionsClaimed, accountPurgesVerified, accountReceiptsPruned }`.
12. **Pratinjau data.** `public.get_account_deletion_preview() returns table (activities integer, achievements integer, projects integer, evidence_files integer, import_batches integer, has_cv boolean, cv_exports integer)` untuk `authenticated`, owner dari `auth.uid()`, read-only. Akun `deleting` → `ACCOUNT_DELETING`.
13. **UI S12.** Kartu baru `src/features/account/delete-account-card.tsx` di bagian *Privacy and account* pada `profile-workspace.tsx` (setelah `AiConsentCard`, `:64-66`). Isinya:
    - teks detail privasi: apa yang dihapus, kapan, dan retensi backup sesuai §2.4.4;
    - tombol danger *Delete account*.

    Dialog memakai `Dialog` (`src/components/ui/dialog.tsx:6`); `NamedDeleteDialog` dipakai hanya bila Fase 0 membuktikan ia mendukung field tambahan. Isi dialog: daftar jumlah, field password (`autocomplete="current-password"`), field konfirmasi email, dan tombol danger. Tidak ada autosave dan tidak ada aksi kedua.
14. **Batch `review` yang ditinggalkan.** `public.expire_abandoned_import_reviews(p_limit integer default 100, p_idle_days integer default 30) returns integer`:
    - aktivitas terakhir dihitung sebagai `greatest(batch.updated_at, max(item.updated_at))`;
    - batch ≥ `p_idle_days` hari tanpa perubahan dibatalkan dengan transisi yang sama dengan `cancel_import_batch` (`cancelled_at`, `expires_at`), memakai helper internal yang sudah ada bila Fase 0 menemukannya; bila tidak ada, fungsi menulis transisi yang identik dan dicatat;
    - batas `p_idle_days` 7–365.

    Pass import memanggilnya sebelum `purge_expired_import_batches`. S03 menampilkan *This import will be cancelled automatically on <date> if you don't finish it.* dari tanggal yang sama (fungsi domain murni `abandonedReviewDeadline(lastActivityAt)`).
15. **Retensi snapshot.**
    - Kolom baru `cv_exports.snapshot_purged_at timestamptz`.
    - `internal.guard_cv_export_row()` (`20261005090000_t21_cv_export_backend.sql:68`) diganti (create or replace) agar hanya transisi `snapshot → '{}'::jsonb` bersamaan dengan `snapshot_purged_at` NULL → nilai yang diizinkan. Aturan immutable lain tidak berubah.
    - `expire_cv_exports` diganti agar ikut mengosongkan snapshot.
    - `public.redact_cv_export_snapshots(p_limit integer) returns integer` mengosongkan snapshot export `failed` dengan `finished_at <= now() - 24 jam`.
    - Pass export memanggilnya.
    - `snapshot_purged_at` ditambahkan ke kolom aman `cvExportRowSchema`.
16. **Retry export dijaga.** `public.retry_cv_export` (`20261005090000_t21_cv_export_backend.sql:374`) diganti: setelah lock yang ada, tolak dengan `EXPORT_RETRY_UNAVAILABLE` (SQLSTATE dan pola error mengikuti kode export T21 yang ada) bila salah satu kondisi berikut benar:
    - `cv_documents.revision <> export.cv_revision`;
    - `internal.cv_export_blockers(cv)` tidak kosong;
    - `snapshot_purged_at` terisi.

    `exportActions` di `src/domain/cv/export-view.ts` menambah syarat readiness siap dan snapshot ada untuk *Retry*. Kode baru masuk union error domain CV dan i18n en/id.
17. **Kunci i18n.** Kunci baru, en **dan** id:
    - `account.delete.*` (S12);
    - `auth.accountDeleted`, `auth.accountDeleting`;
    - `import.review.autoCancelNotice` (path persis mengikuti pola kunci S03 yang dicatat Fase 0);
    - kode `EXPORT_RETRY_UNAVAILABLE` di namespace error export yang ada.
18. **Nomor:**
    - Migration `supabase/migrations/20261009090000_t23_account_deletion.sql` (Fase 1) dan `supabase/migrations/20261009100000_t23_retention.sql` (Fase 2). Parity akhir **33/33**. Diterapkan dengan `pnpm exec supabase migration up --local`.
    - pgTAP `supabase/tests/database/account_deletion.test.sql` dan `supabase/tests/database/retention.test.sql`.
    - Integration `tests/integration/account-deletion.test.ts` dan `tests/integration/retention.test.ts`, lewat script baru `test:integration:account-deletion` (keduanya).
    - E2E `tests/e2e/account-deletion.spec.ts`, `playwright.account-deletion.config.ts`, port **3015**, script baru `test:e2e:account-deletion`.
    - Decision `docs/decisions/0029-t23-account-deletion-retention.md`.

### 2.3 Di luar scope

- **T24:** event analytics (termasuk export terminal dan penghapusan akun), p95, dan biaya reconcile.
- **T25:** verifikasi retensi backup dan purge pada layanan hosted/staging, alert backlog penghapusan dan cleanup, deployment worker, runbook restore yang menerapkan ulang receipt.
- **Tidak dibuat:** pembatalan atau undo penghapusan akun, masa tenggang, export data pribadi sebelum hapus, penghapusan oleh admin, reautentikasi OTP email, MFA, penghapusan otomatis akun tidak aktif, retensi hasil `ai_jobs`, dan perubahan retensi evidence T10/T11.
- **Tidak diubah:** state machine job AI/import/evidence, worker evidence, alur commit import T16, lock protocol CV T20/T21 (selain `retry_cv_export` dan guard snapshot §2.2.15–16), dan `internal.mark_account_deleting`.
- **Bukan v0.1:** billing, team, public profile, dan fitur roadmap `Design.md`.

### 2.4 Keputusan produk yang perlu persetujuan pengguna

Rekomendasi pertama di setiap poin adalah pilihan plan ini. Pelaksana mencatat persetujuan di receipt Fase 0. Bila implementasi menuntut penyimpangan dari salah satu poin, **stop** (lihat §8).

1. **Reautentikasi dengan memasukkan ulang password** (§2.2.3). Alternatif:
   - OTP email lewat `reauthenticate()` (perlu mail sink, langkah tambahan);
   - cukup session yang baru dibuat (lemah terhadap perangkat yang ditinggal).
2. **Konfirmasi dengan mengetik email akun**, ditambah daftar jumlah data yang hilang (§2.2.12–13). Ini nama record yang dipakai aturan Wireframe dan netral bahasa. Alternatif: mengetik frasa `DELETE`/`HAPUS` (bergantung locale), atau hanya checkbox.
3. **Tanpa masa tenggang dan tanpa undo.** Penghapusan dimulai saat dikonfirmasi; worker biasanya selesai dalam hitungan menit, paling lambat 24 jam. Alternatif: masa tenggang 7 hari dengan pembatalan (butuh UI dan state tambahan, serta bertentangan dengan "revokes sessions immediately").
4. **Copy retensi backup di S12** menyatakan kebijakan: *Backup copies that may contain your data are deleted within 30 days.* Copy ini mengikat T25: release gate tetap terbuka sampai konfigurasi hosted terbukti, dan runbook mencatat statusnya *belum terverifikasi*. Alternatif: copy tanpa angka (*Backups are deleted on a rolling schedule*), yang tidak memenuhi kalimat PRD.
5. **Batch import `review` dibatalkan otomatis setelah 30 hari tanpa perubahan**, dengan notice tanggal di S03 (§2.2.14). Alternatif: 7 atau 14 hari (lebih minim data, tetapi lebih cepat membuang kerja review), atau tanpa pembatalan otomatis (melanggar semangat minimisasi data PRD).
6. **Snapshot export dikosongkan** saat PDF dipurge (24 jam setelah sukses) dan 24 jam setelah export gagal. Metadata riwayat tetap (§2.2.15). Konsekuensi: export gagal yang lebih tua dari 24 jam hanya dapat di-*Regenerate*. Alternatif: snapshot disimpan sampai akun dihapus (status quo T21, teks sumber yang sudah dihapus tetap tersimpan).
7. **Retry export ditolak bila CV berubah atau terblokir** (§2.2.16). Ini mengubah perilaku T21 yang disetujui (Retry tanpa validasi ulang) demi mencegah teks sumber yang sudah dihapus tercetak lagi. Alternatif: hanya UI yang menyembunyikan Retry (backend tetap mengizinkan lewat panggilan langsung).

Persetujuan pengguna: **belum tercatat**.

## 3. Kontrak teknis

### 3.1 Migration Fase 1 `20261009090000_t23_account_deletion.sql`

- `internal.guard_account_writable()` dan pemasangan trigger `zz_guard_account_writable` lewat katalog (§2.2.1). Revoke fungsi dari semua role.
- `internal.account_deletions` (§2.2.5) dan indeks claim `(next_attempt_at, requested_at, user_id) where status in ('queued','running')`.
- Fungsi `public`: `begin_account_deletion`, `get_account_deletion_preview`, `claim_account_deletion_jobs`, `purge_account_data`, `mark_account_auth_deleted`, `retry_account_deletion_job`, `verify_account_purges`, `prune_account_deletion_receipts`, `get_account_deletion_backlog`. Semua `security definer` dengan `set search_path = pg_catalog`, grant sesuai §2.2, dan `comment on function` berlabel `T23`.
- Tidak mengubah fungsi T02–T22.

### 3.2 Migration Fase 2 `20261009100000_t23_retention.sql`

- `cv_exports.snapshot_purged_at`, `internal.guard_cv_export_row()` (ganti), `public.expire_cv_exports` (ganti), `public.redact_cv_export_snapshots` (baru), `public.retry_cv_export` (ganti) (§2.2.15–16).
- `public.expire_abandoned_import_reviews` (baru) (§2.2.14).
- Grant baru hanya ke `service_role`, kecuali `retry_cv_export` yang tetap `authenticated`.

### 3.3 Domain dan server

- `src/domain/account/deletion.ts` (import relatif):
  - `accountDeletionInputSchema` (Zod);
  - `confirmationMatches(sessionEmail, typed)`;
  - `ACCOUNT_DELETION_ERROR_CODES` (`VALIDATION`, `CONFIRMATION_MISMATCH`, `INVALID_PASSWORD`, `RATE_LIMITED`, `UNAUTHENTICATED`, `UNAVAILABLE`);
  - `accountDeletionPreviewSchema`.
- `src/domain/import/review-retention.ts`: `ABANDONED_REVIEW_DAYS = 30`, `abandonedReviewDeadline(lastActivityAt)`.
- `src/server/auth/adapter.ts`: `signOutGlobal()` aditif (`signOut({ scope: "global" })`).
- `src/server/auth/reauthenticate.ts`: §2.2.3.
- `src/server/auth/context.ts`: `accountDeleting` (§2.2.8). `src/server/auth/actions.ts`: cabang deleting di `signInAction`. `src/app/sign-in/page.tsx`: notice.
- `src/features/account/deletion-service.ts`: `createAccountDeletionService({ client, admin, verifyPassword })` dengan `preview()` dan `deleteAccount(input)`. Error memakai kode + correlation ID mengikuti `src/server/action-result.ts`.
- `src/features/account/actions.ts`: `deleteAccountAction` (§2.2.4), `getAccountDeletionPreviewAction` bila preview dimuat saat dialog dibuka.

### 3.4 Worker

- `workers/account-deletion-worker.ts`: `AccountDeletionWorkerDatabase`, `AccountDeletionWorkerAuth` (`deleteUser(id) → "deleted" | "not_found"`), dan `runAccountDeletionWorkerOnce`, dengan seam test `onStep` untuk simulasi crash.
- `workers/supabase-account-deletion-gateway.ts`: pola `workers/supabase-export-gateway.ts` (fetch RPC dengan timeout, error tanpa body, validasi origin), plus `client.auth.admin.deleteUser`.
- `workers/import-worker.ts`, `workers/export-worker.ts` dan gateway-nya: langkah retensi aditif, dengan field hasil `importReviewsExpired` dan `exportSnapshotsRedacted`.
- `workers/run.ts`, `workers/bootstrap.ts`: pendaftaran pass.

### 3.5 UI

- `src/features/account/delete-account-card.tsx` (client) dan bagian *Privacy and account* di `src/features/profile/profile-workspace.tsx`.
- Notice S03 di komponen review import (path dicatat Fase 0, di bawah `src/features/import/`).
- `src/domain/cv/export-view.ts` + `src/domain/cv/contracts.ts` (kolom aman `snapshot_purged_at`, kode baru).
- `src/i18n/messages.ts`.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20261009090000_t23_account_deletion.sql`, `supabase/migrations/20261009100000_t23_retention.sql` |
| Create | `supabase/tests/database/{account_deletion,retention}.test.sql` |
| Modify | `src/server/supabase/database.types.ts` (`pnpm db:types`) |
| Create | `src/domain/account/deletion.ts`, `src/domain/import/review-retention.ts` |
| Create | `src/server/auth/reauthenticate.ts`, `src/features/account/{deletion-service,actions}.ts`, `src/features/account/delete-account-card.tsx` |
| Modify | `src/server/auth/{adapter,context,actions}.ts`, `src/app/sign-in/page.tsx`, `src/features/profile/profile-workspace.tsx`, komponen S03 di `src/features/import/`, `src/domain/cv/{export-view,contracts}.ts`, `src/features/cv/export-service.ts` (kolom aman), `src/i18n/messages.ts`, `src/app/globals.css` (bila perlu, token yang ada) |
| Create | `workers/account-deletion-worker.ts`, `workers/supabase-account-deletion-gateway.ts` |
| Modify | `workers/{run,bootstrap,import-worker,export-worker,supabase-import-gateway,supabase-export-gateway}.ts` |
| Create | `tests/unit/{account-deletion-domain,account-deletion-service,account-deletion-actions,account-reauthenticate,account-deletion-worker,account-deletion-i18n,request-context-deleting,import-review-retention}.test.ts` |
| Modify | `tests/unit/{cv-export-view,worker-bootstrap,export-worker}.test.ts` dan unit import worker yang ada (field baru) |
| Create | `tests/integration/{account-deletion,retention}.test.ts` |
| Create | `tests/e2e/account-deletion.spec.ts`, `playwright.account-deletion.config.ts` |
| Modify | `package.json` (script baru), `README.md` (Fase 9), `.env.example` (hanya bila ada env baru; harapannya tidak ada) |
| Create | `docs/verification/T23-screenshots/*.png` (Fase 7), `docs/verification/T23-retention-runbook.md` (Fase 9) |
| Create (Fase 9) | `docs/decisions/0029-t23-account-deletion-retention.md`, `docs/verification/T23-account-deletion-retention.md` |

Script baru:

- `test:integration:account-deletion` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/account-deletion.test.ts tests/integration/retention.test.ts`
- `test:e2e:account-deletion` → `playwright test --config playwright.account-deletion.config.ts tests/e2e/account-deletion.spec.ts`

## 5. Fase eksekusi

### Fase 0 — Baseline, probe, dan persetujuan (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD (harapan `402414c` atau turunannya, termasuk commit Gate M4 bila ada). Working tree harus bersih kecuali `.claude/`; jika tidak, **stop**.
- [ ] Periksa Gate M4: ada `docs/verification/M4-gate-review.md` dengan verdict PASSED, atau izin eksplisit pengguna untuk mulai sebelum M4. Bila tidak ada keduanya, **stop**.
- [ ] Siapkan environment:
  - `pnpm install --frozen-lockfile`.
  - `pnpm exec supabase migration list --local`: parity harus **31/31** dengan migration terakhir `20261005090000_t21_cv_export_backend.sql` (atau lebih bila Gate M4 menambah migration; catat).
  - Bila Docker mati, nyalakan dan jalankan `pnpm db:start` (tanpa reset).
  - Pastikan ClamAV T10, Gotenberg T15, dan `workpulse-t21-pdf` hidup sesuai runbook.
- [ ] Jalankan baseline dengan harapan berikut:

  | Command | Harapan |
  | --- | --- |
  | `pnpm lint`, `pnpm typecheck`, `pnpm worker:check` | lulus |
  | `pnpm test` | 103 file / 956 test |
  | `pnpm db:test` | 15 file / 1290 assertion |
  | `pnpm test:integration:cv-export` | 35 test |
  | `pnpm test:integration:import`, `test:integration:evidence`, `test:integration:storage` | lulus; catat angka |
  | `pnpm test:e2e:auth` | lulus; catat angka |

- [ ] Verifikasi dari source dan catat file:baris untuk:
  - **Lifecycle profil:** `internal.mark_account_deleting` (`20260916120000_secure_foundation_mutations.sql:500`), `profiles.deleting_at` (`20260916090000_foundation_schema.sql:195`), dan FK `profiles.id → auth.users on delete cascade` (`:183`).
  - **Antrean storage:** `internal.storage_jobs` beserta kolom tambahan T10 (`evidence_*`, `last_error_code`), `enqueue_storage_delete`, dan ketiga `claim_*_cleanup_jobs` serta `reconcile_orphan_*_objects`.
  - **Matriks deleting.** Untuk setiap RPC `authenticated` yang menulis dan setiap RPC worker `claim_*`/`get_*_input`/`retry_*`, catat apakah dan di mana `deleting_at` diperiksa (langsung atau lewat helper). Grep awal reviewer (bukan bukti): `get_ai_job_input`, `get_cv_export_input`, `get_cv_export_download`, `claim_import_jobs`, `retry_ai_job`, `retry_evidence_scan_job` memeriksa; `claim_ai_jobs`, `claim_cv_export_jobs`, `claim_evidence_scan_jobs`, `retry_cv_export`, `retry_import_batch` tidak memeriksa di badan fungsinya.
  - **Tabel ber-`user_id`:** daftar dari `information_schema.columns` (schema `public`). Daftar ini menjadi urutan purge §2.2.6 dan isi test katalog.
  - **Auth dan UI:** `src/server/auth/{adapter,context,actions,workspace-page}.ts`, `src/app/sign-in/page.tsx`, `src/features/profile/{profile-workspace,ai-consent-card}.tsx`, `src/components/ui/{dialog,named-delete-dialog}.tsx`, komponen S03, `src/domain/cv/export-view.ts`, dan `cancel_import_batch` (helper transisi).
  - **Helper test:** `tests/integration/cv-export-support.ts:61` (`sql()` lewat `docker exec psql`) dan helper fixture/cleanup akun yang dipakai suite lain.
- [ ] **Probe cascade** (psql ke DB lokal, dalam `begin … rollback`, tanpa commit): buat satu akun fixture lengkap (foundation, activity, achievement terpilih ke CV, project, CV dengan item tiap section, export, batch import, baris evidence), lalu `delete from auth.users where id = …`. Catat sukses atau error persisnya (constraint, trigger). Hasil ini menjadi alasan urutan purge di receipt.
- [ ] **Probe Auth** (Auth lokal, akun fixture sekali pakai, tanpa mencetak token):
  1. `signOut({ scope: "global" })` → `auth.getUser()` dengan access token lama ditolak? Refresh token lama ditolak?
  2. `admin.updateUserById(id, { ban_duration: "876000h" })` → `signInWithPassword` dengan password **benar** dan **salah**: kode/pesan error masing-masing (menentukan §2.2.8).
  3. `admin.deleteUser(id)` → baris `public.profiles` ikut hilang (pada akun kosong) dan panggilan kedua mengembalikan 404.
  4. Di dalam fungsi `security definer` yang dipanggil dengan secret key, `auth.uid()` bernilai NULL.
  5. `signInWithPassword` pada client sekali pakai tidak menulis cookie dan tidak mengganti session pengguna di browser.
- [ ] Catat persetujuan pengguna atas §2.4 di receipt. Bila belum tercatat di §2.4, **stop** dan minta persetujuan.
- [ ] Tulis receipt `docs/verification/T23-phase0-baseline.md` dan commit `docs(t23): add phase 0 baseline receipt`. Serahkan hasil probe ke checkpoint Claude sebelum Fase 1.

### Fase 1 — Database: guard, antrean, dan purge (TDD pgTAP)

- [ ] Test gagal lebih dulu di `supabase/tests/database/account_deletion.test.sql`:
  - **Katalog:** setiap tabel `public` ber-`user_id` + `profiles` punya trigger `zz_guard_account_writable`. `internal.account_deletions` tanpa FK dan tanpa privilege untuk `anon`/`authenticated`/`service_role`.
  - **Grant:** `begin_account_deletion` dan fungsi worker ditolak untuk `authenticated`/`anon`; `get_account_deletion_preview` ditolak untuk `anon`.
  - **Begin:** idempotent, `deleting_at` terisi, receipt `queued`.
  - **Guard** untuk akun `deleting` sebagai `authenticated`: satu RPC per domain (§1.5) → `42501`/`ACCOUNT_DELETING`. Akun lain tetap dapat menulis. Panggilan tanpa `auth.uid()` (service) tidak terkena guard. Transisi profil NULL → deleting tetap sah.
  - **Unduhan** (§1.6) ditolak untuk akun `deleting`.
  - **Claim/lease/CAS:** token lama tidak dapat purge/mark; lease habis dapat di-claim ulang.
  - **Purge:** semua key + objek prefix (sisipkan baris `storage.objects` uji) diantrekan sebelum DELETE; job `failed` diantrekan ulang; nol baris ber-`user_id` setelahnya; profil tombstone ada; purge ulang tanpa error; kegagalan di tengah (paksa lewat fixture) → rollback penuh.
  - **FK hilang:** `delete from auth.users` → storage job dan receipt tetap ada (§1.10).
  - **Verify/backlog/prune:** tidak `completed` selama ada objek atau job aktif/gagal; backlog overdue setelah `requested_at` dimundurkan; prune hanya receipt `completed` > 30 hari.
  - **Preview:** jumlah benar dan hanya data pemilik.
- [ ] Implementasi §3.1. Terapkan dengan `pnpm exec supabase migration up --local`. Jalankan `pnpm db:test`, `pnpm db:lint`, `pnpm db:types`, `pnpm typecheck`.
- [ ] Bila test lama gagal karena guard (misalnya fixture pgTAP yang menulis sebagai akun `deleting` secara sengaja), **stop** dan laporkan. Jangan melemahkan test lama.
- [ ] Commit `feat(t23): add account deletion queue, write guard and ordered purge`, lalu receipt Fase 1.

### Fase 2 — Database: retensi import, snapshot, dan retry (TDD pgTAP)

- [ ] Test gagal lebih dulu di `supabase/tests/database/retention.test.sql`:
  - **Batch review:** batch `review` 31 hari tanpa perubahan item → `cancelled` + `expires_at`; batch dengan item yang diubah kemarin → tetap; batas `p_idle_days` di luar 7–365 → error; setelah `purge_expired_import_batches`, file key diantrekan dan teks kosong.
  - **Snapshot:** export `succeeded` kedaluwarsa → `expire_cv_exports` mengosongkan snapshot + `snapshot_purged_at`; export `failed` > 24 jam → `redact_cv_export_snapshots`; `failed` < 24 jam → tetap; perubahan snapshot lain → `CV_EXPORT_IMMUTABLE`.
  - **Retry:** revision CV berubah → `EXPORT_RETRY_UNAVAILABLE`; blocker (`ITEM_DELETED`, `ITEM_CHANGED` tanpa ack) → ditolak; snapshot kosong → ditolak; kasus sah T21 (revision sama, siap, attempt < 3) → tetap `queued` dengan snapshot sama.
- [ ] Implementasi §3.2. Terapkan, lalu jalankan `pnpm db:test` (termasuk `cv_export.test.sql` dan `import_staging.test.sql` lama tanpa perubahan), `pnpm db:lint`, `pnpm db:types`, `pnpm typecheck`. Bila assertion lama T21 tentang retry tanpa validasi bertentangan dengan §2.4.7, catat test mana dan perbarui **hanya** assertion itu dengan alasan di receipt.
- [ ] Commit `feat(t23): add import review expiry, export snapshot retention and guarded retry`, lalu receipt Fase 2.

### Fase 3 — Domain, reautentikasi, service, action (TDD unit)

- [ ] Test gagal lebih dulu:
  - `account-deletion-domain`: schema, `confirmationMatches` (trim, huruf besar, email lain, kosong).
  - `import-review-retention`: `abandonedReviewDeadline` (UTC, 30 hari, input invalid).
  - `account-reauthenticate`: client sekali pakai tanpa persist, user id berbeda → `invalid`, 400/`invalid_credentials` → `invalid`, 429 → `rate_limited`, error jaringan → `unavailable`, password tidak muncul di error.
  - `account-deletion-service`: urutan langkah §2.2.4 dengan fake (verify → begin → ban → global sign-out); verify gagal → begin tidak dipanggil; begin gagal → tidak ada ban/sign-out; ban/sign-out gagal → tetap sukses dengan `AUTH_REVOKE_DEFERRED` tercatat sebagai kode; preview diparse Zod.
  - `account-deletion-actions`: user dari session, email form diabaikan, redirect `/sign-in?notice=accountDeleted`, pemetaan error.
  - `request-context-deleting`: profil `deleting` → `user: null`, `accountDeleting: true`; sign-in page tidak redirect ke dashboard.
  - `account-deletion-i18n`: parity kunci baru en/id.
  - `cv-export-view` (perluas): Retry hanya bila readiness siap dan `snapshot_purged_at` NULL.
- [ ] Implementasi §3.3 dan perubahan domain CV. Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t23): add reauthentication and account deletion service`, lalu receipt Fase 3.

### Fase 4 — Worker (TDD unit, lalu integration)

- [ ] Test gagal lebih dulu di `tests/unit/account-deletion-worker.test.ts`:
  - urutan purge → deleteUser → mark;
  - `not_found` = sukses;
  - error per langkah → retry dengan kode dan backoff yang benar;
  - crash (`onStep` melempar) tidak menandai selesai;
  - verify/prune dipanggil setiap pass;
  - pass terisolasi dari pass lain di `run.ts`;
  - tidak ada email/teks di hasil.

  Perluas `worker-bootstrap`, `export-worker`, dan unit import worker untuk langkah retensi.
- [ ] Implementasi §3.4. Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm worker:check`.
- [ ] Integration awal di `tests/integration/account-deletion.test.ts` dengan Supabase + Auth nyata dan worker nyata (renderer/AI fake):
  - jalur penuh §1.8–1.9 dengan objek Storage nyata di tiga kategori + satu objek yatim;
  - crash di tiga titik §1.11 (lease dimundurkan lewat `sql()`);
  - durasi `requested_at` → `completed_at` dicatat.
- [ ] Jalankan `pnpm test:integration:account-deletion`. Commit `feat(t23): add account deletion worker pass and retention steps`, lalu receipt Fase 4.

### Fase 5 — UI S12, sign-in, S03, S14

- [ ] Test gagal lebih dulu (unit state/komponen murni bila ada pola di repo): tombol nonaktif sampai konfirmasi cocok, fokus awal di password, pesan error per kode, dan notice sign-in.
- [ ] Implementasi §3.5: kartu dan dialog S12, notice sign-in, notice S03, Retry S14. Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] Commit `feat(t23): add S12 account deletion and retention notices`, lalu receipt Fase 5.

### Fase 6 — Integration lintas domain

- [ ] Lengkapi `tests/integration/account-deletion.test.ts`:
  - guard RPC per domain lewat client `authenticated` nyata (§1.5);
  - unduhan ditolak (§1.6);
  - job AI/import/export `queued` → worker tidak memanggil adapter fake penghitung (§1.7);
  - session kedua dan refresh token ditolak setelah action (§1.4);
  - sign-in ulang ditolak;
  - isolasi akun B dan email A dapat mendaftar ulang (§1.14);
  - rekonsiliasi job cleanup `failed` dan backlog (§1.12).
- [ ] `tests/integration/retention.test.ts`:
  - batch review idle → cancel → purge → objek hilang setelah pass cleanup;
  - export sukses kedaluwarsa dan export gagal → snapshot kosong, riwayat S14 (`listExports`) tetap terbaca;
  - retry ditolak lewat service dengan kode `EXPORT_RETRY_UNAVAILABLE`.
- [ ] Jalankan `pnpm test:integration:account-deletion`, `pnpm test:integration:cv-export`, `pnpm test:integration:import`, `pnpm test:integration:import-review`. Commit `test(t23): add cross-domain deletion and retention integration`, lalu receipt Fase 6.

### Fase 7 — Browser acceptance

- [ ] `playwright.account-deletion.config.ts`: port 3015, pola `playwright.cv-export.config.ts`. Web server tanpa env `WORKPULSE_AI_*`, `WORKPULSE_OPENAI_*`, `WORKPULSE_DOCX_*`, `WORKPULSE_GOTENBERG_*`, `WORKPULSE_PDF_*`. Worker dikuras lewat helper pola `tests/e2e/helpers/export-worker.ts` (env hanya di proses anak).
- [ ] Skenario `tests/e2e/account-deletion.spec.ts` (akun fixture dibersihkan):
  1. **Jalur utama dengan keyboard:** S12 → *Delete account* → jumlah data tampil → password salah → error di field, akun utuh → password benar + email salah → tombol nonaktif → email benar → hapus → `/sign-in` dengan notice → navigasi ke `/dashboard` mengarah ke sign-in.
  2. **Dua konteks:** konteks B (user sama) membuka `/activity` setelah A menghapus → sign-in.
  3. **Sign-in ulang ditolak** dengan pesan §2.2.8.
  4. **Purge:** worker dikuras → user Auth hilang, prefix Storage kosong, lalu email yang sama mendaftar ulang dan masuk onboarding kosong.
  5. **Isolasi:** data akun B tetap dan dapat diedit.
  6. **S03:** notice tanggal pembatalan otomatis tampil pada batch review.
  7. **Aksesibilitas dan screenshot:** Axe untuk keadaan §1.18, 360/1440 × light/dark tanpa overflow, fokus masuk dan kembali, `prefers-reduced-motion`. Screenshot `s12-delete-<state>-<360|1440>-<light|dark>.png` di `docs/verification/T23-screenshots/` (data fixture saja).
- [ ] Jalankan `pnpm test:e2e:account-deletion` dan `pnpm test:e2e:cv-export` (aturan Retry baru). Inspeksi screenshot dan catat temuan visual. Commit `test(t23): add account deletion browser acceptance and screenshots`, lalu receipt Fase 7.

### Fase 8 — Regresi penuh

- [ ] Jalankan seluruh §7. `test:e2e:m2` dan `test:e2e:m3` wajib lulus tanpa melemahkan assertion env (kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk run itu). ClamAV, Gotenberg T15, dan renderer T21 wajib berjalan untuk suite yang membutuhkannya; bila tidak, catat **tidak dijalankan** beserta alasan. Flaky bawaan `activity-ui.spec.ts:356` dicatat sebagai flaky bila lulus saat diulang tanpa perubahan.
- [ ] Periksa diff dan hygiene:
  - `git diff <HEAD Fase 0> -- supabase/migrations` hanya berisi dua migration baru;
  - `git diff <HEAD Fase 0> --stat` hanya menyentuh file §4;
  - grep `console.` sesuai §1.19;
  - grep password/email di log/receipt nihil;
  - `git diff --check <HEAD Fase 0>..HEAD`.
- [ ] Tulis receipt `docs/verification/T23-phase8-regression.md` dan commit `test(t23): record regression receipt`. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–8, output command, screenshot, dan daftar acceptance yang belum terbukti.

### Fase 9 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0029-t23-account-deletion-retention.md` berisi:
  - keputusan §2.2 dan persetujuan §2.4;
  - hasil probe cascade dan Auth;
  - argumen race guard tulis;
  - sisa risiko access token;
  - alternatif yang ditolak (guard per RPC, cascade dari `profiles`, DML langsung ke `auth`, OTP, masa tenggang);
  - seam T24/T25.
- [ ] `docs/verification/T23-retention-runbook.md`:
  - query backlog dan target ≤ 24 jam;
  - langkah memeriksa retensi backup/PITR pada proyek Supabase hosted;
  - langkah menerapkan ulang receipt penghapusan setelah restore backup;
  - status setiap klaim (*terbukti lokal* / *belum terverifikasi*).
- [ ] `docs/verification/T23-account-deletion-retention.md`: pass/fail/warning/tidak dijalankan, trace ke R01, PRD *Deletion*/*Data minimization*, S12, DB §4/§6, dan setiap poin §1.
- [ ] README: pass worker baru, script baru, dan tabel quality gates.
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- **Owner A (lengkap), timezone `Asia/Jakarta`:**
  - Foundation semua jenis.
  - Activity dengan chat, AI job (fake), dan achievement confirmed + skill.
  - Project dengan evidence `ready` (objek Storage nyata), evidence di activity.
  - CV dengan item di keenam section + override, satu export `succeeded` (objek PDF) dan satu `failed`.
  - Satu batch import `review` (objek file nyata) dan satu `committed`.
  - Satu objek yatim `<A>/evidence/<uuid>` tanpa baris.
- **Owner A-queued:** job AI, import, dan export `queued` saat penghapusan dimulai.
- **Owner B:** data dan objek sendiri di tiga kategori, untuk isolasi.
- **Batch review idle:** `updated_at` batch dan item dimundurkan 31 hari lewat `sql()`. Pembanding: item diubah kemarin.
- **Sentinel privat:** `WP-PRIVATE-ACCOUNT-SENTINEL-<uuid>` di raw activity, judul CV, dan nama file evidence A. Sentinel tidak boleh muncul di receipt, log worker, error action, atau respons ke akun B. Setelah purge, sentinel tidak ditemukan di tabel `public` mana pun (query `sql()` lintas tabel teks).
- Password fixture dibuat acak per test (`randomBytes`) dan tidak dicetak. Setiap test membersihkan akun dan objek Storage-nya; akun yang sudah dihapus oleh test tidak dibersihkan dua kali.

## 7. Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm exec supabase migration list --local
pnpm exec supabase migration up --local
pnpm test:integration:account-deletion
pnpm test:pdf
pnpm test:integration:cv-export
pnpm test:integration:cv-freshness
pnpm test:integration:cv-builder
pnpm test:integration:cv
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:activity
pnpm test:integration:dashboard
pnpm test:integration:import-commit
pnpm test:integration:import-review
pnpm test:integration:import
pnpm test:integration:m2
pnpm test:integration:m3
pnpm test:integration:ai
pnpm test:integration:ai-review
pnpm test:integration:evidence
pnpm test:integration:storage
pnpm test:e2e:account-deletion
pnpm test:e2e:cv-export
pnpm test:e2e:cv-freshness
pnpm test:e2e:cv
pnpm test:e2e:achievements
pnpm test:e2e:projects
pnpm test:e2e:dashboard
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:import
pnpm test:e2e:import-review
pnpm test:e2e:ai
pnpm test:e2e:ai-review
pnpm test:e2e:evidence
pnpm test:e2e:m2
pnpm test:e2e:m3
pnpm worker:check
pnpm build
git diff --check
```

`test:integration:account-deletion` dan `test:e2e:account-deletion` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. Bila Gate M4 menambah suite (`test:integration:m4`, `test:e2e:m4`), suite itu ikut dijalankan.

Aturan menjalankan suite:

- **Secret key.** `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan. Di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong. Output `db:start`/`db:status` memuat key; selalu saring.
- **Env per command.** Muat `.env.local` + key (dan `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` bila perlu) dalam command yang sama dengan suite, karena env PowerShell tidak bertahan antar command.
- **Output.** Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`.
- **Edit file.** Untuk file ber-karakter non-ASCII gunakan tool Edit, bukan `Set-Content`.
- **Container.** Jangan menghentikan container Supabase, ClamAV T10, Gotenberg T15, atau `workpulse-t21-pdf`. Bila semua container berhenti bersamaan, `pnpm db:start` lalu `docker start` container tambahan (tanpa reset).
- **Port tereservasi.** Bila Supabase "healthy" tetapi port 54321/54322 tidak mendengar, cek `netsh int ipv4 show excludedportrange protocol=tcp`; perbaikannya butuh shell admin, jadi laporkan ke pengguna.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, parity tidak sesuai, atau Gate M4 belum PASSED tanpa izin pengguna.
- Persetujuan §2.4 belum tercatat, atau implementasi menuntut penyimpangan darinya.
- Probe menunjukkan:
  - Auth lokal tidak mendukung ban atau global sign-out;
  - `auth.uid()` tidak NULL untuk panggilan secret key;
  - client sekali pakai menulis cookie session pengguna.
- Penyelesaian memerlukan:
  - mengedit migration yang sudah diterapkan atau `db reset`;
  - DML langsung ke skema `auth` atau `storage` selain SELECT dari `storage.objects` dan baris uji pgTAP;
  - perubahan state machine job AI/import/evidence atau lock protocol CV di luar §2.2.15–16.
- Guard tulis membuat suite lama gagal karena perilaku sah (bukan fixture yang menulis sebagai akun `deleting`).
- Scope bocor ke analytics (T24), deployment/alert/backup hosted (T25), masa tenggang/undo, export data pribadi, MFA, atau fitur roadmap.
- Test membutuhkan key nyata, akun produksi, atau sentinel/password muncul di output, log, receipt, atau respons akun lain.
- Perubahan pada suite lama (T02–T22, gate) diperlukan agar lulus, selain assertion retry T21 yang bertentangan dengan §2.4.7 (dicatat di receipt Fase 2).

## 9. Gate review Claude (setelah Fase 8)

Review read-only mencakup:

- **Reautentikasi dan pemicu:**
  - user dan email dari session;
  - password tidak dicatat;
  - client sekali pakai tanpa cookie;
  - RPC begin tidak dapat dipanggil `authenticated`;
  - urutan action §2.2.4 dan titik commit.
- **Session:**
  - ban + global sign-out;
  - `getRequestContext` tanpa loop redirect;
  - sign-in ulang ditolak;
  - pesan ban tidak membuka enumerasi;
  - sisa risiko access token tercatat jujur.
- **Guard tulis:**
  - katalog lengkap;
  - pengecualian hanya `auth.uid()` NULL;
  - argumen race;
  - tidak ada jalur tulis pengguna yang lolos (spot-check RPC acak di luar daftar test).
- **Purge:**
  - objek diantrekan sebelum DELETE dalam transaksi yang sama;
  - prefix catch-all;
  - urutan aman sesuai probe;
  - tombstone;
  - idempotensi;
  - CAS dan lease;
  - receipt minimal tanpa PII;
  - antrean tanpa FK.
- **Penyelesaian dan retensi:**
  - `completed` hanya setelah prefix kosong;
  - backlog/overdue;
  - prune 30 hari;
  - runbook tidak mengklaim backup terbukti.
- **Retensi lain:**
  - pembatalan review memakai transisi cancel yang sama;
  - redaksi snapshot tidak membuka mutasi lain;
  - guard retry di database, bukan hanya UI;
  - suite T21/T22 tetap bermakna.
- **UI:** satu aksi utama, danger hanya di dialog, fokus, Axe, 360/1440 light/dark, copy backup sesuai §2.4.4.
- **Batas scope dan hygiene:** hanya file §4, tanpa dependency baru, tanpa `console.`, dan angka receipt cocok dengan hasil ulang.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Cascade yang gagal atau parsial.** Purge mengandalkan cascade `profiles` dan gagal di CHECK `cv_items_source_check`, atau trigger cleanup evidence melempar error saat parent terhapus. Akun tertahan `deleting` selamanya. Dijaga oleh probe Fase 0, pgTAP purge pada fixture lengkap, integration jalur penuh, dan backlog overdue.
2. **Jalur tulis yang lolos guard.** Tabel baru tanpa trigger, tabel tanpa kolom `user_id` yang tetap milik pengguna, atau RPC yang menulis lewat jalur service role atas nama pengguna. Dijaga oleh test katalog, spot-check reviewer, dan integration per domain.
3. **Objek tertinggal.** Objek yang diunggah lewat signed upload URL setelah purge, atau key yang tidak tercatat di baris mana pun. Akibatnya `completed` palsu atau objek abadi. Dijaga oleh antrean prefix catch-all, `verify_account_purges` yang membaca `storage.objects`, objek yatim di fixture, dan reconcile orphan kategori.
4. **Session tidak benar-benar dicabut.** Hanya cookie lokal yang dihapus, refresh token konteks lain masih hidup, atau sign-in ulang masuk ke workspace lewat profil tombstone. Dijaga oleh probe Auth, integration refresh token, E2E dua konteks, dan unit `request-context-deleting`.
5. **Reautentikasi yang dapat dilewati.** Email diambil dari form, user id hasil verifikasi tidak dibandingkan, RPC begin terbuka untuk `authenticated`, atau client verifikasi mengganti session browser. Dijaga oleh unit action/reauth, pgTAP grant, dan review.
6. **Perubahan perilaku T21/T22 yang melebar.** Guard snapshot membuka mutasi selain redaksi, retry menolak kasus sah, atau assertion lama dilemahkan diam-diam. Dijaga oleh pgTAP retention, suite `cv-export` lama tanpa perubahan selain yang dicatat, dan diff review.

# T23 Fase 6 — Integration lintas domain

- Tanggal: 9 Oktober 2026
- Eksekutor: Claude Sonnet 5.5

## File berubah

| File | Perubahan |
| --- | --- |
| `tests/integration/account-deletion.test.ts` | dilengkapi: 11 test |
| `tests/integration/account-deletion-support.ts` | helper `rpcAny`, `registerAgain`, `seedQueuedWork`; `seedAccount` mengembalikan id aktivitas dan CV beserta revisi tersimpan |
| `tests/integration/retention.test.ts` | baru: 3 test |
| `tests/integration/cv-export.test.ts` | daftar kunci ringkasan worker bertambah `exportSnapshotsRedacted` |

## Command (hasil nyata)

| Command | Hasil |
| --- | --- |
| `pnpm test:integration:account-deletion` | **2 file / 14 test** lulus |
| `pnpm test:integration:cv-export` | 3 file / **35 test** lulus (setelah memperbarui satu daftar kunci) |
| `pnpm test:integration:import` | 2 file / **21 test** lulus |
| `pnpm test:integration:import-review` | 1 file / **6 test** lulus |
| `pnpm typecheck`, `pnpm lint` | exit 0 |

Perubahan pada suite lama: satu assertion di `cv-export.test.ts` yang membandingkan daftar kunci ringkasan worker secara persis. Kunci baru `exportSnapshotsRedacted` ditambahkan ke daftar itu; tidak ada assertion yang dilemahkan.

## Bukti per acceptance

- **§1.5 guard lewat RPC pengguna nyata.** Akun dengan sesi masih hidup ditandai `deleting` lewat `begin_account_deletion`, lalu 16 RPC dari semua domain (profil, foundation create/update/delete, activity, project, achievement, mulai import, permintaan AI, consent AI, pilih CV, simpan CV, request/retry/unduh export, pratinjau) mengembalikan SQLSTATE `42501` dengan pesan `ACCOUNT_DELETING` atau `AUTH_REQUIRED`. Layanan project dan export memetakannya ke `UNAUTHENTICATED`. Tidak ada baris yang tertulis (education `Inst`, project, dan jumlah export tidak berubah).
  - Catatan temuan: setelah `begin_account_deletion`, revisi profil bertambah. Panggilan `update_profile` dengan revisi lama mendapat `STALE_REVISION` (P0001) alih-alih penolakan guard. Itu perilaku T03 yang sah; test memakai revisi terbaru agar yang diuji memang guard.
- **§1.6 unduhan.** `get_cv_export_download` ditolak (42501) dan `get_evidence_file` lewat service role tidak mengembalikan baris untuk pemilik yang `deleting`.
- **§1.4 sesi.** Dua sesi untuk satu akun: setelah penghapusan lewat service, `getUser()` gagal di keduanya, refresh token sesi kedua ditolak, dan sign-in ulang dengan password benar ditolak dengan `user_banned` (aplikasi memetakannya ke pesan kredensial generik). Access token yang sudah terbit tetap diterima PostgREST sampai `exp`, tetapi penulisan dengan token itu ditolak guard (`42501`). Sisa risiko ini dicatat untuk decision 0029.
- **§1.7 job.** Untuk akun `deleting` dengan job AI, import, dan export `queued`, satu pass tiap worker nyata tidak memanggil provider AI, scanner, parser, renderer, maupun unggah Storage (semua penghitung nol). Export berakhir `failed` dengan `ACCOUNT_DELETING`. Penghapusan akun lalu selesai normal. Retry pengguna (`retry_ai_job`, `retry_cv_export`) ditolak di daftar guard.
- **§1.12 rekonsiliasi dan backlog.** Job cleanup `failed` untuk key akun yang dihapus dikembalikan ke `queued` oleh purge; receipt tidak `completed` selama itu terbuka; `get_account_deletion_backlog` menambah `pending` saat penghapusan dimulai dan `overdue` setelah `requested_at` dimundurkan 25 jam; angkanya kembali setelah selesai.
- **§1.14 isolasi.** B memanggil `begin_account_deletion(A)` lewat client pengguna dan ditolak (42501); profil A tidak berubah dan receipt A tidak ada. Setelah A dihapus, email A mendaftar ulang sebagai akun baru yang kosong (onboarding belum selesai, nol baris di tabel mana pun); data B tidak berubah.
- **§1.15 batch review.** Batch `review` idle 31 hari dibatalkan (`cancelled_at`, `expires_at`) dan dipurge dalam pass yang sama (teks dan file key dikosongkan, staging dihapus); objek file hilang setelah pass cleanup berikutnya; batch lain dengan item yang diubah kemarin tetap `review` dengan teksnya dan objeknya.
- **§1.16 snapshot.** Export sukses yang kedaluwarsa dan export gagal > 24 jam: snapshot `'{}'` + `snapshot_purged_at`; export gagal 1 jam tidak berubah. Riwayat tetap terbaca lewat `listExports` dengan kolom baru. Perubahan snapshot lain tetap ditolak.
- **§1.17 retry.** Lewat service: retry snapshot kosong → `EXPORT_RETRY_UNAVAILABLE`; setelah revisi CV berubah → `EXPORT_RETRY_UNAVAILABLE`; saat CV terblokir (`PROFILE_CHANGED`) → `EXPORT_RETRY_UNAVAILABLE`; setelah pemilik memilih *keep* untuk profil dan CV siap → diterima, status `queued`, snapshot identik.

## Catatan

1. Fixture `seedAccount` semula memakai revisi CV sebelum seleksi education; sekarang memakai revisi tersimpan. Ini perbaikan fixture, bukan perubahan perilaku.
2. Untuk blocker pada test retry, edit SQL langsung pada `profile_snapshot` menghasilkan blocker `PROFILE_CHANGED` (bukan `NAME_REQUIRED`); itu blocker sah dan dipulihkan lewat `resolve_cv_freshness`, jadi test memakai jalur produk.
3. Suite membersihkan akun lewat jalur penghapusan produk (receipt dan worker) karena `delete from auth.users` gagal pada akun berisi data. Setelah suite: nol user `acd-*`, nol receipt, nol objek, nol job terbuka.

## Acceptance Fase 6 yang terbukti

§1.4, §1.5, §1.6, §1.7, §1.12, §1.14 (integration), §1.15, §1.16, §1.17 (integration). Belum: §1.1 sampai §1.3 dan §1.18 di browser (Fase 7), §1.13 runbook (Fase 9), §1.19 sebagian, §1.20 (Fase 8).

## Langkah berikutnya

Fase 7: Playwright (`playwright.account-deletion.config.ts`, port 3015), Axe, screenshot, dan klik-through antislop.

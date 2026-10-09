# T23 Fase 4 — Worker penghapusan akun dan langkah retensi

- Tanggal: 9 Oktober 2026
- Eksekutor: Claude Sonnet 5.5

## File berubah

| File | Perubahan |
| --- | --- |
| `workers/account-deletion-worker.ts` | baru: `runAccountDeletionWorkerOnce`, seam `onStep` untuk simulasi crash |
| `workers/supabase-account-deletion-gateway.ts` | baru: RPC service role dengan timeout, `auth.admin.deleteUser(id, false)` (hard delete), 404 = `not_found` |
| `workers/import-worker.ts`, `supabase-import-gateway.ts` | `expireAbandonedImportReviews` dipanggil sebelum `purgeExpiredImportBatches`; `importReviewsExpired` |
| `workers/export-worker.ts`, `supabase-export-gateway.ts` | `redactCvExportSnapshots` setelah `expireCvExports`; `exportSnapshotsRedacted` |
| `workers/run.ts`, `workers/bootstrap.ts` | pass `account-deletion` terisolasi seperti pass lain; terdaftar di `registeredJobs` |
| `tests/unit/account-deletion-worker.test.ts` | baru: 13 test |
| `tests/unit/{import-worker,export-worker,worker-bootstrap}.test.ts` | fake bertambah method baru; satu test baru di import worker; urutan housekeeping export diperbarui |
| `tests/integration/account-deletion{,-support}.ts` | baru: suite integration dengan Auth, Storage, dan worker nyata |
| `package.json` | script `test:integration:account-deletion` |

## Command (hasil nyata)

| Command | Hasil |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm worker:check` | exit 0; `registeredJobs` memuat `account-deletion` |
| `pnpm test` | **112 file / 1025 test** lulus |
| `pnpm test:integration:account-deletion` | **1 file / 6 test** lulus (79 detik) |

Setelah suite: nol user Auth `acd-*`, nol receipt, nol objek Storage, nol storage job terbuka tersisa.

## Bukti integration (Auth, Storage, dan worker nyata)

- **Jalur penuh (§1.8–1.9, 1.14).** Akun A punya baris di 17 tabel `public` dan tabel internal, serta empat objek (evidence, import, export, yatim tanpa baris). Dihapus lewat service nyata (cek password sungguhan lewat Auth, `begin_account_deletion`, ban, sign-out global). Setelah beberapa putaran pass deletion + evidence + import + export:
  - receipt `completed` dengan `requested_at`, `objects_enqueued_at`, `rows_purged_at`, `auth_deleted_at`, `completed_at` terisi dan `last_error_code` NULL;
  - nol baris di setiap tabel ber-`user_id` (daftar dari katalog), profil dan `auth.users` hilang, prefix Storage kosong;
  - storage job akun A: tidak ada yang terbuka, sedikitnya empat tercatat (antrean bertahan setelah FK hilang);
  - sentinel akun A tidak ada di tabel `public` mana pun;
  - akun B: baris, objek, dan sesi tidak berubah.
- **Durasi (§1.13).** `requested_at` → `completed_at` = **1,9 detik** pada stack lokal, jauh di bawah 24 jam. Angka ini hanya bukti lokal; target 24 jam di hosted diverifikasi di T25.
- **Crash di tiga titik (§1.11).** Worker dimatikan lewat `onStep` setelah claim, setelah purge, dan setelah `deleteUser`. Pada ketiganya: receipt tetap `running` dengan token; job tidak dapat di-claim paralel selama lease hidup; setelah lease dimundurkan, pass berikutnya menyelesaikan penghapusan (`attempt_count ≥ 2`); purge ulang tanpa error; `deleteUser` 404 dianggap selesai; token lama ditolak oleh `mark_account_auth_deleted` dan `retry_account_deletion_job`.
- **Adapter Auth.** User yang tidak ada → `not_found`; id tidak valid ditolak dengan kode `WORKER_AUTH_UNAVAILABLE`.

## Catatan untuk reviewer

1. Test "tidak `completed` selama objek atau job terbuka tersisa" memuat satu pemeriksaan bersyarat (hanya bila objek masih ada setelah satu putaran). Jaminan utamanya diuji dengan pgTAP (Fase 1: `verify_account_purges` tidak menyelesaikan receipt selama objek, job aktif, atau job gagal tersisa).
2. Pass deletion dipanggil di `run.ts` sebelum pass AI, dan masuk ke kondisi `worked` serta ke JSON ringkasan; ringkasan hanya angka.
3. Backoff `1, 5, 15, 60` menit lalu tetap 60; diuji termasuk percobaan ke-9. Retry tanpa batas attempt sesuai §2.2.5; backlog terlihat lewat `get_account_deletion_backlog`.
4. `grep console.` di dua file worker baru: nol.
5. Perubahan pada test lama hanya penambahan method fake dan urutan housekeeping export (`redact` setelah `expire`).

## Acceptance Fase 4 yang terbukti

§1.8 dan §1.9 (integration), §1.11 (unit + integration), §1.13 sebagian (angka durasi lokal; runbook di Fase 9), §1.14 sebagian (isolasi akun B; sign-in ulang dan pendaftaran ulang email di Fase 6 dan 7), §1.19 sebagian.

## Langkah berikutnya

Fase 5: UI S12 (kartu dan dialog hapus akun), notice sign-in (sudah), notice S03, dan aturan Retry S14 di UI. Mode antislop: during.

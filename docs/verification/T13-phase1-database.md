# T13 Fase 1 — Database

- Tanggal: 27 September 2026. Commit: `a113d72`.
- Tujuan: tabel `public.ai_jobs`, RPC consent, request, dan retry untuk pengguna, RPC worker, serta reset `analysis_state` ketika revisi naik. Semua dibuat dengan TDD pgTAP.

## File berubah

| File | Perubahan |
| --- | --- |
| `supabase/migrations/20260928090000_t13_ai_jobs_consent.sql` | Baru; forward-only |
| `supabase/tests/database/ai_jobs.test.sql` | Baru; 84 assertion |
| `supabase/tests/database/activity.test.sql` | Assertion `to_regclass('public.ai_jobs') is null` diubah menjadi `is not null` karena T13 memang membuat tabel tersebut |
| `src/server/supabase/database.types.ts` | Hasil `supabase gen types` (hanya penambahan: 144 baris) |

## Keputusan pelaksanaan

- **`ai_jobs` tidak memakai `touch_mutable_row`.** Trigger tersebut juga menyalin `id` dan `user_id`. T13 memakai trigger sendiri, `internal.guard_ai_job_row`, yang menolak perubahan pada identitas, target, revisi input, key, hash, dan `created_at`. Setiap update menaikkan `revision` dan memperbarui `updated_at`.
- **Urutan lock konsisten: profile (`for share`) → activity (`for update`) → job (`for update`).**
  - `claim_ai_jobs` hanya menyentuh job dan tidak mengubah `analysis_state`. Status `running` diset oleh `get_ai_job_input`, yang sudah memegang lock activity. Dengan begitu claim tidak pernah mengambil lock activity setelah lock job.
  - `expire_ai_job_leases` memakai `skip locked`, mengambil lock activity lebih dulu, lalu job.
- **Hash payload hanya mencakup `raw_text`, `role`, `scope`, dan `outcome`.** Locale tidak ikut karena perubahan locale tidak menaikkan revisi activity. Kalau locale ikut di-hash, request ulang untuk revisi yang sama akan salah ditolak sebagai `IDEMPOTENCY_KEY_REUSED`. Locale tetap dikirim sebagai input saat job diproses.
- **Grant `SELECT` penuh ke `service_role`** hanya untuk diagnostik dan test. Semua write tetap dicabut dari seluruh role.

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm db:test` sebelum migration | ≠0 | `ai_jobs.test.sql` gagal 4/4 karena tabel belum ada; assertion activity yang baru gagal 1/55 |
| `pnpm exec supabase migration up --local` | 0 | `applied: [20260928090000_t13_ai_jobs_consent.sql]`; tanpa reset |
| `pnpm db:test` | 0 | 8 file / 470 assertion (baseline 386 + 84) |
| `pnpm db:lint` | 0 | `results: []` |
| `supabase gen types typescript --local --schema public` | 0 | Types diperbarui |
| `pnpm exec supabase migration list --local` | 0 | 22/22 |
| `pnpm typecheck` | 0 | bersih |

## Acceptance terbukti di tingkat database (§1 handoff)

| Poin §1 | Bukti pgTAP |
| --- | --- |
| 1 | Request duplikat mengembalikan job yang sama dan jumlah job tetap 1. Uji paralel dilakukan di Fase 3 |
| 2 | Edit saat running membuat `get_ai_job_input` memberi 0 row dan status `STALE_INPUT`; edit sebelum complete menghasilkan `failed:STALE_INPUT` dengan result NULL; request untuk revisi baru membuat job baru; retry job lama menghasilkan `STALE_INPUT` |
| 3 | Lease yang sudah lewat berubah menjadi `AI_TIMEOUT`. Complete dengan token lama atau token yang sudah digantikan menghasilkan `stale`. Fail pada job yang sudah selesai menghasilkan `false` |
| 4 | Attempt 1→2→3, lalu retry keempat ditolak dengan `AI_RETRY_EXHAUSTED` |
| 5 | Tanpa consent hasilnya `CONSENT_REQUIRED` dan 0 job; withdraw sebelum claim membuat input fence menghasilkan `CONSENT_REQUIRED`; withdraw saat job running menghasilkan `CONSENT_WITHDRAWN` |
| 6 | Akun deleting: input 0 row dan status `ACCOUNT_DELETING`; request, retry, dan consent menghasilkan `AUTH_REQUIRED` |
| 7 | Result dengan `schema_version` salah menghasilkan `invalid` dengan status `AI_OUTPUT_INVALID` |
| 13 | RLS menyembunyikan job A dari B; request B terhadap activity A menghasilkan `ACTIVITY_UNAVAILABLE`; retry B terhadap job A menghasilkan `AI_JOB_UNAVAILABLE` |
| Hak akses | Tidak ada write langsung untuk authenticated maupun service_role; kolom token, lease, dan hash tidak terbaca client; RPC worker hanya bisa dipanggil service_role; semua fungsi berjenis definer |
| T06 | Perubahan yang hanya menyentuh `analysis_state` tidak menaikkan revisi. Edit input menaikkan revisi dan mengembalikan `analysis_state` ke `not_requested` |
| DB §6 | Menghapus activity juga menghapus job-nya (cascade), dan worker yang terlambat mendapat `stale` |

## Langkah berikutnya

Fase 2: kontrak domain, skema hasil, minimisasi, dan adapter provider.

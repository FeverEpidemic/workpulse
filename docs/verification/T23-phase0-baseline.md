# T23 Fase 0 — Baseline, probe, dan persetujuan

- Tanggal: 9 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `7e874b6` (branch `claude/clever-archimedes-gbu7qd`)
- Tidak ada edit kode di fase ini.

## Pemeriksaan awal

| Item | Hasil |
| --- | --- |
| Working tree | bersih kecuali `.claude/setting.local.json` (untracked, diizinkan) |
| Gate M4 | **Belum PASSED.** `docs/verification/M4-gate-review.md` berstatus DRAFT tanpa verdict; `IMPLEMENTATION_STATUS.md` baris 80–87 masih menyebut Gate M4 sebagai langkah berikutnya. |
| Izin mulai sebelum M4 | Eksekutor sempat berhenti dan bertanya (stop condition §8). Pengguna menolak menjawab pertanyaan itu dan memberi perintah ulang "Coba Eksekusi ulang Plan T23". Eksekutor menafsirkannya sebagai izin eksplisit untuk melanjutkan sebelum verdict M4. **Asumsi ini dicatat agar reviewer dapat mengoreksinya.** |
| Persetujuan §2.4 | Tercatat: pengguna menyetujui ketujuh keputusan produk pada 8 Oktober 2026 ("Setuju semua"). |
| Parity migration | **31/31**, migration terakhir `20261005090000_t21_cv_export_backend.sql` (Gate M4 tidak menambah migration). |
| Container | Supabase (kecuali `supabase_vector_WorkPulse` yang restart-loop, tidak dipakai suite), `workpulse-t10-clamav`, `workpulse-t15-gotenberg`, `workpulse-t21-pdf` hidup. |

## Baseline (command nyata, exit code 0 semuanya)

| Command | Hasil |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm worker:check` | exit 0 |
| `pnpm test` | **104 file / 962 test** lulus (plan mengharapkan 103/956; selisih berasal dari penambahan Gate M4) |
| `pnpm db:test` | **15 file / 1290 assertion**, Result: PASS |
| `pnpm test:integration:cv-export` | 3 file / **35 test** |
| `pnpm test:integration:import` | 2 file / **21 test** |
| `pnpm test:integration:evidence` | 3 file / **14 test** |
| `pnpm test:integration:storage` | 1 file / **1 test** |
| `pnpm test:e2e:auth` | **1 passed** |

`SUPABASE_SECRET_KEY` memakai nilai `SERVICE_ROLE_KEY` JWT (lihat catatan environment lokal). Kunci tidak dicetak.

## Fakta source

- **Lifecycle profil.** `internal.mark_account_deleting(uuid, integer)` di `supabase/migrations/20260916120000_secure_foundation_mutations.sql:500`. `profiles.deleting_at` di `20260916090000_foundation_schema.sql:195`. FK `profiles.id → auth.users on delete cascade` di `:183`.
- **Antrean storage.** `internal.storage_jobs` di `20260917090000_t05_private_storage_foundation.sql` (tanpa FK ke profil; CHECK `storage_jobs_key_owner_check` hanya menerima key kanonis `<uuid>/(import|evidence|export)/<uuid>`). `internal.enqueue_storage_delete` di `:146`, upsert idempotent lewat `on conflict (bucket_id, object_key, kind) do nothing`.
  - Akibat untuk purge: objek `storage.objects` di prefix `<user_id>/` yang key-nya **tidak kanonis** tidak dapat diantrekan. Purge akan melewatinya dan `verify_account_purges` tidak akan menandai `completed` selama objek itu ada, sehingga muncul di backlog overdue alih-alih hilang diam-diam.
- **Claim dan reconcile.** `claim_evidence_cleanup_jobs` (`20260925100000_t10_evidence_backend.sql:1158`, scope diperbaiki di `20260925130000`), `claim_import_cleanup_jobs`, `claim_export_cleanup_jobs` (`20261005090000_t21_cv_export_backend.sql:670`), `reconcile_orphan_evidence_objects` (`:1292` T10), `reconcile_orphan_export_objects` (`:771` T21), `reconcile_orphan_import_objects`.
- **Import.** `cancel_import_batch` di `20260930090000_t15_import_staging.sql:873`; `purge_expired_import_batches` di `:1461`.
- **Export.** `internal.guard_cv_export_row` di `20261005090000_t21_cv_export_backend.sql:68`; `retry_cv_export` di `:374`; `expire_cv_exports` di `:642`.
- **Auth/UI.** `src/server/auth/context.ts` (`getRequestContext`, tanpa `accountDeleting`), `src/server/auth/actions.ts:64` (`signInAction`), `src/server/auth/errors.ts` (peta error; `user_banned` jatuh ke `error.unavailable`), `src/server/auth/adapter.ts` (belum ada `signOutGlobal`), `src/components/ui/named-delete-dialog.tsx` (hanya `children` + tombol submit ke `formId`; mendukung field tambahan lewat `children`, tetapi tombol konfirmasi tidak dapat dinonaktifkan sampai input cocok → kartu S12 memakai `Dialog` langsung sesuai §2.2.13).

## Tabel ber-`user_id` (katalog `information_schema`, skema `public`)

`achievement_skills`, `achievements`, `activities`, `ai_jobs`, `ai_suggestion_reviews`, `certifications`, `chat_messages`, `cv_documents`, `cv_exports`, `cv_items`, `education`, `evidence_files`, `experiences`, `import_batches`, `import_items`, `projects`, `skills` (17 tabel) + `profiles` (kunci `id`). Total 18 tabel `public`.

Tabel `internal` ber-`user_id` yang harus ikut dipurge (bukan bagian katalog trigger guard):

| Tabel | FK | Catatan |
| --- | --- | --- |
| `internal.operation_requests` | `profiles` cascade | perlu `DELETE` eksplisit sebelum tombstone dilepas |
| `internal.evidence_scan_jobs` | **tidak ada** | memuat `object_key`; harus dihapus eksplisit |
| `internal.evidence_reservation_requests` | **tidak ada** | harus dihapus eksplisit |
| `internal.import_jobs` | `import_batches` cascade | ikut hilang bersama batch |
| `internal.storage_jobs` | **sengaja tanpa FK** | **tidak dihapus**; bertahan sampai objek terverifikasi |

Plan §2.2.6 hanya menyebut `operation_requests`; dua tabel internal tanpa FK ditambahkan ke daftar purge Fase 1 sebagai pelengkap, tanpa mengubah kontrak yang dibekukan.

## Matriks `deleting_at` (dari katalog `pg_proc`, pencarian `deleting_at` pada badan fungsi)

RPC `authenticated` **memeriksa** `deleting_at` di badan fungsinya: `answer_ai_questions`, `apply_ai_suggestion`, `commit_import_batch`, `create_achievement_idempotent`, `create_project_idempotent`, `delete_achievement`, `delete_activity`, `delete_project`, `dismiss_ai_suggestion`, `ensure_cv_document`, `filter_*`, `get_cv_export_download`, `get_cv_export_readiness`, `get_cv_freshness`, `get_cv_review_summary`, `get_dashboard_summary`, `list_demonstrated_skills`, `relink_*`, `request_ai_analysis`, `retry_ai_job`, `save_achievement`, `set_ai_consent`, `skip_ai_questions`, `update_project`.

RPC `authenticated` yang **tidak** memeriksanya langsung: `begin_import_batch`, `cancel_import_batch`, `complete_onboarding`, `create_activity_idempotent`, `create_certification_idempotent`, `create_education_idempotent`, `create_experience_idempotent`, `create_skill_idempotent`, `delete_certification/education/experience/skill`, `remove_cv_item`, `reorder_cv_section`, `request_cv_export`, `resolve_cv_freshness`, `retry_cv_export`, `retry_import_batch`, `save_cv_edits`, `select_cv_source`, `update_activity`, `update_certification`, `update_cv_layout`, `update_education`, `update_experience`, `update_import_item`, `update_profile`, `update_skill`, `validate_import_batch`.

RPC `service_role` yang memeriksa: `claim_import_jobs`, `complete_ai_job`, `complete_cv_export`, `complete_evidence_scan_job`, `delete_evidence_file`, `fail_evidence_upload`, `finalize_evidence_upload`, `finalize_import_upload`, `get_ai_job_input`, `get_cv_export_input`, `get_evidence_file`, `list_evidence_files`, `move_activity_evidence_to_achievement`, `reserve_evidence_upload`, `retry_evidence_scan_job`. Yang **tidak**: `claim_ai_jobs`, `claim_cv_export_jobs`, `claim_evidence_scan_jobs`, `advance_import_job`, `complete_import_parse`, `complete_import_ai_job`, `get_import_ai_job_input`, `fail_import_job`.

Kesimpulan: sekitar 27 RPC tulis pengguna tidak memeriksa status `deleting`. Ini memvalidasi desain trigger generik §2.2.1 (guard per RPC akan meninggalkan celah). Catatan: pencarian string hanya menangkap pemeriksaan langsung; helper tidak dikenali.

## Probe cascade (psql, satu transaksi `begin … rollback`, tanpa commit)

Fixture: satu akun dengan experience, project, activity, achievement, education, skill, certification, achievement_skills, CV dengan 6 item, 1 export `queued`, 1 evidence `uploading`, 1 batch import.

| Probe | Hasil |
| --- | --- |
| `delete from auth.users` (cascade) | **GAGAL** |
| `delete from public.profiles` (cascade) | **GAGAL** |
| 13 `DELETE` eksplisit per tabel (urutan di bawah), profil disisakan | **BERHASIL** |

Error persis pada dua probe pertama:

```
ERROR: insert or update on table "projects" violates foreign key constraint "projects_user_id_fkey"
DETAIL: Key (user_id)=(…) is not present in table "profiles".
CONTEXT: PL/pgSQL function internal.clear_experience_context_before_delete() line 3 at SQL statement
         SQL statement "DELETE FROM ONLY public.experiences WHERE $1 = user_id"
```

Penyebabnya berbeda dari dugaan plan (`cv_items_source_check`): trigger `experiences_clear_project_context` melakukan `update public.projects` ketika cascade sudah menghapus profil, sehingga FK `projects_user_id_fkey` gagal. Dugaan plan terbantah sebagian: cascade gagal, tetapi di `experiences`, bukan di `cv_items`. Kesimpulan sama: **cascade dari `profiles` tidak dapat dipakai; purge eksplisit berurutan dengan profil sebagai tombstone diperlukan.**

Urutan eksplisit yang terbukti berhasil (profil tersisa, `internal.storage_jobs` bertambah 1 dari trigger cleanup evidence):

`cv_exports` → `cv_items` → `cv_documents` → `import_batches` → `evidence_files` → `achievement_skills` → `achievements` → `activities` → `projects` → `skills` → `certifications` → `education` → `experiences`.

Fase 1 menambahkan sebelum/sesudahnya: `ai_suggestion_reviews` dan `ai_jobs` sebelum `activities` (FK cascade sudah menanganinya, tetapi urutan eksplisit lebih aman), `chat_messages`, `import_items` (cascade dari batch), tabel internal tanpa FK di atas, dan `operation_requests`.

## Probe Auth (Supabase Auth lokal, akun sekali pakai, token tidak dicetak)

| Probe | Hasil |
| --- | --- |
| `signOut({ scope: "global" })` lalu `getUser(accessToken lama)` | **ditolak** (`AuthSessionMissingError`, status 400) |
| `refreshSession` dengan refresh token lama | **ditolak** (`refresh_token_not_found`, 400) |
| `admin.updateUserById(id, { ban_duration: "876000h" })` | sukses |
| `signInWithPassword` akun banned, password **benar** | **`user_banned`** (400, "User is banned") |
| `signInWithPassword` akun banned, password **salah** | **`user_banned`** (identik) |
| `admin.deleteUser(id)` pada akun kosong | sukses; baris `public.profiles` ikut hilang (1 → 0) |
| `deleteUser` kedua | **404 `user_not_found`** |
| Klaim JWT secret key | hanya `iss`, `role`, `exp`; **tanpa `sub`** |
| `auth.uid()` untuk `service_role` (psql, klaim tanpa `sub`) | **NULL** |
| `signInWithPassword` pada client sekali pakai (`persistSession: false`) | sukses; session client lain **tidak berubah** dan access token-nya tetap valid |

Konsekuensi untuk desain:

1. **§2.2.8:** Auth memeriksa ban **sebelum** password, jadi `user_banned` muncul untuk password benar dan salah. Pesan `auth.accountDeleting` **tidak boleh** dipilih dari error ban (itu membuka enumerasi akun). `mapSupabaseAuthError` sudah memetakan `user_banned` ke `error.unavailable`; Fase 3 menambahkan pemetaan eksplisit `user_banned` → `auth.invalidCredentials` supaya pengguna tidak melihat "layanan tidak tersedia". Cabang `signInAction` yang menampilkan `auth.accountDeleting` hanya terjangkau bila ban gagal terpasang (`AUTH_REVOKE_DEFERRED`).
2. **Poin 4 (session):** global sign-out memutus access token lama pada `getUser()` (yang memeriksa session di server) dan refresh token. Sisa risiko JWT yang sudah ditandatangani untuk panggilan PostgREST langsung sampai `exp` tetap berlaku dan dicatat; tulisan ditolak oleh guard database.
3. **Stop condition:** tidak ada yang terpicu. Ban dan global sign-out didukung, `auth.uid()` NULL untuk secret key, dan client sekali pakai tidak menulis session pengguna.

## Acceptance Fase 0

- Baseline: terbukti (angka di atas).
- Probe cascade dan probe Auth: terbukti; keduanya mengonfirmasi default plan, tidak ada penyimpangan dari §2.2 atau §2.4.
- Keputusan produk §2.4: tercatat.

## Blocker dan catatan

- Gate M4 belum diberi verdict; lanjut berdasarkan perintah ulang pengguna (lihat atas).
- Hasil probe tidak mengubah desain Fase 1 dan Fase 4 selain dua penyesuaian aditif: daftar purge menambahkan tabel internal tanpa FK, dan pemetaan `user_banned` ke pesan kredensial generik.

## Langkah berikutnya

Fase 1 (guard tulis, antrean `account_deletions`, purge berurutan) dengan test pgTAP lebih dulu.

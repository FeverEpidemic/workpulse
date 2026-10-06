# T21 Fase 1 — Database (migration, RPC, pgTAP)

- Tanggal: 6 Oktober 2026
- Status: **PASSED** (checkpoint Claude dianjurkan: protokol lock request export dan state machine job)
- Commit: `feat(t21): add CV export request, job lifecycle and retention RPCs`

## Tujuan

Menambah kolom operasional, constraint state, guard imutabilitas, definisi blocker tunggal, RPC request/retry/
readiness/unduhan untuk pengguna, dan RPC worker (lease, claim, input, complete, fail, expiry, cleanup, orphan) untuk
export CV. Tanpa perubahan fungsi T18–T20, RPC update/delete sumber, `get_dashboard_summary`, atau grant tabel
`cv_exports` T18.

## File berubah

- `supabase/migrations/20261005090000_t21_cv_export_backend.sql` (baru, forward-only)
- `supabase/tests/database/cv_export.test.sql` (baru, 175 assertion)
- `src/server/supabase/database.types.ts` (`gen types`, +109 baris, hanya penambahan; BOM dan LF dipertahankan)
- `docs/verification/T21-implementation-plan.md` (checkbox Fase 1)
- `docs/verification/T21-phase1-database.md` (receipt ini)

## Protokol lock (diverifikasi di kode dan migration)

`request_cv_export`: `internal.cv_actor()` (profil `for share`; akun deleting → `AUTH_REQUIRED`) → onboarding →
validasi input → `cv_documents … for update` **tanpa** cek revision → lookup idempotency → cek revision
(`STALE_REVISION`) → `internal.cv_export_lock_sources` (semua sumber live `for share`, urutan experience → project →
achievement → education → skill → certification, per tipe urut `id`, lewat `internal.cv_lock_source` T18) →
`internal.cv_export_blockers` → dedup → insert. `retry_cv_export`: profil → `cv_documents` → export. RPC worker:
profil `for share` → export `for update`; tidak pernah menunggu `cv_documents` atau sumber. `internal.cv_lock` T18
tidak dipakai karena ia mencampur lock dan cek revision (lihat receipt Fase 0).

## Command dan hasil

| Command | Exit | Hasil aktual |
| --- | --- | --- |
| `pnpm exec supabase test db supabase/tests/database/cv_export.test.sql` (sebelum migration) | 1 | **FAIL** — assertion struktur (kolom, constraint, fungsi) gagal; test berhenti di assertion grant karena fungsi belum ada |
| `pnpm exec supabase migration up --local` | 0 | `20261005090000_t21_cv_export_backend.sql` diterapkan (tanpa reset) |
| `pnpm exec supabase test db …/cv_export.test.sql` (setelah perbaikan test, lihat di bawah) | 0 | **175/175 PASS** |
| `pnpm db:test` | 0 | **15 file / 1290 assertion, Result: PASS** (baseline 14/1115 + 175) |
| `pnpm db:lint` | 0 | `{"results":[]}` (tanpa temuan level error) |
| `pnpm db:types` (stdout dialihkan ke file) | 0 | `database.types.ts` +109 baris, hanya penambahan |
| `pnpm typecheck` | 0 | tanpa error |
| `pnpm exec supabase migration list --local` | 0 | 31 local = 31 remote, terakhir `20261005090000` |
| `pnpm test:integration:cv-freshness` / `:cv` / `:cv-builder` | 0 / 0 / 0 | 11 / 10 / 7 passed (regresi T18–T20 tidak terganggu) |

Perbaikan test setelah run pertama (kesalahan test, bukan implementasi): suffix UUID fixture harus hex; assertion
"semua fungsi security definer" disesuaikan karena dua helper murni sengaja bukan SD; regex "tanpa key privat"
tidak lagi menyebut `outcome` (field tampil sah pada snapshot project).

## Acceptance yang terbukti pada fase ini (pgTAP)

- §1.1 kesiapan: tanpa blocker bila siap; `NAME_REQUIRED` (nama efektif kosong; override mengalahkan snapshot),
  `CONTENT_REQUIRED` (skill/sertifikat saja tidak cukup), `ITEM_CHANGED`/`ITEM_DELETED`/`ITEM_UNCONFIRMED` dengan
  `item_id` milik pemanggil, `PROFILE_CHANGED`; item `kept` dan profil `kept` lolos; readiness untuk akun tanpa CV
  (`CV_NOT_FOUND`) dan tanpa sesi/deleting (tanpa baris).
- §1.2 request atomik: baris `queued` terikat `cv_revision`; `CV_EXPORT_BLOCKED` dengan `detail` JSON kode + `item_id`
  tanpa teks CV dan tanpa write (fingerprint CV/item dan jumlah export tak berubah); `STALE_REVISION`, `CV_NOT_FOUND`,
  `ONBOARDING_REQUIRED`, `AUTH_REQUIRED` (tanpa sesi dan deleting), `INVALID_CV_INPUT` (revision null/0, key null/
  kosong/karakter tak aman/> 200).
- §1.3 snapshot: `cv-export.v1` dengan tepat sepuluh key top-level; item tepat lima key, urut section/position/id;
  override terbawa; tidak ada key `raw_text|contribution|source_excerpt|metrics|activity_id|evidence|scope` dan teks
  kontribusi privat tidak ada; trigger `CV_EXPORT_IMMUTABLE` untuk `snapshot`, `cv_revision`, `idempotency_key`,
  `user_id`; `authenticated` tanpa grant tulis, `service_role` tanpa grant tabel.
- §1.6 idempotency/dedup: key sama + revision sama → export sama (`reused`); key sama + revision lain →
  `IDEMPOTENCY_KEY_REUSED`; revision baru saat aktif → `CV_EXPORT_IN_PROGRESS`; key berbeda + revision sama saat aktif
  → export aktif; indeks unik parsial menolak insert aktif kedua (`23505`); sukses belum kedaluwarsa → dikembalikan;
  kedaluwarsa/purged → export baru; CV yang sedang terblokir tetap `CV_EXPORT_BLOCKED` walau ada export aktif.
- §1.7 job: claim mengisi token, attempt 1, lease ≈ 120 detik; claim kedua tidak mengambil yang sama; batas limit
  1..10; input hanya untuk token benar (snapshot identik); `complete` dengan token salah/lease lewat → `stale`; key
  bukan `<user>/export/<token>`, halaman > 20, byte > 10 MiB → `22023`; sukses menyimpan object, halaman, byte,
  `expires_at = finished_at + 24 jam`; selesai dua kali → `stale`; lease lewat → `failed` `EXPORT_TIMEOUT`;
  `fail` dengan kode di luar allowlist/ malformed → `22023`.
- §1.9 retry: failed retriable → `queued` dengan hash snapshot, `cv_revision`, key identik dan state attempt bersih;
  bukan failed, sukses, ID acak, `null`, kode permanen, attempt 3, akun lain → kode §2.2.9; retry saat export aktif lain
  → `CV_EXPORT_IN_PROGRESS`; attempt ketiga adalah yang terakhir.
- §1.12/§1.14 retensi: tidak ada yang jatuh tempo sebelum 24 jam; `get_cv_export_download` setelah `expires_at` →
  `CV_EXPORT_EXPIRED`; `expire_cv_exports` mengantre tepat satu `internal.storage_jobs` dan menyetel `purged_at`
  (idempotent, limit 1..500); CV dan item tetap; cleanup hanya kategori `export` (job import tidak diklaim,
  dikomplit, atau digagalkan); retry cleanup dengan backoff; `reconcile_orphan_export_objects` hanya objek `export`
  yatim ≥ ambang umur (objek baru dan objek `import` diabaikan, tanpa duplikasi, ambang < 15 menit ditolak).
- §1.13 unduhan: key hanya untuk milik sendiri yang sukses dan belum kedaluwarsa; `NOT_READY` untuk queued/failed;
  `NOT_FOUND` untuk ID acak dan akun lain (tak terbedakan); `AUTH_REQUIRED` tanpa sesi.
- §1.15 akun deleting: request/retry → `AUTH_REQUIRED`; `get_cv_export_input` → tanpa baris dan job `failed`
  `ACCOUNT_DELETING`; `complete_cv_export` → `failed:ACCOUNT_DELETING` tanpa object.
- RLS: akun B hanya melihat export sendiri dan tidak membaca snapshot akun A.

Belum dibuktikan di fase ini: §1.4, §1.5 (race dua koneksi nyata), §1.8, §1.10–§1.11, §1.16–§1.17, §1.19 — milik
Fase 2–6.

## Keputusan implementasi / penyimpangan kecil (untuk gate review)

1. **Dedup setelah validasi.** §2.2.4 menaruh "cek export aktif/sukses" sebelum lock sumber, sedangkan §2.2.6
   menyatakan dedup dilakukan **setelah** validasi blocker. Dipilih urutan §2.2.6 (lock dokumen → idempotency → revision
   → lock sumber → blocker → dedup → insert) karena itu satu-satunya yang memenuhi "CV yang kini terblokir tidak
   mendapat export lama sebagai jalan pintas"; lookup idempotency tetap sebelum cek revision.
2. **Dua helper murni bukan `security definer`:** `internal.cv_export_effective_name` dan
   `internal.is_permanent_export_error` hanya membaca argumen (immutable); tanpa grant API role. Dua puluh fungsi
   lainnya `security definer` dengan `search_path = pg_catalog`.
3. **Nama pesan error baru:** `INVALID_CV_EXPORT_CLAIM_LIMIT`, `INVALID_CV_EXPORT_COMPLETION`,
   `INVALID_CV_EXPORT_FAILURE`, `INVALID_CV_EXPORT_HOUSEKEEPING`, `INVALID_EXPORT_CLEANUP_CLAIM`,
   `INVALID_EXPORT_CLEANUP_RETRY`, `INVALID_EXPORT_ORPHAN_RECONCILIATION` (errcode `22023`, tanpa data pengguna).
4. `complete_cv_export` memvalidasi bentuk argumen (halaman 1–20, byte 1–10 MiB) sebelum CAS dan memvalidasi key =
   `<user>/export/<token>` setelah CAS (worker lama dengan argumen valid tetap mendapat `stale`).
5. Snapshot > 4 MiB (constraint) dipetakan ke `INVALID_CV_INPUT` (`22023`) dalam `request_cv_export`.
6. `reconcile_orphan_export_objects` menganggap export yang sudah `purged_at` tidak lagi memiliki objeknya, sehingga
   objek yang masih tersisa setelah cleanup gagal ikut diantrekan ulang.

## Warning / blocker

Tidak ada blocker. Tidak ada warning dari `db:lint`. Race dua koneksi nyata belum dijalankan (Fase 6); urutan lock
sudah ditinjau terhadap `save_achievement`, `update_profile` dan jalur delete T20 (receipt Fase 0).

## Langkah berikutnya

Fase 2: domain murni `src/domain/cv/export.ts` dan perluasan `contracts.ts` (test unit lebih dulu).

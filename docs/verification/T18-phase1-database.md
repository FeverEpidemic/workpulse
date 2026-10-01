# T18 Fase 1 — Database (TDD pgTAP)

- Tanggal: 30 September 2026
- Eksekutor: Claude Sonnet 5.5

## Tujuan

Migration forward-only untuk `cv_documents`, `cv_items`, `cv_exports` (struktur), trigger, RLS, index, fungsi snapshot, dan lima RPC authenticated (`ensure_cv_document`, `select_cv_source`, `remove_cv_item`, `reorder_cv_section`, `update_cv_layout`).

## File berubah

- `supabase/tests/database/cv_selection.test.sql` (baru)
- `supabase/migrations/20261002090000_t18_cv_schema_selection.sql` (baru)
- `src/server/supabase/database.types.ts` (regenerasi; hanya tambahan)

## Urutan TDD

1. Test ditulis dahulu; `pnpm db:test` **FAIL** (`relation "public.cv_documents" does not exist`, `cv_selection.test.sql` Failed 1-3, Files=12, Tests=782).
2. Migration ditulis dan diterapkan dengan `pnpm exec supabase migration up --local` (tanpa `db reset`).
3. Run pertama: 129/130 lulus; satu kegagalan adalah kesalahan ekspektasi test (posisi skill setelah swap), bukan bug migration. Test diperbaiki, tidak ada assertion dilemahkan.

## Command dan hasil aktual

| Command | Hasil |
| --- | --- |
| `pnpm db:test` | exit 0; Files=12, Tests=909, `Result: PASS` (779 lama + 130 baru) |
| `pnpm db:lint` | exit 0; `{"results":[]}` |
| `supabase gen types typescript --local --schema public` → `database.types.ts` | 304 baris ditambahkan; `pnpm typecheck` exit 0 |
| `pnpm exec supabase migration list --local` | 27 migration, semuanya terapan (27/27) |

## Keputusan implementasi di luar teks plan

- Helper internal (tidak di-grant ke klien): `internal.cv_actor`, `cv_lock`, `cv_lock_source`, `cv_section_for_source`, `cv_append_item`, `cv_renumber_section`, `cv_source_revision`. Urutan lock sesuai §2.2.10.
- `select_cv_source`: `item_ids` = semua item yang dibuat (parent dulu, lalu sumber); `parent_item_ids` = subset parent yang dibuat otomatis (kosong bila parent sudah terpilih atau tidak ada).
- Guard trigger dokumen dan item memakai errcode `P0001` dengan pesan `CV_ITEM_IMMUTABLE` (dokumen: `user_id`/`template_key`). Trigger guard dijalankan sebelum `touch_mutable_row` (nama `*_a_guard`), sehingga perubahan `user_id`/`template_key`/`section_key` ditolak sebelum check constraint.
- Violasi check saat insert item (mis. snapshot > 16 KiB) dipetakan ke `INVALID_CV_INPUT`.

## Acceptance yang dibuktikan (pgTAP)

§1.1 (berurutan + UNIQUE), §1.2, §1.3, §1.4, §1.5, §1.6, §1.7 (RLS, grant, FK lintas akun), §1.8 (+1 per mutasi, stale tanpa write), §1.10, §1.11, §1.12, §1.13 (enam fungsi delete lama), dan §1.14 (confirm tidak menyisipkan). §1.9 (paralel), integration §1.1 (paralel ×5), dan §1.15 dibuktikan di Fase 4.

## Warning / blocker

Tidak ada. `supabase gen types` menampilkan `MaxListenersExceededWarning` dari CLI (tidak berpengaruh).

## Langkah berikutnya

Fase 2: domain murni `src/domain/cv/` (contracts, selection, outline) dengan unit test.

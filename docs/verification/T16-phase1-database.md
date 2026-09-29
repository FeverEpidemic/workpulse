# T16 Fase 1 — Database (receipt)

- Tanggal: 29 September 2026
- Commit: lihat `git log` (`feat(t16): add import commit transaction, review item RPC and target trigger`).

## Tujuan

Migration forward-only `20261001090000_t16_import_commit.sql` dan pgTAP `import_commit.test.sql`: kolom staging baru, trigger target type-aware,
guard item, relaksasi provenance achievement import, validasi SQL tunggal, dan tiga RPC (`update_import_item`, `validate_import_batch`, `commit_import_batch`).

## File berubah

- Baru: `supabase/migrations/20261001090000_t16_import_commit.sql`, `supabase/tests/database/import_commit.test.sql`.
- Diubah: `src/server/supabase/database.types.ts` (regenerasi `supabase gen types`), `supabase/tests/database/import_staging.test.sql` (lihat Ruling 1).

## Command dan hasil aktual

| Command | Hasil |
| --- | --- |
| `pnpm db:test` sebelum migration (test dulu, RED) | exit 1; `import_commit.test.sql` gagal (kolom/fungsi belum ada) |
| `pnpm exec supabase migration up --local` | `20261001090000_t16_import_commit.sql` applied (tanpa `db reset`) |
| `pnpm db:test` setelah migration | exit 0, Files=11, Tests=779, PASS (baseline 668 + 111 assertion baru) |
| `pnpm db:lint` | exit 0, `{"results":[]}` |
| `supabase gen types typescript --local --schema public` → `database.types.ts` | 38 baris ditambahkan (3 RPC, 2 kolom baru) |
| `pnpm exec supabase migration list --local` | 26/26, terakhir `20261001090000` |

Catatan: `pnpm db:types` hanya mencetak ke stdout; hasilnya ditulis ke `src/server/supabase/database.types.ts` (dengan BOM seperti file asli).

## Diff `internal.guard_import_item_row` terhadap body T15

Body T15 (`20260930090000_t15_import_staging.sql:256`) hanya: cek kolom identitas → `INVALID_IMPORT_ITEM_MUTATION`, `revision + 1`, `updated_at`.
T16 menambah setelah cek identitas:

1. `committed_id` boleh berubah hanya bila sebelumnya NULL **dan** flag transaksi lokal `workpulse.import_commit = 'on'` (diset `commit_import_batch`).
2. Bila batch item berstatus `committed`: `action/target_id/committed_id/confirm_requested/validation_errors` immutable; `payload/source_excerpt/purged_at` hanya boleh berubah lewat purge
   (payload dan excerpt keduanya NULL, `purged_at` terisi dari NULL).

## Acceptance yang terbukti (pgTAP)

§1.1 (hitungan per tipe, `committed_id` hanya untuk row yang dibuat, `commit_result`), §1.2 (resolusi create/map/skip), §1.3 (commit ganda, revision lama, sesi berurutan),
§1.4 (rollback termasuk pelanggaran constraint yang lolos validator), §1.5 (map: trigger type-aware, snapshot target identik), §1.6 (draft vs confirm eksplisit + fallback bullet),
§1.7 (hanya `selected_fields`), §1.8 (onboarding), §1.9 (purge menjaga mapping dan excerpt achievement), §1.10 (update/stale/allowlist), §1.11 (validasi tiap kode kecuali `INVALID_ACTION`,
yang tidak dapat dicapai lewat RPC karena trigger menolak profile+map), §1.12 (status, isolasi A/B, akun deleting, tanpa grant write). Race (§1.13), skenario PRD (§1.14),
S08 (§1.15), log hygiene (§1.16 sisi service/worker) dibuktikan di fase berikutnya.

## Ruling

1. **Fixture T15 diadaptasi.** `import_staging.test.sql` (bagian "committed purge") mengisi `committed_id = gen_random_uuid()` langsung. Guard T16 (plan §2.2.15) dan trigger target
   (§2.2.16) memang melarang itu. Fixture kini membuat skill nyata, menulis `committed_id` dengan flag commit saat batch masih `review`, menghapus skill lagi (agar assertion
   `canonical_count` di akhir file tetap identik), baru menandai batch `committed`. Semua assertion T15 tidak diubah; hasil: 115/115 tetap lulus.
2. **`import_items_confirm_check` diperketat** menjadi `not confirm_requested or (entity_type = 'achievement' and action = 'create')` (plan hanya menyebut `entity_type`). RPC sudah mereset flag
   saat action keluar dari `create`; check ini menutup jalur tulis lain. Biaya bila salah: tidak ada, tidak ada kontrak T15 yang membaca kolom ini.
3. **`validate_import_batch` volatile, bukan `stable`** (plan §3.1): `internal.import_actor()` memakai `select … for share`, yang tidak diizinkan pada fungsi non-volatile. Tanpa write.
4. Fixture review pgTAP diinsert langsung sebagai owner test (pipeline T15 sudah punya pgTAP/integration sendiri; integration Fase 3 memakai pipeline nyata).

## Blocker dan langkah berikutnya

Tidak ada blocker. Fase 2: kontrak domain, service, action (test unit sudah ditulis dan akan dijalankan RED dulu).

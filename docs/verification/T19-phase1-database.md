# T19 Fase 1 — Database (30 September 2026)

- Tujuan: RPC `public.save_cv_edits(p_expected_revision integer, p_edits jsonb) returns integer` di atas schema T18, tanpa tabel atau kolom baru.
- File: `supabase/migrations/20261003090000_t19_cv_builder_overrides.sql` (helper `internal.cv_profile_overrides_valid`, constraint `cv_documents_profile_overrides_check`, RPC), `supabase/tests/database/cv_builder.test.sql` (69 assertion), `src/server/supabase/database.types.ts` (+`save_cv_edits`).
- Urutan TDD: `cv_builder.test.sql` ditulis lebih dulu dan `pnpm db:test` gagal (13 file, red) sebelum migration; migration pertama gagal (`pg_catalog.unnest` multi-argumen tidak ada, diganti `rows from (...)`), dibatalkan manual di database lokal (drop objek T19 + hapus baris `schema_migrations`, **bukan** `db reset`) lalu diterapkan ulang.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `supabase migration up --local` | migration diterapkan |
| `supabase test db .../cv_builder.test.sql` | 69 assertion PASS |
| `pnpm db:test` | 13 file / 978 assertion PASS (909 + 69) |
| `pnpm db:lint` | exit 0, `results: []` |
| `supabase gen types` → `database.types.ts` | `save_cv_edits` ditambahkan (BOM dipertahankan) |
| `migration list --local` | 28/28, terakhir `20261003090000` |

## Acceptance terbukti (pgTAP)

Struktur/grant; auth, deleting, onboarding; validasi (judul, summary, override, profil, website, email, key asing, duplikat, ID salah) tanpa write dan tanpa teks di pesan; `STALE_REVISION` tanpa write; override item menyimpan hanya `override_text` (snapshot, `source_revision`, baris canonical utuh); skill/certification → `CV_OVERRIDE_UNSUPPORTED`; item akun lain dan ID acak → `CV_ITEM_NOT_FOUND`; batch atomik dengan tepat satu kenaikan revision; no-op tidak menulis; hapus override (null/blank) termasuk penghapusan `display_overrides`; profil sumber dan `profile_source_revision` tidak berubah; kompatibilitas T18 (layout, delete sumber, remove item ber-override); isolasi akun B.

## Catatan

- Semantik `profile_overrides` = patch per key (key hadir diset/dihapus, key absen tidak berubah); item disentuh `for update` berurutan `id`.
- Batas `display_name` **80** (mengikuti profil), bukan 120.
- Berikutnya: Fase 2 (domain murni).

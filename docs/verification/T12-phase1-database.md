# T12 — Receipt Fase 1: database

- Tanggal: 26 September 2026
- Commit: `162b810 feat(t12): add dashboard and timeline read functions`
- Migration: `20260927090000_t12_dashboard_timeline.sql` (forward-only; tanpa perubahan tabel).

## Perubahan

- Empat fungsi baca memakai `SECURITY INVOKER`, memeriksa `auth.uid()`/ownership, menghormati RLS dan status penghapusan akun, serta tidak memutasi data.
- Fungsi filter achievement/project menjadi predicate yang sama dengan hitungan missing evidence/outcome; demonstrated skills dihitung dari achievement confirmed dan evidence hanya direct `ready`.
- PgTAP menutup grant, invoker, owner isolation, data deleting, empty account, skill normalization, direct evidence semantics, dan count fixture.

## Verifikasi aktual

- `supabase test db`: **386/386** assertion lulus (7 file).
- `supabase db lint --level error`: lulus, `results: []`.
- `supabase gen types typescript --local --schema public`: exit 0.
- `supabase migration list --local`: local/remote parity **21/21**; tidak menjalankan `db reset`.

## Acceptance/batas

- Dashboard read model serta empat filter SQL memiliki bukti database lokal nyata dan owner-scoped.
- Akses production belum diverifikasi.

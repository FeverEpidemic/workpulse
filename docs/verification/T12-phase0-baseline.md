# T12 — Receipt Fase 0: baseline

- Tanggal: 26 September 2026
- Baseline Git: `296767b` (handoff T12); checkout pada branch `claude/clever-archimedes-gbu7qd`.
- Scope: audit read-only sebelum implementasi. Tidak ada perubahan kode pada fase ini.

## Hasil

- Status Supabase lokal aktif; daftar migration baseline 20/20 sampai `20260926100000_t11_evidence_lifecycle.sql`. Setelah migration T12 pada Fase 1, parity menjadi 21/21.
- Kebijakan ownership/RLS untuk foundation dan profile berada di `supabase/migrations/20260916090000_foundation_schema.sql` dan migration foundation hardening. Activity memakai `20260917160000_t06_activity_persistence.sql`, Project memakai migration T08, Achievement/Skills memakai migration T09, dan evidence memakai `20260925100000_t10_evidence_backend.sql` (policy `evidence_files_owner_read`, status `ready`). Normalisasi outcome Project dan validasi owner diperiksa pada migration T08.
- `pnpm install --frozen-lockfile` tidak dapat dijalankan karena launcher `pnpm` mencoba mengambil runtime dari jaringan yang tidak tersedia. Tidak ada dependency yang ditambah atau lockfile yang diubah; command package diverifikasi melalui binary lokal pada fase berikutnya.
- `.claude/` tetap tidak tersentuh dan tidak pernah masuk ke staging T12.

## Acceptance/batas

- Baseline dependency, migration, RLS, owner normalization, dan ready evidence dicatat untuk implementasi T12.
- Tidak ada akses production atau klaim integrasi production.

## Langkah berikutnya

- Lanjutkan migration read-only dan pgTAP T12 tanpa reset database lokal aktif.

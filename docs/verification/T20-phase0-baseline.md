# T20 Fase 0 — Baseline (receipt)

- Tanggal: 2 Oktober 2026
- Tujuan: baseline sebelum edit kode T20 dan verifikasi asumsi plan terhadap source nyata.
- Persetujuan pengguna: keenam keputusan produk §2.4 plan T20 **disetujui pengguna pada 2 Oktober 2026** (commit `050f8d2`); tidak ada penyimpangan.

## Kondisi awal

- `git status --short --branch`: `## claude/clever-archimedes-gbu7qd...origin/claude/clever-archimedes-gbu7qd [ahead 2]`, hanya `?? .claude/` (bersih sesuai syarat). HEAD `050f8d2797771b9e09aee2db1bd339f801340452`.
- Supabase lokal belum berjalan saat mulai; `pnpm db:start` (tanpa reset) menyalakannya dari backup.
- Migration parity `supabase migration list --local`: **29/29**, terakhir `20261003100000_t19_cv_override_helper_grants.sql`.

## Baseline command (hasil aktual)

| Command | Hasil |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0, up to date |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0 — 87 file / 635 test lulus |
| `pnpm db:test` | exit 0 — 13 file / 979 assertion, PASS |
| `pnpm test:integration:cv-builder` | exit 0 — 7/7 |
| `pnpm test:integration:cv` | exit 0 — 10/10 |
| `pnpm test:integration:dashboard` | exit 0 — 4/4 |

Semua angka sama dengan harapan plan.

## Verifikasi source (file:baris)

Definisi **terakhir** fungsi delete (tidak ada definisi lebih baru di migration T10–T19; dicek dengan grep atas seluruh `supabase/migrations`):

- `public.delete_achievement` — `20260922100000_t09_achievements_skills.sql:911`. Lock pertama: baris achievement `for update` (:933–936). Tidak ada lock profil `for update`; hanya `exists` pada profil. Auth dicek di :928–932.
- `public.delete_project` — `...t09...sql:1125`. Lock pertama: experience induk `for update` (:1155–1159), lalu project, activities, achievements. Auth :1146–1150.
- `public.delete_experience` — `...t09...sql:1204`. Lock pertama: experience `for update` (:1222–1225). Guard auth `return` (bukan raise) pada :1221.
- `internal.delete_foundation_record` — `20260916124500_fix_foundation_rpc_row_checks.sql:132`. Lock pertama: baris tabel target `for update` (:161–166). Dipakai `delete_education`, `delete_certification`, `delete_skill` (`20260916120000_secure_foundation_mutations.sql:407–449`); jalur `projects` di whitelist tidak dipakai karena `public.delete_project` diganti T09.
- Tidak ada fungsi delete yang mengunci profil `for update`. Titik sisipan lock CV (setelah validasi auth, sebelum lock sumber pertama) tidak bertentangan dengan lock lain → stop condition tidak terpicu.

Urutan lock jalur lain (semua experience → project → activity → achievement, urut id):

- `relink_achievement_project` (`...t09...sql:794`): experience (current+target) → project (current+target) → activity → achievement. `relink_activity_project` (:1033): experience → project → activity. `delete_activity` (:955): experience → project → activity → achievements.
- `save_achievement` (:545): hanya achievement `for update` (skill dikunci di dalam fungsi); tidak menyentuh CV. `update_activity` memanggil `internal.update_activity` (T06); tidak mengunci achievement di wrapper.
- `select_cv_source` (`20261002090000_t18...sql:622`): `cv_actor` (profil share) → `cv_lock` → sumber `for share` → **achievement lalu parent** (:652–699). Ini berlawanan dengan relink (project → achievement), jadi keputusan §2.2.7 (parent dulu) memang diperlukan.
- Helper T18: `internal.cv_actor` :413, `cv_lock` :435, `cv_lock_source` :461, `cv_append_item` :505, `cv_source_revision` :319, `cv_source_snapshot` :349. `save_cv_edits` — `20261003090000_t19...sql:73`.
- FK `cv_items_*_fk ... on delete set null` + trigger `guard_cv_item_row` (:236–277) sudah menandai `source_deleted` pada delete sumber; T20 menambah lock CV di depan dan kenaikan revision dokumen.
- Profil: tujuh key `profile_snapshot` = `display_name, headline, summary, contact_email, phone, location, website` (`ensure_cv_document`, :597–613); kolom `profiles` bernama sama; `profile_source_revision` = `profiles.revision`.

Sisi aplikasi:

- `src/features/cv/{cv-service,cv-errors,actions,cv-builder-state,cv-view}.ts`, `src/app/(workspace)/cv/page.tsx` dibaca; pola `run()` + `revalidatePath("/cv")` di `actions.ts:34–45`.
- Dashboard: `src/features/dashboard/dashboard-service.ts` (`getDashboard`, RPC paralel), `dashboard-view.tsx` (`CheckLink` memakai kunci `One/Other`), `src/domain/dashboard/{contracts,links}.ts`. Test unit yang ada: `tests/unit/dashboard-service.test.ts`, `dashboard-links.test.ts`; E2E: `tests/e2e/dashboard-timeline.spec.ts`.
- Test unit CV yang ada: `cv-actions`, `cv-builder-state`, `cv-builder-ui.test.tsx`, `cv-contracts`, `cv-draft`, `cv-fixtures.ts`, `cv-labels`, `cv-outline`, `cv-preview`, `cv-resolve`, `cv-selection`, `cv-service`.
- Port Playwright terpakai 3000–3012 (`playwright.cv.config.ts` = 3012); **3013 bebas**. Pola config disalin dari `playwright.cv.config.ts`.

## Blocker

Tidak ada. Lanjut Fase 1.

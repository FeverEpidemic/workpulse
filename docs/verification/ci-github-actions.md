# CI GitHub Actions

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Jalan pada setiap pull request, push ke `main`, dan manual (`workflow_dispatch`). Run lama pada ref yang sama dibatalkan saat ada push baru. Token workflow hanya `contents: read`.

Ini CI saja. Belum ada CD: deploy web/worker dan `supabase db push` ke staging ditunda sampai hosting staging dipilih (lihat T25 Fase 7).

## Job

| Job | Isi | Butuh Docker |
| --- | --- | --- |
| `checks` | `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit, plus project Storybook di Chromium bila ada), `pnpm worker:check`, `pnpm build` | Tidak |
| `database` | `supabase start` lokal, `supabase db lint --level error`, `supabase test db` (pgTAP), cek tipe hasil generate sama dengan `src/server/supabase/database.types.ts`, integration yang cukup dengan Supabase, smoke E2E (`playwright.config.ts`) | Ya (bawaan runner) |

Integration yang dijalankan, dengan `account-deletion` paling awal: worker di suite itu hanya mengambil satu job cleanup per ronde, jadi job Storage sisa suite lain membuat receipt tidak selesai dalam batas 12 ronde (gagal di run pertama CI). Sisanya: `activity`, `projects`, `achievements`, `dashboard`, `m2`, `cv`, `cv-builder`, `cv-freshness`, `ai-review`, `account-deletion`, `product-events`, `release`.

## Keputusan teknis

- **Supabase CLI dari `supabase/setup-cli@v1`, versi 2.117.0** (sama dengan devDependency). Paket npm `supabase` tidak ada di `allowBuilds` (`pnpm-workspace.yaml`), jadi binarinya tidak pernah diunduh dan shim `node_modules/.bin/supabase` rusak. Karena itu workflow memanggil `supabase` langsung, bukan `pnpm db:*`. Saat menaikkan versi CLI, ubah keduanya.
- **Key lokal** dibaca dari `supabase status -o env`, semua nilai `*KEY*`/`*SECRET*` di-mask sebelum ditulis ke `$GITHUB_ENV`. Key ini hanya milik stack sekali pakai di runner; tidak ada secret repository yang dipakai.
- **Playwright selalu lewat `node node_modules/@playwright/test/cli.js`.** Jika ada paket `playwright` top-level dengan versi lain (setup Storybook memakai `"playwright": "latest"`), `pnpm exec playwright` memakai versi itu dan semua spec gagal dengan "did not expect test.beforeAll()". Saran: pin `playwright` ke versi yang sama dengan `@playwright/test`.
- Service yang tidak dipakai test dimatikan saat start: `studio`, `imgproxy`, `edge-runtime`, `logflare`, `vector`, `supavisor`.

## Membaca kegagalan

- `Generated types match the schema` gagal: ada migration tanpa `pnpm db:types`. Generate ulang lalu commit file tipe.
- Smoke E2E gagal: unduh artifact `playwright-report` (berisi `playwright-report/` dan `test-results/`, disimpan 7 hari).
- Integration timeout pada start: lihat log `Start local Supabase`; image Supabase ditarik ulang setiap run.

## Belum dicakup

- E2E per fitur dan integration `evidence`, `import*`, `cv-export`, `ai`, `m3`, `m4`: butuh ClamAV dan Gotenberg. Kandidat workflow nightly dengan service container memakai digest image yang sama dengan runbook [T10](T10-scanner-runbook.md), [T15](T15-renderer-runbook.md), [T21](T21-pdf-renderer-runbook.md).
- `test:ai:live` dan `ops:check` terhadap hosted: butuh secret nyata dan persetujuan pengguna.
- `test:perf`, `test:pdf`.

## Bukti

Belum ada run. Isi setelah run pertama: URL run, commit, durasi per job, hasil.

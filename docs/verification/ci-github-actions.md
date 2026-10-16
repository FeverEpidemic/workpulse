# CI/CD GitHub Actions

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Jalan pada setiap pull request, push ke `main`, tag `v*`, dan manual (`workflow_dispatch`). Run PR lama dibatalkan saat ada push baru; run `main` dan tag tidak pernah dibatalkan agar publish image tidak terputus. Token workflow `contents: read`; hanya job `images` yang mendapat `packages: write`.

CD sejauh ini berarti build, uji, dan publish image Docker ke GHCR. Deploy image ke host dan `supabase db push` ke staging belum ada, menunggu hosting staging dipilih (lihat T25 Fase 7).

## Job

| Job | Isi | Butuh Docker |
| --- | --- | --- |
| `checks` | `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit, plus project Storybook di Chromium bila ada), `pnpm worker:check`, `pnpm build` | Tidak |
| `database` | `supabase start` lokal, `supabase db lint --level error`, `supabase test db` (pgTAP), cek tipe hasil generate sama dengan `src/server/supabase/database.types.ts`, integration yang cukup dengan Supabase, smoke E2E (`playwright.config.ts`) | Ya (bawaan runner) |
| `images` (matrix `web`, `worker`) | Setelah `checks` dan `database` lulus: build target dari [`Dockerfile`](../../Dockerfile), cek tidak ada file `.env*`, uji container, lalu publish ke GHCR bila push ke `main` atau tag `v*` | Ya |

Integration yang dijalankan, dengan `account-deletion` paling awal: worker di suite itu hanya mengambil satu job cleanup per ronde, jadi job Storage sisa suite lain membuat receipt tidak selesai dalam batas 12 ronde (gagal di run pertama CI). Sisanya: `activity`, `projects`, `achievements`, `dashboard`, `m2`, `cv`, `cv-builder`, `cv-freshness`, `ai-review`, `product-events`, `release`.

## Image Docker (CD)

| Image | Isi | Uji di CI |
| --- | --- | --- |
| `ghcr.io/feverepidemic/workpulse-web` | Next.js standalone (`node server.js`), port 3000, user `node` | `GET /api/health` → `{"status":"ok","service":"workpulse-web"}`, tanpa header `x-powered-by` |
| `ghcr.io/feverepidemic/workpulse-worker` | `node workers/run.ts` dengan dependensi production, `workers/` dan `src/` | `worker:check` di container; `run.ts --once` tanpa config keluar 1 dengan tepat `WORKER_UNAVAILABLE` (semua modul termuat, fail-closed) |

Tag: SHA commit penuh selalu; `main` untuk push ke `main`; versi semver untuk tag `v1.2.3`. Deploy sebaiknya merujuk SHA, bukan `main`.

- **Satu image untuk semua environment.** Tidak ada secret atau `NEXT_PUBLIC_*` saat build. `NEXT_PUBLIC_SUPABASE_*` hanya dibaca di kode server (`src/server/supabase/config.ts`), jadi nilainya dibaca saat runtime dari env container. Jangan menambahkan `NEXT_PUBLIC_*` ke build Docker: Next.js akan menanamnya ke bundle.
- **Env saat container jalan.** Web: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `WORKPULSE_SITE_URL`. Worker: variabel bagian worker, AI, renderer, dan scanner dari [`.env.example`](../../.env.example) dan runbook T25. ClamAV dan Gotenberg tidak di-build; pakai image resmi dengan digest dari runbook T10/T15/T21 di jaringan privat.
- **`output: "standalone"` hanya untuk build Docker** (`WORKPULSE_STANDALONE=1` di `next.config.ts`). `pnpm build` lokal dan job `checks` tetap build biasa, karena standalone di Windows menyalin node_modules pnpm yang penuh symlink.
- **Build context allow-list** ([`.dockerignore`](../../.dockerignore)): hanya manifest pnpm, config Next/TS/PostCSS, `src/`, `public/`, `workers/`. File `.env*`, state Supabase lokal, tests dan docs tidak pernah masuk.
- Migration tidak ikut image. `supabase db push` ke staging tetap langkah manual dengan persetujuan, sesuai runbook T25 §3.

Menjalankan lokal (butuh Docker):

```bash
docker build --target web -t workpulse-web .
```

```bash
docker run --rm -p 3000:3000 --env-file .env.local workpulse-web
```

Di dalam container `127.0.0.1` adalah container itu sendiri, jadi untuk Supabase lokal ganti host di `SUPABASE_URL` dengan `host.docker.internal`.

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

- CI: PR #17 hijau setelah tiga perbaikan (urutan `account-deletion`, query diagnostik, `WORKPULSE_SITE_URL`), lalu di-merge ke `main` (`b75a9b4`).
- CD: belum ada run. Isi setelah run pertama: URL run, commit, ukuran image, tag yang terbit di GHCR.

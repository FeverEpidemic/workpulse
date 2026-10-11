# T25 Fase 8 — Regresi penuh dan hygiene

- Tanggal: 10 dan 11 Oktober 2026 (tanggal sistem berganti di tengah fase)
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD akhir fase: lihat `git log -1` setelah receipt ini. Stack lokal aktif 36/36, tidak pernah di-reset.
- Env per suite: `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` (env proses saja), `.env.local`, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`, `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan. ClamAV T10, Gotenberg T15 dan `workpulse-t21-pdf` hidup. Suite dijalankan satu per satu; `test:perf` sendirian.
- Playwright dijalankan lewat `node node_modules/@playwright/test/cli.js test …` dengan argumen yang sama persis dengan script `package.json`, karena perubahan Storybook sesi lain di working tree membuat `pnpm exec playwright` memanggil versi 1.64.0 (lihat O12).

## Run penuh (52 command, urutan plan §7)

| Command | Hasil |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, **124 file / 1093 test** (baseline 114/1041 + 16 test T25; sisanya dari konfigurasi Storybook sesi lain) |
| `pnpm db:test` | exit 0, **20 file / 1638 assertion**, PASS |
| `pnpm db:lint` | exit 0 |
| `supabase migration list --local` | exit 0, 36 migration, local = remote |
| `pnpm test:integration:release` | exit 0, 2 file / **12 test** |
| `pnpm test:integration:product-events` | exit 0, 9 test |
| `pnpm test:integration:account-deletion` | exit 0, 2 file / 14 test |
| `pnpm test:pdf` | exit 0, 46 test |
| `pnpm test:integration:cv-export` | exit 0, 3 file / 35 test |
| `pnpm test:integration:cv-freshness` | exit 0, 11 test |
| `pnpm test:integration:cv-builder` | exit 0, 7 test |
| `pnpm test:integration:cv` | exit 0, 10 test |
| `pnpm test:integration:achievements` | exit 0, 5 test |
| `pnpm test:integration:projects` | exit 0, 7 test |
| `pnpm test:integration:activity` | exit 0, 6 test |
| `pnpm test:integration:dashboard` | exit 0, 4 test |
| `pnpm test:integration:import-commit` | exit 0, 11 test |
| `pnpm test:integration:import-review` | exit 0, 6 test |
| `pnpm test:integration:import` | exit 0, 2 file / 21 test |
| `pnpm test:integration:m2` | exit 0, 8 test |
| `pnpm test:integration:m3` | exit 0, 7 test |
| `pnpm test:integration:m4` | exit 0, 17 test |
| `pnpm test:integration:ai` | exit 0, 13 test |
| `pnpm test:integration:ai-review` | exit 0, 21 test |
| `pnpm test:integration:evidence` | exit 0, 3 file / 14 test |
| `pnpm test:integration:storage` | exit 0, 1 test |
| `pnpm test:perf` | exit 0, 3 test; p95 baca maksimum **192,1 ms** (target 2.000), p95 simpan maksimum **130,6 ms** (target 1.000), n = 50 per operasi |
| `pnpm ops:check` | exit 0, `status: ok`, delapan metrik 0 |
| `pnpm worker:check` | exit 0, `status: ready` |
| `pnpm build` | exit 0 |
| `test:e2e:release` | **15 passed** |
| `test:e2e:account-deletion` | 7 passed |
| `test:e2e:cv-export` | 12 passed |
| `test:e2e:cv-freshness` | 11 passed |
| `test:e2e:cv` | 8 passed |
| `test:e2e:achievements` | 4 passed |
| `test:e2e:projects` | 1 passed |
| `test:e2e:dashboard` | 1 passed |
| `test:e2e:auth` | 1 passed |
| `test:e2e:ui` | 1 passed |
| `test:e2e:activity` | 1 passed |
| `test:e2e:import` | 7 passed |
| `test:e2e:import-review` | 10 passed |
| `test:e2e:ai` | 2 passed |
| `test:e2e:ai-review` | 11 passed |
| `test:e2e:evidence` | 8 passed (lihat temuan flaky di bawah) |
| `test:e2e:m2` | 1 passed (env AI dikosongkan) |
| `test:e2e:m3` | 2 passed (env AI dikosongkan) |
| `test:e2e:m4` | 1 passed |
| `git diff --check` | exit 0 |

Peringatan yang sudah ada sebelum T25: `Cannot load "@napi-rs/canvas"` pada `test:pdf`, `cv-export`, `m4`; log server Next `The destination stream closed early` pada setiap suite E2E.

## Temuan Fase 8

| ID | Prio | Temuan | Penyelesaian |
| --- | --- | --- | --- |
| D12 | P2 | **Regresi dari perbaikan D11 saya.** `overflow-wrap: anywhere` pada seluruh `.workspace-content` membuat `activity-ui.spec.ts` gagal di dalam `test:e2e:evidence` (filter project tidak diterapkan, panah Note → Form tidak mengubah radio): gagal pada 3 dari 3 run, sementara base pra-T25 dan commit yang sama tanpa aturan itu lulus. Aturan yang lebih sempit (hanya `h1` sampai `h3`) masih memberi 1 gagal dari 3 run pada checkout bersih. | Aturan global dihapus. Utility `wrap-anywhere` dipasang hanya pada dua `h1` yang membawa judul dari pengguna (`achievement-detail.tsx`, `project-detail.tsx`), asal masalah S08. Hasil: tes 200% lulus; `test:e2e:evidence` lulus 3 dari 3 run, `achievements`, `projects`, `m2`, `m3`, `m4`, `dashboard` lulus. |
| F1 | flaky | `release-keyboard` › dialog: percobaan pertama gagal sekali, mengulang tanpa perubahan lulus. Sebab: Space dikirim dalam frame yang sama dengan Escape yang menutup dialog penghapusan akun; event `close` native sampai ke React satu task kemudian, sehingga klik membuka dialog diabaikan. Manusia tidak menekan tombol dalam satu frame. | Spec menunggu dua animation frame sebelum membuka ulang (`settle`), seperti yang sudah dilakukan untuk dialog hapus. Dua run penuh berikutnya 15/15. |
| F2 | flaky | `release-a11y` › snapshot aria S05 dan S14 gagal pada percobaan pertama dan kedua setelah tanggal sistem berganti: form capture memuat tanggal hari ini, export "Available until" memuat tanggal besok. | Tanggal dan jam dinormalisasi sebelum dikunci; pesan kegagalan kini menyebut baris pertama yang berbeda. Dua run berturut-turut lulus pada tanggal baru, lalu run penuh 15/15. |
| F3 | env | Worktree sementara untuk membandingkan base dengan HEAD: dua run pertama gagal start karena build mengambil Google Fonts lewat jaringan (`next/font`). Run berikutnya lulus. | Tidak berkaitan dengan produk; catatan untuk operator offline: font Plus Jakarta Sans diambil saat build. |
| F4 | env | `test:e2e:*` menulis ulang tangkapan layar T22/T23 dan `T24-perf-results.json` yang tercatat di git. | Dipulihkan dengan `git checkout` agar diff hanya berisi pekerjaan T25; angka p95 baru dicatat di receipt ini. |

### Analisis flaky `activity-ui` di suite evidence

| Konfigurasi | Hasil `test:e2e:evidence` |
| --- | --- |
| base pra-T25 `3c16211` (checkout bersih, dependensi sesuai lockfile) | 5 dari 5 lulus |
| T25 sebelum perbaikan, `overflow-wrap` pada seluruh workspace | 3 dari 3 gagal di working tree; gagal di checkout bersih |
| T25, aturan yang sama dicabut | lulus (checkout bersih) |
| T25, aturan hanya `h1` sampai `h3` | 1 gagal dari 3 (checkout bersih); 1 gagal dan 2 lulus di working tree |
| T25, tanpa aturan sama sekali | 4 dari 4 lulus |
| T25 akhir (utility pada dua `h1`) | 3 dari 3 lulus |

Spec itu rapuh terhadap timing hidrasi (ia memilih `<select>` dan menekan panah sebelum React selesai hidrasi); perubahan tata letak yang kecil menggeser peluangnya. Spec lama tidak diubah. Penyebab pasti mengapa wrap pada heading menggeser peluang tidak diselidiki lebih jauh; perbaikan sekarang tidak menyentuh halaman Activity.

## Hygiene diff (HEAD Fase 0 = `6e861f2`)

- `git diff 6e861f2..HEAD -- supabase/migrations`: hanya `20261011100000_t24_pilot_metrics_as_of.sql` (masuk lewat merge `origin/main`, P-1) dan `20261012090000_t25_operational_health.sql`.
- `git diff --stat`: berisi file §4 plus file yang tercatat: `tests/e2e/helpers/release-fixture.ts` (helper bersama), `tests/e2e/helpers/accessibility.ts` (satu fungsi baru), `tokens.css`, `globals.css`, dua `h1` (D9, D10, D11), dan dokumen T24 yang datang dari merge `origin/main`. Tidak ada dependency baru.
- `git diff --check 6e861f2..HEAD`: exit 0.
- Grep `sb_secret_`, `eyJ`, sentinel `WP-PRIVATE-*-SENTINEL-<hex>`, email fixture `@workpulse.test` atau `@example.test`, dan `Aa1!` di `docs/verification/T25-*`: hanya penyebutan pola dan placeholder `<uuid>`, tidak ada nilai. Golden aria bersih dari email, id, dan sentinel. Nama file tangkapan layar hanya `<layar>-<lebar>-<tema>.png`, email ditutup (mask) di dalam gambar.
- Akun `t25-*` yang tersisa: **0**. Akun `acd-*` (suite T23 dan restore): 0.
- Profil di database lokal: 235 pada akhir fase (baseline Fase 0: 229; 232 setelah regresi pertama). Tiga akun `wp-*@example.test` dibuat oleh suite lama `test:integration:storage` dan `test:e2e:ui` dan tidak menghapusnya (O3; bertambah tiga setiap regresi penuh). Tidak dibersihkan.

## Perubahan source selama T25 (ringkas)

| Area | Perubahan |
| --- | --- |
| Database | satu migration `20261012090000_t25_operational_health.sql`; tipe diregenerasi |
| Source `src/` | `tokens.css` (dark `border-control`, token `selection-bg`), `globals.css` (`::selection`), `messages.ts` dan `delete-account-card.tsx` (kalimat S12), dua `h1` (`wrap-anywhere`) |
| Worker | `workers/ops-check.ts` |
| Test baru | pgTAP 2 file; integration 2 file (12 test); unit 3 file (+1 test di i18n); E2E 2 spec, 1 config, 1 helper |

## Acceptance yang belum terbukti

| Poin §1 | Status |
| --- | --- |
| §1.17 retensi backup ≤ 30 hari terverifikasi | **belum** (BLOCKER B2) |
| §1.18 staging | **belum** (Fase 7 BLOCKED, B1) |
| §1.11 screen reader nyata (NVDA) | **belum dijalankan**; proxy snapshot aria ada |
| Seluruh §1 lainnya | terbukti dengan hasil di atas |

## Langkah berikutnya

Serahkan ke reviewer Claude: hash commit, receipt Fase 0–8, `T25-release-matrix.md`, daftar defect dan statusnya, dan acceptance yang belum terbukti. Fase 9 (decision 0031, `T25-release-handoff.md`, README) dikerjakan setelah gate dan perbaikan P0–P2. Rekomendasi status T25: **PARTIAL**.

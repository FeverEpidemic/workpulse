# Gate M5 Fase 0: baseline

- Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5), satu sesi, mode antislop *during* (dipilih pengguna untuk sesi ini).
- Handoff: `docs/verification/M5-gate-review-plan.md`. File itu **belum ada di `main`**; ia hanya ada di branch `claude/t27-mobile-tab-bar` (commit `071c046`, `a0416d4`). Pelaksana membacanya dari checkout utama tanpa mengubahnya. Atas permintaan sesi asal, salinan identik (blob `adaaff94`, sama dengan branch T27) di-commit ke branch gate di `32b8ebc` agar receipt dapat menautkannya di `main`.
- Tujuan: worktree bersih dari `origin/main`, parity migration, tiga container nyata, dan angka baseline.

## Worktree

| Butir | Hasil |
| --- | --- |
| Lokasi | `D:\Project\WorkPulse\.claude\worktrees\m5-gate-review` |
| Branch | `claude/m5-gate-review` dari `origin/main` (upstream dilepas agar tidak ter-push) |
| HEAD | `973e886` (Merge PR #31, image Docker CD). Memuat `181103f` (PR #29) dan PR #30 (closeout T25) |
| `git status --short --branch` | `## claude/m5-gate-review`, bersih |
| T27 di `main`? | **Tidak.** T27 ada di `claude/t27-mobile-tab-bar` dan belum di-merge. Sesuai §2.2 butir 2, T27 di luar gate dan angka unit mengikuti `main` |
| Checkout utama | Tidak disentuh. Hanya `.env.local` (git-ignored, tanpa `SUPABASE_SECRET_KEY`) yang disalin ke worktree gate |

## Environment

| Butir | Hasil |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm exec supabase migration list --local` | exit 0. 38 baris, setiap `local` = `remote`; terakhir `20261019090000` (`t26_import_rules_extraction`). Parity **38/38** |
| Supabase lokal | `supabase_db_WorkPulse` (postgres 17.11.0.003), dipakai bersama sesi lain. Tidak ada `db reset` |
| ClamAV | `workpulse-t10-clamav`, 127.0.0.1:13310, ClamAV 1.5.4 (signature 28158, 19 Oktober 2026), image `clamav/clamav:stable` (`sha256:0e31ce08…`) |
| Gotenberg DOCX | `workpulse-t15-gotenberg`, 127.0.0.1:13400, Gotenberg 8.37.0 (`gotenberg/gotenberg:8`, `sha256:f29984bd…`) |
| Renderer PDF | `workpulse-t21-pdf`, 127.0.0.1:13401, Gotenberg 8.37.0 (image yang sama) |
| Secret | `SUPABASE_SECRET_KEY` diisi dari `SERVICE_ROLE_KEY` (`supabase status -o env`) ke environment proses saja, lewat script di scratchpad. Tidak ditulis ke file, log, atau receipt. `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan |

## Baseline

| Command | Exit | Hasil | Harapan handoff |
| --- | ---: | --- | --- |
| `pnpm lint` | 0 | bersih (73 detik) | lulus |
| `pnpm typecheck` | 0 | bersih | lulus |
| `pnpm worker:check` | 0 | `ready`, 9 job terdaftar | lulus |
| `pnpm db:lint` | 0 | `results: []` | lulus |
| `pnpm test` | 0 | **128 file / 1180 test** | 121 / 1151 |
| `pnpm db:test` | **1** | 21 file / 1725 assertion; **3 gagal** di `cv_export.test.sql` (test 12, 41, 69) | 21 / 1725 lulus |
| `pnpm test:integration:release` | 0 | 2 file / **12** test | 12 |
| `pnpm test:integration:account-deletion` | 0 | 2 file / **15** test | 15 |
| `pnpm test:e2e:release` | **1** | tidak ada test yang jalan: `Playwright Test did not expect test.beforeAll() to be called here` di setiap spec, lalu `No tests found` | 15 |

### Penjelasan selisih

1. **Unit 128/1180.** Selisih tepat 7 file / 29 test, yaitu tujuh file story Storybook (`src/components/ui/*.stories.tsx`) yang masuk `main` lewat `834a4b0` setelah `181103f`. Tidak ada perubahan di `tests/` sejak `181103f`. Bukan regresi.
2. **`db:test` 3 gagal.** `pg_temp.n_exports()` di `cv_export.test.sql:271-273` menghitung **semua** baris `public.cv_exports`, bukan milik akun test. Database lokal bersama berisi 2 export sisa: satu milik akun `demo-…@example.test` (dibuat 20 Oktober 13:37, cocok dengan script akun demo lokal di `2b12c99`) dan satu milik akun `t25-…@workpulse.test` (20 Oktober 14:42, akun bocor dari run suite release). Yang terbaca hanya prefix email dan waktu; isi tidak dibaca. Ini pencemaran data lokal, bukan defect produk. Data milik pengguna tidak dihapus. Bukti `db:test` bersih diambil dari clean rebuild di Fase 5. Temuan **M5-N3 (P3)**: assertion pgTAP bergantung pada tabel global kosong.
3. **`test:e2e:release` tidak jalan.** Lihat temuan RV-PW di bawah.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV-PW | P2 | `834a4b0` (Storybook) menambah devDependency `"playwright": "latest"`, yang ter-resolve ke 1.64.0, sedangkan `@playwright/test` dipin 1.63.0. Bin `playwright` di `node_modules/.bin` kini berasal dari 1.64.0, jadi **setiap** script `pnpm test:e2e:*` memuat dua runner dan gagal sebelum test pertama. Akibatnya perintah acceptance E2E di `AGENTS.md` dan §7 handoff tidak bisa dijalankan dari `main`. Run gate T26 (20 Oktober) belum melihatnya karena commit Storybook masuk sesudahnya | Diperbaiki dengan TDD sebelum Fase 3, karena memblokir Fase 3 dan 5 (detail di [Fase 7](M5-gate-review.md#3-temuan)) |
| M5-N3 | P3 | `cv_export.test.sql` gagal bila database lokal sudah berisi export milik akun lain | Catat; terkait T25 O3 |

## Langkah berikutnya

Perbaiki RV-PW, lalu Fase 1–2 (read-only) dan Fase 3.

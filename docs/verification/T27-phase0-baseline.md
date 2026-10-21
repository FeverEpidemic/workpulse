# T27 Fase 0: baseline

- Tanggal: 20 Oktober 2026
- Eksekutor: Claude (Opus 5.5), single-agent.
- antislop: mode during (dipilih pengguna di awal sesi eksekusi; tidak ada preferensi global di `%APPDATA%\antislop\settings.json`).

## Git dan branch

- `git status` awal: hanya `.claude/launch.json` dan `.claude/setting.local.json` (untracked, sengaja lokal). Tidak ada path T27 yang kotor.
- Lima commit (Storybook, docs marketing/legal, plan T27) di `claude/cd-docker-images` belum ada di `origin/main` (`181103f`). Atas persetujuan pengguna, branch `claude/t27-mobile-tab-bar` dibuat dari HEAD `ef98935`, bukan dari `main`. PR T27 akan ikut membawa lima commit itu bila belum merge lebih dulu.
- Parity migration: 38 file di `supabase/migrations`, terakhir `20261019090000_t26_import_rules_extraction.sql` (sesuai harapan 38/38).

## Command dan hasil (HEAD `ef98935`)

| Command | Hasil |
| --- | --- |
| `pnpm lint --ignore-pattern ".claude/**"` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, **128 file / 1180 test** (T26 Fase 5 mencatat 121/1151; selisih dari Storybook dan commit setelahnya) |
| `test:e2e:ui` (`app-frame.spec.ts`) | **1 passed** (1,3 menit), lihat catatan lingkungan |
| `test:e2e:release` | **15 passed** (4,8 menit) |

## Catatan lingkungan

- Port 3000 dipakai `next dev` milik sesi lain di folder yang sama. `test:e2e:ui` dijalankan di worktree terpisah `D:\Project\wp-t27-base` (detached `ef98935`, `pnpm install --frozen-lockfile`) dengan salinan config sementara `playwright.t27-ui.config.ts` (port 3027, `webServer.timeout` 300 s karena build pertama di worktree dingin melewati 60 s) dan `WORKPULSE_SITE_URL=http://127.0.0.1:3027`. Config itu tidak di-commit.
- Percobaan pertama gagal karena lingkungan, bukan kode: (1) `webServer` timeout 60 s; (2) `app-frame` memeriksa origin link konfirmasi terhadap `WORKPULSE_SITE_URL`; (3) `release-a11y` 360 px: `drainImportWorker().claimed` = 0 karena worker `workers/run.ts` (PID 84168) dari sesi lain terus mengklaim job import di database lokal bersama. Worker itu dihentikan atas persetujuan pengguna; setelah itu release 15/15.
- Playwright dijalankan lewat `node node_modules/@playwright/test/cli.js` (paket `playwright` di `package.json` bernilai `latest`, beda versi dari `@playwright/test` 1.63.0).

## Rujukan file:baris di plan

| Rujukan plan | Kondisi aktual |
| --- | --- |
| `workspace-navigation.tsx:28-41` | benar (`navigation` 28-35, `isCurrent` 37-41) |
| `activity-capture-form.tsx:267` (`onSaved`) | panggilan `onSaved` di baris 266; 267 adalah deps efek |
| `globals.css:397-426` (drawer) | 397-432 |
| `globals.css:1012-1107` | media 880 px 1012-1097; media 420 px 1099-1129 |
| `app-frame.spec.ts:259-278`, `:185-226`, `:299-304` | benar |
| `release-keyboard.spec.ts:193-202` | 193-205 |
| `AGENTS.md` dan `docs/AGENTS.md` baris 120 | benar ("mobile memakai drawer") |
| `Design.md` §4.3 | kalimat drawer ada di baris 186 kedua salinan |

## Blocker

Tidak ada.

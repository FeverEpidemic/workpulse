# T30 Fase 1: pondasi

- Tanggal: 22 Oktober 2026. Status: COMPLETE.
- Tujuan: token durasi dan easing yang sama untuk interaksi singkat, sesuai Design.md 28.3.
- File: `src/styles/tokens.css`, `src/app/globals.css`, `tests/unit/motion-tokens.test.ts`, checkbox plan, receipt ini.

| Command | Exit | Pass / fail |
| --- | --- | --- |
| `pnpm test -- tests/unit/motion-tokens.test.ts`, sebelum implementasi | 1 | 3 pass / 5 fail, token instant/slow dan easing belum ada |
| command sama, setelah implementasi | 0 | 8 pass / 0 fail |
| `pnpm test` | 0 | 136 file / 1270 test pass, 0 fail |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | 0 error, 0 warning lint |

Acceptance 1 terbukti: lima token baru dengan nilai kontrak, fast/normal tetap, parser CSS memeriksa seluruh deklarasi durasi interaksi dan mengecualikan hanya tiga nama animasi loading/insertion. Easing tombol, sidebar, tab, dan header memakai token. Tidak ada perubahan palet atau layout.

Warning baseline Storybook: tidak ada file MDX dan plugin mock mempunyai hook Vite yang diabaikan. Tidak ada assertion lama diubah. Tidak ada blocker atau selisih keputusan plan. Berikutnya Fase 2, test merah loading, status job, dan pending navigasi.

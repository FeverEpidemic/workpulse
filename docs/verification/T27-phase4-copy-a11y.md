# T27 Fase 4: copy dan aksesibilitas unit

- Tanggal: 20 Oktober 2026
- Eksekutor: Claude (Opus 5.5), branch `claude/t27-mobile-tab-bar`.

## Tujuan

Mengunci copy en/id baru, tanpa em dash, tanpa string literal di komponen baru, dan memastikan copy drawer lama hilang (acceptance 12). Memeriksa kontras token (acceptance 11).

## File berubah

- Baru: `tests/unit/mobile-navigation-i18n.test.ts`.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/mobile-navigation-i18n.test.ts` di branch | exit 0, 14/14 |
| test yang sama disalin ke worktree baseline `ef98935` | exit 1, 13 gagal / 1 lulus (key belum ada, copy drawer masih ada). Membuktikan test bisa gagal. |

Catatan urutan TDD: key copy sudah ditambahkan di Fase 1 sampai 3 karena komponen membutuhkannya untuk typecheck, jadi red untuk test ini dibuktikan di baseline, bukan sebelum implementasi di branch.

## Isi test

- Sepuluh key (`workspace.tabBar`, `moreMenu`, `openMoreMenu`, `closeMoreMenu`, `moreMenuDescription`, `profileTab`, `quickLog`, `quickLog.closeSheet`, `quickLog.openFullForm`, `quickLog.sheetDescription`) dengan teks en dan id persis.
- Tidak ada U+2014 di copy baru.
- Teks terlihat "More"/"Menu lainnya" termuat dalam nama aksesibel tombol (WCAG 2.5.3 label in name).
- `workspace.openMenu`, `workspace.closeMenu`, `workspace.mobileNavigationDescription`, `workspace-drawer`, `workspace-quick-log--compact` tidak dirujuk lagi di `src/`.
- Empat komponen baru tidak memuat label atau teks literal.

## Kontras

Tidak ada token baru. Pasangan yang dipakai bar, header, dan sheet sudah ada di `tests/unit/theme-contrast.test.ts` untuk light dan dark:

| Pemakaian T27 | Pasangan di test |
| --- | --- |
| label tab tidak aktif | `--color-text-secondary` / `--color-bg-surface` (4,5) |
| label tab aktif | `--color-text-primary` / `--color-bg-subtle` (4,5) |
| ikon tab aktif | `--color-action-primary` / `--color-bg-subtle` (3) |
| ikon + | `--color-action-primary-text` / `--color-action-primary` (4,5) |
| kotak + terhadap bar | `--color-action-primary` / `--color-bg-surface` (3) |
| tepi lingkaran inisial | `--color-border-control` / `--color-bg-surface` (3) |
| teks sheet | `--color-text-secondary` / `--color-bg-elevated` (4,5) |

`theme-contrast.test.ts` tidak diubah. Bukti axe di 360 px light/dark ada di Fase 5.

## Blocker

Tidak ada.

# T27 Fase 1: rute dan state murni

- Tanggal: 20 Oktober 2026
- Eksekutor: Claude (Opus 5.5), single-agent, branch `claude/t27-mobile-tab-bar`.
- antislop: mode during (dipilih pengguna di sesi eksekusi ini).

## Tujuan

Fungsi murni untuk pemetaan tab mobile, judul header, state scroll bar/header, dan inisial tab Profile (acceptance 2, 3, 4, 8 di tingkat unit).

## File berubah

- Baru: `src/components/layout/navigation-routes.ts` (`navigation`, `isCurrent` dipindah dari `workspace-navigation.tsx`; tambah `mobileTabs`, `mobileTabFor`, `mobileTabCurrent`, `mobileTitleKey`).
- Baru: `src/components/layout/use-scroll-chrome.ts` (`nextChrome`, `expandedChrome`, `headerShouldHide`, hook `useScrollChrome`).
- Baru: `src/components/ui/initials-avatar.tsx` (`initialsFrom`, `InitialsAvatar`).
- Ubah: `src/components/layout/workspace-navigation.tsx` (impor `navigation`/`isCurrent` dari modul baru; perilaku sama).
- Ubah: `src/i18n/messages.ts` (key `workspace.profileTab`, en "Profile" / id "Profil").
- Baru: `tests/unit/navigation-routes.test.ts`, `tests/unit/use-scroll-chrome.test.ts`, `tests/unit/initials-avatar.test.tsx`.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run` tiga file baru sebelum implementasi | exit 1, 3 suite gagal (`Cannot find package '@/components/layout/navigation-routes'` dst.): red terbukti |
| `vitest run` tiga file baru setelah implementasi | exit 0, 3 file / 48 test lulus |
| `pnpm typecheck` | exit 0 |
| `pnpm lint --ignore-pattern ".claude/**"` | exit 0 |
| `pnpm test` | exit 0, 131 file / 1228 test lulus (baseline 128 / 1180) |

## Acceptance yang terbukti (unit)

- 2: lima slot berurutan; Activity tidak aktif di `/activity/new`; route detail mengaktifkan tab induk; `/achievements`, `/timeline`, `/cv`, `/settings/profile` mengaktifkan Profile; `aria-current="page"` hanya untuk route persis, `"true"` untuk turunan.
- 3 dan 4 (logika): ambang `scrollY > 24` dan delta 8 px; gerak kecil dijumlahkan sampai lewat delta; kembali ke puncak selalu expanded; header tidak sembunyi bila fokus di dalam atau sheet terbuka.
- 8: inisial maks. dua huruf kapital, fallback satu huruf email, `aria-hidden`.
- Judul header §2.2.6 termasuk fallback logo (`null`).

## Penyimpangan dan catatan

- **Key baru `workspace.profileTab`.** §2.2.12 tidak menyebut label tab Profile. `profile.title` ("Profil dan pengaturan") terlalu panjang untuk slot 72 px di 360 px, jadi label tab memakai "Profile"/"Profil". Judul header di `/settings/profile` tetap `profile.title`.
- **Unit test hook.** Lingkungan Vitest di repo adalah `node` tanpa DOM (UI test memakai `renderToStaticMarkup`). Logika hook dipisah ke reducer murni `nextChrome` dan `headerShouldHide` yang diuji unit; listener scroll, rAF, dan reset saat `pathname` berubah dibuktikan di E2E Fase 5.
- Reset saat `pathname` berubah dilakukan saat render (pola "adjust state on prop change"), bukan efek, agar halaman baru tidak sempat tampil compact.

## Blocker

Tidak ada.

## Berikutnya

Fase 2: `MobileTabBar`, `MobileHeader`, CSS, `viewport`, hapus drawer.

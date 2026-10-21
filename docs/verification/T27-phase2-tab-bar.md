# T27 Fase 2: tab bar dan header

- Tanggal: 20 Oktober 2026
- Eksekutor: Claude (Opus 5.5), branch `claude/t27-mobile-tab-bar`.

## Tujuan

Mengganti hamburger + drawer di ≤ 880 px dengan `MobileHeader` (judul, tombol Menu lainnya di Profile) dan `MobileTabBar` lima slot. Acceptance 1, 2, 3, 4, 8, 9 di tingkat markup; perilaku di browser dibuktikan Fase 5.

## File berubah

- Baru: `src/components/layout/mobile-tab-bar.tsx`, `src/components/layout/mobile-header.tsx`, `src/components/layout/mobile-chrome.tsx`.
- Ubah: `src/components/layout/workspace-navigation.tsx` (hanya sidebar desktop; `MobileNavigation` dan drawer dihapus; `NavigationLinks` diekspor dengan prop `label`/`hrefs` untuk dipakai sheet Fase 3).
- Ubah: `src/components/layout/application-frame.tsx` (prop `email`; `MobileChrome` membungkus topbar + `main` sehingga urutan DOM: skip link, header, konten, bar).
- Ubah: `src/app/(workspace)/layout.tsx` (meneruskan `context.user.email`).
- Ubah: `src/components/layout/quick-log-link.tsx` (prop `compact` dihapus; markup desktop sama).
- Ubah: `src/app/layout.tsx` (ekspor `viewport` dengan `viewportFit: "cover"`).
- Ubah: `src/app/globals.css` (hapus `.workspace-drawer*`, header lama, `.workspace-quick-log--compact`; tambah `.workspace-tab-bar`, `.workspace-tab*`, `.initials-avatar`, header 52 px, padding bawah konten, toast di atas bar).
- Ubah: `src/i18n/messages.ts` (tambah `workspace.tabBar`, `workspace.moreMenu`, `workspace.openMoreMenu`, `workspace.closeMoreMenu`, `workspace.moreMenuDescription`; hapus `workspace.openMenu`, `workspace.closeMenu`, `workspace.mobileNavigationDescription`).
- Baru: `tests/unit/mobile-navigation-ui.test.tsx`.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/mobile-navigation-ui.test.tsx` sebelum implementasi | exit 1, `Cannot find package '@/components/layout/mobile-header'`: red terbukti |
| `vitest run` UI + rute setelah implementasi | exit 0, 2 file / 40 test |
| `pnpm typecheck` | exit 0 |
| `pnpm lint --ignore-pattern ".claude/**"` | exit 0 |
| `pnpm test` | exit 0, 132 file / 1238 test |

## Acceptance yang terbukti (unit)

- 1: `nav` "Main tabs" berisi tepat lima kontrol berurutan (empat link + satu `button` `aria-haspopup="dialog"`); label en/id.
- 2: kelas `is-current` + `aria-current` page/true; ikon aktif `stroke-width` 2.4 (bukan warna saja).
- 3: di `compact` kelima label tetap ada di DOM dengan `sr-only`; tap di luar kontrol memanggil `expand`, tap pada tab tidak.
- 4: judul `p` (bukan `h1`), fallback logo, `data-hidden` false saat sheet terbuka.
- 8: lingkaran inisial `aria-hidden`.
- Tombol Menu lainnya hanya di `/settings/profile`, berlabel visual "More"/"Menu lainnya" dan nama aksesibel "Open more menu".

## Keputusan desain (antislop, R-31)

- Design Read: app shell mobile untuk workspace karier privat, bahasa visual tenang sesuai Design.md, dial ENERGY 1 / RHYTHM 1 / MOTION 2.
- Bar dan header solid `--color-bg-surface`, garis 1 px, tanpa blur/bayangan: navigasi tenang dan kontras label tidak bergantung pada konten di bawahnya.
- Satu aksen: kotak + `--color-action-primary`, karena Quick log adalah satu aksi utama (Design.md §31). Tab lain netral.
- Label tombol + selalu `sr-only`: kotak 44 px sudah menjadi tanda visual, dan "Catatan cepat" tidak muat dalam slot 72 px di 360 px. Nama aksesibel tetap "Quick log"/"Catatan cepat".
- Tombol ≡ diberi teks terlihat ("More"), bukan hamburger polos (antislop-layoutmobile *The Bare Hamburger*).
- Motion: tinggi bar 64 → 52 px dan `translateY` header, `--motion-normal` (180 ms) `ease-out`; aturan global `prefers-reduced-motion` menurunkan durasi ke 0,01 ms.
- Ikon lucide dipertahankan: keluarga ikon yang sudah dipakai sidebar (AGENTS.md *satu keluarga ikon*), sehingga tujuan yang sama dikenali di kedua ukuran.

## Penyimpangan

- Key `workspace.moreMenuDescription` ditambah karena primitive `Dialog` mewajibkan `description`. Tidak ada di §2.2.12.
- Sampai Fase 3, tombol + bernavigasi ke `/activity/new` (bukan dead control); sheet menggantikannya di Fase 3.

## Blocker

Tidak ada.

## Berikutnya

Fase 3: composer sheet dan Menu lainnya.

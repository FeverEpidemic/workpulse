# Decision 0034: T27 bottom tab bar mobile

Date: 20 Oktober 2026 (final 21 Oktober 2026)

Status: Accepted. Desain disetujui pengguna di chat pada 20 Oktober 2026 (interview T27); gate review 20 Oktober 2026 PASS tanpa P0-P2 terbuka (independensi terbatas: reviewer sama dengan eksekutor); closeout 21 Oktober 2026. Task: T27 (permintaan terarah pengguna, tidak ada di `IMPLEMENTATION_PLAN.md` §5). [Rencana](../verification/T27-implementation-plan.md), [bukti](../verification/T27-mobile-tab-bar.md), [gate review](../verification/T27-gate-review.md). Tanpa migration (parity tetap 38).

## References

- **Design.md** §4.1 (navigasi primer kecil), §4.3 (navigasi mobile), §31 (use case mobile, target sentuh 44 px, keyboard aktif saat capture dibuka).
- **AGENTS.md** *UI dan aksesibilitas* (WCAG 2.2 AA, fokus, reduced motion, satu keluarga ikon).
- **Decision terkait:** T04 (app frame), T07 (Quick log dan draft sessionStorage), T25 (matriks aksesibilitas rilis).

## Context

Di ≤ 880 px workspace memakai header dengan hamburger yang membuka drawer berisi enam tujuan plus Profile, tema, dan keluar, ditambah link Quick log di header. Untuk tiga use case mobile utama (tambah aktivitas, lihat aktivitas terbaru, kelola proyek) setiap pindah bagian butuh dua tap dan satu dialog, dan tujuan utama tidak terlihat. Pengguna meminta "Navigation Bar untuk mobile seperti Instagram iOS".

## Decisions

1. **Bottom tab bar lima slot menggantikan drawer** di ≤ 880 px: Dashboard, Activity, Quick log (+), Projects, Profile. Ikon sama dengan sidebar. Desktop (> 880 px) tidak berubah. Ini mengganti Design.md §4.3 "drawer-based mobile navigation" dan aksi Add Activity mengambang.
2. **Quick log adalah satu-satunya aksen** (kotak 44 px `--color-action-primary`) dan sebuah `button` yang membuka bottom sheet composer, bukan link. Catatan langsung terfokus: dialog dibuka dan `focus()` dipanggil di dalam handler tap (`flushSync`), karena iOS Safari hanya membuka keyboard untuk fokus di dalam gesture pengguna. Alur Design.md §31 *Open → Add Activity → Type* tetap satu tap.
3. **Composer memakai ulang form aktivitas** lewat varian `sheet` (catatan + tanggal, simpan di tempat dengan toast). Draft sessionStorage `quick-log-note` dipakai bersama form penuh dan digabung (bukan ditimpa) agar proyek/detail di draft form penuh tidak hilang. Link "Detail lengkap" membuka `/activity/new` dengan teks yang sama. Composer tidak mendaftar ke penjaga unsaved-changes karena draftnya tersimpan per ketikan. Composer selalu menyimpan `capture_mode` `note`; mode chat/form tetap tersedia di form penuh.
4. **Label mengikuti scroll.** Label tampil di puncak, saat scroll ke atas ≥ 8 px, atau saat area bar diketuk; scroll ke bawah ≥ 8 px melewati 24 px menyusutkan bar menjadi ikon (64 → 52 px). Label tetap di DOM sebagai `sr-only`, sehingga nama aksesibel tidak berubah. Header ringkas 52 px ikut sembunyi, tetapi tidak saat fokus keyboard di dalamnya atau sheet terbuka.
5. **Tab aktif memakai latar sage seperti sidebar** plus bobot ikon/label. Achievements, Timeline, dan CV mengaktifkan tab Profile karena dicapai dari sheet **Menu lainnya** yang dibuka dari tombol berlabel di header Profile. Tema dan keluar ikut pindah ke sheet itu.
6. **Tab Profile memakai lingkaran inisial** dari nama tampilan (fallback huruf pertama email). Foto profil ditunda: skema belum punya kolom avatar dan storage-nya butuh migration (disetujui pengguna 20 Oktober 2026).
7. **Bar dan header solid tanpa blur.** Navigasi tetap tenang (Design.md) dan kontras label tidak bergantung pada konten di bawahnya. Konten mendapat ruang bawah setinggi bar + `env(safe-area-inset-bottom)`; root layout mengekspor `viewport-fit=cover`.

## Consequences

- Copy drawer (`workspace.openMenu`, `workspace.closeMenu`, `workspace.mobileNavigationDescription`) dan CSS `.workspace-drawer*` dihapus.
- Matriks E2E rilis mendapat `tests/e2e/mobile-tab-bar.spec.ts`; `app-frame` dan `release-keyboard` menguji bar dan sheet, bukan drawer.
- Risiko terbuka: keyboard iOS hanya dibuktikan lewat desain (fokus sinkron di handler tap) dan Chromium; belum diuji di WebKit atau perangkat nyata.

## Follow-up

- Foto profil dengan fallback inisial (migration kolom avatar + storage + upload).
- Uji composer di Safari iOS perangkat nyata.

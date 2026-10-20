# T27 gate review

- Tanggal: 20 Oktober 2026
- Reviewer: Claude (Opus 5.5). **Independensi terbatas:** reviewer adalah agen yang sama dengan eksekutor (pengguna meminta Claude mengeksekusi plan). Review dilakukan read-only atas kode dan receipt, dengan ulang check di worktree bersih.
- Commit yang direview: `971e618` (branch `claude/t27-mobile-tab-bar`).

## Ulang check di worktree bersih

Worktree terpisah `D:\Project\wp-t27-base`, detached di `971e618`, dependensi dari lockfile. Menangkap masalah CRLF yang tidak terlihat di checkout penulis (`core.autocrlf=true`, tanpa `.gitattributes`).

| Command | Hasil |
| --- | --- |
| `pnpm lint --ignore-pattern .claude/**` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, 134 file / 1261 test |
| `test:e2e:ui` | 1 passed |
| `test:e2e:release` | 21 passed |

`test:e2e:auth`, `activity`, `m2`, `dashboard`, dan `pnpm build` lulus di checkout penulis pada Fase 5 (receipt Fase 5); tidak diulang karena perubahan setelahnya hanya `key={pathname}` pada header.

## Checklist §9

- [x] Receipt Fase 0-5 ada dengan angka aktual.
- [x] Desktop 1440 px: sidebar, topbar, dan link Quick log tidak berubah (diff `workspace-navigation.tsx` hanya memindah `navigation`/`isCurrent` dan menghapus `MobileNavigation`; `QuickLogLink` desktop menghasilkan markup yang sama; snapshot aria terkunci 1440 px lulus; spec T27 test 5).
- [x] Lima slot, pemetaan aktif §2.2.4, `aria-current` page/true (unit + E2E).
- [x] Label selalu di nama aksesibel; `compact` memakai `sr-only`, bukan menghapus.
- [x] Header tidak sembunyi saat fokus di dalam atau sheet terbuka (unit `headerShouldHide`, CSS `:not(:focus-within)`, E2E).
- [x] Composer: fokus langsung, draft bersama, simpan tanpa redirect, form penuh tidak berubah (unit `form()` === `form("full")`; `app-frame` Quick log 185-226 dan `test:e2e:activity` lulus).
- [x] Tidak ada konten tertutup bar di 360 × 640; safe-area dipakai (`padding-bottom` + `env(safe-area-inset-bottom)`, `viewport-fit=cover`).
- [x] Copy en/id sesuai §2.2.12 (plus tiga key tambahan yang dicatat), tanpa em dash. Delivery Gate tercatat PASS tanpa FAIL.

## Temuan

| ID | Prioritas | Temuan | Status |
| --- | --- | --- | --- |
| G1 | P2 | Toast "Activity saved." muncul dua kali setelah simpan dari composer (`onCreated` + `ActionFeedback`). | Diperbaiki di Fase 5 (`b6dd326`), E2E memeriksa tepat satu toast. |
| G2 | P2 | Label tab aktif "Dashboard" terpotong di 360 px. | Diperbaiki di Fase 5, E2E memeriksa tidak ada label terpotong. |
| G3 | P2 | Setelah memilih link di Menu lainnya, fokus kembali ke tombol ≡ yang lalu hilang bersama route; di browser yang tidak mengirim `blur` saat elemen dihapus, `focusWithin` tetap `true` dan header di halaman tujuan tidak pernah sembunyi. | Diperbaiki (`971e618`, `MobileHeader` di-key per route), E2E memeriksa header Timeline sembunyi saat scroll. |
| G4 | P3 | Keyboard iOS Safari belum dibuktikan di WebKit atau perangkat nyata (WebKit tidak ada di config maupun terpasang). | Follow-up: uji di perangkat. |
| G5 | P3 | Fallback inisial dari email hanya dibuktikan unit; onboarding mewajibkan nama sehingga akun tanpa nama tidak bisa dibuat lewat produk. | Diterima. |
| G6 | P3 | `mobile-tab-bar.tsx` tidak bertanda `"use client"` tetapi memakai handler; aman karena hanya diimpor dari `MobileChrome` (client), dan unit test memanggilnya sebagai fungsi. | Diterima. |
| G7 | P3 | Composer selalu menyimpan `capture_mode` `note`; draft mode chat/form dari form penuh tetap dipulihkan lewat "Detail lengkap". | Diterima, dicatat di decision 0034. |

Tidak ada P0-P2 terbuka.

## Verdict

**PASS** untuk masuk Fase 6 (draft dokumen). Closeout 21 Oktober 2026: T27 ditandai DONE di `IMPLEMENTATION_STATUS.md` dan decision 0034 Accepted.

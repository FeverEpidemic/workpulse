# T27 Fase 3: composer dan Menu lainnya

- Tanggal: 20 Oktober 2026
- Eksekutor: Claude (Opus 5.5), branch `claude/t27-mobile-tab-bar`.

## Tujuan

Tombol + membuka bottom sheet composer dengan catatan langsung terfokus; tombol Menu lainnya di Profile membuka sheet berisi Achievements, Timeline, CV, tema, dan keluar (acceptance 5, 6, 7).

## File berubah

- Baru: `src/components/layout/mobile-sheets.tsx` (`QuickLogSheet`, `MoreMenuSheet`, keduanya di atas `Dialog`).
- Ubah: `src/components/layout/mobile-chrome.tsx` (state sheet, buka composer dengan `flushSync` lalu `focus()` di handler tap, fallback fokus via rAF, toast + `router.refresh()` setelah simpan, sheet ditutup saat `pathname` berubah, + di `/activity/new` memfokus form penuh yang sudah ada).
- Ubah: `src/features/activity/activity-capture-form.tsx` (prop `variant`, `onCreated`, `onOpenFullForm`; semua cabang baru dijaga `isSheet`).
- Ubah: `src/components/forms/session-draft.ts` (`mergeDraftValues` dan opsi `{ merge }` pada `useSessionDraft`, default `false`).
- Ubah: `src/components/layout/application-frame.tsx`, `src/app/(workspace)/layout.tsx` (prop `timezone`).
- Ubah: `src/app/globals.css` (`.workspace-sheet-dialog`, tombol tutup, footer sheet).
- Ubah: `src/i18n/messages.ts` (`quickLog.closeSheet`, `quickLog.openFullForm`, `quickLog.sheetDescription`).
- Baru: `tests/unit/mobile-sheets-ui.test.tsx`.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/mobile-sheets-ui.test.tsx` sebelum implementasi | exit 1, `Cannot find package '@/components/layout/mobile-sheets'`: red terbukti |
| `vitest run` sheets + UI + session-draft | 1 gagal karena urutan atribut `IconButton` di regex test (bukan perilaku); regex diperbaiki, lalu lulus |
| `pnpm typecheck` | exit 0 |
| `pnpm lint --ignore-pattern ".claude/**"` | exit 0 |
| `pnpm test` | exit 0, 133 file / 1247 test |
| `next build` | exit 0 |

## Pemeriksaan browser (build produksi, port 3037, 375 × 812, tema gelap, locale id, akun demo lokal)

- `/dashboard`: header "Dashboard", bar lima slot, tab Dashboard aktif.
- Scroll 500 px: `data-compact="true"`, header `data-hidden="true"`, bar hanya ikon (screenshot).
- Tap +: sheet terbuka, `document.activeElement.id === "quick-log-note"`, header kembali tampil (`data-hidden="false"`), tanggal default 20/10/2026.
- Esc: sheet tertutup, fokus kembali ke tombol +.
- `/settings/profile`: tombol "Buka menu lainnya" ada; sheet berisi Pencapaian, Linimasa, CV, tema, Keluar.
- Pilih Pencapaian: pindah ke `/achievements`, sheet tertutup, tab Profil `aria-current="true"`, judul "Pencapaian", overflow horizontal 0.
- 1440 × 900: bar dan header mobile `display: none`, sidebar `flex`, link Quick log topbar tetap. Console tanpa error.
- Simpan dari composer **tidak** dicoba di akun demo agar data promo tidak berubah; dibuktikan di E2E Fase 5 dengan akun test sendiri.

## Penyimpangan dan catatan

- **`onCreated`, bukan `onSaved`.** `onSaved` menerima `ActivityRow` hasil edit, sedangkan create mengembalikan receipt `{ activityId }`. Varian sheet memanggil `onCreated(activityId)` di efek sukses yang sama, tanpa `router.push`. Cabang full tetap redirect ke detail.
- **Composer tidak mendaftar ke penjaga unsaved-changes.** Draft tersimpan ke sessionStorage per ketikan dan menutup sheet adalah tindakan sengaja, sehingga dialog "Leave without saving?" tidak perlu muncul dan tidak menghalangi link "Detail lengkap". Form penuh tetap mendaftar seperti sebelumnya.
- **Draft digabung, bukan ditimpa.** Composer hanya punya catatan dan tanggal; tanpa merge, ketikan di sheet akan menghapus proyek/detail yang sudah ada di draft form penuh. Opsi `merge` hanya aktif untuk sheet; semua form lain memakai perilaku lama (`merge = false`).
- **`capture_mode` di sheet selalu `note`** (input hidden). Draft mode `chat`/`form` dari form penuh tetap tersimpan dan dipulihkan bila pengguna membuka "Detail lengkap".
- **Tombol + di `/activity/new`** memfokus textarea form penuh, karena composer kedua akan memakai id dan draft yang sama di halaman yang sama.
- **Deskripsi sheet** `quickLog.sheetDescription` ditambah karena `Dialog` mewajibkan deskripsi.
- Test unit SSR tidak bisa menjalankan efek; `onCreated` menutup sheet, toast, dan Esc mengembalikan fokus dibuktikan di E2E Fase 5.

## Blocker

Tidak ada.

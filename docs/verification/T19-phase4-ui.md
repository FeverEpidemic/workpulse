# T19 Fase 4 — UI S13 (30 September 2026)

- Tujuan: halaman `/cv` menjadi builder nyata (selection, move aksesibel, locale CV, override wording, summary/judul/contact, Save eksplisit, konflik, parent removal, preview dari data tersimpan) dan tautan *Add to CV*.
- File baru: `src/features/cv/{cv-builder,cv-section,cv-panels,cv-preview}.tsx`, `cv-view.ts`, `src/app/(workspace)/cv/loading.tsx`, `tests/unit/cv-builder-ui.test.tsx`. Diubah: `src/app/(workspace)/cv/page.tsx`, `src/features/achievement/achievement-detail.tsx`, `src/domain/cv/{draft,preview}.ts` (`syncDraft`, `resolveConflict`, `buildCvPreviewEntry`), `src/i18n/messages.ts` (kunci `cv.*` en + id; copy `achievement.confirmedNoCv` dan `achievement.cvEligible` tidak lagi menyebut "later task"), `src/app/globals.css` (kelas `cv-*`, reduced motion), `tests/unit/cv-draft.test.ts`.
- Perilaku: seleksi/hapus/reorder/layout langsung (RPC T18); teks lewat draft lokal + Save (`saveCvEditsAction`). `expected_revision` = max(revision dari props, revision dari receipt terakhir). Data terbaru digabung ke draft lewat `syncDraft` (field belum disentuh mengikuti server, edit lokal dipertahankan, field yang berubah di dua sisi menjadi `unresolved` dan memblokir Save sampai *Keep mine*/*Use saved*). Preview membaca hanya dokumen+item tersimpan; badge *Unsaved changes* tampil selama draft berbeda. Operasi memakai `aria-disabled`/guard `busyRef` (bukan `disabled`) agar fokus tidak hilang; fokus dikembalikan setelah reload ke tombol move yang sama (atau arah berlawanan di tepi), atau ke heading section setelah hapus. Live region terpusat untuk hasil aksi.
- Deviasi dari rencana: tes komponen memakai `renderToStaticMarkup` (proyek tidak punya jsdom/testing-library dan dependency baru dilarang); perilaku interaktif (fokus, klik Add/Move, konflik dua konteks, dialog parent removal) dibuktikan di E2E Fase 5. Logika interaktif yang murni diuji unit (`syncDraft`, `reconcileDraft`, `computeItemMove`).

| Command | Hasil |
| --- | --- |
| `pnpm test` | 86 file / 626 test PASS |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0, route `/cv` dinamis |

Acceptance yang tercakup unit/markup: 2 (Added/Add), 3, 4 (label/disabled), 10 (markup dialog), 11 (preview + badge), 12 (state empty/manual/deleted), 13 (tautan dan highlight). Sisanya di Fase 5. Berikutnya: Fase 5.

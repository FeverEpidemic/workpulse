# T20 Fase 4 — UI S13 dan S04 (receipt)

- Tanggal: 2 Oktober 2026
- Tujuan: badge/ringkasan/panel review di S13 dan dua check CV di dashboard S04, aturan state UI sebagai fungsi murni yang diuji unit.

## File berubah

- Baru: `src/features/cv/cv-review.tsx` (`CvReviewPanel`, `CvReviewToggle`, `CvStateBadge`, `CvReviewSummary`), `tests/unit/dashboard-view.test.tsx`.
- Diubah: `src/features/cv/{cv-builder,cv-section,cv-panels,cv-builder-state}.ts(x)`, `src/app/(workspace)/cv/page.tsx` (`getFreshness()` paralel, fail-closed), `src/features/dashboard/dashboard-view.tsx`, `src/app/globals.css` (`.cv-review-*`), `src/i18n/messages.ts` (+ `cv.aria.reviewChange`, `cv.aria.reviewHide`), `tests/unit/{cv-builder-state,cv-builder-ui}.test.ts(x)` (mock `actions` mendapat `resolveCvFreshnessAction`).

## Perilaku

- Badge teks per state: *Source changed*, *Saved wording kept*, *Source deleted*, *Source unconfirmed* (bersama *Manual wording* T19). Tombol *Review change* (`aria-expanded`, `aria-controls`, nama aksesibel memuat teks yang terlihat) membuka panel; panel tertutup secara default (progressive disclosure).
- Panel: tabel *Saved on CV* vs *Current source* hanya untuk field tampilan yang berbeda, catatan perubahan konteks (parent), wording manual, lalu aksi dari `availableActions`: tanpa override *Refresh from source* (primary) + *Keep saved wording*; dengan override *Keep my wording* (primary, action `refresh`) + *Replace from source*; kept hanya *Refresh from source*; deleted hanya penjelasan (Remove tetap di baris); unconfirmed menautkan `/achievements/<id>`.
- Ringkasan `id="cv-review"` (judul "N item(s) need review", tautan per item, *Refresh all items without manual wording* hanya bila ada kandidat; kandidat dengan draft wording belum disimpan dikeluarkan). Profil punya badge/panel yang sama. Pool achievement ber-`id="cv-pool-achievements"` dan terbuka saat tiba lewat hash dari dashboard.
- Aksi review nonaktif dengan keterangan *Save or discard your wording first.* selama draft T19 target itu dirty. `CV_SOURCE_CHANGED` memuat ulang lewat `router.refresh()` (draft lain tetap lewat `syncDraft`) dengan notice; hasil resolusi diumumkan lewat live region; fokus kembali ke tombol review, lalu ringkasan, lalu heading section/profil/pengaturan. Parent yang ditambahkan oleh refresh diumumkan dan ditampilkan sebagai catatan.
- Preview tetap dari data tersimpan (`buildCvPreviewModel` tidak menerima freshness); diuji (teks sumber baru tidak muncul di preview).
- Dashboard: dua check terpisah (*N CV item(s) need review* → `/cv#cv-review`; *N confirmed achievement(s) are not on your CV* → `/cv#cv-pool-achievements`), hanya bila > 0; pesan "No checks need attention." hanya bila semua check nol.

## Commands dan hasil aktual

| Command | Hasil |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0 — **89 file / 706 test** (sebelumnya 88 / 680) |
| `pnpm build` | exit 0 (`/cv`, `/dashboard` dinamis) |
| `grep console.` di `src/features/cv` dan `src/features/dashboard` | 0 hasil |

## Catatan

- Satu ESLint `react-hooks/set-state-in-effect` ditemukan pada efek hash dan diperbaiki dengan membuka elemen `<details>` secara langsung (event `toggle` menyinkronkan state).
- Verifikasi visual/keyboard/axe/responsive dilakukan di E2E (Fase 6).

## Langkah berikutnya

Fase 5 — integration nyata terhadap Supabase lokal.
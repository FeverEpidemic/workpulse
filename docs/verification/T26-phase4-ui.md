# T26 Fase 4: UI dan copy

Tanggal: 18-19 Oktober 2026. Pelaksana: Claude (Opus 5.5). antislop mode: during (dipilih pengguna di sesi desain).

## Tujuan

Dialog pilihan netral untuk pengguna tanpa consent, opsi `focusTitle` pada primitive `Dialog`, disclosure S02 bercabang, catatan dan copy `rules` di S02/S03, kode `IMPORT_RULES_FAILED`.

## File berubah

- Baru: `src/features/import/import-mode-dialog.tsx`, `tests/unit/import-mode-dialog.test.tsx`.
- `src/components/ui/dialog.tsx`: prop opsional `focusTitle` (default `false`): heading mendapat `tabIndex={-1}` dan difokuskan tepat setelah `showModal()`. Dialog lain tidak berubah (tanpa `tabindex`, alur fokus lama).
- `src/features/import/import-start.tsx`: pengguna tanpa consent membuka `ImportModeDialog` (bukan `AiConsentDialog`); `upload(mode?)`; helper murni `importUploadHeaders` (header `x-extraction-mode`) dan `chooseImportMode` (AI: simpan consent dulu, upload hanya bila berhasil; rules: upload langsung tanpa menyentuh consent); pilihan yang dibatalkan saat consent masih disimpan tidak meng-upload (`modeChoice` dikosongkan oleh Cancel/Esc); disclosure `import.disclosure` vs `import.disclosureNoConsent`; `import.rulesNote` di `review_ready` dan `import.emptyBodyRules` di `review_empty` hanya untuk `rules`; `IMPORT_RULES_FAILED` di `FAILURE_KEYS`.
- `src/features/import/import-review.tsx`: catatan `import.rulesNote` sebagai teks biasa di atas grup kandidat, dan `import.emptyBodyRules` pada review kosong, hanya untuk batch `rules`.
- `src/i18n/messages.ts`: 14 key baru en/id persis §2.2.12.
- `src/app/globals.css`: `.import-mode-dialog` (lebar 720 px), `.import-mode-options` (satu kolom, dua kolom mulai 600 px), `.import-mode-option` (border, radius, padding token yang ada; tombol di dasar kartu, tinggi minimum 44 px).
- `tests/unit/import-start-ui.test.tsx`, `tests/unit/import-review-ui.test.tsx`: test T26 ditambahkan; assertion lama tidak diubah.

## Interaksi dengan batas pemakaian AI (deviasi dari rencana, dicatat untuk gate)

Rencana ditulis sebelum basis usage limits (decision 0032). Di basis itu, S02 mengganti chooser dengan pesan batas bila kuota import AI habis. T26 menyesuaikan tanpa mengubah copy usage limits:

- Pengguna **tanpa consent** dengan kuota habis tetap melihat chooser, karena jalur `rules` tidak memakai unit AI. Di dialog, kartu AI menampilkan `AiLimitNotice` yang sudah ada dan tombol *Pakai AI* dinonaktifkan; kartu tanpa AI tetap aktif. Simetri kartu sedikit berubah hanya pada keadaan ini, demi kejujuran.
- Pengguna **dengan consent** dan kuota habis: perilaku usage limits tidak berubah.
- Retry batch `rules` yang gagal transien tetap menampilkan tombol Retry walau kuota AI habis (retry `rules` tidak di-charge, Fase 1).

## Keputusan desain (R-31, satu baris per keputusan)

- Design Read: layar aplikasi privat (dialog pilihan) untuk pencari kerja, bahasa visual sage tenang dari `Design.md`, dial ENERGY 1 / RHYTHM 1 / MOTION 1.
- Dua kartu identik (border, ukuran, varian tombol `secondary`): keseragaman di sini adalah syarat netralitas, bukan template.
- Tanpa ikon, badge, warna aksen, atau animasi: tidak ada yang boleh menarik ke satu pilihan.
- Tombol Cancel varian `ghost` di bawah kartu: aksi pembatal, bobotnya lebih ringan dari pilihan.
- Titik pecah 600 px: lebar di mana dua kartu masih memuat satu baris judul dan paragraf tanpa patah per kata (berbasis konten, `Design.md` §30).
- Catatan `rules` memakai `.import-note` yang sudah ada (border + latar peringatan + teks), jadi status tidak bergantung pada warna saja.

## Commands dan hasil

| Command | Hasil |
| --- | --- |
| 3 file test UI sebelum implementasi | gagal: modul `import-mode-dialog` belum ada, 5 assertion S02/S03 gagal |
| sama, setelah implementasi | **41/41 lulus** |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | **121 file / 1151 test lulus** |
| `git diff --stat src/components/ui/ai-consent-dialog.tsx` | kosong (dialog consent analisis tidak berubah) |

## Acceptance yang terbukti (unit)

- **10 (bagian unit):** judul dialog adalah elemen pertama sebelum tombol mana pun dan punya `tabindex="-1"` (target fokus awal); dua `section` berlabel (`aria-labelledby` ke heading masing-masing), urutan tetap Dengan AI lalu Tanpa AI; kedua tombol pilihan kelas `button-secondary`, tidak ada `button-primary` atau badge; Cancel `ui-button-ghost`; `chooseImportMode`: AI menyimpan consent lalu upload `ai`, gagal simpan → error di dialog tanpa upload, rules upload `rules` tanpa consent; header `x-extraction-mode`; pengguna yang sudah consent tidak melihat dialog; primitive `Dialog` hanya memberi `tabindex` bila `focusTitle`.
- **11:** disclosure bercabang en/id; catatan `rules` hanya untuk batch `rules` di S02 dan S03 (di atas grup kandidat); copy kosong `rules` hanya untuk `rules`; `IMPORT_RULES_FAILED` punya pesan sendiri tanpa Retry; 14 key ada di en dan id, tidak kosong, tanpa em dash.

Keterbatasan: lingkungan unit adalah Node tanpa DOM (tidak ada dependency DOM, dan dependency baru dilarang), jadi fokus nyata, Enter tanpa memilih, Esc, dan klik dibuktikan di E2E Fase 5.

## Catatan di luar scope

- `import-review.tsx` (ringkasan error S03, sejak T17) memakai em dash sebagai pemisah teks yang dirender. Tidak diubah di T26; dicatat sebagai follow-up P3.

## Blocker

Tidak ada.

## Berikutnya

Fase 5: E2E pengguna baru tanpa AI, axe, viewport 360/1440 light/dark, keyboard, lalu regresi §7.

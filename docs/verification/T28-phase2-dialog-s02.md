# T28 Fase 2: dialog dan S02

- Tanggal: 21 Oktober 2026
- Eksekutor: Claude (Opus 5.5), single-agent, tanpa sub-agent.
- antislop: mode during (session override). `antislop` core dan `antislop-copywriting` dibaca sebelum copy dan komponen ditulis. Delivery Gate dijalankan di Fase 4.
- Tujuan: dialog pilihan untuk semua pengguna, tampilan konfirmasi sebelum pencabutan consent, disclosure netral, kuota habis tidak menutup import, copy §2.2.8.

## File berubah

| File | Perubahan |
| --- | --- |
| `src/features/import/import-mode-dialog.tsx` | Props baru `step`, `granted`, `onBack`, `onConfirmRules`. `step="choose"`: dua kartu T26; bila `granted`, kartu Tanpa AI menampilkan `import.mode.rulesAiOff` (`field-help`) di bawah `rulesBody`. `step="confirm"`: `h3` `tabIndex={-1}` (`import.mode.confirmTitle`), `confirmBody`, error `role="alert"`, dua tombol `secondary` (Matikan AI dan baca CV, lalu Kembali), `import.mode.shared` disembunyikan. Efek fokus: saat tampilan berganti ke konfirmasi, judul konfirmasi difokus; saat kembali, tombol Baca tanpa AI difokus. Tombol Batal (ghost) tetap ada di kedua tampilan sebagai kontrol tutup dialog. Komentar komponen diperbarui. |
| `src/features/import/import-start.tsx` | State `modeStep`. `upload()` tanpa mode selalu membuka dialog di tampilan `choose`. `chooseMode("rules")` dengan consent hanya mengganti ke `confirm`; `runChoice` menjalankan `chooseImportMode`, dipanggil dari pilihan lain dan dari tombol lanjut konfirmasi. `backToChoice` dan `closeModeDialog` mereset `modeStep`. Cabang `showChooser && limited && granted` dihapus; `aiNotice` diteruskan untuk semua pengguna saat kuota habis. Disclosure memakai `import.disclosureChoice`. Setelah pencabutan berhasil, `setView(withConsentWithdrawn)`. Dialog dirender bersama chooser (`showChooser`), untuk semua pengguna. |
| `src/domain/import/import-view.ts` | `withConsentWithdrawn(view)`: batch `ai` `failed_retriable` tanpa alasan blokir lain mendapat `retryBlockReason: "consent"` dan `canRetry: false`, sama dengan `toImportView` ber-`consent: false`. Lainnya dikembalikan apa adanya. |
| `src/i18n/messages.ts` | Key baru en/id: `import.disclosureChoice`, `import.mode.rulesAiOff`, `import.mode.confirmTitle`, `import.mode.confirmBody`, `import.mode.confirmAction`, `import.mode.confirmBack`, persis teks §2.2.8. `import.disclosure` dan `import.disclosureNoConsent` dihapus (tidak dirujuk lagi di `src/`). |
| `src/app/globals.css` | `.import-mode-confirm` (grid, gap `--space-2`, margin atas `--space-5` seperti `.import-mode-options`), `.import-mode-confirm-actions` (flex wrap, gap `--space-2`), tombol min 44 px seperti tombol kartu. Hanya token yang ada. |
| `tests/unit/import-mode-dialog.test.tsx`, `tests/unit/import-start-ui.test.tsx`, `tests/unit/ai-usage-limits.test.tsx` | Test baru dan perubahan assertion disengaja (di bawah). |

### Keputusan kecil yang tidak tertulis di plan

1. **Dialog dirender bersama chooser, bukan tanpa syarat.** Render tanpa syarat membuat markup dialog (termasuk `import.mode.shared` "... tidak dikirim") ikut ada di tampilan status batch, sehingga test Gate M3 RV1 "tells the truth about a consent withdrawn ..." (`not.toContain("tidak dikirim")`) gagal. Tombol Upload hanya ada di chooser, jadi dialog cukup hidup di sana; assertion RV1 tidak diubah. Perilaku §2.2.1 (dialog untuk semua pengguna di setiap upload) tetap terpenuhi.
2. **Tombol Batal tetap di tampilan konfirmasi.** §2.2.4 menyebut "tombol tutup" memanggil `onCancel`; tombol ghost Batal di footer dialog adalah kontrol itu di kedua tampilan, posisinya sama.
3. **`withConsentWithdrawn` di domain.** Acceptance 10 meminta state Retry ikut berubah tanpa reload; fungsi murni ini menjaga aturan tetap di satu tempat dengan `toImportView` dan bisa diuji unit.

## TDD

1. Test ditulis dulu. `pnpm exec vitest run tests/unit/import-mode-dialog.test.tsx tests/unit/import-start-ui.test.tsx tests/unit/ai-usage-limits.test.tsx`: exit 1, **12 failed** (props dan key belum ada, dialog belum dirender untuk pengguna consent, cabang kuota lama, helper belum ada).
2. Implementasi pertama: exit 1, **1 failed | 45 passed (46)**: test RV1 di atas (keputusan kecil #1).
3. Setelah dialog dirender bersama chooser: tiga file lulus, lalu suite penuh lulus.

Test baru:

- `import-mode-dialog.test.tsx`, "T28 import mode dialog ...": kalimat `rulesAiOff` hanya saat `granted` dan letaknya di kartu Tanpa AI sebelum tombolnya; tampilan konfirmasi (`h3` `tabindex="-1"`, body, dua tombol `button-secondary` urutan Matikan lalu Kembali, tanpa `button-primary`, tanpa Use AI, tanpa `import.mode.shared`, judul dialog tetap); error konfirmasi `role="alert"` dan busy hanya di tombol lanjut; copy Indonesia konfirmasi dan `rulesAiOff`.
- `import-mode-dialog.test.tsx`, copy: semua key T26 dan T28 ada di en dan id tanpa em dash, teks `import.disclosureChoice` en/id persis; tidak ada file `src/**/*.ts(x)` yang merujuk `"import.disclosure"` atau `"import.disclosureNoConsent"`.
- `import-start-ui.test.tsx`, "T28 S02 after consent is withdrawn in the page": `withConsentWithdrawn` pada batch `ai` gagal transien sama dengan `toImportView({ consent: false })` (alasan `consent`, Retry nonaktif); batch `rules`, state lain, dan alasan `exhausted` tidak berubah.

## Assertion lama yang berubah dengan sengaja

| Test | Lama | Baru | Alasan |
| --- | --- | --- | --- |
| `import-start-ui.test.tsx` "keeps the AI disclosure and no mode dialog for a user who already consented" | disclosure AI saja, tanpa dialog, tanpa "fixed rules" | diganti "gives a user who already consented the same disclosure and the same choice on upload": dropzone, `disclosureChoice`, dialog, `rulesAiOff` (dan tanpa `rulesAiOff` bila tanpa consent) | §2.2.1, §2.2.8; acceptance 1, 11 |
| `import-start-ui.test.tsx` "keeps the upload open without consent even when the AI import limit is reached" | bagian `consented` mengharapkan tanpa *Upload and extract* | diganti "keeps the upload open at the AI import limit with or without consent, and disables only Use AI": kedua pengguna melihat dropzone, Upload, pemberitahuan batas, Use AI nonaktif, Read without AI aktif | §2.2.7; acceptance 9 |
| `import-start-ui.test.tsx` "explains both paths to a user without consent ..." | teks `import.disclosureNoConsent` | teks `import.disclosureChoice` (en dan id) | key diganti §2.2.8 |
| `ai-usage-limits.test.tsx` "replaces the drop area with the limit and makes manual entry the primary action" | tanpa *Upload and extract*, *Start manually* primary | diganti "keeps the drop area and shows the limit on the AI card ...": dropzone, Upload, teks batas dan jam reset, Use AI nonaktif, Read without AI aktif, *Start manually* bukan primary | §2.2.7; acceptance 9 |
| `import-mode-dialog.test.tsx` daftar `T26_KEYS` | memuat `import.disclosureNoConsent` | key itu dikeluarkan; key T28 di daftar sendiri | key dihapus §2.2.8 |
| `import-mode-dialog.test.tsx` helper `render` | props T26 | ditambah `step="choose"`, `granted={false}`, `onBack`, `onConfirmRules` | props baru §3.2; test T26 lain tidak berubah |

Tidak berubah: `ai-usage-limits.test.tsx` "hides Retry on a retriable failure while limited" dan semua assertion lain T15/T26.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm test` | exit 0, **134 file / 1270 test** (Fase 1: 1263; +4 test dialog T28, +1 test key dihapus, +2 test `withConsentWithdrawn`; dua test S02 diganti satu-satu) |
| `pnpm typecheck` | exit 0 |
| `pnpm exec eslint . --max-warnings 0 --ignore-pattern ".claude/**"` | exit 0 |

## Acceptance yang terbukti (unit)

- 1 (markup): S02 pengguna consent merender dialog pilihan dan dropzone.
- 3 (sebagian): Baca tanpa AI dengan consent hanya mengganti ke konfirmasi di parent; isi konfirmasi teruji markup. Bukti klik ada di Fase 3.
- 9: dropzone dan Upload tetap untuk pengguna consent saat kuota habis; Use AI nonaktif dengan pemberitahuan, Read without AI aktif; tampilan hanya *Start manually* dihapus.
- 10: `withConsentWithdrawn` memberi alasan `consent` dan menonaktifkan Retry batch `ai`, sama seperti reload.
- 11: copy §2.2.8 en/id tanpa em dash; `rulesAiOff` hanya saat consent aktif; key lama tidak dirujuk.
- 12 (markup): heading konfirmasi `tabindex="-1"`, varian tombol sama, error `role="alert"`. Fokus nyata dan axe di Fase 3.

## Catatan dan risiko

- Esc saat pencabutan sedang berjalan menutup dialog dan membatalkan upload (`modeChoice` dikosongkan), tetapi request pencabutan yang sudah terkirim tetap selesai; `granted` di state menjadi `false`. Ini sama dengan perilaku T26 untuk `saveConsent` dan konsisten dengan §2.2.5 (pencabutan tidak ditarik kembali).
- Fase ini belum dijalankan di browser; perilaku fokus, klik, axe, dan layout 360/1440 dibuktikan di Fase 3.

## Blocker

Tidak ada. Stop condition §8 tidak terpicu.

## Langkah berikutnya

Fase 3: skenario E2E (a) sampai (e), axe dialog di kedua tampilan, pembaruan langkah upload pengguna consent di spec lain.

# T30 Fase 3: tombol

- Tanggal: 22 Oktober 2026. Status: COMPLETE untuk implementasi dan unit; ukuran dan input native masih Fase 5.
- Tujuan: klik diterima lewat efek tekan dan spinner, label tetap, tombol sibuk tidak tampak mati.
- File: Button, SubmitButton bersama, button.stories, panel AI, profile/ai-consent-card, globals.css, button-pending.test.tsx, dua assertion label pending, plan dan receipt ini.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm test -- tests/unit/button-pending.test.tsx`, sebelum implementasi | 1 | 1 pass / 3 fail |
| command sama, setelah implementasi | 0 | 4 pass / 0 fail |
| unit Button, import-mode-dialog, AI panel, import-start dan story Button | 1 | 62 pass / 1 fail; check CSS pressed memakai event sintetis tidak memicu pseudo-class browser |
| `pnpm test` | 0 | 144 file / 1321 test pass, 0 fail |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | 0 error / warning lint |
| `rg -n useFormStatus src` | 0 | hanya ActionFeedback, ConflictControls, SubmitButton bersama |
| `git diff --check` | 0 | tanpa whitespace error |

Acceptance 3 dan 5 terbukti pada unit: spinner dengan/tanpa loadingLabel, label asli, sr-only pending label, disabled dan aria-busy. Semua pembaca form status untuk tombol sudah ke SubmitButton bersama. Dua pembaca lain bukan sumber state tombol: ActionFeedback menyembunyikan hasil lama, ConflictControls menyembunyikan konflik lama. Guard keduanya tetap.

Tombol memakai padding yang sama saat idle dan pending serta spinner absolut di ruang padding. Selector busy mengalahkan opacity disabled. Scale 0.97 dan transform token instant dipasang pada kelima variant, termasuk icon button. Lebar aktual, anti submit ganda, opacity dan native :active masih perlu E2E Fase 5.

## Perubahan assertion yang diizinkan

- `tests/unit/import-mode-dialog.test.tsx`: sebelumnya isi tombol pending hanya Saving. Kini tetap Use AI dengan sr-only Saving, plus assertion spinner. Disabled tombol lain tetap diuji.
- `tests/e2e/activity-ui.spec.ts`: sebelumnya hanya Saving. Kini Save activity dan Saving tetap ada, ditambah aria-busy dan spinner terlihat; assertion disabled lama tetap.
- Story Loading: nama aksesibel kini memuat label asli serta sr-only pending label. Ditambah LoadingWithoutLabel dan story Pressed untuk menahan pointer native.

Tidak ada assertion lama di luar label pending yang diubah. Check CSS pada story Pressed yang baru ditulis sempat gagal karena Testing Library userEvent mengirim event sintetis dan tidak mengaktifkan :active browser. Check itu dipindahkan ke acceptance native mouse.down di Fase 5; story tetap menyediakan kontrol untuk interaksi pointer asli. Tidak ada klaim bahwa synthetic pointer membuktikan CSS pressed.

SubmitButton kini meneruskan props Button termasuk ref React 19, variant, name dan value. API pendingLabel yang ada tetap didukung, loadingLabel diterima untuk caller panel AI yang sebelumnya memakai adapter lokal. Tidak mengubah action, payload, alur form, dependency atau migration. Tidak ada blocker. Berikutnya Fase 4, toast lifecycle, transisi dan highlight.

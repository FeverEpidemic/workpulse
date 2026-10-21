# T28 remediasi follow-up gate review: receipt

- Tanggal: 21 Oktober 2026
- Plan: `docs/verification/T28-review-remediation-plan.md` (RV1-RV4, dari temuan P3 G1-G4 di `T28-gate-review.md`).
- Eksekutor: Claude (Opus 5.5), single-agent, worktree `claude/t28-gate-review-5493dd`. Branch ini berbasis ujung `claude/t28-import-mode-choice` (`de511be`), jadi branch T28 bisa di-fast-forward ke sini.
- antislop: mode **during** (dipilih pengguna di sesi ini). Skill dibaca: `antislop` (core: Part 2, Part 3, Delivery Gate) dan `antislop-human`.
- Commit: `1e6ca91` (RV1), `55b7506` (RV2), `cd9a227` (RV3), `9210094` (RV4), lalu receipt ini.

## RV1: dialog pilihan terkunci selama pilihan diproses (G1)

| File | Perubahan |
| --- | --- |
| `src/components/ui/dialog.tsx` | Prop opsional `dismissible` (default `true`). Bila `false`: `onCancel` memanggil `preventDefault()` (Esc tidak menutup) dan klik backdrop tidak memanggil `close()`. 13 pemakai lain tidak berubah. |
| `src/features/import/import-mode-dialog.tsx` | `dismissible={!busy}`; tombol *Cancel* `disabled={busy}`; komentar komponen diperbarui. Komentar prop `pending` ("every button is disabled meanwhile") kini benar. |
| `tests/unit/import-mode-dialog.test.tsx` | "disables Cancel while a choice is being saved or uploaded, in both views". |
| `tests/e2e/import-onboarding.spec.ts` | "T28 the choice cannot be closed while AI is being turned off": server action ditahan dengan `page.route` (POST ber-header `next-action`), lalu Esc dan klik backdrop; setelah dilepas: *Waiting to start*, consent `null`, satu batch `rules`. |

Bukti gagal lalu lulus:

| Langkah | Command | Hasil |
| --- | --- | --- |
| Unit, sebelum perbaikan | `pnpm exec vitest run tests/unit/import-mode-dialog.test.tsx` | exit 1, 1 gagal / 14 lulus (`Cancel` tanpa `disabled`) |
| E2E, sebelum perbaikan | `--grep "cannot be closed"` | exit 1, gagal di `toBeDisabled()` |
| Unit dan E2E, sesudah | sama | exit 0; E2E 1 passed |
| Mutasi: `dismissible` dipaksa `true`, Cancel tetap nonaktif | `--grep "cannot be closed"` | exit 1, gagal di `toBeVisible()` setelah Escape (baris 674). Bagian Esc/backdrop test terbukti bermakna. Mutasi dikembalikan. |

Batasan yang diterima (plan RV1 butir 4): Chromium memaksa dialog tertutup pada Esc kedua tanpa aktivasi pengguna di antaranya (CloseWatcher). Pada kasus itu berlaku perilaku lama: tidak ada upload, `granted` tetap jujur. Tidak diuji E2E. Perlu dicatat di decision 0036 (Fase 5).

## RV2: Batal dan backdrop dari tampilan konfirmasi (G2)

- Test "T28 Read without AI asks first; …" mendapat satu loop setelah langkah Escape: dari tampilan konfirmasi, klik *Cancel*, lalu (putaran kedua) klik backdrop di `(5, 5)`. Setiap putaran: dialog tersembunyi, *Selected: rules.pdf* tetap, tidak ada batch, consent tetap `ai-processing-v1`, dan Upload berikutnya mulai dari dua kartu dengan fokus di judul.
- Lulus: exit 0, 1 passed.
- Mutasi 1, *Cancel* di tampilan konfirmasi memanggil `onConfirmRules`: exit 1, gagal di pengecekan consent (baris 588).
- Mutasi 2, klik backdrop tidak menutup: exit 1, gagal di `toBeHidden()` (baris 585).
- Kedua mutasi dikembalikan; `git status` bersih selain spec.

## RV3: dialog dengan teks 200% (G3)

- Test baru "T28 both dialog views with text at 200% at 320, 360 and 720 …": `html { font-size: 200% !important; }` (sama dengan `release-a11y` "text at 200%"), viewport 320×640, 360×800, dan 720×450. Ukuran terakhir sama dengan jendela 1440×900 pada zoom browser 200% dalam piksel CSS.
- Per tampilan (pilihan dan konfirmasi): panel dan halaman tanpa overflow horizontal, tidak ada tombol yang terpotong (`scrollWidth <= clientWidth`), setiap tombol bisa dicapai (`scrollIntoViewIfNeeded` lalu `toBeInViewport`), axe WCAG 2.2 AA bersih.
- Temuan saat menulis test: token font proyek memakai `px` (`src/styles/tokens.css:50-57`), jadi root font 200% hanya membesarkan teks `rem` (judul kartu, kelas Tailwind). Karena itu dipakai 720×450, agar test juga mewakili zoom browser yang membesarkan semuanya.
- Lulus tanpa perubahan CSS: exit 0, 1 passed.
- Mutasi `white-space: nowrap` pada tombol konfirmasi: test tetap lulus (label muat di 320 px).
- Mutasi `width: 60px; overflow: hidden` pada tombol konfirmasi: exit 1, gagal dengan pesan `t28-200-confirm-320 "Turn off AI and read CV" should not clip`. Pengecekan clipping terbukti bekerja.
- `globals.css` dikembalikan persis (tidak muncul di `git status`).

## RV4: dokumentasi stack lokal bersama (G4)

- `README.md` (setelah paragraf `db:reset`): stack dipakai bersama semua worktree; `db:start`/`db:stop` hanya dari checkout utama karena versi service di-pin di `supabase/.temp/`; gejala `42P10`; cara cek `storage-api:v1.80.2`; perbaikan tanpa `db:reset`.
- `AGENTS.md:141` dan `docs/AGENTS.md:141`: satu kalimat yang sama. Hash kedua file tetap identik.

## Checks §3 (HEAD `9210094`)

Env seperti receipt Fase 4: `.env.local`, `SUPABASE_SECRET_KEY` dari JWT `SERVICE_ROLE_KEY`, `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan. Storage `v1.80.2`, `workpulse-t10-clamav`, `workpulse-t15-gotenberg`, dan `workpulse-t21-pdf` hidup. Suite E2E lewat `node node_modules/@playwright/test/cli.js test --config …`.

| Command | Exit | Hasil | Harapan |
| --- | --- | --- | --- |
| `pnpm exec eslint . --max-warnings 0 --ignore-pattern ".claude/**"` | 0 | bersih | exit 0 |
| `pnpm typecheck` | 0 | bersih | exit 0 |
| `pnpm test` | 0 | **134 file / 1271 test** | 1270 + 1 (RV1) |
| `test:e2e:import` | 0 | **18 passed** (2,0 menit) | 16 + RV1 + RV3 |
| `test:e2e:import-review` | 0 | **10 passed** (1,3 menit) | 10 |
| `test:e2e:ai` | 0 | **2 passed** (38 detik) | 2 (`AiConsentDialog` memakai default `dismissible`) |
| `test:e2e:release` | 0 | **21 passed** (4,0 menit); PNG T25/T27 dikembalikan dengan `git checkout` | 21 |
| `git diff 88095dd HEAD -- supabase src/app/api workers src/server package.json pnpm-lock.yaml` | 0 | 0 baris | 0 baris |
| `git diff --check 88095dd HEAD` | 0 | bersih | - |

Stop conditions §5 plan remediasi: tidak ada yang terpicu.

## Delivery Gate antislop

Design Read: dialog aplikasi privat (pilihan baca CV dan konfirmasi mematikan AI) untuk pencari kerja, bahasa visual sage tenang dari `Design.md`, dial **ENERGY 1 / RHYTHM 1 / MOTION 1** (sama dengan T26/T28). Lingkup: perubahan RV1-RV3. Tidak ada perubahan visual, copy, atau CSS.

**Block 1, Hard Gate (semua "no"):**

- R-02: PASS. Tidak ada copy baru. Teks dokumentasi baru tanpa em dash.
- R-03: PASS. RV3: tanpa overflow di 320/360/720, teks 200%.
- R-17, R-18, R-23, R-24, R-28, R-36, R-38: PASS. Tidak ada angka, testimoni, aset, navigasi, FAQ, atau klaim baru.
- R-25: PASS. Axe (termasuk `color-contrast`) bersih di 6 kombinasi RV3 dan di matrix T28 yang tetap lulus. Tombol *Cancel* nonaktif memakai gaya `:disabled` yang sudah ada (opacity 0,58) dan atribut `disabled`. Kontrol nonaktif dikecualikan dari syarat kontras WCAG 1.4.3.
- R-26: PASS. Setiap kontrol tetap punya perilaku nyata. Dialog tetap bisa ditutup dengan Escape; hanya selama request berjalan Escape ditunda, dan dialog menutup sendiri saat request selesai.
- R-27: PASS. Loading: tombol yang dipilih `loading` + `aria-busy`, semua tombol nonaktif (unit). Error: pesan `role="alert"` di dialog, dan setelah error dialog kembali bisa ditutup.
- R-32: PASS. Keyboard: Esc ditolak selama busy (E2E RV1), Esc/Cancel/backdrop menutup saat tidak busy (E2E (b), RV2). Fokus tidak diubah.
- R-33: PASS. Semua perubahan di source.
- R-34: PASS. Tidak ada perubahan tema; matrix light/dark T28 dan `release` lulus.
- R-35: PASS. Build (webServer Playwright) dan 4 suite E2E dijalankan; klik-through di bawah.
- R-37: PASS. `Design.md` tetap acuan; tidak ada keputusan visual baru.

**Block 2, Purpose-Gate:** PASS untuk semua butir (R-01, R-04, R-06, R-07, R-08, R-09, R-10, R-12, R-13, R-14, R-19, R-22). Tidak ada teknik visual baru.

**Block 3, Liveliness:** YES untuk semua butir. Dial dideklarasikan di atas dan konsisten; fokus per tampilan tetap judul dialog atau judul konfirmasi; tidak ada perubahan spasi atau aksen.

**Block 4, Craftsmanship:**

- C-1: PASS. Alasan mengunci dialog: menutup di tengah request meninggalkan consent berubah tanpa upload.
- C-2, C-3, C-5: PASS.
- C-4: PASS. Busy, error, teks 200%, keyboard, dan tanpa mouse teruji.
- R-05, R-11, R-15, R-16, R-20, R-21, R-29, R-30: PASS (tidak berubah).
- R-31: PASS. Satu keputusan baru, dengan alasan satu baris di C-1.

**Human Skill Checklist:**

- Kontras: YES (axe).
- Non-text contrast: YES (tidak berubah).
- Fokus terlihat: YES.
- Keyboard dan Escape: YES, dengan penundaan Esc selama request.
- State tidak hanya warna: YES (`disabled`, `aria-busy`, teks error).
- Teks 200%: **YES, kini diuji** (RV3). Keyboard layar tidak relevan karena dialog tanpa input teks.

### Klik-through per elemen (R-35)

| Elemen | Aksi | Hasil teramati | Bukti |
| --- | --- | --- | --- |
| *Turn off AI and read CV* | klik, request ditahan | *Cancel* nonaktif, dialog tetap terbuka | E2E RV1 |
| Escape selama request | tekan sekali | dialog tetap terbuka | E2E RV1 |
| Backdrop selama request | klik `(5, 5)` | dialog tetap terbuka | E2E RV1 |
| Request dilepas | - | dialog tertutup, *Waiting to start*, consent `null`, batch `rules` | E2E RV1 |
| *Cancel* di tampilan konfirmasi | klik | dialog tertutup, file tetap, consent tetap, tidak ada batch | E2E RV2 |
| Backdrop di tampilan konfirmasi | klik | sama dengan *Cancel* | E2E RV2 |
| Semua tombol dialog, teks 200% | scroll lalu cek | terlihat di viewport, tidak terpotong | E2E RV3 |

Hasil gate: tidak ada FAIL. Satu batasan tercatat (Esc kedua di Chromium, RV1).

## Langkah berikutnya

- Fast-forward `claude/t28-import-mode-choice` ke branch ini, atau cherry-pick `1e6ca91..9210094` beserta receipt. Branch ini juga membawa `T28-gate-review.md` dan plan remediasi.
- Fase 5 plan T28: decision 0036 memuat aturan RV1 ("selama pilihan diproses, Batal, Esc, dan backdrop tidak menutup dialog") dan batasan Esc kedua di Chromium.

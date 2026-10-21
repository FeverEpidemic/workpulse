# T28 remediation plan: follow-up gate review (G1-G4)

> **Untuk agen pelaksana:** kerjakan item RV secara berurutan. Gunakan TDD: tulis test regresi, jalankan dan lihat gagal, buat perbaikan minimal, jalankan ulang sampai lulus, lalu commit per item. Jangan membuat sub-agent. Bila ragu, baca §5 (stop conditions).

- Tanggal: 21 Oktober 2026
- Sumber: `docs/verification/T28-gate-review.md` (verdict **PASS**, P0-P2: 0, P3: 4).
- Status: **follow-up, tidak memblokir.** T28 sudah lulus gate. Item ini dikerjakan di branch `claude/t28-import-mode-choice` **sebelum Fase 5**, karena RV1 mengubah perilaku dialog yang dicatat di decision 0036.
- Eksekutor: satu agent Claude. Reviewer: Claude, cek ringan (bukan gate penuh) setelah RV4.
- antislop: mode **during** dari plan T28 tetap berlaku untuk RV1-RV3 (UI dan aksesibilitas). Baca `.claude/skills/antislop/SKILL.md` dan `antislop-human` sebelum RV1.
- Batas scope: tidak ada migration, RPC, route, worker, dependency, atau copy baru. Perubahan hanya di `src/components/ui/dialog.tsx`, `src/features/import/import-mode-dialog.tsx`, test, dan dokumentasi.

## 1. Ringkasan

| RV | Dari | Level | Inti perbaikan | File |
| --- | --- | --- | --- | --- |
| RV1 | G1 | P3 | Dialog pilihan tidak bisa ditutup (Batal, Esc, backdrop) selama pilihan sedang diproses | `dialog.tsx`, `import-mode-dialog.tsx` |
| RV2 | G2 | P3 | E2E untuk Batal dan backdrop dari tampilan konfirmasi | `tests/e2e/import-onboarding.spec.ts` |
| RV3 | G3 | P3 | E2E dialog pada teks 200% (kedua tampilan) | `tests/e2e/import-onboarding.spec.ts`, CSS hanya bila test gagal |
| RV4 | G4 | P3 | Dokumentasi: stack Supabase lokal hanya di-start dari checkout utama | `README.md`, `AGENTS.md`, `docs/AGENTS.md` |

## 2. Item

### RV1: Kunci dialog selama pilihan diproses (G1)

**Gejala.** Setelah pengguna consent menekan *Turn off AI and read CV*, tombol Batal tetap aktif dan Esc/backdrop tetap menutup dialog. Bila ditutup sebelum action selesai, `closeModeDialog` mengosongkan `modeChoice` (`import-start.tsx:213-219`), pencabutan consent tetap selesai di server, dan upload dilewati (`import-start.tsx:257`). Hasilnya AI mati tetapi CV tidak di-upload, tanpa pesan apa pun. Hal yang sama berlaku untuk *Use AI* tanpa consent (consent tersimpan, tidak ada upload; perilaku T26).

**Penyebab.** Tombol Batal tidak memakai `busy` (`import-mode-dialog.tsx:122`), padahal komentar prop `pending` menyebut "every button is disabled meanwhile". Primitive `Dialog` selalu meneruskan Esc (event `cancel` native) dan klik backdrop ke `onOpenChange(false)` (`dialog.tsx:48-55`).

**Keputusan.** Begitu tombol pilihan akhir ditekan, pilihan berjalan sampai selesai. Dialog tidak bisa ditutup selama `pending !== null`. Alasan: pengguna sudah memutuskan (dan untuk Tanpa AI sudah mengonfirmasi); menutup di tengah jalan menghasilkan state setengah jadi. Alternatif yang ditolak: tetap bisa ditutup lalu menampilkan pesan "AI sudah dimatikan, CV belum di-upload" di S02 (butuh copy baru dan state baru untuk kasus langka).

**Perbaikan minimal.**

1. `src/components/ui/dialog.tsx`: prop opsional `dismissible?: boolean` (default `true`, sehingga 13 pemakai lain tidak berubah). Bila `false`:
   - `<dialog onCancel={(event) => event.preventDefault()}>` agar Esc tidak menutup;
   - handler `onClick` backdrop tidak memanggil `close()`.
2. `src/features/import/import-mode-dialog.tsx`: teruskan `dismissible={!busy}` ke `Dialog`; tombol Batal mendapat `disabled={busy}`.
3. Perbarui komentar komponen: "Escape, the backdrop and Cancel only call onCancel, and do nothing while a choice is being saved or uploaded."
4. `closeModeDialog` tidak diubah. Batasan yang diterima: Chromium memaksa dialog tertutup pada Esc kedua tanpa aktivasi pengguna di antaranya (CloseWatcher). Pada kasus itu perilaku lama berlaku (tidak ada upload, state `granted` tetap jujur). Catat batasan ini di decision 0036.

**Test regresi (gagal dulu, lalu lulus).**

- Unit `tests/unit/import-mode-dialog.test.tsx`: dengan `pending: "rules"` (tampilan konfirmasi) dan `pending: "ai"` (tampilan pilihan), tombol *Cancel* ber-atribut `disabled`. Dengan `pending: null`, tidak.
- Unit Dialog primitive (`renderToStaticMarkup`): `dismissible` tidak menambah atribut yang terlihat; test ini hanya menjaga default. Perilaku event diuji di E2E.
- E2E `import-onboarding.spec.ts`, test baru "T28 the choice cannot be closed while turning AI off": tahan server action dengan `page.route` (request `POST` ber-header `next-action` ditunda, mis. 1,5 detik, lalu `route.continue()`). Pengguna consent: Upload, *Read without AI*, *Turn off AI and read CV*, lalu segera tekan Escape satu kali. Harapan: dialog masih terlihat, *Cancel* nonaktif; setelah route dilepas, status *Waiting to start*, consent `null`, satu batch `rules`.
- E2E yang sama untuk klik backdrop (klik di koordinat di luar panel, mis. `page.mouse.click(5, 5)`) selama tertahan: dialog tetap terlihat.

**Decision.** Tambahkan ke draft `0036-t28-import-mode-choice.md` (Fase 5): "Selama pilihan diproses, Batal, Esc, dan backdrop tidak menutup dialog", termasuk batasan Esc kedua di Chromium. Ini mempersempit 0033 #2 ("Esc dan tombol tutup hanya membatalkan") hanya untuk rentang saat request berjalan.

### RV2: E2E Batal dan backdrop dari tampilan konfirmasi (G2)

**Gejala.** E2E (b) menguji Esc dan Kembali dari tampilan konfirmasi. Batal dan backdrop hanya dibuktikan lewat inspeksi kode (`dialog.tsx:53-55`, receipt Fase 4 tabel klik-through).

**Perbaikan.** Hanya test. Tambahkan dua langkah ke test "T28 Read without AI asks first; …" setelah langkah Escape (`import-onboarding.spec.ts:565-575`), dengan pola yang sama:

1. Upload, *Read without AI*, klik *Cancel* → dialog tersembunyi, *Selected: rules.pdf* masih terlihat, `batches` kosong, consent tetap `ai-processing-v1`.
2. Upload, *Read without AI*, klik backdrop (`page.mouse.click(5, 5)` pada viewport 1280 px, di luar panel 480 px) → hasil yang sama. Upload berikutnya mulai dari dua kartu dengan fokus di judul dialog.

**Test regresi.** Langkah di atas adalah test-nya. Untuk membuktikan test bermakna, jalankan sekali dengan `closeModeDialog` sementara memanggil `runChoice("rules")` (mutasi lokal, jangan di-commit) dan pastikan test gagal.

### RV3: Dialog pada teks 200% (G3)

**Gejala.** Receipt Fase 4 mencatat zoom 200% tidak diuji untuk dialog; `release-a11y` "text at 200%" (`release-a11y.spec.ts:222-234`) tidak mencakup S02 dengan dialog terbuka.

**Perbaikan.** Test baru di `import-onboarding.spec.ts`, pola sama dengan `release-a11y.spec.ts:234` (`html { font-size: 200% !important; }`):

- Lebar 320, 360, dan 720 px, tema light. Untuk setiap lebar: tampilan pilihan (pengguna consent, sehingga kalimat `rulesAiOff` ikut tampil) dan tampilan konfirmasi.
- Harapan per tampilan: panel dan halaman tidak scroll ke samping (`expectNoOverflow` yang ada); tidak ada tombol yang terpotong (`scrollWidth <= clientWidth` untuk setiap `button` di dialog); tombol terakhir (*Cancel*) dapat dicapai dengan scroll di dalam `.ui-dialog` (`max-height: min(85dvh, 720px); overflow: auto`, `globals.css:1326-1327`) dan `toBeInViewport()` setelah `scrollIntoViewIfNeeded()`; axe tanpa pelanggaran WCAG 2.2 AA.
- Bila test gagal karena layout, perbaikan CSS minimal di `globals.css` (`.import-mode-*`) memakai token yang ada; catat sebab dan perbaikan di receipt. Bila lulus tanpa perubahan, itu hasil yang sah.

### RV4: Dokumentasi stack lokal bersama (G4)

**Gejala.** Stack Supabase lokal dipakai bersama semua worktree. `supabase start` dari worktree tanpa `supabase/.temp/storage-version` (folder ini di-gitignore dan hanya ada di checkout utama, hasil `supabase link`) menjalankan storage `v1.72.1` di atas skema yang sudah dimigrasi `v1.80.2`. Akibatnya setiap upload object gagal `500` (`42P10`) untuk semua sesi. Ini terjadi saat gate review T28.

**Perbaikan.** Hanya dokumentasi, tanpa script baru:

- `README.md`, setelah blok `pnpm db:start` (sekitar baris 233): satu paragraf. Jalankan `pnpm db:start`/`db:stop` hanya dari checkout utama, karena versi service mengikuti `supabase/.temp/*-version`. Cara cek: `docker ps --format "{{.Names}} {{.Image}}"` harus menunjukkan `storage-api:v1.80.2`. Bila storage salah versi: `db:stop` lalu `db:start` dari checkout utama, tanpa `db:reset`.
- `AGENTS.md:141` dan `docs/AGENTS.md:141`: satu kalimat yang sama ("start/stop stack lokal hanya dari checkout utama; worktree tidak punya pin versi service"). Pastikan kedua file tetap identik.

**Verifikasi.** Review teks saja; tidak ada test.

## 3. Checks setelah semua RV

Env seperti receipt T28 Fase 4 (`.env.local`, `SUPABASE_SECRET_KEY` dari JWT `SERVICE_ROLE_KEY`, `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan, tiga container `workpulse-*` hidup, storage `v1.80.2`). Suite E2E lewat `node node_modules/@playwright/test/cli.js test --config …`.

| Command | Harapan |
| --- | --- |
| `pnpm exec eslint . --max-warnings 0 --ignore-pattern ".claude/**"` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, 134 file, 1270 + test baru RV1 |
| `test:e2e:import` | 16 + test baru RV1 dan RV3 (RV2 menambah langkah, bukan test) |
| `test:e2e:import-review` | 10 |
| `test:e2e:release` | 21 (Dialog primitive berubah; lalu `git checkout` PNG T25/T27) |
| `test:e2e:ai` | 2 (`AiConsentDialog` memakai primitive yang sama dengan default `dismissible`) |
| `git diff 88095dd HEAD -- supabase src/app/api workers src/server package.json pnpm-lock.yaml` | 0 baris |

## 4. Receipt

Satu file `docs/verification/T28-review-remediation.md`: per RV, file berubah, test gagal-lalu-lulus (command, exit code, angka), checks §3 dengan angka aktual, dan bagian antislop singkat untuk RV1/RV3 (R-26 kontrol, R-27 state, R-32 keyboard, R-03 mobile). Commit per RV, lalu receipt. Setelah itu lanjut Fase 5 plan T28 dengan tambahan RV1 di decision 0036.

## 5. Stop conditions

- `dismissible={false}` ternyata mengubah perilaku dialog lain (test `ai`, `release`, atau unit Dialog gagal).
- Esc pertama setelah klik tombol tetap menutup dialog di Chromium Playwright meski `cancel` di-`preventDefault()`. Laporkan; jangan mengganti dengan trik fokus atau `keydown` global.
- RV3 butuh perubahan di luar `.import-mode-*` atau token baru.
- Ada test lama yang hanya lulus dengan melemahkan assertion.

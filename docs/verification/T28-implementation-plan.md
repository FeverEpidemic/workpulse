# Handoff T28 Pilihan import Dengan AI / Tanpa AI di setiap import: eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 21 Oktober 2026
- Status plan: **siap dieksekusi**. Belum ada kode yang diubah.
- Dependensi: T26 **DONE** (dialog pilihan netral, batch `rules`), batas pemakaian AI (decision 0032) **DONE**, T27 **DONE** dan sudah di `main` (`f9fff79`).
- Asal task: penambahan scope oleh pengguna pada 21 Oktober 2026, setelah uji import di staging. T28 **tidak ada** di `IMPLEMENTATION_PLAN.md` §5. Konsep disetujui di chat per bagian: pilihan di setiap import, Tanpa AI mencabut consent AI global, langkah konfirmasi sebelum pencabutan.
- Eksekutor: satu agent **Claude**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 4; Fase 5 (draft dokumen) dikerjakan setelah gate.
- antislop: mode **during** dipilih pengguna untuk konsep ini. Pelaksana membaca `.claude/skills/antislop/SKILL.md`, `antislop-ui`, `antislop-copywriting`, dan `antislop-human` sebelum Fase 3, lalu menjalankan Delivery Gate antislop di receipt Fase 4.
- Acuan:
  - PRD R02, §3; User Flow F01 dan *Import exceptions*; Wireframe S02, S12 (consent AI).
  - `AGENTS.md` *Konteks proyek* (jalur manual tetap berfungsi tanpa AI) dan *Activity, achievement, dan AI* (consent diperiksa sebelum enqueue, sebelum mengirim teks, dan sebelum apply).
  - `docs/decisions/0019-t13-ai-jobs-consent.md`, `0021-t15-import-staging.md` #1, `0032-ai-usage-limits.md`, `0033-t26-import-rules-extraction.md` #2 dan #10.

**Goal:** Setiap kali pengguna menekan Upload di S02, dialog pilihan T26 muncul, baik akun sudah memberi consent AI atau belum. **Pakai AI** meng-upload dengan mode `ai` (dan menyimpan consent bila belum ada). **Baca tanpa AI** meng-upload dengan mode `rules`. Bila consent AI sedang aktif, Baca tanpa AI lebih dulu menampilkan konfirmasi di dialog yang sama; setelah dikonfirmasi, consent dicabut sehingga AI berhenti di seluruh aplikasi (import dan analisis aktivitas), lalu file di-upload dengan mode `rules`. Kuota AI yang habis hanya menonaktifkan kartu AI, tidak lagi menutup jalur import.

**Architecture:** Tidak ada migration, route API, atau RPC baru. Pencabutan memakai `setAiConsentAction` dengan `consent=withdraw` (`src/features/ai/actions.ts:48`) yang memanggil `public.set_ai_consent` (`supabase/migrations/20260928090000_t13_ai_jobs_consent.sql:247`). Upload `rules` memakai jalur T26 yang ada (`x-extraction-mode: rules`). Perubahan ada di client: `ImportModeDialog` mendapat langkah konfirmasi yang dikontrol parent, `chooseImportMode` mendapat langkah `withdrawConsent`, dan `ImportStart` merender dialog untuk semua pengguna serta menyimpan revisi profil terbaru dari hasil action consent.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Vitest (unit `node`, `renderToStaticMarkup`), Playwright + axe-core, pnpm dari lockfile. **Tidak ada dependency baru.**

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md`, decision 0033 (terutama #2 yang diubah task ini), `Design.md` (dialog, state, aksesibilitas), lalu `docs/verification/T26-implementation-plan.md` sebagai pola format dan sumber kontrak dialog. Bila perlu memastikan isi PRD/F01/S02/S12, ekstrak DOCX dengan alat ekstraksi; jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **AGENTS.md:** jalur manual harus tetap berfungsi tanpa AI. Consent diperiksa sebelum enqueue, sebelum mengirim teks, dan sebelum apply.
- **Decision 0033 #2:** pengguna yang sudah consent selalu memakai `ai`; dialog pilihan hanya untuk pengguna tanpa consent, dua kartu setara, fokus awal di judul. **T28 mengubah poin ini**: dialog muncul untuk semua pengguna. Aturan kesetaraan kartu dan fokus judul tetap berlaku.
- **Decision 0033 #10:** saat kuota import AI habis, kartu AI menampilkan pemberitahuan batas dan *Pakai AI* nonaktif; kartu tanpa AI tetap aktif. T28 memperluas aturan ini ke pengguna yang sudah consent.
- **Decision 0021 #1 dan T13:** job AI yang sedang berjalan saat consent dicabut gagal dengan `CONSENT_WITHDRAWN` pada titik completion dan hasilnya dibuang (`20260928090000_t13_ai_jobs_consent.sql:635-637`, `20261019090000_t26_import_rules_extraction.sql:525-526`). Pencabutan tidak membatalkan job secara langsung. Copy T28 harus jujur tentang perilaku ini.

Pertahankan perubahan lokal pengguna. Jangan menandai T28 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T28-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka yang ditulis harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T28

T28 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Dialog untuk semua pengguna.** Pengguna dengan consent yang memilih file lalu menekan Upload melihat dialog pilihan, bukan upload langsung. Pengguna tanpa consent tetap melihat dialog yang sama seperti T26. Dibuktikan unit (`chooseImportMode`, markup) dan E2E.
2. **Pakai AI tanpa langkah tambahan untuk pengguna consent.** Pengguna consent yang memilih Pakai AI langsung meng-upload mode `ai`; consent tidak disimpan ulang dan revisi profil tidak berubah. Pengguna tanpa consent tetap menyimpan consent lalu upload (perilaku T26). Dibuktikan unit dan E2E (cek `profiles.revision`).
3. **Konfirmasi sebelum pencabutan.** Pengguna consent yang menekan Baca tanpa AI melihat tampilan konfirmasi di dialog yang sama (§2.2.4). Belum ada consent yang dicabut dan belum ada yang di-upload sebelum tombol lanjut ditekan. Pengguna tanpa consent tidak melihat konfirmasi dan langsung upload `rules` (perilaku T26). Dibuktikan unit dan E2E.
4. **Konfirmasi mencabut consent lalu upload `rules`.** Tombol lanjut mencabut consent (`ai_consent_at` dan `ai_consent_version` menjadi `null`) lalu meng-upload batch dengan `extraction_mode = 'rules'`. Batch tidak membuat `ai_jobs` dan tidak men-charge unit `import`. Dibuktikan E2E (cek database) dan unit (urutan langkah).
5. **Batal dan kembali tidak mengubah apa pun.** Kembali membawa pengguna ke dua kartu; Esc, backdrop, dan tombol tutup menutup dialog. Pada ketiganya consent tetap aktif, tidak ada batch baru, dan file tetap terpilih. Dibuktikan E2E.
6. **Kegagalan pencabutan tidak meng-upload.** Bila `setAiConsentAction` withdraw gagal (mis. `CONFLICT`), error tampil di tampilan konfirmasi, consent tetap aktif, dan tidak ada upload. Dibuktikan unit (`chooseImportMode`).
7. **Revisi profil selalu terbaru.** Dalam satu sesi halaman, pengguna tanpa consent yang memilih Pakai AI, lalu Coba file lain, lalu Baca tanpa AI dan mengonfirmasi, berhasil mencabut consent tanpa `CONFLICT`. Dibuktikan E2E.
8. **AI berhenti di seluruh aplikasi.** Setelah konfirmasi, panel analisis aktivitas tidak dapat meminta analisis tanpa memberi izin lagi (menampilkan jalur *Izinkan AI* yang sudah ada) dan kartu consent S12 berstatus *Tidak diizinkan*. Dibuktikan E2E.
9. **Kuota habis tidak menutup import.** Pengguna consent dengan kuota import AI habis melihat dropzone dan tombol Upload; di dialog, kartu AI menampilkan pemberitahuan batas dengan Pakai AI nonaktif, kartu Tanpa AI tetap aktif dan mengikuti alur konfirmasi. Tampilan yang hanya berisi *Start manually* dihapus. Dibuktikan unit dan E2E.
10. **Retry batch AI setelah consent dicabut.** Batch `ai` yang gagal transien menampilkan alasan `import.retry.consent` dan tidak menawarkan Retry setelah consent dicabut (`src/domain/import/import-view.ts:108`, perilaku yang sudah ada); state client ikut diperbarui tanpa reload. Dibuktikan unit.
11. **Copy jujur dan simetris.** Disclosure S02 menjelaskan kedua jalur untuk semua pengguna; kalimat dampak di kartu Tanpa AI hanya tampil saat consent aktif; konfirmasi menyebut dampak ke analisis aktivitas, nasib analisis yang masih berjalan, data yang tidak berubah, dan cara menyalakan lagi. Semua key baru ada di en dan id, tanpa em dash. Dibuktikan unit.
12. **Aksesibilitas.** Saat tampilan konfirmasi terbuka, fokus pindah ke judul konfirmasi; Enter di judul tidak memilih apa pun; Kembali mengembalikan fokus ke tombol Baca tanpa AI; kedua tombol konfirmasi memakai varian yang sama; error konfirmasi diumumkan `role="alert"`. Axe tanpa pelanggaran WCAG 2.2 AA pada dialog (kedua tampilan) di 360 px dan 1440 px, light dan dark, tanpa overflow horizontal. Dibuktikan E2E.
13. **Tidak ada regresi.** Suite import, AI, M3, dan release tetap lulus. Assertion yang berubah hanya yang menguji perilaku lama "consent berarti upload langsung" dan "kuota habis berarti hanya Start manually", masing-masing dicatat sebagai perubahan disengaja. Dibuktikan suite regresi §7.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- `src/features/import/import-mode-dialog.tsx`: langkah konfirmasi dan kalimat dampak di kartu Tanpa AI.
- `src/features/import/import-start.tsx`: dialog untuk semua pengguna, `chooseImportMode` dengan langkah pencabutan, revisi profil di state, hapus cabang kuota-habis-hanya-manual, disclosure netral.
- `src/i18n/messages.ts`: key baru en/id (§2.2.8), hapus key yang tidak dipakai lagi.
- `src/app/globals.css` hanya bila tampilan konfirmasi butuh layout; pakai token yang ada.
- Test unit/E2E, receipt, draft decision 0036.

### 2.2 Keputusan implementasi

1. **Dialog selalu dirender.** `ImportStart` merender `ImportModeDialog` tanpa syarat `granted` (sekarang `{granted ? null : ...}`, `import-start.tsx:410`). `upload()` tanpa mode selalu membuka dialog (sekarang hanya bila `!granted`, `import-start.tsx:173-177`). Pilihan tidak diingat: dialog muncul di setiap upload.
2. **Langkah per pilihan** (fungsi murni `chooseImportMode`, sekarang `import-start.tsx:61-71`):
   - `ai` + tanpa consent: `saveConsent` lalu `upload("ai")` (perilaku T26).
   - `ai` + consent: langsung `upload("ai")`.
   - `rules` + tanpa consent: langsung `upload("rules")` (perilaku T26).
   - `rules` + consent: `withdrawConsent` lalu `upload("rules")`. Hanya dipanggil dari tombol lanjut di tampilan konfirmasi.
   - Bila `saveConsent` atau `withdrawConsent` mengembalikan error, fungsi mengembalikan pesan itu dan tidak memanggil `upload`.
   - Signature menjadi `chooseImportMode(mode, granted, steps)` dengan `steps: { saveConsent, withdrawConsent, upload }`.
3. **Langkah dialog dikontrol parent.** `ImportModeDialog` mendapat prop `step: "choose" | "confirm"`, `granted: boolean`, `onBack: () => void`, dan `onConfirmRules: () => void`. Di `step="choose"`, Baca tanpa AI memanggil `onChoose("rules")`; parent memutuskan: tanpa consent langsung jalan, dengan consent mengganti `step` ke `"confirm"`. Dengan prop terkontrol, kedua tampilan dapat diuji dengan `renderToStaticMarkup` (unit Vitest berjalan di env `node` tanpa DOM).
4. **Tampilan konfirmasi.** Isi dialog berganti, bukan modal kedua; pola sama dengan konfirmasi pencabutan di kartu consent S12 (`src/features/profile/ai-consent-card.tsx:107-117`).
   - Heading konfirmasi (`h3` di dalam dialog) mendapat `tabIndex={-1}` dan fokus saat tampilan muncul. Fokus tidak ditaruh di tombol mana pun, agar Enter tidak memilih dan pengguna tidak didorong (prinsip 0033 #2).
   - Isi: `import.mode.confirmBody`.
   - Dua tombol `secondary` setara, urutan: **Matikan AI dan baca CV**, lalu **Kembali**.
   - Kembali: `step` kembali ke `"choose"`, fokus ke tombol Baca tanpa AI.
   - Esc, backdrop, tombol tutup: `onCancel` seperti sekarang, dan `step` di-reset ke `"choose"` agar dialog berikutnya mulai dari dua kartu.
   - Saat proses berjalan, kedua tombol nonaktif dan tombol lanjut menampilkan `loading`.
   - Error pencabutan tampil di tampilan konfirmasi (`role="alert"`), `step` tetap `"confirm"`.
   - Judul dialog dan deskripsi bersama (`import.mode.title`, `import.mode.description`) tetap; judul konfirmasi menjadi heading di dalam isi dialog.
5. **Urutan dan atomisitas.** Pencabutan dan upload adalah dua request. Bila pencabutan berhasil tetapi upload gagal, consent tetap tercabut (pengguna sudah mengonfirmasi), dialog ditutup, dan error upload tampil di S02 seperti sekarang (`import-start.tsx:188-197`). `granted` di state menjadi `false` segera setelah pencabutan berhasil.
6. **Revisi profil di state.** `ImportStart` menyimpan `profileRevision` di state (awal dari `consent.profileRevision`) dan memperbaruinya dari hasil action consent (`setAiConsentAction` mengembalikan state berisi `revision` dari `public.set_ai_consent`, `src/features/ai/consent-service.ts:54`). Tanpa ini, langkah allow lalu withdraw di satu sesi halaman gagal `CONFLICT` (acceptance 7). Bila hasil action tidak membawa revisi yang bisa dibaca, berhenti dan laporkan (§8).
7. **Kuota habis.** Cabang `showChooser && limited && granted` (`import-start.tsx:269-274`) dihapus; chooser normal selalu tampil. `aiNotice` diteruskan ke dialog bila `limited`, untuk semua pengguna (sekarang hanya pengguna tanpa consent). Retry batch `ai` saat kuota habis tetap mengikuti `aiBlocksRetry` (`import-start.tsx:256`), tidak berubah.
8. **Copy.** Semua teks baru lewat `src/i18n/messages.ts` (en dan id), tanpa string literal di komponen dan tanpa em dash. Teks yang disetujui:
   - `import.disclosureChoice` (ganti `import.disclosure` dan `import.disclosureNoConsent` di S02 untuk semua pengguna): en "With AI, your CV text is sent to an external AI provider. Without AI, WorkPulse reads it itself using fixed rules. The file, its name and your other records are never sent." / id "Dengan AI, teks CV dikirim ke penyedia AI eksternal. Tanpa AI, WorkPulse membacanya sendiri dengan aturan tetap. File, nama file, dan data Anda yang lain tidak pernah dikirim."
   - `import.mode.rulesAiOff` (kalimat di kartu Tanpa AI, hanya saat consent aktif): en "This also turns off AI for activity analysis. You can turn it back on in Settings." / id "Pilihan ini juga mematikan AI untuk analisis aktivitas. Anda bisa menyalakannya lagi di Pengaturan."
   - `import.mode.confirmTitle`: en "Turn off AI for your account?" / id "Matikan AI untuk akun Anda?"
   - `import.mode.confirmBody`: en "Your CV will be read without AI, and AI stops for activity analysis too. If an AI analysis is still running, its result is discarded. Your notes, drafts and achievements stay as they are. You can turn AI back on in Settings." / id "CV Anda dibaca tanpa AI, dan AI juga berhenti untuk analisis aktivitas. Kalau ada analisis AI yang masih berjalan, hasilnya dibuang. Catatan, draf, dan pencapaian Anda tetap seperti semula. Anda bisa menyalakan AI lagi di Pengaturan."
   - `import.mode.confirmAction`: en "Turn off AI and read CV" / id "Matikan AI dan baca CV".
   - `import.mode.confirmBack`: en "Back" / id "Kembali".
   - Key `import.disclosure` dan `import.disclosureNoConsent` dihapus bila tidak dipakai lagi di `src/`. Key lain dari T26 tidak berubah.
9. **Hal yang tidak berubah.** `AiConsentDialog`, kartu consent S12, panel analisis aktivitas, route `/api/imports`, RPC, worker, dan migration. Parity migration tetap **38/38**.
10. **Nomor.** Decision baru `docs/decisions/0036-t28-import-mode-choice.md` (0035 dipakai T27). Tidak ada script npm baru.

### 2.3 Di luar scope

- Mengingat pilihan terakhir atau melewati dialog untuk pengguna yang sering import.
- Pilihan mode di Retry (batch tetap memakai mode saat upload, 0033 #1).
- Fallback otomatis ke `rules` saat AI gagal atau tidak tersedia.
- Perubahan pesan `import.failed.AI` atau pengembalian unit untuk kegagalan `AI_UNAVAILABLE`/`AI_CONFIG_INVALID` (follow-up terpisah).
- Perubahan kartu consent S12, `AiConsentDialog`, atau panel analisis aktivitas.
- Deploy ke staging (ikut alur T25 setelah T28 DONE).

## 3. Kontrak teknis

### 3.1 Domain dan server

Tidak ada perubahan. Rujukan yang dipakai apa adanya: `setAiConsentAction` (`src/features/ai/actions.ts:48-77`), `toImportView` alasan `consent` (`src/domain/import/import-view.ts:104-109`), header `x-extraction-mode` (`importUploadHeaders`, `import-start.tsx:53-55`).

### 3.2 UI

- `src/features/import/import-mode-dialog.tsx`:
  - Props baru: `step`, `granted`, `onBack`, `onConfirmRules` (§2.2.3).
  - `step="choose"`: dua kartu T26 tanpa perubahan susunan; bila `granted`, kartu Tanpa AI menampilkan `import.mode.rulesAiOff` sebagai `field-help` di bawah `rulesBody`.
  - `step="confirm"`: heading, body, dua tombol (§2.2.4); kalimat bersama `import.mode.shared` disembunyikan agar fokus pada dampak.
  - Komentar komponen diperbarui (sekarang menyebut "a user without AI consent", `import-mode-dialog.tsx:11-15`).
- `src/features/import/import-start.tsx`:
  - `chooseImportMode` (§2.2.2) tetap diekspor untuk unit test.
  - State baru: `modeStep`, `profileRevision`.
  - `upload()`: tanpa mode selalu membuka dialog.
  - `chooseMode("rules")` dengan `granted`: set `modeStep="confirm"`; tombol lanjut menjalankan `chooseImportMode("rules", true, ...)`.
  - `closeModeDialog` mereset `modeStep`.
  - Disclosure memakai `import.disclosureChoice`.
  - Cabang kuota (§2.2.7) dan render dialog (§2.2.1).

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Modify | `src/features/import/import-mode-dialog.tsx`, `src/features/import/import-start.tsx`, `src/i18n/messages.ts` |
| Modify (bila perlu) | `src/app/globals.css` |
| Modify | `tests/unit/import-start-ui.test.tsx`, `tests/unit/import-mode-dialog.test.tsx`, `tests/unit/ai-usage-limits.test.tsx` |
| Modify | `tests/e2e/import-onboarding.spec.ts`, `tests/e2e/m3-assisted-journey.spec.ts`, `tests/e2e/import-review.spec.ts`, `tests/e2e/release-a11y.spec.ts` (hanya langkah upload pengguna consent) |
| Create | `docs/verification/T28-phase{0..4}-*.md`, `docs/verification/T28-import-mode-choice.md` |
| Create | `docs/decisions/0036-t28-import-mode-choice.md` |

Fase 0 menghitung ulang file test yang menekan *Upload and extract* untuk pengguna consent (`rg "Upload and extract" tests` pada 21 Oktober 2026: `import-onboarding` 16, `m3-assisted-journey` 3, `ai-usage-limits` 3, `import-start-ui` 3, `import-review` 1, `m2-manual-journey` 1, `release-a11y` 1). Hanya langkah yang kini membuka dialog yang diubah. Langkah dialog yang berulang dijadikan helper di spec masing-masing atau di `tests/e2e/helpers/`.

## 5. Fase eksekusi

### Fase 0: Baseline (tanpa edit kode)

- [x] `git status` bersih untuk path T28 (catat file lain yang kotor, jangan disentuh); branch kerja `claude/t28-import-mode-choice` dari `main`.
- [x] Parity migration lokal **38/38**, migration terakhir `20261019090000_t26_import_rules_extraction.sql`.
- [x] Jalankan `pnpm lint`, `pnpm typecheck`, `pnpm test`. Harapan dari entry T27: unit **134/1261**. Catat angka aktual.
- [x] Jalankan `pnpm test:e2e:import`, `test:e2e:import-review`, `test:e2e:ai`, `test:e2e:m3`, `test:e2e:release`. Harapan dari entry T26/T27: `import` 11, `import-review` 10, `ai` 2, `m3` 2, `release` 21. Catat angka aktual dan prasyarat container (ClamAV, Gotenberg) di receipt.
- [x] Verifikasi rujukan file:baris di §2 dan §3 masih benar; selisih dicatat di receipt.
- [x] Hitung ulang test yang meng-upload sebagai pengguna consent (§4) dan daftar assertion yang akan berubah dengan sengaja.
- [x] Receipt `T28-phase0-baseline.md`.

### Fase 1: Logika pilihan (unit)

- [x] Test `chooseImportMode` (gagal): empat kombinasi mode × consent (§2.2.2), urutan langkah, `withdrawConsent` gagal → tanpa upload dan pesan error dikembalikan, `saveConsent` gagal → tanpa upload.
- [x] Implementasi `chooseImportMode` baru; perbarui pemanggil.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus.
- [x] Receipt `T28-phase1-choice-logic.md`, commit.

### Fase 2: Dialog dan S02 (unit markup)

- [x] Test (gagal), via `renderToStaticMarkup`:
  - Dialog `step="choose"` dengan `granted` menampilkan `rulesAiOff`; tanpa `granted` tidak.
  - `step="confirm"` menampilkan heading, body, dua tombol bervarian sama dengan urutan §2.2.4, heading dengan `tabindex="-1"`, tanpa `import.mode.shared`.
  - S02 pengguna consent: dropzone tampil, disclosure netral, dialog dirender.
  - S02 pengguna consent dengan kuota habis: dropzone dan Upload tampil, tidak hanya *Start manually*, `aiNotice` diteruskan.
  - Retry batch `ai` dengan `consent: false` menampilkan alasan consent.
- [x] Ubah assertion lama yang sengaja berubah: `import-start-ui.test.tsx` "keeps the AI disclosure and no mode dialog for a user who already consented" dan bagian `consented` di "keeps the upload open … limit is reached"; test kuota di `ai-usage-limits.test.tsx` yang mengharapkan hanya *Start manually*. Catat setiap perubahan dan alasannya di receipt.
- [x] Test copy: key §2.2.8 ada di en dan id, tanpa karakter em dash; key yang dihapus tidak dirujuk lagi di `src/`.
- [x] Implementasi §3.2 dan copy §2.2.8.
- [x] Receipt `T28-phase2-dialog-s02.md`, commit.

### Fase 3: E2E dan aksesibilitas

- [ ] Baca skill antislop (header dokumen ini) sebelum fase ini; cek tampilan konfirmasi terhadap `Design.md` (dialog, tombol, spasi).
- [ ] `import-onboarding.spec.ts`, skenario baru (gagal dulu):
  - (a) Pengguna consent: Upload → dialog → Pakai AI → batch `ai`, revisi profil tidak berubah (acceptance 1, 2).
  - (b) Pengguna consent: Upload → Baca tanpa AI → konfirmasi. Fokus di judul konfirmasi; Enter tidak memilih; Kembali mengembalikan fokus ke Baca tanpa AI; Esc menutup tanpa perubahan; buka lagi lalu konfirmasi → consent `null`, batch `rules`, review terbuka, tidak ada baris `ai_jobs` dan unit `import` tidak bertambah (acceptance 3, 4, 5, 12).
  - (c) Pengguna tanpa consent: Pakai AI → Coba file lain → Baca tanpa AI → konfirmasi berhasil tanpa `CONFLICT` (acceptance 7).
  - (d) Setelah (b): halaman aktivitas menampilkan jalur *Izinkan AI*, S12 *Tidak diizinkan* (acceptance 8).
  - (e) Pengguna consent dengan kuota import habis: dropzone tampil, kartu AI nonaktif dengan pemberitahuan, alur konfirmasi Tanpa AI berhasil (acceptance 9).
- [ ] Axe pada dialog di kedua tampilan, 360 px dan 1440 px, light dan dark; tanpa overflow horizontal (acceptance 12).
- [ ] Perbarui langkah upload pengguna consent di spec lain (§4) agar memilih Pakai AI di dialog; jangan melemahkan assertion lain.
- [ ] Receipt `T28-phase3-e2e.md`, commit.

### Fase 4: Regresi penuh dan Delivery Gate antislop

- [ ] Regresi §7 lengkap; catat angka aktual.
- [ ] Delivery Gate antislop (Block 1-4 dari `.claude/skills/antislop/SKILL.md`) di receipt, setiap PASS dengan bukti; plus checklist `antislop-copywriting` untuk copy §2.2.8. Klik-through setiap kontrol dialog dicatat per elemen (R-35).
- [ ] Receipt `T28-phase4-regression.md`, commit. **Stop: gate review Claude.**

### Fase 5: Draft dokumen (setelah gate lulus)

- [ ] Tulis `docs/decisions/0036-t28-import-mode-choice.md`: mengubah 0033 #2 (dialog untuk semua pengguna; Tanpa AI mencabut consent global setelah konfirmasi) dan memperluas 0033 #10 (kuota habis untuk pengguna consent). Sebut perilaku `CONSENT_WITHDRAWN` untuk job yang sedang berjalan.
- [ ] Tulis `docs/verification/T28-import-mode-choice.md` (ringkasan acceptance dan bukti) tanpa klaim DONE.
- [ ] Commit.

## 6. Fixture

- Akun A tanpa consent, akun B dengan consent (`createUser({ consent: true })`, `tests/e2e/import-onboarding.spec.ts:31-40`), akun C dengan consent dan kuota import harian penuh (isi `internal.ai_usage` lewat helper yang dipakai suite usage limits, bukan lewat upload nyata).
- PDF fixture T26 yang ada; nama dan isi fiktif.
- Sentinel privat T26 tetap berlaku: teks CV dan nama file tidak muncul di log worker, response, atau console.

## 7. Commands

Semua script sudah ada di `package.json`:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration:import
pnpm test:integration:ai
pnpm test:integration:ai-usage
pnpm test:integration:m3
pnpm test:e2e:import
pnpm test:e2e:import-review
pnpm test:e2e:ai
pnpm test:e2e:ai-review
pnpm test:e2e:m2
pnpm test:e2e:m3
pnpm test:e2e:release
```

Suite integration dijalankan untuk memastikan tidak ada perubahan server yang terlewat; T28 tidak menyentuh server. Prasyarat lokal (ClamAV, Gotenberg, env AI harness) mengikuti catatan receipt T26/T27.

## 8. Stop conditions

Berhenti dan laporkan bila:

- Working tree kotor pada path yang akan diubah T28.
- Pencabutan consent atau upload `rules` ternyata butuh perubahan migration, RPC, atau route.
- Hasil `setAiConsentAction` tidak memberi revisi profil yang dapat dipakai (§2.2.6).
- Test lama hanya bisa lulus dengan melemahkan assertion di luar daftar perubahan disengaja (§5 Fase 2 dan 3).
- Scope bocor ke §2.3 (mengingat pilihan, fallback otomatis, pengembalian unit, perubahan S12 atau analisis).
- Perlu dependency baru.
- Masalah credential atau kebutuhan memanggil penyedia AI nyata.

## 9. Gate review Claude

Read-only setelah Fase 4. P0-P2 memblokir, P3 follow-up.

- [ ] Receipt Fase 0-4 lengkap dengan angka aktual; ulang checks utama di worktree bersih.
- [ ] Pengguna consent tidak pernah meng-upload tanpa melewati dialog; Pakai AI tidak menyimpan consent ulang.
- [ ] Pencabutan hanya terjadi dari tombol lanjut di tampilan konfirmasi; Kembali, Esc, backdrop, dan tutup tidak mencabut dan tidak meng-upload.
- [ ] Error pencabutan tidak diikuti upload; revisi profil diambil dari hasil action terakhir.
- [ ] Kesetaraan dialog 0033 #2 tetap: varian tombol sama, tanpa rekomendasi, fokus di judul pada kedua tampilan.
- [ ] Copy en/id sesuai §2.2.8, jujur tentang job yang sedang berjalan, tanpa em dash; Delivery Gate antislop tanpa FAIL.
- [ ] Perubahan assertion lama hanya yang terdaftar dan beralasan.

## 10. Review focus

1. **Revisi basi.** Pencabutan memakai `consent.profileRevision` dari props setelah consent baru disimpan di sesi yang sama, sehingga `CONFLICT`. Dijaga E2E acceptance 7.
2. **Pencabutan tanpa konfirmasi.** `onChoose("rules")` untuk pengguna consent langsung menjalankan pencabutan, atau `onOpenChange(false)` ikut memanggil langkah lanjut. Dijaga unit `chooseImportMode` dan E2E acceptance 3 dan 5.
3. **Upload setelah pencabutan gagal.** Urutan langkah tidak memeriksa hasil `withdrawConsent`. Dijaga unit acceptance 6.
4. **Fokus mendorong pilihan.** Fokus jatuh ke tombol lanjut atau Kembali saat konfirmasi terbuka, sehingga Enter langsung mencabut consent. Dijaga E2E acceptance 12.
5. **Kuota habis masih menutup import.** Cabang lama hanya dipindah, bukan dihapus, atau `aiNotice` tidak diteruskan untuk pengguna consent. Dijaga unit dan E2E acceptance 9.
6. **State `granted` tidak sinkron.** Setelah pencabutan, S02 masih menganggap consent aktif (kalimat dampak tetap tampil, alasan Retry salah). Dijaga unit acceptance 10 dan E2E skenario (b).

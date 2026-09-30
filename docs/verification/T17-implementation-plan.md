# Handoff T17 Import review UI dan onboarding lengkap — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 30 September 2026
- Status saat plan ditulis: **TODO**. Status plan: **DONE — acceptance lokal 30 September 2026** ([bukti](T17-import-review-ui.md), [gate review](T17-review-remediation-plan.md)).
- Dependensi: T16 **DONE** (acceptance lokal, `docs/verification/T16-import-commit.md`) dan T04 **DONE**. T15 (staging, S02), T03 (onboarding manual, S12), dan T12 (dashboard) juga **DONE**. Gate M2 **PASSED**.
- Eksekutor: satu agent **Claude Sonnet 5.5**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 5; Fase 6 (draft dokumen) dikerjakan setelah gate. Checkpoint setelah Fase 2 bersifat opsional.
- Keputusan yang perlu konfirmasi pengguna sebelum Fase 1: §2.2.1 (tanpa migration; purge batch `review` yang ditinggalkan tetap T23), §2.2.2 (route S03 di luar workspace frame), §2.2.3 (S02 terbuka untuk pengguna lama), §2.2.6 (model simpan: pilihan langsung tersimpan, edit field lewat Save eksplisit). Sisanya dibekukan.
- Acuan:
  - PRD R02, §3 (*Imported achievement claims are candidates until the user selects Confirm during review*), *Shared validation*, release scenario *Import an Indonesian CV with overlapping employment dates; correct extraction and confirm once*.
  - User Flow F01 langkah 3–6 (S03, Create/Map/Skip, Confirm hanya bila contribution/outcome/date ada, *Confirm import once*, buka S04), *Import exceptions*, jalur manual S02 → S12 → S04, state *Import batch*.
  - Wireframe S02 (`/onboarding/import`, *returning users enter this screen from S12*), **S03** (`/imports/:id/review`), S04 (*For an empty account, show … Import CV*), S12.
  - Database Schema §4 `import_items`/*Import commit transaction* (dipakai lewat RPC T16, tanpa perubahan).
  - `IMPLEMENTATION_PLAN.md` §1 (autosave hanya dengan status persistensi; commit import aksi eksplisit), §3 *Ownership dan concurrency*, blok T17 dan kalimat Gate M3 di §5, matriks §6 baris R02.
  - `docs/decisions/0002-foundation-schema.md` poin 1 (profil provisional), `0005-design-system-application-frame.md`, `0021-t15-import-staging.md`, `0022-t16-import-commit.md` bagian *Seams*.

**Goal:** Pengguna dengan batch `review` membuka S03 `/imports/:id/review`, melihat kandidat yang dikelompokkan (profile, experience, education, certifications, skills, achievements) beserta excerpt sumber, field kurang, error validasi, dan peringatan duplikat. Tiap kandidat punya *Create*, *Map to existing*, atau *Skip*; field dapat diedit; achievement hanya dikonfirmasi lewat pilihan eksplisit per kandidat. Semua pilihan tersimpan di server sehingga refresh tidak kehilangan apa pun. Tombol *Confirm import* nonaktif selama ada record terpilih yang invalid atau edit yang belum disimpan. Satu klik menjalankan commit atomik T16; pengguna baru menyelesaikan onboarding (nama nyata, locale, timezone) di commit yang sama. Batch committed menampilkan hitungan nyata dan *Open dashboard*. Pengguna lama masuk ke import dari S12 dan dashboard kosong; ekstraksi kosong menawarkan jalur manual.

**Architecture:** UI saja di atas RPC T16; **tidak ada migration**. Server component memuat *review view* lewat service baru (session client, RLS) — batch, item (`payload`, `source_excerpt`, `action`, `target_id`, `confirm_requested`, `revision`), opsi map per tipe milik pengguna, dan hasil `validate_import_batch`. Model view murni di `src/domain/import/review-view.ts` (grouping, field kurang, duplikat, status tombol commit). Client component memanggil `updateImportItemAction`/`commitImportAction` yang sudah ada, ditambah action `validateImportAction` dan route `GET /api/imports/[id]/review` untuk reload setelah konflik. S02, S04, dan S12 hanya mendapat entry point dan copy.

**Tech stack:** Next.js 16 App Router (server components + server actions), React 19, TypeScript 6 strict, Zod 4, Tailwind 4 + token `Design.md`, lucide-react, Vitest (unit + integration nyata), Playwright + axe-core, pnpm dari lockfile. Tidak ada dependency baru.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md` (T16), `docs/IMPLEMENTATION_PLAN.md` §1, §3, blok M3 di §5, decision 0002/0005/0021/0022, `Design.md` (bagian form, list, dialog, state, responsive, aksesibilitas), lalu `docs/verification/T16-implementation-plan.md` sebagai pola format. Ekstrak PRD R02/§3, F01, S02/S03/S04/S12 dengan alat ekstraksi DOCX (mis. `python` + `zipfile` atas `word/document.xml`); jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R02:** ekstrak profile, education, experience, skills, certifications, dan kandidat achievement ke staging; pengguna **mengedit dan memilih** record sebelum **satu commit atomik**; retry tidak menduplikasi data.
- **PRD §3:** klaim achievement hasil import tetap kandidat sampai pengguna memilih *Confirm* saat review. **Shared validation:** hanya display name wajib untuk onboarding; experience wajib organization + role; education wajib institution + qualification; tanggal boleh unknown dan partial disimpan dengan precision; end yang diketahui tidak boleh sebelum start; edit bersamaan melaporkan conflict, bukan overwrite diam-diam.
- **PRD release scenario:** import CV berbahasa Indonesia dengan tanggal kerja overlap; koreksi ekstraksi dan konfirmasi sekali; kandidat terpilih mengisi dashboard tanpa duplikat saat retry.
- **F01:** S03 menampilkan bagian hasil ekstraksi, excerpt, field kurang, dan duplikat; tiap baris *Create*, *Map to existing*, atau *Skip*; map memakai ulang record tanpa menimpa. Edit data kandidat dan selesaikan field wajib. Achievement: pilih *Confirm* hanya bila contribution, outcome, dan tanggal ada; kandidat lain boleh disimpan sebagai draft. *Confirm import once*: commit atomik, tampilkan jumlah yang benar-benar dibuat, buka S04 dengan record langsung terlihat. Jalur manual: nama di S12, opsional education/experience, lalu dashboard; CV dan pekerjaan tidak pernah wajib.
- **F01 Import exceptions:** ekstraksi parsial membuka review dengan field kurang di-highlight; tidak ada hasil yang auto-confirm; submit ganda mengembalikan hasil batch yang ada; sesi kedaluwarsa meminta sign-in dan hanya melanjutkan state server yang tersimpan.
- **S02:** pengguna lama masuk ke layar ini dari S12. *Start manually* membuka S12 dengan display name wajib.
- **S03:** kelompokkan kandidat; tampilkan field yang dapat diedit, excerpt sumber, error validasi, dan **ringkasan pilihan**; mapping tanpa overwrite; **konfirmasi eksplisit per kandidat achievement**. Pilihan review dipersist. Highlight field wajib yang kurang. Tombol simpan final nonaktif bila ada record terpilih yang invalid. Batch committed menampilkan hitungan hasil dan *Open dashboard*; refresh atau double click tidak menduplikasi row. Ekstraksi kosong menawarkan entri manual.
- **S04:** akun kosong menampilkan *Add your first activity* dan *Import CV*.
- **Rencana §1:** autosave hanya untuk draft/edit dengan status persistensi yang jelas; commit import tetap aksi eksplisit.
- **Decision 0022 Seams T17:** S03 memakai `updateImportItemAction`, `validate_import_batch`, `commitImportAction`; `existing_id` menawarkan Map untuk skill duplikat; `payload.display_name` hanya prefill `p_onboarding.display_name`; unique-race skill dapat menghasilkan `IMPORT_ITEM_INVALID` dengan daftar kosong (tampilkan pesan umum lalu validasi ulang).

Pertahankan perubahan lokal pengguna. Jangan menandai T17 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T17-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka yang ditulis harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T17

T17 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **S03 menampilkan batch review dengan jujur.** `/imports/:id/review` untuk batch `review` milik pengguna menampilkan enam grup (hanya grup yang berisi kandidat), tiap kandidat dengan excerpt sumber, field payload yang dapat diedit, pilihan Create/Map/Skip yang tersimpan, dan ringkasan pilihan (jumlah create/map/skip per tipe + jumlah achievement dikonfirmasi). Dibuktikan unit (view model + render) dan E2E.
2. **Field kurang dan error validasi terlihat.** Hasil `validate_import_batch` dipetakan ke field kandidat (pesan en/id per kode `REQUIRED`, `INVALID`, `TOO_LONG`, `DATE_RANGE`, `DUPLICATE`, `TARGET_UNAVAILABLE`, `INVALID_ACTION`), terhubung lewat `aria-describedby`, dan tidak hanya bergantung pada warna. Kandidat `skip` tidak menampilkan error blocking. Dibuktikan unit dan E2E (fake `import_partial`: `role_title` kosong ter-highlight).
3. **Pilihan dipersist dan refresh aman.** Mengubah action, target map, atau confirm langsung tersimpan lewat `update_import_item` dengan status persistensi terlihat (*Saving… / Saved / Not saved*). Edit field disimpan lewat *Save* per kandidat. Reload halaman menampilkan pilihan dan nilai yang sama dari server. Dibuktikan integration (service) dan E2E (reload).
4. **Konflik tanpa kehilangan input.** `STALE_REVISION` pada update (tab lain mengubah item yang sama) menampilkan state konflik dengan *Reload* yang memuat versi server sambil mempertahankan input lokal yang belum tersimpan untuk disalin/diterapkan ulang; tidak ada overwrite diam-diam. Commit dengan revision batch basi menampilkan pesan konflik dan memuat ulang view, tanpa commit. Dibuktikan unit (reducer/state) dan E2E dua tab.
5. **Map hanya ke record milik sendiri.** Opsi *Map to existing* berisi record milik pengguna dengan tipe yang sama (experience → `experiences`, dst.), label ringkas tanpa ID; profile tidak punya opsi Map. Target yang hilang saat commit menampilkan `TARGET_UNAVAILABLE` pada kandidat terkait. Map tidak mengubah row target (diverifikasi snapshot sebelum/sesudah). Dibuktikan integration dan E2E.
6. **Peringatan duplikat.** Skill `DUPLICATE` dari validasi menampilkan tombol *Map to existing skill* yang memakai `existing_id` (satu klik → `map`). Experience/education/certification/achievement yang sama persis secara ternormalisasi dengan record milik pengguna menampilkan peringatan non-blocking *Possible duplicate of …* dengan saran Map; tidak auto-map. Dibuktikan unit (heuristik) dan E2E (skill `SQL`).
7. **Konfirmasi achievement eksplisit.** Checkbox *Confirm this achievement* per kandidat achievement `create`; nonaktif (dengan alasan terlihat) sampai title, contribution, outcome, dan achieved_on tersimpan. Default tidak dicentang. Kandidat yang tidak dikonfirmasi tercatat di ringkasan sebagai draft. Tidak ada kontrol *Confirm all*. Dibuktikan unit dan E2E.
8. **Tombol final.** *Confirm import* nonaktif (dengan alasan terlihat) bila ada error validasi pada kandidat terpilih, edit field yang belum disimpan, penyimpanan yang sedang berjalan, atau (pengguna baru) data onboarding invalid. Satu klik → satu request; tombol loading dan nonaktif sampai respons; double click dan submit ulang setelah refresh tidak membuat row baru. Dibuktikan unit dan E2E (double click + hitungan row via admin).
9. **Onboarding lewat import.** Pengguna provisional melihat bagian *Your name* (prefill dari `payload.display_name` item profile bila ada, jika tidak kosong; placeholder `Pending onboarding` tidak pernah dipakai), locale (default locale saat ini), timezone (deteksi browser, fallback profil). Commit mengirim `onboarding`; sesudahnya `/dashboard` terbuka tanpa redirect ke onboarding. Pengguna yang sudah onboarding tidak melihat bagian ini. Dibuktikan E2E dan unit.
10. **Hasil commit.** Setelah commit, S03 menampilkan hitungan dari `commit_result` (dibuat per tipe, di-map, di-skip, achievement dikonfirmasi) dan *Open dashboard* sebagai aksi utama; fokus pindah ke heading hasil. Membuka ulang URL batch committed menampilkan hitungan yang sama dari `import_batches.commit_result`. Dashboard menampilkan record yang dibuat (hitungan achievement confirmed dan experience/education lewat Timeline). Dibuktikan E2E.
11. **Status non-review.** Batch `queued`/`running` → S03 mengarahkan ke S02 (progres); `failed`/`cancelled` → pesan jelas dengan *Try another file* dan *Start manually*; `review` tanpa kandidat → state kosong dengan *Start manually* sebagai aksi utama dan *Cancel import*; ID asing/tidak ada → halaman not-found generik yang sama (tanpa membedakan). Dibuktikan unit dan E2E (akun B).
12. **Entry point.** S02 `review_ready` menampilkan *Review candidates* → S03 (menggantikan assertion T15 "tanpa link"); S02 `committed` menampilkan copy *Import saved* (bukan copy cancelled) dengan *Open dashboard*. Dashboard kosong: *Import CV* aktif → `/onboarding/import`. S12: kartu *Import CV* → `/onboarding/import`. Pengguna yang sudah onboarding dapat membuka `/onboarding/import` (tidak lagi di-redirect) dan *Start manually* untuk mereka mengarah ke `/settings/profile`. Dibuktikan unit dan E2E.
13. **Rilis skenario PRD.** CV sintetis berbahasa Indonesia (dua experience overlap, satu current) → S02 → worker fake `valid` → S03: koreksi satu field, map satu skill ke skill lama, lengkapi dan konfirmasi satu achievement, skip satu kandidat → commit sekali → dashboard dan timeline menampilkan data dengan overlap utuh; reload + klik ulang tidak menambah row. Dibuktikan E2E (keyboard-only untuk jalur utama).
14. **Aksesibilitas dan responsive.** Axe tanpa pelanggaran WCAG 2.2 AA pada S03 (review, konflik, kosong, hasil), S02 (review ready, committed), dashboard kosong; 360 px dan 1440 px dalam light dan dark tanpa overflow horizontal; keyboard-only untuk seluruh kontrol; fokus kembali setelah dialog/reload; reduced motion dihormati. Dibuktikan E2E.
15. **Privasi dan isolasi.** Akun B tidak dapat melihat S03 atau hasil batch A (halaman not-found generik, route API 404) dan opsi map tidak pernah memuat record akun lain. Log server, response route, dan console browser tidak memuat excerpt, payload, atau nama file (sentinel = 0). Dibuktikan integration dan E2E.
16. **Regresi.** Suite T03–T16 tetap lulus tanpa melemahkan assertion. Perubahan assertion yang disengaja hanya: `tests/e2e/import-onboarding.spec.ts:155` dan `tests/unit/import-start-ui.test.tsx:81` (kini link S03 wajib ada), `tests/e2e/dashboard-timeline.spec.ts:350` (Import CV kini aktif), dan redirect onboarded dari `/onboarding/import` bila ada test yang mengasersinya. Tiap perubahan dicatat di receipt dengan alasan.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Route S03 `src/app/imports/[id]/review/page.tsx` (+ `loading.tsx`), service baca `import-review-view-service.ts`, route `GET /api/imports/[id]/review`, action `validateImportAction`.
- Model view murni `src/domain/import/review-view.ts` (grouping, field kurang, duplikat, ringkasan, kesiapan commit) dan komponen client `src/features/import/import-review.tsx` (+ sub-komponen kandidat bila file terlalu besar).
- Perubahan S02 (`import-start.tsx`, `src/app/onboarding/import/page.tsx`), dashboard kosong (`dashboard-view.tsx`), S12 (`profile-workspace.tsx`), copy en/id di `src/i18n/messages.ts`, CSS token-based di `src/app/globals.css`.
- Unit test, integration `tests/integration/import-review-ui.test.ts`, E2E `tests/e2e/import-review.spec.ts` dengan config dan script baru, decision 0023, receipt.

### 2.2 Keputusan implementasi

1. **Tanpa migration.** Semua kebutuhan data tersedia: `import_items` dapat dibaca pemilik lewat RLS (`20260930090000_t15_import_staging.sql:283-293`), `commit_result` dapat dibaca (decision 0022 poin 13), tulis hanya lewat RPC T16. Purge batch `review` yang ditinggalkan **tidak** dikerjakan di T17 (butuh kebijakan retensi dan job baru) → T23; T17 hanya menyediakan *Cancel import* di S03 sehingga pengguna dapat mengakhirinya. Parity tetap 26/26. **Perlu konfirmasi pengguna.**
2. **Route S03 di luar workspace frame.** `src/app/imports/[id]/review/page.tsx` (bukan di `(workspace)`), karena `requireCompletedWorkspace` (`src/server/auth/workspace-page.ts:13`) me-redirect pengguna provisional ke `/onboarding/import`, padahal F01 menempatkan S03 sebelum S04 untuk pengguna baru. Guard sendiri: tanpa session → `/sign-in?returnTo=<path S03>` (lewat `sanitizeReturnTo`); tanpa profil → `/sign-in?notice=serviceUnavailable`; profil provisional **diizinkan**. Layout mengikuti pola `src/app/onboarding/import/page.tsx` (brand, locale switcher, satu kolom lebar); pengguna yang sudah onboarding mendapat link *Back to dashboard*. Pastikan `sanitizeReturnTo` menerima `/imports/<uuid>/review`; bila tidak, perluas allowlist dengan test. **Perlu konfirmasi pengguna.**
3. **S02 terbuka untuk pengguna lama.** Hapus redirect `onboarding_completed_at → /dashboard` di `src/app/onboarding/import/page.tsx:20`. Untuk pengguna yang sudah onboarding: heading `import.title` (bukan *Choose how to get started*), *Start manually* → `/settings/profile`, link *Back to dashboard*. Route tetap `/onboarding/import` sesuai wireframe S02. **Perlu konfirmasi pengguna.**
4. **Pemuatan data server-side dengan session client.** `createImportReviewViewService({ client })` membaca: batch (`BATCH_COLUMNS` + `commit_result`), item batch (urut `entity_type` sesuai urutan grup, lalu `ordinal`), dan opsi map per tipe yang dimiliki pengguna (maks. 200 per tipe, urut label; kolom minimal untuk label: experience `organization, role_title, start_date, start_precision`; education `institution, qualification`; certification `name, issuer`; skill `name, normalized_name`; achievement `title, status`). Validasi diambil dari `validate_import_batch` hanya bila batch `review`. Semua hasil diparse Zod; row yang gagal parse → `UNAVAILABLE`, bukan crash. Owner selalu dari RLS/session; tidak ada admin client di S03.
5. **Model view murni.** `toImportReviewView({ batch, items, targets, errors, profile })` di `src/domain/import/review-view.ts` menghasilkan: `state` (`review`, `review_empty`, `committed`, `processing`, `failed`, `cancelled`), grup berurutan `profile → experience → education → certification → skill → achievement`, per kandidat `fields` (nilai, wajib?, error), `action`, `targetId`, `confirmRequested`, `canConfirm` + alasan, `duplicate` (dari validasi atau heuristik), ringkasan, dan `commitBlockers` (daftar alasan). Tidak ada akses I/O. Field wajib per tipe mengikuti decision 0022 dan PRD shared validation: experience `organization, role_title, kind`; education `institution, qualification`; certification `name`; skill `name`; achievement `title` (+ `contribution, outcome, achieved_on` bila dikonfirmasi); profile: field di `selected_fields` tidak boleh NULL.
6. **Model simpan.** Perubahan *action*, *map target*, *confirm*, dan pilihan field profil (`selected_fields`) disimpan langsung per perubahan (autosave dengan status per kandidat, sesuai rencana §1). Edit teks/tanggal disimpan lewat tombol *Save* per kandidat (satu `payload_patch` berisi field yang berubah saja); kandidat dengan edit belum tersimpan menandai `unsaved` dan menahan tombol final. Tidak ada debounce autosave teks. Setiap update mengembalikan `item_revision` dan `batch_revision`; client menyimpan revision batch terbaru sebagai token commit. Setelah setiap update sukses, client memanggil `validateImportAction` dan mengganti error. Navigasi keluar dengan edit belum tersimpan memakai `useUnsavedForm`/dialog unsaved yang sudah ada. **Perlu konfirmasi pengguna.**
7. **Konflik.** `STALE` pada update: kandidat masuk state konflik (pola `ConflictControls` di `src/components/forms/conflict-controls.tsx`), input lokal dipertahankan; *Reload* mengambil view terbaru dari `GET /api/imports/[id]/review` dan menampilkan nilai server berdampingan dengan nilai lokal yang belum tersimpan. `STALE` pada commit: pesan konflik, reload view, commit tidak diulang otomatis. `NOT_REVIEWABLE`/`NOT_COMMITTABLE` (batch di-cancel/commit dari tab lain): reload view dan tampilkan state terbaru.
8. **Tanggal di editor.** Gunakan editor partial date yang sudah ada di S12 (`src/features/profile/foundation-editors.tsx` + `src/domain/dates/partial-date.ts`) bila dapat dipakai ulang tanpa perubahan perilaku; jika tidak, ekstrak komponen bersama tanpa mengubah perilaku S12 (test S12 tetap lulus). Achievement `achieved_on` adalah tanggal tepat (input `date`). `is_current` mengosongkan end date di UI; validasi tetap di SQL.
9. **Map.** Pilihan *Map to existing* membuka `select` berlabel berisi opsi tipe yang sama; memilih opsi menyimpan `action = 'map'` dan `target_id` dalam satu update. Mengubah dari map ke create/skip mengirim `target_id = null`. Kandidat map tidak dapat diedit (field read-only, dengan teks *Existing record is kept unchanged*). Profile tidak menampilkan opsi Map. Confirm otomatis dilepas saat action bukan `create` (dikirim dalam update yang sama).
10. **Duplikat.** Skill: dari validasi `DUPLICATE` + `existing_id` → tombol *Map to existing skill*. Heuristik non-blocking (pure, di `review-view.ts`): normalisasi `lower(trim(collapse spaces))`; experience cocok bila `organization` dan `role_title` sama; education bila `institution` dan `qualification` sama; certification bila `name` dan `issuer` (NULL = NULL) sama; achievement bila `title` sama. Hanya pada kandidat `create`. Tidak ada fuzzy/Levenshtein.
11. **Profil.** Kandidat profile: checkbox per field (`headline`, `summary`, `contact_email`, `phone`, `location`, `website`) yang mengisi `selected_fields`; nilai field dapat diedit; `display_name` tidak pernah dipilih lewat checkbox (hanya prefill onboarding). Pengguna lama melihat nilai profil saat ini di samping nilai kandidat agar pilihan menimpa jelas (*Current: …*).
12. **Onboarding dalam S03.** Hanya bila `onboarding_completed_at IS NULL`. Field: display name (wajib, maks. 80, placeholder `Pending onboarding` diperlakukan kosong), locale `en`/`id`, timezone (deteksi `Intl` seperti `src/features/profile/onboarding-form.tsx:25-37`). Nilai ini **tidak** disimpan ke server sebelum commit (tetap lokal + `useSessionDraft` agar refresh tidak menghapusnya). Validasi klien hanya untuk UX; server tetap memutuskan (`ONBOARDING_INVALID` → error di field). Pengguna provisional juga dapat memilih *Start manually* dari S03.
13. **Commit.** Form commit mengirim `batch_id`, `expected_revision` (token batch terbaru), dan field onboarding bila perlu ke `commitImportAction`. `ITEM_INVALID` dengan daftar → error dipetakan ke kandidat dan fokus ke ringkasan error; daftar kosong (unique-race) → pesan umum lalu `validateImportAction`. Sukses → state `committed` dari respons, fokus ke heading hasil, `router.refresh()`. Link *Open dashboard* adalah `Link` biasa ke `/dashboard`.
14. **Hasil committed dari server.** State `committed` dirender dari `commit_result` batch (Zod `commitResultSchema` tanpa `batch_id`/`committed_at` — tambahkan skema `storedCommitResultSchema` di `commit-contracts.ts`). Batch committed oleh fixture lama tanpa `commit_result` → teks *Import saved* tanpa angka (jangan mengarang nol).
15. **Batas tampilan.** Maksimal kandidat per tipe mengikuti `IMPORT_LIMITS.perType` T15; seluruh kandidat dirender dalam grup dengan heading dan jumlah, tanpa pagination. Setiap grup dapat dilipat (progressive disclosure) dan grup dengan error dibuka secara default.
16. **Entry point tanpa fitur baru.** Dashboard kosong dan S12 hanya menautkan ke `/onboarding/import`. Hapus kunci copy `dashboard.importUnavailable`, `onboarding.importUnavailable`, `onboarding.importUnavailableLabel` bila tidak lagi dipakai (grep dulu).
17. **Nomor.** Tanpa migration (parity 26/26). Decision `docs/decisions/0023-t17-import-review-ui.md`. Integration `tests/integration/import-review-ui.test.ts`, script baru `test:integration:import-review`. E2E `tests/e2e/import-review.spec.ts`, config baru `playwright.import-review.config.ts` port **3010**, script baru `test:e2e:import-review`.

### 2.3 Di luar scope

- Perubahan schema, RPC, atau aturan validasi T15/T16. Bila UI terasa membutuhkan perubahan SQL, stop (§8).
- Purge batch `review` yang ditinggalkan, retensi, dan penghapusan akun → **T23**.
- CV selection/freshness (termasuk perubahan profil lewat import) → **T18–T20**.
- Skill link achievement, project sebagai entity import, fuzzy dedupe, merge record, bulk actions (*Confirm all*, *Skip all*) → tidak ada di v0.1.
- Smoke live `extractImport` ke provider nyata (butuh persetujuan pengguna, bukan bagian acceptance T17).
- Gate M3 → sesi terpisah setelah T17 DONE.

## 3. Kontrak teknis

### 3.1 Domain

- `src/domain/import/review-view.ts` (imports relatif, tanpa alias `@/`, seperti `import-view.ts`):
  - Tipe `ReviewItemRow`, `ReviewTargetOption`, `ImportReviewView`, `ReviewCandidate`, `CommitBlocker` (`validation`, `unsaved`, `saving`, `onboarding`, `empty_selection` bila semua kandidat `skip` dan tidak ada onboarding — lihat catatan).
  - `REVIEW_GROUP_ORDER`, `REQUIRED_FIELDS`, `normalizeDuplicateKey`, `findDuplicate`, `canConfirmAchievement(payload)`, `summarize(items)`, `toImportReviewView(input)`.
  - Catatan `empty_selection`: commit dengan semua `skip` sah secara SQL, tetapi bagi pengguna provisional tetap berguna untuk onboarding; jangan blokir — tampilkan peringatan non-blocking *Nothing will be created*. Hanya `validation`, `unsaved`, `saving`, `onboarding` yang memblokir.
- `src/domain/import/commit-contracts.ts`: tambah `storedCommitResultSchema` (subset tanpa `batch_id`/`committed_at`) dan ekspor `IMPORT_PROFILE_SELECTABLE_FIELDS` yang sudah ada dipakai UI. Jangan mengubah skema lain.

### 3.2 Server

- `src/features/import/import-review-view-service.ts`: `createImportReviewViewService({ client })` → `getReviewView(batchId)`; ID bukan UUID atau batch tidak terlihat → `ImportServiceError("NOT_FOUND")`. Tidak mencatat payload/excerpt ke log.
- `src/app/api/imports/[id]/review/route.ts`: `GET` owner-scoped, `cache-control: no-store`, pola `src/features/import/http.ts` (`src/app/api/imports/[id]/route.ts` sebagai contoh); error → JSON `{code, message, correlationId}` tanpa detail.
- `src/features/import/actions.ts`: tambah `validateImportAction(_prev, formData)` (Zod `batch_id`) yang mengembalikan daftar `ImportItemError`. `commitImportAction` tetap; tambah `revalidatePath('/timeline')` dan `revalidatePath('/settings/profile')` setelah sukses (record baru terlihat). Jangan mengubah perilaku action lain.

### 3.3 UI

- `src/app/imports/[id]/review/page.tsx` + `loading.tsx` (skeleton): guard §2.2.2, muat view, render `ImportReview`.
- `src/features/import/import-review.tsx` (client): header (nama file, status), onboarding (bila perlu), ringkasan pilihan (sticky di desktop, di atas tombol final di mobile), grup kandidat, error summary (`role="alert"` dengan link ke field), tombol *Confirm import* (satu aksi utama), *Cancel import* sekunder (dialog konfirmasi, pakai `cancelImportAction`), *Start manually*. Pecah menjadi `import-review-candidate.tsx` bila file > ~400 baris.
- Primitives yang dipakai: `Button`, `Dialog`, `Card`, `Badge`, `field-control` (`Input`, `Select`, `Textarea`), `ActionFeedback`/`FieldError`, `ConflictControls`, `EmptyState`, `useUnsavedForm`, `useSessionDraft`. Ikon hanya lucide-react.
- `src/features/import/import-start.tsx`: `review_ready` → `Link` *Review candidates* (`button-primary`) ke `/imports/${batchId}/review`; `committed` → copy baru `import.committedTitle`/`import.committedBody` + *Open dashboard*; prop baru `onboarded: boolean` untuk tujuan *Start manually*.
- `src/app/onboarding/import/page.tsx`: §2.2.3.
- `src/features/dashboard/dashboard-view.tsx:39-45`: tombol nonaktif diganti `Link` `button-secondary` ke `/onboarding/import`.
- `src/features/profile/profile-workspace.tsx`: kartu *Import CV* dengan deskripsi singkat dan link ke `/onboarding/import`.
- Copy en/id di `src/i18n/messages.ts` untuk semua teks baru; tidak ada string literal di komponen.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `src/domain/import/review-view.ts` |
| Modify | `src/domain/import/commit-contracts.ts` (skema hasil tersimpan saja) |
| Create | `src/features/import/import-review-view-service.ts`, `src/features/import/import-review.tsx` (+ `import-review-candidate.tsx` bila perlu) |
| Create | `src/app/imports/[id]/review/page.tsx`, `src/app/imports/[id]/review/loading.tsx`, `src/app/api/imports/[id]/review/route.ts` |
| Modify | `src/features/import/actions.ts`, `src/features/import/import-start.tsx`, `src/app/onboarding/import/page.tsx`, `src/features/dashboard/dashboard-view.tsx`, `src/features/profile/profile-workspace.tsx`, `src/i18n/messages.ts`, `src/app/globals.css` |
| Modify (hanya bila perlu, dengan test) | `src/domain/routes/safe-return.ts`, ekstraksi editor partial date dari `src/features/profile/foundation-editors.tsx` |
| Create | `tests/unit/{import-review-view,import-review-view-service,import-review-ui,import-review-route}.test.ts(x)` |
| Modify (assertion disengaja, lihat §1.16) | `tests/unit/import-start-ui.test.tsx`, `tests/e2e/import-onboarding.spec.ts`, `tests/e2e/dashboard-timeline.spec.ts`, test unit dashboard/S12 terkait |
| Create | `tests/integration/import-review-ui.test.ts`, `tests/e2e/import-review.spec.ts`, `playwright.import-review.config.ts` |
| Modify | `package.json` (dua script baru), `README.md` (Fase 6) |
| Create (Fase 6) | `docs/decisions/0023-t17-import-review-ui.md`, `docs/verification/T17-import-review-ui.md` |

Script baru:

- `test:integration:import-review` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/import-review-ui.test.ts`
- `test:e2e:import-review` → `playwright test --config playwright.import-review.config.ts tests/e2e/import-review.spec.ts`

Salin pola `playwright.import.config.ts` (env web tanpa `WORKPULSE_AI_*`/`WORKPULSE_OPENAI_*`/`WORKPULSE_DOCX_*`/`WORKPULSE_GOTENBERG_*`, `workers: 1`, build + start) dengan `PORT = 3010` dan `testMatch: "import-review.spec.ts"`.

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD. Working tree harus bersih kecuali `.claude/`. Jika tidak, **stop**.
- [ ] `pnpm install --frozen-lockfile`, `pnpm db:status`, `pnpm exec supabase migration list --local`. Parity harus **26/26** dengan migration terakhir `20261001090000_t16_import_commit.sql`. Bila Docker mati, nyalakan dan `pnpm db:start` (tanpa reset).
- [ ] Baseline `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan 70 file / 449 test), `pnpm db:test` (harapan 11 file / 779 assertion), `pnpm test:integration:import-commit` (harapan 11).
- [ ] Container ClamAV (`docs/verification/T10-scanner-runbook.md`) berjalan, lalu `pnpm test:e2e:import` (harapan 7) dan `pnpm test:e2e:dashboard` (harapan 1). Catat bila environment gagal; jangan ubah kode untuk "memperbaikinya".
- [ ] Verifikasi dari source dan catat file:baris untuk:
  - Grant/RLS `import_items`/`import_batches` (`20260930090000_t15_import_staging.sql:278-295`) dan grant `commit_result` di migration T16.
  - Signature RPC dan tipe di `src/server/supabase/database.types.ts` untuk `update_import_item`, `validate_import_batch`, `commit_import_batch`.
  - `src/features/import/{actions,import-review-service,import-errors}.ts`, `src/domain/import/commit-contracts.ts` (allowlist patch, skema input; catat bahwa `payload_patch` tidak menerima angka — pastikan payload T15 tidak memuat angka mentah, atau catat sebagai temuan).
  - Payload per tipe (`src/domain/import/extract-result.ts:249-342`) dan resolusi `experience_ref` → `experience_item_id` di `complete_import_ai_job` T15.
  - Fake import scenarios (`src/server/ai/fake-provider.ts:5-66`), `tests/import-fixtures.ts` (`CV_LINES`), `tests/e2e/helpers/import-worker.ts` (skenario yang didukung; `import_partial` belum ada di helper — catat).
  - Guard: `src/server/auth/workspace-page.ts:13`, `src/app/onboarding/import/page.tsx:20`, `src/domain/auth/route-state.ts:14`, `src/domain/routes/safe-return.ts` (apakah `/imports/...` diterima).
  - Komponen yang akan dipakai ulang: `ConflictControls`, `useUnsavedForm`, `useSessionDraft`, editor partial date S12, `OnboardingForm` (deteksi timezone).
  - Semua pemakaian `dashboard.importUnavailable`, `onboarding.importUnavailable*`, dan assertion `a[href*="/imports/"]` di test (grep).
  - Port 3010 belum dipakai config Playwright lain.
- [ ] Tulis receipt Fase 0 `docs/verification/T17-phase0-baseline.md`. Commit `docs(t17): add phase 0 baseline receipt`.

### Fase 1 — Model view domain (TDD unit)

- [ ] Test gagal lebih dulu `tests/unit/import-review-view.test.ts`:
  1. Grouping dan urutan grup; grup kosong tidak muncul; `ordinal` menentukan urutan dalam grup.
  2. Field wajib per tipe dan pemetaan error validasi ke field; kandidat `skip` tanpa error blocking; error untuk item tak dikenal diabaikan dengan aman.
  3. `canConfirmAchievement`: false bila salah satu dari title/contribution/outcome/achieved_on kosong/whitespace; alasan per field.
  4. Duplikat: skill dari `DUPLICATE`+`existing_id`; heuristik experience/education/certification/achievement (normalisasi spasi/case; NULL issuer); tidak ada duplikat untuk `map`/`skip`.
  5. Ringkasan: hitungan create/map/skip per tipe dan achievement dikonfirmasi cocok dengan item.
  6. `commitBlockers`: validation, unsaved, saving, onboarding (nama kosong/placeholder/ > 80, timezone kosong); semua skip → peringatan non-blocking saja.
  7. State: `review`, `review_empty`, `committed` (dengan dan tanpa `commit_result`), `processing`, `failed`, `cancelled`.
  8. Tidak ada teks excerpt/payload di field selain yang memang ditampilkan (view tidak menambah data).
- [ ] Implementasi §3.1 hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t17): add import review view model`, receipt Fase 1.

### Fase 2 — Service baca, route, dan action (TDD unit + integration)

- [ ] Test unit gagal lebih dulu:
  - `import-review-view-service`: UUID invalid/tidak ada → `NOT_FOUND`; row tidak valid → `UNAVAILABLE`; validasi hanya dipanggil untuk batch `review`; opsi map dibatasi 200 per tipe; hasil tidak memuat kolom di luar kebutuhan view.
  - `import-review-route`: tanpa session → 401 generik; batch asing → 404 generik; `no-store`; body error tanpa detail.
  - `validateImportAction`: Zod `batch_id`, pemetaan error, tanpa `revalidatePath`.
- [ ] Implementasi §3.2 hingga PASS.
- [ ] `tests/integration/import-review-ui.test.ts` (setup seperti `tests/integration/import-commit.test.ts`, batch `review` dibangun lewat pipeline T15 nyata, bukan insert langsung). Skenario:
  1. `getReviewView` owner A: grup, excerpt, revision, opsi map hanya milik A (akun B punya skill `SQL` sendiri yang tidak boleh muncul).
  2. Persist: `updateItem` (action map ke skill lama, patch `role_title`, confirm achievement setelah dilengkapi) → `getReviewView` baru menampilkan nilai yang sama; revision batch naik.
  3. Konflik: dua update dengan revision item sama → yang kedua `STALE`; nilai server tidak tertimpa.
  4. Commit lalu `getReviewView` → state `committed` dengan hitungan = row nyata (admin count); commit ulang → hasil identik, tanpa row baru. Target map tidak berubah (snapshot `to_jsonb`).
  5. Isolasi: B membaca view/route batch A → `NOT_FOUND`.
  6. Log hygiene: sentinel isi CV dan nama file tidak ada di error, response route, atau output proses.
- [ ] Tambah script `test:integration:import-review`, jalankan; regresi `test:integration:import-commit`, `test:integration:import`.
- [ ] Commit `feat(t17): add import review loader, route and validate action`, receipt Fase 2. Checkpoint Claude opsional.

### Fase 3 — UI S03 (TDD render)

- [ ] Test render gagal lebih dulu `tests/unit/import-review-ui.test.tsx` (pola `tests/unit/import-start-ui.test.tsx`), en dan id:
  1. Review: heading, grup dengan jumlah, excerpt per kandidat, kontrol Create/Map/Skip berlabel (radio group), select map hanya bila Map, profile tanpa Map.
  2. Error field dengan `aria-describedby` dan teks (bukan warna saja); error summary berisi link ke field.
  3. Checkbox confirm nonaktif + alasan sampai field lengkap; tidak ada *Confirm all*.
  4. Tombol final nonaktif dengan alasan untuk tiap blocker; satu aksi utama.
  5. Onboarding hanya untuk profil provisional; prefill nama dari profile candidate; placeholder tidak di-prefill.
  6. Konflik: state konflik menampilkan nilai lokal dan tombol Reload.
  7. Committed: hitungan dari `commit_result`, *Open dashboard*; tanpa `commit_result` → tanpa angka.
  8. Kosong, failed, cancelled: aksi sesuai §1.11.
  9. Status persistensi per kandidat (*Saving… / Saved / Not saved*).
- [ ] Implementasi §3.3 bagian S03 hingga PASS. Pastikan double submit tidak mungkin dari UI (state `pending` + `disabled`).
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Commit `feat(t17): add S03 import review screen`, receipt Fase 3.

### Fase 4 — Entry point S02, S04, S12 (TDD render)

- [ ] Ubah dulu assertion yang disengaja (§1.16) dan tambah test gagal: S02 `review_ready` punya link S03; S02 `committed` memakai copy committed; S02 untuk pengguna onboarded: heading dan tujuan *Start manually* berbeda; dashboard kosong punya link *Import CV* aktif; S12 punya kartu *Import CV*.
- [ ] Implementasi hingga PASS. Hapus kunci copy yang tidak terpakai (grep). `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] Commit `feat(t17): link import review from S02, dashboard and profile`, receipt Fase 4.

### Fase 5 — Browser acceptance dan regresi penuh

- [ ] `playwright.import-review.config.ts` (port 3010) dan script `test:e2e:import-review`. Tambah skenario `import_partial` ke `tests/e2e/helpers/import-worker.ts` bila perlu (tanpa mengubah skenario lama).
- [ ] `tests/e2e/import-review.spec.ts`, skenario minimum:
  1. **Rilis PRD (§1.13), pengguna baru, keyboard-only jalur utama:** upload CV sintetis Indonesia di S02 → worker fake `valid` → *Review candidates* → S03: koreksi `role_title` satu experience (Save), map `SQL` ke skill lama lewat tombol duplikat, lengkapi contribution/outcome/achieved_on satu achievement lalu centang confirm, skip satu kandidat, isi nama + timezone → *Confirm import* → hasil: hitungan cocok dengan admin count; *Open dashboard* → dashboard tanpa redirect onboarding, achievement confirmed = 1; Timeline menampilkan dua experience overlap.
  2. **Idempotensi (§1.8):** double click tombol final, lalu reload URL S03 committed dan navigasi back → hitungan row tetap (admin count) dan hasil sama.
  3. **Refresh mempertahankan pilihan (§1.3):** ubah action/target/confirm dan satu field, reload → nilai sama; edit belum disimpan memicu dialog unsaved saat navigasi.
  4. **Partial extraction (§1.2):** fake `import_partial` → `role_title` kosong ter-highlight, tombol final nonaktif dengan alasan; isi dan Save → aktif.
  5. **Konflik dua tab (§1.4):** tab 1 dan 2 membuka S03; tab 2 mengubah kandidat yang sama; tab 1 menyimpan → state konflik, input lokal tetap, Reload menampilkan versi server; commit dari tab 1 dengan revision lama → konflik tanpa commit.
  6. **Ekstraksi kosong (§1.11):** fake `import_empty` → S02 empty dan S03 kosong menampilkan *Start manually* sebagai aksi utama dan *Cancel import*.
  7. **Pengguna lama (§1.12):** akun sudah onboarding dengan skill/experience lama → dashboard/S12 *Import CV* → S02 (tanpa redirect) → S03 tanpa bagian onboarding → map experience lama → commit → row target tidak berubah.
  8. **Isolasi dan privasi (§1.15):** akun B membuka URL S03 dan route API batch A → not-found generik; sentinel isi CV dan nama file tidak ada di console browser dan output worker.
  9. **Aksesibilitas/responsive (§1.14):** Axe pada S03 review, konflik, kosong, hasil, S02 review ready/committed, dashboard kosong; 360 px dan 1440 px, light dan dark; tanpa overflow horizontal; screenshot dilampirkan.
- [ ] Jalankan seluruh §7. `test:e2e:m2` wajib lulus tanpa melemahkan assertion env (kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk run itu). ClamAV wajib berjalan untuk suite yang membutuhkannya (import, evidence, m2); Gotenberg untuk suite yang membutuhkannya; bila tidak, catat **tidak dijalankan** beserta alasan.
- [ ] Ulangi `test:e2e:import-review` dengan `--repeat-each 2` untuk mendeteksi flaky.
- [ ] Commit `test(t17): add S03 browser acceptance and regression`, receipt Fase 5. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–5, output command, screenshot, dan daftar acceptance yang belum terbukti.

### Fase 6 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0023-t17-import-review-ui.md`: keputusan §2.2 poin 1–17, alternatif yang ditolak (autosave teks dengan debounce, route S03 di dalam workspace, migration purge di T17, fuzzy dedupe, bulk confirm), seam T18–T20 (profil hasil import dan CV freshness) dan T23 (purge batch review ditinggalkan).
- [ ] `docs/verification/T17-import-review-ui.md`: pass/fail/warning/tidak dijalankan, trace ke R02, F01, S02/S03/S04/S12, dan setiap poin §1.
- [ ] README (bagian Import: S03, script baru, tabel quality gates).
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- **Owner A (baru):** belum onboarding, locale `id`, timezone `UTC` (provisional), consent terkini. CV sintetis berbahasa Indonesia memakai format baris fake T15, misalnya:
  - `Curriculum Vitae WP-PRIVATE-IMPORT-SENTINEL-<uuid>`
  - `EXP|PT Sentinel Nusantara|Analis Data|2019|2022`
  - `EXP|WP Labs|Data Lead|2021|` (overlap, current)
  - `EDU|Universitas Contoh|S1 Statistika|2014|2018`
  - `SKILL|SQL`, `SKILL|Python`
  - `ACH|Menurunkan waktu laporan dari 5 ke 2 jam|PT Sentinel Nusantara`
  - Pastikan teks cukup panjang untuk ambang scanned-PDF (`tests/import-fixtures.ts:9-10`); pakai ulang `cvPdf` dengan baris kustom.
  - Skill lama `SQL` dibuat lewat RPC/service normal sebelum upload (untuk duplikat → map).
  - Nama file `cv-WP-FILENAME-SENTINEL-<uuid>.pdf`.
- **Owner C (lama):** sudah onboarding, locale `en`, punya experience `PT Lama Sentosa / Staf` dan skill `SQL`; untuk entry point dan map experience.
- **Owner B:** batch dan skill `SQL` sendiri untuk isolasi.
- Fake `import_valid` tidak menghasilkan profile dan membuat achievement tanpa contribution/outcome/achieved_on; achievement yang dikonfirmasi harus dilengkapi lewat UI. Kandidat profile untuk test render/integration diisi lewat `complete_import_ai_job` ber-payload kustom sebagai `service_role` (pola `import_commit.test.sql`), bukan lewat UI.
- Setiap test membersihkan akun fixture termasuk object Storage prefix `import` (pola `tests/e2e/import-onboarding.spec.ts:92-98`).

## 7. Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm exec supabase migration list --local
pnpm test:integration:import-review
pnpm test:integration:import-commit
pnpm test:integration:import
pnpm test:integration:achievements
pnpm test:integration:dashboard
pnpm test:integration:activity
pnpm test:integration:projects
pnpm test:integration:m2
pnpm test:integration:ai
pnpm test:integration:ai-review
pnpm test:integration:evidence
pnpm test:integration:storage
pnpm test:e2e:import-review
pnpm test:e2e:import
pnpm test:e2e:dashboard
pnpm test:e2e:achievements
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:projects
pnpm test:e2e:ai
pnpm test:e2e:ai-review
pnpm test:e2e:evidence
pnpm test:e2e:m2
pnpm worker:check
pnpm build
git diff --check
```

`test:integration:import-review` dan `test:e2e:import-review` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `db:types` tidak diperlukan karena tidak ada migration; jalankan hanya untuk memastikan tidak ada diff. `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan (di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong). Muat env Supabase lokal dalam command yang sama dengan suite (env PowerShell tidak bertahan antar command). Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, atau parity bukan 26/26.
- Implementasi terasa memerlukan migration, perubahan RPC/validasi T15/T16, `db reset`, atau perubahan grant/RLS (mis. kolom yang dibutuhkan UI tidak terbaca). Laporkan kebutuhan persisnya.
- Keputusan yang ditandai *perlu konfirmasi pengguna* (§2.2.1, §2.2.2, §2.2.3, §2.2.6) belum dikonfirmasi saat Fase 1 dimulai, atau implementasi menuntut penyimpangan darinya.
- `payload_patch` Zod menolak nilai payload nyata T15 (mis. angka) sehingga field tidak dapat disimpan tanpa mengubah kontrak T16.
- Perubahan guard/route membuat pengguna provisional dapat membuka workspace, atau pengguna onboarded kehilangan akses ke rute yang sebelumnya bisa.
- Perubahan assertion test lama di luar daftar §1.16 terasa perlu.
- Scope bocor ke purge/retensi (T23), CV (T18–T20), bulk action, fuzzy dedupe, atau fitur roadmap `Design.md`.
- Test membutuhkan key nyata, atau sentinel/nama file muncul di output.

## 9. Gate review Claude (setelah Fase 5)

Review read-only mencakup:

- Tidak ada migration; semua write lewat `update_import_item`/`commit_import_batch`/`cancel_import_batch`; tidak ada admin client di jalur S03.
- Guard S03: provisional diizinkan, anonymous ke sign-in dengan return aman, akun lain tidak dapat membedakan batch asing dari tidak ada.
- Tidak ada auto-confirm atau *Confirm all*; confirm hanya per achievement dan hanya bila field lengkap; map tidak mengedit target.
- Pilihan tersimpan di server; refresh dan dua tab tidak kehilangan pilihan atau menimpa diam-diam; konflik mempertahankan input lokal.
- Tombol final benar-benar terblokir untuk invalid/unsaved/saving/onboarding; double click dan refresh tidak menduplikasi row.
- Nama onboarding tidak pernah diisi placeholder; `display_name` tidak ditulis lewat `selected_fields`.
- Hitungan hasil berasal dari `commit_result`, bukan dihitung ulang di klien.
- Entry point S02/S04/S12 sesuai wireframe; pengguna lama dapat mengimpor.
- Copy en/id lengkap; WCAG 2.2 AA, 360/1440, light/dark; satu keluarga ikon; token `Design.md`.
- Error dan log hanya kode/ID; tidak ada excerpt, payload, atau nama file di log/console/response error.
- Tidak ada fitur roadmap atau scope T18–T23.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Token revision batch basi.** Client memakai `revision` batch dari render awal, bukan dari respons update terakhir, sehingga commit selalu `STALE` setelah edit — atau sebaliknya reload diam-diam mengambil revision baru dan meng-commit keadaan yang tidak dilihat pengguna. Dijaga E2E 1/5 dan unit state.
2. **Edit belum tersimpan ikut hilang atau di-commit.** Tombol final tidak memperhitungkan draft lokal, sehingga commit memakai nilai server lama sementara layar menampilkan nilai baru. Dijaga unit blocker dan E2E 3.
3. **Confirm lolos tanpa field lengkap atau tidak dilepas saat pindah ke map/skip.** Dijaga unit view dan pgTAP T16 (server tetap menolak), E2E 1.
4. **Guard route bocor.** Route S03 di luar workspace membuka akses tanpa session, atau perubahan `/onboarding/import` membuat provisional masuk workspace. Dijaga unit guard, E2E 7/8, dan regresi `test:e2e:auth`.
5. **Validasi error tidak ter-refresh.** Error lama tetap tampil (atau hilang) setelah update karena `validateImportAction` tidak dipanggil ulang, sehingga tombol final salah status. Dijaga E2E 4 dan integration 2.
6. **Privasi di jalur baru.** Route GET atau error summary menampilkan excerpt/nama file di body error atau log. Dijaga integration 6 dan E2E 8.

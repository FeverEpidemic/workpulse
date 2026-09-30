# Handoff T18 CV schema dan selection service — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi. Semua nama tabel, kolom, fungsi, kode error, dan path di dokumen ini **dibekukan**; jangan mengganti namanya.

- Tanggal: 30 September 2026
- Status saat plan ditulis: **TODO**.
- Dependensi: T09 **DONE** (achievement lifecycle, skills) dan T03 **DONE** (profil, onboarding, foundation CRUD). T08 (projects) dan T16/T17 (import commit) juga **DONE**. Gate M3 **PASSED** (`docs/verification/M3-gate-review.md`).
- Eksekutor: satu agent **Claude Sonnet 5.5**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 4; Fase 5 (draft dokumen) dikerjakan setelah gate. Checkpoint setelah Fase 1 bersifat opsional.
- Keputusan produk: pengguna **menyetujui** (30 September 2026) §2.2.5 (aturan parent wajib), §2.2.7 (duplikat = error `CV_SOURCE_DUPLICATE`), §2.2.9 (safety net penghapusan sumber), dan §2.2.12 (`cv_exports` hanya struktur). Semuanya dibekukan; pelaksana tidak perlu menanyakannya ulang.
- Acuan:
  - PRD R09, *CV freshness contract* (konfirmasi achievement **tidak** otomatis memasukkannya ke CV), *Shared validation*, release scenario *Onboard a graduate …* dan *Edit a selected achievement after manual CV wording changes …* (keduanya baru lengkap di T19–T22).
  - User Flow F07 langkah 1–2 (first open membuat CV unik; locale id/en; pilih dan urutkan record; child memasukkan parent), F03 (*Add to CV* hanya membuka S13; confirm tidak menyisipkan ke CV; reopen menghapus eligibility).
  - Wireframe S13 (`/cv`, UI milik T19) — T18 hanya menyediakan backend yang dibutuhkannya.
  - Database Schema §1 (composite FK, *CV sources*), §5 tabel `cv_documents`/`cv_items`/`cv_exports`, *Selection and freshness invariants*, *Deletion and export consistency*, index; §6 RLS dan *simultaneous CV edits*.
  - `IMPLEMENTATION_PLAN.md` §3 *Ownership dan concurrency* dan *CV*, §4 baris *CV consistency … lock protocol*, blok T18 di §5.
  - `docs/decisions/0002-foundation-schema.md` (lifecycle profil, `onboarding_completed_at`), `0014-t09-achievement-lifecycle.md` (status, seam CV), `0022-t16-import-commit.md` poin 17, `0023-t17-import-review-ui.md` bagian seam T18–T20.

**Goal:** Setiap akun memiliki tepat satu master CV yang dibuat saat pertama dibuka (juga saat dibuka bersamaan). Pengguna dapat memilih experience, project, confirmed achievement, education, skill, dan certification ke section yang sesuai; memilih achievement kontekstual otomatis memasukkan parent yang diperlukan; sumber yang sama tidak bisa dipilih dua kali; draft/dismissed achievement tidak eligible. Pengguna dapat menghapus item (parent dengan child harus diselesaikan eksplisit), mengurutkan ulang item dalam section dan urutan section secara transaksional, dan memilih locale label CV. Setiap mutasi child CV menaikkan revision CV dan dijaga `expected_revision`. Setiap item menyimpan snapshot tampilan sumber dan revision sumber saat dipilih. Menghapus sumber canonical tidak gagal karena CV dan tidak menghapus item secara diam-diam.

**Architecture:** Aturan ada di PostgreSQL. Satu migration forward-only membuat `cv_documents`, `cv_items`, `cv_exports` (struktur saja), check/trigger/RLS/index, fungsi snapshot `internal.cv_source_snapshot`, serta RPC authenticated `ensure_cv_document`, `select_cv_source`, `remove_cv_item`, `reorder_cv_section`, `update_cv_layout`. Domain TypeScript murni (`src/domain/cv/`) memuat kontrak section, aturan parent, dan `buildCvOutline` (penempatan achievement di bawah parent tanpa render ganda) yang akan dipakai T19 preview dan T21 snapshot. Server membungkus RPC lewat `cv-service.ts` (Zod, pemetaan error, correlation ID) dan server action tipis. Tidak ada UI baru: `/cv` tetap `WorkspaceUnavailable` sampai T19. Tidak ada worker dan tidak ada AI.

**Tech stack:** Supabase PostgreSQL 17 (plpgsql `security definer`, RLS, composite FK `on delete set null (col)`, unique constraint deferrable, pgTAP), Next.js App Router server actions, TypeScript strict, Zod 4, Vitest (unit + integration nyata), pnpm dari lockfile. Tidak ada dependency baru.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md` (Gate M3), `docs/IMPLEMENTATION_PLAN.md` §1–§4 dan blok M4, decision 0002/0014/0022/0023, lalu `docs/verification/T16-implementation-plan.md` sebagai pola format receipt. Ekstrak PRD R09/*CV freshness contract*, F07, S13, dan DB §1/§5/§6 dengan alat ekstraksi DOCX (mis. `python` + `zipfile` atas `word/document.xml`; `python-docx` **tidak** terpasang di mesin ini); jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R09:** pilih dan urutkan experience, projects, confirmed achievements, education, skills, certifications. Edit summary dan wording item. Perubahan sumber memicu refresh yang dapat direview. (Summary/wording = T19, refresh = T20.)
- **PRD CV freshness contract:** mengonfirmasi achievement menambahkannya ke *selection pool* tanpa diam-diam menambahkannya ke CV. Sumber terhapus atau belum dikonfirmasi memblokir export sampai item dihapus atau diperbaiki.
- **PRD model:** career database tetap authoritative; CV adalah snapshot yang dapat diedit dari record terpilih.
- **F07:** first open membuat master CV unik akun. Pilih label Indonesia atau Inggris. Template satu kolom A4. Pilih record dan urutkan section serta item. Confirmed achievement boleh berada di bawah experience atau project terpilihnya; standalone di *Selected achievements*. Memilih child otomatis memasukkan parent yang diperlukan. Layout awal dibangun dari data sumber tanpa panggilan AI.
- **F03:** *Add to CV* membuka S13 dengan record disorot; confirm saja tidak menyisipkannya. *Reopen as draft* menghapus eligibility. Hapus achievement membuat link sumber CV invalid dan harus diselesaikan sebelum export.
- **S13:** sertakan education, projects, skills, certifications. Child memasukkan parent. Override hanya mengubah wording CV. Urutan lewat kontrol *move* yang aksesibel. Satu master CV, tanpa duplikasi.
- **DB §5 `cv_documents`:** `title`, `locale` (id/en), `template_key` (`single_column_v1`), `summary_override` opsional, `profile_snapshot`, `profile_source_revision`, `profile_ack_revision` opsional, `section_order` (daftar unik section key yang didukung). `UNIQUE(user_id)`.
- **DB §5 `cv_items`:** `cv_id`, `section_key`, `position`, tepat satu dari `experience_id/project_id/achievement_id/education_id/skill_id/certification_id` bila `source_deleted = false`, semuanya NULL bila deleted; `source_snapshot` (field tampilan + konteks parent), `source_revision`, `override_text` opsional, `acknowledged_revision` opsional, `source_deleted` default false. Composite FK owner. Sumber unik per CV per tipe; `unique (cv_id, section_key, position)` deferrable untuk reorder.
- **DB §5 `cv_exports`:** `cv_id`, `cv_revision`, `snapshot`, `status` queued/running/succeeded/failed, `object_key` opsional, `idempotency_key`, `error_code`, `started_at/finished_at/expires_at`. `UNIQUE(user_id, idempotency_key)`.
- **DB §5 selection invariants:** section yang didukung: experience, projects, achievements, education, skills, certifications. Validasi tipe sumber terhadap section. Achievement dengan konteks experience/project terpilih dirender di bawah parent; standalone di achievements. Memilih child auto-select parent; menghapus parent meminta penghapusan child; tidak ada riwayat kerja tanpa parent yang tersembunyi.
- **DB §5 deletion:** sebelum menghapus sumber CV, kunci item terkait, set `source_deleted = true`, kosongkan referensi, pertahankan snapshot. Mengedit child item CV menaikkan revision CV. Index `cv_items(user_id, cv_id, section_key, position)` dan `cv_exports(user_id, cv_id, created_at desc)`.
- **DB §6:** RLS di semua tabel; tolak write klien langsung ke export snapshot; sediakan operasi server terautentikasi. Test *simultaneous CV edits* wajib.
- **Rencana §5 T18 (kalimat selesai):** concurrent first open menghasilkan satu CV; draft tidak eligible, child memasukkan parent, duplicate sources ditolak, child mutation menaikkan CV revision.

Pertahankan perubahan lokal pengguna. Jangan menandai T18 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T18-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka yang ditulis harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T18

T18 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Satu CV per akun.** `ensure_cv_document()` pada akun tanpa CV membuat satu row dengan `locale = profiles.locale`, `template_key = 'single_column_v1'`, `section_order` default, `profile_snapshot` dari profil, `profile_source_revision = profiles.revision`; panggilan berikutnya mengembalikan row yang sama tanpa write. Lima panggilan paralel dari lima client akun yang sama menghasilkan tepat satu row dan lima respons dengan `cv_id` identik. Insert langsung kedua ditolak `UNIQUE(user_id)`. Dibuktikan pgTAP (berurutan, unique) dan integration (paralel ×5).
2. **Onboarding wajib.** Akun dengan `onboarding_completed_at IS NULL` → `ONBOARDING_REQUIRED` tanpa write (placeholder nama tidak boleh menjadi snapshot CV). Akun `deleting` → `AUTH_REQUIRED`. Dibuktikan pgTAP.
3. **Draft tidak eligible.** `select_cv_source('achievement', id)` untuk achievement `draft` atau `dismissed` → `CV_SOURCE_INELIGIBLE` tanpa write; `confirmed` → item dibuat. `getSelectionPool` di service tidak mengembalikan draft/dismissed. Dibuktikan pgTAP, unit service, integration.
4. **Child memasukkan parent.** Memilih confirmed achievement dengan `project_id` membuat item project (bila belum terpilih) lalu item achievement dalam satu transaksi; dengan `experience_id` saja membuat item experience; tanpa konteks tidak membuat parent. Parent yang sudah terpilih tidak diduplikasi. Respons mencantumkan semua item yang dibuat. Dibuktikan pgTAP dan integration.
5. **Duplikat ditolak.** Memilih sumber yang sudah terpilih → `CV_SOURCE_DUPLICATE` tanpa write; unique index per tipe menolak insert langsung (defense in depth). Dibuktikan pgTAP.
6. **Validasi section/sumber.** Check constraint menolak item dengan section yang tidak cocok dengan kolom sumber, nol atau lebih dari satu sumber saat `source_deleted = false`, sumber non-NULL saat `source_deleted = true`, `section_key` di luar enam key, `position < 1`, dan `section_order` yang tidak unik/berisi key asing/tidak lengkap. Dibuktikan pgTAP.
7. **Ownership.** Akun B tidak dapat membaca CV/item A (RLS), tidak dapat memilih sumber milik A (`CV_SOURCE_NOT_FOUND` generik, sama untuk ID acak), dan composite FK menolak item A yang menunjuk sumber B. Tidak ada grant `insert/update/delete` klien pada ketiga tabel CV. Dibuktikan pgTAP dan integration (query klien langsung).
8. **Mutasi child menaikkan revision CV.** `select_cv_source`, `remove_cv_item`, `reorder_cv_section`, `update_cv_layout` masing-masing menaikkan `cv_documents.revision` **tepat satu** per panggilan sukses (termasuk select yang membuat parent) dan mengembalikan revision baru. `expected_revision` basi → `STALE_REVISION` tanpa write. Dibuktikan pgTAP.
9. **Edit bersamaan.** Dua sesi dengan `expected_revision` sama memanggil mutasi berbeda secara paralel → tepat satu sukses, lainnya `STALE_REVISION`, tanpa deadlock `40P01` dan tanpa posisi ganda. Dibuktikan integration (dua koneksi nyata).
10. **Reorder transaksional.** `reorder_cv_section(section, [item_ids])` dengan daftar yang persis sama dengan himpunan item section itu menulis posisi `1..n` sesuai urutan (termasuk swap dua item) tanpa melanggar unique deferrable; daftar kurang/lebih/duplikat/item section lain → `CV_REORDER_INVALID` tanpa write. Setelah select dan remove, posisi per section selalu kontigu `1..n`. `update_cv_layout` menerima `section_order` permutasi enam key dan `locale` id/en. Dibuktikan pgTAP dan unit.
11. **Penghapusan parent diselesaikan eksplisit.** `remove_cv_item` pada item experience/project yang menjadi parent (menurut `source_snapshot` achievement) dari item achievement terpilih, dengan `p_remove_children = false` → `CV_CHILD_ITEMS_EXIST` dengan daftar ID item child saja; dengan `true` → parent dan child terhapus dalam satu transaksi. Item non-parent dihapus langsung. Dibuktikan pgTAP dan integration.
12. **Snapshot sumber.** Item baru menyimpan `source_snapshot` berisi field tampilan sesuai §3.2 (termasuk konteks parent achievement) dan `source_revision = revision` sumber saat dipilih. Snapshot tidak memuat `raw_text`, `source_excerpt`, `contribution`, evidence, atau ID activity. Mengedit sumber sesudahnya tidak mengubah snapshot atau `source_revision` (refresh = T20). Dibuktikan pgTAP.
13. **Penghapusan sumber tidak rusak.** `delete_achievement`, `delete_experience`, `delete_project`, `delete_education`, `delete_certification`, `delete_skill` yang ada tetap sukses saat sumbernya terpilih di CV; item terkait menjadi `source_deleted = true`, semua kolom sumber NULL, `source_snapshot` dan `position` tetap. Item tidak dihapus. Dibuktikan pgTAP dan integration.
14. **Tanpa perubahan perilaku lama.** Konfirmasi achievement tidak membuat item CV. Semua suite T02–T17 dan gate M2/M3 tetap lulus tanpa melemahkan assertion, terutama `db:test`, `test:integration:achievements`, `test:integration:projects`, `test:integration:import-commit`, `test:integration:m2`, `test:integration:m3`, `test:e2e:achievements`, `test:e2e:m2`.
15. **Log hygiene.** Error, detail, respons service, dan log tidak memuat teks sumber (sentinel = 0). Dibuktikan integration dan grep `console.` di `src/features/cv`.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration forward-only T18 (tiga tabel, check, trigger, RLS, index, fungsi snapshot, lima RPC) dan pgTAP baru `cv_selection.test.sql`.
- Domain TypeScript `src/domain/cv/` (section key, pemetaan tipe → section, aturan parent, validasi reorder, `buildCvOutline`, skema Zod).
- Server `src/features/cv/cv-service.ts`, pemetaan error, dan server action tipis (belum dirender).
- Integration suite nyata `cv-selection.test.ts`, script baru, decision 0024, receipt.

### 2.2 Keputusan implementasi

1. **Satu CV, dibuat lewat RPC idempoten.** `ensure_cv_document()` memakai `insert … on conflict (user_id) do nothing` lalu `select`; tidak memakai `internal.operation_requests`. Alasan: `UNIQUE(user_id)` sudah merupakan scope idempotensi; rencana §5 meminta concurrent first open menghasilkan satu CV.
2. **Onboarding wajib sebelum CV.** `ensure_cv_document` menolak `onboarding_completed_at IS NULL` (`ONBOARDING_REQUIRED`). Alasan: decision 0002 — nama provisional tidak valid untuk output CV; route `/cv` sudah memakai `requireCompletedWorkspace`.
3. **Nilai awal.** `title = 'Master CV'` (nonblank ≤ 120, diedit T19), `locale = profiles.locale`, `template_key = 'single_column_v1'` (check tunggal), `section_order = ["experience","projects","achievements","education","skills","certifications"]`, `profile_snapshot = {schema_version:'cv-profile.v1', display_name, headline, summary, contact_email, phone, location, website}` dari profil, `profile_source_revision = profiles.revision`, `summary_override/profile_ack_revision = NULL`.
4. **Section key dan pemetaan tipe.** Section key persis: `experience`, `projects`, `achievements`, `education`, `skills`, `certifications`. Tipe sumber RPC: `experience`→`experience`/`experience_id`, `project`→`projects`/`project_id`, `achievement`→`achievements`/`achievement_id`, `education`→`education`/`education_id`, `skill`→`skills`/`skill_id`, `certification`→`certifications`/`certification_id`. Item achievement **selalu** `section_key = 'achievements'`; penempatan di bawah parent adalah aturan render (§2.2.6), bukan penyimpanan. Alasan: DB §5 "validate source type against section" dan satu sumber per tipe per CV.
5. **Parent wajib (disetujui pengguna, 30 September 2026).** Parent achievement = project bila `project_id` tidak NULL, selain itu experience bila `experience_id` tidak NULL, selain itu tidak ada. Project **tidak** otomatis memilih experience-nya; experience, education, skill, certification tidak punya parent. Alasan: F07 hanya menyebut achievement di bawah experience/project; section projects berdiri sendiri di S13; memaksa experience untuk setiap project akan menyisipkan record yang tidak dipilih pengguna.
6. **Render tanpa ganda.** `buildCvOutline(document, items)` (domain murni): section mengikuti `section_order`; achievement ditempatkan di bawah item project terpilih bila `snapshot.project_id` cocok dengan `project_id` item project, selain itu di bawah item experience bila `snapshot.experience_id` cocok, selain itu di section `achievements`. Setiap achievement muncul tepat sekali. Item `source_deleted` tetap muncul dengan flag `deleted` (tampilan state = T19/T20). Urutan dalam grup mengikuti `position`.
7. **Duplikat = error (disetujui pengguna, 30 September 2026).** Sumber yang sudah terpilih → `CV_SOURCE_DUPLICATE` (bukan return idempoten). Alasan: rencana §5 "duplicate sources ditolak"; retry klien sudah dijaga `expected_revision`.
8. **Revision CV.** RPC mutasi mengunci `cv_documents` `for update`, membandingkan `p_expected_revision`, lalu menaikkan revision **sekali** per panggilan (update `cv_documents` di akhir; trigger `internal.touch_mutable_row` menaikkan revision). `cv_items` juga memakai `touch_mutable_row` untuk revision item-nya sendiri.
9. **Safety net penghapusan sumber (disetujui pengguna, 30 September 2026).** FK sumber di `cv_items` memakai composite FK `on delete set null (<kolom>)` (pola `projects_experience_fk` di `20260916090000_foundation_schema.sql:320-323`). Trigger `before update` `internal.guard_cv_item_row` menandai `source_deleted = true` bila kolom sumber berubah dari non-NULL ke NULL, mempertahankan `source_snapshot`/`position`, dan tidak menyentuh `cv_documents`. Kenaikan revision CV, lock protocol, dan invalidasi lengkap saat delete/edit/reopen sumber adalah **T20**. Alasan: tanpa ini, `delete_*` T03/T08/T09 akan gagal karena FK (regresi); dengan tidak mengunci `cv_documents` dari jalur delete, urutan lock sumber → item tidak berlawanan dengan RPC CV (lihat §2.2.10).
10. **Urutan lock RPC CV.** profile `for share` (cek `deleting_at`) → `cv_documents` `for update` → item CV yang disentuh `for update` (urut `id`) → sumber `for share` (hanya `select_cv_source`, parent dulu lalu achievement). Jalur delete sumber mengunci sumber → item (lewat FK) dan tidak pernah menunggu `cv_documents`, sehingga tidak ada siklus. Dokumentasikan di decision 0024 dan uji race §1.9 serta select vs `delete_achievement`/`save_achievement` (reopen).
11. **Eligibility dicek dengan lock.** `select_cv_source` mengunci achievement `for share` sebelum memeriksa `status = 'confirmed'`, sehingga reopen bersamaan menunggu atau terjadi sebelum cek. Reopen **sesudah** pemilihan tidak menghapus item; state *unconfirmed* dan blokir export adalah T20/T21.
12. **`cv_exports` hanya struktur (disetujui pengguna, 30 September 2026).** Tabel dibuat sesuai DB §5 ditambah kolom lease yang meniru `ai_jobs` (`attempt_count` 0..3, `attempt_token uuid`, `lease_expires_at`); RLS select own; tanpa fungsi, tanpa grant write, tanpa worker. T21 boleh menambah kolom/fungsi secara forward. Alasan: rencana §5 T18 menyebut `cv_exports`; perilaku export milik T21.
13. **Kolom override/freshness dibuat, belum ditulis.** `summary_override`, `profile_ack_revision`, `override_text`, `acknowledged_revision` ada dengan check panjang/positif, tetapi tidak ada RPC yang menulisnya di T18 (override = T19, acknowledgement/refresh = T20).
14. **Posisi kontigu.** Setelah setiap `select_cv_source` (append di akhir section) dan `remove_cv_item` (renumber section terdampak), posisi per section adalah `1..n`. `reorder_cv_section` memakai `set constraints cv_items_section_position_key deferred` di dalam fungsi. Constraint dideklarasikan `deferrable initially immediate`.
15. **Selection pool dibaca lewat RLS.** `getSelectionPool` di service membaca tabel sumber dengan session client: semua experience, project, education, skill, certification milik pengguna dan achievement `status = 'confirmed'` saja, ditandai `selected` bila sudah ada item. Tidak ada RPC baru untuk ini.
16. **Snapshot di SQL, satu sumber kebenaran.** `internal.cv_source_snapshot(p_user_id uuid, p_source_type text, p_source_id uuid) returns jsonb` membangun snapshot §3.2; dipakai `select_cv_source` (dan kelak refresh T20). `pg_column_size(source_snapshot) <= 16384`.
17. **Nomor.** Migration `supabase/migrations/20261002090000_t18_cv_schema_selection.sql` (parity menjadi 27/27). Decision `docs/decisions/0024-t18-cv-schema-selection.md`. pgTAP `supabase/tests/database/cv_selection.test.sql`. Integration `tests/integration/cv-selection.test.ts`, script baru `test:integration:cv`. Tidak ada E2E/port baru.

### 2.3 Di luar scope

- UI S13 (`/cv` builder, preview, kontrol move, highlight *Add to CV*, label section id/en di UI), summary/contact editing, `override_text` → **T19**. `/cv` tetap `WorkspaceUnavailable`.
- Freshness (changed/override/deleted/unconfirmed), *Keep saved wording*, Refresh/Replace, invalidasi CV dalam transaksi mutasi/delete sumber (termasuk kenaikan revision CV), dashboard *CV needs review* → **T20**.
- Export request, snapshot immutable, worker PDF, retry/expiry → **T21/T22**.
- Tombol *Add to CV* di S08 → T19 (tidak ditambahkan di T18).
- Perubahan RPC/trigger T02–T17 (kecuali FK baru yang mereferensikan tabel mereka).
- Target job, CV variants, AI auto-selection, template lain.

## 3. Kontrak teknis

### 3.1 Migration `20261002090000_t18_cv_schema_selection.sql`

Urutan isi:

1. Fungsi helper `immutable`/`stable`, `set search_path = pg_catalog`:
   - `internal.cv_section_keys() returns text[]` → enam key dalam urutan default.
   - `internal.is_valid_cv_section_order(p jsonb) returns boolean` → array string, tanpa duplikat, himpunannya **sama persis** dengan enam key.
   - Grant execute ke `authenticated, service_role` (dipakai check constraint, pola `20260916090000_foundation_schema.sql:175-180`).
2. Tabel `public.cv_documents`:
   ```sql
   id uuid primary key default pg_catalog.gen_random_uuid(),
   user_id uuid not null references public.profiles(id) on delete cascade,
   title text not null default 'Master CV',
   locale text not null,
   template_key text not null default 'single_column_v1',
   summary_override text,
   profile_snapshot jsonb not null,
   profile_source_revision integer not null,
   profile_ack_revision integer,
   section_order jsonb not null,
   created_at / updated_at timestamptz not null default pg_catalog.clock_timestamp(),
   revision integer not null default 1,
   constraint cv_documents_user_key unique (user_id),
   constraint cv_documents_user_id_id_key unique (user_id, id),
   -- checks: title btrim nonblank <= 120; locale in ('en','id'); template_key = 'single_column_v1';
   -- summary_override null or (btrim = self, nonblank, <= 5000); profile_snapshot object, pg_column_size <= 8192;
   -- profile_source_revision > 0; profile_ack_revision null or > 0;
   -- internal.is_valid_cv_section_order(section_order); revision > 0
   ```
3. Tabel `public.cv_items`:
   ```sql
   id uuid primary key default pg_catalog.gen_random_uuid(),
   user_id uuid not null references public.profiles(id) on delete cascade,
   cv_id uuid not null,
   section_key text not null,
   position integer not null,
   experience_id uuid, project_id uuid, achievement_id uuid,
   education_id uuid, skill_id uuid, certification_id uuid,
   source_snapshot jsonb not null,
   source_revision integer not null,
   override_text text,
   acknowledged_revision integer,
   source_deleted boolean not null default false,
   created_at / updated_at / revision seperti di atas,
   constraint cv_items_user_id_id_key unique (user_id, id),
   constraint cv_items_cv_fk foreign key (user_id, cv_id)
     references public.cv_documents (user_id, id) on delete cascade,
   constraint cv_items_experience_fk foreign key (user_id, experience_id)
     references public.experiences (user_id, id) on delete set null (experience_id),
   -- idem project_id→projects, achievement_id→achievements, education_id→education,
   -- skill_id→skills, certification_id→certifications
   constraint cv_items_section_position_key unique (cv_id, section_key, position)
     deferrable initially immediate,
   -- checks:
   --   section_key = any(internal.cv_section_keys()); position >= 1;
   --   source_revision > 0; acknowledged_revision null or > 0;
   --   override_text null or (btrim = self, nonblank, <= 2000);
   --   source_snapshot object, pg_column_size <= 16384;
   --   cv_items_source_check:
   --     (source_deleted and num_nonnulls(six ids) = 0)
   --     or (not source_deleted and num_nonnulls(six ids) = 1 and
   --         case section_key when 'experience' then experience_id is not null
   --                          when 'projects' then project_id is not null
   --                          when 'achievements' then achievement_id is not null
   --                          when 'education' then education_id is not null
   --                          when 'skills' then skill_id is not null
   --                          when 'certifications' then certification_id is not null end)
   ```
   Partial unique index per tipe: `cv_items_cv_experience_key on (cv_id, experience_id) where experience_id is not null` (dan lima lainnya). Index `cv_items_user_cv_section_position_idx on (user_id, cv_id, section_key, position)` dan index FK sumber `(user_id, <kolom>)` untuk setiap kolom sumber.
4. Tabel `public.cv_exports` (§2.2.12): kolom DB §5 + `attempt_count integer not null default 0` (check 0..3), `attempt_token uuid`, `lease_expires_at timestamptz`; `cv_revision > 0`; `status in ('queued','running','succeeded','failed')`; `snapshot` object; `object_key` null atau nonblank; `idempotency_key` nonblank ≤ 200; `error_code` null atau `^[A-Z][A-Z0-9_]{0,63}$`; `unique (user_id, idempotency_key)`; `unique (user_id, id)`; FK `(user_id, cv_id)` → `cv_documents` `on delete cascade`; index `(user_id, cv_id, created_at desc)`.
5. Trigger:
   - `touch_mutable_row` `before update` pada `cv_documents`, `cv_items`, `cv_exports`.
   - `internal.guard_cv_document_row()` `before update`: `user_id`, `template_key` immutable.
   - `internal.guard_cv_item_row()` `before update` (dijalankan **sebelum** touch — beri nama trigger yang terurut alfabetis lebih dulu, mis. `cv_items_a_guard`): `cv_id`, `section_key`, `user_id` immutable; kolom sumber hanya boleh berubah non-NULL → NULL (jalur FK), dan bila itu terjadi set `new.source_deleted := true`; `source_deleted` tidak boleh kembali ke false; perubahan sumber NULL → non-NULL ditolak (`CV_ITEM_IMMUTABLE`). Verifikasi di Fase 1 bahwa aksi FK `set null` memicu trigger row `before update` pada tabel referencing (PostgreSQL menjalankannya sebagai UPDATE biasa).
6. RLS: enable pada ketiga tabel; policy `select` own (`(select auth.uid()) = user_id`); `revoke all … from public, anon, authenticated, service_role`; `grant select … to authenticated`. Tidak ada grant write.
7. `internal.cv_source_snapshot(p_user_id, p_source_type, p_source_id)` (§3.2), `stable`, `security definer`; return NULL bila row tidak ada untuk owner itu. Tidak di-grant ke klien.
8. RPC (semua `security definer`, `set search_path = pg_catalog`, identifier ter-qualify, `raise exception using errcode = 'P0001', message = '<CODE>'` tanpa teks sumber; `revoke execute … from public, anon, service_role` lalu `grant … to authenticated`; `comment on` untuk tabel, kolom penting, dan fungsi):

| Fungsi | Perilaku |
| --- | --- |
| `public.ensure_cv_document()` returns table `(cv_id uuid, revision integer, created boolean)` | `auth.uid()` wajib; profil `for share`, tidak ada/deleting → `AUTH_REQUIRED`; belum onboarding → `ONBOARDING_REQUIRED`. Insert nilai awal §2.2.3 `on conflict (user_id) do nothing`; kembalikan row (created = true hanya untuk insert). |
| `public.select_cv_source(p_expected_revision integer, p_source_type text, p_source_id uuid)` returns table `(cv_revision integer, item_ids uuid[], parent_item_ids uuid[])` | Auth seperti di atas. `p_source_type` ∉ enam tipe atau argumen NULL → `INVALID_CV_INPUT`. Lock CV `for update`; tidak ada CV → `CV_NOT_FOUND`; revision basi → `STALE_REVISION`. Lock sumber `for share` dengan `user_id` sama; tidak ada → `CV_SOURCE_NOT_FOUND`. Achievement bukan `confirmed` → `CV_SOURCE_INELIGIBLE`. Sudah terpilih → `CV_SOURCE_DUPLICATE`. Untuk achievement: tentukan parent (§2.2.5), lock parent `for share`, insert item parent bila belum ada (posisi akhir section-nya). Insert item sumber (posisi akhir) dengan snapshot dan `source_revision`. Naikkan revision CV sekali. |
| `public.remove_cv_item(p_expected_revision integer, p_item_id uuid, p_remove_children boolean)` returns table `(cv_revision integer, removed_item_ids uuid[])` | Auth; lock CV; revision basi → `STALE_REVISION`; item bukan milik CV pengguna → `CV_ITEM_NOT_FOUND`. Bila item experience/project dan ada item achievement yang `source_snapshot->>'project_id'` / `->>'experience_id'` menunjuk sumbernya **dan** menurut §2.2.5 parent-nya adalah item ini: `p_remove_children` false → `CV_CHILD_ITEMS_EXIST` dengan `detail` = jsonb array ID item child; true → hapus child juga. Hapus, renumber section terdampak, naikkan revision sekali. Item `source_deleted` tetap dapat dihapus (snapshot parent dipakai untuk menemukan child). |
| `public.reorder_cv_section(p_expected_revision integer, p_section_key text, p_item_ids uuid[])` returns `integer` (revision baru) | Auth; lock CV; revision basi → `STALE_REVISION`; `p_section_key` bukan enam key → `INVALID_CV_INPUT`; lock item section itu `for update` (urut `id`); `p_item_ids` harus tanpa duplikat dan himpunannya sama persis dengan item section → selain itu `CV_REORDER_INVALID`. `set constraints cv_items_section_position_key deferred`; tulis posisi `1..n` sesuai urutan array; naikkan revision sekali. |
| `public.update_cv_layout(p_expected_revision integer, p_locale text, p_section_order jsonb)` returns `integer` | Auth; lock CV; revision basi → `STALE_REVISION`; keduanya NULL → `INVALID_CV_INPUT`; locale bukan en/id atau `section_order` tidak valid → `INVALID_CV_INPUT`. Update kolom yang tidak NULL (revision naik lewat touch). Locale hanya label; tidak menerjemahkan snapshot. |

Kode error lengkap: `AUTH_REQUIRED`, `ONBOARDING_REQUIRED`, `INVALID_CV_INPUT`, `CV_NOT_FOUND`, `STALE_REVISION`, `CV_SOURCE_NOT_FOUND`, `CV_SOURCE_INELIGIBLE`, `CV_SOURCE_DUPLICATE`, `CV_ITEM_NOT_FOUND`, `CV_CHILD_ITEMS_EXIST`, `CV_REORDER_INVALID`, `CV_ITEM_IMMUTABLE`. Sebelum menulis, cek di Fase 0 apakah kode yang sama (`STALE_REVISION`, `AUTH_REQUIRED`) sudah dipakai dengan errcode tertentu oleh RPC lama, dan ikuti pola errcode tersebut.

### 3.2 Isi `source_snapshot` (schema `cv-source.v1`)

Selalu `{schema_version:'cv-source.v1', source_type:<tipe>, source_id:<uuid>, …}` ditambah:

| Tipe | Field |
| --- | --- |
| experience | `organization, role_title, kind, description, start_date, start_precision, end_date, end_precision, is_current` |
| project | `title, description, user_role, outcome, status, start_date, start_precision, end_date, end_precision, is_current, experience_id` |
| achievement | `title, cv_bullet, achieved_on, experience_id, project_id` |
| education | `institution, qualification, field_of_study, description, start_date, start_precision, end_date, end_precision, is_current` |
| skill | `name` |
| certification | `name, issuer, issued_date, issued_precision, credential_url` |

Tanggal diserialisasi sebagai string ISO `YYYY-MM-DD` atau NULL. Dilarang: `raw_text`, `source_excerpt`, `contribution`, `scope`, `metrics`, `activity_id`, `origin`, evidence. Alasan: snapshot adalah field tampilan CV (DB §5), evidence tidak masuk CV (AGENTS.md).

### 3.3 Domain dan server

- `src/domain/cv/contracts.ts`: `CV_SECTION_KEYS` (urutan default), `CV_SOURCE_TYPES`, `SECTION_FOR_SOURCE_TYPE`, `CV_ERROR_CODES`, skema Zod `cvSourceSnapshotSchema` (discriminated union per `source_type`, `.strict()`), `cvDocumentRowSchema`, `cvItemRowSchema`, input `selectCvSourceInput`, `removeCvItemInput`, `reorderCvSectionInput`, `updateCvLayoutInput`, dan `parseChildItemsDetail(detail)` yang hanya menerima array UUID.
- `src/domain/cv/selection.ts`: `requiredParent(snapshot)` (§2.2.5), `isValidSectionOrder(order)`, `isValidReorder(currentIds, requestedIds)`.
- `src/domain/cv/outline.ts`: `buildCvOutline({ sectionOrder, items })` (§2.2.6) — murni, tanpa I/O; output diurutkan deterministik.
- `src/features/cv/cv-service.ts`: `createCvService({ supabase, correlationId })` → `ensure`, `getCv` (dokumen + item terurut + outline), `getSelectionPool` (§2.2.15), `select`, `remove`, `reorder`, `updateLayout`. Owner selalu dari session. Pemetaan kode di `src/features/cv/cv-errors.ts` (kode → `messageKey`) mengikuti pola `src/features/project/project-service.ts:43-180`. Kunci pesan en/id baru di `src/i18n/messages.ts` (hanya pesan error; tidak ada copy UI builder).
- `src/features/cv/actions.ts`: server action `ensureCvAction`, `selectCvSourceAction`, `removeCvItemAction`, `reorderCvSectionAction`, `updateCvLayoutAction` (Zod, correlation ID, `revalidatePath('/cv')` setelah sukses). Belum dirender (T19). Ikuti pola origin/validasi action yang ada (mis. `src/features/project/actions.ts`).
- `pnpm db:types` memperbarui `src/server/supabase/database.types.ts`.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20261002090000_t18_cv_schema_selection.sql`, `supabase/tests/database/cv_selection.test.sql` |
| Modify | `src/server/supabase/database.types.ts` (`db:types`) |
| Create | `src/domain/cv/{contracts,selection,outline}.ts` |
| Create | `src/features/cv/{cv-service,cv-errors,actions}.ts` |
| Modify | `src/i18n/messages.ts` (kunci error CV en/id) |
| Create | `tests/unit/{cv-contracts,cv-selection,cv-outline,cv-service,cv-actions}.test.ts` |
| Create | `tests/integration/cv-selection.test.ts` |
| Modify | `package.json` (script baru), `README.md` (Fase 5) |
| Create (Fase 5) | `docs/decisions/0024-t18-cv-schema-selection.md`, `docs/verification/T18-cv-schema-selection.md` |

Script baru:

- `test:integration:cv` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/cv-selection.test.ts`

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD. Working tree harus bersih kecuali `.claude/`. Jika tidak, **stop**.
- [ ] `pnpm install --frozen-lockfile`, `pnpm db:status`, `pnpm exec supabase migration list --local`. Parity harus **26/26** dengan migration terakhir `20261001090000_t16_import_commit.sql`. Bila Docker mati, nyalakan dan `pnpm db:start` (tanpa reset).
- [ ] Baseline `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan 76 file / 501 test), `pnpm db:test` (harapan 11 file / 779 assertion), `pnpm test:integration:achievements` (harapan 5), `pnpm test:integration:projects` (harapan 7).
- [ ] Verifikasi dari source dan catat file:baris untuk:
  - Kolom `revision` dan trigger `touch_mutable_row` pada `experiences`, `education`, `certifications`, `projects`, `skills` (`20260916090000_foundation_schema.sql:150-170, 218-409`) dan `achievements` (`20260922100000_t09_achievements_skills.sql:127-189` + trigger revision-nya); pastikan semua sumber punya `unique (user_id, id)`.
  - Pola composite FK `on delete set null (col)` (`20260916090000_foundation_schema.sql:320-323`, `20260922100000_t09_achievements_skills.sql:183-188`).
  - Fungsi delete terbaru dan urutan lock-nya: `delete_achievement` (`20260922100000_t09_achievements_skills.sql:911`), `delete_project` (`:1125`), `delete_experience` (`:1204`), `delete_education`/`delete_certification`/`delete_skill` lewat `internal.delete_foundation_record` (`20260916124500_fix_foundation_rpc_row_checks.sql:132`). Pastikan tidak ada yang akan gagal karena FK baru dan tidak ada yang mengunci profil lalu tabel CV.
  - Transisi status achievement dan lock di `save_achievement` terbaru (`20260922110000_t09_achievement_null_patch.sql:3`) untuk uji race reopen vs select.
  - Pola errcode/message RPC lama untuk `STALE_REVISION`/`AUTH_REQUIRED` (grep migration) dan pola pemetaan error service (`src/features/project/project-service.ts`, `src/features/achievement/achievement-service.ts`).
  - `requireCompletedWorkspace` dan `src/app/(workspace)/cv/page.tsx` (tetap tidak diubah).
  - Helper integration yang dipakai suite lain untuk akun A/B dan onboarding (mis. `tests/integration/achievement-lifecycle.test.ts`, `tests/integration/project-context.test.ts`).
- [ ] Tulis receipt Fase 0 `docs/verification/T18-phase0-baseline.md`. Commit `docs(t18): add phase 0 baseline receipt`.

### Fase 1 — Database (TDD pgTAP)

- [ ] Tulis `supabase/tests/database/cv_selection.test.sql` yang gagal lebih dulu (pola `begin; select no_plan(); … select * from finish(); rollback;`, `pg_temp.set_jwt_subject` seperti `import_commit.test.sql`). Assertion minimum:
  1. Struktur: tiga tabel, `unique (user_id)` CV, `cv_items_section_position_key` deferrable, enam partial unique index, enam FK `set null`, RLS aktif, policy select own, tidak ada grant `insert/update/delete` ke `authenticated`, `prosecdef` dan grant lima RPC (authenticated saja).
  2. `ensure_cv_document` (§1.1, §1.2): nilai awal, pemanggilan kedua tanpa write (revision/updated_at sama), `ONBOARDING_REQUIRED`, `AUTH_REQUIRED` untuk deleting, insert langsung kedua melanggar unique.
  3. Check constraint (§1.6): setiap pelanggaran dicoba sebagai `service_role`/superuser dan ditolak.
  4. `select_cv_source` (§1.3–§1.5, §1.12): draft/dismissed → `CV_SOURCE_INELIGIBLE`; confirmed dengan project → item project + achievement; dengan experience saja → item experience + achievement; parent sudah terpilih → tidak diduplikasi; duplikat → `CV_SOURCE_DUPLICATE`; sumber akun B dan ID acak → `CV_SOURCE_NOT_FOUND`; snapshot berisi field §3.2 persis (bandingkan himpunan key) dan tidak berisi kunci terlarang; `source_revision` = revision sumber; edit sumber sesudahnya tidak mengubah snapshot.
  5. Revision (§1.8): tiap RPC mutasi menaikkan revision CV tepat 1; revision basi → `STALE_REVISION` tanpa write.
  6. `remove_cv_item` (§1.11): `CV_CHILD_ITEMS_EXIST` + detail ID; `p_remove_children = true` menghapus keduanya; posisi kontigu setelah remove.
  7. `reorder_cv_section` (§1.10): swap dua item sukses; himpunan tidak cocok/duplikat/section lain → `CV_REORDER_INVALID`; posisi `1..n`.
  8. `update_cv_layout`: locale dan section_order valid tersimpan; invalid → `INVALID_CV_INPUT`.
  9. Penghapusan sumber (§1.13): untuk keenam fungsi delete yang ada, sumber terpilih dihapus sukses; item `source_deleted = true`, kolom sumber NULL, snapshot/posisi tetap; update item yang mengembalikan sumber → `CV_ITEM_IMMUTABLE`.
  10. Konfirmasi achievement lewat `save_achievement` tidak membuat item CV (§1.14).
- [ ] Pastikan `pnpm db:test` **FAIL** karena test baru. Tulis migration §3.1, lalu `pnpm exec supabase migration up --local`. **Dilarang** `db reset`.
- [ ] `pnpm db:test` (PASS; catat total file/assertion), `pnpm db:lint`, `pnpm db:types`, migration list (27/27).
- [ ] Commit `feat(t18): add CV documents, items and selection RPCs`, lalu receipt Fase 1. Checkpoint Claude opsional di sini.

### Fase 2 — Domain murni (TDD unit)

- [ ] Test gagal lebih dulu:
  - `cv-contracts`: `CV_SECTION_KEYS` sama persis dengan daftar SQL (tulis ulang daftar eksplisit di test); skema snapshot per tipe menerima contoh §3.2 dan menolak kunci terlarang (`raw_text`, `source_excerpt`, `contribution`); input RPC menolak UUID invalid, section asing, array reorder duplikat; `parseChildItemsDetail` menolak non-UUID.
  - `cv-selection`: `requiredParent` untuk achievement dengan project+experience → project; experience saja → experience; tanpa konteks/tipe lain → null; `isValidSectionOrder` dan `isValidReorder` untuk kasus valid/invalid.
  - `cv-outline`: achievement di bawah project terpilih; di bawah experience bila project tidak terpilih atau NULL; standalone di `achievements`; tiap achievement muncul sekali; urutan section mengikuti `section_order`; urutan item mengikuti `position`; item deleted diberi flag.
- [ ] Implementasi §3.3 bagian domain hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t18): add CV selection domain rules and outline`, receipt Fase 2.

### Fase 3 — Service dan action (TDD unit)

- [ ] Test gagal lebih dulu:
  - `cv-service`: tanpa session → `AUTH_REQUIRED`; pemetaan setiap kode DB §3.1 → kode service + `messageKey` + `correlationId` UUID; `CV_CHILD_ITEMS_EXIST` membawa daftar ID; `getSelectionPool` menyaring draft/dismissed dan menandai `selected`; pesan error tidak memuat teks sumber (sentinel).
  - `cv-actions`: validasi Zod, `revalidatePath('/cv')` hanya setelah sukses, error dikembalikan sebagai kode aman.
- [ ] Implementasi hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t18): add CV service and actions`, receipt Fase 3.

### Fase 4 — Integration nyata dan regresi penuh

- [ ] `tests/integration/cv-selection.test.ts` (setup seperti suite integration lain: admin, owner A/B sign-in nyata, onboarding lewat RPC nyata, sumber dibuat lewat RPC/service yang ada, bukan insert admin). Skenario wajib:
  1. Graduate tanpa employment (§1.1, §1.4): A membuat education, project akademik standalone, achievement confirmed ber-`project_id`; lima `ensure` paralel → satu CV; select achievement → item project + achievement; `getCv` outline menempatkan achievement di bawah project.
  2. Draft tidak eligible (§1.3) lewat service; setelah confirm lewat service achievement, select sukses.
  3. Duplikat dan parent sudah ada (§1.4, §1.5).
  4. Edit bersamaan (§1.9): dua client A, `expected_revision` sama, `reorder` vs `select` paralel ×3 putaran → tepat satu sukses per putaran, sisanya `STALE_REVISION`, tanpa `40P01`, posisi kontigu.
  5. Race sumber (§2.2.10–§2.2.11): `select_cv_source` vs `save_achievement` reopen, dan `select_cv_source`/`reorder` vs `delete_achievement`/`delete_experience` dengan dua koneksi nyata → hasil serial konsisten, tanpa deadlock; item yang tersisa valid (`source_deleted` benar).
  6. Penghapusan sumber (§1.13) lewat service domain lama (achievement/project/experience/skill) → item `source_deleted`, snapshot tetap.
  7. Isolasi (§1.7): B tidak melihat CV A, select sumber A → `CV_SOURCE_NOT_FOUND`, insert/update/delete langsung ke tabel CV ditolak untuk A dan B.
  8. Log hygiene (§1.15): sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>` di title/cv_bullet sumber tidak muncul di error, detail, atau respons error service.
- [ ] Tambah script `test:integration:cv` dan jalankan.
- [ ] Jalankan seluruh §7. `test:e2e:m2` dan `test:e2e:m3` wajib lulus tanpa melemahkan assertion env (kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk run itu). ClamAV dan Gotenberg wajib berjalan untuk suite yang membutuhkannya; bila tidak, catat **tidak dijalankan** beserta alasan. Flaky bawaan `activity-ui.spec.ts:356` dicatat sebagai flaky bila lulus saat diulang tanpa perubahan.
- [ ] Commit `test(t18): add real integration suite for CV selection`, receipt Fase 4 `docs/verification/T18-phase4-integration-regression.md`. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–4, output command, dan daftar acceptance yang belum terbukti.

### Fase 5 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0024-t18-cv-schema-selection.md`: keputusan §2.2 poin 1–17, kode error, urutan lock, alternatif yang ditolak (achievement disimpan di section parent, project auto-memilih experience, return idempoten untuk duplikat, FK `restrict`/`cascade` untuk sumber, `operation_requests` untuk ensure), seam T19 (RPC, outline, selection pool, override/summary columns), T20 (invalidasi + kenaikan revision CV saat delete/edit/reopen, refresh memakai `internal.cv_source_snapshot`, profile snapshot), T21 (`cv_exports` lease, urutan lock export).
- [ ] `docs/verification/T18-cv-schema-selection.md`: pass/fail/warning/tidak dijalankan, trace ke R09, F07, S13 (backend), DB §5/§6, dan setiap poin §1.
- [ ] README (bagian CV: schema, script baru, tabel quality gates).
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- Owner A (graduate): sudah onboarding, locale `id`, timezone `Asia/Jakarta`, tanpa experience. Education `Universitas Contoh / S1 Informatika` (tanggal tahun saja), project `Skripsi Sistem Antrian` (standalone, `completed`), achievement confirmed ber-`project_id` skripsi, satu achievement draft, satu achievement dismissed, skill `SQL`, certification tanpa tanggal.
- Owner A (employee, akun terpisah bila perlu): dua experience overlap (satu current), achievement confirmed ber-`experience_id` tanpa project, achievement confirmed standalone.
- Owner B: CV dan sumber sendiri untuk isolasi.
- Akun belum onboarding (untuk `ONBOARDING_REQUIRED`) dan akun `deleting` (pgTAP).
- Sentinel privat: `WP-PRIVATE-CV-SENTINEL-<uuid>` di title/cv_bullet achievement A.
- Setiap test membersihkan akun fixture seperti suite integration lain.

## 7. Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm exec supabase migration list --local
pnpm test:integration:cv
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:activity
pnpm test:integration:dashboard
pnpm test:integration:import-commit
pnpm test:integration:import-review
pnpm test:integration:import
pnpm test:integration:m2
pnpm test:integration:m3
pnpm test:integration:ai
pnpm test:integration:ai-review
pnpm test:integration:evidence
pnpm test:integration:storage
pnpm test:e2e:achievements
pnpm test:e2e:projects
pnpm test:e2e:dashboard
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:import
pnpm test:e2e:import-review
pnpm test:e2e:ai
pnpm test:e2e:ai-review
pnpm test:e2e:evidence
pnpm test:e2e:m2
pnpm test:e2e:m3
pnpm worker:check
pnpm build
git diff --check
```

`test:integration:cv` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan (di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong). Muat env Supabase lokal (`.env.local` + key) dalam command yang sama dengan suite (env PowerShell tidak bertahan antar command). Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`. Untuk edit file ber-karakter non-ASCII gunakan tool Edit, bukan `Set-Content`.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, atau parity bukan 26/26.
- Penyelesaian memerlukan `db reset`, rewrite migration lama, kolom baru di tabel canonical, atau mengubah RPC/trigger T02–T17.
- FK `on delete set null` membuat salah satu fungsi delete lama gagal atau mengubah hasil pgTAP/integration lama dan tidak bisa dipulihkan tanpa mengubah fungsi tersebut.
- Trigger `before update` tidak terpicu oleh aksi FK sehingga check `cv_items_source_check` gagal saat delete sumber (laporkan; jangan menghapus check).
- Race memicu deadlock yang hanya bisa dihilangkan dengan mengubah urutan lock fungsi lama.
- Implementasi terasa memerlukan UI S13, tombol *Add to CV*, override/summary editing, freshness/refresh/acknowledgement, invalidasi CV di fungsi mutasi lama, atau export (T19–T22).
- Implementasi ternyata menuntut penyimpangan dari keputusan yang sudah disetujui pengguna (§2.2.5, §2.2.7, §2.2.9, §2.2.12). Laporkan alasan dan alternatifnya, lalu tunggu keputusan; jangan mengubahnya sendiri.
- Test membutuhkan key nyata, atau sentinel muncul di output.

## 9. Gate review Claude (setelah Fase 4)

Review read-only mencakup:

- Tidak ada write klien langsung ke tabel CV; lima RPC saja, grant dan `security definer`/`search_path` benar; RLS select own di tiga tabel.
- Satu CV per akun terbukti termasuk paralel; onboarding wajib.
- Eligibility hanya confirmed, dicek di bawah lock; konfirmasi tidak menyisipkan ke CV.
- Parent otomatis sesuai §2.2.5, tanpa duplikasi; penghapusan parent membutuhkan keputusan eksplisit.
- Check section/sumber, unique per tipe, unique posisi deferrable benar; posisi kontigu.
- Setiap mutasi RPC menaikkan revision CV tepat sekali dan dijaga `expected_revision`.
- Snapshot hanya field tampilan; tidak ada teks sumber privat atau evidence.
- Delete sumber lama tetap berfungsi dan item menjadi `source_deleted` dengan snapshot utuh; tidak ada lock `cv_documents` dari jalur delete.
- Urutan lock konsisten; test race tanpa deadlock.
- Error hanya kode dan ID; tidak ada teks sumber di log/detail/response.
- Tidak ada UI S13 prematur atau fitur roadmap (target job, variants, AI selection).

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Delete sumber lama rusak.** FK dibuat `restrict`/tanpa aksi, atau trigger guard menolak update dari aksi FK, sehingga `delete_achievement`/`delete_experience` gagal saat sumber terpilih. Dijaga pgTAP 9 dan integration 6.
2. **Draft lolos ke CV lewat race.** Status achievement dicek tanpa lock sehingga reopen bersamaan menyisipkan draft. Dijaga §2.2.11, pgTAP 4, integration 5.
3. **Revision CV tidak naik atau naik ganda.** Select yang membuat parent menaikkan revision dua kali, atau reorder menaikkan per item, sehingga token `expected_revision` klien T19 tidak cocok. Dijaga pgTAP 5.
4. **Concurrent first open membuat dua CV atau error.** `ensure` memakai select-then-insert tanpa `on conflict`, sehingga paralel menghasilkan `23505`. Dijaga integration 1 (paralel ×5).
5. **Snapshot membocorkan teks privat.** `internal.cv_source_snapshot` memakai `to_jsonb(row)` utuh sehingga `source_excerpt`/`contribution` ikut. Dijaga pgTAP 4 (himpunan key persis) dan unit skema `.strict()`.
6. **Reorder melanggar unique posisi.** Constraint tidak deferrable atau tidak di-defer dalam fungsi, sehingga swap gagal. Dijaga pgTAP 7 dan integration 4.

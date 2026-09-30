# Handoff T19 CV builder dan overrides — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi. Semua nama tabel, kolom, fungsi, kode error, key i18n, dan path di dokumen ini **dibekukan**; jangan mengganti namanya.

- Tanggal: 30 September 2026
- Status saat plan ditulis: **TODO**.
- Dependensi: T18 **DONE** (schema CV, lima RPC seleksi, domain `src/domain/cv`, `cv-service.ts`, tanpa UI; `docs/verification/T18-cv-schema-selection.md`) dan T04 **DONE** (design system, app frame). T09 (achievement), T08 (project), T12, Gate M3 **DONE/PASSED**.
- Eksekutor: satu agent **Claude Sonnet 5.5**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 5; Fase 6 (draft dokumen) dikerjakan setelah gate. Checkpoint setelah Fase 1 bersifat opsional.
- Keputusan produk: **§2.2.3, §2.2.4, §2.2.5, dan §2.2.7 menunggu persetujuan pengguna** sebelum Fase 1 (lihat §2.4). Pelaksana **berhenti** di akhir Fase 0 sampai persetujuan tercatat di receipt Fase 0.
- Acuan:
  - PRD R09 (pilih dan urutkan; edit summary dan wording item), *CV freshness contract* (hanya bagian override dan pool; freshness = T20), *Shared validation*, release scenario *Onboard a graduate with no CV and no employment …* (sampai penyusunan CV; export = T21/T22) dan *Edit a selected achievement after manual CV wording changes …* (bagian override; refresh = T20).
  - User Flow F07 langkah 1–2 (locale label id/en, template satu kolom A4, urutan section dan item, layout awal dari sumber tanpa AI), F03 (*Add to CV* membuka S13 dengan record disorot; confirm saja tidak menyisipkan).
  - Wireframe S13 (`/cv`): selection/editor kiri, preview kanan; education, projects, skills, certifications; child memasukkan parent; override hanya wording CV; kontrol *move* aksesibel; state unsaved/saved/manual override/deleted source; satu master CV; pola *Forms* dan *Responsive behavior* (360 px menumpuk panel di bawah editor, 1440 px berdampingan).
  - Database Schema §5 `cv_documents`/`cv_items` (`summary_override`, `override_text`, `profile_snapshot`), *Selection and freshness invariants* (override tidak menimpa snapshot), *Editing any CV child item increments its parent CV revision*; §6 test *simultaneous CV edits*.
  - `IMPLEMENTATION_PLAN.md` §3 *CV*, §4 baris *CV consistency … lock protocol*, blok T19 di §5, dan T20–T22 untuk batas.
  - `docs/decisions/0024-t18-cv-schema-selection.md` (bagian *Seam* T19), `docs/verification/T18-gate-review.md` (P3 F2), `Design.md` (compact rows, satu aksi utama, split layout, reduced motion).

**Goal:** Halaman `/cv` (S13) menjadi builder nyata. Pengguna membuka master CV (dibuat otomatis, satu per akun), memilih record dari selection pool ke enam section, melihat item terpilih dengan parent-child yang benar, memindahkan item dan section naik/turun lewat kontrol aksesibel, memilih label locale CV (`en`/`id`), mengedit judul, summary, dan contact tampilan, serta menulis wording override per item — semuanya tanpa mengubah record canonical maupun `source_snapshot`. Perubahan teks disimpan lewat aksi **Save** eksplisit dengan `expected_revision`; edit bersamaan yang basi ditolak tanpa menimpa dan input lokal dipertahankan. Preview di kanan selalu dibangun dari CV **tersimpan**, bukan draft lokal. *Add to CV* di detail achievement hanya membuka `/cv` dengan record disorot. Seorang lulusan tanpa employment yang punya education, project, dan achievement confirmed dapat menyusun CV yang berguna. Tidak ada AI, export, atau freshness.

**Architecture:** Satu migration forward-only menambah RPC `save_cv_edits` (satu transaksi, satu kenaikan revision) di atas schema T18; tidak ada tabel atau kolom baru. Domain murni menambah `labels`, `resolve` (nilai efektif override vs sumber), `preview` (view model yang akan dipakai ulang T21/T22), dan `draft` (reconcile konflik, hitung move). Service menambah `saveEdits`; server action `saveCvEditsAction` dan perbaikan correlation ID (P3 F2). UI: server component `/cv` memuat CV lewat service dan merender client component `CvBuilder` (selection panel, selected list, editor item, editor profil, kontrol layout, preview). Seleksi, hapus, reorder, dan layout tetap operasi langsung (RPC T18); hanya teks yang memakai draft lokal + Save.

**Tech stack:** Next.js App Router (server component + server action), React 19 client component, TypeScript strict, Zod 4, Tailwind 4 dengan primitives `src/components/ui`, lucide-react, Supabase PostgreSQL 17 (plpgsql `security definer`, pgTAP), Vitest (unit, komponen, integration nyata), Playwright + axe-core, pnpm dari lockfile. Tidak ada dependency baru.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md` (T18), `docs/IMPLEMENTATION_PLAN.md` §1–§4 dan blok M4, decision 0024 (terutama *Seam*), `docs/verification/T18-cv-schema-selection.md`, `T18-gate-review.md`, `docs/verification/T17-implementation-plan.md` sebagai pola fase UI + browser, dan `Design.md` (bagian layout, form, responsive, aksesibilitas). Ekstrak ulang PRD R09/*CV freshness contract*, F07, F03, S13, dan DB §5/§6 dengan alat ekstraksi DOCX (mis. `python` + `zipfile` atas `word/document.xml`; `python-docx` **tidak** terpasang); jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R09:** pilih dan urutkan experience, projects, confirmed achievements, education, skills, certifications; edit summary dan wording item. (Refresh dari perubahan sumber = T20.)
- **PRD freshness:** konfirmasi achievement hanya menambah selection pool, tidak diam-diam menambahkan ke CV. Refresh tidak menimpa override; Replace hanya eksplisit (T20). PDF yang sudah diunduh tidak berubah.
- **F07:** first open membuat CV unik; label id/en; template satu kolom A4; pilih record dan urutkan section serta item; child memasukkan parent; layout awal dari data sumber tanpa AI. Preview memakai revision tersimpan yang persis sama (S14/T22).
- **F03:** *Add to CV* membuka S13 dengan record disorot untuk dipilih; confirm saja tidak menyisipkannya.
- **S13:** kiri selection/editor, kanan preview; kontrol *move* aksesibel (drag opsional); override hanya mengubah wording CV; state unsaved, saved, manual override, deleted source; satu master CV, tanpa duplikasi, tanpa input lowongan atau matching.
- **DB §5:** override hidup di `cv_items.override_text` dan `cv_documents.summary_override`; `source_snapshot` tidak ditulis ulang oleh edit wording; mengedit child item CV menaikkan revision CV induk; edit contact tampilan disimpan di `profile_snapshot`.
- **Rencana §5 T19 (kalimat selesai):** graduate dengan education/project bisa menyusun CV, manual wording tidak mengubah canonical record, parent removal menangani child, stale concurrent edit tidak overwrite.

Pertahankan perubahan lokal pengguna. Jangan menandai T19 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T19-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka yang ditulis harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T19

T19 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **First open.** Akun sudah onboarding yang membuka `/cv` mendapat tepat satu master CV (dua tab paralel tidak membuat dua) dengan locale awal = locale profil, judul `Master CV`, tanpa item terpilih otomatis (selection pool terisi, CV kosong dengan empty state yang menawarkan aksi *Add*). Dibuktikan integration + E2E.
2. **Selection.** Pengguna memilih record dari pool untuk keenam section; draft/dismissed tidak muncul di pool; memilih achievement kontekstual otomatis menambahkan parent (tampil di daftar dan preview); duplikat tidak ditawarkan (tombol berubah menjadi *Added* tanpa aksi). Dibuktikan unit komponen + E2E.
3. **Struktur parent-child.** Achievement muncul tepat sekali: di bawah project terpilih, selain itu experience terpilih, selain itu di section *Achievements*; sama di daftar editor dan preview. Dibuktikan unit `buildCvPreviewModel` dan E2E.
4. **Move aksesibel.** Setiap item dan setiap section punya tombol *Move up*/*Move down* dengan label yang menyebut nama item/section, `disabled` di tepi, hasil diumumkan lewat live region, dan fokus tetap pada tombol item yang dipindah setelah render ulang. Semua dapat dijalankan hanya dengan keyboard. Reorder achievement kontekstual bergerak di dalam grup parent-nya. Dibuktikan unit `computeItemMove`/`computeSectionMove`, unit komponen, dan E2E keyboard.
5. **Locale CV.** Pemilih *CV language* (English / Bahasa Indonesia) menyimpan `locale` lewat `update_cv_layout`; label section dan format tanggal preview berubah, **konten sumber tidak diterjemahkan**. Locale UI aplikasi tidak berubah. Dibuktikan unit preview dan E2E.
6. **Override wording terpisah.** Edit `override_text` per item (experience, project, achievement, education) menyimpan hanya `cv_items.override_text`; `source_snapshot`, `source_revision`, dan seluruh record canonical (revision dan isi) tidak berubah; menghapus isi override mengembalikan wording sumber. Skill dan certification tidak punya override (`CV_OVERRIDE_UNSUPPORTED`). Dibuktikan pgTAP dan integration.
7. **Summary, judul, contact.** Edit `title` (nonblank ≤ 120), `summary_override` (≤ 5000), dan override tampilan `display_name`/`headline`/`contact_email`/`phone`/`location`/`website` tersimpan di `cv_documents` (`profile_snapshot.display_overrides`, keputusan §2.2.5); nilai `profile_snapshot` sumber (`display_name`, `summary`, dll.) dan `profile_source_revision` tidak berubah; kosong = kembali ke nilai sumber. Website hanya `http/https`. Dibuktikan pgTAP dan unit.
8. **Save eksplisit + revision guard.** Semua edit teks disimpan lewat satu RPC `save_cv_edits` dengan `expected_revision`: satu transaksi, revision CV naik **tepat satu** untuk seluruh batch, batch invalid tidak menulis apa pun, batch tanpa perubahan efektif tidak menulis dan tidak menaikkan revision. Dibuktikan pgTAP.
9. **Tidak menimpa edit basi.** Dua sesi memegang revision sama: satu `save_cv_edits`/mutasi sukses, yang lain `STALE_REVISION` tanpa write dan tanpa `40P01`. UI menampilkan state konflik, **mempertahankan input lokal**, memuat ulang data tersimpan, dan untuk setiap field yang berubah di server sejak draft dimulai meminta pilihan *Keep mine* / *Use saved* sebelum Save diaktifkan lagi. Dibuktikan integration (dua koneksi nyata), unit `reconcileDraft`, dan E2E dua konteks browser.
10. **Parent removal.** Menghapus item parent yang punya child achievement membuka dialog yang menyebut child (judul dari daftar, bukan dari error), dengan pilihan *Remove parent and its achievements* atau *Cancel*; tidak ada penghapusan diam-diam. Item non-parent dihapus langsung. Fokus kembali ke elemen logis sesudah dialog/hapus. Dibuktikan unit komponen dan E2E.
11. **Preview dari saved.** Panel preview hanya membaca CV tersimpan (dokumen + item dari server); teks draft lokal yang belum disimpan **tidak** muncul di preview, dan badge *Unsaved changes* tampil selama draft berbeda. Setelah Save, preview berubah. Dibuktikan unit komponen dan E2E.
12. **State.** Tampil dan diuji: loading (skeleton), empty (CV kosong, pool kosong), error aman (kode + correlation ID), disabled/pending saat submit, saved (dengan waktu/teks status non-warna), unsaved, conflict, manual override (badge teks + isi override), dan deleted source (badge *Source deleted*, snapshot tetap tampil, aksi Remove tersedia). State *changed source* dan *unconfirmed source* **belum** ada (T20).
13. **Add to CV.** Detail achievement `confirmed` menampilkan tautan *Add to CV* ke `/cv?highlight=<id>`; `/cv` menyorot dan memfokuskan entri pool tersebut tanpa menambahkannya; achievement draft/dismissed tidak menampilkan tautan; parameter tidak valid/ milik akun lain/ sudah terpilih diabaikan dengan aman (tanpa membocorkan keberadaan). Dibuktikan unit dan E2E.
14. **Graduate journey.** Graduate tanpa employment: education + project akademik + achievement confirmed ber-project → CV tersusun (education, project dengan achievement di bawahnya, skill), urutan diubah, wording override ditulis, dan record canonical tidak berubah. Dibuktikan E2E + integration.
15. **Aksesibilitas dan responsive.** `/cv` lulus axe (0 pelanggaran serius/kritis) pada 360 px dan 1440 px, light dan dark; layout 1440 px berdampingan (editor kiri, preview kanan), 360 px preview di bawah editor tanpa scroll horizontal; label form terlihat; fokus pada field pertama yang tidak valid; `prefers-reduced-motion` dihormati. Dibuktikan E2E + axe.
16. **Tanpa perubahan perilaku lama.** T18 tetap lulus tanpa melemahkan assertion (pgTAP, `test:integration:cv`), begitu pula seluruh suite T02–T17 dan gate M2/M3. Konfirmasi achievement tetap tidak membuat item CV. Tidak ada export, freshness, atau AI.
17. **Log hygiene.** Error, detail, respons service/action, dan log tidak memuat teks CV/sumber (sentinel = 0); correlation ID di respons error action = ID yang dipakai service (menutup P3 F2). Tidak ada `console.` di `src/features/cv`. Dibuktikan integration + unit + grep.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration forward-only T19 (RPC `save_cv_edits`) dan pgTAP `cv_builder.test.sql`.
- Domain `src/domain/cv/{labels,resolve,preview,draft}.ts` dan perluasan `contracts.ts`.
- Service `saveEdits`, action `saveCvEditsAction`, perbaikan correlation ID, pemetaan error baru, kunci i18n en/id untuk UI S13.
- UI S13: route `/cv` (server) + komponen `src/features/cv/*`, tautan *Add to CV* pada detail achievement.
- Integration `cv-builder.test.ts`, E2E `cv-builder.spec.ts`, script baru, decision 0025, receipt.

### 2.2 Keputusan implementasi

1. **Satu RPC penyimpanan teks: `public.save_cv_edits(p_expected_revision integer, p_edits jsonb) returns integer`.** `p_edits` berisi key opsional (minimal satu): `title`, `summary_override`, `profile_overrides` (objek), `item_overrides` (array `{item_id, override_text}`); key asing → `INVALID_CV_INPUT`. Nilai `null`/string kosong-setelah-trim pada `summary_override`, field `profile_overrides`, atau `override_text` berarti **hapus override** (kembali ke sumber); `title` kosong → `INVALID_CV_INPUT`. Lock: profil `for share` → `cv_documents` `for update` → item yang disentuh `for update` (urut `id`) — sama dengan protokol T18 (decision 0024 poin 10); tidak menyentuh tabel sumber. Satu panggilan sukses menaikkan revision CV sekali; bila tidak ada perubahan efektif, tidak ada write dan revision tidak naik (mengembalikan revision saat ini). *Alasan:* rencana §5 meminta save state eksplisit dan revision guard; satu batch atomik mencegah setengah tersimpan; tidak menaikkan revision untuk no-op menghindari konflik palsu.
2. **Batas panjang dan validasi.** `title` ≤ 120; `summary_override` ≤ 5000; `override_text` ≤ 2000 (selaras check T18); `profile_overrides`: `display_name` ≤ 120, `headline` ≤ 160, `contact_email` ≤ 254 dan berformat email sederhana, `phone` ≤ 40, `location` ≤ 120, `website` ≤ 2048 dan skema `http`/`https`. **Fase 0 wajib memverifikasi** batas profil yang sudah ada di `profiles` (T03) dan menyamakannya; jika berbeda, ikuti profil dan catat. Semua nilai di-trim server; teks tidak pernah masuk pesan error.
3. **Override hanya untuk item bertipe experience, project, achievement, education (MENUNGGU PERSETUJUAN).** `override_text` menggantikan tampilan wording item: description (experience/project/education) atau `cv_bullet` (achievement). Skill dan certification hanya label → `CV_OVERRIDE_UNSUPPORTED`. Item `source_deleted` tetap boleh diedit (snapshot dipertahankan; state ditangani T20). *Alasan:* S13 "override hanya mengubah wording CV"; label skill/certification bukan wording; menahan cakupan.
4. **Kosong dulu, tanpa auto-selection (MENUNGGU PERSETUJUAN).** Master CV baru tidak berisi item; pengguna memilih dari pool. Tidak ada tombol *Add all*. *Alasan:* PRD freshness "tanpa diam-diam menambahkan ke CV" dan larangan AI auto-selection; "layout awal dari sumber tanpa AI" dipenuhi oleh section order default + profile snapshot + snapshot item yang diambil dari sumber. Bulk-add adalah tambahan kenyamanan yang ditunda (catat di decision).
5. **Override profil disimpan di `profile_snapshot.display_overrides` (MENUNGGU PERSETUJUAN).** Objek opsional dengan key `display_name`, `headline`, `contact_email`, `phone`, `location`, `website`; nilai sumber (`cv-profile.v1` dari T18) **tidak diubah**. `summary_override` tetap kolom sendiri. Schema tetap `cv-profile.v1` (tambahan aditif, Zod `.strict()` diperbarui). *Alasan:* DB §5 menyimpan contact display edit di `profile_snapshot`; memisahkan salinan sumber dari override agar T20 dapat melakukan Refresh/Replace tanpa kehilangan wording pengguna. Tidak ada migration kolom.
6. **Operasi struktural tetap langsung.** `select`, `remove`, `reorder`, `update_cv_layout` memakai RPC T18 apa adanya (satu revision per panggilan). Teks memakai draft lokal + Save. Draft lokal bertahan lintas re-render akibat operasi struktural; `expected_revision` selalu diambil dari revision server terbaru. *Alasan:* menghindari perubahan RPC T18; struktur berdampak lintas item sehingga tidak boleh menggantung sebagai draft.
7. **Preview hanya dari saved (MENUNGGU PERSETUJUAN atas batas ini).** View model `buildCvPreviewModel({document, items})` menerima data dari server. Komponen preview tidak menerima draft. Tidak ada halaman `/cv/preview` (S14 = T22) dan tidak ada pagination A4; preview S13 adalah tampilan layar satu kolom yang mengikuti template `single_column_v1`. Model ini yang dipakai ulang T21/T22.
8. **Label dan tanggal CV bukan i18n UI.** `src/domain/cv/labels.ts` memuat label section, "Present"/"Sekarang", dan bulan untuk locale CV (`en`/`id`) tanpa bergantung pada locale UI. Format tanggal: year → `2024`; month → `Mar 2024`/`Mar 2024` via `Intl.DateTimeFormat` dengan locale CV dan `timeZone: 'UTC'`; day → tanggal penuh; NULL tidak ditampilkan (tanpa placeholder); `is_current` → *Present*/*Sekarang*. Salin kunci UI (tombol, status, error) tetap di `src/i18n/messages.ts` (en + id).
9. **Move logika murni.** `computeItemMove(items, itemId, direction)` mengembalikan daftar ID section baru: untuk achievement kontekstual bergerak hanya di antara saudara sebaris (parent sama, per aturan outline) dengan menukar posisi keduanya di dalam daftar section; item lain bergerak di antara tetangga section. `computeSectionMove(order, key, direction)` menukar dua key. Hasilnya dikirim ke `reorder_cv_section`/`update_cv_layout`. Drag-and-drop **tidak** diimplementasikan.
10. **Reconcile konflik di klien.** `reconcileDraft({ base, draft, server })` (murni) mengembalikan per field: `unchanged`, `mine` (server sama dengan base), atau `conflict` (server berbeda dari base dan draft berbeda dari server). Field `conflict` menuntut pilihan *Keep mine*/*Use saved* sebelum Save aktif; field lain otomatis diteruskan. Jaminan keras tetap `STALE_REVISION` di database; ini hanya cara UI tidak menimpa diam-diam.
11. **First open lewat service di server component.** `/cv` memanggil `createCvService(...).ensure()` (idempoten, `on conflict`) lalu `getCv` dan `getSelectionPool`; tanpa `revalidatePath` di render. Query `?highlight=` divalidasi (UUID) dan dicocokkan hanya terhadap pool milik sesi.
12. **Add to CV.** Tautan biasa (`<Link>`) di `achievement-detail.tsx`, hanya bila status `confirmed`. Tidak ada write. Sorotan = `aria-current`/badge teks *Suggested* + fokus + `scrollIntoView` yang menghormati reduced motion.
13. **Perbaikan P3 F2.** `run()` di `src/features/cv/actions.ts` membuat satu `correlationId` dan meneruskannya ke service **dan** `failure()`; test unit membuktikan ID error = ID service.
14. **Nomor.** Migration `supabase/migrations/20261003090000_t19_cv_builder_overrides.sql` (parity 28/28). Decision `docs/decisions/0025-t19-cv-builder-overrides.md`. pgTAP `supabase/tests/database/cv_builder.test.sql`. Integration `tests/integration/cv-builder.test.ts` (script baru `test:integration:cv-builder`). E2E `tests/e2e/cv-builder.spec.ts` (script baru `test:e2e:cv`, `playwright.cv.config.ts`, port **3012** — Fase 0 memverifikasi port bebas; port 3000–3011 sudah dipakai suite lain).
15. **Komponen UI memakai primitives yang ada.** `Button`, `Card`, `Badge`, `Dialog`, `EmptyState`, `Skeleton`, `InlineError`, `FieldControl`, `RevisionConflict`/`conflict-controls`, `ActionFeedback`, `SubmitButton`, `unsaved-changes`, `session-draft` dari `src/components/{ui,forms}`; ikon hanya lucide-react. Tidak ada primitive baru kecuali diperlukan dan dicatat.

### 2.3 Di luar scope

- Freshness (changed/override-dengan-perubahan-sumber/unconfirmed), *Keep saved wording*, Refresh/Replace, acknowledgement, invalidasi CV pada mutasi/delete sumber, dashboard *CV needs review* → **T20**.
- Validasi export, request export, snapshot immutable, worker PDF → **T21**. Halaman `/cv/preview`, page boundary, download, regenerate → **T22**.
- Perubahan RPC/trigger T02–T18 dan tabel canonical; kolom baru di tabel CV.
- Drag-and-drop, bulk-add, template lain, target job, CV variants, AI auto-selection atau AI rewrite, evidence di CV.
- Copy S13 untuk state *changed source* dan *unconfirmed source*.

### 2.4 Keputusan yang perlu dikonfirmasi pengguna sebelum Fase 1

Tanyakan/catat di receipt Fase 0 (pelaksana **berhenti** sampai ada jawaban):

1. §2.2.3 override hanya untuk experience/project/achievement/education (skill dan certification tidak).
2. §2.2.4 CV baru kosong tanpa auto-selection dan tanpa *Add all*.
3. §2.2.5 override profil di `profile_snapshot.display_overrides` (bukan kolom baru).
4. §2.2.7 preview S13 hanya tampilan layar dari data tersimpan; tanpa halaman `/cv/preview` dan pagination A4 di T19.

Rekomendasi: setujui keempatnya.

## 3. Kontrak teknis

### 3.1 Migration `20261003090000_t19_cv_builder_overrides.sql`

Forward-only; **tidak** mengubah objek T18. Isi:

1. Helper `internal.cv_profile_overrides_valid(p jsonb) returns boolean` (`immutable`, `set search_path = pg_catalog`): objek, key ⊆ enam key §2.2.5, nilai string nonblank berbatas panjang §2.2.2, `website` http/https. Grant execute `authenticated, service_role`.
2. Check constraint pada `cv_documents` (aditif): `cv_documents_profile_overrides_check` — `profile_snapshot -> 'display_overrides'` bernilai NULL atau lolos helper. (Bila `add constraint … not valid` tidak diperlukan karena tabel hanya berisi data T18, gunakan constraint biasa; Fase 0 memeriksa tidak ada `display_overrides` di data lokal.)
3. `public.save_cv_edits(p_expected_revision integer, p_edits jsonb) returns integer` — `security definer`, `set search_path = pg_catalog`, identifier ter-qualify, `raise exception using errcode = 'P0001', message = '<CODE>'` mengikuti pola T18 (pakai persis pola errcode/`detail` yang T18 pakai). `revoke execute … from public, anon, service_role`; `grant execute … to authenticated`; `comment on function`. Perilaku:
   - `auth.uid()` wajib; profil `for share`, tidak ada/deleting → `AUTH_REQUIRED`; belum onboarding → `ONBOARDING_REQUIRED`.
   - `p_expected_revision`/`p_edits` NULL, bukan objek, kosong, key asing → `INVALID_CV_INPUT`.
   - Lock `cv_documents` `for update`; tidak ada → `CV_NOT_FOUND`; revision basi → `STALE_REVISION` (sebelum validasi isi).
   - Validasi isi §2.2.2; pelanggaran → `INVALID_CV_INPUT` (tanpa teks nilai di pesan/detail). `item_overrides`: maksimal 200 entri, tanpa `item_id` ganda; item bukan milik CV pengguna → `CV_ITEM_NOT_FOUND` (sama untuk ID acak dan milik akun lain); tipe skill/certification (`skill_id`/`certification_id` non-NULL atau `section_key in ('skills','certifications')`) dengan override non-null → `CV_OVERRIDE_UNSUPPORTED`; menghapus override pada item tanpa override bukan pelanggaran.
   - Lock item yang disentuh `for update` urut `id`. Hitung perubahan efektif dengan `is distinct from`; tanpa perubahan → return revision saat ini, tanpa write. Ada perubahan → update kolom terkait (`title`, `summary_override`, `profile_snapshot` dengan `display_overrides` diganti utuh atau key dihapus; objek kosong → key `display_overrides` dihapus), update `override_text` item, lalu **satu** update `cv_documents` (trigger `touch_mutable_row` menaikkan revision sekali). `source_snapshot`, `source_revision`, `acknowledged_revision`, dan kolom sumber tidak disentuh.
4. Kode error baru: `CV_OVERRIDE_UNSUPPORTED`. Kode T18 dipakai ulang. Fase 0 memeriksa daftar kode dan pemetaan di `src/domain/cv/contracts.ts` (`CV_ERROR_CODES`) dan `cv-errors.ts`.
5. Tidak ada grant tulis klien baru; RLS T18 cukup.
6. `pnpm db:types` memperbarui `src/server/supabase/database.types.ts`.

### 3.2 Domain

- `contracts.ts` (ubah): `CV_ERROR_CODES` + `CV_OVERRIDE_UNSUPPORTED`; `cvProfileSnapshotSchema` `.strict()` dengan `display_overrides` opsional; `profileOverridesSchema`; `saveCvEditsInput` (`expectedRevision`, `title?`, `summaryOverride?: string|null`, `profileOverrides?: Record<key, string|null>`, `itemOverrides?: {itemId, overrideText: string|null}[]`, minimal satu edit, batas §2.2.2); `cvDocumentRowSchema` disesuaikan.
- `labels.ts`: `CV_LABELS[locale]` (heading enam section, `present`, `unknownDate` tidak ada — sengaja tanpa placeholder), `formatCvDateRange(item, locale)`, `formatCvPartialDate(date, precision, locale)`.
- `resolve.ts`: `resolveItemText(item)` = `override_text ?? bullet/description snapshot`; `resolveProfile(document)` = sumber digabung `display_overrides`; `resolveSummary(document)`; `hasOverride(item)`.
- `preview.ts`: `buildCvPreviewModel({ document, items })` → `{ locale, profile, summary, sections: [{ key, heading, entries: [{ itemId, type, headline, subline, dates, text, deleted, hasOverride, children: [...] }] }] }` memakai `buildCvOutline` (T18), tanpa I/O; section kosong tidak dirender; urutan mengikuti `section_order` lalu `position`.
- `draft.ts`: `CvDraft` (`title`, `summary`, `profile`, `items: Record<id, string>`), `diffDraft(base, draft)`, `reconcileDraft`, `toSaveInput`, `computeItemMove`, `computeSectionMove`, `isDirty`.

### 3.3 Service, action, i18n

- `cv-service.ts`: `saveEdits(input)` (Zod, memanggil `save_cv_edits`, memvalidasi revision balik, memetakan error dengan `correlationId`). `getCv` dan `getSelectionPool` tidak berubah; sorotan `?highlight=` ditangani halaman.
- `cv-errors.ts`: kode `OVERRIDE_UNSUPPORTED` → `messageKey` `cv.error.overrideUnsupported`; pemetaan action ke `ErrorCode` (`VALIDATION`).
- `actions.ts`: `saveCvEditsAction` (Zod, origin/validasi seperti action lain, `revalidatePath('/cv')` hanya setelah sukses); perbaikan §2.2.13.
- `src/i18n/messages.ts`: kunci `cv.*` **en dan id** (judul halaman, selection panel, section, tombol Add/Added/Move/Remove, status Saved/Unsaved/Saving, badge Manual wording/Source deleted/Suggested, dialog parent removal, konflik, empty/error, live region). Kunci baru wajib ada di kedua bahasa (test parity yang sudah ada).

### 3.4 UI S13 (`/cv`)

Server component `src/app/(workspace)/cv/page.tsx`: `requireCompletedWorkspace('/cv')` → service `ensure/getCv/getSelectionPool` → `<CvBuilder … />`. State loading lewat `loading.tsx` (skeleton) dan error boundary aman.

Layout: judul halaman + status simpan; 1440 px dua kolom (editor/selection kiri, preview kanan sticky); 360 px satu kolom, preview di bawah editor. Panel editor berisi (bawah judul): (a) bar **Save** (aksi utama tunggal, badge *Unsaved changes*/*All changes saved*, `aria-live="polite"`); (b) **CV settings** (judul, CV language, urutan section dengan move up/down); (c) **Profile on CV** (display name, headline, email, phone, location, website, summary — dengan nilai sumber sebagai placeholder dan aksi *Use profile value*); (d) per section: daftar item terpilih (compact row, badge tipe/state, editor wording *Edit wording* yang membuka textarea dengan panjang maks, *Use source wording*, move up/down, *Remove*) dan daftar **Available to add** dari pool (tombol *Add* → *Added*). Achievement kontekstual tampil menjorok di bawah parent.

Komponen (path §4). Dialog parent removal memakai `Dialog` (fokus terperangkap, Escape, fokus kembali ke pemicu atau ke item berikutnya bila pemicu hilang). Live region terpusat untuk hasil move/add/remove/save.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20261003090000_t19_cv_builder_overrides.sql`, `supabase/tests/database/cv_builder.test.sql` |
| Modify | `src/server/supabase/database.types.ts` (`db:types`) |
| Create | `src/domain/cv/{labels,resolve,preview,draft}.ts` |
| Modify | `src/domain/cv/contracts.ts`, `src/features/cv/{cv-service,cv-errors,actions}.ts`, `src/i18n/messages.ts` |
| Create | `src/features/cv/{cv-builder,cv-settings,cv-profile-editor,cv-section-list,cv-item-row,cv-pool-list,cv-remove-dialog,cv-conflict-panel,cv-preview,cv-save-bar}.tsx` (nama boleh digabung bila kecil; jangan menambah abstraksi spekulatif) |
| Modify | `src/app/(workspace)/cv/page.tsx`; Create `src/app/(workspace)/cv/loading.tsx` |
| Modify | `src/features/achievement/achievement-detail.tsx` (tautan *Add to CV*) |
| Create | `tests/unit/{cv-labels,cv-resolve,cv-preview,cv-draft}.test.ts`, `tests/unit/cv-builder-ui.test.tsx`, perluas `tests/unit/{cv-contracts,cv-service,cv-actions}.test.ts` |
| Create | `tests/integration/cv-builder.test.ts`, `tests/e2e/cv-builder.spec.ts`, `playwright.cv.config.ts` |
| Modify | `package.json` (script baru), `README.md` (Fase 6) |
| Create (Fase 6) | `docs/decisions/0025-t19-cv-builder-overrides.md`, `docs/verification/T19-cv-builder-overrides.md` |

Script baru:

- `test:integration:cv-builder` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/cv-builder.test.ts`
- `test:e2e:cv` → `playwright test --config playwright.cv.config.ts tests/e2e/cv-builder.spec.ts`

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD. Working tree harus bersih kecuali `.claude/`. Jika tidak, **stop**.
- [ ] `pnpm install --frozen-lockfile`, `pnpm db:status`, `pnpm exec supabase migration list --local`. Parity harus **27/27** dengan migration terakhir `20261002090000_t18_cv_schema_selection.sql`. Bila Docker mati, nyalakan dan `pnpm db:start` (tanpa reset).
- [ ] Baseline `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan 81 file / 575 test), `pnpm db:test` (harapan 12 file / 909 assertion), `pnpm test:integration:cv` (harapan 10), `pnpm test:integration:achievements` (harapan 5).
- [ ] Verifikasi dari source dan catat file:baris untuk:
  - `src/features/cv/cv-service.ts` (metode `ensure/getCv/getSelectionPool/select/remove/reorder/updateLayout`, bentuk `CvView`, `CvSelectionPool`), `src/features/cv/cv-errors.ts` (pemetaan kode → `messageKey`), `src/features/cv/actions.ts` (correlation ID di `run`/`failure` — P3 F2), `src/domain/cv/{contracts,selection,outline}.ts`.
  - Migration T18: pola errcode/`detail` RPC, nama trigger (`cv_items_a_guard`, `touch_mutable_row`), check `cv_documents`/`cv_items`, dan pastikan `profile_snapshot` size check 8192.
  - Batas panjang kolom profil (headline, phone, location, website, contact_email) di migration foundation/T03 dan validator URL/email yang ada (mis. `src/features/profile/schemas.ts`), untuk §2.2.2.
  - Pola halaman workspace lain yang punya `loading.tsx`/error boundary, `requireCompletedWorkspace`, dan cara halaman memakai `Dialog`, `RevisionConflict`, `unsaved-changes`, `session-draft`, `ActionFeedback`, `SubmitButton`, `FieldErrorBinding` (mis. halaman project S08 dan `achievement-form.tsx`).
  - `src/features/achievement/achievement-detail.tsx` (tempat tombol/aksi status confirmed) dan kunci i18n `achievement.confirmedNoCv`/`achievement.cvEligible` yang menyebut CV "later" (teks yang mungkin perlu disesuaikan tanpa mengubah perilaku).
  - Pola test komponen React (`tests/unit/import-start-ui.test.tsx` dan util test), pola Playwright + axe + fixture akun (`tests/e2e/helpers`, `tests/e2e/import-review.spec.ts`), dan port bebas 3012 (`grep -n "PORT" playwright.*.config.ts`).
  - Helper tanggal parsial di `src/domain/dates` yang dapat dipakai ulang oleh `labels.ts` (jangan menulis ulang parser).
  - Data lokal tidak memuat `display_overrides` dan tidak ada CV dengan `override_text` (untuk constraint §3.1.2).
- [ ] Ambil jawaban pengguna atas §2.4 dan catat di receipt. **Stop** bila belum ada.
- [ ] Tulis receipt Fase 0 `docs/verification/T19-phase0-baseline.md`. Commit `docs(t19): add phase 0 baseline receipt`.

### Fase 1 — Database (TDD pgTAP)

- [ ] Tulis `supabase/tests/database/cv_builder.test.sql` yang gagal lebih dulu (pola `import_commit.test.sql`/`cv_selection.test.sql`). Assertion minimum:
  1. Struktur: `save_cv_edits` ada, `prosecdef`, execute hanya `authenticated`, tidak ada grant tulis baru; constraint `cv_documents_profile_overrides_check`.
  2. Auth/onboarding: `AUTH_REQUIRED` (deleting/tanpa sesi), `ONBOARDING_REQUIRED`, `CV_NOT_FOUND`.
  3. Validasi (§1.7): judul kosong/>120, summary >5000, override >2000, key profil asing, website non-http(s), email invalid, `p_edits` kosong/key asing/NULL → `INVALID_CV_INPUT` **tanpa write** dan tanpa teks nilai di pesan.
  4. Override item (§1.6): tersimpan pada `override_text`; `source_snapshot` dan `source_revision` identik sebelum/sesudah (bandingkan `jsonb`); baris sumber canonical (revision dan isi) tidak berubah; hapus (`null`/blank) mengembalikan NULL; skill/certification → `CV_OVERRIDE_UNSUPPORTED`; item akun B dan ID acak → `CV_ITEM_NOT_FOUND`; ID ganda → `INVALID_CV_INPUT`.
  5. Revision (§1.8): batch banyak edit menaikkan revision **tepat 1**; batch invalid tidak menaikkan; no-op tidak menulis (revision dan `updated_at` sama); `STALE_REVISION` tanpa write; kombinasi valid + satu item tak dikenal tidak menyimpan sebagian.
  6. Profil (§1.7): `profile_snapshot` sumber (`display_name`, `summary`, dll.) dan `profile_source_revision` tidak berubah; `display_overrides` tersimpan; menghapus semua key menghapus `display_overrides`; nilai kosong per key menghapus key itu.
  7. Kompatibilitas T18: RPC seleksi/reorder/layout tetap berfungsi setelah override; `remove_cv_item` menghapus item ber-override; delete sumber T18 tetap mempertahankan `override_text` pada item `source_deleted`.
  8. Isolasi: akun B tidak dapat mengubah CV A (RPC hanya menyentuh CV pemanggil).
- [ ] Pastikan `pnpm db:test` **FAIL** karena test baru. Tulis migration §3.1, lalu `pnpm exec supabase migration up --local`. **Dilarang** `db reset`.
- [ ] `pnpm db:test` (PASS; catat total file/assertion), `pnpm db:lint`, `pnpm db:types`, migration list (28/28).
- [ ] Commit `feat(t19): add save_cv_edits RPC for CV overrides`, lalu receipt Fase 1. Checkpoint Claude opsional di sini.

### Fase 2 — Domain murni (TDD unit)

- [ ] Test gagal lebih dulu:
  - `cv-contracts`: `saveCvEditsInput` (minimal satu edit, batas panjang, UUID item, website http/https, key profil asing ditolak, `null` = hapus); `CV_ERROR_CODES` memuat `CV_OVERRIDE_UNSUPPORTED`; skema profil menerima `display_overrides` dan menolak kunci asing.
  - `cv-labels`: heading en/id untuk enam section; format tanggal year/month/day; NULL tanpa placeholder; `is_current` → Present/Sekarang; zona UTC (tanggal `2024-03-01` tidak bergeser).
  - `cv-resolve`: override menang atas snapshot; kosong kembali ke snapshot; profil = sumber + override per key; summary = override atau sumber.
  - `cv-preview`: contoh graduate (education, project dengan achievement kontekstual, skill) → urutan section sesuai `section_order`, achievement sekali, section kosong dihilangkan, item `deleted` ditandai, `hasOverride`, locale mengganti label tanpa mengubah teks sumber.
  - `cv-draft`: `diffDraft`, `isDirty`, `toSaveInput` (hanya field berubah; kosong → `null`), `reconcileDraft` (unchanged/mine/conflict), `computeItemMove` (tepi, achievement kontekstual di grup parent, achievement standalone), `computeSectionMove` (tepi, permutasi tetap valid untuk `isValidSectionOrder`).
- [ ] Implementasi §3.2 hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t19): add CV builder domain (labels, resolve, preview, draft)`, receipt Fase 2.

### Fase 3 — Service, action, i18n (TDD unit)

- [ ] Test gagal lebih dulu:
  - `cv-service`: `saveEdits` memetakan setiap kode DB → kode service + `messageKey` + `correlationId`; `OVERRIDE_UNSUPPORTED`; `STALE_REVISION` memberi kode konflik; respons sukses membawa revision baru; pesan error tidak memuat sentinel.
  - `cv-actions`: validasi Zod `saveCvEditsAction`; `revalidatePath('/cv')` hanya setelah sukses; **correlation ID di respons error = ID yang diberikan ke service** (tutup F2) untuk semua action CV.
  - Parity kunci i18n en/id untuk kunci `cv.*` baru (suite i18n yang ada).
- [ ] Implementasi §3.3 hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t19): add CV save edits service and action`, receipt Fase 3.

### Fase 4 — UI S13 (TDD komponen)

- [ ] Test komponen gagal lebih dulu (`cv-builder-ui.test.tsx`, jsdom, service/action di-mock): render empty CV dan pool; *Add* memanggil action dengan `expected_revision` terbaru dan berubah menjadi *Added*; achievement kontekstual di bawah parent; tombol *Move* berlabel, `disabled` di tepi, memanggil action dengan daftar ID dari `computeItemMove`, fokus kembali ke tombol yang sama, live region berisi hasil; edit wording membuat badge *Unsaved changes* muncul **sedangkan preview tetap teks tersimpan**; Save memanggil `saveCvEditsAction` hanya dengan field berubah; sukses membersihkan draft; `STALE_REVISION` menampilkan panel konflik, input lokal tetap ada, field `conflict` memblokir Save sampai dipilih *Keep mine*/*Use saved*; hapus parent dengan child membuka dialog (daftar judul child dari state, bukan dari error), *Cancel* tidak menghapus, konfirmasi memanggil action dengan `removeChildren = true`; badge *Manual wording* dan *Source deleted*; pemilih locale; highlight `?highlight=`; kontras tidak bergantung pada warna (teks pada setiap badge).
- [ ] Implementasi §3.4 dan tautan *Add to CV* (`achievement-detail.tsx`, hanya `confirmed`; sesuaikan copy `achievement.confirmedNoCv` agar tidak menyebut "later task" tanpa mengubah perilaku confirm). Tanpa `console.`. Fokus ke field pertama tidak valid; reduced motion.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Commit `feat(t19): add CV builder UI (S13)`, receipt Fase 4.

### Fase 5 — Integration nyata, browser, dan regresi penuh

- [ ] `tests/integration/cv-builder.test.ts` (setup seperti `cv-selection.test.ts`: admin, owner A/B nyata, onboarding lewat RPC nyata, sumber lewat service/RPC yang ada). Skenario wajib:
  1. Graduate (§1.14): education, project akademik, achievement confirmed ber-project, skill → `ensure` paralel ×3 satu CV; select semua; `saveEdits` (judul, summary, override profil, override item); `getCv` + `buildCvPreviewModel` sesuai; **baris sumber canonical tidak berubah** (revision + isi sebelum/sesudah).
  2. Override terpisah (§1.6): override tidak mengubah `source_snapshot`/`source_revision`; hapus override kembali; skill → `OVERRIDE_UNSUPPORTED`.
  3. Edit bersamaan (§1.9): dua client A, revision sama, `saveEdits` vs `saveEdits` dan `saveEdits` vs `select`/`reorder` paralel ×3 putaran → tepat satu sukses, lainnya `STALE_REVISION`, tanpa `40P01`, tanpa override hilang.
  4. Parent removal (§1.10) lewat service: `CHILD_ITEMS_EXIST` lalu hapus dengan child; override child ikut terhapus.
  5. Isolasi (§1.7): B tidak dapat menyimpan edit ke item A (`CV_ITEM_NOT_FOUND`), tidak melihat CV A.
  6. Delete sumber setelah override: item `source_deleted`, `override_text` dan snapshot utuh.
  7. Log hygiene (§1.17): sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>` di judul/summary/override tidak muncul di error, detail, atau respons error.
- [ ] Tambah script `test:integration:cv-builder`, `test:e2e:cv`, `playwright.cv.config.ts` (port 3012; salin pola config lain) lalu jalankan integration.
- [ ] `tests/e2e/cv-builder.spec.ts` (fixture akun via admin seperti `import-review.spec.ts`, cleanup fixture) — build produksi nyata, tanpa AI: (1) graduate journey penuh (first open kosong → *Add* education, project, achievement → parent otomatis → move dengan keyboard → override → Save → reload, data bertahan, preview berubah hanya setelah Save); (2) locale CV id/en (label preview berubah, UI tetap); (3) parent removal dialog + fokus; (4) konflik dua konteks browser (edit di tab B menyimpan lebih dulu, tab A menyimpan → panel konflik, input lokal tetap, *Keep mine* lalu Save sukses); (5) *Add to CV* dari detail achievement → `/cv?highlight=` menyorot tanpa menambahkan; draft tidak menampilkan tautan; (6) responsive 360/1440 px × light/dark tanpa scroll horizontal + axe 0 pelanggaran serius/kritis; (7) reduced motion. Simpan `test-results` sebagai bukti; tampilkan screenshot 360/1440 di receipt.
- [ ] Jalankan seluruh §7. `test:e2e:m2`, `test:e2e:m3` wajib lulus tanpa melemahkan assertion env (kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk run itu). ClamAV dan Gotenberg wajib berjalan untuk suite yang membutuhkannya; bila tidak, catat **tidak dijalankan** beserta alasan. Flaky bawaan `activity-ui.spec.ts:356` (dan run pertama `test:e2e:activity`) dicatat sebagai flaky bila lulus saat diulang tanpa perubahan.
- [ ] Commit `test(t19): add CV builder integration and browser suites`, receipt Fase 5 `docs/verification/T19-phase5-integration-browser-regression.md`. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–5, output command, dan daftar acceptance yang belum terbukti.

### Fase 6 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0025-t19-cv-builder-overrides.md`: keputusan §2.2 poin 1–15, kode error baru, urutan lock `save_cv_edits`, alternatif yang ditolak (RPC per field/per item, kolom baru untuk override profil, autosave teks, drag-and-drop, bulk-add/auto-selection, preview dari draft lokal, override untuk skill/certification), seam T20 (state changed/unconfirmed, Keep/Refresh/Replace memakai `override_text` dan `display_overrides`, profile freshness), T21 (`buildCvPreviewModel` sebagai basis render snapshot, validasi nama dari `resolveProfile`), T22 (preview S14 memakai model yang sama + pagination).
- [ ] `docs/verification/T19-cv-builder-overrides.md`: pass/fail/warning/tidak dijalankan, trace ke R09, F07, F03, S13, DB §5/§6, dan setiap poin §1, termasuk screenshot 360/1440 light/dark.
- [ ] README (bagian CV: builder S13, script baru, tabel quality gates, port 3012). `AGENTS.md` dan salinannya di `docs/` tetap identik bila disentuh (biasanya oleh `workpulse-task-closeout`).
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- Owner A (graduate): sudah onboarding, locale `id`, timezone `Asia/Jakarta`, tanpa experience. Education `Universitas Contoh / S1 Informatika` (tahun saja), project `Skripsi Sistem Antrian` (`completed`), achievement confirmed ber-`project_id` skripsi (dengan `cv_bullet`), satu achievement draft, satu dismissed, skill `SQL`, certification tanpa tanggal, achievement confirmed standalone.
- Owner A2 (employee) bila perlu: dua experience overlap (satu current), achievement confirmed ber-`experience_id` tanpa project.
- Owner B: CV dan sumber sendiri untuk isolasi; sesi browser kedua untuk konflik.
- Sentinel privat: `WP-PRIVATE-CV-SENTINEL-<uuid>` di judul CV/summary/override/`cv_bullet` sumber A.
- Setiap test membersihkan akun fixture seperti suite lain.

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
pnpm test:integration:cv-builder
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
pnpm test:e2e:cv
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

`test:integration:cv-builder` dan `test:e2e:cv` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan (di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong). Muat env Supabase lokal (`.env.local` + key) dalam command yang sama dengan suite (env PowerShell tidak bertahan antar command). Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`. Untuk edit file ber-karakter non-ASCII gunakan tool Edit, bukan `Set-Content`. Playwright membangun produksi (`next build`); pastikan tidak ada server lain di port 3012.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, atau parity bukan 27/27.
- Persetujuan pengguna atas §2.4 belum tercatat (jangan mulai Fase 1).
- Penyelesaian memerlukan `db reset`, rewrite migration lama, kolom/tabel baru, atau mengubah RPC/trigger T02–T18.
- Implementasi terasa memerlukan freshness/changed/unconfirmed state, Refresh/Replace/Keep, invalidasi CV pada mutasi sumber, request/validasi export, halaman `/cv/preview`, pagination A4, atau AI (T20–T22 / di luar MVP).
- Muncul kebutuhan menulis `source_snapshot`, `source_revision`, atau record canonical dari jalur override.
- Race memicu deadlock yang hanya bisa dihilangkan dengan mengubah urutan lock T18.
- Penyimpangan dari keputusan yang disetujui pengguna (§2.4 setelah dijawab). Laporkan alasan dan alternatif, tunggu keputusan.
- Test membutuhkan key nyata, atau sentinel muncul di output/log/screenshot.
- Perubahan pada suite lama (T02–T18) diperlukan agar lulus, selain kunci i18n/copy `achievement.confirmedNoCv` yang dicatat di receipt.

## 9. Gate review Claude (setelah Fase 5)

Review read-only mencakup:

- `save_cv_edits`: `security definer`/`search_path`/grant benar; tidak ada write klien langsung; lock protocol sesuai decision 0024; satu revision per batch; no-op tidak menulis; validasi sisi DB menolak tanpa membocorkan teks.
- `source_snapshot`, `source_revision`, dan record canonical tidak pernah ditulis oleh jalur override (pgTAP + integration).
- Ownership: item/CV akun lain tidak terjangkau; ID acak dan milik akun lain tak dapat dibedakan.
- Preview hanya dari data tersimpan; draft lokal tidak bocor ke preview; model preview tanpa I/O dan dapat dipakai ulang T21.
- Konflik tidak menimpa: `STALE_REVISION` dan `reconcileDraft`; input lokal tidak hilang saat konflik/error.
- Parent removal tidak diam-diam menghapus child.
- Move aksesibel (label, disabled, live region, fokus) dan hanya keyboard; achievement tidak dirender ganda.
- Locale CV tidak menerjemahkan konten sumber dan tidak mengubah locale UI; tanggal tanpa placeholder/bergeser zona.
- Aksesibilitas: axe, kontras token nyata di light/dark, 360/1440 px, reduced motion, status tidak hanya warna.
- Tidak ada fitur roadmap (target job, variants, AI, bulk-add, drag) dan tidak ada state T20/T22 prematur.
- Log/error hygiene; correlation ID F2 tertutup; tidak ada `console.`.
- Semua suite lama tetap lulus; angka di receipt cocok dengan hasil ulang.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Override menimpa atau mengubah sumber.** RPC menulis `source_snapshot`/`source_revision` atau UI mengirim teks ke jalur edit record canonical. Dijaga pgTAP 4/6 (bandingkan jsonb dan revision sumber) dan integration 1–2.
2. **Save menaikkan revision berkali-kali atau pada no-op.** Update per item memicu revision CV berlipat sehingga `expected_revision` klien basi sendiri. Dijaga pgTAP 5 dan unit komponen (Save berikutnya langsung sukses).
3. **Draft lokal hilang atau menimpa edit orang lain saat konflik.** Reload membuang input, atau Save setelah reload menimpa override baru dari sesi lain. Dijaga unit `reconcileDraft`, unit komponen, dan E2E dua konteks.
4. **Preview menampilkan teks belum tersimpan.** Preview membaca state lokal sehingga tidak sesuai revision yang kelak diekspor. Dijaga unit komponen dan E2E (sebelum/sesudah Save).
5. **Move merusak urutan atau fokus.** Achievement kontekstual berpindah keluar grup, posisi tidak kontigu, atau fokus hilang ke `body` setelah render ulang (tidak lolos keyboard-only). Dijaga unit `computeItemMove`, unit komponen, dan E2E keyboard.
6. **Parent removal diam-diam menghapus child** atau dialog membocorkan teks lewat error. Judul child dari state klien, bukan dari pesan error. Dijaga unit komponen, integration 4, dan E2E.
7. **Label locale CV mengubah konten sumber atau locale UI.** Dijaga unit `cv-labels`/`cv-preview` dan E2E locale.

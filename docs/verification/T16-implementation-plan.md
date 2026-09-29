# Handoff T16 Import commit transaction — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 29 September 2026
- Status saat plan ditulis: **TODO**. T16 belum dimulai.
- Dependensi: T15 **DONE** (acceptance lokal, `docs/verification/T15-import-staging.md`) dan T09 **DONE**. T02/T03 (profile lifecycle, onboarding) dan T12 (dashboard/timeline) juga **DONE**. Gate M2 **PASSED**.
- Eksekutor: satu agent **Claude Sonnet 5.5**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 4; Fase 5 (draft dokumen) dikerjakan setelah gate. Checkpoint setelah Fase 1 bersifat opsional.
- Acuan:
  - PRD R02, §3 (*Imported achievement claims are candidates until the user selects Confirm*), §4 retensi, *Shared validation*, release scenario *Import an Indonesian CV with overlapping employment dates*.
  - User Flow F01 langkah 3–4 (Create/Map/Skip, *Confirm import once*), *Import exceptions*, state transition *Import batch*.
  - Wireframe S03 (`/imports/:id/review`, UI milik T17) — T16 hanya menyediakan backend yang dibutuhkannya.
  - Database Schema §1 (composite FK, *import mappings*), §2 (kolom canonical), §3 `achievements`, §4 `import_items` dan **Import commit transaction**, *File retention*, §6 RLS dan implementation checks (*duplicate import commit*).
  - `IMPLEMENTATION_PLAN.md` §3 *Ownership dan concurrency*, §4 baris *Import achievement … confirm* dan *profil provisional*, blok T16 di §5.
  - `docs/decisions/0002-foundation-schema.md` poin 1 dan 7, `0004-foundation-create-idempotency.md`, `0014-t09-achievement-lifecycle.md`, `0021-t15-import-staging.md` bagian *Seams* dan *Lock order*.

**Goal:** Pengguna yang batch import-nya berstatus `review` dapat menyimpan pilihan per kandidat (`create` / `map` / `skip`, edit field, pilih field profil, konfirmasi achievement), lalu melakukan satu commit atomik. Commit mengunci batch, memvalidasi semua item terpilih dan kepemilikan target `map`, membuat row foundation lebih dulu (experience, education, certification, skill), me-resolve referensi sementara, lalu membuat achievement sebagai draft atau confirmed (hanya bila pengguna memilih Confirm dan field wajib lengkap). Profil hanya menerima field yang dipilih. Pengguna baru menyelesaikan onboarding dalam transaksi yang sama. `committed_id`, hitungan hasil, dan status `committed` disimpan hanya setelah semua write berhasil. Commit ganda mengembalikan hasil pertama. Satu item invalid me-rollback semuanya. `map` tidak pernah mengubah row target. Excerpt achievement tetap ada setelah teks staging dipurge.

**Architecture:** Semua aturan ada di PostgreSQL. Satu migration forward-only menambah kolom staging yang dibutuhkan (`import_items.confirm_requested`, `import_batches.commit_result`), trigger type-aware untuk target polimorfik, guard item setelah commit, relaksasi check provenance achievement untuk `origin = 'import'`, fungsi validasi bersama `internal.import_item_errors`, serta tiga RPC authenticated: `update_import_item`, `validate_import_batch`, `commit_import_batch`. Server TypeScript hanya membungkus RPC (Zod di boundary, pemetaan error, correlation ID) lewat service dan server action yang akan dipakai UI S03 di T17. Tidak ada worker baru dan tidak ada AI. Satu penyesuaian UI kecil: S08 menampilkan provenance "diimpor dari CV" untuk achievement `origin = 'import'`.

**Tech stack:** Supabase PostgreSQL (plpgsql `security definer`, RLS, pgTAP), Next.js App Router server actions, TypeScript strict, Zod 4, Vitest (unit + integration nyata), Playwright hanya untuk regresi, pnpm dari lockfile. Tidak ada dependency baru.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md` (T15), `docs/IMPLEMENTATION_PLAN.md` §1–§4 dan blok M3, decision 0002/0004/0014/0021, lalu `docs/verification/T15-implementation-plan.md` sebagai pola format. Ekstrak PRD R02/§3/§4, F01, S03, dan DB §1–§4/§6 dengan alat ekstraksi DOCX (mis. `python` + `zipfile` atas `word/document.xml`); jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R02:** pengguna mengedit dan memilih record sebelum **satu commit atomik**. Retry tidak menduplikasi data.
- **PRD §3:** klaim achievement hasil import tetap kandidat sampai pengguna memilih *Confirm* saat review. Wording tidak boleh mengarang angka, senioritas, kausalitas, employer, atau hasil. Hanya display name yang wajib untuk menyelesaikan onboarding.
- **PRD shared validation:** experience wajib organization + role; education wajib institution + qualification; tanggal boleh unknown; partial date disimpan dengan precision; end yang diketahui tidak boleh sebelum start; edit bersamaan melaporkan conflict.
- **PRD §4:** file import dan teks staging dihapus dalam 24 jam setelah commit, pembatalan, atau kegagalan terminal.
- **F01 langkah 3–4:** S03 menampilkan kandidat, excerpt, field kurang, dan duplikat. Tiap baris punya *Create*, *Map to existing*, atau *Skip*. Mapping memakai ulang record yang ada, **tidak** menimpanya. *Confirm import once*: commit record terpilih secara atomik, tampilkan jumlah yang benar-benar dibuat, buka S04 dengan record langsung terlihat.
- **F01 Import exceptions / state:** tidak ada hasil ekstraksi yang auto-confirm; submit ganda mengembalikan hasil batch yang ada; `review → committed` sekali.
- **S03:** kandidat dikelompokkan profile/experience/education/certifications/skills/achievements; field dapat diedit; excerpt dan error validasi terlihat; **konfirmasi eksplisit per achievement**; pilihan review dipersist; tombol final nonaktif bila record terpilih invalid; refresh atau double click tidak menduplikasi row.
- **DB §4 Import commit transaction:** kunci batch; kembalikan hasil lama bila sudah committed. Validasi semua payload terpilih dan kepemilikan target mapped. Buat row foundation dulu, resolve referensi staging, lalu buat achievement draft atau yang dikonfirmasi eksplisit. Set `committed_id` tiap row yang dibuat, `status = committed` hanya setelah semua write sukses. Mapping hanya reuse. Import profil hanya menulis field yang dipilih dan direview pengguna. Gunakan **trigger type-aware** untuk memvalidasi target polimorfik. Rollback semua write pada kegagalan apa pun.
- **DB §4 File retention:** excerpt import yang disalin ke row karier menjaga provenance setelah teks staging dipurge. Mapping import dan metadata status minimal tetap ada sampai akun dihapus.
- **DB §3 achievements:** `origin` manual/activity/import; confirmed mewajibkan title, contribution, outcome, cv_bullet, achieved_on; `cv_bullet` default faktual bila AI tidak tersedia.
- **DB §6:** tolak write klien langsung ke import commit; sediakan operasi server terautentikasi. Test *duplicate import commit* wajib.
- **Rencana §4:** status reviewed draft/confirmed disimpan terpisah dari `action`; konfirmasi eksplisit menjadi bagian commit; mapping tidak mengubah target. Finalisasi onboarding hanya setelah pengguna memilih nama nyata.

Pertahankan perubahan lokal pengguna. Jangan menandai T16 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T16-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka yang ditulis harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T16

T16 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Commit atomik sukses.** Batch `review` dengan campuran `create`/`map`/`skip` di semua `entity_type` → satu panggilan `commit_import_batch` membuat tepat row yang dipilih `create`, mengisi `committed_id` hanya untuk item yang dibuat, batch `committed` dengan `committed_at`, `expires_at = committed_at`, dan `commit_result` berisi hitungan `created/mapped/skipped` per tipe yang cocok dengan row nyata. Dibuktikan pgTAP dan integration.
2. **Foundation dulu, referensi di-resolve.** Achievement dengan `payload.experience_item_id` menunjuk item experience `create` mendapat `experience_id` = experience yang baru dibuat; menunjuk item `map` mendapat `target_id`-nya; menunjuk item `skip` menjadi standalone (`experience_id` NULL). Dibuktikan pgTAP.
3. **Double commit mengembalikan hasil awal.** Commit kedua (berurutan, dan dua sesi paralel) pada batch yang sama mengembalikan `commit_result` identik tanpa row baru, termasuk bila `p_expected_revision` lama dipakai. Dibuktikan pgTAP (berurutan) dan integration (paralel ×3 lewat service).
4. **Satu item invalid me-rollback semuanya.** Batch dengan satu item terpilih invalid (mis. experience tanpa `role_title`, interval pasti terbalik, URL non-http, achievement confirm tanpa `achieved_on`) → `IMPORT_ITEM_INVALID` dengan daftar `{item_id, field, code}` tanpa teks sumber; jumlah row semua tabel canonical, `profiles.revision`, `onboarding_completed_at`, status batch, dan `committed_id` identik sebelum/sesudah. Termasuk kasus pelanggaran yang hanya ditangkap constraint canonical (defense in depth). Dibuktikan pgTAP dan integration.
5. **Map hanya reuse dan milik sendiri.** `map` ke row milik akun lain, ke ID yang tidak ada, atau ke tabel yang salah untuk `entity_type` ditolak trigger type-aware saat `update_import_item` (`IMPORT_TARGET_INVALID`) dan divalidasi ulang saat commit (target yang dihapus di antaranya → `IMPORT_ITEM_INVALID` kode `TARGET_UNAVAILABLE`). Row target yang di-map memiliki `revision`, `updated_at`, dan seluruh kolom identik sebelum/sesudah commit. Dibuktikan pgTAP dan integration.
6. **Achievement default draft, confirm eksplisit.** Item achievement `create` tanpa `confirm_requested` menjadi `status = 'draft'`, `origin = 'import'`. Dengan `confirm_requested = true` dan title, contribution, outcome, achieved_on valid → `confirmed` (cv_bullet kosong diisi `internal.factual_cv_bullet`, sama dengan T09). `confirm_requested` pada item selain achievement atau pada `map`/`skip` ditolak. Tidak ada jalur yang mengkonfirmasi tanpa flag. Dibuktikan pgTAP dan unit service.
7. **Profil hanya field terpilih.** Item profile `create` menulis hanya kolom di `payload.selected_fields` (allowlist `headline`, `summary`, `contact_email`, `phone`, `location`, `website`); kolom lain profil tidak berubah. `map` pada profile ditolak. `skip` tidak menulis apa pun. Dibuktikan pgTAP.
8. **Onboarding lewat commit.** Pengguna dengan `onboarding_completed_at IS NULL` wajib mengirim `p_onboarding` (`display_name` nyata, `locale`, `timezone` valid); commit mengisi nama, locale, timezone, dan `onboarding_completed_at` dalam transaksi yang sama. Tanpa `p_onboarding` → `ONBOARDING_REQUIRED`; placeholder → `INVALID_DISPLAY_NAME`; keduanya tanpa write. Pengguna yang sudah onboarding: `p_onboarding` diabaikan (nama tidak berubah). Dibuktikan pgTAP dan integration.
9. **Provenance setelah purge.** Setelah commit lalu `purge_expired_import_batches` (T15), achievement import tetap punya `source_excerpt` = excerpt item; `import_items` committed tetap punya `entity_type/action/target_id/committed_id` dengan `payload`/`source_excerpt` NULL; `extracted_text`/`file_key` batch NULL dan object Storage terhapus. Dibuktikan pgTAP dan integration.
10. **Pilihan review dipersist dan revision-guarded.** `update_import_item` menyimpan `action`, `target_id`, field payload yang boleh diedit, `selected_fields`, dan `confirm_requested`; menaikkan revision item **dan** batch; `expected_revision` basi → `STALE_REVISION` tanpa write. `source_excerpt`, `entity_type`, `ordinal` tidak bisa diubah. Hanya boleh saat batch `review` dan belum dipurge. Commit dengan `p_expected_revision` batch basi → `STALE_REVISION`. Dibuktikan pgTAP dan integration.
11. **Validasi dry-run.** `validate_import_batch` mengembalikan error per item terpilih (kode `REQUIRED`, `INVALID`, `TOO_LONG`, `DATE_RANGE`, `DUPLICATE`, `TARGET_UNAVAILABLE`, `INVALID_ACTION`) tanpa write, dan himpunan error-nya sama dengan yang membuat commit gagal. Skill `create` yang normalized name-nya sudah ada → `DUPLICATE` dengan `existing_id`. Dibuktikan pgTAP dan unit.
12. **Status dan isolasi.** Commit pada batch `queued`/`running`/`failed`/`cancelled` atau yang sudah dipurge → `IMPORT_NOT_COMMITTABLE`. Akun B tidak bisa update/validate/commit batch A (`IMPORT_NOT_FOUND` generik) dan tidak bisa map ke row A. Tidak ada grant `insert/update/delete` klien pada `import_items`/`import_batches`. Akun `deleting` → `AUTH_REQUIRED`. Dibuktikan pgTAP dan integration.
13. **Race.** Commit vs `update_import_item`, commit vs `cancel_import_batch`, dan commit vs `delete_experience` atas target `map` menghasilkan urutan serial yang konsisten (satu sukses, lainnya conflict/ditolak dengan kode jelas), tanpa deadlock `40P01` dan tanpa row yatim. Dibuktikan integration (dua koneksi nyata).
14. **Rilis skenario PRD.** Fixture CV Indonesia dengan dua pengalaman kerja overlap (satu current) → staging T15 (fake `import_valid`) → edit satu kandidat, map satu skill ke skill lama, konfirmasi satu achievement → commit → kedua experience tersimpan dengan overlap utuh, Dashboard (T12) menghitung achievement confirmed dan skill yang benar, Timeline menampilkan experience/education; commit ulang tidak menambah row. Dibuktikan integration.
15. **S08 provenance jujur.** Achievement `origin = 'import'` menampilkan label "Imported from CV"/"Diimpor dari CV" beserta excerpt, **bukan** pesan "source activity unavailable". Achievement `activity`/`manual` tidak berubah. Dibuktikan unit render dan `test:e2e:achievements`.
16. **Log hygiene.** Error, `commit_result`, detail `IMPORT_ITEM_INVALID`, response action, dan log server tidak memuat isi payload, excerpt, atau nama file (sentinel = 0). Dibuktikan integration dan grep.
17. **Regresi.** Suite T06–T15 tetap lulus tanpa melemahkan assertion, terutama `db:test` (termasuk `import_staging.test.sql` dan `achievement.test.sql`), `test:integration:import`, `test:integration:achievements`, `test:integration:dashboard`, `test:e2e:import`, `test:e2e:achievements`, `test:e2e:m2`.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration forward-only T16 (kolom staging, trigger type-aware, guard item, relaksasi check provenance achievement import, fungsi validasi, tiga RPC) dan pgTAP baru `import_commit.test.sql`.
- Domain TypeScript: kontrak kode error/field commit dan skema Zod input `update_import_item`/`commit_import_batch`.
- Server: `import-review-service.ts` (update item, validate, commit), pemetaan error, dan server action yang dipakai T17.
- Penyesuaian kecil S08 (label provenance import) dan copy en/id.
- Integration suite nyata `import-commit.test.ts`, script baru, decision 0022, receipt.

### 2.2 Keputusan implementasi

1. **Pilihan review disimpan di `import_items`, bukan dikirim sekaligus saat commit.** RPC `update_import_item` di T16 adalah satu-satunya jalan menulis `action/target_id/payload/confirm_requested`; commit membaca item yang tersimpan. Alasan: S03 mensyaratkan pilihan dipersist dan refresh tidak kehilangan pilihan; DB §4 meminta trigger type-aware pada `target_id`, yang harus hidup bersama RPC penulisnya. T17 hanya membangun UI di atas RPC ini. **Perlu konfirmasi pengguna** (lihat §8).
2. **Revision batch sebagai token review.** `update_import_item` menaikkan revision batch (update no-op `updated_at` memicu guard T15 `revision + 1`). `commit_import_batch(p_batch_id, p_expected_revision, p_onboarding)` membandingkan revision tersebut. Alasan: memastikan pengguna meng-commit keadaan review yang ia lihat, termasuk bila tab lain mengubah item. Worker tidak lagi menyentuh batch setelah `review`, jadi token ini stabil (berbeda dengan cancel/retry di decision 0021 poin 8).
3. **Idempotensi berbasis state batch.** Commit mengunci batch `for update` lebih dulu; bila `status = 'committed'` langsung mengembalikan `commit_result` tersimpan (tanpa memeriksa revision). Tidak memakai `internal.operation_requests`. Alasan: batch sudah merupakan scope idempotensi unik per pengguna; DB §4 meminta "return prior results if already committed".
4. **Konfirmasi achievement di kolom terpisah.** Tambah `import_items.confirm_requested boolean not null default false` dengan check `not confirm_requested or entity_type = 'achievement'`. `payload.status` tetap `draft` (check T15 `import_items_achievement_draft_check` tidak diubah). Alasan: rencana §4 meminta status review disimpan terpisah dari `action`, dan invariant T15 "staging tidak pernah confirmed" tetap utuh.
5. **Provenance achievement import.** Check `achievements_source_pair_check` saat ini mewajibkan `(source_excerpt is null) = (source_activity_revision is null)` (`20260922100000_t09_achievements_skills.sql:171`). Ganti (drop + add dalam migration T16) menjadi: pasangan tetap wajib untuk `origin <> 'import'`; untuk `origin = 'import'` `source_activity_revision` wajib NULL dan `source_excerpt` boleh terisi. Tidak ada kolom baru di tabel canonical. Row foundation (experience/education/certification/skill) **tidak** menyimpan excerpt (tabel canonical tidak punya kolomnya); provenance mereka = mapping `import_items` yang dipertahankan purge. Alasan: DB §4 *File retention* menyalin excerpt ke row karier; hanya `achievements` punya kolom `source_excerpt`. **Perlu konfirmasi pengguna** (§8). Verifikasi di Fase 0 bahwa `save_achievement` tidak mengizinkan edit `source_excerpt` dan tidak ada kode yang menganggap `source_excerpt` ⇒ ada activity (lihat `src/features/achievement/achievement-detail.tsx:101-110`).
6. **Onboarding dalam commit.** `p_onboarding jsonb` (`{display_name, locale, timezone}`) wajib bila `onboarding_completed_at IS NULL`; divalidasi seperti `public.complete_onboarding` 4-argumen (`20260916150000_auth_onboarding_locale_timezone.sql:6`: `internal.is_real_display_name`, locale `en/id`, `internal.is_valid_timezone`). Bila onboarding sudah selesai, `p_onboarding` diabaikan. `display_name` di payload profile **tidak** pernah ditulis lewat `selected_fields`; T17 memakainya hanya sebagai prefill `p_onboarding.display_name`. Alasan: decision 0002 poin 1 dan rencana §4 (nama nyata dipilih pengguna); menghindari dua jalan menulis nama.
7. **Profil: `create` = terapkan field terpilih.** Profile hanya mendukung `create` dan `skip`; `map` → `INVALID_ACTION`. `payload.selected_fields` adalah array unik ⊆ allowlist §2.2.6; field terpilih yang NULL di payload → `REQUIRED`. Nilai terpilih menimpa kolom profil (pengguna memilihnya secara eksplisit). Constraint profil yang ada tetap berlaku.
8. **Map per tipe.** experience → `experiences`, education → `education`, certification → `certifications`, skill → `skills`, achievement → `achievements`. `map` mewajibkan `target_id`; `create`/`skip` mewajibkan `target_id IS NULL`. `committed_id` diisi hanya untuk row yang **dibuat**; item `map` menyimpan referensinya di `target_id`. Achievement `map` mengabaikan `confirm_requested` (ditolak di update) dan tidak mengubah target.
9. **Skill duplikat → error, bukan auto-map.** `create` skill yang `internal.normalize_skill_name(name)` sudah ada pada akun → `DUPLICATE` dengan `existing_id`; dua item `create` dalam batch yang sama dengan nama ternormalisasi sama → `DUPLICATE` (tanpa `existing_id`) pada item kedua. Commit gagal atomik. Alasan: F01 meminta Map eksplisit; auto-map diam-diam melanggar "user selects". T17 dapat menawarkan Map memakai `existing_id`. Experience/education duplikat bersifat fuzzy dan menjadi urusan tampilan T17, bukan penolakan T16.
10. **Validasi tunggal di SQL.** `internal.import_item_errors(p_user_id uuid, p_batch_id uuid)` mengembalikan `(item_id, field, code, existing_id)` untuk item non-`skip`, dan dipakai oleh `validate_import_batch` maupun commit. Validasi mencakup **setiap** constraint canonical terkait (nonblank, panjang, enum `kind`, `internal.is_canonical_partial_date`, `internal.is_valid_partial_interval`, pola URL certification/website, `internal.is_valid_achievement_metrics`, panjang `cv_bullet` fallback ≤ 2.000) sehingga commit normal tidak pernah menabrak constraint mentah. `validation_errors` hasil AI (T15, mis. `UNGROUNDED`) bersifat informatif dan **tidak** dibaca commit. Constraint violation yang tetap lolos ditangkap di commit, di-rollback, dan dipetakan ke `IMPORT_ITEM_INVALID` tanpa pesan PostgreSQL mentah.
11. **Edit payload terbatas.** `update_import_item` menerima `p_payload` sebagai **patch** dengan allowlist per tipe (nama kolom canonical sesuai payload T15 di `src/domain/import/extract-result.ts:249-342`): experience `organization, role_title, kind, description, start_date, start_precision, end_date, end_precision, is_current`; education `institution, qualification, field_of_study, description, start/end, is_current`; certification `name, issuer, issued_date, issued_precision, credential_url`; skill `name`; achievement `title, contribution, outcome, cv_bullet, achieved_on, metrics, experience_item_id`; profile `headline, summary, contact_email, phone, location, website, selected_fields` (+ `display_name` untuk prefill). Kunci di luar allowlist → `INVALID_IMPORT_ITEM_INPUT`. `experience_item_id` hanya boleh NULL atau ID item experience dalam batch yang sama. Validasi konten penuh terjadi di `validate`/commit, bukan di update, agar draft review dapat tersimpan setengah jadi. Grounding tidak dijalankan ulang: nilai yang diedit adalah tulisan pengguna.
12. **Urutan lock.** profile `for update` → batch `for update` → item batch `for update` (urut `entity_type`, `ordinal`) → target `map` `for share` per tabel (experiences, education, certifications, skills, achievements; urut `id`) → insert. Ini memperluas urutan decision 0021 (profile → batch → job → items). `update_import_item` memakai profile `for share` → batch `for update` → item `for update`. Dokumentasikan di decision 0022 dan uji race §1.13.
13. **Hasil commit.** Kolom baru `import_batches.commit_result jsonb` (object kecil, `pg_column_size <= 4096`, wajib terisi ⇔ `status = 'committed'` untuk batch yang di-commit oleh T16; fixture committed T15 tanpa result tetap valid — gunakan check `commit_result is null or status = 'committed'`). Isi: `{schema_version:'import-commit.v1', counts:{<type>:{created,mapped,skipped}}, confirmed_achievements:n, profile_fields_applied:n, onboarding_completed:boolean}` — hanya angka dan boolean. Kolom di-grant select ke `authenticated`.
14. **Retensi.** Commit set `expires_at = committed_at`; purge T15 (`purge_expired_import_batches`, `20260930090000_t15_import_staging.sql:1461`) menjalankan sisanya tanpa perubahan. T16 tidak mengubah fungsi purge.
15. **Guard item setelah commit.** Ganti body `internal.guard_import_item_row` (`20260930090000_t15_import_staging.sql:256`) sehingga, bila batch item berstatus `committed`, perubahan hanya diizinkan untuk purge (payload/excerpt → NULL, `purged_at` terisi); `action`, `target_id`, `committed_id`, `confirm_requested` immutable. Sebelum commit, `committed_id` hanya boleh diisi dari dalam `commit_import_batch` (gunakan flag transaksi lokal `set_config('workpulse.import_commit', 'on', true)` yang dicek guard; flag tidak dapat diset klien karena klien tidak punya write grant).
16. **Trigger type-aware.** `internal.validate_import_item_target()` `before insert or update of action, target_id, committed_id` pada `import_items`: untuk `target_id`/`committed_id` non-NULL, row harus ada di tabel sesuai `entity_type` dengan `user_id` sama; profile tidak boleh punya `target_id`/`committed_id`; `map` ⇔ `target_id` non-NULL. Pelanggaran → `IMPORT_TARGET_INVALID` (tanpa membedakan tidak ada vs milik akun lain).
17. **Consent tidak diperiksa saat commit.** Commit tidak mengirim apa pun ke AI; consent yang ditarik setelah `review` tidak memblokir commit. Alasan: PRD §4 membatasi consent pada pemrosesan AI; jalur manual tidak boleh tertutup.
18. **Tidak ada CV invalidation.** Tabel CV belum ada (T18). `map` tidak mengubah row; perubahan profil lewat commit akan diintegrasikan ke freshness di T20. Catat seam di decision.
19. **Nomor.** Migration `supabase/migrations/20261001090000_t16_import_commit.sql` (parity menjadi 26/26). Decision `docs/decisions/0022-t16-import-commit.md`. pgTAP `supabase/tests/database/import_commit.test.sql`. Integration `tests/integration/import-commit.test.ts`, script baru `test:integration:import-commit`. Tidak ada port E2E baru.

### 2.3 Di luar scope

- UI S03 (`/imports/:id/review`), grouping, excerpt, duplikat fuzzy, summary pilihan, tombol final, result counts ke S04, entry import dari S12/dashboard untuk pengguna lama → **T17**. Jangan membuat route atau halaman S03.
- Perubahan S02 selain yang terpaksa oleh kontrak baru (S02 tetap tanpa link S03 sampai T17).
- Purge batch `review` yang ditinggalkan dan orkestrasi penghapusan akun → T17/T23.
- CV selection/freshness/invalidation → T18–T20.
- Skill link achievement (`achievement_skills`) dari import: payload T15 tidak memuatnya; tidak ditambahkan.
- Project sebagai entity import: tidak ada di DB §4; tidak ditambahkan.
- Perubahan pipeline T15 (upload, scan, parse, AI, grounding) dan perilaku T06–T15 selain §2.2.5 (check provenance) dan §2.2.15 (guard item).

## 3. Kontrak teknis

### 3.1 Migration `20261001090000_t16_import_commit.sql`

Urutan isi:

1. `alter table public.import_items add column confirm_requested boolean not null default false` + check `import_items_confirm_check (not confirm_requested or entity_type = 'achievement')`.
2. `alter table public.import_batches add column commit_result jsonb` + check `import_batches_commit_result_check (commit_result is null or (status = 'committed' and jsonb_typeof(commit_result) = 'object' and pg_column_size(commit_result) <= 4096))`. Tambahkan `commit_result` ke `grant select (...)` authenticated (ulang grant kolom).
3. Drop + add `achievements_source_pair_check` (§2.2.5):
   ```sql
   check (
     (origin <> 'import' and (source_excerpt is null) = (source_activity_revision is null))
     or (origin = 'import' and source_activity_revision is null)
   )
   ```
   Verifikasi dulu di Fase 0 bahwa tidak ada row lokal `origin = 'import'` yang melanggar (seharusnya nol row).
4. `internal.validate_import_item_target()` + trigger (§2.2.16).
5. Ganti body `internal.guard_import_item_row()` (§2.2.15). Salin body T15 lalu tambah cabang; lampirkan diff body di receipt Fase 1.
6. `internal.import_item_errors(p_user_id uuid, p_batch_id uuid) returns table (item_id uuid, field text, code text, existing_id uuid)` (§2.2.10), `stable`, `security definer`, tidak di-grant ke siapa pun selain dipanggil fungsi lain.
7. RPC:

| Fungsi | Grant | Perilaku |
| --- | --- | --- |
| `public.update_import_item(p_item_id uuid, p_expected_revision integer, p_action text, p_target_id uuid, p_payload_patch jsonb, p_confirm_requested boolean)` | authenticated | `auth.uid()` wajib, profil tidak deleting (`AUTH_REQUIRED`). Lock profile share → batch → item. Item/batch asing atau tidak ada → `IMPORT_NOT_FOUND`. Batch bukan `review` atau sudah dipurge → `IMPORT_NOT_REVIEWABLE`. Revision item basi → `STALE_REVISION`. `p_action` ∉ create/map/skip → `INVALID_IMPORT_ITEM_INPUT`. Patch divalidasi allowlist (§2.2.11), lalu `payload = payload || patch`. `p_confirm_requested` true hanya untuk achievement `create`. Menaikkan revision item dan batch. Return `item_id, item_revision, batch_revision`. |
| `public.validate_import_batch(p_batch_id uuid)` | authenticated | Owner check seperti di atas; batch `review` saja (`IMPORT_NOT_REVIEWABLE`). Return hasil `internal.import_item_errors`. Tanpa write, `stable`. |
| `public.commit_import_batch(p_batch_id uuid, p_expected_revision integer, p_onboarding jsonb)` | authenticated | Algoritma §3.2. Return `jsonb` = `commit_result` + `batch_id`, `committed_at`. |

Semua fungsi: `security definer`, `set search_path = pg_catalog`, identifier ter-qualify, `raise exception using errcode, message = '<CODE>'` tanpa teks sumber atau nama file; `revoke execute ... from public, anon, service_role` lalu `grant ... to authenticated`; `comment on` untuk kolom dan fungsi baru. Tidak ada grant `insert/update/delete` tabel import ke `authenticated`.

### 3.2 Algoritma `commit_import_batch`

1. `v_user := auth.uid()`; NULL → `AUTH_REQUIRED`. Lock `profiles` `for update`; tidak ada atau `deleting_at` terisi → `AUTH_REQUIRED`.
2. Lock batch `for update` dengan `user_id = v_user`; tidak ada → `IMPORT_NOT_FOUND`.
3. `status = 'committed'` → return `commit_result` tersimpan (+ `batch_id`, `committed_at`). Selesai, tanpa write.
4. `status <> 'review'` atau `purged_at is not null` → `IMPORT_NOT_COMMITTABLE`. `revision <> p_expected_revision` → `STALE_REVISION`.
5. Onboarding (§2.2.6): bila belum onboarding, validasi `p_onboarding` (`ONBOARDING_REQUIRED`, `INVALID_DISPLAY_NAME`, `INVALID_LOCALE`, `INVALID_TIMEZONE`).
6. Lock item batch `for update` (urut `entity_type`, `ordinal`); lock target `map` `for share` sesuai §2.2.12.
7. `internal.import_item_errors`; ada baris → `raise exception using errcode = '22023', message = 'IMPORT_ITEM_INVALID', detail = <jsonb array {item_id, field, code, existing_id}>`. Detail hanya ID dan kode.
8. `set_config('workpulse.import_commit', 'on', true)`.
9. Insert `create` untuk experience, education, certification, skill (urut ordinal); simpan `committed_id`.
10. Achievement `create`: resolve `experience_item_id` (item experience `create` → `committed_id`; `map` → `target_id`; `skip`/NULL → NULL). Insert `origin = 'import'`, `source_excerpt = item.source_excerpt`, `source_activity_revision = NULL`, field payload, `metrics` (default `[]`), `status = 'confirmed'` bila `confirm_requested` (cv_bullet NULL → `internal.factual_cv_bullet(contribution, outcome)`), selain itu `draft`. Simpan `committed_id`.
11. Profile `create`: update kolom di `selected_fields` saja.
12. Onboarding: set `display_name = btrim(...)`, `locale`, `timezone`, `onboarding_completed_at = coalesce(onboarding_completed_at, now())`.
13. Hitung `commit_result`; update batch `status = 'committed'`, `committed_at = now()`, `expires_at = committed_at`, `commit_result`.
14. Blok `exception when check_violation or not_null_violation or unique_violation or foreign_key_violation then raise exception using errcode = '22023', message = 'IMPORT_ITEM_INVALID'` (tanpa `detail` dari `sqlerrm`). Exception mengembalikan seluruh write.

### 3.3 Domain dan server

- `src/domain/import/commit-contracts.ts`: `IMPORT_ITEM_ACTIONS`, kode field (`REQUIRED`, `INVALID`, `TOO_LONG`, `DATE_RANGE`, `DUPLICATE`, `TARGET_UNAVAILABLE`, `INVALID_ACTION`), kode request (`IMPORT_ITEM_INVALID`, `IMPORT_NOT_COMMITTABLE`, `IMPORT_NOT_REVIEWABLE`, `IMPORT_TARGET_INVALID`, `INVALID_IMPORT_ITEM_INPUT`, `ONBOARDING_REQUIRED`, `STALE_REVISION`, `IMPORT_NOT_FOUND`), allowlist patch per tipe (sama persis dengan SQL), skema Zod `updateImportItemInput`, `commitImportInput`, `commitResultSchema`, dan `parseItemErrorsDetail(detail)` yang hanya menerima `{item_id: uuid, field, code, existing_id?}`.
- `src/features/import/import-review-service.ts`: `createImportReviewService({ supabase, correlationId })` → `updateItem`, `validate`, `commit`. Owner selalu dari session; ID asing → `NOT_FOUND` generik. Pemetaan kode di `import-errors.ts` (perluas, jangan ubah kode T15).
- `src/features/import/actions.ts`: tambah `updateImportItemAction` dan `commitImportAction` (Zod, correlation ID, `revalidatePath('/dashboard')` setelah commit). Belum dirender di UI mana pun (T17).
- `src/features/achievement/achievement-detail.tsx`: cabang `origin === 'import'` → label `achievement.importedFromCv`, excerpt, tanpa `achievement.sourceUnavailable`. Kunci baru en/id di `src/i18n/messages.ts`.
- `pnpm db:types` memperbarui `src/server/supabase/database.types.ts`.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20261001090000_t16_import_commit.sql`, `supabase/tests/database/import_commit.test.sql` |
| Modify | `src/server/supabase/database.types.ts` (`db:types`) |
| Modify (hanya bila assertion menyentuh check provenance, dengan alasan di receipt) | `supabase/tests/database/achievement.test.sql` |
| Create | `src/domain/import/commit-contracts.ts`, `src/features/import/import-review-service.ts` |
| Modify | `src/features/import/{actions,import-errors}.ts`, `src/features/achievement/achievement-detail.tsx`, `src/i18n/messages.ts` |
| Create | `tests/unit/{import-commit-contracts,import-review-service,import-review-actions}.test.ts`, `tests/unit/achievement-import-provenance-ui.test.tsx` |
| Create | `tests/integration/import-commit.test.ts`; bila perlu `tests/integration/import-helpers.ts` (ekstrak helper dari `import-staging.test.ts` **tanpa** mengubah assertion-nya) |
| Modify | `package.json` (script baru), `README.md` (Fase 5) |
| Create (Fase 5) | `docs/decisions/0022-t16-import-commit.md`, `docs/verification/T16-import-commit.md` |

Script baru:

- `test:integration:import-commit` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/import-commit.test.ts`

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD. Working tree harus bersih kecuali `.claude/`. Jika tidak, **stop**.
- [ ] `pnpm install --frozen-lockfile`, `pnpm db:status`, `pnpm exec supabase migration list --local`. Parity harus **25/25** dengan migration terakhir `20260930090000_t15_import_staging.sql`. Bila Docker mati, nyalakan dan `pnpm db:start` (tanpa reset).
- [ ] Baseline `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan 66 file / 424 test), `pnpm db:test` (harapan 10 file / 668 assertion), `pnpm test:integration:achievements` (harapan 5), `pnpm test:integration:dashboard` (harapan 4).
- [ ] Container ClamAV (`docs/verification/T10-scanner-runbook.md`) dan Gotenberg (`docs/verification/T15-renderer-runbook.md`) berjalan, lalu `pnpm test:integration:import` (harapan 21). Catat bila environment gagal; jangan ubah kode untuk "memperbaikinya".
- [ ] Verifikasi dari source dan catat file:baris untuk:
  - `import_items`/`import_batches` dan grant kolom (`20260930090000_t15_import_staging.sql:27-295`), `guard_import_item_row` (`:256`), `complete_import_ai_job` resolusi `experience_item_id` (`:1428-1432`), `purge_expired_import_batches` (`:1461`), `cancel_import_batch` (`:873`, urutan lock-nya).
  - Payload per tipe di `src/domain/import/extract-result.ts:249-342` (nama kunci persis).
  - `achievements` constraint dan `achievements_source_pair_check` (`20260922100000_t09_achievements_skills.sql:127-189`), `internal.factual_cv_bullet` (`:107`), `internal.is_valid_achievement_metrics` (`:52`), `enforce_achievement_context` (`:260`), logika confirm di `save_achievement` terbaru (`20260922110000_t09_achievement_null_patch.sql:113-119`) — pastikan `source_excerpt` tidak dapat diedit lewat `save_achievement`.
  - Constraint canonical foundation (`20260916090000_foundation_schema.sql:182-354`) **ditambah** check tambahan dari `20260916190000_t03_foundation_contract_hardening.sql` (panjang, format email/website/phone bila ada). Susun tabel "constraint → kode validasi" di receipt; tabel ini menjadi spesifikasi `internal.import_item_errors`.
  - `internal.normalize_skill_name`, `skills_user_normalized_name_key`, `internal.is_real_display_name`, `internal.is_valid_timezone`, `public.complete_onboarding` 4-argumen, `public.delete_experience` terbaru (`20260922100000_t09_achievements_skills.sql:1204`, urutan lock-nya untuk uji race).
  - Pemakaian `source_excerpt` di UI (`src/features/achievement/achievement-detail.tsx:66,101-110`) dan query dashboard/timeline T12 yang membaca `achievements.origin` atau `source_excerpt` (grep).
  - Jumlah row `achievements where origin = 'import'` di DB lokal (harapan 0).
- [ ] Tulis receipt Fase 0 `docs/verification/T16-phase0-baseline.md`. Commit `docs(t16): add phase 0 baseline receipt`.

### Fase 1 — Database (TDD pgTAP)

- [ ] Tulis `supabase/tests/database/import_commit.test.sql` yang gagal lebih dulu (pola `begin; select no_plan(); … select * from finish(); rollback;`, `pg_temp.set_jwt_subject`, setup batch `review` lewat RPC T15 sebagai `service_role` seperti di `import_staging.test.sql`). Assertion minimum:
  1. Struktur: kolom `confirm_requested`/`commit_result` + check; check provenance baru; trigger type-aware ada; `prosecdef` dan grant tiga RPC (authenticated saja); tidak ada grant write tabel import ke authenticated; `commit_result` terbaca authenticated, `extracted_text` tetap tidak.
  2. `update_import_item`: sukses menaikkan revision item dan batch; revision basi → `STALE_REVISION`; kunci di luar allowlist → `INVALID_IMPORT_ITEM_INPUT`; ubah `source_excerpt` mustahil; `confirm_requested` pada non-achievement atau `map` → ditolak; batch non-`review` → `IMPORT_NOT_REVIEWABLE`; `experience_item_id` ke item batch lain → ditolak.
  3. Trigger type-aware: map ke row akun B, ID acak, tabel salah, profile dengan target → `IMPORT_TARGET_INVALID`.
  4. `validate_import_batch`: setiap kode §1.11 muncul untuk fixture yang sesuai; `skip` tidak divalidasi; skill duplikat (DB dan intra-batch) → `DUPLICATE` (+ `existing_id` untuk DB); tanpa write.
  5. Commit sukses campuran (§1.1, §1.2): hitungan row canonical per tabel naik tepat sebesar `create`; `committed_id` benar; resolusi `experience_item_id` untuk create/map/skip; achievement draft vs confirmed + fallback cv_bullet; `origin = 'import'` dan `source_excerpt` = excerpt.
  6. Map tidak mengubah target: snapshot `to_jsonb(row)` target sebelum = sesudah (§1.5).
  7. Profil: hanya `selected_fields`; `map` profile ditolak; `skip` tanpa write (§1.7).
  8. Onboarding (§1.8): belum onboarding tanpa `p_onboarding` → `ONBOARDING_REQUIRED`; placeholder → `INVALID_DISPLAY_NAME`; valid → nama/locale/timezone/`onboarding_completed_at` terisi; sudah onboarding → nama tidak berubah.
  9. Rollback (§1.4): satu item invalid → `IMPORT_ITEM_INVALID`, semua hitungan canonical, `profiles.revision`, status batch, dan `committed_id` identik; uji juga pelanggaran yang lolos validasi (mis. paksa lewat fixture yang melewati `import_item_errors` bila memungkinkan, atau uji `exception` mapping dengan skill unique race tersimulasi).
  10. Idempotensi (§1.3): commit kedua mengembalikan `commit_result` identik, nol row baru, juga dengan revision lama.
  11. Status (§1.12): `queued`/`running`/`failed`/`cancelled`/purged → `IMPORT_NOT_COMMITTABLE`; revision basi → `STALE_REVISION`; akun B → `IMPORT_NOT_FOUND` untuk update/validate/commit; akun deleting → `AUTH_REQUIRED`.
  12. Guard setelah commit: update `action`/`target_id`/`committed_id`/`confirm_requested` pada item committed ditolak; `purge_expired_import_batches` tetap bisa mengosongkan payload/excerpt (§1.9) dan achievement tetap memegang `source_excerpt`.
  13. Regresi: `achievements_source_pair_check` masih menolak pasangan tidak lengkap untuk `origin` `manual`/`activity`.
- [ ] Pastikan `pnpm db:test` **FAIL** karena test baru. Tulis migration §3.1–§3.2, lalu `pnpm exec supabase migration up --local`. **Dilarang** `db reset`.
- [ ] `pnpm db:test` (PASS; catat total file/assertion), `pnpm db:lint`, `pnpm db:types`, migration list (26/26).
- [ ] Commit `feat(t16): add import commit transaction, review item RPC and target trigger`, lalu receipt Fase 1. Checkpoint Claude opsional di sini.

### Fase 2 — Kontrak domain, service, dan action (TDD unit)

- [ ] Test gagal lebih dulu:
  - `import-commit-contracts`: allowlist patch per tipe cocok dengan daftar SQL (satu sumber: konstanta diekspor dan dibandingkan di test dengan daftar yang dituliskan eksplisit); skema input menolak kunci asing, UUID invalid, `confirm_requested` non-boolean; `parseItemErrorsDetail` menolak detail yang memuat properti selain ID/kode.
  - `import-review-service`: tanpa session → `AUTH_REQUIRED` generik; pemetaan setiap kode DB → kode service + `messageKey` + `correlationId` UUID; `IMPORT_ITEM_INVALID` membawa daftar item error; `NOT_FOUND` untuk ID asing; commit ganda meneruskan hasil yang sama; pesan error tidak memuat payload/excerpt (sentinel).
  - `import-review-actions`: Zod pada FormData/JSON, origin check pola `src/features/import/http.ts`, `revalidatePath` dipanggil setelah commit sukses saja.
- [ ] Implementasi §3.3 hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t16): add import review service and commit actions`, receipt Fase 2.

### Fase 3 — Integration nyata

- [ ] `tests/integration/import-commit.test.ts` (setup seperti `tests/integration/import-staging.test.ts`: admin, owner A/B sign-in nyata, Storage lokal, ClamAV + parser thread nyata, renderer `fake`, fake AI `import_valid`). Batch `review` dibangun lewat pipeline T15 nyata (upload service → `worker:once`/pass import dan AI), bukan insert langsung. Skenario wajib:
  1. Rilis skenario PRD (§1.14): CV sintetis berbahasa Indonesia, dua `EXP` overlap (satu current), satu `EDU`, dua `SKILL` (satu sudah ada di akun → map), dua `ACH` (satu confirm, satu draft); edit `role_title` satu experience; commit lewat service; verifikasi row, overlap tersimpan, `experience_id` achievement, dashboard counts (service T12) dan timeline memuat experience/education.
  2. Commit paralel ×3 dari tiga client A (§1.3): tepat satu set row, tiga respons `commit_result` identik.
  3. Rollback (§1.4) lewat service: hitungan canonical dan profil sebelum = sesudah.
  4. Map milik akun B dan target yang dihapus sebelum commit (§1.5).
  5. Onboarding pengguna baru lewat commit, lalu `/dashboard` guard tidak lagi me-redirect ke onboarding (panggil loader/service yang dipakai guard, bukan browser).
  6. Race (§1.13) dengan dua koneksi nyata: commit vs `update_import_item`; commit vs `cancel_import_batch`; commit vs `delete_experience` atas target map. Tanpa `40P01`; hasil akhir konsisten.
  7. Purge setelah commit (§1.9): manipulasi `expires_at` lewat admin, jalankan pass purge + cleanup import, cek object Storage tidak ada, achievement `source_excerpt` tetap, mapping item tetap.
  8. Isolasi (§1.12) lewat service dan query klien langsung (insert/update tabel import ditolak).
  9. Log hygiene (§1.16): sentinel isi CV dan nama file tidak muncul di error, detail, `commit_result`, respons service, dan stdout/stderr proses worker yang dijalankan test.
- [ ] Tambah script `test:integration:import-commit` dan jalankan. Regresi: `test:integration:import`, `achievements`, `dashboard`, `activity`, `projects`, `m2`, `ai`, `ai-review`.
- [ ] Commit `test(t16): add real integration suite for import commit`, receipt Fase 3.

### Fase 4 — Provenance S08 dan regresi penuh

- [ ] Test render gagal lebih dulu `achievement-import-provenance-ui` (pola `tests/unit/*-ui.test.tsx` yang ada): `origin = 'import'` → label import + excerpt, tanpa `sourceUnavailable`; `activity` dengan activity terhapus → perilaku lama tetap; en/id.
- [ ] Implementasi §3.3 bagian S08. `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] Jalankan seluruh §7. `test:e2e:m2` wajib lulus tanpa melemahkan assertion env (kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk run itu). ClamAV dan Gotenberg wajib berjalan untuk suite yang membutuhkannya; bila tidak, catat **tidak dijalankan** beserta alasan.
- [ ] Commit `feat(t16): show import provenance on achievement detail`, receipt Fase 4. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–4, output command, tabel constraint → kode validasi, dan daftar acceptance yang belum terbukti.

### Fase 5 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0022-t16-import-commit.md`: keputusan §2.2 poin 1–19, kode error, urutan lock, alternatif yang ditolak (pilihan dikirim sekaligus saat commit, auto-map skill, kolom excerpt baru di tabel foundation, `operation_requests` untuk commit), seam T17 (RPC, `validate_import_batch`, `existing_id`, prefill nama) dan T20 (freshness profil).
- [ ] `docs/verification/T16-import-commit.md`: pass/fail/warning/tidak dijalankan, trace ke R02, F01, S03, DB §4/§6, dan setiap poin §1.
- [ ] README (bagian Import: commit, script baru, tabel quality gates).
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- Owner A: locale `id`, timezone `Asia/Jakarta`, consent terkini, **belum** onboarding (untuk skenario onboarding) atau sudah onboarding (skenario lain) — buat dua akun terpisah bila perlu.
  - Skill lama milik A: `SQL` (untuk map dan duplikat).
  - Experience lama milik A: `PT Lama Sentosa / Staf` (target map; dipakai juga untuk race `delete_experience`).
  - CV sintetis dengan baris fake scenario T15, misalnya:
    - `EXP|PT Sentinel Nusantara|Analis Data|2019|2022`
    - `EXP|WP Labs|Data Lead|2021|` (overlap, current)
    - `EDU|Universitas Contoh|S1 Statistika|2014|2018`
    - `SKILL|SQL` dan `SKILL|Python`
    - `ACH|Menurunkan waktu laporan dari 5 ke 2 jam|PT Sentinel Nusantara`
  - Fake `import_valid` (`src/server/ai/fake-provider.ts:19-55`) tidak menghasilkan profile dan membuat achievement tanpa `contribution`/`outcome`/`achieved_on`. Achievement yang akan di-confirm harus dilengkapi lewat `update_import_item` (ini sekaligus menguji edit review). Item profile diuji di pgTAP dengan `complete_import_ai_job` ber-payload kustom sebagai `service_role`.
  - Sentinel privat di isi CV: `WP-PRIVATE-IMPORT-SENTINEL-<uuid>`; nama file `cv-WP-FILENAME-SENTINEL-<uuid>.pdf`.
- Owner B: batch dan row sendiri untuk isolasi dan map lintas akun.
- Setiap test membersihkan akun fixture (termasuk object Storage prefix `import`) seperti suite T15.

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
pnpm test:e2e:import
pnpm test:e2e:achievements
pnpm test:e2e:dashboard
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

`test:integration:import-commit` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan (di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong). Muat env Supabase lokal dalam command yang sama dengan suite (env PowerShell tidak bertahan antar command). Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, atau parity bukan 25/25.
- Penyelesaian memerlukan `db reset`, rewrite migration lama, kolom baru di tabel canonical, atau perubahan daftar schema yang di-expose.
- Pengguna menolak keputusan §2.2.1 (RPC update item di T16), §2.2.5 (relaksasi check provenance achievement), §2.2.6 (onboarding lewat commit), atau §2.2.9 (skill duplikat sebagai error). Laporkan alternatif dan tunggu keputusan.
- Ada row `achievements.origin = 'import'` di DB lokal yang melanggar check baru, atau kode yang bergantung pada `source_excerpt ⇒ source_activity_revision`.
- Relaksasi check atau guard item mengubah hasil pgTAP/integration T09/T14/T15 dan tidak bisa dipulihkan tanpa mengubah kontrak mereka.
- Race commit memicu deadlock yang hanya bisa dihilangkan dengan mengubah urutan lock fungsi T02/T08/T09/T15.
- Implementasi terasa memerlukan UI S03, route `/imports/:id/review`, entry import pengguna lama, CV invalidation, skill link achievement, project import, atau purge batch `review` (T17/T18–T20/T23).
- Test membutuhkan key nyata, atau sentinel/nama file muncul di output.

## 9. Gate review Claude (setelah Fase 4)

Review read-only mencakup:

- Tidak ada write klien langsung ke `import_batches`/`import_items`; tiga RPC saja, grant dan `security definer`/`search_path` benar.
- Commit benar-benar atomik: satu kegagalan (validasi, constraint, target hilang) mengembalikan semua write; tidak ada `committed_id` atau status `committed` parsial.
- Idempotensi: commit ganda berurutan dan paralel mengembalikan hasil sama tanpa row baru.
- Map hanya reuse dan milik sendiri; trigger type-aware menutup semua tipe; target tidak berubah.
- Achievement hanya confirmed bila `confirm_requested` dan field wajib valid; tidak ada auto-confirm; `origin = 'import'`, excerpt tersalin.
- Profil hanya field terpilih; nama hanya lewat `p_onboarding`; onboarding sesuai invariant decision 0002.
- Validasi SQL setara dengan constraint canonical; `validation_errors` AI tidak dipakai sebagai gerbang.
- Urutan lock konsisten; test race tanpa deadlock.
- Retensi: purge T15 menjaga mapping dan excerpt achievement.
- Error hanya kode dan ID; tidak ada payload, excerpt, atau nama file di log/detail/response.
- S08 tidak menampilkan copy yang salah untuk achievement import; tidak ada fitur roadmap atau UI S03 prematur.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Commit parsial.** Exception ditangkap terlalu lebar (mis. `when others` yang mengembalikan nilai) sehingga sebagian insert tetap ter-commit, atau status `committed` ditulis sebelum semua insert. Dijaga pgTAP 9 dan integration 3 (hitungan sebelum/sesudah).
2. **Double commit menduplikasi.** Status diperiksa sebelum lock, atau revision dibandingkan sebelum cek `committed`, sehingga retry kedua gagal `STALE_REVISION` atau membuat row kedua. Dijaga pgTAP 10 dan integration 2 (paralel ×3).
3. **Map menulis target atau menembus akun.** Trigger type-aware hanya memeriksa satu tipe, atau commit memperbarui row target (mis. menyalin payload). Dijaga pgTAP 3/6 dan integration 4.
4. **Validasi SQL tertinggal dari constraint canonical.** Constraint T03 (panjang/format) tidak tercakup sehingga commit menabrak error mentah atau pesan PostgreSQL bocor. Dijaga tabel constraint Fase 0, pgTAP 4/9, dan unit pemetaan error.
5. **Relaksasi provenance melemahkan T09/T14.** Check baru mengizinkan achievement `activity`/`manual` dengan excerpt tanpa revision. Dijaga pgTAP 13 dan regresi `achievement.test.sql`/`ai_review.test.sql`.
6. **Deadlock dengan operasi foundation.** Commit mengunci target sebelum item, atau urutan tabel berbeda dari `delete_experience`. Dijaga integration 6.

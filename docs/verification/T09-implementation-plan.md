# Rencana Implementasi T09 Manual Achievements dan Skills

Tanggal: 21 September 2026.

Target pelaksana: **GPT-5.6 Luna dengan reasoning MAX**.

Status terkini: **DONE per 25 September 2026 setelah acceptance remediasi lulus**. T08 tetap DONE,
T10 tetap TODO, dan Gate M2 tetap terbuka sampai task M2 berikutnya selesai.

Status implementasi sebelum review: **DONE per 24 September 2026**. Hard gate remediasi review T08 sudah DONE
dan T09 sudah dieksekusi pada working tree aktual. Migration, RPC, route S07/S08, test, dan hasil
verifikasi T09 dicatat pada [verification T09](T09-manual-achievements-skills.md). Dokumen ini tetap
menjadi source plan untuk scope dan Definition of Done; Gate M2 tetap terbuka sampai T10–T12 selesai.

### Checkpoint acceptance remediasi — 25 September 2026

Seluruh acceptance review yang tertunda sudah lulus terhadap Docker Desktop dan local Supabase:
Achievement integration 5/5, Project integration 7/7, Achievement browser 3/3, Auth/Activity/Project
browser masing-masing 1/1, 32 file / 159 unit tests, TypeScript, ESLint, production build, dan
`git diff --check`. Rincian perintah, warning non-blocking, serta alasan pgTAP/DB lint tidak diulang
ada di [verification T09](T09-manual-achievements-skills.md) dan
[rencana remediasi](T09-review-remediation-plan.md). Tidak ada perubahan SQL atau database reset.

### Checkpoint remediasi review — 24 September 2026 (historis, Docker belum tersedia)

RV1–RV6 sudah diimplementasikan dan regresi ditambahkan. Semua unit lulus (32 file/159 tests),
TypeScript, ESLint, dan production build lulus. Database integration dan browser E2E belum dijalankan
karena Docker Desktop Linux engine tidak tersedia; rincian bukti ada di
[verification T09](T09-manual-achievements-skills.md). Tidak ada migration, perubahan schema/RPC,
backfill, atau reset database. T09 tetap **PARTIAL**, T08 **DONE**, T10 **TODO**, dan Gate M2 terbuka.
Langkah berikutnya adalah menjalankan acceptance database/browser yang tertunda saat Docker tersedia.

### Checkpoint eksekusi final sebelum review — 24 September 2026

T09.0–T09.8 sudah dikerjakan pada working tree aktual: decision, migration/RPC, generated types,
service/actions, S07/S08, Activity/Project seam, database race/ownership checks, responsive/Axe
browser acceptance, regression integration, clean disposable rebuild dari nol, dan full existing
Activity/Project browser regression. Bukti angka dan command ada di
[T09 verification](T09-manual-achievements-skills.md). Status historis pada checkpoint ini adalah
DONE; review berikutnya membuka kembali T09 menjadi PARTIAL.

## Hasil yang harus dicapai

T09 menyediakan jalur manual lengkap dari Activity atau Project menuju Achievement yang dapat
ditinjau dan dikonfirmasi tanpa AI. Pengguna dapat membuat Achievement standalone atau turunan dari
satu Activity, menyimpan draft, mengonfirmasi, dismiss, reopen, mengedit Achievement confirmed yang
tetap valid, memberi skill label, serta menghapus record dengan dependency preview. Satu Activity
tidak pernah mempunyai lebih dari satu derived Achievement, termasuk saat request bersaing.

T09 juga menutup seam context T08: Activity dan derived Achievement selalu mempunyai Project dan
Experience yang sama; perubahan context Project, relink Activity, delete Project, dan delete
Experience memperbarui Achievement dalam transaksi yang sama. Delete Activity mempertahankan
Achievement beserta source excerpt dan source revision. Confirmed Achievement menjadi eligible untuk
selection pool CV masa depan, tetapi tidak otomatis dipilih dan T09 tidak membuat CV behavior.

## Gate dependensi

- T01-T07 tetap DONE berdasarkan checkpoint yang ada.
- Implementasi dasar T08 tersedia, tetapi status authoritative T08 saat plan ini ditulis adalah
  PARTIAL karena empat temuan review masih menunggu remediasi.
- Luna harus membaca hasil akhir remediasi T08, termasuk decision lock hierarchy dan signature RPC
  final. Jangan memulai migration atau coding T09 selama T08 belum kembali DONE.
- Setelah T08 DONE, jalankan baseline ulang terhadap working tree aktual. Jangan menyalin jumlah test
  dari checkpoint lama sebagai hasil baru.
- Pertahankan seluruh dirty changes T07-T08. Dilarang reset, checkout, atau mengedit migration yang
  sudah diterapkan.

Jika T08 belum DONE ketika prompt eksekusi dijalankan, Luna harus berhenti setelah pemeriksaan
read-only, mencatat blocker konkret, dan tidak membuat scaffold T09 yang bergantung pada kontrak T08
yang belum final.

## Acuan wajib

### Instruksi dan checkpoint

- `AGENTS.md` dan `docs/AGENTS.md`.
- `docs/IMPLEMENTATION_STATUS.md`, khususnya status authoritative T08 dan tracker T09.
- `docs/IMPLEMENTATION_PLAN.md` bagian 1, 3, 4, acceptance T08-T12, matriks R05/R06, dan Gate M2.
- `docs/verification/T08-review-remediation-plan.md`, verification final T08, serta decision T08
  final termasuk decision remediasi yang dibuat sebelum T09.
- Implementasi aktual Activity, Project, Profile/Skills, shared actions, route filters, draft recovery,
  Supabase migrations, generated types, dan tests; jangan mengandalkan nama file dari plan bila kode
  aktual sudah berubah.

### Dokumen sumber

- PRD R05 dan R06, shared validation/deletion/privacy/performance, serta skenario graduate manual.
- User Flow F02-F04 dan shared recovery; khususnya lifecycle Achievement dan context propagation.
- Wireframe S06-S10; terutama S07 Achievements dan S08 Review achievement.
- Database Schema bagian 1-3 dan 6: cardinality, field canonical, context, transaksi, deletion, dan
  index.
- `docs/Design.md` bagian Achievement, form, destructive action, state, responsive, dan
  accessibility dengan resolusi konflik pada `IMPLEMENTATION_PLAN.md` bagian 1.
- Mockup `design-mockups/S07.html`, `S08.html`, dan render 360/1440 light/dark sebagai referensi
  hierarchy saja. Data, AI, Evidence, dan CV action pada mockup bukan bukti capability yang sudah ada.

Trace minimum yang harus dipertahankan pada decision, verification, dan status:

| Sumber | Kontrak T09 |
| --- | --- |
| PRD R05 | Hanya konfirmasi eksplisit membuat Achievement CV-eligible; qualitative outcome valid; metric/evidence opsional; source dipertahankan; satu derived Achievement per Activity. |
| PRD R06 | Achievement boleh standalone atau terkait Project; context Project/Experience konsisten. |
| Flow F02 | Manual create tetap bekerja tanpa AI; Activity tersimpan lebih dahulu. |
| Flow F03 | Filter draft/confirmed/dismissed/project; transition guard; skill count hanya confirmed; delete mempertahankan Activity. |
| Flow F04 | Relink Activity memperbarui derived Achievement atomik; delete Project mempertahankan karya dan Experience. |
| Screen S06 | Activity menampilkan Create/Open achievement; source edit tidak menimpa Achievement; delete mempertahankan derived Achievement. |
| Screen S07 | Compact list, status text, project/date/outcome, 30-row pagination, filter URL, state empty/error/loading. |
| Screen S08 | Required confirmation fields, optional metrics/skills, factual CV fallback, source beside editor, explicit lifecycle actions. |
| DB bagian 3/6 | Composite ownership, unique derived Activity, confirmed checks, metric JSON validation, atomic context/delete, provenance retention. |

## Keputusan scope T09

### Termasuk

- Migration forward-only untuk `achievements` dan `achievement_skills` serta extension RPC T08/T06
  yang diperlukan untuk context dan deletion.
- Owner-scoped create idempotent untuk Achievement standalone dan derived manual.
- Lifecycle `draft`, `confirmed`, `dismissed` dengan transition guard database.
- Edit dengan `expected_revision`, local-input-preserving conflict, dan safe unavailable state.
- S07 `/achievements`: filter status dan Project di URL, cursor stabil 30 row, list, loading, empty,
  no-match, error, dan deep-link safety.
- S08 `/achievements/new` dan `/achievements/[id]`: source panel, editor manual, skills, metrics,
  factual CV bullet fallback, confirm/dismiss/reopen/delete, unsaved guard, conflict recovery.
- Activity detail: Create achievement ketika belum ada, Open achievement ketika sudah ada, dan
  dependency-aware Activity delete yang mempertahankan Achievement provenance.
- Project detail: daftar Achievement minimal, create linked Achievement, serta attach/move/detach
  owned Achievement dengan context behavior yang jelas.
- Skill tags memakai tabel `skills` yang sudah ada; demonstrated count dihitung dari distinct
  confirmed Achievement, tidak disimpan sebagai proficiency.
- PostgreSQL nyata untuk RLS dua akun, constraints, lifecycle, optimistic concurrency, context
  propagation, deletion, dan race satu-derived-Achievement.
- Bilingual id/en, responsive 360/1440, light/dark, keyboard, focus, reduced motion, dan Axe pada
  state representative.

### Tidak termasuk

- AI detection/refinement, follow-up questions, consent, jobs, suggestion banner, auto-fill, atau
  source apply; semuanya T13-T14.
- Evidence table, upload, screening, attachment state/count, dan filter `missing evidence`; semuanya
  T10-T11/T12. Jangan merender angka nol atau kartu Evidence palsu.
- Import candidates/commit; semuanya T15-T17.
- CV selection, Add to CV action aktif, source refresh/invalidation, builder, export, dan PDF;
  semuanya T18-T22. Confirm hanya membuat record eligible secara domain.
- Dashboard/Timeline count dan event; semuanya T12.
- Skill proficiency/readiness/level, skill inference, duplicate skill taxonomy, global search,
  command palette, coach, target job, streak, atau feature roadmap lain.
- Mengubah Activity raw text, Chat history, atau isi source saat membuat/edit Achievement.
- Dependency atau worker baru. T09 tidak mempunyai background job.
- Hosted/staging/production deployment dan performance T24.

## Kontrak data yang harus diputuskan sebelum migration

Catat keputusan final pada `docs/decisions/0014-t09-achievement-lifecycle.md` atau nomor berikutnya
yang tersedia. Jika remediasi T08 memakai nomor 0014, pilih nomor berikutnya; jangan menimpa decision.

### 1 Achievement canonical

Tambahkan `public.achievements` dengan common ownership/audit/revision fields dan field canonical:

- `activity_id`, `experience_id`, `project_id` UUID nullable;
- `title`, `contribution`, `scope`, `outcome`, `cv_bullet` text nullable;
- `achieved_on` exact date nullable;
- `status` hanya `draft`, `confirmed`, `dismissed`;
- `origin` hanya `manual`, `activity`, `import` walaupun T09 hanya membuat manual/activity;
- `source_excerpt` text nullable dan `source_activity_revision` integer nullable;
- `metrics` JSONB array default `[]`.

Gunakan batas teknis eksplisit dan sama di Zod/SQL/UI: title 200 Unicode code points;
contribution/scope/outcome masing-masing 5.000; CV bullet 2.000; source excerpt maksimal 10.000
sesuai Activity. Jangan trim/truncate diam-diam. Optional text disimpan `NULL`, bukan empty string.

Confirmed mensyaratkan title, contribution, outcome, achieved_on, dan cv_bullet valid. Draft dan
dismissed boleh incomplete. Qualitative outcome tanpa metric sah. `status` tidak boleh berubah lewat
direct table update dari browser.

### 2 Metrics canonical

Satu metric adalah object strict dengan:

- `label`: nonblank, maksimal 100;
- `value`: finite JSON number;
- `unit`: nonblank, maksimal 50;
- `baseline`: finite JSON number opsional;
- `period`: nonblank maksimal 100 opsional.

Batasi maksimal 20 metric dan payload serialized 20 KiB untuk mencegah abuse. Jangan melarang nilai
negatif atau desimal. Row UI yang seluruhnya kosong dibuang sebelum submit; row parsial menghasilkan
field error. SQL validation function harus menolak object/key/type tambahan, string-number, NaN,
missing value/unit, array non-object, dan payload berlebih. Jangan mengisi nol sebagai fallback.

### 3 Skill labels dan demonstrated count

`achievement_skills` menyimpan `(user_id, achievement_id, skill_id)` dengan composite FK owner dan
unique triple. Maksimal 20 skill tag per Achievement. Label memakai normalization tabel `skills`
yang sudah ada: trim dan case-fold; unique `(user_id, normalized_name)` tetap authority.

Save Achievement menerima label/ID yang sudah divalidasi server, lalu dalam transaksi yang sama:

1. lock Achievement;
2. resolve existing owned skills berdasarkan normalized name;
3. create missing skill sekali di bawah unique constraint tanpa mengganti casing record existing;
4. replace join set secara deterministic;
5. update Achievement revision/status.

Browser tidak mengirim `user_id`. Demonstrated count selalu query `COUNT(DISTINCT achievement_id)`
dengan status live `confirmed`; draft dan dismissed tidak pernah dihitung. Rename skill tidak mengubah
join. Delete skill menghapus join saja dan tidak menghapus Achievement.

### 4 Factual CV bullet fallback

Fallback hanya berjalan saat Confirm dipilih dan cv_bullet kosong. Helper domain menyusun contribution
dan outcome yang diberikan pengguna tanpa parafrasa, terjemahan, angka, causality, seniority, atau
fakta baru. Aturan deterministic:

- trim hanya whitespace tepi masing-masing field;
- pertahankan isi dan bahasa sumber;
- gabungkan contribution dan outcome dengan `. ` bila contribution belum berakhir punctuation,
  atau satu spasi bila sudah;
- jangan menggandakan outcome yang identik dengan contribution;
- bila hasil melebihi 2.000 code points, jangan truncate; minta pengguna menulis CV wording lebih
  ringkas.

Unit test harus membuktikan Unicode id/en, punctuation, duplicate text, whitespace, dan over-limit.
Fallback tidak dipanggil saat Save draft dan tidak mengubah Activity.

### 5 Provenance derived Achievement

Derived create hanya menerima `activity_id`; database membaca Activity owned yang terkunci lalu
menyalin `experience_id`, `project_id`, `raw_text` persis ke `source_excerpt`, serta Activity
`revision` ke `source_activity_revision`. Browser tidak boleh menetapkan source excerpt/revision atau
context authoritative.

Enforce partial unique index `UNIQUE(user_id, activity_id) WHERE activity_id IS NOT NULL`. Standalone
Achievement mempunyai `activity_id=NULL`; source fields juga NULL dan tetap valid tanpa Experience
atau Project.

Edit Activity setelah derived Achievement dibuat tidak menimpa source excerpt, wording, atau status.
S08 membandingkan live Activity revision dengan `source_activity_revision` dan menampilkan `Source
changed` bila berbeda. T09 tidak menerapkan AI result atau memaksa re-confirm.

Delete Activity mengunci derived Achievement, memastikan provenance sudah lengkap, mengosongkan
`activity_id`, lalu menghapus Activity/Chat. Achievement, Experience, Project, status, fields, skills,
source excerpt, dan source revision tetap ada. Receipt dan UI menjelaskan jumlah Achievement yang
dipertahankan.

### 6 Lifecycle dan revision

Allowed transitions:

- `draft -> confirmed` atau `draft -> dismissed`;
- `dismissed -> draft`;
- `confirmed -> draft`;
- same-status save untuk draft/dismissed;
- same-status edit untuk confirmed hanya bila seluruh required fields tetap valid.

Tidak ada direct `dismissed -> confirmed` dan tidak ada direct `confirmed -> dismissed`. Reopen
menjadi draft lebih dahulu. Confirm, dismiss, reopen, edit, skill replacement, relink, dan source
detachment yang mengubah row memakai expected revision dan menaikkan revision tepat sekali per
logical operation. No-op tidak boleh menghasilkan receipt sukses yang menutupi stale revision.

Create memakai stable operation UUID dan ledger scoped `achievement.create`. Request identik
mengembalikan immutable receipt awal; key sama dengan payload berbeda ditolak. Dua operation key
berbeda yang bersaing untuk Activity sama menghasilkan satu derived Achievement dan safe conflict;
tidak boleh ada duplicate.

### 7 Context dan lock hierarchy

Setelah remediasi T08 selesai, extend hierarchy final menjadi:

`Experience -> Project -> Activity -> Achievement -> achievement_skills`

Kunci row dalam setiap kelompok berdasarkan UUID ascending bila lebih dari satu. Skill rows yang
diubah dikunci setelah Achievement berdasarkan normalized name/UUID. Jangan memperkenalkan urutan
terbalik pada delete/update Skill.

Aturan context:

- derived Achievement selalu mengikuti `experience_id` dan `project_id` Activity;
- standalone Achievement dengan Project menurunkan Experience dari Project, termasuk NULL;
- standalone tanpa Project boleh memakai Experience owned atau NULL;
- detach standalone dari Project mempertahankan Experience saat ini;
- attach/move derived Achievement berarti relink source Activity dan Achievement bersama;
- Project Experience edit memperbarui semua linked Activity dan Achievement atomik;
- delete Project mengosongkan Project link Activity/Achievement dan mempertahankan Experience;
- delete Experience membersihkan Experience pada Project/Activity/Achievement sesuai contract
  foundation tanpa menghapus karya.

Redefine RPC T06/T08 dengan migration forward-only, bukan mengedit migration historis. Activity dan
derived Achievement yang berubah masing-masing naik revision tepat sekali. Receipt Project delete
ditambah jumlah released Achievement tanpa menghapus field receipt lama. Preserve compatibility
signature bila client lama masih memakai RPC; bila return type harus berubah, buat versioned RPC atau
drop/recreate dengan regenerated types dan update seluruh caller/test dalam migration yang sama.

### 8 Ownership, grants, dan privacy

- RLS aktif pada dua tabel baru.
- Semua parent memakai composite FK `(user_id, id)`; tidak ada join lintas akun.
- `authenticated` hanya mendapat SELECT tabel baru dan EXECUTE RPC sempit. Revoke direct
  INSERT/UPDATE/DELETE pada Achievement/join.
- Session/auth.uid adalah owner authority; service credential path masa depan tetap harus mengecek
  owner dan `profiles.deleting_at`.
- Foreign/missing/deleted ID menghasilkan response indistinguishable tanpa title/source leak.
- Error mempunyai safe code, localized message key, correlation ID, dan optional field errors.
- Jangan log title, contribution, outcome, cv_bullet, source excerpt, Activity raw text, skill input,
  metrics payload, FormData, token, atau secret.

## Contract UI

### S07 Achievements

- Route `/achievements` memakai URL filters allowlist `status=draft|confirmed|dismissed`, owned
  `project`, dan opaque cursor; unknown/duplicate/malformed params dibuang dari canonical URL.
- Default `All`; tabs/status controls menampilkan text, bukan warna saja. Jangan tampilkan total palsu
  bila query hanya memuat satu page. Count hanya ditampilkan bila query count nyata dan bounded.
- Order canonical `achieved_on DESC NULLS LAST, id DESC`. Cursor harus mewakili bucket tanggal
  present/null agar draft tanpa tanggal tidak duplicate/skip. Page size 30 dan server mengambil 31.
- Row compact menampilkan title atau localized `Untitled draft`, concise outcome, exact date atau
  `Date not set`, Project/Experience context, skill labels ringkas, dan status text.
- Jangan menampilkan Evidence count/filter sampai T11. Confirmed row dapat menyatakan `CV eligible`,
  bukan `Added to CV`.
- Filter/status/cursor dipertahankan melalui safe return ketika membuka S08. Back setelah mutation
  kembali ke sanitized filter tanpa external redirect atau loop.
- Empty all, empty draft, empty confirmed, dismissed, no-match, loading skeleton, error/reference ID,
  dan unavailable harus berbeda. Empty state menawarkan Add achievement atau Quick log yang benar.

### S08 create dan review

- `/achievements/new` membuat standalone draft. Optional owned `activity` atau `project` query hanya
  menjadi prefill setelah server ownership validation. Invalid/foreign prefill tidak membocorkan data
  dan form standalone tetap berfungsi.
- `/achievements/[id]` membedakan draft/dismissed/confirmed dengan heading/action yang jelas.
- Desktop 1440 dapat memakai source/editor dua kolom; mobile 360 menumpuk source sebelum editor.
- Source panel menampilkan Activity original dan context hanya untuk derived record; data tidak
  editable di panel dan tidak berubah saat Achievement save.
- Form fields: title, contribution, outcome, achieved_on, cv_bullet, optional scope, metrics, skills,
  Experience/Project untuk standalone. Project selection derives Experience dan menjelaskan akibat.
- Skills memakai accessible combobox/tag control atau checklist/search sederhana dari owned labels;
  free text dapat membuat label. Keyboard add/remove dan duplicate normalized feedback wajib.
- Metrics memakai repeatable labeled rows dengan Add/remove, bukan satu opaque text input.
- Save draft, Confirm, Dismiss, Reopen as draft, Save changes, dan Delete adalah explicit actions.
  Hanya satu primary action per decision area. Disable repeat submit saat pending.
- Confirm memfokuskan field invalid pertama. Kegagalan, session expiry, atau conflict mempertahankan
  input lokal/session draft. Restored draft membawa base revision; stale/unknown memerlukan review
  atau rebase eksplisit.
- Confirmed edit tetap confirmed hanya bila valid. Reopen menghapus CV eligibility. Dismissed harus
  reopen sebelum Confirm.
- Source changed banner bersifat informatif/actionable dan tidak overwrite. AI state/follow-up tidak
  dirender pada T09.
- `Add to CV` tidak aktif sebelum T18; jangan membuat link palsu. Copy cukup menjelaskan bahwa
  confirmed Achievement akan tersedia untuk CV selection nanti.

### Integrasi S06 Activity

- Detail membaca lookup minimal derived Achievement. Bila belum ada, tampilkan `Create achievement
  manually`; bila ada, `Open achievement` dengan status.
- CTA create membawa safe return dan source Activity owned. Race click/retry tetap satu record.
- Edit Activity tidak memutasi Achievement; setelah revision berbeda, S08 menunjukkan source changed.
- Tambahkan named Activity delete dialog. Preview memuat jumlah Chat dan apakah satu derived
  Achievement akan dipertahankan. Jika preview gagal, destructive submit disabled.
- Delete receipt kembali ke sanitized Activity list dan menyatakan Achievement retained bila ada.
  Jangan menyatakan Evidence dihapus sebelum T11.

### Integrasi S10 Project

- Project detail menambahkan compact Achievement section tanpa mengubah hierarchy S10 yang ada.
- Create linked Achievement membuka S08 new dengan owned Project preselected.
- Attach/move/detach standalone Achievement memakai current Achievement revision dan derives context
  server-side.
- Untuk derived Achievement, attach/move/detach harus menjelaskan bahwa source Activity ikut berpindah
  dan memakai expected revision keduanya atau RPC authoritative yang mengunci keduanya. Jangan membuat
  mismatch dengan mengubah Achievement saja.
- Context-change confirmation dan delete Project menampilkan Activity serta Achievement counts nyata.
  Failure mempertahankan selection/input dan menyediakan reload/review.
- Candidate list owner-scoped, paginated 30, filter-before-limit, dan tidak mengambil source excerpt
  atau narrative fields yang tidak dibutuhkan.

### Delete Achievement dan Skill

- Achievement delete preview menyebut Achievement title, jumlah skill link yang dilepas, Project link,
  dan bahwa source Activity tetap ada. Delete menghapus Achievement dan join dalam satu transaksi.
- Karena T11/T20 belum ada, jangan membuat klaim Evidence/CV cleanup. Catat seam bahwa RPC delete
  diperluas T11/T20 untuk direct Evidence dan CV source invalidation.
- S12 Skill delete preview setelah T09 menampilkan jumlah confirmed/draft/dismissed Achievement yang
  akan kehilangan tag. Delete Skill tidak menghapus Achievement; demonstrated count berubah dari
  query live.

## Urutan kerja untuk Luna

Kerjakan subtask berurutan. Setiap subtask harus meninggalkan test focused yang lulus sebelum lanjut.

### T09.0 Dependency gate dan baseline

1. Baca semua acuan wajib dan pastikan status T08 DONE setelah remediasi.
2. Inspect `git status --short`, diff, migrations applied, generated types, dan implementation nyata.
3. Pastikan Supabase lokal benar aktif; jangan reset database aktif.
4. Jalankan baseline pada bagian Perintah verifikasi dan catat hasil/angka aktual.
5. Jika baseline gagal karena perubahan existing, bedakan defect T09 dari blocker dan jangan menutupi
   failure dengan perubahan di luar scope.

Acceptance: dependensi valid, dirty changes dipertahankan, baseline tercatat, dan tidak ada file T09
yang dibuat bila T08 masih PARTIAL.

### T09.1 Decision, domain contract, dan failing tests

1. Tulis decision lifecycle/provenance/context/limits/lock hierarchy.
2. Tambahkan domain types, Zod schemas, metric validator, CV fallback, filter/cursor contract, dan
   transition matrix.
3. Tulis unit tests untuk limits Unicode, metrics, fallback, transitions, query parsing, nullable-date
   cursor, context display, and action mapping.
4. Tulis pgTAP/integration tests yang gagal karena tabel/RPC belum ada, termasuk two-account and race
   scenarios. Pastikan failure berasal dari capability yang belum ada, bukan fixture/setup.

Acceptance: keputusan tidak menyisakan product guess; focused tests merah untuk alasan yang tepat.

### T09.2 Migration schema dan mutation RPC

1. Tambahkan satu atau beberapa migration forward-only setelah migration remediasi T08.
2. Buat table/index/check/RLS/composite FK/grants untuk Achievement dan join.
3. Buat SQL JSON metrics validator dan confirmed invariant.
4. Implement idempotent create, save/transition with skill replacement, relink, delete Achievement,
   delete Activity retention, dan dependency preview/read functions yang memang perlu.
5. Redefine Activity/Project/Experience RPC untuk Achievement context sesuai lock hierarchy final.
6. Tambahkan pgTAP untuk direct mutation denial, owner isolation, constraints, transition guards,
   replay, propagation, retention, receipt, and races.

Acceptance: seluruh invariant tetap benar walau UI dilewati; satu Activity tidak bisa mendapat dua
derived Achievement; tidak ada partial context atau cross-owner join.

### T09.3 Generated types, service, dan actions

1. Apply migration incremental ke stack lokal aktif tanpa reset, lalu regenerate Supabase types.
2. Tambahkan Achievement contracts/service/actions mengikuti pola Activity/Project, bukan generic
   mutation yang menerima arbitrary table/columns.
3. Implement session owner boundary, safe database error mapping, UUID correlation, idempotent receipt,
   list/detail/candidate/dependency queries, and conflict latest record.
4. Extend Activity/Project services hanya pada seam Achievement; pertahankan semantics T06-T08.
5. Tambahkan integration PostgreSQL untuk service/action boundary dan dua akun.

Acceptance: service tidak mempercayai owner/context/source/status dari browser; receipt replay dan
conflict behavior stabil; generated types cocok schema applied.

### T09.4 S07 list dan filters

1. Implement route, loading, filter controls, list rows, stable cursor, safe return, and states.
2. Tambahkan dictionary id/en dan style scoped memakai primitives/token existing.
3. Tambahkan unit/component tests untuk URL, nullable-date cursor, labels, no fake count, dan return.
4. Jangan menambahkan Evidence/AI/CV control aktif.

Acceptance: status/project filtering dan pagination stabil; 30-row boundary tidak duplicate/skip;
draft tidak disebut CV eligible.

### T09.5 S08 editor dan lifecycle

1. Implement standalone/derived create, detail source panel, form, metrics, skill tags, session draft,
   unsaved navigation, and validation focus.
2. Hubungkan Save draft, Confirm with fallback, Dismiss, Reopen, confirmed Save changes, and Delete.
3. Tampilkan source changed berdasarkan revision tanpa overwrite.
4. Implement local-input-preserving conflict dan unavailable/deleted state.
5. Tambahkan unit/component and E2E flow tanpa AI/evidence.

Acceptance: qualitative Achievement dapat confirmed tanpa metric/evidence; dismissed tidak bisa
langsung Confirm; confirmed valid edit tetap confirmed; reopened record tidak eligible.

### T09.6 Activity dan Project integration

1. Tambahkan Create/Open Achievement serta Activity delete preview/retention pada S06.
2. Tambahkan Project Achievement section, create linked, attach/move/detach, and real dependency count
   pada S10.
3. Extend Project context edit/delete dan Activity relink/update agar derived Achievement atomik.
4. Uji safe nested return, revision conflicts, and source/context preservation.
5. Jalankan regression Activity/Project E2E dan integration.

Acceptance: Activity/derived Achievement tidak pernah context mismatch; delete Project/Activity
mempertahankan karya sesuai source; T06-T08 behavior tidak regresi.

### T09.7 Race, accessibility, dan responsive acceptance

Orkestrasi dengan PostgreSQL/session nyata dan timeout terbatas:

- dua different-key create derived pada Activity yang sama;
- identical-key replay versus changed payload;
- confirm versus dismiss pada revision yang sama;
- Activity relink versus Project Experience update;
- Activity delete versus Achievement confirm/edit;
- concurrent case-variant skill creation/link;
- Skill delete versus Achievement skill replacement;
- Project delete versus Achievement attach.

Hasil boleh salah satu transaksi menang dan yang lain mendapat conflict/unavailable yang aman, tetapi
tidak boleh duplicate, deadlock, timeout tak terbatas, lost update, partial context, atau data lintas
akun.

Jalankan Axe pada S07 list/empty/error dan S08 draft/validation/confirmed/dismissed/conflict/delete,
serta Project/Activity dialog yang berubah. Verifikasi keyboard, focus return, first invalid focus,
360/1440, light/dark, reduced motion, long Unicode content, dan tanpa horizontal overflow.

### T09.8 Clean rebuild dan penutupan

1. Jalankan seluruh final commands dan record output aktual.
2. Buat clean Supabase disposable dengan project ID/workdir/port unik dan absolute target yang sudah
   diverifikasi; jangan menyentuh stack aktif.
3. Apply seluruh migration dari nol, seed, lalu jalankan pgTAP, DB lint, Achievement/Project/Activity/
   Storage integration.
4. Stop/hapus hanya resource disposable setelah bukti dicatat.
5. Buat `docs/verification/T09-manual-achievements-skills.md`, update README/status/plan ini, dan
   catat file, migration, decision, checks, limitations, serta next T10.
6. Mark T09 DONE hanya bila seluruh Definition of Done memiliki bukti. Selain itu gunakan PARTIAL atau
   BLOCKED dengan blocker dan next command konkret.

## File yang diperkirakan

Nama akhir mengikuti pola repository aktual setelah remediasi T08.

### File baru yang mungkin diperlukan

- `supabase/migrations/<timestamp>_t09_achievements_skills.sql`
- migration T09 kedua hanya bila extension RPC T08 perlu dipisahkan untuk review/compatibility
- `src/domain/achievement/contracts.ts`
- `src/domain/achievement/achievement-cursor.ts`
- `src/domain/achievement/cv-bullet.ts`
- `src/domain/achievement/metrics.ts`
- `src/features/achievement/schemas.ts`
- `src/features/achievement/achievement-service.ts`
- `src/features/achievement/achievement-action-contract.ts`
- `src/features/achievement/actions.ts`
- `src/features/achievement/achievement-list.tsx`
- `src/features/achievement/achievement-form.tsx`
- `src/features/achievement/achievement-detail.tsx`
- `src/features/achievement/skill-tags.tsx`
- `src/features/achievement/metrics-editor.tsx`
- `src/app/(workspace)/achievements/loading.tsx`
- `src/app/(workspace)/achievements/new/page.tsx`
- `src/app/(workspace)/achievements/[id]/page.tsx`
- `tests/unit/achievement-*.test.ts`
- `tests/integration/achievement-lifecycle.test.ts`
- `tests/e2e/achievements-ui.spec.ts`
- `playwright.achievements.config.ts`
- `supabase/tests/database/achievement.test.sql`
- `docs/decisions/<next>-t09-achievement-lifecycle.md`
- `docs/verification/T09-manual-achievements-skills.md`

### File yang diperkirakan berubah

- `src/app/(workspace)/achievements/page.tsx`
- `src/app/(workspace)/activity/[id]/page.tsx`
- `src/app/(workspace)/projects/[id]/page.tsx`
- `src/features/activity/activity-service.ts`, detail/action contract, dan UI delete seam
- `src/features/project/project-service.ts`, actions/contracts, detail, and dependency receipt
- `src/features/profile/foundation-actions.ts` dan editor Skill untuk dependency preview/count
- `src/domain/database-types.ts`
- `src/server/supabase/database.types.ts` hasil generator
- `src/domain/routes/safe-return.ts` dan URL filter utility bila benar-benar diperlukan
- `src/i18n/messages.ts`
- `src/app/globals.css`
- `supabase/tests/database/activity.test.sql`, `project.test.sql`, dan `foundation.test.sql`
- `tests/integration/activity-persistence.test.ts` dan `project-context.test.ts`
- `tests/e2e/activity-ui.spec.ts`, `projects-ui.spec.ts`, dan Auth/UI regression bila shared profile
  Skill behavior berubah
- `package.json` untuk script integration/E2E Achievement; lockfile tidak berubah
- `README.md`
- `docs/IMPLEMENTATION_STATUS.md`
- plan ini setelah hasil aktual tersedia

### File yang tidak seharusnya berubah

- Migration T01-T08 yang sudah applied; semua perubahan SQL lewat migration baru.
- `pnpm-lock.yaml` karena T09 tidak memerlukan dependency baru.
- `workers/*`, storage adapter/scanner, bucket, Evidence jobs/UI, AI provider/jobs, import, CV, PDF,
  Dashboard, Timeline, account deletion, dan mockup sumber.
- PRD, Flow, Wireframe, Database Schema DOCX, `docs/Design.md`, dan design mockups.
- Activity raw text/Chat semantics di luar delete-retention dan derived lookup.

## Matriks acceptance dan bukti

| Acceptance T09 | Bukti otomatis wajib | Pemeriksaan tambahan |
| --- | --- | --- |
| Standalone draft tanpa Activity/Employment | pgTAP + integration create idempotent + S08 E2E | Empty context tidak membuat placeholder Experience |
| Derived draft menyalin source/context | pgTAP exact raw text/revision/context + integration | Browser tidak mengirim source authoritative |
| Satu derived per Activity | Partial unique + two-session different-key race | S06 hanya Create atau Open, tidak keduanya |
| Confirm guards | Zod + SQL checks + E2E invalid focus | title/contribution/outcome/date/bullet wajib; metric/evidence tidak wajib |
| Factual fallback | Unit Unicode/punctuation/duplicate/limit + E2E blank bullet confirm | Tidak ada angka/fakta/parafrasa baru |
| Lifecycle valid | pgTAP transition matrix + service/E2E | dismissed harus reopen; confirmed edit valid tetap confirmed |
| Optimistic conflict | Two-client integration + two-tab E2E | Input lokal dan skill/metric rows tetap ada |
| Metrics strict | Unit + SQL invalid JSON matrix | Qualitative outcome tanpa metric tetap sah |
| Skill normalization | pgTAP/integration concurrent casefold + UI duplicate | Existing casing dipertahankan; max 20 tags |
| Demonstrated count | Query fixtures across confirmed/draft/dismissed and transitions | COUNT DISTINCT, tanpa proficiency/readiness |
| S07 filter/pagination | Unit cursor + integration 31 same-date/null-date + E2E | URL/return stabil; no fake Evidence filter/count |
| Source changed | Activity edit integration + S08 E2E | Achievement tidak dioverwrite/demote otomatis |
| Activity delete retention | pgTAP/integration delete + S06 E2E | source excerpt/revision dan Achievement fields tetap |
| Project/Experience propagation | pgTAP + Project/Activity/Achievement integration | revisions naik tepat sekali, detach preserve Experience |
| Attach/move/detach Achievement | Integration owned/foreign/derived + Project E2E | Derived action menjelaskan Activity ikut berpindah |
| Delete Achievement/Skill | pgTAP dependency receipt + S08/S12 E2E | Activity/Achievement retained sesuai target; no T11/T20 claim |
| Race matrix | Dua koneksi PostgreSQL dengan timeout dan final-state assertions | Tidak ada deadlock, duplicate, orphan, lost update |
| Privacy/error | Dua akun + missing/foreign E2E/service errors | Tidak ada content/secret pada logs/output |
| Mobile/theme/a11y | Playwright 360/1440 light/dark, Axe, keyboard, reduced motion | Manual focus/dialog/long-content review |
| Regression T01-T08 | Full unit, foundation/activity/project/storage integration, Auth/UI/Activity/Project E2E, build, worker, pgTAP, lint | Manual workflow tetap tanpa AI |

## Perintah verifikasi saat eksekusi

Gunakan script dari `package.json` aktual. Command baru boleh diberi nama berbeda, tetapi verification
harus mencatat command yang benar-benar dijalankan, exit code, jumlah tests/assertions, environment,
dan alasan check yang tidak dijalankan.

### Baseline minimum sebelum edit

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
pnpm test:integration:projects
pnpm test:integration:activity
pnpm test:integration:storage
pnpm build
pnpm worker:check
pnpm db:test
pnpm db:lint
pnpm exec supabase migration list --local
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:projects
git diff --check
```

### Final minimum setelah implementasi

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:activity
pnpm test:integration:storage
pnpm build
pnpm worker:check
pnpm db:types
pnpm db:test
pnpm db:lint
pnpm db:status
pnpm exec supabase migration list --local
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:projects
pnpm test:e2e:achievements
git diff --check
```

Jangan mencetak local secret/key. Integration fixture server-only boleh menerima credential lokal
sebagai process environment dan wajib cleanup dalam `finally`. Database aktif hanya menerima
forward migration; clean reset hanya pada disposable project yang path/project ID/port-nya telah
diverifikasi bukan WorkPulse aktif. Hosted/staging/production dan T24 performance tetap out of scope.

## Risiko dan mitigasi

| Risiko | Mitigasi |
| --- | --- |
| T09 dibangun di atas RPC T08 yang masih berubah | Hard gate T08 DONE; baca migration/decision final sebelum menulis SQL. |
| Dua request membuat dua derived Achievement | Partial unique DB + operation ledger + two-session race. |
| Confirm dapat dilewati lewat direct update | Revoke DML; transition RPC dan confirmed SQL check. |
| Project/Activity/Achievement context mismatch | Composite FK, derived context server-side, one transaction, lock hierarchy, final-state assertions. |
| Propagation menaikkan revision dua kali | Satu authoritative RPC path dan exact delta tests untuk setiap context operation. |
| Delete Activity kehilangan source | Source excerpt/revision disalin saat derived create dan diverifikasi sebelum detach/delete. |
| Fallback mengarang atau memotong fakta | Pure deterministic concat, no translation/paraphrase/truncation, unit snapshots. |
| Metric string/shape berbahaya lolos | Strict Zod + SQL JSON validator + payload/item caps. |
| Skill case race membuat duplicate | Unique normalized name + transaction retry/select + concurrent integration. |
| Delete Skill deadlock dengan save Achievement | Lock Achievement lalu Skill/join dalam consistent order; concurrency test. |
| Cursor gagal pada tanggal NULL | Explicit date/null bucket cursor dan 31-row integration fixtures. |
| Mockup mendorong Evidence/AI/CV prematur | Scope assertions dan UI/E2E memastikan control/count palsu tidak muncul. |
| Conflict membuang metrics/skills lokal | Session draft menyimpan nested fields dan base revision; two-tab E2E. |
| Narrative/source bocor ke logs | Safe generic errors, correlation ID, log review, test output tanpa private content. |
| Dirty work T07-T08 tertimpa | Inspect diff awal; additive/scoped edits; no checkout/reset. |

## Definition of Done

T09 boleh ditandai DONE hanya jika:

1. T08 remediation sudah DONE dan T09 memakai signature serta lock hierarchy final tanpa mengedit
   migration historis.
2. Achievement/achievement_skills mempunyai RLS, composite ownership, restrictive grants, indexes,
   checks, revision, dan server/database validation yang lulus dari clean migration.
3. Create standalone dan derived idempotent; derived source/context diambil server-side; race dua key
   tetap menghasilkan maksimal satu Achievement per Activity.
4. Draft/confirmed/dismissed lifecycle mengikuti transition matrix. Confirm membutuhkan title,
   contribution, outcome, achieved_on, dan cv_bullet; qualitative achievement tanpa metric/evidence
   dapat confirmed.
5. Factual CV bullet fallback hanya menggabungkan contribution/outcome yang ada, tidak mengarang,
   menerjemahkan, atau truncate.
6. Metrics strict dan opsional; skill tags normalized/owner-scoped/atomic; demonstrated count hanya
   distinct confirmed Achievement tanpa proficiency/readiness.
7. S07 menyediakan filter status/Project, nullable-date cursor 30, compact rows, stable safe return,
   dan loading/empty/no-match/error states tanpa Evidence/AI/CV behavior palsu.
8. S08 menyediakan standalone/derived editor, source panel, session draft, validation, explicit
   actions, source-changed state, conflict recovery, delete preview, responsive, dan accessibility.
9. Edit confirmed yang masih valid tetap confirmed; reopen menghilangkan eligibility; dismissed tidak
   dapat langsung Confirm.
10. Activity create/open/delete integration mempertahankan raw source dan derived Achievement
    provenance. Delete Activity tidak menghapus Achievement.
11. Project/Experience edits, Activity relink/update, Achievement attach/move/detach, dan Project
    delete menjaga context atomik serta revision tepat sekali; delete Project mempertahankan karya dan
    Experience.
12. Delete Achievement mempertahankan Activity; delete Skill hanya melepas joins. Dependency preview
    dan receipts memakai count aktual serta tidak mengklaim Evidence/CV behavior sebelum waktunya.
13. Race create/transition/context/delete/skill selesai deterministic tanpa deadlock, duplicate,
    orphan, lost update, leak, atau partial commit.
14. Missing/foreign/deleted records aman, localized, mempunyai correlation ID, dan tidak membocorkan
    private content atau secret.
15. Lint, nonincremental typecheck, unit, Achievement/Project/Activity/Storage integration, build,
    worker check, type generation, pgTAP, DB lint/status/ledger, Auth/UI/Activity/Project/Achievement
    E2E, Axe, 360/1440 light/dark, keyboard, reduced motion, forward migration, clean disposable
    rebuild, dan diff check mempunyai hasil aktual yang tercatat.
16. Decision, `docs/verification/T09-manual-achievements-skills.md`, README, plan ini, dan
    `docs/IMPLEMENTATION_STATUS.md` diperbarui. Next task T10 dan Gate M2 tetap terbuka.

## Prompt eksekusi siap salin untuk Luna

```text
Implementasikan T09 Manual Achievements dan Skills berdasarkan
docs/verification/T09-implementation-plan.md menggunakan GPT-5.6 Luna dengan
reasoning MAX.

Sebelum mengedit, baca seluruh AGENTS.md yang berlaku,
docs/IMPLEMENTATION_STATUS.md, docs/IMPLEMENTATION_PLAN.md bagian 1/3/4,
acceptance T08-T12, matriks R05/R06, dan Gate M2. Ekstrak PRD R05-R06,
Flow F02-F04/shared recovery, Wireframe S06-S10, Database Schema bagian 1-3/6,
Design.md Achievement/forms/accessibility, mockup S07-S08, seluruh verification
T06-T08, serta decisions foundation/activity/project yang relevan.

Hard gate: pastikan remediasi review T08 sudah DONE dan baca migration/RPC/lock
hierarchy final. Jika T08 masih PARTIAL/BLOCKED, jangan buat scaffold atau migration
T09; catat blocker dan berhenti. Pertahankan semua dirty changes dan jangan reset,
checkout, atau mengubah migration T01-T08 yang sudah diterapkan.

Kerjakan T09.0-T09.8 berurutan dan test-first. Tambahkan migration forward-only
untuk achievements/achievement_skills, RLS/composite ownership, strict metrics,
confirmed guards, idempotent create, optimistic revision, lifecycle transition,
skill replacement, context propagation, dependency preview, dan retention source.
Session/auth.uid adalah owner. Revoke direct DML; browser tidak menentukan user,
source excerpt/revision, derived context, atau confirmed status secara bebas.

Implementasikan /achievements, /achievements/new, dan /achievements/:id dengan
status/project URL filters, nullable-date cursor 30, standalone/derived manual
create, source panel, metrics, skill tags, deterministic factual CV bullet fallback,
Save draft, Confirm, Dismiss, Reopen, confirmed Save changes, Delete, unsaved guard,
dan conflict recovery. Qualitative outcome valid tanpa angka/evidence. Dismissed
harus reopen sebelum Confirm; edit confirmed yang tetap valid tidak butuh confirm
kedua. Draft/dismissed tidak masuk demonstrated skill count.

Extend Activity dan Project seams: satu derived Achievement per Activity melalui
database race guard; Activity edit hanya menandai source changed; Activity delete
mempertahankan Achievement/source excerpt/revision; Project/Experience context,
Activity relink, and Project delete memperbarui Activity/Achievement atomik dengan
lock order final T08 yang diperluas sampai Achievement. Project detail mendukung
create/attach/move/detach Achievement dengan owner/revision checks.

Jangan membuat AI, follow-up, Evidence upload/count/filter, import, Dashboard,
Timeline, Add to CV aktif, CV invalidation, export, PDF, worker job, proficiency,
readiness, target job, search, atau fake control/count. Catat seam T11 untuk Evidence,
T12 untuk dashboard/timeline, T13-T14 untuk AI, T16 untuk import, dan T18-T20 untuk CV.

Jalankan baseline dan seluruh final checks pada plan, termasuk PostgreSQL dua akun,
race dua session, forward migration tanpa reset database aktif, generated types,
clean disposable rebuild, Auth/UI/Activity/Project/Achievement E2E, Axe, keyboard,
360/1440 light/dark, reduced motion, dan diff check. Jangan cetak credential atau
private content. Catat hasil aktual pada decision T09,
docs/verification/T09-manual-achievements-skills.md, README, plan, dan status.
Tandai DONE hanya bila seluruh Definition of Done terbukti; selain itu gunakan
PARTIAL/BLOCKED dengan blocker serta next command konkret. Setelah DONE, T10 menjadi
next task dan Gate M2 tetap terbuka.
```

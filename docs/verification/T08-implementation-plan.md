# Rencana Implementasi T08 Project dan Context Propagation

Tanggal perencanaan: 20 September 2026

Status: **IMPLEMENTED; verification DONE**. Dokumen ini adalah rencana eksekusi historis; hasil
aktual dan evidence T08 ada di [T08 projects/context verification](T08-projects-context.md) serta
`docs/IMPLEMENTATION_STATUS.md`.

Model eksekusi yang dituju: GPT-5.6 Luna dengan reasoning `MAX`.

Dependensi wajib menurut rencana: T04 dan T06 `DONE`. Baseline aktual lebih maju: T01-T07 dan
remediasi review T07 sudah `DONE`. Gate M2 masih terbuka sampai T08-T12 selesai. Worktree saat
perencanaan belum bersih karena hasil remediasi T07 belum di-commit; seluruh perubahan pengguna dan
hasil T05-T07 harus dipertahankan. Jangan mereset, checkout, atau menimpa file yang sudah berubah.

## Hasil yang dituju

T08 mengganti shell `/projects` dengan workflow manual S09-S10 yang lengkap. Pengguna dapat membuat
Project standalone atau menghubungkannya ke Experience, melihat list berfilter dan detail, mengedit
field canonical dengan revision guard, membuat Activity baru dalam context Project, menautkan atau
memindahkan Activity miliknya yang sudah ada, serta menghapus Project setelah melihat dependency
preview. Semua perubahan context bersifat owner-scoped dan transaksional.

Project mempunyai status tepat `planned`, `active`, atau `completed`; tidak ada progress percentage,
paused, atau archived. `completed` boleh disimpan tanpa outcome, tetapi UI harus memberi label
faktual `Needs outcome` dan penjelasan bahwa Dashboard akan menindaklanjutinya saat T12 tersedia.
Project akademik, volunteering, dan personal valid tanpa Experience.

Pada T08, hanya Activity yang sudah memiliki persistence. Achievement baru dibuat pada T09,
Evidence pada T10-T11, dan CV source pada T18-T20. Karena itu T08 harus membangun boundary relink dan
delete yang dapat diperluas secara transaksional oleh task pemiliknya, tetapi tidak membuat tabel,
counter, kartu kosong, atau klaim sukses palsu untuk domain yang belum ada.

## Acuan dan acceptance sumber

- `docs/IMPLEMENTATION_PLAN.md` §1; §3 Ownership/concurrency dan Data karier; §4; acceptance T08;
  matriks R06; Gate M2; serta cara kerja Luna pada §7.
- PRD R06: Project menyimpan title, context, dates, status, role, outcome; Activity dan Achievement
  masing-masing mempunyai maksimal satu Project opsional; standalone record valid.
- PRD shared validation: title wajib, partial/unknown dates valid, definite end-before-start ditolak,
  dan concurrent edit menghasilkan conflict, bukan silent overwrite.
- PRD dashboard/deletion: completed Project tanpa outcome menjadi actionable check; delete record
  mem-preview link yang terpengaruh.
- Release scenario graduate: user tanpa employment dapat membuat academic Project, mencatat hasil,
  dan pada task berikutnya menggunakannya untuk Achievement/CV.
- User Flow F04: create/edit Project; status `planned`/`active`/`completed`; buat linked work atau
  attach existing owned record; Project menentukan experience context; relink harus atomik.
- User Flow F04 delete: tampilkan dependency count, pertahankan Activity/Achievement, bersihkan link
  Project, pertahankan experience, dan kembali ke S09. Direct Project evidence baru ditangani T11.
- Shared navigation recovery: filter list bertahan, unsaved edit meminta konfirmasi, dan
  missing/foreign/deleted deep link memakai satu state `Record unavailable`.
- Wireframe S09: route `/projects`, row compact berisi title, role, optional Experience, partial date,
  status, dan linked count; filter bertahan; unknown date tampil `Date not set`; completed tanpa
  outcome memakai label teks `Needs outcome`.
- Wireframe S10: route `/projects/:id`, editable overview, create linked Activity, attach existing
  owned records, context-change confirmation, dan dependency-aware delete.
- Database Schema §§1-3/6: composite ownership FK, Project fields/checks/index, partial dates,
  context invariant, revision, relink/context-edit transaction, delete retention, dan lock behavior.
- `docs/Design.md` §2 dan §8 serta §§16-38: list/database hybrid, compact rows, progressive
  disclosure, stacked mobile layout, status text label, token/theme/focus/reduced-motion. Konflik
  status/progress diselesaikan oleh `IMPLEMENTATION_PLAN.md` §1: hanya tiga status, tanpa progress.
- `design-mockups/S09.html` dan `S10.html` memberi arah hierarchy dan density. Sample Achievement,
  Evidence, metrics, dan data contoh bukan capability T08.
- Decision 0004, 0009, 0010, dan 0011 serta verification T06-T07 adalah kontrak authoritative untuk
  operation key, owner/session errors, Activity revision, context validation, draft recovery, dan UI
  feedback yang harus tetap lulus.

## Kondisi workspace sebelum eksekusi

- Stack terpin: Next.js 16.3.5, React 19.3.0, TypeScript 6.0.3, Supabase JS 2.116.0, Zod 4.6.5,
  Lucide React 1.46.0, Vitest 5.0.0, Playwright 1.63.0, Node 24, dan pnpm 11.19.0. Dependency baru
  tidak diperkirakan diperlukan.
- `projects` sudah ada sejak T02 dengan owner composite key, optional `experience_id`, canonical
  fields/status/partial date, revision/timestamps, RLS, dan index `(user_id, status, updated_at, id)`.
- Authenticated client masih memiliki direct INSERT ke `projects`; create idempotent khusus Project
  belum ada. T08 harus menutup direct mutation tersebut dan memakai operation ledger T03.
- `public.update_project` dan `public.delete_project` sudah ada sebagai foundation RPC generic.
  Update Project experience memicu sinkronisasi Activity dari T06. Delete lama hanya mengembalikan
  UUID dan tidak memberi dependency receipt; belum cukup untuk S10.
- `activities` mempunyai owner composite FK ke Project/Experience. Trigger database memaksa
  `activity.experience_id` sama dengan `project.experience_id`, termasuk NULL. Project experience
  update saat ini memperbarui linked Activities dan menaikkan revision Activity.
- `createActivityService()` sudah menyediakan create/update/list/detail dan T07 memakai Project
  option read-only. T08 tidak boleh merusak raw text, Chat history, create receipt, cursor, atau
  conflict contract tersebut.
- Integration T06 saat ini membuat fixture Project melalui authenticated direct INSERT. Setelah
  T08 mencabut grant itu, fixture/regression tersebut harus memakai create RPC T08 atau server-only
  admin setup yang dinyatakan jelas; jangan mengembalikan grant hanya agar test lama tetap hijau.
- `/projects` masih `WorkspaceUnavailable`; `/projects/new` dan `/projects/[id]` belum ada.
- `/activity/new` belum menerima preselected Project dari URL. T08 perlu integrasi sempit agar
  `Log related work` membuka capture dengan owned Project terpilih tanpa mengubah draft yang sudah
  dipulihkan dari session.
- `ProjectRow`, `ProjectStatus`, partial-date parser, shared feedback, operation-key hook, session
  draft, unsaved guard, conflict controls, named delete dialog, Record unavailable, tokens, dan i18n
  sudah tersedia dan harus direuse.
- Safe-return mengenali path Project, tetapi contract query masih placeholder `status`/`q`, belum
  mempunyai cursor atau nested return flow Project detail → Activity → Project detail.
- Belum ada tabel Achievement, Evidence, atau CV. Jangan menulis SQL yang mereferensikan tabel yang
  belum ada dan jangan menampilkan count `0` seolah domain tersebut sudah diimplementasikan.

## Batas scope

### Termasuk dalam T08

- Migration forward-only untuk create Project idempotent, revocation direct Project INSERT,
  transactional Activity relink, serta dependency-aware Project delete receipt.
- Server validation dan database checks yang konsisten untuk Project title/text/status/partial date.
- Project service owner-scoped dengan create/update/list/detail, linked Activity summary, relink,
  dependency preview, delete, safe localized errors, revision conflict, dan cursor stabil.
- Route `/projects`, `/projects/new`, dan `/projects/:id` untuk S09-S10.
- Status filter URL (`planned`, `active`, `completed`), pagination 30, compact rows, partial-date
  formatting, linked Activity count, dan `Needs outcome`.
- Form create/edit untuk title, description, role, optional Experience, start/end partial date,
  current flag, status, dan outcome.
- Stable operation key pada create; `expected_revision` dan restored-draft base revision pada edit;
  feedback hanya setelah commit.
- Context-change confirmation bila Project experience edit akan memengaruhi linked Activities.
- `Log related work` ke Activity capture dengan Project preselected setelah ownership validation.
- Attach/move existing owned Activity ke Project dan detach dari Project. Project menentukan
  effective Experience; browser tidak mengirim authoritative Experience untuk relink.
- Delete preview dengan actual Activity count; delete mempertahankan Activity, raw text, Chat,
  structured fields, dan Experience sambil membersihkan hanya `project_id`.
- Unit, PostgreSQL integration/pgTAP, browser E2E, accessibility, responsive/theme, clean migration
  rebuild, verification record, decision record bila diperlukan, README/status updates.

### Tidak termasuk

- Achievement table/UI/count/attach/relink. T09 memperluas boundary relink/delete agar derived
  Achievement mengikuti Activity dalam transaksi yang sama.
- Evidence UI, quota, file count, upload, screening, cleanup, atau direct Project attachment. T10-T11
  memperluas delete receipt dan lifecycle file.
- Dashboard actionable query dan Timeline Project event. Label `Needs outcome` ada di S09/S10;
  Dashboard/Timeline baru dihubungkan T12.
- AI consent/jobs/provider, suggested achievement, follow-up question, atau analysis state.
- CV selection, freshness invalidation, source snapshot, atau export. T18-T20 memperluas mutation
  protocol ketika tabel CV sudah tersedia.
- Project progress percentage, paused/archived, milestone, Kanban, global search, `q` filter,
  realtime, bulk relink, optimistic fake row, sample data production, analytics, atau deployment.
- Activity delete atau perubahan capture mode. Activity source dan first Chat message tidak berubah
  ketika context Project dipindahkan.
- Dependency atau package baru kecuali blocker nyata dibuktikan dan dicatat lebih dahulu.

## Keputusan implementasi T08

### 1. Route, query, dan return contract

Gunakan route canonical:

| Route | Tanggung jawab T08 |
| --- | --- |
| `/projects` | S09 list, status filter, empty/no-match/error state, dan cursor pagination. |
| `/projects/new` | S10 create mode dengan optional safe `returnTo`. |
| `/projects/:id` | S10 detail/edit, linked Activity, attach/detach, delete, dan safe `returnTo`. |

Query list yang didukung:

- `status=planned|active|completed`; tidak ada nilai berarti semua status.
- `cursor=<opaque-project-cursor>` untuk page berikutnya.

Hapus placeholder `q` dari contract Project karena search bukan MVP. Filter baru menghapus cursor.
Order canonical: `updated_at DESC, id DESC`, page size 30. Cursor versioned memuat hanya timestamp
dan UUID terakhir; malformed, duplicate, atau tampered cursor ditolak sebelum query.

Tambahkan `sanitizeProjectReturnTo()` yang hanya menerima `/projects` dengan status/cursor valid.
Project detail/new memakai sanitizer itu untuk Back/Cancel. Cross-feature navigation perlu bounded
safe return: Activity yang dibuka/dibuat dari Project boleh kembali ke owned-shaped route
`/projects/:id`, dan Project detail tetap membawa return list yang sudah disanitasi. Implementasi
tidak boleh menerima external URL, protocol-relative path, backslash, dot segment, duplicate key,
unknown key, recursive return chain tanpa batas, atau Project UUID malformed. Batasi maksimal satu
nested Project-list return hop dan pertahankan regression safe-return T03-T07.

Missing, foreign, deleted, dan random Project UUID harus menampilkan copy/state identik. Jangan
membedakan ownership dari nonexistence. Link list menuju detail membawa current Project list URL;
Back, successful delete, dan Cancel kembali ke list/filter/page yang aman.

### 2. Field dan validation contract

Gunakan canonical schema yang sudah ada. Tambahkan application/domain contract Project terpisah,
misalnya `src/domain/project/contracts.ts` dan `src/features/project/schemas.ts`:

- `title`: trim, nonblank, maksimum 200 Unicode code point.
- `description`: optional, trim, blank → NULL, maksimum 5.000.
- `user_role`: optional, trim, blank → NULL, maksimum 200.
- `outcome`: optional, trim, blank → NULL, maksimum 5.000.
- `status`: hanya `planned`, `active`, `completed`.
- `experience_id`: owned UUID atau NULL.
- start/end memakai date + precision `year|month|day`; unknown menyimpan keduanya NULL.
- `is_current=true` memaksa end date/precision NULL.
- `status=completed` memaksa `is_current=false`, tetapi tidak mewajibkan end date atau outcome.
- tolak hanya interval tanggal yang pasti bertentangan; overlap dengan Experience atau Project lain
  tetap valid.

Selaraskan Zod dan SQL `char_length` checks. Browser `maxLength` dan controls partial date hanya
ergonomi; server dan database tetap authoritative. Tambahkan `PROJECT_FIELD_LIMITS` daripada
menyebarkan literal. Jika limit ini menjadi keputusan teknis baru, catat rationale pada decision T08.

Project standalone dengan Experience NULL harus melewati create/update/relink. Label context memakai
`Independent`/padanan lokal hanya sebagai presentation; jangan menyimpan placeholder itu ke database.

### 3. Migration dan public mutation boundary

Buat satu migration timestamp berikutnya, misalnya `*_t08_projects_context.sql`. Migration harus
forward-only, idempotent terhadap urutan ledger migration, schema-qualified, fixed `search_path`, dan
grant sempit. Jangan mengubah migration lama.

#### Create Project

Tambahkan `public.create_project_idempotent(...)` yang:

1. memperoleh owner hanya dari `auth.uid()` dan menolak profile `deleting_at`;
2. menerima client UUID `operation_key`, tetapi tidak menerima `user_id`;
3. memvalidasi target Experience dengan composite ownership;
4. menormalisasi optional text dan partial-date/status rules;
5. memakai `internal.operation_requests` dengan operation kind Project yang berbeda;
6. menyimpan Project dan receipt dalam transaksi yang sama;
7. replay payload identik mengembalikan receipt awal; key sama + payload berbeda menghasilkan
   `IDEMPOTENCY_KEY_REUSED` tanpa row kedua;
8. mengembalikan receipt minimal immutable (`project_id`, `user_id`, `revision=1`), bukan row live.

Setelah RPC tersedia, revoke direct INSERT `projects` dari authenticated. Pertahankan SELECT untuk
owner; direct UPDATE/DELETE sudah harus tetap tidak tersedia. RPC/internal helper tidak diberikan ke
anon atau service role hanya karena memakai elevated credential.

Perbarui fixture T06/T07 yang masih mengandalkan authenticated direct Project INSERT. Product-path
tests harus memakai RPC public baru; fixture setup yang sengaja memakai admin client harus tetap
server-only dan tidak dianggap bukti bahwa browser dapat melakukan mutation langsung.

#### Update Project dan propagation

`public.update_project` tetap revision-checked. Service mengirim allowlist canonical lengkap; jangan
mengizinkan ownership/id/timestamp/revision dari patch. Update `experience_id` harus mengunci Project
dan context dengan urutan konsisten lalu memperbarui semua linked Activities dalam transaksi yang
sama. Setiap Activity yang benar-benar berubah context naik revision tepat satu; Activity yang sudah
memiliki Experience sama tidak mendapat revision palsu.

Trigger compatibility T06 boleh dipertahankan bila tests membuktikan lock/receipt benar. Jika perlu
diganti, lakukan di migration T08 tanpa mengubah public Activity update semantics. Dua hasil yang sah
dalam race attach vs Project context edit: attach ter-serialize lalu menerima context final, atau
request stale/conflict yang actionable. Context mismatch tidak boleh pernah commit.

#### Relink Activity

Tambahkan RPC khusus, misalnya
`public.relink_activity_project(p_activity_id, p_expected_revision, p_project_id)`:

- owner berasal dari session; Project dan Activity harus milik owner yang sama;
- target Project dikunci sebelum Activity sesuai lock protocol Project mutation;
- bila target Project non-NULL, RPC menurunkan `experience_id` dari Project secara authoritative,
  termasuk NULL; browser tidak mengirim Experience;
- bila target NULL, RPC membersihkan hanya `project_id` dan mempertahankan current Experience;
- raw text, date, mode, role/scope/outcome, Chat, dan analysis state tidak berubah;
- revision Activity naik tepat satu jika context berubah; same-target replay dengan stale revision
  menjadi conflict, bukan silent success yang menyembunyikan race;
- missing/foreign Activity/Project memakai safe unavailable result tanpa existence leak;
- T09 memperluas transaksi yang sama untuk derived Achievement. Jangan membuat Achievement hook yang
  mereferensikan tabel belum ada.

#### Delete Project

Ganti public delete Project lama dengan dependency-aware RPC baru. Karena PostgreSQL tidak dapat
mengubah return type hanya dengan `CREATE OR REPLACE`, migration harus drop/recreate signature secara
eksplisit setelah memastikan tidak ada caller runtime lama. Receipt minimum:

- `deleted_project_id`;
- `released_activity_count` aktual.

Dalam satu transaksi: verifikasi owner/deleting state, lock Project dan expected revision, lock linked
Activities dalam urutan ID, hitung actual dependents, set `project_id=NULL` sambil mempertahankan
masing-masing `experience_id`, lalu delete Project. FK tetap defense terakhir. Activity revision naik
tepat satu karena context berubah; Chat dan Activity row tetap ada.

Preview UI membaca count owner-scoped dari detail. Count preview boleh berubah sebelum confirm;
receipt delete menampilkan jumlah aktual. RPC harus aman terhadap concurrent attach: attach commit
lebih dahulu lalu ikut dilepas/dihitung, atau menunggu delete lalu gagal unavailable—tidak boleh ada
orphan/mismatch/foreign row.

T09 memperluas delete untuk Achievement; T11 untuk direct Project evidence; T20 untuk CV invalidation.
Catat seam ini pada decision/verification agar task berikutnya tidak menganggap lifecycle sudah final.

### 4. Project service dan error contract

Buat `createProjectService(client)` sebagai boundary domain, bukan query tersebar di Server Components.
Minimal method:

- `createProject(input)` → frozen create receipt;
- `updateProject(input)` → current owned Project;
- `listProjects(filters)` → 30 Project summaries + linked Activity count + next cursor;
- `getProject(id)` → Project, Experience label minimal, linked Activities, dependency count;
- `listRelinkCandidates(projectId, cursor/filter bila perlu)` → owned Activity minimal yang dapat
  dipilih tanpa mengambil Chat/raw source penuh yang tidak perlu;
- `relinkActivity(input)` → current Activity context receipt/row;
- `deleteProject(input)` → dependency receipt.

Semua public input divalidasi Zod. Setiap method memanggil `auth.getUser()` dan menggunakan actor ID
valid untuk owner predicate; tidak menerima `user_id`. RLS/composite FK tetap wajib walaupun query
memiliki explicit owner predicate.

Gunakan `ProjectServiceError` dengan safe code, localized `MessageKey`, UUID correlation ID, optional
typed field errors, dan latest owned Project hanya untuk conflict. Mapping minimal:

- validation/constraint → `VALIDATION`;
- missing session/401/403/known auth code → `UNAUTHENTICATED`;
- missing/foreign Project atau Activity → `NOT_FOUND` dengan copy generik;
- stale Project/Activity/context race → `CONFLICT`;
- reused create key → `IDEMPOTENCY_KEY_REUSED` lalu action copy operation-key conflict;
- provider/transport/unknown result → `UNAVAILABLE`.

Jangan memakai substring raw provider kecuali exact stable SQL code/message yang didefinisikan oleh
migration. Jangan log title, description, role, outcome, Activity source, FormData, token, atau raw DB
error. List summary mengambil kolom minimum; jangan mengambil `raw_text` hanya untuk menampilkan count.

`activity-context-service.ts` boleh tetap menjadi read adapter T07. Project mutation harus
`revalidatePath` untuk `/projects`, detail terkait, `/activity`, dan Activity detail yang berubah agar
context option/label tidak stale. Hindari membuat dua aturan context yang berbeda antara services.

### 5. Server Actions, idempotency, dan save lifecycle

Server Actions Project harus tipis:

1. baca named fields dari `FormData` tanpa owner;
2. parse partial dates dengan helper canonical yang sudah ada;
3. panggil service dengan cookie-bound Supabase client;
4. map service error ke `ActionState` tanpa mengganti correlation ID;
5. revalidate hanya setelah commit;
6. return success receipt/row setelah commit, bukan redirect sebelum state diterima.

Create memakai `useCreateOperationKey(ownerId, "project-create", state)`. Key bertahan pada validation,
auth, network, atau ambiguous failure dan berputar hanya setelah success. Tombol disabled sampai key
siap dan selama pending. Success membersihkan draft/dirty state lalu menuju detail; failure menjaga DOM
dan session draft.

Edit memakai `expected_revision`. Gunakan base-revision metadata T07 untuk restored draft: draft lama
atau mismatch tidak boleh mewarisi revision server terbaru tanpa explicit review/rebase. Conflict
menampilkan latest owned Project dan pilihan Reload server atau Review/retry local changes. Jangan
menyalin ID, owner, timestamps, revision, atau lifecycle field lain dari object conflict ke form.

Perubahan Experience dengan linked Activity count >0 membuka confirmation summary sebelum submit.
Summary menyebut jumlah Activity dan bahwa Experience mereka akan mengikuti Project; jangan menyebut
Achievement/CV sebelum domain tersedia. Pending/saved/conflict/unavailable tidak bergantung pada warna.

### 6. S09 Project list

`/projects` memanggil Project list service setelah workspace gate. Perilaku:

- header dan satu primary CTA `New project`;
- tabs/filter All, Planned, Active, Completed dengan selected state semantic dan URL;
- compact row berisi title, text status, user role bila ada, Experience label atau Independent,
  formatted partial date range atau `Date not set`, linked Activity count, dan `Needs outcome` bila
  completed + outcome NULL;
- order server canonical; UI tidak resort;
- maksimal 30 row dan Next memakai opaque cursor sambil mempertahankan status;
- empty account menjelaskan fungsi Project dan satu CTA;
- valid filter tanpa hasil memberi no-match + Clear filters;
- invalid query memberi inline safe error dan tidak menjalankan query invalid;
- service failure memberi Retry, bukan empty state;
- loading route memakai skeleton dengan layout stabil;
- row/detail return mempertahankan filter/cursor.

Formatter partial date tidak boleh menampilkan tanggal placeholder Januari/awal bulan. Locale `en`
dan `id` hanya menerjemahkan label; content pengguna tidak diterjemahkan. `is_current` tampil Present
atau padanan lokal. Unknown start/end ditampilkan jujur tanpa mengarang interval.

Achievement count tidak ditampilkan pada T08. Setelah T09, row summary dapat ditambah dengan query
nyata. Jangan menampilkan `0 achievements` atau kartu disabled sebagai placeholder.

### 7. S10 create, detail, edit, dan linked work

Create/edit form memakai field canonical dan progressive disclosure. Title/status/Experience/role
terlihat awal; description, partial dates, current, dan outcome tetap mudah ditemukan tanpa membuat
mobile grid sempit. Status `completed` mematikan current flag; outcome tetap optional dan warning
nonblocking menjelaskan `Needs outcome`.

Detail default menampilkan saved Project dan editable overview yang jelas. Implementasi boleh memakai
view/edit mode dalam route sama, tetapi satu decision area hanya memiliki satu primary action. Seluruh
text content menjaga whitespace yang relevan dan tidak diterjemahkan.

Linked Activity section:

- tampilkan Activity minimal yang sudah terhubung dalam order `occurred_on DESC, id DESC`;
- setiap item membuka canonical `/activity/:id` dengan safe return ke Project detail;
- `Log related work` membuka `/activity/new` dengan owned Project preselected dan return ke detail;
- `Attach existing` membuka dialog/list accessible berisi owned Activity dan current Project label;
- memilih standalone/Project lain memerlukan summary `Attach`/`Move`; submit memakai current Activity
  revision dan RPC relink;
- row linked menyediakan `Detach`; detach mempertahankan Experience;
- conflict Activity mempertahankan pilihan lokal dan meminta reload/review, bukan mencoba revision
  baru diam-diam;
- no candidate/empty/error/loading state berbeda dan aman.

Integrasi Activity capture menambahkan optional `initialProjectId` yang sudah divalidasi terhadap
owned context options. Prefill hanya berlaku pada create form yang pristine. Session draft yang valid
dan dipulihkan pengguna menang atas URL prefill; URL tidak boleh menghapus draft. Project menentukan
effective Experience memakai helper T07. Malformed/foreign Project query tidak membocorkan nama dan
capture manual tetap dapat digunakan tanpa context.

Jangan merender section Achievement atau Evidence pada T08. Jangan mengubah Activity source/Chat saat
relink. Tidak ada bulk attach; satu explicit Activity per operation menjaga conflict/recovery jelas.

### 8. Delete preview dan post-delete behavior

Gunakan `NamedDeleteDialog` atau extension sempit yang mempertahankan accessible focus/return.
Confirmation harus menyebut nama Project dan count Activity yang dipertahankan. Copy eksplisit:

- Project row akan dihapus;
- N Activity tetap ada;
- Project link dibersihkan;
- Experience tiap Activity dipertahankan.

Jangan menyatakan Evidence dihapus karena T11 belum ada. Bila dependency preview gagal, destructive
action disabled; jangan menganggap count nol. Delete memakai current expected revision. Conflict
menutup/merender state review tanpa kehilangan page; unavailable kembali aman. Success menuju sanitized
Project list dan menampilkan jumlah aktual dari receipt.

### 9. Responsive, accessibility, dan privacy contract

- 360 px: satu kolom, tabs dapat wrap/scroll secara accessible, form/partial date stack, dialog tidak
  overflow, linked actions memiliki label penuh, dan global Quick log tetap tersedia.
- 1440 px: overview dan linked work dapat memakai dua kolom; density mengikuti S09/S10 tanpa kartu
  besar untuk setiap Activity.
- Light/dark memakai tokens existing, muted sage, tanpa gradient. Status selalu memiliki text.
- Keyboard: create/filter/edit/attach/move/detach/delete dapat diselesaikan; dialog trap/close/return
  focus benar; first invalid field difokuskan; conflict/unavailable heading dapat ditemukan.
- Reduced motion dihormati. Axe WCAG 2.2 A/AA dijalankan pada list, create, detail, dialog, validation,
  empty, conflict, dan unavailable representative states.
- Jangan log user content, Project title/description/outcome, Activity excerpt, Experience label,
  FormData, filename, token, atau secret. Browser tidak menerima service credential.

## Urutan kerja untuk Luna

Kerjakan subtask berurutan; jangan mulai T09:

1. **T08.1 Baseline dan contract** — baca semua acuan, jalankan baseline, inspect dirty diff, tulis
   decision T08 untuk limit/RPC/lock seam bila belum tercakup keputusan lama.
2. **T08.2 Migration** — checks field, create idempotent, revoke direct insert, relink RPC,
   dependency-aware delete, grants/RLS/lock order, pgTAP race/ownership tests.
3. **T08.3 Types dan domain** — regenerate Supabase public types dari schema applied; tambah Project
   contracts, schema, cursor, query parser, partial-date display, dan unit tests.
4. **T08.4 Service/actions** — implement owner/session boundary, CRUD/list/detail/count/relink/delete,
   safe errors/correlation, stable receipt, revision conflicts, action mapping, dan integration tests.
5. **T08.5 S09** — list/filter/cursor/loading/empty/error/no-match/labels/return URL.
6. **T08.6 S10 overview** — create/detail/edit/draft/rebase/context confirmation/completed warning.
7. **T08.7 Linked work** — capture prefill, attach/move/detach, safe nested return, conflicts, and
   delete preview/receipt.
8. **T08.8 Browser/accessibility** — Project E2E plus Auth/UI/Activity regressions, 360/1440,
   light/dark, keyboard, Axe, reduced motion.
9. **T08.9 Verification** — clean disposable migration rebuild, record actual commands/results,
   update README/status/verification, and mark status accurately.

Setelah setiap subtask, jalankan focused test terkait sebelum melanjutkan. Jika review menemukan gap
kontrak pada task sebelumnya, pisahkan remediation dengan bukti; jangan menyisipkan refactor luas.

## File yang diperkirakan

Nama rinci boleh menyesuaikan pola aktual, tetapi ownership lapisan harus tetap jelas.

### File baru yang mungkin diperlukan

- `supabase/migrations/<timestamp>_t08_projects_context.sql`
- `src/domain/project/contracts.ts`
- `src/domain/project/project-cursor.ts`
- `src/domain/project/project-display.ts`
- `src/features/project/schemas.ts`
- `src/features/project/project-service.ts`
- `src/features/project/actions.ts`
- `src/features/project/project-form.tsx`
- `src/features/project/project-list.tsx`
- `src/features/project/project-detail.tsx`
- `src/features/project/activity-relink-dialog.tsx`
- `src/app/(workspace)/projects/loading.tsx`
- `src/app/(workspace)/projects/new/page.tsx`
- `src/app/(workspace)/projects/[id]/page.tsx`
- `tests/unit/project-*.test.ts` sesuai boundary
- `tests/integration/project-context.test.ts`
- `tests/e2e/projects-ui.spec.ts`
- `playwright.projects.config.ts`
- `docs/decisions/0012-t08-project-context.md`
- `docs/verification/T08-projects-context.md`

### File yang diperkirakan berubah

- `src/app/(workspace)/projects/page.tsx`
- `src/app/(workspace)/activity/new/page.tsx`
- `src/features/activity/activity-capture-form.tsx`
- `src/features/activity/activity-context-service.ts` hanya bila read model dapat direuse tanpa
  mengubah error semantics T07
- `src/domain/routes/safe-return.ts`
- `src/domain/routes/url-filters.ts` hanya bila Project query utility ditempatkan bersama
- `src/domain/profile/field-contract.ts` atau domain Project contract untuk field limit
- `src/domain/database-types.ts`
- `src/server/supabase/database.types.ts` hasil generator lokal
- `src/i18n/messages.ts`
- `src/app/globals.css`
- `supabase/tests/database/foundation.test.sql` dan/atau `activity.test.sql`, atau suite Project baru
- `tests/unit/url-filters.test.ts`, `tests/unit/session-draft.test.ts`, dan regression terkait
- `tests/e2e/activity-ui.spec.ts` untuk prefill/return regression
- `package.json` untuk script integration/E2E Project
- `README.md`
- `docs/IMPLEMENTATION_STATUS.md`

### File yang tidak seharusnya berubah

- Migration T01-T07 yang sudah applied; hanya migration forward baru yang boleh ditambah.
- `pnpm-lock.yaml`, kecuali dependency baru benar-benar dibenarkan; default tidak berubah.
- `workers/*`; tidak ada Project background job pada T08.
- Storage adapter/scanner, bucket, Evidence schema/UI, AI provider/jobs, import, CV, PDF, account
  deletion, Dashboard, Timeline, dan Achievement implementation.
- Dokumen sumber DOCX, `docs/Design.md`, dan design mockups.
- Activity create/update persistence semantics selain prefill/return integration dan RPC relink baru.

## Matriks acceptance dan bukti

| Acceptance T08 | Bukti otomatis | Pemeriksaan tambahan |
| --- | --- | --- |
| Create minimal standalone Project | Unit/action + integration create title/status default tanpa Experience | Academic/personal copy tidak meminta employer |
| Create retry idempotent | Concurrent/ambiguous replay integration + pgTAP ledger; changed payload rejected | Receipt tetap revision 1 setelah later edit |
| Direct Project mutation tertutup | pgTAP dua akun: direct insert/update/delete ditolak; RPC own berhasil | Grants diff dan generated types cocok |
| Field/status/date validation | Unit Zod/partial date + pgTAP constraints | Unknown/partial ditampilkan tanpa placeholder |
| Completed tanpa outcome valid | Integration simpan berhasil + E2E label `Needs outcome` | Warning nonblocking, tanpa outcome rekaan |
| Standalone Project valid | Integration create/update Experience NULL + E2E label Independent | Tidak membuat Experience placeholder |
| List/filter/pagination | Unit query/cursor + integration 31 same timestamp + E2E filter/detail/back | Order tidak diubah client; `q` ditolak |
| Foreign/missing detail aman | Service/integration/E2E akun kedua dan random UUID mendapat state sama | Tidak ada existence/name leak |
| Update revision conflict | Concurrent integration + two-tab E2E local draft retained/rebase explicit | No silent overwrite |
| Project context edit propagates | pgTAP/integration Project Experience A→B/NULL memperbarui all linked Activity atomik dan revision +1 | Confirmation summary memakai count Activity nyata |
| Attach/move owned Activity | Integration RPC derives Experience from Project + E2E standalone/P1→P2 | Browser tidak mengirim authoritative Experience |
| Detach Activity | Integration project NULL tetapi Experience retained; source/Chat unchanged | UI copy menjelaskan preservation |
| Relink ownership dan race | pgTAP/integration foreign target rejected; attach vs context edit serialized/conflict | Tidak ada mismatched context |
| Create linked work | E2E Project detail → capture prefilled → save → Project detail/list | Existing valid session draft tidak ditimpa URL |
| Delete preview/retention | Integration/pgTAP count + delete; Activity/Chat/Experience remain, project_id NULL, revision +1 | Dialog disabled jika preview unavailable |
| Delete vs attach race | Two-client integration menghasilkan release-count-consistent atau safe unavailable | Tidak ada orphan/mismatch |
| No premature domains | Diff/UI assertions: tanpa Achievement/Evidence/CV fake count/card/schema | Verification mencatat seam T09/T11/T20 |
| Mobile/theme/a11y | Playwright 360/1440, light/dark, keyboard, Axe, reduced motion | Manual focus/contrast/dialog review |
| Regression T01-T07 | Unit, Activity/Storage integration, Auth/UI/Activity E2E, build, worker, pgTAP, DB lint | Raw text/Chat/filter/conflict tetap benar |

## Perintah verifikasi saat eksekusi

Catat output aktual, jumlah test, environment, dan alasan setiap check yang tidak dijalankan. Jangan
menyalin angka dari plan sebagai hasil.

Baseline minimum sebelum edit:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
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
git diff --check
```

Setelah implementasi:

```text
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
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
git diff --check
```

Nama scripts baru boleh disesuaikan dengan manifest final, tetapi verification record harus menulis
command aktual dan scope jujur. Integration/browser tests memakai Supabase lokal nyata. Fixture
server-only boleh memakai local secret key untuk setup/cleanup; produk/browser tidak boleh menerima
key. Semua account/Experience/Project/Activity fixture dibersihkan pada `finally` termasuk saat gagal.

Karena T08 mengubah public schema/RPC/grants, wajib:

1. apply forward migration ke stack lokal aktif tanpa reset data aktif;
2. jalankan `db:types` setelah migration applied dan review diff generated type;
3. verifikasi migration ledger lokal;
4. lakukan clean rebuild pada project Supabase disposable dengan project ID, workdir, dan port unik;
5. sebelum destructive reset, resolve serta verifikasi absolute disposable target dan pastikan bukan
   workspace/database aktif;
6. jalankan pgTAP + Project/Activity/Storage integration + DB lint pada rebuild disposable;
7. stop dan hapus hanya resource disposable setelah bukti dicatat.

Jangan reset stack Supabase aktif. Jangan mencetak local key. Hosted/staging/production migration,
deployment, dan T24 performance di luar scope; catat sebagai belum dijalankan, bukan dianggap lulus.

## Prompt eksekusi untuk Luna

```text
Implementasikan T08 Project dan Context Propagation berdasarkan
docs/verification/T08-implementation-plan.md menggunakan GPT-5.6 Luna dengan
reasoning MAX.

Baca seluruh AGENTS.md yang berlaku, docs/IMPLEMENTATION_STATUS.md,
docs/IMPLEMENTATION_PLAN.md §1, §3, §4, acceptance T08, matriks R06, dan Gate
M2. Ekstrak sumber PRD R06/shared validation/deletion/release scenario graduate,
User Flow F04/shared recovery, Wireframe S09-S10, Database Schema §§1-3/6,
Design.md §2/§8/shared UI, mockup S09-S10, verification T06-T07, serta decisions
0004 dan 0009-0011. Pertahankan seluruh dirty changes T05-T07; jangan reset,
checkout, atau memulai T09.

Kerjakan T08.1-T08.9 berurutan. Tambahkan migration forward-only untuk Project
create idempotent, revoke direct INSERT, Activity relink owner-scoped, dan delete
Project dependency-aware. Project update memakai expected_revision dan perubahan
Experience harus mempropagasi linked Activity secara atomik. Relink menurunkan
Experience dari Project; detach dan delete hanya membersihkan project_id serta
mempertahankan Activity, Chat, structured fields, dan Experience. Uji race dengan
PostgreSQL nyata dan dua akun. Regenerate database types setelah migration.

Implementasikan /projects, /projects/new, dan /projects/:id. Status hanya planned,
active, completed; tanpa progress. Title wajib; partial/unknown dates valid;
completed tanpa outcome tetap tersimpan dan diberi Needs outcome. List memakai
status URL filter, updated_at/id cursor, page 30, compact rows, linked Activity
count, empty/error/loading/no-match, dan safe return. Foreign/deleted/random deep
link harus indistinguishable.

Create memakai operation key stabil. Edit memakai base-revision draft metadata,
expected_revision, local-input-preserving conflict, serta confirmation saat
Experience Project mengubah linked Activity. Detail menyediakan Log related work,
Attach/Move existing owned Activity, Detach, dan named dependency delete. Prefill
Activity hanya untuk owned Project dan tidak menimpa restored session draft.

Jangan membuat Achievement, Evidence, Dashboard/Timeline, AI, CV, import, export,
worker job, progress, paused/archived, search, bulk relink, atau fake counts/cards.
Catat seam bahwa T09 memperluas relink/delete untuk Achievement, T11 untuk direct
Project evidence, dan T20 untuk CV invalidation.

Jalankan baseline lalu checks final pada plan: lint, nonincremental typecheck, unit,
Project/Activity/Storage integration, build, worker check, generated types, pgTAP,
DB lint/status/ledger, Auth/UI/Activity/Project E2E, Axe, 360/1440 light/dark,
keyboard, reduced motion, forward migration, clean disposable rebuild, dan diff
check. Jangan reset database aktif atau membocorkan key. Catat hasil aktual pada
docs/verification/T08-projects-context.md dan docs/IMPLEMENTATION_STATUS.md. Tandai
DONE hanya jika seluruh acceptance terbukti; selain itu gunakan PARTIAL/BLOCKED
dengan blocker konkret. T09 menjadi next task dan Gate M2 tetap terbuka.
```

## Risiko dan mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Direct Project INSERT melewati idempotency | Revoke grant setelah create RPC; pgTAP direct mutation + replay race. |
| Browser mengirim Experience yang tidak cocok | Relink RPC hanya menerima Project dan menurunkan Experience di database. |
| Project context edit race dengan attach | Lock Project sebelum Activity; integration dua session memverifikasi serialisasi/conflict. |
| Delete preview stale | Delete RPC lock/count ulang dan mengembalikan receipt aktual; preview bersifat penjelasan, bukan authority. |
| Delete menghapus Experience Activity | Explicit update hanya `project_id=NULL`; test exact Experience/source/Chat retention. |
| Activity revision tidak naik atau naik dua kali | Trigger/RPC unit pgTAP memeriksa delta tepat satu hanya saat context berubah. |
| Generic update menerima field terlindungi | Service full allowlist + internal RPC allowlist + SQL tests owner/id/revision/timestamp. |
| Partial date menampilkan Jan 1/day 1 | Formatter memakai precision; tests year/month/unknown/id/en. |
| Completed dipaksa mempunyai outcome | Outcome tetap NULL-valid; UI memberi text warning/check saja. |
| Standalone Project diam-diam membuat employer | Experience NULL canonical; `Independent` hanya display label. |
| Nested return membuka redirect/loop | Route-specific sanitizer, bounded one hop, duplicate/unknown/external rejection tests. |
| URL prefill menimpa Activity draft | Owned validation + initial default hanya; valid restored session draft menang. |
| Attach dialog mengambil raw Activity berlebihan | Query minimal display fields; source tidak masuk log/error. |
| Luna mengambil mockup Achievement/Evidence | Scope dan assertions eksplisit melarang section/count palsu sebelum T09-T11. |
| Migration mengubah stack aktif destruktif | Forward apply saja; clean reset hanya pada disposable target yang diverifikasi. |
| Dirty T07 tertimpa | Inspect status/diff awal; edit additive/scoped; tidak checkout/reset. |

## Definition of Done

T08 boleh ditandai `DONE` hanya jika:

1. Create Project owner-scoped dan idempotent; direct client INSERT/UPDATE/DELETE ditolak dan receipt
   replay tetap stabil.
2. S09 list/filter/cursor/detail route bekerja dengan three statuses, page 30, partial/unknown date,
   Activity count, stable return URL, dan semua loading/empty/no-match/error states.
3. S10 create/edit menyimpan seluruh canonical field dengan server/database validation,
   `expected_revision`, stable draft/operation key, unsaved guard, dan actionable conflict.
4. Project standalone tanpa Experience valid. Completed tanpa outcome tersimpan dan tampil dengan
   text label `Needs outcome`, tanpa angka/outcome rekaan.
5. Project Experience edit mempropagasi context ke semua linked Activities atomik dan menaikkan
   revision hanya pada Activity yang berubah; context mismatch tidak dapat commit.
6. Log related work mem-prefill owned Project tanpa menimpa restored draft. Attach/move/detach
   existing owned Activity bekerja lewat RPC; foreign target ditolak tanpa leak.
7. Delete dialog menampilkan dependency count; delete transaction mempertahankan Activity, source,
   Chat, structured fields, dan Experience, hanya membersihkan Project link, lalu kembali ke safe list.
8. Race create replay, concurrent edit, attach vs context change, dan attach vs delete memiliki hasil
   deterministic/actionable tanpa duplicate, orphan, lost update, atau silent overwrite.
9. Missing/foreign/deleted deep links dan errors aman, localized, mempunyai correlation ID, dan tidak
   mencatat content/secret.
10. UI 360/1440, light/dark, keyboard, dialog focus, reduced motion, dan Axe representative states
    lulus; status tidak bergantung pada warna.
11. Tidak ada Achievement/Evidence/CV/AI/Dashboard/Timeline implementation atau fake UI/count dalam
    scope T08; seam T09/T11/T20 terdokumentasi.
12. Forward migration, generated types, clean disposable rebuild, lint, typecheck, unit,
    Project/Activity/Storage integration, build, worker check, pgTAP, DB lint/ledger,
    Auth/UI/Activity/Project E2E, dan diff check memiliki hasil aktual yang tercatat.
13. `docs/verification/T08-projects-context.md`, decision bila perlu, README, dan
    `docs/IMPLEMENTATION_STATUS.md` diperbarui. T09 dicatat sebagai langkah berikutnya dan Gate M2
    tetap terbuka.

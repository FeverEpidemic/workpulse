# Rencana Implementasi T07 Capture dan Activity UI

Tanggal perencanaan: 17 September 2026

Eksekusi selesai: 18 September 2026. Status akhir T07: **DONE**; bukti acceptance ada di
[verifikasi T07](T07-activity-ui.md).

Model eksekusi yang dituju: GPT-5.6 Luna dengan reasoning `MAX`.

Dependensi wajib: T04 dan T06 `DONE`. Baseline aktual: T01-T06 `DONE`, remediasi review T06
selesai, dan Gate M2 masih terbuka. Worktree belum bersih karena hasil T05-T06 belum di-commit;
seluruh perubahan tersebut harus dipertahankan.

## Hasil yang dituju

T07 menghubungkan persistence Activity T06 ke pengalaman manual S05-S06 yang lengkap. Pengguna
dapat membuka Quick log dalam satu aksi, memilih Note, Form, atau Chat, menyimpan Activity tanpa AI,
melihat daftar dengan filter dan pagination, membuka deep link detail, serta mengedit Activity dengan
optimistic revision recovery. Feedback `Saved` hanya muncul setelah commit berhasil; kegagalan
menjaga input lokal dan draft tab.

Implementasi harus tetap jujur terhadap capability yang tersedia. Mode Chat pada T07 hanya
menyimpan pesan pertama sebagai `raw_text` dan `chat_messages` sequence 1 secara atomik melalui
kontrak T06. Tidak ada consent AI, analysis job, progress `Analyzing`, retry AI, suggestion,
achievement, evidence, attachment, atau delete Activity. Project dan Experience hanya dibaca
sebagai context option; CRUD serta relink lintas-record tetap milik T08.

## Acuan dan acceptance sumber

- `docs/IMPLEMENTATION_PLAN.md` §1, §3 Ownership dan concurrency, §3 Data karier, acceptance T07,
  matriks R04, dan Gate M2.
- PRD R04: Quick note hanya memerlukan teks nonblank dan tanggal Activity; structured entry
  menambah context dan project opsional; Chat menyimpan note asli sebelum pemrosesan AI.
- PRD Content and AI behavior: source disimpan sebelum AI, routine Activity tetap berguna tanpa
  achievement, dan AI tidak pernah mengganti `raw_text`.
- PRD Reliability/Usability: form content bertahan setelah save gagal; kontrol berlabel, focus
  terlihat, layout 360/1440 px, serta primary flow keyboard-accessible.
- User Flow F02: Quick log membuka Note/Form/Chat, tanggal default mengikuti timezone profil,
  `Saved` baru tampil setelah persistence berhasil, dan jalur manual tetap bekerja tanpa consent
  atau availability AI.
- User Flow Shared navigation recovery: Back kembali ke list beserta filter; unsaved edit meminta
  konfirmasi; foreign/deleted deep link memakai satu state `Record unavailable`.
- Wireframe S05: input maksimal 10.000 karakter, exact date, context opsional dengan progressive
  disclosure, mode Chat menyimpan first message, dan state saving/saved terpisah dari AI.
- Wireframe S06: list filter tanggal/project, detail source text dan Chat history, serta unsaved edit
  guard. Achievement/evidence state diterapkan hanya setelah task domain pemiliknya tersedia.
- Database Schema §§1-3/6: exact Activity date, owner-scoped reads, revision guard, append-only Chat,
  context project/experience konsisten, dan page size 30 dengan stable date/ID tie breaker.
- `docs/Design.md` §2, §6-7, dan §16-44: capture satu aksi, textarea-first, progressive disclosure,
  compact rows, muted sage tanpa gradient, light/dark, reduced motion, mobile autofocus, serta
  WCAG 2.2 AA.
- `design-mockups/S05.html` dan `design-mockups/S06.html` menjadi arah hierarchy/density. Sample
  data, AI suggestion, evidence card, dan action preview di mockup bukan capability T07.
- `docs/verification/T06-activity-persistence.md`, decision 0009, dan decision 0010 adalah kontrak
  implementasi authoritative untuk create receipt, exact date, raw-text preservation, safe error,
  conflict, context, list/detail, dan cursor.

## Kondisi workspace sebelum eksekusi

- Stack terpin: Next.js 16.3.5, React 19.3.0, TypeScript 6.0.3, Supabase JS 2.116.0, Zod 4.6.5,
  Lucide React 1.46.0, Vitest 5.0.0, Playwright 1.63.0, dan Node 24. Dependency baru tidak
  diperkirakan diperlukan.
- Route `/activity` masih shell filter dan unavailable state. Route `/activity/new` masih Quick log
  dengan textarea terfokus, session draft owner-scoped, unsaved guard, dan tombol save disabled.
  Route `/activity/[id]` belum ada.
- `createActivityService()` sudah menyediakan `createActivity`, `updateActivity`, `listActivities`,
  dan `getActivity`. Create mengembalikan receipt immutable, bukan row live. Update conflict
  mengembalikan latest owned record. List memakai page size 30 dan cursor opaque T06.
- `activityDateInTimeZone()` sudah menghasilkan default calendar date dari instant dan timezone
  profil. UI harus memakai helper ini, bukan timezone browser atau `new Date("YYYY-MM-DD")`.
- `useCreateOperationKey`, `useSessionDraft`, `useUnsavedForm`, `ActionFeedback`, field-error
  binding, `RevisionConflict`, `RecordUnavailable`, toast, dialog, skeleton, button, input,
  textarea, dan select sudah tersedia. T07 memperluas/reuse primitives tersebut.
- Filter Activity T04 saat ini menyimpan project sebagai keyword bebas. Persistence T06 menerima
  `projectId` UUID. T07 harus mengubah contract URL menjadi project UUID-backed select tanpa
  menambahkan search global atau project keyword query.
- `projects` dan `experiences` sudah owner-readable melalui RLS. Project CRUD belum menjadi scope;
  T07 hanya membutuhkan query options minimal untuk context dan filter.
- `ActionState` belum memiliki code khusus idempotency reuse. T07 dapat memetakan
  `IDEMPOTENCY_KEY_REUSED` ke error UI `CONFLICT` dengan message key
  `error.operationKeyReused`; jangan memperluas public error contract hanya untuk menyalin nama
  service bila tidak diperlukan.
- Existing `test:e2e:ui` masih mengharapkan save Quick log disabled dan project keyword input. Test
  tersebut harus diperbarui menjadi contract T07 tanpa mengurangi coverage frame, URL history,
  draft isolation, mobile autofocus, theme, atau accessibility T04.

## Batas scope

### Termasuk dalam T07

- UI S05 untuk Note, Form, dan Chat manual.
- Default exact date dari timezone profil dan field date yang visible/editable.
- Optional Project dan standalone Experience context menggunakan owner-scoped options.
- Progressive disclosure untuk role, scope, dan outcome pada Form; Note/Chat tetap minimal.
- Server Actions create/update yang memakai Activity service T06 dan safe `ActionState` mapping.
- Stable operation key per create attempt, draft tab owner-scoped, disabled repeat submit, dan
  feedback sesudah commit.
- List Activity owner-scoped, compact rows, empty/no-match/error/loading states, filter date/project,
  page size 30, dan next cursor.
- Detail Activity owner-scoped dengan current source, mode, date, context, optional structured
  fields, dan ordered Chat history.
- Edit Activity dengan `expected_revision`, local draft preservation, unsaved navigation guard,
  conflict display, Reload server, serta explicit review/retry local changes.
- Safe return link yang mempertahankan filter dan cursor page, serta safe unavailable state untuk
  missing/foreign/random UUID.
- String English/Bahasa Indonesia, styling light/dark, 360/1440 px, keyboard, focus management,
  reduced motion, semantic status, dan Axe checks.
- Unit/regression tests serta browser E2E dengan Supabase lokal nyata.

### Tidak termasuk

- Migration SQL, perubahan tabel/RPC, regenerate database types, atau dependency baru.
- Project create/edit/delete, attach existing Activity, relink lintas Activity/Achievement, atau
  dependency preview; semua itu T08.
- Achievement schema, detection, `Open achievement`, suggestion banner, atau source-review flag;
  semua itu T09/T14.
- Evidence card, upload, move, download, screening, atau delete attachment; semua itu T10-T11.
- AI consent, `ai_jobs`, provider call, follow-up answer, assistant Chat message, `Analyzing`,
  `Analysis failed`, atau Retry analysis; semua itu T13-T14.
- Delete Activity. Lifecycle delete harus menunggu achievement/evidence/AI/CV dependents tersedia;
  jangan menambahkan hard delete sementara.
- Dashboard/timeline update, realtime subscription, text search, grouping weekly, infinite scroll,
  analytics event, optimistic fake row, atau data sample production.

## Keputusan implementasi T07

### 1 Route, query, dan return contract

Gunakan route canonical berikut:

| Route | Tanggung jawab T07 |
| --- | --- |
| `/activity` | List, date/project filter, empty/no-match/error state, dan cursor pagination. |
| `/activity/new` | Capture Note/Form/Chat dengan optional `returnTo`. |
| `/activity/:id` | Detail dan edit Activity dengan optional `returnTo`. |

Query list yang didukung:

- `from=YYYY-MM-DD`, inclusive.
- `to=YYYY-MM-DD`, inclusive.
- `project=<owned-project-uuid>`.
- `cursor=<opaque-T06-cursor>` untuk page berikutnya.

`project` tetap nama query publik agar URL T04 tidak berganti tanpa alasan, tetapi nilainya berubah
dari keyword menjadi UUID. Filter form harus menghapus `cursor` saat user Apply/Clear agar filter
baru selalu mulai pada page pertama. Unknown query tidak menjadi state aplikasi.

`returnTo` dibuat dari URL list yang sudah disanitasi. Allowlist safe-return `/activity` diperluas
untuk `cursor`; nilai filter tetap dibatasi dan external/protocol-relative/backslash/dot-segment URL
ditolak. Row list menautkan ke detail dengan current list URL. Capture CTA dari list membawa
current list URL; global Quick log memakai `/activity` sebagai fallback. Back dari detail atau
Cancel dari capture/edit memakai safe return tersebut. Pagination page dapat kembali melalui
browser Back dan explicit detail link kembali ke page/filter yang sama.

Malformed Activity ID, foreign ID, deleted ID, dan UUID acak menghasilkan UI unavailable yang sama.
Tidak ada copy yang membedakan ownership dari nonexistence. `RecordUnavailable` boleh menerima
optional safe back href/label; default Dashboard untuk consumer lama tetap dipertahankan.

### 2 Context option boundary tanpa mengambil scope T08

Tambahkan read helper/service owner-scoped yang mengembalikan hanya data minimum:

- Experience: `id`, `organization`, dan `role_title`.
- Project: `id`, `title`, `experience_id`, dan `status` bila diperlukan untuk label.

Query mengambil actor dari authenticated client, mengandalkan RLS sekaligus memberi predicate
`user_id`, dan tidak menerima owner dari payload browser. Urutan label deterministic. Tidak ada
create/update/delete Project atau Experience baru pada helper ini.

Capture behavior:

- `No project` dan `No experience` selalu tersedia.
- Jika Project dipilih, `experienceId` dikunci mengikuti `project.experience_id`, termasuk NULL.
- Jika Project kosong, pengguna boleh memilih standalone Experience.
- UI menampilkan effective Experience yang ditentukan Project dan tidak mengirim pasangan context
  yang dapat mismatch.
- Empty Project list tidak memblokir capture; control menjelaskan bahwa Activity dapat standalone.

List/detail memakai map options yang sama untuk label. ID yang tidak lagi ada ditampilkan sebagai
context unavailable/none tanpa membocorkan record akun lain. T08 dapat mengganti read helper ini
dengan Project service penuh tanpa mengubah Activity form contract.

### 3 Capture mode dan progressive disclosure

Gunakan satu form dan satu action contract dengan `capture_mode` allowlist:

- **Note**: label `Work note`; wajib `raw_text` dan date. Context Project/Experience opsional.
- **Form**: wajib source text dan date; tampilkan Project/Experience serta disclosure `Add details`
  untuk role, scope, dan outcome. Optional text mengikuti limit T06 dan canonical NULL behavior.
- **Chat**: label `First message`; wajib source text dan date. Copy menyatakan pesan akan disimpan
  sebagai Activity dan tidak dianalisis pada saat ini. Tidak ada composer kedua atau AI indicator.

Mode switch harus keyboard-accessible, memiliki selected state yang tidak hanya memakai warna, dan
tidak membuang source text/date/context. Role/scope/outcome dapat tetap berada di draft ketika user
berpindah mode, tetapi action harus mengirim NULL untuk mode Note/Chat agar hidden stale values tidak
masuk canonical record. Alternatif implementasi boleh selalu menampilkan optional details untuk
semua mode hanya bila tetap sesuai S05; default wajib tetap textarea-first dan minimal.

Textarea memakai `maxLength=10000`, counter code point yang konsisten dengan server, visible help,
dan tidak melakukan `.trim()` atau slice sebelum submit. Trim hanya dipakai untuk client predicate
blank. Browser limit bukan satu-satunya validation; server T06 tetap authoritative.

Date diisi server dari `activityDateInTimeZone(new Date(), profile.timezone)`. Jangan memakai
timezone browser sebagai source canonical. User dapat mengubah date; submitted calendar string
disimpan persis.

### 4 Create action, idempotency, dan save lifecycle

Buat Server Action tipis yang:

1. Membaca field dari `FormData` tanpa menerima `user_id`.
2. Memetakan snake-case form names ke `ActivityCreateInput`.
3. Memanggil cookie-bound `createSupabaseServerClient()` dan `createActivityService()`.
4. Mengembalikan `actionSuccess("activity.saved", receipt)` hanya setelah RPC commit berhasil.
5. Memetakan `ActivityServiceError` ke localized `ActionState`, membawa field errors dan correlation
   ID service yang sudah aman; exception lain menjadi generic `UNAVAILABLE` tanpa source text.
6. Melakukan `revalidatePath("/activity")` dan detail yang baru dibuat setelah success.

Operation key dibuat dengan `useCreateOperationKey(ownerId, formKey, state)` dan disimpan di
`sessionStorage`. Tombol save disabled sampai key tersedia. Key tidak dirotasi pada validation,
session, network, atau ambiguous failure; retry payload identik tetap deduplicated. Success merotasi
key. Reuse key dengan payload berbeda menampilkan copy operation-key conflict, bukan membuat request
baru diam-diam.

Client form memakai `useActionState`, `useSessionDraft`, dan `useUnsavedForm` dengan state yang sama.
Pada success:

- `ActionFeedback` menerbitkan status/toast `Activity saved`.
- Draft form dan dirty state dibersihkan.
- Navigasi client menuju `/activity/:id` dengan safe `returnTo` hanya setelah success state diterima.
- Receipt dipakai hanya untuk ID/revision/date/mode; UI detail membaca row current melalui service.

Pada error, jangan reset form, jangan clear session draft, jangan rotate key, dan fokuskan field
invalid pertama setelah error correlation berubah. Session expired menawarkan sign-in dengan safe
return route; draft tetap owner/tab-scoped. Disable repeat submit ketika pending dan gunakan label
`Saving…`; jangan memasukkan optimistic Activity ke list sebelum commit.

### 5 List S06

Server page memanggil `listActivities` dengan filter/cursor yang sudah divalidasi dan query context
options secara paralel setelah workspace/session gate selesai. Perilaku:

- Order canonical tetap `occurred_on DESC, id DESC`; UI tidak melakukan resort.
- Maksimal 30 row per page; link Next membawa filter + `nextCursor`. Jangan membuat limit client.
- Row compact menampilkan source excerpt, exact date yang dilokalisasi, capture mode, dan context
  Project/Experience bila ada. Text dapat dipotong untuk presentasi tetapi canonical source tidak
  diubah dan detail selalu menampilkan penuh.
- Seluruh row atau judul menjadi link bernama yang jelas; focus state terlihat.
- Empty account memiliki satu primary CTA `Add activity`.
- Filter yang valid tetapi tidak menemukan row menampilkan `No matching activity` dan Clear filters.
- Filter invalid menampilkan inline error aman, mempertahankan nilai yang dapat diperbaiki, dan
  tidak menjalankan query dengan input invalid.
- Service unavailable menampilkan Retry tanpa mengganti error menjadi empty state.
- Project select memuat owned projects; UUID foreign/missing diperlakukan sebagai unavailable
  selection dan tidak membocorkan nama.

Tanggal exact perlu formatter domain/UI yang tidak menggeser hari. Parse komponen `YYYY-MM-DD` atau
format instant dengan timezone UTC; jangan parse lalu format menggunakan timezone OS. Tambahkan
unit test tanggal dekat boundary dan locale `en`/`id`.

### 6 Detail dan edit S06

Detail membaca `getActivity(id)` dan context options. Default view menampilkan:

- badge Saved dan capture mode dengan text label;
- exact Activity date;
- current full `raw_text` dengan whitespace/line breaks yang terbaca;
- Project/Experience label bila ada;
- optional role/scope/outcome hanya bila berisi nilai;
- Chat history order `sequence_no ASC` hanya untuk mode Chat.

Untuk Chat, bedakan `Current activity text` dari `Original chat history`. Edit `raw_text` tidak
mengubah pesan pertama; UI tidak boleh menyatakan sebaliknya. Assistant message atau follow-up tidak
ditampilkan bila belum ada.

Edit menggunakan form fields yang sama dengan create, tetapi:

- `capture_mode` read-only/immutable.
- Hidden `activity_id` dan `expected_revision` tidak dipersist ke session draft.
- Operation key create tidak digunakan.
- Success memakai row hasil update, revalidate list/detail, membersihkan draft/dirty state, dan
  menampilkan save feedback setelah commit.
- Conflict mempertahankan local fields, menampilkan latest server revision/content/context secara
  aman, dan menyediakan `Reload server` atau `Review and retry my changes`.
- Retry local change hanya mengganti hidden expected revision setelah user melihat conflict; form
  local tidak ditimpa otomatis.
- Missing row selama edit berubah menjadi Record unavailable; foreign/missing tetap indistinguishable.

Extend conflict helper secara sempit dengan kind `activity` atau buat Activity-specific controls.
Jangan memaksa generic profile summary yang tidak memperlihatkan current Activity source. Latest
record ditampilkan tanpa log/analytics dan hanya karena service sudah memastikan ownership.

Delete button tidak dirender. Evidence/achievement sections juga tidak dirender sebagai fake empty
cards. Detail boleh memberi secondary link Edit dan Back to activity, dengan satu primary action
per decision area.

### 7 Error, privacy, dan state integrity

- Server Action dan Server Component tidak mencatat raw note, Chat content, optional fields,
  project label, FormData, session token, atau provider error.
- Correlation ID ditampilkan melalui shared InlineError; raw Supabase/SQL message tidak ditampilkan.
- `ActivityServiceError.messageKey` menjadi source localization. Field names dipetakan ke form names
  yang benar agar `aria-invalid` dan error ID terhubung.
- Input client tidak menjadi authority untuk owner, revision latest, context ownership, atau
  project-experience consistency.
- Draft key memakai owner + form identity. Create dan edit record yang berbeda tidak berbagi draft.
- Successful save hanya menghapus draft form terkait, bukan seluruh draft owner.
- Error state tidak dikomunikasikan dengan warna saja. Saving, saved, conflict, unavailable, dan
  validation mempunyai copy/role semantic.
- Do not expose `analysis_state` as `Analyzing` ketika nilainya `not_requested`. UI boleh tidak
  menampilkan analysis state sama sekali pada T07.

### 8 Responsive dan accessibility contract

- 360 px: satu kolom, action tidak overflow, mode control dapat wrap, field full width, Project dan
  Experience tidak membentuk grid sempit, serta Quick log tetap satu tap dari header.
- 1440 px: form utama dan explanatory secondary panel dapat memakai split layout sesuai mockup,
  tetapi detail/list tidak diwajibkan tampil bersamaan dalam route yang sama.
- Light/dark memakai token yang sudah ada; tidak ada gradient atau status color-only.
- Quick log autofocus hanya pada initial page open. Error submit memindahkan fokus ke first invalid
  field; conflict/unavailable heading menerima navigasi screen-reader yang jelas.
- Mode switch, disclosure, select, list link, pagination, Cancel, Save, conflict action, dialog, dan
  navigation seluruhnya keyboard-accessible.
- Touch target mengikuti primitive T04; reduced motion tidak menghambat save/navigation.
- Axe WCAG 2.0/2.1/2.2 A/AA dijalankan pada capture idle/error/success destination, list
  empty/populated/filtered, detail, edit validation, conflict, dan unavailable state representatif.

## Paket kerja eksekusi

### T07.1 Baseline, source trace, dan boundary review

1. Catat `git status --short`; jangan reset, stash, checkout, atau menimpa perubahan T05-T06.
2. Jalankan frozen install, lint, typecheck, unit, Activity/Storage integration, build, worker check,
   pgTAP, DB lint, migration list, serta existing Auth/UI E2E sesuai environment lokal.
3. Verifikasi Supabase lokal aktif tidak linked ke hosted dan tidak akan di-reset.
4. Baca ulang T06 decisions/service/tests dan cocokkan receipt/error/revision/cursor contract.
5. Buat decision baru hanya jika implementasi menemukan konflik produk/teknis yang belum diselesaikan
   rencana ini. Jangan membuat decision file untuk mengulang acceptance yang sudah jelas.

Acceptance subtask: baseline aktual tercatat; existing failure dipisahkan dari regresi T07; tidak
ada perubahan database atau cleanup terhadap pekerjaan pengguna.

### T07.2 URL, display, dan context read helpers

1. Ubah project URL filter menjadi UUID-backed dan tambahkan cursor query parsing terpisah.
2. Perluas safe-return `/activity` untuk cursor dengan bounds/validation yang sesuai.
3. Tambahkan exact-date formatter locale-safe dan source excerpt helper presentasional.
4. Tambahkan owner-scoped query context options Project/Experience dengan payload minimum.
5. Tambahkan unit tests invalid UUID/date/range/cursor, filter serialization, safe return, exact date,
   context label, dan foreign/missing selection behavior.

Acceptance subtask: copied URL memulihkan filter/page yang sama; filter invalid tidak mencapai
service; date tidak bergeser; helper context tidak membuka mutation atau cross-owner data.

### T07.3 Server Actions dan error mapping

1. Buat create/update Activity actions yang memanggil service T06.
2. Parse FormData exact, null-kan hidden optional values sesuai mode, dan jangan menerima owner.
3. Map validation/session/not-found/conflict/idempotency/unavailable ke localized ActionState.
4. Pertahankan correlation ID service dan latest owned row hanya untuk update conflict.
5. Revalidate list/detail hanya setelah commit.
6. Unit test mapping success/error, raw-text preservation, mode field allowlist, null optional fields,
   no owner input, receipt-only success, dan exception sanitization.

Acceptance subtask: action tipis tidak menduplikasi domain rules; tidak ada raw/provider message
pada result; success tidak dapat terjadi sebelum persistence selesai.

### T07.4 Capture S05

1. Refactor `QuickLogCapture` menjadi form S05 reusable/expanded tanpa membuat form duplikat.
2. Implement mode control, source textarea/counter, date, context, progressive details, Cancel,
   operation key, draft, unsaved guard, pending/feedback, field errors, dan focus-first-error.
3. Ambil default date dari timezone profil di server page.
4. Pastikan Project menentukan Experience dan standalone Experience hanya aktif tanpa Project.
5. Success clear form state lalu membuka detail dengan return context; failure mempertahankan
   source/date/context/optional fields.
6. Update en/id copy agar tidak menyatakan persistence atau AI capability yang salah.

Acceptance subtask: Note/Form/Chat tersimpan manual; first Chat message berasal dari RPC T06; save
failure dan session expiry mempertahankan input; global Quick log tetap satu click + focus.

### T07.5 Activity list dan pagination

1. Ganti unavailable placeholder `/activity` dengan server-rendered list S06.
2. Hubungkan filter GET date/project, invalid state, Clear, dan reset cursor.
3. Render compact rows, count page yang jujur, context label, detail link dengan returnTo, serta
   empty/no-match/unavailable states.
4. Implement Next page dari `nextCursor`; pertahankan filters dan safe back path.
5. Tambahkan route-level skeleton hanya bila shared workspace skeleton tidak merepresentasikan
   layout list secara memadai.

Acceptance subtask: filter URL, page 30, ordering, and return path memakai service contract T06;
list tidak memakai fake data, offset, arbitrary limit, atau client-only filter.

### T07.6 Activity detail, edit, dan conflict

1. Tambahkan `/activity/[id]` dengan safe server read dan Record unavailable state.
2. Render full source, exact date, context, optional fields, mode, dan ordered Chat history.
3. Tambahkan edit mode/form dengan expected revision, per-record draft, unsaved guard, validation,
   save feedback, dan Cancel.
4. Implement Activity conflict UI yang menunjukkan latest owned server version serta dua recovery
   action tanpa menimpa local input.
5. Uji random/foreign/deleted ID, edit success, validation, two-tab conflict, retry local changes,
   and reload server behavior.

Acceptance subtask: deep link aman; original Chat message tetap terlihat sesudah raw text edit;
conflict tidak silent-overwrite dan local draft tetap ada.

### T07.7 Browser, responsive, dan accessibility acceptance

1. Tambahkan E2E Activity khusus dengan fixture akun lokal dan cleanup `finally`. Seed Project/
   Experience melalui server-only test setup; jangan membuat production test route atau mencetak
   secret.
2. Uji create Note, Form, Chat; default date; validation; success; failed/session-expired save;
   double-submit guard; filter/back-forward; project filter; pagination; detail/unavailable; edit;
   and two-tab conflict.
3. Uji 360/1440 px dalam light/dark tanpa horizontal overflow dan screenshot state utama.
4. Uji keyboard flow, autofocus, invalid focus, disclosure, conflict focus, unsaved dialog, and
   reduced motion.
5. Jalankan Axe pada state representatif dan field-error association helper.
6. Update existing app-frame E2E dari disabled placeholder ke capture aktif tanpa menghapus
   assertions T04.

Acceptance subtask: browser membuktikan manual path tanpa AI, save-failure preservation, filter
return, missing deep link, mobile capture, keyboard, dan no serious accessibility regression.

### T07.8 Regression, verification record, dan checkpoint

1. Jalankan seluruh checks final di bawah, termasuk Activity/Storage integration, existing Auth/UI
   E2E, dan new Activity E2E.
2. Review diff memastikan tidak ada schema/worker/AI/achievement/evidence/project CRUD/delete scope.
3. Tulis hasil aktual pada `docs/verification/T07-activity-ui.md` dengan file berubah, commands,
   tests, screenshot/a11y evidence, checks tidak dijalankan, dan limitation.
4. Perbarui README bila cara menjalankan E2E baru berubah.
5. Perbarui `docs/IMPLEMENTATION_STATUS.md`. Tandai T07 `DONE` hanya bila seluruh acceptance punya
   bukti aktual; selain itu gunakan `PARTIAL`/`BLOCKED` dengan blocker konkret.
6. Catat T08 sebagai next task. Gate M2 tetap terbuka sampai T08-T12 selesai.

Acceptance subtask: sesi baru dapat melanjutkan dari checkpoint tanpa chat lama; tidak ada claim
hosted/staging/production atau AI yang belum diverifikasi.

## Perkiraan file

Daftar ini adalah batas kerja. Luna tidak wajib membuat semua file bila struktur yang lebih kecil
memenuhi acceptance tanpa menduplikasi tanggung jawab.

### File baru yang mungkin diperlukan

- `src/app/(workspace)/activity/[id]/page.tsx`
- `src/features/activity/actions.ts`
- `src/features/activity/activity-capture-form.tsx` atau refactor nama
  `quick-log-capture.tsx`
- `src/features/activity/activity-list.tsx`
- `src/features/activity/activity-detail.tsx`
- `src/features/activity/activity-editor.tsx` bila capture form tidak dapat direuse dengan jelas
- `src/features/activity/activity-context-service.ts` atau method read-only kecil pada service
  Activity yang ada
- `src/features/activity/activity-conflict-controls.tsx` bila generic conflict helper tidak cocok
- `src/domain/activity/activity-display.ts`
- `tests/unit/activity-actions.test.ts`
- `tests/unit/activity-display.test.ts`
- `tests/e2e/activity-ui.spec.ts`
- `playwright.activity.config.ts`
- `docs/verification/T07-activity-ui.md`
- `docs/decisions/0011-*.md` hanya jika ada keputusan baru material

### File yang diperkirakan berubah

- `src/app/(workspace)/activity/page.tsx`
- `src/app/(workspace)/activity/new/page.tsx`
- `src/features/activity/quick-log-capture.tsx`
- `src/features/activity/activity-filters.tsx`
- `src/features/activity/activity-service.ts` hanya untuk read context/minor query contract, bukan
  mengubah T06 persistence semantics
- `src/domain/routes/url-filters.ts`
- `src/domain/routes/safe-return.ts`
- `src/components/forms/conflict-controls.tsx` hanya bila activity dapat ditambah tanpa merusak
  profile/foundation behavior
- `src/components/ui/record-unavailable.tsx` untuk optional safe back link
- `src/i18n/messages.ts`
- `src/app/globals.css`
- `tests/unit/url-filters.test.ts`
- `tests/unit/activity-service.test.ts` bila context query masuk service yang sama
- `tests/e2e/app-frame.spec.ts`
- `package.json` untuk script E2E Activity yang benar-benar dijalankan
- `README.md`
- `docs/IMPLEMENTATION_STATUS.md`

### File yang tidak seharusnya berubah

- `supabase/migrations/*`, `supabase/seed.sql`, dan generated database types
- `supabase/tests/database/*`, kecuali ditemukan regression T06 nyata yang harus lebih dahulu
  dipisahkan sebagai remediasi; T07 sendiri tidak membutuhkan SQL baru
- `workers/*`
- Storage adapter/scanner dan bucket configuration
- Auth/Profile RPC dan schema
- Route Achievements, Projects, Timeline, dan CV selain regression locator yang benar-benar perlu
- Dokumen sumber DOCX, `docs/Design.md`, dan design mockups
- `pnpm-lock.yaml`, kecuali dependency baru benar-benar diperlukan dan dibenarkan; default tidak
  berubah

## Matriks acceptance dan bukti

| Acceptance T07 | Bukti otomatis | Pemeriksaan tambahan |
| --- | --- | --- |
| Quick log satu aksi dan input fokus | Playwright dari desktop topbar dan mobile header ke `/activity/new`, `activeElement` textarea | Keyboard-only dari dashboard dan Activity |
| Note minimal tersimpan manual | E2E isi text/date, save, detail/list; integration T06 memeriksa row exact | Tidak ada consent/AI dependency |
| Form optional details/context | E2E role/scope/outcome + owned Project/Experience; detail roundtrip | Project menentukan effective Experience |
| Chat first message dipersist sebelum proses lain | E2E Chat save/detail history; Activity integration exact sequence 1 | Tidak ada assistant message atau analyzing copy |
| Saved hanya setelah commit | Action unit + E2E pending/disabled then success toast/detail | Tidak ada optimistic fake row |
| Save gagal mempertahankan text | E2E validation/session failure memeriksa DOM + owner-scoped session draft | Reload/tab limitation dijelaskan sesuai source |
| Raw text tidak diubah UI | Action/unit whitespace + Unicode; E2E detail source | Tidak ada trim/slice sebelum submit |
| Default date timezone profile | Existing unit helper + E2E seeded timezone expected date | User-selected date authoritative |
| Filter date/project dan return terjaga | Unit URL/safe return + E2E filter, detail, Back/Cancel, reload/history | Project query berisi UUID, bukan keyword |
| Pagination 30/cursor | Existing integration 31 same-date + E2E seeded page Next/back | Order tidak diubah client |
| Deep link hilang/foreign aman | E2E random dan account-B ID mendapat copy sama | No ownership existence leak |
| Edit revision conflict actionable | Two-tab E2E: one commit, one conflict, local text retained, retry/reload | Latest server row hanya own record |
| Mobile dan keyboard capture | Playwright 360/1440, keyboard mode/disclosure/save/conflict | Touch target/focus review |
| Light/dark/reduced motion | Playwright both themes, overflow, computed reduced motion | Visual compare arah S05/S06 mockup, non-pixel-perfect |
| WCAG 2.2 AA target | Axe A/AA + error association on representative states | Manual heading, live region, focus, labels, contrast |
| Regression T01-T06 | Unit, Activity/Storage integration, Auth/UI E2E, build, worker, pgTAP, DB lint | Diff confirms no schema/domain scope creep |

## Perintah verifikasi yang harus dijalankan saat eksekusi

Baseline:

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
pnpm db:status
pnpm exec supabase migration list --local
pnpm test:e2e:auth
pnpm test:e2e:ui
git diff --check
```

Setelah implementasi:

```text
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
pnpm test:integration:activity
pnpm test:integration:storage
pnpm build
pnpm worker:check
pnpm db:test
pnpm db:lint
pnpm db:status
pnpm exec supabase migration list --local
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
git diff --check
```

Nama `test:e2e:activity` boleh disesuaikan dengan manifest final, tetapi verification record harus
menulis command aktual dan scope test yang jujur. Browser tests memakai production build, Supabase
lokal, dan Chromium. Fixture server-only dapat memakai local secret key untuk setup/cleanup, tetapi
produk dan browser tidak boleh menerima key tersebut. Seluruh user/project/activity fixture wajib
dibersihkan pada `finally`, termasuk saat assertion gagal.

`db:types`, forward migration, dan clean disposable rebuild tidak diperlukan bila T07 benar-benar
tidak mengubah SQL/public schema. Jangan menjalankannya hanya untuk menghasilkan bukti kosong.
Hosted migration, staging latency, production deployment, dan T24 performance tidak dijalankan.
Jika perubahan tak terduga membutuhkan migration, hentikan scope T07 dan dokumentasikan alasan;
jangan menyisipkan schema change tanpa review kontrak.

## Prompt eksekusi untuk Luna

```text
Implementasikan T07 Capture dan Activity UI berdasarkan
docs/verification/T07-implementation-plan.md menggunakan GPT-5.6 Luna dengan
reasoning MAX.

Baca AGENTS.md yang berlaku, docs/IMPLEMENTATION_STATUS.md,
docs/IMPLEMENTATION_PLAN.md bagian 1, 3, 4, acceptance T07 dan matriks R04,
serta sumber PRD R04, User Flow F02/shared recovery, Wireframe S05-S06,
Database Schema bagian 1-3/6, dan Design.md bagian yang dirujuk rencana.
Baca kontrak T06 pada verification dan decisions 0009-0010. Pertahankan semua
perubahan T05-T06 yang belum di-commit. Jangan memulai T08 atau task setelahnya.

Kerjakan T07.1 sampai T07.8. Hubungkan create/update/list/detail T06 ke UI S05-S06.
Quick log harus satu aksi dan autofocus. Implementasikan Note, Form, dan Chat
manual; Chat hanya menyimpan pesan pertama dan tidak menjalankan AI. Default date
berasal dari timezone profil. Project menentukan effective Experience; context
options bersifat read-only dan owner-scoped.

Gunakan stable operation key sampai create success, expected_revision untuk edit,
session draft owner/per-record, unsaved guard, safe localized errors, dan conflict
recovery yang mempertahankan input lokal. Saved hanya boleh tampil setelah commit.
List memakai filter URL date/project UUID, page size 30, cursor T06, compact rows,
dan returnTo aman yang mempertahankan filter/page. Foreign, deleted, dan random
deep link harus menghasilkan Record unavailable yang sama.

Jangan membuat migration, AI job/consent/provider, achievement/suggestion,
evidence/attachment, Project CRUD, Activity delete, dashboard/timeline, search,
atau data sample production. Jangan mengubah raw_text sebelum submit dan jangan
mencatat source/FormData/provider error.

Jalankan unit, Activity/Storage integration, build, worker check, pgTAP, DB lint,
existing Auth/UI E2E, dan E2E Activity baru pada 360/1440 light/dark dengan
keyboard, Axe, reduced motion, save failure, filter return, missing deep link,
Chat persistence, pagination, serta two-tab conflict. Catat hasil aktual pada
docs/verification/T07-activity-ui.md dan docs/IMPLEMENTATION_STATUS.md. Tandai
DONE hanya bila seluruh acceptance terbukti; bila tidak gunakan PARTIAL/BLOCKED
dengan blocker konkret. T08 menjadi next task dan Gate M2 tetap terbuka.
```

## Risiko dan mitigasi

| Risiko | Mitigasi |
| --- | --- |
| UI `.trim()`/slice mengubah source | Trim hanya untuk blank predicate; FormData mengirim original; unit whitespace/Unicode dan E2E detail exact. |
| Default date bergeser karena timezone browser/server | Hitung di server dengan helper T06 dan profile timezone; format exact date tanpa timezone OS. |
| Project dan Experience mismatch | Project option membawa authoritative experience ID; disable standalone selector saat project terpilih; database tetap guard terakhir. |
| Project filter lama tetap keyword | Ubah URL utility/test/E2E menjadi UUID-backed select dan dokumentasikan compatibility change T04 placeholder. |
| Save sukses tetapi draft belum dibersihkan sebelum redirect | Action return success ke client; clear state/rotate key lalu navigasi, bukan redirect langsung dari action. |
| Ambiguous response membuat duplicate | Pertahankan operation key setelah semua failure; retry identical; jangan rotate diam-diam. |
| Validation/conflict rerender menghilangkan input | Controlled/uncontrolled strategy konsisten + session draft; test server error dan two-tab conflict. |
| Generic conflict UI menyembunyikan source terbaru | Tambahkan Activity mapping/summary khusus dan tampilkan latest owned fields sebelum retry. |
| Detail membocorkan foreign record | Owner-scoped service; missing/foreign/random memakai state/copy identik dan safe back route. |
| Cursor hilang saat filter/detail navigation | Pisahkan cursor dari filter form; preserve pada row returnTo; reset hanya saat Apply/Clear. |
| E2E membutuhkan Project sebelum T08 | Seed hanya melalui server-only test fixture; jangan menambah production CRUD/route. |
| Mockup mendorong AI/evidence scope creep | Ambil hierarchy/density saja; omit suggestion/evidence/actions sampai T09-T14. |
| Existing app-frame E2E rusak karena placeholder berubah | Update expectation sesuai capability T07, pertahankan seluruh frame/theme/draft/history/a11y coverage. |
| T07 diam-diam mengubah database | Diff gate melarang migration/generated types; gunakan service T06 apa adanya. |

## Definition of Done

T07 dapat ditandai `DONE` hanya jika:

1. `/activity/new` menyediakan Note, Form, dan Chat manual yang menyimpan Activity melalui service
   T06; Chat membuat first user message atomik dan tidak memulai AI.
2. Source nonblank maksimal 10.000 karakter dan exact date tervalidasi; UI tidak trim/truncate
   source; default date memakai timezone profil.
3. Operation key bertahan pada retry, repeat submit disabled saat pending, dan feedback Saved hanya
   muncul setelah commit. Save gagal/session expired mempertahankan DOM input dan draft tab.
4. Optional role/scope/outcome memakai progressive disclosure. Owned Project/Experience context
   dapat dipilih tanpa Project CRUD; selected Project menentukan effective Experience.
5. `/activity` menampilkan own rows dalam order T06, page size 30, filter date/project UUID, cursor,
   loading/empty/no-match/error states, dan URL/filter/page yang dapat dipulihkan.
6. `/activity/:id` menampilkan full source, exact date, context, optional fields, dan ordered Chat
   history. Foreign/deleted/random IDs tidak dapat dibedakan dan kembali ke safe list route.
7. Edit memakai `expected_revision`; two-tab conflict tidak silent-overwrite, mempertahankan local
   input, dan menyediakan Reload server atau explicit review/retry.
8. Global desktop/mobile Quick log tetap satu aksi dengan input fokus; capture/list/detail/edit
   bekerja pada 360/1440 px, light/dark, keyboard, reduced motion, dan target WCAG 2.2 AA.
9. Tidak ada migration, dependency, AI, achievement, evidence, Project CRUD, Activity delete,
   dashboard/timeline, atau fake data di luar scope.
10. Lint, typecheck, unit, Activity/Storage integration, build, worker check, pgTAP, DB lint,
    migration ledger check, Auth/UI E2E, Activity E2E, Axe, responsive, dan diff check memiliki hasil
    aktual yang tercatat.
11. `docs/verification/T07-activity-ui.md`, README bila diperlukan, dan
    `docs/IMPLEMENTATION_STATUS.md` diperbarui; T08 dicatat sebagai langkah berikutnya dan Gate M2
    tetap terbuka.

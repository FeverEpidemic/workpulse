# Rencana Implementasi T06 Activity Persistence

Tanggal perencanaan: 17 September 2026

Status: siap dieksekusi; T06 tetap `TODO` sampai acceptance memiliki bukti aktual.

Dependensi minimum: T03 `DONE`. Baseline aktual: T01-T05 `DONE`, remediasi review T05 selesai,
dan Gate M1 sudah ditutup. T06 adalah paket pertama M2 Capture.

## Hasil yang dituju

T06 menghasilkan persistence Activity yang aman dan dapat dipakai oleh UI T07, project/context
T08, achievement T09, evidence T10, dashboard/timeline T12, serta AI T13-T14. Hasilnya mencakup
schema `activities` dan `chat_messages`, create yang idempotent, edit dengan optimistic revision,
query list/detail owner-scoped, keyset pagination 30 record, dan helper tanggal default berdasarkan
timezone profil.

Jalur manual harus lengkap pada lapisan persistence: Activity disimpan dengan analysis state
`not_requested`, `raw_text` tidak diubah atau digantikan AI, dan mode Chat menyimpan pesan pertama
bersama Activity dalam satu transaksi. T06 tidak mengaktifkan tombol Save pada S05, tidak membuat
UI Activity, tidak membuat `ai_jobs`, dan tidak memulai achievement, evidence, atau project UI.

## Acuan dan acceptance sumber

- `IMPLEMENTATION_PLAN.md` §1, §3 Ownership dan concurrency, §3 Data karier, §4 operation
  idempotency, acceptance T06, matriks R04, dan urutan M2.
- PRD R04: Quick note hanya membutuhkan teks nonblank dan tanggal Activity; structured capture
  menambah context opsional; pesan Chat asli harus tersimpan sebelum pemrosesan AI.
- PRD Content and AI behavior: simpan raw note dan structured context sebelum AI; Activity rutin
  tetap berguna tanpa achievement; AI tidak boleh mengganti `raw_text`; perubahan pengguna membuat
  revision baru.
- PRD Shared validation dan Reliability: concurrent edit menghasilkan conflict; input form tetap
  tersedia setelah save gagal; target save di staging di bawah satu detik tidak termasuk network
  dan AI, tetapi pengukuran performance tetap milik T24.
- User Flow F02: tanggal default adalah hari ini pada timezone profil; Saved baru tampil setelah
  persistence berhasil; AI unavailable tidak menghilangkan Activity; edit note menaikkan revision
  dan membuat hasil input lama stale.
- User Flow shared recovery: daftar kembali dengan filter yang sama; deep link foreign/deleted
  memakai satu state Record unavailable; unsaved browser behavior tetap milik T07.
- Database Schema §1: UUID server-side, audit timestamp UTC, exact `date` untuk Activity,
  `expected_revision`, RLS, serta composite FK ownership.
- Database Schema §2: list memakai stable tie breaker ID dan default page size 30.
- Database Schema §3: field `activities`, append-only `chat_messages`, index
  `(user_id, occurred_on DESC, id)`, context project/experience konsisten, dan revision Activity
  menjadi source revision bagi AI di task berikutnya.
- Database Schema §6: table exposed wajib RLS; direct mutation worker/server-controlled ditolak;
  authenticated server operation mengambil owner dari session.
- Wireframe S05-S06 dipakai hanya untuk kontrak data: Note/Form/Chat, exact date, optional context,
  list filter date/project, source text dan chat history. UI, focus, save feedback, delete preview,
  dan evidence controls tetap T07/T10.
- Dokumentasi resmi Supabase tentang
  [Database Functions](https://supabase.com/docs/guides/database/functions),
  [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), dan
  [securing the Data API](https://supabase.com/docs/guides/api/securing-your-api): function
  privileges harus eksplisit; `security definer` memakai fixed/empty `search_path`; grants dan RLS
  merupakan lapisan terpisah.
- Dokumentasi resmi PostgreSQL tentang
  [date and time](https://www.postgresql.org/docs/17/functions-datetime.html): instant dan local
  calendar date adalah konsep berbeda. `occurred_on` disimpan sebagai `date`; konversi timezone
  hanya dipakai untuk menghitung default hari, bukan mengubah tanggal yang dipilih pengguna.

## Kondisi workspace sebelum eksekusi

- Stack aktual adalah Next.js 16.3.5, React 19.3.0, Supabase JS 2.116.0, Supabase CLI 2.117.0,
  Zod 4.6.5, TypeScript 6.0.3, dan Node 24. Dependency baru tidak diperkirakan diperlukan.
- `public` baru memiliki profile dan foundation records; `activities`, `chat_messages`,
  achievements, dan `ai_jobs` belum ada.
- `internal.operation_requests` sudah menyimpan key, operation kind, input revision, SHA-256
  payload hash, result type/ID, immutable result payload, dan completion time. Constraint saat ini
  hanya mengizinkan empat foundation create operation; T06 harus memperluasnya forward-only tanpa
  merusak replay T03.
- Mutasi foundation memakai typed public RPC yang mengambil owner dari `auth.uid()`, sementara
  direct authenticated INSERT/UPDATE/DELETE sudah dicabut. T06 mengikuti boundary yang sama.
- `profiles.timezone` sudah tervalidasi terhadap IANA catalog. `src/domain/dates/partial-date.ts`
  hanya menangani partial career dates; exact Activity date memerlukan helper terpisah.
- Route `/activity` dan `/activity/new` dari T04 masih placeholder. Quick log menyimpan draft
  owner-scoped di `sessionStorage`, tetapi tombol Save belum aktif. File UI tersebut tidak perlu
  berubah pada T06.
- Integration test lokal sudah memiliki pola dua akun dengan authenticated Supabase clients dan
  cleanup melalui admin client. T06 dapat memakai pola yang sama tanpa credential baru.
- Worktree berisi perubahan review T05 yang belum menjadi baseline bersih. Eksekutor wajib
  mempertahankannya, mencatat `git status --short`, dan tidak mereset atau menimpa file tersebut.

## Batas scope

### Termasuk dalam T06

- Migration versioned untuk `public.activities` dan `public.chat_messages`.
- Composite ownership FK, checks, indexes, triggers/functions yang diperlukan untuk invariant
  Activity, RLS, grants, dan function privileges.
- Create Activity idempotent dan atomic, termasuk first Chat message untuk mode `chat`.
- Update Activity revision-checked untuk field input pengguna.
- Server-side validation dan safe error mapping untuk create/update/list/detail.
- List owner-scoped dengan filter tanggal/project yang siap dipakai T07, page size 30, dan keyset
  cursor stabil `(occurred_on, id)`.
- Detail owner-scoped yang mengembalikan Activity beserta Chat history berurutan.
- Helper exact ISO date dari instant dan IANA timezone profil, serta test batas pergantian hari.
- Compatibility update minimum pada lifecycle project/experience bila diperlukan agar FK/context
  Activity tidak dapat rusak oleh RPC foundation yang sudah tersedia.
- pgTAP, unit, dan integration test dua akun dengan database lokal nyata.

### Tidak termasuk

- Perubahan halaman `/activity`, `/activity/new`, component capture, copy en/id, filter URL UI,
  autofocus, save feedback, unsaved dialog, atau E2E S05-S06. Semua itu T07.
- Delete Activity API/UI. Lifecycle delete lintas achievement, AI job, evidence, dan CV baru dapat
  diselesaikan setelah tabel dependennya ada; T06 hanya menyiapkan FK chat `ON DELETE CASCADE`.
- Project CRUD UI, attach existing Activity, context relink UI, atau dependency preview T08.
- Achievement schema/detection, `ai_jobs`, consent, queue, analysis transition, follow-up chat, atau
  provider call T09/T13/T14.
- Evidence rows/upload/screening T10-T11, dashboard/timeline T12, import, CV, dan PDF.
- Search, offset pagination, aggregate counts, analytics event, realtime subscription, atau data
  contoh production.

## Keputusan teknis T06

### 1 Schema Activity dan Chat

`public.activities` memakai kontrak berikut:

| Field | Kontrak T06 |
| --- | --- |
| `id` | UUID server-generated primary key. |
| `user_id` | Owner profile; tidak pernah diterima sebagai input authorization dari client. |
| `raw_text` | Disimpan byte-for-byte sesuai string yang diterima; `btrim(raw_text)` wajib nonblank; maksimal 10.000 karakter PostgreSQL. |
| `occurred_on` | Exact PostgreSQL `date`, wajib; tidak disimpan sebagai timestamp. |
| `capture_mode` | `note`, `form`, atau `chat`; immutable setelah create. |
| `role` | Nullable; canonical NULL atau trimmed nonblank, maksimal 200 karakter. |
| `scope`, `outcome` | Nullable; canonical NULL atau trimmed nonblank, masing-masing maksimal 5.000 karakter. |
| `experience_id`, `project_id` | Optional composite owned references. Project menentukan effective experience context. |
| `analysis_state` | `not_requested`, `queued`, `running`, `done`, atau `failed`; create T06 selalu `not_requested`. |
| `revision` | Mulai 1; naik tepat satu pada setiap perubahan input/context pengguna. |
| `created_at`, `updated_at` | `timestamptz` UTC; audit timestamp tidak dipakai sebagai Activity date. |

Limit `role` mengikuti role title foundation; `scope` dan `outcome` mengikuti batas descriptive
text foundation. Karena dokumen sumber hanya menetapkan limit `raw_text`, angka optional-field ini
harus dicatat sebagai technical safety decision pada decision log, divalidasi sama di Zod dan SQL,
dan tidak boleh diam-diam memotong input.

`public.chat_messages` memakai UUID, owner, composite Activity FK, role `user|assistant`, content
nonblank maksimal 10.000 karakter, `sequence_no` positif, audit fields, dan unique
`(user_id, activity_id, sequence_no)`. Row bersifat append-only. T06 hanya membuat sequence 1
ber-role `user` saat `capture_mode = chat`; tidak ada assistant message atau follow-up API.

### 2 Raw text dan exact date

- Validasi blank memakai `trim`/`btrim` hanya sebagai predicate. Nilai yang tersimpan dan di-hash
  tetap string asli; leading whitespace, line breaks, dan wording tidak dinormalisasi diam-diam.
- Batas 10.000 memakai jumlah karakter, bukan byte. 10.000 karakter Unicode diterima; 10.001
  ditolak oleh Zod dan SQL.
- Service create/update mewajibkan `occurredOn` berformat calendar date ISO `YYYY-MM-DD` yang valid.
  Nilai tersebut disimpan langsung; tidak dibentuk melalui `new Date("YYYY-MM-DD")` dan tidak
  digeser oleh timezone runtime.
- Helper `activityDateInTimeZone(instant, profileTimezone)` menghasilkan default S05. Test memakai
  satu instant yang jatuh pada tanggal berbeda di dua timezone IANA. Helper tidak membaca timezone
  OS dan tidak mengambil timezone dari payload bebas; input produksi berasal dari profil yang sudah
  tervalidasi.
- T07 harus menampilkan default ini di field tanggal. Jika pengguna mengubah tanggal, tanggal
  eksplisit tersebut menjadi authoritative.

### 3 Ownership, grants, dan RLS

- `activities` dan `chat_messages` berada di exposed `public` schema sehingga RLS wajib aktif.
- Owner SELECT policy memakai `(select auth.uid()) = user_id`. Policies INSERT/UPDATE/DELETE dapat
  tetap didefinisikan sebagai defense-in-depth, tetapi grants mutasi langsung untuk
  `authenticated` dicabut. `anon` tidak memiliki table/function access.
- Authenticated user memperoleh SELECT own rows dan EXECUTE hanya pada RPC T06 yang diperlukan.
  Create/update berjalan melalui typed wrapper; internal helper/ledger tidak dapat dipanggil.
- RPC tidak menerima `user_id`. Ia mengambil actor dari `auth.uid()`, memastikan profile ada dan
  `deleting_at IS NULL`, memakai schema-qualified relations, fixed `search_path`, dan mengembalikan
  error aman untuk foreign/missing record yang tidak dapat dibedakan.
- Chat INSERT tidak dibuka langsung. First message dibuat di transaksi create Activity agar tidak
  ada Activity chat tanpa pesan pertama atau pesan yatim.

### 4 Create idempotency tanpa menggandakan note text

- Extend constraint `internal.operation_requests.operation_kind` dengan `activity.create` dan
  `result_table` dengan `activities`; create tetap memakai `input_revision = 0`.
- Operation key adalah UUID client-generated, scoped oleh `(user_id, operation_kind, key)`, dan
  bertahan melewati validation/auth/ambiguous response sampai server melaporkan success. Rotasi
  browser key menjadi pekerjaan T07; database contract diselesaikan sekarang.
- Payload hash dibentuk dari canonical create payload lengkap, termasuk exact `raw_text`, tetapi
  ledger hanya menyimpan SHA-256. `result_payload` Activity adalah receipt minimal yang stabil,
  misalnya `id`, `user_id`, `revision`, `occurred_on`, dan `capture_mode`; ia tidak menyimpan
  `raw_text`, role, scope, atau outcome untuk menghindari salinan note privat.
- Request identik dengan key sama mengembalikan receipt yang sama dan tidak membuat Activity atau
  Chat message kedua. Key sama dengan payload berbeda menghasilkan `IDEMPOTENCY_KEY_REUSED`.
- Insert ledger, Activity, optional first Chat message, dan completion receipt berada dalam satu
  transaksi. Kegagalan apa pun meninggalkan nol row parsial.

### 5 Revision dan analysis state

- `revision` Activity adalah input/source revision untuk stale-result checks T13-T14. Create = 1;
  update user terhadap `raw_text`, date, optional structured fields, atau context menaikkan tepat
  satu setelah `expected_revision` cocok.
- Update RPC menerima patch allowlist tetapi service T06 mengirim canonical editable state. Owner,
  ID, audit fields, revision, capture mode, dan analysis state tidak dapat diubah melalui patch.
- Dua update dari revision sama harus menghasilkan satu commit dan satu `STALE_REVISION`. Conflict
  result dapat memuat latest owned record bagi T07 tanpa kehilangan local input di caller.
- T06 tidak memasang generic trigger yang menaikkan revision untuk setiap perubahan operational.
  T13 harus mengubah `analysis_state` melalui server-only operation yang tidak menaikkan source
  revision. Sebaliknya, user Chat answer di T14 harus append message dan menaikkan Activity revision
  atomik karena ia mengubah input AI.
- Edit `raw_text` pada Activity mode Chat tidak menulis ulang atau menghapus first Chat message.
  History tetap menyimpan pesan yang benar-benar dikirim; Activity menyimpan source text terbaru.

### 6 Context integrity dan boundary T08

- Composite FK memastikan experience/project berasal dari owner yang sama.
- Bila `project_id` terisi, effective `experience_id` wajib sama persis dengan experience project,
  termasuk pasangan NULL. RPC mengunci/read project yang dimiliki user dan menolak mismatch.
- Bila project tidak dipilih, optional experience harus merupakan owned experience.
- Activity context update memakai revision guard yang sama dengan edit note.
- Setelah table Activity ada, RPC project/experience lama tidak boleh dapat meninggalkan context
  yang tidak konsisten. Migration T06 boleh menambahkan compatibility hook minimum: perubahan
  `projects.experience_id` mempropagasi effective experience ke linked Activity dalam transaksi dan
  menaikkan revision Activity; delete project melepas `project_id` sambil mempertahankan
  `experience_id`; delete experience membersihkan context Activity tanpa menghapus Activity.
- Compatibility hook ini bukan penyelesaian T08. Project UI, attach existing Activity, explicit
  relink service, dependency preview, dan propagation ke derived achievement tetap deferred.

### 7 List, detail, dan pagination

- List order canonical adalah `occurred_on DESC, id DESC`; index utama sama urutannya dengan owner
  di depan. Index tambahan `(user_id, project_id, occurred_on DESC, id DESC)` dibuat bila query
  plan filter project membutuhkannya.
- Page size externally fixed 30. Query mengambil paling banyak 31 row, mengembalikan 30, dan
  membentuk `nextCursor` hanya bila row ke-31 ada. Tidak ada client-controlled arbitrary limit.
- Cursor versioned dan opaque bagi UI, tetapi bukan secret. Payload minimal berisi `occurredOn` dan
  `id`; decoder memvalidasi versi, exact date, UUID, ukuran, dan trailing/unknown fields sebelum
  nilai dipakai pada query.
- Cursor predicate menggunakan tuple yang sama dengan order: row berikutnya memenuhi
  `(occurred_on, id) < (cursor.occurred_on, cursor.id)`. Test dengan lebih dari 30 row pada tanggal
  sama membuktikan tidak ada duplicate atau skip.
- Filter persistence layer yang disiapkan sekarang: inclusive `from`, inclusive `to`, dan owned
  `projectId`. `from > to`, malformed date, cursor, atau UUID ditolak sebelum database call.
- Detail mengambil tepat satu owned Activity dan Chat messages order `sequence_no ASC`. Foreign,
  deleted, dan random UUID menghasilkan hasil unavailable yang sama. Evidence dan derived
  achievement tidak di-join sebelum task pemiliknya.

### 8 Service dan error contract

- Factory service menerima authenticated session context/client; method tidak memiliki parameter
  owner. Caller tanpa user/profile lengkap mendapat `UNAUTHENTICATED` atau `UNAVAILABLE` yang aman.
- Domain error codes minimum: `VALIDATION`, `UNAUTHENTICATED`, `NOT_FOUND`, `CONFLICT`,
  `IDEMPOTENCY_KEY_REUSED`, dan `UNAVAILABLE`. Raw SQL/provider message tidak diteruskan.
- Validation error dapat menunjuk `raw_text`, `occurred_on`, `role`, `scope`, `outcome`,
  `experience_id`, atau `project_id`; localized UI mapping diselesaikan T07.
- Tidak ada note text, Chat content, filter text, atau operation payload dalam log. Correlation ID
  boleh dibuat di action boundary T07, bukan disimpan bersama raw note.
- Query/service dipisahkan dari React component agar integration test dapat menguji kontrak dengan
  authenticated clients dan T07 hanya menambahkan action/UI adapter.

## Paket kerja eksekusi

### T06.1 Baseline, source trace, dan decision record

1. Catat `git status --short` dan pastikan perubahan review T05 dipertahankan.
2. Jalankan baseline install, lint, typecheck, unit, build, worker check, Activity-independent
   Storage integration, pgTAP, DB lint, migration list, dan DB status.
3. Pastikan Supabase lokal tidak linked ke hosted project dan database aktif tidak akan di-reset.
4. Buat `docs/decisions/0009-activity-persistence.md` yang mengunci raw-text preservation, exact
   date/timezone boundary, Activity revision semantics, minimal idempotency receipt, append-only
   Chat, owner-only mutation, dan keyset pagination.

Acceptance subtask: baseline aktual tercatat; kegagalan lama dipisahkan dari perubahan T06; tidak
ada cleanup/reset terhadap pekerjaan pengguna atau database lokal aktif.

### T06.2 Domain contracts dan validation

1. Tambahkan shared field limits/types untuk Activity dan Chat.
2. Buat Zod schema create/update/filter/cursor yang mempertahankan `raw_text` asli, mengubah blank
   optional structured fields menjadi NULL, dan menolak unknown fields.
3. Implement exact-date parser yang menolak overflow seperti `2026-02-30` tanpa UTC conversion.
4. Implement timezone default helper dengan injected instant agar deterministic.
5. Implement cursor codec versioned dan validation.
6. Tambahkan unit tests untuk blank text, Unicode 10.000/10.001, whitespace preservation, invalid
   dates, timezone boundary, filter range, cursor tampering, dan pagination helper.

Acceptance subtask: contract TypeScript tidak dapat mengubah note diam-diam; date helper mengikuti
profile timezone; invalid input berhenti sebelum query/RPC.

### T06.3 Migration schema, ownership, dan context

1. Buat `activities` dan `chat_messages` dengan constraints, composite keys/FKs, indexes, comments,
   RLS, policies, dan least-privilege grants.
2. Tambahkan context validator serta compatibility patch project/experience minimum yang diperlukan
   untuk menjaga invariant setelah Activity tersedia.
3. Perluas constraint ledger secara forward-only setelah preflight existing rows; jangan recreate
   atau menghapus replay T03.
4. Buat internal create helper dan typed public wrapper. Simpan minimal receipt tanpa note text.
5. Buat revision-checked update RPC dengan exact allowlist dan safe condition codes.
6. Revoke default/public execute dan grant hanya wrapper yang diperlukan ke `authenticated`.

Acceptance subtask: schema menolak cross-owner context, malformed fields, direct client mutation,
dan partial chat create; existing foundation replay tetap valid.

### T06.4 Create dan update service

1. Buat Activity service dengan authenticated context dan tanpa owner payload.
2. Implement create mapping ke idempotent RPC dan update mapping ke revision RPC.
3. Map Postgres/Supabase errors ke stable safe codes; ambil latest record hanya untuk owned stale
   conflict.
4. Pastikan create mode Chat menghasilkan first message sequence 1 yang sama persis dengan
   `raw_text`; Note/Form tidak membuat Chat row.
5. Pastikan create/update tidak enqueue job atau mengubah state menjadi seolah-olah dianalisis.

Acceptance subtask: manual create bekerja tanpa AI; ambiguous retry aman; stale update tidak
menimpa perubahan lain; foreign/missing tidak bocor.

### T06.5 List dan detail query service

1. Implement list projection minimum dengan filters dan canonical two-column order.
2. Fetch 31, trim 30, dan emit next cursor dari row terakhir yang benar.
3. Implement detail own record dan Chat history ascending.
4. Pastikan list tidak memuat seluruh Chat history dan tidak menghitung achievement/evidence yang
   belum ada.
5. Tambahkan unit tests untuk cursor boundary dan integration tests untuk actual ordered pages.

Acceptance subtask: lebih dari 30 Activity pada tanggal sama dapat dipaginasi tanpa duplicate/skip;
akun kedua tidak dapat melihat list/detail akun pertama.

### T06.6 Database dan integration acceptance

1. Tambahkan pgTAP khusus Activity untuk structure, checks, FK ownership, privileges, RLS, ledger,
   create replay, Chat atomicity, revision race, context consistency, dan lifecycle compatibility.
2. Tambahkan integration test dua authenticated account yang memakai RPC/service nyata.
3. Uji identical sequential dan concurrent retry, reused key different payload, 10.001 character,
   exact date roundtrip, cross-owner IDs, concurrent edit, page 30+1, filter date/project, safe
   detail, dan direct table mutation rejection.
4. Periksa ledger receipt tidak mengandung `raw_text`, role, scope, outcome, atau Chat content.
5. Cleanup fixture melalui account deletion pada `afterAll`/`finally` dan fail test bila cleanup
   penting gagal.

Acceptance subtask: acceptance T06 dibuktikan pada PostgreSQL/Supabase lokal nyata, bukan hanya
fake service atau unit test.

### T06.7 Forward migration, clean rebuild, dan dokumentasi

1. Terapkan migration forward-only pada stack WorkPulse lokal aktif; jangan menjalankan
   `db:reset` terhadap stack itu.
2. Regenerate `database.types.ts` dari schema lokal dan review bahwa public Activity/RPC contract
   sesuai migration. Schema `internal` tetap tidak diekspos.
3. Jalankan clean migration/seed/test pada project Supabase disposable yang path dan project ID-nya
   telah diverifikasi. Hapus hanya resource disposable setelah hasil dicatat.
4. Jalankan lint, typecheck, unit, Activity integration, Storage regression, pgTAP, DB lint,
   production build, worker check, dan `git diff --check`.
5. Tulis bukti aktual pada `docs/verification/T06-activity-persistence.md`, perbarui README setup/
   status bila perlu, lalu perbarui `docs/IMPLEMENTATION_STATUS.md`.
6. Tandai T06 `DONE` hanya jika seluruh matriks acceptance terbukti. T07 menjadi next task; Gate M2
   tetap terbuka sampai T06-T12 selesai.

Acceptance subtask: active DB dan clean rebuild sama-sama lulus; status tidak mengklaim UI Capture,
AI, delete Activity lintas domain, hosted migration, staging performance, atau Gate M2 selesai.

## Perkiraan file

Daftar ini adalah batas kerja, bukan kewajiban membuat semua file bila implementasi lebih kecil.

### File baru yang mungkin diperlukan

- `src/domain/activity/contracts.ts`
- `src/domain/activity/activity-date.ts`
- `src/domain/activity/activity-cursor.ts`
- `src/features/activity/schemas.ts`
- `src/features/activity/activity-service.ts`
- `src/features/activity/activity-queries.ts` bila pemisahan read/write membuat service lebih jelas
- `supabase/migrations/20260917xxxxxx_t06_activity_persistence.sql`
- `supabase/tests/database/activity.test.sql`
- `tests/unit/activity-validation.test.ts`
- `tests/unit/activity-date.test.ts`
- `tests/unit/activity-cursor.test.ts`
- `tests/integration/activity-persistence.test.ts`
- `docs/decisions/0009-activity-persistence.md`
- `docs/verification/T06-activity-persistence.md`

### File yang diperkirakan berubah

- `src/server/supabase/database.types.ts` melalui generator setelah migration diterapkan
- `package.json` hanya bila perlu menambah script Activity integration yang benar-benar dijalankan
- `vitest.integration.config.ts` hanya bila test path/env perlu dipisah tanpa merusak Storage test
- `supabase/tests/database/foundation.test.sql` hanya untuk regression assertion lifecycle project/
  experience yang tidak tepat bila diletakkan di Activity suite
- `README.md`
- `docs/IMPLEMENTATION_STATUS.md`

### File yang tidak seharusnya berubah

- `src/app/(workspace)/activity/page.tsx`
- `src/app/(workspace)/activity/new/page.tsx`
- `src/features/activity/quick-log-capture.tsx`
- `src/features/activity/activity-filters.tsx`
- `src/i18n/messages.ts` kecuali eksekutor menemukan server error mapping yang benar-benar perlu
  dikompilasi sekarang; default-nya copy/UI menunggu T07
- `workers/`, Storage adapter/scanner T05, bucket config, dan `internal.storage_jobs`
- Schema achievement, evidence, AI jobs, import, CV, atau export
- Dokumen sumber PRD, User Flow, Wireframe, Database Schema, dan `Design.md`

## Matriks acceptance dan bukti

| Acceptance T06 | Bukti otomatis | Pemeriksaan tambahan |
| --- | --- | --- |
| Retry save tidak menduplikasi | pgTAP + integration sequential/concurrent same key menghasilkan satu Activity, satu ledger receipt, dan satu first Chat message | Review receipt tetap identik setelah Activity diedit dan tidak berisi note text |
| Key sama payload berbeda ditolak | pgTAP/integration `IDEMPOTENCY_KEY_REUSED` dan row count tidak bertambah | Pastikan error tidak memuat payload |
| `raw_text` tersimpan tanpa AI | Integration membandingkan string exact termasuk whitespace/Unicode; state `not_requested`; tidak ada job | Review diff tidak menambah `ai_jobs`/provider call |
| Blank dan 10.001 ditolak | Unit Zod serta RPC/SQL constraint test; 10.000 Unicode diterima | Tidak ada silent trim/truncate |
| Exact date timezone benar | Unit fixed-instant pada dua IANA timezone dan invalid date; integration exact date roundtrip | Stored date tidak berubah saat process timezone berbeda |
| Dua edit bersamaan conflict | Integration dua clients/requests dengan expected revision sama: satu success, satu stale; final revision naik satu | Latest owned record tersedia untuk rekonsiliasi T07 |
| Ownership list/detail aman | RLS/pgTAP dan integration dua akun untuk SELECT, foreign detail, project/experience FK | Foreign dan missing memberikan bentuk unavailable sama |
| Direct mutation ditolak | pgTAP dan authenticated client INSERT/UPDATE/DELETE gagal; wrapper tetap berhasil | Function grants/public execute direview |
| Chat first message atomic | pgTAP/integration Chat create menghasilkan sequence 1 exact; Note/Form nol message; rollback test nol row parsial | Chat tetap append-only dan belum ada assistant/follow-up |
| Context konsisten | pgTAP mismatched/cross-owner project-experience ditolak; compatible context diterima | Compatibility hook tidak diklaim sebagai T08 lengkap |
| Pagination 30 stabil | Integration 31+ rows dengan same date, dua page tanpa duplicate/skip, canonical ordering | Cursor malformed/tampered ditolak sebelum query |
| Regression T01-T05 aman | Full unit, Storage integration, pgTAP, DB lint, build, worker check, forward migration, clean rebuild | Review tidak mengubah UI/auth/storage behavior |

## Perintah verifikasi yang harus dijalankan saat eksekusi

Baseline:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
pnpm test:integration:storage
pnpm build
pnpm worker:check
pnpm db:test
pnpm db:lint
pnpm db:status
pnpm exec supabase migration list --local
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
pnpm exec supabase migration up
pnpm db:types
pnpm db:test
pnpm db:lint
pnpm db:status
pnpm exec supabase migration list --local
git diff --check
```

Nama script Activity integration boleh disesuaikan dengan manifest final, tetapi verification harus
menulis command aktual. Jangan mengubah `test:integration:storage` sehingga diam-diam menjalankan
scope lain tanpa nama yang jujur; sediakan generic `test:integration` atau path eksplisit bila
kedua suite perlu dijalankan bersama.

Activity integration memerlukan Supabase lokal, dua akun fixture, publishable key, dan secret key
server-only hanya untuk setup/cleanup user. Test domain harus memakai authenticated clients. Clean
rebuild dilakukan pada project disposable, bukan melalui `pnpm db:reset` pada project WorkPulse
aktif. Bila sandbox memblokir Docker named pipe atau telemetry path, ulangi command yang sama dengan
izin lokal yang diperlukan; jangan mengganti target atau mengurangi assertion.

Browser E2E S05-S06 belum wajib pada T06 karena UI tidak berubah. Jika compatibility hook menyentuh
RPC yang dipakai Auth/Profile, jalankan `pnpm test:e2e:auth`; jika tidak, catat alasan tidak
menjalankannya. Hosted migration, staging latency, dan production deployment tidak dijalankan tanpa
environment serta otorisasi pengguna.

## Prompt eksekusi

```text
Eksekusi T06 Activity persistence berdasarkan
docs/verification/T06-implementation-plan.md.

Baca AGENTS.md yang berlaku, docs/IMPLEMENTATION_STATUS.md,
docs/IMPLEMENTATION_PLAN.md bagian 1, 3, 4, acceptance T06 dan matriks R04,
serta sumber PRD R04, User Flow F02, Database Schema bagian 1/2/3/6, dan
Wireframe S05-S06. Pertahankan seluruh perubahan review T05 yang sudah ada.
Jangan memulai UI T07 atau fitur T08 ke atas.

Kerjakan T06.1 sampai T06.7. Simpan raw_text persis, validasi blank tanpa
memodifikasi nilai, gunakan exact date dan timezone profil hanya untuk default,
buat create idempotent dengan receipt ledger minimal tanpa note text, dan gunakan
expected_revision untuk edit. Mode Chat harus menyimpan first user message atomik.
List harus owner-scoped, page size 30, dan memakai keyset occurred_on/id.

Jangan menerima user_id dari payload, jangan membuka direct client mutation,
jangan membuat ai_jobs atau mengubah analysis_state dari not_requested, dan jangan
mengaktifkan UI save. Terapkan migration forward-only pada database lokal aktif,
regenerate public types, lalu lakukan clean rebuild hanya pada project disposable.

Jalankan unit, Activity integration dua akun, Storage regression, pgTAP, DB lint,
build, worker check, migration checks, dan git diff --check. Tulis hasil aktual ke
docs/verification/T06-activity-persistence.md dan docs/IMPLEMENTATION_STATUS.md.
Tandai DONE hanya bila seluruh acceptance terbukti; jika tidak gunakan
PARTIAL/BLOCKED dengan blocker konkret. T07 menjadi next task dan Gate M2 tetap
terbuka.
```

## Risiko dan mitigasi

| Risiko | Mitigasi |
| --- | --- |
| `raw_text` berubah karena `.trim()` | Gunakan trim hanya untuk predicate blank; hash dan insert memakai original string; test whitespace exact. |
| Tanggal bergeser satu hari | Simpan `date` ISO langsung; helper timezone memakai format parts, bukan parse `YYYY-MM-DD` menjadi UTC Date; test dateline. |
| Retry membuat duplikat | Ledger + domain row + Chat seed satu transaksi; unique scoped key; test concurrent identical requests. |
| Ledger menggandakan note privat | Simpan hash dan minimal receipt saja; pgTAP memastikan result payload tidak punya content fields. |
| Worker state kelak membuat hasil sendiri stale | Revision hanya naik untuk user input/context; operational analysis state memakai path terpisah pada T13. |
| Client mengubah owner atau lifecycle | Tidak ada owner parameter; direct mutation grants dicabut; exact function grants dan RLS diuji. |
| Project/experience mutation merusak context | Composite FK + validator + compatibility hook minimum; regression pada RPC lama. |
| Cursor melewatkan row dengan tanggal sama | Order dan predicate memakai tuple identik; fixture 31+ same-date memverifikasi dua halaman. |
| Function `security definer` melewati RLS terlalu luas | Fixed search path, schema-qualified relation, auth/profile/deleting guard, exact grants, dan review body function. |
| T06 melebar ke UI/AI/delete lintas domain | Jangan ubah route/component, jangan buat job/provider/achievement/evidence, dan catat deferred lifecycle eksplisit. |
| Migration mengganggu database aktif | Forward-only active migration; preflight ledger; clean reset hanya pada disposable project yang targetnya diverifikasi. |

## Definition of Done

T06 dapat ditandai `DONE` hanya jika:

1. `activities` dan `chat_messages` memiliki schema, constraints, indexes, composite ownership FK,
   RLS, grants, dan function privileges yang sesuai sumber.
2. Authenticated create menghasilkan revision 1, state `not_requested`, exact Activity date, dan
   `raw_text` yang sama persis; mode Chat menambah first user message dalam transaksi yang sama.
3. Input blank atau 10.001 karakter ditolak di server dan database tanpa trim/truncate; 10.000 Unicode
   diterima.
4. Create replay sequential dan concurrent menghasilkan satu domain row; reused key dengan payload
   berbeda ditolak; receipt ledger tidak menyimpan note/context content.
5. Edit memakai `expected_revision`; satu dari dua concurrent edit menang dan yang lain mendapat
   actionable conflict tanpa overwrite.
6. Context owner dan project/experience consistency tidak dapat dilanggar melalui RPC atau direct
   client call, termasuk compatibility dengan foundation lifecycle yang sudah ada.
7. List/detail hanya mengembalikan own records; page size 30 dan cursor `(occurred_on, id)` terbukti
   tidak duplicate/skip; foreign/missing detail tidak dapat dibedakan.
8. Manual persistence lulus tanpa `ai_jobs`, provider call, achievement, evidence, atau perubahan
   UI; analysis state tidak menyatakan proses yang tidak ada.
9. Migration forward-only, regenerated public types, pgTAP, DB lint, unit, Activity integration dua
   akun, Storage regression, build, worker check, clean disposable rebuild, dan diff check memiliki
   hasil aktual yang tercatat.
10. `docs/verification/T06-activity-persistence.md` dan `docs/IMPLEMENTATION_STATUS.md` diperbarui;
    T07 dicatat sebagai langkah berikutnya dan Gate M2 tetap terbuka.

# Rencana Remediasi Review T06 Activity Service Contract

Tanggal: 17 September 2026.

Status: selesai dieksekusi pada 17 September 2026. Seluruh Definition of Done memiliki bukti aktual;
T06 kembali `DONE`, T07 menjadi task berikutnya, dan Gate M2 tetap terbuka.

## Tujuan

Menutup tiga temuan review pada boundary service Activity tanpa memperluas scope ke UI T07,
project CRUD T08, achievement, evidence, AI, atau deletion Activity. Setelah remediasi:

- session hilang atau token tidak valid menghasilkan `UNAUTHENTICATED`, bukan dependency failure;
- replay create dengan operation key yang sama mengembalikan receipt create immutable yang sama,
  walaupun row Activity sudah berubah karena edit atau propagation context;
- semua error Activity membawa code, localized message key, optional field errors, dan correlation ID;
- persistence database, RLS, raw text, Chat atomicity, revision conflict, context lifecycle, dan
  pagination T06 tetap tidak berubah.

Remediasi direkomendasikan hanya pada TypeScript service contract dan tests. RPC
`public.create_activity_idempotent` serta ledger `internal.operation_requests` sudah menyimpan
receipt minimal immutable; jangan membuat migration baru kecuali reproduksi membuktikan kontrak
database tersebut tidak cukup.

## Temuan yang diperbaiki

### P2 Session hilang salah diklasifikasikan

`createActivityService.requireActorId()` memeriksa `error` dari `auth.getUser()` sebelum
`data.user`. Supabase JS 2.116.0 mengembalikan `AuthSessionMissingError` bersama user `null` ketika
tidak ada session. Implementasi saat ini mengubah kondisi itu menjadi `UNAVAILABLE`; jalur
`UNAUTHENTICATED` berikutnya praktis tidak dipakai untuk kasus normal signed-out/expired session.

Dampaknya adalah caller tidak dapat membedakan kebutuhan sign-in dari gangguan dependency. Pada
T07 hal ini akan menghalangi recovery yang harus mempertahankan draft lalu meminta pengguna masuk.

### P2 Replay create membaca row mutable

RPC create mengembalikan receipt ledger yang stabil, tetapi `createActivity()` hanya mengambil ID
dari receipt lalu membaca ulang `public.activities`. Edit Activity atau propagation experience
melalui Project dapat menaikkan revision dan mengubah row sebelum replay. Request create identik
kemudian mengembalikan state live baru, bukan hasil create awal. Test integration saat ini hanya
membandingkan ID replay sehingga perubahan payload/revision tidak terdeteksi.

### P3 Error Activity tidak mengikuti kontrak bersama

`ActivityServiceError` memakai pesan Inggris hardcoded dan tidak memiliki `messageKey` maupun
`correlationId`. Ini menyimpang dari `docs/IMPLEMENTATION_PLAN.md` §3 serta pola
`src/server/action-result.ts` dan `PrivateStorageError`. T07 seharusnya dapat memetakan error secara
lokal dan menampilkan reference ID tanpa menyalin ulang klasifikasi di setiap action.

## Acuan wajib

- `AGENTS.md` dan `docs/AGENTS.md`.
- `docs/IMPLEMENTATION_STATUS.md`, terutama checkpoint T06 dan status Gate M2.
- `docs/IMPLEMENTATION_PLAN.md` §1, §3 Ownership dan concurrency, §3 Data karier, §4 operation
  idempotency, acceptance T06, dan matriks R04.
- `docs/verification/T06-implementation-plan.md`, khususnya create receipt, safe errors,
  idempotent replay, dan Definition of Done.
- `docs/verification/T06-activity-persistence.md` dan
  `docs/decisions/0009-activity-persistence.md`.
- PRD R04 dan Content/AI behavior; User Flow F02 dan shared recovery; Wireframe S05/S06; Database
  Schema §§1–3/6.
- Implementasi aktual `src/features/activity/activity-service.ts`, Activity contracts/schemas,
  `src/server/action-result.ts`, `src/server/storage/private-storage-service.ts`, serta unit dan
  integration tests T06.

## Batas perubahan

### Termasuk

- Klasifikasi hasil `auth.getUser()` untuk missing/invalid session versus dependency unavailable.
- Error contract Activity dengan safe code, localized `MessageKey`, optional field errors,
  correlation ID UUID, dan latest owned record hanya untuk conflict.
- Create API yang mengembalikan immutable receipt dari RPC tanpa mengubahnya menjadi row live.
- Explicit read setelah create bila test atau caller memerlukan Activity lengkap.
- Regression tests unit dan integration untuk tiga temuan.
- Pembaruan decision, verification record, dan implementation status berdasarkan hasil aktual.
- Regression T01–T06 yang proporsional, termasuk Storage dan pgTAP.

### Tidak termasuk

- UI Capture/list/detail, Server Action form T07, toast/save feedback, route baru, atau browser E2E
  S05/S06.
- Mengubah isi `raw_text`, batas karakter, exact date, capture mode, analysis state, revision,
  context, RLS, grants, pagination, atau Chat append-only behavior.
- Activity delete, achievement, evidence, AI job/consent, Project CRUD/relink UI, dashboard,
  timeline, CV, atau worker handler.
- Menyimpan raw note, role, scope, outcome, Chat content, filename, atau secret dalam error,
  correlation metadata, log, atau operation receipt.
- Mengedit migration T06 yang sudah diterapkan. Bila perubahan SQL benar-benar diperlukan, gunakan
  migration forward-only baru dan jelaskan alasannya sebelum implementasi.
- Hosted migration, staging performance, atau deployment production.

## Keputusan teknis yang direncanakan

### 1 Klasifikasi auth yang eksplisit

Gunakan type guard resmi yang diekspor Supabase JS/Auth JS; jangan memeriksa substring pesan error.
Contract minimum:

- `AuthSessionMissingError` menjadi `UNAUTHENTICATED`.
- Auth API error yang secara eksplisit menyatakan token/session tidak valid atau HTTP 401/403
  menjadi `UNAUTHENTICATED`.
- `AuthRetryableFetchError`, network/transport failure, dan error provider lain menjadi
  `UNAVAILABLE`.
- User valid tanpa error mengembalikan actor ID.
- Kondisi kontradiktif atau tidak dikenal fail closed sebagai `UNAVAILABLE`; jangan mempercayai
  owner dari input caller.

Verifikasi export/type guard aktual pada versi pinned `@supabase/supabase-js@2.116.0` sebelum
menulis import. Jangan mengubah package version untuk remediasi ini.

### 2 Error contract Activity

Pertahankan `ActivityServiceErrorCode` bila itu menjaga diff tetap kecil, tetapi tambahkan:

- `messageKey: MessageKey`;
- `correlationId` UUID baru untuk setiap error instance;
- `fieldErrors?: Partial<Record<string, MessageKey>>`;
- `latestRecord?: ActivityRow` hanya untuk conflict record milik actor.

Mapping yang direkomendasikan memakai key yang sudah tersedia:

| Code | Message key |
| --- | --- |
| `VALIDATION` | `error.validation` |
| `UNAUTHENTICATED` | `auth.signInRequired` |
| `NOT_FOUND` | `error.notFound` |
| `CONFLICT` | `error.conflict` |
| `IDEMPOTENCY_KEY_REUSED` | `error.operationKeyReused` |
| `UNAVAILABLE` | `error.unavailable` |

`Error.message` boleh menjadi satu pesan generik aman untuk diagnostics, tetapi bukan copy UI dan
tidak boleh memuat raw database/provider message. Jangan membuat correlation ID deterministic dari
user ID, operation key, atau source content. Gunakan UUID acak seperti contract bersama.

### 3 Immutable create receipt sebagai hasil idempotent

Tambahkan contract domain eksplisit, misalnya `ActivityCreateReceipt`, dengan field minimum:

- `activityId`;
- `userId`;
- `revision`;
- `occurredOn`;
- `captureMode`.

`createActivity()` harus memetakan satu row hasil RPC langsung ke receipt tersebut dan
mengembalikannya pada first call maupun replay. Jangan membaca `public.activities` di dalam
`createActivity()` untuk membentuk hasil idempotent.

Jika caller memerlukan row penuh, caller menjalankan `getActivity(receipt.activityId)` sebagai read
terpisah dengan semantics live yang jelas. Jangan menambahkan raw text ke ledger hanya agar create
dapat mengembalikan snapshot penuh. Receipt minimal yang ada adalah boundary privacy yang harus
dipertahankan.

Public RPC signature dan generated database types diperkirakan tidak berubah. Bila implementasi
menemukan kebutuhan mengubah SQL/RPC, hentikan perluasan itu, catat bukti, dan evaluasi migration
forward-only baru; jangan mengedit `20260917160000_t06_activity_persistence.sql`.

## Fase 0 Baseline dan reproduksi

1. Baca seluruh acuan wajib dan periksa `git status --short`. Pertahankan semua perubahan pengguna
   yang sudah ada; jangan membersihkan atau mengembalikan file di luar scope.
2. Catat baseline berikut dengan exit code dan jumlah test aktual:

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
git diff --check
```

3. Reproduksi tanpa meninggalkan data:
   - anonymous client `auth.getUser()` menghasilkan missing-session error;
   - service saat ini memetakannya ke `UNAVAILABLE`;
   - create Activity, edit sehingga revision naik, lalu replay operation key awal; service saat ini
     mengembalikan row live revision baru walau RPC receipt tetap revision 1;
   - error instance saat ini tidak memiliki localized key/correlation ID.
4. Gunakan akun/row disposable dan cleanup dalam `finally`. Jangan mencetak key, token, note text,
   atau full error provider ke output dokumentasi.

Acceptance fase:

- Ketiga temuan dapat direproduksi atau dibuktikan langsung dari test sebelum fix.
- Baseline failure yang sudah ada dipisahkan dari perubahan remediasi.
- Database aktif tidak di-reset dan tidak ada fixture tertinggal.

## Fase 1 Perbaiki auth dan error contract

1. Implementasikan classifier auth kecil dan teruji pada boundary Activity service.
2. Ubah `requireActorId()` agar missing/invalid session menghasilkan `UNAUTHENTICATED`, sementara
   gangguan provider/network menghasilkan `UNAVAILABLE`.
3. Tambahkan `messageKey`, `correlationId`, dan typed field errors ke `ActivityServiceError`.
4. Map seluruh jalur Zod, auth, RPC, read/list/detail, idempotency conflict, revision conflict, dan
   unexpected error ke contract yang sama.
5. Pertahankan foreign/missing Activity sebagai bentuk `NOT_FOUND` yang sama dan jangan menambahkan
   owner/payload ke pesan error.
6. Pertahankan `latestRecord` hanya setelah service berhasil membaca Activity owned pada conflict.

Test unit minimum:

- missing session -> `UNAUTHENTICATED` + `auth.signInRequired` + UUID correlation ID;
- invalid/expired token error -> `UNAUTHENTICATED`;
- retryable/network auth failure -> `UNAVAILABLE` + `error.unavailable`;
- Zod failure -> `VALIDATION` + field message key;
- setiap error instance memiliki UUID berbeda;
- generic `Error.message`, field errors, dan correlation metadata tidak mengandung source text atau
  provider/database message.

Acceptance fase:

- Caller dapat membedakan sign-in recovery dari dependency outage tanpa membaca message string.
- Error dapat dirender memakai dictionary `en`/`id` dan memiliki reference ID.
- Tidak ada data akun lain atau source content dalam error.

## Fase 2 Jadikan receipt sebagai hasil create service

1. Tambahkan `ActivityCreateReceipt` pada domain contract dan export dari barrel/type file yang
   memang dipakai; hindari abstraction baru yang tidak memiliki consumer.
2. Ubah return type `createActivity()` dari `Promise<ActivityRow>` menjadi receipt yang immutable.
3. Map snake_case RPC result ke contract TypeScript secara eksplisit dan validasi row tunggal,
   actor owner, revision 1, exact date, serta capture mode sebelum return.
4. Hapus read live row dari jalur create. `getActivity()` tetap menjadi API detail live.
5. Sesuaikan tests/caller T06: setelah create, gunakan receipt ID untuk read detail bila assertion
   memerlukan raw text, analysis state, optional fields, atau Chat messages.
6. Jangan mengubah operation hash, receipt ledger, RPC grants, RLS, atau schema database.

Test integration minimum:

- first create dan immediate replay menghasilkan receipt deep-equal, bukan hanya ID sama;
- concurrent identical create menghasilkan dua receipt deep-equal, satu Activity, satu ledger row,
  dan satu first Chat message;
- create -> user edit revision 2 -> replay original create menghasilkan receipt revision 1 yang
  sama, sedangkan `getActivity()` menunjukkan row live revision 2;
- create berkonteks Project -> Project experience propagation mengubah live Activity revision,
  tetapi replay create tetap mengembalikan receipt awal;
- same key + changed payload tetap `IDEMPOTENCY_KEY_REUSED` dan tidak menambah row;
- ledger receipt tetap hanya memiliki lima field aman dan tidak mengandung `raw_text`, role, scope,
  outcome, Chat content, atau context IDs.

Acceptance fase:

- Contract idempotency service sama dengan receipt database: request identik mengembalikan hasil
  create awal yang stabil.
- Current mutable state hanya diperoleh melalui read eksplisit.
- Tidak ada duplikasi source content dalam ledger.

## Fase 3 Regression lintas T01 sampai T06

Jalankan ulang seluruh command berikut dan catat hasil aktual:

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
git diff --check
```

Ketentuan verifikasi:

1. Activity integration tetap memakai dua authenticated account untuk ownership, context, direct
   mutation denial, revision conflict, dan pagination.
2. Tambahkan satu anonymous/no-session case tanpa melemahkan fixture cleanup.
3. Storage integration wajib tetap lulus karena working tree memuat hardening T05.
4. pgTAP wajib tetap lulus walau tidak ada SQL yang berubah; ini membuktikan service remediation
   tidak disertai schema drift.
5. `pnpm db:types` hanya dijalankan bila schema/RPC berubah. Bila dijalankan, bandingkan output
   aktual dengan checked-in types; jangan menerima rewrite line-ending sebagai perubahan semantik.
6. Clean disposable database rebuild tidak wajib bila tidak ada migration atau SQL test yang
   berubah. Jika implementasi mengubah database, clean rebuild dan forward migration menjadi wajib
   sesuai T06 implementation plan.
7. Browser E2E S05/S06 tidak dijalankan karena UI T07 tetap di luar scope. Jika route/component
   Activity tersentuh, anggap scope melebar dan kembalikan perubahan itu sebelum menutup remediasi.

Acceptance fase:

- Unit, Activity integration, Storage regression, build, worker, pgTAP, DB lint, migration list,
  dan diff check lulus.
- Test baru gagal terhadap implementasi lama dan lulus setelah fix.
- Tidak ada migration baru, lockfile change, atau UI change tanpa alasan yang dibuktikan.

## Fase 4 Decision dan checkpoint

Setelah code dan checks lulus:

1. Tambahkan `docs/decisions/0010-t06-activity-service-contract.md` yang mencatat:
   - classifier missing/invalid session versus provider unavailable;
   - localized error keys dan correlation ID;
   - receipt immutable sebagai return value create;
   - live Activity harus dibaca terpisah;
   - alasan tidak menyimpan raw source dalam operation ledger;
   - tidak ada perubahan database/migration, bila memang demikian.
2. Perbarui `docs/verification/T06-activity-persistence.md` dengan bagian remediasi review,
   regression cases, file berubah, command aktual, dan limitation.
3. Perbarui `docs/IMPLEMENTATION_STATUS.md`:
   - T06 kembali `DONE` hanya setelah seluruh acceptance lulus;
   - T07 kembali menjadi next task;
   - Gate M2 tetap terbuka;
   - catat checks yang tidak dijalankan dan alasannya.
4. Ubah status dokumen rencana ini menjadi selesai dieksekusi hanya setelah bukti final ada.
5. README hanya diubah bila command/setup pengguna benar-benar berubah.

## File yang diperkirakan berubah saat eksekusi

Wajib atau sangat mungkin:

- `src/features/activity/activity-service.ts`
- `src/domain/activity/contracts.ts`
- `src/domain/database-types.ts` bila receipt diekspor dari kontrak publik domain
- `tests/unit/activity-service.test.ts` atau test unit terarah dengan nama ekuivalen
- `tests/integration/activity-persistence.test.ts`
- `docs/decisions/0010-t06-activity-service-contract.md`
- `docs/verification/T06-activity-persistence.md`
- `docs/verification/T06-review-remediation-plan.md`
- `docs/IMPLEMENTATION_STATUS.md`

Hanya bila dibuktikan perlu:

- `src/i18n/messages.ts`, jika key yang ada tidak cukup; pertahankan parity `en`/`id`.
- `src/server/action-result.ts`, hanya bila shared error code perlu diperluas tanpa merusak caller.
- `src/server/supabase/database.types.ts`, hanya bila signature RPC/schema berubah.
- migration forward-only baru dan pgTAP Activity, hanya bila contract database ternyata perlu
  berubah. Jangan mengedit migration T06 historis.

Tidak boleh berubah untuk remediasi ini:

- route/component Activity dan UI T07;
- worker atau AI/provider code;
- dokumen sumber PRD, Flow, Wireframe, Database Schema, dan `Design.md`;
- schema achievement, evidence, project CRUD T08, import, CV, export, atau account deletion.

## Matriks temuan ke bukti

| Temuan | Fix utama | Bukti minimum |
| --- | --- | --- |
| Missing session menjadi `UNAVAILABLE` | Supabase auth error classifier | Unit missing/invalid/retryable + anonymous integration |
| Replay membaca row live | Return immutable RPC receipt | replay setelah edit/context propagation + concurrent deep equality |
| Error tanpa i18n/correlation | `MessageKey` + UUID correlation ID | unit mapping semua code, unique UUID, no source leakage |

## Non regression checklist

- [x] `raw_text` tersimpan persis tanpa trim, normalization, atau truncation.
- [x] Blank dan 10.001 code point ditolak; 10.000 Unicode diterima.
- [x] Chat create tetap menulis first user message atomik dan Note/Form tidak membuat Chat.
- [x] Analysis state create tetap `not_requested`; tidak ada job/provider call.
- [x] Owner berasal dari authenticated session; payload tidak menerima `user_id`.
- [x] Foreign dan missing detail tetap tidak dapat dibedakan.
- [x] Direct authenticated INSERT/UPDATE/DELETE Activity dan Chat tetap ditolak.
- [x] Revision conflict mengembalikan latest owned row tanpa overwrite.
- [x] Context mismatch/cross-owner ditolak dan lifecycle propagation tetap menaikkan revision.
- [x] Pagination tetap 30 dengan urutan `occurred_on DESC, id DESC` tanpa duplicate/skip.
- [x] Receipt ledger tidak menyimpan source text atau context content.
- [x] T05 restrictive Storage policy dan integration tetap lulus.
- [x] Tidak ada UI/AI/T08+ atau dependency baru.

## Definition of Done

T06 kembali `DONE` hanya jika:

1. Missing session dan invalid/expired token dipetakan ke `UNAUTHENTICATED`; provider/network
   failure tetap `UNAVAILABLE`.
2. Setiap `ActivityServiceError` memiliki safe code, localized message key, UUID correlation ID,
   typed optional field errors, dan tidak membocorkan source/provider/database details.
3. `createActivity()` mengembalikan immutable minimal receipt langsung dari RPC; tidak membaca row
   live untuk membentuk hasil idempotent.
4. Replay immediate, concurrent, setelah edit, dan setelah context propagation mengembalikan
   receipt yang sama; changed payload tetap ditolak.
5. Caller/test memakai `getActivity()` secara eksplisit untuk current row dan Chat detail.
6. Seluruh non-regression checklist memiliki bukti otomatis atau catatan review konkret.
7. Lint, typecheck, unit, Activity integration, Storage integration, production build, worker
   check, pgTAP, DB lint, migration list, dan `git diff --check` lulus.
8. Decision 0010, verification T06, implementation status, dan status plan diperbarui dengan hasil
   aktual; checks yang tidak dijalankan tidak diklaim lulus.
9. T07 tetap belum dimulai dan Gate M2 tetap terbuka.

Jika satu gate wajib tidak dapat dijalankan, biarkan T06 `PARTIAL` dan tulis blocker serta next
command konkret. Jangan menandai `DONE` berdasarkan unit test saja.

## Format handoff Luna

Jawaban akhir Luna harus berurutan:

1. outcome dan status akhir T06;
2. tiga temuan dan invariant yang diperbaiki;
3. bentuk final create receipt dan error contract;
4. file serta decision yang berubah;
5. migration/schema impact, termasuk pernyataan eksplisit bila tidak ada;
6. command yang benar-benar dijalankan beserta exit/count aktual;
7. checks yang tidak dijalankan dan alasannya;
8. risiko/limitation yang tersisa;
9. next task T07 hanya bila T06 kembali `DONE`.

## Prompt eksekusi siap salin untuk Luna

```text
Implementasikan seluruh remediasi dalam
docs/verification/T06-review-remediation-plan.md untuk WorkPulse. Gunakan model
gpt-5.6-luna dengan reasoning max.

Baca AGENTS.md dan docs/AGENTS.md, docs/IMPLEMENTATION_STATUS.md,
docs/IMPLEMENTATION_PLAN.md bagian 1, 3, 4, acceptance T06 dan matriks R04,
docs/verification/T06-implementation-plan.md,
docs/verification/T06-activity-persistence.md, decision 0009, source R04/F02/S05-S06
serta Database Schema bagian 1-3/6, lalu implementasi dan tests aktual. Pertahankan
seluruh perubahan T05/T06 yang sudah ada dan jangan memulai T07 atau T08+.

Kerjakan berurutan: baseline dan reproduksi tiga temuan; perbaiki klasifikasi
missing/invalid session versus provider unavailable; sejajarkan ActivityServiceError
dengan localized MessageKey, typed field errors, dan UUID correlation ID; lalu ubah
createActivity agar mengembalikan immutable minimal receipt langsung dari RPC tanpa
membaca row Activity live. Untuk data terkini, gunakan getActivity secara eksplisit.
Jangan menyimpan raw_text atau content privat lain dalam operation ledger/error/log.

Tambahkan unit tests untuk auth/error mapping dan integration tests untuk receipt
deep-equal pada replay immediate, concurrent, setelah edit, dan setelah project context
propagation. Pertahankan changed-payload rejection, owner isolation, direct mutation
denial, revision conflict, raw-text exactness, Chat atomicity, pagination, dan Storage
regression. Gunakan type guard resmi Supabase pada versi pinned; jangan klasifikasi
berdasarkan substring message.

Migration baru tidak diharapkan karena RPC/ledger sudah memiliki receipt immutable.
Jangan edit migration historis. Jika bukti menunjukkan SQL perlu berubah, gunakan
migration forward-only baru, jelaskan alasan, jalankan forward migration dan clean
disposable rebuild, serta regenerate/compare database types. Jika tidak ada schema
change, tetap jalankan pgTAP, DB lint, dan migration list sebagai regression.

Jalankan seluruh checks pada Fase 3 dan catat hasil aktual. Jangan klaim browser E2E,
hosted migration, staging, atau production karena di luar scope. Buat decision 0010,
perbarui verification T06 dan IMPLEMENTATION_STATUS, serta ubah T06 kembali DONE hanya
bila seluruh Definition of Done lulus. Jika ada gate wajib terblokir, pertahankan PARTIAL
dengan blocker dan next command konkret. Akhiri dengan format handoff Luna di plan.
```

## Hasil eksekusi — 17 September 2026

**Status akhir: DONE.** Ketiga temuan direproduksi melalui unit test sebelum perbaikan; seluruh regression checks yang berlaku lulus sesudah perbaikan. T07 adalah pekerjaan berikutnya. Gate M2 tetap terbuka.

| Pemeriksaan | Hasil aktual |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lulus, exit 0 |
| `pnpm lint` | Lulus, exit 0, tanpa warning |
| `pnpm typecheck -- --incremental false` | Lulus, exit 0 |
| `pnpm test` | Lulus, 23 file / 112 test |
| Activity persistence integration | Lulus, 6/6 |
| Private storage integration | Lulus, 1/1 |
| `pnpm build` | Lulus, exit 0 |
| `pnpm worker:check` | Lulus, worker ready |
| `pnpm db:test` | Lulus, pgTAP 240/240 |
| `pnpm db:lint` | Lulus, tanpa schema error |
| `pnpm exec supabase migration list --local` | Lulus, 9 migration terpasang cocok dengan database lokal |
| `git diff --check` | Lulus, exit 0; hanya peringatan konversi LF/CRLF Git |

Build pertama di sandbox gagal menulis cache `.next` karena pembatasan Windows; pengulangan dengan akses tulis workspace yang disetujui lulus. Supabase lokal dipakai tanpa reset; key lokal diteruskan hanya ke proses test, tidak dicetak atau disimpan. Telemetry CLI dimatikan untuk pemeriksaan lokal.

Tidak ada schema/RPC change, jadi migration baru, `db:types`, dan clean rebuild tidak diperlukan. E2E browser tidak dijalankan karena tidak ada caller UI untuk service ini; hosted migration, staging, dan production berada di luar scope. Pemeriksaan whitespace pada file baru hanya menemukan dua trailing spaces yang dipakai sebagai hard line breaks Markdown di header verification.

Perubahan mencakup klasifikasi auth/error aman, receipt lima field immutable dari RPC, regression tests untuk replay/edit/concurrency/project propagation, [decision 0010](../decisions/0010-t06-activity-service-contract.md), serta pembaruan verification dan status. Tidak ada temuan blocker untuk T06.

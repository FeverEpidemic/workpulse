# Verifikasi T06 — Activity persistence

Tanggal: 17 September 2026  
Status: **DONE**  
Dependencies: T01–T05 DONE; T05 policy hardening remains in place.

## Scope dan trace requirement

T06 menyediakan persistence Activity yang dapat dipakai sebelum AI maupun UI Capture dibuat.
Implementasi dan remediasi review memenuhi PRD R04 / Content and AI behavior, Flow F02 / shared
recovery, Wireframe S05/S06, dan Database Schema §§1–3/6:
Activity menyimpan teks sumber dan tanggal secara persis, Chat menyimpan pesan pertama secara atomik,
record dimiliki akun pembuatnya, perubahan memakai revision, dan list memakai filter serta cursor
stabil. Catatan Quick log manual yang sudah ada tidak dihubungkan ke database di task ini; UI dan
feedback save tetap menunggu T07.

Requirement R01 menjadi dasar ownership/session. Tidak ada perubahan UI, provider/worker AI,
`ai_jobs`, achievement, evidence, deletion lintas domain, atau flow T07+. Activity baru mulai dalam
status `not_requested`; pemanggilan persistence tidak enqueue analisis.

## Perubahan

- Migration forward-only `20260917160000_t06_activity_persistence.sql` membuat tabel Activity,
  Chat, create-idempotency receipt, owner composite FK, validasi, RLS, privilege, dan RPC terbatas.
  Context Activity tetap konsisten dengan Project/Experience melalui FK dan compatibility hook;
  lifecycle project/experience yang sudah ada memperbarui atau melepas context tanpa menghapus
  Activity.
- Domain/service menyediakan exact date, timezone conversion helper, cursor keyset versi 1, validasi
  input, create/replay, update dengan `expected_revision`, safe errors, filter, detail, dan list 30
  baris. Identitas owner diambil dari authenticated session; tidak ada `user_id` tepercaya dari
  payload.
- Remediasi service contract membedakan missing/invalid session dari outage menggunakan type guard
  resmi Supabase JS 2.116.0, menambahkan localized `MessageKey`, typed field errors, UUID correlation
  ID, dan pesan diagnostics generik. Create memvalidasi dan mengembalikan receipt RPC lima-field
  immutable; current row dan Chat tetap dibaca eksplisit melalui `getActivity()`.
- `raw_text` tidak di-trim, dinormalisasi, atau dipotong. Batasnya 10.000 Unicode code point.
  Role dibatasi 200 karakter serta scope/outcome 5.000; rationale ada di
  [decision 0009](../decisions/0009-activity-persistence.md).
- Jenis public database diregenerasi dari schema lokal; `internal` tetap tidak diekspos.
- Integration command Activity ditambahkan. `test:integration:storage` sekarang menunjuk hanya
  suite Storage, sehingga regression Storage tetap memiliki scope yang jujur. README menjelaskan
  status dan kebutuhan fixture environment.

File T06 baru: `src/domain/activity/*`, `src/features/activity/{schemas,activity-service}.ts`,
`supabase/migrations/20260917160000_t06_activity_persistence.sql`,
`supabase/tests/database/activity.test.sql`, unit/integration tests Activity, decision 0009, dan
file verifikasi ini. File berubah: README, `package.json`, `src/domain/database-types.ts`, serta
`src/server/supabase/database.types.ts`. File UI, Storage, Auth, worker, dan sumber DOCX tidak
diubah oleh T06.

## Acceptance

| Acceptance | Bukti aktual |
| --- | --- |
| Replay identical tidak menggandakan Activity, receipt, atau Chat pertama | Unit/integration membandingkan receipt deep-equal saat immediate, concurrent, setelah edit revision 2, dan setelah project context propagation; pgTAP memverifikasi ledger minimal yang stabil. |
| Idempotency key dengan payload lain ditolak | RPC/pgTAP dan integration memeriksa conflict stabil; jumlah row tidak bertambah. |
| Session dan error aman | Anonymous Supabase `getUser()` menghasilkan `AuthSessionMissingError` lalu service mengembalikan `UNAUTHENTICATED`; invalid JWT dan HTTP 403 juga meminta sign-in, sedangkan retryable/unknown/contradictory error menjadi `UNAVAILABLE`. Unit memeriksa semua code, key dictionary, UUID baru, field errors, dan tidak ada provider/source text pada diagnostics. |
| Receipt create minimal dan eksplisit | Unit memvalidasi actor owner, revision 1, ISO date, capture mode, lima key tepat, immutability runtime, dan tidak ada read `.from()` pada jalur create. Current row dibaca melalui `getActivity()` terpisah. |
| Raw text, Chat, batas panjang | Integration membandingkan Unicode/whitespace persis, Chat sequence 1 atomik, dan 10.000 code point diterima; unit/pgTAP menolak blank dan 10.001. Note/Form tidak membuat pesan Chat. |
| Date tanpa pergeseran timezone | Unit fixed instant untuk timezone IANA dan kalender invalid lulus; integration menyimpan tanggal exact. Kolom SQL bertipe `date`. |
| Ownership dan mutasi langsung | Dua authenticated account; foreign/missing detail aman dan setara, foreign Project/Experience ditolak, SELECT lintas owner kosong, direct INSERT/UPDATE/DELETE ditolak. |
| Dua update revision yang sama | Dua request dengan `expected_revision` sama menghasilkan satu update dan satu stale conflict; service memperoleh state terbaru milik owner untuk rekonsiliasi. |
| Chat create atomic | Integration memeriksa pesan pertama exact sequence 1; pgTAP memeriksa rollback/no-partial-row dan Note/Form nol message. Tidak ada assistant/follow-up. |
| Context dan lifecycle | pgTAP menguji mismatch/cross-owner; integration menguji project/experience lifecycle, standalone experience, dan Activity retention. |
| Pagination dan filter | Integration memakai 31 record pada tanggal sama; page 30 + cursor tidak duplicate/skip. Tanggal inclusive dan project filter diuji. Cursor malformed/tampered ditolak oleh unit sebelum query. |
| Regression T01–T05 | Unit, Storage integration, pgTAP, DB lint, build, worker, forward migration, dan clean rebuild lulus. Diff review memastikan UI/Auth/Storage behavior tidak berubah oleh T06. |

## Hasil verifikasi

Quality gates terhadap workspace dan stack lokal aktif:

| Command | Hasil |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lulus; dependency lock tidak berubah. |
| `pnpm lint` | Lulus, 0 exit. |
| `pnpm typecheck -- --incremental false` | Lulus, 0 exit. |
| `pnpm test` | 23 file, 112 test lulus. |
| `pnpm test:integration:activity` | 6/6 lulus terhadap stack aktif, termasuk anonymous session serta replay setelah edit dan context propagation. |
| `pnpm test:integration:storage` | 1/1 lulus terhadap stack aktif. |
| `pnpm build` | Production build lulus. |
| `pnpm worker:check` | Lulus; bootstrap siap, belum ada registered jobs seperti yang diharapkan untuk T06. |
| `pnpm db:types` | Lulus; public TypeScript types diregenerasi dari database lokal. |
| `pnpm db:test` | 240/240 pgTAP assertion lulus. |
| `pnpm db:lint` | Lulus pada konfigurasi repo (`--level error`), tanpa error. |
| `pnpm exec supabase migration up --local` | Lulus; `applied: []`, migration T06 sudah diterapkan. |
| `pnpm exec supabase migration list --local` | Sembilan migration lokal sama dengan ledger lokal. |
| `git diff --check` | Lulus tanpa whitespace error; Git hanya melaporkan peringatan normal LF/CRLF pada file tracked. |

Integration command mendapat local Supabase values melalui process environment; secret key tidak
dicetak atau disimpan pada file. Active Supabase stack tidak di-reset dan tidak linked ke hosted.

## Remediasi review service contract — 17 September 2026

Review membuka kembali T06 sebagai `PARTIAL` sampai tiga temuan ditutup. Regression unit baru
dijalankan sebelum perubahan service dan gagal 8/8: missing session menjadi `UNAVAILABLE`, message
key serta correlation ID tidak tersedia, dan create mengembalikan Activity row revision 2 yang
dibaca setelah RPC, bukan receipt revision 1. Hasil tersebut menjadi reproduksi sebelum fix.

Sesudah fix, `ActivityServiceError` mempunyai code stabil, key dictionary `en`/`id`, UUID acak per
instance, typed optional field errors, dan generic `Error.message`. `latestRecord` dipasang hanya
untuk conflict setelah service membaca record dengan owner dari session. Error provider/database dan
source tidak disimpan dalam message, field errors, atau correlation metadata.

`createActivity()` kini memvalidasi tepat satu row RPC, memastikan owner cocok dengan session, revision
awal 1, exact date, dan capture mode; hasilnya frozen receipt `{ activityId, userId, revision,
occurredOn, captureMode }`. Tidak ada query Activity live pada jalur create. Regression integration
membaca detail melalui `getActivity()` dan memastikan receipt replay tidak berubah setelah edit atau
project experience propagation. Existing pgTAP 240/240 juga memastikan ledger hanya memuat receipt
minimal dan mempertahankan receipt awal setelah edit.

File remediation: `src/features/activity/activity-service.ts`,
`src/domain/activity/contracts.ts`, `src/domain/database-types.ts`,
`tests/unit/activity-service.test.ts`, `tests/integration/activity-persistence.test.ts`,
`docs/decisions/0010-t06-activity-service-contract.md`, status ini, status implementation, dan
`docs/verification/T06-review-remediation-plan.md`. Tidak ada migration, SQL test, database generated
type, UI, worker, package version, atau lockfile yang berubah.

Checks pasca-remediasi: frozen install, lint, typecheck, unit, Activity/Storage integration, production
build, worker check, pgTAP, DB lint, local migration list, dan diff check semuanya lulus. Build
memerlukan rerun dengan akses workspace karena percobaan sandbox awal tidak dapat menulis cache
`.next`; tidak ada perubahan build configuration. Integration account dibersihkan, Supabase aktif
tidak di-reset, dan key lokal hanya tersedia dalam process environment.

`db:types` dan clean disposable rebuild tidak diulang karena tidak ada perubahan SQL/RPC. Browser E2E
tidak dijalankan karena route/component tidak berubah. Hosted migration, staging performance, dan
production tetap di luar scope. T07 menjadi task berikutnya; Gate M2 tetap terbuka sampai T06–T12
selesai.

### Clean rebuild terisolasi

Project disposable `workpulse_t06clean202609171620` memakai workdir sementara
`.tmp/workpulse_t06_clean_20260917_1620` dan port terpisah (API 55321). Sebelum dibuat, target
config ID diverifikasi, port dicek tidak terpakai, dan tidak ada container/volume/network dengan
project ID tersebut. `supabase db reset --local --workdir ... --yes` hanya dijalankan pada project
ini; kesembilan migration dan seed selesai tanpa mengubah DB aktif.

Pada rebuild tersebut: pgTAP 240/240 lulus; Activity integration 5/5 lulus; Storage integration
1/1 lulus. `supabase db lint` keluar 0; default warning level melaporkan satu advisory PL/pgSQL
bahwa local variable `v_revision` di `internal.update_activity` tidak dibaca. Script repo
`pnpm db:lint` menggunakan error severity dan tidak melaporkan error. Advisory itu tidak mengubah
hasil RPC atau acceptance dan dicatat untuk diperhatikan saat perubahan berikutnya.

Sesudah bukti dicatat, hanya project ID disposable itu dihentikan dengan `--no-backup`. Verifikasi
Docker menunjukkan container, volume, dan network project tersebut tidak tersisa; folder disposable
yang dibuat untuk clean rebuild juga dihapus. Database aktif tetap berjalan dan migration list-nya
tidak berubah.

## Batasan dan langkah berikutnya

- Browser E2E tidak dijalankan karena route/component tidak berubah; T07 menangani Capture/list UI,
  save feedback, dan browser flow.
- Hosted migration/deployment, staging performance, dan production belum dijalankan. Gate M2 tetap
  terbuka sampai T06–T12 selesai.
- AI consent/job/provider flow, delete Activity lintas achievement/evidence/CV, dan worker handler
  tetap pada task berikutnya; `analysis_state` T06 hanya menyatakan analisis tidak diminta.
- T07 — Capture dan Activity UI — menjadi task berikutnya.

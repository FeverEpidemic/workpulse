# Rencana Eksekusi T05 Private Storage Foundation

Tanggal perencanaan: 17 September 2026

Status: siap dieksekusi; T05 tetap `TODO` sampai acceptance memiliki bukti aktual.

Model eksekusi yang diminta: GPT-5.6 Luna dengan reasoning `MAX`.
Dependensi minimum: T02 `DONE`. Baseline aktual: T01-T04 `DONE`, termasuk remediasi review
T03-T04 pada 17 September 2026.

## Hasil yang dituju

T05 menghasilkan fondasi penyimpanan privat yang dapat dipakai ulang oleh evidence T10/T11,
import T15, export T21/T22, dan account cleanup T23. Hasilnya mencakup bucket privat, key object
yang owner-scoped, adapter server-only, penerbitan signed download URL maksimal lima menit,
validasi metadata, kontrak malware scanner yang fail closed, dan durable `storage_jobs` untuk
cleanup.

T05 tidak membuat UI upload, belum membuat tabel `evidence_files` atau `import_batches`, dan tidak
menyatakan malware screening terintegrasi. Gate M1 baru boleh ditutup setelah isolasi dua akun,
batas expiry URL, dan kelangsungan cleanup queue terbukti pada stack Supabase lokal.

## Acuan dan acceptance sumber

- `IMPLEMENTATION_PLAN.md` §1, §3 Jobs dan data privat, §4 extension schema, acceptance T05, matriks
  R01/R07, serta Gate M1.
- Database Schema §4 Storage protocol and quotas: prefix privat untuk import, evidence, dan export;
  key `user_id/category/object_uuid`; reserve sebelum upload; actual metadata diverifikasi; object
  yang gagal/orphan dibersihkan.
- Database Schema §4 File retention: `storage_jobs` tidak memiliki parent FK, tidak dapat diakses
  client, bertahan setelah parent dihapus, dan disimpan sampai penghapusan object terverifikasi.
- Database Schema §6 Access policy: ownership berlaku pada storage path dan signed URL; direct
  client write ke worker state dilarang; service credential tidak pernah masuk browser.
- PRD R01: akun lain tidak dapat membaca atau mengubah file.
- PRD R07: evidence privat, validasi tipe/ukuran, download/delete owner-only, dan file tidak dikirim
  ke AI.
- PRD Reliability §4: signature/MIME/size/ownership diverifikasi server, file dikarantina sampai
  screening lulus, signed URL maksimal lima menit, dan dokumen aktif tidak dipreview inline.
- Official Supabase docs: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
  [API keys](https://supabase.com/docs/guides/getting-started/api-keys),
  [CLI storage config](https://supabase.com/docs/guides/local-development/cli/config), dan
  [`createSignedUrl`](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl).
  Bucket privat memakai access control berbasis RLS; secret key melewati RLS sehingga hanya boleh
  dipakai oleh komponen server yang melakukan authorization sendiri; signed URL menerima expiry
  dalam detik; konfigurasi bucket lokal mendukung `public`, `file_size_limit`, dan allowlist MIME.
- Official OpenAI docs: [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
  mendukung tool use dan reasoning `MAX`, sesuai model eksekusi yang diminta.

## Kondisi workspace sebelum eksekusi

- `@supabase/supabase-js` 2.116.0, Supabase CLI 2.117.0, Zod 4.6.5, dan Node 24 sudah dipin; T05
  tidak memerlukan dependency baru.
- `supabase/config.toml` sudah mengaktifkan Storage dengan project limit 50 MiB, tetapi belum
  mendefinisikan bucket WorkPulse.
- `.env.example` sudah membedakan publishable key dan server-only `SUPABASE_SECRET_KEY`.
- Web memakai cookie-bound `createSupabaseServerClient`; belum ada admin client terpisah. Admin
  storage client harus memakai `@supabase/supabase-js` langsung, tidak memakai SSR client/cookie.
- Worker masih bootstrap tanpa registered jobs. T05 menyiapkan queue dan kontrak, bukan loop worker.
- `internal` sudah menjadi schema tidak terekspos. `storage_jobs` ditempatkan di schema ini dan
  tidak ditambahkan ke API schemas.
- Worktree memiliki perubahan remediasi T03-T04. Eksekutor harus menjalankan baseline lebih dulu,
  tidak mereset atau menimpa perubahan tersebut, dan membatasi overlap pada file yang tercantum
  dalam rencana ini.

## Keputusan teknis T05

### 1 Bucket dan object key

- Gunakan satu bucket bernama `workpulse-private` dengan `public = false`.
- Gunakan tiga kategori allowlisted: `import`, `evidence`, dan `export`.
- Bentuk key kanonik tepat tiga segmen:
  `owner_uuid/category/object_uuid`.
- `owner_uuid` dan `object_uuid` harus UUID kanonik lowercase; category harus enum; slash tambahan,
  backslash, dot segment, percent-encoded separator, query, fragment, nama file, dan ekstensi
  ditolak.
- Original filename tidak masuk object key. Nama tersebut baru disimpan sebagai metadata domain
  pada task pemiliknya dan tidak dicatat ke log.
- Object UUID dibuat server dan tidak digunakan ulang. MIME tidak disimpulkan dari ekstensi.
- Bucket memakai hard ceiling 50 MiB dan allowlist MIME PDF, PNG, JPEG, serta DOCX. Limit domain
  10 MiB untuk import/evidence, quota 50 MiB/account, slot, signature, dan actual-byte reservation
  tetap dimiliki T10/T15. Export-specific size policy ditetapkan pada T21.

Satu bucket dipilih karena schema sumber meminta prefix yang terpisah, bukan tiga bucket, dan satu
key contract memudahkan authorization, cleanup, serta adapter. Kategori tetap menjadi boundary
eksplisit dan tidak boleh berupa string bebas.

### 2 Tidak ada akses Storage langsung dari browser

- `anon` dan `authenticated` tidak memperoleh direct `SELECT/INSERT/UPDATE/DELETE` untuk object
  dalam bucket WorkPulse.
- Upload token, download URL, metadata lookup, move, dan delete hanya diterbitkan/dijalankan oleh
  server setelah authorization domain. T05 hanya mengimplementasikan bagian yang diperlukan untuk
  fondasi dan acceptance download/delete.
- Kebijakan ini sengaja lebih ketat daripada owner-prefix policy langsung. Jika client diberi
  `SELECT` pada `storage.objects`, client dapat memanggil signed URL API sendiri dengan expiry yang
  dipilihnya. Server-only issuance diperlukan agar batas 300 detik benar-benar menjadi invariant.
- Secret key tidak pernah dikirim sebagai prop, response, client bundle, URL, atau log. Admin client
  memiliki auth persistence, refresh, dan URL-session detection yang dinonaktifkan.

### 3 Authorization dan signed URL

- Server mengambil actor dari session melalui auth context yang sudah ada; tidak menerima
  `user_id` dari form/payload sebagai owner.
- Service mem-parse key, membandingkan owner segment dengan actor ID, memeriksa category allowlist,
  lalu memeriksa object pada bucket melalui adapter admin.
- Missing dan foreign object menggunakan error aman yang sama, misalnya
  `STORAGE_OBJECT_UNAVAILABLE`, agar tidak membocorkan keberadaan file akun lain.
- Download TTL wajib integer 1-300 detik. Nilai di luar rentang ditolak, bukan diam-diam di-clamp.
- URL dibuat dengan download disposition. T05 tidak membuat inline preview untuk PDF/DOCX.
- Default pemanggil adalah 300 detik; integration test juga menerbitkan TTL pendek untuk
  membuktikan expiry aktual tanpa menunggu lima menit.

### 4 Adapter dan metadata

Pisahkan kontrak domain dari Supabase:

- `StorageAdapter` menangani object info, signed download URL, dan remove. Method upload/move tidak
  ditambahkan sampai ada consumer nyata pada T10/T15.
- `SupabaseStorageAdapter` adalah implementasi server-only dengan admin client terpisah.
- `PrivateStorageService` menjalankan actor/path authorization, TTL guard, category policy, safe
  error mapping, dan metadata validation sebelum memanggil adapter.
- Metadata provider diperlakukan sebagai input tidak tepercaya. Validasi minimal mencakup object
  existence, ukuran integer nonnegative, MIME allowlisted, dan hasil yang konsisten dengan locator.
  Validasi signature, SHA-256, actual upload bytes, dan domain status `ready` tetap T10/T15.
- Adapter exception tidak diteruskan mentah ke user. Response memakai error code aman dan
  correlation ID; log tidak memuat secret, filename, attachment content, atau signed URL.

### 5 `internal.storage_jobs`

Migration T05 membuat queue cleanup dengan kontrak berikut:

| Field | Kontrak |
| --- | --- |
| `id` | UUID server-generated primary key. |
| `user_id` | UUID owner untuk authorization/audit; sengaja tanpa FK ke profile. |
| `bucket_id` | Harus `workpulse-private` pada T05. |
| `object_key` | Key kanonik owner/category/object UUID. |
| `kind` | `delete` pada T05. |
| `status` | `queued`, `running`, `succeeded`, atau `failed`. |
| `attempt_count` | Integer nonnegative; bertambah saat claim. |
| `attempt_token` | UUID nullable, diisi pada claim dan diwajibkan untuk completion guard. |
| `lease_expires_at` | Nullable; lease running 120 detik. |
| `next_attempt_at` | Waktu job boleh di-claim/retry. |
| `error_code` | Kode aman nullable, tanpa object content atau filename. |
| `created_at`, `updated_at`, `finished_at` | Audit UTC. |

Aturan queue:

- Tidak ada FK ke project/activity/achievement/evidence/profile agar delete parent/account tidak
  menghapus atau memblokir cleanup receipt.
- Unique `(bucket_id, object_key, kind)` membuat enqueue delete idempotent. Object UUID tidak
  digunakan ulang, sehingga job sukses tidak perlu digandakan.
- Enqueue identik mengembalikan job yang sama; job `failed` hanya kembali `queued` melalui operasi
  retry eksplisit.
- Claim memakai lock/CAS atomik, urutan `next_attempt_at, created_at, id`, lease 120 detik, dan
  attempt token baru.
- Complete/fail mensyaratkan status `running`, token yang sama, dan lease yang belum digantikan.
  Worker lama tidak dapat menulis hasil setelah lease direclaim.
- Table dan fungsi internal dicabut dari `public`, `anon`, dan `authenticated`. Akses service/worker
  tetap melalui operasi server terbatas, bukan client Data API.

T05 menyiapkan schema dan SQL transition contract. Polling daemon dan registered worker handler
baru ditambahkan saat task pertama yang benar-benar menghapus object membutuhkannya; acceptance T05
tidak boleh dipenuhi dengan infinite loop atau mock worker.

### 6 Malware scanner fail closed

- Definisikan `MalwareScanner` dan hasil terstruktur: `clean`, `infected`, `unavailable`, atau
  `failed`, dengan error code aman.
- Default tanpa konfigurasi adalah `unavailable`, bukan `clean`.
- Fake scanner hanya dapat dipilih secara eksplisit pada development/test, diberi nama yang jelas,
  dan harus ditolak pada production.
- T05 tidak memilih vendor dan tidak memindahkan file ke status `ready`. Integrasi scanner nyata,
  quarantine lifecycle, retry, dan status evidence adalah T10.
- `.env.example` menambah nama konfigurasi nonsecret yang diperlukan dan placeholder credential
  vendor hanya setelah vendor dipilih; jangan membuat variabel credential spekulatif.

## Paket kerja eksekusi

### T05.1 Baseline dan decision record

1. Catat `git status --short`; jangan membersihkan worktree atau mengubah remediasi T03-T04.
2. Jalankan baseline install, lint, typecheck, unit, build, worker check, pgTAP, dan DB lint.
3. Verifikasi local Supabase tidak linked ke hosted project.
4. Buat `docs/decisions/0007-private-storage-foundation.md` yang mengunci nama bucket, key format,
   server-only signed URL, TTL 300 detik, queue tanpa FK, dan scanner fail-closed.

Acceptance subtask: baseline tercatat dengan hasil aktual; setiap failure lama dipisahkan dari
perubahan T05; tidak ada command destructive pada database aktif.

### T05.2 Object key, konfigurasi, dan admin client

1. Implement enum category, builder/parser object key, serta Zod validation.
2. Pisahkan public Supabase config dari secret/admin config; gunakan satu admin client server-only.
3. Tolak URL Supabase invalid dan secret kosong. Pastikan module admin tidak dapat diimpor ke client
   component.
4. Tambahkan unit test key traversal, wrong segment count, mixed-case/noncanonical UUID, category
   asing, dan config failure.

Acceptance subtask: tidak ada path yang dapat keluar dari owner/category boundary; secret hanya
dibaca di server module dan tidak muncul pada hasil serialization/log.

### T05.3 Bucket privat dan Storage boundary

1. Tambahkan deklarasi bucket lokal pada `supabase/config.toml` sebagai private dengan limit dan
   MIME allowlist yang disepakati.
2. Tambahkan migration idempotent untuk memastikan `workpulse-private` private pada database baru
   dan upgrade database lama.
3. Jangan membuat public URL path atau policy client yang memungkinkan arbitrary signed URL TTL.
4. Tambahkan database assertions untuk bucket private, config yang konsisten, dan tidak adanya
   privilege/policy WorkPulse untuk `anon`/`authenticated`.

Acceptance subtask: public URL tidak dapat digunakan; direct user-token storage operation ditolak;
admin operation hanya bekerja dari server client.

### T05.4 Adapter, authorization, signed download, dan metadata

1. Buat interface adapter dan implementasi Supabase.
2. Buat service owner authorization dengan safe missing/foreign response.
3. Terapkan TTL 1-300 detik dan download disposition.
4. Validasi metadata sebelum URL diterbitkan; mapping provider errors tetap aman.
5. Unit test dengan fake adapter membuktikan foreign owner berhenti sebelum provider call dan TTL
   301 tidak diteruskan.
6. Integration test lokal mengunggah fixture kecil dengan admin client, membuktikan owner dapat
   menerima/menggunakan URL, akun kedua ditolak, direct client signing ditolak, dan URL TTL pendek
   benar-benar expired. Selalu hapus fixture pada `finally`.

Acceptance subtask: dua akun tidak dapat saling menerbitkan atau memakai akses baru untuk path
asing; server tidak pernah menerbitkan URL lebih dari 300 detik.

### T05.5 Durable cleanup queue

1. Buat `internal.storage_jobs`, indexes, checks, grants, dan comment SQL.
2. Implement enqueue idempotent, atomic claim, guarded completion/failure, dan explicit retry.
3. pgTAP memverifikasi invalid transitions, stale token, lease reclaim, duplicate enqueue, dan
   client inaccessibility.
4. Buat fixture job untuk object project, hapus project melalui operasi owner yang sah, lalu buktikan
   job masih ada. Uji juga bahwa tidak ada FK profile/parent pada queue.

Acceptance subtask: cleanup receipt bertahan setelah parent dihapus dan worker attempt lama tidak
dapat menyelesaikan job yang sudah direclaim.

### T05.6 Scanner contract dan failure behavior

1. Tambahkan interface, result schema, unavailable implementation, serta explicit fake
   development/test implementation bila test membutuhkannya.
2. Resolver production menolak fake/unconfigured-as-clean.
3. Unit test membuktikan dependency unavailable tidak pernah menghasilkan `clean` atau `ready`.

Acceptance subtask: ketiadaan scanner tidak membuka jalur file siap pakai; tidak ada klaim integrasi
malware nyata.

### T05.7 Regression, clean rebuild, dan Gate M1

1. Terapkan migration secara forward-only pada stack lokal aktif; jangan menjalankan `db:reset`
   terhadap database tersebut.
2. Jalankan clean migration/seed/test pada project Supabase disposable yang path-nya telah
   diverifikasi, lalu hapus hanya resource disposable setelah hasil dicatat.
3. Regenerate database types hanya jika public schema benar-benar berubah; `internal.storage_jobs`
   tidak boleh memaksa exposure schema.
4. Jalankan seluruh quality gates dan storage integration tests.
5. Tulis bukti aktual pada `docs/verification/T05-private-storage-foundation.md`; perbarui README
   setup/env bila perlu dan `IMPLEMENTATION_STATUS.md`.
6. Lakukan review Gate M1: T01-T05 `DONE`, isolation dua akun dan lifecycle dasar lulus. Jangan
   mengklaim evidence UI, quota race, screening nyata, atau production storage selesai.

Acceptance subtask: status T05 hanya `DONE` jika seluruh matriks acceptance memiliki bukti aktual;
jika local Storage tidak tersedia, selesaikan unit/SQL independen dan gunakan `PARTIAL` atau
`BLOCKED` dengan blocker konkret.

## Perkiraan file

Daftar ini adalah batas kerja. Eksekutor tidak wajib membuat file yang tidak diperlukan.

### File baru yang mungkin diperlukan

- `src/server/supabase/admin.ts`
- `src/server/storage/constants.ts`
- `src/server/storage/object-key.ts`
- `src/server/storage/adapter.ts`
- `src/server/storage/supabase-storage-adapter.ts`
- `src/server/storage/private-storage-service.ts`
- `src/server/storage/metadata.ts`
- `src/server/storage/malware-scanner.ts`
- `supabase/migrations/20260917xxxxxx_private_storage_foundation.sql`
- `supabase/tests/database/private_storage_foundation.test.sql`
- `tests/unit/storage-object-key.test.ts`
- `tests/unit/storage-service.test.ts`
- `tests/unit/malware-scanner.test.ts`
- `tests/integration/private-storage.test.ts`
- `vitest.integration.config.ts` bila pemisahan env integration diperlukan
- `docs/decisions/0007-private-storage-foundation.md`
- `docs/verification/T05-private-storage-foundation.md`

### File yang diperkirakan berubah

- `.env.example`
- `supabase/config.toml`
- `package.json` hanya untuk script integration yang benar-benar dijalankan
- `pnpm-lock.yaml` hanya bila dependency baru ternyata diperlukan dan sudah dibenarkan; default-nya
  tidak berubah
- `README.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `src/server/supabase/database.types.ts` hanya bila generator mendeteksi perubahan public schema

### File yang tidak seharusnya berubah

- Route/page dan komponen UI T03-T04
- `workers/bootstrap.ts` dan `workers/check.ts`, kecuali T05 benar-benar menambahkan executable
  cleanup handler; rencana default tidak melakukannya
- Tabel activities, achievements, evidence, imports, CV, dan AI jobs
- Dokumen sumber PRD, User Flow, Wireframe, Database Schema, dan `Design.md`

## Matriks acceptance dan bukti

| Acceptance T05 | Bukti otomatis | Pemeriksaan tambahan |
| --- | --- | --- |
| Bucket tidak public | pgTAP/SQL assertion `storage.buckets.public = false`; public URL request gagal | Review config lokal dan migration sama nama/limit/MIME |
| Key owner/category/object valid | Unit property/table tests untuk builder/parser dan traversal cases | Review tidak ada filename/extension pada key |
| Akun B tidak mengakses path A | Integration dua akun: foreign issue ditolak sebelum adapter; direct user-token access gagal | Error foreign dan missing tidak dapat dibedakan |
| URL maksimal 5 menit | Unit TTL 0/301 reject dan spy `createSignedUrl`; integration URL pendek expired | Tidak ada client route yang menerima expiry bebas |
| Metadata tidak dipercaya | Unit malformed/missing size atau MIME ditolak | Signature/actual-byte dinyatakan deferred ke T10/T15 |
| Secret server-only | Build/typecheck; import boundary test atau lint convention | Search build/source untuk tidak ada secret serialization/log |
| Cleanup queue survive parent delete | pgTAP enqueue -> delete project -> job tetap ada | Tidak ada FK queue ke parent/profile |
| Queue concurrency aman | pgTAP atomic claim, 120s lease, token guard, retry, stale completion | Index claim dan urutan lock direview |
| Scanner fail closed | Unit unconfigured/fake-production rejection | Verification menyatakan scanner nyata belum terpasang |
| Tidak ada scope creep | Diff review tidak memuat evidence UI/domain tables atau worker daemon | Gate M1 tidak disamakan dengan M2 evidence workflow |

## Perintah verifikasi yang harus dijalankan saat eksekusi

Baseline dan regression:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
pnpm build
pnpm worker:check
pnpm db:test
pnpm db:lint
pnpm db:status
```

Setelah implementasi:

```text
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
pnpm test:integration:storage
pnpm build
pnpm worker:check
pnpm exec supabase migration up
pnpm db:test
pnpm db:lint
pnpm db:status
```

Nama `test:integration:storage` boleh disesuaikan dengan script final, tetapi verification record
harus menuliskan command aktual. Integration test memerlukan Supabase lokal, Storage service, dua
akun fixture, publishable key, secret key server-only, dan cleanup fixture pada `finally`.

Clean rebuild dilakukan pada project disposable, bukan melalui `pnpm db:reset` pada project
WorkPulse aktif. Jika sandbox memblokir Docker named pipe atau telemetry path, ulangi hanya command
yang sama dengan izin lokal yang diperlukan; jangan mengubah target atau mematikan test untuk
memperoleh hasil hijau.

## Urutan prompt untuk Luna MAX

Gunakan prompt berikut pada sesi eksekusi dengan model GPT-5.6 Luna dan reasoning `MAX`:

```text
Eksekusi T05 Private storage foundation berdasarkan
docs/verification/T05-implementation-plan.md.

Baca AGENTS.md yang berlaku, docs/IMPLEMENTATION_STATUS.md,
docs/IMPLEMENTATION_PLAN.md bagian 1, 3, 4, acceptance T05 dan Gate M1,
serta sumber PRD R01/R07 dan Database Schema bagian 4/6. Pertahankan semua
perubahan remediasi T03-T04 yang sudah ada dan jangan memulai T06.

Kerjakan T05.1 sampai T05.7 berurutan. Sebelum edit, laporkan baseline,
dependensi, file yang akan disentuh, dan checks. Gunakan satu bucket private
workpulse-private dengan key owner_uuid/category/object_uuid. Semua signed URL
harus diterbitkan server, download disposition, dan expiry 1-300 detik. Secret
key tidak boleh masuk browser. storage_jobs harus berada di internal schema,
tanpa FK ke parent/profile, dengan lease 120 detik dan attempt-token guard.
Scanner default harus fail closed; jangan mengklaim scanner nyata.

Jalankan unit, integration dua akun dengan Storage lokal, pgTAP, DB lint,
production build, forward migration pada database aktif, serta clean rebuild
pada project disposable. Jangan reset database WorkPulse aktif. Update
docs/verification/T05-private-storage-foundation.md dan
docs/IMPLEMENTATION_STATUS.md dengan hasil aktual. Tandai DONE dan tutup Gate
M1 hanya bila seluruh acceptance terbukti; jika tidak, gunakan PARTIAL/BLOCKED
dan tulis blocker konkret.
```

## Risiko dan mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Secret admin masuk browser karena reuse SSR client | Admin client berada di module `server-only`, memakai `createClient` langsung, dan tidak menerima cookie/session. |
| Client membuat URL expiry lebih panjang | Jangan grant direct Storage `SELECT`; seluruh signing melewati service dengan TTL guard 300 detik. |
| Prefix check lemah memungkinkan path traversal | Parser exact tiga segmen, UUID/category allowlist, dan tolak encoding/separator tambahan sebelum provider call. |
| Secret bypass RLS mengakses object asing | Authorization actor-vs-key dilakukan sebelum adapter; integration test memastikan adapter tidak dipanggil untuk foreign owner. |
| Metadata browser diperlakukan benar | Parse metadata provider/server; T10/T15 tetap wajib signature, actual bytes, SHA-256, quota, dan screening. |
| Queue hilang ketika parent/account dihapus | `internal.storage_jobs.user_id` dan object locator tidak mempunyai FK cascade; enqueue terjadi sebelum parent link diputus. |
| Worker lama menulis setelah lease expiry | Attempt token dan guarded completion wajib; stale-token test di pgTAP. |
| Fake scanner dianggap production-ready | Resolver production menolak fake; unavailable tidak pernah menghasilkan `clean`/`ready`; verification menyatakan batas integrasi. |
| Migration merusak database lokal aktif | Forward migration pada active stack; clean reset hanya pada project disposable yang targetnya diverifikasi. |
| T05 melebar menjadi T10/T15/T21 | Jangan membuat evidence/import/export domain rows, upload UI, quota reservation, parser, PDF renderer, atau scanner vendor. |

## Definition of Done

T05 dapat ditandai `DONE` hanya jika:

1. Bucket `workpulse-private` terbukti private dan konsisten antara migration serta local config.
2. Semua object memakai key kanonik owner/category/object UUID tanpa filename.
3. Browser tidak memiliki secret atau direct storage capability yang dapat melewati server TTL.
4. Owner dapat memperoleh signed download URL dengan download disposition; akun lain dan path
   invalid mendapat error aman; TTL tidak dapat melebihi 300 detik.
5. Metadata validation dan safe provider-error mapping digunakan oleh service nyata, bukan file mati.
6. `internal.storage_jobs` tidak memiliki FK parent/profile, enqueue idempotent, claim atomik,
   lease 120 detik, attempt token guard, retry eksplisit, dan terbukti bertahan setelah parent delete.
7. Scanner contract default fail closed; tidak ada file yang dianggap clean/ready saat dependency
   tidak tersedia.
8. Lint, typecheck, unit, build, worker check, storage integration dua akun, pgTAP, DB lint,
   forward migration, dan disposable clean rebuild memiliki hasil aktual yang tercatat.
9. Verification record dan implementation status diperbarui tanpa mengklaim evidence UI,
   quota/screening nyata, hosted storage, atau production deployment.
10. Integration review Gate M1 menyatakan T01-T05 lengkap; T06 menjadi next task.

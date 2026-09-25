# Rencana Remediasi Review T08 Project dan Context

Tanggal plan: 21 September 2026. Eksekusi checkpoint: 22 September 2026.

Status: **DONE**. Empat temuan review sudah ditutup dengan perubahan kode, migration forward-only,
regression test, browser test, dan verifikasi active/disposable local stack. Dokumen ini semula
merupakan rencana test-first; bagian berikutnya tetap dipertahankan sebagai trace keputusan dan
Definition of Done, sedangkan bukti aktual diringkas di bagian hasil eksekusi dan
`docs/verification/T08-projects-context.md`. T09 tetap `TODO` dan menjadi task berikutnya; Gate M2
tetap terbuka sampai T08-T12 selesai.

## Hasil eksekusi

- Completed Project sekarang memaksa `is_current=false` tanpa menghapus `end_date` atau
  `end_precision` yang valid; Project current tetap membersihkan end date.
- `create_project_idempotent()` membentuk canonical payload/hash dan menyelesaikan replay ledger
  sebelum lookup Experience live. Replay setelah parent dihapus tetap mengembalikan receipt yang
  sama; payload berbeda tetap `IDEMPOTENCY_KEY_REUSED`.
- `update_project()` memakai lock hierarchy Experience → Project → Activity ketika context berubah,
  tetap mendukung partial patch, dan lulus regression dua session melawan `delete_experience()`.
- Candidate attach memakai exclusion di database, cursor keyset `occurred_on DESC, id DESC`, page
  30, dan UI `Load more` dengan loading/error/retry/end state serta Axe dan viewport 360px.
- Migration `supabase/migrations/20260921090000_t08_review_remediation.sql` diterapkan incremental
  tanpa mengedit tiga migration T08 sebelumnya. Unit/static, active-stack, disposable-stack, build,
  worker, dan seluruh empat suite E2E yang diwajibkan lulus; detail angka dan limitation ada di
  verification T08.

## Tujuan

Menutup empat defect T08 tanpa memperluas scope produk:

- tanggal akhir Project `completed` yang valid tidak lagi dihapus oleh service;
- replay create dengan operation key yang sama tetap mengembalikan receipt awal walaupun Experience
  sumber sudah dihapus setelah commit pertama;
- edit Project dan delete Experience memakai urutan lock yang konsisten sehingga tidak membentuk
  deadlock Experience–Project;
- seluruh Activity owned yang eligible dapat dicapai dari attach/move flow melalui pagination,
  bukan dipotong sebelum filtering.

Remediasi harus mempertahankan ownership session, optimistic revision, atomic context propagation,
retention Activity/Chat/Experience, safe errors, dan seluruh acceptance T06–T08 yang sudah ada.

## Temuan yang diperbaiki

### P1 Service menghapus tanggal akhir Project completed

`normalizeProjectInput()` saat ini mengubah `endDate` dan `endPrecision` menjadi `null` ketika status
`completed`. Form dan schema menerima tanggal akhir, sedangkan SQL hanya memaksa `is_current=false`
untuk status tersebut. Akibatnya create maupun update melalui service dapat kehilangan partial date
yang valid secara diam-diam.

Perilaku target: `completed` memaksa `isCurrent=false`, tetapi tanggal akhir yang diberikan pengguna
tetap tersimpan. Tanggal akhir hanya dibersihkan ketika record benar-benar current.

### P2 Replay create bergantung pada parent yang masih hidup

Versi final `create_project_idempotent()` memvalidasi dan mengunci `p_experience_id` sebelum membaca
operation ledger. Bila request pertama sudah commit, lalu Experience dihapus sehingga Project menjadi
standalone, retry identik menghasilkan `INVALID_PROJECT_INPUT` alih-alih receipt immutable yang sudah
tersimpan.

Perilaku target: payload tetap dinormalisasi dan di-hash secara deterministik; replay ledger dengan
key serta payload yang sama dikembalikan sebelum validasi dependency live. Validasi/lock Experience
hanya berlaku ketika operation ledger benar-benar baru.

### P2 Urutan lock Project dan Experience terbalik

`update_project()` mengunci Project, lalu mengambil lock `FOR SHARE` pada target Experience.
`delete_experience()` yang sudah ada mengunci Experience, lalu Project terkait. Edit Project yang
masih memakai Experience yang bersamaan sedang dihapus dapat membentuk siklus tunggu dan satu
transaksi dibatalkan oleh deadlock detector.

Perilaku target: hierarchy lintas operasi adalah Experience → Project → Activity ketika mutation
memerlukan ketiganya. Operasi yang tidak menyentuh Experience tetap Project → Activity. Perubahan
context dan revision tetap satu transaksi.

### P2 Candidate attach dipotong sebelum filtering

`listRelinkCandidates()` mengambil 100 Activity terbaru lalu membuang row yang sudah terhubung ke
Project target di memory. Bila 100 row terbaru semuanya sudah linked, dialog menyatakan tidak ada
candidate walaupun Activity eligible yang lebih lama masih ada. Batas 100 juga membuat kandidat
setelah batas tidak pernah dapat dicapai.

Perilaku target: exclusion target Project dilakukan pada query database sebelum limit. Kandidat
memakai keyset pagination stabil berdasarkan `occurred_on DESC, id DESC`; UI menyediakan cara memuat
halaman berikutnya tanpa mencetak atau mencatat `raw_text`.

## Acuan wajib

- `AGENTS.md` dan `docs/AGENTS.md`, khususnya ownership, idempotency, revision, transaction/context,
  partial date, privacy, dan verifikasi PostgreSQL nyata.
- `docs/IMPLEMENTATION_STATUS.md`, checkpoint T06–T08, task tracker, dan Gate M2.
- `docs/IMPLEMENTATION_PLAN.md` §1, §3 Ownership/concurrency dan Data karier, §4 operation ledger,
  acceptance T06–T09, serta matriks R04/R06.
- `docs/decisions/0002-foundation-schema.md`, `0004-foundation-create-idempotency.md`,
  `0009-activity-persistence.md`, dan `0012-t08-project-context.md`.
- `docs/verification/T08-implementation-plan.md` dan `T08-projects-context.md`.
- PRD R06; Flow F04/shared recovery; Wireframe S09–S10; Database Schema §§1–3/6; `Design.md` hanya
  untuk state UI/accessibility yang tersentuh.
- Implementasi aktual Project, Activity context, foundation `delete_experience`, operation ledger,
  serta unit/integration/pgTAP/E2E terkait.

## Dependensi dan batas perubahan

Dependensi T01–T07 tetap `DONE`. Saat plan ini ditulis, implementasi dasar T08 berstatus `PARTIAL`;
setelah eksekusi pada 22 September 2026 statusnya kembali `DONE`. T09 tetap `TODO` dan tidak
termasuk dalam pekerjaan ini.

### Termasuk

- Perbaikan normalisasi completed/end date di Project service.
- Migration forward-only baru yang mengganti definisi final `create_project_idempotent()` dan
  `update_project()`; migration T08 lama tidak diedit.
- Klarifikasi lock hierarchy Experience → Project → Activity beserta regression concurrency nyata.
- Candidate query yang mengecualikan target sebelum limit dan keyset pagination owner-scoped.
- State loading/error/end-of-list dan keyboard/focus untuk pagination candidate.
- Regression unit, integration PostgreSQL, pgTAP, browser, accessibility, dan documentation.
- Decision 0013, pembaruan verification T08, status, README, dan plan ini setelah hasil aktual ada.

### Tidak termasuk

- Achievement/skill T09, Evidence T10–T11, Dashboard/Timeline T12, AI, import, CV, export, atau
  account deletion.
- Mengubah status Project di luar `planned`, `active`, `completed`, menambahkan progress, atau
  mewajibkan outcome/end date untuk completed.
- Mengubah semantics detach/delete: Activity tetap dipertahankan, `project_id` dibersihkan, dan
  `experience_id` tetap sesuai contract yang sudah diterima.
- Mengubah source migration `20260920100000`, `20260920101500`, atau `20260920102000` yang sudah
  diterapkan ke stack lokal.
- Menambah dependency, queue, worker job, API publik baru, atau logging private content.
- Reset database WorkPulse aktif, deployment hosted/staging/production, atau klaim performance T24.

## Keputusan teknis yang direncanakan

### 1 Completed mempertahankan historical end date

Ubah normalisasi service sehingga:

- `status === "completed"` hanya menghasilkan `isCurrent=false`;
- `endDate`/`endPrecision` dibersihkan hanya bila input efektif masih current;
- pasangan date/precision, definite range, dan unknown tetap divalidasi schema serta SQL;
- payload hash create merepresentasikan nilai canonical yang benar, termasuk end date completed;
- create dan update memakai helper yang sama agar tidak divergen.

Tambahkan regression pada service boundary, bukan hanya schema, karena defect berada setelah Zod
berhasil. Integration harus membaca ulang row database dan membuktikan precision tersimpan.

### 2 Replay ledger diselesaikan sebelum dependency live

Buat satu migration forward-only baru dengan timestamp setelah tiga migration T08. Pada
`create_project_idempotent()`:

1. validasi actor, operation key, scalar fields, status, serta partial date;
2. bentuk payload canonical dan hash;
3. insert operation ledger `ON CONFLICT DO NOTHING`;
4. jika ledger sudah ada, lock row ledger, bandingkan hash, validasi receipt, lalu kembalikan receipt
   lama tanpa membaca Experience atau Project live;
5. hanya untuk ledger baru, validasi dan lock Experience owned, insert Project, simpan receipt, lalu
   return dalam transaksi yang sama.

Key sama dengan payload berbeda tetap `IDEMPOTENCY_KEY_REUSED`. Ledger incomplete/corrupt tetap
`OPERATION_RESULT_UNAVAILABLE`. Jangan menghidupkan kembali Project yang sudah dihapus atau mengubah
receipt menjadi snapshot row live.

### 3 Lock hierarchy Experience → Project → Activity

Redefine `update_project()` dalam migration yang sama atau migration forward-only berurutan. Untuk
full update dari service, target `experience_id` diketahui dari payload dan dikunci sebelum Project.
Untuk compatibility partial patch yang tidak membawa `experience_id`:

- baca snapshot owner-scoped untuk menentukan candidate Experience tanpa lock sebagai hint;
- lock Experience tersebut bila non-null;
- lock Project dan ulangi pemeriksaan owner/revision;
- bila revision/context berubah saat menunggu, kembalikan `STALE_REVISION` dan jangan mencoba
  melanjutkan dengan lock set yang tidak lengkap.

Setelah Project terkunci, lock linked Activity dalam urutan ID hanya bila Experience berubah, lalu
update Project; trigger propagation tetap menaikkan Activity revision tepat sekali. Pertahankan
compatibility partial patch dan safe missing/foreign behavior.

Jangan mengubah `delete_experience()` tanpa bukti bahwa penyelarasan `update_project()` tidak cukup.
Jika reproduksi menunjukkan operasi lain membentuk siklus, perluas migration secara minimal dan
catat alasan pada decision 0013.

### 4 Candidate attach memakai pagination server-side

Ubah contract candidate menjadi page, minimal `{ items, nextCursor }`, dengan ukuran page 30 agar
konsisten dengan list Activity/Project. Query wajib:

- owner dari session dan predicate `user_id` eksplisit;
- mengecualikan `project_id = targetProjectId` di database sambil tetap memasukkan `project_id IS
  NULL` serta Activity dari Project lain;
- order `occurred_on DESC, id DESC` dan cursor opaque tervalidasi;
- mengambil `pageSize + 1`, lalu membentuk next cursor dari row terakhir yang dirender;
- mengambil title Project lain hanya untuk item halaman saat ini.

UI attach memuat halaman pertama dan menyediakan aksi `Load more`/halaman berikutnya dengan pending,
error + correlation ID, retry, focus, dan end state. Pilih transport terkecil yang mengikuti pola
server action/service saat ini; jangan memuat seluruh Activity tanpa batas ke client. Relink tetap
memakai `expected_revision` milik setiap candidate dan refresh menghapus row yang baru dipindahkan.

## Fase 0 Baseline dan reproduksi test-first

1. Baca semua acuan wajib, periksa `git status --short`, dan pertahankan dirty changes pengguna.
2. Pastikan stack Supabase lokal yang benar aktif. Jangan reset database aktif.
3. Catat baseline aktual dengan exit code dan jumlah test:

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

4. Tambahkan regression yang gagal terhadap implementasi lama:
   - create dan update Project completed dengan end month/day; read-back kehilangan end date;
   - create Project dengan Experience, delete Experience, lalu replay key/payload identik; replay
     gagal alih-alih mengembalikan receipt awal;
   - dua koneksi PostgreSQL mengorkestrasi update Project versus delete Experience dan membuktikan
     urutan lama dapat deadlock/abort;
   - buat lebih dari 100 Activity terbaru yang sudah linked ke target dan satu candidate lebih lama;
     candidate lama tidak muncul pada implementasi lama.
5. Gunakan fixture unik dan cleanup `finally`/transaction rollback. Jangan mencetak token, source
   Activity, title private, atau credential.

Acceptance fase:

- Keempat regression gagal karena perilaku yang ditargetkan, bukan setup.
- Reproduksi concurrency memakai dua session nyata dengan timeout terbatas dan tidak menggantung CI.
- Database aktif tidak di-reset dan tidak ada fixture tertinggal.

## Fase 1 Perbaiki completed date di service

1. Perbaiki helper normalisasi dengan perubahan terkecil.
2. Tambahkan unit/service regression untuk create dan update completed dengan end date.
3. Tambahkan integration read-back untuk precision `month` atau `day`.
4. Verifikasi current Project tetap membersihkan end date dan reversed range tetap ditolak.

Acceptance fase:

- End date/precision completed tersimpan persis dalam bentuk canonical.
- Completed tetap `is_current=false`; outcome tetap opsional.
- Current, unknown, partial pair, dan definite interval tidak regresi.

## Fase 2 Perbaiki replay dan lock order melalui migration baru

1. Tambahkan migration forward-only; jangan mengubah migration historis.
2. Susun ulang create RPC sesuai urutan ledger-first untuk replay.
3. Susun ulang update RPC sesuai hierarchy Experience → Project → Activity.
4. Pertahankan signature/grant/comment, allowlist patch, owner boundary, error code, trigger revision,
   dan receipt shape.
5. Tambahkan pgTAP untuk replay setelah parent deletion dan compatibility partial patch.
6. Tambahkan integration dua koneksi untuk concurrency update/delete; uji kedua kemungkinan winner
   dan pastikan hasil akhir konsisten tanpa deadlock.

Acceptance fase:

- Replay identik mengembalikan ID/user/revision receipt awal tanpa dependency live.
- Changed payload dengan key sama tetap ditolak.
- Fresh create dengan Experience missing/foreign tetap ditolak tanpa disclosure.
- Concurrent update/delete selesai sebagai success atau expected stale conflict, bukan deadlock,
  timeout, atau partial propagation.
- Activity context/revision tetap atomik dan tepat sekali.

## Fase 3 Perbaiki candidate query dan UI pagination

1. Terapkan exclusion target sebelum limit dan cursor validation pada service.
2. Tambahkan page contract dan server boundary untuk halaman berikutnya.
3. Hubungkan attach dialog ke pending/error/retry/end state dan gabungkan item tanpa duplikasi.
4. Setelah relink sukses, hilangkan candidate, refresh linked count/list, dan pertahankan dialog/focus
   secara dapat diprediksi.
5. Tambahkan unit service/query test, integration pagination dengan lebih dari satu halaman, dan E2E
   yang membuktikan candidate di luar 100-row pola lama tetap dapat dicapai.

Acceptance fase:

- Tidak ada false empty ketika eligible Activity masih ada.
- Semua halaman stabil tanpa duplicate/skip pada dataset tidak berubah.
- Foreign Activity/Project tidak pernah muncul atau dapat dipindah.
- UI dapat digunakan dengan keyboard, tidak overflow pada 360px, dan error memiliki reference ID.

## Fase 4 Regression database dari nol

Karena remediasi mengubah SQL/RPC, semua berikut wajib:

1. Terapkan migration baru secara incremental ke stack WorkPulse lokal aktif dengan `migration up`;
   jangan reset stack tersebut.
2. Jalankan pgTAP, DB lint, type generation, dan Project/Activity/Storage integration pada stack aktif.
3. Bandingkan output `pnpm db:types` dengan `src/server/supabase/database.types.ts`. Signature
   diperkirakan tetap sama; jangan membuat diff generated tanpa perubahan nyata.
4. Buat project Supabase disposable terpisah, jalankan migration dari nol, seed, pgTAP, DB lint, dan
   tiga integration suites.
5. Hentikan/hapus hanya resource disposable setelah path/project ID diverifikasi; jangan menyentuh
   volume stack WorkPulse aktif.

Acceptance fase:

- Forward upgrade dan clean rebuild menerapkan seluruh migration berurutan.
- Ledger constraint, grants, RLS, composite ownership, revision, dan context propagation lulus.
- Tidak ada schema lint error atau drift typegen.

## Fase 5 Browser, accessibility, dan penutupan

1. Jalankan kembali seluruh command Fase 0 setelah perubahan.
2. Project E2E mencakup completed end date read-back dan candidate pagination >100-pattern.
3. Jalankan Axe pada attach dialog loading/error/populated state; cek keyboard focus dan viewport
   360/1440 light/dark pada state yang berubah.
4. Buat `docs/decisions/0013-t08-review-remediation.md` berisi completed-date semantics,
   ledger-before-parent replay, lock hierarchy, dan candidate cursor.
5. Perbarui `docs/verification/T08-projects-context.md` dengan before/after, migration, file, command,
   output aktual, clean rebuild, serta limitation.
6. Perbarui plan ini, README, dan `docs/IMPLEMENTATION_STATUS.md`. Kembalikan T08 ke `DONE` dan
   jadikan T09 next task hanya bila semua Definition of Done lulus.

Jangan menyatakan hosted/staging/production atau T24 performance terverifikasi.

## File yang diperkirakan berubah saat eksekusi

Wajib atau sangat mungkin:

- migration baru `supabase/migrations/<timestamp>_t08_review_remediation.sql`
- `src/features/project/project-service.ts`
- `src/domain/project/contracts.ts`
- `src/features/project/project-detail.tsx`
- `src/features/project/actions.ts` dan/atau action boundary kecil untuk candidate pagination
- `src/i18n/messages.ts`
- `supabase/tests/database/project.test.sql`
- `tests/unit/project-validation.test.ts` atau service-focused test baru
- `tests/unit/project-cursor.test.ts` bila cursor candidate memerlukan contract baru
- `tests/integration/project-context.test.ts`
- `tests/e2e/projects-ui.spec.ts`
- `docs/decisions/0013-t08-review-remediation.md`
- `docs/verification/T08-projects-context.md`
- `docs/verification/T08-review-remediation-plan.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `README.md`

Hanya bila dibuktikan perlu:

- `src/domain/project/project-cursor.ts` atau reuse `src/domain/activity/activity-cursor.ts`
- `src/features/project/project-action-contract.ts`
- `src/domain/routes/safe-return.ts` bila pagination state memang perlu berada di URL
- `src/app/(workspace)/projects/[id]/page.tsx`
- `src/server/supabase/database.types.ts` hanya bila regenerated output benar-benar berubah
- `supabase/migrations/...` redefinisi `delete_experience` bila regression menunjukkan penyelarasan
  `update_project` saja tidak menutup cycle.

Tidak diperkirakan berubah:

- tiga migration T08 yang sudah diterapkan;
- package manifest/lockfile;
- worker, Storage implementation, Achievement/Evidence/AI/CV code;
- dokumen sumber PRD, Flow, Wireframe, Database Schema, atau `Design.md`.

## Matriks temuan ke bukti

| Temuan | Fix utama | Bukti wajib |
| --- | --- | --- |
| Completed menghapus end date | Normalisasi hanya membersihkan end ketika current | Unit/service + integration read-back + E2E |
| Replay memvalidasi parent live dahulu | Existing ledger branch sebelum Experience lookup | pgTAP/integration create → delete Experience → replay |
| Project→Experience berlawanan dengan delete | Experience→Project→Activity pada update | Dua-session concurrency tanpa deadlock + state akhir |
| Limit sebelum filter membuat false empty | DB exclusion + cursor page 30 | Unit/integration dataset >100 + E2E load next |
| SQL remediasi merusak baseline | Migration forward-only dan clean rebuild | pgTAP, lint, typegen compare, three integrations |
| UI baru merusak privacy/accessibility | Safe action state dan shared primitives | Axe, keyboard, responsive, no private logs |

## Definition of Done

Remediasi selesai hanya jika:

1. Create dan update Project completed mempertahankan end date/precision yang valid.
2. Completed tetap non-current dan outcome/end date tetap opsional.
3. Replay key/payload identik mengembalikan receipt awal walaupun Experience atau Project live sudah
   berubah/dihapus; changed payload tetap ditolak.
4. Fresh create tetap memvalidasi owned Experience dan profile deletion state.
5. Update Project versus delete Experience tidak deadlock dan menghasilkan state atomik yang valid.
6. Propagation Activity tetap tepat sekali, owner-scoped, dan revision-checked.
7. Semua candidate eligible dapat dicapai melalui pagination; filtering terjadi sebelum limit.
8. Candidate UI memiliki loading, error/reference, retry, keyboard/focus, responsive, dan no-result
   state yang akurat.
9. Migration incremental, clean disposable rebuild, pgTAP, DB lint, typegen comparison, unit,
   Project/Activity/Storage integration, Auth/UI/Activity/Project E2E, build, worker, accessibility,
   responsive, dan diff check memiliki hasil aktual.
10. Tidak ada migration historis, dependency, private log, atau scope T09+ yang ikut berubah.
11. Decision/verification/status diperbarui; T08 baru kembali `DONE` setelah semua butir lulus.

## Prompt eksekusi siap salin

```text
Eksekusi remediasi review T08 berdasarkan
docs/verification/T08-review-remediation-plan.md.

Baca AGENTS.md yang berlaku, docs/IMPLEMENTATION_STATUS.md,
docs/IMPLEMENTATION_PLAN.md §1/§3/§4 dan acceptance T06–T09,
docs/verification/T08-implementation-plan.md,
docs/verification/T08-projects-context.md, serta decisions 0002, 0004,
0009, dan 0012.

Kerjakan test-first dan tutup empat temuan: (1) completed Project harus
mempertahankan valid end date/precision; (2) create replay harus membaca receipt
ledger sebelum memvalidasi Experience live; (3) update Project harus mengikuti
lock hierarchy Experience → Project → Activity agar tidak deadlock dengan
delete_experience; (4) attach candidates harus difilter sebelum limit dan dapat
dipaginasi sampai seluruh owned eligible Activity dapat dicapai.

Gunakan migration forward-only baru; jangan edit tiga migration T08 yang sudah
diterapkan dan jangan reset database WorkPulse aktif. Pertahankan session owner,
expected revision, safe errors, immutable receipt, partial-patch compatibility,
atomic propagation, Activity/Chat retention, serta batas scope T08.

Jalankan seluruh checks Fase 4–5 termasuk clean disposable rebuild dan concurrency
dua session. Buat decision 0013, perbarui verification T08, plan ini, README, dan
IMPLEMENTATION_STATUS. Kembalikan T08 ke DONE dan lanjutkan T09 hanya bila seluruh
Definition of Done lulus; bila ada gate wajib gagal, pertahankan PARTIAL dengan
blocker serta next command konkret.
```

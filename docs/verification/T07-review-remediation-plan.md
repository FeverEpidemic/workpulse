# Rencana Remediasi Review T07 Activity UI

Tanggal: 20 September 2026.

Status: **siap dieksekusi; belum diimplementasikan**. T07 dibuka kembali sebagai `PARTIAL` sampai
seluruh Definition of Done di dokumen ini memiliki bukti aktual. T08 belum dimulai dan Gate M2
tetap terbuka.

## Tujuan

Menutup tiga temuan review pada edit/draft Activity dan error context tanpa memperluas scope produk.
Setelah remediasi:

- draft edit yang dipulihkan tetap terikat pada revision tempat draft dibuat dan tidak dapat
  menimpa revision yang lebih baru tanpa review/rebase eksplisit;
- edit Activity mode Note atau Chat tidak menghapus `role`, `scope`, atau `outcome` yang sudah
  tersimpan, walaupun field tersebut tetap tidak menjadi input create/edit untuk mode minimal;
- kegagalan query Project/Experience memiliki safe code, localized message key, dan correlation ID
  yang diteruskan ke state fatal maupun degraded;
- jalur create, list, detail, pagination, raw-text preservation, Chat history, RLS, dan revision
  conflict T06/T07 tetap tidak berubah.

Remediasi diperkirakan hanya memerlukan TypeScript/UI/tests dan dokumentasi. Jangan membuat
migration atau mengubah RPC/schema kecuali reproduksi membuktikan boundary database tidak cukup.

## Temuan yang diperbaiki

### P1 Draft edit lama mewarisi revision terbaru

`ActivityCaptureForm` memakai draft key berdasarkan owner dan Activity ID. `useSessionDraft()`
memulihkan field lokal, tetapi `expected_revision` sengaja tidak ikut dipersist. Ketika pengguna:

1. mengubah Activity revision 1 tetapi meninggalkan halaman dengan draft tetap tersimpan;
2. revision server berubah menjadi 2 melalui tab lain atau propagation context;
3. kembali ke detail dan membuka Edit;

field draft revision 1 dipulihkan di atas row revision 2, sedangkan hidden `expected_revision`
berasal dari prop server revision 2. Save kemudian berhasil dan dapat menimpa perubahan revision 2
tanpa conflict. Ini melanggar kontrak `expected_revision` dan recovery yang harus mempertahankan
input lokal tanpa silent overwrite.

### P1 Edit Note/Chat dapat menghapus structured fields

Form edit saat ini merender dan mengisi `role`, `scope`, dan `outcome` untuk seluruh capture mode,
tetapi `activityUpdateInputFromForm()` mengubah ketiganya menjadi `null` bila mode immutable bukan
`form`. T06 schema/service mengizinkan row Note/Chat yang sudah memiliki structured fields. Save
terhadap row tersebut—bahkan hanya mengubah `raw_text`—dapat menghapus data canonical secara diam-
diam. Input yang terlihat pada edit Note/Chat juga tampak dapat disimpan walau sebenarnya dibuang.

### P2 Context query failure tidak memiliki correlation ID

`ActivityContextServiceError` hanya memiliki pesan diagnostics tetap. Pada list, error ini memblokir
halaman tetapi `ActivityPageIssue` tidak mendapat reference ID. Pada capture/detail, error ditelan
menjadi boolean `contextOptionsAvailable=false`, sehingga degraded state juga tidak dapat dirujuk.
Kontrak ini menyimpang dari `docs/IMPLEMENTATION_PLAN.md` §3 dan `AGENTS.md`: error harus aman,
terlokalisasi, berkode, dan memiliki correlation ID tanpa membawa data privat/provider message.

## Acuan wajib

- `AGENTS.md` dan `docs/AGENTS.md`.
- `docs/IMPLEMENTATION_STATUS.md`, khususnya checkpoint T07 dan Gate M2.
- `docs/IMPLEMENTATION_PLAN.md` §1, §3 Ownership/concurrency dan error contract, acceptance T06/T07,
  serta matriks R04.
- `docs/verification/T07-implementation-plan.md`, khususnya §§3–7, draft isolation, edit conflict,
  optional fields, dan Definition of Done.
- `docs/verification/T07-activity-ui.md` serta keputusan 0009–0010.
- PRD R04; User Flow F02 dan shared navigation recovery; Wireframe S05/S06; Database Schema
  §§1–3/6; `Design.md` untuk shared states dan aksesibilitas.
- Implementasi aktual pada Activity form/actions/context service, shared session draft, error
  primitives, dan unit/integration/E2E tests terkait.

## Dependensi dan batas perubahan

Dependensi yang sudah `DONE`: T01–T06. T07 tetap menjadi task aktif selama remediasi; T08 tidak
boleh dimulai sebagai bagian pekerjaan ini.

### Termasuk

- Metadata base revision untuk draft edit Activity dan recovery draft legacy/unknown revision.
- Explicit review/rebase atau discard ketika base revision draft berbeda dari row server.
- Preservation structured fields pada update Note/Chat dan edit UI yang konsisten dengan mode
  minimal.
- Safe error contract untuk context options serta rendering reference ID pada fatal/degraded state.
- Regression unit, integration, dan browser E2E untuk tiga temuan.
- Pembaruan decision, verification T07, implementation status, dan README setelah hasil aktual ada.

### Tidak termasuk

- Mengubah create semantics: Note/Chat baru tetap minimal; Form tetap satu-satunya mode yang menerima
  `role`, `scope`, dan `outcome` dari input form.
- Mengubah `capture_mode`, raw text, Chat message pertama, pagination, Activity schema/RPC/RLS/grants,
  operation ledger, atau generated database types.
- Activity delete, Project CRUD/relink T08, achievement, evidence, AI, dashboard/timeline, import,
  CV, export, atau account deletion.
- Menambahkan autosave canonical; draft tetap session-scoped dan save tetap aksi eksplisit.
- Mencatat raw note, structured fields, project label, FormData, token, atau provider/database error.
- Hosted migration, staging, deployment production, atau perubahan dokumen sumber.

## Keputusan teknis yang direncanakan

### 1 Draft edit membawa base revision sebagai metadata

Pertahankan values draft saat ini agar create/profile consumers tidak ikut berubah. Tambahkan
metadata Activity edit yang terpisah dan versioned, owner-scoped serta form-scoped, misalnya melalui
helper shared pada `session-draft.ts`. Metadata minimum hanya berisi schema version dan
`baseRevision`; jangan menyimpan user ID, source text tambahan, atau latest server row.

Contract minimum:

- metadata ditulis ketika Activity edit pertama kali menjadi dirty, menggunakan revision row yang
  menjadi dasar form;
- draft dan metadata dibersihkan bersama pada success, explicit discard, reload server, dan cleanup
  owner saat sign-out;
- metadata bukan authority: owner tetap dari session dan server tetap memeriksa
  `expected_revision`;
- bila draft ditemukan dan `baseRevision === activity.revision`, edit dapat dilanjutkan normal;
- bila base berbeda, local fields tetap terlihat tetapi Submit tidak boleh memakai latest revision
  secara diam-diam. Tampilkan latest server version dan pilihan `Reload server` atau explicit
  `Review and retry my changes` sebelum rebase;
- draft lama tanpa metadata diperlakukan sebagai revision tidak diketahui: jangan membuang input,
  tetapi wajibkan review eksplisit sebelum save;
- setelah explicit retry/rebase, hidden expected revision dan metadata berpindah ke revision yang
  telah dilihat pengguna. Conflict server biasa tetap menangani race baru setelah rebase.

Gunakan conflict presentation Activity yang sudah ada; hindari dialog atau state family baru bila
komponen yang sama dapat membedakan conflict server dan restored-draft mismatch secara jelas.

### 2 Note/Chat minimal tetapi existing structured data dipertahankan

Pisahkan semantics create dan update:

- create Note/Chat tetap mengirim `role`, `scope`, dan `outcome` sebagai `null` agar hidden stale
  draft tidak masuk canonical row;
- create/update Form tetap membaca ketiga field dari `FormData` dan melewati Zod/DB limits;
- update Note/Chat mengambil nilai canonical ketiga field dari current owned Activity yang sudah
  dibaca server action, bukan dari client payload dan bukan menggantinya dengan `null`;
- Activity edit Note/Chat tidak merender ketiga field sebagai editable controls. Detail tetap
  menampilkan nilai existing sebagai read-only bila ada;
- context Project/Experience tetap editable untuk seluruh mode sesuai T07.

Ubah contract parser update agar menerima current owned record atau structured-field snapshot yang
diturunkan darinya. Jangan menerima owner, capture mode, atau existing structured values dari hidden
client fields. Server action saat ini sudah membaca Activity owned sebelum update; gunakan hasil itu
tanpa query tambahan.

### 3 Error context mengikuti contract bersama

Tambahkan contract sempit pada `ActivityContextServiceError`:

- code aman, minimal `UNAVAILABLE`;
- `messageKey`, gunakan key context-unavailable yang sudah ada bila copy sesuai;
- UUID correlation ID acak per error instance;
- `Error.message` diagnostics generik, tanpa Supabase message, query, owner ID, atau label context.

Jangan membuat correlation ID baru berulang kali saat error yang sama diteruskan. Pada caller:

- list yang tidak dapat memuat options meneruskan `messageKey` dan `correlationId` ke
  `ActivityPageIssue`;
- capture/detail tetap usable dengan options kosong, tetapi degraded state menampilkan localized
  message dan reference ID melalui primitive error/inline state bersama;
- missing/foreign Activity semantics tetap indistinguishable dan tidak memakai context error untuk
  membocorkan keberadaan record.

## Fase 0 Baseline dan reproduksi test-first

1. Baca acuan wajib, periksa `git status --short`, dan pertahankan seluruh perubahan pengguna.
2. Pastikan Docker/Supabase lokal tersedia sebelum database/browser checks. Jangan reset database
   WorkPulse aktif.
3. Catat baseline dengan exit code dan jumlah test aktual:

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

4. Tambahkan regression yang gagal terhadap implementasi lama:
   - restore draft edit revision 1 pada page yang sekarang memuat revision 2; local input tetap ada
     tetapi tidak boleh save menggunakan revision 2 tanpa review;
   - create/fixture Note atau Chat dengan structured fields, edit source/context, lalu buktikan
     structured fields tidak berubah;
   - context query error memiliki safe code, localized key, UUID correlation ID, dan UI fatal/
     degraded menampilkan reference ID.
5. Fixture browser/database harus owner-scoped, dibersihkan di `finally`, dan tidak mencetak note,
   token, key, atau full provider error.

Acceptance fase:

- Ketiga regression gagal karena perilaku yang tepat, bukan karena fixture/setup.
- Baseline failure yang sudah ada dipisahkan dari perubahan remediasi.
- Tidak ada fixture atau perubahan database yang tertinggal.

## Fase 1 Perbaiki draft revision dan conflict recovery

1. Tambahkan helper metadata draft dengan API sekecil mungkin; consumer non-Activity mempertahankan
   perilaku dan format values saat ini.
2. Hubungkan Activity edit ke base revision metadata dan lifecycle cleanup.
3. Deteksi restored draft mismatch sebelum save; pertahankan DOM/local draft.
4. Reuse latest-version conflict panel untuk explicit reload/retry. Submit normal tidak boleh
   mengangkat expected revision otomatis.
5. Setelah user memilih retry, rebase metadata dan expected revision secara eksplisit; race berikutnya
   tetap menghasilkan server conflict.
6. Pastikan cancel edit yang berarti discard membersihkan values dan metadata, sedangkan navigasi
   `Continue without saving` tetap mempertahankan keduanya.

Test minimum:

- helper key/metadata owner isolation, malformed metadata, cleanup, dan legacy missing metadata;
- same-revision restore dapat save normal;
- different/unknown revision restore mempertahankan field dan memblokir silent save;
- reload membuang local draft; explicit retry menyimpan local fields setelah review;
- server berubah lagi setelah rebase menghasilkan conflict kedua, bukan silent overwrite;
- create draft, profile drafts, Back/Forward guard, dan sign-out cleanup tidak regresi.

## Fase 2 Perbaiki structured-field preservation

1. Ubah update action contract agar current owned Activity menjadi source structured fields pada
   Note/Chat.
2. Pertahankan input parsing Form dan canonical trim/null behavior melalui schema T06.
3. Sembunyikan/omit editable structured controls pada edit Note/Chat; jangan mengirim hidden copies
   dari client.
4. Pertahankan read-only detail untuk nilai existing.
5. Tambahkan unit tests untuk payload injection dan integration/browser regression untuk
   round-trip preservation.

Test minimum:

- create Note/Chat tetap men-null-kan stale hidden optional values;
- update Form memakai submitted role/scope/outcome;
- update Note/Chat mengabaikan submitted/injected optional values dan mempertahankan current
  canonical values;
- edit hanya source/date/context pada Note/Chat tidak mengubah structured fields atau Chat history;
- limits/blank normalization Form tetap sama.

## Fase 3 Perbaiki context error dan UI reference

1. Tambahkan safe error properties dan UUID generation pada context service.
2. Pastikan query result error, rejected request, dan unexpected exception dipetakan sekali ke
   contract yang sama.
3. Teruskan error object ke list/capture/detail tanpa raw provider details.
4. Render fatal list error dan degraded capture/detail dengan localized copy, correlation ID, serta
   semantic role yang sesuai; manual capture tanpa context options tetap dapat disimpan.
5. Tambahkan unit/static-render test untuk error contract dan reference ID. Tambahkan browser case
   hanya bila kegagalan context dapat diinjeksi deterministically tanpa mengubah policy/schema.

Acceptance fase:

- Setiap failure context memiliki code, message key, dan UUID correlation ID unik.
- UI menampilkan reference ID yang sama dari service error, bukan UUID baru di caller.
- Provider/database message dan private values tidak tampil atau masuk log.
- Capture tetap usable dengan Project/Experience controls unavailable.

## Fase 4 Regression lengkap dan penutupan

Jalankan kembali seluruh command Fase 0 dan catat hasil aktual. Ketentuan tambahan:

1. Activity E2E mencakup restored-draft revision mismatch, explicit retry/reload, structured-field
   preservation, keyboard/focus, serta 360/1440 light/dark pada state yang berubah.
2. Axe dijalankan pada restored-draft conflict dan degraded context state yang dapat dibuat secara
   deterministik.
3. Activity integration tetap membuktikan two-account ownership, idempotency, raw text/Chat,
   revision conflict, context propagation, dan pagination.
4. Storage integration dan pgTAP tetap lulus karena working tree memuat T05–T06 yang belum di-commit.
5. `pnpm db:types` dan clean disposable rebuild tidak diperlukan bila schema/RPC/SQL tidak berubah.
   Bila SQL ternyata perlu berubah, hentikan asumsi ini, gunakan migration forward-only, jalankan
   forward upgrade serta clean rebuild, dan compare generated types.
6. Jangan menyatakan hosted/staging/production terverifikasi.

Setelah checks lulus:

1. Tambahkan `docs/decisions/0011-t07-review-remediation.md` yang mencatat base-revision draft,
   preservation mode minimal, dan context error propagation.
2. Perbarui `docs/verification/T07-activity-ui.md` dengan reproduksi before/after, files, tests,
   accessibility, dan limitation aktual.
3. Perbarui dokumen ini dengan hasil eksekusi aktual.
4. Kembalikan T07 ke `DONE`, perbarui README/status, dan jadikan T08 next task hanya setelah seluruh
   Definition of Done lulus.

## File yang diperkirakan berubah saat eksekusi

Wajib atau sangat mungkin:

- `src/components/forms/session-draft.ts`
- `src/features/activity/activity-capture-form.tsx`
- `src/features/activity/activity-action-contract.ts`
- `src/features/activity/actions.ts`
- `src/features/activity/activity-context-service.ts`
- `src/app/(workspace)/activity/page.tsx`
- `src/app/(workspace)/activity/new/page.tsx`
- `src/app/(workspace)/activity/[id]/page.tsx`
- `src/features/activity/activity-detail.tsx`
- `tests/unit/session-draft.test.ts`
- `tests/unit/activity-action-contract.test.ts`
- unit test context-error baru atau file terarah ekuivalen
- `tests/e2e/activity-ui.spec.ts`
- `docs/decisions/0011-t07-review-remediation.md`
- `docs/verification/T07-activity-ui.md`
- `docs/verification/T07-review-remediation-plan.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `README.md`

Hanya bila dibuktikan perlu:

- `src/features/activity/activity-page-issue.tsx` atau shared context-issue component kecil;
- `src/i18n/messages.ts` bila key/copy existing tidak cukup; parity `en`/`id` wajib;
- `tests/e2e/app-frame.spec.ts` dan `tests/e2e/auth-profile.spec.ts` bila shared draft cleanup berubah;
- `src/domain/activity/` hanya bila pure helper membuat revision-state lebih mudah diuji.

Tidak diperkirakan berubah:

- migration T01–T06, SQL tests, RPC, RLS, grants, dan generated database types;
- package manifest/lockfile;
- worker, Storage implementation, Project/Achievement/AI code;
- dokumen sumber PRD, Flow, Wireframe, Database Schema, dan `Design.md`.

## Matriks temuan ke bukti

| Temuan | Fix utama | Bukti wajib |
| --- | --- | --- |
| Draft revision lama memakai revision terbaru | Metadata base revision + explicit rebase | E2E leave draft → concurrent edit → reopen; local retained, no silent save |
| Draft legacy tidak memiliki base revision | Treat unknown as review-required | Unit legacy payload + browser recovery tanpa membuang input |
| Note/Chat update meng-null-kan structured fields | Preserve current owned canonical values | Unit injected payload + integration/E2E round-trip |
| Note/Chat menampilkan control yang tidak disimpan | Omit editable structured controls | Browser assertion controls absent; detail values tetap visible |
| Context failure tanpa reference | Safe context error + propagation | Unit UUID/code/key + render fatal/degraded reference ID |
| Remediasi merusak create/profile draft | API metadata opt-in dan regression | Existing unit/Auth/UI E2E tetap lulus |
| Remediasi merusak privacy/schema | Session owner + server revision tetap authority | Two-account integration, pgTAP, DB lint, no schema diff |

## Definition of Done

Remediasi selesai hanya jika:

1. Restored Activity edit draft tidak pernah otomatis memakai revision server yang lebih baru.
2. Local input dipertahankan dan pengguna melihat latest server version sebelum explicit rebase.
3. Race setelah rebase masih menghasilkan conflict normal.
4. Edit Note/Chat tidak menghapus existing `role`, `scope`, atau `outcome`; controls yang tidak dapat
   disimpan tidak dirender sebagai editable.
5. Create Note/Chat tetap minimal dan Form optional fields tetap valid/teruji.
6. Context failures memiliki safe code, localized key, correlation ID, dan UI reference yang sama.
7. Tidak ada private content/provider detail dalam error, metadata draft, log, atau dokumentasi test.
8. Unit, Activity/Storage integration, build, worker, pgTAP, DB lint, migration list, Auth/UI/Activity
   E2E, accessibility, responsive, dan diff check memiliki hasil aktual.
9. Tidak ada migration, typegen, dependency, atau scope T08+ tanpa bukti kebutuhan dan keputusan baru.
10. Decision/verification/status diperbarui; T07 baru kembali `DONE` dan T08 baru menjadi next task
    setelah semua butir di atas lulus.

## Prompt eksekusi siap salin

```text
Eksekusi remediasi review T07 berdasarkan
docs/verification/T07-review-remediation-plan.md.

Baca AGENTS.md yang berlaku, docs/IMPLEMENTATION_STATUS.md,
docs/IMPLEMENTATION_PLAN.md bagian 1/3 dan acceptance T06/T07,
docs/verification/T07-implementation-plan.md,
docs/verification/T07-activity-ui.md, serta decisions 0009–0010.

Perbaiki tiga temuan tanpa memulai T08: (1) draft edit Activity harus membawa
base revision dan wajib explicit review/rebase bila revision server berubah atau
metadata draft legacy tidak diketahui; (2) update Note/Chat harus mempertahankan
role/scope/outcome existing dari current owned row dan tidak merender control yang
tidak dapat disimpan; (3) context-option failures harus memiliki safe code,
localized key, UUID correlation ID, serta reference yang diteruskan ke fatal dan
degraded UI.

Kerjakan test-first sesuai Fase 0. Pertahankan local input, server session/expected
revision sebagai authority, Note/Chat create minimal, Form optional fields, raw
text exact, original Chat history, ownership, dan privacy. Jangan edit migration
historis atau menambah schema/dependency kecuali reproduksi membuktikan perlu.

Jalankan seluruh checks Fase 4 dan catat hasil aktual. Buat decision 0011,
perbarui verification T07, plan ini, README, dan IMPLEMENTATION_STATUS. Kembalikan
T07 ke DONE dan lanjutkan next task T08 hanya bila seluruh Definition of Done
lulus; bila ada gate wajib terblokir, pertahankan PARTIAL dengan blocker serta
next command konkret.
```

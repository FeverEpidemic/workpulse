# T11 Evidence UI dan lifecycle — rencana eksekusi multi-agent

Tanggal rencana: 26 September 2026

Status task: **TODO — plan ready, implementation belum dimulai**

Orchestrator: **GPT-5.6 Sol**

Sub-agent: **GPT-6 Luna sebagai Explorer dan Coder**

Dependensi: T10 **DONE** pada acceptance lokal; T05 dan T09 **DONE**

Acuan: R07, F05, S06/S08/S10, Database §4/§6, `IMPLEMENTATION_PLAN.md` §1/§3/§4/T11,
decision 0016, serta bukti T10.

## 1. Outcome yang harus dihasilkan

T11 menambahkan satu kontrol attachment reusable pada detail Activity, Achievement, dan Project.
Kontrol tersebut harus memakai kontrak backend T10 dan memperlihatkan state server sebenarnya:
`uploading`, `scanning`, `ready`, `failed`, dan `deleting`. Pengguna dapat mengunggah file privat,
mengunduh file `ready`, menghapus file melalui konfirmasi bernama, mencoba lagi dengan reservation
baru, serta memindahkan evidence langsung dari Activity ke derived Achievement miliknya secara
atomik.

Task hanya boleh ditandai DONE setelah bukti lokal menunjukkan bahwa:

1. file tidak pernah ditampilkan sebagai `ready` hanya karena request upload selesai;
2. retry file gagal membuat reservation dan idempotency key baru, bukan menimpa object lama;
3. move ke Achievement yang sudah memiliki tiga slot aktif ditolak tanpa mengubah source row,
   object key, hash, bytes, quota akun, atau kemampuan download file asal;
4. penghapusan parent segera menolak penerbitan URL baru dan meninggalkan cleanup receipt yang
   dapat diproses worker;
5. evidence Project hanya tampil dan dihitung sebagai direct Project evidence, tidak diwariskan
   sebagai direct Achievement evidence;
6. kontrol dapat digunakan dengan keyboard pada 360 px dan 1440 px dalam tema light/dark;
7. alur manual T07–T09 tetap berfungsi ketika scanner atau worker tidak tersedia.

Gate M2 tetap terbuka setelah T11; T12 yang menutup paket Dashboard dan Timeline.

## 2. Sumber dan keputusan scope

### 2.1 Trace requirement

| Sumber | Kontrak T11 |
| --- | --- |
| PRD R07 | File privat melekat tepat ke Activity, Achievement, atau Project; tipe/size divalidasi; download/delete owner-only; evidence tidak dikirim ke AI. |
| PRD file safety | PDF/PNG/JPEG/DOCX; lebih dari 0 sampai 10 MiB/file; 3 file/parent; 50 MiB/account; quarantine sampai screening lolos; signed URL maksimal 5 menit; tanpa inline preview dokumen aktif. |
| F05 | Reservation sebelum upload; state pending sampai ready; failure menawarkan Retry/Remove; delete menutup akses baru; move eksplisit dan atomik dengan validasi kapasitas destination. |
| S06 | Daftar evidence pada Activity dan aksi `Move to achievement` hanya ketika derived Achievement yang sesuai tersedia. |
| S08 | Daftar evidence hanya direct Achievement evidence; pending/failed tidak dihitung sebagai supporting evidence. |
| S10 | Pending dan ready evidence Project dibedakan; dependency preview delete mencantumkan direct attachment. |
| Database §4/§6 | Exactly-one parent, owner-scoped access, lock quota/parent, cleanup queue bertahan setelah parent hilang, client tidak menulis lifecycle worker secara langsung. |

### 2.2 Keputusan implementasi yang dibekukan

- UI move T11 hanya **Activity → derived Achievement dari Activity yang sama**. Tidak ada generic
  reparenting, move Project, copy, atau transfer lintas akun. F05 memakai istilah “between”, tetapi
  acceptance task dan S06 meminta aksi forward ini; reverse move tidak diperlukan untuk DONE T11.
- Hanya evidence `ready` yang dapat dipindahkan. `uploading`/`scanning` sedang memiliki pekerjaan
  aktif; `failed` harus Retry/Remove; `deleting` tidak dapat dimutasi. RPC mengembalikan conflict
  aman untuk state lain.
- Move mempertahankan `id`, `object_key`, bytes, SHA-256, timestamps awal, dan total bytes akun.
  Move hanya mengganti kolom parent, merekam revision baru, dan tidak membuat cleanup/scan job.
- Slot destination menghitung `uploading`, `scanning`, dan `ready`, sama seperti reservation T10.
  `failed` dan `deleting` tidak mengonsumsi slot logis.
- Listing parent dikembalikan oleh boundary evidence owner-scoped. Client tidak mengirim atau
  dipercaya menentukan `user_id`.
- Status `deleting` boleh tampil read-only sampai row dibersihkan; tidak ada Download/Retry/Move.
- Polling hanya berjalan saat ada `uploading` atau `scanning`, berhenti saat terminal, component
  unmount, atau tab tidak aktif, dan tidak mengubah status secara optimistik menjadi `ready`.
- Delete file menggunakan filename pada dialog. Parent delete menggunakan jumlah direct attachment,
  bukan jumlah evidence turunan atau evidence Project yang terkait secara konteks.
- Tidak membuat Evidence Library terpisah. Bagian Evidence Library di `Design.md` berada di luar
  scope MVP yang sudah diputuskan di `IMPLEMENTATION_PLAN.md` §1.
- Tidak ada evidence preview, thumbnail aktif, AI analysis, link evidence, public share, OCR,
  export evidence ke CV/PDF, atau perubahan T12 Dashboard.

Jika pemeriksaan SQL menemukan bahwa pembatasan `ready` bertentangan dengan invariant worker T10,
Explorer menghentikan handoff dan mengirim temuan kepada orchestrator. Orchestrator tidak boleh
diam-diam memperluas operasi move.

## 3. Topologi agent dan aturan orkestrasi

Gunakan maksimum empat slot aktif:

| Slot | Model/peran | Tanggung jawab |
| --- | --- | --- |
| 1 | GPT-5.6 Sol — orchestrator | Baseline, contract freeze, pembagian file, integrasi, review diff, menjalankan acceptance, dokumentasi/status. |
| 2 | GPT-6 Luna — Explorer | Read-only audit sebelum coding; setelah coding menjadi reviewer read-only. |
| 3 | GPT-6 Luna — Coder A | Database, repository, service, dan HTTP/API evidence. |
| 4 | GPT-6 Luna — Coder B | Komponen UI reusable, dictionary/CSS, unit UI, dan E2E fixture/spec yang dimilikinya. |

Semua agent berbagi workspace. Tidak ada worktree terpisah. Karena working tree saat plan dibuat
sudah berisi perubahan T07–T10 yang belum seluruhnya committed, setiap agent wajib:

- membaca `git status --short` sebelum bekerja;
- tidak reset, checkout, stash, reformat massal, atau menghapus perubahan yang bukan miliknya;
- menyebut file yang akan disentuh sebelum edit;
- memakai `apply_patch` untuk edit manual;
- menghentikan diri bila file yang dialokasikan berubah oleh agent lain saat sedang dikerjakan;
- menyerahkan receipt berisi file, migration, commands, hasil aktual, risiko, dan pekerjaan tersisa;
- tidak menandai task DONE dan tidak mengedit `IMPLEMENTATION_STATUS.md` atau Notion; itu hanya milik
  orchestrator.

### 3.1 Urutan wave

```text
Wave 0  Sol baseline dan scope lock
   ↓
Wave 1  Luna Explorer audit read-only
   ↓  receipt disetujui Sol
Wave 2  Sol membekukan contract dan file ownership
   ↓
Wave 3  Luna Coder A ─────┐
        Luna Coder B ─────┼─ paralel pada file yang tidak overlap
        Sol review awal ──┘
   ↓
Wave 4  Sol mengintegrasikan tiga host screen dan shared seams
   ↓
Wave 5  Luna Explorer melakukan review read-only terhadap diff terintegrasi
   ↓
Wave 6  Sol memperbaiki temuan, menjalankan acceptance penuh, dan menulis bukti/status
```

Coder tidak dimulai sebelum Explorer menyerahkan audit. Host wiring baru dimulai setelah kontrak
API/props stabil. Satu writer saja untuk `src/i18n/messages.ts`, `src/app/globals.css`, generated DB
types, host detail components, package scripts, dan dokumen.

## 4. Prompt agent yang siap dipakai

### 4.1 Prompt Luna Explorer

> Audit T11 secara read-only. Baca AGENTS.md, docs/IMPLEMENTATION_STATUS.md bagian authoritative,
> docs/IMPLEMENTATION_PLAN.md §1/§3/§4/T11, decision 0016, verification T10, serta ekstrak R07/F05/
> S06/S08/S10/Database §4/§6 dari DOCX dengan alat dokumen. Periksa SQL T10 untuk lock order,
> parent-delete trigger, slot/quota count, queue receipt, RLS dan error token; periksa repository,
> service/API, tiga detail screen, i18n/CSS dan tests. Jangan edit. Laporkan: baseline, exact gap,
> proposal list/move contract, lock order, file ownership map, acceptance matrix, risiko regresi,
> dan blocker. Bedakan fakta kode dari rekomendasi.

Explorer lulus bila receipt menjawab:

- apakah ketiga delete path benar-benar memicu cleanup sebelum FK/source hilang;
- urutan lock T10 yang wajib dipakai move agar tidak deadlock dengan reserve/delete;
- bagaimana parent revision diverifikasi tanpa mempercayai payload owner;
- apakah listing aman menyertakan `deleting` dan mengabaikan record account lain;
- command nyata dari `package.json` dan kebutuhan environment lokal.

### 4.2 Prompt Luna Coder A

> Implementasikan slice backend T11 sesuai plan yang sudah dibekukan. Ownership file: migration
> T11 dan pgTAP evidence; src/features/evidence contracts/service/errors/http; evidence repository;
> route listing dan move; integration/unit backend yang terkait. Jangan sentuh tiga host component,
> messages, CSS, Playwright UI, docs/status, atau file agent lain. Tambahkan list-by-parent owner-scoped
> dan move ready Activity→derived Achievement yang atomik. Gunakan session identity, expected
> evidence revision dan destination parent revision, lock order konsisten T10, destination slot
> check, immutable object identity, safe error mapping, dan no-store. Migration forward-only;
> jangan reset database aktif. Jalankan checks scoped yang tersedia dan serahkan receipt lengkap.

### 4.3 Prompt Luna Coder B

> Implementasikan slice UI T11 sesuai contract/API fixture yang diberikan orchestrator. Ownership
> file: komponen baru di src/features/evidence untuk attachment control dan helper client; keys
> evidence di src/i18n/messages.ts; CSS evidence di globals.css; unit UI/client; fixture dan spec
> Playwright evidence UI baru. Jangan sentuh SQL, repository/service/routes, generated DB types,
> tiga host detail component, docs/status, atau file agent lain. Render uploading/scanning/ready/
> failed/deleting sebagai teks dan warna; polling hanya untuk pending; upload reserve→PUT→refresh;
> retry membuat reservation/idempotency key baru; ready-only download; named remove; optional
> activity-to-achievement move control; preserve input/error; keyboard/focus/aria-live/reduced motion;
> 360/1440 light/dark. Jangan preview file atau menyatakan claim terverifikasi. Gunakan mock API
> contract hanya di unit test, bukan production. Jalankan checks scoped dan serahkan receipt.

### 4.4 Prompt Luna reviewer setelah integrasi

> Review diff T11 secara read-only terhadap R07/F05/S06/S08/S10 dan plan. Cari P0–P2 saja:
> authorization leak, direct-table lifecycle write, non-atomic move, lock-order/deadlock risk,
> slot/quota salah, stale revision, object overwrite, polling leak, false ready, missing named
> confirmation, inaccessible control, Project evidence diwariskan ke Achievement, parent deletion
> tidak menutup URL baru, atau bukti test yang tidak mendukung klaim. Sertakan file dan line yang
> tepat, reproduction, serta acceptance yang dilanggar. Jika tidak ada temuan, sebut checks yang
> masih belum dibuktikan; jangan edit.

## 5. Kontrak teknis yang akan dibangun

### 5.1 Listing parent

Perluas collection endpoint evidence:

```text
GET /api/evidence?parentKind=activity|achievement|project&parentId=<uuid>
→ { items: EvidencePublicRecord[] }
```

- Validasi query dengan Zod dan canonical UUID.
- Resolve owner dari session dan profile aktif.
- Repository memanggil RPC/list query yang memvalidasi owned parent terlebih dahulu agar record
  akun lain dan ID parent tidak dapat dibedakan oleh respons.
- Urutan stabil `created_at ASC, id ASC`; maksimum tiga active slot, tetapi response dapat mencakup
  row failed/deleting yang masih ada.
- Response tidak memuat `object_key`, SHA-256, scan job, internal error detail, atau `user_id`.
- `Cache-Control: no-store` dan error contract T10 tetap dipakai.

`EvidencePublicRecord` harus cukup untuk UI: id, filename, contentType, bytes, status, revision,
reservation expiry, created/updated timestamp, dan safe failure code. Parent identity tidak perlu
dikirim kembali bila endpoint sudah scoped ke parent.

### 5.2 Move evidence

Endpoint yang direkomendasikan:

```text
POST /api/evidence/:id/move
{
  "targetAchievementId": "<uuid>",
  "expectedRevision": 3,
  "expectedTargetRevision": 5
}
→ EvidencePublicRecord
```

RPC forward-only `move_activity_evidence_to_achievement` wajib:

1. resolve actor dari argument server yang berasal dari session;
2. lock profile/account active menggunakan urutan T10;
3. lock evidence source dan pastikan owner, status `ready`, serta parent saat ini Activity;
4. lock Activity lalu derived Achievement yang `achievement.activity_id = activity.id` dan owner
   sama, memakai urutan ID deterministik bila protokol T10 mengharuskannya;
5. validasi evidence `expected_revision` dan Achievement `expectedTargetRevision`;
6. hitung slot destination aktif di bawah lock; bila sudah tiga, raise token
   `EVIDENCE_SLOT_LIMIT` sebelum mutation;
7. update exactly-one parent columns, `parent_revision`, evidence revision, dan `updated_at` dalam
   transaksi yang sama;
8. tidak mengubah object, bytes, hash, account quota, scan job, atau membuat cleanup receipt;
9. return public row yang telah dipindah.

Replay dengan revision lama menghasilkan conflict. Cross-owner, unrelated Achievement, source yang
sudah dipindah/dihapus, atau ID tidak valid memakai error aman yang tidak membocorkan keberadaan.
Race move-vs-delete menghasilkan tepat salah satu hasil: move committed pada parent valid, atau
conflict/not-found tanpa orphan dan tanpa row setengah berubah.

### 5.3 Matrix state dan aksi UI

| State | Label wajib | Download | Remove | Retry | Move |
| --- | --- | --- | --- | --- | --- |
| uploading | Uploading | Tidak | Ya | Tidak | Tidak |
| scanning | Scanning | Tidak | Ya | Tidak | Tidak |
| ready | Ready | Ya | Ya | Tidak | Ya, hanya pada S06 dengan derived Achievement |
| failed | Failed + pesan aman | Tidak | Ya | Ya, reservation baru | Tidak |
| deleting | Removing | Tidak | Tidak | Tidak | Tidak |

Status selalu memiliki text, tidak hanya badge color. `aria-live=polite` mengumumkan perubahan
state tanpa memindahkan fokus. Aksi yang sedang berjalan disabled per item, bukan seluruh halaman.

### 5.4 Upload dan retry

1. File input menyebut format dan limit sebelum pemilihan.
2. Client check ukuran/type hanya feedback cepat; server tetap otoritatif.
3. Generate idempotency key per reservation attempt.
4. `POST /api/evidence` dengan parent kind/id, filename, declared MIME/bytes, parent revision.
5. `PUT /api/evidence/:id/upload` dengan exact bytes dan evidence revision dari reserve response.
6. Tampilkan response server; setelah finalize normalnya `scanning`, bukan `ready`.
7. Poll collection saat pending sampai worker mengubah state. Gunakan backoff terbatas dan tombol
   refresh ketika provider/worker unavailable.
8. Retry failed membuat reservation baru. Bila `File` object tidak lagi tersedia setelah reload,
   buka picker dan jelaskan bahwa file perlu dipilih lagi.

Jangan menyimpan file contents, filename, atau URL signed dalam log/analytics/session storage.

### 5.5 Download dan remove

- Download hanya memanggil owner-authorized endpoint untuk `ready`, lalu menjalankan attachment
  download dari URL short-lived. Tidak menampilkan document inline dan tidak menyimpan URL.
- Named remove menampilkan filename dan menjelaskan bahwa parent tetap ada. Setelah DELETE sukses,
  tampilkan `deleting` sampai list tidak lagi mengembalikan row. Penerbitan URL baru harus gagal
  segera; URL lama dibatasi maksimum 300 detik sesuai provider.
- Conflict mempertahankan item/input lokal, refreshes server list, dan memberi aksi retry yang jelas.

### 5.6 Integrasi screen

**S06 Activity detail**

- Mount attachment control setelah source/context dan sebelum/berdekatan dengan Achievement card.
- Parent adalah Activity aktual; `expectedParentRevision = activity.revision`.
- Berikan target move hanya bila derived Achievement yang dimuat memiliki `activity_id` yang sama.
- Delete preview menampilkan direct evidence count dan menyatakan direct files akan dihapus sementara
  derived Achievement tetap dipertahankan.

**S08 Achievement detail**

- Parent adalah Achievement aktual dan evidence hanya direct rows.
- `ready` direct count dapat dipakai label evidence; Project/Activity attachments tidak digabung.
- Delete preview menyebut direct evidence yang akan dihapus dan Activity sumber tetap dipertahankan.

**S10 Project detail**

- Parent adalah Project aktual; pending dan ready dipisahkan secara visual di control yang sama.
- Delete preview mencantumkan direct Project attachments yang akan dihapus, sementara Activity dan
  Achievement terkait dipertahankan sesuai T08/T09.
- Tidak ada Move to Achievement dari Project.

Orchestrator melakukan host wiring karena ketiga file ini juga menjadi seam T07–T09 dan rawan
conflict. Data initial list dapat dimuat paralel dengan detail page, tetapi semua mutation tetap
melalui evidence boundary T10/T11.

## 6. Paket kerja dan ownership file

### T11.0 Baseline dan audit — Sol + Explorer

- Snapshot `git status`, migration parity, stack status, scripts nyata, dan file collision.
- Audit source DOCX dan current code; jangan memakai status historis sebagai authoritative state.
- Pastikan T10 DONE lokal dan tidak ada kebutuhan layanan eksternal.
- Output: receipt Explorer dan contract freeze dari Sol.

### T11.1 Database list/move — Coder A

File perkiraan:

- `supabase/migrations/<timestamp>_t11_evidence_ui_lifecycle.sql`
- `supabase/tests/database/evidence.test.sql`
- generated `src/server/supabase/database.types.ts` oleh orchestrator setelah migration stabil

Acceptance slice:

- list owner-scoped untuk ketiga parent;
- ready-only move Activity→derived Achievement;
- destination full dan concurrent last slot aman;
- cross-owner/unrelated target ditolak;
- parent delete/move race konsisten;
- immutable object/quota terbukti;
- migration forward-only, active DB tidak di-reset.

### T11.2 Server contract/API — Coder A

File perkiraan:

- `src/features/evidence/contracts.ts`
- `src/features/evidence/evidence-errors.ts`
- `src/features/evidence/evidence-service.ts`
- `src/features/evidence/http.ts` bila helper query diperlukan
- `src/server/storage/evidence-repository.ts`
- `src/app/api/evidence/route.ts`
- `src/app/api/evidence/[id]/move/route.ts`
- unit/integration evidence backend terkait

Acceptance slice:

- bounded validation, no-store, session-derived owner, safe localized errors;
- list tidak bocor internal fields;
- move memakai dua expected revisions dan mapping conflict/slot/not-found yang aman;
- API lama reserve/upload/download/delete tidak regresi.

### T11.3 Reusable attachment control — Coder B

File perkiraan:

- `src/features/evidence/evidence-attachments.tsx`
- helper client/hook kecil di `src/features/evidence/` bila diperlukan
- `src/i18n/messages.ts`
- `src/app/globals.css`
- `tests/unit/evidence-*.test.tsx`

Acceptance slice:

- semua state dan action matrix ter-render;
- upload/retry/poll/download/remove/move mengikuti kontrak;
- filename panjang, Unicode, dan pesan id/en tidak merusak layout;
- keyboard, focus, live region, disabled/loading/error, reduced motion;
- tidak ada preview, fake success, atau object URL yang bocor.

### T11.4 Host wiring dan lifecycle delete — Sol

File perkiraan:

- tiga route detail di `src/app/(workspace)/.../[id]/page.tsx`
- `src/features/activity/activity-detail.tsx`
- `src/features/achievement/achievement-detail.tsx`
- `src/features/project/project-detail.tsx`
- service/domain contracts hanya bila data count tidak bisa disediakan tanpa perubahan kecil

Acceptance slice:

- initial evidence load gagal tidak menyembunyikan canonical parent record;
- attachment control memakai parent revision terbaru;
- delete preview direct count benar;
- Project evidence tidak muncul/terhitung pada Achievement;
- existing returnTo, edit, conflict, dan named delete behavior tetap utuh.

### T11.5 Browser acceptance — Coder B + Sol

File perkiraan:

- `tests/e2e/evidence-ui.spec.ts`
- `tests/evidence-fixtures.ts`
- `playwright.evidence.config.ts`
- existing Activity/Achievement/Project specs hanya bila assertion regresi perlu ditambah

Gunakan private local Storage dan real local ClamAV untuk jalur clean/failed screening bila
environment tersedia. Mock network boleh untuk unit component state, bukan bukti integration DONE.

### T11.6 Review, docs, dan checkpoint — Explorer + Sol

- Explorer melakukan review read-only P0–P2.
- Sol memperbaiki temuan dan mengulang affected checks.
- Buat/ubah decision bila lock/move policy menambah keputusan arsitektur material.
- Tulis `docs/verification/T11-evidence-ui-lifecycle.md` berisi hasil aktual.
- Update `docs/IMPLEMENTATION_STATUS.md` hanya setelah acceptance.
- Sinkronkan halaman Notion WorkPulse setelah status lokal diperbarui, kecuali pengguna saat
  eksekusi secara eksplisit melarang layanan eksternal atau connector tidak tersedia. Catat bila
  sinkronisasi tidak dijalankan; dokumen lokal tetap sumber detail.

## 7. Verification matrix

### 7.1 Unit

- Zod parent/list/move input dan canonical UUID.
- Status/action matrix, byte formatting, long filename, safe error copy id/en.
- Poll start/stop/backoff dan cleanup timer pada unmount/hidden tab.
- Upload response `scanning` tidak dirender `ready`.
- Retry menghasilkan reservation/idempotency key baru.
- Signed URL tidak disimpan dan active document tidak dipreview.
- Move/remove conflict mempertahankan UI record sampai server refresh.
- Keyboard/focus/ARIA untuk picker, named remove, retry, download, dan move.

### 7.2 PostgreSQL dan integration nyata

- dua akun: list/get/download/remove/move lintas owner ditolak tanpa existence leak;
- list hanya exact direct parent;
- slot 1–3 valid; destination slot keempat ditolak;
- dua move concurrent menuju last slot menghasilkan tepat satu success;
- rejected move mempertahankan source parent, id, key, hash, bytes, revision yang semestinya, dan
  signed download dari source;
- stale evidence atau target revision menghasilkan conflict;
- move vs Activity/Achievement delete konsisten dan tanpa orphan;
- delete Activity/Achievement/Project menandai direct evidence deleting, menolak URL baru, dan
  membuat cleanup receipt yang bertahan setelah parent row hilang;
- direct Project ready evidence tidak muncul dalam direct Achievement query/count;
- worker cleanup menghapus object dan menyelesaikan receipt tanpa menyentuh parent record lain.

### 7.3 Playwright S06/S08/S10

1. Activity: upload clean → uploading/scanning → ready; download; move ke derived Achievement;
   Activity list kosong dan S08 menampilkan file direct yang sama.
2. Destination penuh: move ditolak, file tetap di Activity dan masih downloadable.
3. Failed/outage: file tidak ready, pesan aman tampil, Retry/Remove tersedia; retry memakai row baru.
4. Named remove: dialog menyebut filename; cancel mempertahankan file; confirm menutup download baru
   dan menampilkan Removing/kemudian hilang.
5. Project: direct file tampil di S10, tidak tampil di S08 untuk Achievement terkait, dan delete
   preview Project menghitungnya.
6. Parent delete untuk ketiga jenis mempertahankan karya canonical yang dijanjikan T08/T09 dan
   menutup evidence.
7. 360 px dan 1440 px, light/dark, keyboard-only, visible focus, axe scan, tidak ada horizontal
   overflow; status tidak bergantung pada warna.

### 7.4 Commands yang harus dijalankan

Gunakan scripts lockfile, bukan perintah asumsi. Minimal setelah integrasi:

```powershell
pnpm test
pnpm test:integration:evidence
pnpm test:integration:activity
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm db:test
pnpm db:lint
pnpm test:e2e:evidence
pnpm test:e2e:activity
pnpm test:e2e:achievements
pnpm test:e2e:projects
pnpm worker:check
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Selain itu:

- periksa `supabase migration list --local` untuk parity;
- generate ulang DB types setelah migration dan pastikan diff hanya perubahan schema yang dimaksud;
- rebuild seluruh migration hanya pada stack disposable, tidak pada active database;
- jalankan worker terpisah saat browser test menunggu scanning/cleanup;
- catat engine/signature ClamAV, port lokal, warning, retry, dan semua check yang tidak dijalankan
  beserta alasannya;
- jangan mengubah kegagalan environment menjadi klaim lulus.

## 8. Stop conditions dan recovery

Hentikan coding dan kembalikan ke Sol bila:

- T10 lock order atau trigger parent-delete tidak dapat ditentukan dengan bukti kode;
- perubahan memerlukan generic file reparenting, reverse move, Evidence Library, atau perubahan scope
  produk;
- migration memerlukan reset active DB atau destructive rewrite migration lama;
- direct client write ke lifecycle worker menjadi satu-satunya jalan;
- scanner nyata/Storage lokal tidak tersedia untuk acceptance integration;
- shared file berubah oleh agent lain dan merge aman tidak dapat dipastikan;
- requirement konflik baru mengubah hasil pengguna.

Recovery tidak boleh memakai `git reset --hard`, `git checkout --`, penghapusan worktree, atau
overwrite perubahan pengguna. Sol mengisolasi diff, mengembalikan task ke PARTIAL bila perlu, dan
mencatat bukti yang sudah lulus serta blocker yang masih terbuka.

## 9. Definition of Done dan handoff T12

T11 dapat menjadi DONE hanya bila seluruh acceptance inti pada §1 memiliki bukti nyata, migration
parity terjaga, reviewer tidak memiliki P0/P1 terbuka, lint/typecheck/build lulus, dan verification
record membedakan hasil lokal dari production readiness. Scaffold, mocked UI, API-only E2E, atau
happy path upload tanpa move/delete race tidak cukup.

Handoff ke T12 harus menyediakan query semantic yang jelas:

- “missing evidence” = confirmed Achievement dengan **nol direct `ready` evidence**;
- pending/failed/deleting tidak dihitung;
- Activity atau Project evidence tidak diwariskan;
- T12 tidak perlu membaca object storage atau signed URL untuk menghitung check Dashboard.

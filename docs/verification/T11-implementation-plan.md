# Handoff T11 Evidence UI dan lifecycle — eksekusi single-agent

- Tanggal: 26 September 2026
- Status pada checkpoint T10: **TODO** — penerimaan T10 lokal selesai; implementasi T11 belum menjadi bagian dari baseline handoff ini.
- Dependensi: T05, T09, dan T10 **DONE** pada acceptance lokal.
- Eksekutor: satu agent **GPT-6 Luna**; seluruh fase dikerjakan berurutan tanpa delegasi atau paralelisme.
- Reviewer: **Claude**, gate review setelah Fase 5; checkpoint setelah Fase 2 opsional.
- Acuan: R07, F05, S06/S08/S10, Database Schema §4/§6, IMPLEMENTATION_PLAN.md §1/§3/§4/T11, decision 0016, serta verification T10.

Versi 26 September 2026 yang membagi pekerjaan ke orchestrator dan beberapa sub-agent telah superseded oleh handoff single-agent ini. Dokumen ini adalah rencana pelaksanaan, bukan bukti bahwa acceptance T11 telah lulus.

## 0. Cara memakai handoff ini

GPT-6 Luna membaca dokumen ini sepenuhnya sebelum mengubah kode, lalu membaca AGENTS.md, bagian authoritative docs/IMPLEMENTATION_STATUS.md, docs/IMPLEMENTATION_PLAN.md §1/§3/§4/T11, docs/decisions/0016-t10-evidence-backend.md, dan docs/verification/T10-evidence-backend.md. Ekstrak requirement R07 dari PRD, flow F05, screen S06/S08/S10, serta Database Schema §4/§6 dari DOCX menggunakan alat ekstraksi dokumen; jangan menebak isi dari nama atau metadata file.

Audit baseline Git, migration parity, package scripts, server code, SQL T10, parent delete paths, host screens, dan tests sebelum coding. Pertahankan perubahan lokal yang sudah ada. Jika kondisi aktual berbeda dari kontrak handoff, kumpulkan bukti dan laporkan sebelum mengubah scope atau migration.

Kerjakan Fase 0 sampai Fase 6 sesuai urutan pada §6. Satu GPT-6 Luna menjadi satu-satunya penulis untuk seluruh perubahan T11. Jangan membuat sub-agent, mengerjakan fase secara paralel, menandai T11 DONE, atau menulis bagian authoritative docs/IMPLEMENTATION_STATUS.md. Pada akhir tiap fase, buat receipt yang mencatat tujuan, file berubah, commands beserta hasil aktual, acceptance yang dibuktikan, warning/kegagalan, blocker, dan langkah berikutnya. Hasil verification record Fase 6 adalah draft untuk Claude.

Claude dapat melakukan checkpoint read-only setelah Fase 2 bila diminta. Gate review read-only wajib dilakukan setelah Fase 5 dan sebelum Fase 6. GPT-6 Luna memperbaiki temuan P0–P2 dan mengulang checks yang terdampak; Claude memeriksa ulang sebelum menerima draft dokumentasi. Status authoritative tetap milik reviewer setelah gate dan acceptance nyata selesai.

## 1. Outcome dan acceptance inti

T11 menambahkan attachment control reusable pada detail Activity, Achievement, dan Project. Kontrol memakai lifecycle backend T10 dan hanya menampilkan status yang dikembalikan server. Ia mendukung upload privat, download ready-only, remove dengan konfirmasi bernama, retry memakai reservation baru, dan move eksplisit dari Activity ke derived Achievement yang sama.

T11 harus membuktikan seluruh kriteria berikut dengan hasil lokal yang nyata:

1. **Tidak ada false-ready.** Request upload yang selesai tidak membuat UI menyatakan file ready. File tetap uploading/scanning sampai backend melaporkan ready setelah validasi dan screening berhasil.
2. **Retry adalah reservation baru.** Retry memakai idempotency key baru dan object reservation baru; ia tidak menimpa object yang gagal. Setelah reservation baru berhasil dibuat, row failed lama dihapus best-effort. Jika delete gagal, row lama tetap tampak dengan aksi Remove.
3. **Move ke tujuan penuh tidak mengubah source.** Move yang mencapai batas tiga slot ditolak tanpa mengubah parent, revision, object key, bytes, hash, quota akun, scan job, cleanup receipt, atau kemampuan download dari Activity.
4. **Parent delete menutup akses baru dan menjaga cleanup.** Penghapusan Activity, Achievement, atau Project menolak penerbitan URL baru segera dan membuat cleanup receipt yang masih dapat diproses worker setelah parent hilang.
5. **Project evidence tidak diwariskan.** File langsung pada Project hanya tampil/dihitung sebagai Project evidence; ia tidak menjadi evidence langsung Achievement melalui relasi konteks.
6. **Aksesibel dan responsif.** Alur kontrol bisa diselesaikan dengan keyboard, visible focus, label/status tekstual, dan layout tanpa overflow pada 360 px serta 1440 px dalam light dan dark theme.
7. **Jalur manual tidak bergantung pada scanner.** T07–T09 tetap dapat dipakai ketika scanner atau worker tidak tersedia. File tidak boleh ditandai ready dalam keadaan tersebut.

Gate M2 tetap terbuka sampai task Dashboard/Timeline dan seluruh acceptance gate yang relevan selesai.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Trace requirement

- PRD R07: file privat menempel tepat ke Activity, Achievement, atau Project; server memvalidasi ownership, tipe, dan ukuran; file tidak dikirim untuk analisis AI.
- F05: reserve dilakukan sebelum upload; file pending sampai ready; failure menyediakan Retry/Remove; delete menutup akses baru; move eksplisit memvalidasi kapasitas destination secara atomik.
- S06: tampilkan evidence Activity dan aksi Move to achievement hanya bila derived Achievement terkait tersedia.
- S08: tampilkan direct Achievement evidence saja; pending/failed tidak dihitung sebagai evidence pendukung.
- S10: bedakan pending dan ready Project evidence; delete preview merangkum direct attachment yang terdampak.
- Database §4/§6: exactly-one parent, ownership, reservation quota/slot, cleanup queue tanpa parent FK, dan larangan client menulis lifecycle worker secara langsung.

### 2.2 Keputusan implementasi

- Move hanya **Activity → derived Achievement dari Activity yang sama**, untuk file berstatus ready. Tidak ada generic reparenting, reverse move, move dari Project, copy, atau transfer lintas akun.
- Payload move membawa expectedRevision untuk **evidence saja**. RPC memvalidasi target Achievement di bawah lock: owner sama dan achievement.activity_id harus sama dengan Activity sumber. Jangan meminta expectedTargetRevision; edit isi Achievement tidak boleh menghalangi move selama relasi masih valid. Saat move, simpan revision Achievement yang terkunci ke evidence_files.parent_revision sebagai provenance. Catat keputusan arsitektur ini pada docs/decisions/0017-t11-evidence-ui-lifecycle.md di Fase 6.
- uploading, scanning, failed, dan deleting tidak dapat dipindahkan; balas dengan conflict aman. Move tidak mengubah object key, bytes, hash, quota, scan job, atau cleanup queue.
- Reservation menghitung uploading, scanning, dan ready sebagai tiga slot aktif. failed dan deleting tidak memakai slot. List tetap boleh menampilkan seluruh status selama row masih ada.
- Retry menggunakan File yang masih tersedia di memori atau meminta pengguna memilih file kembali setelah reload. Buat reservation dan idempotency key baru. Setelah reserve berhasil, hapus row failed lama via DELETE best-effort; kegagalan cleanup tidak menggagalkan upload baru dan row lama tetap dapat dihapus manual.
- List adalah untuk satu parent langsung, maksimum 50 row, urutan created_at ASC, id ASC, termasuk failed dan deleting. Tidak ada pewarisan melalui Activity/Project/Achievement context.
- Reserve tetap memakai expectedRevision sebagai **revision parent**. Jika host telah diedit dan revision stale, server mengembalikan conflict; tampilkan pesan dan tombol reload yang memanggil router.refresh(), sambil mempertahankan File/input pengguna.
- Tidak ada preview/thumbnail, Evidence Library, global search, reverse move, AI analysis, OCR, evidence pada CV/PDF, public share, atau perubahan T12.

## 3. Kontrak teknis

### 3.1 Migration dan SQL RPC

Buat migration forward-only supabase/migrations/20260926090000_t11_evidence_list_move.sql. Timestamp harus lebih besar daripada migration T10 terakhir 20260925130000; sebelum menerapkan, verifikasi parity dan jangan reset database lokal aktif.

Tambahkan public.list_evidence_files(p_user_id uuid, p_parent_kind text, p_parent_id uuid):

- SECURITY DEFINER dengan SET search_path yang eksplisit.
- Bentuk kolom setiap row identik dengan hasil get_evidence_file, agar repository dapat memakai mapper toEvidenceRecord.
- Hanya mengembalikan row dengan direct parent yang tepat dan profile owner masih aktif (profiles.deleting_at IS NULL). Parent bukan milik user, parent tidak ada, atau profile deleting menghasilkan list kosong, tanpa membocorkan keberadaan record.
- Urutan stabil created_at ASC, id ASC; maksimum 50 row. Sertakan status failed/deleting bila row masih ada.
- Revoke seluruh hak dari PUBLIC, anon, dan authenticated; grant execute hanya ke service_role. Tambahkan COMMENT ON FUNCTION.

Tambahkan public.move_activity_evidence_to_achievement(p_user_id uuid, p_evidence_id uuid, p_target_achievement_id uuid, p_expected_revision integer), juga SECURITY DEFINER, search path eksplisit, grant hanya kepada service_role, revoke untuk role lain, dan function comment. Urutan operasi di dalam transaksi:

1. Validasi semua argumen wajib; argumen malformed menghasilkan SQLSTATE 22023.
2. Baca snapshot file tanpa lock untuk menemukan source Activity. Jika file tidak ditemukan atau bukan milik p_user_id, return kosong.
3. Lock profile dan verifikasi deleting_at IS NULL; jika tidak aktif/tidak ada, hasilkan 42501 AUTH_REQUIRED.
4. Lock source Activity milik owner. Jika tidak ditemukan, return kosong.
5. Lock target Achievement hanya jika owner sama dan achievement.activity_id sama dengan source Activity. Jika tidak ditemukan atau tidak related, return kosong.
6. Lock row evidence dan validasi kembali bahwa file masih direct pada Activity yang sama. Perubahan parent sejak snapshot menghasilkan EVIDENCE_STATE_CONFLICT.
7. Wajib status ready; status lain menghasilkan EVIDENCE_STATE_CONFLICT.
8. Bandingkan hanya revision evidence terhadap p_expected_revision; mismatch menghasilkan STALE_REVISION. Jangan validasi expected revision Achievement.
9. Hitung slot destination di bawah lock target. Jika sudah tiga row aktif (uploading, scanning, ready), hasilkan EVIDENCE_SLOT_LIMIT sebelum mutation.
10. Dalam satu update, kosongkan activity_id dan project_id, isi achievement_id, isi parent_revision dengan revision target yang di-lock, increment revision evidence dan set updated_at.
11. Kembalikan row hasil move. Jangan mengubah object key, ukuran/bytes, hash, status ready, quota akun, scan job, atau cleanup receipt.

Ikuti lock order terverifikasi: **profile → source Activity → target Achievement → evidence file**. Urutan ini kompatibel dengan T10 reserve/finalize/fail/delete dan trigger parent cleanup T10/T09. Jangan menukar urutan atau menambahkan lock yang tidak perlu. Source/target tidak valid dan cross-owner tetap menghasilkan hasil kosong yang dipetakan service menjadi EVIDENCE_NOT_FOUND, bukan existence leak.

Tambahkan pgTAP ke supabase/tests/database/evidence.test.sql dan perbarui plan() sesuai assertion baru.

### 3.2 Repository, contracts, service, dan HTTP

- Tambahkan ListEvidenceQuerySchema dan MoveEvidenceInputSchema di src/features/evidence/contracts.ts. Gunakan strict object, canonical UUID, parent kind allowlist, dan positive integer untuk evidence revision.
- Tambahkan list(userId, parentKind, parentId) dan move({...}) di src/server/storage/evidence-repository.ts. Keduanya memanggil RPC service_role dengan p_user_id dari session server, bukan payload client. Tambahkan helper callMany untuk hasil array dan gunakan toEvidenceRecord.
- Tambahkan list(query) dan move(id, input) ke src/features/evidence/evidence-service.ts. List menghasilkan records direct parent. Hasil kosong pada move menjadi EVIDENCE_NOT_FOUND; petakan SQLSTATE/token ke error T10 yang aman dan terlokalisasi.
- GET /api/evidence?parentKind=activity|achievement|project&parentId=<uuid> mengembalikan { items: EvidencePublicRecord[] }, validasi query dan memasang Cache-Control: no-store.
- POST /api/evidence/[id]/move menjalankan origin check lewat evidenceHttp(request, true), membaca body lewat evidenceJson, lalu mengembalikan EvidencePublicRecord. Jangan menerima owner ID dari body.
- Public record tidak memuat user_id, object key, hash, scan job, credential, atau detail error internal.
- Tambahkan src/features/evidence/evidence-loader.ts dengan server-only dan loadParentEvidence(parentKind, parentId), hasil { status: "ok", items } | { status: "error", code, correlationId }. Kegagalan list tidak boleh menyembunyikan parent record.
- Jalankan pnpm db:types sesudah migration dan simpan generated output ke src/server/supabase/database.types.ts.

### 3.3 Loader dan bounded list

HTTP list dan server loader hanya mengembalikan maksimal 50 row seperti kontrak di atas. Karena row failed/deleting tidak memakai slot dan dapat tetap tersimpan, 50 row bukan jaminan total row parent. Delete preview tidak boleh menyebut items.length sebagai hitungan tepat bila tepat 50 row kembali. Pada kondisi batas itu, tampilkan minimum yang jujur seperti “50+”, atau sediakan hitungan exact owner-scoped melalui server boundary sebelum memakai angka pasti. Jangan memperluas endpoint publik atau melakukan direct client write untuk mengatasi batas ini.

## 4. Reusable attachment control

Buat src/features/evidence/evidence-attachments.tsx (client) dan helper src/features/evidence/evidence-client.ts. Helper memanggil API dan tidak mencatat isi file atau nama file ke log.

Props minimum:

    locale, parentKind, parentId, parentRevision, initialItems, initialIssue?,
    moveTarget?: { achievementId } | null, onItemsChange?(items)

Gunakan label status dan action matrix berikut. Status harus selalu berupa teks, bukan warna saja. Announce perubahan dengan aria-live="polite" dan jangan memindahkan fokus saat polling.

| Status | Download | Remove | Retry | Move |
| --- | --- | --- | --- | --- |
| uploading | Tidak | Ya | Tidak | Tidak |
| scanning | Tidak | Ya | Tidak | Tidak |
| ready | Ya | Ya | Tidak | Ya, hanya S06 dengan derived Achievement |
| failed | Tidak | Ya | Ya, reservation baru | Tidak |
| deleting | Tidak | Tidak | Tidak | Tidak |

Upload:

1. File chooser menyatakan PDF/PNG/JPEG/DOCX, 10 MiB/file, dan batas slot. Validasi tipe/ukuran/slot di client hanya untuk feedback cepat; server tetap otoritatif.
2. POST reserve dengan parent kind/id, filename, MIME/bytes, revision parent terkini, dan idempotency key unik per reservation attempt.
3. Setelah reserve sukses, PUT exact bytes ke endpoint upload dengan content-type dan header x-expected-revision dari reservation.
4. Tampilkan status server; jangan set ready secara optimistik. Jika parent revision stale, pertahankan File, tampilkan conflict dan tombol reload.
5. Poll GET list setiap 2 detik, lalu backoff sampai interval maksimum 15 detik, paling lama sekitar lima menit. Poll hanya bila ada uploading/scanning, berhenti pada unmount atau document.hidden, dan sediakan tombol Refresh. Ketika worker/provider unavailable, tunjukkan status unavailable tanpa mengubah file menjadi ready.
6. Untuk Retry, gunakan File di memori atau minta pengguna memilih ulang. Setelah reservation baru berhasil, DELETE row failed lama secara best-effort.

Download memanggil POST authorization endpoint hanya untuk file ready lalu memakai window.location.assign(url) untuk attachment. Simpan URL signed tidak di React state, storage, URL halaman, atau log.

Remove memakai NamedDeleteDialog dengan filename. Status deleting bersifat read-only sampai row hilang; konfirmasi menyatakan bahwa parent record tetap ada.

Move hanya tersedia di S06 bila moveTarget tersedia. Minta konfirmasi sederhana; sukses menghapus row dari daftar Activity melalui hasil server/list refresh. Conflict mempertahankan row dan menjelaskan langkah pemulihan.

Tambahkan keys evidence.* untuk en dan id di src/i18n/messages.ts; tambahkan CSS .evidence-* di src/app/globals.css memakai token yang ada. Filename panjang, Unicode, dan konten bebas harus memakai overflow-wrap: anywhere. Pertahankan focus, keyboard, reduced motion, pending/disabled/error states, dan viewport 360/1440.

## 5. Wiring S06, S08, dan S10

Tambahkan server loader pada page src/app/(workspace)/activity/[id]/page.tsx, src/app/(workspace)/achievements/[id]/page.tsx, dan src/app/(workspace)/projects/[id]/page.tsx. Muat evidence paralel dengan parent record. Bila evidence load gagal, parent tetap tampil dan control menerima initialIssue.

- **S06 Activity:** control memakai parent Activity yang canonical. Ambil parentRevision dari state Activity terbaru setelah edit. Berikan moveTarget hanya bila Achievement derived yang dimuat memiliki activity_id sama. Simpan item terbaru melalui onItemsChange untuk delete preview direct evidence.
- **S08 Achievement:** tampilkan direct Achievement evidence saja. Activity/Project evidence terkait konteks tidak boleh ditampilkan atau dihitung di sini.
- **S10 Project:** tampilkan direct Project evidence dan bedakan pending dari ready. Jangan berikan move target.
- Delete preview ketiga host menyebut direct evidence yang terdampak dan mempertahankan named-delete flow yang sudah ada. Bila list gagal, jangan mengarang hitungan. Bila list mencapai batas 50, gunakan aturan hitungan pada §3.3.

Pertahankan edit, revision conflict, returnTo, named delete, dan parent record behavior T07–T09.

## 6. Fase eksekusi dan receipt

### Fase 0 — Baseline

Catat git status --short --branch, branch/commit, pnpm install --frozen-lockfile, pnpm db:status, pnpm exec supabase migration list --local, status ClamAV localhost:13310, scripts yang tersedia, serta angka baseline unit/integration/E2E terakhir di status/verification. Jangan reset database, membuang file lokal, atau mengubah perubahan yang sudah ada. Receipt memuat environment dan seluruh kondisi awal.

### Fase 1 — Database

Buat migration list/move forward-only dan pgTAP. Terapkan incremental dengan pnpm exec supabase migration up --local; jalankan pnpm db:test, pnpm db:lint, pnpm db:types, dan pnpm exec supabase migration list --local. Catat parity sebelum/sesudah. Jangan memakai db reset pada database aktif. Receipt menyertakan versi migration, assertion baru/total, parity, serta hasil aktual setiap command.

### Fase 2 — Server boundary

Implementasikan contracts, repository, service, route list/move, loader, dan safe error mapping. Tambahkan unit tests serta tests/integration/evidence-ui-lifecycle.test.ts; daftarkan script nyata test:integration:evidence-ui di package.json. Jalankan integration dengan PostgreSQL nyata. Checkpoint Claude read-only sesudah fase ini bersifat opsional. Receipt menyertakan status auth/ownership, no-store, cross-owner outcome, dan hasil tests.

### Fase 3 — Attachment control

Implementasikan helper API dan control reusable serta dictionary/CSS. Tambahkan tests/unit/evidence-client.test.ts dan tests/unit/evidence-attachments.test.tsx untuk action/state matrix, polling, retry, download, remove, move, dan aksesibilitas. Receipt menyebut perubahan dan hasil unit tests.

### Fase 4 — Host wiring

Hubungkan S06/S08/S10 dan page loaders. Pastikan parent tidak hilang saat list unavailable, revision Activity yang dipakai selalu yang terkini, move target hanya derived Achievement dari Activity yang sama, Project tidak mewariskan evidence, dan delete preview tidak membuat klaim count dari list capped. Receipt menyertakan screenshot viewport/theme awal dan hasil regresi screen terkait.

### Fase 5 — Browser acceptance dan regresi

Tambahkan tests/e2e/evidence-ui.spec.ts ke testMatch pada playwright.evidence.config.ts; tambahkan script test:e2e:evidence-ui bila targeted run diperlukan. Jalankan suite Evidence bersama regresi Activity, Achievement, dan Project. Gunakan private local Storage, worker terpisah, dan ClamAV nyata untuk bukti scanning/delete. Jangan gunakan mock sebagai bukti lifecycle production. Serahkan screenshot 360 px dan 1440 px untuk light/dark, hasil keyboard/axe/overflow checks, output commands, serta receipt lengkap Fase 0–5 kepada Claude.

### Fase 6 — Draft docs untuk review

Setelah gate Claude dan perbaikan P0–P2:

- Buat docs/decisions/0017-t11-evidence-ui-lifecycle.md untuk keputusan move yang memakai expected evidence revision saja dan merekam parent revision Achievement sebagai provenance.
- Buat docs/verification/T11-evidence-ui-lifecycle.md sebagai draft hasil aktual; pisahkan pass, fail, warning, dan tidak dijalankan beserta alasan.
- Serahkan daftar commit/diff dan seluruh receipt kepada Claude.
- Jangan menulis status authoritative atau mengklaim T11 DONE. Reviewer yang memperbarui docs/IMPLEMENTATION_STATUS.md setelah gate acceptance lengkap.

## 7. Matriks verifikasi

### Unit

- Schema list/move menolak query/body malformed dan UUID noncanonical.
- Semua lima status merender label teks dan aksi sesuai matrix.
- Client tidak menyatakan ready sebelum response server; polling start/stop/backoff/hidden/unmount/Refresh teruji.
- Retry membuat key/reservation baru dan menghapus failed lama best-effort setelah reserve baru sukses.
- Error reserve stale revision mempertahankan File/input dan memunculkan refresh action.
- Signed URL tidak disimpan/logged dan dokumen tidak dipreview inline.
- Move/remove conflict mempertahankan state sampai refresh server.
- Filename panjang/Unicode, locale en/id, keyboard, focus return, aria-live, dan reduced motion.

### PostgreSQL dan integration nyata

- List ketiga jenis parent berisi exact direct rows saja, maksimal 50, urut created_at, id, serta memuat failed/deleting yang masih ada.
- Cross-owner/nonexistent/deleting parent list dan move tidak membocorkan existence; service memetakan move kosong menjadi 404 EVIDENCE_NOT_FOUND.
- Move hanya Activity → Achievement derived dari Activity itu; move ke Achievement standalone/tidak terkait dan file bukan Activity ditolak.
- Move non-ready ditolak. Stale evidence revision conflict; perubahan content revision Achievement saja tidak menghalangi move jika relasinya tetap sama.
- Parent revision pada row setelah move sama dengan revision Achievement yang terkunci saat move.
- Slot 1–3 valid; slot keempat ditolak tanpa perubahan parent, id, object key, bytes, hash, status, quota, scan job, cleanup receipt, atau kemampuan download.
- Dua move concurrent ke slot terakhir memberi tepat satu success.
- Race move vs delete_activity dan move vs delete_achievement menghasilkan state konsisten tanpa orphan/half-move/deadlock.
- Delete Activity/Achievement/Project menutup download URL baru dan menyisakan cleanup receipt; worker nyata menyelesaikan receipt tanpa menyentuh file parent lain.
- Retry lama yang berhasil membuat reservation baru membersihkan row failed lama; kegagalan DELETE mempertahankan row lama dengan aksi Remove.
- Project direct evidence tidak muncul pada list/count Achievement terkait.
- Bila capped list berisi 50 row, delete preview tidak menampilkan angka pasti dari items.length; exact count harus berasal dari server atau ditampilkan sebagai 50+.

### Playwright S06/S08/S10

1. S06 upload clean, pending/scanning hingga ready oleh server, download, lalu move; list Activity kosong dan S08 menunjukkan file direct yang sama.
2. Tujuan penuh menolak move; row tetap di Activity dan masih dapat diunduh.
3. Scanner/worker unavailable menghasilkan status non-ready; error aman, Retry/Remove tersedia, retry memakai reservation baru.
4. Named remove menyebut filename; Cancel mempertahankan file; Confirm menutup penerbitan URL baru, menunjukkan Removing, lalu menghilang setelah cleanup.
5. S10 menampilkan Project evidence dan pending/ready terpisah; file tidak tampil atau terhitung pada S08; delete preview Project benar.
6. Delete ketiga parent menutup akses baru, mempertahankan canonical records sesuai kontrak T08/T09, dan membersihkan direct evidence.
7. Keyboard-only, focus terlihat, axe, tanpa horizontal overflow, status tidak bergantung pada warna pada 360/1440 px dalam light/dark.

## 8. Commands

Scripts T10 yang ada di package.json mencakup test, test:integration:evidence, test:integration:activity, test:integration:achievements, test:integration:projects, test:e2e:evidence, test:e2e:activity, test:e2e:achievements, test:e2e:projects, worker:check, typecheck, lint, build, db:test, db:lint, dan db:types. Fase 2 menambah test:integration:evidence-ui; Fase 5 boleh menambah test:e2e:evidence-ui.

Jalankan command dari lockfile/pnpm dan catat command serta output/exit code aktual:

    pnpm test
    pnpm test:integration:evidence
    pnpm test:integration:evidence-ui
    pnpm test:integration:activity
    pnpm test:integration:achievements
    pnpm test:integration:projects
    pnpm db:test
    pnpm db:lint
    pnpm db:types
    pnpm exec supabase migration list --local
    pnpm test:e2e:evidence
    pnpm test:e2e:evidence-ui
    pnpm test:e2e:activity
    pnpm test:e2e:achievements
    pnpm test:e2e:projects
    pnpm worker:check
    pnpm typecheck
    pnpm lint
    pnpm build
    git diff --check

Jangan melaporkan script tambahan lulus sebelum benar-benar ditambahkan dan dijalankan. Perintah yang tidak tersedia, gagal, atau tidak dijalankan harus dicatat dengan alasan; jangan menyimpulkan lulus dari mock, keberadaan file, atau output lama.

## 9. Stop conditions

Berhenti dan laporkan bukti, jangan improvisasi, bila:

- Migration parity atau schema nyata tidak cocok dengan asumsi; penyelesaian membutuhkan reset database aktif, rewrite migration lama, atau destructive operation.
- Lock order, trigger parent-delete, owner boundary, atau slot behavior tidak dapat dibuktikan dari source SQL T10/T09.
- Butuh generic reparenting, reverse move, library, preview/OCR/AI, perubahan produk, atau perluasan T12.
- Hostile/uncommitted file changes membuat edit aman tidak dapat dipastikan. Jangan reset, checkout, stash, atau menghapus pekerjaan pengguna.
- ClamAV/storage lokal tidak tersedia: jangan memakai fake-clean. Tandai acceptance scanner-dependent sebagai tidak dijalankan dan selesaikan hanya checks independen yang aman.
- Browser/UI acceptance mengharuskan layanan eksternal atau deployment. Tetap pada environment lokal yang diotorisasi.
- Daftar direct evidence mencapai batas 50 dan delete preview tidak punya exact count yang aman: tampilkan 50+ atau hentikan klaim exact count; jangan menampilkan angka yang diketahui bisa undercount.

## 10. Gate review Claude

Setelah Fase 5, Claude menerima commit/hash dan diff, receipt setiap fase, output perintah aktual, screenshots 360/1440 light/dark, hasil keyboard/axe, dan daftar acceptance yang belum dibuktikan. Review bersifat read-only dan mencakup:

- Session-derived identity/ownership; tidak ada owner dari payload dan tidak ada direct client lifecycle write.
- Migration forward-only; RPC list/move hanya dapat dieksekusi service_role; parent delete tetap menutup URL baru dan menjaga receipt.
- Lock order move profile → Activity → Achievement → evidence file; slot check terserialisasi dan move atomik.
- expectedRevision hanya evidence; relasi target tervalidasi saat lock; parent_revision mencatat revision target terkunci.
- Tidak ada false-ready/optimistic ready; polling berhenti sesuai lifecycle dan tidak bocor setelah unmount/hidden.
- Retry memakai idempotency key baru dan menghapus failed row lama best-effort setelah reserve sukses.
- Signed URL tidak disimpan atau dilog; download ready-only; file tidak dipreview.
- Named confirmation, aria/keyboard/focus, filename wrapping, dan en/id copy.
- Project evidence tidak bocor ke S08 atau missing-evidence count; delete preview tidak memakai truncated count seolah exact.
- Unit/integration/Playwright tests benar-benar memverifikasi setiap klaim, termasuk slot race, move/delete race, non-ready, unrelated target, retry cleanup, dan parent deletion.

Temuan **P0–P2** memblokir penerimaan draft dan harus diperbaiki serta diuji ulang. Catat P3 sebagai follow-up tanpa menyembunyikan risiko. Jika tidak ada temuan, Claude tetap mencatat limitation dan checks yang belum dibuktikan. Hanya reviewer yang mengubah status authoritative sesudah seluruh gate pass.

## 11. Handoff T12

Gunakan semantic missing evidence berikut untuk Dashboard/Timeline: Achievement berstatus confirmed yang memiliki **nol direct evidence berstatus ready**. Status uploading, scanning, failed, dan deleting tidak dihitung; evidence Activity atau Project tidak diwariskan. T12 dapat menghitung check dari metadata domain tanpa membaca object storage atau membuat signed URL.

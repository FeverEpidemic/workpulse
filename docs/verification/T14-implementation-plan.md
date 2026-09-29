# Handoff T14 Detection, refinement dan review — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan, buat implementasi minimal, jalankan ulang, lalu commit. Jangan membuat sub-agent.

- Tanggal: 28 September 2026
- Status saat plan ditulis: **TODO**. T14 belum dimulai.
- Dependensi: T07, T09, dan T13 sudah **DONE**. Gate M2 **PASSED** (acceptance lokal). T13 lulus smoke live pada endpoint OpenAI-compatible pilihan pengguna.
- Eksekutor: satu agent **GPT-6 Luna**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude**. Gate review read-only wajib dilakukan setelah Fase 5; Fase 6 (draft dokumen) dikerjakan setelah gate. Checkpoint setelah Fase 3 bersifat opsional.
- Acuan:
  - PRD R04/R05, §3 *Detection and confirmation*, §4 *AI disclosure / Data minimization / Failures*, dan release scenario ketiga (*Save a note while AI is unavailable; retry analysis after editing it*).
  - User Flow F02 (langkah 3–6 dan catatan di bawah tabel), F03, serta state transition *Achievement* dan *AI or export job*.
  - Wireframe §1 (*AI controls*, *Shared dialogs*), S05, S06, S08.
  - Database Schema §3 (`activities`, `chat_messages`, `achievements`, `ai_jobs`, *Worker rules*) dan §6 (*Save activity*, *Delete activity*).
  - `IMPLEMENTATION_PLAN.md` §1 (baris DESIGN §7 dan §26), §3 *Data karier* dan *Jobs dan data privat*, §4 (baris follow-up/suppression), serta blok T14 di §5.
  - `docs/decisions/0019-t13-ai-jobs-consent.md` bagian *Seam*, dan `docs/verification/T13-ai-jobs-consent.md` follow-up R4.

**Goal:** Pengguna menyimpan activity, lalu secara eksplisit meminta analisis dari S06. Hasil `detect.v1` tampil di samping teks sumber. Pengguna dapat menjawab maksimal tiga pertanyaan opsional (atau Skip / Save for later), menolak saran (suppression tersimpan di server untuk revisi itu), atau membuka saran sebagai **draft** Achievement lewat aksi Review. Tidak ada auto-confirm. Hasil lama tidak pernah menimpa revisi yang lebih baru, Achievement confirmed, Achievement dismissed, atau draft yang sudah diedit pengguna. Kegagalan AI (consent ditolak, outage, output rusak, edit saat berjalan, retry habis) selalu menyisakan activity tersimpan beserta Retry dan *Create achievement manually*.

**Architecture:** Semua keputusan state tetap di PostgreSQL. Migration forward-only menambah kind `refine`, membatasi satu job AI per revisi activity, mengecek jumlah pertanyaan per kind di tabel, dan menambah tabel `public.ai_suggestion_reviews` (satu row per revisi activity) untuk skip, dismiss, jawaban, dan apply. RPC user baru `answer_ai_questions`, `skip_ai_questions`, `dismiss_ai_suggestion`, dan `apply_ai_suggestion` berjalan `SECURITY DEFINER` dengan urutan lock yang konsisten, pemeriksaan consent, `expected_revision`, dan idempotensi. Worker T13 diperluas untuk kind `refine` (prompt tanpa pertanyaan lanjutan). Web membaca status lewat route GET owner-scoped yang dipolling dengan backoff, lalu mengubah state lewat server action. Kolom tabel `achievements` **tidak** diubah.

**Tech stack:** Next.js App Router, TypeScript strict, Supabase PostgreSQL/RLS, Zod 4, worker Node 24 (`.ts` type stripping), Vitest, pgTAP, Playwright + Axe, dan pnpm dari lockfile.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, bagian authoritative `IMPLEMENTATION_STATUS.md` (entry T13), `IMPLEMENTATION_PLAN.md` §1–§4 dan blok T14, decision 0019, serta `docs/verification/T13-implementation-plan.md` sebagai pola. Ekstrak PRD §3/§4, F02/F03, Wireframe §1/S05/S06/S08, dan DB §3/§6 memakai alat ekstraksi DOCX (mis. `python` + `zipfile` atas `word/document.xml`); jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R05:** AI boleh menyarankan satu achievement dan maksimal tiga pertanyaan opsional per revisi activity. Teks sumber disimpan. Hanya konfirmasi eksplisit pengguna yang membuat draft CV-eligible.
- **PRD §3 Detection and confirmation:** simpan note mentah dan konteks sebelum AI. Activity rutin tetap berguna tanpa achievement. Pertanyaan hanya untuk role, scope, atau outcome yang hilang dan relevan; semua opsional dengan *Skip* dan *Save for later*. Wording AI boleh menyusun ulang fakta, tetapi tidak boleh mengarang angka, senioritas, kausalitas, employer, atau hasil. Sumber tampil di samping saran. Perubahan membuat revisi baru; respons AI lama tidak boleh mengganti draft yang lebih baru. Satu achievement per activity.
- **F02 langkah 3–6:** analisis diminta setelah consent untuk revisi tersimpan; hasil nonpotential membiarkan activity sebagai log biasa. Jawaban pertanyaan disimpan sebagai chat message dan konteks; maksimal tiga follow-up per revisi. Membuka saran menampilkan wording, role, scope, outcome, metrics opsional, dan sumber mentah; achievement mulai sebagai draft. *Confirm*, *save draft*, atau *dismiss*; dismiss mempertahankan activity dan menekan saran berulang untuk revisi itu.
- **F02 catatan:** tanpa consent, activity biasa dengan analisis `not_requested`. Kegagalan AI menyisakan activity dengan Retry dan *Create achievement manually*. Edit note menaikkan revisi dan membatalkan hasil pending. Reanalysis memperbarui draft hanya setelah review dan tidak pernah menimpa achievement confirmed.
- **F03:** skill label dapat ditambah manual atau diterima dari saran. Hanya achievement confirmed yang dihitung.
- **Wireframe §1 AI controls:** *Saved* terpisah dari *Analyzing*. Follow-up dapat di-skip. Teks sumber di samping wording saran. Request AI yang gagal tidak pernah menyembunyikan note asli.
- **S05:** tampilkan saving, saved, analyzing, analysis failed secara terpisah. AI ditolak tetap membiarkan capture manual. Saran membuka S08 hanya bila dipilih. Jawaban tidak wajib untuk menyimpan.
- **S06:** kegagalan AI menawarkan Retry. Setelah edit note, achievement terkait ditandai perlu review sumber tanpa ditimpa.
- **S08:** pertanyaan opsional, maksimal tiga per revisi. Tampilkan state *source changed*, *AI failed*, dan validasi.
- **DB §3:** `chat_messages` append-only; jawaban pengguna menambah konteks, tidak mengganti `raw_text`. `ai_jobs.kind` `import/detect/refine`. *Worker rules:* cocokkan revisi sumber sebelum apply (`STALE_INPUT` bila tidak cocok); perubahan draft membutuhkan review action; reanalysis tidak pernah menulis achievement confirmed.
- **DB §6 Save activity:** activity write + revisi + job AI opsional dalam satu batas atomik.

Pertahankan perubahan lokal pengguna. Jangan menandai T14 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T14-phaseN-<slug>.md`. Receipt berisi tujuan, file yang berubah, command beserta hasil aktual (exit code dan angka), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya.

## 1. Acceptance inti T14

T14 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Alur utama.** Save note → *Analyze* → job `succeeded` → saran tampil di samping teks sumber → *Review as draft* membuat satu Achievement `draft` (origin `activity`, `source_excerpt` = `raw_text`, `source_activity_revision` = revisi job) → edit → *Confirm* lewat aksi T09. Dibuktikan integration dan E2E.
2. **Tidak ada auto-apply atau auto-confirm.** Job `succeeded` tanpa aksi Review tidak membuat atau mengubah Achievement apa pun. Apply tidak pernah menghasilkan status `confirmed`. Dibuktikan pgTAP dan integration (hitung row sebelum/sesudah).
3. **Consent declined.** Tanpa consent, *Analyze* membuka `AiConsentDialog`; *Continue manually* tidak membuat job. *Create achievement manually* tetap berjalan sampai confirm. Consent yang ditarik setelah job sukses membuat apply dan enqueue refine ditolak `CONSENT_REQUIRED`; skip dan dismiss tetap boleh. Dibuktikan pgTAP, integration, dan E2E.
4. **AI outage.** Mode `unavailable` menghasilkan `failed/AI_UNAVAILABLE`. Panel menampilkan pesan terlokalisasi, *Retry*, dan *Create achievement manually*; note asli tetap tampil. Retry setelah worker berganti ke fake berhasil. Dibuktikan integration dan E2E.
5. **Malformed dan ungrounded output.** Output yang gagal skema, menambah angka yang tidak ada di input (di metrics **maupun** teks saran), atau berisi pertanyaan pada kind `refine` menjadi `AI_OUTPUT_INVALID` dengan `result` NULL. Dibuktikan unit (validator) dan integration (fake scenario).
6. **Edit saat berjalan.** Edit activity ketika job queued/running menghasilkan `STALE_INPUT`; result lama tidak pernah tampil sebagai saran revisi baru dan apply atas job lama ditolak `STALE_INPUT`. Dibuktikan pgTAP, integration, dan E2E.
7. **Retry berulang.** Tiga attempt gagal membuat Retry nonaktif dengan pesan *retry habis* dan jalur manual tetap tersedia. Retry ganda paralel tidak membuat job kedua. Dibuktikan integration.
8. **Satu job per revisi.** `request_ai_analysis` paralel (×5) dan kombinasi detect/refine untuk revisi yang sama menghasilkan satu job. Dibuktikan pgTAP dan integration.
9. **Maksimal tiga follow-up per revisi.** Tabel menolak result `detect` dengan lebih dari tiga pertanyaan dan result `refine` dengan pertanyaan apa pun. Jawaban hanya diterima untuk field yang ditanyakan job tersebut dan masih kosong di activity. Dibuktikan pgTAP dan unit.
10. **Jawaban menjadi revisi input baru.** *Answer* menulis field `role/scope/outcome` yang kosong, menaikkan revisi activity satu kali, menambah pasangan chat message (pertanyaan `assistant`, jawaban `user`) bila `capture_mode = chat`, dan (bila consent terkini) meng-enqueue satu job `refine` untuk revisi baru — semuanya dalam satu transaksi. Submit ganda dengan jawaban identik mengembalikan hasil yang sama. `raw_text` tidak berubah. Dibuktikan pgTAP dan integration.
11. **Skip dan Save for later.** *Skip* menyimpan `questions_skipped_at` di server; pertanyaan tidak tampil lagi untuk revisi itu setelah reload. *Save for later* tidak menulis apa pun dan pertanyaan tetap tampil setelah reload. Dibuktikan E2E.
12. **Dismiss suppression.** *Dismiss suggestion* menyimpan state `dismissed` untuk revisi itu; setelah reload, request ulang, atau retry, saran tidak tampil dan apply ditolak `AI_SUGGESTION_DISMISSED`. Edit activity lalu analisis ulang pada revisi baru boleh memunculkan saran baru. Dibuktikan pgTAP, integration, dan E2E.
13. **Perlindungan Achievement yang ada.** Apply ditolak dan row tidak berubah bila derived Achievement berstatus `confirmed` (`ACHIEVEMENT_CONFIRMED`), `dismissed` (`ACHIEVEMENT_DISMISSED`), atau draft yang sudah diedit pengguna sejak apply terakhir (`DRAFT_EDITED`). Draft yang belum disentuh sejak apply terakhir boleh diperbarui dari saran revisi yang lebih baru. `expected_revision` Achievement dan activity wajib cocok. Dibuktikan pgTAP dan integration.
14. **Apply idempoten.** Klik ganda / request paralel apply untuk job yang sama menghasilkan satu Achievement dan receipt yang sama. Dibuktikan integration.
15. **Nonpotential.** `potential=false` menampilkan *No achievement detected* dan activity tetap log normal; tidak ada tombol Review. Dibuktikan integration dan E2E.
16. **Status jujur.** *Saved* tampil terpisah dari *Queued/Analyzing*. Tanpa worker, job tetap `queued` dan UI menampilkan *Waiting to start* tanpa klaim hasil. Polling berhenti di status terminal. Dibuktikan unit (view model) dan E2E.
17. **Isolasi dua akun.** Akun B tidak dapat membaca status, menjawab, skip, dismiss, atau apply job milik A; semua error generik `NOT_FOUND` tanpa membocorkan keberadaan. Dibuktikan pgTAP dan integration.
18. **Log hygiene.** Sentinel pada `raw_text`, jawaban, dan key palsu tidak muncul di stdout/stderr worker, pesan error, `error_code`, response route, maupun receipt. Dibuktikan integration dan grep.
19. **UI aksesibel.** Panel S06 dan aside S08 dapat dioperasikan dengan keyboard, fokus kembali ke pemicu setelah dialog, status dibacakan (`role="status"`), Axe WCAG 2.2 A/AA bersih, tanpa overflow di 360/1440 px light/dark, copy en/id, tanpa sparkle atau gradient. Dibuktikan E2E.
20. **Regresi.** Suite T06–T13 tetap lulus tanpa melemahkan assertion, termasuk `test:integration:ai`, `test:e2e:ai`, dan `test:e2e:m2` (assertion env AI-free tidak diubah).

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration forward-only: kind `refine`, satu job per revisi, check jumlah pertanyaan per kind, tabel `public.ai_suggestion_reviews`, RPC user baru, penggantian `request_ai_analysis` dan `complete_ai_job`, pgTAP.
- Domain: validator per kind dan grounding angka pada teks saran; view model analisis.
- Server/worker: prompt `refine`, pemilihan prompt per kind, fake scenario tambahan.
- Feature: `ai-review-service.ts`, server action baru, route GET status analisis.
- UI: panel *AI analysis* di S06, aside saran di S08 (read-only + terima skill), copy en/id, CSS token.
- Test unit/pgTAP/integration/E2E, script baru, decision 0020, receipt.

### 2.2 Keputusan implementasi

1. **Analisis diminta eksplisit dari S06.** Save di S05 tidak meng-enqueue apa pun dan tetap redirect ke S06 seperti sekarang (`src/features/activity/activity-capture-form.tsx:260`). Tombol *Analyze with AI* ada di panel S06. Alasan: F02 langkah 3 memakai *request or accept*, jalur manual tidak berubah, dan pengguna tidak terkejut teksnya dikirim.
2. **Satu job AI per revisi activity, lintas kind.** Tambah `unique (user_id, activity_id, input_revision)` pada `ai_jobs`. `request_ai_analysis` diganti: bila sudah ada job (detect atau refine) untuk revisi itu, kembalikan job tersebut (bandingkan `payload_hash` seperti T13). Alasan: suppression per revisi dan batas pertanyaan menjadi struktural, bukan hitungan browser.
3. **Kind `refine`.** Constraint kind menjadi `in ('detect', 'refine')`; pola key menjadi `^(detect|refine):[0-9a-f-]{36}:r[1-9][0-9]*$`. `refine` hanya dibuat oleh `answer_ai_questions` untuk revisi hasil jawaban. Input worker identik dengan detect (minimisasi T13 tidak berubah). `schema_version` tetap `detect.v1`.
4. **Batas pertanyaan ditegakkan tabel.** Tambah check: `result is null or jsonb_array_length(result->'questions') <= 3`, dan `kind <> 'refine' or result is null or jsonb_array_length(result->'questions') = 0`. `complete_ai_job` diganti agar memeriksa aturan ini **sebelum** update dan mengembalikan `'invalid'` (job `failed/AI_OUTPUT_INVALID`) alih-alih exception. Worker juga menolak di Zod lebih dulu. Karena satu revisi hanya punya satu job dan refine tidak bertanya, maksimal tiga follow-up per revisi terbukti oleh constraint.
5. **Jawaban = revisi input baru.** `answer_ai_questions` menulis jawaban ke field activity `role/scope/outcome` yang ditanyakan dan masih NULL, memakai jalur validasi `internal.update_activity` T06 bila signature-nya cocok (verifikasi Fase 0). Trigger T06/T13 menaikkan revisi dan mereset `analysis_state`. Untuk `capture_mode = chat`, tambahkan pasangan `chat_messages` (`assistant` = teks pertanyaan dari result, `user` = jawaban) dengan `sequence_no = max + 1` di bawah lock activity. Lalu, bila consent terkini, insert job `refine` untuk revisi baru (`analysis_state = queued`). Tanpa consent, jawaban tetap tersimpan dan receipt mengembalikan `job = null`. Alasan: pertanyaan `detect.v1` memang per field, AI hanya menerima field minimal, dan DB §6 meminta save + job opsional dalam satu transaksi.
6. **Tabel `public.ai_suggestion_reviews`**, satu row per `(user_id, activity_id, activity_revision)`, dibuat lazily oleh RPC user. Menyimpan `job_id`, `state` (`open/dismissed/applied`), `questions_skipped_at`, `answered_at`, `answers_hash`, `applied_achievement_id`, `applied_achievement_revision`. Kolom `achievements` tidak diubah. Alasan: menghindari perubahan bentuk row Achievement yang dibaca `select("*")` di `src/features/achievement/achievement-service.ts:153/331/372` dan menjaga T09 stabil.
7. **Apply membuat atau memperbarui draft saja.** `apply_ai_suggestion(job, expected_activity_revision, expected_achievement_revision)`:
   - Job milik caller dan `succeeded`, `potential = true`, `suggestion` ada; revisi activity = expected = `job.input_revision` (`STALE_INPUT`); consent terkini (`CONSENT_REQUIRED`); review revisi itu tidak `dismissed` (`AI_SUGGESTION_DISMISSED`).
   - Tanpa derived Achievement (expected harus NULL): insert draft `origin = 'activity'`, `source_excerpt = raw_text`, `source_activity_revision = revisi`, context mengikuti activity, field `title/contribution/outcome/scope/cv_bullet/metrics` dari saran, `achieved_on = activities.occurred_on`.
   - Dengan derived Achievement: `expected_achievement_revision` wajib cocok (`STALE_REVISION`). `confirmed` → `ACHIEVEMENT_CONFIRMED`. `dismissed` → `ACHIEVEMENT_DISMISSED`. Draft dianggap *untouched* hanya bila revisinya sama dengan `applied_achievement_revision` pada review terakhir yang menerapkannya, atau bila semua field konten NULL dan `metrics = '[]'`. Selain itu `DRAFT_EDITED`. Draft untouched diperbarui field-nya beserta `source_excerpt`/`source_activity_revision` ke revisi saat ini (perluasan semantik T09 yang dicatat di decision 0020).
   - `suggestion.role` tidak diterapkan (tabel Achievement tidak punya kolom role). Metric `baseline: null` dihilangkan dari objek agar lolos `internal.is_valid_achievement_metrics`.
   - Skill **tidak** di-link otomatis (lihat poin 10).
   - Idempotensi: bila review revisi itu sudah `applied` oleh job yang sama dan Achievement masih di `applied_achievement_revision`, kembalikan receipt yang sama tanpa write.
   - Urutan lock: profile (`for share`) → experience → project (pola `create_achievement_idempotent`, `20260922100000_t09_achievements_skills.sql:441-465`) → activity (`for update`) → derived achievement (`for update`) → job → review. Semua RPC T14 yang menyentuh lebih dari satu tabel mengikuti urutan ini.
8. **Skip dan dismiss tidak butuh consent** karena tidak memproses data. Keduanya idempoten. Dismiss atas review `applied` ditolak `AI_SUGGESTION_APPLIED` (pengguna men-dismiss Achievement lewat aksi T09).
9. **Grounding diperluas.** `validateDetectResult(raw, input, { kind })` menolak: pertanyaan pada `refine`; angka di `title/contribution/outcome/scope/cv_bullet` yang tidak muncul di input (pakai normalisasi `numbersIn` yang sama); metric ungrounded (T13). Validator yang sama dipakai route status sebelum saran ditampilkan; result tersimpan yang gagal validator baru ditampilkan sebagai `AI_OUTPUT_INVALID` dan tidak dapat di-apply (server action memvalidasi ulang sebelum memanggil RPC; RPC membaca result dari DB, bukan dari client).
10. **Skill saran lewat aksi pengguna.** S08 menampilkan chip *Add* untuk setiap `suggestion.skills` yang belum ada di form; klik menambah ke state `SkillTags` (`src/features/achievement/skill-tags.tsx` sudah terkontrol lewat `value/onChange`, dan `achievement-form.tsx:63` memegang state). Link skill baru tersimpan hanya saat pengguna menekan Save/Confirm T09.
11. **Aside saran S08 read-only.** Bila derived Achievement ada dan activity punya saran `succeeded` yang lebih baru daripada `source_activity_revision` tetapi apply diblokir (`DRAFT_EDITED`/`ACHIEVEMENT_CONFIRMED`), S08 menampilkan saran itu read-only di samping editor dengan label *AI suggestion (not applied)*. Tidak ada tombol overwrite. Pengguna menyalin sendiri bila mau.
12. **Status dibaca lewat route GET, perubahan lewat server action.** `GET /api/ai/activities/[id]/analysis` (owner session, `cache: no-store`) mengembalikan view model; polling di client memakai pola `EVIDENCE_POLL_DELAYS` (`src/features/evidence/evidence-attachments.tsx:17`) dan berhenti pada status terminal atau revisi berubah. Aksi `requestAnalysis/retry/answer/skip/dismiss/apply` ada di `src/features/ai/actions.ts`. Response route tidak memuat `raw_text` (sudah ada di halaman), ID job lain, atau data akun lain.
13. **Prompt `refine.prompt.v1`**: instruksi detect + "pertanyaan sudah dijawab; `questions` harus `[]`". Provider menerima kind lewat parameter ketiga `detect(input, signal, kind = "detect")`; `OpenAIProvider` memilih instruksi per kind. Minimisasi payload tidak berubah.
14. **Fake scenario tambahan** (development/test saja): `no_potential`, `fabricated_text` (angka di `cv_bullet` yang tidak ada di input), `many_questions` (4 pertanyaan). Scenario `valid` mengembalikan `questions = []` bila kind `refine`.
15. **UI panel S06** (`src/features/ai/activity-analysis-panel.tsx`), satu kartu di antara kartu detail dan kartu Achievement, label kecil *AI* tanpa sparkle/gradient (Design §32):
    - `not_requested` / tanpa job revisi ini: *Analyze with AI* (sekunder). Tanpa consent membuka `AiConsentDialog`; *Allow AI* memanggil `setAiConsentAction` lalu request.
    - `queued`: *Waiting to start*; `running`: *Analyzing…*; keduanya `role="status"` dan tanpa spinner tak berujung (teks jelas).
    - `failed`: pesan per error code, *Retry* (nonaktif dengan alasan bila `attempt_count >= 3` atau consent tidak ada), dan *Create achievement manually*.
    - Job revisi lama: *This activity changed after analysis* + *Analyze again*.
    - `succeeded` nonpotential: *No achievement detected. This activity stays in your log.*
    - `succeeded` potensial: wording saran (title, contribution, outcome, scope, metrics, CV bullet) di samping teks sumber (stack di 360 px), pertanyaan opsional dengan field input + *Answer*, *Skip questions*, *Save for later*; aksi *Review as draft* (primer) dan *Dismiss suggestion*.
    - Derived Achievement sudah ada: tombol utama menjadi *Open achievement*; *Review as draft* hanya bila apply diizinkan.
    - Konflik (`STALE_INPUT`/`STALE_REVISION`) memakai `RevisionConflict` bersama dengan reload tanpa membuang jawaban yang sedang diketik.
16. **Nomor decision:** `docs/decisions/0020-t14-detection-review.md`. **Migration:** `supabase/migrations/20260929090000_t14_ai_review.sql`; parity menjadi 23/23. **Port E2E:** 3008.

### 2.3 Di luar scope

- Kind `import`, `import_batch_id`, dan consent import (T15/T17).
- Analisis otomatis saat save, streaming, chat assistant bebas, atau AI di S07 list.
- Rate limit/kuota AI per pengguna.
- Perubahan kolom `achievements`, aksi confirm/dismiss/reopen T09, atau aturan CV freshness (T20). Flag *source changed* CV milik T20.
- Penerjemahan, evidence AI, OCR, dan semua fitur roadmap Design.md.
- Perubahan perilaku T06–T13 selain yang tercantum di §2.2 poin 2–5.

## 3. Kontrak teknis

### 3.1 Migration `20260929090000_t14_ai_review.sql`

Perubahan `public.ai_jobs`:

- Ganti `ai_jobs_kind_check` menjadi `kind in ('detect', 'refine')` dan `ai_jobs_idempotency_key_check` sesuai §2.2.3. Tambahkan check `ai_jobs_key_kind_check`: prefix key sama dengan `kind`.
- Tambah `ai_jobs_one_per_revision_key unique (user_id, activity_id, input_revision)`. Fase 0 memastikan data lokal tidak melanggar (query duplikat harus 0 row).
- Tambah `ai_jobs_questions_check` sesuai §2.2.4.
- Grant kolom `select` untuk `authenticated` sudah memuat `kind`; tidak ada grant baru.
- `internal.guard_ai_job_row` tidak diubah.

Tabel `public.ai_suggestion_reviews`:

| Kolom | Definisi |
| --- | --- |
| `id` | uuid PK default `gen_random_uuid()` |
| `user_id` | uuid not null, FK `profiles(id)` on delete cascade |
| `activity_id` | uuid not null; composite FK `(user_id, activity_id)` → `activities(user_id, id)` on delete cascade |
| `activity_revision` | integer not null `> 0` |
| `job_id` | uuid not null; composite FK `(user_id, job_id)` → `ai_jobs(user_id, id)` on delete cascade |
| `state` | text not null default `'open'`, check `open/dismissed/applied` |
| `questions_skipped_at`, `answered_at` | timestamptz |
| `answers_hash` | bytea, `octet_length = 32` bila ada; `(answered_at is null) = (answers_hash is null)` |
| `applied_achievement_id` | uuid; composite FK `(user_id, applied_achievement_id)` → `achievements(user_id, id)` on delete set null (`applied_achievement_id`) |
| `applied_achievement_revision` | integer `> 0` |
| `created_at`, `updated_at` | timestamptz not null default `clock_timestamp()` |
| `revision` | integer not null default 1 |

- `unique (user_id, id)`, `unique (user_id, activity_id, activity_revision)`, `unique (user_id, job_id)`.
- Check: `state = 'applied'` mewajibkan `applied_achievement_revision` terisi; `state <> 'applied'` mewajibkan keduanya NULL kecuali `applied_achievement_id` yang di-set NULL oleh FK (dokumentasikan).
- Trigger guard: identitas (`user_id`, `activity_id`, `activity_revision`, `job_id`, `created_at`) immutable, `revision + 1`, `updated_at`.
- RLS enable, policy `ai_suggestion_reviews_select_own`; `revoke all` dari `public, anon, authenticated, service_role`; `grant select` ke `authenticated`.
- Index `(user_id, activity_id, activity_revision desc)`.

Fungsi (semua `security definer`, `set search_path = pg_catalog`, identifier ter-qualify, error `raise exception using errcode, message = '<CODE>'` tanpa teks sumber):

| Fungsi | Grant | Perilaku |
| --- | --- | --- |
| `public.request_ai_analysis(uuid, integer)` (replace) | authenticated | Sama dengan T13, tetapi pencarian job lama memakai `(user_id, activity_id, input_revision)` sehingga job refine yang sudah ada dikembalikan. Receipt ditambah kolom `kind`. **Ubah return type hanya bila perlu**; bila menambah kolom, `drop function` + `create` dalam migration yang sama dan perbarui service T13 (catat di receipt). |
| `public.complete_ai_job(uuid, uuid, jsonb)` (replace) | service_role | Sama dengan T13, ditambah pemeriksaan pertanyaan per kind sebelum update (`'invalid'`). |
| `public.answer_ai_questions(p_job_id uuid, p_expected_revision int, p_answers jsonb)` | authenticated | `p_answers` = objek `{field: text}` dengan kunci ⊆ `role/scope/outcome`, 1–3 kunci. Lock sesuai §2.2.7. Guard: job milik caller dan `succeeded` (`AI_JOB_UNAVAILABLE`/`AI_JOB_NOT_APPLICABLE`); revisi activity = expected = `job.input_revision` (`STALE_INPUT`); review revisi itu tidak `dismissed` dan belum skip (`AI_QUESTIONS_CLOSED`); setiap kunci ada di `result.questions[].field` dan field activity masih NULL (`INVALID_AI_ANSWER`); teks lolos batas activity (role ≤200, scope/outcome ≤5000; trim, nonblank). Replay: bila review revisi itu `answered_at` terisi dan `answers_hash` sama, kembalikan receipt tersimpan; hash beda → `IDEMPOTENCY_KEY_REUSED`. Tulis field → revisi +1 → chat pair (mode chat) → review lama `answered_at/answers_hash` → job `refine` bila consent terkini. Return: `activity_revision`, `job_id` (nullable), `job_status` (nullable). |
| `public.skip_ai_questions(p_job_id uuid)` | authenticated | Upsert review revisi job, set `questions_skipped_at` bila NULL. Idempoten. |
| `public.dismiss_ai_suggestion(p_job_id uuid)` | authenticated | Upsert review, `state = 'dismissed'`. Idempoten. `applied` → `AI_SUGGESTION_APPLIED`. |
| `public.apply_ai_suggestion(p_job_id uuid, p_expected_activity_revision int, p_expected_achievement_revision int)` | authenticated | §2.2.7. Return `achievement_id`, `achievement_revision`, `created boolean`. Insert memakai struktur `create_achievement_idempotent` (T09), dengan `unique_violation` pada `achievements_one_derived_activity_idx` dipetakan ke `ACHIEVEMENT_EXISTS`. |

Semua RPC user: `auth.uid()` wajib dan profil tidak deleting (`AUTH_REQUIRED`); job/activity milik akun lain → `AI_JOB_UNAVAILABLE` (tidak membedakan tidak ada vs milik orang lain). Revoke `execute` dari `public, anon, service_role` untuk fungsi user; grant ke `authenticated`. Tambahkan `comment on` untuk tabel dan setiap fungsi.

Catatan eksekutor:

- Salin body T13 `request_ai_analysis`/`complete_ai_job` persis, lalu ubah hanya bagian yang disebut. Diff terhadap body T13 dilampirkan di receipt Fase 1.
- pgTAP T13 (`supabase/tests/database/ai_jobs.test.sql`) yang mengasersi kind/pola key lama boleh disesuaikan **hanya** untuk perluasan `refine`; catat setiap assertion yang diubah beserta alasannya.

### 3.2 Domain dan server

- `src/domain/ai/contracts.ts`: `AI_JOB_KINDS = ["detect", "refine"]`, kode error baru `AI_SUGGESTION_DISMISSED`, `AI_SUGGESTION_APPLIED`, `AI_QUESTIONS_CLOSED`, `DRAFT_EDITED`, `ACHIEVEMENT_CONFIRMED`, `ACHIEVEMENT_DISMISSED` (pisahkan kode job worker dari kode review bila lebih rapi; jaga regex `^[A-Z][A-Z0-9_]{0,63}$`).
- `src/domain/ai/detect-result.ts`: `validateDetectResult(raw, input, options?: { kind })` sesuai §2.2.9; `hasGroundedText`. `detectResultJsonSchema` tidak berubah (strict mode tetap valid untuk kedua kind).
- `src/domain/ai/analysis-view.ts` (baru, murni): `toAnalysisView({ activity, job, review, consent, derivedAchievement })` → union state `none | queued | running | failed | stale | no_potential | suggestion | suppressed | applied` beserta flag `canRetry`, `canApply`, `applyBlockReason`, `visibleQuestions` (filter field yang sudah terisi dan skip). Seluruh logika tampilan diuji di unit, bukan di komponen.
- `src/domain/ai/apply-mapping.ts` (baru): `suggestionToDraftFields(result, activity)` dipakai unit test sebagai spesifikasi mapping yang dilakukan SQL (metric `baseline: null` dihapus, `achieved_on = occurred_on`, role diabaikan). Integration membuktikan SQL = mapping ini.
- `src/server/ai/detect-prompt.ts`: `REFINE_PROMPT_VERSION = "refine.prompt.v1"`, `REFINE_INSTRUCTIONS`. `provider.ts`: tipe `AiJobKind` dan parameter `kind`. `openai-provider.ts`, `fake-provider.ts`: pilih instruksi/perilaku per kind.
- `src/features/ai/ai-review-service.ts`: `answerQuestions`, `skipQuestions`, `dismissSuggestion`, `applySuggestion`, `getAnalysisView(activityId)`; memakai `mapAiDatabaseError` (`src/features/ai/ai-errors.ts`) yang diperluas. Kode DB baru dipetakan ke kode service + `messageKey`; kepemilikan asing → `NOT_FOUND`.
- `src/features/ai/ai-job-service.ts`: `JOB_COLUMNS` dan skema row menambah `kind`; receipt menambah `kind`.
- `src/features/ai/actions.ts`: action baru dengan pola `setAiConsentAction` (Zod, correlation ID, `revalidatePath` untuk `/activity/[id]`, `/achievements`, `/achievements/[id]`).
- `src/app/api/ai/activities/[id]/analysis/route.ts`: GET owner-scoped, `export const dynamic = "force-dynamic"`, error generik.

### 3.3 Worker

- `workers/ai-worker.ts`: `isValidClaim` menerima `detect|refine`; `provider.detect(input, signal, job.kind)`; `validateDetectResult(..., { kind: job.kind })`. Ringkasan tetap hanya angka dan kode; tambahkan hitungan per kind bila berguna.
- `workers/supabase-ai-gateway.ts`: parsing `kind` pada claim. Tidak ada RPC worker baru.
- `tests/unit/worker-bootstrap.test.ts` tidak berubah kecuali `registeredJobs` memang berubah (tidak direncanakan).

### 3.4 UI

- `src/features/ai/activity-analysis-panel.tsx` (client) dipasang di `src/features/activity/activity-detail.tsx` antara kartu detail dan kartu evidence; menerima `activity`, `linkedAchievement`, `consent` dari page server (`src/app/(workspace)/activity/[id]/page.tsx` memuat `ai_consent_at/_version` profil).
- `src/features/ai/ai-suggestion-aside.tsx` dipasang di `src/features/achievement/achievement-detail.tsx`; `AchievementForm` menerima prop opsional `suggestedSkills` dan merender chip *Add* di dekat `SkillTags`.
- Copy `ai.analysis.*` dan `ai.review.*` en/id di `src/i18n/messages.ts`; CSS berbasis token di `src/app/globals.css`.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20260929090000_t14_ai_review.sql`, `supabase/tests/database/ai_review.test.sql` |
| Modify | `supabase/tests/database/ai_jobs.test.sql` (hanya perluasan kind), `src/server/supabase/database.types.ts` (`db:types`) |
| Create | `src/domain/ai/{analysis-view,apply-mapping}.ts` |
| Modify | `src/domain/ai/{contracts,detect-result}.ts`, `src/server/ai/{provider,detect-prompt,openai-provider,fake-provider}.ts` |
| Create | `src/features/ai/{ai-review-service,activity-analysis-panel,ai-suggestion-aside}.ts(x)`, `src/app/api/ai/activities/[id]/analysis/route.ts` |
| Modify | `src/features/ai/{ai-errors,ai-job-service,actions}.ts`, `src/features/activity/activity-detail.tsx`, `src/app/(workspace)/activity/[id]/page.tsx`, `src/features/achievement/{achievement-detail,achievement-form}.tsx`, `src/app/(workspace)/achievements/[id]/page.tsx`, `src/i18n/messages.ts`, `src/app/globals.css` |
| Modify | `workers/ai-worker.ts`, `workers/supabase-ai-gateway.ts`, `package.json`, `README.md` |
| Create | `tests/unit/{ai-analysis-view,ai-apply-mapping,ai-review-service,ai-review-actions,ai-analysis-panel}.test.ts(x)` |
| Modify | `tests/unit/{detect-result,ai-worker,openai-provider,ai-job-service}.test.ts` |
| Create | `tests/integration/ai-review.test.ts`, `tests/e2e/ai-review.spec.ts`, `tests/e2e/helpers/ai-worker.ts`, `playwright.ai-review.config.ts` (PORT 3008) |
| Create (Fase 6) | `docs/decisions/0020-t14-detection-review.md`, `docs/verification/T14-detection-review.md` |

Script baru:

- `test:integration:ai-review` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/ai-review.test.ts`
- `test:e2e:ai-review` → `playwright test --config playwright.ai-review.config.ts tests/e2e/ai-review.spec.ts`

Helper E2E `tests/e2e/helpers/ai-worker.ts` menjalankan `node workers/run.ts --once` sebagai child process dengan env **khusus child**: `NODE_ENV=test`, `WORKPULSE_AI_MODE=fake`, `WORKPULSE_AI_FAKE_SCENARIO=<scenario>`, URL Supabase lokal, dan `SUPABASE_SECRET_KEY` dari env proses test. Env AI tidak pernah diteruskan ke `webServer`. Output child hanya diperiksa untuk angka/kode dan sentinel.

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD. Working tree harus bersih kecuali `.claude/`. Jika ada perubahan lain, **stop**.
- [ ] `pnpm install --frozen-lockfile`, `pnpm db:status`, `pnpm exec supabase migration list --local`. Parity harus **22/22** dengan migration terakhir `20260928090000_t13_ai_jobs_consent.sql`.
- [ ] Baseline `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan 51 file / 274 test), `pnpm db:test` (harapan 8 file / 470 assertion), `pnpm test:integration:ai` (harapan 13).
- [ ] Query duplikat `select user_id, activity_id, input_revision, count(*) from public.ai_jobs group by 1,2,3 having count(*) > 1` pada DB lokal: harus 0 row.
- [ ] Verifikasi dari source dan catat file:baris untuk: body `request_ai_analysis`, `complete_ai_job`, `internal.fail_ai_job_locked` (migration T13); signature dan validasi `internal.update_activity` (`20260917160000_t06_activity_persistence.sql:496`); `guard_chat_message_insert`; urutan lock `create_achievement_idempotent`; `internal.is_valid_achievement_metrics`; `internal.guard_achievement_row`; `SkillTags` dan state skill di `achievement-form.tsx`; redirect save di `activity-capture-form.tsx:260`; pola polling evidence; pemetaan error di `ai-errors.ts`; port 3008 belum dipakai config lain.
- [ ] Tulis receipt Fase 0. **Jangan** memanggil provider nyata.

### Fase 1 — Database (TDD pgTAP)

- [ ] Tulis `supabase/tests/database/ai_review.test.sql` yang gagal lebih dulu (pola `begin; … no_plan(); … finish(); rollback;`, `pg_temp.set_jwt_subject`, job dibuat lewat RPC lalu diselesaikan sebagai `service_role`). Assertion minimum:
  1. Struktur: kind/key check baru, unique per revisi, questions check, tabel review, grant (authenticated tanpa write; `service_role` tanpa write), `prosecdef`, RLS.
  2. Request ganda pada revisi yang sama → id sama; setelah `answer` membuat refine rev 2, request rev 2 mengembalikan job refine.
  3. `complete_ai_job` refine dengan satu pertanyaan → `'invalid'`/`AI_OUTPUT_INVALID`; detect dengan 4 pertanyaan → `'invalid'`.
  4. `answer_ai_questions`: sukses menulis field NULL, revisi +1, `raw_text` tetap, chat pair hanya untuk mode chat, refine `queued`, `analysis_state = queued`; replay identik → hasil sama tanpa revisi tambahan; hash beda → `IDEMPOTENCY_KEY_REUSED`; field tidak ditanyakan atau sudah terisi → `INVALID_AI_ANSWER`; revisi salah → `STALE_INPUT`; tanpa consent → field tersimpan, job NULL; setelah skip/dismiss → `AI_QUESTIONS_CLOSED`.
  5. `skip`/`dismiss` idempoten; dismiss setelah apply → `AI_SUGGESTION_APPLIED`.
  6. `apply_ai_suggestion`: create draft dengan mapping §2.2.7, status `draft`; replay → sama, `created = false`; revisi activity berubah → `STALE_INPUT`; consent ditarik → `CONSENT_REQUIRED`; dismissed review → `AI_SUGGESTION_DISMISSED`; nonpotential → `AI_JOB_NOT_APPLICABLE`; confirmed → `ACHIEVEMENT_CONFIRMED`; dismissed achievement → `ACHIEVEMENT_DISMISSED`; draft diedit lewat `save_achievement` → `DRAFT_EDITED`; draft untouched + saran revisi baru → field dan `source_activity_revision` diperbarui; tidak pernah ada row `confirmed` hasil apply.
  7. Isolasi: akun B → `AI_JOB_UNAVAILABLE` pada semua RPC dan tidak melihat review A.
  8. Delete activity: job dan review ikut terhapus (cascade), Achievement tetap dengan provenance.
- [ ] Pastikan `pnpm db:test` **FAIL**. Tulis migration §3.1, lalu `pnpm exec supabase migration up --local`. **Dilarang** `db reset`.
- [ ] `pnpm db:test` (PASS; catat total), `pnpm db:lint`, `pnpm db:types`, migration list (23/23).
- [ ] Commit `feat(t14): add ai review table, refine kind and review RPCs`, lalu tulis receipt.

### Fase 2 — Domain, prompt, dan provider (TDD unit)

- [ ] Test gagal lebih dulu:
  - `detect-result`: refine dengan pertanyaan ditolak; angka rekaan di `cv_bullet`/`title`/`outcome` ditolak; angka dari `role/scope/outcome` input diterima; format `5,5`/`1.000` konsisten dengan `numbersIn`.
  - `ai-analysis-view`: setiap state §2.2.15, `visibleQuestions` memfilter field terisi/skip, `canRetry` false pada attempt 3 atau tanpa consent, stale saat `job.input_revision < activity.revision`, suppressed saat review dismissed.
  - `ai-apply-mapping`: baseline NULL dihapus, role diabaikan, `achieved_on` dari activity.
  - `openai-provider`: kind `refine` memakai `REFINE_INSTRUCTIONS`; payload tetap lima kunci T13.
  - `ai-worker`: claim refine valid, validasi per kind, kind tak dikenal → `stale`.
  - Fake: scenario baru dan refine tanpa pertanyaan.
- [ ] Implementasi hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit, receipt.

### Fase 3 — Service, route, dan integration nyata

- [ ] Unit `ai-review-service` dan `ai-review-actions` dengan fake client: pemetaan kode DB → kode service + `messageKey` + UUID `correlationId`; validasi input Zod (jawaban trim, batas panjang, kunci field).
- [ ] Buat route GET status; unit test route: tanpa session → 401 generik, activity asing → 404 generik, result yang gagal validator baru → view `failed/AI_OUTPUT_INVALID`.
- [ ] `tests/integration/ai-review.test.ts` (setup seperti `tests/integration/ai-jobs.test.ts`: admin, owner A/B sign-in nyata, worker `runAiWorkerOnce` dengan gateway nyata dan fake provider berpenghitung). Skenario wajib:
  1. Alur utama sampai confirm lewat service T09 (§1.1) dan hitung Achievement sebelum apply = 0 (§1.2).
  2. Consent declined dan withdraw setelah sukses (§1.3).
  3. Outage `unavailable` lalu retry dengan fake (§1.4).
  4. `malformed`, `ungrounded`, `fabricated_text`, `many_questions` → `AI_OUTPUT_INVALID` (§1.5).
  5. Edit saat queued dan saat running (hook `onDetect`) → `STALE_INPUT`, apply job lama ditolak (§1.6).
  6. Retry sampai habis, retry paralel ×3 (§1.7).
  7. Request paralel ×5 dan detect vs refine pada revisi sama (§1.8).
  8. Answer (note dan chat), replay paralel ×3, refine sukses tanpa pertanyaan; payload provider refine persis lima kunci (§1.9–§1.10).
  9. Dismiss lalu request/retry → tetap suppressed; edit → revisi baru → saran baru (§1.12).
  10. Proteksi confirmed/dismissed/edited draft; untouched draft diperbarui (§1.13); apply paralel ×3 → satu Achievement (§1.14).
  11. Nonpotential (§1.15).
  12. Isolasi dua akun lewat service dan route (§1.17).
  13. Log hygiene: tangkap stdout/stderr dan pesan error selama semua skenario; sentinel teks, jawaban, dan key palsu = 0 (§1.18).
- [ ] Tambah script `test:integration:ai-review` dan jalankan. Regresi: `test:integration:ai`, `activity`, `achievements`, `m2`.
- [ ] `pnpm worker:check` dan `pnpm worker:once` dengan mode default `unavailable`.
- [ ] Commit per kelompok, receipt. Checkpoint Claude opsional di sini.

### Fase 4 — UI S06 dan S08

- [ ] Implementasi §2.2.10, §2.2.11, §2.2.15, dan §3.4 dengan primitives bersama (`Button`, `Card`, `Badge`, `RevisionConflict`, `AiConsentDialog`, `InlineError`) dan satu keluarga ikon (lucide-react).
- [ ] Unit render `ai-analysis-panel` (pola `tests/unit/evidence-attachments-ui.test.tsx`): tiap state menampilkan teks status, tidak ada klaim hasil saat queued, Retry nonaktif pada attempt 3, tidak ada gradient/sparkle, sumber tetap tampil saat failed.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e:activity`, `pnpm test:e2e:achievements` (regresi). Commit, receipt.

### Fase 5 — Browser acceptance dan regresi penuh

- [ ] Buat `playwright.ai-review.config.ts` (PORT 3008, `webServer.env` tanpa variabel AI) dan `tests/e2e/ai-review.spec.ts`. Skenario:
  1. Consent declined: *Analyze* → dialog → Escape (fokus kembali) → *Continue manually* → tidak ada job → *Create achievement manually* → confirm.
  2. Allow → *Waiting to start* (tanpa worker) → jalankan helper worker `valid` → reload/polling → saran di samping sumber → jawab pertanyaan outcome (keyboard-only) → revisi naik, refine selesai → *Review as draft* → S08 menampilkan draft, sumber, dan chip skill *Add* → confirm.
  3. Skip vs Save for later dengan reload.
  4. Dismiss → reload → tetap suppressed → edit note → analisis ulang → saran baru.
  5. Outage (`WORKPULSE_AI_MODE=unavailable` di child) → pesan + Retry + manual; Retry dengan `valid` berhasil.
  6. Malformed → pesan invalid dan Retry.
  7. Edit saat queued → *This activity changed after analysis*.
  8. Draft diedit lalu saran revisi baru → S08 aside read-only, tanpa overwrite.
  9. Locale `id` untuk panel dan pertanyaan.
  10. Axe pada S06 (tiap state utama) dan S08 aside; 360×800 dan 1440×900 light/dark tanpa overflow; screenshot dilampirkan.
- [ ] Jalankan suite §7 lengkap. `test:e2e:m2` wajib lulus tanpa melemahkan assertion env (bersihkan env harness `AI_AGENT`/`ANTHROPIC_BASE_URL` per run bila ada, lihat T13 R5). Suite ClamAV dijalankan bila container tersedia; bila tidak, catat sebagai tidak dijalankan beserta alasan.
- [ ] Opsional, hanya dengan persetujuan eksplisit pengguna: satu smoke live `refine` via `worker:once` atas fixture sintetis; catat model, latency, dan status tanpa key. Tanpa persetujuan, catat *tidak dijalankan*; ini tidak memblokir DONE.
- [ ] Receipt. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–5, output command, screenshot, hasil Axe/keyboard, dan daftar acceptance yang belum terbukti.

### Fase 6 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0020-t14-detection-review.md`: keputusan §2.2 poin 1–16, error code baru, urutan lock, perluasan semantik `source_excerpt` untuk draft untouched, dan seam T15/T20.
- [ ] `docs/verification/T14-detection-review.md`: pass/fail/warning/tidak dijalankan, trace ke R04/R05, F02/F03, S05/S06/S08, DB §3/§6, dan setiap poin §1.
- [ ] README (bagian Worker/AI dan tabel quality gates, script baru).
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- Owner A: locale `en`, timezone `Asia/Jakarta`, consent NULL di awal.
  - `AN1` note: `"Migrated 3 reports to the new pipeline. WP-PRIVATE-SENTINEL-<uuid>"`, outcome NULL (fake `valid` memunculkan pertanyaan outcome, metric `3` grounded).
  - `AN2` chat dengan pesan pertama berisi sentinel, untuk chat pair.
  - `AN3` note rutin untuk `no_potential`.
  - Jawaban outcome: `"Weekly prep dropped from 5 to 2 hours"` (angka ini menjadi input sah untuk refine).
- Owner B: activity dan consent sendiri; dipakai hanya untuk isolasi.
- Key palsu log: `sk-test-WP-SENTINEL-KEY`.
- Setiap test membersihkan akun fixture seperti suite T13.

## 7. Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm exec supabase migration list --local
pnpm test:integration:ai-review
pnpm test:integration:ai
pnpm test:integration:activity
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:dashboard
pnpm test:integration:m2
pnpm test:integration:evidence
pnpm test:e2e:ai-review
pnpm test:e2e:ai
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:projects
pnpm test:e2e:achievements
pnpm test:e2e:dashboard
pnpm test:e2e:m2
pnpm test:e2e:evidence
pnpm worker:check
pnpm worker:once
pnpm build
git diff --check
```

`test:integration:ai-review` dan `test:e2e:ai-review` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, parity bukan 22/22, atau query duplikat per revisi tidak kosong.
- Penyelesaian memerlukan `db reset`, rewrite migration lama, perubahan kolom `achievements`, atau perubahan daftar schema yang di-expose.
- `internal.update_activity` tidak dapat dipakai untuk jawaban tanpa mengubah perilaku T06, dan penulisan langsung akan melewati validasi context/panjang yang sama.
- Mengganti return type `request_ai_analysis` merusak kontrak T13 di luar penambahan `kind`.
- Implementasi terasa memerlukan auto-apply, auto-confirm, link skill otomatis, analisis saat save, kind `import`, kuota AI, atau perubahan CV (T15/T20).
- Test membutuhkan key nyata, key/sentinel muncul di output, atau `m2-manual-journey` gagal karena env AI.
- Smoke live opsional gagal karena akun/billing/kuota; jangan mencoba model lain tanpa persetujuan.

## 9. Gate review Claude (setelah Fase 5)

Review read-only mencakup:

- Tidak ada write langsung ke `ai_jobs` atau `ai_suggestion_reviews` dari role mana pun; RLS dan grant sesuai.
- Satu job per revisi ditegakkan DB; batas pertanyaan per kind ditegakkan tabel dan worker.
- Consent dicek pada request, input, complete (T13), apply, dan enqueue refine; skip/dismiss tidak membutuhkan consent.
- Apply: revisi activity dan Achievement dicocokkan di bawah lock dengan urutan konsisten; tidak ada jalur ke `confirmed`; confirmed/dismissed/edited draft tidak berubah; idempoten.
- Jawaban menaikkan revisi tepat satu kali, `raw_text` tetap, chat pair hanya mode chat, refine atomik.
- Grounding teks dan metric; result lama yang gagal validator baru tidak dapat tampil atau di-apply.
- UI jujur: *Saved* terpisah dari analisis, queued tanpa worker ditampilkan apa adanya, note asli tidak pernah tersembunyi, manual path selalu terlihat saat gagal.
- Tidak ada teks sumber/jawaban/key di log, error, atau response route.
- Aksesibilitas dan responsif sesuai §1.19; tidak ada fitur roadmap.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Apply menimpa pekerjaan pengguna.** Pemeriksaan *untouched* memakai revisi yang salah atau lupa kasus draft manual kosong. Dijaga pgTAP 6 dan integration 10 (edit lewat `save_achievement` lalu apply → `DRAFT_EDITED`, row identik).
2. **Hasil stale muncul sebagai saran revisi baru.** View model atau route memilih job terbaru tanpa mencocokkan `input_revision` dengan revisi activity. Dijaga unit `ai-analysis-view` dan integration 5 / E2E 7.
3. **Loop pertanyaan tanpa batas.** Refine yang tetap bertanya, atau jawaban yang membuat job detect baru dengan pertanyaan lagi. Dijaga constraint questions per kind, unique per revisi, pgTAP 3, dan integration 8.
4. **Jawaban dobel menaikkan revisi dua kali** atau membuat dua job refine. Dijaga replay `answers_hash` dan integration 8 (paralel ×3).
5. **Consent hanya dicek di UI.** Apply atau refine berjalan setelah withdraw. Dijaga pgTAP 4/6 dan integration 2.
6. **Kebocoran teks lewat route atau error.** Response route atau pesan error membawa jawaban/raw text. Dijaga integration 13, unit route, dan grep sentinel.

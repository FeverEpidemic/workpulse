# 0020 — T14 Detection, refinement, dan review

- Tanggal: 29 September 2026
- Status: Diterima (menunggu keputusan status T14 oleh reviewer/pengguna)
- Rujukan: PRD R04/R05, §3 *Detection and confirmation*, §4 *AI disclosure / Data minimization / Failures*; User Flow F02 (langkah 3–6), F03; Wireframe §1, S05, S06, S08; Database Schema §3 dan §6; `IMPLEMENTATION_PLAN.md` §1, §3, §4/T14; [handoff T14](../verification/T14-implementation-plan.md); [decision 0019](0019-t13-ai-jobs-consent.md).

## Konteks

T13 menyediakan job AI yang durable dan consent. T14 memakainya untuk analisis activity: saran satu Achievement, pertanyaan lanjutan opsional, penolakan saran, dan pembukaan saran sebagai **draft**. Syarat: tidak ada auto-confirm, hasil lama tidak menimpa revisi yang lebih baru atau karya pengguna, dan jalur manual tetap utuh saat AI gagal.

## Keputusan

1. **Analisis diminta eksplisit dari S06.** Save di S05 tidak meng-enqueue job. Tombol *Analyze with AI* ada di panel S06; tanpa consent tombol membuka `AiConsentDialog`.
2. **Satu job AI per revisi activity, lintas kind.** `ai_jobs_one_per_revision_key` unik pada `(user_id, activity_id, input_revision)`. Request ganda mengembalikan job yang sama, dan `payload_hash` yang berbeda ditolak (`IDEMPOTENCY_KEY_REUSED`). Insert dipusatkan di `internal.enqueue_ai_job`, yang dipakai `request_ai_analysis` (detect) dan `answer_ai_questions` (refine).
3. **Kind `refine`** hanya dibuat oleh `answer_ai_questions`. Input worker identik dengan detect, `schema_version` tetap `detect.v1`, dan prompt `refine.prompt.v1` menambahkan "pertanyaan sudah dijawab; `questions` harus `[]`". Provider menerima kind lewat parameter ketiga `detect(input, signal, jobKind)`.
4. **Batas pertanyaan ditegakkan tabel**: `ai_jobs_questions_check` (≤ 3) dan `ai_jobs_refine_no_questions_check`. `complete_ai_job` memeriksa aturan itu sebelum update dan mengembalikan `'invalid'` (job `failed/AI_OUTPUT_INVALID`). Karena satu revisi hanya punya satu job dan refine tidak bertanya, maksimal tiga follow-up per revisi bersifat struktural.
5. **Jawaban = revisi input baru.** `answer_ai_questions` menerima 1–3 jawaban hanya untuk field yang ditanyakan job dan masih kosong, menulisnya lewat `internal.update_activity` (validasi T06, revisi naik satu kali), menambah pasangan `chat_messages` bila `capture_mode = chat`, lalu meng-enqueue job refine bila consent terkini. Tanpa consent jawaban tetap tersimpan dan job tidak dibuat. Replay jawaban identik mengembalikan hasil yang sama (`answers_hash`); jawaban berbeda untuk revisi yang sudah dijawab ditolak.
6. **Tabel `public.ai_suggestion_reviews`**, satu row per `(user_id, activity_id, activity_revision)`: `state` (`open`/`dismissed`/`applied`), `questions_skipped_at`, `answered_at`, `answers_hash`, `applied_achievement_id`, `applied_achievement_revision`. Hanya RPC yang menulisnya; kolom tabel `achievements` tidak diubah.
7. **Apply hanya membuat atau menyegarkan draft.** `apply_ai_suggestion` menolak job yang bukan `succeeded`/potensial (`AI_JOB_NOT_APPLICABLE`), revisi tidak cocok (`STALE_INPUT`/`STALE_REVISION`), consent hilang (`CONSENT_REQUIRED`), review `dismissed` (`AI_SUGGESTION_DISMISSED`), Achievement `confirmed` (`ACHIEVEMENT_CONFIRMED`), `dismissed` (`ACHIEVEMENT_DISMISSED`), atau draft yang sudah diedit (`DRAFT_EDITED`). Draft *untouched* boleh diperbarui. `suggestion.role` tidak diterapkan; metric `baseline: null` dihilangkan (`internal.ai_apply_metrics`). Replay tidak menaikkan revisi karena `guard_achievement_row` (T09) hanya menaikkan revisi saat data berubah.
8. **Perluasan semantik `source_excerpt` (T09).** Draft *untouched* yang diperbarui dari saran revisi lebih baru ikut memperbarui `source_excerpt` dan `source_activity_revision` ke revisi saat ini. *Untouched* berarti semua field konten NULL dan `metrics = '[]'`, atau revisi Achievement sama dengan `applied_achievement_revision` pada review terakhir.
9. **Skip dan dismiss tidak butuh consent** karena tidak memproses data; keduanya idempoten. Dismiss atas review `applied` ditolak (`AI_SUGGESTION_APPLIED`); pertanyaan yang sudah di-skip/di-dismiss ditolak `AI_QUESTIONS_CLOSED`.
10. **Grounding diperluas.** `validateDetectResult(raw, input, { kind })` menolak pertanyaan pada refine, angka di teks saran yang tidak ada di input, dan metric ungrounded. Validator yang sama dipakai service sebelum saran ditampilkan; result tersimpan yang gagal validator ditampilkan sebagai `AI_OUTPUT_INVALID` dan tidak dapat di-apply.
11. **Skill saran lewat aksi pengguna.** S08 menampilkan chip *Add* yang hanya mengubah state form; link skill tersimpan saat Save/Confirm T09.
12. **Aside saran S08 read-only** untuk saran yang lebih baru saat apply diblokir (`DRAFT_EDITED`/`ACHIEVEMENT_CONFIRMED`), tanpa tombol overwrite.
13. **Status dibaca lewat `GET /api/ai/activities/[id]/analysis`** (owner session, `no-store`, error generik, tanpa `raw_text`); perubahan lewat server action di `src/features/ai/actions.ts`. State view: `none`, `queued`, `running`, `failed`, `stale`, `no_potential`, `suggestion`, `suppressed`, `applied`. Polling berhenti di status terminal.
14. **Fake provider** (development/test saja) mendapat skenario `no_potential`, `fabricated_text`, `many_questions`, dan `with_skills`.
15. **Urutan lock** untuk RPC T14 yang menyentuh lebih dari satu tabel: profile (`for share`) → experience/project → activity (`for update`) → derived Achievement → job → review. Ini sama dengan `internal.update_activity`.
    - Koreksi gate review: `answer_ai_questions` awalnya mengunci job → review → activity, kebalikan dari apply, sehingga answer dan apply pada job yang sama dapat deadlock (`40P01`, tampil sebagai `UNAVAILABLE`). Migration forward-only `20260929100000_t14_answer_lock_order.sql` menggantinya dengan urutan di atas. Test `11d` di integration menjalankan answer dan apply bersamaan (8 putaran).
16. **Nomor dan migration.** Decision ini 0020; migration `20260929090000_t14_ai_review.sql` dan `20260929100000_t14_answer_lock_order.sql`; parity lokal 24/24. Port E2E 3008.

## Perubahan pada kontrak T13

- `request_ai_analysis` dan `retry_ai_job` dijatuhkan dan dibuat ulang dengan kolom `kind` pada receipt (return type berubah, sehingga bukan `create or replace`). Badan fungsi tidak berubah selain insert lewat `internal.enqueue_ai_job`.
- `complete_ai_job` mendapat satu blok validasi pertanyaan sebelum update.
- `receiptSchema`/`JOB_COLUMNS` di `ai-job-service.ts` mewajibkan `kind`.
- Perubahan `retry_ai_job` pada Fase 3 diterapkan dengan memperluas migration `20260929090000` yang belum dipakai environment lain dan mengeksekusi delta langsung ke database lokal tanpa `db reset`. Sebelum migration ini masuk environment bersama, jalankan ulang dari nol atau verifikasi bahwa definisi di database sama dengan file.
- Tidak ada assertion pgTAP atau integration T13 yang dilemahkan; file pgTAP T13 tidak diubah.

## Error code baru

`AI_JOB_NOT_APPLICABLE`, `AI_SUGGESTION_DISMISSED`, `AI_SUGGESTION_APPLIED`, `AI_QUESTIONS_CLOSED`, `DRAFT_EDITED`, `ACHIEVEMENT_CONFIRMED`, `ACHIEVEMENT_DISMISSED`, `ACHIEVEMENT_EXISTS`, `INVALID_AI_ANSWER` (dipetakan ke `VALIDATION`). Pesan terlokalisasi en/id; kode job T13 tidak berubah.

## Seam

- **T15** menambah `import_batch_id`, kind `import`, dan consent import. Constraint satu-job-per-revisi berlaku pada target activity dan tidak menyentuh job import.
- **T20** memiliki flag *source changed* CV; T14 tidak mengubah aturan freshness.
- Log bersama: worker hanya mencetak hitungan dan error code (T13); T14 tidak menambah log baru.

## Konsekuensi

- Tanpa worker berjalan, job tetap `queued` dan UI menampilkan *Waiting to start*.
- Smoke live `refine` pada provider nyata belum dijalankan; kualitas jawaban model belum terbukti di luar fake provider.

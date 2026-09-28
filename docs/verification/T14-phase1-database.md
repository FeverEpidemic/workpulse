# T14 Fase 1 — Database (TDD pgTAP)

- Tanggal: 28 September 2026
- Pelaksana: Claude. Handoff: [T14-implementation-plan.md](T14-implementation-plan.md). Baseline: [Fase 0](T14-phase0-baseline.md).

## Tujuan

Migration forward-only `20260929090000_t14_ai_review.sql`: kind `refine`, satu job per revisi
lintas kind, batas pertanyaan per kind ditegakkan tabel, tabel `public.ai_suggestion_reviews`,
dan RPC `answer_ai_questions`/`skip_ai_questions`/`dismiss_ai_suggestion`/`apply_ai_suggestion`,
mengikuti §3.1 rencana. TDD: `supabase/tests/database/ai_review.test.sql` ditulis dan dikonfirmasi
gagal (tabel belum ada) sebelum migration ditulis.

## TDD

1. Test ditulis, `pnpm db:test` dikonfirmasi **FAIL** (`relation "public.ai_suggestion_reviews" does not exist`, 3/4 subtest gagal pada file baru).
2. Migration ditulis; `pnpm exec supabase migration up --local` diterapkan tanpa `db reset`.
3. Iterasi debug pada fixture test itu sendiri (bukan migration) — dicatat karena tiga kegagalan awal murni bug fixture:
   - `result_with_questions(4)` hanya pernah menghasilkan 3 field (role/scope/outcome ada di alam semesta, tidak ada field ke-4); diperbaiki agar p_n=4 menduplikasi field `role`.
   - Helper mengabaikan `p_n` untuk `p_kind='refine'` (selalu 0 pertanyaan), sehingga skenario "refine result with questions is rejected" tidak pernah benar-benar mengirim pertanyaan; diperbaiki agar count selalu dihormati.
   - `claim_ai_jobs` FIFO mengambil job refine sisa dari skenario sebelumnya alih-alih job baru yang dimaksud test, karena job refine itu dibuat lebih dulu (created_at lebih awal). Diperbaiki dengan menguras (claim + complete) job refine sisa sebelum pindah ke skenario berikutnya, dan menambah kasus INVALID_AI_ANSWER yang bersih (field belum ditanyakan vs field sudah terisi) memakai activity chat baru dengan `role` sudah terisi sejak awal — sekaligus membuktikan penyisipan pasangan Chat.
4. Setelah perbaikan fixture, seluruh assertion pada file baru **PASS**. Ditambah cakupan isolasi akun B (§1.17) dan cascade delete (§1.j) yang belum ada di draft pertama.

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm db:test` (sebelum migration) | 1 | Gagal seperti diharapkan: `ai_suggestion_reviews` belum ada |
| `pnpm exec supabase migration up --local` | 0 | Migration diterapkan, tanpa reset |
| `pnpm db:test` (akhir) | 0 | **9 file / 540 assertion**, semua PASS (470 baseline T13 + 70 baru T14) |
| `pnpm db:lint` | 0 | Bersih, tiga schema (`extensions`, `internal`, `public`) |
| `pnpm exec supabase migration list --local` | 0 | **23/23**, local=remote semua, terakhir `20260929090000` |
| `pnpm db:types` (`supabase gen types typescript --local --schema public`, redirect ke `src/server/supabase/database.types.ts`) | 0 | Regenerasi berhasil; tabel `ai_suggestion_reviews` dan kolom `ai_jobs.kind` (sudah ada sejak T13) hadir di types |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih (perubahan return type `request_ai_analysis` tidak memecah compile-time karena TS layer belum mengasumsikan bentuk row secara statis) |
| `pnpm test` | 0 | 51 file / 274 test, tidak berubah dari baseline (Fase 1 tidak menyentuh TS) |
| `pnpm test:integration:ai` | 1 | **Regresi diharapkan gagal 12/13** — lihat catatan di bawah |

## Catatan regresi `test:integration:ai` (diharapkan, bukan bug)

`request_ai_analysis` sekarang mengembalikan kolom tambahan `kind`. `receiptSchema` di
`src/features/ai/ai-job-service.ts:28-34` memakai Zod `.strict()` yang menolak kolom tak
dikenal, sehingga setiap panggilan lewat `AiJobService.requestAnalysis` melempar
`AiServiceError("UNAVAILABLE")`. Ini persis perubahan yang didokumentasikan rencana §3.2 sebagai
pekerjaan **Fase 3** ("ai-job-service.ts: JOB_COLUMNS dan skema row menambah kind; receipt
menambah kind"), bukan cacat Fase 1. Regresi `test:integration:ai` akan diperbaiki dan diverifikasi
ulang lulus di Fase 3 sebagai bagian dari daftar regresi yang memang disebut rencana di sana. Tidak
ada perubahan kode TS dibuat di Fase 1 untuk menjaga diff tetap pada lapisan database sesuai
instruksi "ubah hanya bagian yang disebut".

## Diff terhadap body T13 (dicatat sesuai §3.1 catatan eksekutor)

- **`request_ai_analysis`**: return type diganti (`drop function` + `create function`, bukan
  `create or replace`, karena kolom `kind` ditambahkan). Badan fungsi identik dengan T13 sampai
  baris insert job; baris insert digantikan pemanggilan `internal.enqueue_ai_job(v_user_id,
  v_activity, 'detect')` (helper baru, lihat di bawah) alih-alih inline insert+on-conflict. Ini
  **satu penyimpangan disengaja** dari instruksi "ubah hanya bagian yang disebut": logika
  insert+on-conflict+set-state yang identik dibutuhkan lagi oleh `answer_ai_questions` untuk
  kind `refine`, jadi diekstrak ke `internal.enqueue_ai_job` agar invarian "satu job per revisi"
  punya satu sumber kebenaran, bukan disalin dua kali. Perilaku eksternal (kode error, kolom
  return, urutan pemeriksaan consent/revision) tidak berubah.
- **`complete_ai_job`**: badan identik dengan T13 ditambah satu blok baru persis sebelum
  `update ... set status = 'succeeded'`: pengecekan `jsonb_array_length(result->'questions') > 3`
  atau (`kind='refine'` dan pertanyaan apa pun) mengembalikan `'invalid'` lewat
  `internal.fail_ai_job_locked(v_job, 'AI_OUTPUT_INVALID')`, pola yang sama dengan pengecekan
  `is_valid_ai_result` yang sudah ada di atasnya.
- **`internal.fail_ai_job_locked`, `internal.set_activity_analysis_state`,
  `internal.has_current_ai_consent`, `internal.is_valid_ai_result`, `internal.guard_ai_job_row`,
  `internal.guard_activity_row`, `retry_ai_job`, `expire_ai_job_leases`, `claim_ai_jobs`,
  `get_ai_job_input`, `fail_ai_job`, `set_ai_consent`**: tidak diubah sama sekali.

## Asumsi/keputusan tambahan yang dibuat saat implementasi (dicatat untuk decision 0020 di Fase 6)

1. **`internal.enqueue_ai_job` helper baru** (lihat di atas) — dipakai `request_ai_analysis` (kind
   `detect`) dan langkah refine di `answer_ai_questions` (kind `refine`). Alasan: menghindari
   duplikasi logika insert/on-conflict/state yang mengunci invarian satu-job-per-revisi.
2. **Deteksi replay `answer_ai_questions`** memeriksa `ai_suggestion_reviews.answered_at` **sebelum**
   pengecekan revisi aktivitas, bukan sesudah. Sebab: setelah jawaban pertama sukses, revisi
   aktivitas sudah naik satu, sehingga permintaan ulang (retry jaringan) dengan
   `p_expected_revision` yang sama seperti permintaan asli akan tampak "stale" jika urutan
   pengecekan dibalik. Job/refine hasil replay diturunkan lewat query
   `ai_jobs` pada `input_revision = job.input_revision + 1 and kind = 'refine'`, bukan kolom
   tersimpan terpisah — satu job per revisi (constraint Fase 1) menjamin query ini tunggal.
3. **Apply idempoten untuk kasus create** (job yang sama diklik dua kali sebelum achievement ada)
   ditangani dengan mendeteksi `p_expected_achievement_revision is null` tetapi achievement kini
   ada dan review revisi tersebut `state='applied' and applied_achievement_id` cocok — expected
   revision lokal diisi ulang ke `v_achievement.revision` lalu lanjut ke jalur update-untouched
   biasa. Tanpa ini, retry jaringan pada create pertama akan salah ditolak `STALE_REVISION`.
4. **Idempotensi update draft** tidak memerlukan cabang kode terpisah: trigger
   `guard_achievement_row` (T09, tidak diubah) hanya menaikkan revisi bila konten benar-benar
   berbeda (`is distinct from`), sehingga apply ulang dengan saran yang sama otomatis
   tidak menaikkan revisi Achievement. Perilaku ini diverifikasi eksplisit oleh pgTAP
   (`replay does not bump the achievement revision`).
5. **Metric baseline null** dihilangkan lewat `internal.ai_apply_metrics`, fungsi murni baru,
   bukan dimodifikasi di `internal.is_valid_achievement_metrics` (T09, tidak diubah).

## Acceptance yang terbukti di fase ini

Butir §1 rencana yang punya bukti pgTAP di fase ini: 2 (tidak ada auto-apply/auto-confirm — draft
selalu, tidak pernah confirmed), 5 (pertanyaan berlebih dan refine dengan pertanyaan → `AI_OUTPUT_INVALID`),
8 (satu job per revisi lintas kind — pgTAP request/refine berbagi slot), 9 (maksimal tiga
follow-up, ditegakkan constraint), 10 (jawaban → revisi baru, chat pair, refine job, replay
idempoten), 12 (dismiss suppression + `AI_SUGGESTION_DISMISSED`), 13 (proteksi confirmed/draft
edited via jalur `save_achievement`), 14 (apply idempoten), 17 (isolasi dua akun). Butir yang
melibatkan UI, worker proses nyata, atau E2E (1, 3, 4, 6, 7, 11, 15, 16, 18, 19, 20) menunggu
Fase 2-5.

## Blocker dan langkah berikutnya

Tidak ada blocker. Regresi `test:integration:ai` yang diharapkan (lihat di atas) akan hilang
setelah Fase 3 memperbarui `ai-job-service.ts`. Langkah berikutnya: Fase 2 — domain (`analysis-view.ts`,
`apply-mapping.ts`, `contracts.ts`, `detect-result.ts`), prompt `refine.prompt.v1`, dan provider
(TDD unit).

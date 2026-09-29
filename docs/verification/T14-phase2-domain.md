# T14 Fase 2 — Domain, prompt, dan provider (TDD unit)

- Tanggal: 28 September 2026
- Pelaksana: Claude. Handoff: [T14-implementation-plan.md](T14-implementation-plan.md). Sebelumnya: [Fase 0](T14-phase0-baseline.md), [Fase 1](T14-phase1-database.md).

## Tujuan

§2.2.9 (grounding diperluas ke teks saran, bukan hanya metric), §2.2.13 (prompt `refine.prompt.v1`),
§2.2.14 (fake scenario tambahan), dan view model murni `analysis-view.ts`/`apply-mapping.ts` yang
Fase 3 (service) dan Fase 4 (UI) akan pakai sebagai spesifikasi.

## TDD

Semua test ditulis sebelum implementasi dan dikonfirmasi gagal (compile error atau assertion
gagal) sebelum kode produksi ditulis:

1. `tests/unit/detect-result.test.ts`: kasus fabricated-text dan refine-dengan-pertanyaan ditulis
   dulu; gagal karena `hasGroundedText` dan parameter `kind` belum ada. Dua kasus grounding yang
   sudah ada (`grounds metrics ... Indonesian` dan kasus baru "only in role/scope/outcome") sempat
   gagal setelah `hasGroundedText` diimplementasikan karena fixture test itu sendiri masih
   menyisakan angka default (3/5/2) di field teks yang tidak relevan dengan input baru — diperbaiki
   di fixture, bukan di domain code.
2. `tests/unit/ai-analysis-view.test.ts` (baru): ditulis sebelum `analysis-view.ts` ada (gagal
   resolve import). Satu kasus ("draft edited... allows an untouched one") awalnya gagal karena
   desain pertama salah memakai `review.appliedAchievementRevision` (baris review milik revisi job
   yang SEDANG dilihat) padahal Achievement bisa saja terakhir di-apply oleh revisi yang LEBIH LAMA.
   Diperbaiki dengan memindahkan provenance ke field baru `AnalysisViewAchievement.appliedRevision`
   yang eksplisit independen dari revisi job saat ini (lihat "Keputusan implementasi" di bawah).
3. `tests/unit/ai-apply-mapping.test.ts` (baru), `tests/unit/fake-provider.test.ts` (baru): gagal
   resolve sebelum `apply-mapping.ts` dan scenario baru ada.
4. `tests/unit/openai-provider.test.ts`, `tests/unit/ai-worker.test.ts`, `tests/unit/ai-contracts.test.ts`:
   assertion baru (kind refine, unknown kind, migration T14 berisi kode error) ditambahkan dan
   dikonfirmasi gagal sebelum provider/worker/contracts diubah.
5. `pnpm typecheck` sempat gagal dua kali setelah `detect-result.test.ts` diperluas: fixture
   `valid()` tidak diketik eksplisit sehingga TS menyimpulkan `scope: string` (bukan
   `string | null`) dan lalu `suggestion` masih dianggap bisa null di banyak baris walau runtime
   selalu ada. Diperbaiki dengan tipe `ValidResult = DetectResult & { suggestion: NonNullable<...> }`
   pada fixture, bukan mengubah domain type.

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm exec vitest run tests/unit/detect-result.test.ts` | 0 | 18 test |
| `pnpm exec vitest run tests/unit/ai-analysis-view.test.ts` | 0 | 14 test |
| `pnpm exec vitest run tests/unit/ai-apply-mapping.test.ts` | 0 | 5 test |
| `pnpm exec vitest run tests/unit/openai-provider.test.ts` | 0 | 16 test |
| `pnpm exec vitest run tests/unit/fake-provider.test.ts` | 0 | 5 test |
| `pnpm exec vitest run tests/unit/ai-worker.test.ts` | 0 | 15 test |
| `pnpm exec vitest run tests/unit/ai-contracts.test.ts` | 0 | 5 test |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | **54 file / 308 test** (51/274 baseline + 3 file baru/34 test) |

`pnpm db:test`, `pnpm db:lint`, migration list tidak diulang karena Fase 2 tidak menyentuh SQL.

## Perubahan

- `src/domain/ai/contracts.ts`: `AI_JOB_KINDS = ["detect", "refine"]`; `AI_REVIEW_ERROR_CODES`
  (9 kode: `AI_JOB_NOT_APPLICABLE`, `AI_SUGGESTION_DISMISSED`, `AI_SUGGESTION_APPLIED`,
  `AI_QUESTIONS_CLOSED`, `DRAFT_EDITED`, `ACHIEVEMENT_CONFIRMED`, `ACHIEVEMENT_DISMISSED`,
  `ACHIEVEMENT_EXISTS`, `INVALID_AI_ANSWER`) terpisah dari `AI_ERROR_CODES` (kode worker T13, tidak
  diubah). Pemetaan ke `AiServiceErrorCode` di `ai-errors.ts` adalah pekerjaan Fase 3.
- `src/domain/ai/detect-result.ts`: `hasGroundedText` baru (angka di
  title/contribution/outcome/scope/cv_bullet harus muncul di `raw_text`/`role`/`scope`/`outcome`
  input, memakai `numbersIn` yang sama dengan metric). `validateDetectResult` menerima
  `options?: { kind }`; `kind: "refine"` dengan `questions.length > 0` ditolak sebelum pengecekan
  grounding.
- `src/domain/ai/analysis-view.ts` (baru, murni): `toAnalysisView` mengembalikan union state
  `none | queued | running | failed | stale | no_potential | suggestion | suppressed | applied`
  plus `canRetry`, `canApply`, `applyBlockReason`, `visibleQuestions`.
- `src/domain/ai/apply-mapping.ts` (baru, murni): `suggestionToDraftFields` — spesifikasi TS untuk
  pemetaan yang dilakukan `internal.ai_apply_metrics` + `apply_ai_suggestion` di SQL (Fase 1); baseline
  null dihilangkan, `role` tidak pernah dipakai.
- `src/server/ai/detect-prompt.ts`: `REFINE_PROMPT_VERSION = "refine.prompt.v1"`,
  `REFINE_INSTRUCTIONS` (instruksi detect + "questions must be [].").
- `src/server/ai/provider.ts`: `AIProvider.detect` menerima parameter ketiga opsional `jobKind`.
- `src/server/ai/openai-provider.ts`: `requestBody`/`detect` meneruskan `jobKind`; instruksi
  dipilih lewat `instructionsFor(mode, jobKind)`. Payload tetap lima kunci (`raw_text/role/scope/outcome/locale`)
  untuk kedua kind — dibuktikan unit.
- `src/server/ai/fake-provider.ts`: scenario baru `no_potential`, `fabricated_text` (angka `4173`
  yang dijamin tidak pernah ada di fixture manapun), `many_questions` (4 pertanyaan, dua di
  antaranya field `role` duplikat, dikembalikan untuk kind apa pun — scenario ini sengaja
  mensimulasikan model yang mengabaikan instruksi refine, supaya validator/DB benar-benar diuji).
  Scenario `valid` mengembalikan `questions = []` untuk `jobKind = "refine"`.
- `workers/ai-worker.ts`: `isValidClaim` menerima `kind` `detect` atau `refine`; job dengan kind
  lain (mis. `import`, belum dipakai T14) tetap `stale` tanpa memanggil provider. `processJob`
  meneruskan `job.kind` ke `provider.detect` dan `validateDetectResult`.

## Keputusan implementasi (untuk decision 0020 di Fase 6)

1. **`AnalysisViewAchievement.appliedRevision`** (bukan mewarisi nilai dari `review` param job saat
   ini). Draft "untouched" bisa saja terakhir di-apply oleh revisi job yang LEBIH LAMA daripada job
   yang sedang dilihat (skenario: suggestion baru muncul di revisi 2, draft masih di kondisi apply
   dari revisi 1). Memakai `review.appliedAchievementRevision` (review row milik revisi job SAAT
   INI, yang untuk suggestion baru biasanya belum ada barisnya) akan salah memblokir apply pada
   draft yang sebenarnya belum disentuh. Field baru ini eksplisit menyimpan provenance milik
   Achievement itu sendiri; Fase 3 mengisinya lewat query terpisah ke `ai_suggestion_reviews`
   (`applied_achievement_id = achievement.id`, ambil `applied_achievement_revision` terbaru),
   sesuai logika yang SQL `apply_ai_suggestion` (Fase 1) sudah pakai lewat `exists (...)`.
2. **`AI_REVIEW_ERROR_CODES` terpisah dari `AI_ERROR_CODES`.** Kode T13 (`AI_ERROR_CODES`) adalah
   hasil job/worker (dicatat di `ai_jobs.error_code`); kode T14 baru adalah error RPC review
   (dilempar sebagai `P0001`/`22023`, tidak pernah disimpan di `ai_jobs`). Memisahkan mencegah
   worker code dan review code tercampur di satu union type yang dipakai untuk tujuan berbeda.
3. **`fabricated_text` fixture memakai angka `4173`** (bukan angka acak kecil) khusus supaya tidak
   pernah bertabrakan tanpa sengaja dengan angka nyata di fixture test/integration mana pun.

## Acceptance yang terbukti

Bagian domain dari §1.5 (grounding teks, bukan hanya metric — unit), §1.9 (batas pertanyaan per
kind di level validator, sebelum mencapai DB — unit), §1.16 (state jujur — `analysis-view` unit
mencakup semua transisi utama termasuk stale/no_potential/suppressed/applied). Sisanya (jalur
end-to-end lewat service, route, dan worker nyata) menunggu Fase 3.

## Blocker dan langkah berikutnya

Tidak ada blocker. Langkah berikutnya: Fase 3 — `ai-review-service.ts`, route GET status, server
actions, dan integration test nyata (termasuk memperbaiki regresi `test:integration:ai` yang
dicatat di Fase 1 akibat kolom `kind` baru pada receipt `request_ai_analysis`).

# T14 Fase 4 — UI (S06 panel, S08 aside)

Tanggal: 2026-09-29. Status: PARTIAL (Fase 4 selesai lokal; T14 belum DONE, menunggu Fase 5 dan gate review).
Rujukan: R05–R06, F02, S06, S08; plan `T14-implementation-plan.md` §5 Fase 4.

## Scope selesai

- S06 `ActivityAnalysisPanel` (`src/features/ai/activity-analysis-panel.tsx`): state none, queued, running, failed, stale, no_potential, suggestion, suppressed, applied. Panel membaca `GET /api/ai/activities/[id]/analysis` (no-store) dan polling hanya saat queued/running memakai `EVIDENCE_POLL_DELAYS`.
- Tanpa consent, *Analyze with AI* membuka `AiConsentDialog`; *Allow AI* menyimpan consent lalu otomatis meminta analisis. *Continue manually* tidak membuat job.
- Failed: pesan per kode kegagalan, Retry (nonaktif dengan alasan saat sudah 3 attempt atau consent ditarik), *Create achievement manually*, dan teks sumber tetap terlihat.
- Suggestion: teks sumber di samping wording saran, pertanyaan follow-up (input terkontrol karena React 19 me-reset field uncontrolled setelah form action), *Answer*, *Skip questions*, *Save for later*, *Review as draft*, *Dismiss suggestion*. Apply hanya membuat/menyegarkan draft; alasan apply diblokir dijelaskan (`BLOCK_KEYS`). CONFLICT ditampilkan sebagai `RevisionConflict` dengan reload.
- S08 `AiSuggestionAside` (read-only, tanpa tombol/form) muncul hanya ketika saran baru tidak boleh menimpa achievement (draft sudah diedit, confirmed, atau dismissed). Skill saran hanya chip *Add {name}* di `AchievementForm` yang mengubah state lokal; tidak ada auto-link dan tidak ada persist sampai user menyimpan.
- Helper murni `toAchievementAiSuggestion` (`src/features/ai/achievement-ai-suggestion.ts`).
- i18n `ai.analysis.*` dan `ai.aside.*` untuk `en` dan `id`; CSS token-only (`.ai-analysis*`, `.ai-suggested-skills`), tanpa gradient/sparkle.

## File berubah

Baru: `activity-analysis-panel.tsx`, `ai-suggestion-aside.tsx`, `achievement-ai-suggestion.ts`, `tests/unit/ai-analysis-panel.test.tsx`.
Diubah: `activity/[id]/page.tsx`, `achievements/[id]/page.tsx`, `activity-detail.tsx`, `achievement-detail.tsx`, `achievement-form.tsx`, `globals.css`, `messages.ts`, `tests/unit/activity-context-ui.test.tsx` (prop `consent`), `tests/e2e/activity-ui.spec.ts`.

## Perubahan pada test yang sudah ada

`tests/e2e/activity-ui.spec.ts:266` sebelumnya menegaskan tidak ada teks `/analyz/i` pada detail activity mode Chat. Panel T14 memang menawarkan *Analyze with AI*, jadi asersi diganti: tombol tersedia, tetapi tidak ada klaim `waiting to start`, `analyzing…`, atau `suggested wording` sebelum user meminta. Ini pelonggaran yang disengaja dan sesuai plan (analisis diminta eksplisit dari S06), bukan pelemahan invariant "manual capture tanpa AI".

## Perintah dan hasil

| Perintah | Hasil |
| --- | --- |
| `pnpm typecheck` | bersih |
| `pnpm lint` | bersih (setelah memperbaiki dua `react-hooks/set-state-in-effect`: consent diturunkan dari action state, load awal ditunda lewat timer) |
| `pnpm test` | 57 file, 356 test lulus |
| `pnpm test:e2e:activity` | 1/1 lulus |
| `pnpm test:e2e:achievements` | 4/4 lulus |

## Belum dijalankan / belum terbukti

- Perilaku panel di browser dengan worker fake (queued → suggestion → refine → apply → S08): Fase 5 (`ai-review.spec.ts`).
- Axe, keyboard, screenshot 360/1440 light/dark untuk panel dan aside: Fase 5.
- `pnpm build`, `worker:check`, dan regresi penuh §7: Fase 5.

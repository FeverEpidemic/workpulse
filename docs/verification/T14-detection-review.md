# T14 — Detection, refinement, dan review: bukti acceptance

- Tanggal: 29 September 2026. Status usulan: **PARTIAL sampai reviewer/pengguna memutuskan** (T14 belum ditandai DONE; `IMPLEMENTATION_STATUS.md` tidak diubah).
- Rujukan: R04, R05, F02, F03, S05, S06, S08, DB §3/§6; handoff [T14-implementation-plan.md](T14-implementation-plan.md); [decision 0020](../decisions/0020-t14-detection-review.md).
- Receipt fase: [0](T14-phase0-baseline.md), [1](T14-phase1-database.md), [2](T14-phase2-domain.md), [3](T14-phase3-service-integration.md), [4](T14-phase4-ui.md), [5](T14-phase5-browser-regression.md).

## Gate review (Claude) dan perbaikan

| Temuan | Tingkat | Status |
| --- | --- | --- |
| `answer_ai_questions` mengunci job → review → activity, kebalikan `apply_ai_suggestion`; answer dan apply pada job yang sama dapat deadlock | P2 | **Diperbaiki** (`20260929100000_t14_answer_lock_order.sql`, commit `e6dce2a`), dengan test race `11d` |
| Log hygiene (§1.18) hanya diuji pada return value, bukan stdout/stderr worker atau log server Next | P3 | Terbuka |
| Perubahan return type `request_ai_analysis`/`retry_ai_job` (`kind`) menyentuh kontrak T13 | P3 | Dicatat di decision 0020 |
| `mapAiErrorCode` memetakan kode di luar daftar ke `CONFLICT` | P3 | Terbuka, kosmetik |
| Jawaban dikirim tanpa `trim()` ke server (hanya cek kosong yang di-trim) | P3 | Terbuka, server memvalidasi |

Test `11d` menjalankan answer dan apply bersamaan pada 8 activity dan menegaskan tidak ada error `UNAVAILABLE` (jalur `40P01`). Test itu **tidak dibuktikan gagal** terhadap urutan lock lama; ia menjaga regresi, bukan bukti bahwa race lama pasti terpicu.

## Perintah dan hasil (setelah perbaikan)

| Perintah | Hasil |
| --- | --- |
| `pnpm exec supabase migration up` | migration `20260929100000` diterapkan tanpa `db reset`; `migration list --local` 24/24 |
| `pnpm test:integration:ai-review` | 21/21 lulus (termasuk `11d`) |
| `pnpm test:integration:ai`, `:activity`, `:achievements` | lulus (13, 6, 5 test) |
| `pnpm test:e2e:ai-review` | 11/11 lulus |
| `pnpm db:test` | 9 file, 540 assertion PASS; `pnpm db:lint` bersih |
| `pnpm lint`, `pnpm typecheck` | exit 0 |

Hasil suite lain (unit 357, seluruh integration/E2E T06–T13 kecuali dua di bawah, `build`, `worker:check`) berasal dari Fase 5 pada commit `6bc054d`, sebelum migration perbaikan; migration itu hanya mengganti satu fungsi dan tidak menyentuh kode TypeScript, sehingga suite tersebut tidak dijalankan ulang penuh setelahnya.

## Trace acceptance (§1 rencana)

| # | Butir | Bukti | Status |
| --- | --- | --- | --- |
| 1 | Alur utama sampai confirm | integration 1; E2E (follow-up → refine → Review as draft → S08 → confirm) | Lulus |
| 2 | Tanpa auto-apply/auto-confirm | pgTAP `ai_review`; integration 1 (jumlah row sebelum/sesudah) | Lulus |
| 3 | Consent declined/ditarik | pgTAP; integration 3; E2E (dialog, *Continue manually* tanpa job) | Lulus |
| 4 | AI outage + Retry | integration 4; E2E outage → Retry | Lulus |
| 5 | Malformed, ungrounded, refine bertanya | unit `detect-result`; integration 5 (4 skenario) | Lulus |
| 6 | Edit saat berjalan → stale | pgTAP; integration 6; E2E edit saat queued | Lulus |
| 7 | Retry habis, retry paralel | integration 7 | Lulus (E2E tidak mencakup retry habis) |
| 8 | Satu job per revisi | pgTAP; integration (×5 paralel, detect/refine) | Lulus |
| 9 | Maks 3 follow-up | pgTAP (constraint); unit | Lulus |
| 10 | Jawaban = revisi baru, chat pair, refine, replay | pgTAP; integration 9, 9b | Lulus |
| 11 | Skip / Save for later | E2E | Lulus |
| 12 | Dismiss suppression | pgTAP; integration 10; E2E | Lulus |
| 13 | Proteksi Achievement | pgTAP; integration 11a, 11b, E2E S08 draft diedit | Lulus |
| 14 | Apply idempoten | integration 11c (×3 paralel) | Lulus |
| 15 | Nonpotential | integration 12; E2E | Lulus |
| 16 | Status jujur | unit `analysis-view`, `ai-analysis-panel`; E2E queued → suggestion | Lulus |
| 17 | Isolasi dua akun | pgTAP; integration 13; E2E API 404 | Lulus |
| 18 | Log hygiene | integration 14 (return value, receipt, error, ringkasan worker) dan log T13 | **Sebagian** — stdout/stderr worker dan log server Next tidak ditangkap oleh test T14 |
| 19 | UI aksesibel | E2E axe, 360/1440 × light/dark, en/id, keyboard | Lulus untuk axe, layout, tema, bahasa, dan keyboard; pengembalian fokus ke pemicu setelah dialog tidak diverifikasi terpisah dalam review ini (lihat catatan dialog) |
| 20 | Regresi T06–T13 | lihat "Tidak dijalankan/gagal" | **Sebagian** — `test:e2e:m2` dan `test:e2e:evidence` (`evidence-api.spec.ts:46`) gagal karena scanner |

Tambahan: concurrency answer-versus-apply (P2) — integration `11d` (Lulus).

## Tidak dijalankan atau belum terbukti

- **`test:e2e:m2` dan `test:e2e:evidence`** gagal di `waitForReady`/status `scanning`. Penyebab yang dicurigai adalah ClamAV tidak berjalan; kegagalan yang sama belum dibuktikan ada pada commit sebelum T14. T14 tidak mengubah kode evidence.
- **Suite ClamAV** (`test:integration:evidence`, scanner nyata) tidak dijalankan.
- **Smoke live `refine`** pada provider nyata tidak dijalankan (butuh persetujuan pengguna); perilaku model nyata terhadap prompt `refine.prompt.v1` belum terbukti.
- **Dialog consent:** membuka ulang dengan Enter tepat setelah Escape tidak memicu klik tanpa jeda 300 ms; akar penyebab tidak dibuktikan dan `Dialog` tidak diubah.
- **Lingkungan:** `supabase_vector` restart terus; log webServer "The destination stream closed early" muncul saat E2E tanpa menggagalkan test.
- **Migration:** definisi `retry_ai_job` pada Fase 3 diterapkan ke DB lokal lewat psql, bukan melalui `migration up`. Sebelum dipakai environment bersama, verifikasi dari database kosong.
- Test ulang penuh unit/build setelah migration perbaikan tidak dijalankan (alasan di atas).

## Langkah berikutnya

Reviewer/pengguna memutuskan status T14 dan menutup atau menerima butir P3 dan item yang belum terbukti; pengguna memutuskan apakah smoke live `refine` dijalankan. Setelah itu, T15.

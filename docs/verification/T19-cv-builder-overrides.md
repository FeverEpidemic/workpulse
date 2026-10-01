# T19 CV builder dan overrides — bukti acceptance

- Tanggal: 1 Oktober 2026
- Status: **DONE** (acceptance lokal)
- Pelaksana: Claude Sonnet 5.5 (Fase 0–5); reviewer: Claude (Opus), gate review `T19-gate-review.md` tanpa P0–P2. Tujuh P3 (F1–F7) diperbaiki reviewer di `58d1f25` atas instruksi pengguna (review ulang tidak independen penuh; ditopang test yang terbukti gagal tanpa perbaikan untuk F2).
- Trace: PRD R09, *CV freshness contract* (override dan pool), *Shared validation*, release scenario graduate tanpa CV (sampai penyusunan CV) dan edit achievement setelah wording manual (bagian override); F07 langkah 1–2, F03; S13 `/cv`; DB §5 (`summary_override`, `override_text`, `profile_snapshot`), §6 (*simultaneous CV edits*). Decision [0025](../decisions/0025-t19-cv-builder-overrides.md). Receipt [Fase 0](T19-phase0-baseline.md)–[5](T19-phase5-integration-browser-regression.md).

## Acceptance §1

| # | Poin | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | First open: satu CV, locale profil, `Master CV`, kosong + empty state | PASS | integration graduate (3 `ensure` paralel → 1 CV); E2E graduate |
| 2 | Selection enam section, draft/dismissed tidak di pool, parent otomatis, *Added* | PASS | unit markup; E2E graduate |
| 3 | Achievement tepat sekali di bawah parent | PASS | unit `cv-preview`, markup; E2E graduate; pool menyebut "On the CV under …" (F4) |
| 4 | Move aksesibel (label, disabled tepi, live region, fokus, keyboard) | PASS | unit `computeItemMove`/`computeSectionMove`, `cv-builder-state` (posisi announce); E2E keyboard |
| 5 | Locale CV mengubah label/tanggal, bukan konten atau locale UI | PASS | unit `cv-labels`/`cv-preview`; E2E locale (`html lang` dan profil tetap `en`) |
| 6 | Override wording terpisah dari snapshot dan canonical; skill/certification ditolak | PASS | pgTAP; integration 1–2 |
| 7 | Judul, summary, contact tampilan di `display_overrides`; sumber tidak berubah | PASS | pgTAP; unit kontrak/resolve; integration graduate |
| 8 | Save eksplisit, satu revision per batch, invalid/no-op tanpa write | PASS | pgTAP; integration (`revision + 1`, no-op sama) |
| 9 | Edit basi tidak menimpa; input lokal dipertahankan; Keep mine / Use saved | PASS | integration dua koneksi 3 putaran tanpa `40P01`; unit `reconcileDraft`/`syncDraft`/`deriveSaveState`; E2E dua konteks |
| 10 | Parent removal lewat dialog, fokus kembali | PASS | integration 4; E2E dialog (Escape, konfirmasi, fokus) |
| 11 | Preview hanya dari saved | PASS | unit markup; E2E (preview berubah hanya setelah Save) |
| 12 | State loading/empty/error/pending/saved/unsaved/conflict/manual/deleted | PASS | `loading.tsx`; markup + E2E; error klien kini membawa correlation ID (F5); wording item yang dihapus di sesi lain dilaporkan (F6, E2E) |
| 13 | Add to CV | PASS | unit `resolveHighlight`; E2E (menyorot tanpa menambah, draft tanpa tautan, parameter buruk diabaikan) |
| 14 | Graduate journey | PASS | E2E + integration; record canonical identik sebelum/sesudah |
| 15 | Aksesibilitas dan responsive | PASS | E2E Axe 0 serious/critical pada 360/1440 × light/dark, tanpa overflow, reduced motion; screenshot `T19-screenshots/` (diregenerasi setelah F4) |
| 16 | Tanpa perubahan perilaku lama | PASS | pgTAP T18, `test:integration:cv`, seluruh suite T02–T17, M2/M3 lulus |
| 17 | Log hygiene, correlation ID F2 T18 | PASS | integration sentinel; unit action (ID error = ID service); `console.` di `src/features/cv` = 0 |

## Command

Angka gate = reviewer pada HEAD `03207fb`; angka akhir = reviewer setelah perbaikan P3 (`58d1f25`).

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint`, `typecheck`, `build`, `worker:check` | 0 | bersih (gate dan akhir) |
| `git diff --check 2087200..HEAD` | 2 → 0 | gate: 2 blank line EOF (F1); akhir bersih |
| `pnpm test` | 0 | gate 86 file / 626; akhir 87 file / 635 |
| `pnpm db:test` | 0 | gate 13 file / 978; akhir 13 file / 979 (assertion F2 red → green) |
| `pnpm db:lint` | 0 | `results: []` |
| `pnpm db:types` | 0 | tanpa perubahan setelah migration grant |
| `supabase migration list --local` | 0 | 29/29, terakhir `20261003100000` |
| `supabase db diff --local --schema public,internal` | 0 | 29 migration di shadow DB dari nol → "No schema changes found" (F7) |
| `test:integration:cv-builder` / `cv` | 0 | 7/7, 10/10 (gate dan akhir) |
| `test:integration:` achievements, projects, activity, dashboard, import-commit, import-review, import, m2, m3, ai, ai-review, evidence, storage | 0 | 5, 7, 6, 4, 11, 6, 21, 8, 7, 13, 21, 14, 1 (reviewer, gate) |
| `test:e2e:cv` | 0 | gate 7 passed (dua kali); akhir 8 passed (test F6 baru) |
| `test:e2e:` achievements, m2, m3 | 0 | 4, 1, 2 (gate dan akhir) |
| `test:e2e:` projects, dashboard, auth, ui, activity, import, import-review, ai, ai-review, evidence | 0 | 1, 1, 1, 1, 1, 7, 10, 2, 11, 8 (reviewer, gate) |

## Flaky, tidak dijalankan, batas

- **Flaky:** run pertama pelaksana gagal pada `test:e2e:activity` dan `test:e2e:evidence` (flaky bawaan `activity-ui.spec.ts:356`), lulus saat diulang; run reviewer tidak flaky. Satu run `db:test` reviewer menggagalkan `evidence.test.sql` #7 karena jam dinding melompat (mesin tertidur, 3187 detik wallclock); diulang tanpa perubahan → lulus.
- **Tidak dijalankan:** `test:e2e` gabungan, `test:ai:live` (T19 tanpa AI), stres race berskala, staging/production. Setelah `58d1f25` suite integration/E2E di luar CV, achievements, M2, dan M3 tidak diulang (perubahan hanya komponen S13, domain draft, i18n, dan revoke grant helper).
- **Deviasi tercatat:** test komponen memakai `renderToStaticMarkup` (tanpa jsdom); aturan state dipindah ke modul murni teruji dan interaksi DOM dibuktikan E2E. Batas `display_name` 80 mengikuti profil T03, bukan 120 di rencana.
- **Batas:** bukti lokal saja. Freshness/changed/unconfirmed, Keep/Refresh/Replace, invalidasi CV saat sumber berubah = T20; validasi/request export = T21; S14 dan PDF = T22.

# T13 Durable AI jobs dan consent — bukti acceptance dan gate review

- Tanggal: 27 September 2026
- Branch: `claude/clever-archimedes-gbu7qd`.
- Commit T13: `f3c7b28` (rencana), `a113d72` (DB), `8bfab78` (domain/provider), `b314d9f` (worker/service), `da04e5f` (UI), `62a06ed` (live smoke dan dokumen), `ca7c7e5` (OpenAI-compatible dan smoke live), lalu commit dokumen ini.
- Pelaksana: Claude, atas instruksi pengguna, dalam satu sesi tanpa sub-agent. Gate review juga dilakukan Claude secara read-only setelah Fase 6. Karena pelaksana dan reviewer sama, independensi review terbatas; ini dicatat sebagai batas.
- Rujukan: [handoff](T13-implementation-plan.md), [decision 0019](../decisions/0019-t13-ai-jobs-consent.md), receipt [Fase 0](T13-phase0-baseline.md), [1](T13-phase1-database.md), [2](T13-phase2-domain-provider.md), [3](T13-phase3-worker-service.md), [4](T13-phase4-consent-ui.md), [5](T13-phase5-browser-regression.md), [6](T13-phase6-live-smoke.md).
- Trace: PRD R05, §3, §4; F02; S12 (dan §1 shared dialogs); DB §2, §3, §6.

## Verdict

**T13: DONE (acceptance lokal dan smoke live pada endpoint OpenAI-compatible pilihan pengguna).**

Dasar keputusan:

- Ke-13 poin acceptance §1 terbukti (lihat tabel di bawah).
- Tidak ada temuan P0–P2 yang masih terbuka.
- Dua defect yang ditemukan selama eksekusi sudah diperbaiki beserta test regresinya:
  - worker crash karena *parameter properties* TypeScript;
  - race fokus di UI consent.
- Satu overflow S12 bawaan T03 juga diperbaiki.

## Acceptance §1

| # | Poin | Status | Bukti |
| --- | --- | --- | --- |
| 1 | Request duplikat memakai job yang sama | PASS | pgTAP: request ulang mengembalikan id yang sama dan jumlah job tetap 1. Integration 2–3: 5 request paralel menghasilkan 1 `job_id` dan 1 row; request setelah selesai mengembalikan job yang sudah selesai |
| 2 | Source yang berubah menghasilkan `STALE_INPUT` | PASS | pgTAP: fence input dan complete. Integration 4: edit saat queued menghasilkan 0 panggilan provider. Integration 5: edit saat provider berjalan menghasilkan result NULL. Retry dan request pada revisi lama menghasilkan `STALE_INPUT`, sedangkan revisi baru membuat job baru |
| 3 | Worker terlambat tidak dapat menulis | PASS | pgTAP: lease kedaluwarsa menghasilkan `AI_TIMEOUT`, complete dengan token lama atau token yang sudah digantikan menghasilkan `stale`, dan fail setelah selesai menghasilkan `false`. Integration 13: activity dihapus di tengah proses, job ikut ter-cascade, dan write terlambat menghasilkan `stale` |
| 4 | Maksimal tiga attempt | PASS | pgTAP dan integration 8: attempt 1→2→3, lalu `AI_RETRY_EXHAUSTED` / `RETRY_EXHAUSTED` |
| 5 | Consent ditegakkan tiga kali | PASS | pgTAP dan integration 1 dan 6: `CONSENT_REQUIRED` tanpa membuat job; withdraw saat queued menghasilkan 0 panggilan provider; withdraw saat running menghasilkan `CONSENT_WITHDRAWN` dengan result NULL |
| 6 | Akun yang sedang dihapus diblokir | PASS | pgTAP dan integration 7: `ACCOUNT_DELETING` dengan 0 panggilan provider; request, retry, dan consent ditolak dengan `AUTH_REQUIRED` |
| 7 | Validasi output terstruktur | PASS | Unit `detect-result` (skema, aturan lintas field, grounding termasuk format angka id). Unit adapter (refusal, filter, truncation, JSON rusak). pgTAP (result invalid ditolak di SQL). Integration 8 dan 9 |
| 8 | Tidak ada secret atau teks sumber di log | PASS | Integration 12 memakai proses `node workers/run.ts --once` nyata dengan stub yang membocorkan sentinel dan key di body 500: stdout, stderr, dan row job bersih. Smoke live: output worker bebas key dan teks fixture. Pemindaian key di 483 file menemukan 0 |
| 9 | Minimisasi input | PASS | Unit `ai-minimize` (5 kunci, sentinel identitas tidak ada). Integration 2 (payload provider) dan 9 (body HTTP ke stub, untuk dua API style) |
| 10 | Jalur manual tetap utuh | PASS | Integration 1 (confirm tanpa consent). E2E consent 3 (Quick log setelah withdraw menghasilkan `not_requested` dan 0 job). Regresi `integration:m2` 8/8 dan `e2e:m2` 1/1 dengan assertion env AI-free yang tidak diubah |
| 11 | Smoke live | PASS | Fase 6: `https://ai.sumopod.com/v1`, `gpt-6-luna`, Chat Completions dengan json_schema strict. Fixture en (3011 ms, 581/368 token) dan id (3101 ms, 585/252 token) valid dan grounded. Job end-to-end melalui `node workers/run.ts --once` berakhir `succeeded`/`done` |
| 12 | UI consent S12 aksesibel | PASS | E2E `ai-consent` 2/2, stabil 12/12 run berturut-turut setelah perbaikan fokus. Mencakup Escape dan *Continue manually* dengan fokus kembali, allow dengan keyboard saja, withdraw inline, konflik dua tab, copy id, Axe WCAG 2.2 A/AA di 5 state, serta tanpa overflow pada 360/1440 light/dark |
| 13 | Isolasi dua akun | PASS | pgTAP (RLS, `ACTIVITY_UNAVAILABLE`, `AI_JOB_UNAVAILABLE`). Integration 11: B tidak dapat select, request, maupun retry job A, dan ID acak menghasilkan `NOT_FOUND` yang identik. Kolom token ditolak bahkan untuk owner |

## Gate review (read-only, §9 handoff)

| Pemeriksaan | Hasil |
| --- | --- |
| Tidak ada write langsung ke `ai_jobs`, dan kolom lease/token tidak dapat dibaca client | OK: grant tabel dan kolom (migration), dibuktikan pgTAP |
| CAS token dan lease pada input, complete, dan fail | OK: migration baris 567, 626, 684. Tidak ada retry otomatis; batas 3 attempt dijaga oleh check constraint dan `retry_ai_job` |
| Consent diperiksa di request, retry, input, dan complete; versi dari satu sumber | OK: `has_current_ai_consent` di baris 329, 417, 576, 635. Unit parity TypeScript↔SQL |
| Revisi dicocokkan di setiap langkah; trigger T06 tidak mengubah semantik revisi | OK: pgTAP membuktikan perubahan `analysis_state` saja tidak menaikkan revisi, sedangkan edit menaikkan revisi dan mereset state |
| Idempotency | OK: key diturunkan server, uji paralel, penolakan untuk hash yang berbeda |
| Minimisasi dan hygiene log | OK: tidak ada `console.*` di jalur AI; gateway dan provider memakai pesan tetap; ringkasan worker hanya berisi angka dan kode yang divalidasi terhadap `AI_ERROR_CODES` |
| Fake tidak aktif di production; default `unavailable` | OK: unit resolver |
| UI consent | OK: E2E dan Axe; tidak ada klaim analisis di halaman lain (Quick log dan detail activity diperiksa) |
| Smoke live dijalankan dan dicatat tanpa secret | OK: Fase 6 |

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| D1 | P1 (saat eksekusi) | `workers/run.ts` crash karena constructor *parameter properties* di `src/server/ai/*` tidak didukung type stripping Node 24 | Fixed di `b314d9f`, dengan regresi integration 12 (proses worker nyata) |
| D2 | P2 (saat eksekusi) | Race fokus setelah allow (1/6 run gagal): `dialog.close()` mengembalikan fokus ke pemicu yang sudah hilang | Fixed di `da04e5f` (fokus dipindah dari effect setelah dialog tertutup); 12/12 run lulus |
| D3 | P2 (bawaan T03) | S12 overflow 416–420 px pada viewport 360 untuk email login yang panjang | Fixed di `da04e5f` dengan `[overflow-wrap:anywhere]` |
| R1 | P3 | Pada mode daemon, pass yang terus gagal mencetak satu baris `…Worker: "unavailable"` setiap interval poll. Isinya tanpa konten, tetapi bising | Open, follow-up |
| R2 | P3 | `.env.ai.local` pengguna belum berisi `WORKPULSE_OPENAI_BASE_URL`; smoke memakai env proses. Tanpa variabel itu, `worker:run` mengirim ke api.openai.com dan gagal dengan `AI_CONFIG_INVALID` (fail closed) | Open, tindakan pengguna |
| R3 | P3 | `store:false` tidak dikirim ke endpoint compatible, sehingga retensi mengikuti kebijakan pemroses. Copy consent generik tidak menjelaskan retensi | Open; perlu keputusan produk sebelum rilis |
| R4 | P3 | Tanpa worker berjalan, job tetap `queued`. UI T14 harus jujur menampilkannya | Seam T14 |
| R5 | P3 | Harness sesi menyuntikkan `AI_AGENT`/`ANTHROPIC_BASE_URL`, yang cocok dengan regex AI-free di M2; env dibersihkan per run | Catatan environment |
| R6 | P3 | N2 (Gate M2) masih ada: `evidence-pipeline` tidak memuat `.env.local` sendiri | Open (bawaan) |
| R7 | Proses | Fase 2 tidak mengamati test gagal lebih dulu (deviasi TDD); tercatat di receipt Fase 2 | Catatan |

## Command akhir

Hasil command yang relevan, diambil dari receipt fase dan diulang setelah perubahan terakhir:

| Command | Hasil |
| --- | --- |
| `pnpm test` | 51 file / 274 test |
| `pnpm db:test` | 8 file / 470 assertion |
| `pnpm db:lint` | bersih |
| Parity migration | 22/22 |
| Integration | ai 13, activity 6, achievements 5, projects 7, dashboard 4, m2 8, storage 1, evidence 14 (ClamAV nyata) |
| E2E | ai 2, auth 1, ui 1, activity 1, projects 1, achievements 4, dashboard 1, evidence 8, m2 1 |
| `pnpm test:ai:live` | 3 lulus + 1 skip sesuai desain |
| `worker:check` | `ai-detect` terdaftar |
| `build`, `lint`, `typecheck`, `git diff --check f3c7b28..HEAD` | 0 |

Suite E2E dan integration non-AI tidak diulang setelah `ca7c7e5` karena perubahan itu hanya menyentuh adapter, resolver, dan copy dialog consent, yang semuanya dicakup oleh suite AI yang diulang.

## Batas

- Semua bukti berasal dari Supabase lokal (Docker), ClamAV lokal, dan build lokal.
- Satu-satunya panggilan eksternal adalah smoke live dengan fixture sintetis ke endpoint yang dipilih pengguna.
- Tidak ada deployment, migration hosted, maupun data pengguna nyata.
- Keberhasilan lokal bukan bukti kesiapan production.

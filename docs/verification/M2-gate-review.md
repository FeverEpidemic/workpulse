# Gate M2 — laporan integration review

- Tanggal: 26–27 September 2026
- Branch: `claude/clever-archimedes-gbu7qd`. Baseline `845375c`; commit gate: `107b32c` (fix F1),
  `ad12662` (journey E2E + receipt 0–3), `e41b572` (integration lintas domain), commit laporan ini.
- Handoff: [M2-gate-review-plan.md](M2-gate-review-plan.md). Receipt: [Fase 0](M2-gate-phase0-baseline.md),
  [1](M2-gate-phase1-acceptance-audit.md), [2](M2-gate-phase2-code-review.md),
  [3](M2-gate-phase3-manual-journey.md), [4](M2-gate-phase4-cross-domain.md), [5](M2-gate-phase5-regression.md).
- Pelaksana dan pemberi keputusan: Claude (satu sesi, tanpa sub-agent).
- Kalimat gate (`IMPLEMENTATION_PLAN.md` §5): *F02–F06 manual berjalan dari note hingga confirmed
  achievement, evidence privat dan timeline; tidak bergantung pada AI.*

## Verdict

**Belum ditetapkan pada Fase 6.** Diisi Claude pada Fase 7 setelah verifikasi ulang independen.

## 1. Ringkasan

Satu pengguna baru tanpa CV/employment menyelesaikan F02→F06 lewat UI browser nyata, dengan evidence
diperiksa ClamAV nyata dan tanpa konfigurasi AI. Delapan skenario mutasi lintas domain menunjukkan count
Dashboard, list terfilter, detail, dan Timeline tetap sepakat. Retensi karya, privasi evidence, dan
isolasi dua akun terjaga. Review menemukan **satu P1 (F1)** yang memblokir pembuatan achievement dari
Project setelah achievement derived di tab yang sama. F1 sudah diperbaiki dengan test regresi. Tidak ada
P0 atau P2. Seluruh regresi §8 hijau dengan ClamAV nyata.

## 2. Kriteria lulus §1

| # | Kriteria | Status | Bukti |
| --- | --- | --- | --- |
| 1 | Alur manual utuh F02→F06 | PASS | `tests/e2e/m2-manual-journey.spec.ts` 1/1 (tiga run lulus); Fase 3 langkah 1–8 |
| 2 | Tanpa AI | PASS | Journey menegaskan env proses tanpa variabel AI/provider; `innerText` setiap halaman bebas klaim analisis/saran AI kecuali penafian eksplisit; `analysis_state = not_requested`; review kode Fase 2 (tanpa kontrol AI) |
| 3 | Konsistensi lintas fitur | PASS | `m2-cross-domain.test.ts` 8/8: setiap snapshot mengasersi count = row filter link; skenario 1–7; journey langkah 5–7 di UI |
| 4 | Retensi karya | PASS | Skenario 1 (delete activity → achievement + excerpt/revision tetap), 2 (delete project → activity/achievement + experience tetap), 3 (delete experience → karya tetap, konteks dibersihkan) |
| 5 | Privasi evidence | PASS | Journey langkah 6: `scanning` tanpa Download → ClamAV → `ready`; URL `/object/sign/…?token=`, `expiresInSeconds` ≤ 300, byte identik; nama file tidak tampil di Dashboard/Timeline. Skenario 6–7: file non-ready/terhapus tidak dihitung dan tidak dapat diunduh. `evidence-pipeline` 5/5, `evidence-api` 1/1 |
| 6 | Isolasi dua akun | PASS | Journey langkah 9 (UI + HTTP: foreign = acak, tanpa judul A di Dashboard/Timeline/filter) dan skenario 8 (11 operasi service: kode error foreign = acak; list/filter/Dashboard/Timeline kosong) |
| 7 | Regresi penuh hijau | PASS | Fase 5: semua command §7 exit 0, termasuk evidence integration 14/14 dan E2E evidence 8/8 dengan ClamAV nyata; tanpa flaky pada run ini |
| 8 | Tidak ada P0–P2 terbuka | PASS | F1 (P1) fixed `107b32c`; tidak ada P0/P2 |

## 3. Matriks acceptance T06–T12

Detail per butir ada di [Fase 1](M2-gate-phase1-acceptance-audit.md). Ringkasnya 31 butir terbukti dan 2
terbukti sebagian. Keduanya ditutup oleh bukti gate:

| Task | Status gate | Penutup celah |
| --- | --- | --- |
| T06 | Terbukti | — |
| T07 | Terbukti | Journey langkah 1–2 (Quick log terfokus, keyboard, sukses setelah commit, timezone profil) |
| T08 | Terbukti | Propagation achievement saat relink: skenario 4 |
| T09 | Terbukti | Reopen round-trip: skenario 5; F1 fixed |
| T10 | Terbukti | Regresi evidence 14/14 dengan ClamAV nyata |
| T11 | Terbukti | UI lifecycle nyata: journey langkah 6–7; move: skenario 6 |
| T12 | Terbukti | Count = list setelah setiap mutasi: skenario 1–8 |

## 4. Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| F1 | P1 | Setelah membuat derived Achievement, *Create Achievement* dari S10 Project di tab yang sama ditolak `IDEMPOTENCY_KEY_REUSED`. Penyebab: `revalidatePath` pada create action me-render ulang `/achievements/new?activity=…`, lalu halaman me-redirect sehingga state sukses tidak sampai ke form dan key create bersama tidak dirotasi | **Fixed** `107b32c` (key create di-scope per sumber). Regresi `achievements-ui.spec.ts` gagal→lulus; journey langkah 7 lulus |
| F1-a | P3 | Sisa F1: hapus derived Achievement lalu buat ulang dari activity yang sama di tab yang sama me-replay receipt lama (*Record unavailable*, tanpa kehilangan data) | Open, follow-up |
| G1 | P3 | `tests/integration/evidence-lifecycle.test.ts` (acceptance T11) tidak termasuk script `test:integration:*` mana pun | Open; lulus 5/5 bila dijalankan eksplisit |
| G4 | P3 | Efek delete Achievement terhadap skill/missing-evidence di Dashboard belum punya test lintas domain | Open |
| C1 | P3 | Reserve evidence ke parent asing/acak mengembalikan `PROVIDER_UNAVAILABLE` (503). Tidak bocor, tetapi semantiknya menyesatkan | Open |
| C2 | P3 | Deep link Timeline/Dashboard → detail tanpa `returnTo` (keputusan T12). Browser Back mempertahankan filter | Open (UX) |
| C3 | P3 | Kata "proficiency" muncul di penafian S08/S12 (bukan fitur) | Catatan |
| N1 | P3 | `tests/unit/malware-scanner.test.ts` tidak hermetik terhadap `WORKPULSE_SCANNER_MODE` di env proses | Open |
| N2 | P3 | `evidence-pipeline.test.ts` tidak memuat `.env.local` sendiri | Open |
| T12 | P3 | Heading Dashboard lama, fallback konteks saat truncated, redirect sign-in S12 tanpa `record`, warning `destination stream closed early` (121×), `NO_COLOR` (153×), advisory lint `v_revision` T06 | Open (bawaan) |
| T12 | — | Flaky Axe `achievements-ui` conflict test | Diperbaiki test `845375c`; tidak muncul lagi dalam tiga eksekusi |

## 5. Skenario rilis PRD yang relevan untuk M2 (§6 rencana)

| Skenario | Bukti M2 | Sisa untuk milestone lain |
| --- | --- | --- |
| Graduate tanpa CV/employment | Journey langkah 1: display name + timezone saja → Dashboard kosong jujur, Import CV disabled, CTA manual terfokus; lalu alur penuh | Import CV (T15–T17) |
| Note saat AI unavailable | Journey langkah 2 dan 10: capture tersimpan tanpa AI (`not_requested`), tanpa UI yang mengklaim analisis | Stale retry AI menunggu T13/T14 |
| Concurrent evidence quota | Regresi `evidence-backend` (slot terakhir dan batas 50 MiB diserialisasi), `evidence-lifecycle` (race move), skenario 6 (move tidak menambah bytes) | Staging/hosted (T25) |
| Ownership dua akun | Journey langkah 9 dan skenario 8 | PDF multipage/ownership export menunggu T21/T22 |

## 6. Command dan hasil

Tabel lengkap ada di [Fase 5](M2-gate-phase5-regression.md). Ringkasnya: lint, typecheck, unit 203/203,
pgTAP 386/386, DB lint bersih, parity 21/21, integration activity 6, projects 7, achievements 5, storage 1,
evidence 14, evidence-lifecycle 5, dashboard 4, m2 8; E2E auth 1, ui 1, activity 1, projects 1,
achievements 4, dashboard 1, evidence 8, m2 1; worker check ready; build; `git diff --check`.

## 7. Flaky dan tidak dijalankan

- Flaky: tidak ada pada run gate. Kegagalan awal di Fase 3–5 berasal dari helper test atau environment
  (dirinci di receipt), bukan dari perilaku produk yang intermiten.
- Tidak dijalankan: clean disposable rebuild (tidak ada migration baru), `db:types` (tidak ada perubahan
  schema), staging/hosted/production, performa T24. Integration gate memakai fixture evidence `ready` lewat
  RPC scan admin. Jalur scanner nyata dibuktikan terpisah oleh journey dan `evidence-pipeline`.

## 8. Batas

Semua bukti berasal dari Supabase lokal (Docker), Storage lokal, ClamAV lokal di container, worker satu
jalan (`runEvidenceWorkerOnce`), dan build lokal. Tidak ada deployment, migration hosted, atau layanan
eksternal. Keberhasilan lokal bukan bukti production. Docker Desktop sempat restart di tengah sesi. Stack
pulih tanpa reset dan parity tetap 21/21.

# Gate M4 — laporan draft (integration review Master CV dan PDF)

- Tanggal: 9 Oktober 2026.
- Branch: `claude/clever-archimedes-gbu7qd`. Baseline handoff `7a93932`.
- Pelaksana: Claude Sonnet 5.5, satu sesi tanpa sub-agent, Fase 0–6 dari [`M4-gate-review-plan.md`](M4-gate-review-plan.md).
- **Status dokumen: DRAFT. Belum ada verdict.** Verdict Gate M4 dan pembaruan `IMPLEMENTATION_STATUS.md`/`AGENTS.md` adalah wewenang reviewer (Fase 7).
- Kalimat gate (`IMPLEMENTATION_PLAN.md:277`): *F07 end-to-end lolos; snapshot/provenance/override terjaga dan PDF dapat dibaca serta dicari.*
- Receipt: [Fase 0](M4-gate-phase0-baseline.md), [1](M4-gate-phase1-acceptance-audit.md), [2](M4-gate-phase2-code-review.md), [3](M4-gate-phase3-cv-journey.md), [4](M4-gate-phase4-cross-domain.md), [5](M4-gate-phase5-regression.md).

## Ringkasan

- Journey F07 baru (`tests/e2e/m4-cv-journey.spec.ts`) dan integration lintas domain baru (`tests/integration/m4-cv-output.test.ts`, 17 test) lulus dengan Supabase, Storage, ClamAV, dan renderer Chromium nyata. Seluruh regresi §7 lulus tanpa rerun.
- Gate menemukan **tiga P2 di produk**, semuanya diperbaiki dengan test yang terbukti gagal dulu: pratinjau CV yang dapat digulir tidak dapat dijangkau keyboard (RV-A11Y), handler `onBeforeInput` Quick log melempar `TypeError` pada setiap ketikan (RV-QL), dan fokus jatuh ke `body` setelah `CV_SOURCE_CHANGED` (RV-F1, reklasifikasi T20 F1). Tidak ada P0 atau P1. Tidak ada PDF lama yang berubah, tidak ada export yang lolos dengan blocker, tidak ada karya yang hilang.
- Tidak ada migration, perubahan RPC/SQL, perubahan worker, dependency baru, atau `db reset`. Suite lama tidak diubah kecuali penambahan satu test E2E dan dua test unit.
- **Batas independensi:** perbaikan RV-A11Y, RV-QL, dan RV-F1 dikerjakan pelaksana yang sama dengan penemu temuan. Reviewer perlu menilai ulang diff perbaikan (§3).

## 1. Kriteria lulus §1 (usulan pelaksana, menunggu penilaian reviewer)

| # | Kriteria | Status | Bukti |
| --- | --- | --- | --- |
| 1 | F07 end-to-end di browser | PASS | `test:e2e:m4` lulus 4 kali berturut-turut sesudah perbaikan (run 8, run html, run 9, dan regresi Fase 5). Alur lengkap: data karier → S04/S08 → S13 → S14 → renderer nyata → *Download PDF* → ekstraksi pdf.js cocok dengan revision tersimpan ([Fase 3](M4-gate-phase3-cv-journey.md)) |
| 2 | Tanpa AI | PASS | E2E menegaskan env bebas AI, web server tanpa `WORKPULSE_AI_*`, dan 0 klaim AI pada setiap halaman. Integration M4-10: 0 baris `ai_jobs` untuk akun CV, pass worker AI dengan provider penghitung = 0 panggilan |
| 3 | Snapshot immutable, PDF lama tidak berubah | PASS | E2E langkah 8–9 (sha256 PDF-1 identik lewat riwayat; objek tersimpan dan `md5(snapshot)` sama setelah PDF-2, PDF-3, Retry, Regenerate). Integration `expectUntouched` pada skenario 1, 2, 3, 5, 6, 7, 8 |
| 4 | Provenance terjaga | PASS | M4-1 (batch import dipurge), M4-2 (activity sumber dihapus), M4-4 (item tetap menyimpan snapshot tampilan dan memblokir export untuk enam tipe) |
| 5 | Override terjaga | PASS | E2E langkah 3, 5, 6 (override tercetak menggantikan sumber, refresh/Keep my wording tidak menimpa). M4-3 (refresh tidak menyentuh override, Replace menggantinya, export lama tetap memuat override). Override ringkasan dan kontak dibuktikan oleh bukti T19/T21 (`cv-builder.test.ts:231`, `cv-export-renderer-real.test.ts:119`) dan tidak diulang khusus di M4 |
| 6 | Konsistensi lintas domain | PASS | `expectLayers` pada setiap mutasi M4-1…9: readiness, `get_cv_review_summary`, Dashboard `cvReview`, state item sepakat |
| 7 | PDF dapat dibaca dan dicari | PASS | E2E: PDF unduhan A4, nama, heading *Pendidikan*/*Proyek*, karakter Indonesia, tanpa evidence. M4-11: CV panjang, 1 < halaman ≤ 20, awal dan akhir bullet, A4. `pnpm test:pdf` 46. Cakupan aksara non-Latin tetap sesuai batas T21 N4 (bukan bagian kriteria) |
| 8 | Isolasi dua akun | PASS | E2E langkah 10 (tujuh halaman, route, API, Storage) dan M4-12 (service, RPC mentah, Storage, reconcile). Catatan: aksi server tidak dipanggil dari browser dengan id asing; ditutup oleh service yang sama (M4-12) dan unit aksi T21/T22 |
| 9 | Aksesibilitas journey | PASS (setelah RV-A11Y, RV-F1) | Axe tanpa pelanggaran pada S13 (selection, override, review *changed*) dan S14 (siap, terblokir, sukses dengan halaman PDF); *Retry*, *Regenerate*, *Download PDF*, *Export*, *Keep my wording*, *Add* dengan keyboard; satu pass 360 × 800 dark tanpa overflow dan tanpa pelanggaran. Menutup T22 N6 |
| 10 | Regresi penuh hijau | PASS | [Fase 5](M4-gate-phase5-regression.md): 47 command, semua exit 0, tanpa flaky |
| 11 | Tidak ada P0–P2 terbuka | PASS | §3 |

## 2. Matriks acceptance T18–T22

Audit lengkap di [Fase 1](M4-gate-phase1-acceptance-audit.md): tidak ada acceptance **Tidak terbukti**. Dua baris yang semula **Terbukti sebagian** ditutup gate.

| Task | Hasil gate | Catatan |
| --- | --- | --- |
| T18 | Terbukti | Selection, parent, duplikat, revision; M4-3/4/6 menguji ulang lintas domain |
| T19 | Terbukti | Override terpisah dari canonical (E2E, M4-3); graduate lewat UI penuh (E2E langkah 1–5) |
| T20 | Terbukti, RV-F1 | Freshness, refresh, delete, reopen di M4-3/4/5/6/8; T20 F1 (fokus) diperbaiki, T20 F2 tetap P3 |
| T21 | Terbukti | Snapshot, race, retry, kedaluwarsa, tanpa evidence di PDF (M4-7, M4-9, E2E langkah 9) |
| T22 | Terbukti, RV-A11Y | Retry/Regenerate/Download kini diuji dengan keyboard (N6 tertutup); preview/halaman PDF lulus Axe |

## 3. Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV-A11Y | P2 | `.cv-preview-column` (S13 dan S14) sticky + `overflow: auto` tanpa kontrol fokus di dalamnya: wilayah gulir tidak dapat dijangkau keyboard (WCAG 2.1.1, Axe `scrollable-region-focusable` serious) | **Fixed** `3a6d8fb`; unit merah → hijau, Axe journey merah → hijau |
| RV-QL | P2 | Quick log: `onBeforeInput` membaca `nativeEvent.inputType.startsWith` yang `undefined` pada event `textInput`/`keypress` React → `TypeError` tak tertangkap per karakter; penjaga 10.000 code point saat mengetik mati | **Fixed** `e67b8a6`; `insertedTextOf` murni, unit 4/4, journey tanpa `pageerror` |
| RV-F1 | P2 | T20 F1: setelah `CV_SOURCE_CHANGED`, panel review menutup dan fokus jatuh ke `body` | **Fixed**: kode di `3a6d8fb` (satu file dengan RV-A11Y), test E2E di `41c4af0` (merah: `activeElement` `BODY`; hijau). `cv-freshness` 11/11 |
| T20 F2 | P3 | Tabel review di 360 px memotong kata di kolom label; tanpa overflow, SC 1.4.10 terpenuhi | Follow-up |
| T20 F3, F4, F6 | P3 | Copy unconfirmed/`parentAdded`; asersi ganda `m2-manual-journey.spec.ts:339/341`; biaya baca freshness | Follow-up (F6 → T24) |
| T21 N2, N3, N4, N5, N6, N7, N8 | P3 | Tidak berubah (N2/N4 → T23, N5 → T25, N7 → T24); N6 tertutup dari sisi UI oleh `cv-export.spec.ts:512` | Follow-up |
| T22 N1, N2, N3, N5, N8 | P3 | Copy *failed* ganda; satu canvas; E2E menimpa 16 PNG yang di-track (terkonfirmasi, dipulihkan `git restore`); tiga query paralel; kolom sticky | Follow-up |
| T22 N6 | P3 → tertutup | Retry/Regenerate/Download diuji dengan keyboard di E2E M4 langkah 4, 7, 8, 9 | Ditutup |
| T22 N7 | P3 | Flaky `activity-ui.spec.ts:356` tidak muncul pada gate | Catat |
| N-M4-1 | P3 | Snapshot export memuat `credential_url` sertifikat (data pemilik, tidak pernah dicetak, terbaca pemilik lewat PostgREST = T21 N3) | Catat |
| N-M4-2 | P3 | Biaya baca `cv_export_blockers` per item (T20 F6) | T24 |
| E-1 | P3 | Aksi server unduh tidak dipanggil dari browser dengan id asing | Catat |
| E-2 | P3 | Log `The destination stream closed early` pada web server E2E | Catat |

## 4. Command dan hasil

Angka rinci dan seluruh daftar ada di [Fase 5](M4-gate-phase5-regression.md). Ringkas:

| Command | Exit | Hasil |
| --- | ---: | --- |
| `pnpm lint` / `typecheck` / `build` / `worker:check` | 0 | bersih / bersih / berhasil / `ready` (8 job) |
| `pnpm test` | 0 | 104 file / 962 test |
| `pnpm db:test` / `db:lint` | 0 | 15 file / 1290 PASS / bersih |
| `supabase migration list --local` | 0 | 31/31 |
| `pnpm test:pdf` | 0 | 46 |
| `pnpm test:integration:m4` | 0 | 17 |
| `pnpm test:e2e:m4` | 0 | 1 (≈ 53 detik) |
| `test:e2e:cv-freshness` | 0 | 11 |
| 24 suite integration dan E2E domain lain | 0 | sama dengan angka baseline T18–T22/M2/M3 |
| `git diff --check` | 0 | bersih |

Hash PDF run terakhir (hanya untuk jejak, nilai berubah per run): PDF-1 `c83390db…ddc2`, PDF-2 `f1f3e6cf…5992`, PDF-3 `062ea0d3…de70`, masing-masing 1 halaman.

Commit gate: `ea64239` (Fase 0), `bb0da94` (Fase 1–2), `3a6d8fb`, `e67b8a6`, `41c4af0` (perbaikan), `7355d26` (journey), `9c0cc25` (integration), receipt Fase 3–4 dan 5, dan commit laporan ini.

## 5. Flaky dan tidak dijalankan

- Flaky: tidak ada pada gate. Selama penyusunan journey ada tujuh run merah; seluruhnya dijelaskan di [Fase 3](M4-gate-phase3-cv-journey.md): empat kesalahan test saya (run 1, 2, 3, 5) dan dua temuan produk (run 4 untuk RV-A11Y; run 6 dan 7 untuk RV-QL, satu penyebab). Tidak ada yang di-rerun sampai lulus tanpa penjelasan.
- Tidak dijalankan: `test:e2e` gabungan, `test:ai:live`, stres race berskala, p95 (T24), staging/production, `db:types` (tanpa migration).

## 6. Batas

Semua bukti dari Supabase lokal (Docker), Storage lokal, ClamAV dan Gotenberg lokal, renderer Chromium lokal, dan Playwright Chromium. Cakupan teks aksara Han, Arab, Ibrani, dan Devanagari mengikuti batas T21 N4. Keberhasilan lokal bukan bukti kesiapan production. Gate tidak mencakup penghapusan akun dan retensi snapshot (T23), analytics dan p95 (T24), maupun deployment (T25).

# Rencana Remediasi Gate M3 — Assisted entry

Status plan: **OPEN — menunggu persetujuan pengguna** (1 temuan P2).

- Tanggal: 30 September 2026.
- Reviewer: Claude (Opus), integration review Gate M3 atas permintaan pengguna ("Langsung jalankan Gate Review M3").
- HEAD yang direview: `42bab36` (branch `claude/clever-archimedes-gbu7qd`). Baseline: T13–T17 DONE (acceptance lokal).
- Kalimat gate (`IMPLEMENTATION_PLAN.md` §5 M3): *F01 import dan F02 assisted lolos bersama malformed file, retry, consent withdrawal, AI unavailable dan stale-result scenarios.*
- Laporan gate: [M3-gate-review.md](M3-gate-review.md).
- Verdict awal: **BELUM LULUS — 1 temuan P2 terbuka (RV1).**

## 1. Ringkasan temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV1 | P2 | S02 menampilkan "AI processing is not allowed, so the text was not sent." untuk batch `CONSENT_WITHDRAWN`, padahal kode itu hanya muncul setelah teks CV sudah terkirim ke provider | Open |
| N1 | P3 | `workers/ai-worker.ts:90`: job import dengan teks kosong/terlalu panjang hanya dihitung `aiSkipped` tanpa `failAiJob`; job menunggu lease habis (120 s) lalu menjadi `AI_TIMEOUT`. Tidak terjangkau saat ini karena `workers/import-worker.ts:169` sudah menolak teks > 60.000 karakter sebagai `IMPORT_TEXT_TOO_LONG` | Follow-up |
| N2 | P3 | S06 untuk job `CONSENT_WITHDRAWN`/`CONSENT_REQUIRED` hanya menampilkan pesan generik "The analysis could not be completed." (ditambah alasan consent bila consent masih ditarik). Jujur, tetapi tidak menjelaskan bahwa hasilnya dibuang karena consent | Follow-up (copy) |
| N3 | P3 | Helper E2E `drainAiWorker` tidak mengembalikan stdout worker, sehingga hygiene log di E2E hanya diperiksa untuk output `drainImportWorker` (yang juga menjalankan pass AI). Warisan T14 §1.18 "Sebagian" | Follow-up |
| N4 | P3 | Flaky pra-M3 `tests/e2e/activity-ui.spec.ts:356` hanya dalam `test:e2e:evidence` (2/2 gagal pada gate ini): `selectOption` project terjadi sebelum hydration, lalu `<select>` kembali ke "All projects" | Follow-up (perbaikan test: tunggu hydration/`networkidle` sebelum memilih) |

Tidak ada temuan P0 atau P1.

## 2. RV1 — Copy S02 salah untuk consent yang ditarik saat ekstraksi berjalan (P2)

**Gejala.** Pengguna mengizinkan AI, mengunggah CV, lalu menarik consent di S12 tepat saat worker sedang memanggil provider untuk batch itu. Batch berakhir `failed` dengan `error_code = CONSENT_WITHDRAWN`. S02 menampilkan *"AI processing is not allowed, so the text was not sent."* (id: *"Pemrosesan AI tidak diizinkan, jadi teks tidak dikirim."*). Kalimat kedua salah: teks CV sudah diterima provider, hanya hasilnya yang dibuang. Ini melanggar kontrak status jujur (T15 §1.17) dan menyesatkan pengguna tentang pengiriman datanya. Tidak ada kebocoran data tambahan, sehingga levelnya P2, bukan P0.

**Bukti.** `tests/integration/m3-assisted-entry.test.ts` skenario 2b (lulus): withdraw di dalam `extractImport` → `ownCalls(provider).import = 1`, batch `CONSENT_WITHDRAWN`, view S02 `errorCode = CONSENT_WITHDRAWN`.

**Penyebab.**

- `supabase/migrations/20260930090000_t15_import_staging.sql:1340-1342`: consent ditarik **sebelum** teks diambil → `CONSENT_REQUIRED` (teks memang tidak dikirim).
- `…:1387-1389`: consent ditarik **setelah** provider dipanggil → `CONSENT_WITHDRAWN` (teks sudah dikirim, hasil dibuang).
- `src/features/import/import-start.tsx:34` memetakan keduanya ke `import.failed.CONSENT_REQUIRED`.
- `tests/unit/import-start-ui.test.tsx:123` mengunci pemetaan yang salah itu.

**Perbaikan minimal (tanpa SQL, tanpa migration).**

1. Tambah key `import.failed.CONSENT_WITHDRAWN` en/id di `src/i18n/messages.ts`. Copy usulan:
   - en: *"AI processing was withdrawn while this file was being processed. The result was discarded and nothing was added."*
   - id: *"Pemrosesan AI ditarik saat file ini sedang diproses. Hasilnya dibuang dan tidak ada data yang ditambahkan."*
2. `importFailureKey("CONSENT_WITHDRAWN")` → `import.failed.CONSENT_WITHDRAWN`. `CONSENT_REQUIRED` tetap memakai copy lama, karena pada kode itu teks memang tidak dikirim.
3. Jangan mengubah `retryBlockReason`: retry tetap diblokir sampai consent diizinkan lagi (sudah benar).

**Test regresi (gagal dulu, lalu lulus).**

- Unit `tests/unit/import-start-ui.test.tsx`: `importFailureKey("CONSENT_WITHDRAWN")` → `import.failed.CONSENT_WITHDRAWN`, dan `importFailureKey("CONSENT_REQUIRED")` → `import.failed.CONSENT_REQUIRED`. Tambah render S02 `failed_retriable` + `CONSENT_WITHDRAWN` yang tidak memuat "was not sent" / "tidak dikirim".
- Parity kunci i18n en/id (test yang sudah ada) tetap lulus.

## 3. Checks yang wajib diulang setelah remediasi

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:import
pnpm test:e2e:m3
pnpm test:integration:m3
git diff --check 42bab36..HEAD
```

## 4. Yang tidak diubah

Tanpa migration, tanpa perubahan RPC atau worker, tanpa `db reset`. N1–N3 tetap follow-up kecuali pengguna memintanya.

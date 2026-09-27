# Gate M2 — Fase 4 integration lintas domain

- Tanggal: 27 September 2026 · Handoff §5 Fase 4 · kriteria §1.3, §1.4, §1.6.
- File baru: `tests/integration/m2-cross-domain.test.ts`; script `test:integration:m2` di `package.json`.
- Pola: admin hanya untuk membuat akun/experience dan fixture evidence `ready` lewat RPC scan (seperti
  `dashboard-timeline.test.ts`); semua mutasi dan pembacaan lewat service nyata dengan sesi owner A/B
  yang login ke Supabase lokal. Evidence memakai `createEvidenceService` dengan
  `SupabaseEvidenceRepository` + `SupabaseStorageAdapter` nyata (seperti `evidence-pipeline.test.ts`).

## Invariant yang diasersi pada setiap snapshot

`consistentSnapshot()` memanggil `getDashboard()`, lalu menelusuri seluruh halaman (cursor) dari filter
yang sama dengan link Dashboard: `status=confirmed`, `confirmed + missingEvidence`, project `status=active`,
serta `skillId` untuk setiap skill. Setiap count **harus sama** dengan jumlah row; lalu `getTimeline()`.
Setiap skenario mengambil snapshot sebelum dan sesudah mutasi.

## Skenario dan hasil

| # | Mutasi | Asersi sesudah | Hasil |
| --- | --- | --- | --- |
| 1 | Delete Activity sumber derived confirmed | Achievement tetap `confirmed`, `activity_id` NULL, `source_excerpt` = raw text persis (termasuk newline/spasi), `source_activity_revision` = revision terakhir, skill tetap; confirmed/skill count tetap; recent activity kehilangan activity itu dan terisi tetangga; event Timeline tetap; detail activity `NOT_FOUND` | PASS |
| 2 | Delete Project (dengan Experience) | Receipt 1 activity + 1 achievement dilepas; activity & achievement `project_id` NULL, `experience_id` dipertahankan; current projects −1; event project hilang; konteks achievement di Timeline menjadi `role · organization`; filter project kosong | PASS |
| 3 | Delete Experience | Project/activity/achievement tetap; `experience_id` NULL pada semuanya; derived tetap di project; counts tetap; event experience hilang; konteks project NULL (*Independent*), derived tetap judul project, standalone NULL | PASS |
| 4 | Relink Project → Experience lain, lalu relink Activity → Project lain | Activity dan derived achievement mengikuti experience baru (satu transaksi); konteks project di Timeline berubah; relink activity memindahkan achievement ke project baru + experience-nya; filter project lama kosong, baru tepat 1; confirmed count tetap | PASS |
| 5 | Reopen confirmed → draft → confirm ulang | Draft: confirmed −1, missing-evidence −1, skill −1, event Timeline hilang. Confirm ulang: summary identik dengan sebelum, event kembali | PASS |
| 6 | Move evidence `ready` Activity → derived Achievement | missing-evidence −1, achievement keluar dari list missing; jumlah bytes akun (`uploading/scanning/ready`) tidak berubah; list activity kosong, list achievement berisi file itu | PASS |
| 7 | Delete evidence `ready` satu-satunya pada achievement confirmed | missing-evidence +1, achievement masuk list missing; `download()` dan `get()` → `EVIDENCE_NOT_FOUND` (URL baru tidak terbit); nama file tidak muncul di Timeline | PASS |
| 8 | Isolasi akun B terhadap record A | Untuk detail/delete activity, detail/delete achievement, detail/delete/candidates project, evidence get/download/remove/move/reserve: kode error untuk ID A **sama persis** dengan ID acak dan tidak sukses. List evidence, filter achievement (project, skill, missing), filter activity (project) kosong; Dashboard B semua nol, `hasCareerRecords=false`; Timeline B kosong termasuk filter project A dan `projectOptions`. Data A tetap utuh setelah percobaan B | PASS |

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm test:integration:m2` (run 1) | 1 | 4/8 — skenario 2, 3, 4, 8 gagal di fixture: activity dalam project dibuat tanpa `experience_id` project, ditolak trigger konteks (`VALIDATION`). Ini perilaku produk yang benar (UI menurunkan experience dari project); helper diperbaiki mengikuti UI |
| `pnpm test:integration:m2` (run 2) | 0 | **8/8** lulus (21.1 s) |
| `pnpm typecheck` | 0 | bersih |
| `pnpm lint` | 0 | bersih |

## Temuan

Tidak ada temuan P0–P2. Tidak ada count ≠ list, karya hilang, atau kebocoran owner. Catatan P3:

- C1 (dari Fase 2) terkonfirmasi: reserve evidence oleh B pada parent A dan pada parent acak sama-sama
  `PROVIDER_UNAVAILABLE`, jadi tidak ada kebocoran keberadaan record, tetapi semantiknya "storage down".

## Blocker dan langkah berikutnya

Tidak ada. Berikutnya Fase 5: regresi penuh dengan ClamAV nyata.

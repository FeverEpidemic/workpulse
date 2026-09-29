# T15 — Import upload dan extraction staging: bukti acceptance

Tanggal: 29 September 2026. Rujukan: R02, F01 (+ *Import exceptions*, state *Import batch*), S02 (S03 milik T17), DB §1/§3/§4/§6.
[Rencana](T15-implementation-plan.md), [decision 0021](../decisions/0021-t15-import-staging.md), [runbook renderer](T15-renderer-runbook.md),
receipt [Fase 0](T15-phase0-baseline.md), [1](T15-phase1-database.md), [2](T15-phase2-parser.md), [3](T15-phase3-domain.md),
[4](T15-phase4-worker-service.md), [5](T15-phase5-ui.md), [6](T15-phase6-browser-regression.md).

Eksekutor dan reviewer: Claude (atas permintaan pengguna). Review karena itu tidak independen; tinjauan gate §9 dicatat di bawah.

## Trace acceptance §1

| # | Acceptance | Bukti | Hasil |
| --- | --- | --- | --- |
| 1 | Alur utama PDF → review, excerpt substring teks | integration 1; E2E 2 | PASS |
| 2 | DOCX: halaman dari renderer terisolasi, 21 halaman ditolak walau metadata 1 | `import-renderer-real` (Gotenberg nyata, 2→2, 21→21); integration 2 (fake) | PASS |
| 3 | Ekstraksi tidak menulis record canonical | pgTAP (hitungan canonical); integration 1 | PASS |
| 4 | Validasi upload di server | unit `import-file-inspection`, `import-service`; integration 3; E2E 3 | PASS |
| 5 | Deteksi saat parsing (encrypted, scanned, corrupt, empty, >20 halaman, teks terlalu panjang) | unit `parse-in-thread`, `import-worker`; integration 4 | PASS (teks terlalu panjang: unit worker saja) |
| 6 | Batas parser (ZIP bomb, timeout, heap) | unit `import-file-inspection`, `parse-in-thread` | PASS |
| 7 | Malware screening wajib; scanner unavailable tidak pernah dianggap bersih | unit `import-worker`; integration 5, 5b (ClamAV nyata, EICAR) | PASS |
| 8 | Consent di begin, enqueue, input, completion | pgTAP; integration 6; E2E 1 | PASS |
| 9 | Grounding kandidat | unit `import-extract-result`; integration 7 | PASS |
| 10 | Ekstraksi parsial/kosong; achievement selalu draft | pgTAP; unit; integration 7; E2E 6 | PASS |
| 11 | Upload idempoten (paralel, byte beda, replay setelah object ada) | pgTAP; integration 8 | PASS |
| 12 | Peringatan hash duplikat per akun | pgTAP; integration 9; E2E 3 | PASS |
| 13 | Cancel di tiap tahap, completion terlambat tidak menulis | pgTAP; integration 10; E2E 5 | PASS |
| 14 | Leave-return dan session kedaluwarsa | E2E 2 | PASS |
| 15 | Retry batch yang sama, paralel satu job, batas, permanen, expired | pgTAP; integration 5b, 6, 11; E2E 4 | PASS |
| 16 | Retensi terminal (object, teks, item; metadata minimal; committed) | pgTAP (termasuk committed fixture); integration 5, 12 | PASS |
| 17 | Status jujur, polling berhenti | unit `import-view`, `import-start-ui`; E2E 2–6 | PASS |
| 18 | Isolasi dua akun, kolom privat | pgTAP; integration 13 | PASS |
| 19 | Log hygiene | integration 14; E2E 2 (output worker) | PASS, dengan tafsir: nama file milik pemilik tampil di view S02 miliknya sendiri, tidak di log/error/AI |
| 20 | UI aksesibel dan responsif | E2E 1–7 (keyboard, fokus, Axe, 360/1440 light/dark) | PASS |
| 21 | Regresi T06–T14 | receipt Fase 6 (semua suite lulus; satu assertion M2 disesuaikan karena placeholder S02 diganti) | PASS |

## Tinjauan gate §9 (read-only, oleh pelaksana)

- Tidak ada write klien langsung ke `import_batches`, `import_items`, `internal.import_jobs`, `ai_jobs`; kolom privat tidak terbaca klien (pgTAP).
- Tidak ada jalur ekstraksi ke tabel canonical; payload achievement dijaga `status = draft` oleh check tabel dan RPC.
- Scan sebelum parse, hash/bytes diverifikasi sebelum dan sesudah scan; scanner unavailable → retry lalu gagal retriable.
- Parser di thread dengan heap limit, env kosong, stdio dibuang, timeout keras; halaman DOCX dari renderer.
- Consent dicek di begin, enqueue AI, input AI, completion; payload AI hanya `{ text }`.
- Semua RPC worker compare-and-set pada token/lease; urutan lock profile → batch → job konsisten, termasuk fungsi AI T13 yang diubah.
- Temuan: tidak ada P0–P2. P3: (a) klien dapat memanggil `begin_import_batch` langsung dan membuat batch `uploading` miliknya sendiri yang kedaluwarsa dalam 15 menit (finalize butuh service role, jadi tidak ada job atau object); (b) batch `review` yang ditinggalkan tidak dipurge (keputusan terbuka T17/T23); (c) route `GET /api/imports` belum dipakai client (page server memuat batch aktif langsung).

## Belum terbukti / di luar lokal

- Smoke live `extractImport` terhadap provider nyata (butuh persetujuan pengguna).
- Isolasi jaringan renderer dan scanner di staging, perilaku worker ter-deploy, dan retensi nyata di staging/production.
- Keputusan produk: apakah import memerlukan versi consent tersendiri.

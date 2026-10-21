# Gate M5 Fase 1: audit acceptance (read-only)

- Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5).
- HEAD gate: `973e886` (`origin/main`) plus commit gate. T27 di luar gate (belum di `main`).
- Sumber: PRD diekstrak ulang dengan `python -I` + `zipfile` atas `word/document.xml` (158 paragraf; R01–R10, §4, *Release scenarios*, tabel milestone, *Pilot measures*), `IMPLEMENTATION_PLAN.md` §5 M5 dan §6, decision 0029–0034, bukti per paket di §3 handoff.
- File berubah: hanya receipt ini.

## 1. Acceptance × bukti

| Paket | Acceptance (ringkas) | Tanda | Bukti konkret | Dijalankan ulang di gate |
| --- | --- | --- | --- | --- |
| T23 | Worker restart tidak kehilangan cleanup; akun terhapus tidak dapat retry; antrean bertahan setelah FK hilang; bukti retensi tercatat | **Terbukti sebagian** | `account-deletion.test.ts` › "resumes after a crash…", "never marks a receipt completed while an object or an open cleanup job is left", "rejects user RPCs of every domain with 42501"; `account_deletion.test.sql`, `retention.test.sql`; `T23-gate-review.md` (tanpa P0–P2). Sebagian: retensi backup ≤ 30 hari baru terbukti untuk **staging** (decision 0034), belum untuk lingkungan pilot (kriteria §1.12) | `test:integration:account-deletion` 15/15 (Fase 0); Fase 3 langkah 7–8 dan Fase 4 skenario 3–4 menguji ulang dengan tabel 0032 |
| T24 | Event untuk activation 24 jam, value completion 7 hari, return capture 28 hari, export reliability; p95 di bawah target; target disebut hipotesis | **Terbukti** | `product_events.test.sql` (134 assertion), `product-events.test.ts` (9), `T24-perf-results.json`, `T24-pilot-metrics-runbook.md` (target sebagai hipotesis, peringatan n ≤ 20). Activation lewat import `rules` belum pernah diuji (event pre-T26) | `test:integration:product-events` dan `test:perf` di Fase 5; activation lewat import `rules` di Fase 4 skenario 1 |
| T25 | R01–R10 dengan bukti; tanpa defect kritis privasi/data; integrasi nyata di staging | **Terbukti sebagian** | `T25-release-matrix.md` §6–7, `T25-review-remediation-plan.md`, `T25-closeout-review.md` (PASS, satu pengecualian p95 hosted), decision 0034. Sebagian: integrasi nyata terbukti di **staging** dengan image `sha-1de7318…` yang belum memuat migration 37–38; lingkungan pilot belum diperiksa | `test:integration:release` 12/12 (Fase 0); `test:e2e:release` setelah RV-PW |
| Batas AI (0032) | Unit dibebankan dalam transaksi job; batas harian/bulanan/kapasitas; S06/S02 menampilkan batas dan jalur manual | **Terbukti** | `ai-usage-limits-gate-review.md` (PASS, U1–U5 P3); integration `ai-usage` 9 (paralel 18/20 → tepat 2 job); `ai-usage-limits.test.tsx`. Staging belum dimigrasi (U5) | `test:integration:ai-usage` di Fase 5; Fase 4 skenario 2 dan 6 |
| T26 | Import tanpa consent lewat parser aturan; tanpa `ai_jobs` dan unit; grounding sama dengan AI; dialog netral | **Terbukti** | `T26-gate-review.md` (PASS, N1–N7 P3); `import_rules.test.sql`; integration `T26-*`; E2E `import-onboarding.spec.ts` › "T26 a new user reads the CV without AI…" (PDF, renderer DOCX palsu di helper E2E) | Fase 3 langkah 2 dengan DOCX dan Gotenberg nyata; Fase 4 skenario 2, 3, 5, 7 |

Tidak ada baris **Tidak terbukti**. Dua baris *sebagian* hanya tertutup oleh bukti lingkungan pilot (kriteria §1.11–§1.12).

## 2. Matriks R01–R10 di HEAD gate

| ID | Bukti minimum (§6 rencana) | Dampak 0032/0033 | Test di gate |
| --- | --- | --- | --- |
| R01 | Auth/recovery/expiry, dua akun, CRUD profil, deletion | 0032 menambah dua tabel `internal` ber-`user_id`; 0033 menambah jalur worker. Penghapusan harus mencakup keduanya | `test:integration:release`, `test:integration:account-deletion`, `test:e2e:auth`, `test:e2e:account-deletion`; **baru**: `test:e2e:m5` langkah 1, 7, 8 dan `test:integration:m5` skenario 3, 4, 7 |
| R02 | Malformed import, review saved, atomic commit, retry dedup | 0033: mode `rules` tanpa consent; 0032: unit untuk mode `ai` | `test:integration:import`, `import-commit`, `import-review`, `test:e2e:import`, `import-review`; **baru**: `test:e2e:m5` langkah 2 (DOCX, Gotenberg nyata), `test:integration:m5` skenario 2 dan 5 |
| R03 | Counts dari fixtures, link checks | Tidak ada | `test:integration:dashboard`, `test:e2e:dashboard`; `test:e2e:m5` langkah 2 (record impor tampil sekali) |
| R04 | Persist before AI, timezone, failed save input, conflict | 0032: request analisis dapat ditolak batas; catatan tetap tersimpan | `test:integration:activity`, `ai-usage`, `test:e2e:activity`; **baru**: `test:e2e:m5` langkah 3 |
| R05 | Confirm guards, 3 pertanyaan, stale AI, sumber disimpan | 0032: refine yang ditolak tetap menyimpan jawaban | `test:integration:ai`, `ai-review`, `ai-usage`, `test:e2e:ai-review`; **baru**: `test:e2e:m5` langkah 3–4 (AI unavailable, stale, konfirmasi manual) |
| R06 | Context propagation, standalone, delete retain | Tidak ada | `test:integration:projects`, `test:e2e:projects` |
| R07 | Race quota, signature/screening, owner URL, cleanup | Tidak ada | `test:integration:evidence`, `storage`, `test:e2e:evidence`; `test:e2e:m5` langkah 4 (ClamAV nyata) |
| R08 | Partial/unknown/overlap dates, deep links | 0033: tanggal dari parser aturan (presisi bulan/tahun) | `test:integration:dashboard`, unit timeline; `test:e2e:m5` langkah 2 (dua masa kerja tumpang tindih) |
| R09 | Selection, ordering, override, invalidation | Tidak ada | `test:integration:cv`, `cv-builder`, `cv-freshness`, `m4`, E2E padanannya |
| R10 | Immutable snapshot race, A4 searchable, retry/expiry | Tidak ada | `test:integration:cv-export`, `m4`, `test:pdf`, `test:e2e:cv-export`, `m4`; `test:e2e:m5` langkah 5 |

## 3. Peta skenario

| # | Skenario | Bukti yang ada | Bukti baru di gate |
| --- | --- | --- | --- |
| 1 | Import CV Indonesia, masa kerja tumpang tindih, koreksi, konfirmasi sekali, tanpa duplikat | Mode `ai`: `import-commit` › "1. Indonesian CV with overlapping employment…", `import-review.spec` › "R02 release scenario…" | Mode `rules`: `test:e2e:m5` langkah 2 (DOCX Indonesia, dua masa kerja tumpang tindih, Gotenberg dan ClamAV nyata, Enter ganda, reload) |
| 2 | Graduate tanpa CV/employment sampai export | `test:e2e:m4` langkah 1–5, `cv-export` › "graduate scenario…" | Tidak ada |
| 3 | Note saat AI unavailable, edit, retry, output basi tidak menimpa | `ai-review.spec` › "S06 provider outage…", "S06 editing the note while a job is queued…"; `m3-assisted-journey` | `test:e2e:m5` langkah 3 dengan provider `unavailable` nyata (mode default pilot), bukan fake |
| 4 | Dua upload di batas kuota, URL dicabut | `evidence-backend`, `m2-cross-domain` #7, `private-storage` | Tidak ada |
| 5 | Override lalu update/delete sumber | `cv-freshness`, `cv-export` release scenario, `m4-cv-output` #3–4 | Tidak ada |
| 6 | Ownership dua akun, PDF multipage | `release-ownership.test.ts`, `m4-cv-output` #11–12, `test:pdf` | `test:integration:m5` skenario 7 (RPC dan route T26/0032) |
| X1 | Export bersamaan mutasi sumber | `cv-export`, `m4-cv-output` #9 | Tidak ada |
| X2 | Penarikan consent | `m3-assisted-entry` #2, #2b | `test:integration:m5` skenario 6 (dengan unit 0032) |
| X3 | Lease expiration | `cv-export` lease, `import-staging` #10 | `test:integration:m5` skenario 3, 8 (lease job `rules`) |
| X4 | Cleanup setelah penghapusan akun | `account-deletion` (3 test), `retention` | `test:integration:m5` skenario 3–4, `test:e2e:m5` langkah 8 |

## 4. P3 dan celah terbuka, diklasifikasi ulang

| Asal | ID | Ringkas | Klasifikasi gate | Alasan |
| --- | --- | --- | --- | --- |
| T25 | N3 | Assertion insert belum spesifik `42501` | P3 | Penolakan tetap terbukti; hanya ketajaman pesan |
| T25 | N5 | Skenario 2/3 sebagai rangkaian test | P3, sebagian ditutup | Skenario 3 kini satu journey (`test:e2e:m5`); skenario 2 tetap rangkaian di M4 |
| T25 | N6 | NVDA manusia belum dijalankan | P3 (keterbatasan) | Di luar gate menurut §1 handoff |
| T25 | O3 | Akun `wp-*` dan fixture suite lama bocor di database lokal | **P3**, diperluas | Database lokal, bukan data pengguna nyata, jadi bukan P0 privasi. Dampak nyata baru: memicu M5-N3 (`cv_export.test.sql` gagal di Fase 0). Hitungan di Fase 5 |
| T25 7b | B3 | Margin umur prune beberapa detik | P3 | Batas 30 hari tetap terpenuhi pada jadwal normal |
| T25 7b | B5 | Baris basi receipt Fase 7 | P3 | Dokumen |
| T25 7b | B6 | Recovery Gmail belum terikat image | **P3, dipindah ke §1.11** | Kriteria §1.11 mewajibkan satu klik recovery dari kotak masuk nyata ke `myworkpulse.my.id`; bila operator tidak bisa menunjukkannya, menjadi P2 lingkungan pilot |
| T25 7b | B7 | Nilai yang hanya dilaporkan | P3 | Fase 6 memberi label *dibaca balik* / *dilaporkan* |
| T25 7b | RV-B1 di server | Status pemasangan script baru di host | Bagian kriteria §1.12 | Dibuktikan lewat sha256 di host pilot |
| T25 closeout | C1–C4 | Prune pertama, versi script di server, jam cron, harness p95 | P3 | C2 menjadi syarat §1.12 untuk host pilot (sha256) |
| T25 §3 | tanpa ID | Cleanup setelah restore hosted; p95 staging; kanal notifikasi `ops:check` | P3 / BLOCKER production | Tidak menghalangi verdict pilot (§1 "tidak mencakup"); kanal notifikasi masuk daftar periksa Fase 6 butir 9 |
| Batas AI | U1–U5 | pgTAP khusus, parse gagal memakai unit, baris kapasitas, entry status, staging belum dimigrasi | P3 | U5 masuk Fase 6 butir 1 (urutan rilis) |
| T26 | N1 | T26 bertumpuk di branch usage limits | **Tertutup** | Keduanya sudah di `main` (`973e886` memuat `20261018090000` dan `20261019090000`) |
| T26 | N2 | Migration dan worker harus naik bersamaan | **P3, syarat §1.11** | Pilot dilaporkan sudah di migration terakhir; Fase 6 butir 1 meminta waktu penerapan migration 37–38 dan waktu worker T26 terpasang, serta job import di antara keduanya. Bila ada job yang macet, P2 lingkungan |
| T26 | N3 | Fokus setelah *Use AI* belum diverifikasi | P3 | Jalur `ai` tidak dipakai journey gate (AI pilot `unavailable`) |
| T26 | N4, N5 | Deviasi yang diterima; spasi hilang di `contracts.ts:28` | P3 | Kosmetik |
| T26 | N6 | Em dash di ringkasan error S03 | P3 | Copy, sejak T17 |
| T26 | N7 | Uji CV nyata dan NVDA belum ada | P3 | Di luar gate |
| T23 | F4, F6, F9 | Pesan guard ganda; objek non-kanonis, race guard, token sampai `exp`; rate limit Auth lokal | P3 | F6 retensi backup kini kriteria §1.12 |
| T24 | G2, G5, G6, G7 | Draft kosong menghitung activation; batas metode perf; `local_date` saat onboarding lewat import; N+1 | P3 | G6 tidak memengaruhi ukuran mana pun |

## 5. Baris basi

- Handoff `M5-gate-review-plan.md:11`: "T25 **PARTIAL**". Basi: T25 DONE sejak 20 Oktober 2026 (decision 0034, PR #30).
- Handoff `M5-gate-review-plan.md:12`: baseline "minimal `181103f`". HEAD kini `973e886` (PR #30, #31); angka unit ikut berubah karena story Storybook (Fase 0).
- Handoff `M5-gate-review-plan.md:122`: nomor decision berikutnya **0036**. Di `main`, `docs/decisions` berakhir di `0034-t25-staging-closeout.md`; T27 juga memakai nomor 0034 di branch-nya. Gate ini tidak menulis decision.
- `T25-release-checklist.md:8-9` sudah diperbarui 20 Oktober dan **tidak** lagi menyebut staging BLOCKED. Yang basi: §3 baris 48 (restore hosted) tetap benar sebagai belum diuji; tidak ada baris lain yang salah. Kolom bukti baris 16, 18, 21–24 hanya menyebut staging; pilot belum tercantum.
- `T25-release-handoff.md:70` ("scanner di host belum diverifikasi"), `:75` dan `:81` ("retensi backup ≤ 30 hari belum terverifikasi", "tidak ada proyek hosted untuk diperiksa") basi terhadap closeout staging 20 Oktober.
- `AGENTS.md:9`: "Langkah berikutnya: Gate M5, lalu deploy `main` ke staging (migration 37-38)". Masih benar; perubahan diserahkan ke reviewer di Fase 8.

## 6. Langkah berikutnya

Fase 2 membaca kode di sambungan yang ditandai di §2 (kolom dampak).

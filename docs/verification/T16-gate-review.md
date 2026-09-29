# T16 Gate review (import commit transaction)

- Tanggal: 29 September 2026
- HEAD yang direview: `6a8dd06` (baseline handoff `da0b8fe`), 22 file, +3272/−19.
- **Batasan independensi:** review ini dijalankan oleh sesi yang sama dengan pelaksana (bukan konteks segar). Verifikasi ulang dijalankan dari nol, tetapi bias penulis tetap mungkin.
  Review Opus dengan konteks baru tetap disarankan sebelum closeout bila pengguna ingin gate independen.

## Verdict

**Tidak ada temuan P0–P2 terbuka.** Empat catatan P3. T16 layak masuk Fase 5 (dokumen) lalu closeout. Status authoritative belum diubah.

## Matriks acceptance §1

| # | Acceptance | Bukti | Hasil |
| --- | --- | --- | --- |
| 1–2 | Commit atomik, foundation dulu, referensi di-resolve | pgTAP §7, integration 1 | PASS |
| 3 | Commit ganda | pgTAP §8 (berurutan, revision lama), integration 2 (3 sesi paralel) | PASS |
| 4 | Rollback total termasuk constraint-only | pgTAP §6 (+constraint uji), integration 3 | PASS |
| 5 | Map hanya reuse, milik sendiri | pgTAP §4/§7, integration 4 | PASS |
| 6 | Draft default, confirm eksplisit | pgTAP §3/§7 | PASS |
| 7 | Profil hanya field terpilih | pgTAP §7 (`map` profile ditolak); `skip` profile tidak punya assertion sendiri | PASS (lihat P3-1) |
| 8 | Onboarding lewat commit | pgTAP §9, integration 5 | PASS |
| 9 | Provenance setelah purge | pgTAP §11, integration 7 | PASS |
| 10 | Persist + revision guard | pgTAP §3 | PASS |
| 11 | Validasi dry-run | pgTAP §5 (kecuali `INVALID_ACTION`, tidak terjangkau lewat RPC) | PASS |
| 12 | Status dan isolasi | pgTAP §10, integration 8 | PASS |
| 13 | Race | integration 6a–6c, satu putaran | PASS terbatas (P3-3) |
| 14 | Skenario PRD | integration 1 | PASS |
| 15 | S08 provenance | unit render en/id, `test:e2e:achievements` | PASS |
| 16 | Log hygiene | integration 9 + grep `console.` di `src/features/import` = 0 | PASS |
| 17 | Regresi | tabel di bawah | PASS |

## Review kode (checklist §9)

- Tidak ada write klien langsung: grant tabel import tidak berubah (hanya select, plus `select (commit_result)`); ketiga RPC `security definer`, `search_path = pg_catalog`, execute hanya `authenticated`; semua helper `internal.*` dicabut dari semua role. Diverifikasi pgTAP struktur.
- Atomik: seluruh write ada dalam satu fungsi; blok `exception` hanya membungkus insert/update dan me-raise ulang `IMPORT_ITEM_INVALID` (tidak pernah menelan error dan melanjutkan); `status = committed` ditulis terakhir.
- Idempotensi: `committed` dicek setelah lock batch dan sebelum cek revision.
- Lock order profile → batch → item → target(share) → insert konsisten dengan `update_import_item` (share profile → batch → item), `cancel_import_batch`, dan `delete_experience`.
- Flag `workpulse.import_commit` bersifat transaksi-lokal, di-reset setelah loop, dan tidak dapat diset klien (tidak ada jalur SQL klien).
- Error/detail hanya id, field, kode; detail dengan properti lain ditolak di TypeScript.
- Scope: tidak ada route S03, CV invalidation, atau project import.

## Verifikasi ulang (independen, hasil aktual)

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm worker:check` / `pnpm db:lint` | 0 | bersih |
| `pnpm test` | 0 | 70 file / 449 test |
| `pnpm db:test` | 0 | Files=11, Tests=779 PASS |
| `pnpm test:integration:import-commit` | 0 | 11/11 |
| `pnpm test:integration:import` | 0 | 21/21 |
| `pnpm test:integration:achievements` | 0 | 5/5 |

Suite lain (dashboard, activity, projects, m2, ai, ai-review, evidence, storage, seluruh E2E domain, `build`) dijalankan pada Fase 4 dengan hasil di `T16-phase4-provenance-regression.md`;
tidak diulang pada gate ini. Tidak ada `db reset`. Lingkungan: Supabase lokal, ClamAV dan Gotenberg nyata; lokal bukan bukti production.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| P3-1 | P3 | Tidak ada assertion pgTAP untuk item `profile` dengan `skip` (tidak menulis apa pun) dan untuk `validate_import_batch` pada akun `deleting`. Perilakunya benar dari kode. | Follow-up (tambahkan di T17) |
| P3-2 | P3 | Konflik `unique_violation` skill akibat balapan dengan pembuatan skill lain menghasilkan `IMPORT_ITEM_INVALID` dengan daftar item kosong. UI T17 harus menangani daftar kosong (pesan umum + validasi ulang). | Catatan seam T17 |
| P3-3 | P3 | Uji race satu putaran per skenario: membuktikan hasil serial sah, bukan absennya deadlock secara statistik. | Diterima; ulang saat T24 bila perlu |
| P3-4 | P3 | Fixture T15 `import_staging.test.sql` diubah karena guard baru; assertion tidak berubah (Ruling di receipt Fase 1). | Dicatat |

## Langkah berikutnya

Fase 5 (decision 0022, `T16-import-commit.md`, README), lalu skill `workpulse-task-closeout`.

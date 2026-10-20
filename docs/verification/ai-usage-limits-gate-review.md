# Gate review: batas pemakaian AI per akun (decision 0032)

Tanggal: 20 Oktober 2026. Reviewer: Claude (Opus 5.5), read-only. Branch `claude/eloquent-jones-3c0191`, HEAD `65293cb` (basis `main` `4db01aa`). Tidak ada handoff plan; acuan review adalah decision 0032 dan receipt `ai-usage-limits.md`.

## Verdict

**PASS.** Tidak ada temuan P0, P1, atau P2. Lima catatan P3. Branch ini menjadi basis T26 dan harus di-merge sebelum T26.

## Kriteria

| Kriteria | Hasil | Bukti |
| --- | --- | --- |
| Charge atomik dalam transaksi job, tanpa sisa bila ditolak | PASS | `internal.charge_ai_usage` dipanggil di RPC yang sama; raise membatalkan seluruh transaksi; `enqueue_ai_job` memakai subtransaksi sehingga insert refine ikut di-rollback |
| Upsert bersyarat tidak bisa melewati batas saat paralel | PASS | `on conflict ... do update ... where units < limit` mengunci baris counter; integration: 6 request paralel di 18/20 → tepat 2 job |
| Replay idempotent tidak di-charge | PASS | charge hanya bila insert menghasilkan baris baru (`enqueue_ai_job`, `begin_import_batch`) |
| Body T14/T15 lain tidak berubah | PASS | `enqueue_ai_job` dibandingkan dengan `t14_ai_review.sql:131-174`; `begin_import_batch`/`retry_import_batch` dengan T15; hanya charge yang ditambahkan |
| Refine yang ditolak tetap menyimpan jawaban | PASS | `return null` pada `AI_QUOTA_EXCEEDED`/`AI_CAPACITY_EXCEEDED` untuk `refine`; `answer_ai_questions` mengembalikan `job_id` null; integration |
| Tabel counter tanpa grant API, tanpa konten, cascade dengan profil | PASS | `internal.*` dengan RLS aktif dan `revoke all`; FK `on delete cascade`; integration memeriksa API dan penghapusan user |
| `get_ai_usage` hanya untuk pemilik sesi, angka bersama tidak diekspos | PASS | `auth.uid()`, grant hanya `authenticated`, kapasitas hanya sebagai `limit_reason = 'capacity'` |
| Jalur manual tetap jalan | PASS | S02/S06 menampilkan *Start manually* / *Create achievement manually*; integration memastikan confirm manual setelah batas |
| Copy en/id, waktu reset dalam timezone profil | PASS | `ai-limit-notice.tsx`, `messages.ts`; unit `ai-usage-limits.test.tsx` |

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| U1 | P3 | Tidak ada pgTAP khusus untuk `charge_ai_usage`/`get_ai_usage`; perilaku dibuktikan lewat integration terhadap DB nyata (termasuk paralel). | Follow-up: pgTAP untuk batas, jendela, dan privilege |
| U2 | P3 | Parse import yang gagal sebelum AI tetap memakai satu dari 5 unit bulanan (keputusan 0032 #6). Untuk batch `rules` T26 tidak berlaku karena tidak di-charge. | Diterima, dipantau di pilot |
| U3 | P3 | Kapasitas bersama adalah satu baris per hari yang dikunci sampai transaksi RPC selesai. | Diterima untuk skala pilot (decision 0032 *Konsekuensi*) |
| U4 | P3 | Entry `IMPLEMENTATION_STATUS.md` ditulis "DONE lokal" sebelum gate review. Gate ini menutup celah itu; entry diperbarui. | Selesai di commit ini |
| U5 | P3 | Staging belum dimigrasi. | Ikut alur deploy T25 setelah merge |

## Verifikasi ulang

Supabase lokal bersama sudah berisi migration T26 (`20261019090000`) di atas migration ini, sehingga `db:test` dan suite DB dari branch ini sendiri akan menabrak signature yang sudah di-drop T26. Suite DB dan integration karena itu dijalankan dari worktree T26 (`claude/wizardly-thompson-18c6a2`), yang memuat kedua commit branch ini tanpa perubahan pada file usage limits selain body `begin_import_batch`/`retry_import_batch` yang diganti T26.

| Command | Lokasi | Exit | Hasil |
| --- | --- | --- | --- |
| `pnpm lint` | branch ini | 0 | |
| `pnpm typecheck` | branch ini | 0 | |
| `pnpm test` | branch ini | 0 | 119 file / 1084 test |
| `git diff --check 4db01aa HEAD` | branch ini | 0 | |
| `pnpm db:test` | T26 | 0 | 21 file / 1725 test |
| `pnpm test:integration:ai-usage` | T26 | 0 | 9/9 |
| `pnpm test:integration:ai` | T26 | 0 | 13/13 |
| `pnpm test:integration:ai-review` | T26 | 0 | 21/21 |
| `pnpm test:integration:storage` | T26 | 0 | 1/1 |
| `pnpm test:integration:import`, `import-commit`, `import-review`, `m3`, `release`, `account-deletion` | T26 | 0 | 25, 12, 6, 7, 12, 15 |
| `pnpm test:e2e:ai` | T26 | 0 | 2/2 |
| `pnpm test:e2e:ai-review` | T26 | 0 | 11/11 |
| `pnpm test:e2e:import`, `import-review`, `m3`, `release`, `m2` | T26 | 0 | 11, 10, 2, 15, lulus |

## Batas

Lokal, bukan staging atau production.

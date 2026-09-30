# T18 Gate review (Claude, read-only)

- Tanggal: 30 September 2026
- Reviewer: Claude
- HEAD yang direview: `1a56484` (baseline handoff `8c010c9`; 21 file, +4081 baris; tidak ada perubahan `src/app`, UI, worker, atau migration lama)
- Lingkungan: Supabase lokal (migration 27/27), ClamAV dan Gotenberg berjalan; `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal (proses saja); `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan.

## Verdict

**Tidak ada temuan P0–P2. T18 lulus gate review.** Status T18 belum ditandai DONE: Fase 5 (decision 0024, `T18-cv-schema-selection.md`, README) dan closeout masih menunggu.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| F1 | P3 | Receipt Fase 4 tidak menyimpan nama test yang gagal pada run pertama `test:e2e:activity`. Saya menjalankan ulang: lulus (1 passed), jadi konsisten dengan flaky bawaan, tetapi penyebab run pertama tidak terkonfirmasi. | Dicatat |
| F2 | P3 | `src/features/cv/actions.ts` membuat correlation ID baru pada `failure()` alih-alih memakai ID yang dibuat untuk service pada `run()`, sehingga ID di respons error tidak sama dengan ID yang dipakai service. Tidak ada log di sisi CV, jadi dampaknya nol saat ini; rapikan di T19 saat UI mengonsumsi ID. | Follow-up T19 |
| F3 | P3 | Race (§1.9, §2.2.10–11) dibuktikan dengan dua session pada satu proses Node: interleaving nyata tetapi tidak deterministik. Sesuai batas yang sudah dicatat receipt. | Diterima |

## Checklist §9 handoff

| Butir | Hasil | Bukti |
| --- | --- | --- |
| Tanpa write klien langsung; lima RPC, grant, `security definer`/`search_path` | PASS | Migration `:297-315` (hanya `grant select`), `:862-871`; semua fungsi `set search_path = pg_catalog`; pgTAP + integration insert/update/delete langsung ditolak |
| Satu CV per akun, paralel; onboarding wajib | PASS | `ensure_cv_document` `on conflict (user_id) do nothing` (`:597-615`), `ONBOARDING_REQUIRED` (`:593`); integration paralel ×5 |
| Eligibility hanya confirmed di bawah lock; confirm tidak menyisipkan | PASS | achievement dikunci `for share` sebelum cek status (`:652-661`); integration reopen vs select |
| Parent otomatis, tanpa duplikasi; hapus parent eksplisit | PASS | `:678-699`, `:743-759` |
| Check section/sumber, unique per tipe, posisi deferrable, kontigu | PASS | `:120-158`, `internal.cv_renumber_section` |
| Revision naik tepat sekali, `expected_revision` | PASS | satu `update cv_documents` di akhir tiap RPC + `touch_mutable_row`; `cv_lock` menolak revision basi |
| Snapshot hanya field tampilan | PASS | `internal.cv_source_snapshot` memakai `jsonb_build_object` eksplisit (bukan `to_jsonb(row)`); tidak ada `raw_text`/`contribution`/evidence |
| Delete sumber lama tetap jalan, item `source_deleted`, tanpa lock `cv_documents` dari jalur delete | PASS | FK `on delete set null (col)` + `guard_cv_item_row` (`:236-277`); enam fungsi delete diuji pgTAP dan integration |
| Urutan lock konsisten, tanpa deadlock | PASS | profil → CV → item (urut id) → sumber; race 3 putaran dan reopen/delete vs select tanpa `40P01` |
| Error hanya kode/ID, tanpa teks sumber | PASS | `raise exception` hanya kode; `CV_CHILD_ITEMS_EXIST` detail = ID; sentinel test lulus; `console.` di `src/features/cv` = 0 |
| Tidak ada UI S13/fitur roadmap | PASS | tidak ada perubahan `src/app`; `/cv` tidak disentuh |

## Command yang saya jalankan ulang

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | bersih (`--max-warnings 0`) |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | lulus (angka 81 file / 575 test di receipt tidak saya hitung ulang dari output) |
| `pnpm db:test` | 0 | 12 file, 909 assertion, PASS |
| `pnpm db:lint` | 0 | `results: []` |
| `pnpm worker:check` | 0 | status ready |
| `pnpm build` | 0 | sukses |
| `git diff --check` | 0 | bersih |
| `pnpm test:integration:cv` | 0 | 10/10 |
| `pnpm test:integration:achievements` | 0 | 5/5 |
| `pnpm test:integration:projects` | 0 | 7/7 |
| `pnpm test:integration:import-commit` | 0 | 11/11 |
| `pnpm test:integration:m2` | 0 | 8/8 |
| `pnpm test:integration:m3` | 0 | 7/7 |
| `pnpm test:e2e:m2` | 0 | 1 passed |
| `pnpm test:e2e:m3` | 0 | 2 passed |
| `pnpm test:e2e:achievements` | 0 | 4 passed |
| `pnpm test:e2e:activity` | 0 | 1 passed |

## Tidak dijalankan ulang oleh reviewer

Suite integration/E2E lain di daftar §7 (activity, dashboard, import, import-review, ai, ai-review, evidence, storage; e2e projects/dashboard/auth/ui/import/import-review/ai/ai-review/evidence). Alasan: T18 tidak menyentuh kode, UI, worker, maupun migration lama mereka; hasil lulus ada di receipt Fase 4 dan tidak saya verifikasi independen. `test:ai:live` tidak relevan.

## Batas

Keberhasilan lokal bukan bukti integrasi production. UI S13, freshness/invalidasi revision CV saat sumber berubah, dan export adalah T19–T22.

## Langkah berikutnya

Fase 5 (decision 0024, `T18-cv-schema-selection.md`, README), lalu `workpulse-task-closeout` untuk menandai T18 DONE. F2 dibawa ke T19.

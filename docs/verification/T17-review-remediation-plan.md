# Rencana Remediasi Review T17 — Import review UI dan onboarding

Status plan: **DONE — 30 September 2026** (RV1, N1, N7 diperbaiki di `2c81c02`; T17 DONE, lihat `T17-import-review-ui.md`).

- Tanggal: 30 September 2026.
- Reviewer: Claude (Opus), gate review read-only setelah Fase 5 (`T17-implementation-plan.md` §9–§10).
- HEAD yang direview: `58e0183` (branch `claude/clever-archimedes-gbu7qd`, baseline `d4bd39f`).
- Verdict awal (HEAD `58e0183`): **BELUM LULUS — 1 temuan P2 terbuka.**
- **Review ulang (30 September 2026, HEAD `2c81c02`): LULUS — tidak ada P0–P2 terbuka.** RV1 dan N1/N7 ditutup di `2c81c02` (bukti: `T17-phase5b-remediation.md`); checks §4 diulang semuanya exit 0, `git diff --check d4bd39f..HEAD` exit 0. Remediasi dikerjakan reviewer sendiri atas instruksi pengguna, sehingga review ulang tidak independen penuh: ditopang test yang terbukti gagal tanpa perbaikan (unit 6 gagal, E2E RV1 gagal di notice) dan lulus dengan perbaikan. Lanjut Fase 6/closeout.
- Persetujuan pengguna (30 September 2026, "Setuju semua"): verdict, klasifikasi RV1 dan N1–N9, perbaikan RV1 §2, perapian §3, serta penerimaan N2 (HTTP 200 dengan konten 404 generik) dan N3 (assertion `m2-manual-journey`) untuk dicatat di decision 0023.
- Eksekutor remediasi: satu agent, tanpa sub-agent, TDD (test gagal → perbaikan minimal → lulus). Tanpa migration, tanpa perubahan RPC/validasi T15/T16, tanpa `db reset`.

## 1. Ringkasan temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV1 | P2 | Token revision batch untuk commit ikut "melompat" ke revision yang dibuat tab lain lewat receipt update, sehingga commit dapat menerapkan pilihan yang tidak pernah ditampilkan di tab ini | FIXED `2c81c02` |
| N1 | P3 | `git diff --check d4bd39f..HEAD` exit 2: baris kosong ekstra di EOF pada 5 file; receipt Fase 5 melaporkan exit 0 (dijalankan pada working tree bersih, bukan pada range T17) | FIXED `2c81c02` |
| N2 | P3 | S03 untuk id asing/tidak ada merespons HTTP 200 (streaming `loading.tsx`) dengan konten 404 generik identik; API tetap 404 | Diterima; catat di decision 0023 |
| N3 | P3 | Perubahan assertion `tests/e2e/m2-manual-journey.spec.ts:181` di luar daftar §1.16 | Diterima (kontrak Import CV aktif yang sama dengan `dashboard-timeline`); catat di decision 0023 |
| N4 | P3 | `GET /api/imports/[id]/review` lewat `importHttp` tetap menginstansiasi admin client + `ImportService` meski data hanya dibaca lewat session client | Follow-up |
| N5 | P3 | Tidak ada label `import.review.field.metrics` / `import.review.field.experience_item_id`; bila SQL mengeluarkan error pada field itu, ringkasan error menampilkan key mentah | Follow-up |
| N6 | P3 | `ONBOARDING_INVALID` dari commit hanya tampil sebagai notice umum, bukan error pada field onboarding (§2.2.12) | Follow-up |
| N7 | P3 | `cancelImport` memanggil `clearUnsavedForm("import-review-<itemId>")` untuk key yang tidak pernah dipakai (key sebenarnya per batch, sudah dibersihkan `guardClean`) | FIXED `2c81c02` |
| N8 | P3 | `onProfileField` mengirim `""` (bukan `null`) untuk nilai profil yang dikosongkan, berbeda dari `draftPatch` | Follow-up |
| N9 | P3 | Flaky pra-T17: `activity-ui.spec.ts:356` (`toHaveURL` project) gagal sekali dalam `test:e2e:evidence`, lulus pada `test:e2e:activity` dan rerun evidence (8/8) | Pantau |

Tidak ada temuan P0 atau P1.

## 2. RV1 — Token revision batch menyerap perubahan tab lain (P2)

**Gejala.** Tab A dan tab B membuka S03 batch yang sama (revision batch `r`). Tab B mengubah kandidat X (mis. mencentang *Confirm this achievement* atau mengganti action ke `map`) → batch `r+1`. Tab A lalu menyimpan kandidat lain Y dengan sukses → receipt `batchRevision = r+2`. Tab A kini memegang token `r+2` = revision server, sehingga *Confirm import* di tab A **berhasil** dan meng-commit pilihan X dari tab B, padahal tab A masih menampilkan X dalam keadaan lama (mis. belum dikonfirmasi). Ini melanggar §1 poin 4 (*commit dengan revision batch basi menampilkan pesan konflik … tanpa commit*), kontrak PRD *concurrent edits report conflict, not silent overwrite*, dan risiko §10.1 (*meng-commit keadaan yang tidak dilihat pengguna*).

**Penyebab.** `src/domain/import/review-edit.ts:64-66` (`nextBatchRevision = Math.max(current, receipt)`) dan `withReceipt` (`:68-79`) mengadopsi revision batch dari receipt tanpa memeriksa apakah kenaikan itu seluruhnya berasal dari simpanan tab ini. `update_import_item` menaikkan revision batch tepat satu per update (`20261001090000_t16_import_commit.sql:655-658` + trigger revision T15), sehingga lompatan lebih dari jumlah simpanan sendiri berarti ada perubahan dari luar. `import-review.tsx:220` dan commit `:293` memakai token itu. E2E dua tab (`tests/e2e/import-review.spec.ts:430-441`) hanya menguji kasus tab A **tidak** menyimpan apa pun setelah perubahan tab B, sehingga celah ini lolos.

**Perbaikan minimal (tanpa perubahan SQL).**

1. Lacak token secara eksplisit: token commit = revision batch dari snapshot terakhir yang dimuat (render awal atau `reload()`) + jumlah update sukses milik tab ini sejak snapshot itu. Receipt tidak lagi dipakai dengan `Math.max`.
2. Setelah update sukses, bila `receipt.batchRevision` > token yang diharapkan (setelah semua simpanan sendiri yang sedang berjalan selesai), anggap batch berubah di tempat lain: jangan majukan token ke nilai receipt; tampilkan notice konflik yang sudah ada (`import.review.commitStale` atau copy setara) dan jalankan `reload()` sehingga pengguna melihat pilihan terbaru sebelum commit. Draft lokal tetap dipertahankan seperti perilaku reload sekarang.
3. Alternatif yang setara dan boleh dipilih: jangan majukan token dari receipt yang melompat, sehingga commit berikutnya pasti `STALE` → jalur konflik commit yang sudah ada (pesan + reload, tanpa commit). Pilih satu dan catat alasannya di receipt remediasi.
4. Simpanan paralel milik sendiri pada kandidat berbeda yang selesai tidak berurutan tidak boleh dianggap konflik palsu yang membuat token salah; bila menyebabkan reload yang tidak perlu, itu dapat diterima selama tidak ada commit keadaan tak terlihat.

**Test regresi (gagal dulu, lalu lulus).**

- Unit (`tests/unit/import-review-edit.test.ts`): receipt dengan `batchRevision = token + 2` untuk satu simpanan sendiri → token **tidak** menjadi nilai receipt dan fungsi melaporkan out-of-sync; receipt `token + 1` → token maju normal; dua simpanan sendiri yang selesai tidak berurutan → token akhir = base + 2 tanpa out-of-sync.
- E2E (`tests/e2e/import-review.spec.ts`, skenario dua tab diperluas atau skenario baru): tab B mencentang confirm/mengubah action kandidat X; tab A menyimpan kandidat Y (Saved) lalu klik *Confirm import* → **tidak ada commit** (admin count 0, batch tetap `review`), tab A menampilkan pilihan X terbaru dari server; commit berikutnya setelah sinkron berhasil sekali.

## 3. Perapian P3 yang ikut dikerjakan

- N1: hapus baris kosong ekstra di EOF pada `src/features/import/import-review.tsx`, `tests/integration/import-review-ui.test.ts`, `tests/unit/import-review-route.test.ts`, `tests/unit/import-review-ui.test.tsx`, `tests/unit/import-review-view.test.ts`. Receipt berikutnya menjalankan `git diff --check d4bd39f..HEAD` (range), bukan hanya working tree.
- N2, N3: masukkan ke decision 0023 pada Fase 6.
- N4–N8: opsional; kerjakan hanya bila kecil dan diuji, jika tidak biarkan sebagai follow-up di decision 0023.

## 4. Checks yang wajib diulang setelah remediasi

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm worker:check
pnpm test:integration:import-review
pnpm test:integration:import-commit
pnpm test:e2e:import-review
pnpm test:e2e:import
pnpm test:e2e:m2
git diff --check d4bd39f..HEAD
```

`test:e2e:import-review` diulang dengan `--repeat-each 2`. Muat env Supabase lokal dalam command yang sama; kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk `test:e2e:m2`. Tulis hasil aktual (exit code, angka pass/fail) di `docs/verification/T17-phase5b-remediation.md` dan commit `fix(t17): keep the commit token in sync with this tab's saves`.

## 5. Bukti gate review (dijalankan ulang reviewer, HEAD `58e0183`)

Environment: Docker Desktop + Supabase lokal (parity migration 26/26, tanpa migration baru), ClamAV `workpulse-t10-clamav` dan Gotenberg `workpulse-t15-gotenberg` berjalan; `supabase_vector` restart-loop (tidak dipakai). `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal di env proses saja.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 76 file / 495 test |
| `pnpm worker:check` | 0 | — |
| `pnpm build` | 0 | — |
| `pnpm db:lint` | 0 | — |
| `pnpm db:test` | 0 | 11 file / 779 assertion, PASS |
| `git diff --check d4bd39f..HEAD` | 2 | 5 baris kosong ekstra di EOF (N1) |
| `test:integration:import-review` | 0 | 6 |
| `test:integration:import-commit` | 0 | 11 |
| `test:integration:import` | 0 | 21 |
| `test:integration:{achievements,dashboard,activity,projects,m2,ai,ai-review,evidence,storage}` | 0 | 5, 4, 6, 7, 8, 13, 21, 14, 1 |
| `test:e2e:import-review` | 0 | 9 |
| `test:e2e:{import,dashboard,m2,auth,ui,achievements,ai,activity,projects,ai-review}` | 0 | 7, 1, 1, 1, 1, 4, 2, 1, 1, 11 |
| `test:e2e:evidence` | 1 → 0 | run pertama 7/8 (flaky `activity-ui.spec.ts:356`, N9), rerun 8/8 |

Tidak dijalankan: `--repeat-each 2` untuk `test:e2e:import-review` (receipt pelaksana 18/18; akan diulang setelah remediasi), smoke live `extractImport`, race stres commit.

## 6. Hal yang sudah diverifikasi lulus (read-only)

- Tanpa migration; tulis hanya lewat `update_import_item`, `validate_import_batch`, `commit_import_batch`, `cancel_import_batch` melalui session client; loader S03 hanya memakai session client + RLS (`import-review-view-service.ts`).
- Guard S03 di luar workspace: anonim → `/sign-in?returnTo=` (allowlist UUID di `safe-return.ts`), tanpa profil → `serviceUnavailable`, provisional diizinkan, id asing/tidak ada/bukan UUID → `notFound()` yang sama; `/imports` masuk `protectedPaths` dan matcher proxy.
- Tidak ada *Confirm all*; confirm per achievement hanya dari payload tersimpan yang lengkap; server melepas confirm saat action bukan `create` dan client mencerminkannya (`applyChange`).
- Map tidak mengubah target (integration + E2E snapshot); opsi map hanya milik pemilik (integration akun B).
- Tombol final diblokir untuk validation/unsaved (termasuk tanggal invalid)/saving/onboarding; `commitLock` + `pending` mencegah submit ganda; idempotensi dibuktikan admin count.
- Nama onboarding tidak pernah diprefill placeholder; `display_name` tidak ada di checkbox `selected_fields`.
- Hitungan hasil dari `commit_result` (respons commit atau `import_batches.commit_result`), tanpa angka bila tidak ada.
- Entry point S02/S04/S12, S02 terbuka untuk pengguna lama dengan *Start manually* → `/settings/profile`.
- Copy en/id dijaga tipe `Record<keyof typeof en, string>`; ikon hanya lucide; CSS memakai token existing.
- Tidak ada `console`/logger baru di jalur S03; error route/action hanya kode + correlation ID; sentinel isi CV/nama file = 0 di integration dan E2E.

# T25 Fase 2 — Penjaga katalog dan isolasi dua akun

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `7d1f022`; checkpoint Fase 1 disetujui pengguna ("lanjut Fase 2").
- Tidak ada migration dan tidak ada perubahan source `src/`. Tidak ada defect baru yang ditemukan oleh suite ini.

## Tujuan dan file berubah

Menutup D1, D2, dan bagian restore dari D8 (matriks Fase 1): penjaga katalog database, isolasi dua akun yang dihasilkan dari katalog, dan bukti bahwa penghapusan dapat diterapkan ulang setelah restore.

| File | Aksi |
| --- | --- |
| `supabase/tests/database/release_catalog.test.sql` | create (26 assertion) |
| `tests/integration/release-ownership.test.ts` | create (11 test: 8 isolasi + 3 "dapat gagal") |
| `tests/integration/release-restore.test.ts` | create (1 test) |
| `package.json` | script `test:integration:release` (satu baris; lihat catatan) |

Catatan `package.json`: file itu punya perubahan Storybook yang bukan dari sesi ini. Hanya satu baris script saya yang masuk commit (lewat index); perubahan Storybook tetap berstatus modified di working tree dan tidak saya komit.

## Command dan hasil

`SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` hasil `supabase status -o env` ke env proses saja; `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan.

| Command | Hasil |
| --- | --- |
| `supabase test db supabase/tests/database/release_catalog.test.sql` | exit 0, 25 assertion lulus pada run pertama (26 setelah satu kontrol negatif ditambah) |
| `pnpm db:test` | exit 0, **19 file / 1603 assertion**, `Result: PASS` (baseline Fase 0: 18 / 1577) |
| `pnpm db:lint` | exit 0, `{"results":[]}` |
| `vitest run … release-ownership.test.ts release-restore.test.ts` | exit 0, **2 file / 12 test** (11 + 1) (setara script `test:integration:release`, 156 detik) |
| `eslint tests/integration/release-*.ts --max-warnings 0` | exit 0 |
| `tsc --noEmit` | exit 0 |

## Penjaga katalog (`release_catalog.test.sql`)

Delapan aturan dibaca dari katalog (`pg_class`, `pg_attribute`, `pg_trigger`, `pg_proc`, `has_*_privilege`, `storage.buckets`), tanpa daftar tulisan tangan:

| Aturan | Pelanggaran yang dilaporkan |
| --- | --- |
| `rls_missing` | tabel `public` tanpa RLS |
| `guard_missing` | tabel `public` ber-`user_id` (dan `profiles`) tanpa `zz_guard_account_writable` |
| `anon_table_privilege` | privilege tabel **atau kolom** untuk `anon` di `public`/`internal` |
| `internal_table_privilege` | privilege tabel/kolom `internal` untuk `anon`, `authenticated`, `service_role` |
| `secdef_search_path` | fungsi `security definer` di `public`/`internal` tanpa `search_path` |
| `anon_function` | fungsi `public` yang dapat dieksekusi `anon` (allowlist kosong, ditulis eksplisit) |
| `internal_schema_usage` | `anon` memegang `USAGE` pada skema `internal` |
| `public_bucket` | bucket Storage `public = true` |

- **Katalog nyata bersih** untuk kedelapan aturan, dan batas non-vakum: ≥ 18 tabel `public`, ≥ 9 tabel `internal`, ≥ 100 fungsi `security definer`, ≥ 1 bucket.
- **Setiap aturan dapat gagal** (§2.2.4): 11 probe membuat objek pelanggar di subtransaksi lalu me-rollback (`p_setup` dieksekusi, aturan dihitung, `raise` `P0T25` dibaca). Dilaporkan oleh probe: tabel tanpa RLS, tabel ber-`user_id` tanpa guard, grant tabel ke `anon`, grant kolom ke `anon`, tabel `internal` ke `authenticated`, tabel `internal` ke `service_role`, fungsi `security definer` di `public` dan di `internal` tanpa `search_path`, fungsi `public` yang di-grant ke `anon`, `USAGE` skema `internal` ke `anon`, bucket publik. Dua kontrol negatif (setup `select 1`) tidak dilaporkan, dan tidak ada objek probe yang tersisa setelahnya.
- Aturan `internal_schema_usage` dan pemeriksaan kolom ditambahkan di luar daftar plan §1.3: keduanya menjadi alasan catatan O1 (fungsi `internal` yang dapat dieksekusi `anon` lewat `PUBLIC`) aman, dan privilege kolom adalah cara `ai_jobs`/`import_batches` dibuka ke `authenticated`.

## Isolasi dua akun (`release-ownership.test.ts`)

Akun A dan B dibuat lewat Admin API (`t25-release-<label>-<uuid>@example.test`, password acak per run, tidak dicetak), di-onboard lewat `complete_onboarding`, dan dihapus lewat jalur penghapusan T23. Sentinel privat berbeda per akun (`WP-PRIVATE-T25-SENTINEL-<uuid>`) ada di raw activity, judul achievement, judul project, organisasi experience, isi batch dan item import A; B tidak pernah menerimanya.

| Pemeriksaan | Cakupan | Hasil |
| --- | --- | --- |
| Fixture per tabel | 18 tabel `public` dari katalog; 18 punya baris untuk A | lulus; tabel baru tanpa baris atau alasan membuat test gagal |
| Tabel (select, update, delete, insert) | 18 tabel, kolom owner dari katalog (`profiles.id`, lainnya `user_id`) | B: select 0 baris (kontrol: pemilik membaca ≥ 1 baris), update/delete ditolak `42501`, insert `user_id` A ditolak `42501`; fingerprint `md5` baris A tidak berubah |
| RPC ber-ID record | 47 kasus (parameter) pada 36 RPC, daftar wajib dari katalog (tes gagal bila ada parameter `uuid` baru tanpa kasus) | jawaban untuk ID milik A sama dengan ID acak pada semua kasus; fingerprint A tidak berubah. Kontrol pemilik (B dengan record B sendiri, revisi basi) berbeda dari "tidak ditemukan" pada 45 dari 47 kasus; satu tanpa kontrol (`cancel_import_batch`, mengubah data) dan satu tidak dapat dibedakan (lihat di bawah) |
| Replay operation key | 6 RPC `create_*_idempotent` | B dengan kunci A memperoleh record **B sendiri**, bukan record A |
| RPC worker | 59 fungsi hanya `service_role` | ditolak `42501` untuk `authenticated` dan `anon` (118 panggilan); semua 115 fungsi `public` ditolak untuk `anon` |
| Storage | 5 objek A (evidence uploading, evidence ready, import, export, yatim) × `authenticated`/`anon` | signed URL, unduh, timpa, hapus, unggah ke prefix A, dan list ditolak; SHA-256 dan jumlah objek A tidak berubah |
| Route | `/api/evidence/[id]/download`, `/api/cv/exports/[id]`, `/api/imports/[id]` | B: ID A dan ID acak sama-sama 404 dengan kode dan pesan sama; pemilik 200 |
| Sentinel | semua respons yang diterima B | nol kemunculan sentinel A |

### Tabel yang ditulis sebagai pemilik database (dengan alasan)

| Tabel | Alasan |
| --- | --- |
| `ai_suggestion_reviews` | baris ada hanya setelah job sukses, yang membutuhkan worker AI dan provider (suite ai-review) |
| `import_batches` (status review) | batch mencapai review setelah scan, parse, dan ekstraksi worker import (suite import-staging) |
| `import_items` | ditulis worker import |
| `cv_exports` | export sukses membutuhkan worker export dan renderer (suite cv-export) |

Tabel lain diisi lewat RPC atau jalur nyata. `evidence_files` ready dihasilkan jalur sah: reserve → upload → pemindai bersih (adapter fake hanya di test) → worker. `ai_jobs` dibuat oleh `set_ai_consent` + `request_ai_analysis`.

### Satu pengecualian kontrol pemilik

`apply_ai_suggestion.p_job_id`: pemilik job berstatus `queued` mendapat `AI_JOB_UNAVAILABLE`, sama dengan orang asing. Perbandingan foreign-vs-random tetap berlaku; kontrol pemilik untuk job sukses memerlukan worker AI dan sudah dibuktikan oleh `ai-review` test 13.

### Bukti penjaga dapat gagal (§2.2.4)

Tiga test "ownership checks can fail" menjalankan fungsi pemeriksa yang sama (`leakOf`, `writeLeakOf`, `outcome`, `noSentinel`) pada jawaban yang akan diberikan database yang rusak: baris yang kembali ke orang asing, kode error tak terduga, tulisan yang berlaku, jawaban foreign yang berbeda dari random, dan sentinel di respons. Semuanya dilaporkan sebagai pelanggaran. Tidak ada mutasi pada database lokal.

## Restore (`release-restore.test.ts`)

Alur nyata dengan Auth, Storage, dan worker:

1. Akun lama dihapus sampai `completed`; titik restore diambil sesudahnya.
2. Akun kedua (data + 4 objek) meminta penghapusan **setelah** titik restore.
3. Ekspor operator `select user_id … where requested_at > <titik restore>` mengembalikan tepat satu id (akun kedua; akun lama tidak ikut).
4. Restore disimulasikan: receipt dihapus dan `deleting_at` dikosongkan (guard dimatikan dalam satu transaksi), baris dan objek tetap ada.
5. `begin_account_deletion(id)` dipanggil untuk id hasil ekspor → receipt `queued` → `runUntilCompleted` → `completed`; baris, objek, dan Auth user hilang.
6. Memanggil lagi untuk id yang sudah tidak ada menghasilkan `P0002`, tanpa mengubah receipt; runbook akan menulis "lewati id itu".

Retensi dan pemangkasan receipt 30 hari sudah dibuktikan `account_deletion.test.sql` ("a recent completed receipt is kept", "older than 30 days is pruned") dan tidak diulang.

## Temuan Fase 2

| ID | Prio | Temuan | Tindakan |
| --- | --- | --- | --- |
| — | — | Tidak ada pelanggaran katalog dan tidak ada kebocoran lintas akun | D1, D2 tertutup; D8 (replay restore) tertutup, alert backlog menunggu Fase 3 |
| O5 | P3 | `authenticated` tidak punya privilege `INSERT`/`UPDATE`/`DELETE` pada tabel `public` mana pun; semua tulisan lewat RPC `security definer`. Enam tabel (profiles, experiences, education, certifications, projects, skills) masih punya policy tulis `_own` yang tidak pernah terpakai lewat PostgREST. Aman (lapisan ganda), tetapi policy itu tidak teruji oleh jalur PostgREST. | Dicatat |
| O6 | P3 | `begin_account_deletion` untuk id yang tidak ada menjawab `P0002` (kontrak T23). | Masuk runbook Fase 6 |
| N1 | info | `create_project_idempotent` menerima `planned`, `active`, `completed` (bukan `ongoing`); `create_activity_idempotent` dengan project wajib membawa `experience_id` project itu. | Hanya catatan fixture |

## Acceptance Fase 2

- §1.3 (katalog database): terbukti, 8 aturan, 11 probe pelanggar.
- §1.4 (isolasi tabel): terbukti untuk 18 tabel dari katalog.
- §1.5 (isolasi RPC): terbukti untuk 47 parameter pada 36 RPC.
- §1.6 (storage, route, worker): terbukti.
- §2.2.9 (restore): terbukti sebagai test; klaim retensi backup ≤ 30 hari **tetap tidak terverifikasi** (B2).
- Stop condition §8: tidak ada yang terpicu.

## Catatan

- Perubahan Storybook oleh sesi lain ada di working tree (`package.json`, `vitest.config.ts`, `eslint.config.mjs`, `pnpm-lock.yaml`, `.storybook/`, `src/components/ui/*.stories.tsx`, `docs/IMPLEMENTATION_STATUS.md`). Tidak saya sentuh. Fase 8 membandingkan diff terhadap HEAD Fase 0; file-file itu akan muncul kecuali sudah dikomit atau dipindahkan oleh pemiliknya. Selain itu `vitest.config.ts` yang diubah mempengaruhi suite unit Fase 3 dan 4 (lihat langkah berikutnya).
- Suite ini membuat dua akun per run dan menghapusnya lewat jalur T23. Run lokal ini menambah nol akun `t25-*` yang tersisa (diperiksa di Fase 8).

## Langkah berikutnya

Fase 3: pgTAP `operational_health.test.sql` (gagal lebih dulu), migration `20261012090000_t25_operational_health.sql` (parity 36/36), `workers/ops-check.ts`, `ops:check`.

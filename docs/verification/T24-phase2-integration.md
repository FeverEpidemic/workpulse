# T24 Fase 2 — Integration event lintas domain

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `5a48eb5`; commit: `b3efd14` (`test(t24): add product event integration across domains`)
- Tidak ada perubahan di `src/`, `workers/`, atau migration di fase ini.

## Tujuan dan file berubah

| File | Perubahan |
| --- | --- |
| `tests/integration/product-events.test.ts` | baru: 9 test terhadap Supabase, Auth, Storage, worker export dan worker AI nyata |
| `package.json` | script baru `test:integration:product-events` |

Harness memakai `tests/integration/account-deletion-support.ts` (`setupHarness`, `createAccount`, `deleteThroughService`, `runUntilCompleted`, `teardownHarness`) supaya akun berpopulasi dibersihkan lewat jalur penghapusan T23, bukan `deleteUser` biasa. Akun A (`Asia/Jakarta`) memakai semua jalur; akun B (`UTC`) hanya activity, satu education dan export.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm test:integration:product-events` | exit 0, **1 file / 9 test**, 30 detik |
| `pnpm test:integration:account-deletion` | exit 0, **2 file / 14 test** (sama dengan baseline) |
| `pnpm test:integration:import-commit` | exit 0, **1 file / 11 test** (sama dengan baseline) |
| `pnpm typecheck`, `pnpm lint` | exit 0 |
| Akun `acd-t24%` tersisa setelah suite | **0** |

Dua run pertama gagal karena cacat test saya, bukan produk: `save_changes` memakai `cvBullet: ""` yang mengosongkan bullet (`REQUIRED_CONFIRM_FIELDS`), dan permintaan export kedua untuk revision CV yang sama memang dipakai ulang oleh `request_cv_export` (dedup export sukses yang belum kedaluwarsa), sehingga test mengubah judul CV lebih dulu.

## Acceptance yang terbukti di fase ini

| §1 | Bukti |
| --- | --- |
| 1 Event dari semua jalur | service activity Note/Form/Chat (urutan `note, form, chat`); RPC experience, certification, skill; service project; service achievement (draft → confirm, standalone); **apply AI** lewat worker AI nyata dan provider fake (`origin: activity`, nol event AI); **import commit** lewat `createImportReviewService` dengan batch staging (`{created:3, mapped:1, skipped:1, confirmed_achievements:1}`, tiga `career_record_created`, satu `achievement_confirmed` origin `import`); export lewat **worker export nyata**: sukses (attempt 1), gagal `RENDERER_UNAVAILABLE` (renderer fake gagal), retry sukses (attempt 2) = tiga event |
| 1 Tanpa event | edit activity, edit project, edit achievement confirmed, skill, baca: nol event |
| 2 Atomik, idempotent | `STALE_REVISION` pada confirm: nol event; commit import dengan satu item invalid ditolak: jumlah event tidak berubah; `createActivity` kunci sama dan commit import kedua: tidak menambah event |
| 3 Metadata minimal | pencarian sentinel `WP-PRIVATE-T24-SENTINEL-<uuid>` (ada di raw activity, judul project, judul achievement, nama file batch import, judul CV; 5 jenis lokasi terverifikasi ada) terhadap teks seluruh baris `internal.product_events`: **0** kemunculan; juga 0 untuk `WP-PRIVATE`, `@workpulse.test`, dan UUID di properti; hasil `get_pilot_metrics` tidak memuat sentinel |
| 4 Tidak dapat diakses klien | `authenticated` dan `anon` lewat PostgREST: `get_pilot_metrics` dan `set_pilot_participant` ditolak; `internal.product_events` (skema internal) dan `public.product_events` tidak terbaca |
| 5 Kohort terpisah dari fixture | metrik kosong saat tidak ada peserta; setelah A didaftarkan `cohort_size = 1` dan event B (tidak terdaftar, punya export sukses) tidak terhitung; versi persetujuan di luar pola ditolak `INVALID_PILOT_PARTICIPANT` |
| 6–8 | activation 1/1, value completion 1/1 (konfirmasi + export sukses), return capture 1/1 (dua `local_date` di minggu berbeda); dengan `p_as_of = now()` akun baru `pending = 1`, `rate` NULL |
| 9 Export reliability | 2 dari 3 terminal (sukses, gagal, retry sukses) = `0.6667`, dengan worker export nyata |
| 10 Laporan jujur | kolom `eligible`, `achieved`, `pending`, `rate`, `target` dan `cohort_size` terverifikasi lewat PostgREST service role |
| 11 Ikut terhapus | `deleteThroughService(A)` → `runUntilCompleted` (receipt `completed`, profil hilang): nol event dan nol baris peserta A; event B persis sama dengan sebelum penghapusan |

## Belum terbukti di fase ini

- Overhead trigger pada p95 simpan (Fase 5).
- Regresi seluruh suite lama (Fase 6); di fase ini hanya `account-deletion` dan `import-commit` dijalankan ulang.
- Event dari `reopen` lalu `confirm` pada jalur layanan (tercakup pgTAP Fase 1, bukan integration).

## Blocker dan catatan

- Tidak ada stop condition §8 yang terpicu; tidak ada test lama yang diubah.
- Suite memakai satu apply AI dengan provider fake pada akun yang memberi consent di test; tidak memanggil endpoint AI nyata.

## Langkah berikutnya

Fase 3: `tests/perf/{stats,perf-support,seed}.ts`, `vitest.perf.config.ts`, `tests/unit/perf-stats.test.ts`, script `test:perf`.

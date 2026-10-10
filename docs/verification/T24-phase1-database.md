# T24 Fase 1 — Database: event, kohort, metrik

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `6047ce7`; commit implementasi: `adca357` (`feat(t24): add product events, pilot cohort and pilot metrics`)
- Persetujuan checkpoint Fase 0: pengguna ("Setuju semua", 10 Oktober 2026), termasuk jawaban T2 (jumlahkan hanya experience, education, certification, achievement).

## Tujuan dan file berubah

| File | Perubahan |
| --- | --- |
| `supabase/migrations/20261011090000_t24_product_events.sql` | baru: tiga tabel `internal`, dua validator, recorder, enam fungsi trigger, sepuluh trigger, dua RPC service-role |
| `supabase/tests/database/product_events.test.sql` | baru: 134 assertion pgTAP |
| `src/server/supabase/database.types.ts` | `pnpm db:types`: tepat dua fungsi `public` baru (`get_pilot_metrics`, `set_pilot_participant`), 24 baris tambah, tanpa hapus |

Tidak ada fungsi T02–T23, worker, UI, atau test lama yang diubah.

## TDD

1. Test ditulis lebih dulu. Dijalankan sebelum migration: **gagal** (`relation "internal.product_events" does not exist`, test 1–2 gagal).
2. Migration diterapkan dengan `pnpm exec supabase migration up --local` (exit 0, satu file diterapkan).
3. Test hijau setelah dua perbaikan pada test sendiri (bukan pada produk):
   - `remove_cv_item` butuh argumen ketiga `p_remove_children`;
   - suffix UUID fixture harus heksadesimal (diganti `md5(...)::uuid`);
   - `profiles_touch_mutable_row` memaksa `created_at := old.created_at`, sehingga fixture jendela metrik tidak dapat memundurkan `created_at`. Test menonaktifkan trigger itu **di dalam transaksi test** (`alter table … disable trigger`, ikut rollback). Perilaku produksi tidak berubah.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm exec supabase test db supabase/tests/database/product_events.test.sql` | exit 0, **134 assertion**, `Result: PASS` |
| `pnpm db:test` | exit 0, **18 file / 1573 assertion** (1439 + 134), `Result: PASS`; tidak ada test lama yang gagal atau diubah |
| `pnpm db:lint` | exit 0, `results: []` untuk skema `extensions`, `internal`, `public` |
| `pnpm db:types` (ke berkas sementara, lalu disalin) | diff hanya dua fungsi, lihat atas |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `supabase migration list --local` | **34/34**, semua `local = remote`, terakhir `20261011090000` |

## Isi migration

- **Tabel.** `internal.product_events` (kolom persis enam: `id`, `user_id`, `event_name`, `occurred_at`, `local_date`, `properties`; CHECK nama event dan `internal.product_event_properties_valid`; indeks `(user_id, event_name, occurred_at)`), `internal.product_event_epoch` (satu baris dijaga indeks unik `((true))`, diisi `clock_timestamp()` saat migration), `internal.pilot_participants`. FK ke `public.profiles(id) on delete cascade`. RLS aktif, semua privilege (tabel dan sequence) dicabut dari `public`, `anon`, `authenticated`, `service_role`.
- **Validator.** Allowlist kunci per event, enum, dan bilangan bulat berbatas. Menolak kunci tak dikenal, string bebas, ID, pecahan, string-sebagai-angka, error code di luar delapan kode `fail_cv_export`, sukses dengan error code, dan `origin` pada non-achievement. `coalesce(…, false)` sehingga hasil NULL tidak lolos CHECK.
- **Recorder.** `internal.record_product_event` (`security definer`, `search_path = pg_catalog`) membaca `profiles.timezone` tanpa lock, menulis `local_date = (clock_timestamp() at time zone timezone)::date`, tidak menulis apa pun bila profil tidak ada. Tidak ada `exception when others`.
- **Trigger** (10, semua `AFTER … FOR EACH ROW`, nama `product_event_*`):
  - `product_event_activity_saved` pada `activities` (insert);
  - `product_event_career_record` pada `projects`, `experiences`, `education`, `certifications` (insert) dan, dengan fungsi yang menambah `origin`, pada `achievements`;
  - `product_event_confirmed_achievement_insert` (insert, `new.status = 'confirmed'`) dan `product_event_confirmed_achievement_update` (`update of status`, `new.status = 'confirmed' and old.status is distinct from 'confirmed'`);
  - `product_event_import_committed` pada `import_batches` (`update of status`, ke `committed`);
  - `product_event_cv_export_finished` pada `cv_exports` (`update of status`, `old.status = 'running'` ke `succeeded`/`failed`).
- **RPC.** `set_pilot_participant` dan `get_pilot_metrics`, `security definer`, hanya `service_role`, `comment on function` berlabel `T24`.

### Keputusan implementasi di dalam kontrak beku

| Hal | Keputusan | Alasan |
| --- | --- | --- |
| Penjumlahan `import_committed` (T2 Fase 0) | hanya `experience`, `education`, `certification`, `achievement` | sesuai persetujuan pengguna dan §2.4.3 |
| Dua trigger konfirmasi | satu INSERT, satu UPDATE OF status | klausa `WHEN` pada trigger INSERT tidak boleh merujuk `OLD` |
| Fungsi trigger | enam fungsi (`activity_saved`, `career_record`, `achievement_created`, `achievement_confirmed`, `import_committed`, `cv_export_finished`) | fungsi `career_record` generik tidak membaca `origin`, yang hanya ada di `achievements` |
| Kode error tambahan | `22023 INVALID_PILOT_PARTICIPANT` untuk argumen null atau versi persetujuan di luar pola | plan tidak menyebut perilaku ini; tanpa kode ini hasilnya `23514` mentah dari CHECK. Empat kode bernama di §2.2.7 tidak berubah. **Mohon reviewer mengonfirmasi penambahan ini.** |
| Normalisasi trigger export | `error_code` di luar allowlist menjadi `null`, `attempt` dijepit ke 1–10, `page_count` di luar 1–20 menjadi `null`, jumlah import dijepit ke 1000 | trigger membentuk datanya sendiri (§2.2.1) sehingga baris fixture yang janggal tidak menggagalkan transaksi domain; CHECK tetap menolak penyisipan langsung yang melanggar |
| `set_pilot_participant` untuk penarikan | tidak memvalidasi `p_consent_version` | versi hanya bermakna saat mendaftar |
| Penarikan akun berstatus `deleting` | `PILOT_ACCOUNT_UNAVAILABLE` | urutan cek §2.2.7: akun tersedia lebih dulu |

## Acceptance yang terbukti di fase ini (pgTAP)

| §1 | Bukti |
| --- | --- |
| 1 Event per jalur | activity note/form/chat; experience, education, certification, project, achievement (manual, activity, import); `achievement_confirmed` (confirm; edit confirmed, reopen, CV select/remove, update activity/project, skill: nol event); import commit (satu `import_committed` dengan `{created:3, mapped:1, skipped:1, confirmed_achievements:1}` dan tiga `career_record_created`); export succeeded, failed, retry-sukses, `ACCOUNT_DELETING`, `EXPORT_TIMEOUT` |
| 2 Atomik, idempotent | `STALE_REVISION` pada `save_achievement`, `IMPORT_ITEM_INVALID` pada import: hitungan event tidak berubah; `create_activity_idempotent` kunci sama dan commit import kedua: tidak menambah event; completion export ulang `stale`: tidak menambah event |
| 3 Metadata minimal | enam kolom saja; 18 percobaan insert langsung (kunci ID, teks bebas, kunci tak dikenal, tipe salah, di luar rentang, error code di luar allowlist, enum salah) ditolak `23514`; tidak ada sentinel dan tidak ada UUID di properti semua event; `local_date` mengikuti zona profil (zona dipilih agar tanggalnya berbeda dari UTC pada jam berapa pun) |
| 4 Tanpa akses klien | tidak ada privilege tabel/sequence untuk tiga role; dua RPC hanya `service_role`; fungsi internal tanpa grant. Pembuktian lewat PostgREST menyusul di Fase 2 |
| 5 Kohort | empat kode error, idempotensi, pembaruan versi tanpa mengubah `enrolled_at`, penarikan final dan idempoten, akun sebelum epoch ditolak, akun `deleting` ditolak |
| 6 Activation | 23:59:59 masuk, 24:00:00 tidak; `import_committed` perlu `created + mapped > 0`; jendela terbuka = `pending`, bukan gagal |
| 7 Value completion | batas 7 hari eksklusif; ekspor gagal tidak dihitung; tidak ada konfirmasi tidak dihitung; jendela terbuka `pending` |
| 8 Return capture | Minggu–Senin = dua minggu, Senin–Minggu = satu; `local_date` menentukan (bukan UTC); batas 28 hari eksklusif; tiga minggu lolos |
| 9 Export reliability | gagal lalu sukses = 1/2; `ACCOUNT_DELETING` dikeluarkan; `pending` selalu 0 |
| 10 Laporan jujur | empat baris, `rate` NULL saat `eligible = 0`, target 0.60/0.40/0.30/0.98, `cohort_size` |
| 11 Cascade | `delete from auth.users` menghapus event dan peserta; akun lain utuh (akun uji tanpa experience/project, lihat T4 Fase 0). Pembuktian lewat jalur T23 penuh menyusul di Fase 2 |
| 5 (non-kohort) | akun tak terdaftar dan peserta yang menarik diri yang memenuhi semua ukuran tidak terhitung |

## Belum terbukti di fase ini

- Penolakan `authenticated`/`anon` lewat PostgREST sungguhan dan event lewat service TypeScript nyata (Fase 2).
- Cascade lewat jalur T23 penuh dengan akun berpopulasi (Fase 2).
- Overhead trigger pada p95 simpan (Fase 5).

## Blocker dan catatan

- Tidak ada stop condition §8 yang terpicu. Tidak ada test lama yang gagal atau diubah; tidak ada daftar trigger yang dikunci persis.
- Satu hal untuk reviewer: kode `INVALID_PILOT_PARTICIPANT` (tabel di atas).

## Langkah berikutnya

Fase 2: `tests/integration/product-events.test.ts` dan script `test:integration:product-events`.

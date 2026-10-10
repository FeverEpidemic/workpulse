# Decision 0030: T24 instrumentasi dan performa

Date: 10 Oktober 2026

Status: Accepted (acceptance lokal, 10 Oktober 2026). Task: T24 (PRD §4 *Performance targets* dan *Privacy*, §5 *Pilot measures*; rencana M5). [Rencana](../verification/T24-implementation-plan.md), [bukti](../verification/T24-instrumentation-performance.md), [gate review](../verification/T24-gate-review.md), [runbook metrik pilot](../verification/T24-pilot-metrics-runbook.md).

## References

- **PRD §4** *Performance targets*: pada dataset 1.000 activities, 200 achievements, dan 50 projects, p95 baca dashboard dan list di bawah 2 detik, dan save di bawah 1 detik, tanpa network dan AI. *Privacy*: akses owner-scoped di setiap tabel.
- **PRD §5** *Pilot measures*: event tanpa teks catatan, teks CV, nama file, atau isi lampiran. Activation 24 jam, Value completion 7 hari, Return capture 28 hari, Export reliability. Target adalah hipotesis yang ditinjau setelah 20 pengguna pilot pertama yang memberi persetujuan.
- **Implementation plan:** blok T24 (M5) dan Gate M5 (target pilot dievaluasi dari pilot, bukan syarat sebelum pilot).
- **Decision terkait:** 0029 (purge akun dan tombstone profil), 0027 (state export), 0022/0023 (import commit).
- **Receipt:** `docs/verification/T24-phase0-baseline.md` sampai `T24-phase6-regression.md`, hasil mentah `T24-perf-results.json`.

## Context

Sebelum T24, WorkPulse tidak mencatat event produk, jadi keempat ukuran pilot PRD tidak dapat dihitung. Target performa PRD juga belum pernah diukur pada dataset yang disepakati.

T24 menambah satu migration forward-only (parity 33 ke 34), satu suite pgTAP (134 assertion), satu suite integration, dan satu suite perf. Tidak ada perubahan UI, worker, i18n, atau fungsi RPC T02-T23. Satu-satunya perubahan di `src/` adalah tipe `database.types.ts` untuk dua RPC baru.

Pengguna menyetujui delapan keputusan produk §2.4 handoff pada 10 Oktober 2026 ("Setuju semua"):

1. Event dicatat untuk semua akun, tetapi ukuran hanya dihitung untuk kohort yang didaftarkan operator.
2. Tidak ada perubahan UI. Peserta pilot mendapat penjelasan lewat formulir persetujuan pilot di luar aplikasi.
3. Record karier manual untuk Activation adalah activity, achievement, project, experience, education, dan certification. Import commit dihitung bila `created + mapped > 0`.
4. Semua jendela dihitung dari `profiles.created_at`.
5. Minggu adalah minggu kalender ISO (mulai Senin) di zona waktu profil saat save.
6. Export reliability dihitung per transisi terminal. Kegagalan `ACCOUNT_DELETING` dikeluarkan.
7. Event dan baris peserta ikut terhapus bersama akun.
8. Event disimpan selama akun ada. Kebijakan retensi diputuskan setelah pilot.

## Keputusan

1. **Event lewat trigger `AFTER` di tabel kanonis.** Sepuluh trigger `product_event_*` di delapan tabel (`activities`, `achievements`, `projects`, `experiences`, `education`, `certifications`, `import_batches`, `cv_exports`) memanggil `internal.record_product_event`.
   - *Alasan:* jalur tulisnya berbeda-beda. Ada RPC service, import commit T16, apply AI T14, dan `complete_cv_export`/`fail_cv_export_locked` dari worker T21. Mengedit setiap fungsi berisiko ada yang terlewat dan mengubah fungsi lama. Trigger menangkap semua jalur, berjalan di transaksi domain (rollback ikut membatalkan event), dan tidak mengubah fungsi T02-T23.
   - Trigger tidak meredam error. Bila CHECK event gagal, transaksi domain gagal. Di dalam import commit, handler T16 mengubah kegagalan itu menjadi error commit, bukan sukses diam-diam.
2. **Lima event dengan properti allowlist.**

   | Event | Kapan | Properti |
   | --- | --- | --- |
   | `activity_saved` | insert `activities` | `capture_mode` |
   | `career_record_created` | insert achievement, project, experience, education, certification | `record_type`, `origin` (achievement saja) |
   | `achievement_confirmed` | insert berstatus `confirmed`, atau update `status` dari selain `confirmed` | `origin` |
   | `import_committed` | `import_batches` berpindah ke `committed` | `created`, `mapped`, `skipped`, `confirmed_achievements` (0-1000) |
   | `cv_export_finished` | `cv_exports` dari `running` ke `succeeded` atau `failed` | `outcome`, `error_code`, `attempt` (1-10), `page_count` (1-20) |

   `internal.product_event_properties_valid` dipakai sebagai CHECK. Fungsi itu menolak kunci di luar daftar, tipe yang salah, string bebas, dan bilangan pecahan atau di luar rentang. Daftar `error_code` sama persis dengan allowlist `fail_cv_export` T21. Tidak ada ID record, teks, nama file, email, atau correlation ID. Skill bukan record karier, dan edit record tidak menghasilkan event.
3. **Hitungan import hanya dari record karier.** `import_committed` menjumlahkan `experience`, `education`, `certification`, dan `achievement` dari `commit_result.counts`. `profile` dan `skill` tidak dihitung (keputusan produk 3).
4. **`local_date` dari zona waktu profil saat event.** Recorder membaca `profiles.timezone` tanpa lock.
5. **Epoch instrumentasi.** `internal.product_event_epoch` berisi satu baris yang diisi saat migration diterapkan. Akun yang dibuat sebelum epoch tidak punya event sejak hari pertama, jadi tidak dapat didaftarkan ke kohort.
6. **Kohort `internal.pilot_participants`** diisi operator lewat `public.set_pilot_participant` (hanya `service_role`). Penarikan diri bersifat final. Kode error: `PILOT_ACCOUNT_UNAVAILABLE`, `PILOT_ACCOUNT_PREDATES_INSTRUMENTATION`, `PILOT_PARTICIPANT_WITHDRAWN`, `PILOT_PARTICIPANT_UNKNOWN`, semuanya `22023`. Pelaksana menambah `22023 INVALID_PILOT_PARTICIPANT` untuk input null atau versi persetujuan yang tidak cocok pola. Tanpa kode itu, input buruk akan jatuh ke CHECK `23514` yang kurang jelas. Reviewer menerima penambahan ini (gate review G3).
7. **`public.get_pilot_metrics(p_as_of)`** (hanya `service_role`) mengembalikan empat baris: `activation`, `value_completion`, `return_capture`, `export_reliability`. Setiap baris berisi `cohort_size`, `eligible`, `achieved`, `pending`, `rate` (NULL bila `eligible = 0`, dibulatkan empat desimal), dan `target` (0,60 / 0,40 / 0,30 / 0,98).
   - Jendela adalah `[created_at, created_at + N)`. Event di detik terakhir masuk, event tepat di batas tidak.
   - Akun yang jendelanya belum selesai masuk `pending`, bukan dihitung gagal. Value completion dan return capture hanya menghitung akun yang sudah teraktivasi, jadi `pending` keduanya berisi akun teraktivasi yang jendela 7 atau 28 harinya masih terbuka.
   - Export reliability menghitung setiap event `cv_export_finished` kohort sampai `p_as_of`, kecuali `ACCOUNT_DELETING`. Gagal lalu retry sukses dihitung 1 dari 2. `pending` selalu 0.
8. **Tidak dapat diakses klien.** Ketiga tabel internal punya RLS aktif dan tidak punya privilege untuk `anon`, `authenticated`, maupun `service_role`. Kedua RPC hanya dapat dieksekusi `service_role`.
9. **Penghapusan akun lewat FK cascade.** Event dan baris peserta mereferensikan `public.profiles(id) on delete cascade`, sehingga ikut hilang saat `deleteUser` menghapus tombstone profil (decision 0029). Fungsi T23 tidak diubah, dan tidak ada event `account_deleted` (event itu akan langsung ikut terhapus). Observability penghapusan tetap memakai `get_account_deletion_backlog`.
10. **Tidak ada migration indeks.** Query plan Fase 4 tidak memenuhi kriteria §2.2.12 handoff. Query halaman memakai indeks yang sudah ada atau membaca tabel kecil milik satu akun dalam waktu di bawah 3 ms. Satu-satunya Seq Scan pada tabel di atas 1.000 baris adalah `exists (select 1 from activities ...)` di `get_dashboard_summary`, yang berhenti di baris pertama dalam 0,007 ms. Indeks baru tidak akan mengubah pilihan planner itu.
11. **Performa diukur di lapisan service.** Suite `pnpm test:perf` men-seed akun P dan Q lewat RPC pengguna dengan klaim JWT di psql (trigger dan constraint aktif), menjalankan `analyze`, lalu mengukur layanan `src/features/*` lewat client `authenticated` nyata ke Kong/PostgREST loopback. Setiap operasi punya 50 sampel warm setelah 5 pemanasan, dengan urutan acak ber-seed tetap dan p95 nearest-rank. Hasilnya ditulis ke `T24-perf-results.json`.

## Hasil performa

Pada run pelaksana (file hasil), p95 baca tertinggi 162,2 ms dan p95 simpan tertinggi 198,4 ms. Pada run ulang reviewer, angkanya 192,4 ms dan 91,9 ms. Target PRD adalah 2.000 ms untuk baca dan 1.000 ms untuk simpan. Fase 4 membandingkan p95 sebelum dan sesudah trigger aktif, dan tidak ada kenaikan p50 yang dapat diatribusikan ke trigger. Waktu operasi didominasi hop HTTP dan `auth.getUser()` (sekitar 75 ms per panggilan).

Batas metode: satu mesin pengembangan (Windows, Docker Desktop/WSL2), satu pengguna tanpa konkurensi, loopback, tanpa evidence, dan sampel cold tanpa pengosongan buffer PostgreSQL. Angka ini tidak membuktikan target di layanan hosted. Pengukuran itu milik T25.

## Batas definisi yang diterima

- **Draft achievement kosong menghitung Activation.** `create_achievement_idempotent` membuat baris draft tanpa isi, dan trigger insert mencatat `career_record_created` untuk baris itu. Akibatnya, satu klik "achievement baru" sudah memenuhi "menyimpan satu record karier manual". Ini sesuai §1.1 dan keputusan produk 3. Pengguna menerima batas ini untuk pilot pada 10 Oktober 2026 (gate review G2). Bila angka Activation tampak terlalu tinggi, penajaman definisi (misalnya achievement dihitung saat simpan pertama yang berisi) adalah perubahan kontrak di task lanjutan.
- **Laporan untuk tanggal lampau tidak sepenuhnya point-in-time.** Status teraktivasi tidak dibatasi `occurred_at <= p_as_of`. Untuk `p_as_of` di masa lalu, `pending` value completion dan return capture dapat ikut menghitung akun yang baru teraktivasi sesudah `p_as_of`. `eligible`, `achieved`, dan `rate` tidak terpengaruh, dan laporan dengan `now()` benar. Perbaikannya butuh migration baru, jadi dicatat sebagai follow-up (gate review G1).
- **`local_date` pada import yang menyelesaikan onboarding.** Import commit T16 memperbarui `profiles.timezone` setelah record diinsert. Event `career_record_created` dari import itu memakai zona lama (default `UTC`). Tidak ada ukuran yang membaca `local_date` event itu, karena return capture hanya memakai `activity_saved` (gate review G6).

## Alternatif yang ditolak

- **Event di setiap RPC.** Lebih banyak fungsi lama yang berubah, dan jalur yang terlewat tidak terdeteksi.
- **SDK analitik pihak ketiga atau event dari browser.** Data keluar dari database owner-scoped, butuh banner consent, dan dapat membawa URL atau teks halaman.
- **Event hanya untuk akun terdaftar.** Aktivitas sebelum pendaftaran akan hilang, sehingga jendela 24 jam sering tidak terukur.
- **Toggle consent analitik di aplikasi.** Butuh UI, copy, versi persetujuan, dan E2E. Itu lebih cocok untuk rilis publik.
- **Event `account_deleted`.** Baris itu akan langsung terhapus oleh cascade yang sama.
- **Purge event berkala di T24.** Kebijakan retensi diputuskan bersama hasil pilot.

## Seam ke task berikutnya

- **T25:** pengukuran performa di staging atau hosted, performa yang dirasakan browser, alert backlog penghapusan dan cleanup, dan kalimat pemberitahuan event di detail privasi S12 bersama copy rilis.
- **Pasca-pilot:** retensi atau agregasi event, peninjauan target setelah 20 peserta, dan definisi Activation bila draft kosong terbukti mengganggu.
- **Follow-up:** batas `p_as_of` di `get_pilot_metrics` (G1), loop N+1 di `get_cv_review_summary`, dan `loadSkills` tanpa batas di `achievement-service.ts` (G7).

## Gate review

Gate review Claude (Opus) pada `0f5aeeb` tidak menemukan P0-P2 ([T24-gate-review.md](../verification/T24-gate-review.md)). Reviewer menjalankan ulang pgTAP, suite integration T24 dan suite yang disentuh trigger, serta `test:perf`, dan menghitung ulang p95 dari sampel mentah. Ada delapan temuan P3. G2 diterima pengguna, sedangkan G1 dan G7 menjadi follow-up.

## Perubahan pada test lama

Tidak ada. Seluruh suite T02-T23 dan Gate M2/M3/M4 lulus tanpa perubahan (receipt Fase 6). Fixture pgTAP T24 menonaktifkan `profiles_touch_mutable_row` di dalam transaksi test agar `created_at` dapat dimundurkan. Perubahan itu ikut rollback dan tidak mengubah perilaku produksi.

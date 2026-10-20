# Decision 0032: Batas pemakaian AI per akun untuk pilot

Date: 18 Oktober 2026

Status: Accepted. Angka disetujui pengguna pada 18 Oktober 2026 (keempat rekomendasi). Konteks: pilot gratis November 2026 dengan pendaftaran terbuka tanpa waitlist dan tanpa batas kursi (dipromosikan lewat Instagram Reel). Billing tetap di luar scope v0.1; keputusan ini hanya menyiapkan kaitan ke paket.

## References

- **PRD §2** R05 (deteksi AI opsional, jalur manual tetap berfungsi), flow F01 (import) dan F02 (assisted capture), screen S02 dan S06; **PRD §4** *Failures*.
- **Decision terkait:** 0019 (T13 jobs dan consent; `AI_RATE_LIMITED` tetap berarti 409/429 dari provider), 0029 (penghapusan akun).
- **Receipt:** [`docs/verification/ai-usage-limits.md`](../verification/ai-usage-limits.md).

## Context

Setiap akun baru dapat memicu job AI atas biaya pemilik. Sebelum keputusan ini satu-satunya batas adalah `AI_RATE_LIMITED`, yaitu pemetaan HTTP 429/409 dari provider. Tidak ada kuota per akun, sehingga pendaftaran terbuka tidak membatasi biaya provider.

## Keputusan

1. **Satu unit = satu attempt provider yang diantrekan.** Yang dibebankan: job `detect` baru (`request_ai_analysis`), job `refine` baru (`answer_ai_questions`), `retry_ai_job`, batch baru (`begin_import_batch`), dan `retry_import_batch`. Replay idempotent tidak dibebankan.
2. **Dua bucket per akun, jendela kalender UTC.** `analysis` (detect, refine, retry) **20/hari, 200/bulan**; `import` **3/hari, 5/bulan**.
3. **Kapasitas bersama 2.000 unit/hari** untuk semua akun yang paketnya dihitung ke kapasitas.
4. **Ditegakkan di database, atomik.** `internal.charge_ai_usage` menambah counter dengan upsert bersyarat (`... on conflict do update ... where units < limit`) dalam transaksi yang sama dengan penulisan job. Jika ditolak, RPC raise `AI_QUOTA_EXCEEDED` (akun) atau `AI_CAPACITY_EXCEEDED` (bersama) dan tidak ada job, batch, atau unit yang tersisa. Urutan lock: hari akun, bulan akun, hari bersama.
5. **Refine yang ditolak tidak menggagalkan jawaban.** Seperti consent yang tidak ada, `answer_ai_questions` tetap menyimpan jawaban dan mengembalikan `job_id` null.
6. **Import dibebankan saat `begin_import_batch`**, sebelum upload, supaya pengguna tahu sebelum mengirim file. Parse yang gagal sebelum AI tetap memakai satu unit; ini diterima demi kesederhanaan.
7. **Kaitan paket.** `internal.ai_plans` (NULL = tanpa batas) dan `internal.ai_plan_assignments` (operator, lewat SQL). Akun tanpa baris memakai `free`. Paket `unlimited` untuk akun operator dan fixture test, di luar kapasitas bersama. Billing nanti cukup mengubah `internal.ai_plan_for`. Angka dapat diubah dengan `UPDATE` tanpa migration.
8. **Read model.** `public.get_ai_usage()` (authenticated) mengembalikan pemakaian pemilik per bucket, jendela yang memblokir (`monthly`, `daily`, `capacity`), dan waktu reset. Angka pemakaian bersama tidak diekspos.
9. **UI.** S06 mengganti *Analyze with AI* (atau *Retry*) dengan pemberitahuan batas, waktu reset dalam timezone profil, dan *Create achievement manually*. S02 mengganti area unggah (atau *Retry*) dengan pemberitahuan batas dan menjadikan *Start manually* aksi utama. Action yang tetap kalah balapan menerima `RATE_LIMITED` dan panel memuat ulang usage.
10. **Privasi.** Counter tidak berisi konten dan ikut terhapus ketika user Auth dihapus (FK ke `profiles` dengan cascade). Tabel berada di `internal` tanpa grant API.

## Konsekuensi

- Suite yang menguji mekanik job (bukan kuota) memasang fixture-nya ke paket `unlimited` (`tests/integration/ai-usage-support.ts`, `import_staging.test.sql`), supaya run lokal berulang tidak tersandung batas harian atau kapasitas bersama.
- Kegagalan provider tetap memakai unit; retry dibatasi tiga attempt (T13), sehingga outage maksimal menghabiskan tiga unit per job.
- Kapasitas bersama adalah satu baris per hari; setiap charge memegang lock-nya sampai transaksi RPC selesai. Pada skala pilot ini cukup; ukur ulang sebelum production.

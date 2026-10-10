# T23 Runbook retensi dan penghapusan akun

Dokumen ini menjelaskan cara memeriksa penghapusan akun dan retensi data, apa yang terbukti lokal, dan apa yang belum terverifikasi. Tidak ada perintah di sini yang membaca isi karier pengguna.

- Tanggal: 10 Oktober 2026
- Status: draft untuk gate review
- Terkait: [decision 0029](../decisions/0029-t23-account-deletion-retention.md), [laporan T23](T23-account-deletion-retention.md)

## 1. Status klaim

| Klaim | Status | Bukti atau tindakan |
| --- | --- | --- |
| Sesi dicabut seketika saat penghapusan dimulai | **Terbukti lokal** | integration dan E2E dua konteks; sisa risiko access token sampai `exp` dicatat di decision |
| Penulisan oleh akun `deleting` ditolak di database | **Terbukti lokal** | pgTAP (katalog trigger) dan integration (16 RPC) |
| Baris akun dan objek dihapus ≤ 24 jam | **Terbukti lokal hanya sebagai mekanisme** | requested → completed 1,9 detik di stack lokal; pada hosted harus diukur dengan query backlog (bagian 2) |
| Antrean cleanup bertahan setelah FK dihapus dan worker restart tidak kehilangan pekerjaan | **Terbukti lokal** | pgTAP dan integration crash di tiga titik |
| File import dan teks staging dihapus ≤ 24 jam setelah terminal | **Terbukti lokal** | pgTAP dan integration (batch review idle) |
| Backup berisi data pengguna kedaluwarsa ≤ 30 hari | **Belum terverifikasi** | kebijakan di copy S12; diverifikasi di T25 (bagian 3) |
| Penghapusan diterapkan ulang setelah restore backup | **Belum dirancang penuh** | bagian 4; butuh ledger di luar database (T25) |

Aturan: klaim *Belum terverifikasi* tidak boleh dikutip sebagai janji produk sebelum bagian 3 dan 4 dijalankan pada layanan hosted.

## 2. Memeriksa penghapusan ≤ 24 jam

Jalankan sebagai owner database atau lewat role service. Kolom di bawah tidak memuat email, nama, atau teks.

Backlog (jumlah yang belum selesai dan yang lewat 24 jam):

```sql
select pending, overdue from public.get_account_deletion_backlog();
```

Target: `overdue = 0` sepanjang waktu. Nilai `overdue > 0` adalah alert T25.

Receipt yang tertahan, dengan penyebab dari kode error terakhir:

```sql
select user_id, status, requested_at, attempt_count, last_error_code,
       rows_purged_at, auth_deleted_at
from internal.account_deletions
where status <> 'completed'
order by requested_at;
```

Cara membaca:

| Status | Arti | Tindakan bila lama |
| --- | --- | --- |
| `queued` | menunggu claim atau jadwal retry (`next_attempt_at`) | pastikan worker berjalan; lihat `last_error_code` |
| `running` | sedang diproses; lease 120 detik | lease habis otomatis di-claim ulang |
| `purged` | baris dan user Auth sudah terhapus; menunggu objek dan job cleanup | periksa job cleanup di bawah |
| `completed` | prefix Storage kosong dan tidak ada job terbuka | dipangkas setelah 30 hari |

Job cleanup yang masih terbuka untuk satu akun:

```sql
select status, count(*), min(created_at)
from internal.storage_jobs
where user_id = '<user_id>'::uuid and status in ('queued', 'running', 'failed')
group by status;
```

Job `failed` dikembalikan ke antrean oleh purge atau oleh reconcile kategori (evidence, import, export). Objek non-kanonis di prefix `<user_id>/` tidak dapat diantrekan dan menahan receipt di `purged`; hapus lewat Storage API setelah memeriksa kuncinya, lalu jalankan pass worker.

Kode error yang mungkin muncul: `ACCOUNT_PURGE_FAILED`, `AUTH_DELETE_FAILED`, `WORKER_BACKEND_UNAVAILABLE`. Penghapusan tidak berhenti diam-diam: retry tanpa batas attempt dengan backoff 1, 5, 15, 60 menit, lalu 60 menit.

## 3. Memeriksa retensi backup ≤ 30 hari (hosted, T25)

Status saat ini: **belum terverifikasi**. Sebelum menyatakan klaim ini terbukti:

1. Catat paket dan jenis backup proyek Supabase hosted (backup harian atau PITR) dari dashboard proyek, bagian Database → Backups.
2. Catat retensi yang tertulis untuk paket itu dari dokumentasi resmi Supabase **beserta tanggal akses** dan tautannya. Jangan menyalin angka dari dokumen ini.
3. Bandingkan dengan 30 hari. Bila retensi paket lebih panjang, ubah copy S12 (`account.delete.privacy`) atau konfigurasi sebelum rilis; bila PITR menyimpan lebih lama, tidak ada klaim 30 hari yang sah.
4. Simpan hasilnya (paket, retensi, tanggal akses, siapa yang memeriksa) di `docs/verification/` pada dokumen T25.

## 4. Menerapkan ulang penghapusan setelah restore (rancangan awal, T25)

Restore ke titik sebelum suatu penghapusan memulihkan akun itu **beserta** receipt yang hilang dari titik itu. Receipt di database bukan sumber yang aman untuk memutar ulang penghapusan setelah restore.

Rancangan yang perlu dikerjakan di T25:

1. Sebelum restore, ekspor daftar user id yang dihapus sejak titik restore dari ledger di luar database (mis. penyimpanan append-only berisi hanya UUID dan `completed_at`). Ledger ini belum ada.
2. Setelah restore, untuk setiap user id di ledger: panggil `begin_account_deletion(user_id)` sebagai service role, lalu biarkan worker menyelesaikannya.
3. Verifikasi dengan bagian 2 sampai `overdue = 0`.

Sampai ledger itu ada, restore backup produksi tidak boleh dilakukan tanpa persetujuan eksplisit pemilik produk.

## 5. Retensi lain yang diperkenalkan T23

| Data | Aturan | Pemeriksaan |
| --- | --- | --- |
| Batch import `review` yang ditinggalkan | dibatalkan setelah 30 hari tanpa perubahan batch atau item (`expire_abandoned_import_reviews`); file dan teks dihapus ≤ 24 jam kemudian oleh purge T15 | `select status, purged_at from public.import_batches where status = 'review' and updated_at < now() - interval '30 days'` harus kosong setelah satu pass |
| Snapshot export sukses | dikosongkan saat PDF dipurge (24 jam setelah sukses) | `select count(*) from public.cv_exports where purged_at is not null and snapshot_purged_at is null` harus 0 untuk export yang dipurge sesudah migration T23; baris yang dipurge sebelumnya (hanya database pengembangan) tidak otomatis dikosongkan |
| Snapshot export gagal | dikosongkan 24 jam setelah `finished_at` | `select count(*) from public.cv_exports where status = 'failed' and finished_at < now() - interval '24 hours' and snapshot_purged_at is null` harus 0 setelah satu pass |
| Receipt penghapusan `completed` | dipangkas setelah 30 hari | `select count(*) from internal.account_deletions where status = 'completed' and completed_at < now() - interval '30 days'` harus 0 setelah satu pass |

## 6. Menjalankan pass secara manual

```powershell
pnpm worker:once
```

Satu pass menjalankan verify dan prune receipt, claim penghapusan, import, export, evidence, dan AI. Keluaran hanya angka dan kode.

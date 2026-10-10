# T23 Account deletion dan retention — laporan verifikasi (draf)

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- Status dokumen: **DRAFT untuk gate review.** Bukan verdict dan bukan penandaan DONE. `IMPLEMENTATION_STATUS.md` tidak diubah.
- HEAD yang diuji: `56ff182` (kode), `93b0861` (receipt Fase 8). HEAD Fase 0: `7e874b6`.
- Independensi: seluruh fase dan pemeriksaan di dokumen ini dikerjakan oleh agen yang sama. Tidak ada gate review independen (Opus) yang berjalan; temuan reviewer dapat mengubah status baris mana pun di bawah.
- Gate M4: belum memiliki verdict saat T23 dimulai; mulai berdasarkan perintah ulang pengguna ("Coba Eksekusi ulang Plan T23").

Rujukan: [handoff](T23-implementation-plan.md), [decision 0029](../decisions/0029-t23-account-deletion-retention.md), [runbook](T23-retention-runbook.md), receipt fase `T23-phase0-baseline.md` sampai `T23-phase8-regression.md`, screenshot `T23-screenshots/`.

## Ringkasan

| Item | Hasil |
| --- | --- |
| Pass | seluruh 44 command regresi §7 exit 0 (Fase 8) |
| Tidak dijalankan | tidak ada |
| Warning | keluaran `[WebServer] ... stream closed early` selama `test:e2e:cv-export` (unduhan PDF diputus browser), tidak menggagalkan test dan bukan bagian T23 |
| Fail | tidak ada pada HEAD akhir. Dua kegagalan selama pengerjaan sudah diperbaiki: dua suite pgTAP lama yang gagal oleh guard (kondisi guard dipersempit) dan dialog yang menempel di pojok (CSS) |
| Angka | unit 113 file / 1034; pgTAP 17 file / 1439; integration account-deletion 14, cv-export 35, import 21, evidence 14, storage 1; E2E account-deletion 7, cv-export 12 |

## Trace ke sumber

| Sumber | Butir | Bukti |
| --- | --- | --- |
| PRD R01 | akun lain tidak dapat membaca atau mengubah record atau file | pgTAP isolasi (akun lain tidak berubah), integration §1.14, E2E akun lain |
| PRD *Deletion* | sesi dicabut seketika | integration sesi, E2E dua konteks |
| PRD *Deletion* | data aktif dan objek dihapus ≤ 24 jam | mekanisme terbukti lokal (1,9 detik); target hosted diukur dengan backlog (runbook §2) |
| PRD *Deletion* | backup kedaluwarsa ≤ 30 hari | **belum terverifikasi** (runbook §3, T25) |
| PRD *Data minimization* | file import dan teks staging ≤ 24 jam setelah terminal | pgTAP dan integration batch review |
| PRD *Failures* | job durable | pgTAP claim, lease, CAS; integration crash di tiga titik |
| Wireframe S12 | reautentikasi dan konfirmasi kehilangan data yang jelas | E2E keyboard |
| Wireframe S12 | penjelasan retensi backup di detail privasi | copy `account.delete.privacy`; klaim 30 hari adalah kebijakan |
| DB §4 | antrean cleanup tanpa FK bertahan sampai penghapusan objek terverifikasi | pgTAP dan integration (`storage_jobs` bertahan setelah FK hilang) |
| DB §6 *Delete account* | tandai deleting, tolak tulisan, antrekan semua objek sebelum menghapus baris, worker memeriksa deleting sebelum retry | pgTAP urutan dan rollback; integration §1.7 |
| Rencana §5 T23 | worker restart tidak kehilangan cleanup, akun terhapus tidak dapat me-retry job, antrean bertahan setelah FK dihapus, bukti retensi tercatat | integration crash, §1.7, pgTAP §1.10, runbook |

## Acceptance §1

| # | Butir | Status | Bukti |
| --- | --- | --- | --- |
| 1 | Entry dan reautentikasi | Terbukti | unit service dan reauth; integration Auth nyata; E2E password salah |
| 2 | Konfirmasi kehilangan data | Terbukti | unit domain dan state; E2E email tidak cocok, tombol nonaktif |
| 3 | Mulai penghapusan atomik dan idempotent, hanya service role | Terbukti | pgTAP (grant, idempotent); integration B tidak dapat memanggil RPC |
| 4 | Sesi dicabut seketika | Terbukti dengan sisa risiko | integration dan E2E; access token terbit tetap valid sampai `exp` untuk bacaan (decision 0029) |
| 5 | Tulisan ditolak di database | Terbukti | pgTAP katalog; integration 16 RPC lewat client nyata; layanan memetakan ke `UNAUTHENTICATED` |
| 6 | Unduhan ditolak | Terbukti | integration `get_cv_export_download` dan `get_evidence_file` |
| 7 | Job tidak berjalan untuk akun deleting | Terbukti | integration worker nyata dengan adapter penghitung (nol panggilan) |
| 8 | Objek diantrekan sebelum baris dihapus | Terbukti | pgTAP (urutan, rollback penuh); integration tiga kategori + yatim |
| 9 | Purge lengkap | Terbukti | integration (tabel dari katalog nol, profil dan Auth hilang, prefix kosong, empat timestamp) |
| 10 | Antrean bertahan setelah FK hilang | Terbukti | pgTAP `delete from auth.users` |
| 11 | Worker restart tidak kehilangan pekerjaan | Terbukti | unit; integration tiga titik crash, token lama ditolak |
| 12 | Rekonsiliasi cleanup | Terbukti | pgTAP verify, backlog, prune; integration job `failed` dikembalikan |
| 13 | Bukti retensi tercatat | **Sebagian** | durasi lokal tercatat; runbook ada; status backup *belum terverifikasi* |
| 14 | Isolasi dua akun dan pendaftaran ulang email | Terbukti | integration dan E2E |
| 15 | Batch `review` ditinggalkan | Terbukti | pgTAP, integration, unit, E2E notice S03 |
| 16 | Retensi snapshot export (0027 N2) | Terbukti dengan catatan | pgTAP dan integration; export yang dipurge sebelum T23 tidak dikosongkan (decision 0029) |
| 17 | Retry export dijaga (0028 N4) | Terbukti | pgTAP, unit `export-view`, integration, E2E `cv-export` |
| 18 | Aksesibilitas dan responsive S12 | Terbukti | Axe nol pelanggaran, nol overflow 360/1440 × light/dark, fokus, 12 screenshot |
| 19 | Privasi dan log | Terbukti, dengan tinjauan manual yang disarankan | grep `console.` nol, unit error tanpa password atau email, keluaran worker tanpa sentinel |
| 20 | Tanpa regresi | Terbukti | Fase 8, dengan perubahan assertion lama yang tercatat |

## Penyimpangan dan hal yang perlu diputuskan reviewer

1. Kondisi guard tulis dipersempit ke role DB `authenticated` (decision 0029 keputusan 2).
2. Perubahan assertion lama, semuanya akibat keputusan yang dibekukan: Retry T22 saat CV terblokir, daftar kode error, kolom aman, kunci ringkasan worker.
3. `.ui-dialog { margin: auto }` pada CSS bersama (cacat dialog lama).
4. Dua tabel internal tanpa FK ikut dipurge: `evidence_scan_jobs` dan `evidence_reservation_requests`.
5. Fase 3 ditulis tanpa urutan TDD murni (implementasi service sebelum testnya).
6. Migration kedua dan pertama tidak diedit setelah commit; fungsi guard direvisi sebelum commit pertama dengan `create or replace` yang identik dengan file.

## Belum terbukti atau di luar T23

- Retensi backup ≤ 30 hari dan penerapan ulang penghapusan setelah restore (T25); ledger di luar database belum ada.
- Race guard tulis paralel (argumen, bukan percobaan).
- Metrik dan alert backlog (T24, T25).
- Deployment worker hosted (T25).

# Gate M4 — Fase 4: integration lintas domain

- Tanggal: 9 Oktober 2026.
- Pelaksana: Claude Sonnet 5.5.
- File: `tests/integration/m4-cv-output.test.ts` (baru) dan script `test:integration:m4` di `package.json`. Memakai ulang `tests/integration/cv-export-support.ts` tanpa mengubahnya.
- Lingkungan: Supabase lokal, ClamAV `workpulse-t10-clamav`, renderer Chromium `workpulse-t21-pdf` (`WORKPULSE_PDF_GOTENBERG_URL`, suite gagal keras bila tidak terjangkau dan memeriksa `renderer.kind === "gotenberg"`; tidak ada fake untuk export). Akun nyata lewat sign-in, service layer nyata, worker export nyata, `sql()` untuk jam.

## Cara pengukuran

`expectLayers(account, label, expected)` dipanggil sebelum dan sesudah mutasi. Ia membaca empat lapis lewat jalur produksi dan menegaskan satu cerita:

- `getReadiness()` (blocker S14);
- `getFreshness()` (state tiap item dan profil);
- `get_cv_review_summary` (hitungan S13);
- `createDashboardService().getDashboard().cvReview` (check S04).

Himpunan blocker readiness (selain `NAME_REQUIRED`/`CONTENT_REQUIRED`) harus sama dengan himpunan item `changed`/`deleted`/`unconfirmed` plus profil `changed`. `review_count` S13 dan Dashboard harus sama dengan jumlah itu, dan `availableCount` Dashboard sama dengan `available_count`. Daftar blocker juga dicocokkan dengan `expected` yang ditulis di test. Setiap export diperiksa dengan `exportNow` (request, worker nyata, objek tersimpan, ekstraksi pdf.js) dan `expectUntouched` (snapshot md5, key objek, revision, sha256 byte objek lama).

## Hasil

`pnpm test:integration:m4`: exit 0, 1 file / **17 test**, 103 detik. Run pertama 10/17: tujuh kegagalan adalah kesalahan test saya (item CV kehilangan tautan FK setelah sumbernya dihapus sehingga dicari sebelum penghapusan; `reconcile_orphan_export_objects` mensyaratkan umur ≥ 900 detik), bukan perilaku produk. Tidak ada ekspektasi yang diubah untuk meloloskan produk.

| # | Skenario | Bukti utama |
| --- | --- | --- |
| 1 | Provenance import | Batch import nyata (upload → ClamAV → parser → fake AI untuk ekstraksi → review → commit) memberi experience dan achievement confirmed (origin `import`). Dipilih ke CV dan diekspor. `purge_expired_import_batches` ≥ 1, `purged_at` terisi, `payload` item staging `null`. Sesudahnya: fingerprint dan revision CV sama, empat lapis kosong, achievement tetap `origin=import` dengan `source_excerpt` sama, snapshot item sama, request ulang memakai ulang export lama (`reused`), export lama utuh, export baru memuat experience dan bullet impor |
| 2 | Delete activity sumber | Achievement turunan terpilih tetap `confirmed` dengan `source_excerpt` dan `source_activity_revision` sama, `activity_id = null`; item CV sama, revision CV sama, empat lapis kosong, export lama utuh (reuse, 1 baris export) |
| 3 | Override + edit sumber + refresh + Replace | Dua sumber diubah → dua `ITEM_CHANGED` di semua lapis, export ditolak tanpa tulisan; refresh item tanpa override tidak menyentuh override item lain (tetap `changed`); *Replace* menghapus override; export baru memuat teks sumber; export lama masih memuat override |
| 4 | Delete enam tipe sumber | Achievement, project (dengan anak), experience, education, skill, certification: `ITEM_DELETED` di readiness, review, Dashboard, state item, dan `request_cv_export` (`EXPORT_BLOCKED`, 0 baris export, fingerprint CV sama); snapshot item tetap tersimpan; record lain tidak hilang; setelah item dihapus siap lagi dan teks yang dihapus tidak ada di PDF |
| 5 | Reopen → confirm | `ITEM_UNCONFIRMED` di semua lapis; setelah confirm ulang tanpa perubahan tampilan item fresh dan bisa diekspor (decision 0026); dengan perubahan → `ITEM_CHANGED`, refresh, export; export lama utuh |
| 6 | Relink | Achievement kontekstual di bawah experience dipindah ke project: `ITEM_CHANGED`, refresh menambah satu parent project, achievement tercetak tepat sekali, di bawah project, bukan di bawah experience lagi; export lama utuh |
| 7 | Evidence | Evidence `ready` (ClamAV nyata) pada achievement dan project terpilih: tidak mengubah readiness, review, revision (request ulang = export lama); sertifikat ber-`credential_url`. Snapshot (`snapshot::text`) dan teks PDF tidak memuat nama file evidence, isi, object key, kata `evidence`, `object_key`, host kredensial, atau `http(s):`. Dua objek export, tidak ada objek evidence di prefix export |
| 8 | Profil | `PROFILE_CHANGED` di semua lapis; *Keep saved wording* → export memuat nama tersimpan, bukan nama baru; edit kedua → `PROFILE_CHANGED` lagi; refresh → nama baru; export lama utuh |
| 9 | Edit saat export | Edit sumber dan Save CV setelah request, sebelum worker: PDF memuat teks lama, `cv_revision` export < revision CV (S14 menandai *Earlier revision* dari kondisi ini), request baru ditolak `EXPORT_BLOCKED` |
| 10 | Tanpa AI | 0 baris `ai_jobs` untuk akun suite (kecuali akun skenario 1, yang mengimpor CV dan memang membuat job ekstraksi). Satu pass worker AI dengan provider fake penghitung: `calls` dan `importCalls` = 0 |
| 11 | CV panjang | Locale `id`, 14 achievement dengan bullet ≥ 640 karakter, renderer nyata: 1 < halaman ≤ 20, = `page_count`, semua halaman A4 (pdf.js), teks memuat *Pengalaman*, *Pendidikan*, *Pencapaian*, nama, awal dan akhir (60 karakter) setiap bullet; tanpa `evidence` atau `http` |
| 12 | Isolasi | Untuk `select`, `remove`, `saveEdits`, `resolveFreshness`, `issueDownload` (attachment dan inline), `retryExport`: id milik A dan id acak memberi hasil identik (kode, `messageKey`, blockers), dan semuanya ditolak. `listExports`/`getExport` kosong/`null`. RPC mentah `get_cv_export_download` dan `retry_cv_export`: kode dan pesan galat sama. `cv_exports` dan `cv_items` A kosong bagi B. `createSignedUrl`, `download`, `list` Storage untuk key A gagal/kosong. `reconcile_orphan_export_objects` tidak mengantre hapus objek export A yang diumurkan 3 jam; byte objek tetap sama |

Rute `/api/cv/exports/[id]` dan halaman dibuktikan di E2E (Fase 3 langkah 10), karena integration berjalan tanpa server Next. Aksi server membungkus service yang sama dan sudah memiliki unit `cv-export-actions.test.ts`.

## Temuan

Tidak ada temuan baru dari Fase 4. P0/P1 tidak muncul: tidak ada PDF lama yang berubah, tidak ada export yang lolos dengan blocker, tidak ada karya yang hilang.

Catatan perilaku yang dikonfirmasi (bukan temuan):

- `cv_items` kehilangan tautan FK ke sumber yang dihapus dan menandai `source_deleted`; snapshot tampilan tetap ada.
- Confirm ulang tanpa perubahan field tampilan menghasilkan `fresh` (keputusan 0026 §2.2.2).

## Blocker dan langkah berikutnya

Tidak ada. Fase 5: regresi penuh.

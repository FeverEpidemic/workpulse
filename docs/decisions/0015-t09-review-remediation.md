# Decision 0015 — T09 review remediation

Tanggal: 24 September 2026  
Status: **DITERAPKAN; acceptance database/browser lokal lulus 25 September 2026**

## Konteks

Review T09 menemukan isu recovery lifecycle, pagination Achievement dengan tanggal NULL, create
redirect/session recovery, dan jalur Activity ↔ Achievement. Pemeriksaan juga mengoreksi temuan
metrics: helper `normalizeMetricRows()` dapat mengubah string kosong menjadi nol, tetapi tidak
dipakai jalur save. Tidak ada bukti bahwa blank metric tersimpan sebagai nol.

## Keputusan

1. Retry conflict mengirim kembali `achievement_action` pengguna dengan revision terbaru dan
   mempertahankan input lokal sampai save berhasil atau pengguna memilih reload/discard. Jika
   perubahan bersamaan membuat aksi semula tidak valid, tampilkan hanya aksi recovery yang valid
   untuk status terbaru dan minta pilihan eksplisit; jangan mengganti aksi atau mengonfirmasi otomatis.
2. Untuk cursor bertanggal, keyset pagination menyertakan setiap row dengan `achieved_on IS NULL`
   sesudah seluruh row bertanggal. Cursor NULL-date berikutnya melanjutkan urutan UUID descending.
3. Hapus helper metrics yang tidak dipakai. Pertahankan validasi schema jalur save untuk menolak
   blank; nilai nol eksplisit tetap valid. Tidak membuat migration atau backfill karena persistence
   defect tidak terbukti.
4. Redirect framework untuk existing Achievement berada di luar `try/catch` yang mengubah error
   menjadi halaman; tidak membuat record baru saat source Activity sudah mempunyai turunan.
5. Login resume mengarah kembali ke route create yang sudah memvalidasi source UUID dan return
   destination. Source Activity/Project yang hilang atau tidak dimiliki pengguna menghasilkan respons
   owner-safe dan tidak berubah menjadi create standalone.
6. Safe-return memakai satu canonicalizer dengan panjang URL maksimum 500 karakter, maksimum empat
   `returnTo` nesting, route/query allowlist, serta penolakan URL eksternal, malformed, dan ambigu.
   Activity detail boleh kembali ke Achievement detail; sanitasi mencegah loop atau rekursi tanpa batas.

Trace: R01/shared recovery; R04/F02/S05–S06; R05/F03/S07–S08; R06/F04/S09–S10.

## Konsekuensi dan verifikasi

Perubahan ini tidak mengubah schema, RPC, migration, generated types, atau data tersimpan. Acceptance
remediasi lulus pada 25 September 2026: Achievement/Project integration 5/5 dan 7/7; Achievement
browser 3/3; Auth, Activity, dan Project browser masing-masing 1/1; 32 file/159 unit tests;
TypeScript, ESLint, dan production build. T09 kembali DONE; Gate M2 tetap terbuka sampai task M2
berikutnya selesai. Tidak ada migration, database reset, atau pekerjaan T10 dalam remediasi ini.
Rincian implementasi dan hasil ada di
[rencana remediasi](../verification/T09-review-remediation-plan.md) dan
[verification T09](../verification/T09-manual-achievements-skills.md).

# Decision 0044: T33 multi-select di daftar "Available to add" CV

Date: 6 November 2026

Status: Accepted. Task T33 DONE lokal pada 6 November 2026 (closeout reviewer). Bentuk daftar checkbox dipilih pengguna pada 5 November 2026. Keputusan lain diusulkan di chat dan ditinjau pengguna lewat plan. Dieksekusi Claude Sonnet 5.5 (Fase 0 sampai 3b) di branch `claude/t33-cv-multi-select-288f9f`. Gate review Claude Opus 5.5: satu P1 (RV1) dan satu P2 (RV2), keduanya diperbaiki, gate ulang lulus tanpa P0-P2 pada commit `d8831ca`. Task: T33 (permintaan terarah pengguna, tidak ada di `IMPLEMENTATION_PLAN.md` §5). [Rencana](../verification/T33-implementation-plan.md), [bukti](../verification/T33-cv-multi-select.md), [gate review](../verification/T33-review-remediation-plan.md). Tanpa migration (parity tetap 38), tanpa RPC baru, tanpa dependency.

## References

- **Decision 0025** #6 (tanpa auto-selection dan *Add all*), #7 (operasi struktural langsung tersimpan, teks lewat draft dan Save), #12 (aturan state sebagai modul murni), #13 (Add to CV adalah tautan).
- **`select_cv_source`** di `supabase/migrations/20261004090000_t20_cv_freshness_deletion.sql`. Achievement dengan project atau experience ikut menambahkan induknya. Record yang sudah ada menghasilkan `CV_SOURCE_DUPLICATE`. Revision yang basi ditolak.
- **`AGENTS.md`** bagian UI dan aksesibilitas: target sentuh 44 px, status tidak bergantung warna, verifikasi 360 px dan 1440 px, light dan dark.

## Context

Daftar "Available to add" di `/cv` memakai satu tombol Add per baris. Pengguna meminta pilihan ganda supaya beberapa record bisa masuk CV sekaligus.

## Menggantikan sebagian decision 0025 #6

Decision 0025 #6 melarang bulk-add dan *Add all* karena PRD freshness melarang menambah diam-diam. Decision ini mengubah satu bagian:

- **Berubah:** bulk-add diizinkan bila pengguna sendiri mencentang tiap record dan menekan tombol. Tidak ada yang masuk CV sebelum tombol ditekan.
- **Tetap:** tidak ada auto-selection, tidak ada *Add all*, tidak ada "Select all". Tombol Add per baris dihapus.

Bagian lain decision 0025 tidak berubah.

## Decisions

1. **Daftar checkbox, bukan dropdown atau hybrid.** Pilihan pengguna. *Alasan:* semua pilihan terlihat, detail baris tetap muat, dan pola checkbox sudah ada di `import-review-candidate.tsx`.
2. **RPC lama dipanggil berurutan, tanpa RPC baru.** `selectCvSourceAction` dipanggil satu per satu. *Alasan:* tiap penambahan berdiri sendiri, jadi gagal sebagian tidak merusak CV. Efek samping per item sama dengan klik tunggal.
3. **Tanpa "Pilih semua".** Sejalan dengan decision 0025 #6.
4. **Berhenti di kegagalan pertama.** Sisanya tetap tercentang. *Alasan:* kegagalan revision atau jaringan hampir pasti berulang.
5. **Urutan daftar, bukan urutan klik.** *Alasan:* hasilnya bisa ditebak dan mudah diuji.
6. **Revision dirantai dari jawaban server.** Tiap panggilan memakai `cvRevision` dari jawaban sebelumnya, bukan state React. Runner tidak menebak revision. Jawaban sukses tanpa revision numerik menghentikan proses.
7. **Item Suggested langsung tercentang.** Fokus ke checkbox, belum ada write. Nilai `highlight` yang tidak valid tidak mencentang apa pun.
8. **Record yang sudah masuk hanya dihapus lewat ikon sampah.** *Alasan:* menghapus centang tidak boleh melewati dialog hapus item beranak.
9. **`aria-disabled` dan guard di handler, bukan `disabled`,** untuk tombol dan checkbox selama proses. *Alasan:* temuan T19 Fase 5, `disabled` membuang fokus.
10. **Selector stabil.** Checkbox `cv-pool-check-<sourceId>` dinamai lewat `aria-labelledby` ke nama record, tanpa badge Suggested dan tanpa detail. Tombol `cv-pool-add-<sectionKey>`. Teks Added `cv-pool-added-<sourceId>`.
11. **State seleksi satu `Set<sourceId>` di `CvBuilder`.** Aturan murni ada di `cv-builder-state.ts` (`addableSelection`, `poolAddButton`, `runSequentialAdds`, `pruneChosen`) dan diuji unit.
12. **Gaya mengikuti app.** Checkbox native dan token yang ada. Tanpa warna, ikon, atau animasi baru. Dial ENERGY 1 / RHYTHM 1 / MOTION 1.
13. **Satu refresh di akhir batch sukses.** Layout tidak bergeser saat proses berjalan.

## Perilaku hasil remediasi gate review

Gate review menemukan dua celah. Keduanya diperbaiki di `eca526b`.

- **RV1 (P1): pool dimuat ulang pada semua jalur gagal.** Sebelumnya `router.refresh()` hanya berjalan bila minimal satu record masuk. Bila record pertama sudah hilang, baris itu tetap tampil dan pengguna buntu. Sekarang pool dimuat ulang pada setiap kegagalan. Refresh kedua dilewati bila `fail()` sudah me-refresh karena konflik (`isSourceChangedConflict` atau `isStaleConflict`).
- **Notice jumlah.** `cv.notice.partialAdd` tampil bila batch berisi lebih dari satu record, juga saat tidak ada yang masuk ("0 of 3 added. The rest stay selected so you can try again."). Batch satu record cukup memakai notice error dengan correlation ID.
- **RV2 (P2): `pruneChosen`.** Induk yang ikut masuk lewat achievement, atau record yang masuk dari sesi lain, tetap ada di `chosen` dan muncul tercentang lagi setelah dihapus. Fungsi murni `pruneChosen(chosen, pool)` membuang setiap id yang `selected` di pool saat ini. Fungsi ini jalan saat `savedKey` berubah dan mengembalikan Set yang sama bila tidak ada perubahan.

## Consequences

- Pengguna mencentang beberapa record dan menambahkannya dengan satu tombol per section. Satu batch tiga record menaikkan `cv_documents.revision` tepat tiga kali.
- Selama `router.refresh()` setelah jawaban stale, tombol masih bisa diklik. Klik kedua memakai revision lama dan menghasilkan konflik lagi. Data tidak rusak (N2).
- Selector `#cv-add-<id>` dihapus. Test yang memakainya dimigrasikan, dan aria snapshot S13 dikunci ulang (hanya area daftar).
- Kunci copy `cv.action.add` dan `cv.aria.add` dihapus.

## Not promised

- Belum diuji di Safari, Firefox, perangkat nyata, staging, atau production. Semua bukti berasal dari Chromium lokal di production build.
- Teks bahasa Indonesia (label tombol, keterangan, notice) hanya terbukti lewat unit test. E2E M5 dan Axe S13 berjalan dengan locale `id`, tetapi memakai selector stabil dan tidak membaca teks baru. Belum ada pemeriksaan visual locale `id` pada daftar ini.
- Lebar sekitar 768 px tidak diuji khusus. Daftar satu kolom di semua lebar, diuji di 360 px dan 1440 px.
- "Pilih semua", pencarian di daftar, tombol sticky, RPC batch, undo batch, dan drag-and-drop tidak termasuk.

## Follow-up (P3)

- **N1:** `landing.spec.ts:308` gagal 2 dari 3 run, juga di base `e3e522a`. Milik T32 atau PR di area landing.
- **N2:** tombol tambah masih bisa diklik selama refresh setelah jawaban stale.

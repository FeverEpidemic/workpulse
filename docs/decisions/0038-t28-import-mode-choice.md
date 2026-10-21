# Decision 0038: T28 pilihan Dengan AI / Tanpa AI di setiap import

Date: 21 Oktober 2026

Status: Accepted. Konsep disetujui pengguna di chat pada 21 Oktober 2026 (pilihan di setiap import, Tanpa AI mencabut consent global, konfirmasi sebelum pencabutan); gate review 21 Oktober 2026 PASS tanpa P0-P2, empat temuan P3 diselesaikan dalam remediasi RV1-RV4. Task: T28 (penambahan scope pengguna, tidak ada di `IMPLEMENTATION_PLAN.md` §5; R02, F01, S02, S12). [Rencana](../verification/T28-implementation-plan.md), [bukti](../verification/T28-import-mode-choice.md), [gate review](../verification/T28-gate-review.md), [remediasi](../verification/T28-review-remediation.md). Tidak ada migration (tetap 38).

## References

- **PRD** R02, §3; **User Flow** F01 dan *Import exceptions*; **Wireframe** S02, S12 (consent AI).
- **AGENTS.md** *Konteks proyek* (jalur manual tetap berfungsi tanpa AI) dan *Activity, achievement, dan AI* (consent diperiksa sebelum enqueue, sebelum mengirim teks, dan sebelum apply).
- **Decision terkait:** 0019 (T13 consent AI dan job), 0021 #1 (T15 staging), 0032 (batas pemakaian AI), 0033 #2 dan #10 (T26 import tanpa AI).

## Context

Decision 0033 #2 menampilkan dialog pilihan hanya bagi pengguna tanpa consent; pengguna yang sudah consent selalu meng-upload dengan mode `ai`. Setelah uji import di staging, pengguna meminta agar pilihan itu muncul di setiap import. Consent `ai-processing-v1` bersifat global (import dan analisis aktivitas), jadi memilih Tanpa AI saat consent aktif hanya konsisten bila consent itu dicabut. Selain itu, 0033 #10 menyisakan satu kasus tertutup: pengguna consent dengan kuota import AI habis hanya melihat *Start manually*, padahal jalur tanpa AI tidak memakai kuota.

## Decisions

1. **Mengubah 0033 #2: dialog pilihan di setiap upload, untuk semua pengguna.** Setiap Upload di S02 membuka dialog yang sama, dengan atau tanpa consent. Pilihan tidak diingat. Aturan kesetaraan 0033 #2 tetap: dua kartu setara, urutan tetap, varian tombol sama, tanpa rekomendasi, fokus awal di judul. Dialog hidup bersama tampilan pilih file S02 (satu-satunya tempat tombol Upload); tampilan status batch tidak merender dialog. *Alasan:* pengguna yang sudah consent pun perlu bisa memilih jalur yang tidak mengirim teks ke penyedia AI per file.
2. **Pakai AI tanpa langkah tambahan bagi pengguna consent.** Pengguna consent yang memilih Pakai AI langsung meng-upload mode `ai`; consent tidak disimpan ulang dan revisi profil tidak berubah. Pengguna tanpa consent tetap menyimpan consent lalu upload (perilaku T26).
3. **Tanpa AI dengan consent aktif mencabut consent global, setelah konfirmasi.** Baca tanpa AI pada pengguna consent mengganti isi dialog dengan konfirmasi *Matikan AI untuk akun Anda?* (bukan modal kedua, pola sama dengan pencabutan di kartu consent S12). Fokus di judul konfirmasi, bukan di tombol, agar Enter tidak mencabut consent. Dua tombol `secondary` setara: *Matikan AI dan baca CV*, lalu *Kembali*. Kembali mengembalikan fokus ke Baca tanpa AI; Esc, backdrop, dan Batal menutup dialog tanpa mengubah apa pun. Tombol lanjut menjalankan `setAiConsentAction` withdraw, lalu upload mode `rules`. Tanpa consent, Baca tanpa AI langsung upload (perilaku T26). *Alasan:* consent bersifat global; menyimpan consent aktif sambil memilih Tanpa AI akan membuat pilihan itu tidak bermakna untuk analisis aktivitas, dan dampak itu harus terlihat sebelum terjadi.
4. **Dua request, urutan tetap.** Pencabutan dan upload adalah dua request. Error pencabutan (mis. `CONFLICT`) tampil di konfirmasi dan upload tidak dijalankan. Bila pencabutan berhasil tetapi upload gagal, consent tetap tercabut (pengguna sudah mengonfirmasi) dan error upload tampil di S02. Revisi profil disimpan di state dan diperbarui dari hasil setiap action consent, sehingga izinkan lalu matikan di satu kunjungan halaman tidak `CONFLICT`.
5. **Dialog terkunci selama pilihan diproses (remediasi RV1).** Selama simpan consent, pencabutan, atau upload berjalan, semua tombol dialog nonaktif termasuk Batal, Esc ditahan, dan klik backdrop diabaikan (primitive `Dialog` mendapat opsi `dismissible`, default tetap bisa ditutup). *Alasan:* menutup dialog di tengah request meninggalkan consent berubah tanpa upload. *Batasan yang diterima:* Chromium memaksa dialog tertutup pada Esc kedua tanpa aktivasi pengguna di antaranya (CloseWatcher). Pada kasus itu request yang sudah terkirim tetap selesai, upload dilewati, dan state tetap jujur (`granted` false, S12 *Tidak diizinkan*). Tidak diuji E2E.
6. **Job AI yang sedang berjalan saat pencabutan.** Pencabutan tidak membatalkan job secara langsung; job gagal dengan `CONSENT_WITHDRAWN` pada titik completion dan hasilnya dibuang (0021 #1, T13). Copy konfirmasi menyebut hal ini: *Kalau ada analisis AI yang masih berjalan, hasilnya dibuang.*
7. **Retry batch `ai` mengikuti consent tanpa reload.** Setelah pencabutan berhasil, batch `ai` yang gagal transien langsung mendapat alasan `consent` dan Retry nonaktif (`withConsentWithdrawn`, setara dengan `toImportView` ber-`consent: false`). Alasan `expired` dan `exhausted` didahulukan; batch `rules` tidak berubah.
8. **Memperluas 0033 #10: kuota habis tidak menutup import untuk siapa pun.** Tampilan kuota-habis yang hanya berisi *Start manually* bagi pengguna consent dihapus. Dropzone dan Upload selalu tampil; di dialog, kartu AI menampilkan pemberitahuan batas dan Pakai AI nonaktif, kartu Tanpa AI tetap aktif dan mengikuti konfirmasi bila consent aktif. Retry batch `ai` saat kuota habis tidak berubah.
9. **Copy.** S02 memakai satu disclosure untuk semua pengguna (`import.disclosureChoice`) menggantikan `import.disclosure` dan `import.disclosureNoConsent`. Kartu Tanpa AI menyebut bahwa pilihan itu juga mematikan AI untuk analisis aktivitas, hanya saat consent aktif. Konfirmasi menyebut dampak ke analisis aktivitas, nasib analisis yang masih berjalan, data yang tidak berubah, dan cara menyalakan lagi.
10. **Tanpa perubahan server.** Tidak ada migration, RPC, route, worker, atau dependency baru. Pencabutan memakai `setAiConsentAction` dan `public.set_ai_consent` yang ada; upload `rules` memakai jalur T26 (`x-extraction-mode: rules`).

## Alternatives rejected

- **Mengingat pilihan terakhir atau melewati dialog bagi pengguna yang sering import:** mengurangi satu klik, tetapi pilihan yang diingat diam-diam mengirim teks ke AI pada upload berikutnya. Ditunda (plan §2.3).
- **Tanpa AI tanpa mencabut consent (pilihan per file saja):** consent global tetap aktif untuk analisis aktivitas, sehingga pengguna yang memilih Tanpa AI karena alasan privasi tetap mengirim teks aktivitas ke AI tanpa menyadarinya.
- **Mencabut consent tanpa konfirmasi:** dampaknya ke seluruh akun terlalu besar untuk satu klik di dialog import.
- **Konfirmasi sebagai modal kedua:** dua modal bertumpuk menyulitkan fokus dan screen reader; mengganti isi dialog mengikuti pola S12.
- **Fokus di tombol lanjut atau Kembali pada konfirmasi:** Enter langsung mencabut consent atau mendorong pengguna kembali ke AI.
- **Tombol lanjut bervarian destructive:** pencabutan bisa dibatalkan di Pengaturan dan bukan penghapusan data; varian merah mendorong satu pilihan.
- **Fallback otomatis ke `rules` saat AI gagal atau tidak tersedia:** tetap ditolak seperti 0033; asal kandidat menjadi tidak jelas.

## Open

- Pembagian pilihan AI dan tanpa AI per upload belum diukur (melanjutkan 0033 Open).
- Uji screen reader manusia (NVDA) pada tampilan konfirmasi belum dilakukan; axe, urutan tab, dan fokus lulus di E2E.
- Esc kedua yang dipaksa Chromium selama request (keputusan #5) tidak diuji E2E.
- Pesan `import.failed.AI` dan pengembalian unit untuk kegagalan `AI_UNAVAILABLE`/`AI_CONFIG_INVALID` tetap follow-up terpisah (plan §2.3).

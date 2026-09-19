# Keputusan persistence Activity

Tanggal: 17 September 2026

## Cakupan

T06 menambahkan persistence server-side untuk Activity dan Chat agar manual capture dapat berjalan sebelum AI. Keputusan ini menerapkan PRD R04, flow F02, Database Schema §§1–3 dan 6, serta kontrak lintas fitur pada `docs/IMPLEMENTATION_PLAN.md` §§1, 3, dan 4. UI S05/S06 tetap menjadi T07.

## Keputusan

- `raw_text` adalah sumber asli. Validasi hanya memeriksa whitespace dan batas karakter; database menyimpan nilai yang diterima persis tanpa trim, normalisasi, atau pemotongan.
- Panjang Activity dan Chat dihitung sebagai Unicode code point agar sesuai dengan `char_length` PostgreSQL. Batas Activity adalah 10.000 karakter. `role` dibatasi 200 karakter, sedangkan `scope` dan `outcome` 5.000 karakter, mengikuti batas field karier T03. Nilai optional dipangkas dan blank menjadi NULL.
- `occurred_on` disimpan sebagai tanggal kalender ISO yang divalidasi tanpa konversi timezone. Helper default menerima instant dan timezone IANA profil. Ia tidak membaca timezone mesin.
- Activity baru selalu mulai pada revision 1 dan analysis state `not_requested`. Revision naik satu saat input atau context berubah; perubahan operational state di masa depan tidak mengubah source revision.
- Create menggunakan `internal.operation_requests` dengan key unik per owner dan operasi. Hash mencakup payload canonical penuh, tetapi receipt hanya memuat `id`, `user_id`, `revision`, `occurred_on`, dan `capture_mode`. Replay mengembalikan receipt stabil; key yang sama dengan payload berbeda ditolak.
- Create Chat menambahkan pesan user sequence 1 yang kontennya sama persis dengan `raw_text` dalam transaksi yang sama. Pesan tidak dapat diubah atau dihapus langsung; tidak ada assistant message, follow-up, job AI, atau provider call pada T06.
- Update menerima canonical editable state bersama `expected_revision`. Hanya satu edit dari revision yang sama dapat commit. Service memberikan latest owned row pada conflict dan menyamakan hasil foreign/missing sebagai unavailable.
- Semua query mencakup owner yang diperoleh dari session. Direct client mutation dicabut. RPC memakai `auth.uid()`, composite ownership FK, RLS, schema-qualified objects, `search_path` tetap, dan grant sempit.
- Jika project mengubah experience context, Activity tertaut ikut diperbarui atomik dan revision-nya naik. Menghapus project melepas link project sambil mempertahankan experience; menghapus experience membersihkan context tanpa menghapus Activity. Ini hanya compatibility minimum, bukan CRUD/relink T08.
- List memakai urutan `occurred_on DESC, id DESC` dengan cursor keyset versioned, filter tanggal inklusif, dan page size tetap 30.

## Deferred

Capture UI, delete Activity, achievement, evidence, AI consent/jobs, retries, provider integration, dashboard, timeline, dan project UI tetap pada task berikutnya. Gate M2 baru ditutup setelah T06–T12 acceptance selesai.


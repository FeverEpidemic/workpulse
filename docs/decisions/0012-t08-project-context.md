# Decision 0012 — T08 Project dan context propagation

Tanggal: 21 September 2026  
Status: Accepted for T08; follow-up seams remain for T09, T11, and T20.

## Context

T08 menghubungkan Project dengan Activity tanpa membuat capability Achievement, Evidence, Dashboard,
Timeline, AI, atau CV lebih awal. Project harus dapat berdiri sendiri atau memakai Experience milik
user yang sama. Activity memiliki `project_id` opsional dan `experience_id` yang harus mengikuti
Experience Project saat keduanya terhubung.

## Decisions

1. **Session adalah sumber owner.** Semua mutation Project mengambil `auth.uid()` di database dan
   session user di service. Payload tidak boleh memilih `user_id`; target Experience, Project, dan
   Activity diverifikasi dengan ownership composite key. Direct Project INSERT dicabut dari client dan
   create memakai operation ledger dengan receipt immutable.

2. **Project contract v0.1 tetap kecil.** Status hanya `planned`, `active`, dan `completed`.
   `title` dibatasi 200 Unicode code points; `description` dan `outcome` 5.000; `user_role` 200.
   Partial/unknown dates disimpan dengan precision canonical. `completed` tidak memaksa outcome atau
   end date; UI hanya menampilkan `Needs outcome`. `Independent` adalah label presentation ketika
   `experience_id` NULL, bukan record pengganti.

3. **Lock order adalah Project lalu Activity.** Update context Project, relink Activity, dan delete
   Project mengunci Project terlebih dahulu lalu linked/target Activity. Propagation dilakukan dalam
   transaksi yang sama; Activity hanya naik revision ketika context benar-benar berubah. Detach dan
   delete mengosongkan `project_id` saja serta mempertahankan Experience, raw text, Chat, dan field
   Activity lainnya.

4. **Revision dan retry tetap eksplisit.** Create replay memakai operation key dan mengembalikan
   receipt awal. Edit/relink/delete memerlukan `expected_revision`; stale input menghasilkan conflict
   atau unavailable state yang aman. Restored form draft menyimpan base revision dan tidak boleh
   menimpa data server tanpa reload/rebase yang eksplisit.

5. **Public update mempertahankan partial compatibility.** Service T08 mengirim canonical full
   fields, tetapi RPC masih menerima partial patch karena kontrak foundation T06 telah dipakai oleh
   fixture/regression yang ada. Allowlist database tetap menolak owner, id, timestamp, revision, dan
   unknown fields. Follow-up migration forward-only memperbaiki relink no-op dan SQL lint ambiguity;
   migration lama tidak diubah.

6. **Deletion adalah retention boundary, bukan cascade karya.** Delete preview menampilkan jumlah
   Activity yang akan dilepas, tetapi RPC menghitung ulang dan mengembalikan receipt aktual. Project
   dihapus, `project_id` pada Activity dibersihkan, dan Activity/Chat/Experience dipertahankan. T09
   akan memperluas transaksi yang sama untuk derived Achievement; T11 untuk direct Project Evidence;
   T20 untuk invalidasi source CV.

7. **URL dan UI hanya mengirim context yang dapat divalidasi.** Project list mendukung filter status
   dan cursor opaque berisi `updated_at`/UUID dengan order stabil. Nested return dibatasi satu hop dan
   hanya menerima route Project yang dimiliki bentuk aman. Activity capture boleh memakai Project dari
   URL setelah ownership validation, tetapi restored session draft menang.

## Consequences

Keputusan ini menutup mutation bypass dan menjaga invariants context di database. Project/browser
acceptance memang bergantung pada local Supabase nyata; setelah Docker aktif kembali, active stack
dan clean disposable stack sama-sama lulus. Seams T09/T11/T20 tetap menjadi perluasan transaksi,
bukan alasan untuk membuat capability domain lebih awal.

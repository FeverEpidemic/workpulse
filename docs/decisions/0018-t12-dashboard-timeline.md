# 0018 — T12 Dashboard dan Timeline read models

- Tanggal: 26 September 2026
- Status: Accepted
- Task: T12 (R03, R08, F06, S04, S11, S12 deep link)
- Rencana: [T12 handoff](../verification/T12-implementation-plan.md) §2.2
- Bukti: [T12 verification](../verification/T12-dashboard-timeline.md)

Catatan penomoran: `0017` dicadangkan untuk decision T11 dan belum ada di repository. Decision ini
tidak membuat 0017.

## Keputusan

1. **Fungsi SQL `SECURITY INVOKER`.** Migration `20260927090000_t12_dashboard_timeline.sql`
   menambah `filter_achievements`, `filter_projects`, `get_dashboard_summary`, dan
   `list_demonstrated_skills` sebagai fungsi `stable`, `security invoker`, `search_path = ''`.
   RLS owner-only tabel sumber tetap berlaku; fungsi juga memfilter `user_id = auth.uid()` dan
   mengembalikan kosong ketika `profiles.deleting_at` terisi. Execute hanya untuk `authenticated`
   dan `service_role`. Tidak ada tabel atau kolom baru.
   *Alasan:* definer akan melewati RLS dan memindahkan tanggung jawab ownership ke SQL buatan
   tangan; invoker mempertahankan satu sumber kebenaran otorisasi.
2. **Satu predikat untuk count dan list.** Count *missing evidence* dan *completed missing outcome*
   dihitung dari `filter_achievements`/`filter_projects` yang sama dengan jalur list terfilter.
   *Alasan:* count Dashboard harus identik dengan jumlah row setelah link dibuka, termasuk lintas
   pagination; dua predikat terpisah akan menyimpang.
3. **Filter ortogonal.** `evidence=missing` berarti tanpa direct `ready` evidence untuk status
   apa pun, dan `outcome=missing` berarti outcome NULL/blank untuk status apa pun. Link Dashboard
   menambahkan `status=confirmed` atau `status=completed`. Evidence Activity/Project tidak
   diwariskan; `uploading`/`scanning`/`failed`/`deleting` tidak dihitung sebagai ready.
   *Alasan:* filter dapat dikombinasikan dengan tab status yang ada tanpa semantik tersembunyi.
4. **Stat tile.** *Confirmed achievements* → `/achievements?status=confirmed`, *Current projects* →
   `/projects?status=active`. *Demonstrated skills* tidak memiliki link agregat; setiap chip skill
   menaut ke `/achievements?status=confirmed&skill=<id>`.
   *Alasan:* tidak ada list yang memuat tepat himpunan "skill yang ditunjukkan".
5. **Empty dashboard jujur.** Tanpa activity, achievement, project, experience, maupun education,
   Dashboard menampilkan *Add your first activity* (→ `/activity/new`), *Add career history*
   (→ `/settings/profile`), dan *Import CV* sebagai tombol disabled dengan keterangan belum tersedia.
   *Alasan:* `/onboarding/import` me-redirect user yang sudah onboarding ke `/dashboard`; import
   baru tersedia pada T15–T17, sehingga link aktif akan menjadi redirect loop.
6. **Anchor dan urutan Timeline.** Experience/education/project memakai `start_date`, achievement
   memakai `achieved_on`. Urutan: tahun DESC; dalam tahun tanggal DESC, precision
   (day > month > year), type (achievement, project, experience, education), lalu `id`. Anchor NULL
   masuk grup *Date not set* paling bawah, diurutkan type, title, `id`. Overlap tidak digabung;
   tidak ada inferensi gap/promotion. Project tanpa tanggal menampilkan *Date not set*, bukan
   *Started Date not set*.
   *Alasan:* timeline diturunkan dari record canonical (DB §1) dan precision parsial tidak boleh
   dipalsukan menjadi tanggal lengkap.
7. **Timeline tanpa pagination, dengan batas jujur.** Setiap sumber dimuat maksimal 500 row
   (`limit 501` untuk deteksi). Bila terlampaui, sumber dipotong dan notice `role="status"` tampil.
   *Alasan:* pagination timeline di luar scope v0.1; batas eksplisit mencegah pemotongan diam-diam
   oleh `max_rows` PostgREST. Target performa diukur pada T24.

## Konsekuensi

- Filter URL baru (`evidence`, `skill`, `outcome`, `type`, `project`, `record`) terdaftar di reader,
  `sanitizeReturnTo`, schema service, dan UI chip/Clear.
- Project filter Timeline yang tidak ada pada data owner (asing/terhapus) menghasilkan empty
  filtered dan opsi *Unavailable project* tanpa membedakan penyebabnya.
- CV freshness check tetap milik T20 dan tidak dirender di Dashboard.

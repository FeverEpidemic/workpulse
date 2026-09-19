# Rencana Remediasi Review T05 Private Storage Policy

Tanggal: 17 September 2026.

Status: selesai dieksekusi; bukti aktual dan keterbatasan dicatat di
`T05-private-storage-foundation.md` dan `docs/IMPLEMENTATION_STATUS.md`.

## Tujuan

Menutup temuan review prioritas P1 pada boundary Storage T05. Setelah remediasi, bucket
`workpulse-private` harus tetap tidak dapat diakses langsung oleh `anon` atau `authenticated`
meskipun database memiliki policy permisif generik untuk bucket Storage lain. Batas signed URL
1–300 detik harus tetap hanya dapat ditegakkan oleh service server.

Gate M1 dibuka kembali sampai migration hardening, regression test, forward migration, clean
rebuild, dan verifikasi dua akun selesai. Remediasi tidak memulai T06, T10, T15, T21, atau T23.

## Temuan yang diperbaiki

Migration `20260917090000_t05_private_storage_foundation.sql` hanya menghapus policy
`storage.objects` yang nama, `USING`, atau `WITH CHECK`-nya memuat literal
`workpulse-private`. Policy generik seperti `USING (true)` atau owner-prefix berdasarkan segmen
path tidak memuat literal tersebut sehingga tidak terdeteksi.

Policy PostgreSQL bersifat permisif secara default. Karena privilege provider pada
`storage.objects` tidak seluruhnya dapat dicabut oleh role migration proyek, policy generik yang
tersisa dapat membuat row WorkPulse terlihat atau dapat ditandatangani langsung memakai token
pengguna. Pemilik file kemudian dapat meminta signed URL dengan expiry yang tidak melewati guard
server 300 detik.

Reproduksi review pada stack lokal membuktikan:

1. Policy `FOR SELECT TO authenticated USING (true)` tidak ditemukan oleh query cleanup migration.
2. Setelah policy tersebut dibuat dalam transaksi, role `authenticated` dapat melihat object
   `workpulse-private`.
3. Transaksi reproduksi di-rollback; tidak ada policy atau fixture review yang menetap.

## Acuan wajib

- `AGENTS.md` dan `docs/AGENTS.md`.
- `docs/IMPLEMENTATION_STATUS.md`, khususnya status T05 dan Gate M1.
- `docs/IMPLEMENTATION_PLAN.md` §1, §3 Jobs dan data privat, §4, acceptance T05, dan Gate M1.
- `docs/verification/T05-implementation-plan.md`, terutama keputusan “Tidak ada akses Storage
  langsung dari browser”, T05.3, matriks acceptance, dan Definition of Done.
- `docs/verification/T05-private-storage-foundation.md` serta
  `docs/decisions/0007-private-storage-foundation.md`.
- PRD R01/R07 dan Reliability §4; Database Schema §4 Storage protocol and quotas dan §6 Access
  policy pattern.

## Batas perubahan

### Termasuk

- Policy RLS restriktif untuk melindungi semua row `workpulse-private` dari role browser.
- Migration baru yang diterapkan forward-only pada database yang sudah memiliki migration T05.
- pgTAP yang membuktikan policy permisif generik tidak membuka read/write pada bucket WorkPulse.
- Non-regression untuk policy bucket lain, signed URL server, queue, scanner, dan seluruh T01–T05.
- Pembaruan decision, verification record, dan implementation status setelah bukti final tersedia.

### Tidak termasuk

- Mengedit migration `20260917090000_t05_private_storage_foundation.sql` yang sudah diterapkan.
- Membuat upload UI, `evidence_files`, reservation/quota, signature validation, atau status `ready`.
- Memilih atau mengintegrasikan vendor malware scanner.
- Membuat worker polling daemon, import pipeline, PDF export, atau account deletion.
- Menghapus policy generik milik bucket lain tanpa bukti bahwa policy itu hanya untuk WorkPulse.
- Hosted migration atau deployment production tanpa permintaan dan otorisasi terpisah.

## Keputusan teknis yang direncanakan

Tambahkan migration baru, misalnya
`supabase/migrations/20260917xxxxxx_t05_storage_policy_hardening.sql`. Timestamp final harus lebih
besar daripada migration terbaru dan tidak boleh mengubah file migration lama.

Migration membuat policy stabil pada `storage.objects` dengan karakteristik berikut:

- `AS RESTRICTIVE` agar hasilnya di-AND dengan setiap policy permisif yang mungkin sudah ada.
- `FOR ALL` agar `SELECT`, `INSERT`, `UPDATE`, dan `DELETE` memiliki boundary yang sama.
- `TO anon, authenticated`; service operation tetap memakai credential server.
- `USING (bucket_id <> 'workpulse-private')` untuk row yang sudah ada.
- `WITH CHECK (bucket_id <> 'workpulse-private')` untuk row baru atau hasil update.
- Nama policy konstan dan spesifik, misalnya `workpulse_private_server_only`.
- `DROP POLICY IF EXISTS` hanya untuk nama policy WorkPulse tersebut, lalu `CREATE POLICY`, agar
  definisinya deterministik pada clean rebuild dan upgrade yang terkontrol.

Contoh bentuk yang harus divalidasi saat implementasi, bukan disalin tanpa review:

```sql
drop policy if exists workpulse_private_server_only on storage.objects;

create policy workpulse_private_server_only
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id <> 'workpulse-private')
with check (bucket_id <> 'workpulse-private');
```

Jangan mengganti policy ini dengan policy permisif `USING (false)`. Policy permisif tambahan tidak
dapat meniadakan policy permisif lain karena policy permisif digabung dengan OR.

## Fase 0 Baseline dan reproduksi

1. Catat `git status --short --branch`; pertahankan semua perubahan pengguna.
2. Pastikan project lokal tidak linked ke hosted project.
3. Jalankan baseline install, lint, typecheck, unit, build, worker check, pgTAP, DB lint, dan Storage
   integration.
4. Reproduksi temuan hanya di dalam transaksi yang selalu diakhiri `ROLLBACK`:
   - buat object fixture WorkPulse sebagai role privileged;
   - buat policy generik `FOR SELECT TO authenticated USING (true)` tanpa literal bucket;
   - buktikan query cleanup lama tidak mendeteksinya;
   - buktikan `authenticated` dapat melihat row WorkPulse sebelum hardening.
5. Catat hasil aktual dan jangan meninggalkan policy/object fixture.

Acceptance fase:

- Reproduksi gagal pada implementasi lama dengan cara yang sama seperti temuan review.
- Database aktif dan source workspace tidak berubah setelah rollback.
- Kegagalan baseline yang sudah ada dipisahkan dari perubahan remediasi.

## Fase 1 Migration hardening dan decision record

1. Buat migration forward-only dengan policy restriktif yang dijelaskan di atas.
2. Jangan mengubah ACL atau policy yang tidak terkait WorkPulse.
3. Pastikan role `service_role` tetap dapat menjalankan operasi server yang dibutuhkan; jangan
   mengandalkan policy browser untuk authorization service credential.
4. Tambahkan `docs/decisions/0008-private-storage-restrictive-policy.md` yang mencatat:
   - akar masalah policy permisif generik;
   - alasan memakai policy restriktif;
   - pengaruhnya hanya pada bucket WorkPulse;
   - service tetap wajib memeriksa owner dan TTL;
   - batas provider-owned ACL yang tidak dapat dianggap tercabut.

Acceptance fase:

- Policy final tercatat sebagai `RESTRICTIVE`, berlaku untuk seluruh command, dan mencakup
  `anon` serta `authenticated`.
- WorkPulse ditolak pada `USING` dan `WITH CHECK` walaupun ada policy permisif generik.
- Access policy bucket lain tidak dihapus atau diam-diam diubah.

## Fase 2 Regression test database dan Storage API

Perluas `supabase/tests/database/private_storage.test.sql` dengan fixture transaksional berikut:

1. Assertion struktur policy:
   - policy berada pada `storage.objects`;
   - nama tepat dan unik;
   - `permissive = RESTRICTIVE`;
   - command mencakup seluruh operasi;
   - role memuat `anon` dan `authenticated`;
   - `USING` serta `WITH CHECK` menolak `workpulse-private`.
2. Buat policy permisif generik untuk `SELECT`, `INSERT`, `UPDATE`, dan `DELETE` yang tidak memuat
   literal `workpulse-private`.
3. Sebagai `authenticated`, buktikan:
   - row WorkPulse tidak dapat dibaca;
   - insert ke bucket WorkPulse ditolak;
   - update tidak dapat memindahkan row ke atau dari bucket WorkPulse;
   - delete tidak menghapus row WorkPulse.
4. Buat bucket/object disposable lain dan buktikan policy generik tetap dapat bekerja pada bucket
   tersebut. Ini memastikan policy restriktif tidak mematikan Storage global.
5. Semua fixture berada dalam transaksi pgTAP dan hilang saat rollback.

Pertahankan `tests/integration/private-storage.test.ts` sebagai bukti API nyata dan, bila perlu,
tambahkan assertion eksplisit bahwa owner maupun akun kedua tidak dapat membuat signed URL langsung
dengan expiry 3.600 detik setelah migration hardening. Admin/server-issued URL 1–300 detik harus
tetap dapat digunakan dan expired sesuai TTL.

Acceptance fase:

- Regression test akan gagal bila policy restriktif dihapus atau diubah menjadi permisif.
- Broad-policy fixture tidak membuka read, sign, upload, update, atau delete WorkPulse.
- Bucket lain tetap mengikuti policy-nya sendiri.
- Owner-authorized server URL tetap berfungsi dengan attachment disposition dan TTL maksimal
  300 detik.

## Fase 3 Forward migration dan clean rebuild

1. Terapkan migration baru dengan `pnpm exec supabase migration up --local` pada stack WorkPulse
   lokal aktif. Jangan menjalankan `db:reset` pada stack aktif.
2. Jalankan pgTAP, DB lint, Storage integration, dan migration list pada database aktif.
3. Jalankan clean rebuild pada project Supabase disposable dengan project ID dan path yang
   diverifikasi sebelum operasi apa pun.
4. Pada disposable stack, jalankan seluruh migration dari nol, seed, pgTAP, DB lint, dan Storage
   integration yang relevan.
5. Hapus hanya container, volume, network, dan folder disposable yang target absolutnya sudah
   diverifikasi. Jangan menyentuh database WorkPulse aktif.

Acceptance fase:

- Forward upgrade dari database T05 lama berhasil tanpa mengedit migration historis.
- Clean rebuild menghasilkan policy dan hasil test yang sama.
- Migration list lokal sinkron dan DB lint tidak menemukan schema error.
- Tidak ada resource disposable aktif yang tertinggal.

## Fase 4 Regression lengkap dan penutupan Gate M1

Jalankan minimal:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
pnpm test:integration:storage
pnpm build
pnpm worker:check
pnpm db:test
pnpm db:lint
pnpm exec supabase migration list --local
git diff --check
```

Setelah semua bukti lulus:

1. Perbarui `docs/verification/T05-private-storage-foundation.md` dengan bagian remediasi review,
   file berubah, migration baru, reproduksi sebelum/sesudah, dan hasil perintah aktual.
2. Perbarui `docs/IMPLEMENTATION_STATUS.md`: T05 kembali `DONE`, Gate M1 ditutup ulang, dan T06
   menjadi next task.
3. Tautkan decision 0008 dan rencana remediasi ini.
4. Jangan menyatakan hosted Storage, scanner nyata, quota/screening, atau production deployment
   selesai.

Jika satu acceptance privacy belum terbukti, pertahankan T05 `PARTIAL` dan Gate M1 terbuka dengan
blocker konkret. Jangan melanjutkan T06 sebagai bagian sesi remediasi.

## File yang diperkirakan berubah saat eksekusi

File baru:

- `supabase/migrations/20260917xxxxxx_t05_storage_policy_hardening.sql`
- `docs/decisions/0008-private-storage-restrictive-policy.md`

File berubah:

- `supabase/tests/database/private_storage.test.sql`
- `tests/integration/private-storage.test.ts` hanya jika assertion API tambahan diperlukan
- `docs/verification/T05-private-storage-foundation.md`
- `docs/IMPLEMENTATION_STATUS.md`

File yang tidak perlu berubah:

- Migration T01–T05 yang sudah diterapkan
- Adapter, object-key, metadata, queue, dan scanner TypeScript kecuali test membuktikan defect baru
- Route/page dan komponen UI
- Dokumen sumber PRD, User Flow, Wireframe, Database Schema, dan `Design.md`

## Matriks temuan ke bukti

| Risiko | Perbaikan | Bukti wajib |
| --- | --- | --- |
| Policy generik membuka read WorkPulse | Restrictive `USING` | pgTAP broad SELECT policy tetap menghasilkan 0 row |
| Policy generik membuka write WorkPulse | Restrictive `WITH CHECK` | pgTAP broad INSERT/UPDATE ditolak |
| Delete langsung melewati lifecycle | Restrictive `USING` | pgTAP broad DELETE tidak menghapus object |
| Browser membuat URL di atas 300 detik | Direct SELECT/sign tetap ditolak | Storage integration owner dan akun kedua gagal sign 3.600 detik |
| Hardening merusak bucket lain | Predicate hanya menolak bucket WorkPulse | Fixture bucket lain tetap mengikuti policy generik |
| Upgrade merusak stack yang sudah berjalan | Migration baru forward-only | `migration up --local`, pgTAP, DB lint, dan integration lulus |
| Clean install berbeda dari upgrade | Seluruh migration dijalankan dari nol | Disposable rebuild menghasilkan bukti yang sama |

## Definition of Done

Remediasi selesai hanya jika:

1. Policy permisif generik tidak dapat memberikan akses browser ke `workpulse-private`.
2. `anon` dan `authenticated` ditolak untuk seluruh operasi row WorkPulse melalui policy
   restriktif yang terverifikasi.
3. Policy bucket lain tetap berfungsi sesuai contract-nya.
4. Service server masih menerbitkan attachment URL hanya untuk owner dengan TTL 1–300 detik.
5. Migration forward-only dan clean rebuild sama-sama lulus.
6. Unit, integration, build, worker check, pgTAP, DB lint, dan diff check memiliki hasil aktual.
7. Verification record dan decision log diperbarui.
8. T05 baru dikembalikan ke `DONE` dan Gate M1 baru ditutup setelah semua butir di atas terbukti.

## Prompt eksekusi siap salin

```text
Eksekusi remediasi review T05 berdasarkan
docs/verification/T05-review-remediation-plan.md.

Baca AGENTS.md yang berlaku, docs/IMPLEMENTATION_STATUS.md,
docs/IMPLEMENTATION_PLAN.md bagian 1/3/4 dan Gate M1,
docs/verification/T05-implementation-plan.md,
docs/verification/T05-private-storage-foundation.md, decision 0007,
serta sumber PRD R01/R07 dan Database Schema bagian 4/6.

Perbaiki temuan P1 bahwa policy storage.objects yang permisif dan generik dapat
membuka bucket workpulse-private atau melewati guard signed URL 300 detik.
Jangan edit migration T05 yang sudah diterapkan. Tambahkan migration forward-only
dengan policy AS RESTRICTIVE FOR ALL TO anon, authenticated yang menolak
workpulse-private pada USING dan WITH CHECK. Pertahankan service_role server path.

Tambahkan pgTAP yang sengaja membuat broad policies tanpa literal bucket dan
membuktikan read/insert/update/delete WorkPulse tetap ditolak, sedangkan bucket
fixture lain tidak rusak. Jalankan forward migration pada stack lokal aktif tanpa
reset, clean rebuild hanya pada project disposable, seluruh quality gates, Storage
integration dua akun, DB lint, dan diff check. Update decision, verification record,
dan implementation status. Kembalikan T05 ke DONE dan tutup Gate M1 hanya jika semua
acceptance terbukti. Jangan memulai T06 atau scope T10+.
```

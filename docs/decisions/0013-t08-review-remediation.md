# Decision 0013 — T08 review remediation

Tanggal: 22 September 2026  
Status: Accepted and implemented for T08; T09/T11/T20 seams remain deferred.

## Context

Review terhadap T08 menemukan empat boundary yang belum cukup kuat: service menghapus tanggal akhir
Project `completed`, create replay masih bergantung pada Experience yang hidup, urutan lock edit
Project dapat berlawanan dengan `delete_experience`, dan attach candidates dibatasi sebelum filtering.
Perbaikan harus forward-only karena tiga migration T08 sebelumnya sudah diterapkan ke database lokal.

## Decisions

1. **Completed mempertahankan tanggal historis.** Normalisasi service hanya memaksa
   `is_current=false` untuk status `completed`. `end_date` dan `end_precision` tetap disimpan bila
   valid; keduanya dibersihkan hanya bila record efektifnya current. SQL dan service memakai semantics
   yang sama, sehingga canonical partial date tidak hilang di boundary UI/service.

2. **Replay ledger mendahului dependency live.** Create membentuk payload canonical dan hash setelah
   validasi scalar/partial-date, lalu melakukan claim operation ledger. Pada replay, row ledger dikunci,
   hash dibandingkan, receipt divalidasi, dan receipt immutable dikembalikan sebelum lookup Experience
   atau Project live. Hanya claim baru yang memvalidasi serta mengunci Experience owner-scoped. Ini
   menjaga idempotency setelah parent dihapus tanpa menghidupkan kembali row atau mengubah receipt.

3. **Lock hierarchy mengikuti dependency.** Mutation `update_project` yang menyentuh context mengambil
   hint Experience secara owner-scoped, mengunci Experience yang relevan dalam urutan UUID, kemudian
   Project, lalu linked Activity dalam urutan ID bila propagation diperlukan. Snapshot dan revision
   diperiksa ulang setelah menunggu lock. Operasi yang tidak menyentuh Experience tetap memakai
   Project → Activity. Migration `delete_experience` tidak diubah karena regression dua session
   menunjukkan update baru dan delete dapat selesai tanpa deadlock serta menghasilkan state atomik.

4. **Candidate query menggunakan keyset pagination.** Candidate attach dieksklusikan di database
   sebelum limit: Activity owned yang standalone atau terhubung ke Project lain tetap eligible, tetapi
   Activity pada target Project tidak. Order stabil adalah `occurred_on DESC, id DESC`; cursor opaque
   divalidasi dan page size 30 memakai fetch `pageSize + 1`. Title Project lain hanya diambil untuk row
   pada page saat ini. UI menggabungkan page tanpa duplikasi dan menyediakan loading, error dengan
   correlation ID, retry, end state, keyboard/focus, serta responsive behavior.

## Consequences

Migration `20260921090000_t08_review_remediation.sql` mengganti definisi RPC tanpa mengubah tiga
migration T08 sebelumnya atau signature/grant publik. Generated database types tetap identik karena
signature RPC tidak berubah. Create/update/relink/delete tetap session-owned, revision-checked, dan
transactional; Activity, Chat, dan Experience tetap dipertahankan sesuai keputusan 0012.

Replay receipt tidak menjadi snapshot row live, sehingga receipt dapat menunjuk pada Project yang
kemudian tidak lagi ada; ini memang konsekuensi idempotency dan bukan perintah untuk memulihkan data.
Candidate pagination menambah satu server action dan state UI, tetapi tidak memindahkan seluruh
Activity ke client.

## Evidence and limits

Regression unit, Project integration, pgTAP, DB lint, type generation comparison, active local
incremental migration, clean disposable rebuild, build, worker check, and Auth/UI/Activity/Project
Playwright suites passed on 22 September 2026. The concurrency regression uses two authenticated
sessions and bounded waits. No hosted/staging/production deployment, production email/storage, or
T24 performance claim is included. Full command counts and limitations are recorded in
`docs/verification/T08-projects-context.md`.

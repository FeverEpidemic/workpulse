# Decision 0024 — T18 CV schema dan selection

Date: 30 September 2026

Status: accepted for WorkPulse MVP v0.1 (local acceptance; see `docs/verification/T18-cv-schema-selection.md`)

References: PRD R09 dan *CV freshness contract*; User Flow F07 langkah 1–2, F03; Wireframe S13 (backend saja); Database Schema §1, §5 (`cv_documents`, `cv_items`, `cv_exports`, *Selection and freshness invariants*, *Deletion and export consistency*), §6; implementation plan §3, §4, §5 T18; handoff `docs/verification/T18-implementation-plan.md`; gate review `docs/verification/T18-gate-review.md`.

## Context

M4 membutuhkan satu master CV per akun yang dapat diisi dari data karier canonical. T18 menyediakan schema dan operasi seleksi di PostgreSQL; UI S13 (T19), freshness dan refresh (T20), serta export (T21/T22) dibangun di atasnya.

## Keputusan

1. **Satu CV per akun lewat RPC idempoten.** `ensure_cv_document()` memakai `insert ... on conflict (user_id) do nothing` lalu select, tanpa `internal.operation_requests`. *Alasan:* `UNIQUE(user_id)` sudah merupakan scope idempotensi; lima panggilan paralel menghasilkan satu row.
2. **Onboarding wajib.** Belum onboarding → `ONBOARDING_REQUIRED`; akun `deleting` → `AUTH_REQUIRED`. *Alasan:* nama provisional tidak boleh menjadi snapshot CV (decision 0002).
3. **Nilai awal.** `title = 'Master CV'`, `locale = profiles.locale`, `template_key = 'single_column_v1'`, `section_order` default enam key, `profile_snapshot` schema `cv-profile.v1`, `profile_source_revision = profiles.revision`.
4. **Section dan pemetaan tipe.** Enam key: `experience`, `projects`, `achievements`, `education`, `skills`, `certifications`. Item achievement selalu `section_key = 'achievements'`; penempatan di bawah parent adalah aturan render (`buildCvOutline`), bukan penyimpanan. *Alasan:* satu sumber per tipe per CV dan validasi tipe terhadap section.
5. **Parent wajib (disetujui pengguna).** Parent achievement = project bila `project_id` ada, selain itu experience bila `experience_id` ada, selain itu tidak ada. Project tidak otomatis memilih experience-nya. *Alasan:* F07 hanya menyebut achievement di bawah experience/project; memaksa experience akan menyisipkan record yang tidak dipilih pengguna.
6. **Render tanpa ganda.** `buildCvOutline` (`src/domain/cv/outline.ts`) menempatkan setiap achievement tepat sekali: di bawah project terpilih, selain itu experience terpilih, selain itu section `achievements`.
7. **Duplikat = error (disetujui pengguna).** `CV_SOURCE_DUPLICATE`, ditambah unique index parsial per tipe sebagai defense in depth.
8. **Revision CV.** Setiap RPC mutasi mengunci `cv_documents` `for update`, membandingkan `p_expected_revision` (`STALE_REVISION`), lalu menaikkan revision tepat sekali lewat `touch_mutable_row`.
9. **Safety net hapus sumber (disetujui pengguna).** FK sumber `on delete set null (col)` dan trigger `internal.guard_cv_item_row` menandai `source_deleted = true` sambil mempertahankan snapshot dan posisi. Trigger tidak menyentuh `cv_documents`. Kenaikan revision CV dan invalidasi lengkap adalah T20. *Alasan:* tanpa ini `delete_*` T03/T08/T09 gagal karena FK.
10. **Urutan lock.** profil (share) → `cv_documents` (update) → item CV (update, urut id) → sumber (share, parent dulu). Jalur delete sumber mengunci sumber lalu item lewat FK dan tidak pernah menunggu `cv_documents`, sehingga tidak ada siklus.
11. **Eligibility dicek dengan lock.** Achievement dikunci `for share` sebelum cek `confirmed`. Reopen setelah pemilihan tidak menghapus item; state unconfirmed dan blokir export adalah T20/T21.
12. **`cv_exports` hanya struktur (disetujui pengguna).** Kolom DB §5 ditambah `attempt_count`, `attempt_token`, `lease_expires_at`; RLS select own, tanpa fungsi dan tanpa grant write. T21 menambah secara forward.
13. **Kolom override/freshness ada, belum ditulis.** `summary_override`, `profile_ack_revision`, `override_text`, `acknowledged_revision` memiliki check tetapi tidak ada RPC yang menulisnya.
14. **Posisi kontigu.** Select menambah di akhir section, remove me-renumber, reorder menulis `1..n` dengan `cv_items_section_position_key` (deferrable) di-defer di dalam fungsi.
15. **Snapshot di SQL.** `internal.cv_source_snapshot` membangun `cv-source.v1` dengan `jsonb_build_object` eksplisit; tidak pernah `raw_text`, `source_excerpt`, `contribution`, evidence, atau ID activity.
16. **Selection pool lewat RLS.** `getSelectionPool` membaca dengan session client; achievement hanya `confirmed` dan hanya kolom tampilan.
17. **Nomor.** Migration `20261002090000_t18_cv_schema_selection.sql` (parity 27/27), pgTAP `cv_selection.test.sql`, integration `cv-selection.test.ts`, script `test:integration:cv`.

Kode error DB: `AUTH_REQUIRED`, `ONBOARDING_REQUIRED`, `INVALID_CV_INPUT`, `CV_NOT_FOUND`, `STALE_REVISION`, `CV_SOURCE_NOT_FOUND`, `CV_SOURCE_INELIGIBLE`, `CV_SOURCE_DUPLICATE`, `CV_ITEM_NOT_FOUND`, `CV_CHILD_ITEMS_EXIST`, `CV_REORDER_INVALID`, `CV_ITEM_IMMUTABLE`.

## Alternatif yang ditolak

Menyimpan achievement di section parent; project otomatis memilih experience; return idempoten untuk duplikat; FK `restrict`/`cascade` untuk sumber; `operation_requests` untuk ensure.

## Seam

- **T19:** lima RPC, `getCv`/`buildCvOutline`, `getSelectionPool`, kolom override/summary. Rapikan correlation ID di `actions.ts` (gate review F2).
- **T20:** invalidasi dan kenaikan revision CV saat sumber diedit/dihapus/di-reopen, refresh memakai `internal.cv_source_snapshot`, profile snapshot dan acknowledgement.
- **T21:** lease `cv_exports` dan urutan lock export harus konsisten dengan keputusan 10.

## Batas

Bukti lokal; tidak ada deployment. Race diuji dengan dua session nyata pada satu proses Node (tidak deterministik, bukan stres berskala).

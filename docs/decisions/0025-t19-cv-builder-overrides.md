# Decision 0025 — T19 CV builder dan overrides

Date: 1 Oktober 2026

Status: accepted for WorkPulse MVP v0.1 (local acceptance; see `docs/verification/T19-cv-builder-overrides.md`)

References: PRD R09, *CV freshness contract* (bagian override dan pool), *Shared validation*; User Flow F07 langkah 1–2, F03; Wireframe S13 (`/cv`); Database Schema §5 (`cv_documents`, `cv_items`, *Selection and freshness invariants*), §6 (*simultaneous CV edits*); implementation plan §3 *CV*, §4, §5 T19; handoff `docs/verification/T19-implementation-plan.md`; gate review `docs/verification/T19-gate-review.md`; decision 0024.

## Context

T18 menyediakan schema CV, lima RPC seleksi, dan `buildCvOutline` tanpa UI. T19 menjadikan `/cv` (S13) builder nyata: memilih dan mengurutkan record, memilih label locale CV, mengedit judul, summary, contact tampilan, dan wording per item tanpa mengubah record canonical maupun snapshot sumber. Freshness (T20) dan export (T21/T22) di luar scope.

## Keputusan

1. **Satu RPC teks: `public.save_cv_edits(p_expected_revision integer, p_edits jsonb) returns integer`.** Key opsional `title`, `summary_override`, `profile_overrides` (patch per key), `item_overrides` (`{item_id, override_text}`, maks 200, tanpa ID ganda); key asing → `INVALID_CV_INPUT`. `null`/blank menghapus override; `title` tidak boleh kosong. *Alasan:* Save eksplisit yang atomik mencegah setengah tersimpan dan memberi satu titik `expected_revision`.
2. **Satu revision per batch; no-op tidak menulis.** Semua validasi sebelum write; item diperbarui lalu tepat satu `update cv_documents` (trigger `touch_mutable_row`). Batch tanpa perubahan efektif (`is distinct from`) mengembalikan revision saat ini. *Alasan:* update per item yang menaikkan revision berkali-kali membuat klien basi oleh save-nya sendiri; no-op tidak boleh memicu konflik palsu.
3. **Urutan lock sama dengan decision 0024.** `internal.cv_actor()` profil `for share` → `internal.cv_lock` `cv_documents for update` → item yang disentuh `for update` urut `id`. Tabel sumber tidak dikunci maupun ditulis. *Alasan:* tidak ada siklus dengan jalur seleksi atau delete sumber; race 3 putaran tanpa `40P01`.
4. **Override hanya experience, project, achievement, education (disetujui pengguna, 30 September 2026).** `override_text` menggantikan description atau `cv_bullet`; skill/certification → `CV_OVERRIDE_UNSUPPORTED` (kode baru). Item `source_deleted` tetap boleh diedit. *Alasan:* S13 "override hanya mengubah wording"; label skill/certification bukan wording.
5. **Override profil di `profile_snapshot.display_overrides` (disetujui pengguna).** Key `display_name`, `headline`, `contact_email`, `phone`, `location`, `website`; nilai sumber `cv-profile.v1` dan `profile_source_revision` tidak diubah. Constraint `cv_documents_profile_overrides_check` lewat `internal.cv_profile_overrides_valid`. Batas mengikuti kolom profil T03: `display_name` **80** (rencana menulis 120; profil menang), `headline` 120, `contact_email` 320 + regex profil, `phone` 40, `location` 120, `website` 2048 `http/https`. Judul ≤ 120, summary ≤ 5000, override item ≤ 2000. *Alasan:* memisahkan salinan sumber dari wording pengguna agar T20 dapat Refresh/Replace tanpa kehilangan override; tanpa kolom baru.
6. **CV baru kosong, tanpa auto-selection dan *Add all* (disetujui pengguna).** *Alasan:* PRD freshness melarang menambahkan diam-diam; bulk-add ditunda sebagai kenyamanan.
7. **Operasi struktural langsung, teks lewat draft + Save.** Select/remove/reorder/layout memakai RPC T18 apa adanya; draft lokal bertahan lintas reload dan `expected_revision` = max(revision props, revision receipt terakhir). *Alasan:* struktur berdampak lintas item sehingga tidak boleh menggantung.
8. **Preview S13 hanya dari data tersimpan (disetujui pengguna).** `buildCvPreviewModel({ document, items })` (`src/domain/cv/preview.ts`) murni, tanpa I/O; komponen preview tidak menerima draft; badge *Unsaved changes* menjelaskan selisihnya. Tanpa `/cv/preview` dan pagination A4. *Alasan:* preview harus sama dengan revision yang kelak diekspor.
9. **Label dan tanggal CV terpisah dari i18n UI.** `src/domain/cv/labels.ts` (heading, *Present*/*Sekarang*, `Intl.DateTimeFormat` dengan `timeZone: 'UTC'`); presisi year/month/day, NULL tanpa placeholder. Locale CV tidak menerjemahkan konten sumber dan tidak mengubah locale UI.
10. **Konflik direkonsiliasi per field di klien.** `reconcileDraft`/`syncDraft` (`src/domain/cv/draft.ts`): field yang hanya diubah server diambil, yang hanya diubah pengguna dipertahankan, yang diubah keduanya menjadi `unresolved` dan memblokir Save sampai *Keep mine*/*Use saved*. Wording untuk item yang dihapus di sesi lain dilaporkan lewat `droppedEdits` + notice, bukan dibuang diam-diam. Jaminan keras tetap `STALE_REVISION` di database.
11. **Move logika murni dan aksesibel.** `computeItemMove` menukar dengan saudara sebaris (achievement kontekstual hanya di grup parent-nya), `computeSectionMove` menukar dua key; tombol berlabel nama, `disabled` di tepi, live region, fokus dikembalikan ke tombol yang sama. Drag-and-drop tidak diimplementasikan.
12. **Aturan state editor sebagai modul murni.** `src/features/cv/cv-builder-state.ts` (status Save, panel konflik, fokus field invalid, posisi announce, pool awal, penempatan achievement, correlation ID klien) diuji unit karena proyek tidak punya DOM test environment dan dependency baru tidak ditambahkan; interaksi DOM dibuktikan E2E.
13. **Add to CV adalah tautan.** Detail achievement `confirmed` menautkan `/cv?highlight=<id>`; halaman memvalidasi UUID dan hanya menyorot achievement belum terpilih di pool milik sesi (sorotan + fokus + scroll yang menghormati reduced motion), tanpa write.
14. **Correlation ID.** `run()` di `src/features/cv/actions.ts` membuat satu ID untuk service dan `failure()` (menutup T18 F2); kegagalan yang tidak mencapai server memakai ID klien seperti S08.
15. **Grant helper.** Migration `20261003100000_t19_cv_override_helper_grants.sql` mencabut execute `internal.cv_profile_overrides_valid` dari public/anon/authenticated/service_role (gate review F2), konsisten dengan helper internal T18.
16. **Nomor.** Migration `20261003090000_t19_cv_builder_overrides.sql` dan `20261003100000_t19_cv_override_helper_grants.sql` (parity 29/29), pgTAP `cv_builder.test.sql`, integration `cv-builder.test.ts` (`test:integration:cv-builder`), E2E `cv-builder.spec.ts` (`test:e2e:cv`, `playwright.cv.config.ts`, port 3012).

Kode error DB baru: `CV_OVERRIDE_UNSUPPORTED` (service `OVERRIDE_UNSUPPORTED`, `cv.error.overrideUnsupported`, action `VALIDATION`). Kode T18 dipakai ulang.

## Alternatif yang ditolak

RPC per field atau per item (revision berlipat, setengah tersimpan); kolom baru untuk override profil; autosave teks; drag-and-drop; bulk-add/auto-selection; preview dari draft lokal; override untuk skill/certification; menambah jsdom/testing-library untuk test komponen.

## Seam

- **T20:** state *changed source*, *override dengan perubahan sumber*, *unconfirmed*; Keep/Refresh/Replace memakai `override_text`, `acknowledged_revision`, dan `display_overrides` (Refresh mengganti salinan sumber, bukan override); profile freshness lewat `profile_source_revision`/`profile_ack_revision`; invalidasi revision CV saat sumber berubah.
- **T21:** `buildCvPreviewModel` sebagai basis render snapshot export; validasi nama memakai `resolveProfile`; urutan lock export konsisten dengan keputusan 3.
- **T22:** preview S14 memakai model yang sama ditambah pagination A4.

## Batas

Bukti lokal; tidak ada deployment. Race diuji dengan dua session nyata pada satu proses Node (tidak deterministik). Konflik dua konteks browser diuji E2E, bukan stres berskala.

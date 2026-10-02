# Handoff T20 CV freshness dan deletion integration — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi. Semua nama tabel, kolom, fungsi, kode error, key i18n, dan path di dokumen ini **dibekukan**; jangan mengganti namanya.

- Tanggal: 2 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Dependensi: T19 **DONE** (S13 `/cv`, `save_cv_edits`, domain `labels/resolve/preview/draft`, `cv-builder-state.ts`; `docs/verification/T19-cv-builder-overrides.md`), T18 **DONE** (schema CV, lima RPC seleksi, safety net `source_deleted`), T12 **DONE** (dashboard S04, `get_dashboard_summary`). T03, T08, T09, T16, Gate M3 **DONE/PASSED**.
- Eksekutor: satu agent **Claude Sonnet 5.5** (atau eksekutor lain yang ditunjuk pengguna). Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 6; Fase 7 (draft dokumen) dikerjakan setelah gate. Checkpoint setelah Fase 1 dianjurkan karena fase itu mengubah fungsi delete milik T03/T08/T09.
- Keputusan produk: §2.4 berisi enam keputusan yang **menunggu persetujuan pengguna**. Fase 0 berhenti sampai persetujuan tercatat (lihat §8).
- Acuan:
  - PRD R09 (*Source edits trigger a reviewable refresh*), *CV freshness contract* (selected source update → item changed; Refresh hanya untuk item tanpa override; item ber-override menampilkan wording lama dan perubahan sumber, pengguna memilih Keep wording atau Replace from source; deleted/unconfirmed memblokir export), R03 check *CV needs review*, release scenario *Edit a selected achievement after manual CV wording changes; refresh without losing the override. Delete its source and verify export is blocked until resolved.* (bagian freshness; blokir export = T21).
  - User Flow F07 langkah 5 (*review and refresh in S13; a valid stale item may be exported after the user explicitly chooses Keep saved wording; missing or unconfirmed sources must be removed or corrected*), F03 (edit confirmed → selected CV items changed; Reopen as draft menghapus eligibility; delete → CV source link invalid).
  - Wireframe S13 (state *changed source*, *manual override*, *deleted source*, *unconfirmed source*; *Keep wording* / *Replace from source*; tidak pernah menimpa wording manual otomatis), S04 (check *CV needs review*), S14 (blokir — hanya sebagai batas T22).
  - Database Schema §2 *Profile and context editing* (perubahan nama, contact, summary menandai profile snapshot changed), §5 *Selection and freshness invariants* dan *Deletion and export consistency*, §6 tabel atomic boundary (*Delete project or experience … invalidate affected CV references*, *Delete achievement or skill … invalidate CV source item*) dan test *simultaneous CV edits*.
  - `IMPLEMENTATION_PLAN.md` §3 *Data karier* (invalidasi CV dan increment revision dalam transaksi yang sama), §3 *CV*, §4 baris *CV consistency … lock protocol*, blok T20 di §5, T21/T22 untuk batas.
  - `docs/decisions/0024-t18-cv-schema-selection.md` (keputusan 9, 10, 11 dan *Seam* T20), `docs/decisions/0025-t19-cv-builder-overrides.md` (keputusan 3, 5, 10 dan *Seam* T20), `docs/verification/T19-gate-review.md`, `Design.md` (compact rows, satu aksi utama, progressive disclosure, status tidak hanya warna).

**Goal:** Master CV tahu kapan sumbernya berubah dan pengguna menyelesaikan perubahan itu secara eksplisit. Untuk setiap item terpilih dan untuk profil CV, sistem menghitung state **fresh**, **changed**, **kept** (Keep saved wording untuk revision live tertentu), **deleted**, atau **unconfirmed** dari revision sumber live, tanpa menulis apa pun ke CV ketika sumber diedit. Di S13 pengguna melihat badge per state, membuka panel review yang membandingkan versi tersimpan dengan sumber terbaru, lalu memilih *Refresh from source*, *Keep saved wording*, *Keep my wording*, atau *Replace from source*; override tidak pernah hilang tanpa *Replace*. Acknowledgement hanya berlaku untuk revision yang ditinjau; edit sumber berikutnya membuat item changed lagi. Menghapus sumber terpilih menandai item deleted dan menaikkan revision CV dalam transaksi yang sama, dengan protokol lock yang konsisten. Dashboard S04 menampilkan *CV needs review* dengan label terpisah untuk item changed dan achievement confirmed yang tersedia. Tidak ada export, tidak ada refresh otomatis, tidak ada AI.

**Architecture:** Satu migration forward-only menambah fungsi state SQL (`internal.cv_item_state`, `internal.cv_profile_state`) sebagai satu-satunya definisi freshness yang kelak dipakai T21; RPC baca `get_cv_freshness` dan `get_cv_review_summary`; RPC tulis batch `resolve_cv_freshness` (satu transaksi, satu kenaikan revision, pola `save_cv_edits`); helper lock `internal.cv_lock_for_source_change` yang dipanggil di awal setiap jalur delete sumber sebelum sumber dikunci; serta `create or replace` pada fungsi delete T03/T08/T09 dan `select_cv_source` T18 dengan perubahan minimal untuk protokol lock. Domain murni `src/domain/cv/freshness.ts` memetakan state ke aksi dan menghitung perbedaan tampilan. Service/action CV bertambah `getFreshness`/`resolveFreshness`; dashboard service memanggil `get_cv_review_summary`. UI S13 menambah ringkasan review, badge, dan panel review; preview tetap hanya dari data tersimpan.

**Tech stack:** Next.js App Router (server component + server action), React 19 client component, TypeScript strict, Zod 4, Tailwind 4 dengan primitives `src/components/ui`, lucide-react, Supabase PostgreSQL 17 (plpgsql `security definer`, pgTAP), Vitest (unit, integration nyata), Playwright + axe-core, pnpm dari lockfile. Tidak ada dependency baru.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md` (T19 dan T18), `docs/IMPLEMENTATION_PLAN.md` §1–§4 dan blok M4, decision 0024 dan 0025 (terutama *Seam*), `docs/verification/T19-cv-builder-overrides.md`, `T19-gate-review.md`, `docs/verification/T19-implementation-plan.md` sebagai pola fase, dan `Design.md` (form, status, responsive, aksesibilitas). Ekstrak ulang PRD R09/R03/*CV freshness contract*/release scenarios, F03/F07, S04/S13/S14, dan DB §2/§5/§6 dengan alat ekstraksi DOCX (mis. `python` + `zipfile` atas `word/document.xml`; `python-docx` tidak terpasang); jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R09:** edit sumber memicu refresh yang dapat ditinjau.
- **PRD freshness:** update sumber terpilih menandai item CV changed. Refresh hanya memperbarui item tanpa override manual. Untuk item ber-override, tampilkan wording lama dan perubahan sumber; pengguna memilih Keep wording atau Replace from source. Sumber deleted/unconfirmed memblokir export sampai item dihapus atau diperbaiki. PDF yang sudah diunduh tidak berubah.
- **PRD R03:** *CV needs review* = revision sumber terpilih berbeda dari revision CV tersimpan, **atau** ada achievement confirmed yang belum dipilih. Buka CV builder; label terpisah untuk changed dan available.
- **F07:** sumber berubah → review dan refresh di S13. Item stale yang valid boleh diekspor setelah pengguna eksplisit memilih Keep saved wording. Sumber hilang atau unconfirmed harus dihapus atau diperbaiki.
- **F03:** edit achievement confirmed menaikkan revision dan menandai item CV terpilih changed; Reopen as draft menghapus eligibility; delete membuat link sumber CV tidak valid dan harus diselesaikan sebelum export.
- **S13:** state unsaved, saved, changed source, manual override, deleted source, unconfirmed source. Review menawarkan Keep wording atau Replace from source; jangan pernah menimpa wording manual secara otomatis.
- **DB §2:** perubahan nama, contact, atau summary profil menandai profile snapshot CV changed.
- **DB §5:** freshness dihitung dari revision sumber live vs `source_revision`. `acknowledged_revision` mencatat Keep saved wording untuk revision live yang persis itu; edit sumber berikutnya membatalkan acknowledgement efektif. Refresh menyalin field tampilan baru ke `source_snapshot` dan `source_revision`; tidak pernah menimpa `override_text` tanpa Replace eksplisit. Profil mengikuti aturan yang sama; edit contact tampilan tetap di `profile_snapshot`. Sebelum menghapus sumber CV: kunci item terkait, set `source_deleted`, hapus referensi, pertahankan snapshot. Mengedit child item CV menaikkan revision CV induk.
- **DB §6:** delete project/experience membersihkan context dan meng-invalidasi referensi CV; delete achievement/skill meng-invalidasi item sumber CV.
- **Rencana §5 T20 (kalimat selesai):** edit sumber kedua membuat acknowledgement lama tidak berlaku, refresh mempertahankan override, delete/reopen sumber memblokir eligibility, dan edit activity sumber memunculkan kebutuhan review tanpa silent overwrite.

Pertahankan perubahan lokal pengguna. Jangan menandai T20 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T20-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka yang ditulis harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T20

T20 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **State item dari revision live.** Untuk setiap item, `internal.cv_item_state` menghasilkan tepat satu dari `fresh`, `changed`, `kept`, `deleted`, `unconfirmed` dengan prioritas §2.2.2. Revision sumber yang naik tanpa perubahan field tampilan (`internal.cv_source_snapshot` live = `source_snapshot`) tetap `fresh`. Dibuktikan pgTAP + unit `cv-freshness`.
2. **Edit sumber tidak menulis CV.** `update_experience`/`update_project`/`save_achievement`/`update_education`/`update_skill`/`update_certification` atas sumber terpilih tidak mengubah `cv_items` (snapshot, override, revision) maupun `cv_documents.revision`; item menjadi `changed`. Dibuktikan pgTAP + integration.
3. **Keep saved wording per revision live.** Aksi `keep` menyetel `acknowledged_revision` = revision live yang ditinjau; item menjadi `kept`; snapshot dan override tidak berubah. Edit sumber berikutnya membuat item `changed` lagi tanpa write ke CV. Dibuktikan pgTAP + integration (skenario rencana: *edit kedua membatalkan acknowledgement*).
4. **Refresh mempertahankan override.** Aksi `refresh` menyalin snapshot live dan revision live ke item, mengosongkan `acknowledged_revision`, dan **tidak** mengubah `override_text`; item menjadi `fresh`. Bila refresh achievement mengubah parent (project/experience) dan parent baru belum terpilih, parent ditambahkan dalam transaksi yang sama (sama dengan `select_cv_source`). Dibuktikan pgTAP + integration (release scenario PRD).
5. **Replace eksplisit.** Aksi `replace` = refresh + `override_text = NULL`; hanya sah bila item punya override, selain itu `CV_RESOLUTION_INVALID`. Dibuktikan pgTAP.
6. **Review basi ditolak.** `source_revision` yang dikirim berbeda dengan revision live → `CV_SOURCE_CHANGED` tanpa write; `expected_revision` CV basi → `STALE_REVISION` tanpa write. Aksi pada item `deleted`/`unconfirmed`/`fresh` → `CV_RESOLUTION_INVALID` (unconfirmed: `CV_SOURCE_INELIGIBLE`). Dibuktikan pgTAP.
7. **Batch atomik.** `resolve_cv_freshness` dengan banyak resolusi menaikkan revision CV **tepat satu**; satu resolusi invalid membatalkan seluruh batch. Dibuktikan pgTAP.
8. **Profile freshness.** Edit `display_name`, `headline`, `summary`, `contact_email`, `phone`, `location`, `website` di profil membuat state profil CV `changed`; edit locale/timezone saja tetap `fresh`. `keep` menyetel `profile_ack_revision`; `refresh` menyalin tujuh field sumber ke `profile_snapshot` sambil mempertahankan `display_overrides` dan `summary_override`; `replace` juga menghapus keduanya. Commit import yang mengubah profil (T16) juga menghasilkan `changed`. Dibuktikan pgTAP + integration.
9. **Delete sumber = invalidasi dalam transaksi yang sama.** Untuk keenam jalur delete (`delete_experience`, `delete_project`, `delete_achievement`, `delete_education`, `delete_skill`, `delete_certification`): item terpilih menjadi `source_deleted` dengan snapshot dan `override_text` utuh, dan `cv_documents.revision` naik tepat satu **dalam transaksi delete**. Delete sumber yang tidak terpilih tidak menaikkan revision CV. Akun tanpa CV tetap dapat menghapus. Dibuktikan pgTAP + integration.
10. **Reopen dan dismiss.** Achievement terpilih yang di-reopen menjadi draft (atau di-dismiss) berstate `unconfirmed`; konfirmasi ulang membuatnya `changed` (bukan `fresh` diam-diam). Dibuktikan pgTAP + integration.
11. **Edit activity sumber.** `relink_activity_project` atas activity yang derived achievement-nya terpilih membuat item achievement `changed` (context berubah), tanpa write ke CV dan tanpa mengubah wording. `update_activity` (raw text) tidak mengubah state item. Dibuktikan integration (kalimat selesai rencana).
12. **Protokol lock tanpa deadlock.** Race nyata dua koneksi ×3 putaran tanpa `40P01`: (a) edit sumber vs `resolve_cv_freshness` atas item yang sama, (b) delete sumber vs `remove_cv_item`/`save_cv_edits`, (c) `relink_achievement_project` vs `select_cv_source` untuk achievement yang sama, (d) delete sumber vs `resolve_cv_freshness`. Hasilnya konsisten: sukses, `STALE_REVISION`, `CV_SOURCE_CHANGED`, atau `CV_SOURCE_NOT_FOUND`. Dibuktikan integration.
13. **Dashboard *CV needs review*.** S04 menampilkan dua check terpisah: jumlah item yang perlu review (`changed` + `deleted` + `unconfirmed` + profil `changed`) dan jumlah achievement confirmed yang belum dipilih (*available*), masing-masing menautkan ke `/cv`. Check bernilai 0 tidak tampil; angka cocok fixture; akun tanpa CV: review 0, available = jumlah achievement confirmed. Dibuktikan integration + E2E.
14. **UI S13.** Badge teks untuk *Source changed*, *Saved wording kept*, *Source deleted*, *Source unconfirmed* (bersama *Manual wording* T19); ringkasan *N items need review* dengan tautan ke tiap item; panel review yang membandingkan versi tersimpan dan sumber terbaru (field yang berbeda) serta wording manual; aksi sesuai §2.2.3; *Refresh all items without manual wording*; item unconfirmed menautkan ke detail achievement; aksi review nonaktif selama wording item/profil tersebut punya draft belum tersimpan; `CV_SOURCE_CHANGED` memuat ulang data dengan notice tanpa membuang draft lain; preview berubah hanya setelah resolusi tersimpan. Dibuktikan unit `cv-builder-state` + E2E.
15. **Ownership.** `get_cv_freshness` dan `get_cv_review_summary` hanya mengembalikan data pemanggil; `resolve_cv_freshness` dengan item akun lain atau ID acak → `CV_ITEM_NOT_FOUND` (tidak dapat dibedakan). Dibuktikan pgTAP + integration.
16. **Aksesibilitas dan responsive.** `/cv` dengan item changed/deleted/unconfirmed dan S04 dengan check CV lulus axe (0 pelanggaran serius/kritis) pada 360 px dan 1440 px, light dan dark; panel review dapat dioperasikan dengan keyboard, fokus kembali ke elemen logis setelah resolusi, hasil diumumkan lewat live region, status tidak hanya warna. Dibuktikan E2E + axe.
17. **Tanpa perubahan perilaku lama.** T18/T19 dan seluruh suite T02–T17, gate M2/M3 tetap lulus tanpa melemahkan assertion; perubahan fungsi delete hanya menambah lock CV dan kenaikan revision CV (nilai kembali, kode error, dan efek lain identik). Konfirmasi achievement tetap tidak menambah item CV. Tidak ada export, refresh otomatis, atau AI. Dibuktikan regresi penuh.
18. **Log hygiene.** Error, detail, respons service/action, dan log tidak memuat teks CV/sumber (sentinel = 0); correlation ID respons error action = ID service. Tidak ada `console.` di `src/features/cv` dan `src/features/dashboard`. Dibuktikan integration + unit + grep.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration forward-only T20 dan pgTAP `cv_freshness.test.sql`.
- Domain `src/domain/cv/freshness.ts` dan perluasan `contracts.ts`.
- Service `getFreshness`, `resolveFreshness`, action `resolveCvFreshnessAction`, pemetaan error baru, kunci i18n en/id.
- UI S13 (badge, ringkasan, panel review, aksi) dan check dashboard S04.
- Integration `cv-freshness.test.ts`, E2E `cv-freshness.spec.ts`, script baru, decision 0026, receipt.

### 2.2 Keputusan implementasi

1. **Freshness dihitung saat dibaca, bukan ditulis saat sumber diedit.** Edit sumber tidak menyentuh `cv_items`/`cv_documents`; state dihitung oleh fungsi SQL dari revision dan snapshot live. *Alasan:* DB §5 "compute freshness from the live source revision"; menulis CV dari setiap update sumber memaksa semua RPC update T03/T08/T09/T14/T16 masuk protokol lock CV dan membuka siklus lock dengan RPC CV (CV → sumber). T21 memvalidasi freshness di bawah lock saat request export.
2. **Definisi state (satu sumber kebenaran SQL).** `internal.cv_item_state(p_item public.cv_items) returns text`, prioritas: `deleted` bila `source_deleted`; `unconfirmed` bila achievement sumber berstatus selain `confirmed`; `fresh` bila revision live = `source_revision` **atau** snapshot live = `source_snapshot`; `kept` bila revision live = `acknowledged_revision`; selain itu `changed`. Profil: `internal.cv_profile_state(p_document public.cv_documents) returns text` membandingkan tujuh field tampilan profil live dengan key sumber di `profile_snapshot` (abaikan `schema_version` dan `display_overrides`): sama → `fresh`; berbeda dan `profile_ack_revision = profiles.revision` → `kept`; selain itu `changed`. *Alasan:* revision saja menghasilkan *changed* palsu (mis. edit metrics, skill link, `activity_id` dilepas oleh `delete_activity`, locale profil) yang tidak mengubah apa pun di CV; DB §2 hanya menyebut nama/contact/summary untuk profil. T21 wajib memakai fungsi yang sama.
3. **Aksi per state (menunggu persetujuan, §2.4.1).** RPC menerima `keep`, `refresh`, `replace` untuk item `changed` atau `kept`, dan untuk profil `changed`/`kept`. UI S13:
   - item `changed` **tanpa** override: aksi utama *Refresh from source* (`refresh`), sekunder *Keep saved wording* (`keep`);
   - item `changed` **dengan** override: panel menampilkan wording manual, wording sumber lama (snapshot) dan wording sumber baru; aksi utama *Keep my wording* (`refresh` — detail lain diperbarui, override tetap), sekunder *Replace from source* (`replace`);
   - item `kept`: badge *Saved wording kept* dan aksi opsional *Refresh from source*;
   - profil: sama, dengan override = `display_overrides`/`summary_override`;
   - *Refresh all items without manual wording*: satu batch `refresh` untuk semua item `changed` tanpa override (PRD "Refresh updates only items without manual overrides").
   `kept` untuk item ber-override tidak ditawarkan di UI (RPC tetap menerimanya). *Alasan:* PRD memberi item ber-override pilihan Keep wording/Replace; release scenario menuntut *refresh without losing the override*; F07 menuntut *Keep saved wording* eksplisit sebagai jalan item stale yang valid.
4. **Satu RPC resolusi: `public.resolve_cv_freshness(p_expected_revision integer, p_resolutions jsonb) returns table (cv_revision integer, added_parent_item_ids uuid[])`.** `p_resolutions` array 1–200 objek `{ "target": "item"|"profile", "item_id": uuid (hanya untuk item), "source_revision": integer, "action": "keep"|"refresh"|"replace" }`; key asing, item ganda, lebih dari satu entri profil → `INVALID_CV_INPUT`. `source_revision` adalah revision live yang dilihat pengguna (untuk profil: `profiles.revision`). Semua validasi sebelum write; satu `update cv_documents` di akhir (trigger `touch_mutable_row`). Tidak ada no-op diam-diam: setiap resolusi valid mengubah sesuatu. *Alasan:* pola `save_cv_edits` (decision 0025 poin 1–2); acknowledgement terikat ke revision yang ditinjau.
5. **Urutan lock RPC CV (diperluas dari decision 0024 poin 10).** profil `for share` (`internal.cv_actor`) → `cv_documents for update` (`internal.cv_lock`) → item yang disentuh `for update` urut `id` → sumber `for share` dalam urutan kanonik **experience → project → achievement → education → skill → certification**, masing-masing urut `id`. Urutan sumber kanonik ini sama dengan jalur `delete_activity`/`delete_project`/`relink_*` T09 (experience → project → activity → achievement). Refresh yang menambah parent mengunci parent sebelum achievement. *Alasan:* menghindari siklus dengan relink/propagasi context.
6. **Jalur delete sumber mengambil lock CV lebih dulu.** Helper `internal.cv_lock_for_source_change(p_user_id uuid) returns uuid`: profil `for share` lalu `cv_documents for update` milik pengguna (NULL bila belum ada CV). Dipanggil di awal `delete_experience`, `delete_project` (T09), `delete_achievement`, dan `internal.delete_foundation_record` (education, certifications, skills, projects-lama) **sebelum** baris sumber dikunci. Setelah delete, bila ada item CV yang menjadi `source_deleted` dalam transaksi ini, jalankan `update cv_documents set updated_at = updated_at` sekali. Body fungsi lain disalin apa adanya dari definisi terakhir (Fase 0 mencatat file:baris) — hanya dua sisipan itu. *Alasan:* rencana §3 menuntut invalidasi dan increment revision CV di transaksi delete; tanpa lock CV di depan, jalur delete (sumber → item → dokumen) dan `remove_cv_item` (dokumen → item) membentuk siklus. Dengan lock dokumen di depan, keduanya terserialisasi per akun.
7. **`select_cv_source` mengunci parent sebelum achievement.** `create or replace` dengan perubahan minimal: baca achievement tanpa lock untuk menemukan parent, kunci parent `for share`, lalu kunci achievement `for share`, ulangi pembacaan parent; bila parent berubah di antara keduanya → `CV_SOURCE_CHANGED` (dapat diulang). Perilaku lain (duplikat, eligibility, return) identik dan pgTAP `cv_selection.test.sql` tetap lulus tanpa perubahan. *Alasan:* T18 mengunci achievement lalu parent, berlawanan dengan `relink_achievement_project` (project → achievement); race nyata dapat menghasilkan `40P01`.
8. **Deleted dan unconfirmed hanya diselesaikan lewat Remove atau perbaikan sumber.** Tidak ada aksi resolusi untuk keduanya. Item unconfirmed menautkan `/achievements/<id>` (konfirmasi ulang lalu review sebagai `changed`). Remove memakai `remove_cv_item` T18 apa adanya.
9. **RPC baca.** `public.get_cv_freshness() returns table (target text, item_id uuid, state text, live_revision integer, live_snapshot jsonb)`: satu baris per item plus satu baris `target = 'profile'`; `live_snapshot` hanya untuk state `changed`/`kept` (item: `internal.cv_source_snapshot`, profil: objek tujuh field `cv-profile.v1`), selain itu NULL. `public.get_cv_review_summary() returns table (has_cv boolean, review_count integer, available_count integer)`. Keduanya `security definer`, `stable`, memakai `auth.uid()` tanpa lock, hanya data pemanggil, akun `deleting` → tanpa baris. Grant hanya `authenticated`. *Alasan:* snapshot builder internal tidak diekspos ke klien; RLS cukup untuk tabel tetapi fungsi state butuh sumber lintas tabel.
10. **Dashboard memakai RPC terpisah.** `get_dashboard_summary` T12 tidak diubah (menghindari drop/recreate return type). `dashboard-service.ts` memanggil `get_cv_review_summary` paralel; dua check baru di bagian *Needs attention*: `dashboard.checkCvReview{One,Other}` → `/cv#cv-review`, `dashboard.checkCvAvailable{One,Other}` → `/cv#cv-pool-achievements`. Check tampil hanya bila > 0. *Alasan:* R03 label terpisah; kontrak T12 tetap.
11. **Draft lokal T19 dilindungi.** Aksi review untuk item (atau profil) dinonaktifkan dengan keterangan *Save or discard your wording first* selama `draft` T19 untuk target itu dirty. Setelah resolusi sukses, data dimuat ulang lewat jalur `syncDraft` T19; draft target lain tetap. `CV_SOURCE_CHANGED` → reload + notice *The source changed again; review the latest version*.
12. **Preview tetap dari data tersimpan.** `buildCvPreviewModel` tidak menerima state freshness; preview berubah karena snapshot tersimpan berubah setelah `refresh`/`replace`. Indikator review hanya di panel editor.
13. **Kode error DB baru:** `CV_SOURCE_CHANGED` (service `SOURCE_CHANGED`, `cv.error.sourceChanged`, action `CONFLICT`), `CV_RESOLUTION_INVALID` (service `RESOLUTION_INVALID`, `cv.error.resolutionInvalid`, action `VALIDATION`). Kode T18/T19 dipakai ulang.
14. **Nomor.** Migration `supabase/migrations/20261004090000_t20_cv_freshness_deletion.sql` (parity 30/30). Decision `docs/decisions/0026-t20-cv-freshness-deletion.md`. pgTAP `supabase/tests/database/cv_freshness.test.sql`. Integration `tests/integration/cv-freshness.test.ts` (script baru `test:integration:cv-freshness`). E2E `tests/e2e/cv-freshness.spec.ts` (script baru `test:e2e:cv-freshness`, `playwright.cv-freshness.config.ts`, port **3013** — port 3000–3012 sudah dipakai; Fase 0 memverifikasi).
15. **Komponen UI memakai primitives yang ada** (`Button`, `Badge`, `Dialog`, `InlineError`, `ActionFeedback`, `SubmitButton`, `RevisionConflict`/`conflict-controls`) dan pola T19 (`cv-panels.tsx`, `cv-section.tsx`, `cv-builder-state.ts`). Aturan state UI baru ditaruh sebagai fungsi murni di `cv-builder-state.ts` agar teruji unit (proyek tidak punya DOM test environment; decision 0025 poin 12). Ikon hanya lucide-react.

### 2.3 Di luar scope

- Validasi dan request export, blokir export, snapshot immutable, worker PDF → **T21**. Halaman `/cv/preview`, link blokir S14 → S13, download, regenerate → **T22**.
- Refresh otomatis, notifikasi, atau penulisan CV dari jalur update sumber.
- Perubahan RPC update sumber (`update_*`, `save_achievement`, `relink_*`, `update_activity`, `apply_ai_suggestion`, `commit_import_batch`) dan perubahan `get_dashboard_summary`.
- Penanda *source changed* di S08 untuk activity/AI (milik T14) dan perubahan S07/S10.
- Kolom atau tabel baru; drag-and-drop, bulk-add, target job, CV variants, AI, evidence di CV.

### 2.4 Keputusan produk yang menunggu persetujuan pengguna

Pelaksana mencatat jawaban di receipt Fase 0. Tanpa persetujuan semua poin, **stop** setelah baseline.

1. §2.2.3 pemetaan aksi: item tanpa override → *Refresh from source* / *Keep saved wording*; item ber-override → *Keep my wording* (refresh detail, override tetap) / *Replace from source*; plus *Refresh all items without manual wording*.
2. §2.2.2 revision yang naik tanpa perubahan tampilan dianggap `fresh`; profil hanya membandingkan tujuh field tampilan.
3. §2.2.6 fungsi delete T03/T08/T09 diubah (lock CV di depan + kenaikan revision CV) lewat `create or replace` dengan perubahan minimal.
4. §2.2.7 `select_cv_source` T18 diubah ke urutan parent-dulu dengan error baru `CV_SOURCE_CHANGED` saat parent berubah di tengah.
5. §2.2.10 dashboard: dua check terpisah; tanpa CV, *available* = jumlah achievement confirmed.
6. §2.2.11 aksi review nonaktif selama wording target itu belum disimpan.

## 3. Kontrak teknis

### 3.1 Migration `20261004090000_t20_cv_freshness_deletion.sql`

Forward-only; tidak mengubah tabel. Pola errcode/`detail`, `security definer`, `set search_path = pg_catalog`, identifier ter-qualify, revoke/grant, dan `comment on function` mengikuti T18/T19.

1. **Helper state.**
   - `internal.cv_live_source(p_item public.cv_items) returns table (source_type text, source_id uuid, live_revision integer, live_snapshot jsonb, achievement_status text)` — dari kolom sumber non-NULL; memakai `internal.cv_source_revision`/`internal.cv_source_snapshot`.
   - `internal.cv_item_state(p_item public.cv_items) returns text` (§2.2.2).
   - `internal.cv_profile_display(p_user_id uuid) returns jsonb` (tujuh field profil live) dan `internal.cv_profile_state(p_document public.cv_documents) returns text`.
   - Semua `stable`, revoke dari `public, anon, authenticated, service_role` (pola grant helper T19 F2).
2. **`internal.cv_lock_for_source_change(p_user_id uuid) returns uuid`** (§2.2.6). Revoke penuh.
3. **`public.get_cv_freshness()`** dan **`public.get_cv_review_summary()`** (§2.2.9). `review_count` = item `changed`/`deleted`/`unconfirmed` + 1 bila profil `changed`. `available_count` = achievement `confirmed` milik pengguna tanpa item CV. Execute hanya `authenticated`.
4. **`public.resolve_cv_freshness(p_expected_revision integer, p_resolutions jsonb)`** (§2.2.4):
   - `internal.cv_actor()`; belum onboarding → `ONBOARDING_REQUIRED`.
   - Bentuk input invalid → `INVALID_CV_INPUT` (sebelum lock dokumen bila memungkinkan, tanpa teks nilai di pesan).
   - `internal.cv_lock` → `STALE_REVISION`/`CV_NOT_FOUND`.
   - Item disentuh `for update` urut `id`; bukan milik CV pemanggil → `CV_ITEM_NOT_FOUND`.
   - Sumber `for share` dengan urutan kanonik §2.2.5; sumber hilang → `CV_SOURCE_NOT_FOUND`.
   - Per resolusi: hitung state di bawah lock. `deleted`/`fresh`, atau `keep` pada target yang sudah `kept` → `CV_RESOLUTION_INVALID`; `unconfirmed` → `CV_SOURCE_INELIGIBLE`; `source_revision` ≠ live → `CV_SOURCE_CHANGED`; `replace` tanpa override → `CV_RESOLUTION_INVALID`.
   - `keep`: `acknowledged_revision = live`. `refresh`: `source_snapshot = live_snapshot`, `source_revision = live`, `acknowledged_revision = NULL`, `override_text` tetap. `replace`: refresh + `override_text = NULL`. Achievement dengan parent baru yang belum terpilih: kunci parent (sebelum achievement, §2.2.5) dan tambahkan lewat `internal.cv_append_item`; ID dikembalikan di `added_parent_item_ids`.
   - Profil: `keep` → `profile_ack_revision = profiles.revision`; `refresh` → tujuh key sumber di `profile_snapshot` diganti nilai live, `schema_version` dan `display_overrides` tetap, `profile_source_revision = profiles.revision`, `profile_ack_revision = NULL`; `replace` → refresh + hapus `display_overrides` + `summary_override = NULL`.
   - Satu `update cv_documents` di akhir; return revision baru.
5. **Fungsi delete** (§2.2.6): `create or replace` `public.delete_experience(uuid, integer)`, `public.delete_project(uuid, integer)`, `public.delete_achievement(uuid, integer)`, `internal.delete_foundation_record(text, uuid, integer)`. Signature, return, grant, dan comment tetap. Sisipan: (a) `perform internal.cv_lock_for_source_change(v_user_id)` setelah validasi auth dan sebelum lock sumber pertama; (b) sebelum delete, catat apakah ada `cv_items` yang mereferensikan sumber; (c) setelah delete sukses, bila ada, satu `update cv_documents set updated_at = updated_at where user_id = v_user_id`.
6. **`public.select_cv_source(integer, text, uuid)`** (§2.2.7).
7. Grant: tidak ada grant tulis tabel baru. `pnpm db:types` memperbarui `src/server/supabase/database.types.ts`.

### 3.2 Domain

- `contracts.ts` (ubah): `CV_ERROR_CODES` + `CV_SOURCE_CHANGED`, `CV_RESOLUTION_INVALID`; `CV_FRESHNESS_STATES = ['fresh','changed','kept','deleted','unconfirmed']`; `cvFreshnessRowSchema` (strict; `live_snapshot` divalidasi dengan skema sumber/profil yang ada); `cvReviewSummarySchema`; `resolveCvFreshnessInput` (`expected_revision`, `resolutions` 1–200, satu entri profil maks, tanpa item ganda, `source_revision` int ≥ 1).
- `freshness.ts` (baru, murni): `indexFreshness(rows)`; `availableActions({ state, hasOverride, target })` (§2.2.3); `primaryAction(...)`; `diffDisplayFields(saved, live, type)` → daftar field tampilan yang berbeda (headline, subline, tanggal, teks) memakai `labels.ts`/`resolve.ts` T19; `needsReview(state)`; `reviewCount(rows)`; `bulkRefreshResolutions(rows, items)` (hanya `changed` tanpa override).

### 3.3 Service, action, dashboard, i18n

- `cv-service.ts`: `getFreshness()` (RPC `get_cv_freshness`, Zod, map per item + profil), `resolveFreshness(input)` (Zod, RPC, receipt `{ cvRevision, addedParentItemIds }`, pemetaan error dengan `correlationId`).
- `cv-errors.ts`: dua kode baru (§2.2.13).
- `actions.ts`: `resolveCvFreshnessAction` lewat `run()` T19 (correlation ID tunggal, `revalidatePath('/cv')` dan `revalidatePath('/')` hanya setelah sukses — Fase 0 memverifikasi path dashboard).
- `src/domain/dashboard/{contracts,links}.ts`, `src/features/dashboard/{dashboard-service,dashboard-view}.tsx`: `cvReview: { hasCv, reviewCount, availableCount }`, tautan, dua `CheckLink` (§2.2.10). Kegagalan RPC CV = `UNAVAILABLE` seperti check lain.
- `src/i18n/messages.ts`: kunci en **dan** id untuk badge, ringkasan, panel review (*Saved on CV*, *Current source*, *Your wording*), aksi, notice, keterangan nonaktif, error baru, check dashboard (bentuk One/Other).

### 3.4 UI S13

- `src/app/(workspace)/cv/page.tsx`: muat `getFreshness()` bersama `getCv`/`getSelectionPool` (paralel); oper ke `CvBuilder`.
- Ringkasan review (`id="cv-review"`) di bawah bar Save: *N items need review*, daftar tautan ke item, tombol *Refresh all items without manual wording* (hanya bila ada kandidat). Tanpa item review → tidak dirender.
- Baris item (`cv-section.tsx`): badge state teks; tombol *Review change* membuka panel (progressive disclosure, `aria-expanded`). Panel (`cv-review.tsx`): tabel dua kolom *Saved on CV* vs *Current source* untuk field berbeda, wording manual bila ada, aksi §2.2.3. Deleted: teks penjelasan + *Remove* (T19). Unconfirmed: teks + tautan *Open achievement* + *Remove*.
- Profil (`cv-panels.tsx`): badge dan panel yang sama untuk profil.
- Pool achievement mendapat `id="cv-pool-achievements"` sebagai target tautan dashboard.
- Live region T19 mengumumkan hasil; fokus kembali ke tombol *Review change* item (atau ke ringkasan bila item hilang).

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20261004090000_t20_cv_freshness_deletion.sql`, `supabase/tests/database/cv_freshness.test.sql` |
| Modify | `src/server/supabase/database.types.ts` (`db:types`) |
| Create | `src/domain/cv/freshness.ts` |
| Modify | `src/domain/cv/contracts.ts`, `src/features/cv/{cv-service,cv-errors,actions,cv-builder,cv-section,cv-panels,cv-builder-state}.ts(x)`, `src/app/(workspace)/cv/page.tsx`, `src/i18n/messages.ts`, `src/app/globals.css` (bila perlu) |
| Create | `src/features/cv/cv-review.tsx` |
| Modify | `src/domain/dashboard/{contracts,links}.ts`, `src/features/dashboard/{dashboard-service.ts,dashboard-view.tsx}` |
| Create | `tests/unit/cv-freshness.test.ts`; perluas `tests/unit/{cv-contracts,cv-service,cv-actions,cv-builder-state}.test.ts` dan test unit dashboard yang ada (Fase 0 mencatat namanya) |
| Create | `tests/integration/cv-freshness.test.ts`, `tests/e2e/cv-freshness.spec.ts`, `playwright.cv-freshness.config.ts` |
| Modify | `package.json` (script baru), `README.md` (Fase 7) |
| Create (Fase 7) | `docs/decisions/0026-t20-cv-freshness-deletion.md`, `docs/verification/T20-cv-freshness-deletion.md` |

Script baru:

- `test:integration:cv-freshness` → `vitest run --config vitest.integration.config.ts --configLoader native tests/integration/cv-freshness.test.ts`
- `test:e2e:cv-freshness` → `playwright test --config playwright.cv-freshness.config.ts tests/e2e/cv-freshness.spec.ts`

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD. Working tree harus bersih kecuali `.claude/`. Jika tidak, **stop**.
- [ ] `pnpm install --frozen-lockfile`, `pnpm db:status`, `pnpm exec supabase migration list --local`. Parity harus **29/29** dengan migration terakhir `20261003100000_t19_cv_override_helper_grants.sql`. Bila Docker mati, nyalakan dan `pnpm db:start` (tanpa reset).
- [ ] Baseline `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan 87 file / 635 test), `pnpm db:test` (harapan 13 file / 979 assertion), `pnpm test:integration:cv-builder` (harapan 7), `pnpm test:integration:cv` (harapan 10), `pnpm test:integration:dashboard` (harapan 4).
- [ ] Verifikasi dari source dan catat file:baris untuk:
  - Definisi **terakhir** `public.delete_experience`, `public.delete_project`, `public.delete_achievement` (harapan `20260922100000_t09_achievements_skills.sql` sekitar baris 1204, 1125, 911) dan `internal.delete_foundation_record` (harapan `20260916124500_fix_foundation_rpc_row_checks.sql:132`); pastikan tidak ada definisi lebih baru di migration T10–T19. Catat lock pertama di tiap fungsi dan apakah ada lock profil `for update` (bila ada lock profil `for update` setelah titik sisipan, **stop**).
  - Urutan lock `relink_achievement_project`, `relink_activity_project`, `update_project` (propagasi context), `save_achievement` (reopen/dismiss/confirm), dan `update_activity`; konfirmasi urutan experience → project → activity → achievement dan apakah `update_activity` menyentuh achievement.
  - `select_cv_source`, `internal.cv_source_snapshot`, `internal.cv_source_revision`, `internal.cv_actor`, `internal.cv_lock`, `internal.cv_append_item` (`20261002090000_t18_cv_schema_selection.sql`), dan `save_cv_edits` (`20261003090000_t19_cv_builder_overrides.sql`).
  - Field profil yang masuk `profile_snapshot` (tujuh key di `ensure_cv_document`) dan nama kolom `profiles` terkait; jalur `commit_import_batch` yang mengubah profil.
  - `src/features/cv/{cv-service,cv-errors,actions,cv-builder,cv-section,cv-panels,cv-builder-state,cv-view}.ts(x)`, `src/domain/cv/{contracts,draft,resolve,labels,preview}.ts` (cara `syncDraft`, live region, fokus, `isDirty` per target).
  - Dashboard: `src/features/dashboard/*`, `src/domain/dashboard/*`, path halaman dashboard (`revalidatePath`), kunci i18n `dashboard.check*`, test unit dan E2E dashboard yang ada.
  - Port 3013 bebas (`grep -n "PORT" playwright.*.config.ts`) dan pola `playwright.cv.config.ts`.
- [ ] Tanyakan/catat persetujuan pengguna atas §2.4. Bila belum disetujui, **stop** dan serahkan receipt.
- [ ] Tulis receipt Fase 0 `docs/verification/T20-phase0-baseline.md`. Commit `docs(t20): add phase 0 baseline receipt`.

### Fase 1 — Database (TDD pgTAP)

- [ ] Tulis `supabase/tests/database/cv_freshness.test.sql` yang gagal lebih dulu (pola `cv_builder.test.sql`). Assertion minimum:
  1. Struktur: fungsi baru ada, `prosecdef`, execute RPC hanya `authenticated`, helper internal tanpa grant; tidak ada grant tulis baru.
  2. State item (§1.1): fresh awal; edit sumber tampilan → `changed`; edit yang tidak mengubah snapshot (mis. metrics achievement, `achievement_skills`) → `fresh`; source delete → `deleted`; reopen/dismiss → `unconfirmed`; konfirmasi ulang → `changed`.
  3. Edit sumber tidak menulis CV (§1.2): `cv_items` (snapshot, override, revision) dan `cv_documents.revision` sama sebelum/sesudah untuk keenam tipe.
  4. Keep (§1.3): `kept`; edit kedua → `changed`; snapshot/override tetap.
  5. Refresh/Replace (§1.4–§1.5): snapshot = live, `source_revision` = live, ack NULL, override tetap; replace mengosongkan override; replace tanpa override → `CV_RESOLUTION_INVALID`; refresh achievement yang di-relink ke project belum terpilih menambah parent dan mengembalikan ID-nya.
  6. Penolakan (§1.6): `CV_SOURCE_CHANGED`, `STALE_REVISION`, `CV_RESOLUTION_INVALID` (fresh/deleted), `CV_SOURCE_INELIGIBLE` (unconfirmed), input invalid → `INVALID_CV_INPUT`, semuanya tanpa write.
  7. Batch (§1.7): banyak resolusi → revision +1; satu invalid → tidak ada perubahan.
  8. Profil (§1.8): edit nama/headline/summary/contact → `changed`; locale/timezone → `fresh`; keep/refresh/replace sesuai §3.1.4 dengan `display_overrides` dan `summary_override` dipertahankan kecuali replace.
  9. Delete (§1.9): keenam jalur → `source_deleted`, snapshot dan override utuh, revision CV +1; sumber tidak terpilih → revision CV tetap; akun tanpa CV → delete sukses; nilai kembali fungsi delete identik dengan sebelum T20.
  10. `select_cv_source` (§2.2.7): seluruh perilaku T18 tetap (jalankan ulang `cv_selection.test.sql` tanpa perubahan).
  11. Summary dan ownership (§1.13, §1.15): `get_cv_review_summary` (dengan/tanpa CV), `get_cv_freshness` hanya baris pemanggil, item akun B → `CV_ITEM_NOT_FOUND`.
- [ ] Pastikan `pnpm db:test` **FAIL** karena test baru. Tulis migration §3.1, lalu `pnpm exec supabase migration up --local`. **Dilarang** `db reset`.
- [ ] `pnpm db:test` (PASS, termasuk semua file lama tanpa perubahan; catat total), `pnpm db:lint`, `pnpm db:types`, migration list (30/30).
- [ ] Commit `feat(t20): add CV freshness RPCs and source-delete invalidation`, lalu receipt Fase 1. Checkpoint Claude dianjurkan (fungsi delete lintas domain berubah).

### Fase 2 — Domain murni (TDD unit)

- [ ] Test gagal lebih dulu:
  - `cv-contracts`: kode error baru; `resolveCvFreshnessInput` (batas 1–200, satu profil, tanpa ID ganda, aksi enum, revision ≥ 1); `cvFreshnessRowSchema` menolak state/key asing.
  - `cv-freshness`: `availableActions`/`primaryAction` untuk setiap kombinasi state × override × target (§2.2.3); `diffDisplayFields` untuk keenam tipe dan profil (tanggal parsial, NULL tanpa placeholder, locale tidak menerjemahkan konten); `reviewCount`; `bulkRefreshResolutions` hanya memilih `changed` tanpa override dan membawa `live_revision`.
- [ ] Implementasi §3.2 hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t20): add CV freshness domain rules`, receipt Fase 2.

### Fase 3 — Service, action, dashboard backend (TDD unit)

- [ ] Test gagal lebih dulu:
  - `cv-service`: `getFreshness` memvalidasi baris; `resolveFreshness` memetakan setiap kode DB → kode service + `messageKey` + `correlationId`; receipt membawa revision dan parent baru; pesan error tanpa sentinel.
  - `cv-actions`: validasi `resolveCvFreshnessAction`; `revalidatePath` hanya setelah sukses; correlation ID error = ID service.
  - Dashboard service/contracts: `cvReview` dipetakan; RPC gagal → `UNAVAILABLE`.
  - Parity kunci i18n en/id.
- [ ] Implementasi §3.3 (tanpa UI) hingga PASS. `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(t20): add CV freshness service, action and dashboard summary`, receipt Fase 3.

### Fase 4 — UI S13 dan S04 (TDD unit state)

- [ ] Test gagal lebih dulu (`cv-builder-state.test.ts` dan test unit dashboard/komponen yang ada): badge/teks per state; ringkasan dan kandidat bulk refresh; aksi nonaktif saat draft target dirty (§2.2.11); urutan fokus setelah resolusi/hapus; pesan live region; reload saat `CV_SOURCE_CHANGED` mempertahankan draft target lain; dashboard menampilkan dua check hanya bila > 0 dengan tautan benar.
- [ ] Implementasi §3.4 dan check dashboard. Tanpa `console.`. Reduced motion dihormati.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Commit `feat(t20): add CV review UI and dashboard CV checks`, receipt Fase 4.

### Fase 5 — Integration nyata

- [ ] `tests/integration/cv-freshness.test.ts` (setup seperti `cv-builder.test.ts`: admin, owner A/B nyata, onboarding dan sumber lewat RPC nyata). Skenario wajib:
  1. Release scenario PRD (§1.3–§1.4, §1.9): achievement terpilih + override → edit achievement → `changed` → `refresh` → override tetap, snapshot baru → edit kedua → `changed` → `keep` → edit ketiga → `changed` → delete achievement → `deleted`, override dan snapshot utuh, revision CV +1.
  2. Keenam tipe sumber: edit → `changed`, refresh → `fresh`; tidak ada write CV pada edit.
  3. Context (§1.11): `relink_activity_project` pada activity yang derived achievement-nya terpilih → item `changed`; refresh menambah parent project baru bila belum terpilih; `update_activity` raw text → tetap `fresh`; `delete_activity` → tetap `fresh`.
  4. Reopen/dismiss/konfirmasi ulang (§1.10).
  5. Profil (§1.8): `update_profile` dan `commit_import_batch` dengan field profil → `changed`; resolusi profil.
  6. Race (§1.12): skenario (a)–(d) dengan dua client paralel ×3 putaran; catat hasil tiap putaran; tanpa `40P01`.
  7. Dashboard (§1.13): `get_cv_review_summary` cocok fixture (dengan dan tanpa CV), lewat `createDashboardService`.
  8. Ownership dan log hygiene (§1.15, §1.18): sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>` di sumber, override, dan judul tidak muncul di error/detail/respons error.
- [ ] Tambah script `test:integration:cv-freshness`, jalankan. Commit `test(t20): add CV freshness integration suite`, receipt Fase 5.

### Fase 6 — Browser acceptance dan regresi penuh

- [ ] `playwright.cv-freshness.config.ts` (port 3013; salin pola `playwright.cv.config.ts`), script `test:e2e:cv-freshness`.
- [ ] `tests/e2e/cv-freshness.spec.ts` (fixture akun via admin, cleanup) — build produksi nyata, tanpa AI: (1) achievement terpilih tanpa override diedit di S08 → `/cv` badge *Source changed* → panel menampilkan perbedaan → *Refresh from source* → preview berubah, badge hilang; (2) item ber-override → *Keep my wording* → wording tetap, detail baru; lalu *Replace from source* pada edit berikutnya; (3) *Keep saved wording* → badge *Saved wording kept* → edit sumber lagi → *Source changed*; (4) delete sumber → *Source deleted* + Remove; reopen achievement → *Source unconfirmed* + tautan; (5) profil berubah di S12 → review profil; (6) *Refresh all items without manual wording* melewati item ber-override; (7) aksi nonaktif saat draft wording belum disimpan; (8) dashboard S04 menampilkan dua check dan tautannya membuka `/cv` pada bagian yang benar; (9) keyboard-only untuk satu alur review + fokus + live region; (10) responsive 360/1440 px × light/dark tanpa scroll horizontal + axe 0 pelanggaran serius/kritis untuk `/cv` dan S04; (11) reduced motion. Simpan `test-results` dan screenshot 360/1440 di receipt.
- [ ] Jalankan seluruh §7. `test:e2e:m2`, `test:e2e:m3` wajib lulus tanpa melemahkan assertion env (kosongkan `AI_AGENT`/`ANTHROPIC_BASE_URL` untuk run itu). ClamAV dan Gotenberg wajib berjalan untuk suite yang membutuhkannya; bila tidak, catat **tidak dijalankan** beserta alasan. Flaky bawaan `activity-ui.spec.ts:356` dicatat sebagai flaky bila lulus saat diulang tanpa perubahan.
- [ ] Commit `test(t20): add CV freshness browser suite`, receipt Fase 6 `docs/verification/T20-phase6-browser-regression.md`. Serahkan kepada Claude: hash commit, diff, receipt Fase 0–6, output command, dan daftar acceptance yang belum terbukti.

### Fase 7 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] `docs/decisions/0026-t20-cv-freshness-deletion.md`: keputusan §2.2 poin 1–15 dan persetujuan §2.4, kode error baru, protokol lock lengkap (RPC CV, jalur delete, select), alternatif yang ditolak (menulis CV dari setiap update sumber, trigger update CV pada tabel sumber, perbandingan revision murni, auto-refresh, mengubah `get_dashboard_summary`, aksi Keep untuk deleted/unconfirmed), seam T21 (validasi export memakai `internal.cv_item_state`/`internal.cv_profile_state` di bawah lock dengan urutan §2.2.5; `changed` memblokir, `kept` lolos) dan T22 (S14 menautkan blokir ke `/cv#cv-review`).
- [ ] `docs/verification/T20-cv-freshness-deletion.md`: pass/fail/warning/tidak dijalankan, trace ke R03, R09, F03, F07, S04, S13, DB §2/§5/§6 dan setiap poin §1, termasuk screenshot 360/1440 light/dark.
- [ ] README (bagian CV: freshness, script baru, port 3013, tabel quality gates). `AGENTS.md` dan salinannya di `docs/` tetap identik bila disentuh (biasanya oleh `workpulse-task-closeout`).
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- Owner A (employee): sudah onboarding, locale `en`, timezone `Asia/Jakarta`. Experience current, project ber-experience, activity dengan derived achievement confirmed ber-project, achievement confirmed standalone, achievement confirmed belum dipilih (untuk *available*), education, skill `SQL`, certification. CV memuat semuanya kecuali achievement *available*; satu achievement dan satu experience ber-override; override profil `headline`.
- Owner A2 (graduate, tanpa CV) untuk `get_cv_review_summary` tanpa CV: dua achievement confirmed.
- Owner B: CV dan sumber sendiri untuk isolasi; sesi kedua untuk race.
- Sentinel privat: `WP-PRIVATE-CV-SENTINEL-<uuid>` di `cv_bullet` sumber, override, judul CV, dan headline profil A.
- Setiap test membersihkan akun fixture seperti suite lain.

## 7. Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm exec supabase migration list --local
pnpm test:integration:cv-freshness
pnpm test:integration:cv-builder
pnpm test:integration:cv
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:activity
pnpm test:integration:dashboard
pnpm test:integration:import-commit
pnpm test:integration:import-review
pnpm test:integration:import
pnpm test:integration:m2
pnpm test:integration:m3
pnpm test:integration:ai
pnpm test:integration:ai-review
pnpm test:integration:evidence
pnpm test:integration:storage
pnpm test:e2e:cv-freshness
pnpm test:e2e:cv
pnpm test:e2e:achievements
pnpm test:e2e:projects
pnpm test:e2e:dashboard
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:import
pnpm test:e2e:import-review
pnpm test:e2e:ai
pnpm test:e2e:ai-review
pnpm test:e2e:evidence
pnpm test:e2e:m2
pnpm test:e2e:m3
pnpm worker:check
pnpm build
git diff --check
```

`test:integration:cv-freshness` dan `test:e2e:cv-freshness` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `SUPABASE_SECRET_KEY` diambil dari `pnpm exec supabase status -o env` ke env proses saja; jangan dicetak atau disimpan (di mesin ini gunakan nilai `SERVICE_ROLE_KEY` JWT bila key format baru ditolak Kong). Muat env Supabase lokal (`.env.local` + key) dalam command yang sama dengan suite (env PowerShell tidak bertahan antar command). Jangan mem-pipe suite pnpm ke `Select-Object -First`; tangkap dengan `Out-String`. Untuk edit file ber-karakter non-ASCII gunakan tool Edit, bukan `Set-Content`. Playwright membangun produksi (`next build`); pastikan tidak ada server lain di port 3013.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, parity bukan 29/29, atau §2.4 belum disetujui pengguna.
- Penyelesaian memerlukan `db reset`, rewrite file migration lama, kolom/tabel baru, atau perubahan RPC update sumber, `get_dashboard_summary`, atau RPC CV T18/T19 selain `select_cv_source` (§2.2.7).
- Perubahan fungsi delete memerlukan lebih dari dua sisipan §3.1.5, mengubah nilai kembali/kode error, atau ada definisi delete yang lebih baru dari yang dicatat Fase 0.
- Fase 0 menemukan jalur yang mengunci profil `for update` atau sumber dalam urutan yang bertentangan dengan §2.2.5 sehingga protokol lock tidak dapat dipenuhi tanpa mengubah RPC lain.
- Race memicu `40P01` yang tidak hilang dengan urutan §2.2.5–§2.2.7.
- Implementasi terasa memerlukan request/validasi export, halaman `/cv/preview`, refresh otomatis, AI, atau penulisan `override_text` di luar `replace`.
- Test membutuhkan key nyata, atau sentinel muncul di output/log/screenshot.
- Perubahan pada suite lama (T02–T19) diperlukan agar lulus, selain penyesuaian kunci i18n/copy yang dicatat di receipt.

## 9. Gate review Claude (setelah Fase 6)

Review read-only mencakup:

- Fungsi state SQL: prioritas benar, perbandingan snapshot tidak membocorkan field privat, satu definisi yang akan dipakai T21; `get_cv_freshness` hanya field tampilan aman.
- `resolve_cv_freshness`: `security definer`/`search_path`/grant; urutan lock §2.2.5; validasi sebelum write; satu revision per batch; `refresh` tidak pernah menyentuh `override_text`; `keep` terikat revision live; parent ditambahkan saat context berubah.
- Edit sumber tidak menulis CV; tidak ada refresh otomatis.
- Diff fungsi delete dan `select_cv_source` terhadap definisi sebelumnya: hanya sisipan yang diizinkan; nilai kembali/kode error identik; invalidasi dan revision CV dalam transaksi delete; akun tanpa CV aman.
- Race tanpa `40P01`, hasil konsisten; tidak ada lost update override.
- Profil: hanya tujuh field memicu `changed`; `display_overrides`/`summary_override` dipertahankan kecuali replace.
- Dashboard: dua label terpisah, angka cocok fixture, `get_dashboard_summary` tidak berubah.
- UI: tidak ada overwrite diam-diam; draft T19 terlindungi; preview tetap dari data tersimpan; status tidak hanya warna; keyboard, fokus, live region; axe 360/1440 light/dark.
- Tidak ada fitur T21/T22 prematur atau roadmap.
- Log/error hygiene; tidak ada `console.`; semua suite lama tetap lulus; angka di receipt cocok dengan hasil ulang.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review focus — risiko yang paling mungkin lolos

1. **Refresh atau Replace menghapus override tanpa pilihan eksplisit.** Bulk refresh ikut memproses item ber-override, atau `refresh` menulis `override_text`. Dijaga pgTAP 5, unit `bulkRefreshResolutions`, integration 1, E2E (6).
2. **Acknowledgement tidak terikat revision.** `keep` menyimpan revision lama dari klien tanpa memeriksa live, atau state `kept` bertahan setelah edit berikutnya. Dijaga pgTAP 4/6 dan integration 1.
3. **Deadlock di jalur delete/select/resolve.** Sisipan lock CV ditempatkan setelah lock sumber, atau urutan sumber di `resolve_cv_freshness` berlawanan dengan relink. Dijaga integration 6 (empat skenario ×3) dan review diff fungsi.
4. **Changed palsu atau changed yang hilang.** Perbandingan revision murni menandai perubahan tak terlihat, atau perbandingan snapshot salah sehingga perubahan context tidak terdeteksi. Dijaga pgTAP 2, integration 2–3.
5. **Perubahan perilaku fungsi delete lama.** Nilai kembali, `STALE_REVISION`, atau jalur akun tanpa CV berubah. Dijaga pgTAP 9 dan regresi suite T03/T08/T09/M2.
6. **Draft wording pengguna hilang saat resolusi atau `CV_SOURCE_CHANGED`.** Reload membuang draft target lain, atau aksi review aktif ketika wording belum disimpan. Dijaga unit `cv-builder-state` dan E2E (7).

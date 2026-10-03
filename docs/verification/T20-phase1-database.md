# T20 Fase 1 — Database (receipt)

- Tanggal: 2 Oktober 2026
- Tujuan: migration forward-only T20 (state freshness SQL, RPC baca, `resolve_cv_freshness`, lock CV di jalur delete, `select_cv_source` parent-dulu) dan pgTAP `cv_freshness.test.sql`, dikerjakan TDD.

## File berubah

- Baru: `supabase/migrations/20261004090000_t20_cv_freshness_deletion.sql`, `supabase/tests/database/cv_freshness.test.sql`.
- Diubah: `src/server/supabase/database.types.ts` (hasil `supabase gen types`, +25 baris: tiga RPC baru; BOM asli dipertahankan).
- Diubah (lihat **Penyimpangan** di bawah): `supabase/tests/database/cv_selection.test.sql`, `tests/integration/cv-selection.test.ts`.

## Isi migration (ringkas)

- Helper internal (tanpa grant API): `cv_live_source`, `cv_item_state` (deleted > unconfirmed > fresh > kept > changed; revision naik tanpa perubahan snapshot = fresh), `cv_profile_display`, `cv_profile_state` (tujuh field), `cv_lock_for_source_change`.
- RPC: `get_cv_freshness`, `get_cv_review_summary`, `resolve_cv_freshness(p_expected_revision, p_resolutions)` (validasi bentuk sebelum lock; `cv_lock`; item `for update` urut id; sumber `for share` urut canonical experience → project → achievement → education → skill → certification, parent achievement dikunci sebelum achievement; satu `update cv_documents` di akhir = satu revision per batch; `refresh` tidak menyebut `override_text`; `replace` mengosongkan override / `display_overrides` + `summary_override`).
- `create or replace` dengan hanya dua sisipan: `delete_achievement`, `delete_project`, `delete_experience`, `internal.delete_foundation_record` (lock CV di depan lock sumber pertama; satu `update cv_documents set updated_at = updated_at` setelah delete yang memang mereferensikan item CV). Return value, kode error, signature, grant tidak berubah.
- `select_cv_source`: achievement membaca parent tanpa lock, mengunci parent lalu achievement, membaca ulang; parent berubah → `CV_SOURCE_CHANGED`.
- Error baru di DB: `CV_SOURCE_CHANGED`, `CV_RESOLUTION_INVALID` (belum dipetakan di service; Fase 3).

## Commands dan hasil aktual

| Command | Hasil |
| --- | --- |
| `pnpm db:test` (sebelum migration) | exit 1 — `cv_freshness.test.sql` gagal (fungsi belum ada), file lain ok |
| `pnpm exec supabase migration up --local` | exit 0, `20261004090000` diterapkan |
| `pnpm db:test` (sesudah) | exit 0 — **14 file / 1110 assertion, PASS** (`cv_freshness` 131 assertion baru; sebelumnya 13 file / 979) |
| `pnpm db:lint` | exit 0, `results: []` |
| `pnpm db:types` | exit 0; output ditulis ke `src/server/supabase/database.types.ts` |
| `supabase migration list --local` | **30/30**, terakhir `20261004090000` |
| `pnpm test:integration:achievements` / `projects` / `cv-builder` / `activity` / `dashboard` | exit 0 — 5/5, 7/7, 7/7, 6/6, 4/4 |
| `pnpm test:integration:cv` | exit 0 — 10/10, tiga kali berturut-turut (setelah penyesuaian di bawah) |
| `pnpm typecheck` | exit 0 |

Catatan proses: satu edit kecil pada migration (bentuk `unnest` multi-array → `rows from (...)`) dilakukan setelah `migration up`; file migration idempotent (`create or replace`, revoke/grant), jadi hasil edit diterapkan ulang ke DB lokal dengan `psql` (ON_ERROR_STOP, exit 0) tanpa reset. Isi akhir file = yang diuji.

## Acceptance yang terbukti pada fase ini (pgTAP)

§1.1 (state, termasuk revision-tanpa-perubahan = fresh), §1.2 (edit enam tipe sumber tidak menulis `cv_items`/`cv_documents`; fingerprint dan revision sama), §1.3 (keep terikat revision live; edit kedua → changed), §1.4–1.5 (refresh mempertahankan override, replace; replace tanpa override ditolak), §1.6 (`CV_SOURCE_CHANGED`, `STALE_REVISION`, `CV_RESOLUTION_INVALID`, `CV_SOURCE_INELIGIBLE`, input invalid, semua tanpa write), §1.7 (batch +1 revision; satu invalid membatalkan semua), §1.8 (profil: keep/refresh/replace, locale/timezone tetap fresh), §1.9 (keenam jalur delete: `source_deleted`, snapshot+override utuh, revision +1; sumber tidak terpilih → revision tetap; akun tanpa CV tetap bisa delete; return value identik), §1.10 (reopen/dismiss → unconfirmed), §1.11 sebagian (relink achievement → changed + parent baru ditambahkan; relink activity/`update_activity` di Fase 5), §1.13/§1.15 sisi DB (`get_cv_review_summary` dengan/tanpa CV, `get_cv_freshness` hanya milik pemanggil, item akun lain/ID acak → `CV_ITEM_NOT_FOUND`).

Interpretasi yang dicatat: acceptance §1.10 "konfirmasi ulang → changed" dipenuhi bila konfirmasi ulang mengubah field tampilan (diuji dengan edit judul pada draft). Konfirmasi ulang tanpa perubahan field tampilan menghasilkan `fresh` karena definisi §2.2.2 (snapshot live = snapshot tersimpan); diuji eksplisit.

## Penyimpangan dari "suite lama tanpa perubahan" (perlu perhatian reviewer)

Keputusan §1.9/§2.2.6 yang disetujui pengguna (delete sumber terpilih menaikkan `cv_documents.revision` dalam transaksi delete) tidak dapat hidup berdampingan dengan dua assertion lama yang menganggap revision CV tidak bergerak saat sumber dihapus. Plan §8 menyebut perubahan suite lama sebagai stop condition, tetapi kedua kasus adalah konsekuensi langsung keputusan itu, bukan pelemahan; perubahan dibuat minimal dan assertion intinya dipertahankan:

1. `supabase/tests/database/cv_selection.test.sql` (bagian 8): `remove_cv_item(17, …)` dan `cv_revision = 18` memakai literal revision. Setelah enam delete lewat RPC revision CV adalah 23, bukan 17. Literal diganti dengan revision dokumen saat itu (`select revision from cv_documents …`) dan ekspektasi `+ 1`. Hasil yang diuji (`CV_CHILD_ITEMS_EXIST` dengan daftar ID, penghapusan parent+children, `cardinality = 2`) tidak berubah.
2. `tests/integration/cv-selection.test.ts` (race reorder vs `delete_experience`): sebelumnya mengharapkan keduanya `fulfilled`. Kini delete mengambil lock CV lebih dulu dan menaikkan revision, sehingga reorder yang kalah race membawa revision basi dan ditolak `CONFLICT` (`STALE_REVISION`). Assertion kini: delete selalu `fulfilled`; reorder `fulfilled` atau `CONFLICT`; posisi tetap `[1, 2]` dan konsisten (urutan terbalik bila reorder menang, urutan awal bila kalah); item terhapus tetap `source_deleted`. Stabil 3/3 run.

Bila pengguna/reviewer tidak setuju dengan penyesuaian ini, satu-satunya alternatif adalah mengubah keputusan §2.4.3 (tidak menaikkan revision CV saat delete).

## Belum dijalankan / catatan

- `test:integration:import-commit` gagal pada run pertama karena ClamAV/Gotenberg (container `workpulse-t10-clamav`, `workpulse-t15-gotenberg`) berstatus Exited; batch tidak mencapai `review`. Setelah `docker start` kedua container, suite lulus: exit 0, 11/11. Suite import lain dijalankan pada regresi penuh (Fase 6).
- Tidak ada kegagalan lain, tidak ada blocker.

## Langkah berikutnya

Fase 2 — domain murni (`contracts.ts`, `freshness.ts`) dengan unit test.

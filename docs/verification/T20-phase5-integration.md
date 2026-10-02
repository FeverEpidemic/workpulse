# T20 Fase 5 — Integration nyata (receipt)

- Tanggal: 2 Oktober 2026
- Tujuan: bukti terhadap Supabase lokal nyata (auth, RLS, RPC, trigger, lock) untuk freshness, resolusi, delete, dan race.

## File berubah

- Baru: `tests/integration/cv-freshness.test.ts` (11 test), script `test:integration:cv-freshness` di `package.json`.
- Diubah: `supabase/tests/database/cv_freshness.test.sql` (+5 assertion: commit import yang menulis profil → profil `changed`; lihat di bawah).

## Cakupan (akun, sesi, dan RPC nyata; tanpa mock)

1. Release scenario PRD: achievement terpilih + override → edit → `changed` (CV tidak berubah, fingerprint sama) → refresh (override tetap, snapshot baru) → edit kedua → keep (terikat revision live) → edit ketiga → `changed` lagi tanpa write → review basi `SOURCE_CHANGED`, revision CV basi `CONFLICT` → delete achievement: revision CV +1 dalam transaksi delete, snapshot dan override utuh, state `deleted`, resolusi ditolak; replace hanya sah dengan override dan satu-satunya yang menghapusnya.
2. Enam tipe sumber lewat RPC update nyata → semuanya `changed`, CV tidak ditulis, batch refresh satu transaksi (+1 revision) → semuanya `fresh`.
3. Konteks: `relink_activity_project` → item `changed` tanpa write CV; refresh menambah parent project baru (ID di receipt); `update_activity` (teks mentah) dan `delete_activity` tetap `fresh`.
4. Reopen/dismiss → `unconfirmed` (`live_snapshot` NULL, resolusi `SOURCE_INELIGIBLE`); konfirmasi ulang dengan perubahan → `changed`; konfirmasi tidak menambah item.
5. Profil: locale saja `fresh`; headline/summary/phone `changed`; keep → `kept`; edit berikutnya → `changed`; refresh mempertahankan `display_overrides` dan `summary_override`; replace menghapus keduanya. Commit import yang menulis profil dibuktikan di pgTAP (tabel import tidak dapat ditulis `service_role`, jadi batch tidak dapat dipentaskan dari suite ini; fungsi `commit_import_batch` nyata dijalankan di pgTAP).
6. Race dua koneksi nyata × 3 putaran: (a) edit sumber vs resolve, (b) delete sumber vs `remove_cv_item` dan vs `save_cv_edits`, (c) `relink_achievement_project` vs `select_cv_source`, (d) delete sumber vs resolve. Setiap hasil harus salah satu dari: sukses, `STALE_REVISION`, `CV_SOURCE_CHANGED`, `CV_RESOLUTION_INVALID`, `CV_SOURCE_NOT_FOUND`; `40P01`/`40001` dan galat lain gagalkan test. Override tidak hilang pada (a) dan (b). Hasil per putaran tidak ditulis ke log; yang dicatat adalah suite lulus 3 run berturut-turut.
7. Dashboard lewat `createDashboardService`: `{hasCv, reviewCount, availableCount}` cocok fixture (dengan CV: 0/2 → 1/2 setelah edit → 0/2 setelah keep; tanpa CV: false/0/2; draft tidak dihitung).
8. Ownership dan log hygiene: `getFreshness` hanya baris pemanggil; item akun lain dan ID acak → `NOT_FOUND` dengan `messageKey` sama; sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>` di judul/bullet/override tidak muncul di JSON/`message` error mana pun; correlation ID ada.

## Commands dan hasil aktual

| Command | Hasil |
| --- | --- |
| `pnpm test:integration:cv-freshness` | exit 0 — 11/11; diulang total 6 kali; satu run awal mencatat unhandled rejection dari test (promise dibuat serentak lalu di-await berurutan) → diperbaiki, lalu 3 run bersih |
| `pnpm db:test` | exit 0 — **14 file / 1115 assertion** |
| `pnpm typecheck`, `pnpm lint` | exit 0 |

Dua kegagalan awal pada penulisan test (bukan produk): `update_activity` menuntut patch lengkap (dipakai `createActivityService`), dan `service_role` tidak punya grant ke tabel import.

## Belum dibuktikan di fase ini

E2E browser, axe, responsive, regresi seluruh suite → Fase 6.

## Langkah berikutnya

Fase 6 — E2E `cv-freshness.spec.ts` dan regresi penuh.
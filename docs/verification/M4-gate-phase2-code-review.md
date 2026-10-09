# Gate M4 — Fase 2: review kode lintas domain

- Tanggal: 9 Oktober 2026.
- Pelaksana: Claude Sonnet 5.5. Read-only; tidak ada kode produk yang diubah.
- Yang dibaca (kode nyata, bukan hanya test): `src/features/cv/export-service.ts`, `src/app/api/cv/exports/[id]/route.ts`, `src/app/(workspace)/cv/preview/page.tsx`, `src/features/cv/cv-builder.tsx:100-370`, `src/features/cv/cv-builder-state.ts:150-183`, `src/server/export/cv-print-template.ts:1-40`, `workers/supabase-export-gateway.ts`, migration `20260916090000` (trigger revision), `20260922100000` (guard achievement, sinkronisasi konteks), `20261002090000` (snapshot, lock, grant), `20261004090000` (state freshness, jalur delete, `select_cv_source`), `20261005090000` (blocker, snapshot export, grant), serta hasil grep lintas `src/`, `workers/`, dan `supabase/migrations/`.

## Checklist

| Butir | Hasil | Bukti |
| --- | --- | --- |
| **Ownership.** Service, route, dan worker mengambil actor dari sesi atau baris job | PASS | `export-service.ts:56-67` (`requireActorId` dari `supabase.auth.getUser()`), `:83` filter `user_id` selain RLS, `:187-188` kunci unduhan harus kategori `export` dan owner sama dengan sesi. Route `api/cv/exports/[id]/route.ts:25-31` memakai konteks sesi dan menolak akun `deleting`. Payload klien tidak membawa `user_id`. Worker memakai `attempt_token` dan baris job |
| `getSupabaseAdminClient`/secret di jalur CV | PASS | Grep di `src/features/cv`, `src/app/(workspace)/cv`, `src/app/api/cv`, `src/domain/cv`, `src/server/export`: 0 hasil. Admin hanya di `src/server/storage/request-service.ts` (penerbitan signed URL), jalur import/evidence, dan gateway worker |
| RPC CV memeriksa `auth.uid()` dan composite FK | PASS | Semua RPC pengguna lewat `internal.cv_actor()` (`t18:413-433`: `auth.uid()` + profil bukan `deleting`) dan filter `user_id` per sumber (`cv_source_revision`/`cv_source_snapshot`/`cv_lock_source`, `t18:319-486`). Grant: RPC pengguna hanya `authenticated`; RPC worker hanya `service_role` (`t21:830-860`); helper `internal.*` dicabut penuh |
| **Lock protocol (0026).** Profil → dokumen → item → sumber | PASS | `select_cv_source` (`cv_lock` lalu parent lalu sumber, `t20:927-951`), `cv_lock_for_source_change` (profil share → dokumen update, `t20:157-176`) dipakai `delete_achievement`/`delete_project`/`delete_experience`/`internal.delete_foundation_record` (`t20:841`), `request_cv_export` mengunci sumber lewat `cv_export_lock_sources` dalam urutan kanonik (`t21:199-231`). Jalur edit sumber lain (`update_project`, `save_achievement`, relink, propagasi konteks, `apply_ai_suggestion`, `commit_import_batch`) hanya mengunci baris sumbernya dan tidak menyentuh `cv_documents`, jadi tidak membentuk siklus dengan jalur CV |
| Jalur mutasi sumber yang tidak menaikkan revision | PASS | Revision dinaikkan di level trigger, bukan di RPC: `internal.touch_mutable_row` (`foundation:150-170`, naik pada setiap UPDATE) untuk profil, experience, education, certification, project, skill; `guard_achievement_row` (`t09:235-258`) naik bila salah satu kolom tampilan berubah. Karena itu tidak ada jalur (termasuk trigger propagasi konteks `t09:311-334`, `:771-792`) yang dapat mengubah tampilan tanpa menaikkan revision |
| Satu definisi readiness/freshness | PASS | `internal.cv_item_state`/`cv_profile_state` (`t20:62-153`) dipakai `get_cv_freshness`, `get_cv_review_summary`, `resolve_cv_freshness`, dan `internal.cv_export_blockers` (`t21:119-159`), yang dipakai `get_cv_export_readiness` dan `request_cv_export`. TypeScript (`src/domain/cv/freshness.ts`) hanya mengindeks state dari DB, memilih aksi, dan membandingkan field tampilan untuk diff; ia tidak menghitung state |
| Snapshot dan worker | PASS | Worker hanya memanggil RPC (`workers/supabase-export-gateway.ts:114-156`, `get_cv_export_input` untuk masukan) plus Storage; tidak ada `.from(` ke tabel. Snapshot `cv-export.v1` (`t21:163-195`): sepuluh key, item lima key, tanpa `raw_text`/`contribution`/`metrics`/evidence. Lihat catatan P3 N-M4-1 |
| Template: escape dan tanpa hyperlink/resource | PASS | `cv-print-template.ts:5-10` `esc` untuk semua nilai, `:12-13` tanpa `@font-face`/`url()`/`@import`; grep `href|src=|<a |<img|<script|<link` = 0 |
| **Preview = export** | PASS | Unit `cv-export-domain.test.ts` dan `cv-export-view.test.ts` (`buildExportRenderModel` `toEqual` `buildCvPreviewModel`, en/id). Gate menguji lagi di E2E (urutan dan teks PDF) dan integration (skenario 11) |
| **Error contract** | PASS | `CvServiceError` membawa `code` dan `correlationId` (`export-service.ts:54`); route memetakan ke pesan terlokalisasi (`route.ts:34-39`). ID asing, acak, dan bukan UUID memberi `EXPORT_NOT_FOUND`/404 yang sama (`export-service.ts:167-173`, `route.ts:32`). Unit `cv-export-i18n.test.ts` untuk kode blocker |
| **Logging** | PASS | Grep `console.` dan `logger.` di `src/` dan `workers/`: hanya `src/server/documents/parser-thread.ts:7-11` yang membisukan console. Tidak ada teks CV, wording, nama, object key, atau token dicatat |
| **AI-free** | PASS | Grep `server/ai|domain/ai|AIProvider` di jalur CV/export dan worker export: 0 hasil |

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV-F1 | P2 | T20 F1 diklasifikasi ulang dari P3: `cv-builder.tsx:150-158` pada `CV_SOURCE_CHANGED` menutup semua panel review (`setOpenReviews(new Set())`) dan memanggil `router.refresh()`; `pendingFocus` sudah di-null di `:186` dan efek fokus hanya jalan bila `savedKey` berubah (`:74`, `:126-130`), padahal edit sumber tidak mengubah `savedKey`. Tombol aksi yang sedang fokus ter-unmount sehingga fokus jatuh ke `body`. Detail klasifikasi di receipt Fase 1 | Terbuka, diperbaiki di Fase 6 |
| N-M4-1 | P3 | Snapshot export menyimpan `source_snapshot` item apa adanya, termasuk `credential_url` sertifikasi. Ini data milik pengguna sendiri dan tidak pernah dicetak (`cv-export.test.ts:179`), tetapi terbaca pemilik lewat PostgREST (T21 N3). Tidak ada kebocoran lintas akun | Catat (T21 N3) |
| N-M4-2 | P3 | `internal.cv_export_blockers` menelusuri semua item dalam satu loop plpgsql dan memanggil `cv_item_state` per item, yang memanggil `cv_live_source` dan `cv_source_snapshot` dua kali per item (T20 F6). Benar secara fungsi; biaya diukur di T24 | Follow-up T24 |

Tidak ada P0 atau P1. Satu P2 (RV-F1) berasal dari reklasifikasi.

## Batas review ini

- Review SQL menelusuri jalur mutasi dan urutan lock; bukti runtime ada pada pgTAP dan integration race T18–T21 yang diulang di Fase 5. Gate tidak menjalankan stres race berskala.
- Preview/export diverifikasi lewat test, bukan dengan membandingkan seluruh kode TypeScript baris per baris.

## Blocker dan langkah berikutnya

Tidak ada blocker. Lanjut Fase 3 (E2E journey F07), termasuk reproduksi RV-F1 sebagai test gagal.

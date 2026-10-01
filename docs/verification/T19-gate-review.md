# T19 Gate review (Claude, read-only)

- Tanggal: 1 Oktober 2026
- Reviewer: Claude
- HEAD yang direview: `03207fb` (baseline handoff `2087200`; 45 file, +4696/−16 baris; satu migration baru, tanpa perubahan migration/RPC T02–T18)
- Lingkungan: Supabase lokal (migration 28/28, terakhir `20261003090000`), ClamAV dan Gotenberg berjalan; `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal (hanya di env proses); `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan.

## Verdict

**Tidak ada temuan P0–P2. T19 lulus gate review.** T19 belum ditandai DONE: Fase 6 (decision 0025, `T19-cv-builder-overrides.md`, README) dan closeout masih menunggu.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| F1 | P3 | `git diff --check 2087200..HEAD` exit 2: blank line di EOF pada `playwright.cv.config.ts:41` dan `docs/verification/T19-phase3-service-action.md:13`. Receipt Fase 5 menyatakan `git diff --check` sudah dijalankan sebelum commit tanpa mencatat hasilnya. Hanya whitespace. | Rapikan di Fase 6 |
| F2 | P3 | `internal.cv_profile_overrides_valid(jsonb)` (`20261003090000…sql:60`) tidak di-`revoke … from public`, sehingga `anon` tetap punya `execute` (dicek `has_function_privilege` = true). Fungsi ini `immutable` dan murni validasi tanpa akses data, jadi tidak ada kebocoran. Namun pola T18 adalah mencabut semua helper `internal`. | Follow-up (migration forward berikutnya, mis. T20) |
| F3 | P3 | Test komponen `cv-builder-ui.test.tsx` hanya `renderToStaticMarkup` karena jsdom/testing-library tidak tersedia dan dependency baru dilarang. Perilaku interaktif §1.4/§1.9/§1.10/§1.11 dibuktikan lewat E2E (keyboard, dua konteks, dialog) dan unit murni (`syncDraft`, `reconcileDraft`, `computeItemMove`). Deviasi sudah dicatat receipt Fase 4. | Diterima |
| F4 | P3 | UX: pool section *Achievements* juga mendaftar achievement kontekstual yang sudah tampil di bawah project (baris "Added") sementara ringkasan menulis "Available to add (0)" dan "0 selected" (terlihat di `T19-screenshots/cv-1440-light.png`). Tidak salah secara data, tetapi bisa membingungkan. | Pertimbangkan di T20/T22 |
| F5 | P3 | Kegagalan jaringan/exception di klien (`cv-builder.tsx:154-157`, `:288-289`) menampilkan `error.unavailable` tanpa correlation ID karena memang tidak ada respons server. Error dari server tetap membawa kode + correlation ID. | Diterima |
| F6 | P3 | Bila sesi lain menghapus item yang sedang diberi wording lokal, `reconcileDraft` membuang field item tersebut tanpa pemberitahuan (item memang sudah tidak ada). | Dicatat |
| F7 | P3 | Receipt Fase 1 mencatat rollback manual migration yang gagal di DB lokal (drop objek + hapus baris `schema_migrations`, bukan `db reset`). Saya memverifikasi `md5(prosrc)` kedua fungsi di DB = isi file migration dan definisi constraint sesuai, sehingga state lokal setara apply bersih. Apply dari nol belum diuji di environment terpisah. | Dicatat |

## Checklist §9 handoff

| Butir | Hasil | Bukti |
| --- | --- | --- |
| `save_cv_edits`: `security definer`, `search_path`, grant | PASS | migration `:73-78`, `:286-287`; `has_function_privilege`: authenticated true, anon/service_role false; tidak ada grant tulis tabel baru |
| Lock protocol decision 0024 | PASS | `internal.cv_actor()` profil `for share` → `internal.cv_lock` `cv_documents for update` → item `for update order by id` (`:221-230`); tabel sumber tidak disentuh |
| Satu revision per batch, no-op tanpa write, batch invalid tanpa write | PASS | semua validasi sebelum write; satu `update cv_documents` di akhir (`:268-281`) + `touch_mutable_row`; no-op `return v_cv.revision` (`:257-259`); pgTAP + integration (`revision + 1`, no-op sama) |
| `source_snapshot`/`source_revision`/record canonical tidak ditulis | PASS | RPC hanya menulis `cv_items.override_text` dan kolom `title`/`summary_override`/`profile_snapshot.display_overrides`; integration membandingkan baris canonical sebelum/sesudah; E2E `after.data == before.data` |
| Ownership; ID acak vs milik akun lain tak terbedakan | PASS | filter `user_id`+`cv_id` (`:225`), `CV_ITEM_NOT_FOUND` sama; integration isolasi |
| Preview hanya dari saved; model tanpa I/O | PASS | `CvPreview` menerima `buildCvPreviewModel({ document: doc, items })` dari props server (`cv-builder.tsx:92`); draft tidak diteruskan; E2E memastikan preview tidak berubah sebelum Save |
| Konflik tidak menimpa; input lokal bertahan | PASS | `STALE_REVISION` di DB; `syncDraft`/`resolveConflict`, Save terkunci selama `unresolved`; E2E dua konteks (Keep mine + Use saved) |
| Parent removal tidak diam-diam | PASS | dialog dari daftar child di state (`onRemove`), fallback `CHILD_ITEMS_EXIST` membuka dialog; integration + E2E |
| Move aksesibel, keyboard-only, tanpa render ganda | PASS | label menyebut nama, `disabled` di tepi, live region, fokus dipulihkan (`pendingFocus`); E2E keyboard; achievement sekali di editor dan preview |
| Locale CV tidak menerjemahkan konten/UI; tanggal UTC tanpa placeholder | PASS | `labels.ts` `timeZone: 'UTC'`, NULL → null; E2E locale (`html lang` tetap `en`, profil tetap `en`) |
| Aksesibilitas/responsive | PASS | E2E Axe 0 serious/critical pada 360/1440 × light/dark, tanpa overflow; screenshot diperiksa; reduced motion CSS + `scrollIntoView` |
| Tanpa fitur roadmap / state T20–T22 prematur | PASS | tidak ada bulk-add, drag, AI, export, freshness, `/cv/preview` |
| Log hygiene; F2 T18 tertutup; tanpa `console.` | PASS | `run()` satu `correlationId` untuk service dan `failure()` (`actions.ts:34-44`); integration sentinel; grep `console.` di `src/features/cv` = 0 |
| Suite lama tetap lulus; angka receipt cocok | PASS | tabel di bawah; semua angka sama dengan receipt Fase 5 |

## Command yang saya jalankan ulang

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 86 file / 626 test |
| `pnpm worker:check` | 0 | ready |
| `pnpm build` | 0 | `/cv` dinamis |
| `git diff --check 2087200..HEAD` | 2 | 2 blank line di EOF (F1) |
| `pnpm db:test` | 0 | 13 file / 978 assertion, PASS |
| `pnpm db:lint` | 0 | `results: []` |
| `supabase migration list --local` | 0 | 28/28 |
| `test:integration:cv-builder` | 0 | 7/7 |
| `test:integration:cv` | 0 | 10/10 |
| `test:integration:achievements` / `projects` / `activity` / `dashboard` | 0 | 5/5, 7/7, 6/6, 4/4 |
| `test:integration:import-commit` / `import-review` / `import` | 0 | 11/11, 6/6, 21/21 |
| `test:integration:m2` / `m3` | 0 | 8/8, 7/7 |
| `test:integration:ai` / `ai-review` / `evidence` / `storage` | 0 | 13/13, 21/21, 14/14, 1/1 |
| `test:e2e:cv` | 0 | 7 passed (dijalankan dua kali, keduanya lulus) |
| `test:e2e:achievements` / `m2` / `m3` | 0 | 4, 1, 2 passed |
| `test:e2e:projects` / `dashboard` / `auth` / `ui` / `activity` | 0 | 1, 1, 1, 1, 1 passed |
| `test:e2e:import` / `import-review` / `ai` / `ai-review` / `evidence` | 0 | 7, 10, 2, 11, 8 passed |

Tidak ada flaky pada run reviewer ini (termasuk `activity` dan `evidence` yang gagal di run pertama receipt). Log `[WebServer] Error: The destination stream closed early` muncul di semua suite E2E termasuk M2 dan tidak memengaruhi hasil.

## Tidak dijalankan

`test:e2e` gabungan, `test:ai:live` (tidak relevan; T19 tanpa AI), apply migration dari nol di environment bersih (lihat F7), staging/production.

## Batas

Keberhasilan lokal bukan bukti integrasi production. Freshness/changed/unconfirmed, Keep/Refresh/Replace dan invalidasi CV saat sumber berubah adalah T20; validasi dan request export T21; preview S14 dan PDF T22.

## Langkah berikutnya

Fase 6 (decision 0025, `T19-cv-builder-overrides.md`, README, rapikan F1), lalu `workpulse-task-closeout` untuk menandai T19 DONE. F2 dibawa ke migration forward berikutnya.

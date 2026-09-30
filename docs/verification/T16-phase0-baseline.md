# T16 Fase 0 — Baseline (receipt)

- Tanggal: 29 September 2026
- HEAD: `da0b8fe` di branch `claude/clever-archimedes-gbu7qd`. Working tree bersih kecuali `.claude/` (untracked).
- Tidak ada kode diedit pada fase ini.

## Command dan hasil aktual

| Command | Hasil |
| --- | --- |
| `pnpm install --frozen-lockfile` | Already up to date |
| `pnpm exec supabase migration list --local` | 25/25 local = remote, terakhir `20260930090000` |
| `pnpm lint` / `pnpm typecheck` | exit 0 / exit 0 |
| `pnpm test` | exit 0, 66 file / 424 test lulus |
| `pnpm db:test` | exit 0, Files=10, Tests=668, PASS |
| `pnpm test:integration:achievements` | 5/5 lulus |
| `pnpm test:integration:dashboard` | 4/4 lulus |
| `pnpm test:integration:import` (ClamAV + Gotenberg berjalan) | 2 file / 21 test lulus |
| `select count(*) from achievements where origin='import'` (DB lokal) | 0 |

Suite integration dijalankan dengan `.env.local` + `SERVICE_ROLE_KEY` JWT dari `supabase status -o env` di env proses saja
(lihat catatan environment); `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan.

## Temuan source (file:baris)

- `import_items` / `import_batches`, grant kolom: `20260930090000_t15_import_staging.sql:27-295`.
  - `import_items_purged_check`: `(purged_at is null) = (payload is not null and source_excerpt is not null)` — item tidak purged wajib punya payload **dan** excerpt (`:153`).
  - `import_batches_expires_check`, `purged_check`, `committed_check` (`(status='committed') = (committed_at is not null)`) di `:86-96`.
  - Guard batch (`:221`) menaikkan `revision` pada setiap UPDATE dan mengizinkan `review → committed`.
  - Guard item (`:256`) hanya menjaga kolom identitas dan menaikkan revision — belum ada guard `committed`.
- `complete_import_ai_job` meresolusi `experience_ref` → `experience_item_id` (JSON string uuid) di `:1428-1432`; achievement selalu `payload.status = 'draft'`.
- `purge_expired_import_batches` (`:1461`): batch `committed` → payload/source_excerpt item di-NULL-kan + `purged_at` (guard T16 harus mengizinkan ini); status lain → item dihapus.
- `cancel_import_batch` (`:873`): lock batch `for update` lalu job; tidak mengunci profile `for update`, hanya `internal.import_actor()` (profile `for share`).
- Payload T15 (`src/domain/import/extract-result.ts:249-342`): kunci canonical persis seperti di plan §2.2.11. Achievement memakai `achieved_on` (date ISO atau null), `metrics` (label/value/unit/baseline?), `experience_item_id`. Profile juga membawa `display_name`.
- `achievements` (`20260922100000_t09_achievements_skills.sql:127-189`): `achievements_source_pair_check` di `:171` — ditemukan seperti dalam plan. `enforce_achievement_context` (`:260`) hanya menuntut excerpt bila `activity_id is not null`, sehingga achievement `origin='import'` dengan `source_excerpt` tanpa revision aman untuk trigger.
- `save_achievement` (`20260922110000_t09_achievement_null_patch.sql:82-134`) hanya mengubah title/contribution/scope/outcome/cv_bullet/achieved_on/metrics; `source_excerpt` tidak dapat diedit. Confirm memakai `internal.factual_cv_bullet` bila cv_bullet kosong (`:113-121`), gagal `CV_BULLET_TOO_LONG` bila > 2000.
- `delete_experience` (`20260922100000...:1204`): lock experience `for update` → projects → update achievements standalone → delete. Tidak mengunci profile.
- `complete_onboarding` 4-arg (`20260916150000_auth_onboarding_locale_timezone.sql:6`): `is_real_display_name`, locale `en/id`, `is_valid_timezone`, `onboarding_completed_at = coalesce(...)`.
- Pemakaian `source_excerpt` di UI: `src/features/achievement/achievement-detail.tsx:101-110`. Grep `\.origin` di `src/`: hanya `achievement-detail.tsx:76` dan mapper service — tidak ada query dashboard/timeline yang membaca `origin`/`source_excerpt`. Tidak ada kode yang menganggap `source_excerpt ⇒ activity`, kecuali cabang UI `!activity && source_excerpt` (`:110`) yang akan diubah di Fase 4.

## Tabel constraint canonical → kode validasi (spesifikasi `internal.import_item_errors`)

Semua field teks kanonis: `col = btrim(col, E' \t\n\r')` dan panjang dalam batas; nilai kosong diperlakukan sebagai NULL (dinormalisasi
oleh validator: `btrim` lalu `nullif('')`), sehingga commit menulis nilai yang sudah ter-trim.

| Entitas.kolom | Constraint | Kode |
| --- | --- | --- |
| experience.organization / role_title | not null, nonblank, ≤ 200 | `REQUIRED` / `TOO_LONG` |
| experience.kind | in employment/internship/volunteer | `REQUIRED` (NULL) / `INVALID` |
| experience.description | NULL atau 1–5000 | `TOO_LONG` |
| experience/education dates | `is_canonical_partial_date` per sisi (date+precision berpasangan, year→01-01, month→tgl 1), `is_valid_partial_interval` (current ⇒ tanpa end; upper_bound(end) ≥ start) | `INVALID` (format/pasangan/cast), `DATE_RANGE` (interval terbalik, current+end) |
| education.institution / qualification | not null, ≤ 200 | `REQUIRED` / `TOO_LONG` |
| education.field_of_study | NULL atau 1–200 | `TOO_LONG` |
| education.description | NULL atau 1–5000 | `TOO_LONG` |
| certification.name | not null, ≤ 200 | `REQUIRED` / `TOO_LONG` |
| certification.issuer | NULL atau 1–200 | `TOO_LONG` |
| certification.issued_date/precision | `is_canonical_partial_date` | `INVALID` |
| certification.credential_url | NULL atau `^https?://[^/?#\s]+([/?#]\S*)?$`, ≤ 2048 | `INVALID` / `TOO_LONG` |
| skill.name | not null, ≤ 100, normalized name tidak kosong, unik per akun | `REQUIRED` / `TOO_LONG` / `DUPLICATE` |
| achievement.title | NULL atau ≤ 200 (draft); confirm wajib | `TOO_LONG` / `REQUIRED` |
| achievement.contribution / outcome | NULL atau ≤ 5000; confirm wajib | `TOO_LONG` / `REQUIRED` |
| achievement.cv_bullet | NULL atau ≤ 2000; confirm wajib (fallback `factual_cv_bullet`, hasil ≤ 2000) | `TOO_LONG` / `REQUIRED` |
| achievement.achieved_on | date valid; confirm wajib | `INVALID` / `REQUIRED` |
| achievement.metrics | `is_valid_achievement_metrics` | `INVALID` |
| achievement.experience_item_id | NULL atau item experience batch yang sama | `INVALID` |
| profile.headline ≤ 120, summary ≤ 2000, contact_email ≤ 320 + regex, phone ≤ 40, location ≤ 120, website ≤ 2048 + regex http(s) | field terpilih tidak boleh NULL | `REQUIRED` / `TOO_LONG` / `INVALID` |
| action/target | map hanya bila `target_id` ada, dimiliki, dan tabel benar; profile hanya create/skip | `INVALID_ACTION` / `TARGET_UNAVAILABLE` |

## Catatan

- Tidak ada blocker. Tidak ada row `origin='import'` yang melanggar check baru, dan tidak ada kode yang bergantung pada `source_excerpt ⇒ source_activity_revision` selain cabang UI yang memang diubah di T16.
- Fixture review pgTAP: batch/item dibuat langsung sebagai owner test (bypass RPC) karena pipeline T15 sudah diuji tersendiri; integration Fase 3 memakai pipeline nyata.
- Langkah berikutnya: Fase 1 (pgTAP `import_commit.test.sql` lebih dulu, lalu migration `20261001090000_t16_import_commit.sql`).

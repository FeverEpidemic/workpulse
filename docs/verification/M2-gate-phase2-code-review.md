# Gate M2 — Fase 2 review kode lintas domain (read-only)

- Tanggal: 26 September 2026 · Baseline `845375c` · Handoff §5 Fase 2.
- File berubah: hanya receipt ini. Tidak ada kode yang diubah, dan tidak ada command aplikasi yang dijalankan selain grep/read.

## Checklist

| Area | Hasil | Bukti (file:line) |
| --- | --- | --- |
| Ownership: actor dari sesi | ✔ | `requireActorId()` → `client.auth.getUser()` di `activity-service.ts:181`, `project-service.ts:211`, `achievement-service.ts:141`, `dashboard-service.ts:102`, `timeline-service.ts:64`; profile `actions.ts:36`, `foundation-actions.ts:286/396`. Evidence: `features/evidence/http.ts:14-23` memakai `getRequestContext()` dan meneruskan `context.user.id`, bukan payload. |
| Ownership: defense in depth pada query baca | ✔ | `.eq("user_id", actorId)` di `dashboard-service.ts:122/128`, `timeline-service.ts:82-100`, plus RLS `achievements_select_own` (`20260922100000_t09_achievements_skills.sql:225`). |
| Secret key hanya di server | ✔ | `SUPABASE_SECRET_KEY` hanya dibaca `src/server/supabase/config.ts:36`; admin client (`server/supabase/admin.ts`) hanya diimpor `features/evidence/http.ts:4` dan `server/storage/request-service.ts:4`, keduanya `import "server-only"`. Tidak ada file `"use client"` yang mengimpor admin/config. |
| Evidence RPC high-privilege memeriksa owner | ✔ | Semua RPC evidence menerima `p_user_id` dari sesi; `reserve_evidence_upload` mengunci profil `deleting_at is null` (`20260925100000…sql:499-505`) dan parent `where user_id = p_user_id` (`:532-542`). Parent asing/hilang → 0 row → `PROVIDER_UNAVAILABLE` yang sama. `evidence-service.ts:20-24` menolak record `userId ≠ actor` atau `deleting` dengan `EVIDENCE_NOT_FOUND`. |
| Composite FK / RLS untuk tabel T06–T12 | ✔ | FK `(user_id, id)` untuk activity→experience/project (`t06…sql:123-125`), achievement→activity/experience/project (`t09…sql:184-188`), achievement_skills (`:198-200`), evidence→parent (`t10…sql:188-192`). T12 tanpa tabel baru (fungsi `SECURITY INVOKER`, decision 0018). |
| Revision | ✔ | Save activity/project/achievement membawa `expected_revision` (T06/T08/T09); evidence reserve memakai revision parent (`t10…sql:543`), upload/delete/move memakai revision evidence dan target (`evidence-repository.ts:207-262`). Trigger `guard_achievement_row` menaikkan revision pada perubahan konteks (`t09…sql:247-251`). |
| Idempotency | ✔ | Create activity/project/achievement memakai operation ledger (T06/T08/T09); evidence reserve memakai `(user_id, idempotency_key)` + payload hash, payload berbeda → `IDEMPOTENCY_KEY_REUSED` (`t10…sql:507-514`). Pola konsisten. |
| Error contract | ✔ | Service error punya `code`, `messageKey` en/id, dan `correlationId` UUID (`dashboard-service.ts:59-71`, `timeline-service.ts:32-44`, `evidence-errors.ts:36-46`). HTTP evidence mengembalikan `{code,message,correlationId}` terlokalisasi (`http.ts:26-30`). Record asing = acak = `Record unavailable` / `EVIDENCE_NOT_FOUND`. |
| Delete activity | ✔ (verifikasi empiris di Fase 4) | `achievements.activity_id … on delete set null (activity_id)` (`t09…sql:184`); `source_excerpt`/`source_activity_revision` tetap. Evidence activity: FK cascade + `activities_evidence_cleanup_before_delete` (`t10…sql:429`). |
| Delete project | ✔ (Fase 4) | activity/achievement `project_id` set null (`t06…sql:125`, `t09…sql:188`); `experience_id` tidak disentuh FK. Evidence project cascade + cleanup trigger (`t10…sql:435`). |
| Delete experience | ✔ (Fase 4) | Trigger `experiences_clear_project_context` (`foundation…sql:411`); activity/achievement `experience_id` set null. |
| Relink/konteks atomik | ✔ (Fase 4) | `sync_activity_context_to_achievements` AFTER UPDATE pada activities (`t09…sql:311-334`), `projects_sync_achievement_experience` (`t09…sql:790`), `enforce_achievement_context` menolak konteks derived yang berbeda dari activity (`:270-278`). |
| Filter URL dan safe-return | ✔ | `safe-return.ts:24-30` memuat key `/activity` from/to/project/cursor, `/achievements` status/project/evidence/skill/cursor, `/projects` status/outcome/cursor, `/timeline` type/project, `/settings/profile` mode/record; setiap key divalidasi (`:148-189`). |
| Logging | ✔ | Tidak ada `console.*` di `src/` maupun `workers/`. Worker hanya menulis JSON ringkasan angka (`workers/run.ts:18`, `evidence-worker.ts:298-332`) atau `WORKER_UNAVAILABLE`. Tidak ada raw_text, filename, isi file, atau secret. |
| i18n | ✔ | `const id: Record<keyof typeof en, string>` (`src/i18n/messages.ts:530`) memaksa key parity pada typecheck (lulus di Fase 0). |
| Copy terlarang | ✔ dengan catatan | Tidak ada streak/readiness/score/gap/%. Kata *proficiency* hanya muncul sebagai penafian (`messages.ts:342`, `:507`: "never imply proficiency"). |
| AI-free | ✔ dengan catatan | Tidak ada kontrol/status AI aktif. Copy yang menyebut AI hanya menegaskan jalur manual: `quickLog.chatHelp` "…will not be analyzed now" (`messages.ts:412`), "works without AI" (`:321`, `:404`, id `:848`, `:931`). Filter AI-free E2E Fase 3 harus mengecualikan kalimat penafian ini, sesuai handoff §5 langkah 10. |

## Temuan terklasifikasi

| ID | Level | Temuan | Lokasi | Tindakan |
| --- | --- | --- | --- | --- |
| C1 | P3 | Reserve evidence ke parent asing/hilang menghasilkan `PROVIDER_UNAVAILABLE` (HTTP 503), bukan kode validasi/unavailable-record. Tidak ada kebocoran, karena asing dan acak identik, tetapi semantik "storage down" bisa menyesatkan pengguna. | `evidence-repository.ts:186`, `t10…sql:542` | Follow-up |
| C2 | P3 | Deep link dari Timeline/Dashboard ke detail tidak membawa `returnTo`, sehingga tombol back in-app kembali ke list domain, bukan ke Timeline. Browser Back tetap mempertahankan filter Timeline di URL. Ini keputusan eksplisit T12 plan §2 butir 11. | `domain/timeline/timeline.ts:103-154`, `safe-return.ts:67-81` | Follow-up UX |
| C3 | P3 | Penafian yang memuat kata "proficiency" muncul di S08/S12. Isinya tidak menjadi fitur terlarang, tetapi pemeriksaan kata kunci otomatis perlu mengecualikannya. | `messages.ts:342`, `:507` | Catat saja |

Tidak ada temuan P0–P2 dari review kode. Perilaku delete/relink diverifikasi secara empiris di Fase 4 karena aturannya tersebar di FK action dan trigger.

## Blocker dan langkah berikutnya

Tidak ada blocker. Berikutnya Fase 3: E2E journey manual lintas domain.

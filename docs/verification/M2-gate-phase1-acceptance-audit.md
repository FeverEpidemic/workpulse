# Gate M2 — Fase 1 audit acceptance T06–T12 (read-only)

- Tanggal: 26 September 2026 · Baseline `845375c` · Handoff §5 Fase 1.
- Sumber: `IMPLEMENTATION_PLAN.md` §3/§5 (T06–T12), bukti `T06`…`T12`, test aktual di `tests/`,
  dan F02–F06 yang diekstrak dari `WorkPulse_User_Flow_v0.1.docx` (unzip `word/document.xml`, bukan metadata).
- File berubah: hanya receipt ini. Tidak ada command aplikasi yang dijalankan pada fase ini.

## 1. Matriks acceptance × bukti

Tanda: **T** = terbukti, **TS** = terbukti sebagian, **TT** = tidak terbukti.

| Task | Acceptance (§5) | Tanda | Bukti konkret |
| --- | --- | --- | --- |
| T06 | Retry save tidak menduplikasi | T | `activity-persistence.test.ts:291` "deduplicates concurrent create retries…"; pgTAP `activity.test.sql` ledger |
| T06 | Tanggal exact sesuai timezone | T | `tests/unit/activity-date.test.ts:17` (Asia/Bangkok vs LA pada batas hari); `activity-persistence.test.ts:260`; E2E `activity-ui.spec.ts:192` default tanggal = zona profil |
| T06 | 10.001 karakter ditolak | T | `activity-persistence.test.ts:277`; `tests/unit/activity-service.test.ts:160`; pgTAP |
| T06 | Dua edit bersamaan → conflict | T | `activity-persistence.test.ts:291` (bagian revision conflict) |
| T06 | raw_text tanpa AI | T | `activity-persistence.test.ts:231` exact Unicode/whitespace; `analysis_state = not_requested` (T06 §Scope) |
| T07 | Save gagal mempertahankan teks | T | `activity-ui.spec.ts:132` validation/session-expiry recovery, draft + operation key sama |
| T07 | Filter dipertahankan saat kembali | T | `activity-ui.spec.ts:132` detail return; `app-frame.spec.ts:87` Back/Forward |
| T07 | Deep link hilang aman | T | `activity-ui.spec.ts:132` missing/foreign/malformed → copy `Record unavailable` sama |
| T07 | Mobile/keyboard, Quick log terfokus | T | `activity-ui.spec.ts:132` 360/1440 light/dark, keyboard mode; `app-frame.spec.ts:87` Quick log |
| T08 | Completed tanpa outcome tersimpan + check | T | `project-context.test.ts:102`; `projects-ui.spec.ts:75` "completed warning"; pgTAP `dashboard_timeline.test.sql` outcome NULL/blank |
| T08 | Standalone academic project valid | T | `project-context.test.ts:102` "creates standalone and completed Projects" |
| T08 | Delete project mempertahankan experience + activity | T | `project-context.test.ts:172` "…deletes with a receipt"; `projects-ui.spec.ts:75` dependency delete |
| T08 | Propagation achievement (ditambahkan T09) | TS | `achievement-lifecycle.test.ts` tidak menguji relink Project→Experience dengan derived Achievement; pgTAP T09 mencakup propagation SQL. Sambungan lintas service → **Fase 4 skenario 4** |
| T09 | Confirm kualitatif tanpa angka/evidence | T | `achievement-lifecycle.test.ts:119` |
| T09 | Dismissed kembali draft sebelum confirm | T | `tests/unit/achievement-domain.test.ts:53`; E2E `achievements-ui.spec.ts:325-327` Dismiss → Reopen as draft |
| T09 | Edit confirmed valid tetap confirmed | T | `achievements-ui.spec.ts:199` lifecycle retry; `achievement-lifecycle.test.ts:75` |
| T09 | Draft tidak masuk demonstrated count | T | `achievement-lifecycle.test.ts:75`; `dashboard-timeline.test.ts:598` reopen → skill count turun |
| T09 | Race satu achievement per activity | T | `achievement-lifecycle.test.ts:247` |
| T09 | Provenance saat activity dihapus | T | `achievement-lifecycle.test.ts:262` "retains provenance after Activity deletion" |
| T10 | Race slot/byte hanya kapasitas sah | T | `evidence-backend.test.ts:67` (slot), `:83` (50 MiB akun) |
| T10 | Oversized / MIME spoof ditolak | T | `evidence-pipeline.test.ts:91`; pgTAP `evidence.test.sql` batas bytes |
| T10 | Abandoned reservation dilepas, quota benar | T | `evidence-backend.test.ts:140` |
| T10 | Scanner unavailable → tidak ready | T | `evidence-scanner-real.test.ts:19`; `evidence-pipeline.test.ts:111` |
| T11 | Move ke parent penuh ditolak tanpa kehilangan file | T | `evidence-lifecycle.test.ts:104`, `:135` (**catatan: file tidak ada di script pnpm mana pun**, lihat G1) |
| T11 | Parent delete menutup akses + antre cleanup | T | `evidence-backend.test.ts:129`; `evidence-pipeline.test.ts:111`; `evidence-lifecycle.test.ts:146` |
| T11 | File project bukan direct evidence achievement | T | `evidence-ui.spec.ts:98` (network di-mock); pgTAP `dashboard_timeline.test.sql` Project/Activity evidence tidak diwariskan |
| T11 | UI lifecycle nyata (upload→scan→ready→download) | TS | `evidence-api.spec.ts:8` memakai HTTP+ClamAV nyata tetapi upload lewat `fetch`, bukan kontrol UI; `evidence-ui.spec.ts` UI tetapi network mock → **Fase 3 langkah 6–7** |
| T12 | Count = fixture = list lintas pagination | T | `dashboard-timeline.test.ts:420`, `:563` |
| T12 | Check → filter sumber | T | `dashboard-timeline.spec.ts:337` |
| T12 | Empty CTA benar (manual, Import disabled) | T | `dashboard-timeline.spec.ts:337`; pgTAP akun kosong |
| T12 | Tanpa readiness/proficiency/streak | T | `dashboard-timeline.spec.ts:337` copy en/id |
| T12 | Timeline canonical + deep link | T | `dashboard-timeline.test.ts:522`; unit `timeline-build`; E2E `<details>` experience |

Ringkas: 31 T, 2 TS, 0 TT. Kedua TS adalah sambungan lintas domain yang memang menjadi sasaran Fase 3/4.

## 2. Pemetaan F02–F06 (DOCX) → UI dan test

| Flow | Langkah / cabang (DOCX) | UI | Test yang ada | Celah → skenario |
| --- | --- | --- | --- | --- |
| F02 | 1 Quick log, tanggal default zona profil, project opsional | S05 `/activity/new` | `activity-ui.spec.ts:132`, `app-frame.spec.ts:87` | — |
| F02 | 2 Simpan teks + revision 1 sebelum AI, *Saved* setelah commit | S05→S06 | `activity-ui.spec.ts:132`, `activity-persistence.test.ts:231` | Journey penuh → F3.2 |
| F02 | 3–4 Analisis/follow-up AI | — | Di luar M2 (T13/T14) | AI-free → F3.10 |
| F02 | 5–6 Achievement dari activity, Confirm/draft/dismiss | S06→S08 | `achievements-ui.spec.ts:296` | Journey dengan project context → F3.4 |
| F02 | Tanpa consent → activity normal; AI gagal → *Create achievement manually* | S06 | Manual path diuji; cabang AI failure belum ada (T14) | F3.10 |
| F03 | Filter S07 draft/confirmed/dismissed/project/missing evidence | S07 | `achievement-lifecycle.test.ts:143`, `dashboard-timeline.test.ts:563` | — |
| F03 | Confirm guard; qualitative tanpa angka | S08 | `achievement-lifecycle.test.ts:119` | — |
| F03 | Skill hanya dari confirmed | S08 | `achievement-lifecycle.test.ts:75` | Reopen → confirm ulang lintas Dashboard/Timeline → F4.5 |
| F03 | Reopen menghapus eligibility | S08 | `dashboard-timeline.test.ts:598` (satu arah) | Round-trip → F4.5 |
| F03 | Delete achievement: hapus evidence + skill link, pertahankan activity | S08 | Tidak ada assertion lintas Dashboard/skill count setelah delete achievement | Dicatat sebagai P3 celah uji (lihat G4) |
| F03 | *Add to CV* | S13 | Di luar M2 (T18+) | — |
| F04 | Create project, status, experience link | S09/S10 | `project-context.test.ts:102`, `projects-ui.spec.ts:75` | F3.3 |
| F04 | Attach existing activity; activity + derived achievement berbagi konteks; relink atomik | S10 | `project-context.test.ts:172` (activity saja) | Dengan achievement → F4.4 |
| F04 | Completed tanpa outcome → dashboard check | S04 | `dashboard-timeline.spec.ts:337` | — |
| F04 | Delete project: pertahankan activity/achievement + experience, hapus file project | S10 | `project-context.test.ts:172` (activity) | Achievement + Timeline + Dashboard → F4.2 |
| F05 | Valid → reserve/upload/screen/ready | S06/S08/S10 | `evidence-api.spec.ts:8` (fetch), `evidence-pipeline.test.ts:62` | Lewat kontrol UI + ClamAV → F3.6 |
| F05 | Format/quota invalid, transfer/screening gagal | embedded | `evidence-ui.spec.ts:98` (mock), `evidence-pipeline.test.ts:91/:99` | — |
| F05 | Download owner, ≤5 menit | embedded | `private-storage.test.ts:103`, `evidence-pipeline.test.ts:62` | Deep link akun B → F3.9 |
| F05 | Delete: akses baru dicabut, quota diperbarui | embedded | `evidence-api.spec.ts:8` | Efek ke Dashboard → F4.7 |
| F05 | Move activity↔achievement atomik; tanpa copy lewat project | embedded | `evidence-lifecycle.test.ts:93` | Efek ke missing-evidence → F4.6 |
| F06 | Timeline grup tahun, konteks, filter, deep link, *Date not set*, *Present* | S11 | `dashboard-timeline.test.ts:522`, `dashboard-timeline.spec.ts:337` | Setelah delete/relink → F4.2–F4.4 |
| Shared | Back mempertahankan filter; unsaved warning; *Record unavailable* | semua | `app-frame.spec.ts:87`, `activity-ui.spec.ts:132` | Akun B lintas route → F3.9, F4.8 |

## 3. Celah dan follow-up terbuka

### Celah yang ditemukan pada audit

| ID | Celah | Level awal | Tindak lanjut |
| --- | --- | --- | --- |
| G1 | `tests/integration/evidence-lifecycle.test.ts` (acceptance T11: move/full/race) tidak dirujuk oleh script `test:integration:*` mana pun, jadi tidak ikut regresi §8. | P3 (bukti T11 ada; celah proses regresi) | Jalankan eksplisit pada Fase 5; catat sebagai follow-up script |
| G2 | Tidak ada journey UI tunggal F02→F06 dengan ClamAV nyata. | — | Fase 3 |
| G3 | Konsistensi lintas domain setelah delete/relink/reopen/move belum diukur sebelum-sesudah. | — | Fase 4 |
| G4 | Delete achievement (F03) belum diuji efeknya terhadap skill count dan missing evidence di Dashboard. | P3 celah uji | Follow-up; bukan kriteria §1 handoff |

### Follow-up P3 dan "tidak dijalankan" dari bukti T06–T12

| Asal | Item | Status saat audit |
| --- | --- | --- |
| T06 | Advisory PL/pgSQL `v_revision` tidak dibaca di `internal.update_activity` (lint level warning) | Terbuka, P3 |
| T06–T09 | Warning Next.js `destination stream closed early` pada navigasi E2E | Terbuka, P3 |
| T09/T10 | Warning Node `NO_COLOR` | Terbuka, P3 kosmetik |
| T10 | Rebuild disposable 26 September terhalang port Windows 55422 (rebuild 25 September lulus) | Historis; Gate M2 tidak mensyaratkan rebuild |
| T10/T11 | Hosted scanner/supervisor/retention tidak dibuktikan (lokal saja) | Di luar M2 (T25) |
| T11 | Activity E2E sempat gagal timing filter URL, rerun lulus | Flaky P3 |
| T12 | Heading Dashboard lama "Your workspace is ready" | Terbuka, P3 |
| T12 | Konteks achievement fallback saat Timeline `truncated` (>500 row) | Terbuka, P3 |
| T12 | Redirect sign-in S12 tanpa `record` | Terbuka, P3 |
| T12 | Flaky Axe `achievements-ui.spec.ts:199` (warna transisi) | Perbaikan test di-commit `845375c`; dikonfirmasi pada Fase 5 |
| T12 | `test:integration:evidence` dan `test:e2e:evidence` tidak dijalankan (ClamAV tidak aktif) | Dijalankan pada Fase 5 |

## 4. Temuan, blocker, langkah berikutnya

- Temuan P0–P2: tidak ada dari audit bukti. G1 dan G4 tercatat sebagai P3.
- Blocker: tidak ada.
- Berikutnya: Fase 2, review kode lintas domain.

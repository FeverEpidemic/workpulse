# Gate M2 — Fase 3 E2E alur manual lintas domain

- Tanggal: 26–27 September 2026 · Handoff §5 Fase 3 · kriteria §1.1, §1.2, §1.5.
- File baru: `playwright.m2.config.ts` (port 3006, workers 1, timeout 420 s),
  `tests/e2e/m2-manual-journey.spec.ts`, script `test:e2e:m2` di `package.json`.
- Perbaikan produk yang ditemukan fase ini: `107b32c fix(m2): scope Achievement create key to its source`
  (temuan **F1, P1**, lihat bawah) dengan regresi baru di `tests/e2e/achievements-ui.spec.ts`.

## Environment

- Supabase lokal aktif (tanpa reset). Docker Desktop restart di tengah sesi (27 September); stack
  Supabase naik ulang otomatis, container `workpulse-t10-clamav` di-`docker start` ulang (bukan duplikat)
  dan menunggu `healthy`. Signature setelah FreshClam: **ClamAV 1.5.4 / daily 28135 / Sat Sep 26 2026**.
- `SUPABASE_SECRET_KEY` hanya di environment proses (script scratchpad di luar repo, tidak memuat nilai).
- Scanner: `WORKPULSE_SCANNER_MODE=clamav`, `127.0.0.1:13310`. Tidak ada fake scanner.
- AI-free: spec menegaskan tidak ada variabel env yang cocok `(^|_)(AI|OPENAI|ANTHROPIC|GEMINI|LLM)(_|$)`.
  Run pertama gagal karena variabel harness agen (`AI_AGENT`, `ANTHROPIC_BASE_URL`); variabel harness
  (`AI_*`, `ANTHROPIC_*`, `CLAUDE_*`) dihapus dari proses test, asersi tidak dilemahkan.

## Cakupan spec (satu test, lewat UI kecuali pembuatan akun dan drain worker)

| Langkah handoff | Asersi utama |
| --- | --- |
| 1 Graduate tanpa CV | Akun baru → `/onboarding/import` (Import CV *not available yet*) → *Start manually* → hanya display name + timezone → Dashboard kosong, `Import CV` disabled, *Add your first activity* membuka `#quick-log-note` terfokus |
| 2 F02 capture | Keyboard-only (Tab dari skip link → Quick log → ketik → Tab ke Save → Enter), focus-visible diasersi. Browser `Pacific/Pago_Pago` (UTC−11) vs profil `Pacific/Kiritimati` (UTC+14): tanggal selalu berbeda, default `occurred_on` = tanggal profil. Response action ditahan: tombol disabled dan *Activity saved.* belum muncul sebelum commit. Reload + list `/activity` memuat note dan tanggal terformat; read-back RLS owner: `occurred_on` benar, `raw_text` persis, `analysis_state = not_requested` |
| 3 F04 project | `/projects/new` keyboard-only (status Active, start Month 2026/9) → *Attach existing activity* → *Attach* → detail: *1 linked activity/activities* |
| 4 F03 achievement | Dari detail activity → *Create Achievement* → *New Achievement* (keyboard). Konteks `Project: <project>` terpropagasi. Title/Contribution/Outcome/Achieved on/skill via keyboard → *Confirm Achievement*. Read-back: `confirmed`, `metrics = []`, `project_id` dan `activity_id` benar; tanpa evidence |
| 5 Dashboard | *Confirmed achievements 1*, *Current projects 1*, skill 1, check *1 confirmed achievement has no ready evidence.* → list `evidence=missing` tepat 1 row achievement ini |
| 6 F05 evidence | Upload PDF di S08 → *Security check in progress*, tanpa tombol Download → `drain()` ClamAV → *Ready*. Download: response `expiresInSeconds` ≤ 300, URL `/storage/v1/object/sign/…?token=`, byte unduhan identik. Dashboard: *No checks need attention.* |
| 7 Tidak diwariskan | Evidence activity → *Ready*. Achievement kedua dibuat dari S10 project yang sama, confirm tanpa evidence → *Confirmed achievements 2*, check 1, list `evidence=missing` hanya achievement kedua. Nama file tidak muncul di Dashboard |
| 8 F06 timeline | Grup 2026: achievement dengan konteks project, project *Started Sep 2026*; note activity dan nama file tidak muncul. Experience ditambah di S12 → event muncul → klik → `/settings/profile?record=…#experience-…` dengan `<details open>`. Klik achievement/project → editor canonical |
| 9 Isolasi | Akun B (context terpisah): `/activity|achievements|projects/<id A>` = *Record unavailable* dan teks `main` identik dengan UUID acak; `POST /api/evidence/<id A>/download` 404 dengan `code` sama seperti UUID acak; `GET /api/evidence/<id A>` 404; list evidence parent A kosong; Dashboard/Timeline/list terfilter B tidak memuat judul, role, note, atau nama file A; Dashboard B kosong |
| 10 AI-free | `innerText` body setiap halaman alur tidak cocok `/analy[sz]\|menganalisis\|AI suggestion\|saran AI/i` setelah mengecualikan penafian eksplisit ("will not be analyzed now", "works without AI") |
| 11 Aksesibilitas | Axe WCAG 2.2 A/AA: detail achievement dengan evidence, Dashboard, Timeline (1440 light) dan Timeline 360 dark → 0 violation. 360×800 dark: Dashboard, detail achievement, Timeline tanpa overflow horizontal |

## Hasil run

| Run | Hasil | Catatan |
| --- | --- | --- |
| 1 | FAIL | Guard AI env menangkap variabel harness agen → dihapus dari proses (bukan produk) |
| 2 | FAIL | Read-back admin `null`: tabel karier tidak memberi grant ke `service_role` (hardening disengaja) → read-back lewat sesi owner RLS |
| 3 | FAIL (timeout) | Docker restart; setelah pulih, helper `tabTo` menunggu tombol dialog yang sudah tertutup oleh `router.refresh()` → helper fail-fast, dialog ditutup Escape hanya bila masih terbuka |
| 4 | FAIL | Input tanggal native mengikuti locale OS (dd/mm/yyyy) → pengisian keyboard mencoba urutan day-first lalu month-first |
| 5 | FAIL | Kontrol evidence belum hydrate saat `setInputFiles` → tunggu `networkidle` dan list evidence termuat |
| 6 | FAIL | **Bug produk F1** (di bawah) pada langkah 7 |
| 7 | **PASS 1/1** (26.4 s) | setelah `107b32c` |
| 8 | **PASS 1/1** (39.6 s total) | `--reporter=html`, `PLAYWRIGHT_HTML_OPEN=never`; 6 screenshot + 4 lampiran Axe di `playwright-report/` (diabaikan Git) |

Screenshot diinspeksi: Timeline 360 dark menampilkan grup 2026/2024, konteks project, *Started Sep 2026*,
experience 2024, tanpa overflow. Screenshot `fullPage` 1440 menggambar sidebar/topbar `fixed` di posisi
scroll — artefak capture Playwright, bukan layout (Axe dan overflow lulus pada halaman yang sama).

Warning non-blocking: Next.js `The destination stream closed early` (P3 yang sudah tercatat T07–T12).

## Temuan

### F1 — P1 — create Achievement kedua di tab yang sama ditolak `IDEMPOTENCY_KEY_REUSED` (FIXED)

- **Gejala:** setelah membuat derived Achievement dari Activity, *Create Achievement* dari S10 Project di
  tab yang sama menampilkan "This save key was already used with different details." Reload tidak
  memulihkan (key tersimpan di `sessionStorage`). F04 "within S10, create a linked … achievement" terblokir.
- **Akar masalah:** `createAchievementAction` memanggil `revalidatePath`, sehingga Next me-render ulang
  halaman aktif `/achievements/new?activity=…`; karena activity kini memiliki achievement, halaman itu
  `redirect()` ke detail. State `success` action tidak pernah sampai ke form, sehingga
  `useCreateOperationKey` tidak merotasi key bersama `achievement-create`.
- **Perbaikan minimal:** slot key create diberi scope per sumber (`achievement-create:activity:<id>`,
  `achievement-create:project:<id>`, standalone) di `src/features/achievement/achievement-form.tsx`.
  Retry sumber yang sama tetap idempotent; sumber berbeda memakai key sendiri. Tanpa migration/kontrak.
- **TDD:** test baru `achievements-ui.spec.ts` "a second Achievement create in the same tab uses a fresh
  operation key and keeps its Project context" gagal sebelum perbaikan (key `f78af734…` dipakai ulang),
  lulus sesudahnya; suite Achievement 4/4.
- **Sisa P3 (F1-a):** jika derived Achievement dihapus lalu dibuat ulang untuk activity yang sama di tab
  yang sama, key activity lama akan me-replay receipt Achievement yang sudah dihapus (hasil: *Record
  unavailable*, tidak ada kehilangan data). Follow-up: rotasi key saat server menolak/replay receipt yang
  tidak lagi tersedia.

## Blocker dan langkah berikutnya

Tidak ada blocker. Berikutnya Fase 4: integration lintas domain.

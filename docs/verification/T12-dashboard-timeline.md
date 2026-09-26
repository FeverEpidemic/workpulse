# T12 — Dashboard dan Timeline: bukti acceptance lokal

- Tanggal: 26 September 2026
- Status: **DONE** (acceptance lokal). Bukan bukti production.
- Branch: `claude/clever-archimedes-gbu7qd`
- Rujukan: R03, R08, F06 (F03 untuk missing evidence), S04, S11, S12 deep link, Database Schema §1/§6.
- Rencana: [T12-implementation-plan.md](T12-implementation-plan.md). Decision:
  [0018](../decisions/0018-t12-dashboard-timeline.md). Receipt fase:
  [0](T12-phase0-baseline.md), [1](T12-phase1-database.md), [2](T12-phase2-domain-services.md),
  [3](T12-phase3-profile-deep-links.md), [4](T12-phase4-dashboard.md), [5](T12-phase5-timeline.md),
  [6](T12-phase6-browser-acceptance.md).

## 1. Ringkasan

Implementasi Fase 0–6 dikerjakan satu eksekutor (commit `162b810`…`380fe3f`). Gate review Claude
(§10 rencana) dilakukan pada sesi ini dengan membaca migration, service, domain timeline, filter
URL, safe-return, UI S04/S11/S12, pgTAP, integration, dan E2E, lalu menjalankan ulang seluruh
gate lokal.

Hasil review: **tidak ada temuan P0–P2.** Temuan P3 yang diperbaiki pada review:

| # | Temuan | Perbaikan |
| --- | --- | --- |
| R1 | Tombol *Apply filters* Timeline memakai `button-primary`, melanggar §4.2 (Timeline tanpa aksi primer) dan aturan satu aksi utama (Quick log). | `button-secondary`. |
| R2 | Project tanpa tanggal tampil "Started Date not set" / "Dimulai Tanggal tidak diatur". | Label menjadi *Date not set*; E2E menegaskan teks persis. |
| R3 | URL `/timeline?project=<id tidak ada di opsi>` menampilkan select "All projects" padahal filter aktif. | Opsi *Unavailable project* (en/id) dipilih; tidak membedakan asing vs terhapus. E2E menegaskan nilai select. |
| R4 | Link check *Needs attention* hanya tebal tanpa affordance link. | Underline dengan offset 4px. |
| R5 | Chip skill di 1440 px tersebar per kolom grid. | Daftar skill memakai flex-wrap. |

P3 yang dicatat sebagai follow-up (tidak memblokir):

- Heading Dashboard masih memakai copy lama "Your workspace is ready" (`dashboard.title`, juga
  diuji `auth-profile.spec.ts`). Pertimbangkan heading "Dashboard" pada task UI berikutnya.
- Konteks achievement fallback ke experience/*Independent* bila project induknya terpotong batas
  500 row (hanya saat `truncated`).
- Redirect sign-in dari `/settings/profile` belum membawa `record`.
- `achievements-ui.spec.ts` (T09, conflict retry) flaky: Axe sesekali menangkap warna transisi
  tombol (#87a780, kontras 4.45). Lulus 3/3 pada dua rerun berturut-turut; bukan perubahan T12.
- Next server mencatat `The destination stream closed early` saat navigasi cepat. Muncul juga pada
  suite pra-T12 (`test:e2e:ui` 26 kali), bukan regresi T12.

## 2. Trace acceptance §1

| # | Acceptance | Status | Bukti |
| --- | --- | --- | --- |
| 1 | Count cocok fixture dan jumlah row link, lintas pagination | PASS | pgTAP count fixture §7; integration "returns owner-scoped Dashboard counts and executes its canonical filter links" (ikuti `nextCursor`), "paginates … filter results" 31 row pada jalur RPC; E2E skenario 2 |
| 2 | Setiap item membuka sumbernya | PASS | E2E: stat, check, skill chip, recent activity, current project, event experience (`<details>` terbuka), achievement; unit `profile-record-deep-link` untuk education |
| 3 | Missing evidence hanya direct `ready` | PASS | pgTAP: ready dikecualikan; scanning/failed masuk; Activity/Project evidence tidak diwariskan; integration: evidence ready → count turun tanpa cache |
| 4 | Completed missing outcome NULL/blank | PASS | pgTAP NULL dan blank-trim; E2E link → tepat P2 |
| 5 | Empty dashboard jujur | PASS | pgTAP akun kosong; E2E CTA → `/activity/new` terfokus, Import CV disabled bukan link |
| 6 | Timeline benar | PASS | unit `timeline-build` (urutan §7, overlap, Present, precision, draft/dismissed, filter); E2E heading tahun, undated terakhir, *Date not set*, "Started 2023" tanpa "Jan", filter URL + reload + back/forward |
| 7 | Tanpa kebocoran owner | PASS | pgTAP subject B; integration dua akun; E2E user B + `/timeline?project=<P1 milik A>` → empty filtered |
| 8 | Tanpa fitur terlarang | PASS | E2E copy en/id tanpa streak/readiness/proficiency/%; tanpa CV check dan AI (review kode) |
| 9 | Aksesibel dan responsif | PASS | E2E Axe WCAG 2.2 A/AA pada Dashboard penuh/kosong, Timeline, Timeline terfilter; keyboard focus-visible; tanpa overflow 360×800 dan 1440×900 light/dark; screenshot diinspeksi manual |

Checklist gate §10: fungsi invoker/`search_path=''`/grant/`deleting_at`/tanpa perubahan tabel ✔;
predikat tunggal count-list ✔; identity dari sesi, `.eq("user_id", actorId)` defense in depth ✔;
recent memakai `occurred_on` ✔; skill distinct confirmed ✔; tidak ada `any` atau log `raw_text` ✔;
Dashboard tanpa cache ✔.

## 3. Command dan hasil aktual (setelah perbaikan review)

Integration dan E2E membutuhkan `SUPABASE_SECRET_KEY`; `.env.local` tidak memuatnya, sehingga nilai
lokal diambil dari `supabase status -o env` ke environment proses saja (tidak ditulis ke file).

| Command | Hasil |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 44 file / 203 test lulus |
| `pnpm db:test` | 7 file / 386 assertion lulus |
| `pnpm db:lint` | `results: []` |
| `pnpm exec supabase migration list --local` | parity 21/21, terakhir `20260927090000` |
| `pnpm test:integration:dashboard` | 4/4 |
| `pnpm test:integration:achievements` | 5/5 |
| `pnpm test:integration:projects` | 7/7 |
| `pnpm test:integration:activity` | 6/6 |
| `pnpm test:e2e:dashboard` | 1/1 (tiga run setelah perbaikan, termasuk `--reporter=html` untuk screenshot) |
| `pnpm test:e2e:ui` | 1/1 |
| `pnpm test:e2e:auth` | 1/1 |
| `pnpm test:e2e:activity` | 1/1 |
| `pnpm test:e2e:achievements` | run 1: 2/3 (flaky Axe transisi, lihat §1); run 2 dan 3: 3/3 |
| `pnpm test:e2e:projects` | 1/1 |
| `pnpm worker:check` | `status: ready` |
| `pnpm build` | exit 0 |
| `git diff --check` | exit 0 |

Tidak dijalankan: `pnpm test:integration:evidence` dan `pnpm test:e2e:evidence` — memerlukan ClamAV
nyata dan tidak ada container ClamAV lokal aktif; fake scanner tidak dipakai. T12 tidak mengubah
kode evidence. `pnpm db:types` tidak dijalankan ulang karena tidak ada migration baru sejak Fase 1.

## 4. Batas

- Semua bukti berasal dari Supabase lokal (Docker) dan build lokal. Tidak ada deployment,
  migration hosted, atau layanan eksternal.
- Target performa (1.000 activities, 200 achievements, 50 projects) diukur pada T24.
- Gate M2 belum ditutup: integration review M2 (T06–T12) dilakukan sebagai langkah terpisah.

# T31 gate review (Fase 0–3)

- Tanggal: 27 Oktober 2026
- Reviewer: Claude Opus 5.5, read-only terhadap kode
- Branch: `claude/t31-impl`, HEAD `8d1565f`, baseline handoff `f789e5b`
- Commit yang direview: `1c3e329` (Fase 0), `22f8363` (CSS), `b3ee047` (E2E), `8d1565f` (Fase 3)

## Verdict

**LULUS.** Tidak ada temuan P0–P2. Empat P3 dicatat sebagai follow-up. Fase 4 (draft Design.md, decision, ringkasan acceptance) boleh dimulai. T31 belum DONE sampai closeout.

## Checklist §9 handoff

| Item | Hasil | Bukti |
| --- | --- | --- |
| Receipt Fase 0–3 lengkap dengan angka aktual | PASS | Empat receipt; angka cocok dengan run ulang di bawah |
| Diff hanya `globals.css`, test, receipt, screenshot | PASS | `git diff --stat f789e5b..HEAD`: `globals.css`, `mobile-tab-bar.spec.ts`, `floating-tab-bar-css.test.ts`, 4 receipt, 10 PNG. Tanpa TSX, copy, migration, dependency |
| Gutter meneruskan tap; tap di kapsul di luar tab tetap me-expand | PASS | `nav` sendiri kapsulnya (`left: 50%`, `width`, `translateX(-50%)`), tidak ada wrapper full-width; E2E `elementFromPoint(4, …)` di luar bar; tap `box.x + 2` → `data-compact="false"` |
| Label tidak terpotong di 360 px; target ≥ 44 px dengan gap compact | PASS | Assertion T27 `scrollWidth ≤ clientWidth` tetap; `expectTargets(page, 8)` di compact |
| Kontrol terakhir dan toast di atas kapsul; tanpa scroll horizontal | PASS | `.workspace-content` dan `.ui-toast-region` memakai `--tab-bar-offset`; E2E lima rute, padding ≥ 72 |
| Reduced motion: state berganti tanpa transisi | PASS | E2E: durasi maksimum ≤ 0,01 ms di kapsul, list, header, tab; compact tetap 268 px |
| Tanpa blur; satu shadow; radius token; tanpa token baru | PASS | `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-md)`, `backdrop-filter` tidak ada (unit + E2E). Custom property lokal `--tab-bar-*` di blok mobile, bukan token desain baru |
| Delivery Gate antislop tanpa FAIL | PASS | `T31-phase3-regression.md` blok 1–4 |

## Penyimpangan dari plan

Gutter **8 px**, bukan 12 px (§2.2.2). Fase 0 mengukur label tebal "Dashboard" 64,5 px melawan isi tab 63,2 px pada kapsul 336 px, berhenti di stop condition §8, dan mencatat keputusan pengguna (opsi 1, gutter 8 px) pada 26 Oktober 2026. Turunannya konsisten di kode dan test: kapsul 344 px, `bottom` = tinggi − 8, padding `main` ≥ 72 (bukan 76). Penyimpangan sah. Fase 4 wajib menulis 8 px di Design.md dan decision, bukan angka 12 dari plan.

## Run ulang independen

Worktree `t31-impl` bersih, HEAD `8d1565f`. Env: `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY`, `.env.local` dimuat, variabel AI harness dikosongkan, container `workpulse-t10-clamav`, `-t15-gotenberg`, `-t21-pdf` berjalan.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 154 file, 1446 test lulus |
| `git diff --check f789e5b..HEAD` | 0 | bersih |
| `pnpm test:e2e:release` | 0 | 43 lulus (8,9 menit) |

Log server `The destination stream closed early` muncul 11 kali; sama dengan baseline Fase 0, bukan regresi. Screenshot tracked T25/T27/T30/T31 yang ditulis ulang suite dikembalikan dengan `git checkout`.

Tidak dijalankan ulang oleh reviewer: `pnpm build` (sudah dibangun oleh config release), `test:e2e:ui`, `test:e2e:activity`, `test:e2e:m2`. Perubahan murni CSS satu komponen dan suite release mencakup bar, jadi angka receipt Fase 3 diterima.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| G1 | P3 | Label tebal "Dashboard" hanya punya sisa 0,3 px di slot kapsul 344 px (`globals.css:432`). Font fallback atau penskalaan teks browser bisa memotongnya jadi "Dashboar…". Tidak ada test dengan teks diperbesar. Bukti perbaikan: E2E dengan `font-size` root 110% tanpa label terpotong. | Follow-up |
| G2 | P3 | Receipt Fase 3 acceptance 2 menyebut lebar "kembali 344 px saat … tap di dalam kapsul", tapi `mobile-tab-bar.spec.ts:202-203` hanya memeriksa `data-compact="false"` setelah tap. Lebar mengikuti atribut lewat CSS, jadi perilaku benar, tetapi klaimnya lebih luas dari assertion. Bukti perbaikan: tambah `expect.poll` lebar 344 setelah tap. | Follow-up |
| G3 | P3 | Di dark mode tepi kapsul hanya ditopang border 1 px `--color-border-default`; `--shadow-md` hampir tak terlihat. Sesuai plan (tanpa token baru), dicatat untuk keputusan desain berikutnya. | Follow-up |
| G4 | P3 | `env(safe-area-inset-bottom)` dan gestur sentuh belum diverifikasi di perangkat nyata; Chromium desktop mengembalikan 0. | Follow-up |

### Remediation P3, 27 Oktober 2026

Pilihan pengguna untuk G1 dan G3; dikerjakan Claude Opus 5.5 setelah closeout (decision 0041 keputusan 9).

| ID | Status | Perbaikan | Bukti |
| --- | --- | --- | --- |
| G1 | Ditutup | List expanded `padding: 0`; ruang label tebal "Dashboard" 0,3 → 1,9 px. Pengukuran canvas: Plus Jakarta Sans tebal 64,5 px, Arial tebal 62,7 px, jadi font fallback muat | E2E baru: ruang label aktif ≥ 1,5 px (Range vs `clientWidth` tab) |
| G2 | Ditutup | E2E tap di dalam kapsul kini juga menunggu lebar 344 px | `mobile-tab-bar.spec.ts`, setelah klik `box.x + 2` |
| G3 | Ditutup | `[data-theme="dark"] .workspace-tab-bar { border-color: var(--color-border-strong) }`, token yang sudah ada | Unit CSS dan E2E: warna border = `--color-border-strong` di dark, `--color-border-default` di light |
| G4 | Terbuka | Butuh perangkat sentuh nyata | - |

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 154 file, 1448 test |
| `pnpm test:e2e:release` | 0 | 43 lulus (8,8 menit), termasuk axe light/dark expanded dan compact |
| `git diff --check` | 0 | bersih |

Screenshot `docs/verification/T31-screenshots` ditulis ulang oleh run ini dan menunjukkan perubahan; screenshot T25/T27/T30 dikembalikan.

## Berikutnya

1. Fase 4 oleh eksekutor: `Design.md` dan `docs/Design.md` §4.3 (gutter 8 px), decision nomor bebas berikutnya, `T31-floating-tab-bar.md`. Checkout utama punya perubahan belum di-commit di kedua Design.md; edit di worktree saja.
2. Closeout (`workpulse-task-closeout`) setelah Fase 4.

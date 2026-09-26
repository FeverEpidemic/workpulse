# T12 — Receipt Fase 6: browser acceptance dan handoff

- Tanggal: 26 September 2026
- Branch kerja: `claude/clever-archimedes-gbu7qd`
- Commit code:
  - Fase 1 `162b810 feat(t12): add dashboard and timeline read functions`
  - Fase 2 `00d0417`, `5afdf77`, `443b5ed`
  - Fase 3 `228b60d feat(t12): open canonical records from profile`
  - Fase 4 `074c9e9 feat(t12): add dashboard workspace view`
  - Fase 5 `e1ee2c5 feat(t12): add canonical timeline view`
  - Fase 6 `e1dd930 test(t12): add dashboard timeline browser acceptance`

## Perubahan

- `playwright.dashboard.config.ts` (PORT 3005), `test:e2e:dashboard`, dan `tests/e2e/dashboard-timeline.spec.ts` menyiapkan fixture canonical dua owner dan user kosong, lalu menghapus seluruh user yang dibuat.
- Acceptance mencakup exact Dashboard counts/list parity, CTA kosong/fokus, TypeScript/missing evidence/missing outcome links, Activity/Project deep links, timeline dates/deep links/filter/history, foreign-owner filter, copy en/id, Axe, keyboard focus-visible, dan horizontal overflow/screenshot pada 360×800 serta 1440×900 light/dark.
- Screenshot dan hasil Axe dilampirkan dalam report Playwright lokal: `playwright-report/index.html` (8 PNG screenshots).

## Verifikasi aktual

- Dashboard/Timeline Playwright: **1/1** lulus; Axe WCAG 2.2 A/AA lulus pada Dashboard kosong, Dashboard penuh, Timeline, dan Timeline terfilter.
- Activity/ Achievement/Projects/Auth/Profile/UI Playwright: **1/1**, **3/3**, **1/1**, **1/1**, **1/1** lulus.
- TypeScript, lint, Vitest penuh (**44 file/203 test**), Worker check, build production, dan `git diff --check`: lulus.
- Database: pgTAP **386/386**, DB lint kosong, type generation exit 0, migrations parity **21/21**.
- Integration: Dashboard **4/4**, Achievement **5/5**, Project **7/7**, Activity **6/6**.

## Gagal, warning, tidak dijalankan

- `pnpm` tidak dapat digunakan langsung karena launcher berusaha memperoleh runtime dari jaringan; perintah diverifikasi melalui binary lokal yang sama. `pnpm install --frozen-lockfile` tidak berhasil pada baseline karena hambatan ini; lockfile/dependency tidak diubah.
- Build pertama pada sandbox biasa gagal menulis cache `.next` dengan `Access is denied`; build ulang dengan izin filesystem lokal lulus.
- Next server mencatat `The destination stream closed early` pada beberapa transisi halaman. Playwright seluruhnya lulus; warning ini perlu disertakan dalam review.
- `test:e2e:evidence` dan `test:integration:evidence` tidak dijalankan: host tidak memiliki `clamscan`/`clamdscan` dan tidak ada container ClamAV lokal. Fake scanner tidak digunakan.
- Error dashboard/timeline tidak diuji dengan mematikan API Supabase; unit tests service mencakup pemetaan error dan dependency lokal tetap aktif untuk regresi.
- Tidak ada bukti production atau gate M2.

## Gate berikutnya

- External read-only review Claude masih diperlukan sesuai handoff sebelum Fase 7. Environment ini tidak menyediakan reviewer Claude; karena itu decision `0018`, draft `T12-dashboard-timeline.md`, dan authoritative `IMPLEMENTATION_STATUS.md` belum ditulis/diubah. T12 belum dinyatakan DONE.

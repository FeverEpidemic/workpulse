# T14 Fase 5 — Browser acceptance dan regresi

Tanggal: 2026-09-29. Status: PARTIAL (Fase 5 selesai lokal; T14 belum DONE, menunggu gate review Claude dan Fase 6).
Rujukan: R05–R06, F02, S06, S08; plan `T14-implementation-plan.md` §5 Fase 5 dan §7.

## Scope selesai

- `tests/e2e/ai-review.spec.ts` (11 test, port 3008, `playwright.ai-review.config.ts`, script `pnpm test:e2e:ai-review`) dengan worker nyata `workers/run.ts --once` dan fake provider eksplisit lewat `tests/e2e/helpers/ai-worker.ts`. webServer tidak menerima env AI; child worker diberi `NODE_ENV=test`, `WORKPULSE_AI_MODE=fake`, dan skenario per test. Tidak ada panggilan provider nyata.
- Cakupan: consent ditolak + jalur manual tanpa job; allow via keyboard → queued → suggestion; isolasi owner lain (API 404, tanpa kebocoran sentinel); pertanyaan follow-up → refine → Review as draft → S08 → chip skill (hanya state form) → confirm; skip/save for later; dismiss → suppressed lalu edit → analisis ulang; outage → Retry; malformed; no_potential; edit saat queued → stale; S08 untuk draft yang sudah diedit (tidak ditimpa); Bahasa Indonesia; layout 360/1440 × light/dark dengan axe, cek overflow horizontal, dan screenshot (attachment Playwright di `test-results/`, tidak di-commit).
- Fake provider mendapat skenario `with_skills` (`Data pipelines`, `Reporting`) beserta unit test.

## Perilaku yang perlu dicatat

Membuka ulang dialog consent dengan Enter tepat setelah Escape menutup dialog native tidak memicu `onClick` tombol Analyze (klik mouse dan Enter setelah jeda normal berfungsi; pola T13 tidak terpengaruh karena ada panggilan DB di antaranya). Test memberi jeda 300 ms sebelum Enter kedua. Akar penyebab tidak dibuktikan (dugaan: event susulan Chromium setelah `dialog.close()`); `Dialog` tidak diubah. Ini keterbatasan terbuka untuk gate review, bukan klaim perbaikan produk.

## Perintah dan hasil

| Perintah | Hasil |
| --- | --- |
| `pnpm test:e2e:ai-review --repeat-each 2` | 22/22 lulus (11 test × 2) |
| `pnpm typecheck`, `pnpm lint` | bersih |
| `pnpm test` | 57 file, 357 test lulus |
| `pnpm worker:check` | exit 0 |
| `pnpm db:test` | 540 test pgTAP lulus; `pnpm db:lint` bersih |
| `test:integration:ai-review` / `ai` / `activity` / `achievements` / `projects` / `dashboard` / `m2` | semua lulus (13 di ai; 6, 5, 7, 4, 8 pada suite lain); m2 dengan `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan |
| `test:e2e:ai` / `auth` / `ui` / `activity` / `projects` / `achievements` / `dashboard` | lulus (2, 1, 1, 1, 1, 4, 1) |
| `pnpm build` | lulus |
| `pnpm worker:once` (mode default) | exit 1 `WORKER_UNAVAILABLE` sesuai harapan |
| `git diff --check` | tanpa whitespace error (hanya peringatan LF→CRLF) |

## Gagal / belum terbukti

- `pnpm test:e2e:m2`: gagal di `waitForReady` (`m2-proof.pdf` tidak pernah `Ready`). `pnpm test:e2e:evidence`: 7 lulus, 1 gagal (`evidence-api.spec.ts:46`, status `scanning`, diharapkan `ready`). Keduanya membutuhkan scanner evidence nyata (ClamAV); kontainer tidak berjalan di lingkungan ini (`docker ps` tidak menampilkan ClamAV), sehingga file tidak pernah lolos ke `ready`. Ini sesuai aturan T10 (scanner unavailable ≠ ready), tetapi saya tidak menjalankan ulang kedua suite pada commit sebelum T14 untuk membuktikan bahwa kegagalan yang sama sudah ada sebelumnya; ini belum terbukti tidak terkait T14. T14 tidak mengubah kode evidence.
- Smoke live `refine` pada provider nyata tidak dijalankan (butuh persetujuan pengguna).
- Kontainer `supabase_vector` restart terus di lingkungan lokal; tidak terkait dengan hasil di atas.
- Log webServer "The destination stream closed early" muncul selama E2E dan tidak menggagalkan test.

## Langkah berikutnya

Gate review Claude atas commit Fase 0–5, lalu perbaikan P0–P2 jika ada, kemudian Fase 6 (decision 0020, `T14-detection-review.md`, README). T14 tetap belum DONE.

# T17 Fase 5b — Remediasi gate review (30 September 2026)

Tujuan: menutup RV1 (P2) dan N1/N7 (P3) dari `T17-review-remediation-plan.md`. Dikerjakan oleh Claude (Opus) atas instruksi pengguna "Fix yourself and review ulang T17"; reviewer sama dengan pelaksana remediasi, sehingga independensi review ulang terbatas (lihat §Catatan).

## File berubah

- `src/domain/import/review-edit.ts`: `nextBatchRevision` (`Math.max` atas receipt) dihapus; `withReceipt` tidak lagi mengubah revision batch; tracker murni baru `startRevisionTracker`, `resetRevisionTracker`, `beginSave`, `settleSave`, `commitToken`.
- `src/features/import/import-review.tsx`: token commit = `commitToken(tracker)` (revision snapshot terakhir yang dimuat + simpanan sukses tab ini); setiap save melewati `beginSave`/`settleSave`; bila receipt melampaui token setelah simpanan sendiri selesai → notice `import.review.changedElsewhere` + `reload()` (reset tracker). `reload()` mereset tracker; simpanan yang dimulai sebelum reload diabaikan (generation). N7: loop `clearUnsavedForm` yang tidak berguna dan import-nya dihapus.
- `src/i18n/messages.ts`: `import.review.changedElsewhere` en/id.
- `tests/unit/import-review-edit.test.ts`: test lama "highest batch revision seen as the commit token" **diganti** (test itu mengasersi perilaku cacat RV1); 6 test baru untuk tracker.
- `tests/e2e/import-review.spec.ts`: skenario baru RV1.
- N1: baris kosong ekstra di EOF dihapus dari 5 file (`import-review.tsx`, `import-review-ui.test.ts`, `import-review-route.test.ts`, `import-review-ui.test.tsx`, `import-review-view.test.ts`).

Tanpa migration, tanpa perubahan RPC/validasi T15/T16, tanpa `db reset`. Parity 26/26.

## Pilihan desain (plan §2 poin 1–3)

Dipakai poin 1+2 (deteksi + reload), dengan poin 3 sebagai jaring pengaman: token tidak pernah dinaikkan ke revision receipt, sehingga bila reload gagal commit berikutnya pasti `STALE` → jalur konflik commit yang sudah ada. Simpanan paralel sendiri yang selesai tidak berurutan tidak memicu konflik karena pemeriksaan hanya dilakukan saat `inFlight = 0`.

## Bukti gagal → lulus

| Test | Tanpa perbaikan | Dengan perbaikan |
| --- | --- | --- |
| Unit `import-review-edit.test.ts` | 6 gagal / 4 lulus (`withReceipt` memakai revision 8, fungsi tracker belum ada) | 10/10 |
| E2E `-g "RV1"` (src perbaikan di-stash) | 1 gagal di `import-review.spec.ts:471`: notice *changed in another tab* tidak muncul (tab A akan meng-commit pilihan tab B yang tak terlihat) | lulus |

Run E2E pertama tanpa perbaikan gagal lebih awal karena `locator.check()` pada radio terkontrol; test diubah ke `click()` + tunggu *Saved*, lalu dijalankan ulang tanpa perbaikan untuk bukti di atas.

## Checks (hasil aktual, working tree setelah perbaikan)

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | — |
| `pnpm typecheck` | 0 | — |
| `pnpm test` | 0 | 76 file / 500 test |
| `pnpm worker:check` | 0 | — |
| `pnpm build` | 0 | — |
| `pnpm test:integration:import-review` | 0 | 6 |
| `pnpm test:integration:import-commit` | 0 | 11 |
| `pnpm test:e2e:import-review --repeat-each 2` | 0 | 20/20 (10 skenario × 2) |
| `pnpm test:e2e:import` | 0 | 7 |
| `pnpm test:e2e:m2` | 0 | 1 (env `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan) |
| `pnpm test:e2e:dashboard` | 0 | 1 |
| `git diff --check` (working tree) | 0 | — |

`git diff --check d4bd39f..HEAD` dijalankan ulang setelah commit (lihat gate review ulang).

## Catatan

- Pesan `[WebServer] Error: The destination stream closed early.` muncul di output Playwright pada banyak suite (juga sebelum T17); bukan kegagalan test.
- N2–N6, N8, N9 tetap sesuai plan (dicatat di decision 0023 atau follow-up).

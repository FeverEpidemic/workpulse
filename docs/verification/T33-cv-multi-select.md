# T33 Multi-select di daftar "Available to add" CV: catatan acceptance

- Tanggal: 6 November 2026
- Status: **DONE** (acceptance lokal), ditandai reviewer saat closeout 6 November 2026.
- Branch: `claude/t33-cv-multi-select-288f9f`, base `e3e522a`.
- Pelaksana: Claude Sonnet 5.5. Reviewer: Claude Opus 5.5.
- Decision: [0044](../decisions/0044-t33-cv-multi-select.md). Rencana: [T33-implementation-plan.md](T33-implementation-plan.md).
- Receipt: [Fase 0](T33-phase0-baseline.md), [Fase 1](T33-phase1-state.md), [Fase 2](T33-phase2-ui.md), [Fase 3](T33-phase3-e2e-regression.md), [Fase 3b](T33-phase3b-remediation.md). Gate review dan gate ulang: [T33-review-remediation-plan.md](T33-review-remediation-plan.md).

## Verdict gate

Gate review pertama: BELUM LULUS (RV1 P1, RV2 P2). Gate ulang pada commit `d8831ca`: **LULUS**, tanpa P0-P2. Sumber verdict adalah bagian "Gate ulang" di `T33-review-remediation-plan.md`.

## Hasil command

| Command | Exit | Hasil | Sumber |
| --- | --- | --- | --- |
| `pnpm lint`, `pnpm typecheck` | 0 | Tanpa warning | Gate ulang |
| `pnpm test` | 0 | 163 file / 1577 test | Gate ulang |
| `pnpm test:e2e:cv` | 0 | 15 lulus | Gate ulang |
| `pnpm test:e2e:cv-freshness` | 0 | 11 lulus | Receipt 3b (tidak diulang reviewer) |
| `pnpm test:e2e:cv-export`, `m4`, `m5` | 0 | 12, 1, 1 lulus | Receipt Fase 3 (tidak diulang reviewer) |
| `pnpm test:e2e:release` | 1 | 77 lulus, 2 gagal, 1 skip | Gate ulang |
| `pnpm test:e2e:release` | 0 | 79 lulus, 0 gagal, 1 skip | Receipt 3b (run pelaksana) |
| `git diff --check` | 0 | Bersih | Gate ulang |
| Parity migration | | 38/38 | Receipt Fase 0 dan 3, gate review |
| File terlarang (`supabase/migrations`, `package.json`, `pnpm-lock.yaml`, `actions.ts`) | | Tidak berubah | Gate ulang |

Dua kegagalan di run release gate ulang bukan dari T33: `landing.spec.ts:308` (N1, juga gagal di base) dan `landing-motion.spec.ts:39` (lulus 3 dari 3 saat diulang). Run release yang macet sekitar dua jam tidak dihitung. Di sisi pelaksana, satu run release juga tidak dihitung karena bentrok dengan sesi lain di port dan DB yang sama.

## Acceptance 1 sampai 13

1. **Checkbox per record.** Terbukti. Unit `cv-builder-ui.test.tsx` ("gives every record not yet on the CV one checkbox...") memeriksa checkbox bernama record dan tanpa tombol per baris. E2E graduate journey: `getByRole("button", /^Add .* to CV$/)` jumlah 0.
2. **Record yang sudah di CV.** Terbukti. Unit ("shows a record already on the CV as text...") dan E2E: teks "Added" lewat `cv-pool-added`, tanpa checkbox, keterangan "On the CV under ..." tetap.
3. **Tanpa write sebelum tombol.** Terbukti. E2E `cv-builder.spec.ts:493`: `cv_items` = 0 setelah mencentang, uncheck, dan centang ulang. E2E Suggested: `cv_items` kosong sampai tombol ditekan.
4. **Tombol dan labelnya.** Terbukti. Unit untuk `poolAddButton` dan markup. E2E: 0 centang `aria-disabled` dengan keterangan terlihat, klik tidak menulis; "Add 3 to CV" dan "Add 2 to CV"; section tanpa record tersedia tanpa tombol.
5. **Batch berurutan.** Terbukti. Unit `runSequentialAdds`: revision berantai 10, 12, 14. E2E `:493`: centang urutan terbalik, hasil mengikuti urutan daftar, `cv_documents.revision` naik tepat 3, tanpa panel konflik.
6. **Achievement dengan induk.** Terbukti. E2E `:543`: dua achievement satu project, satu batch, tiga item di Projects, dua anak, tanpa error.
7. **Gagal sebagian.** Terbukti. Unit: berhenti di kegagalan pertama, throw, jawaban tanpa revision. E2E `:563`: record tengah dihapus, satu masuk, sisanya tetap tercentang, pesan "1 of 3 added..." dan correlation ID. Setelah remediasi, E2E `:678` membuktikan kasus record pertama hilang: "0 of 3 added...", baris yang hilang keluar dari daftar, dua sisanya tercentang, klik ulang menghasilkan `cv_items` = 2.
8. **Konflik revision.** Terbukti. Skenario "Add SQL" (`cv-builder.spec.ts:376`) lulus dengan assertion yang sama. E2E `:597`: draft wording bertahan melewati batch dan jawaban stale, tanpa konflik palsu setelah reload.
9. **Tautan Add to CV.** Terbukti. E2E `:399`: `/cv?highlight=<id>` memberi checkbox tercentang dan fokus, `cv_items` kosong, record masuk setelah tombol ditekan. Tiga nilai highlight tidak valid: nol centang, tombol `aria-disabled`.
10. **Keyboard dan screen reader.** Terbukti. E2E reduced motion (`:472`): Tab ke tombol, Enter, fokus pindah ke judul section, live region "added to the CV." `release-keyboard` lulus dengan cek cincin fokus. M4 dan cv-export lewat Space dan Enter. Catatan: pengujian screen reader sebenarnya tidak dilakukan, hanya snapshot aksesibilitas yang dikunci.
11. **Responsif dan kontras.** Terbukti di Chromium. E2E `:646`: 360 dan 1440 px, light dan dark, tinggi baris minimal 44 px, klik teks men-toggle, nama panjang membungkus, tanpa overflow, Axe nol temuan. Kontras batas checkbox 4,54:1 (light) dan 4,64:1 (dark), diukur dari piksel dan dicek dengan `contrast-check.py`. Rincian di receipt Fase 3.
12. **Tanpa *Add all*.** Terbukti. `Add all` jumlah 0 di unit dan E2E (assertion lama dipertahankan), ditambah `Select all` jumlah 0.
13. **Tanpa regresi.** Terbukti dengan catatan. Suite CV, freshness, export, M4, M5, dan release lulus pada run yang dihitung. Parity 38/38. Tidak ada assertion dilemahkan (diff `tests/` dibaca reviewer). Dua kegagalan release di atas bukan dari T33. Freshness, export, M4, dan M5 tidak diulang reviewer.

## Follow-up (P3)

- **N1.** `landing.spec.ts:308` gagal 2 dari 3 run, juga di base `e3e522a`. Yang dilaporkan terlalu kecil adalah tautan email `halo@myworkpulse.my.id` di 360 px (200x44). Ukurannya tampak dibulatkan ke 44, jadi tinggi sebenarnya mungkin sedikit di bawah batas. Belum diukur. Milik T32 atau PR berikutnya di area landing.
- **N2.** Selama `router.refresh()` setelah jawaban stale, tombol tambah masih bisa diklik dan memicu konflik lagi. Data tidak rusak.

## Batas bukti

Semua bukti berasal dari Chromium lokal di production build. Tidak diuji di Safari, Firefox, perangkat nyata, staging, atau production. Teks bahasa Indonesia untuk daftar ini hanya terbukti unit. Lebar sekitar 768 px tidak diuji khusus.

## Perubahan file

Kode: `cv-builder-state.ts`, `cv-builder.tsx`, `cv-section.tsx`, `globals.css`, `messages.ts`. Test: `cv-builder-state.test.ts`, `cv-builder-ui.test.tsx`, enam spec E2E (`cv-builder`, `cv-export`, `cv-freshness`, `m4-cv-journey`, `m5-pilot-journey`, `release-keyboard`). Aria: `T25-aria/s13-cv.aria.yml` (hanya area daftar). Tidak ada migration, RPC, dependency, atau perubahan `actions.ts`.

# T32 Landing page dan halaman legal: bukti acceptance

- Tanggal: 1 November 2026
- Status: **gate review lulus, belum ditandai DONE** (status ditetapkan di closeout). Gate review Claude Opus 5.5: satu P2 (RV1) diperbaiki, review ulang lulus tanpa P0-P2 ([gate review](T32-review-remediation-plan.md), [remediasi](T32-review-remediation.md)).
- Pelaksana Fase 0-6: Claude Opus 5.5, branch `claude/t32-landing`, [PR #40](https://github.com/FeverEpidemic/workpulse/pull/40).
- Keputusan: [decision 0042](../decisions/0042-t32-landing-legal.md). Rencana: [T32-implementation-plan.md](T32-implementation-plan.md).
- Receipt: [Fase 0](T32-phase0-baseline.md), [Fase 1](T32-phase1-copy.md), [Fase 2](T32-phase2-route-locale.md), [Fase 3](T32-phase3-landing-ui.md), [Fase 3b](T32-phase3b-motion.md), [Fase 4](T32-phase4-legal.md), [Fase 5](T32-phase5-e2e-regression.md). Screenshot dan video tempo: `docs/verification/T32-screenshots/`.
- Copy: [copy deck](../marketing/landing-copy-v1.md) (disetujui 29 Oktober 2026), [brief](../marketing/landing-page-brief-v1.md).

## Penyimpangan dari plan

1. **Eksekusi di branch saat ini, bukan worktree baru dari `main`** (pilihan pengguna). Sesi fork sempat bekerja paralel di checkout yang sama di Fase 0-1, lalu dihentikan (receipt Fase 0).
2. **Anti-kedip hero memakai skrip inline sebelum hero**, bukan hanya `.is-reveal-ready` setelah mount (decision 0042 #6).
3. **Reveal memakai cek scroll**, bukan IntersectionObserver (decision 0042 #6).
4. **Timeline hero di E2E diukur dengan waktu nyata**, bukan `page.clock`. `page.clock` dipakai untuk fallback 3 s.
5. **Model konten legal** ditambah intro, tabel, dan segmen inline (decision 0042 #7).
6. **`AchievementListRow` tidak dipecah** (decision 0042 #4).
7. **Urutan TDD:** test reducer hero (Fase 3b) dan konten legal (Fase 4) ditulis tidak dalam urutan merah-dulu. Ini dicatat di receipt masing-masing.
8. **Koreksi dokumen:** receipt Fase 3b dan temuan gate F5 sempat menyebut blok reduced motion global "tidak ada". Bloknya ada (`globals.css:1870`), dan kedua dokumen sudah dikoreksi di Fase 6.

## Acceptance (§1 handoff)

| # | Poin | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | Tamu melihat landing | PASS | E2E: `GET /` 200 tanpa redirect, `main#main-content`, h1 |
| 2 | Pengguna login tetap diarahkan | PASS | E2E dua akun (onboarding ke `/dashboard`, provisional ke `/onboarding/import`). Unit `root-destination` termasuk sesi tanpa profil. Catatan F1. |
| 3 | Locale kunjungan pertama | PASS | Unit `accept-language` (q-value, `in`, wildcard, header rusak, prioritas). E2E: header id/en/ms/kosong, browser `id-ID`, cookie menang atas browser, profil menang atas keduanya. |
| 4 | Toggle bahasa | PASS | E2E keyboard, `aria-pressed`, `lang`, cookie, reload, `/sign-in` ikut. Di halaman legal untuk akun login toggle diganti link dashboard (RV1). |
| 5 | CTA daftar | PASS | E2E: minimal 3 CTA, form "Create account", link legal di form, "Sign in" ke mode masuk, `mode` lain diabaikan. Unit `sign-in-mode`. `test:e2e:auth` lulus. |
| 6 | Isi sesuai brief | PASS | Unit scan `landing.*` dan data contoh. E2E urutan section, scan teks en/id, tanpa video/FAQ, crawl link internal semuanya 200. |
| 7 | Bukti visual dari komponen app | PASS | Unit dan E2E: 5 `ExampleFrame` (`role="group"`, label, badge, `inert`), tanpa form/submit/link terlindungi, data fiktif, `ActivityListRow` dan `CvPreview`. |
| 8 | Panel demo bertab | PASS | E2E: ARIA tabs, panah/Home/End, satu panel, geser kanan/kiri `0.24s`, klik beruntun menyisakan satu panel. Tanpa JS tiga panel. |
| 9 | Reveal bertahap | PASS | E2E: section di layar langsung terlihat, delay 0/80/160/240 ms, geser 12 px, sekali, scroll cepat aman, tanpa JS terlihat, logo diam. |
| 10 | Cerita hero | PASS | E2E: urutan sekali jalan 3.027 ms, tidak berulang, kartu AI tersembunyi saat DOMContentLoaded, replay dengan keyboard dan fokus tetap, fallback 3 s, tab tersembunyi langsung ke `done`. Video tempo. |
| 11 | Titik langkah | PASS | E2E: 1, 1-3, dan 1-5 dengan teks status, transisi `0.24s`, tanpa loop. |
| 12 | Interaksi mikro | PASS | E2E: kartu `translateY(-2px)` dengan `--shadow-lg`, panah CTA 3 px saat hover dan `:focus-visible`, indikator toggle bergeser, perangkat sentuh tanpa angkat. |
| 13 | Reduced motion dan tanpa JS | PASS | E2E: tanpa perubahan fase atau replay, tanpa reveal, panel tanpa animasi, transisi 0 s, kartu diam. Tanpa JS keadaan akhir. |
| 14 | Permukaan hangat tanpa aksen baru | PASS | E2E warna latar light/dark dan nol gradient. Unit CSS tanpa literal warna. Tabel kontras di Fase 3 dan Design.md §17.5. |
| 15 | Pembuat dan kontak | PASS | E2E nama, `mailto`, footer. |
| 16 | Halaman legal | PASS | Unit paritas kata per kata dengan draf (4 dokumen × 12 bagian), guard `LEGAL_DRAFT`. E2E 200 untuk tamu dan login, en/id, `noindex`, label draf, `<mark>`. |
| 17 | Responsif dan aksesibilitas | PASS | E2E 360/768/1440 untuk tiga halaman: tanpa overflow, target 44 px, satu h1, landmark, skip link. Axe WCAG 2.2 AA nol temuan di 24 kombinasi. Catatan F8. |
| 18 | Metadata | PASS | E2E title dan description en/id. OG tetap `opengraph-image.tsx`. |
| 19 | Tanpa regresi | PASS dengan catatan | Run setelah remediasi: release 79 lulus 0 gagal, auth lulus, unit 163/1562. `ui` dan `m2` lulus di Fase 5 dan di gate. Dua flaky (F4) tercatat. `smoke.spec.ts` diubah dengan alasan di receipt Fase 2-3. |

## Trace

- Brief `docs/marketing/landing-page-brief-v1.md`, copy deck `docs/marketing/landing-copy-v1.md`, draf `docs/legal/`.
- Design.md §16.4 dan §17.5 (baru), §16.1 (dial app), §28 (motion, blok reduced motion global decision 0040).
- PRD/Flow/DB: tidak ada perubahan skema. Migration parity tetap 38/38.

## Command (angka terakhir)

| Command | Exit | Hasil | Sumber |
| --- | --- | --- | --- |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | bersih | remediasi |
| `pnpm typecheck` | 0 | bersih | remediasi |
| `pnpm test` | 0 | 163 file / 1562 test | remediasi |
| `pnpm build` | 0 | | remediasi |
| `pnpm test:e2e:release` | 0 | 79 lulus, 1 skip (rekaman video) | remediasi |
| `pnpm test:e2e:auth` | 0 | 1 lulus | remediasi |
| `pnpm test:e2e:ui` | 0 | 1 lulus | Fase 5 |
| `pnpm test:e2e:m2` | 0 | 1 lulus | Fase 5, gate |
| `git diff --check` | 0 | | remediasi |

## Tidak dijalankan atau tidak dijanjikan

- Safari, Firefox, perangkat sentuh nyata, staging, production.
- Screenshot T32 hanya ditulis ulang bila `T32_WRITE_SCREENSHOTS=1`, dan video tempo hanya direkam ulang bila `T32_RECORD_VIDEO=1`. Run release biasa tidak mengubah keduanya.
- Isian legal yang kosong, review hukum, forwarding email, dan video adalah tanggung jawab pemilik produk.

## Follow-up (P3)

F1, F3, F4, dan F8 di decision 0042. F6 ditutup di copy deck (Fase 6).

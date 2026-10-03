# T20 Gate review (Claude, read-only)

- Tanggal: 3 Oktober 2026
- Reviewer: Claude (Opus)
- HEAD yang direview: `8b1d4e9` (baseline handoff `cd239d7`; 44 file, +5318/−40 baris; satu migration baru `20261004090000`, tanpa tabel/kolom baru)
- Lingkungan: Supabase lokal (migration 30/30), ClamAV `workpulse-t10-clamav` dan Gotenberg `workpulse-t15-gotenberg` berjalan; `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal (hanya env proses); `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan untuk semua suite.

## Verdict

**Tidak ada temuan P0–P2. T20 lulus gate review.** Tujuh temuan P3 dicatat sebagai follow-up. Fase 7 (decision 0026, `T20-cv-freshness-deletion.md`, README) dikerjakan reviewer setelah gate ini. Status authoritative T20 di `IMPLEMENTATION_STATUS.md` belum diubah (closeout terpisah).

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| F1 | P3 | Saat resolusi gagal dengan `CV_SOURCE_CHANGED`, `fail()` (`src/features/cv/cv-builder.tsx:151`) menutup semua panel review dan membatalkan `pendingFocus`; tombol aksi yang sedang fokus ter-unmount sehingga fokus jatuh ke `body`. Notice `role="alert"` tetap diumumkan, tetapi pengguna keyboard kehilangan posisi. Jalur sukses sudah mengembalikan fokus (§1.16). Bukti perbaikan: unit `reviewFocusCandidates` untuk jalur konflik + E2E yang memicu edit sumber di konteks kedua lalu memeriksa `document.activeElement`. | Follow-up |
| F2 | P3 | Pada 360 px tabel *Saved on CV* / *Current source* (`src/app/globals.css:2525`) memotong kata di kolom label (`Descriptio`/`n`) dan kolom nilai sangat sempit (lihat `T20-screenshots/cv-review-360-*.png`). Tidak ada overflow horizontal dan Axe 0 pelanggaran, tetapi keterbacaan buruk. Bukti perbaikan: tata letak bertumpuk (label di atas, dua nilai berurutan) di bawah breakpoint + screenshot 360. | Follow-up |
| F3 | P3 | Copy: `cv.review.unconfirmedHelp` ("Confirm it again to review the change") menyiratkan konfirmasi ulang selalu meminta review, padahal konfirmasi ulang tanpa perubahan field tampilan menghasilkan `fresh` (keputusan §2.2.2, sudah diuji pgTAP/integration). `cv.notice.parentAdded` memakai pola "item(s)" alih-alih bentuk One/Other. `src/i18n/messages.ts:659`, `:675` (+ padanan `id`). | Follow-up |
| F4 | P3 | `tests/e2e/m2-manual-journey.spec.ts:339` dan `:341` berisi assertion yang sama dua kali (*no ready evidence* `toHaveCount(0)`) setelah penyesuaian T20. Kosmetik. | Follow-up |
| F5 | P3 | Proses: plan §8 menjadikan perubahan suite lama sebagai stop condition, tetapi pelaksana mengubah tiga suite (`cv_selection.test.sql` literal revision, race reorder di `cv-selection.test.ts`, check dashboard di `m2-manual-journey.spec.ts`) tanpa berhenti. Saya meninjau ketiganya: semuanya konsekuensi langsung keputusan yang disetujui (§2.4.3 delete menaikkan revision CV; §2.4.5 check *available*), assertion inti dipertahankan, tidak ada pelemahan. Diterima dan dicatat di decision 0026 (*Konsekuensi pada suite lama*). | Diterima |
| F6 | P3 | Biaya baca: `get_cv_freshness` memanggil `internal.cv_live_source` dua kali per item (sekali lewat `cv_item_state`), dan `get_cv_review_summary` menghitung snapshot live untuk setiap item di setiap load dashboard. Benar secara fungsi; perlu diukur pada fixture T24. | Follow-up T24 |
| F7 | P3 | Receipt Fase 6 mencatat `test:integration:evidence` gagal karena environment dan `test:e2e:evidence` tidak dijalankan. Dengan `.env.local` dimuat dalam proses yang sama, reviewer menjalankan keduanya: 14/14 dan 8/8. Receipt meremehkan cakupan, tidak ada dampak produk. | Ditutup oleh run reviewer |

Catatan non-temuan: rencana menulis `revalidatePath('/')`; pelaksana memakai `/dashboard` (route nyata) — benar. Log server Next `The destination stream closed early` muncul di hampir semua suite E2E (juga yang tidak disentuh T20, mis. `ui` 32×, `evidence` 32×), jadi bukan regresi T20.

## Checklist §9 handoff

| Butir | Hasil | Bukti |
| --- | --- | --- |
| Fungsi state SQL: prioritas, tanpa field privat, satu definisi | PASS | `cv_item_state` (`migration:62-95`) deleted > unconfirmed > fresh (revision **atau** snapshot sama) > kept > changed; `cv_profile_state` (`:120-153`) hanya tujuh field; `live_snapshot` hanya untuk changed/kept dan berasal dari `internal.cv_source_snapshot` (field tampilan) milik pemanggil |
| `resolve_cv_freshness`: definer/search_path/grant | PASS | `security definer`, `set search_path = pg_catalog` (`:285-290`); execute hanya `authenticated` (`:589-594`); helper internal dicabut penuh (`:178-182`) |
| Urutan lock §2.2.5 | PASS | `cv_actor` (profil share) → `cv_lock` (`:395`) → item `for update order by id` (`:403-408`) → sumber `for share` per tipe kanonik urut id (`:459-473`); parent achievement dikunci sebelum achievement dan dibandingkan ulang (`:440-455`, `:559-561`) |
| Validasi sebelum write; satu revision per batch | PASS | bentuk input divalidasi sebelum lock (`:340-393`); semua state/revision dicek per resolusi sebelum update item; satu `update cv_documents` di akhir (`:574-584`); pgTAP batch +1 dan batch invalid tanpa perubahan |
| `refresh` tidak menyentuh `override_text`; `keep` terikat live | PASS | update `refresh` tidak menyebut `override_text` (`:539-544`); hanya `replace` mengosongkan (`:545-551`); `keep` = `v_live_revision` setelah cek `source_revision` = live (`:525-538`); integration release scenario |
| Parent ditambahkan saat konteks berubah | PASS | `:554-571`; integration *context* (parent project baru di receipt) |
| Edit sumber tidak menulis CV; tanpa auto-refresh | PASS | tidak ada RPC update sumber yang diubah; pgTAP fingerprint enam tipe; integration `cvFingerprint` sebelum/sesudah |
| Diff fungsi delete dan `select_cv_source` | PASS | diff reviewer terhadap definisi terakhir (T09 `:911/:1125/:1204`, foundation fix `:132`, T18 `:622`): hanya deklarasi `v_cv_id`/`v_referenced`, panggilan `cv_lock_for_source_change` sebelum lock sumber pertama, cek referensi, dan satu touch dokumen setelah delete; nilai kembali, kode error, signature, grant identik. `select_cv_source` hanya memindahkan lock parent ke depan + `CV_SOURCE_CHANGED` |
| Invalidasi dalam transaksi delete; akun tanpa CV aman | PASS | pgTAP §1.9 enam jalur (revision +1, snapshot+override utuh, tidak terpilih → tetap, tanpa CV → sukses); tidak ada jalur delete sumber lain di migration (grep `delete from public.(achievements|skills|education|certifications|experiences|projects)`) |
| Race tanpa `40P01`, konsisten, override tidak hilang | PASS | integration (a)–(d) ×3 putaran, `expectOutcomes` menolak `40P01`/`40001` dan error di luar kontrak; override diperiksa pada (a)/(b) |
| Profil: tujuh field; override dipertahankan kecuali replace | PASS | pgTAP + integration (locale saja fresh; refresh menjaga `display_overrides`/`summary_override`; replace menghapus keduanya); E2E profil |
| Dashboard: dua label, angka cocok, `get_dashboard_summary` tidak berubah | PASS | migration tidak menyentuh `get_dashboard_summary`; integration `createDashboardService` (0/2 → 1/2 → 0/2; tanpa CV false/0/2); E2E dua check + tautan |
| UI: tanpa overwrite diam-diam, draft terlindungi, preview dari saved | PASS | `isReviewBlocked` + bulk melewati draft (`cv-builder.tsx`); preview tidak menerima freshness; E2E (1)(6) |
| Status tidak hanya warna; keyboard, fokus, live region; axe 360/1440 light/dark | PASS (F1, F2 P3) | badge teks; E2E keyboard; Axe 0 pada `/cv` dan `/dashboard` 4 kombinasi; screenshot diperiksa |
| Tanpa fitur T21/T22/roadmap | PASS | tidak ada export, `/cv/preview`, auto-refresh, AI |
| Log hygiene; tanpa `console.`; suite lama lulus; angka receipt cocok | PASS | sentinel integration; grep `console.` di `src/features/{cv,dashboard}` = 0; semua angka receipt Fase 6 cocok dengan run reviewer (evidence lebih baik, F7) |

## Command yang saya jalankan ulang

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` / `typecheck` / `worker:check` | 0 | bersih |
| `pnpm test` | 0 | 89 file / 706 test |
| `pnpm build` | 0 | `/cv`, `/dashboard` dinamis |
| `pnpm db:test` | 0 | 14 file / 1115 assertion, PASS |
| `pnpm db:lint` | 0 | `results: []` |
| `pnpm db:types` | 0 | tanpa diff terhadap `database.types.ts` |
| `supabase migration list --local` | 0 | 30/30, terakhir `20261004090000` |
| `supabase db diff --local --schema public,internal` | 0 | 30 migration di shadow DB dari nol → "No schema changes found" (re-apply `psql` Fase 1 setara apply bersih) |
| `git diff --check cd239d7..HEAD` | 0 | bersih |
| `test:integration:` cv-freshness, cv-builder, cv, achievements, projects, activity, dashboard | 0 | 11, 7, 10, 5, 7, 6, 4 |
| `test:integration:` import-commit, import-review, import, m2, m3, ai, ai-review, evidence, storage | 0 | 11, 6, 21, 8, 7, 13, 21, 14, 1 |
| `test:e2e:` cv-freshness (dua kali), cv, achievements, projects, dashboard | 0 | 10 (dan 10), 8, 4, 1, 1 |
| `test:e2e:` auth, ui, activity, import, import-review, ai, ai-review, evidence, m2, m3 | 0 | 1, 1, 1, 7, 10, 2, 11, 8, 1, 2 |

Tidak ada flaky pada run reviewer. Tidak dijalankan: `test:e2e` gabungan (smoke), `test:ai:live` (T20 tanpa AI), stres race berskala, staging/production.

## Batas

Bukti lokal; tidak ada deployment. Race tidak deterministik (dua session nyata, 3 putaran per skenario). Keberhasilan lokal bukan bukti production.

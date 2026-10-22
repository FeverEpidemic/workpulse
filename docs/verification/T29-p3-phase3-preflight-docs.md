# T29 remediation P3 Fase 3: preflight dan koreksi dokumen

Tanggal: 22 Oktober 2026.

## Tujuan dan file

RV3 di tests/e2e/auth-google.spec.ts: config memerlukan publishable key, beforeAll async membaca settings lokal sebelum fixture dibuat. RV4 di T29-phase0-baseline.md: catatan koreksi literal client_id dengan rujukan Fase 5, teks lama tetap ada. Checkbox plan diperbarui.

## Commands dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| Harness Node beforeAll pertama | 1 | generic TypeScript createClient<Database> perlu dihapus saat evaluasi JavaScript |
| Harness sebelum implementasi, generic dihapus | 1 | Missing expected rejection untuk provider mati |
| Harness setelah implementasi | 0 | 4 kasus lulus: disabled, HTTP gagal, network gagal, enabled |
| pnpm test:e2e:auth-google | 0 | 17 lulus dengan provider aktif |
| Assertion Node RV4 sebelum edit | 1 | koreksi dan rujukan belum ada |
| Assertion Node RV4 setelah edit | 0 | koreksi, rujukan, dan teks historis terpelihara |
| git diff --check | 0 | bersih |

Harness sementara mengeksekusi isi beforeAll yang dibaca dari spec dengan config, fetch, createClient, mkdirSync simulasi. Tidak disimpan sebagai dependency/test baru, tidak mematikan provider nyata.

## Acceptance

RV3 §2.5: bukan skip; error dilempar untuk external.google selain true, HTTP gagal, atau network gagal. Pesan literal:

> Local Google provider is off or unavailable. The shared stack may have been restarted from a checkout without [auth.external.google]. Run pnpm db:stop then pnpm db:start from a checkout with that block after coordinating shared stack use. In a new worktree, first copy the image version files from supabase/.temp in the main checkout (not project-ref or linked-project.json).

RV4 §2.6: koreksi ditempatkan tepat setelah paragraf client_id lama dan merujuk T29-phase5-e2e-regression.md, Kegagalan di tengah jalan butir 3.

## Warning dan blocker

Warning Next stream/terminal sama dengan fase sebelumnya. Tidak ada blocker. Tidak melakukan restart stack atau akses Google/hosted/staging.

## Langkah berikutnya

Fase 4: regresi §6, pembaruan decision, Delivery Gate dan draft status di receipt.

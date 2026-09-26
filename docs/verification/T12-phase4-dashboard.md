# T12 — Receipt Fase 4: Dashboard S04

- Tanggal: 26 September 2026

## Perubahan

- Dashboard route memerlukan workspace onboarding lengkap, memuat service tanpa cache, dan menangani unavailable/unauthenticated dengan Retry/sign-in yang aman.
- Ditambahkan loading skeleton, empty state dengan Quick Log manual, Import CV disabled dan penjelasan, agregat, action checks, recent activities, current projects, dan skill chips.
- Copy tersedia dalam en/id. Tidak ada streak, readiness, proficiency, percentage, inferensi, atau AI.

## Verifikasi aktual

- `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `node node_modules/eslint/bin/eslint.js . --max-warnings 0`: exit 0.
- Vitest penuh: **44/44 file, 203/203 test** lulus.
- Playwright frame UI: **1/1** lulus; Dashboard penuh/kosong dibuktikan pada acceptance Fase 6.
- Dashboard service unit tests mencakup auth/RPC/row-invalid error mapping; API Supabase tidak dihentikan untuk simulasi error karena akan mengganggu suite lain.

## Acceptance/batas

- Empty CTA membuka `/activity/new` dan fokus pada input; import bukan link yang membuat redirect loop.
- Counts dan action checks diverifikasi ke canonical lists pada Fase 6.

# T12 — Receipt Fase 5: Timeline S11 dan filter

- Tanggal: 26 September 2026

## Perubahan

- Timeline route menampilkan canonical events per tahun, unknown group, precision-aware dates, context, empty/error/retry/truncated states dan filter type/project.
- Filter form menggunakan URL router yang konsisten: query kosong tidak ditambahkan dan kontrol menyelaraskan state saat Back/Forward.
- Achievement/Project filter chips dan Clear mempertahankan filter route yang telah dibuat pada Fase 2. Experience/education deep link memakai S12 editor.

## Verifikasi aktual

- Unit penuh: **44/44 file, 203/203 test** lulus; TypeScript strict dan lint lulus.
- Achievement Playwright: **3/3** lulus; Project Playwright: **1/1** lulus.
- Browser T12 membuktikan group order, `Date not set`, overlap, `Present`, project filter 4 event, URL reload/back/forward, dan partial year tetap tampil sebagai `2023`.

## Acceptance/batas

- Timeline tetap projection dari record canonical dan tidak dapat diedit sebagai salinan terpisah.
- Batas sumber 500 dan notice truncation mengikuti service; dataset acceptance tidak melampaui limit.

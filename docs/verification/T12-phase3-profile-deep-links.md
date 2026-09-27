# T12 — Receipt Fase 3: deep link Profile S12

- Tanggal: 26 September 2026
- Commit: `228b60d feat(t12): open canonical records from profile`

## Perubahan

- Link experience/education menerima target UUID tervalidasi, menautkan ke hash canonical, membuka `<details>` record yang cocok, dan membawa record ke viewport.
- Ditambahkan unit render untuk record target; CSS global menerima bagian style Dashboard/Timeline yang dipakai fase UI.

## Verifikasi aktual

- Unit penuh setelah perubahan: **203/203** lulus; TypeScript strict lulus.
- Auth/Profile Playwright: **1/1** lulus. Server sempat mencatat `The destination stream closed early` selama navigasi; assertion browser tetap lulus.

## Acceptance/batas

- Pengalaman/education target membuka editor sumber; akses owner tetap di Profile query sesi.
- Akses production belum diverifikasi.

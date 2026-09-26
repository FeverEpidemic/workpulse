# T12 — Receipt Fase 2: domain, filter URL, service

- Tanggal: 26 September 2026
- Commit:
  - `00d0417 feat(t12): add filtered dashboard list routes`
  - `5afdf77 feat(t12): build canonical timeline events`
  - `443b5ed feat(t12): add dashboard and timeline services`

## Perubahan

- Achievement menerima filter `evidence=missing` dan `skill=<uuid>`; Project menerima `outcome=missing`. Pembaca query, safe-return, schema service, paging/cursor, filter chips, tab status, dan clear link mempertahankan filter baru.
- Timeline domain builder mengurutkan canonical events, mempertahankan overlap, precision dan undated semantics, serta membangun link ke record sumber. Service memakai sesi/RLS, bukan service role.
- Dashboard summary, recent activity, active project, dan skill data berasal dari database tanpa cache buatan.

## Verifikasi aktual

- Unit: **201/201** lulus; TypeScript strict lulus.
- Integration T12: **4/4** lulus, termasuk count/list parity, pagination 31 baris, owner isolation, direct-ready evidence dan reopen freshness.
- Integration Achievement/Project: **12/12** lulus.

## Acceptance/batas

- Angka filter menggunakan predicate list yang sama; timeline memakai source canonical.
- Browser UI belum menjadi acceptance pada fase ini.

# Storybook AI setup

Tanggal: 10 Oktober 2026. Scope terarah dari pengguna; tidak memulai T25.

## Rencana

1. Jalankan `npx storybook ai setup` dan ikuti instruksi runtime yang dicetak.
2. Pertahankan konfigurasi Storybook awal serta pekerjaan pengguna. Discovery dibatasi pada root layout, CSS, provider, konfigurasi dan primitives yang akan diberi story.
3. Preview memakai globals CSS aplikasi, Plus Jakarta Sans, `ToastProvider` lalu `UnsavedChangesProvider`, App Router mock dari framework, tema light/dark dan locale en/id. Tidak menambahkan provider, portal atau browser-state key baru.
4. Registrasikan `msw-storybook-addon@3`, pin MSW yang kompatibel dengan Vitest, dan buat worker publik. Tidak ada handler jaringan karena target story tidak memakai endpoint.
5. Tulis story colocated untuk Button, Badge, Input, Textarea, Select, Dialog dan RevisionConflict. Semua dimulai dengan tag `ai-generated` dan `needs-work`; hapus tag terakhir hanya setelah file lulus.
6. Tambahkan tepat satu `CssCheck` yang mengukur warna tombol dari token asli serta minimum touch target.
7. Jalankan batch seluruh story, TypeScript, lint dan build Storybook. Perbaiki hanya failure yang terbukti. Hapus contoh scaffold bila story WorkPulse sudah lulus.

## Acceptance

- Seluruh story WorkPulse lulus Chromium; interaksi keyboard, field, Escape dialog dan label diuji.
- CSS nyata terbukti lewat computed style, tema gelap tersedia, dan locale provider dapat diganti.
- Tepat satu `CssCheck`, tanpa tag `needs-work` pada file yang lulus.
- TypeScript dan lint lulus; static build Storybook berfungsi.
- Tidak ada perubahan behavior aplikasi, schema, endpoint, data privat atau dokumen sumber PRD/flow/screen.

Rujukan: Design.md, rencana implementasi §1 dan §3, shared UI S01-S14. Ini verifikasi tooling lokal, bukan acceptance release/production R01-R10 atau F01-F07.

## Arah visual

Reading this as: katalog komponen untuk pengembang WorkPulse, mengikuti workspace sage yang tenang; ENERGY 1 / RHYTHM 1 / MOTION 1.

Warna, font, radius dan spacing diambil dari CSS aplikasi agar katalog merepresentasikan produk. Satu komponen menjadi fokus setiap story. Sage menandai aksi utama; warna status disertai label. Tidak menambahkan dekorasi, layout halaman produk, ikon atau konten karier yang menyerupai data pengguna nyata.

## Adaptasi CLI

- Command deprecated tetap dijalankan sesuai permintaan dan mencetak instruksi setup.
- Output mengira package manager npm; `storybook add` sendiri memilih pnpm dari repo. Dependency dan worker dijalankan dengan pnpm agar satu lockfile tetap berlaku.
- MSW dipin ke 2.15.0 untuk peer `@vitest/mocker@5`; addon 3.0.3.
- `mockdate` tidak dibutuhkan karena primitives tidak bergantung pada tanggal, sesuai aturan preview dan cleanup dependency tidak terpakai.
- esbuild diizinkan build agar tooling Vite berfungsi; MSW postinstall dinonaktifkan karena worker dibuat eksplisit lewat `msw init`.

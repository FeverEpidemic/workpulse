# Decision 0040: T30 animasi dan loading

Date: 23 Oktober 2026

Status: Accepted. Desain disetujui pengguna di chat pada 21 Oktober 2026 (interview T30); dieksekusi ChatGPT Sol 6.1 (Fase 0 sampai 5); gate review Claude 23 Oktober 2026 menemukan satu P2 (RV1) yang ditutup di Fase 5b, lalu PASS tanpa P0-P2 terbuka (perbaikan RV1 ditulis reviewer sendiri, independensi terbatas). Task: T30 (permintaan terarah pengguna, tidak ada di `IMPLEMENTATION_PLAN.md` §5). [Desain](../verification/T30-motion-loading-design.md), [rencana](../verification/T30-implementation-plan.md), [bukti](../verification/T30-motion-loading.md), [gate review](../verification/T30-review-remediation-plan.md). Tanpa migration (parity tetap 38) dan tanpa dependency baru.

## References

- **Design.md** §16.1 (tanpa gradient), §16.2 (logo tidak dianimasikan berulang), §28 (motion), §29 (loading), §37 (reduced motion). §28.2 sampai §29 diperbarui oleh decision ini.
- **AGENTS.md** *UI dan aksesibilitas* (WCAG 2.2 AA, reduced motion, status tidak bergantung pada warna).
- **Decision terkait:** 0035 (T27 tab bar dan sheet mobile), 0038 (T28 pilihan mode import), 0039 (T29 Google sign-in, `dismissible` pada `Dialog`).

## Context

Pengguna melaporkan tiga hal: app terasa kaku, loading sulit dibedakan dari crash, dan klik tombol tidak terasa diterima. Di kode, `.ui-skeleton` berupa kotak diam tanpa `@keyframes`, `Button` mengganti labelnya saat pending dan mati tanpa tanda bila `loadingLabel` kosong, tombol pending tampil dengan opacity 0.58 seperti disabled, dan job panjang hanya punya status `queued`/`running` tanpa persentase.

## Decisions

1. **Dial MOTION 2, CSS saja.** Transisi masuk/keluar singkat dan loading yang bergerak, tanpa koreografi, library animasi, atau flag eksperimental Next. Token baru `--motion-instant` (100 ms), `--motion-slow` (240 ms), `--ease-out`, `--ease-in`, `--ease-standard` di `src/styles/tokens.css`; transisi interaksi maksimal 240 ms (`tests/unit/motion-tokens.test.ts`). *Alasan:* Design.md mengutamakan kecepatan dan ketenangan; masalahnya kekakuan, bukan kurang efek.
2. **Indikator tidak boleh hanya bergerak.** `LoadingIndicator` merender `LoaderCircle` berputar dan `Clock3` statis; reduced motion menyembunyikan yang berputar dan menampilkan yang statis, sementara teks yang terlihat membawa sinyal hidup. *Alasan:* blok reduced motion global menghentikan animasi di frame pertama, sehingga spinner saja akan tampak macet.
3. **Skeleton berdenyut lewat opacity, bukan shimmer.** `ui-skeleton-pulse` 1.6 s, muncul setelah 150 ms. Setiap `loading.tsx` menampilkan teks memuat; `SlowLoadingNotice` menambah catatan dan tombol muat ulang (`window.location.reload()`) setelah 8 detik. *Alasan:* shimmer memerlukan gradient, yang dilarang Design.md §16.1.
4. **`Button` satu-satunya sumber pending.** Saat `loading`: label tetap, spinner absolut di padding, `loadingLabel` menjadi teks `sr-only`, `aria-busy`, `disabled`, opacity 1, `cursor: progress`. `SubmitButton` dan tombol `useFormStatus` lokal (panel AI, consent AI) memakai pola ini. Efek tekan `scale(0.97)` 100 ms menggantikan `translateY(1px)`. *Alasan:* label yang berganti mengubah lebar dan bisa hilang; opacity disabled membuat tombol sibuk tampak mati.
5. **`ProgressStatus` untuk AI, import, dan export.** Tahap dalam kata, waktu menunggu sejak layar ini menunggu (muncul setelah 3 detik, `aria-hidden`, di luar region `status`), dan catatan lambat setelah ambang AI 30 s, export 45 s, import 60 s (`PROGRESS_SLOW_MS`). Interval berhenti saat unmount atau tab tersembunyi. Tanpa persentase atau ETA. *Alasan:* job hanya melaporkan status, jadi angka progress akan karangan (R-38); ambang adalah hipotesis UX pilot, bukan SLA.
6. **Pending navigasi = `useLinkStatus` ATAU fallback route yang ter-mount.** `useLinkStatus` kembali idle begitu `loading.tsx` tampil, jadi `SlowLoadingNotice` mendaftarkan pathname ke store per workspace frame (`navigation-loading-store.ts`, token per mount, cleanup hanya melepas token sendiri, tanpa timer tebakan). Link sidebar dan tab bar pending selama salah satu aktif. *Alasan:* klik harus terlihat diterima sampai konten baru menggantikan tampilan. Perubahan kontrak plan §2.2.7/§8 ini disetujui pengguna pada 22 Oktober 2026 dan dikonfirmasi di chat reviewer 23 Oktober 2026.
7. **Masuk halaman hanya pada navigasi client.** `src/app/(workspace)/template.tsx` memakai `useSyncExternalStore` (snapshot server `true`) untuk mengenali mount saat hydration: HTML server membawa `data-page-enter="false"`, mount dari navigasi client membawa `"true"` (opacity + geser 4 px, 180 ms). Sidebar, tab bar, dan header tidak ikut. *Alasan:* versi awal memutuskan setelah hydration dan memutar ulang konten yang sudah ter-paint (gate RV1, FCP 380 ms lalu animasi 428.5 ms).
8. **Dialog, sheet, backdrop, toast.** `<dialog>` native memakai `@starting-style` untuk masuk dan `transition-behavior: allow-discrete` (`display`, `overlay`) untuk keluar; dialog tertutup `inert` dan `aria-hidden`. Escape menyelaraskan state lewat `onCancel` kecuali `dismissible={false}` (T29), yang tetap mencegah penutupan. Toast ditandai `leaving` 120 ms sebelum dihapus. *Alasan:* animasi keluar tanpa JS tambahan; browser tanpa `overlay` menutup tanpa animasi keluar.
9. **Satu feedback sukses.** Setelah simpan dari Quick log, `ActionFeedback` tetap satu-satunya toast; `onCreated` hanya menyimpan `{ id, at }` di sessionStorage `workpulse-just-added` dan refresh. `JustAddedHighlight` memberi baris yang cocok di `/activity` dan dashboard latar sage memudar 1.2 s, sekali (marker berlaku 10 detik, lalu dihapus). Tombol tidak menampilkan centang.

## Not promised

- Belum diuji di Safari, Firefox, perangkat iOS fisik, atau background tab OS; staging dan production belum.
- `error.tsx` per route belum ada; crash nyata masih memakai error bawaan Next (follow-up).
- Ambang lambat dan waktu menunggu bukan estimasi penyelesaian.

## Follow-up (P3 dari gate review)

- N1: Escape memanggil `onOpenChange(false)` dua kali (`onCancel` lalu `onClose`).
- N2: `[data-ui-button]` menambah padding 4 px per sisi pada semua `Button`, sehingga berbeda lebar dengan link bergaya tombol.
- `error.tsx` per route.

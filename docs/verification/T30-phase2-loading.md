# T30 Fase 2: loading

- Tanggal: 22 Oktober 2026. Status: COMPLETE untuk implementasi dan bukti unit. Bukti DOM dijadwalkan Fase 5.
- Tujuan: loading terlihat hidup dan dapat dipulihkan, dengan waktu tunggu yang jujur serta live region yang tidak berubah setiap detik.

## File berubah

- Baru: `progress-status-view.ts`, `progress-status.tsx`, `loading-indicator.tsx`, `slow-loading-notice.tsx` di `src/components/ui/`; `pending-link-content.tsx` di layout.
- Sembilan `src/app/**/loading.tsx`, globals.css, messages.ts; sidebar dan tab bar; panel AI, export CV, import-start dan import-review.
- Lima test unit baru: progress-status-view, progress-status, slow-loading-notice, loading-pages, navigation-pending. Dua story baru: progress-status dan skeleton. Plan dan receipt ini.

## Command dan hasil

| Command | Exit | Pass / fail |
| --- | --- | --- |
| lima test baru sebelum implementasi | 1 | 18 fallback gagal, 4 suite gagal import komponen yang belum ada |
| lima test baru dan motion-tokens setelah implementasi | 1 | 39 pass / 3 fail karena entity apostrof markup pada test baru |
| command sama setelah normalisasi entity HTML | 0 | 6 file / 42 test pass |
| `pnpm test`, pertama | 1 | 133 file pass / 10 fail; 1274 test pass / 1 fail, 9 suite browser terputus karena optimisasi dependency Vite |
| import-start-ui, progress-status, dua story baru | 0 | 4 file / 34 test pass |
| `pnpm test`, ulang | 0 | 143 file / 1315 test pass, 0 fail |
| `pnpm typecheck` | 0 | 0 error, termasuk pengulangan setelah story baru |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | 0 error / warning lint |
| `git diff --check` | 0 | tanpa whitespace error |

## Acceptance terbukti dan yang belum

- Acceptance 6 dan 7 pada level unit: pulse tanpa gradient, sembilan fallback mempunyai teks terlihat dalam en/id; recovery pada 8000 ms, tombol Reload. Utility animate-pulse lama pada fallback CV/achievements diganti Skeleton agar durasi dan reduced motion satu sumber.
- Acceptance 8 pada level unit: hook Next di-mock true/false, bukan state navigasi buatan. Next hanya memberi konteks ke child Link, sehingga helper client kecil mencerminkan pending ke atribut anchor lewat efek. Spinner mengganti ikon setelah delay CSS, bukan menghapus label.
- Acceptance 9 pada level unit: 3 s, 30/45/60 s, masa depan dijepit nol, kind ditolak tipe; elapsed di luar live region dan aria-hidden. Interval berhenti saat hidden/unmount; tahap berganti tidak mereset waktu tunggu job yang sama.
- Indikator Clock3 statis tersedia untuk reduced motion. Story normal, lama, dark dan preferensi reduced motion tersedia. Pembuktian computed style, timer DOM, klik reload dan browser reduced motion masih Fase 5.

## Selisih dan warning

- Helper LoadingIndicator dan PendingLinkContent ditambahkan untuk berbagi indikator serta mematuhi batas konteks useLinkStatus. Tidak ada dependency baru atau perubahan server action.
- Key tahap existing dipakai ulang. Hanya lima key baru: common.loadingPage/stillLoading/reload dan progress.elapsed/slow; seluruhnya en/id. Final audit copy tetap Fase 4.
- Assertion lama import-start-ui mengharuskan teks tahap langsung setelah role=status. Implementasi disesuaikan agar teks tetap langsung di region; assertion tidak disentuh. Indikator diurutkan secara visual melalui CSS. Tidak ada assertion lama dilemahkan.
- Test baru progress-status menormalkan entity apostrof HTML sebelum membandingkan teks yang sama. Itu bukan perubahan ekspektasi produk.
- Vite pertama mengoptimisasi lucide-react saat story baru dimuat lalu me-reload suite; ulang dengan cache siap lulus, tanpa mematikan test browser atau mengubah konfigurasinya. Warning MDX dan mock hook sama dengan baseline.

Tidak ada blocker. Berikutnya Fase 3, TDD tombol pending dengan label asli, lebar tetap, dan efek tekan.

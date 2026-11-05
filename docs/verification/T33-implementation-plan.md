# Handoff T33 Multi-select di daftar "Available to add" CV: eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [x]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 5 November 2026
- Status saat plan ditulis: **TODO**.
- Dependensi: T19 (CV builder), T20 (freshness), dan T32 **DONE** di `main` (`e3e522a`).
- Asal task: permintaan terarah pengguna pada 5 November 2026 (screenshot daftar "Available to add" di `/cv`, "kalau ini diubah jadi Multiple Select"). T33 **tidak ada** di `IMPLEMENTATION_PLAN.md` §5. Bentuk daftar checkbox dipilih pengguna. Keputusan lain di §2.2 diusulkan di chat, dan pengguna meninjaunya lewat plan ini.
- Eksekutor: satu agent **Claude Sonnet 5.5** (`claude-sonnet-5-5`) di sesi terpisah, ditetapkan pengguna 5 November 2026. Semua fase berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus 5.5). Gate review read-only wajib setelah Fase 3. Fase 4 (draft dokumen) dikerjakan setelah gate.
- Branch: `claude/t33-cv-multi-select`, dari `origin/main`. **Jangan push, jangan buka PR, jangan merge** kecuali pengguna memintanya.
- antislop: mode **during** (dipilih pengguna 5 November 2026; jangan ditanyakan lagi). Pelaksana membaca `antislop`, `antislop-ui`, `antislop-human`, `antislop-layoutmobile`, dan `antislop-copywriting` dari `.claude/skills/<nama>/SKILL.md`, lalu menjalankan Delivery Gate di Fase 3.
- Acuan:
  - [Decision 0025](../decisions/0025-t19-cv-builder-overrides.md) #6 (tanpa auto-selection dan *Add all*, bulk-add ditunda), #7 (operasi struktural langsung), #12 (aturan state sebagai modul murni), #13 (Add to CV adalah tautan).
  - `docs/IMPLEMENTATION_PLAN.md` T19 dan Wireframe S13 sebagai konteks. `AGENTS.md` *UI dan aksesibilitas*.
  - Kode: `src/features/cv/cv-section.tsx` (`:160-190` `PoolRow`, `:214-221` daftar), `src/features/cv/cv-builder.tsx` (`:157-174` `fail`, `:176-206` `runOperation`, `:214-220` `onAdd`, `:461` wiring), `src/features/cv/cv-builder-state.ts`, `src/features/cv/cv-view.ts` (`:6-12` `PoolOption`, `:45-49` `resolveHighlight`), `src/app/globals.css` (`.cv-pool*`), `src/i18n/messages.ts` (`cv.*`, en dan id).
  - RPC: `public.select_cv_source` versi terakhir di `supabase/migrations/20261004090000_t20_cv_freshness_deletion.sql:897`.

**Goal:** Di setiap section CV, pengguna mencentang beberapa record di "Available to add", lalu menambahkannya sekaligus dengan satu tombol. Tombol Add per baris hilang. Tidak ada yang masuk CV sebelum tombol ditekan.

**Architecture:** Hanya sisi aplikasi. Tombol menjalankan `selectCvSourceAction` yang sudah ada, satu per satu dalam urutan daftar, memakai `cvRevision` dari respons sebelumnya sebagai `expected_revision` berikutnya. Halaman di-refresh sekali di akhir. Aturan state tinggal di `cv-builder-state.ts` dan diuji unit (decision 0025 #12). Tidak ada migration, RPC, route, atau dependency baru.

**Tech stack:** Next.js 16 App Router, React 19, CSS di `globals.css` dengan token dari `src/styles/tokens.css`, Vitest env `node` (markup lewat `renderToStaticMarkup`, tanpa DOM), Playwright + axe-core.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md`, decision 0025, dan file antislop di atas.

Kutipan sumber yang mengikat (parafrase ringkas):

- **Decision 0025 #6:** tidak ada auto-selection dan tidak ada *Add all*, karena PRD freshness melarang menambah diam-diam. T33 mengizinkan bulk-add yang tiap item-nya dipilih sendiri, dan tetap tanpa *Add all*.
- **Decision 0025 #7:** operasi struktural langsung tersimpan, teks lewat draft + Save. Draft wording yang belum disimpan harus bertahan melewati penambahan batch.
- **`select_cv_source`:** achievement dengan project atau experience otomatis ikut menambahkan induknya bila belum ada di CV. Record yang sudah ada menghasilkan `CV_SOURCE_DUPLICATE`. Revision yang basi ditolak.
- **`AGENTS.md`:** target sentuh 44 px, status tidak bergantung warna, verifikasi 360 px dan 1440 px light/dark.

Pertahankan perubahan lokal pengguna. Checkout utama `D:\Project\WorkPulse` sedang di branch PR lain (`claude/t32-landing`) dan punya file untracked milik pengguna. Jangan menyentuhnya; kerjakan T33 di worktree branch ini. Jangan menandai T33 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`.

Pada akhir setiap fase, tulis **receipt** di `docs/verification/T33-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T33

T33 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Checkbox per record.** Setiap record yang belum di CV punya satu `checkbox` bernama record itu, dan tidak ada lagi tombol Add per baris. Dibuktikan unit (markup) dan E2E.
2. **Record yang sudah di CV.** Barisnya tanpa checkbox, menampilkan teks "Added", dan keterangan "On the CV under ..." tetap ada. Dibuktikan unit dan E2E.
3. **Tanpa write sebelum tombol.** Mencentang tidak menulis ke database: `cv_items` tetap kosong setelah mencentang. Dibuktikan E2E (query `cv_items`).
4. **Tombol dan labelnya.** Satu tombol per section yang masih punya record tersedia. Dengan 0 centang: `aria-disabled`, klik tidak melakukan apa-apa, ada keterangan terlihat. Dengan N centang: "Add N to CV" / "Tambahkan N ke CV". Section tanpa record tersedia tidak punya tombol. Dibuktikan unit dan E2E.
5. **Batch berurutan.** Tiga record tercentang masuk CV dalam urutan daftar (bukan urutan klik), `cv_documents.revision` naik sesuai jumlah panggilan, dan tidak ada konflik palsu. Dibuktikan unit (fake action) dan E2E.
6. **Achievement dengan induk.** Dua achievement satu project dalam satu batch menghasilkan satu project dengan dua anak, tanpa duplikat dan tanpa error. Dibuktikan E2E.
7. **Gagal sebagian.** Bila satu item gagal: proses berhenti, item yang berhasil tetap masuk, item yang gagal dan sisanya tetap tercentang, pesan menyebut jumlahnya, dan pesan error membawa correlation ID. Dibuktikan unit dan E2E (mengarsipkan atau menghapus sumber lewat sesi lain sebelum menekan tombol).
8. **Konflik revision.** Revision basi dari sesi lain tetap masuk alur konflik yang ada, dan draft wording tidak hilang. Skenario "Add SQL" di `tests/e2e/cv-builder.spec.ts:369` tetap lulus setelah dimigrasikan, dengan assertion yang sama.
9. **Tautan Add to CV.** `/cv?highlight=<id>` menampilkan baris Suggested dengan checkbox tercentang dan terfokus, `cv_items` tetap kosong, dan record baru masuk setelah tombol ditekan. Nilai highlight yang tidak valid tidak mencentang apa pun. Dibuktikan E2E.
10. **Keyboard dan screen reader.** Seluruh alur bisa dilakukan tanpa pointer (Tab, Space, Enter). Live region mengumumkan progres dan hasil. Setelah sukses, fokus pindah ke judul section. Fokus tidak hilang selama proses. Dibuktikan E2E (`release-keyboard` dan test reduced motion).
11. **Responsif dan kontras.** Di 360 px dan 1440 px, light dan dark: tinggi baris yang bisa diklik ≥ 44 px, seluruh baris men-toggle checkbox, nama panjang membungkus, tidak ada scroll horizontal, dan axe nol temuan WCAG 2.2 AA. Kontras batas checkbox ≥ 3:1 dicek dengan `.claude/skills/antislop-human/contrast-check.py`. Dibuktikan E2E dan receipt.
12. **Tanpa *Add all*.** `getByRole("button", { name: /^Add all/ })` tetap 0, dan tidak ada "Select all". Assertion lama di `tests/unit/cv-builder-ui.test.tsx:45` dan `tests/e2e/cv-builder.spec.ts:173` tetap ada.
13. **Tanpa regresi.** Suite CV, journey M4 dan M5, serta `test:e2e:release` lulus tanpa assertion dilemahkan. Parity migration tetap 38/38.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Baris daftar, tombol tambah, dan state seleksi di `/cv`.
- Runner batch berurutan dan aturan state murni.
- Copy en dan id, CSS daftar.
- Migrasi test yang memakai tombol Add per baris, dan lock ulang `docs/verification/T25-aria/s13-cv.aria.yml`.
- Decision record baru dan verification doc (Fase 4).

### 2.2 Keputusan implementasi

1. **Daftar checkbox, bukan dropdown atau hybrid** (pilihan pengguna). *Alasan:* semua pilihan terlihat, detail baris tetap muat, dan pola checkbox sudah ada (`import-review-candidate.tsx:172`).
2. **Pakai RPC lama berurutan, tanpa RPC baru.** *Alasan:* tiap penambahan berdiri sendiri, jadi gagal sebagian tidak merusak CV, dan hasilnya sama dengan klik satu per satu. Efek samping per item ikut sama tanpa perlu ditulis ulang.
3. **Tanpa "Pilih semua".** *Alasan:* sejalan dengan decision 0025 #6.
4. **Berhenti di kegagalan pertama.** Sisanya tetap tercentang supaya bisa dicoba lagi. *Alasan:* kegagalan revision atau jaringan hampir pasti berulang pada item berikutnya.
5. **Urutan daftar, bukan urutan klik.** *Alasan:* hasilnya bisa ditebak dan mudah diuji.
6. **Refresh sekali di akhir.** `router.refresh()` dipanggil sekali bila minimal satu item berhasil, atau lewat `fail()` untuk konflik. *Alasan:* refresh per item menyebabkan layout bergeser saat proses berjalan.
7. **Item Suggested langsung tercentang.** Fokus ke checkbox, belum ada write. *Alasan:* pengguna sudah sengaja mengeklik "Add to CV", dan tanpa ini butuh tiga langkah. Ini bukan auto-selection: tetap perlu tombol, dan centangnya terlihat.
8. **Item yang sudah masuk hanya bisa dihapus lewat ikon sampah.** *Alasan:* menghapus centang tidak boleh melewati dialog hapus item beranak.
9. **`aria-disabled` + guard, bukan `disabled`,** untuk tombol dan checkbox selama proses (0 centang atau `busy`). *Alasan:* temuan T19 Fase 5, `disabled` membuang fokus.
10. **Selector stabil.**
    - Checkbox: `id="cv-pool-check-<sourceId>"`, dinamai dengan `aria-labelledby` ke nama record dan dijelaskan `aria-describedby` ke detail bila ada, supaya badge Suggested tidak masuk nama.
    - Tombol: `id="cv-pool-add-<sectionKey>"`, `data-testid="cv-pool-add"`.
    - Teks Added: `id="cv-pool-added-<sourceId>"`, `data-testid="cv-pool-added"`, dengan teks sr-only dari `cv.aria.added`.
    - `id="cv-add-<id>"` lama dihapus. `data-testid="cv-pool-row"`, `aria-current`, `cv-pool-placement`, dan anchor `#cv-pool-<section>` tetap.
11. **State seleksi satu `Set<sourceId>` di `CvBuilder`,** diinisialisasi dari `highlightId` (sudah divalidasi `resolveHighlight`). Pilihan efektif selalu diturunkan dari pool saat ini, jadi item yang sudah masuk gugur sendiri setelah refresh.
12. **Copy.** Pakai persis tabel ini, tanpa em dash. Kunci lama `cv.action.add` dan `cv.aria.add` dihapus bila tidak terpakai lagi.

    | Key | en | id |
    |---|---|---|
    | `cv.pool.addSelected` | Add {count} to CV | Tambahkan {count} ke CV |
    | `cv.pool.addNone` | Add to CV | Tambahkan ke CV |
    | `cv.pool.selectHint` | Select at least one record. | Pilih minimal satu catatan. |
    | `cv.pool.adding` | Adding {current} of {total} | Menambahkan {current} dari {total} |
    | `cv.announce.addedMany` | {count} records added to the CV. | {count} catatan ditambahkan ke CV. |
    | `cv.notice.partialAdd` | {added} of {total} added. The rest stay selected so you can try again. | {added} dari {total} ditambahkan. Sisanya tetap terpilih supaya bisa dicoba lagi. |

    Untuk satu item, pakai `cv.announce.added` yang sudah ada.
13. **Decision baru bernomor 0044.** Nomor 0043 sudah dipakai PR #41 yang belum merge, walau belum terlihat di branch ini.
14. **Gaya mengikuti app.** Repo tidak punya `DESIGN.md`. Pakai checkbox native dan token yang ada, tanpa warna, ikon, atau animasi baru. Dial mengikuti app: ENERGY 1, RHYTHM 1, MOTION 1.

### 2.3 Di luar scope

"Pilih semua", pencarian di daftar, tombol sticky, RPC batch, undo batch, drag-and-drop, perubahan alur hapus, perubahan dashboard, dan isu lain di PR #41.

## 3. Kontrak teknis

Tambahkan ke `cv-builder-state.ts`. Tidak boleh ada import React.

```ts
/** Records to add, in list order: chosen, still in the pool, and not on the CV yet. */
export function addableSelection(pool: readonly PoolOption[], chosen: ReadonlySet<string>): PoolOption[];

/** Label key and disabled state of a section's add button; null when nothing is left to add. */
export function poolAddButton(available: number, chosenCount: number): { messageKey: MessageKey; disabled: boolean } | null;

export interface SequentialAddResult {
  added: PoolOption[];
  /** The record the run stopped at; null when every record was added. */
  failed: PoolOption | null;
  /** The failed answer from the server; null when the call threw or gave no revision. */
  failure: ActionState | null;
  revision: number;
}

/** Adds records one at a time, each with the revision the previous answer returned, and stops at the first failure. */
export function runSequentialAdds(input: {
  options: readonly PoolOption[];
  revision: number;
  add: (option: PoolOption, revision: number) => Promise<ActionState>;
  onProgress?: (current: number, total: number) => void;
}): Promise<SequentialAddResult>;
```

`runSequentialAdds` tidak pernah melempar. Panggilan yang melempar, atau jawaban sukses tanpa `cvRevision` numerik, menghentikan proses dengan `failure: null`. Runner tidak boleh menebak revision.

Di `cv-builder.tsx`, `onAdd` diganti `onAddSelected(sectionKey)` dan `onTogglePoolOption(sourceId, checked)`:

1. Keluar bila `busyRef.current` true atau daftar kosong. Set `busyRef`, `setBusy(true)`, kosongkan notice.
2. Jalankan `runSequentialAdds`. `add` membuat `form({ expected_revision, source_type, source_id })` dan memanggil `selectCvSourceAction`. `onProgress` mengisi `announcement`.
3. `setLocalRevision(result.revision)`. Keluarkan `added` dari Set.
4. Semua berhasil: `pendingFocus` ke `cv-section-heading-<sectionKey>`, umumkan hasil, `router.refresh()` sekali.
5. Ada yang gagal: `fail(failure)`, atau `error.unavailable` dengan `clientCorrelationId()` bila `failure` null. Bila `added.length > 0`, isi `cv.notice.partialAdd` lewat `infoNotice` dan pastikan `router.refresh()` berjalan (`fail()` hanya me-refresh untuk konflik). Fokus ke notice lewat `setNoticeFocus`.
6. `finally`: lepas `busyRef` dan `busy`.

`runOperation` jangan diubah perilakunya, karena dipakai operasi lain.

Di `cv-section.tsx`: `PoolRow` menjadi `<li>` berisi `<label>` selebar baris untuk record tersedia, atau teks Added untuk record yang sudah masuk. Efek highlight (`:164-170`) menargetkan `cv-pool-check-<id>`. `CvSection` menampilkan tombol dan keterangan setelah `<ul>`. `SectionHandlers` berganti ke `chosen`, `onTogglePoolOption`, dan `onAddSelected`.

CSS: tinggi baris minimal `var(--touch-target-min)`, nama membungkus (`min-width: 0`), focus ring terlihat di kedua tema. Selector `.cv-pool [aria-disabled="true"]` (`opacity: 0.75`) tetap untuk tombol, tetapi periksa kontras labelnya saat nonaktif.

## 4. Struktur file

Berubah:

- `src/features/cv/cv-builder-state.ts`, `cv-builder.tsx`, `cv-section.tsx`
- `src/i18n/messages.ts`, `src/app/globals.css`
- `tests/unit/cv-builder-ui.test.tsx` dan test unit state CV yang sudah ada (cari file yang menguji `cv-builder-state`)
- `tests/e2e/cv-builder.spec.ts`, `cv-export.spec.ts`, `cv-freshness.spec.ts`, `m4-cv-journey.spec.ts`, `m5-pilot-journey.spec.ts`, `release-keyboard.spec.ts`
- `docs/verification/T25-aria/s13-cv.aria.yml` (lock ulang di Fase 3)

Baru:

- `docs/verification/T33-phaseN-*.md`, `docs/verification/T33-cv-multi-select.md`, `docs/decisions/0044-t33-cv-multi-select.md`

Tidak boleh berubah: `supabase/migrations/*`, `package.json`, `pnpm-lock.yaml`, `src/features/cv/actions.ts`.

## 5. Fase eksekusi

### Fase 0: baseline, tanpa edit kode

- [ ] Siapkan worktree: `pnpm install --frozen-lockfile`, salin `.env.local` dari checkout utama, dan salin **hanya** lima file `supabase/.temp/{storage,postgres,gotrue,rest}-version` dan `storage-migration` (lihat §7).
- [ ] Pastikan branch `claude/t33-cv-multi-select` bersih dan parity migration 38/38.
- [ ] Jalankan `pnpm lint`, `pnpm typecheck`, `pnpm test`. Harapan unit dari receipt T32: 163 file / 1562 test. Catat angka nyata.
- [ ] Jalankan `pnpm test:e2e:cv` untuk baseline. Catat flaky yang sudah ada.
- [ ] Verifikasi klaim file:baris di header, dan bahwa semua jawaban sukses `selectCvSourceAction` membawa `cvRevision` numerik. Bila tidak, berhenti (§8).
- [ ] Tulis `T33-phase0-baseline.md`, commit.

### Fase 1: aturan state dan copy (TDD unit)

- [ ] Test gagal untuk `addableSelection`: urutan daftar, membuang yang `selected`, membuang id yang tidak ada di pool.
- [ ] Test gagal untuk `poolAddButton`: `available = 0` → null, `chosen = 0` → disabled + `cv.pool.addNone`, `chosen > 0` → `cv.pool.addSelected`.
- [ ] Test gagal untuk `runSequentialAdds` dengan fake `add`: revision dirantai, urutan benar, berhenti di kegagalan pertama, tangkap throw, jawaban tanpa revision, `onProgress`.
- [ ] Implementasi, tambah copy en dan id, lulus, commit `feat(t33): add pool selection rules and copy`.
- [ ] Tulis `T33-phase1-state.md`.

### Fase 2: UI

- [ ] Perbarui `tests/unit/cv-builder-ui.test.tsx` lebih dulu sampai gagal: checkbox, tanpa `aria-label="Add SQL to CV"`, teks Added tanpa checkbox, tombol nonaktif, highlight tercentang, tetap tanpa "Add all".
- [ ] Implementasi `cv-section.tsx`, `cv-builder.tsx`, dan CSS sesuai §3. Lulus unit, lint, typecheck.
- [ ] Commit `feat(t33): select several records from the CV pool`.
- [ ] Tulis `T33-phase2-ui.md`.

### Fase 3: E2E, regresi, Delivery Gate

- [ ] Migrasikan helper `add()` di `cv-builder.spec.ts:114-117`: centang, klik `cv-pool-add` section itu, tunggu `cv-pool-added`. Migrasikan semua pemakaian di spec lain per §2.2.10. Assertion lama diganti padanan yang setara, tidak dibuang.
- [ ] `m4-cv-journey.spec.ts:424-427` dan `release-keyboard.spec.ts:173-179`: fokus awal di checkbox yang tercentang, lalu pindah ke tombol dengan keyboard.
- [ ] Tambah E2E baru untuk acceptance 3, 4, 5, 6, 7, 9, 11.
- [ ] Lock ulang aria hanya setelah melihat diff-nya: `WORKPULSE_RELEASE_WRITE_ARIA=1` pada `release-a11y`. Lampirkan ringkasan diff di receipt. Selain area daftar, tidak boleh ada yang berubah.
- [ ] Jalankan regresi §7. Klik setiap kontrol di browser lalu catat per elemen (R-35). Jalankan Delivery Gate antislop lengkap sebagai laporan PASS/FAIL dengan bukti.
- [ ] Commit `test(t33): cover the multi-select pool end to end`, lalu tulis `T33-phase3-e2e-regression.md`.
- [ ] **Berhenti di sini.** Laporkan ke pengguna bahwa gate review siap dijalankan. Jangan lanjut ke Fase 4 sebelum diminta.

### Fase 4: draft dokumen (setelah gate)

- [ ] `docs/decisions/0044-t33-cv-multi-select.md`: menggantikan sebagian decision 0025 #6, berisi keputusan §2.2 dan batas yang belum diuji.
- [ ] `docs/verification/T33-cv-multi-select.md`: acceptance per poin dengan bukti, tanpa klaim DONE.
- [ ] Commit `docs(t33): add decision 0044 and acceptance record`.

## 6. Fixture

Pakai helper yang ada di `tests/e2e/cv-builder.spec.ts` (`createUser`, `createAchievement`, `createProject`, `createSkill`, `createEducation`, `secondSession`). Akun dibuat per test. Record memakai teks fiktif yang sudah dipakai suite (mis. "Skripsi Sistem Antrian"). Untuk acceptance 11, tambahkan satu record bernama panjang.

## 7. Commands

Hanya script yang ada; tidak ada script baru.

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:cv
pnpm test:e2e:cv-freshness
pnpm test:e2e:cv-export
pnpm test:e2e:m4
pnpm test:e2e:m5
pnpm test:e2e:release
git diff --check
```

Catatan lingkungan mesin ini (PowerShell 5.1):

- **Secret.** `.env.local` tidak punya `SUPABASE_SECRET_KEY`. Isi env proses dari `SERVICE_ROLE_KEY` hasil `pnpm exec supabase status -o env`. Jangan mencetak atau menyimpannya. Env PowerShell tidak bertahan antar command, jadi muat di command yang sama dengan suite. `db:start` dan `db:status` mencetak key, jadi saring outputnya.
- **Env AI.** Harness menyuntikkan `AI_AGENT` dan `ANTHROPIC_BASE_URL`. Kosongkan dengan `$env:AI_AGENT = $null; $env:ANTHROPIC_BASE_URL = $null`. Jangan melemahkan assertion test.
- **Stack lokal dipakai bersama semua worktree.** Jangan `db:reset`. Jangan me-restart stack dari worktree tanpa lima file `.temp` di atas, karena upload bisa rusak dengan `42P10`. Bila kontainer mati, cek `docker ps`, lalu `pnpm db:start` dan `docker start` kontainer `workpulse-*`.
- **Suite release** butuh `workpulse-t10-clamav`, `workpulse-t15-gotenberg`, dan `workpulse-t21-pdf` hidup. `release-a11y` dan suite UI menimpa screenshot T25/T27/T30 yang tracked: `git checkout` file itu setelah run, kecuali file aria yang memang dikunci ulang.
- **Pipa.** Jangan `pnpm ... | Select-Object -First`, karena prosesnya mati. Tangkap dengan `Out-String`, lalu saring. Commit multi-baris pakai `git commit -F <file>`.
- **Flaky yang sudah ada.** `landing.spec.ts` layout 360, `motion-loading.spec.ts:61`, `activity-ui.spec.ts`. Bandingkan dengan base sebelum menyalahkan T33.
- **Playwright.** Bila `pnpm exec playwright` berbenturan versi, jalankan `node node_modules/@playwright/test/cli.js test --config <config>`.
- **Port.** Sesi lain bisa memakai port dev atau menjalankan worker di DB yang sama. Tanyakan pengguna sebelum menghentikan proses yang bukan milikmu.

## 8. Stop conditions

Berhenti dan laporkan ke pengguna bila:

- Working tree kotor di luar perubahan T33, atau checkout utama perlu disentuh.
- Butuh migration, RPC baru, `db:reset`, dependency baru, atau perubahan `actions.ts`.
- `selectCvSourceAction` tidak selalu mengembalikan `cvRevision` pada sukses.
- Efek samping per item (mis. `product_events`) ternyata berbeda antara batch dan klik tunggal.
- Sebuah test hanya bisa lulus dengan melemahkan assertion, atau diff aria menyentuh area di luar daftar.
- Salah satu poin acceptance tidak bisa dipenuhi dengan desain ini, atau pelaksana ingin menambah sesuatu dari §2.3.
- Masalah credential, atau butuh akses ke project hosted. T33 tidak menyentuh hosted sama sekali.

## 9. Gate review Claude

Read-only setelah Fase 3, pada commit terakhir branch. P0-P2 memblokir, P3 follow-up.

- [ ] Receipt Fase 0-3 lengkap, angkanya bisa diulang, dan tidak ada assertion dilemahkan (`git diff` pada `tests/`).
- [ ] Jalankan ulang lint, typecheck, unit, `test:e2e:cv`, dan `test:e2e:release`.
- [ ] Tidak ada perubahan di `supabase/migrations`, `package.json`, atau `actions.ts`.
- [ ] Parity 38/38 dan tanpa *Add all*.
- [ ] Diff `s13-cv.aria.yml` hanya area daftar.
- [ ] Laporan Delivery Gate ada dan berbukti, termasuk daftar klik per elemen.
- [ ] Cek langsung di browser: alur 3 item, gagal sebagian, Suggested, keyboard, 360 px dark.

## 10. Review focus

1. **Revision basi di dalam loop.** State React `revision` tidak diperbarui di antara panggilan. Runner wajib memakai `cvRevision` dari respons. Dijaga unit `runSequentialAdds` dan E2E acceptance 5.
2. **Draft wording hilang atau konflik palsu saat batch.** `syncDraft` berjalan saat `savedKey` berubah. Dijaga E2E: ketik wording, tambah batch, teks masih ada dan Save masih aktif.
3. **Fokus hilang.** Baris berubah dari checkbox menjadi teks setelah refresh. `pendingFocus` hanya berjalan saat `savedKey` berubah, jadi jalur gagal total harus tetap menjaga fokus. Dijaga `release-keyboard` dan acceptance 7.
4. **Gagal sebagian tanpa refresh.** `fail()` tidak me-refresh untuk error biasa, sehingga item yang berhasil bisa tampak belum masuk. Dijaga E2E acceptance 7.
5. **Klik di dalam label.** Tautan atau elemen interaktif di dalam `<label>` baris bisa men-toggle tanpa sengaja. Baris tidak boleh memuat elemen interaktif lain.
6. **Nama aksesibel checkbox.** Tidak boleh ikut memuat "Suggested" atau detail, karena selector dan screen reader bergantung padanya. Dijaga unit, E2E, dan aria snapshot.

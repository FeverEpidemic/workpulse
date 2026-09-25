# Decision 0011 — T07 Review Remediation

Tanggal: 20 September 2026  
Status: **accepted**

## Konteks

Review T07 menemukan tiga celah pada recovery draft Activity, update minimal Note/Chat, dan
propagasi error context options. Ketiganya dapat diperbaiki pada boundary TypeScript/UI tanpa
mengubah schema, RPC, RLS, migration, atau dependency.

## Keputusan

### 1. Draft edit menyimpan base revision sebagai metadata terpisah

Draft values tetap memakai format session draft yang ada. Edit Activity menyimpan metadata
terpisah, owner-scoped dan form-scoped, dengan `schemaVersion` serta `baseRevision` saja.
Metadata bukan authority: session server dan `expected_revision` tetap menjadi pengaman terakhir.

Draft dengan base revision yang berbeda dari row server, atau draft lama tanpa metadata yang valid,
mempertahankan input lokal tetapi harus melalui review eksplisit. `Reload server` membuang draft;
`Review and retry my changes` merebase ke revision yang sedang dilihat pengguna. Cleanup values dan
metadata dilakukan bersama.

### 2. Update Note/Chat mempertahankan structured fields canonical

Create Note/Chat tetap minimal dan menyimpan `role`, `scope`, serta `outcome` sebagai `null`.
Create/update Form tetap membaca field tersebut dari input Form. Pada update Note/Chat, server
action mengambil snapshot Activity milik pengguna saat ini dan mempertahankan structured fields;
payload client tidak dapat mengosongkan atau mengubahnya.

UI edit Note/Chat tidak merender control editable untuk field yang tidak dapat disimpan. Nilai
existing, bila ada, tetap terlihat sebagai read-only; context Project/Experience tetap dapat diedit.

### 3. Context error memakai kontrak aman dan satu correlation ID

Kegagalan context options dipetakan ke code `UNAVAILABLE`, message key lokal
`activity.contextOptionsUnavailable`, dan UUID correlation ID per error instance. Pesan diagnostics
tetap generik dan tidak membawa detail provider, query, owner, atau private content. Error yang
sama mempertahankan ID saat diteruskan dari service ke list, capture, dan detail; state degraded
tetap dapat menyimpan Activity tanpa context options.

## Batas dan bukti

Keputusan ini tidak memulai T08 dan tidak mengubah dokumen sumber produk. Implementasi berada pada
form/session draft, Activity action/context/page boundaries, i18n, serta unit dan browser tests.
Bukti acceptance dirangkum di [verifikasi T07](../verification/T07-activity-ui.md) dan
[rencana remediasi](../verification/T07-review-remediation-plan.md). Seluruh pemeriksaan memakai
Supabase lokal; tidak ada klaim hosted, staging, atau production.

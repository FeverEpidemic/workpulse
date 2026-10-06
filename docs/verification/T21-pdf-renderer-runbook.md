# T21 CV PDF renderer runbook (Gotenberg / Chromium)

Draft from the Phase 0 probe (6 October 2026). This runbook covers the isolated renderer that turns the CV print
template (HTML) into an A4 PDF for export (R10/F07, plan §2/§8). It does not deploy hosted staging or production.
Finalized in Phase 8 after the gate review.

## Local renderer

The export renderer is a **separate container** from the T15 DOCX page renderer (`workpulse-t15-gotenberg`, port
13400). It uses the same pinned image digest but its own flags: the T15 container runs with
`--chromium-deny-list=".*"`, which is meant to refuse every Chromium URL, so its flags are left unchanged and the T21
container allows only the local file the API itself writes under `/tmp`.

```powershell
docker run -d --name workpulse-t21-pdf --publish 127.0.0.1:13401:3000 --memory 2g gotenberg/gotenberg@sha256:f29984bd1e226bf1b93ba90af06000afa8b315853e99d27b9aaa41b93f15c769 gotenberg --api-timeout=60s --chromium-disable-javascript=true --chromium-allow-list="^file:///tmp/.*" --webhook-deny-list=".*"
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:13401/health
```

Verified on 6 October 2026: Gotenberg 8.37.0 (`/version`), `/health` reports `chromium: up` (and `libreoffice: up`).
For an existing container use `docker start workpulse-t21-pdf` and check `/health` instead of creating a duplicate.
Manage this container only by its name; do not stop the Supabase, ClamAV (T10) or Gotenberg T15 containers.

Fonts: the image ships `Noto Sans` (Regular, Bold, Italic, Bold Italic under `/usr/share/fonts/truetype/noto/`);
`fc-match "Noto Sans"` and `fc-match sans-serif` both resolve to `NotoSans-Regular.ttf`. The template asks for
`'Noto Sans', sans-serif` and loads no external or bundled font.

## Request contract (worker -> renderer)

`POST {base}/forms/chromium/convert/html`, `multipart/form-data`:

| Field | Value | Note |
| --- | --- | --- |
| `files` | the full HTML document, filename `index.html` | the only file; no assets, no script |
| `paperWidth` | `8.27` | inches (A4) |
| `paperHeight` | `11.7` | inches (A4) |
| `preferCssPageSize` | `true` | `@page { size: A4; margin: 16mm 18mm }` decides margins |
| `printBackground` | `false` | the template has no backgrounds |

The response is the PDF (`%PDF-`). The worker caps it at 10 MiB, requires the `%PDF-` signature, and verifies page
count (1-20) and extracted text in the isolated parser thread before uploading anything.

## Probe results (Phase 0)

| Probe | Result |
| --- | --- |
| Small HTML, Indonesian text, `files` + A4 fields | HTTP 200, `%PDF-`, 17,346 bytes, 1 page, MediaBox `[0 0 594.96 841.92]`, extracted text contains `Siti Nurhaliza Ç. Ñuñez` and `Rp1,5 miliar — “tepat waktu”` |
| 20 explicit pages (`break-after: page`) | HTTP 200, 55,479 bytes, `pdf-pages` = 20, `pdf` = ok 20 pages, every page A4 |
| 21 pages | `pdf-pages` = 21 (the worker maps it to `EXPORT_TOO_LONG`); `pdf` kind = `TOO_MANY_PAGES` |
| ~9.26 MiB PDF (random-noise image + text) | HTTP 200 in 1.7 s, parser accepts it (`pdf-pages` 1, `pdf` ok 1) |
| `<script>` that rewrites the body | not executed (sentinel text absent, static text present) |
| `<img src="http://127.0.0.1:3000/health">` and `<img src="file:///etc/passwd">` | conversion still 200, resource not loaded |

Parser note: `parseInThread("pdf")` rejects a PDF whose extracted text has fewer than 200 non-blank characters
(`IMPORT_MIN_TEXT_CHARS`, code `SCANNED_PDF`). A legitimate short CV can fall below that, so the export worker needs a
text check that does not apply the import threshold (decided in Phase 4, recorded in its receipt).

## Worker-only configuration (never in browser or web-server env)

```dotenv
WORKPULSE_PDF_RENDERER_MODE=gotenberg
WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401
WORKPULSE_PDF_RENDER_TIMEOUT_MS=60000
```

Default mode is `unavailable`: export jobs then fail with the retriable `RENDERER_UNAVAILABLE`, the CV stays
untouched, and the user can retry. `fake` is refused outside `NODE_ENV=development|test` and the worker summary marks it
as `pdfRenderer: "explicit-test-fake"`. A bad URL or an out-of-range timeout (1,000-90,000 ms) fails closed to
`unavailable`.

## Verification

```powershell
pnpm test:integration:cv-export
```

`tests/integration/cv-export-renderer-real.test.ts` fails loudly when the renderer is not reachable; it never falls
back to the fake.

## Staging notes

- Keep the renderer on a private network reachable only by the worker; it has no authentication.
- Run the container without outbound internet in staging; the template needs no network access.
- `--chromium-disable-javascript=true` and the file allow-list are defense in depth: the template contains no script
  and no external resource by construction (unit-tested).
- Record image digest, Gotenberg version, memory limit, and observed render latency in the staging evidence.
- Local results do not prove staging isolation or production behavior (T25).

## Stop the local renderer

```powershell
docker stop workpulse-t21-pdf
docker rm workpulse-t21-pdf
```

These commands target only the named T21 container.

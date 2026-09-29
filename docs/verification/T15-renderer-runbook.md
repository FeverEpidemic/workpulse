# T15 DOCX page renderer runbook (Gotenberg / LibreOffice)

This runbook covers the isolated renderer used only to count DOCX pages for CV import (R02/F01, plan §2/§4/§8).
It does not deploy hosted staging or production. DOCX metadata (`docProps/app.xml`) is never trusted for page counts.

## Local renderer

Start the pinned image on loopback only, without mounting files:

```powershell
docker run -d --name workpulse-t15-gotenberg --publish 127.0.0.1:13400:3000 --memory 2g gotenberg/gotenberg@sha256:f29984bd1e226bf1b93ba90af06000afa8b315853e99d27b9aaa41b93f15c769 gotenberg --api-timeout=60s --chromium-disable-javascript=true --chromium-deny-list=".*" --webhook-deny-list=".*"
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:13400/health
```

Verified on 29 September 2026: Gotenberg 8.37.0, health reports `libreoffice: up`.
For an existing container use `docker start workpulse-t15-gotenberg` and check `/health` instead of creating a duplicate.

Worker-only configuration (never in browser or web-server env):

```dotenv
WORKPULSE_DOCX_RENDERER_MODE=gotenberg
WORKPULSE_GOTENBERG_URL=http://127.0.0.1:13400
WORKPULSE_DOCX_RENDER_TIMEOUT_MS=30000
```

Default mode is `unavailable`: DOCX imports then fail with the retriable `PAGE_COUNT_UNAVAILABLE` and the user keeps
the manual path. `fake` (page breaks + 1) is refused outside `NODE_ENV=development|test` and the worker summary marks it
as `docxRenderer: "explicit-test-fake"`.

The worker sends only the DOCX bytes as a multipart part named `document.docx` (never the user's filename), caps the
response at 50 MiB, requires a `%PDF-` body, and counts pages of the returned PDF in the isolated parser thread.

## Verification

```powershell
pnpm test:integration:import
```

`tests/integration/import-renderer-real.test.ts` fails loudly when the renderer is not reachable; it never falls back
to the fake. It proves a 2-page DOCX counts 2 (metadata says 9) and a 21-page DOCX counts 21 (metadata says 1).

## Staging notes

- Keep the renderer on a private network reachable only by the worker; it has no authentication.
- `--chromium-deny-list=".*"` and `--webhook-deny-list=".*"` disable outbound fetches from the Chromium and webhook
  features, which import does not use. LibreOffice conversion of a DOCX does not need network access; run the container
  without outbound internet in staging.
- Record image digest, LibreOffice version, memory limit, and observed conversion latency in the staging evidence.
- Local results do not prove staging isolation or production behavior.

## Stop the local renderer

```powershell
docker stop workpulse-t15-gotenberg
docker rm workpulse-t15-gotenberg
```

These commands target only the named T15 container. They do not stop Supabase or the T10 ClamAV container.

import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The route reads the session through getRequestContext(); the tests give it a real signed-in Supabase client.
const session = vi.hoisted(() => ({ current: null as null | { id: string; client: unknown } }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/context", () => ({
  getRequestContext: async () => session.current === null
    ? { user: null, client: null, profile: null, profileUnavailable: false }
    : {
      user: { id: session.current.id }, client: session.current.client, profileUnavailable: false,
      profile: { locale: "en", deleting_at: null, onboarding_completed_at: "2026-09-01T00:00:00Z" },
    },
}));

import { GET } from "@/app/api/cv/exports/[id]/route";
import { exportActions } from "@/domain/cv/export-view";
import { resolvePdfRenderer } from "@/server/export/pdf-renderer";

import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";

import {
  LONG_TIMEOUT,
  SENTINEL,
  achievementRow,
  collectedErrors,
  createAccount,
  cvRevision,
  drain,
  exportCount,
  exportInfo,
  expectExportError,
  failingRenderer,
  fake,
  newKey,
  pdfOf,
  readyAccount,
  request,
  signedUrlTtlSeconds,
  sql,
  setupHarness,
  teardownHarness,
  type Account,
} from "./cv-export-support";

const routeAs = (account: Account | null, id: string) => {
  session.current = account === null ? null : { id: account.id, client: account.clients[0] };
  return GET(new Request(`http://localhost/api/cv/exports/${id}`), { params: Promise.resolve({ id }) });
};

const finishedDay = (exportId: string) =>
  sql(`select to_char(finished_at at time zone 'UTC', 'YYYY-MM-DD') from public.cv_exports where id = '${exportId}'::uuid`);

describe("T22 export status route and downloads (real Supabase, real Storage)", () => {
  beforeAll(() => setupHarness());

  afterAll(async () => {
    session.current = null;
    await teardownHarness();
  });

  it("serves status and named or inline downloads to the owner only, with owner-scoped short URLs and no private data", async () => {
    const { account: owner, bullet } = await readyAccount("pva", { displayName: `Ani ${SENTINEL}`, bullet: `${SENTINEL} bullet` });
    const other = await createAccount("pvb", { displayName: "Budi Contoh" });
    const requested = await request(owner);
    expect(requested.status).toBe("queued");

    // Status while queued: safe columns only, never cached.
    const queued = await routeAs(owner, requested.exportId);
    expect(queued.status).toBe(200);
    expect(queued.headers.get("cache-control")).toBe("no-store");
    expect(await queued.json()).toMatchObject({ id: requested.exportId, status: "queued", expired: false, cv_revision: requested.cvRevision, page_count: null });

    await drain(fake);
    const done = await routeAs(owner, requested.exportId);
    const body = await done.json() as Record<string, unknown>;
    expect(done.status).toBe(200);
    expect(body).toMatchObject({ id: requested.exportId, status: "succeeded", expired: false, error_code: null });
    expect(typeof body.page_count).toBe("number");
    for (const forbidden of ["snapshot", "object_key", "attempt_token", "lease_expires_at", "idempotency_key", "user_id"]) {
      expect(Object.keys(body), forbidden).not.toContain(forbidden);
    }
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expect(JSON.stringify(body)).not.toContain(bullet);
    expect(JSON.stringify(body)).not.toContain(owner.id);

    // Another account, a random id and a malformed id are indistinguishable (the same generic 404).
    const results = [
      await routeAs(other, requested.exportId),
      await routeAs(other, randomUUID()),
      await routeAs(other, "not-a-uuid"),
      await routeAs(owner, randomUUID()),
    ];
    const texts: string[] = [];
    const parsed: Record<string, unknown>[] = [];
    for (const response of results) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = await response.text();
      texts.push(text);
      parsed.push(JSON.parse(text) as Record<string, unknown>);
    }
    for (const entry of parsed) {
      expect(Object.keys(entry).sort()).toEqual(["code", "correlationId", "message"]);
      expect({ ...entry, correlationId: null }).toEqual({ ...parsed[0], correlationId: null });
    }
    expect(parsed[0]).toMatchObject({ code: "EXPORT_NOT_FOUND" });
    const anonymous = await routeAs(null, requested.exportId);
    expect(anonymous.status).toBe(401);
    texts.push(await anonymous.text());

    // The other account can neither download, retry nor see the export through the service.
    const foreign = other.exports[0]!;
    const downloadError = await expectExportError(foreign.issueDownload({ export_id: requested.exportId, disposition: "inline" }), "EXPORT_NOT_FOUND");
    const retryError = await expectExportError(foreign.retryExport({ export_id: requested.exportId }), "EXPORT_NOT_FOUND");
    await expect(foreign.getExport(requested.exportId)).resolves.toBeNull();
    await expect(foreign.listExports()).resolves.toEqual([]);
    texts.push(JSON.stringify({ downloadError: downloadError.message, retryError: retryError.message }));

    // Attachment: a generic, dated file name; default disposition is the attachment.
    const day = finishedDay(requested.exportId);
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const named = await owner.exports[0]!.issueDownload({ export_id: requested.exportId, disposition: "attachment" });
    const dflt = await owner.exports[0]!.issueDownload({ export_id: requested.exportId });
    expect(Object.keys(named).sort()).toEqual(["expiresInSeconds", "url"]);
    for (const issued of [named, dflt]) {
      expect(issued.expiresInSeconds).toBeLessThanOrEqual(300);
      const ttl = signedUrlTtlSeconds(issued.url);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(305);
      expect(issued.url).not.toContain(SENTINEL);
      expect(decodeURIComponent(issued.url)).not.toMatch(/Ani|Budi|Contoh/);
      const response = await fetch(issued.url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain(`attachment; filename=WorkPulse-CV-${day}.pdf`);
      expect(Buffer.from((await response.arrayBuffer()).slice(0, 5)).toString("latin1")).toBe("%PDF-");
    }

    // Inline: no attachment header, cross-origin readable by the S14 page, same short lifetime, no name in the URL.
    const inline = await owner.exports[0]!.issueDownload({ export_id: requested.exportId, disposition: "inline" });
    expect(signedUrlTtlSeconds(inline.url)).toBeLessThanOrEqual(305);
    expect(new URL(inline.url).searchParams.has("download")).toBe(false);
    const inlineResponse = await fetch(inline.url, { headers: { Origin: "http://127.0.0.1:3014" } });
    expect(inlineResponse.status).toBe(200);
    expect(inlineResponse.headers.get("content-disposition") ?? "").not.toContain("attachment");
    expect(inlineResponse.headers.get("access-control-allow-origin")).toBe("*");
    expect(inlineResponse.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from((await inlineResponse.arrayBuffer()).slice(0, 5)).toString("latin1")).toBe("%PDF-");
    const preflight = await fetch(inline.url, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:3014", "Access-Control-Request-Method": "GET" } });
    expect(preflight.status).toBe(200);

    // After the 24 hours the status says so and the download is refused.
    sql(`update public.cv_exports set expires_at = clock_timestamp() - interval '1 minute' where id = '${requested.exportId}'::uuid`);
    const expired = await (await routeAs(owner, requested.exportId)).json() as Record<string, unknown>;
    expect(expired).toMatchObject({ status: "succeeded", expired: true });
    await expectExportError(owner.exports[0]!.issueDownload({ export_id: requested.exportId, disposition: "inline" }), "EXPORT_EXPIRED");

    // Nothing the other account (or an anonymous caller) received mentions the owner's CV text.
    const everything = [...texts, JSON.stringify(collectedErrors)].join("\n");
    expect(everything).not.toContain(SENTINEL);
    expect(everything).not.toContain(bullet);
  }, LONG_TIMEOUT);

  it("lets the status route follow an export from queued through running to succeeded", async () => {
    const { account } = await readyAccount("pvc");
    const requested = await request(account);
    const statusOf = async () => (await (await routeAs(account, requested.exportId)).json() as { status: string; page_count: number | null }).status;
    const seen = [await statusOf()];
    // While the worker holds the job (after the render, before it completes) the route says running.
    await drain(fake, { onRendered: async () => { seen.push(await statusOf()); } });
    seen.push(await statusOf());
    expect(seen).toEqual(["queued", "running", "succeeded"]);
  }, LONG_TIMEOUT);

  it("offers Download for the saved revision, and Regenerate (as a new request) once the CV changed", async () => {
    const { account } = await readyAccount("pvd");
    const service = account.exports[0]!;
    const requested = await request(account);
    await drain(fake);
    const saved = await cvRevision(account);
    expect(requested.cvRevision).toBe(saved);

    const [first] = await service.listExports(5);
    const sameRevision = exportActions({ row: first!, savedRevision: saved, readiness: await service.getReadiness(), now: new Date() });
    expect(sameRevision).toEqual({ primary: "download", secondary: [], disabledReason: null });

    // The CV is saved again: the finished PDF belongs to an earlier revision now.
    await account.cv[0]!.saveEdits({ expected_revision: saved, title: `Judul baru ${randomUUID().slice(0, 8)}` });
    const savedAgain = await cvRevision(account);
    expect(savedAgain).toBe(saved + 1);
    const earlier = exportActions({ row: first!, savedRevision: savedAgain, readiness: await service.getReadiness(), now: new Date() });
    expect(earlier).toEqual({ primary: "regenerate", secondary: ["download"], disabledReason: null });

    const regenerated = await service.requestExport({ expected_revision: savedAgain, idempotency_key: newKey() });
    expect(regenerated.exportId).not.toBe(requested.exportId);
    expect(regenerated).toMatchObject({ reused: false, cvRevision: savedAgain, status: "queued" });
    // The earlier export keeps the revision it was made from.
    expect(exportInfo(requested.exportId).cv_revision).toBe(saved);
    await drain(fake);
  }, LONG_TIMEOUT);

  it("offers Retry for a failure of the saved revision with attempts left, and Regenerate after the third attempt or a CV change", async () => {
    const { account } = await readyAccount("pve");
    const service = account.exports[0]!;
    const requested = await request(account);
    const now = () => new Date();
    const newest = async () => (await service.listExports(5))[0]!;

    await drain(failingRenderer("RENDERER_UNAVAILABLE"));
    let row = await newest();
    expect(row).toMatchObject({ id: requested.exportId, status: "failed", error_code: "RENDERER_UNAVAILABLE", attempt_count: 1 });
    const saved = await cvRevision(account);
    expect(exportActions({ row, savedRevision: saved, readiness: await service.getReadiness(), now: now() }).primary).toBe("retry");

    for (let attempt = 2; attempt <= 3; attempt += 1) {
      await service.retryExport({ export_id: requested.exportId });
      await drain(failingRenderer("RENDERER_UNAVAILABLE"));
    }
    row = await newest();
    expect(row).toMatchObject({ status: "failed", attempt_count: 3 });
    expect(exportActions({ row, savedRevision: saved, readiness: await service.getReadiness(), now: now() }))
      .toEqual({ primary: "regenerate", secondary: [], disabledReason: null });
    // The database agrees that a fourth attempt is not allowed.
    await expectExportError(service.retryExport({ export_id: requested.exportId }), "EXPORT_NOT_RETRYABLE");

    // A failure of a revision that is no longer the saved one is never retried (N2): the user regenerates.
    const other = await readyAccount("pvf");
    const failedEarlier = await request(other.account);
    await drain(failingRenderer("RENDERER_TIMEOUT"));
    const earlierRow = (await other.account.exports[0]!.listExports(5))[0]!;
    expect(earlierRow).toMatchObject({ id: failedEarlier.exportId, status: "failed", attempt_count: 1 });
    await other.account.cv[0]!.saveEdits({ expected_revision: await cvRevision(other.account), title: `Judul ${randomUUID().slice(0, 8)}` });
    const readiness = await other.account.exports[0]!.getReadiness();
    expect(exportActions({ row: earlierRow, savedRevision: await cvRevision(other.account), readiness, now: now() }))
      .toEqual({ primary: "regenerate", secondary: [], disabledReason: null });
  }, LONG_TIMEOUT);

  it("never makes two jobs for two clicks on the same saved revision", async () => {
    const { account } = await readyAccount("pvg");
    const service = account.exports[0]!;
    const revision = await cvRevision(account);
    const [one, two] = await Promise.all([
      service.requestExport({ expected_revision: revision, idempotency_key: newKey() }),
      service.requestExport({ expected_revision: revision, idempotency_key: newKey() }),
    ]);
    expect(one.exportId).toBe(two.exportId);
    expect([one.reused, two.reused].sort()).toEqual([false, true]);
    expect(exportCount(account.id)).toBe(1);
    await drain(fake);
  }, LONG_TIMEOUT);

  it("regenerates an expired export as a new request after validating the saved CV", async () => {
    const { account } = await readyAccount("pvh");
    const service = account.exports[0]!;
    const requested = await request(account);
    await drain(fake);
    sql(`update public.cv_exports set expires_at = clock_timestamp() - interval '1 minute' where id = '${requested.exportId}'::uuid`);
    const [row] = await service.listExports(5);
    const saved = await cvRevision(account);
    expect(exportActions({ row: row!, savedRevision: saved, readiness: await service.getReadiness(), now: new Date() }))
      .toEqual({ primary: "regenerate", secondary: [], disabledReason: null });
    const regenerated = await service.requestExport({ expected_revision: saved, idempotency_key: newKey() });
    expect(regenerated).toMatchObject({ reused: false, status: "queued" });
    expect(regenerated.exportId).not.toBe(requested.exportId);
    await drain(fake);
  }, LONG_TIMEOUT);

  it("blocks Export and Regenerate while the saved CV is blocked, but keeps Download of a finished PDF", async () => {
    const { account, achievement, itemId } = await readyAccount("pvi");
    const service = account.exports[0]!;
    const requested = await request(account);
    await drain(fake);
    // Deleting a selected source blocks the next export and bumps the CV revision in the same transaction (T20).
    const source = await achievementRow(account, achievement.id);
    const deleted = await account.clients[0]!.rpc("delete_achievement", { p_achievement_id: achievement.id, p_expected_revision: source.revision });
    expect(deleted.error).toBeNull();
    const readiness = await service.getReadiness();
    expect(readiness).toMatchObject({ ready: false, blockers: [{ code: "ITEM_DELETED", item_id: itemId }] });
    const [row] = await service.listExports(5);
    expect(row!.id).toBe(requested.exportId);
    const actions = exportActions({ row: row!, savedRevision: await cvRevision(account), readiness, now: new Date() });
    expect(actions).toEqual({ primary: "regenerate", secondary: ["download"], disabledReason: "cv.export.error.blocked" });
    // The database refuses the request that the page would not allow: no job is created.
    const before = exportCount(account.id);
    await expectExportError(service.requestExport({ expected_revision: await cvRevision(account), idempotency_key: newKey() }), "EXPORT_BLOCKED");
    expect(exportCount(account.id)).toBe(before);
  }, LONG_TIMEOUT);

  it("serves, from the real Chromium renderer, the stored PDF through an inline URL: same bytes, same page count, readable text", async () => {
    const url = process.env["WORKPULSE_PDF_GOTENBERG_URL"];
    if (!url) throw new Error("Set WORKPULSE_PDF_GOTENBERG_URL (docs/verification/T21-pdf-renderer-runbook.md); this test never falls back to the fake renderer");
    const health = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!health?.ok) throw new Error("The PDF renderer is not reachable: start workpulse-t21-pdf; this test never falls back to the fake renderer");
    const renderer = resolvePdfRenderer({ mode: "gotenberg", baseUrl: url, nodeEnv: "test" });
    expect(renderer.kind).toBe("gotenberg");

    const bullet = "Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”";
    const { account } = await readyAccount("pvj", { displayName: "Siti Nurhaliza Ç. Ñuñez", bullet });
    const requested = await request(account);
    expect(await drain(renderer)).toMatchObject({ succeeded: 1, failed: {}, errored: 0 });

    const status = await (await routeAs(account, requested.exportId)).json() as { status: string; page_count: number };
    expect(status.status).toBe("succeeded");
    const inline = await account.exports[0]!.issueDownload({ export_id: requested.exportId, disposition: "inline" });
    const response = await fetch(inline.url, { headers: { Origin: "http://127.0.0.1:3014" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const served = new Uint8Array(await response.arrayBuffer());
    // The bytes the page would draw are exactly the stored PDF.
    const stored = (await pdfOf(requested.exportId)).bytes;
    const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    expect(hash(served)).toBe(hash(stored));
    const parsed = await parseInThread("pdf-export", served);
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.pageCount).toBe(status.page_count);
    expect((parsed.text ?? "").normalize("NFKC")).toContain(bullet.normalize("NFKC"));
    expect((parsed.text ?? "").normalize("NFKC")).toContain("Siti Nurhaliza Ç. Ñuñez".normalize("NFKC"));
  }, LONG_TIMEOUT);
});

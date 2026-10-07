import { randomUUID } from "node:crypto";

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

import {
  LONG_TIMEOUT,
  SENTINEL,
  collectedErrors,
  createAccount,
  drain,
  expectExportError,
  fake,
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
});

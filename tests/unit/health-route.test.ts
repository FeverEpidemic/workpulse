import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GET, WEB_SERVICE, WEB_SERVICE_VERSION, buildHealthPayload } from "@/app/api/health/route";

const packageVersion = (): string => {
  const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
};

describe("GET /api/health", () => {
  it("answers 200 with the fixed payload", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "workpulse-web",
      version: "0.1.0",
    });
  });

  it("returns exactly the contract body: no dependency probe, no configuration echo", async () => {
    expect(await GET().text()).toBe(
      '{"status":"ok","service":"workpulse-web","version":"0.1.0"}',
    );
    expect(Object.keys(buildHealthPayload()).sort()).toEqual(["service", "status", "version"]);
    expect(buildHealthPayload().service).toBe(WEB_SERVICE);
  });

  it("is never cached", () => {
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });

  it("keeps the reported version aligned with the package version", () => {
    expect(WEB_SERVICE_VERSION).toBe(packageVersion());
  });
});

import { describe, expect, it } from "vitest";

import { buildWorkerBootstrap, serializeWorkerBootstrap } from "../../workers/bootstrap.ts";

describe("worker bootstrap", () => {
  it("announces registered evidence handlers without claiming dependency health", () => {
    expect(buildWorkerBootstrap()).toEqual({
      status: "ready",
      service: "workpulse-worker",
      registeredJobs: ["evidence-scan", "evidence-cleanup"],
    });
    expect(serializeWorkerBootstrap()).toBe(
      '{"status":"ready","service":"workpulse-worker","registeredJobs":["evidence-scan","evidence-cleanup"]}',
    );
  });

});

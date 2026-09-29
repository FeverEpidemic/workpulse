import { describe, expect, it } from "vitest";

import { buildWorkerBootstrap, serializeWorkerBootstrap } from "../../workers/bootstrap.ts";

const JOBS = ["evidence-scan", "evidence-cleanup", "ai-detect", "import-scan-parse", "import-cleanup", "ai-import"];

describe("worker bootstrap", () => {
  it("announces registered evidence, AI and import handlers without claiming dependency health", () => {
    expect(buildWorkerBootstrap()).toEqual({
      status: "ready",
      service: "workpulse-worker",
      registeredJobs: JOBS,
    });
    expect(serializeWorkerBootstrap()).toBe(
      `{"status":"ready","service":"workpulse-worker","registeredJobs":${JSON.stringify(JOBS)}}`,
    );
  });

});

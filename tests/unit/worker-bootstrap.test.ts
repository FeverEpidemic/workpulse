import { describe, expect, it } from "vitest";

import { buildWorkerBootstrap, serializeWorkerBootstrap } from "../../workers/bootstrap.ts";

describe("worker bootstrap", () => {
  it("announces the worker service with no registered jobs yet", () => {
    expect(buildWorkerBootstrap()).toEqual({
      status: "ready",
      service: "workpulse-worker",
      registeredJobs: [],
    });
    expect(serializeWorkerBootstrap()).toBe(
      '{"status":"ready","service":"workpulse-worker","registeredJobs":[]}',
    );
  });

});

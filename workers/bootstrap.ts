/**
 * Worker bootstrap contract (T01).
 *
 * T10 registers evidence handlers; this check does not contact dependencies.
 * The separately running worker owns polling and durable lease processing.
 */
export const WORKER_SERVICE = "workpulse-worker";

export type WorkerBootstrap = {
  status: "ready";
  service: typeof WORKER_SERVICE;
  registeredJobs: string[];
};

export function buildWorkerBootstrap(): WorkerBootstrap {
  return { status: "ready", service: WORKER_SERVICE, registeredJobs: ["evidence-scan", "evidence-cleanup"] };
}

export function serializeWorkerBootstrap(): string {
  return JSON.stringify(buildWorkerBootstrap());
}

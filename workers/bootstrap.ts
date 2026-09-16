/**
 * Worker bootstrap contract (T01).
 *
 * The durable job runtime (queue claim, lease, attempt tokens, retries) is T13's
 * responsibility; this module only proves that a worker process can start, announce
 * itself and exit. `registeredJobs` stays empty until job handlers exist.
 */
export const WORKER_SERVICE = "workpulse-worker";

export type WorkerBootstrap = {
  status: "ready";
  service: typeof WORKER_SERVICE;
  registeredJobs: string[];
};

export function buildWorkerBootstrap(): WorkerBootstrap {
  return { status: "ready", service: WORKER_SERVICE, registeredJobs: [] };
}

export function serializeWorkerBootstrap(): string {
  return JSON.stringify(buildWorkerBootstrap());
}

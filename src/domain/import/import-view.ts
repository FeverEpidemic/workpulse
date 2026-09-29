// Shared by the web app and tests; keep imports relative (no "@/" alias).
import {
  IMPORT_ENTITY_TYPES,
  IMPORT_MAX_RETRIES,
  isPermanentImportError,
  type ImportEntityType,
  type ImportStage,
  type ImportStatus,
} from "./contracts.ts";

export type ImportBatchRow = {
  id: string;
  filename: string;
  status: ImportStatus;
  stage: ImportStage;
  error_code: string | null;
  retry_count: number;
  page_count: number | null;
  expires_at: string | null;
  purged_at: string | null;
  created_at: string;
  revision: number;
};

export type ImportViewState =
  | "choose"
  | "uploading"
  | "waiting"
  | "screening"
  | "parsing"
  | "extracting"
  | "review_ready"
  | "review_empty"
  | "failed_permanent"
  | "failed_retriable"
  | "cancelled"
  | "committed";

export type RetryBlockReason = "exhausted" | "expired" | "consent" | null;

export type ImportView = {
  state: ImportViewState;
  batchId: string | null;
  filename: string | null;
  revision: number | null;
  errorCode: string | null;
  counts: Record<ImportEntityType, number>;
  total: number;
  canRetry: boolean;
  retryBlockReason: RetryBlockReason;
  canCancel: boolean;
  /** True while the server state can still change without user action. */
  polling: boolean;
  duplicate: { createdAt: string; status: string } | null;
};

export type ImportViewInput = {
  batch: ImportBatchRow | null;
  counts?: Partial<Record<ImportEntityType, number>>;
  consent: boolean;
  duplicate?: { createdAt: string; status: string } | null;
  now?: Date;
};

const EMPTY_COUNTS = Object.fromEntries(IMPORT_ENTITY_TYPES.map((type) => [type, 0])) as Record<ImportEntityType, number>;

function stateOf(batch: ImportBatchRow, total: number): ImportViewState {
  switch (batch.status) {
    case "queued":
      return batch.stage === "uploading" ? "uploading" : "waiting";
    case "running":
      if (batch.stage === "parsing") return "parsing";
      if (batch.stage === "extracting") return "extracting";
      return "screening";
    case "review":
      return total > 0 ? "review_ready" : "review_empty";
    case "failed":
      return isPermanentImportError(batch.error_code) || batch.stage === "uploading" ? "failed_permanent" : "failed_retriable";
    case "cancelled":
      return "cancelled";
    case "committed":
      return "committed";
  }
}

/** Pure S02 view model: every status the page shows comes from saved server state. */
export function toImportView(input: ImportViewInput): ImportView {
  const counts = { ...EMPTY_COUNTS, ...(input.counts ?? {}) };
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const batch = input.batch;
  if (!batch) {
    return {
      state: "choose", batchId: null, filename: null, revision: null, errorCode: null, counts, total: 0,
      canRetry: false, retryBlockReason: null, canCancel: false, polling: false, duplicate: null,
    };
  }
  const state = stateOf(batch, total);
  let retryBlockReason: RetryBlockReason = null;
  if (state === "failed_retriable") {
    const now = (input.now ?? new Date()).getTime();
    if (batch.purged_at !== null || (batch.expires_at !== null && Date.parse(batch.expires_at) <= now)) retryBlockReason = "expired";
    else if (batch.retry_count >= IMPORT_MAX_RETRIES) retryBlockReason = "exhausted";
    else if (!input.consent) retryBlockReason = "consent";
  }
  return {
    state,
    batchId: batch.id,
    filename: batch.filename,
    revision: batch.revision,
    errorCode: batch.status === "failed" ? batch.error_code : null,
    counts,
    total,
    canRetry: state === "failed_retriable" && retryBlockReason === null,
    retryBlockReason,
    canCancel: batch.status === "queued" || batch.status === "running" || batch.status === "review",
    polling: ["uploading", "waiting", "screening", "parsing", "extracting"].includes(state),
    duplicate: input.duplicate ?? null,
  };
}

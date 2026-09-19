export const ACTIVITY_FIELD_LIMITS = {
  rawText: 10_000,
  role: 200,
  scope: 5_000,
  outcome: 5_000,
  chatContent: 10_000,
} as const;

export const ACTIVITY_LIST_PAGE_SIZE = 30;

export type ActivityCaptureMode = "note" | "form" | "chat";
export type ActivityAnalysisState = "not_requested" | "queued" | "running" | "done" | "failed";
export type ChatMessageRole = "user" | "assistant";

export type ActivityDatabaseRow = import("@/server/supabase/database.types").Database["public"]["Tables"]["activities"]["Row"];
export type ChatMessageDatabaseRow = import("@/server/supabase/database.types").Database["public"]["Tables"]["chat_messages"]["Row"];

export type ActivityRow = Omit<ActivityDatabaseRow, "capture_mode" | "analysis_state"> & {
  capture_mode: ActivityCaptureMode;
  analysis_state: ActivityAnalysisState;
};

export interface ActivityCreateReceipt {
  readonly activityId: string;
  readonly userId: string;
  readonly revision: number;
  readonly occurredOn: string;
  readonly captureMode: ActivityCaptureMode;
}

export type ChatMessageRow = Omit<ChatMessageDatabaseRow, "role"> & {
  role: ChatMessageRole;
};

export type ActivityListItem = Pick<
  ActivityRow,
  | "id"
  | "user_id"
  | "raw_text"
  | "occurred_on"
  | "capture_mode"
  | "role"
  | "scope"
  | "outcome"
  | "experience_id"
  | "project_id"
  | "analysis_state"
  | "revision"
  | "created_at"
  | "updated_at"
>;

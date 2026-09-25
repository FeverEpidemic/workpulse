import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivityDetailClient } from "@/features/activity/activity-detail";
import { ActivityPageIssue } from "@/features/activity/activity-page-issue";
import type { ActivityContextIssue } from "@/features/activity/activity-context-service";

const ISSUE: ActivityContextIssue = {
  code: "UNAVAILABLE",
  messageKey: "activity.contextOptionsUnavailable",
  correlationId: "5a8f5c7b-bb52-4d5e-9e28-66c9b3ad7b0f",
};

const ACTIVITY = {
  id: "69d5940d-288c-4d5b-a9a7-41954870c1b8",
  user_id: "d8edc2e3-618e-4f23-a1de-e9ae18cb9740",
  raw_text: "A saved activity",
  occurred_on: "2026-09-17",
  capture_mode: "note" as const,
  role: null,
  scope: null,
  outcome: null,
  experience_id: null,
  project_id: null,
  analysis_state: "not_requested" as const,
  revision: 1,
  created_at: "2026-09-17T00:00:00.000Z",
  updated_at: "2026-09-17T00:00:00.000Z",
};

describe("Activity context reference UI", () => {
  it("keeps the fatal page reference ID from the service error", () => {
    const html = renderToStaticMarkup(
      <ActivityPageIssue locale="en" messageKey={ISSUE.messageKey} correlationId={ISSUE.correlationId} retryHref="/activity" />,
    );

    expect(html).toContain(ISSUE.correlationId);
    expect(html).toContain("Project and experience options could not be loaded");
  });

  it("keeps the same reference ID in the degraded detail state", () => {
    const html = renderToStaticMarkup(
      <ActivityDetailClient
        locale="en"
        ownerId={ACTIVITY.user_id}
        activity={ACTIVITY}
        chatMessages={[]}
        options={{ experiences: [], projects: [] }}
        contextIssue={ISSUE}
        returnTo="/activity"
      />,
    );

    expect(html).toContain(ISSUE.correlationId);
    expect(html).toContain("data-testid=\"activity-context-reference\"");
  });
});

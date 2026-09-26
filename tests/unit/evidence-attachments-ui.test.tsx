import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { describeEvidenceFailure, EvidenceAttachments, EVIDENCE_POLL_DELAYS, evidenceItemActions } from "@/features/evidence/evidence-attachments";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function failure(code: string | undefined, serverMessage?: string) {
  return Object.assign(new Error("Evidence request failed"), { code, serverMessage });
}

describe("Evidence attachment controls", () => {
  it("limits each action to its supported lifecycle state and parent", () => {
    expect(evidenceItemActions("uploading", "activity", true)).toEqual({ download: false, retry: false, remove: true, move: false });
    expect(evidenceItemActions("scanning", "activity", true)).toEqual({ download: false, retry: false, remove: true, move: false });
    expect(evidenceItemActions("ready", "activity", true)).toEqual({ download: true, retry: false, remove: true, move: true });
    expect(evidenceItemActions("ready", "achievement", true)).toEqual({ download: true, retry: false, remove: true, move: false });
    expect(evidenceItemActions("failed", "activity", true)).toEqual({ download: false, retry: true, remove: true, move: false });
    expect(evidenceItemActions("deleting", "project", true)).toEqual({ download: false, retry: false, remove: false, move: false });
  });

  it("uses a bounded poll schedule", () => {
    expect(EVIDENCE_POLL_DELAYS).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
  });

  it("renders a labelled, keyboard reachable attachment control", () => {
    const html = renderToStaticMarkup(
      <EvidenceAttachments locale="en" parentKind="activity" parentId="activity-1" expectedParentRevision={2} />,
    );

    expect(html).toContain('aria-labelledby="evidence-heading"');
    expect(html).toContain('aria-label="Choose an evidence file"');
    expect(html).toContain('type="file"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading evidence");
  });

  it("surfaces actionable server errors instead of generic retry copy", () => {
    const full = describeEvidenceFailure("en", failure("EVIDENCE_SLOT_LIMIT", "This record already has the maximum number of evidence files."), "evidence.reserveFailed");
    expect(full).toEqual({ message: "This record already has the maximum number of evidence files.", stale: false });
    const quota = describeEvidenceFailure("id", failure("EVIDENCE_QUOTA_EXCEEDED", "Unggahan ini akan melewati batas penyimpanan bukti."), "evidence.reserveFailed");
    expect(quota.message).toBe("Unggahan ini akan melewati batas penyimpanan bukti.");
  });

  it("flags conflicts as stale so the host reloads revisions", () => {
    expect(describeEvidenceFailure("en", failure("CONFLICT"), "evidence.moveFailed")).toMatchObject({ stale: true });
  });

  it("falls back to local copy for network failures and unlisted codes", () => {
    expect(describeEvidenceFailure("en", new TypeError("Failed to fetch"), "evidence.reserveFailed").message)
      .toBe("The file could not be added. Check your connection and choose the file again.");
    expect(describeEvidenceFailure("en", failure("IDEMPOTENCY_CONFLICT", "internal detail"), "evidence.moveFailed").message)
      .toBe("This file could not be moved. Refresh and try again.");
  });
});

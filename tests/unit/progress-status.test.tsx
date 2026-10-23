import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressStatusContent } from "@/components/ui/progress-status";
import { progressStatusView } from "@/components/ui/progress-status-view";
import { t } from "@/i18n/messages";

describe("T30 progress announcements",()=>{
  it("keeps elapsed time outside a caller-owned live region", () => {
    const html = renderToStaticMarkup(<ProgressStatusContent locale="en" kind="export" stage="queued" view={progressStatusView(5000, 0, "export", "queued")} renderStatus={(stage) => <div data-testid="cv-export-status" role="status" aria-live="polite">{stage}</div>} />);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/<div data-testid="cv-export-status" role="status" aria-live="polite">.*<\/p><\/div><span class="field-help" aria-hidden="true">Waiting 5s<\/span>/);
  });
  it.each(["ai","import","export"] as const)("keeps %s elapsed seconds outside the live region",kind=>{
    const html=renderToStaticMarkup(<ProgressStatusContent locale="en" kind={kind} stage="running" view={progressStatusView(65_000,0,kind,"running")} />);
    const region=html.match(/<[^>]*role="status"[^>]*>(.*?)<\/p>/)?.[1];
    expect(region).toBeTruthy();
    expect(region!.replaceAll("&#x27;", "'")).toContain(t("en","progress.slow"));
    expect(region).not.toContain("Waiting 65s");
    expect(html).toContain('aria-hidden="true">Waiting 65s</span>');
    expect(html).toContain("ui-loading-static");
    expect(html).toContain("ui-loading-spinner");
  });
  it.each(["en","id"] as const)("announces only the stage initially in %s",locale=>{
    const html=renderToStaticMarkup(<ProgressStatusContent locale={locale} kind="ai" stage="queued" view={progressStatusView(0,0,"ai","queued")} />);
    expect(html).toContain(t(locale,"ai.analysis.queued"));
    expect(html).not.toContain(t(locale,"progress.slow"));
    expect(html).not.toContain(t(locale,"progress.elapsed",{seconds:0}));
  });
});

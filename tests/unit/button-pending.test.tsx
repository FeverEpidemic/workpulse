import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("T30 pending button", () => {
  it("preserves the original label, adds a delayed spinner and exposes busy state", () => {
    const html = renderToStaticMarkup(<Button loading loadingLabel="Saving activity">Save activity</Button>);
    expect(html).toContain("Save activity");
    expect(html).toContain('class="ui-button-spinner"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('<span class="sr-only">Saving activity</span>');
  });
  it("still shows the spinner without a loading label", () => {
    const html = renderToStaticMarkup(<Button loading>Save activity</Button>);
    expect(html).toContain("ui-loading-spinner");
    expect(html).toContain("Save activity");
  });
  it("keeps idle markup and disabled semantics", () => {
    const idle = renderToStaticMarkup(<Button>Retry</Button>);
    expect(idle).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(idle).not.toContain("ui-button-spinner");
    const disabled = renderToStaticMarkup(<Button disabled>Retry</Button>);
    expect(disabled).toContain('disabled=""');
    expect(disabled).not.toContain('aria-busy="true"');
  });
  it("centralizes all submit-button form status reads", () => {
    for (const path of ["src/features/ai/activity-analysis-panel.tsx", "src/features/profile/ai-consent-card.tsx"]) {
      expect(readFileSync(path, "utf8")).not.toContain("useFormStatus");
    }
    expect(readFileSync("src/components/forms/submit-button.tsx", "utf8")).toContain("useFormStatus");
  });
});

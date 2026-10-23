import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";

describe("T30 dialog exit semantics", () => {
  it.each([false, true])("excludes a closing dialog from interaction when open=%s", (open) => {
    const html = renderToStaticMarkup(<Dialog open={open} onOpenChange={vi.fn()} title="Confirm" description="Review the action"><button>Cancel</button></Dialog>);
    if (open) {
      expect(html).not.toContain('aria-hidden="true"');
      expect(html).not.toContain("inert=");
    } else {
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('inert=""');
    }
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Template from "@/app/(workspace)/template";
import { t } from "@/i18n/messages";
describe("T30 copy and page boundary", () => {
  it.each(["en", "id"] as const)("has all new loading copy in %s without em dash", locale => {
    for (const key of ["common.loadingPage", "common.stillLoading", "common.reload", "progress.elapsed", "progress.slow"] as const) {
      const text = t(locale, key, { seconds: 5 });
      expect(text).toBeTypeOf("string"); expect(text.length).toBeGreaterThan(0); expect(text).not.toContain("\u2014");
    }
  });
  it("animates only its page content", () => {
    const html = renderToStaticMarkup(<Template><h1>Activity</h1></Template>);
    expect(html).toBe('<div class="workspace-page-enter"><h1>Activity</h1></div>');
  });
});

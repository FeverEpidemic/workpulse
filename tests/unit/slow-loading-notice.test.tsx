import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlowLoadingContent, slowLoadingView } from "@/components/ui/slow-loading-notice";
afterEach(()=>vi.useRealTimers());
describe("T30 slow page recovery",()=>{
  it("offers recovery exactly after eight seconds",()=>{
    vi.useFakeTimers();vi.setSystemTime(1000);const start=Date.now();
    vi.advanceTimersByTime(7999);expect(slowLoadingView(Date.now(),start)).toBe(false);
    vi.advanceTimersByTime(1);expect(slowLoadingView(Date.now(),start)).toBe(true);
    expect(slowLoadingView(0,1000)).toBe(false);
  });
  it("renders a reload button only when recovery is needed",()=>{
    const early=renderToStaticMarkup(<SlowLoadingContent locale="en" slow={false}/>);
    expect(early).toContain("Loading this page");expect(early).not.toContain("<button");
    const late=renderToStaticMarkup(<SlowLoadingContent locale="en" slow/>);
    expect(late).toContain("Still loading.");expect(late).toContain("Reload</button>");
  });
});

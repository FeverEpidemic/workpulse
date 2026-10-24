import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({pending:false}));
vi.mock("next/link",async original=>({...await original<typeof import("next/link")>(),useLinkStatus:()=>state}));
import { PendingLinkContent } from "@/components/layout/pending-link-content";
describe("T30 real Next pending context",()=>{
  it.each([false,true])("reflects useLinkStatus pending=%s",pending=>{
    state.pending=pending;
    const html=renderToStaticMarkup(<PendingLinkContent><span>Activity</span></PendingLinkContent>);
    expect(html).toContain(`data-pending="${pending}"`);
    expect(html).toContain("Activity");
    if(pending) expect(html).toContain("ui-loading-spinner");
  });
});

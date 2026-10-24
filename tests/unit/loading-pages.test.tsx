import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const request=vi.hoisted(()=>({locale:"en" as "en"|"id"}));
vi.mock("@/server/auth/context",()=>({getRequestLocale:async()=>request.locale}));
import Workspace from "@/app/(workspace)/loading";
import Activity from "@/app/(workspace)/activity/loading";
import Achievements from "@/app/(workspace)/achievements/loading";
import Dashboard from "@/app/(workspace)/dashboard/loading";
import Projects from "@/app/(workspace)/projects/loading";
import Timeline from "@/app/(workspace)/timeline/loading";
import Cv from "@/app/(workspace)/cv/loading";
import Preview from "@/app/(workspace)/cv/preview/loading";
import ImportReview from "@/app/imports/[id]/review/loading";
import { t } from "@/i18n/messages";
describe("T30 every route loading fallback",()=>{
  for(const locale of ["en","id"] as const) {
    it.each(Object.entries({Workspace,Activity,Achievements,Dashboard,Projects,Timeline,Cv,Preview,ImportReview}))(`%s has visible loading text in ${locale}`,async(_,Page)=>{
      request.locale=locale;
      const html=renderToStaticMarkup(await Page());
      expect(html).toMatch(new RegExp(`<p[^>]*class="field-help"[^>]*>${t(locale,"common.loadingPage")}</p>`));
      expect(html).not.toContain("animate-pulse");
    });
  }
});

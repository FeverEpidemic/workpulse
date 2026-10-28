import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { t, type Locale } from "@/i18n/messages";

/**
 * Wraps sample app UI on the landing page: a visible "Example" label, a descriptive name for screen readers,
 * and `inert` so nothing inside can be focused or clicked.
 */
export function ExampleFrame({ label, locale, className, children }: { label: string; locale: Locale; className?: string; children: ReactNode }) {
  return (
    <div className={["landing-example", className].filter(Boolean).join(" ")} role="group" aria-label={label} data-example="true">
      <Badge className="landing-example-badge">{t(locale, "landing.example")}</Badge>
      <div inert>{children}</div>
    </div>
  );
}

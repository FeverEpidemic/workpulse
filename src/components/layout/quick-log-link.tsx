import Link from "next/link";
import { NotebookPen } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { t, type Locale } from "@/i18n/messages";

export function QuickLogLink({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const label = t(locale, "workspace.quickLog");
  return (
    <Tooltip label={t(locale, "workspace.quickLogTooltip")} align={compact ? "end" : "center"}>
      <Link
        className={compact ? "button-primary workspace-quick-log workspace-quick-log--compact" : "button-primary workspace-quick-log"}
        href="/activity/new"
        aria-label={compact ? label : undefined}
      >
        <NotebookPen size={18} strokeWidth={1.8} aria-hidden="true" />
        {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
      </Link>
    </Tooltip>
  );
}

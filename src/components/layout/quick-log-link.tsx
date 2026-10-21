import Link from "next/link";
import { NotebookPen } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { t, type Locale } from "@/i18n/messages";

export function QuickLogLink({ locale }: { locale: Locale }) {
  return (
    <Tooltip label={t(locale, "workspace.quickLogTooltip")} align="center">
      <Link className="button-primary workspace-quick-log" href="/activity/new">
        <NotebookPen size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>{t(locale, "workspace.quickLog")}</span>
      </Link>
    </Tooltip>
  );
}

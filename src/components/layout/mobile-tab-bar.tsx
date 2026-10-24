import Link from "next/link";
import { FolderKanban, LayoutDashboard, NotebookTabs, Plus } from "lucide-react";
import type { MouseEvent, Ref } from "react";

import { mobileTabCurrent, mobileTabs, type MobileTabId } from "@/components/layout/navigation-routes";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { PendingLinkContent } from "@/components/layout/pending-link-content";
import { t, type Locale } from "@/i18n/messages";

const tabIcons = {
  dashboard: LayoutDashboard,
  activity: NotebookTabs,
  projects: FolderKanban,
} as const;

export function MobileTabBar({
  locale,
  pathname,
  compact,
  displayName,
  email,
  onExpand,
  onQuickLog,
  quickLogRef,
}: {
  locale: Locale;
  pathname: string;
  compact: boolean;
  displayName: string;
  email: string;
  onExpand: () => void;
  onQuickLog: (event: MouseEvent<HTMLButtonElement>) => void;
  quickLogRef?: Ref<HTMLButtonElement>;
}) {
  const labelClass = compact ? "workspace-tab-label sr-only" : "workspace-tab-label";

  function icon(id: MobileTabId, current: boolean) {
    if (id === "profile") return <InitialsAvatar name={displayName} fallback={email} />;
    if (id === "quickLog") return null;
    const Icon = tabIcons[id];
    return <Icon size={22} strokeWidth={current ? 2.4 : 1.8} aria-hidden="true" />;
  }

  return (
    <nav
      className="workspace-tab-bar"
      aria-label={t(locale, "workspace.tabBar")}
      data-compact={compact ? "true" : "false"}
      onClick={(event) => {
        // A tap on the bar itself brings the labels back; a tap on a tab just navigates.
        if (!(event.target as Element).closest("a, button")) onExpand();
      }}
    >
      <ul className="workspace-tab-list">
        {mobileTabs.map(({ id, href, key }) => {
          const label = t(locale, key);
          if (href === null) {
            return (
              <li key={id}>
                <button
                  ref={quickLogRef}
                  type="button"
                  className="workspace-tab workspace-tab--quick-log"
                  aria-haspopup="dialog"
                  onClick={onQuickLog}
                >
                  <span className="workspace-tab-plus" aria-hidden="true"><Plus size={22} strokeWidth={2.2} /></span>
                  <span className="workspace-tab-label sr-only">{label}</span>
                </button>
              </li>
            );
          }
          const current = mobileTabCurrent(pathname, id);
          return (
            <li key={id}>
              <Link
                href={href}
                className={current ? "workspace-tab is-current" : "workspace-tab"}
                aria-current={current}
              >
                <PendingLinkContent href={href} icon={icon(id, Boolean(current))}>
                  <span className={labelClass}>{label}</span>
                </PendingLinkContent>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

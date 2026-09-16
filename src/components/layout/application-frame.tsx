import type { ReactNode } from "react";

import { WorkspaceNavigation, WorkspaceTopBar } from "@/components/layout/workspace-navigation";
import { UnsavedChangesProvider } from "@/components/ui/unsaved-changes";
import { ToastProvider } from "@/components/ui/toast";
import { t, type Locale } from "@/i18n/messages";
import type { ThemePreference } from "@/domain/theme/theme-preference";

export function ApplicationFrame({
  children,
  displayName,
  ownerId,
  locale,
  initialTheme,
}: {
  children: ReactNode;
  displayName: string;
  ownerId: string;
  locale: Locale;
  initialTheme: ThemePreference;
}) {
  return (
    <ToastProvider notificationsLabel={t(locale, "common.notifications")}>
      <UnsavedChangesProvider locale={locale}>
        <a className="skip-link" href="#main-content">{t(locale, "workspace.skipToContent")}</a>
        <div className="workspace-layout">
          <WorkspaceNavigation
            displayName={displayName}
            ownerId={ownerId}
            locale={locale}
            initialTheme={initialTheme}
          />
          <div className="workspace-main-column">
            <WorkspaceTopBar displayName={displayName} locale={locale} />
            <main id="main-content" className="workspace-content" tabIndex={-1}>
              {children}
            </main>
          </div>
        </div>
      </UnsavedChangesProvider>
    </ToastProvider>
  );
}

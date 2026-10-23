import type { ReactNode } from "react";

import { MobileChrome } from "@/components/layout/mobile-chrome";
import { WorkspaceNavigation, WorkspaceTopBar } from "@/components/layout/workspace-navigation";
import { UnsavedChangesProvider } from "@/components/ui/unsaved-changes";
import { ToastProvider } from "@/components/ui/toast";
import { NavigationLoadingProvider } from "@/components/layout/navigation-loading";
import { t, type Locale } from "@/i18n/messages";
import type { ThemePreference } from "@/domain/theme/theme-preference";

export function ApplicationFrame({
  children,
  displayName,
  email,
  ownerId,
  timezone,
  locale,
  initialTheme,
}: {
  children: ReactNode;
  displayName: string;
  email: string;
  ownerId: string;
  timezone: string;
  locale: Locale;
  initialTheme: ThemePreference;
}) {
  return (
    <ToastProvider notificationsLabel={t(locale, "common.notifications")}>
      <NavigationLoadingProvider>
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
            <MobileChrome
              locale={locale}
              displayName={displayName}
              email={email}
              ownerId={ownerId}
              timezone={timezone}
              initialTheme={initialTheme}
            >
              <WorkspaceTopBar displayName={displayName} locale={locale} />
              <main id="main-content" className="workspace-content" tabIndex={-1}>
                {children}
              </main>
            </MobileChrome>
          </div>
        </div>
      </UnsavedChangesProvider>
      </NavigationLoadingProvider>
    </ToastProvider>
  );
}

import type { ReactNode } from "react";

import { ApplicationFrame } from "@/components/layout/application-frame";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";
import { getThemePreference } from "@/server/theme/preference";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [context, locale, initialTheme] = await Promise.all([
    getRequestContext(),
    getRequestLocale(),
    getThemePreference(),
  ]);

  if (!context.user || !context.profile?.onboarding_completed_at) return children;

  return (
    <ApplicationFrame
      displayName={context.profile.display_name}
      ownerId={context.profile.id}
      locale={locale}
      initialTheme={initialTheme}
    >
      {children}
    </ApplicationFrame>
  );
}

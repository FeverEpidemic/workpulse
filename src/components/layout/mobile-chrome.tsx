"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { MobileHeader } from "@/components/layout/mobile-header";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { useScrollChrome } from "@/components/layout/use-scroll-chrome";
import type { Locale } from "@/i18n/messages";

// Header before the content and the tab bar after it, so the tab order is header, content, bar.
export function MobileChrome({
  children,
  locale,
  displayName,
  email,
}: {
  children: ReactNode;
  locale: Locale;
  displayName: string;
  email: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { compact, expand } = useScrollChrome();

  return (
    <>
      <MobileHeader
        locale={locale}
        pathname={pathname}
        compact={compact}
        sheetOpen={false}
        onOpenMore={() => undefined}
      />
      {children}
      <MobileTabBar
        locale={locale}
        pathname={pathname}
        compact={compact}
        displayName={displayName}
        email={email}
        onExpand={expand}
        onQuickLog={() => router.push("/activity/new")}
      />
    </>
  );
}

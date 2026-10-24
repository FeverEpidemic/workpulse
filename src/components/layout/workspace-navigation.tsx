"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserRound } from "lucide-react";

import { SignOutForm } from "@/features/auth/sign-out-form";
import { isCurrent, navigation } from "@/components/layout/navigation-routes";
import { QuickLogLink } from "@/components/layout/quick-log-link";
import { PendingLinkContent } from "@/components/layout/pending-link-content";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { BrandSymbol } from "@/components/ui/brand-logo";
import { t, type Locale } from "@/i18n/messages";
import type { ThemePreference } from "@/domain/theme/theme-preference";

export function NavigationLinks({ locale, pathname, label, hrefs, onNavigate }: {
  locale: Locale;
  pathname: string;
  label?: string;
  hrefs?: readonly string[];
  onNavigate?: () => void;
}) {
  const links = hrefs ? navigation.filter(({ href }) => hrefs.includes(href)) : navigation;
  return (
    <nav className="workspace-navigation" aria-label={label ?? t(locale, "workspace.primaryNavigation")}>
      {links.map(({ href, key, Icon }) => {
        const current = isCurrent(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={current ? "workspace-nav-link is-current" : "workspace-nav-link"}
            aria-current={current ? "page" : undefined}
            onClick={onNavigate}
          >
            <PendingLinkContent href={href} icon={<Icon size={18} strokeWidth={1.8} aria-hidden="true" />}>
              <span>{t(locale, key)}</span>
            </PendingLinkContent>
          </Link>
        );
      })}
    </nav>
  );
}

function ProfileAndSettings({
  locale,
  ownerId,
  initialTheme,
}: {
  locale: Locale;
  ownerId: string;
  initialTheme: ThemePreference;
}) {
  const pathname = usePathname();
  const current = pathname === "/settings/profile" || pathname.startsWith("/settings/profile/");
  return (
    <div className="workspace-account-controls">
      <Link
        href="/settings/profile"
        className={current ? "workspace-nav-link is-current" : "workspace-nav-link"}
        aria-current={current ? "page" : undefined}
      >
        <PendingLinkContent href="/settings/profile" icon={<UserRound size={18} strokeWidth={1.8} aria-hidden="true" />}>
          <span>{t(locale, "profile.title")}</span>
        </PendingLinkContent>
      </Link>
      <ThemeToggle locale={locale} initialPreference={initialTheme} />
      <SignOutForm ownerId={ownerId} label={t(locale, "auth.signOut")} />
    </div>
  );
}

export function WorkspaceNavigation({
  displayName,
  ownerId,
  locale,
  initialTheme,
}: {
  displayName: string;
  ownerId: string;
  locale: Locale;
  initialTheme: ThemePreference;
}) {
  const pathname = usePathname();

  return (
    <aside className="workspace-sidebar" aria-label={t(locale, "workspace.primaryNavigation")}>
      <Link className="workspace-brand" href="/dashboard">
        <span className="workspace-brand-mark" aria-hidden="true"><BrandSymbol /></span>
        <span>
          <strong>WorkPulse</strong>
          <small>{displayName}</small>
        </span>
      </Link>
      <NavigationLinks locale={locale} pathname={pathname} />
      <div className="workspace-sidebar-footer">
        <ProfileAndSettings
          locale={locale}
          ownerId={ownerId}
          initialTheme={initialTheme}
        />
      </div>
    </aside>
  );
}

export function WorkspaceTopBar({
  displayName,
  locale,
}: {
  displayName: string;
  locale: Locale;
}) {
  return (
    <header className="workspace-topbar">
      <p className="workspace-private-label">
        <span className="workspace-private-dot" aria-hidden="true" />
        {t(locale, "workspace.privateWorkspace")}
        <span aria-hidden="true">·</span>
        {displayName}
      </p>
      <QuickLogLink locale={locale} />
    </header>
  );
}

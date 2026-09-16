"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  CalendarDays,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Menu,
  NotebookTabs,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";

import { SignOutForm } from "@/features/auth/sign-out-form";
import { QuickLogLink } from "@/components/layout/quick-log-link";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { t, type Locale } from "@/i18n/messages";
import type { ThemePreference } from "@/domain/theme/theme-preference";

const navigation = [
  { href: "/dashboard", key: "workspace.dashboard", Icon: LayoutDashboard },
  { href: "/activity", key: "workspace.activity", Icon: NotebookTabs },
  { href: "/achievements", key: "workspace.achievements", Icon: Award },
  { href: "/projects", key: "workspace.projects", Icon: FolderKanban },
  { href: "/timeline", key: "workspace.timeline", Icon: CalendarDays },
  { href: "/cv", key: "workspace.cv", Icon: FileText },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

function NavigationLinks({ locale, pathname, onNavigate }: {
  locale: Locale;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="workspace-navigation" aria-label={t(locale, "workspace.primaryNavigation")}>
      {navigation.map(({ href, key, Icon }) => {
        const current = isCurrent(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={current ? "workspace-nav-link is-current" : "workspace-nav-link"}
            aria-current={current ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{t(locale, key)}</span>
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
  onNavigate,
}: {
  locale: Locale;
  ownerId: string;
  initialTheme: ThemePreference;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const current = pathname === "/settings/profile" || pathname.startsWith("/settings/profile/");
  return (
    <div className="workspace-account-controls">
      <Link
        href="/settings/profile"
        className={current ? "workspace-nav-link is-current" : "workspace-nav-link"}
        aria-current={current ? "page" : undefined}
        onClick={onNavigate}
      >
        <UserRound size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>{t(locale, "profile.title")}</span>
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
  const navigationLabel = t(locale, "workspace.primaryNavigation");

  return (
    <>
      <aside className="workspace-sidebar" aria-label={navigationLabel}>
        <Link className="workspace-brand" href="/dashboard">
          <span className="workspace-brand-mark" aria-hidden="true">W</span>
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

      <MobileNavigation
        key={pathname}
        pathname={pathname}
        ownerId={ownerId}
        locale={locale}
        initialTheme={initialTheme}
      />
    </>
  );
}

function MobileNavigation({
  pathname,
  ownerId,
  locale,
  initialTheme,
}: {
  pathname: string;
  ownerId: string;
  locale: Locale;
  initialTheme: ThemePreference;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigationLabel = t(locale, "workspace.primaryNavigation");

  return (
    <>
      <header className="workspace-mobile-header">
        <Tooltip label={t(locale, "workspace.openMenu")} align="start">
          <IconButton
            aria-label={t(locale, "workspace.openMenu")}
            aria-controls="workspace-mobile-drawer"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </IconButton>
        </Tooltip>
        <Link className="workspace-mobile-brand" href="/dashboard">WorkPulse</Link>
        <QuickLogLink locale={locale} compact />
      </header>

      <Dialog
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={navigationLabel}
        description={t(locale, "workspace.mobileNavigationDescription")}
        className="workspace-drawer-dialog"
      >
        <div id="workspace-mobile-drawer" className="workspace-drawer">
          <div className="workspace-drawer-header">
            <span className="font-semibold">WorkPulse</span>
            <IconButton aria-label={t(locale, "workspace.closeMenu")} onClick={() => setDrawerOpen(false)}>
              <X size={20} aria-hidden="true" />
            </IconButton>
          </div>
          <NavigationLinks
            locale={locale}
            pathname={pathname}
            onNavigate={() => setDrawerOpen(false)}
          />
          <div className="workspace-drawer-footer">
            <ProfileAndSettings
              locale={locale}
              ownerId={ownerId}
              initialTheme={initialTheme}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      </Dialog>
    </>
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

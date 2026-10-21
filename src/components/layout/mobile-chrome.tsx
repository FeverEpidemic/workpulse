"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { MobileHeader } from "@/components/layout/mobile-header";
import { MoreMenuSheet, QuickLogSheet } from "@/components/layout/mobile-sheets";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { useScrollChrome } from "@/components/layout/use-scroll-chrome";
import type { ThemePreference } from "@/domain/theme/theme-preference";
import type { Locale } from "@/i18n/messages";

function focusQuickLogNote(): boolean {
  const note = document.getElementById("quick-log-note");
  if (!(note instanceof HTMLTextAreaElement)) return false;
  note.focus({ preventScroll: true });
  return document.activeElement === note;
}

// Header before the content and the tab bar after it, so the tab order is header, content, bar.
export function MobileChrome({
  children,
  locale,
  displayName,
  email,
  ownerId,
  timezone,
  initialTheme,
}: {
  children: ReactNode;
  locale: Locale;
  displayName: string;
  email: string;
  ownerId: string;
  timezone: string;
  initialTheme: ThemePreference;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { compact, expand } = useScrollChrome();
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [openedOn, setOpenedOn] = useState(pathname);
  // Navigating away (a menu link, Detail lengkap, browser back) closes whichever sheet was open.
  if (openedOn !== pathname) {
    setOpenedOn(pathname);
    setQuickLogOpen(false);
    setMoreOpen(false);
  }

  function openQuickLog() {
    if (pathname === "/activity/new") {
      // The full form is already on screen; a second form would claim the same ids and draft.
      const note = document.getElementById("quick-log-note");
      note?.scrollIntoView({ block: "center" });
      focusQuickLogNote();
      return;
    }
    // iOS Safari opens the keyboard only for focus() inside the tap, so open the dialog and focus synchronously.
    flushSync(() => setQuickLogOpen(true));
    focusQuickLogNote();
  }

  // Fallback when the browser moved focus to the first control as showModal() ran.
  useEffect(() => {
    if (!quickLogOpen) return;
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement?.id !== "quick-log-note") focusQuickLogNote();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [quickLogOpen]);

  // The form's ActionFeedback already shows the "Activity saved." toast; the sheet only closes and refreshes the page.
  const onCreated = useCallback(() => {
    setQuickLogOpen(false);
    router.refresh();
  }, [router]);

  return (
    <>
      {/* Keyed by route: the More button can leave the DOM while focused, and not every browser fires blur then. */}
      <MobileHeader
        key={pathname}
        locale={locale}
        pathname={pathname}
        compact={compact}
        sheetOpen={quickLogOpen || moreOpen}
        onOpenMore={() => setMoreOpen(true)}
      />
      {children}
      <MobileTabBar
        locale={locale}
        pathname={pathname}
        compact={compact}
        displayName={displayName}
        email={email}
        onExpand={expand}
        onQuickLog={openQuickLog}
      />
      <QuickLogSheet
        locale={locale}
        ownerId={ownerId}
        timezone={timezone}
        returnTo={pathname}
        open={quickLogOpen}
        onOpenChange={setQuickLogOpen}
        onCreated={onCreated}
      />
      <MoreMenuSheet
        locale={locale}
        ownerId={ownerId}
        initialTheme={initialTheme}
        pathname={pathname}
        open={moreOpen}
        onOpenChange={setMoreOpen}
      />
    </>
  );
}

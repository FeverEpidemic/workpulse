"use client";

import { X } from "lucide-react";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NavigationLinks } from "@/components/layout/workspace-navigation";
import { IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { activityDateInTimeZone } from "@/domain/activity/activity-date";
import type { ThemePreference } from "@/domain/theme/theme-preference";
import { SignOutForm } from "@/features/auth/sign-out-form";
import { ActivityCaptureForm } from "@/features/activity/activity-capture-form";
import { t, type Locale } from "@/i18n/messages";

const noContextOptions = { experiences: [], projects: [] };
const moreMenuHrefs = ["/achievements", "/timeline", "/cv"] as const;

export function QuickLogSheet({
  locale,
  ownerId,
  timezone,
  returnTo,
  open,
  onOpenChange,
  onCreated,
}: {
  locale: Locale;
  ownerId: string;
  timezone: string;
  returnTo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (activityId: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, "workspace.quickLog")}
      description={t(locale, "quickLog.sheetDescription")}
      className="workspace-sheet-dialog"
    >
      <IconButton
        className="workspace-sheet-close"
        aria-label={t(locale, "quickLog.closeSheet")}
        onClick={() => onOpenChange(false)}
      >
        <X size={20} aria-hidden="true" />
      </IconButton>
      {/* Mounted only while open: the form claims the quick log ids and restores the tab draft on mount. */}
      {open ? (
        <ActivityCaptureForm
          variant="sheet"
          locale={locale}
          ownerId={ownerId}
          defaultOccurredOn={activityDateInTimeZone(new Date(), timezone)}
          options={noContextOptions}
          returnTo={returnTo}
          onCreated={onCreated}
          onOpenFullForm={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

export function MoreMenuSheet({
  locale,
  ownerId,
  initialTheme,
  pathname,
  open,
  onOpenChange,
}: {
  locale: Locale;
  ownerId: string;
  initialTheme: ThemePreference;
  pathname: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, "workspace.moreMenu")}
      description={t(locale, "workspace.moreMenuDescription")}
      className="workspace-sheet-dialog"
    >
      <IconButton
        className="workspace-sheet-close"
        aria-label={t(locale, "workspace.closeMoreMenu")}
        onClick={() => onOpenChange(false)}
      >
        <X size={20} aria-hidden="true" />
      </IconButton>
      <NavigationLinks
        locale={locale}
        pathname={pathname}
        label={t(locale, "workspace.moreMenu")}
        hrefs={moreMenuHrefs}
        onNavigate={() => onOpenChange(false)}
      />
      <div className="workspace-account-controls workspace-sheet-footer">
        <ThemeToggle locale={locale} initialPreference={initialTheme} />
        <SignOutForm ownerId={ownerId} label={t(locale, "auth.signOut")} />
      </div>
    </Dialog>
  );
}

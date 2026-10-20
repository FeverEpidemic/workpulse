"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { useState, type Ref } from "react";

import { mobileTitleKey } from "@/components/layout/navigation-routes";
import { headerShouldHide } from "@/components/layout/use-scroll-chrome";
import { BrandLogo } from "@/components/ui/brand-logo";
import { t, type Locale } from "@/i18n/messages";

export function MobileHeader({
  locale,
  pathname,
  compact,
  sheetOpen,
  onOpenMore,
  moreButtonRef,
}: {
  locale: Locale;
  pathname: string;
  compact: boolean;
  sheetOpen: boolean;
  onOpenMore: () => void;
  moreButtonRef?: Ref<HTMLButtonElement>;
}) {
  const [focusWithin, setFocusWithin] = useState(false);
  const titleKey = mobileTitleKey(pathname);
  const hidden = headerShouldHide({ compact, focusWithin, sheetOpen });

  return (
    <header
      className="workspace-mobile-header"
      data-hidden={hidden ? "true" : "false"}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      {titleKey ? (
        <p className="workspace-mobile-title">{t(locale, titleKey)}</p>
      ) : (
        <Link className="brand-logo workspace-mobile-brand" href="/dashboard"><BrandLogo /></Link>
      )}
      {pathname === "/settings/profile" ? (
        <button
          ref={moreButtonRef}
          type="button"
          className="ui-button-ghost workspace-more-button"
          aria-label={t(locale, "workspace.openMoreMenu")}
          aria-haspopup="dialog"
          onClick={onOpenMore}
        >
          <Menu size={20} aria-hidden="true" />
          <span>{t(locale, "workspace.moreMenu")}</span>
        </button>
      ) : null}
    </header>
  );
}

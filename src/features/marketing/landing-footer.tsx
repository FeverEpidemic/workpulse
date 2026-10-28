import Link from "next/link";

import { BrandSymbol } from "@/components/ui/brand-logo";
import { t, type Locale } from "@/i18n/messages";

export const CONTACT_EMAIL = "halo@myworkpulse.my.id";

export function LandingFooter({ locale, current }: { locale: Locale; current?: "privacy" | "terms" }) {
  return (
    <footer className="landing-footer">
      <div className="landing-container landing-footer-inner">
        <span className="brand-logo landing-footer-logo"><BrandSymbol />WorkPulse</span>
        <nav aria-label={t(locale, "landing.footer.label")} className="landing-footer-nav">
          <Link href="/privacy" aria-current={current === "privacy" ? "page" : undefined}>{t(locale, "landing.footer.privacy")}</Link>
          <Link href="/terms" aria-current={current === "terms" ? "page" : undefined}>{t(locale, "landing.footer.terms")}</Link>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </nav>
      </div>
    </footer>
  );
}

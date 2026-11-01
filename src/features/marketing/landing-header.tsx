import Link from "next/link";

import { BrandLogo } from "@/components/ui/brand-logo";
import { LocaleToggle } from "@/features/marketing/locale-toggle";
import { t, type Locale } from "@/i18n/messages";

export const SIGN_UP_HREF = "/sign-in?mode=create-account";

/**
 * `signedIn` (legal pages only): an onboarded account's language comes from its profile, so the cookie toggle
 * would do nothing, and sign-in links do not apply; it gets a way back to the app instead.
 */
export function LandingHeader({ locale, signedIn = false }: { locale: Locale; signedIn?: boolean }) {
  return (
    <header className="landing-header">
      <div className="landing-container landing-header-inner">
        <Link href="/" className="brand-logo landing-logo" aria-label={t(locale, "landing.home")}><BrandLogo /></Link>
        {signedIn ? (
          <Link href="/dashboard" className="button-secondary landing-nav-cta">{t(locale, "import.openDashboard")}</Link>
        ) : (
          <nav className="landing-nav" aria-label={t(locale, "landing.nav.label")}>
            <LocaleToggle locale={locale} />
            <Link href="/sign-in" className="landing-nav-link">{t(locale, "landing.signIn")}</Link>
            <Link href={SIGN_UP_HREF} className="button-primary landing-nav-cta">{t(locale, "landing.signUp")}</Link>
          </nav>
        )}
      </div>
    </header>
  );
}

import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { resolveTheme } from "@/domain/theme/theme-preference";
import { getRequestLocale } from "@/server/auth/context";
import { getThemePreference } from "@/server/theme/preference";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plus-jakarta-sans",
});

export const metadata: Metadata = {
  title: "WorkPulse",
  description: "Private career workspace for capturing activity and building one master CV.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, themePreference] = await Promise.all([getRequestLocale(), getThemePreference()]);
  const initialTheme = resolveTheme(themePreference, "light");
  const themeBootstrap = [
    "(function(){",
    "var root=document.documentElement;",
    "var preference=" + JSON.stringify(themePreference) + ";",
    "var theme=preference==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference;",
    "root.dataset.theme=theme;",
    "root.style.colorScheme=theme;",
    "}());",
  ].join("");

  return (
    <html
      lang={locale}
      className={plusJakartaSans.variable}
      data-theme={initialTheme}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

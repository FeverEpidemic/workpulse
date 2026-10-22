"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/i18n/messages";

export function slowLoadingView(nowMs: number, startedAt: number): boolean {
  return Math.max(0, nowMs - startedAt) >= 8000;
}

export function SlowLoadingContent({ locale, slow }: { locale: Locale; slow: boolean }) {
  return (
    <div className="ui-page-loading-status">
      <p className="field-help">{t(locale, "common.loadingPage")}</p>
      {slow ? <div className="ui-slow-loading" role="status">
        <p>{t(locale, "common.stillLoading")}</p>
        <Button variant="secondary" onClick={() => window.location.reload()}>{t(locale, "common.reload")}</Button>
      </div> : null}
    </div>
  );
}

export function SlowLoadingNotice({ locale }: { locale: Locale }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const start = Date.now();
    const timer = setTimeout(() => setSlow(slowLoadingView(Date.now(), start)), 8000);
    return () => clearTimeout(timer);
  }, []);
  return <SlowLoadingContent locale={locale} slow={slow} />;
}

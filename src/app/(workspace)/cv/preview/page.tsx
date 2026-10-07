import { FileText } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { InlineError } from "@/components/ui/inline-error";
import { buildCvPreviewModel } from "@/domain/cv/preview";
import { CvServiceError, toCvServiceError } from "@/features/cv/cv-errors";
import { CvExportPage } from "@/features/cv/cv-export-page";
import { createCvService } from "@/features/cv/cv-service";
import { createCvExportService } from "@/features/cv/export-service";
import { t } from "@/i18n/messages";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { createRequestPrivateStorageService } from "@/server/storage/request-service";

type Loaded = {
  cv: NonNullable<Awaited<ReturnType<ReturnType<typeof createCvService>["getCv"]>>> | null;
  readiness: Awaited<ReturnType<ReturnType<typeof createCvExportService>["getReadiness"]>>;
  exports: Awaited<ReturnType<ReturnType<typeof createCvExportService>["listExports"]>>;
};

/**
 * S14: preview and export of the saved CV revision. The page only reads: it never creates the CV (that is S13's first
 * open) and it never starts an export; the user does, explicitly.
 */
export default async function CvPreviewPage() {
  const { context, profile, locale } = await requireCompletedWorkspace("/cv/preview");
  const heading = (
    <header className="workspace-page-header space-y-1">
      <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "cv.exportPage.title")}</h1>
      <p className="text-[var(--color-text-secondary)]">{t(locale, "cv.exportPage.intro")}</p>
    </header>
  );

  let loaded: Loaded | null = null;
  let failure: CvServiceError | null = null;
  if (!context.client) {
    failure = new CvServiceError("UNAVAILABLE");
  } else {
    try {
      const correlationId = crypto.randomUUID();
      const cvService = createCvService({ supabase: context.client, correlationId });
      const exportService = createCvExportService({ supabase: context.client, getStorage: createRequestPrivateStorageService, correlationId });
      const [cv, readiness, exports] = await Promise.all([cvService.getCv(), exportService.getReadiness(), exportService.listExports(5)]);
      loaded = { cv, readiness, exports };
    } catch (error) {
      failure = toCvServiceError(error, crypto.randomUUID());
    }
  }

  if (failure || !loaded) {
    return (
      <section className="space-y-5">
        {heading}
        <InlineError correlationId={failure?.correlationId}>
          <p>{t(locale, failure?.code === "UNAVAILABLE" || !failure ? "cv.load.error" : failure.messageKey)}</p>
          <Link className="button-secondary" href="/cv/preview">{t(locale, "common.retry")}</Link>
        </InlineError>
      </section>
    );
  }

  if (loaded.cv === null) {
    return (
      <section className="space-y-5">
        {heading}
        <EmptyState
          icon={<FileText size={22} aria-hidden="true" />}
          title={t(locale, "cv.exportPage.empty.title")}
          description={t(locale, "cv.exportPage.empty.description")}
          action={{ href: "/cv", label: t(locale, "cv.exportPage.empty.action") }}
        />
      </section>
    );
  }

  const { document, items } = loaded.cv;
  return (
    <section className="space-y-5">
      {heading}
      <CvExportPage
        locale={locale}
        timeZone={profile.timezone}
        title={document.title}
        cvLocale={document.locale}
        savedRevision={document.revision}
        model={buildCvPreviewModel({ document, items })}
        readiness={loaded.readiness}
        exports={loaded.exports}
        nowIso={new Date().toISOString()}
      />
    </section>
  );
}

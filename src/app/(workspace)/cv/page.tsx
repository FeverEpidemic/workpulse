import Link from "next/link";
import * as z from "zod";

import { InlineError } from "@/components/ui/inline-error";
import { CvBuilder } from "@/features/cv/cv-builder";
import { CvServiceError, toCvServiceError } from "@/features/cv/cv-errors";
import { createCvService } from "@/features/cv/cv-service";
import { resolveHighlight, toPoolOptions } from "@/features/cv/cv-view";
import { t } from "@/i18n/messages";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CvPage({ searchParams }: Props) {
  const query = await searchParams;
  const { context, locale } = await requireCompletedWorkspace("/cv");
  const heading = (
    <header className="workspace-page-header space-y-1">
      <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "workspace.cv")}</h1>
      <p className="text-[var(--color-text-secondary)]">{t(locale, "cv.intro")}</p>
    </header>
  );

  let loaded: Awaited<ReturnType<ReturnType<typeof createCvService>["getCv"]>> = null;
  let pool: ReturnType<typeof toPoolOptions> | null = null;
  let failure: CvServiceError | null = null;
  if (!context.client) {
    failure = new CvServiceError("UNAVAILABLE");
  } else {
    try {
      const service = createCvService({ supabase: context.client });
      await service.ensure();
      const [cv, selectionPool] = await Promise.all([service.getCv(), service.getSelectionPool()]);
      loaded = cv;
      pool = toPoolOptions(selectionPool);
    } catch (error) {
      failure = toCvServiceError(error, crypto.randomUUID());
    }
  }

  if (failure || !loaded || !pool) {
    const messageKey = failure?.messageKey ?? "cv.load.error";
    return (
      <section className="space-y-5">
        {heading}
        <InlineError correlationId={failure?.correlationId}>
          <p>{t(locale, failure?.code === "UNAVAILABLE" || !failure ? "cv.load.error" : messageKey)}</p>
          <Link className="button-secondary" href="/cv">{t(locale, "common.retry")}</Link>
        </InlineError>
      </section>
    );
  }

  const requested = typeof query.highlight === "string" && z.uuid().safeParse(query.highlight).success ? query.highlight : null;
  return (
    <section className="space-y-5">
      {heading}
      <CvBuilder
        locale={locale}
        document={loaded.document}
        items={loaded.items}
        pool={pool}
        highlightId={resolveHighlight(pool, requested)}
      />
    </section>
  );
}

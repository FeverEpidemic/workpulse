import { isExportExpired } from "@/domain/cv/export";
import { CvServiceError, toCvServiceError, type CvServiceErrorCode } from "@/features/cv/cv-errors";
import { createCvExportService } from "@/features/cv/export-service";
import { t, type Locale } from "@/i18n/messages";
import { getRequestContext } from "@/server/auth/context";
import { createRequestPrivateStorageService } from "@/server/storage/request-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };
const STATUS: Partial<Record<CvServiceErrorCode, number>> = { UNAUTHENTICATED: 401, EXPORT_NOT_FOUND: 404, UNAVAILABLE: 503 };

/**
 * S14 status polling for one export of the signed-in owner: the safe columns plus `expired`. A foreign, missing or
 * malformed id gets the same generic 404; errors carry a code, a localized message and a correlation ID only.
 */
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const correlationId = crypto.randomUUID();
  let locale: Locale = "en";
  try {
    const session = await getRequestContext();
    locale = session.profile?.locale === "id" ? "id" : "en";
    if (!session.user || !session.client) throw new CvServiceError("UNAUTHENTICATED", { correlationId });
    if (session.profileUnavailable) throw new CvServiceError("UNAVAILABLE", { correlationId });
    if (!session.profile || session.profile.deleting_at) throw new CvServiceError("UNAUTHENTICATED", { correlationId });
    const service = createCvExportService({ supabase: session.client, getStorage: createRequestPrivateStorageService, correlationId });
    const row = await service.getExport(id);
    if (row === null) throw new CvServiceError("EXPORT_NOT_FOUND", { correlationId });
    return Response.json({ ...row, expired: isExportExpired(row, new Date()) }, { headers: NO_STORE });
  } catch (error) {
    const safe = toCvServiceError(error, correlationId);
    return Response.json(
      { code: safe.code, message: t(locale, safe.messageKey), correlationId: safe.correlationId },
      { status: STATUS[safe.code] ?? 503, headers: NO_STORE },
    );
  }
}

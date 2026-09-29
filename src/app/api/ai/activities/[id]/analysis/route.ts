import "server-only";

import { AiServiceError } from "@/features/ai/ai-errors";
import { createAiReviewService } from "@/features/ai/ai-review-service";
import { t } from "@/i18n/messages";
import { getRequestContext } from "@/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function statusFor(code: AiServiceError["code"]): number {
  switch (code) {
    case "VALIDATION": return 400;
    case "UNAUTHENTICATED": return 401;
    case "NOT_FOUND": return 404;
    case "UNAVAILABLE": return 503;
    default: return 409;
  }
}

/**
 * S06/S08 status polling. Owner-scoped: no raw_text, no other job ids, no other account's
 * data. Errors are generic (401/404/etc with a stable code and localized message only).
 */
export async function GET(_request: Request, context: Context) {
  let locale: "en" | "id" = "en";
  try {
    const requestContext = await getRequestContext();
    locale = requestContext.profile?.locale === "id" ? "id" : "en";
    if (!requestContext.user) throw new AiServiceError("UNAUTHENTICATED");
    if (requestContext.profileUnavailable) throw new AiServiceError("UNAVAILABLE");
    if (!requestContext.profile || requestContext.profile.deleting_at) throw new AiServiceError("UNAUTHENTICATED");

    const { id } = await context.params;
    const payload = await createAiReviewService(requestContext.client!).getAnalysisView(id);
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const safe = error instanceof AiServiceError ? error : new AiServiceError("UNAVAILABLE");
    return Response.json(
      { code: safe.code, message: t(locale, safe.messageKey), correlationId: safe.correlationId },
      { status: statusFor(safe.code), headers: { "Cache-Control": "no-store" } },
    );
  }
}

import "server-only";

import { t } from "@/i18n/messages";
import { getRequestContext } from "@/server/auth/context";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import { getSupabaseAdminClient } from "@/server/supabase/admin";
import { getTrustedSiteUrl } from "@/server/supabase/config";

import { ImportServiceError, toImportServiceError } from "./import-errors";
import { createImportService, type ImportService } from "./import-service";

/**
 * Owner-scoped JSON boundary for /api/imports. Mutations require the trusted Origin.
 * Responses carry a view model only (no extracted text, no candidate payloads) and errors
 * carry a stable code, a localized message and a correlation ID.
 */
export type ImportHttpContext = { client: NonNullable<Awaited<ReturnType<typeof getRequestContext>>["client"]>; actorId: string };

export async function importHttp(
  request: Request,
  mutation: boolean,
  run: (service: ImportService, context: ImportHttpContext) => Promise<unknown>,
) {
  let locale: "en" | "id" = "en";
  try {
    if (mutation && request.headers.get("origin") !== getTrustedSiteUrl()) throw new ImportServiceError("VALIDATION");
    const context = await getRequestContext();
    locale = context.profile?.locale === "id" ? "id" : "en";
    if (!context.user || !context.client) throw new ImportServiceError("UNAUTHENTICATED");
    if (context.profileUnavailable) throw new ImportServiceError("UNAVAILABLE");
    if (!context.profile || context.profile.deleting_at) throw new ImportServiceError("UNAUTHENTICATED");
    const admin = getSupabaseAdminClient();
    const service = createImportService({
      client: context.client,
      admin,
      storage: new SupabaseStorageAdapter(admin),
      actorId: context.user.id,
    });
    return Response.json(await run(service, { client: context.client, actorId: context.user.id }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const safe = toImportServiceError(error);
    return Response.json(
      { code: safe.code, message: t(locale, safe.messageKey), correlationId: safe.correlationId },
      { status: safe.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

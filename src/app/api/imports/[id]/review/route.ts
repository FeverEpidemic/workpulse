import { createImportReviewViewService } from "@/features/import/import-review-view-service";
import { importHttp } from "@/features/import/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * S03 reload after a conflict: the saved review state of one owned batch. Owner session only; a missing or
 * foreign id is a generic 404 and errors carry a code and correlation ID, never candidate text.
 */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return importHttp(request, false, (_service, { client, actorId }) => createImportReviewViewService({ client, actorId }).getReviewView(id));
}

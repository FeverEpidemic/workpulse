import { importHttp } from "@/features/import/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** S02 status polling for one owned batch (generic 404 for missing or foreign ids). */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return importHttp(request, false, (service) => service.getView(id));
}

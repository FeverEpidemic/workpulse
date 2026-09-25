import { evidenceHttp } from "@/features/evidence/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return evidenceHttp(request, true, async (service) => service.download((await context.params).id));
}

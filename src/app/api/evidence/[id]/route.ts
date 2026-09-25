import { evidenceHttp, evidenceJson } from "@/features/evidence/http";
import { toPublicEvidenceRecord } from "@/features/evidence/contracts";
import { EvidenceError } from "@/features/evidence/evidence-errors";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return evidenceHttp(request, false, async (service) => toPublicEvidenceRecord(await service.get((await context.params).id)));
}
export async function DELETE(request: Request, context: Context) {
  return evidenceHttp(request, true, async (service) => {
    const input = await evidenceJson(request);
    if (!input || typeof input !== "object" || !("expectedRevision" in input) || typeof input.expectedRevision !== "number") throw new EvidenceError("VALIDATION");
    return toPublicEvidenceRecord(await service.remove((await context.params).id, input.expectedRevision));
  });
}

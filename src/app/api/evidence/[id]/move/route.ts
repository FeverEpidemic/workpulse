import { evidenceHttp, evidenceJson } from "@/features/evidence/http";
import { toPublicEvidenceRecord } from "@/features/evidence/contracts";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return evidenceHttp(request, true, async (service) => {
    const { id } = await context.params;
    return toPublicEvidenceRecord(await service.moveToAchievement(id, await evidenceJson(request)));
  });
}

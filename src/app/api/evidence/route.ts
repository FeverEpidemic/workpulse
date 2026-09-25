import { evidenceHttp, evidenceJson } from "@/features/evidence/http";
import { toPublicEvidenceRecord } from "@/features/evidence/contracts";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return evidenceHttp(request, true, async (service) => toPublicEvidenceRecord(await service.reserve(await evidenceJson(request))));
}

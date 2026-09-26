import { evidenceHttp, evidenceJson } from "@/features/evidence/http";
import { EvidenceParentKindSchema, toPublicEvidenceRecord } from "@/features/evidence/contracts";
import { EvidenceError } from "@/features/evidence/evidence-errors";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return evidenceHttp(request, false, async (service) => {
    const url = new URL(request.url);
    const parentKind = EvidenceParentKindSchema.safeParse(url.searchParams.get("parentKind"));
    const parentId = url.searchParams.get("parentId");
    if (!parentKind.success || !parentId) throw new EvidenceError("VALIDATION");
    const items = await service.list(parentKind.data, parentId);
    return { items: items.map(toPublicEvidenceRecord) };
  });
}
export async function POST(request: Request) {
  return evidenceHttp(request, true, async (service) => toPublicEvidenceRecord(await service.reserve(await evidenceJson(request))));
}

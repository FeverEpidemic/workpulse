import { evidenceHttp } from "@/features/evidence/http";
import { toPublicEvidenceRecord } from "@/features/evidence/contracts";
export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return evidenceHttp(request, true, async (service) => toPublicEvidenceRecord(await service.upload(
    (await context.params).id, Number(request.headers.get("x-expected-revision")),
    request.headers.get("content-type") ?? "", request.body,
  )));
}

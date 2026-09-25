import "server-only";
import { getRequestContext } from "@/server/auth/context";
import { getTrustedSiteUrl } from "@/server/supabase/config";
import { getSupabaseAdminClient } from "@/server/supabase/admin";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import { SupabaseEvidenceRepository, type EvidenceRpcClient } from "@/server/storage/evidence-repository";
import { createEvidenceService } from "./evidence-service";
import { EvidenceError, evidenceErrorMessage, toEvidenceError } from "./evidence-errors";

export async function evidenceHttp(request: Request, mutation: boolean, run: (service: ReturnType<typeof createEvidenceService>) => Promise<unknown>) {
  let locale: "en" | "id" = "en";
  try {
    if (mutation && request.headers.get("origin") !== getTrustedSiteUrl()) throw new EvidenceError("VALIDATION");
    const context = await getRequestContext();
    locale = context.profile?.locale === "id" ? "id" : "en";
    if (!context.user) throw new EvidenceError("AUTH_REQUIRED");
    if (context.profileUnavailable) throw new EvidenceError("PROVIDER_UNAVAILABLE");
    if (!context.profile || context.profile.deleting_at) throw new EvidenceError("AUTH_REQUIRED");
    const admin = getSupabaseAdminClient();
    const service = createEvidenceService({
      repository: new SupabaseEvidenceRepository(admin as unknown as EvidenceRpcClient),
      storage: new SupabaseStorageAdapter(admin),
      resolveActor: async () => ({ id: context.user!.id }),
    });
    return Response.json(await run(service), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const safe = toEvidenceError(error);
    return Response.json({ code: safe.code, message: evidenceErrorMessage(safe.code, locale), correlationId: safe.correlationId }, {
      status: safe.status, headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function evidenceJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body) throw new EvidenceError("VALIDATION");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new EvidenceError("VALIDATION")); void reader.cancel().catch(() => undefined); }, 10_000);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.length;
      if (length > 4096) { void reader.cancel().catch(() => undefined); throw new EvidenceError("VALIDATION"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch { throw new EvidenceError("VALIDATION"); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}

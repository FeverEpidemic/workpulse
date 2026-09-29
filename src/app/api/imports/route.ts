import { importHttp } from "@/features/import/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S02 upload: raw PDF/DOCX body, validated server-side before any object or batch exists. */
export async function POST(request: Request) {
  return importHttp(request, true, (service) => service.upload({
    idempotencyKey: request.headers.get("x-idempotency-key"),
    filename: request.headers.get("x-file-name"),
    contentType: request.headers.get("content-type"),
    contentLength: request.headers.get("content-length"),
    body: request.body,
  }));
}

/** S02 leave-return: the latest batch the user can still act on. */
export async function GET(request: Request) {
  return importHttp(request, false, (service) => service.getActiveView());
}

import { NextResponse } from "next/server";

/** Contract of the web service, kept in one place so tests cannot drift from it. */
export const WEB_SERVICE = "workpulse-web";
export const WEB_SERVICE_VERSION = "0.1.0";

export type HealthPayload = {
  status: "ok";
  service: typeof WEB_SERVICE;
  version: string;
};

/**
 * Liveness only: reports that the web process is serving. It must not touch the
 * database, storage or AI dependencies, and must not echo configuration values.
 */
export function buildHealthPayload(): HealthPayload {
  return { status: "ok", service: WEB_SERVICE, version: WEB_SERVICE_VERSION };
}

export function healthResponse(): NextResponse<HealthPayload> {
  return NextResponse.json(buildHealthPayload(), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export const dynamic = "force-dynamic";

export function GET(): NextResponse<HealthPayload> {
  return healthResponse();
}

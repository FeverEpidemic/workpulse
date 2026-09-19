import { Buffer } from "node:buffer";
import * as z from "zod";

import { isExactActivityDate } from "@/domain/activity/activity-date";

export interface ActivityCursor {
  occurredOn: string;
  id: string;
}

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  occurredOn: z.string().refine(isExactActivityDate),
  id: z.uuid(),
}).strict();

export class ActivityCursorError extends Error {
  constructor() {
    super("Invalid activity cursor");
    this.name = "ActivityCursorError";
  }
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  const parsed = cursorPayloadSchema.safeParse({ version: 1, ...cursor });
  if (!parsed.success) throw new ActivityCursorError();
  return Buffer.from(JSON.stringify(parsed.data), "utf8").toString("base64url");
}

export function decodeActivityCursor(value: string): ActivityCursor {
  if (value.length === 0 || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ActivityCursorError();
  }

  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(json, "utf8").toString("base64url") !== value) throw new ActivityCursorError();
    const parsed = cursorPayloadSchema.safeParse(JSON.parse(json));
    if (!parsed.success) throw new ActivityCursorError();
    return { occurredOn: parsed.data.occurredOn, id: parsed.data.id };
  } catch {
    throw new ActivityCursorError();
  }
}

import { Buffer } from "node:buffer";
import * as z from "zod";

export interface ProjectCursor {
  updatedAt: string;
  id: string;
}

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  id: z.uuid(),
}).strict();

export class ProjectCursorError extends Error {
  constructor() {
    super("Invalid project cursor");
    this.name = "ProjectCursorError";
  }
}

export function encodeProjectCursor(cursor: ProjectCursor): string {
  const parsed = cursorPayloadSchema.safeParse({ version: 1, ...cursor });
  if (!parsed.success) throw new ProjectCursorError();
  return Buffer.from(JSON.stringify(parsed.data), "utf8").toString("base64url");
}

export function decodeProjectCursor(value: string): ProjectCursor {
  if (value.length === 0 || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ProjectCursorError();
  }

  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(json, "utf8").toString("base64url") !== value) throw new ProjectCursorError();
    const parsed = cursorPayloadSchema.safeParse(JSON.parse(json));
    if (!parsed.success) throw new ProjectCursorError();
    return { updatedAt: parsed.data.updatedAt, id: parsed.data.id };
  } catch {
    throw new ProjectCursorError();
  }
}

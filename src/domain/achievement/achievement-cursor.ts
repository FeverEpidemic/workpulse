import * as z from "zod";

const cursorSchema = z.object({
  v: z.literal(1),
  bucket: z.enum(["dated", "null"]),
  achievedOn: z.string().date().nullable(),
  id: z.uuid(),
}).strict();

export type AchievementCursor = z.infer<typeof cursorSchema>;

function encode(value: string): string {
  if (typeof btoa === "function") return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  if (typeof atob === "function") {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return atob(padded);
  }
  return Buffer.from(value, "base64url").toString("utf8");
}

export function encodeAchievementCursor(value: { achievedOn: string | null; id: string }): string {
  return encode(JSON.stringify({ v: 1, bucket: value.achievedOn === null ? "null" : "dated", achievedOn: value.achievedOn, id: value.id }));
}

export function decodeAchievementCursor(value: string): AchievementCursor {
  if (!value || value.length > 256) throw new Error("invalid_cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decode(value));
  } catch {
    throw new Error("invalid_cursor");
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success || (result.data.bucket === "dated") === (result.data.achievedOn === null)) throw new Error("invalid_cursor");
  return result.data;
}


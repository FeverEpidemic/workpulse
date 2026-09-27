import { AI_LOCALES, type AiLocale } from "./contracts.ts";

/**
 * The only data sent to an AI provider for detection. Identity, IDs, project or
 * employer names, evidence and filenames are deliberately absent.
 */
export interface DetectInput {
  locale: AiLocale;
  raw_text: string;
  role: string | null;
  scope: string | null;
  outcome: string | null;
}

export interface DetectSource {
  raw_text: string;
  role: string | null;
  scope: string | null;
  outcome: string | null;
  locale: string | null;
}

export function buildDetectInput(source: DetectSource): DetectInput {
  const locale = (AI_LOCALES as readonly string[]).includes(source.locale ?? "")
    ? (source.locale as AiLocale)
    : "en";
  return {
    locale,
    raw_text: source.raw_text,
    role: source.role ?? null,
    scope: source.scope ?? null,
    outcome: source.outcome ?? null,
  };
}

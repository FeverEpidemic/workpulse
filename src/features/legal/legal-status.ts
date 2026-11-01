import type { LegalBlock, LegalDocument, LegalText } from "@/features/legal/content/types";

/**
 * True while the drafts still have blanks for the owner to fill in. The pages then show a draft notice and ask
 * search engines not to index them. tests/unit/legal-content.test.ts fails if this turns false too early.
 */
export const LEGAL_DRAFT = true;

function textPlaceholders(text: LegalText): string[] {
  return text.flatMap((part) => (typeof part === "object" && "placeholder" in part ? [part.placeholder] : []));
}

function blockPlaceholders(block: LegalBlock): string[] {
  if (block.type === "p") return textPlaceholders(block.text);
  if (block.type === "ul") return block.items.flatMap(textPlaceholders);
  return [...block.head, ...block.rows.flat()].flatMap(textPlaceholders);
}

export function legalPlaceholders(doc: LegalDocument): string[] {
  return [
    ...textPlaceholders(doc.effectiveDate),
    ...doc.intro.flatMap(blockPlaceholders),
    ...doc.sections.flatMap((section) => section.blocks.flatMap(blockPlaceholders)),
  ];
}

/** A page may drop the draft label only when no document has a blank left. */
export function canPublishLegal(draft: boolean, docs: LegalDocument[]): boolean {
  return draft || docs.every((doc) => legalPlaceholders(doc).length === 0);
}

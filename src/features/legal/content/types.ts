// T32 legal pages as structured data, copied from docs/legal/*-draft.md (the Markdown stays the source).
// tests/unit/legal-content.test.ts fails when a copy drifts from its draft.

export type LegalInline =
  | string
  | { strong: string }
  | { code: string }
  | { placeholder: string }
  | { link: string; href: string };

export type LegalText = LegalInline[];

export type LegalBlock =
  | { type: "p"; text: LegalText }
  | { type: "ul"; items: LegalText[] }
  | { type: "table"; head: LegalText[]; rows: LegalText[][] };

export interface LegalSection {
  id: string;
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  effectiveDate: LegalText;
  intro: LegalBlock[];
  sections: LegalSection[];
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { privacyEn } from "@/features/legal/content/privacy.en";
import { privacyId } from "@/features/legal/content/privacy.id";
import { termsEn } from "@/features/legal/content/terms.en";
import { termsId } from "@/features/legal/content/terms.id";
import type { LegalBlock, LegalDocument, LegalText } from "@/features/legal/content/types";
import { canPublishLegal, LEGAL_DRAFT, legalPlaceholders } from "@/features/legal/legal-status";

const DOCS: [string, LegalDocument][] = [
  ["privacy-policy-id-draft.md", privacyId],
  ["privacy-policy-en-draft.md", privacyEn],
  ["terms-of-service-id-draft.md", termsId],
  ["terms-of-service-en-draft.md", termsEn],
];

function plain(text: LegalText): string {
  return text.map((part) => (typeof part === "string" ? part : "strong" in part ? part.strong : "code" in part ? part.code : "placeholder" in part ? part.placeholder : part.link)).join("");
}

function blockText(block: LegalBlock): string {
  if (block.type === "p") return plain(block.text);
  if (block.type === "ul") return block.items.map(plain).join(" ");
  return [...block.head, ...block.rows.flat()].map(plain).join(" ");
}

// Markdown to the words a reader sees: no markers, links as their text, table pipes and separators gone.
function normalizeMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !/^\|[\s|:-]+\|$/.test(line.trim()))
    .join("\n")
    .replace(/\*\*|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^- /gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

function parseDraft(file: string) {
  const markdown = readFileSync(`docs/legal/${file}`, "utf8").replace(/\r/g, "");
  const body = markdown.split("\n").filter((line) => !line.startsWith("# ") && !line.startsWith(">") && !/^(Berlaku sejak|Effective from):/.test(line)).join("\n");
  const [intro, ...rest] = body.split(/^## /m);
  return {
    effective: /^(?:Berlaku sejak|Effective from): (.+)$/m.exec(markdown)![1]!,
    intro: normalizeMarkdown(intro!),
    sections: rest.map((chunk) => {
      const [heading, ...lines] = chunk.split("\n");
      return { heading: heading!.trim(), text: normalizeMarkdown(lines.join("\n")) };
    }),
  };
}

describe.each(DOCS)("T32 legal content %s", (file, doc) => {
  const draft = parseDraft(file);

  it("has every section of the draft, in order, with the same headings", () => {
    expect(doc.sections).toHaveLength(12);
    expect(doc.sections.map((section) => section.heading)).toEqual(draft.sections.map((section) => section.heading));
    expect(doc.sections.map((section) => section.id)).toEqual(draft.sections.map((_, index) => `section-${index + 1}`));
  });

  it("has the same words as the draft in the intro and in every section", () => {
    expect(squash(doc.intro.map(blockText).join(" "))).toBe(draft.intro);
    doc.sections.forEach((section, index) => {
      expect(squash(section.blocks.map(blockText).join(" ")), section.heading).toBe(draft.sections[index]!.text);
    });
    expect(plain(doc.effectiveDate)).toBe(draft.effective);
  });

  it("names the operator and the contact address, linked as mail", () => {
    const first = doc.sections[0]!.blocks.map(blockText).join(" ");
    const last = doc.sections.at(-1)!.blocks.map(blockText).join(" ");
    for (const text of [first, last]) expect(text).toContain("Ilham Aisy Rasyid");
    expect(last).toContain("halo@myworkpulse.my.id");
    const links = JSON.stringify(doc).match(/"href":"mailto:halo@myworkpulse\.my\.id"/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
  });

  it("marks every unfilled [BRACKET] as a placeholder", () => {
    const loose = JSON.stringify(doc).replace(/"placeholder":"\[[^\]]+\]"/g, "");
    expect(loose).not.toMatch(/\[[A-Z]/);
    expect(legalPlaceholders(doc).length).toBeGreaterThan(0);
  });
});

describe("T32 legal draft guard", () => {
  const all = DOCS.map(([, doc]) => doc);

  it("does not allow publishing while placeholders remain", () => {
    expect(canPublishLegal(false, all)).toBe(false);
    expect(canPublishLegal(true, all)).toBe(true);
  });

  it("allows publishing once nothing is left to fill in", () => {
    const filled: LegalDocument = { effectiveDate: ["1 January 2027"], intro: [], sections: [{ id: "section-1", heading: "1. Contact", blocks: [{ type: "p", text: ["Done."] }] }] };
    expect(canPublishLegal(false, [filled])).toBe(true);
  });

  it("keeps the shipped pages marked as drafts while the content has placeholders", () => {
    expect(canPublishLegal(LEGAL_DRAFT, all)).toBe(true);
  });
});

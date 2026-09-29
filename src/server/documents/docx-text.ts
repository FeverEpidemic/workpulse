// Shared by the web app and the worker; keep imports relative (no "@/" alias).

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    if (entity.startsWith("#x")) return safeCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return safeCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITY[entity] ?? match;
  });
}

/** Numeric references to control characters, surrogates, or out-of-range values are dropped. */
function safeCodePoint(value: number): string {
  if (value === 0x09 || value === 0x0a) return String.fromCodePoint(value);
  if (!Number.isInteger(value) || value < 0x20 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return "";
  return String.fromCodePoint(value);
}

// Only these WordprocessingML elements contribute text or structure. Deleted text
// (w:delText), field codes (w:instrText), and tab-stop definitions (w:tabs) are skipped.
const TOKEN = /<(\/?)(?:[A-Za-z0-9_]+:)?(t|tab|tabs|br|cr|p|tc|tr)\b[^>]*?(\/?)>/g;

/** Plain text of word/document.xml, one line per paragraph, table cells separated by tabs. */
export function extractDocxText(documentXml: string): string {
  const out: string[] = [];
  let inText = false;
  let textStart = 0;
  let tabsDepth = 0;
  for (const match of documentXml.matchAll(TOKEN)) {
    const [whole, closing, name, selfClosing] = match;
    const index = match.index ?? 0;
    if (name === "t") {
      if (!closing && !selfClosing) {
        inText = true;
        textStart = index + whole.length;
      } else if (closing && inText) {
        out.push(decodeXmlText(documentXml.slice(textStart, index)));
        inText = false;
      }
      continue;
    }
    if (inText) continue;
    if (name === "tabs") {
      if (!selfClosing) tabsDepth += closing ? -1 : 1;
      continue;
    }
    if (tabsDepth > 0) continue;
    if (name === "tab" && !closing) out.push("\t");
    else if ((name === "br" || name === "cr") && !closing) out.push("\n");
    else if (name === "p" && (closing || selfClosing)) out.push("\n");
    else if (name === "tc" && closing) out.push("\t");
    else if (name === "tr" && closing) out.push("\n");
  }
  return normalizeExtractedText(out.join(""));
}

/** Trim each line, drop control characters, and collapse runs of blank lines. */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, (run) => (run.includes("\t") ? "\t" : " ")).trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

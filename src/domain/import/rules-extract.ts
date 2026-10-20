// Rule-based CV extraction (T26, decision 0033): fixed rules propose import.v1 candidates from the parsed text, and
// validateImportResult grounds them exactly like AI output. Pure, no I/O. It runs in the parser thread on untrusted
// text, so patterns avoid nested quantifiers and lines over 500 characters are never headings or date anchors.
// Shared by the worker and tests: relative imports only and no TypeScript parameter properties (Node type stripping).
import { IMPORT_LIMITS, IMPORT_SCHEMA_VERSION, MONTHS, type RawImportResult } from "./extract-result.ts";

export const RULES_HEADINGS = {
  experience: [
    "experience", "work experience", "professional experience", "employment", "work history",
    "pengalaman", "pengalaman kerja", "riwayat pekerjaan",
  ],
  education: ["education", "academic background", "pendidikan", "riwayat pendidikan"],
  skills: ["skills", "technical skills", "keahlian", "kemampuan", "keterampilan", "kompetensi"],
  summary: ["summary", "profile", "about me", "ringkasan", "profil", "tentang saya"],
  // Content under these headings is ignored in v1.
  closing: [
    "certifications", "sertifikasi", "projects", "proyek", "awards", "penghargaan", "languages", "bahasa",
    "references", "referensi", "organisasi", "organizations", "volunteering",
  ],
} as const;

type SectionKind = keyof typeof RULES_HEADINGS | "header";
type Line = { text: string; start: number; end: number };
type RawDate = { year: number; month: number | null; day: null };
type Range = { start: RawDate | null; end: RawDate | null; current: boolean; match: string };
type Entry = { header: Line[]; anchor: Line; bullets: Line[] };

const MAX_ANCHOR_LINE = 500;
const MAX_HEADING = 40;
const MAX_HEADER_LINES = 12;
const MAX_HEADLINE = 80;

const HEADING_KIND = new Map<string, SectionKind>(
  (Object.keys(RULES_HEADINGS) as Array<keyof typeof RULES_HEADINGS>)
    .flatMap((kind) => RULES_HEADINGS[kind].map((word): [string, SectionKind] => [word, kind])),
);

const MONTH_INDEX = new Map(MONTHS.flatMap((names, index) => names.map((name): [string, number] => [name, index + 1])));
const MONTH_NAMES = [...MONTH_INDEX.keys()].sort((a, b) => b.length - a.length).join("|");
const YEAR = "(?:19|20)\\d{2}";
const DATE = `(?:(?:${MONTH_NAMES})\\.?\\s?${YEAR}|\\d{1,2}\\/${YEAR}|${YEAR})`;
const PRESENT = "present|now|current|sekarang|saat ini";
const RANGE = new RegExp(
  `(?<![\\p{L}\\d/])(${DATE})\\s*(?:-|–|\\bto\\b|s\\/d|sampai)\\s*(${DATE}|${PRESENT})(?![\\p{L}\\d/])`, "iu",
);
const SINGLE_DATE = new RegExp(`(?<![\\p{L}\\d/])(${DATE})(?![\\p{L}\\d/])`, "iu");

const BULLET = /^(?:[•▪·*]\s*|-\s+|\d{1,2}[.)]\s+)/u;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d ().-]{7,22}\d/g;
const URL = /https?:\/\/[^\s<>()|,;]+/i;
const DOMAIN_TOKEN = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.([a-z]{2,})(?:\/\S*)?$/i;
const WEB_TLDS = new Set(["com", "id", "net", "org", "io", "dev", "me", "co", "app", "info", "biz", "xyz"]);
const NAME = /^\p{Lu}[\p{L}'.-]*(?: \p{Lu}[\p{L}'.-]*){1,4}$/u;
const NOT_NAMES = new Set(["curriculum vitae", "daftar riwayat hidup", "resume"]);

const ROLE_SEPARATORS = [/\s+at\s+/i, /\s*\|\s*/, /\s+[–-]\s+/, /,\s+/];
const SEGMENT_SPLIT = /\s*\|\s*|,\s+|\s+[–-]\s+/;
const EDGE_PUNCTUATION = /^[\s,|–-]+|[\s,|–-]+$/g;
const INTERNSHIP = /(?<![\p{L}])(?:intern|internship|magang)(?![\p{L}])/iu;
const VOLUNTEER = /(?<![\p{L}])(?:volunteer|relawan|sukarelawan)(?![\p{L}])/iu;
const INSTITUTION = /(?<![\p{L}])(?:universitas|university|institut|institute|politeknik|polytechnic|sekolah|school|sma|smk|college|akademi|academy)(?![\p{L}])/iu;
const DEGREE = /(?<![\p{L}\d])(?:s1|s2|s3|d3|d4|sarjana|magister|doktor|diploma|bachelor|master|phd|b\.sc|m\.sc|b\.eng|s\.kom|s\.t\.)(?![\p{L}\d])/iu;
const FIELD_LABEL = /(?<![\p{L}])(?:jurusan|program studi|prodi)(?![\p{L}])\s*:?\s*/iu;
const FIELD_IN = /\s+in\s+/i;
const FIELD_OF = /\s+of\s+/i;
const SKILL_LABEL = /^[^:,;|•]{1,40}:\s*/u;
const SKILL_SPLIT = /[,;•|]/u;

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed !== "") {
      const start = offset + raw.indexOf(trimmed);
      lines.push({ text: trimmed, start, end: start + trimmed.length });
    }
    offset += raw.length + 1;
  }
  return lines;
}

function headingKind(line: Line): SectionKind | null {
  if (line.text.length > MAX_HEADING || /\d/.test(line.text)) return null;
  const key = line.text.replace(/:/g, "").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
  return HEADING_KIND.get(key) ?? null;
}

function sections(lines: Line[]): Array<{ kind: SectionKind; lines: Line[] }> {
  const result: Array<{ kind: SectionKind; lines: Line[] }> = [{ kind: "header", lines: [] }];
  for (const line of lines) {
    const kind = headingKind(line);
    if (kind) result.push({ kind, lines: [] });
    else result[result.length - 1]!.lines.push(line);
  }
  return result;
}

const isBullet = (line: Line) => BULLET.test(line.text);
const stripBullet = (text: string) => text.replace(BULLET, "").trim();
const slice = (text: string, first: Line, last: Line) => text.slice(first.start, last.end);

function toDate(token: string): RawDate | null {
  const value = token.toLocaleLowerCase("en").trim();
  const year = Number(/(?:19|20)\d{2}$/.exec(value)?.[0]);
  if (!Number.isInteger(year)) return null;
  const numeric = /^(\d{1,2})\//.exec(value);
  if (numeric) {
    const month = Number(numeric[1]);
    return { year, month: month >= 1 && month <= 12 ? month : null, day: null };
  }
  const name = /^\p{L}+/u.exec(value)?.[0];
  return { year, month: name ? MONTH_INDEX.get(name) ?? null : null, day: null };
}

function findRange(line: Line): Range | null {
  if (line.text.length > MAX_ANCHOR_LINE) return null;
  const match = RANGE.exec(line.text);
  if (!match) return null;
  const start = toDate(match[1]!);
  const current = new RegExp(`^(?:${PRESENT})$`, "i").test(match[2]!.trim());
  return { start, end: current ? null : toDate(match[2]!), current, match: match[0] };
}

function findSingleDate(line: Line): Range | null {
  if (line.text.length > MAX_ANCHOR_LINE) return null;
  const match = SINGLE_DATE.exec(line.text);
  return match ? { start: null, end: toDate(match[1]!), current: false, match: match[0] } : null;
}

function remainder(line: Line, range: Range | null): string {
  const text = range && line.text.includes(range.match) ? line.text.replace(range.match, " ") : line.text;
  return text.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(EDGE_PUNCTUATION, "");
}

/**
 * Groups a section into entries around date anchors. A run of non-bullet lines is split per anchor: when the run starts
 * with a bare date the entry starts at the anchor (date, role, organization), otherwise it ends at the anchor (up to
 * two lines before it). At most three header lines per entry; the bullets after the run belong to its last entry.
 */
function entries(lines: Line[], anchorOf: (line: Line) => Range | null): Array<Entry & { range: Range }> {
  const result: Array<Entry & { range: Range }> = [];
  let index = 0;
  while (index < lines.length) {
    if (isBullet(lines[index]!)) { index += 1; continue; }
    const group: Line[] = [];
    while (index < lines.length && !isBullet(lines[index]!)) group.push(lines[index++]!);
    const bullets: Line[] = [];
    while (index < lines.length && isBullet(lines[index]!)) bullets.push(lines[index++]!);

    const anchors = group.flatMap((line, at) => {
      const range = anchorOf(line);
      return range ? [{ at, range }] : [];
    });
    if (anchors.length === 0) continue;
    const made: Array<Entry & { range: Range }> = [];
    const startsAtAnchor = anchors[0]!.at === 0 && remainder(group[0]!, anchors[0]!.range) === "";
    anchors.forEach(({ at, range }, position) => {
      const next = anchors[position + 1]?.at ?? group.length;
      const previous = position === 0 ? -1 : anchors[position - 1]!.at;
      const header = startsAtAnchor
        ? group.slice(at, Math.min(next, at + 3))
        : [...group.slice(previous + 1, at).slice(-2), group[at]!];
      made.push({ header, anchor: group[at]!, bullets: [], range });
    });
    made[made.length - 1]!.bullets = bullets;
    result.push(...made);
  }
  return result;
}

/** The entry's excerpt: its header lines plus as many following bullets as fit in the excerpt limit. */
function entryExcerpt(text: string, entry: Entry): { excerpt: string; bullets: Line[] } | null {
  const first = entry.header[0]!;
  const last = entry.header[entry.header.length - 1]!;
  if (slice(text, first, last).length > IMPORT_LIMITS.excerpt) return null;
  const kept: Line[] = [];
  for (const bullet of entry.bullets) {
    if (slice(text, first, bullet).length > IMPORT_LIMITS.excerpt) break;
    kept.push(bullet);
  }
  return { excerpt: slice(text, first, kept[kept.length - 1] ?? last), bullets: kept };
}

function splitPair(value: string): [string, string] | null {
  for (const separator of ROLE_SEPARATORS) {
    const match = separator.exec(value);
    if (!match) continue;
    const left = value.slice(0, match.index).trim();
    const right = value.slice(match.index + match[0].length).trim();
    if (left !== "" && right !== "") return [left, right];
  }
  return null;
}

function experiences(text: string, lines: Line[]): RawImportResult["experiences"] {
  const result: RawImportResult["experiences"] = [];
  for (const entry of entries(lines, findRange)) {
    if (result.length >= IMPORT_LIMITS.perType) break;
    const cut = entryExcerpt(text, entry);
    if (!cut) continue;
    const parts = entry.header.map((line) => remainder(line, line === entry.anchor ? entry.range : null)).filter((part) => part !== "");
    // A separator on the first line wins; otherwise two lines are role then organization.
    const pair = (parts[0] === undefined ? null : splitPair(parts[0]))
      ?? (parts.length >= 2 ? [parts[0]!, parts[1]!] as [string, string] : null);
    const headerText = entry.header.map((line) => line.text).join(" ");
    const description = cut.bullets.map((line) => stripBullet(line.text)).filter((line) => line !== "").join("\n");
    result.push({
      ref: `exp-${result.length + 1}`,
      role_title: pair?.[0] ?? null,
      organization: pair?.[1] ?? null,
      kind: INTERNSHIP.test(headerText) ? "internship" : VOLUNTEER.test(headerText) ? "volunteer" : null,
      description: description === "" || description.length > IMPORT_LIMITS.long ? null : description,
      start: entry.range.start,
      end: entry.range.end,
      is_current: entry.range.current,
      excerpt: cut.excerpt,
    });
  }
  return result;
}

function educationFields(segments: string[]) {
  const institutionAt = segments.findIndex((segment) => INSTITUTION.test(segment));
  const qualificationAt = segments.findIndex((segment, at) => at !== institutionAt && DEGREE.test(segment));
  let qualification: string | null = null;
  let field: string | null = null;
  if (qualificationAt >= 0) {
    const segment = segments[qualificationAt]!;
    const label = FIELD_LABEL.exec(segment) ?? FIELD_IN.exec(segment) ?? FIELD_OF.exec(segment);
    if (label && segment.slice(label.index + label[0].length).trim() !== "") {
      qualification = segment.slice(0, label.index).trim() || segment;
      field = segment.slice(label.index + label[0].length).trim();
    } else {
      qualification = segment;
      const next = segments[qualificationAt + 1];
      if (next !== undefined && qualificationAt + 1 !== institutionAt && !/\d/.test(next) && !DEGREE.test(next)) field = next;
    }
  }
  if (field === null) {
    for (const segment of segments) {
      const label = FIELD_LABEL.exec(segment);
      if (label && label.index === 0 && segment.slice(label[0].length).trim() !== "") field = segment.slice(label[0].length).trim();
    }
  }
  return { institution: institutionAt >= 0 ? segments[institutionAt]! : null, qualification, field_of_study: field };
}

function education(text: string, lines: Line[]): RawImportResult["education"] {
  const result: RawImportResult["education"] = [];
  for (const entry of entries(lines, (line) => findRange(line) ?? findSingleDate(line))) {
    if (result.length >= IMPORT_LIMITS.perType) break;
    const cut = entryExcerpt(text, { ...entry, bullets: [] });
    if (!cut) continue;
    const segments = entry.header
      .map((line) => remainder(line, line === entry.anchor ? entry.range : null))
      .flatMap((part) => part.split(SEGMENT_SPLIT))
      .map((segment) => segment.replace(EDGE_PUNCTUATION, ""))
      .filter((segment) => segment !== "");
    result.push({
      ...educationFields(segments),
      description: null,
      start: entry.range.start,
      end: entry.range.end,
      is_current: entry.range.current,
      excerpt: cut.excerpt,
    });
  }
  return result;
}

function skills(lines: Line[]): RawImportResult["skills"] {
  const result: RawImportResult["skills"] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.text.length > IMPORT_LIMITS.excerpt) continue;
    const content = stripBullet(line.text).replace(SKILL_LABEL, "");
    for (const token of content.split(SKILL_SPLIT)) {
      if (result.length >= IMPORT_LIMITS.perType) return result;
      const name = token.trim().replace(/[.]+$/, "").trim();
      const key = name.toLocaleLowerCase("en");
      if (name.length < 1 || name.length > 50 || name.split(/\s+/).length > 5 || !/[\p{L}\d]/u.test(name) || seen.has(key)) continue;
      seen.add(key);
      result.push({ name, excerpt: line.text });
    }
  }
  return result;
}

function website(line: string): string | null {
  const url = URL.exec(line)?.[0];
  if (url) return url.replace(/[.]+$/, "");
  for (const raw of line.split(/[\s|,;]+/)) {
    const token = raw.replace(/[.]+$/, "");
    if (token.includes("@")) continue;
    const match = DOMAIN_TOKEN.exec(token);
    if (match && (token.toLowerCase().startsWith("www.") || token.includes("/") || WEB_TLDS.has(match[1]!.toLowerCase()))) {
      return `https://${token}`;
    }
  }
  return null;
}

function phone(line: string): string | null {
  for (const match of line.matchAll(PHONE)) {
    const value = match[0].trim();
    const digits = value.replace(/\D/g, "").length;
    if (digits >= 9 && digits <= 15 && (value.startsWith("+") || value.startsWith("08"))) return value;
  }
  return null;
}

const isContact = (line: string) => EMAIL.test(line) || phone(line) !== null || website(line) !== null;

function profile(
  text: string,
  header: Line[],
  summary: Line[] | undefined,
): RawImportResult["profile"] {
  const lines: Line[] = [];
  for (const line of header.slice(0, MAX_HEADER_LINES)) {
    if (slice(text, header[0]!, line).length > IMPORT_LIMITS.excerpt) break;
    lines.push(line);
  }
  const usable = lines.filter((line) => line.text.length <= MAX_ANCHOR_LINE);
  const used = new Set<Line>();
  const take = <T>(found: { line: Line; value: T } | undefined): T | null => {
    if (!found) return null;
    used.add(found.line);
    return found.value;
  };
  const pick = (read: (line: string) => string | null) => {
    for (const line of usable) {
      const value = read(line.text);
      if (value !== null) return { line, value };
    }
    return undefined;
  };

  const nameAt = usable.findIndex((line) => NAME.test(line.text) && !NOT_NAMES.has(line.text.toLocaleLowerCase("en")));
  const display_name = nameAt >= 0 ? take({ line: usable[nameAt]!, value: usable[nameAt]!.text }) : null;
  const next = nameAt >= 0 ? usable[nameAt + 1] : undefined;
  const headline = next && next.text.length <= MAX_HEADLINE && !isContact(next.text) && !findRange(next)
    ? take({ line: next, value: next.text })
    : null;
  const contact_email = take(pick((line) => EMAIL.exec(line)?.[0] ?? null));
  const phoneValue = take(pick(phone));
  const websiteValue = take(pick(website));

  let summaryValue: string | null = null;
  let last = lines.filter((line) => used.has(line)).pop();
  if (summary && summary.length > 0) {
    const value = summary.map((line) => line.text).join(" ");
    const from = lines[0] ?? summary[0]!;
    if (value.length <= IMPORT_LIMITS.long && slice(text, from, summary[summary.length - 1]!).length <= IMPORT_LIMITS.excerpt) {
      summaryValue = value;
      last = summary[summary.length - 1]!;
    }
  }
  if (!last) return null;
  const first = lines[0] ?? summary?.[0] ?? last;
  return {
    display_name, headline, summary: summaryValue, contact_email, phone: phoneValue, location: null, website: websiteValue,
    excerpt: slice(text, first, last),
  };
}

/** Proposes import.v1 candidates from parsed CV text using fixed rules; uncertain fields stay null. */
export function extractImportByRules(text: string): RawImportResult {
  const all = sections(splitLines(text));
  const of = (kind: SectionKind) => all.filter((section) => section.kind === kind);
  const header = of("header")[0]!.lines;
  const summary = of("summary")[0]?.lines;

  const experienceItems = of("experience").flatMap((section) => experiences(text, section.lines)).slice(0, IMPORT_LIMITS.perType)
    .map((item, index) => ({ ...item, ref: `exp-${index + 1}` }));
  const educationItems = of("education").flatMap((section) => education(text, section.lines)).slice(0, IMPORT_LIMITS.perType);
  const seen = new Set<string>();
  const skillItems = of("skills").flatMap((section) => skills(section.lines))
    .filter((item) => {
      const key = item.name!.toLocaleLowerCase("en");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, IMPORT_LIMITS.perType);

  return {
    schema_version: IMPORT_SCHEMA_VERSION,
    profile: profile(text, header, summary),
    experiences: experienceItems,
    education: educationItems,
    certifications: [],
    skills: skillItems,
    achievements: [],
  };
}

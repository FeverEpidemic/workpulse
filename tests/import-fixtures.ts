// In-memory CV import fixtures (no binaries committed). Every builder is deterministic.
import { docxFixture, zipFixture } from "./evidence-fixtures";

export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");

/** Long enough (>200 non-whitespace characters) to pass the scanned-PDF threshold. */
export const CV_LINES = [
  "Curriculum Vitae WP-PRIVATE-IMPORT-SENTINEL",
  "EXP|PT Sentinel Nusantara|Analis Data|2019|2022",
  "EXP|WP Labs|Data Lead|2021|",
  "EDU|Universitas Contoh|S1 Statistika|2014|2018",
  "CERT|Google Data Analytics|Google|2020",
  "SKILL|Statistika",
  "SKILL|SQL",
  "ACH|Menurunkan waktu laporan dari 5 ke 2 jam|PT Sentinel Nusantara",
  "Pengalaman kerja di bidang analitik data untuk tim produk dan operasional perusahaan.",
];

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

type PdfOptions = { encrypt?: boolean; imageOnly?: boolean };

/** Minimal, valid PDF 1.4 with one Helvetica text page per entry (or image-only pages). */
export function pdfFixture(pages: string[][], options: PdfOptions = {}): Buffer {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const image = options.imageOnly
    ? add("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\u0080\nendstream")
    : 0;
  const kids: number[] = [];
  for (const lines of pages) {
    const stream = options.imageOnly
      ? "q 200 0 0 200 50 500 cm /Im1 Do Q"
      : `BT /F1 11 Tf 14 TL 50 800 Td ${lines.map((line) => `(${escapePdfText(line)}) Tj T*`).join(" ")} ET`;
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const resources = options.imageOnly
      ? `<< /XObject << /Im1 ${image} 0 R >> >>`
      : `<< /Font << /F1 ${font} 0 R >> >>`;
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources ${resources} /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const encrypt = options.encrypt
    ? add(`<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O <${"a1".repeat(32)}> /U <${"b2".repeat(32)}> >>`)
    : 0;

  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  const id = `<${"0f".repeat(16)}>`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R /ID [${id} ${id}]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export function cvPdf(pageCount = 2, lines = CV_LINES): Buffer {
  return pdfFixture(Array.from({ length: pageCount }, (_, index) => (index === 0 ? lines : [`Page ${index + 1}`])));
}

function paragraph(text: string, pageBreakBefore = false): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const br = pageBreakBefore ? '<w:r><w:br w:type="page"/></w:r>' : "";
  return `<w:p>${br}<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

type DocxOptions = { pages?: number; appPages?: number; extra?: Record<string, string> };

/** DOCX with the given lines; `pages` inserts explicit page breaks so a renderer paginates. */
export function cvDocx(lines: string[] = CV_LINES, options: DocxOptions = {}): Buffer {
  const pages = options.pages ?? 1;
  const body = [
    ...lines.map((line) => paragraph(line)),
    ...Array.from({ length: pages - 1 }, (_, index) => paragraph(`Halaman ${index + 2}`, true)),
  ].join("");
  return docxFixture({
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    "docProps/app.xml": `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>${options.appPages ?? 1}</Pages></Properties>`,
    ...(options.extra ?? {}),
  });
}

export function emptyDocx(): Buffer {
  return docxFixture({
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
  });
}

export function macroDocx(): Buffer {
  return cvDocx(CV_LINES, { extra: { "word/vbaProject.bin": "macro" } });
}

/** Declares more than the 50 MiB uncompressed budget while staying tiny on disk. */
export function zipBombDocx(): Buffer {
  return cvDocx(CV_LINES, { extra: { "word/media/bomb.bin": "0".repeat(51 * 1024 * 1024) } });
}

export function spreadsheetZip(): Buffer {
  return zipFixture({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>", "_rels/.rels": "<Relationships/>" });
}

const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
export function encryptedOfficeFile(): Buffer {
  return Buffer.concat([CFB, Buffer.alloc(504), Buffer.from("EncryptedPackage", "utf16le"), Buffer.alloc(64)]);
}
export function legacyDocFile(): Buffer {
  return Buffer.concat([CFB, Buffer.alloc(504), Buffer.from("WordDocument", "utf16le"), Buffer.alloc(64)]);
}

// T26 rule-extraction fixtures: synthetic CV text for fictional people and employers, written the way the parser
// thread returns it (one trimmed line per paragraph).

export const RULES_CV_EN = [
  "Rina Fiktif",
  "Data Analyst",
  "rina.fiktif@contoh.test | +62 812 3456 7890 | linkedin.com/in/rina-fiktif",
  "Summary",
  "Data analyst with 6 years of experience in reporting for retail teams.",
  "Work Experience",
  "Senior Data Analyst at PT Contoh Rekaan",
  "Jan 2021 - Present",
  "• Built a weekly sales dashboard used by 40 store managers",
  "• Cut report preparation from 5 hours to 2 hours",
  "Data Analyst | CV Maju Fiktif",
  "03/2018 – 12/2020",
  "- Maintained the inventory data mart",
  "Data Intern",
  "Toko Rekaan Jaya",
  "2017 - 2017",
  "Education",
  "Bachelor of Science in Statistics",
  "Universitas Rekaan, 2013 - 2017",
  "Skills",
  "Languages: SQL, Python, R",
  "Tools: Power BI; Excel | CI/CD",
  "Certifications",
  "Google Data Analytics, 2021",
].join("\n");

export const RULES_CV_ID = [
  "Budi Rekaan",
  "Pengembang Perangkat Lunak",
  "budi.rekaan@contoh.test",
  "0812-3456-7890",
  "Ringkasan",
  "Pengembang dengan pengalaman 5 tahun membangun aplikasi web.",
  "Pengalaman Kerja",
  "Software Engineer",
  "PT Fiktif Sejahtera",
  "Februari 2020 s/d sekarang",
  "• Memimpin migrasi layanan pembayaran",
  "Relawan Pengajar, Yayasan Rekaan Cerdas, 2018 sampai 2019",
  "Magang Backend – PT Contoh Digital",
  "Juli 2017 - Agustus 2017",
  "Pendidikan",
  "S1, Teknik Informatika, Institut Teknologi Rekaan",
  "2013 - 2017",
  "SMA Negeri 99 Rekaan",
  "2013",
  "Keahlian",
  "• Go • PostgreSQL • Docker",
  "Kemampuan: Kubernetes, go",
  "Bahasa",
  "Indonesia, Inggris",
].join("\n");

/**
 * ASCII lines for PDF fixtures (the minimal PDF writer encodes Latin-1 only), with a private sentinel that must never
 * reach logs, responses or the browser console.
 */
export const RULES_CV_PDF_LINES = [
  "Rina Fiktif",
  "Data Analyst",
  "rina.fiktif@contoh.test | +62 812 3456 7890",
  "Summary",
  "Data analyst with 6 years of experience in reporting for retail teams.",
  "Work Experience",
  "Senior Data Analyst at PT Contoh Rekaan",
  "Jan 2021 - Present",
  "- Built a weekly sales dashboard used by 40 store managers",
  "Education",
  "Bachelor of Science in Statistics",
  "Universitas Rekaan, 2013 - 2017",
  "Skills",
  "Languages: SQL, Python",
  // Under a closing heading, so it stays in the stored text but never becomes a candidate.
  "References",
  "WP-RULES-PRIVATE-SENTINEL available on request",
];

export function rulesCvPdf(lines = RULES_CV_PDF_LINES): Buffer {
  return pdfFixture([lines]);
}

/** One entry per date and separator variant; the anchor line is the only date in each entry. */
export const RULES_CV_DATE_VARIANTS = [
  "Experience",
  "Analyst A - Org A",
  "Mar 2015 to Jun 2016",
  "Analyst B - Org B",
  "2016 – now",
  "Analyst C - Org C",
  "Sep. 2010 - current",
  "Analis D - Org D",
  "Mei 2012 sampai saat ini",
  "Analis E - Org E",
  "Agt 2011 s/d Des 2011",
].join("\n");

export const RULES_CV_NO_HEADINGS = [
  "Saya bekerja sebagai analis selama beberapa tahun di berbagai perusahaan rekaan.",
  "Saya suka belajar hal baru dan bekerja dengan tim lintas fungsi.",
  "Kontak saya tersedia atas permintaan.",
].join("\n");

export const RULES_CV_UNDATED_EXPERIENCE = [
  "Experience",
  "Data Analyst at PT Contoh Rekaan",
  "• Built dashboards for 12 teams",
  "Skills",
  "SQL",
].join("\n");

/** Text from a two-column layout read across both columns at once: nothing should be guessed from it. */
export const RULES_CV_TWO_COLUMN = [
  "Rina Fiktif                 Skills",
  "Experience                  SQL, Python",
  "Data Analyst at PT Contoh   Education",
  "Rekaan 2019 - 2021          Universitas Rekaan 2013",
  "• Built dashboards          Languages",
].join("\n");

/**
 * Lines shaped to trigger backtracking in naive patterns; each must be handled quickly. Most stay just under the
 * 500 character anchor limit so every pattern really runs on them; the last ones are over it.
 */
export const RULES_HOSTILE_LINES = [
  "2020 - ".repeat(70),
  "Jan ".repeat(122) + "x",
  "a".repeat(495) + "@",
  "a@".repeat(245) + "a.",
  "+1 ".repeat(165),
  "1/".repeat(245),
  "0".repeat(499),
  "-".repeat(499),
  "S1, ".repeat(124),
  "a.".repeat(245) + "com",
  "Universitas ".repeat(41),
  ("Analyst at Org, " + "x ".repeat(40)).repeat(5),
  "Jan ".repeat(300) + "2020 - now",
  "a.".repeat(1200),
];

export function eicarDocx(): Buffer {
  return cvDocx(CV_LINES, { extra: { "test-signature.txt": EICAR } });
}

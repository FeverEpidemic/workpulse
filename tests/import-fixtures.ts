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

export function eicarDocx(): Buffer {
  return cvDocx(CV_LINES, { extra: { "test-signature.txt": EICAR } });
}

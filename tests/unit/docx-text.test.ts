import { describe, expect, it } from "vitest";

import { extractDocxText, normalizeExtractedText } from "@/server/documents/docx-text";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

describe("T15 DOCX text extraction", () => {
  it("keeps paragraphs, runs, tabs, breaks and Indonesian characters", () => {
    const xml = `<w:document ${W}><w:body>`
      + '<w:p><w:r><w:t>Analis </w:t></w:r><w:r><w:t xml:space="preserve">Data</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>2019</w:t><w:tab/><w:t>2022</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Baris satu</w:t><w:br/><w:t>Baris dua</w:t></w:r></w:p>'
      + "<w:p><w:r><w:t>Pengalaman &amp; keahlian &#233;l&#xE8;ve &lt;ok&gt;</w:t></w:r></w:p>"
      + "</w:body></w:document>";
    expect(extractDocxText(xml)).toBe("Analis Data\n2019\t2022\nBaris satu\nBaris dua\nPengalaman & keahlian élève <ok>");
  });

  it("separates table cells with tabs and rows with newlines", () => {
    const xml = `<w:document ${W}><w:body><w:tbl>`
      + "<w:tr><w:tc><w:p><w:r><w:t>Org</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Role</w:t></w:r></w:p></w:tc></w:tr>"
      + "</w:tbl></w:body></w:document>";
    expect(extractDocxText(xml)).toContain("Org");
    expect(extractDocxText(xml)).toContain("Role");
  });

  it("skips deleted text, field codes and tab-stop definitions", () => {
    const xml = `<w:document ${W}><w:body>`
      + '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>'
      + "<w:r><w:delText>removed</w:delText></w:r><w:r><w:instrText>HYPERLINK x</w:instrText></w:r>"
      + "<w:r><w:t>kept</w:t></w:r></w:p></w:body></w:document>";
    expect(extractDocxText(xml)).toBe("kept");
  });

  it("drops control characters and numeric references to them", () => {
    expect(extractDocxText(`<w:document ${W}><w:body><w:p><w:r><w:t>a&#1;b&#x0;c</w:t></w:r></w:p></w:body></w:document>`)).toBe("abc");
    expect(normalizeExtractedText("  a  \n\n\n\n b\u0007 ")).toBe("a\n\nb");
  });

  it("returns an empty string for a document without text", () => {
    expect(extractDocxText(`<w:document ${W}><w:body><w:p/></w:body></w:document>`)).toBe("");
  });
});

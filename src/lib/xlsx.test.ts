import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildXlsx } from "./xlsx";

/** Unzips a built workbook and returns the sheet XML. */
async function sheetXmlOf(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  if (!xml) throw new Error("sheet1.xml missing");
  return xml;
}

const baseSheet = {
  name: "מנה",
  header: ["סוג תנועה", "ת. אסמכתא", "סכום"],
  rows: [],
};

describe("buildXlsx", () => {
  it("writes every part Excel needs to open the file", async () => {
    const blob = await buildXlsx({ ...baseSheet, rows: [] });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]) {
      expect(zip.file(part), part).not.toBeNull();
    }
  });

  it("converts a date to the Excel serial without a timezone shift", async () => {
    // 1899-12-30 is serial 0, so 2026-05-26 is 46168. Computing this via Date()
    // in a UTC+3 timezone is exactly how dates slip to the previous day.
    const xml = await sheetXmlOf(
      await buildXlsx({ ...baseSheet, rows: [[{ t: "d", v: "2026-05-26" }]] }),
    );
    expect(xml).toContain("<v>46168</v>");
  });

  it("keeps a non-numeric reference as text instead of NaN", async () => {
    const xml = await sheetXmlOf(
      await buildXlsx({ ...baseSheet, rows: [[{ t: "s", v: "A-771" }]] }),
    );
    expect(xml).toContain("A-771");
    expect(xml).not.toContain("NaN");
  });

  it("emits negative amounts as-is, so credit notes survive", async () => {
    const xml = await sheetXmlOf(
      await buildXlsx({ ...baseSheet, rows: [[{ t: "money", v: -11.8 }]] }),
    );
    expect(xml).toContain("<v>-11.8</v>");
  });

  it("skips blank cells rather than writing empty ones", async () => {
    const xml = await sheetXmlOf(
      await buildXlsx({ ...baseSheet, rows: [[{ t: "n", v: 6 }, { t: "blank" }, { t: "n", v: 8 }]] }),
    );
    expect(xml).toContain('<c r="A2"');
    expect(xml).not.toContain('<c r="B2"');
    expect(xml).toContain('<c r="C2"');
  });

  it("escapes XML-hostile characters in strings", async () => {
    const xml = await sheetXmlOf(
      await buildXlsx({ ...baseSheet, rows: [[{ t: "s", v: 'א & ב <ג> "ד"' }]] }),
    );
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;ג&gt;");
  });

  it("keeps the sheet RTL with a frozen header row", async () => {
    const xml = await sheetXmlOf(await buildXlsx({ ...baseSheet, rows: [] }));
    expect(xml).toContain('rightToLeft="1"');
    expect(xml).toContain('state="frozen"');
  });
});

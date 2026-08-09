import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildXlsx } from "./xlsx";

/** Round-trips a built workbook back through exceljs. */
async function readBack(blob: Blob) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}

const baseSheet = {
  name: "Sheet1",
  header: ["סוג תנועה", "ת. אסמכתא", "סכום"],
  rows: [],
};

describe("buildXlsx", () => {
  it("writes a readable workbook with the requested sheet name", async () => {
    const wb = await readBack(await buildXlsx({ ...baseSheet, rows: [] }));
    expect(wb.worksheets).toHaveLength(1);
    expect(wb.worksheets[0].name).toBe("Sheet1");
  });

  it("writes the date as a real date cell without a timezone shift", async () => {
    // Building the Date from the string parts is what stops a UTC+3 offset
    // from pushing an invoice into the previous day.
    const wb = await readBack(
      await buildXlsx({ ...baseSheet, rows: [[{ t: "d", v: "2026-05-26" }]] }),
    );
    const cell = wb.worksheets[0].getCell("A2");
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).toISOString().slice(0, 10)).toBe("2026-05-26");
    expect(cell.numFmt).toBe("dd/mm/yyyy");
  });

  it("keeps a non-numeric reference as text instead of NaN", async () => {
    const wb = await readBack(
      await buildXlsx({ ...baseSheet, rows: [[{ t: "s", v: "A-771" }]] }),
    );
    expect(wb.worksheets[0].getCell("A2").value).toBe("A-771");
  });

  it("emits negative amounts as-is, so credit notes survive", async () => {
    const wb = await readBack(
      await buildXlsx({ ...baseSheet, rows: [[{ t: "money", v: -11.8 }]] }),
    );
    expect(wb.worksheets[0].getCell("A2").value).toBe(-11.8);
  });

  it("rounds money to two decimals and formats it that way", async () => {
    const wb = await readBack(
      await buildXlsx({
        ...baseSheet,
        rows: [[{ t: "money", v: 204.2905 }, { t: "money", v: -11.836 }]],
      }),
    );
    const ws = wb.worksheets[0];
    expect(ws.getCell("A2").value).toBe(204.29);
    expect(ws.getCell("A2").numFmt).toBe("#,##0.00");
    expect(ws.getCell("B2").value).toBe(-11.84);
  });

  it("leaves blank cells empty rather than writing a zero or an empty string", async () => {
    const wb = await readBack(
      await buildXlsx({
        ...baseSheet,
        rows: [[{ t: "n", v: 6 }, { t: "blank" }, { t: "n", v: 8 }]],
      }),
    );
    const ws = wb.worksheets[0];
    expect(ws.getCell("A2").value).toBe(6);
    expect(ws.getCell("B2").value).toBeNull();
    expect(ws.getCell("C2").value).toBe(8);
  });

  it("survives XML-hostile characters in strings", async () => {
    const text = 'א & ב <ג> "ד"';
    const wb = await readBack(await buildXlsx({ ...baseSheet, rows: [[{ t: "s", v: text }]] }));
    expect(wb.worksheets[0].getCell("A2").value).toBe(text);
  });

  it("keeps the sheet RTL with a frozen header row and the given widths", async () => {
    const wb = await readBack(
      await buildXlsx({ ...baseSheet, rows: [], columnWidths: [16, 13.5, 7.25] }),
    );
    const ws = wb.worksheets[0];
    expect(ws.views[0].rightToLeft).toBe(true);
    expect(ws.views[0].state).toBe("frozen");
    expect(ws.getColumn(2).width).toBeCloseTo(13.5, 3);
  });
});

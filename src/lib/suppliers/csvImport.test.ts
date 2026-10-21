import { describe, it, expect } from "vitest";
import { parseSupplierCsvRows, buildSupplierInsertRecord } from "./csvImport";

const emptyMaps = { parentCatIdMap: new Map<string, string>(), childCatIdMap: new Map<string, string>() };

describe("supplier CSV accounting account number", () => {
  it.each([
    "מספר חשבון בהנהלת חשבונות",
    `מספר חשבון בהנה"ח`,
    "חשבון לקוח/ספק",
  ])("reads the column '%s' into the insert record", (header) => {
    const result = parseSupplierCsvRows(
      [{ "שם הספק": "ספק א", [header]: " 8134 " }, { "שם הספק": "ספק ב", [header]: "" }],
      ["שם הספק", header],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [a, b] = result.suppliers.map((s) => buildSupplierInsertRecord(s, "biz", emptyMaps));
    expect(a.accounting_account_number).toBe("8134");
    expect(b.accounting_account_number).toBeNull();
  });

  it("matches a header written with a curly apostrophe", () => {
    const header = "מספר חשבון בהנה’ח";
    const result = parseSupplierCsvRows([{ "שם הספק": "ספק א", [header]: "8134" }], ["שם הספק", header]);
    expect(result.ok && result.suppliers[0].accounting_account_number).toBe("8134");
  });

  it("does not take a bare 'מספר חשבון' column (usually the bank account)", () => {
    const rows = [{ "שם הספק": "ספק א", "מספר חשבון": "123456", "מספר חשבון בהנהלת חשבונות": "8134" }];
    const result = parseSupplierCsvRows(rows, ["שם הספק", "מספר חשבון", "מספר חשבון בהנהלת חשבונות"]);
    expect(result.ok && result.suppliers[0].accounting_account_number).toBe("8134");
  });

  it.each([
    ["8134.0", "8134"],
    ["8,134", "8134"],
    ["‏8134", "8134"],
  ])("cleans Excel artifact '%s' to '%s'", (raw, expected) => {
    const header = "מספר חשבון בהנהלת חשבונות";
    const result = parseSupplierCsvRows([{ "שם הספק": "ספק א", [header]: raw }], ["שם הספק", header]);
    expect(result.ok && result.suppliers[0].accounting_account_number).toBe(expected);
    expect(result.ok && result.warnings).toEqual([]);
  });

  it.each(["#N/A", "0", "-", "8134.50"])("drops '%s' and warns", (raw) => {
    const header = "מספר חשבון בהנהלת חשבונות";
    const result = parseSupplierCsvRows([{ "שם הספק": "ספק א", [header]: raw }], ["שם הספק", header]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suppliers[0].accounting_account_number).toBe("");
    expect(result.warnings.some((w) => w.includes("ספק א"))).toBe(true);
  });

  it("matches the smart-quote and abbreviated headers", () => {
    for (const header of ["מספר חשבון בהנה”ח", "מס' חשבון בהנה\"ח", "חשבון לקוח / ספק"]) {
      const result = parseSupplierCsvRows([{ "שם הספק": "ספק א", [header]: "8134" }], ["שם הספק", header]);
      expect(result.ok && result.suppliers[0].accounting_account_number).toBe("8134");
    }
  });

  it("does not change how a curly-quote VAT header is read", () => {
    const result = parseSupplierCsvRows(
      [{ "שם הספק": "ספק א", "נדרש מע\"מ": "כן", "מע’מ": "18%" }],
      ["שם הספק", "נדרש מע\"מ", "מע’מ"],
    );
    expect(result.ok && result.suppliers[0].vat_type).toBe("full");
  });

  it("warns when two suppliers share one account number", () => {
    const header = "מספר חשבון בהנהלת חשבונות";
    const result = parseSupplierCsvRows(
      [{ "שם הספק": "ספק א", [header]: "8134" }, { "שם הספק": "ספק ב", [header]: "8134" }],
      ["שם הספק", header],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("8134") && w.includes("ספק א") && w.includes("ספק ב"))).toBe(true);
  });

  it("leaves the number empty when the file has no such column", () => {
    const result = parseSupplierCsvRows([{ "שם הספק": "ספק א" }], ["שם הספק"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildSupplierInsertRecord(result.suppliers[0], "biz", emptyMaps).accounting_account_number).toBeNull();
  });
});

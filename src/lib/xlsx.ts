/**
 * Single-sheet .xlsx writer used by the Summit (סאמיט) export.
 *
 * Backed by exceljs. An earlier version hand-rolled the OOXML on top of jszip;
 * openpyxl read it back fine but Excel itself put up the "we found a problem
 * with some content" repair prompt, so this now delegates to a library that
 * Excel accepts. exceljs is imported dynamically so its ~1MB only loads when a
 * user actually exports.
 */

export type XlsxCell =
  | { t: "s"; v: string }
  /** Plain integer / identifier — rendered with the General format. */
  | { t: "n"; v: number }
  /** Money — rendered with thousands separators and 2 decimals. */
  | { t: "money"; v: number }
  /** `YYYY-MM-DD`; rendered as a real date cell, dd/mm/yyyy. */
  | { t: "d"; v: string }
  | { t: "blank" };

export interface XlsxSheet {
  name: string;
  header: string[];
  rows: XlsxCell[][];
  /** Column widths in Excel character units, index-aligned with `header`. */
  columnWidths?: number[];
  /** Right-to-left sheet view. Defaults to true — this is a Hebrew app. */
  rightToLeft?: boolean;
  /** Tint the header row. Off by default so an export can match a supplied
   *  template's plain header exactly. */
  fillHeader?: boolean;
}

const DATE_FORMAT = "dd/mm/yyyy";
/** Exactly two decimals — never more, so what Excel shows is what Summit reads. */
const MONEY_FORMAT = "#,##0.00";

/** Parses `YYYY-MM-DD` into a UTC Date. Built from the string parts rather
 *  than `new Date(str)` so a timezone offset can never shift the day. */
const parseDate = (dateStr: string): Date | null => {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
};

/** Builds a one-sheet workbook and returns it as a Blob ready for download. */
export async function buildXlsx(sheet: XlsxSheet): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  // Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars.
  const safeName = sheet.name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet1";
  const ws = wb.addWorksheet(safeName, {
    views: [
      {
        rightToLeft: sheet.rightToLeft !== false,
        state: "frozen",
        ySplit: 1,
      },
    ],
  });

  ws.addRow(sheet.header);
  if (sheet.fillHeader) {
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFCFD8DC" },
    };
  }

  if (sheet.columnWidths?.length) {
    sheet.columnWidths.forEach((width, i) => {
      ws.getColumn(i + 1).width = width;
    });
  }

  for (const row of sheet.rows) {
    const excelRow = ws.addRow([]);
    row.forEach((cell, i) => {
      const target = excelRow.getCell(i + 1);
      switch (cell.t) {
        case "blank":
          break;
        case "s":
          if (cell.v) target.value = cell.v;
          break;
        case "n":
          if (Number.isFinite(cell.v)) target.value = cell.v;
          break;
        case "money":
          if (Number.isFinite(cell.v)) {
            // Rounded, not just formatted — otherwise the cell would show 204.29
            // while the value Summit imports is still 204.2905.
            target.value = Math.round(cell.v * 100) / 100;
            target.numFmt = MONEY_FORMAT;
          }
          break;
        case "d": {
          const parsed = parseDate(cell.v);
          if (parsed) {
            target.value = parsed;
            target.numFmt = DATE_FORMAT;
          }
          break;
        }
      }
    });
    excelRow.commit();
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Triggers a browser download of a one-sheet workbook. */
export async function downloadXlsx(sheet: XlsxSheet, fileName: string): Promise<void> {
  const blob = await buildXlsx(sheet);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

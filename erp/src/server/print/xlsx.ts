// Excel exports with exceljs (TX-02, TD-036). Money and SQM are numeric cells (2 / 4 decimals) built from Decimal
// strings, dates are real date cells; the header names the company, report, filters, time and user.
import ExcelJS from "exceljs";

export type XlsxColumn = { key: string; label: string; kind?: "text" | "money" | "sqm" | "date" | "int"; width?: number };
export type XlsxSheet = { name: string; title: string; filters: string[]; columns: XlsxColumn[]; rows: Record<string, string | Date | null>[]; totals?: Record<string, string> };

const FORMAT = { money: "#,##0.00;[Red]-#,##0.00", sqm: "#,##0.0000", date: "dd mmm yyyy", int: "0" } as const;

export async function renderXlsx(sheets: XlsxSheet[], meta: { company: string; user: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jame Jam ERP";
  wb.created = new Date();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31));
    ws.addRow([meta.company]).font = { bold: true, size: 13 };
    ws.addRow([sh.title]).font = { bold: true };
    for (const f of sh.filters) ws.addRow([f]);
    ws.addRow([`Generated ${new Date().toLocaleString("en-GB")} by ${meta.user}`]).font = { italic: true, color: { argb: "FF55627A" } };
    ws.addRow([]);
    const head = ws.addRow(sh.columns.map((c) => c.label));
    head.font = { bold: true };
    head.eachCell((cell) => {
      cell.border = { bottom: { style: "thin" } };
    });
    const cell = (c: XlsxColumn, v: string | Date | null | undefined) => {
      if (v === null || v === undefined || v === "") return null;
      if (c.kind === "money" || c.kind === "sqm" || c.kind === "int") return Number(v);
      if (c.kind === "date") return v instanceof Date ? v : new Date(String(v));
      return String(v);
    };
    for (const r of sh.rows) ws.addRow(sh.columns.map((c) => cell(c, r[c.key])));
    if (sh.totals) {
      const t = ws.addRow(sh.columns.map((c, i) => (i === 0 && !(c.key in sh.totals!) ? "Total" : cell(c, sh.totals![c.key]))));
      t.font = { bold: true };
      t.eachCell((x) => {
        x.border = { top: { style: "thin" } };
      });
    }
    sh.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? (c.kind === "text" || !c.kind ? 28 : 16);
      if (c.kind && c.kind !== "text") col.numFmt = FORMAT[c.kind];
    });
    ws.views = [{ state: "frozen", ySplit: head.number }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

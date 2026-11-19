// Excel / CSV imports for go-live (spec §3.4.7 "import templates with validation, an error report and a dry-run",
// T11-02, TD-037).
//  - One template per entity (download, fill, upload). The file is treated as untrusted: .xlsx or .csv only, ≤ 2 MB,
//    ≤ 5,000 rows, values only (formulas use their cached result, macros are not read).
//  - Every row goes through the same service a user would use (validation, permissions, numbering, GL, audit).
//  - All rows run in ONE transaction that the services join (inOuterTx), with a savepoint per row so one bad row does
//    not hide the others. Check (dry run) always rolls back; Import commits only when every row passed, else nothing
//    is written. Each run is recorded as an ImportBatch.
import ExcelJS from "exceljs";
import { AppError, Ctx, Tx, assertCan, audit, inOuterTx, prisma } from "../core";
import { saveCustomer, saveProduct, saveSupplier } from "../masters";
import { recordOpeningItem } from "../accounting/opening";
import { createOpeningLot } from "../inventory/lots";
import { parseCsv } from "../accounting/bank-rec";

export type ImportColumn = { header: string; key: string; required?: boolean; help: string; example: string };
export type ImportError = { row: number; column?: string; message: string };
export type ImportResult = { entity: string; mode: "DRY_RUN" | "COMMIT"; rowsTotal: number; rowsOk: number; errors: ImportError[]; committed: boolean };

type Row = { n: number; v: Record<string, string> };
type Entity = {
  title: string;
  permission: string;
  columns: ImportColumn[];
  /** Turn rows into units of work (usually one per row; opening stock groups rows by lot). */
  units?: (rows: Row[]) => { rows: Row[]; errors: ImportError[] }[] | ImportError[];
  run: (ctx: Ctx, tx: Tx, rows: Row[]) => Promise<void>;
};

// ── Lookups by the codes people know (inside the import transaction) ──
async function byCode(tx: Tx, what: "customer" | "supplier" | "product" | "warehouse" | "tax", code: string, column: string) {
  const c = code.trim();
  if (!c) return undefined;
  const row =
    what === "customer"
      ? await tx.customer.findUnique({ where: { code: c } })
      : what === "supplier"
        ? await tx.supplier.findUnique({ where: { code: c } })
        : what === "product"
          ? await tx.product.findUnique({ where: { itemCode: c.toUpperCase() } })
          : what === "warehouse"
            ? await tx.warehouse.findUnique({ where: { code: c.toUpperCase() } })
            : await tx.taxCode.findUnique({ where: { code: c.toUpperCase() } });
  if (!row) throw new AppError("VALIDATION", `${column}: no ${what} with code "${c}"`, { fields: { [column]: "Unknown code" } });
  return row.id;
}

async function cashAccountByCode(tx: Tx, code: string) {
  const c = code.trim().toUpperCase();
  if (c === "CASH") return (await tx.account.findUniqueOrThrow({ where: { systemKey: "CASH" } })).id;
  const bank = await tx.bankAccount.findUnique({ where: { code: c } });
  if (bank) return bank.accountId;
  const box = await tx.pettyCashAccount.findUnique({ where: { code: c } });
  if (box) return box.accountId;
  throw new AppError("VALIDATION", `Account: "${code}" is not CASH, a bank account code (BANK-0001) or a petty cash box code (PETTY-01)`, { fields: { Account: "Unknown account" } });
}

const ENTITIES: Record<string, Entity> = {
  customers: {
    title: "Customers",
    permission: "customers.edit",
    columns: [
      { header: "Code", key: "code", help: "Leave empty to number automatically (CUS-0001…)", example: "" },
      { header: "Name", key: "name", required: true, help: "Customer or company name", example: "Al Noor Building Contracting" },
      { header: "Contact person", key: "contactPerson", help: "", example: "Site Manager" },
      { header: "Mobile", key: "mobile", help: "", example: "+971 50 000 0001" },
      { header: "Email", key: "email", help: "", example: "purchase@example.ae" },
      { header: "Address", key: "address", help: "", example: "Al Qusais, Dubai" },
      { header: "TRN", key: "trn", help: "15 digits, only if VAT-registered", example: "100345678900003" },
      { header: "Notes", key: "notes", help: "", example: "" },
    ],
    run: async (ctx, _tx, [r]) => {
      await saveCustomer(ctx, null, { ...r.v, active: "true" });
    },
  },
  suppliers: {
    title: "Suppliers",
    permission: "suppliers.edit",
    columns: [
      { header: "Code", key: "code", help: "Leave empty to number automatically (SUP-0001…)", example: "" },
      { header: "Name", key: "name", required: true, help: "", example: "Anatolia Stone Export" },
      { header: "Type", key: "supplierType", required: true, help: "LOCAL or IMPORT", example: "IMPORT" },
      { header: "Contact person", key: "contactPerson", help: "", example: "" },
      { header: "Mobile", key: "mobile", help: "", example: "" },
      { header: "Email", key: "email", help: "", example: "" },
      { header: "Address", key: "address", help: "", example: "Denizli, Türkiye" },
      { header: "TRN", key: "trn", help: "15 digits, only if VAT-registered", example: "" },
      { header: "Notes", key: "notes", help: "", example: "" },
    ],
    run: async (ctx, _tx, [r]) => {
      await saveSupplier(ctx, null, { ...r.v, supplierType: r.v.supplierType?.toUpperCase(), active: "true" });
    },
  },
  products: {
    title: "Products",
    permission: "products.edit",
    columns: [
      { header: "Item code", key: "itemCode", required: true, help: "Unique code", example: "CAL-20" },
      { header: "Name", key: "name", required: true, help: "", example: "Calacatta White Marble Slab 20mm" },
      { header: "Type", key: "type", required: true, help: "SLAB or TILE", example: "SLAB" },
      { header: "Category", key: "category", help: "", example: "Slabs" },
      { header: "Stone type", key: "stoneType", help: "", example: "Marble" },
      { header: "Finish", key: "finish", help: "", example: "Polished" },
      { header: "Size", key: "size", help: "Tiles, e.g. 60x120", example: "" },
      { header: "Thickness mm", key: "thicknessMm", help: "", example: "20" },
      { header: "Tax code", key: "taxCode", help: "Default tax code: SR, ZR, EX, OS (empty = SR)", example: "SR" },
    ],
    run: async (ctx, tx, [r]) => {
      const defaultTaxCodeId = await byCode(tx, "tax", r.v.taxCode || "SR", "Tax code");
      await saveProduct(ctx, null, { ...r.v, type: r.v.type?.toUpperCase(), defaultTaxCodeId, active: "true" });
    },
  },
  "opening-balances": {
    title: "Opening balances",
    permission: "opening.manage",
    columns: [
      { header: "Kind", key: "kind", required: true, help: "CUSTOMER_INVOICE, SUPPLIER_INVOICE, CUSTOMER_ADVANCE, SUPPLIER_ADVANCE or CASH_BANK", example: "CUSTOMER_INVOICE" },
      { header: "As at", key: "date", required: true, help: "Opening date (YYYY-MM-DD or a date cell)", example: "2026-12-31" },
      { header: "Party code", key: "party", help: "Customer or supplier code (invoices and advances)", example: "CUS-0001" },
      { header: "Account", key: "account", help: "CASH_BANK only: CASH, a bank code (BANK-0001) or a petty cash box (PETTY-01)", example: "" },
      { header: "Invoice no.", key: "refNo", help: "Invoices: the invoice number (unique per party)", example: "INV-2026-114" },
      { header: "Invoice date", key: "docDate", help: "", example: "2026-11-20" },
      { header: "Due date", key: "dueDate", help: "", example: "2027-01-20" },
      { header: "Amount", key: "amount", required: true, help: "Open amount in AED. CASH_BANK: balance; a bank may be negative (overdraft)", example: "15750.00" },
      { header: "Notes", key: "notes", help: "", example: "" },
    ],
    run: async (ctx, tx, [r]) => {
      const kind = r.v.kind?.toUpperCase();
      const base = { kind, date: r.v.date, amount: r.v.amount, notes: r.v.notes };
      if (kind === "CUSTOMER_INVOICE" || kind === "CUSTOMER_ADVANCE") {
        await recordOpeningItem(ctx, { ...base, customerId: await byCode(tx, "customer", r.v.party ?? "", "Party code"), refNo: r.v.refNo, docDate: r.v.docDate, dueDate: r.v.dueDate });
      } else if (kind === "SUPPLIER_INVOICE" || kind === "SUPPLIER_ADVANCE") {
        await recordOpeningItem(ctx, { ...base, supplierId: await byCode(tx, "supplier", r.v.party ?? "", "Party code"), refNo: r.v.refNo, docDate: r.v.docDate, dueDate: r.v.dueDate });
      } else if (kind === "CASH_BANK") {
        await recordOpeningItem(ctx, { ...base, accountId: await cashAccountByCode(tx, r.v.account ?? "") });
      } else {
        throw new AppError("VALIDATION", `Kind: "${r.v.kind ?? ""}" is not one of CUSTOMER_INVOICE, SUPPLIER_INVOICE, CUSTOMER_ADVANCE, SUPPLIER_ADVANCE, CASH_BANK`, { fields: { Kind: "Unknown kind" } });
      }
    },
  },
  "opening-stock": {
    title: "Opening stock",
    permission: "inventory.openingStock",
    columns: [
      { header: "Lot no.", key: "lotNo", required: true, help: "Rows with the same lot no. form one lot; their item, warehouse, date, cost and supplier must be the same", example: "LOT-CA-0310" },
      { header: "Item code", key: "itemCode", required: true, help: "Product item code", example: "CAL-20" },
      { header: "Warehouse", key: "warehouse", required: true, help: "Warehouse code", example: "ALSAJJA" },
      { header: "Received date", key: "receivedDate", required: true, help: "", example: "2026-12-31" },
      { header: "Cost per SQM", key: "costPerSqm", required: true, help: "Landed cost per SQM in AED", example: "455.00" },
      { header: "Supplier code", key: "supplier", help: "", example: "SUP-0002" },
      { header: "Block no.", key: "blockNo", help: "Slabs: required. Tiles: optional (empty = SQM held at lot level)", example: "CB-77" },
      { header: "Slab no.", key: "slabNo", help: "Slabs: unique slab number (empty = numbered automatically)", example: "CA77-01" },
      { header: "Length cm", key: "lengthCm", help: "Slabs only", example: "310" },
      { header: "Width cm", key: "widthCm", help: "Slabs only", example: "190" },
      { header: "Tile SQM", key: "tileSqm", help: "Tiles only: SQM in this block (or the whole lot when Block no. is empty)", example: "" },
      { header: "Shade", key: "shade", help: "", example: "White / grey vein" },
      { header: "Origin", key: "origin", help: "Block origin / quarry", example: "Carrara" },
    ],
    units: (rows) => {
      const errors: ImportError[] = [];
      const lots = new Map<string, Row[]>();
      for (const r of rows) {
        const k = (r.v.lotNo ?? "").trim().toUpperCase();
        if (!k) {
          errors.push({ row: r.n, column: "Lot no.", message: "Lot no. is required" });
          continue;
        }
        lots.set(k, [...(lots.get(k) ?? []), r]);
      }
      if (errors.length) return errors;
      return [...lots.values()].map((rs) => {
        const errs: ImportError[] = [];
        for (const key of ["itemCode", "warehouse", "receivedDate", "costPerSqm", "supplier"] as const) {
          const vals = new Set(rs.map((r) => (r.v[key] ?? "").trim()));
          if (vals.size > 1) errs.push({ row: rs[0].n, column: ENTITIES["opening-stock"].columns.find((c) => c.key === key)!.header, message: `Lot ${rs[0].v.lotNo}: rows disagree on this value (${[...vals].join(", ")})` });
        }
        return { rows: rs, errors: errs };
      });
    },
    run: async (ctx, tx, rows) => {
      const f = rows[0].v;
      const productId = await byCode(tx, "product", f.itemCode ?? "", "Item code");
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId! } });
      const blocks = new Map<string, { blockNo: string; origin?: string; sqm?: string; slabs: { slabNo?: string; lengthCm: string; widthCm: string; shade?: string }[] }>();
      let tileSqm: string | undefined;
      for (const r of rows) {
        const b = (r.v.blockNo ?? "").trim();
        if (product.type === "SLAB") {
          if (!b) throw new AppError("VALIDATION", `Row ${r.n}: Block no. is required for slabs`, { fields: { "Block no.": "Required" } });
          const blk = blocks.get(b) ?? { blockNo: b, origin: r.v.origin || undefined, slabs: [] };
          blk.slabs.push({ slabNo: r.v.slabNo || undefined, lengthCm: r.v.lengthCm ?? "", widthCm: r.v.widthCm ?? "", shade: r.v.shade || undefined });
          blocks.set(b, blk);
        } else if (b) {
          blocks.set(b, { blockNo: b, origin: r.v.origin || undefined, sqm: r.v.tileSqm, slabs: [] });
        } else {
          tileSqm = r.v.tileSqm;
        }
      }
      await createOpeningLot(ctx, {
        productId,
        warehouseId: await byCode(tx, "warehouse", f.warehouse ?? "", "Warehouse"),
        supplierId: await byCode(tx, "supplier", f.supplier ?? "", "Supplier code"),
        lotNo: f.lotNo,
        receivedDate: f.receivedDate,
        costPerSqm: f.costPerSqm,
        tileSqm,
        blocks: [...blocks.values()],
      });
    },
  },
};

export const IMPORT_ENTITIES = Object.entries(ENTITIES).map(([key, e]) => ({ key, title: e.title, permission: e.permission, columns: e.columns }));

// ───────────────────────────── Files ─────────────────────────────

const MAX_BYTES = 2_000_000;
const MAX_ROWS = 5_000;

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.trim();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue); // formula: cached value only
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if ("text" in v) return String(v.text).trim(); // hyperlink
  }
  return "";
}

/** Read the first sheet (xlsx) or the CSV into rows keyed by column key, matching headers by name. */
export async function readImportFile(entity: string, fileName: string, data: Buffer): Promise<{ rows: Row[]; errors: ImportError[] }> {
  const def = ENTITIES[entity];
  if (!def) throw new AppError("NOT_FOUND", `Unknown import: ${entity}`);
  if (data.length > MAX_BYTES) throw new AppError("VALIDATION", "The file is larger than 2 MB");
  const lower = fileName.toLowerCase();
  let table: string[][];
  if (lower.endsWith(".csv")) {
    table = parseCsv(data.toString("utf8"), true);
  } else if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(data as unknown as ArrayBuffer);
    } catch {
      throw new AppError("VALIDATION", "This is not a readable .xlsx file");
    }
    const ws = wb.worksheets.find((w) => w.name !== "Instructions") ?? wb.worksheets[0];
    if (!ws) throw new AppError("VALIDATION", "The workbook has no sheet");
    table = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = row.values as ExcelJS.CellValue[]; // 1-based
      table[n - 1] = vals.slice(1).map(cellText);
    });
    table = Array.from(table, (r) => r ?? []);
  } else {
    throw new AppError("VALIDATION", "Upload the template as .xlsx (or .csv); other formats, including .xlsm, are not accepted");
  }
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const idx = new Map(def.columns.map((c) => [c.key, header.indexOf(c.header.toLowerCase())]));
  const missing = def.columns.filter((c) => c.required && idx.get(c.key)! < 0);
  if (missing.length) throw new AppError("VALIDATION", `The first row must hold the template headers; missing: ${missing.map((c) => c.header).join(", ")}`);
  const rows: Row[] = [];
  const errors: ImportError[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (cells.every((c) => !c)) continue;
    const v: Record<string, string> = {};
    for (const c of def.columns) {
      const j = idx.get(c.key)!;
      v[c.key] = j >= 0 ? (cells[j] ?? "").trim() : "";
    }
    const n = i + 1;
    for (const c of def.columns) if (c.required && !v[c.key]) errors.push({ row: n, column: c.header, message: `${c.header} is required` });
    rows.push({ n, v });
  }
  if (rows.length === 0) throw new AppError("VALIDATION", "The file has no data rows under the headers");
  if (rows.length > MAX_ROWS) throw new AppError("VALIDATION", `Import at most ${MAX_ROWS.toLocaleString()} rows at a time`);
  return { rows, errors };
}

/** The template: a data sheet with the headers, and an Instructions sheet with what each column means and an example. */
export async function importTemplate(entity: string): Promise<{ fileName: string; data: Buffer }> {
  const def = ENTITIES[entity];
  if (!def) throw new AppError("NOT_FOUND", `Unknown import: ${entity}`);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(def.title.slice(0, 31));
  const head = ws.addRow(def.columns.map((c) => c.header));
  head.font = { bold: true };
  def.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(14, c.header.length + 4);
    ws.getColumn(i + 1).numFmt = "@"; // text, so codes and dates keep their form
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const ins = wb.addWorksheet("Instructions");
  ins.addRow([`${def.title} import — fill the "${def.title.slice(0, 31)}" sheet, one row per record. Do not rename the headers.`]).font = { bold: true };
  ins.addRow(["Dates as YYYY-MM-DD (or real date cells). Amounts without thousands separators. Upload, press Check, fix any errors, then Import."]);
  ins.addRow([]);
  const h = ins.addRow(["Column", "Required", "What to enter", "Example"]);
  h.font = { bold: true };
  for (const c of def.columns) ins.addRow([c.header, c.required ? "Yes" : "", c.help, c.example]);
  ins.getColumn(1).width = 18;
  ins.getColumn(3).width = 80;
  ins.getColumn(4).width = 28;
  return { fileName: `import-template-${entity}`, data: Buffer.from(await wb.xlsx.writeBuffer()) };
}

// ───────────────────────────── Run ─────────────────────────────

class Rollback extends Error {}

function toErrors(n: number, e: unknown, def: Entity): ImportError[] {
  if (e instanceof AppError) {
    const fields = (e.details as { fields?: Record<string, string> } | undefined)?.fields;
    const key = fields ? Object.keys(fields)[0] : undefined;
    // Services name their fields (e.g. "trn"); show the template header ("TRN").
    const column = key ? (def.columns.find((c) => c.key === key || c.header === key)?.header ?? key) : undefined;
    return [{ row: n, column, message: e.message.replace(/^Row \d+: /, "") }];
  }
  return [{ row: n, message: "Could not be saved (unexpected error)" }];
}

/** Check (dryRun) or import a file. Import writes only if every row passes. */
export async function runImport(ctx: Ctx, entity: string, fileName: string, data: Buffer, dryRun: boolean): Promise<ImportResult> {
  const def = ENTITIES[entity];
  if (!def) throw new AppError("NOT_FOUND", `Unknown import: ${entity}`);
  assertCan(ctx, def.permission);
  const { rows, errors: shape } = await readImportFile(entity, fileName, data);
  let units: { rows: Row[]; errors: ImportError[] }[] = rows.map((r) => ({ rows: [r], errors: [] }));
  const errors: ImportError[] = [...shape];
  if (def.units) {
    const u = def.units(rows);
    if (u.length && "row" in u[0]) errors.push(...(u as ImportError[]));
    else units = u as { rows: Row[]; errors: ImportError[] }[];
  }
  const badRows = new Set(errors.map((e) => e.row));
  let ok = 0;
  let committed = false;
  try {
    await inOuterTx(async (tx) => {
      for (const unit of units) {
        if (unit.errors.length) {
          errors.push(...unit.errors);
          continue;
        }
        if (unit.rows.some((r) => badRows.has(r.n))) continue;
        // One savepoint name, reused: a failed row is undone without losing the rows before it.
        await tx.$executeRaw`SAVEPOINT import_row`;
        try {
          await def.run(ctx, tx, unit.rows);
          await tx.$executeRaw`RELEASE SAVEPOINT import_row`;
          ok += unit.rows.length;
        } catch (e) {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT import_row`;
          errors.push(...toErrors(unit.rows[0].n, e, def));
        }
      }
      if (dryRun || errors.length) throw new Rollback();
      await audit(tx, ctx, { action: "import", entity: "ImportBatch", entityId: entity, after: { entity, fileName, rows: rows.length } });
      committed = true;
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  errors.sort((a, b) => a.row - b.row);
  const result: ImportResult = { entity, mode: dryRun ? "DRY_RUN" : "COMMIT", rowsTotal: rows.length, rowsOk: committed || dryRun ? ok : 0, errors, committed };
  await prisma.importBatch.create({
    data: { entity, fileName: fileName.slice(0, 200), mode: result.mode, rowsTotal: rows.length, rowsOk: result.rowsOk, rowsFailed: rows.length - ok, errors: errors.slice(0, 500), committed, createdById: ctx.userId },
  });
  return result;
}

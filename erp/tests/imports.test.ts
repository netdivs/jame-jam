// T11-02 imports (TD-037): templates, dry run writes nothing, import is all-or-nothing, per-row errors (also DB-level
// ones, through savepoints), opening stock grouped by lot, permissions, batch records.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { AppError, prisma } from "../src/server/core";
import { importTemplate, runImport } from "../src/server/imports";
import { inventoryReconciliation } from "../src/server/inventory/queries";
import { ctxFor, uid } from "./helpers";

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n"));

async function xlsxFrom(entity: string, rows: (string | number | Date)[][]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await importTemplate(entity)).data as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("imports (T11-02)", () => {
  it("customers: check writes nothing; import is all-or-nothing; duplicates caught per row", async () => {
    const owner = await ctxFor("owner");
    const t = uid();
    const head = ["Code", "Name", "Contact person", "Mobile", "Email", "Address", "TRN", "Notes"];
    const bad = csv([head, [`I-${t}-1`, `Imp A ${t}`, "", "", "", "", "", ""], ["", "", "", "", "", "", "", ""], ["", `Imp B ${t}`, "", "", "", "", "12345", ""], [`I-${t}-1`, `Imp C ${t}`, "", "", "", "", "", ""]]);
    const before = await prisma.customer.count();
    const check = await runImport(owner, "customers", "c.csv", bad, true);
    expect(check.rowsTotal).toBe(3); // the empty row is skipped
    expect(check.rowsOk).toBe(1);
    expect(check.errors.map((e) => [e.row, e.column])).toEqual([
      [4, "TRN"],
      [5, undefined],
    ]);
    expect(check.errors[1].message).toMatch(/already exists/); // a database unique error, isolated by the savepoint
    expect(await prisma.customer.count()).toBe(before);

    const tryIt = await runImport(owner, "customers", "c.csv", bad, false);
    expect(tryIt.committed).toBe(false);
    expect(await prisma.customer.count()).toBe(before);

    const good = csv([head, [`I-${t}-1`, `Imp A ${t}`, "", "", "", "", "", ""], ["", `Imp B ${t}`, "", "", "", "", "100111222300003", ""]]);
    const done = await runImport(owner, "customers", "c.csv", good, false);
    expect(done).toMatchObject({ committed: true, rowsOk: 2, errors: [] });
    expect(await prisma.customer.count()).toBe(before + 2);
    expect((await prisma.customer.findFirstOrThrow({ where: { name: `Imp B ${t}` } })).code).toMatch(/^CUS-\d{4}$/);
    const batches = await prisma.importBatch.findMany({ where: { entity: "customers", fileName: "c.csv" }, orderBy: { createdAt: "asc" } });
    expect(batches.map((b) => [b.mode, b.committed])).toEqual([["DRY_RUN", false], ["COMMIT", false], ["COMMIT", true]]);
  });

  it("products from the xlsx template; header check; permissions; wrong file types refused", async () => {
    const owner = await ctxFor("owner");
    const t = uid();
    const file = await xlsxFrom("products", [[`IMP-${t}`, "Imported slab", "slab", "Slabs", "Marble", "Polished", "", 20, "SR"], [`IMT-${t}`, "Imported tile", "BRICK", "", "", "", "", "", ""]]);
    const r = await runImport(owner, "products", "p.xlsx", file, true);
    expect(r.rowsOk).toBe(1);
    expect(r.errors).toEqual([{ row: 3, column: "Type", message: expect.stringMatching(/tile or slab/) }]);
    await expect(runImport(await ctxFor("sales"), "products", "p.xlsx", file, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(runImport(owner, "products", "p.xlsm", file, true)).rejects.toThrow(/xlsm/);
    await expect(runImport(owner, "products", "p.csv", Buffer.from("Wrong,Headers\n1,2"), true)).rejects.toBeInstanceOf(AppError);
  });

  it("opening balances: codes resolve to parties and accounts; unknown codes are reported by column", async () => {
    const acct = await ctxFor("accountant");
    const t = uid();
    const cust = await prisma.customer.create({ data: { code: `OBC-${t}`, name: `OB import ${t}` } });
    const file = csv([
      ["Kind", "As at", "Party code", "Account", "Invoice no.", "Invoice date", "Due date", "Amount", "Notes"],
      ["CUSTOMER_INVOICE", "2026-10-31", cust.code, "", `INV-${t}`, "2026-10-01", "2026-11-30", "1500.50", ""],
      ["CASH_BANK", "2026-10-31", "", "BANK-0001", "", "", "", "2500", ""],
      ["SUPPLIER_INVOICE", "2026-10-31", "NOPE-1", "", "X1", "", "", "10", ""],
    ]);
    const check = await runImport(acct, "opening-balances", "ob.csv", file, true);
    expect(check.errors).toEqual([{ row: 4, column: "Party code", message: expect.stringMatching(/no supplier with code "NOPE-1"/) }]);
    const ok = csv([
      ["Kind", "As at", "Party code", "Account", "Invoice no.", "Invoice date", "Due date", "Amount", "Notes"],
      ["CUSTOMER_INVOICE", "2026-10-31", cust.code, "", `INV-${t}`, "2026-10-01", "2026-11-30", "1500.50", ""],
      ["CASH_BANK", "2026-10-31", "", "BANK-0001", "", "", "", "2500", ""],
    ]);
    expect((await runImport(acct, "opening-balances", "ob.csv", ok, false)).committed).toBe(true);
    const item = await prisma.openingItem.findFirstOrThrow({ where: { customerId: cust.id } });
    expect(item.amount.toString()).toBe("1500.5");
    expect(item.refNo).toBe(`INV-${t}`);
  });

  it("opening stock: rows grouped into lots with blocks and slabs; disagreeing lot rows refused; stock = GL", async () => {
    const owner = await ctxFor("owner");
    const t = uid();
    const slab = await prisma.product.create({ data: { itemCode: `OS-${t}`, name: `Import slab ${t}`, type: "SLAB" } });
    const tile = await prisma.product.create({ data: { itemCode: `OT-${t}`, name: `Import tile ${t}`, type: "TILE" } });
    const H = ["Lot no.", "Item code", "Warehouse", "Received date", "Cost per SQM", "Supplier code", "Block no.", "Slab no.", "Length cm", "Width cm", "Tile SQM", "Shade", "Origin"];
    const rows = [
      [`L1-${t}`, slab.itemCode, "ALSAJJA", "2026-10-31", "200", "", "B1", `S1-${t}`, "300", "180", "", "Cream", "Oman"],
      [`L1-${t}`, slab.itemCode, "ALSAJJA", "2026-10-31", "200", "", "B1", `S2-${t}`, "290", "175", "", "Cream", "Oman"],
      [`L1-${t}`, slab.itemCode, "ALSAJJA", "2026-10-31", "200", "", "B2", `S3-${t}`, "280", "170", "", "", ""],
      [`L2-${t}`, tile.itemCode, "ALSAJJA", "2026-10-31", "55", "", "", "", "", "", "120.5", "", ""],
    ];
    const disagree = csv([H, ...rows, [`L2-${t}`, tile.itemCode, "ALSAJJA", "2026-10-31", "56", "", "", "", "", "", "1", "", ""]]);
    const c1 = await runImport(owner, "opening-stock", "s.csv", disagree, true);
    expect(c1.errors[0].message).toMatch(/disagree/);
    const lots0 = await prisma.lot.count();
    const r = await runImport(owner, "opening-stock", "s.csv", csv([H, ...rows]), false);
    expect(r).toMatchObject({ committed: true, rowsOk: 4 });
    expect(await prisma.lot.count()).toBe(lots0 + 2);
    const l1 = await prisma.lot.findFirstOrThrow({ where: { lotNo: `L1-${t}` }, include: { blocks: true, slabs: true } });
    expect(l1.blocks).toHaveLength(2);
    expect(l1.slabs.map((s) => s.slabNo).sort()).toEqual([`S1-${t}`, `S2-${t}`, `S3-${t}`]);
    expect((await inventoryReconciliation()).difference.toString()).toBe("0");
  });
});

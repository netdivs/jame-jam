// TX-01 / TX-02 / T11-05: printable PDFs from stored documents, Excel exports equal to the reports, view permissions.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { AppError, prisma, today } from "../src/server/core";
import { buildPrintDoc, companyHeader } from "../src/server/print/documents";
import { renderPdf } from "../src/server/print/pdf";
import { buildExport } from "../src/server/print/exports";
import { renderXlsx } from "../src/server/print/xlsx";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { approvePurchaseOrder, savePurchaseOrder, submitPurchaseOrder } from "../src/server/purchase/orders";
import { trialBalance } from "../src/server/accounting/reports";
import { ctxFor, makeProduct, uid } from "./helpers";

const NOW = today().toISOString().slice(0, 10);

async function expectError(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
}

describe("printing and exports (TX-01, TX-02)", () => {
  it("renders PDFs of a PO, a receipt and a statement from stored values; respects view permissions", async () => {
    const acct = await ctxFor("accountant");
    const sup = await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `Print supplier ${uid()}`, address: "Sharjah", trn: "100111222300003" } });
    const product = await makeProduct("SLAB");
    const sr = await prisma.taxCode.findUniqueOrThrow({ where: { code: "SR" } });
    const po = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: NOW, terms: "50% advance", lines: [{ productId: product.id, sqm: "12.5", unitPrice: "100", taxCodeId: sr.id }] });
    await submitPurchaseOrder(acct, po.id);
    await approvePurchaseOrder(await ctxFor("owner"), po.id);

    const doc = await buildPrintDoc(acct, "po", po.id);
    expect(doc.number).toBe(po.number);
    expect(doc.party?.lines).toEqual(expect.arrayContaining([sup.name, "TRN 100111222300003"]));
    expect(doc.rows[0]).toMatchObject({ sqm: "12.50", net: "1,250.00" }); // SQM as on screen (2 dp)
    expect(doc.totals?.at(-1)).toEqual(["Total payable", "AED 1,312.50"]);
    const pdf = await renderPdf(doc, await companyHeader());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);

    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Print customer ${uid()}` } });
    const rc = await recordCustomerReceipt(acct, { customerId: cust.id, date: NOW, amount: "420", mode: "CASH" });
    const r = await buildPrintDoc(acct, "receipt", rc.id);
    expect(r.title).toBe("Cash Receipt");
    expect(r.totals).toEqual([["Total received", "AED 420.00"]]);
    expect((await renderPdf(r, await companyHeader())).subarray(0, 5).toString()).toBe("%PDF-");
    await expectError(buildPrintDoc(await ctxFor("storekeeper"), "receipt", rc.id), "FORBIDDEN");

    const st = await buildPrintDoc(acct, "statement", cust.id, new URLSearchParams({ party: "customer", from: NOW, to: NOW }));
    expect(st.rows.at(-1)).toMatchObject({ cr: "420.00", bal: "-420.00" });
    await expectError(buildPrintDoc(acct, "nope", "x"), "NOT_FOUND");
    await expectError(buildPrintDoc(acct, "po", "missing"), "NOT_FOUND");
  });

  it("exports the trial balance to Excel with numeric cells equal to the report", async () => {
    const acct = await ctxFor("accountant");
    const { fileName, sheets } = await buildExport(acct, "trial-balance", new URLSearchParams({ asOf: NOW }));
    expect(fileName).toBe(`trial-balance-${NOW}`);
    const buf = await renderXlsx(sheets, { company: "Jame Jam", user: "Test" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const last = ws.getRow(ws.rowCount);
    const tb = await trialBalance(acct, today());
    expect(typeof last.getCell(3).value).toBe("number");
    expect(Number(last.getCell(3).value).toFixed(2)).toBe(tb.totalDebit.toFixed(2));
    expect(Number(last.getCell(4).value).toFixed(2)).toBe(tb.totalCredit.toFixed(2));
    await expectError(buildExport(await ctxFor("sales"), "trial-balance", new URLSearchParams()), "FORBIDDEN");
    await expectError(buildExport(acct, "nope", new URLSearchParams()), "NOT_FOUND");
  });
});

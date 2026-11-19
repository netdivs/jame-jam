// T9-03: spec §4 reports — purchase, sales, profit per invoice, bank, expense, lot stock / valuation, supporting.
import { afterEach, describe, expect, it } from "vitest";
import { D, prisma, toDateOnly, today } from "../src/server/core";
import { createOpeningLot } from "../src/server/inventory/lots";
import { approvePurchaseOrder, savePurchaseOrder, submitPurchaseOrder } from "../src/server/purchase/orders";
import { createGoodsReceipt } from "../src/server/purchase/receipts";
import { postSupplierInvoice } from "../src/server/purchase/invoices";
import { recordSupplierPayment } from "../src/server/purchase/payments";
import { saveSalesOrder } from "../src/server/sales/orders";
import { createTaxInvoice } from "../src/server/sales/invoices";
import { createDeliveryNote } from "../src/server/sales/delivery";
import { createAdjustmentCreditNote } from "../src/server/sales/credit-notes";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { bankReport, expenseReport, lotStock, profitPerInvoice, purchaseReport, reservationsBySo, salesReport, unallocatedAdvances } from "../src/server/reports";
import { REPORTS, reportByKey } from "../src/server/reports/catalog";
import { buildExport } from "../src/server/print/exports";
import { saveSystemSettings } from "../src/server/settings";
import { ctxFor, makeProduct, uid, warehouseId } from "./helpers";

const P = { from: toDateOnly("2026-04-01"), to: toDateOnly("2026-04-30") };

afterEach(async () => {
  await prisma.systemSetting.deleteMany();
});

describe("reports (T9-03)", () => {
  it("purchase, sales, profit, bank and expense figures from a known scenario", async () => {
    const owner = await ctxFor("owner");
    await saveSystemSettings(owner, { "features.salesInvoicing": "true", "purchase.receiveBeforePayment": "ALWAYS", "purchase.bankChargesTreatment": "EXPENSE" });
    const acct = await ctxFor("accountant");
    const sales = await ctxFor("sales");

    // Purchase: 10 SQM × 30 SR from a new supplier, paid by bank with AED 12.50 charges.
    const sup = await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `Report supplier ${uid()}`, supplierType: "LOCAL" } });
    const p1 = await makeProduct("TILE");
    const sr = (await prisma.taxCode.findUniqueOrThrow({ where: { code: "SR" } })).id;
    const po = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: "2026-04-02", lines: [{ productId: p1.id, sqm: "10", unitPrice: "30", taxCodeId: sr }] });
    await submitPurchaseOrder(acct, po.id);
    await approvePurchaseOrder(owner, po.id);
    const poItem = (await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } })).id;
    await createGoodsReceipt(owner, { purchaseOrderId: po.id, warehouseId: await warehouseId(), date: "2026-04-03", lines: [{ poItemId: poItem, tileSqm: "10" }] });
    await postSupplierInvoice(acct, { purchaseOrderId: po.id, supplierInvoiceNo: `R-${uid()}`, date: "2026-04-04", lines: [{ poItemId: poItem, sqm: "10", unitPrice: "30", taxCodeId: sr }] });
    const bank = await prisma.bankAccount.findFirstOrThrow({ where: { active: true }, orderBy: { name: "asc" } });
    await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: "2026-04-05", amount: "315", mode: "BANK", bankAccountId: bank.id, bankCharges: "12.50" });

    const pr = await purchaseReport(acct, { ...P, supplierId: sup.id });
    expect(pr.rows).toHaveLength(1);
    expect([pr.totals.net.toFixed(2), pr.totals.vat.toFixed(2)]).toEqual(["300.00", "15.00"]);

    // Sale: 10 SQM × 105 incl. (cost 40), paid, delivered; adjustment credit 21 incl.
    const p2 = await makeProduct("TILE");
    const lot = await createOpeningLot(owner, { productId: p2.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: "15" });
    const bucket = await prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Report customer ${uid()}` } });
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: "2026-04-10", priceMode: "INCLUSIVE", lines: [{ balanceId: bucket.id, sqm: "10", unitPrice: "105" }] });
    const ti = await createTaxInvoice(sales, { salesOrderId: so.id, date: "2026-04-10" });
    await recordCustomerReceipt(sales, { taxInvoiceId: ti.id, date: "2026-04-11", amount: "1050", mode: "BANK", bankAccountId: bank.id });
    await createDeliveryNote(owner, { taxInvoiceId: ti.id, date: "2026-04-12" });
    await createAdjustmentCreditNote(owner, { taxInvoiceId: ti.id, date: "2026-04-15", reason: "Price", lines: [{ taxInvoiceItemId: ti.items[0].id, amount: "21" }] });

    const sr2 = await salesReport(acct, { ...P, customerId: cust.id });
    expect(sr2.rows.map((r) => r.kind)).toEqual(["Invoice", "Credit note"]);
    expect([sr2.totals.net.toFixed(2), sr2.totals.vat.toFixed(2), sr2.totals.gross.toFixed(2)]).toEqual(["980.00", "49.00", "1029.00"]);

    const pf = await profitPerInvoice(owner, { ...P, customerId: cust.id });
    expect(pf.rows[0]).toMatchObject({ number: ti.number, estimated: false });
    expect([pf.rows[0].netSales.toFixed(2), pf.rows[0].cost.toFixed(2), pf.rows[0].profit.toFixed(2), pf.rows[0].margin!.toString()]).toEqual(["980.00", "400.00", "580.00", "59.2"]);
    await expect(profitPerInvoice(sales, P)).rejects.toMatchObject({ code: "FORBIDDEN" }); // no cost permission

    const br = (await bankReport(acct, { ...P, bankAccountId: bank.id }))[0];
    const mine = br.rows.filter((r) => r.memo.includes(sup.name) || r.memo.includes(cust.name));
    expect(mine.reduce((a, r) => a.plus(r.in).minus(r.out), D(0)).toFixed(2)).toBe("722.50"); // 1050 − 315 − 12.50
    expect(br.closing.minus(br.opening).toFixed(2)).toBe(br.in.minus(br.out).toFixed(2));

    const ex = await expenseReport(acct, P);
    expect(ex.accounts.find((a) => a.name === "Bank Charges")?.rows.some((r) => D(r.amount).eq(12.5))).toBe(true);
    expect(ex.accounts.some((a) => a.name.includes("Cost of"))).toBe(false);
  });

  it("lot stock ties to the Inventory account; supporting reports; catalogue and generic exports", async () => {
    const owner = await ctxFor("owner");
    const ls = await lotStock(owner, { asOf: today() });
    expect(ls.ties).toBe(true);
    expect(ls.totals.value!.toFixed(2)).toBe(ls.gl!.toFixed(2));
    const store = await ctxFor("storekeeper");
    expect((await lotStock(store, { asOf: today() })).rows[0].value).toBeNull(); // no cost permission → no values
    expect(Array.isArray(await reservationsBySo(owner))).toBe(true);
    const adv = await unallocatedAdvances(owner);
    expect(adv.rows.every((r) => r.balance.gt(0))).toBe(true);

    expect(REPORTS.filter((r) => r.no).map((r) => r.no)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    for (const key of ["purchases", "sales", "profit", "expenses", "bank", "lots", "reservations", "advances"]) {
      expect(reportByKey(key), key).toBeTruthy();
      const out = await buildExport(owner, key, new URLSearchParams({ from: "2026-04-01", to: "2026-04-30" }));
      expect(out.sheets.length, key).toBeGreaterThan(0);
    }
  });
});

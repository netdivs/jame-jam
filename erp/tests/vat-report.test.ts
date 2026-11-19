// T9-01 VAT return (FTA VAT 201 boxes), registers and reconciliation to the VAT GL (R7), on a quiet period.
import { afterEach, describe, expect, it } from "vitest";
import { D, prisma, toDateOnly } from "../src/server/core";
import { createOpeningLot } from "../src/server/inventory/lots";
import { approvePurchaseOrder, createShipment, savePurchaseOrder, setShipmentStatus, submitPurchaseOrder } from "../src/server/purchase/orders";
import { createGoodsReceipt } from "../src/server/purchase/receipts";
import { postSupplierInvoice } from "../src/server/purchase/invoices";
import { recordLandedCostExpense } from "../src/server/purchase/landed-cost";
import { saveSalesOrder } from "../src/server/sales/orders";
import { createTaxInvoice } from "../src/server/sales/invoices";
import { createAdjustmentCreditNote } from "../src/server/sales/credit-notes";
import { vatReturn } from "../src/server/accounting/vat-report";
import { buildExport } from "../src/server/print/exports";
import { saveSystemSettings } from "../src/server/settings";
import { ctxFor, makeProduct, uid, warehouseId } from "./helpers";

const FROM = toDateOnly("2026-02-01");
const TO = toDateOnly("2026-02-28");
const tax = (code: string) => prisma.taxCode.findUniqueOrThrow({ where: { code } });

async function receivedPo(type: "LOCAL" | "IMPORT", price: string) {
  const owner = await ctxFor("owner");
  const acct = await ctxFor("accountant");
  const sup = await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `VAT supplier ${uid()}`, supplierType: type } });
  const product = await makeProduct("TILE");
  const po = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: "2026-02-02", lines: [{ productId: product.id, sqm: "10", unitPrice: price, taxCodeId: (await tax(type === "IMPORT" ? "RC" : "SR")).id }] });
  await submitPurchaseOrder(acct, po.id);
  await approvePurchaseOrder(owner, po.id);
  const item = (await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po.id } })).id;
  let shipmentId: string | undefined;
  if (type === "IMPORT") {
    const sh = await createShipment(owner, po.id, { reference: "BL-VAT" });
    for (const s of ["IN_TRANSIT", "AT_PORT", "COLLECTED"] as const) await setShipmentStatus(owner, sh.id, s);
    shipmentId = sh.id;
  }
  await createGoodsReceipt(owner, { purchaseOrderId: po.id, shipmentId, warehouseId: await warehouseId(), date: "2026-02-03", lines: [{ poItemId: item, tileSqm: "10" }] });
  return { acct, sup, po, item };
}

afterEach(async () => {
  await prisma.systemSetting.deleteMany();
});

describe("VAT return (T9-01)", () => {
  it("boxes from the period's documents; registers; ties to the VAT accounts; Excel pack", async () => {
    const owner = await ctxFor("owner");
    await saveSystemSettings(owner, { "features.salesInvoicing": "true", "purchase.receiveBeforePayment": "ALWAYS" });
    const before = await vatReturn(owner, FROM, TO);

    // Sale: 10 SQM × 105 incl. = 1,000 + 50 VAT; credit note 21 incl. = 20 + 1 VAT.
    const sales = await ctxFor("sales");
    const p = await makeProduct("TILE");
    const lot = await createOpeningLot(owner, { productId: p.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: "20" });
    const bucket = await prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `VAT customer ${uid()}`, trn: "100000000000003", emirate: "SHARJAH" } });
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: "2026-02-10", priceMode: "INCLUSIVE", lines: [{ balanceId: bucket.id, sqm: "10", unitPrice: "105" }] });
    const ti = await createTaxInvoice(sales, { salesOrderId: so.id, date: "2026-02-10" });
    await createAdjustmentCreditNote(owner, { taxInvoiceId: ti.id, date: "2026-02-12", reason: "Price correction", lines: [{ taxInvoiceItemId: ti.items[0].id, amount: "21" }] });

    // Local purchase SR 10 × 30 = 300 + 15; import RC 10 × 50 = 500 (+25 RC); freight from abroad RC 200 (+10).
    const local = await receivedPo("LOCAL", "30");
    await postSupplierInvoice(local.acct, { purchaseOrderId: local.po.id, supplierInvoiceNo: `L-${uid()}`, date: "2026-02-05", lines: [{ poItemId: local.item, sqm: "10", unitPrice: "30", taxCodeId: (await tax("SR")).id }] });
    const imp = await receivedPo("IMPORT", "50");
    await postSupplierInvoice(imp.acct, { purchaseOrderId: imp.po.id, supplierInvoiceNo: `I-${uid()}`, date: "2026-02-06", lines: [{ poItemId: imp.item, sqm: "10", unitPrice: "50", taxCodeId: (await tax("RC")).id }] });
    const forwarder = await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `Forwarder ${uid()}`, supplierType: "IMPORT" } });
    await recordLandedCostExpense(imp.acct, { purchaseOrderId: imp.po.id, categoryId: (await prisma.landedCostCategory.findUniqueOrThrow({ where: { name: "Freight" } })).id, supplierId: forwarder.id, billNo: `F-${uid()}`, date: "2026-02-07", amount: "200", taxCodeId: (await tax("RC")).id });

    const r = await vatReturn(owner, FROM, TO);
    const d = (a: { toString(): string }, b: { toString(): string }) => D(a.toString()).minus(D(b.toString())).toFixed(2);
    expect(d(r.boxes.b1.net, before.boxes.b1.net)).toBe("1000.00");
    expect(d(r.boxes.b1.vat, before.boxes.b1.vat)).toBe("50.00");
    expect(d(r.boxes.b1.adjustment!, before.boxes.b1.adjustment!)).toBe("-1.00");
    expect(d(r.boxes.b3.vat, before.boxes.b3.vat)).toBe("10.00");
    expect(d(r.boxes.b6.net, before.boxes.b6.net)).toBe("500.00");
    expect(d(r.boxes.b6.vat, before.boxes.b6.vat)).toBe("25.00");
    expect(d(r.boxes.b9.vat, before.boxes.b9.vat)).toBe("15.00");
    expect(d(r.boxes.b10.vat, before.boxes.b10.vat)).toBe("35.00");
    expect(d(r.boxes.b14, before.boxes.b14)).toBe("34.00"); // (50 − 1 + 10 + 25) − (15 + 35)
    expect(r.output.find((x) => x.number === ti.number)).toMatchObject({ code: "SR", trn: "100000000000003" });
    expect(r.reconciliation.ok).toBe(true);
    // Box 1 by emirate: the Sharjah customer's invoice and credit note land in 1c; the parts add up to box 1.
    const sh = (x: typeof r) => x.boxes.b1ByEmirate.find((e) => e.emirate === "SHARJAH")!;
    expect(sh(r).box).toBe("1c");
    expect([d(sh(r).net, sh(before).net), d(sh(r).vat, sh(before).vat), d(sh(r).adjustment, sh(before).adjustment)]).toEqual(["1000.00", "50.00", "-1.00"]);
    expect(r.boxes.b1ByEmirate.reduce((a, e) => a.plus(e.vat), D(0)).toFixed(2)).toBe(r.boxes.b1.vat.toFixed(2));
    expect((await prisma.taxInvoice.findUniqueOrThrow({ where: { id: ti.id } })).supplyEmirate).toBe("SHARJAH");

    const pack = await buildExport(owner, "vat-pack", new URLSearchParams({ from: "2026-02-01", to: "2026-02-28" }));
    expect(pack.sheets.map((s) => s.name)).toEqual(["VAT return", "Output VAT", "Input VAT", "Trial balance"]);
    await expect(vatReturn(await ctxFor("sales"), FROM, TO)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

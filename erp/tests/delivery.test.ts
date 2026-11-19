// T6-03 delivery notes (BD-15, acceptance R10): only for a fully paid tax invoice; partial dispatch; stock and COGS.
import { afterEach, describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { accountBalance } from "../src/server/accounting/gl";
import { createOpeningLot } from "../src/server/inventory/lots";
import { inventoryReconciliation } from "../src/server/inventory/queries";
import { saveSalesOrder } from "../src/server/sales/orders";
import { applyAdvanceToInvoice, createTaxInvoice } from "../src/server/sales/invoices";
import { createDeliveryNote } from "../src/server/sales/delivery";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { recordReceivedCheque } from "../src/server/receipts/cheques";
import { saveSystemSettings } from "../src/server/settings";
import { buildPrintDoc } from "../src/server/print/documents";
import { ctxFor, makeProduct, slabLot, uid, warehouseId } from "./helpers";

const NOW = today().toISOString().slice(0, 10);
const plus = (days: number) => new Date(today().getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

/** A tile SO of 10 SQM at AED 100 incl. (cost 40/SQM) and its tax invoice (AED 1,000). */
async function invoicedTiles() {
  await saveSystemSettings(await ctxFor("owner"), { "features.salesInvoicing": "true" });
  const owner = await ctxFor("owner");
  const sales = await ctxFor("sales");
  const product = await makeProduct("TILE");
  const lot = await createOpeningLot(owner, { productId: product.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: "50" });
  const bucket = await prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
  const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `DN customer ${uid()}` } });
  const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, priceMode: "INCLUSIVE", lines: [{ balanceId: bucket.id, sqm: "10", unitPrice: "100" }] });
  const ti = await createTaxInvoice(sales, { salesOrderId: so.id, date: NOW });
  return { owner, sales, cust, so, ti, bucket };
}

afterEach(async () => {
  await prisma.systemSetting.deleteMany();
});

describe("delivery notes (T6-03, R10)", () => {
  it("blocked while unpaid or partly paid — no override, uncleared cheques do not count", async () => {
    const { owner, sales, cust, ti } = await invoicedTiles();
    const store = await ctxFor("storekeeper");
    await expectError(createDeliveryNote(store, { taxInvoiceId: ti.id, date: NOW }), "VALIDATION", /AED 1000.00 is still unpaid/);
    await recordCustomerReceipt(sales, { taxInvoiceId: ti.id, date: NOW, amount: "999.99", mode: "CASH" });
    await expectError(createDeliveryNote(owner, { taxInvoiceId: ti.id, date: NOW }), "VALIDATION", /AED 0.01 is still unpaid/);
    // A cheque for the rest that has not cleared cannot pay the invoice.
    await recordReceivedCheque(sales, { customerId: cust.id, chequeNo: `CHQ-${uid()}`, bankName: "ENBD", amount: "0.01", issueDate: NOW, dueDate: plus(10) });
    await expectError(applyAdvanceToInvoice(sales, ti.id, { date: NOW, amount: "0.01" }), "VALIDATION", /0.00 of free advance/);
    await expectError(createDeliveryNote(owner, { taxInvoiceId: ti.id, date: NOW }), "VALIDATION", /still unpaid/);
    await expectError(createDeliveryNote(sales, { taxInvoiceId: ti.id, date: NOW }), "FORBIDDEN");
  });

  it("paid in full: partial then final dispatch; stock out, reservation consumed, COGS at cost, SO delivered", async () => {
    const { sales, so, ti, bucket } = await invoicedTiles();
    const store = await ctxFor("storekeeper");
    await recordCustomerReceipt(sales, { taxInvoiceId: ti.id, date: NOW, amount: "1000", mode: "CASH" });
    const [cogs0, inv0] = await Promise.all([accountBalance(prisma, "COGS"), accountBalance(prisma, "INVENTORY")]);

    const line = ti.items[0];
    await expectError(createDeliveryNote(store, { taxInvoiceId: ti.id, date: NOW, lines: [{ taxInvoiceItemId: line.id, sqm: "10.0001" }] }), "VALIDATION", /only 10 SQM/);
    const dn1 = await createDeliveryNote(store, { taxInvoiceId: ti.id, date: NOW, vehicleNo: "D 12345", receivedBy: "Site foreman", lines: [{ taxInvoiceItemId: line.id, sqm: "4" }] });
    expect(dn1.number).toMatch(/^DN-\d{6}$/);
    expect(D(dn1.costTotal).toFixed(2)).toBe("160.00");
    const b1 = await prisma.stockBalance.findUniqueOrThrow({ where: { id: bucket.id } });
    expect([D(b1.onHandSqm).toString(), D(b1.reservedSqm).toString()]).toEqual(["46", "6"]);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("INVOICED");

    const dn2 = await createDeliveryNote(store, { taxInvoiceId: ti.id, date: NOW });
    expect(D(dn2.items[0].sqm).toString()).toBe("6");
    const [cogs1, inv1] = await Promise.all([accountBalance(prisma, "COGS"), accountBalance(prisma, "INVENTORY")]);
    expect(cogs1.minus(cogs0).toFixed(2)).toBe("400.00");
    expect(inv1.minus(inv0).toFixed(2)).toBe("-400.00");
    const soAfter = await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
    expect(soAfter.status).toBe("DELIVERED");
    expect((await prisma.stockReservation.findUniqueOrThrow({ where: { id: soAfter.items[0].reservationId! } })).status).toBe("CONSUMED");
    expect(D((await prisma.taxInvoiceItem.findUniqueOrThrow({ where: { id: line.id } })).deliveredSqm).toString()).toBe("10");
    await expectError(createDeliveryNote(store, { taxInvoiceId: ti.id, date: NOW }), "VALIDATION", /Nothing left/);
    const pdf = await buildPrintDoc(store, "dn", dn1.id);
    expect(pdf.rows[0]).toMatchObject({ sqm: "4.00" });
    expect(pdf.extra?.lines).toContain("Received by Site foreman");
    const rec = await inventoryReconciliation();
    expect(rec.difference.toString()).toBe("0");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: "DeliveryNote", entityId: dn1.id } });
    expect(log.after).toMatchObject({ vehicleNo: "D 12345", receivedBy: "Site foreman" });
  });

  it("a whole slab sold and delivered becomes SOLD", async () => {
    await saveSystemSettings(await ctxFor("owner"), { "features.salesInvoicing": "true" });
    const owner = await ctxFor("owner");
    const sales = await ctxFor("sales");
    const { slabs } = await slabLot(owner, 1, "100");
    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Slab customer ${uid()}` } });
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, priceMode: "INCLUSIVE", lines: [{ balanceId: slabs[0].balance!.id, sqm: "2", unitPrice: "300" }] });
    const ti = await createTaxInvoice(sales, { salesOrderId: so.id, date: NOW });
    await recordCustomerReceipt(sales, { taxInvoiceId: ti.id, date: NOW, amount: "600", mode: "BANK" });
    const dn = await createDeliveryNote(owner, { taxInvoiceId: ti.id, date: NOW });
    expect(D(dn.costTotal).toFixed(2)).toBe("200.00");
    expect((await prisma.slab.findUniqueOrThrow({ where: { id: slabs[0].id } })).status).toBe("SOLD");
  });
});

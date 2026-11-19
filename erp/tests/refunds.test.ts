// T8-06 refund vouchers and T4-15 supplier advance refund / transfer (TD-027).
import { describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { accountBalance } from "../src/server/accounting/gl";
import { cancelCustomerReceipt, recordCustomerReceipt } from "../src/server/receipts/receipts";
import { recordReceivedCheque } from "../src/server/receipts/cheques";
import { cancelAdvanceTransfer, cancelRefund, customerAdvancePosition, recordCustomerRefund, recordSupplierRefund, transferSupplierAdvance } from "../src/server/refunds/refunds";
import { saveSalesOrder, cancelSalesOrder } from "../src/server/sales/orders";
import { closeProformaInvoice, createProformaInvoice } from "../src/server/sales/proformas";
import { createOpeningLot } from "../src/server/inventory/lots";
import { approvePurchaseOrder, createShipment, savePurchaseOrder, setShipmentStatus, submitPurchaseOrder, verifyPoPayment } from "../src/server/purchase/orders";
import { recordSupplierPayment } from "../src/server/purchase/payments";
import { createGoodsReceipt } from "../src/server/purchase/receipts";
import { postSupplierInvoice } from "../src/server/purchase/invoices";
import { ctxFor, makeProduct, uid, warehouseId } from "./helpers";

const NOW = today().toISOString().slice(0, 10);
const plus = (days: number) => new Date(today().getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

async function customerWithPi() {
  const owner = await ctxFor("owner");
  const sales = await ctxFor("sales");
  const product = await makeProduct("TILE");
  const lot = await createOpeningLot(owner, { productId: product.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: "100" });
  const bucket = await prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
  const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Refund customer ${uid()}` } });
  const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, lines: [{ balanceId: bucket.id, sqm: "10", unitPrice: "100" }] }); // AED 1,000 (+VAT per C4 proposal)
  const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: NOW });
  return { sales, cust, so, pi };
}

describe("customer refunds (T8-06)", () => {
  it("refunds free advance only; posts Dr Customer Advances / Cr Cash; cancel reverses", async () => {
    const acct = await ctxFor("accountant");
    const { sales, cust, pi } = await customerWithPi();
    await recordCustomerReceipt(sales, { customerId: cust.id, date: NOW, amount: "500", mode: "CASH" }); // free
    await recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "300", mode: "CASH" }); // held on PI
    await recordReceivedCheque(sales, { customerId: cust.id, chequeNo: `CHQ-${uid()}`, bankName: "ADCB", amount: "200", issueDate: NOW, dueDate: plus(5) }); // not cleared

    const pos = await customerAdvancePosition(cust.id);
    expect(pos.balance.toString()).toBe("1000");
    expect(pos.free.toString()).toBe("500");

    // Who may refund: Owner and Accountant only (spec §5 "refund").
    await expectError(recordCustomerRefund(sales, { customerId: cust.id, date: NOW, amount: "1", mode: "CASH", reason: "x" }), "FORBIDDEN");
    await expectError(recordCustomerRefund(await ctxFor("manager"), { customerId: cust.id, date: NOW, amount: "1", mode: "CASH", reason: "x" }), "FORBIDDEN");
    await expectError(recordCustomerRefund(acct, { customerId: cust.id, date: NOW, amount: "500.01", mode: "CASH", reason: "Deal off" }), "VALIDATION", /500.00 of free advance/);
    await expectError(recordCustomerRefund(acct, { customerId: cust.id, date: NOW, amount: "10", mode: "CASH" }), "VALIDATION");
    await expectError(recordCustomerRefund(acct, { customerId: cust.id, date: plus(1), amount: "10", mode: "CASH", reason: "x" }), "VALIDATION", /future/);

    const cash = await accountBalance(prisma, "CASH");
    const rf = await recordCustomerRefund(acct, { customerId: cust.id, date: NOW, amount: "500", mode: "CASH", reason: "Customer changed mind" });
    expect(rf.number).toMatch(/^RF-26\d{4}$/);
    expect((await accountBalance(prisma, "CASH")).minus(cash).toString()).toBe("-500");
    expect((await customerAdvancePosition(cust.id)).free.toString()).toBe("0");

    // The receipt behind the refunded money can no longer be cancelled.
    const free = await prisma.customerReceipt.findFirstOrThrow({ where: { customerId: cust.id, proformaInvoiceId: null } });
    await expectError(cancelCustomerReceipt(acct, free.id, { reason: "typo" }), "VALIDATION", /cancel the refund first/);

    await expectError(cancelRefund(sales, rf.id, { reason: "x" }), "FORBIDDEN");
    const c = await cancelRefund(acct, rf.id, { reason: "Recorded twice" });
    expect(c.status).toBe("CANCELLED");
    expect((await accountBalance(prisma, "CASH")).minus(cash).toString()).toBe("0");
    expect((await customerAdvancePosition(cust.id)).free.toString()).toBe("500");
    await expectError(cancelRefund(acct, rf.id, { reason: "again" }), "VALIDATION", /already cancelled/);
    await cancelCustomerReceipt(acct, free.id, { reason: "now it can" });
  });

  it("refund from a proforma lowers its received amount, so the PI can be closed and the SO cancelled", async () => {
    const acct = await ctxFor("accountant");
    const manager = await ctxFor("manager");
    const { sales, cust, so, pi } = await customerWithPi();
    await recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "300", mode: "BANK" });
    await expectError(closeProformaInvoice(manager, pi.id, "CLOSED", "x"), "VALIDATION");
    await expectError(recordCustomerRefund(acct, { customerId: cust.id, date: NOW, amount: "1", mode: "BANK", reason: "x" }), "VALIDATION", /refund those from the proforma/);
    await expectError(recordCustomerRefund(acct, { proformaInvoiceId: pi.id, date: NOW, amount: "300.01", mode: "BANK", reason: "x" }), "VALIDATION", /300.00/);

    const bank = await accountBalance(prisma, "BANK_MAIN");
    await recordCustomerRefund(acct, { proformaInvoiceId: pi.id, date: NOW, amount: "300", mode: "BANK", reason: "Order cancelled" });
    expect((await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } })).receivedAmount.toString()).toBe("0");
    expect((await accountBalance(prisma, "BANK_MAIN")).minus(bank).toString()).toBe("-300");
    expect((await customerAdvancePosition(cust.id)).balance.toString()).toBe("0");
    await cancelSalesOrder(manager, so.id, "Customer cancelled; advance refunded");
  });
});

// ───────────────────────────── Supplier side (T4-15) ─────────────────────────────

const DATE = "2026-03-10";
const tax = (code: string) => prisma.taxCode.findUniqueOrThrow({ where: { code } });

/** Import PO for 20 SQM × 100 = AED 2,000, paid in full and approved. */
async function paidPo(supplierId?: string) {
  const owner = await ctxFor("owner");
  const acct = await ctxFor("accountant");
  const sup = supplierId ? await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } }) : await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `Refund supplier ${uid()}`, supplierType: "IMPORT" } });
  const product = await makeProduct("SLAB");
  const po = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: DATE, lines: [{ productId: product.id, sqm: "20", unitPrice: "100", taxCodeId: (await tax("RC")).id }] });
  await submitPurchaseOrder(acct, po.id);
  await approvePurchaseOrder(owner, po.id);
  return { owner, acct, sup, po: await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } }) };
}

/** Pays, receives and invoices at 90/SQM → closed PO with AED 200 of advance left. */
async function closedPoWithLeftover() {
  const { owner, acct, sup, po } = await paidPo();
  const store = await ctxFor("storekeeper");
  await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "2000", mode: "BANK" });
  await verifyPoPayment(acct, po.id);
  const sh = await createShipment(owner, po.id, { reference: "BL-R", containerNos: "MSKU7654321" });
  for (const s of ["IN_TRANSIT", "AT_PORT", "COLLECTED"] as const) await setShipmentStatus(owner, sh.id, s);
  const tag = uid();
  const item = po.items[0];
  await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh.id, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId: item.id, blocks: [{ blockNo: `B-${tag}`, slabs: Array.from({ length: 10 }, (_, i) => ({ slabNo: `RS-${tag}-${i}`, lengthCm: "200", widthCm: "100" })) }] }] });
  await postSupplierInvoice(acct, { purchaseOrderId: po.id, supplierInvoiceNo: `V-${uid()}`, date: DATE, lines: [{ poItemId: item.id, sqm: "20", unitPrice: "90", taxCodeId: item.taxCodeId }] });
  const fresh = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
  expect(fresh.status).toBe("CLOSED");
  expect(fresh.advanceBalance.toString()).toBe("200");
  return { owner, acct, sup, po: fresh };
}

const supplierAdvance = async (supplierId: string) => {
  const a = await prisma.journalLine.aggregate({ where: { account: { systemKey: "SUPPLIER_ADVANCES" }, partyId: supplierId }, _sum: { debit: true, credit: true } });
  return D(a._sum.debit ?? 0).minus(D(a._sum.credit ?? 0)).toString();
};

describe("supplier advance refund and transfer (T4-15)", () => {
  it("only a closed PO's leftover advance can be refunded; Dr Bank / Cr Supplier Advances; cancel puts it back", async () => {
    const { acct, po: open } = await paidPo();
    await recordSupplierPayment(acct, { purchaseOrderId: open.id, date: DATE, amount: "500", mode: "BANK" });
    await expectError(recordSupplierRefund(acct, { purchaseOrderId: open.id, date: NOW, amount: "100", mode: "BANK", reason: "x" }), "VALIDATION", /not closed/);

    const { sup, po } = await closedPoWithLeftover();
    expect(await supplierAdvance(sup.id)).toBe("200");
    await expectError(recordSupplierRefund(await ctxFor("manager"), { purchaseOrderId: po.id, date: NOW, amount: "1", mode: "BANK", reason: "x" }), "FORBIDDEN");
    await expectError(recordSupplierRefund(acct, { purchaseOrderId: po.id, date: NOW, amount: "200.01", mode: "BANK", reason: "x" }), "VALIDATION", /200.00 of advance left/);

    const bank = await accountBalance(prisma, "BANK_MAIN");
    const rf = await recordSupplierRefund(acct, { purchaseOrderId: po.id, date: NOW, amount: "200", mode: "BANK", reason: "Invoice lower than paid", reference: "TT-991" });
    expect(rf.partyType).toBe("SUPPLIER");
    expect((await accountBalance(prisma, "BANK_MAIN")).minus(bank).toString()).toBe("200");
    expect(await supplierAdvance(sup.id)).toBe("0");
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).advanceBalance.toString()).toBe("0");

    await cancelRefund(acct, rf.id, { reason: "Bank returned the transfer" });
    expect(await supplierAdvance(sup.id)).toBe("200");
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).advanceBalance.toString()).toBe("200");
  });

  it("moves the leftover advance to another PO of the same supplier; it counts as paid there; cancel while unused", async () => {
    const { acct, sup, po } = await closedPoWithLeftover();
    const { po: other } = await paidPo(sup.id);
    const { po: stranger } = await paidPo();

    await expectError(transferSupplierAdvance(await ctxFor("sales"), { fromPurchaseOrderId: po.id, toPurchaseOrderId: other.id, date: NOW, amount: "1", reason: "x" }), "FORBIDDEN");
    await expectError(transferSupplierAdvance(acct, { fromPurchaseOrderId: po.id, toPurchaseOrderId: stranger.id, date: NOW, amount: "100", reason: "x" }), "VALIDATION", /another supplier/);
    await expectError(transferSupplierAdvance(acct, { fromPurchaseOrderId: other.id, toPurchaseOrderId: po.id, date: NOW, amount: "100", reason: "x" }), "VALIDATION", /not closed/);
    await expectError(transferSupplierAdvance(acct, { fromPurchaseOrderId: po.id, toPurchaseOrderId: other.id, date: NOW, amount: "250", reason: "x" }), "VALIDATION", /200.00 of advance left/);

    const t = await transferSupplierAdvance(acct, { fromPurchaseOrderId: po.id, toPurchaseOrderId: other.id, date: NOW, amount: "200", reason: "Use on next order" });
    expect(t.number).toMatch(/^AT-26\d{4}$/);
    expect(t.toAdvance.toString()).toBe("200");
    const target = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: other.id } });
    expect(target.paidAmount.toString()).toBe("200");
    expect(target.advanceBalance.toString()).toBe("200");
    expect(target.paymentStatus).toBe("PARTIAL");
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).advanceBalance.toString()).toBe("0");
    expect(await supplierAdvance(sup.id)).toBe("200"); // same supplier, same advance: no GL needed

    // The target can be paid only what is left of its total.
    await expectError(recordSupplierPayment(acct, { purchaseOrderId: other.id, date: DATE, amount: "1800.01", mode: "BANK" }), "VALIDATION");

    await cancelAdvanceTransfer(acct, t.id, { reason: "Wrong PO" });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: other.id } })).paidAmount.toString()).toBe("0");
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).advanceBalance.toString()).toBe("200");
    await expectError(cancelAdvanceTransfer(acct, t.id, { reason: "again" }), "VALIDATION", /already cancelled/);
  });
});

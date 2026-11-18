// T6-02 — post-dated cheques (R5): record → deposit → clear / bounce / cancel / replace, GL, PI and PO effects,
// status history, register = GL.
import { describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { accountBalance } from "../src/server/accounting/gl";
import { changeChequeStatus, chequesDue, pdcReconciliation, recordIssuedCheque, recordReceivedCheque, replaceReceivedCheque } from "../src/server/receipts/cheques";
import { customerAdvanceBalance, recordCustomerReceipt } from "../src/server/receipts/receipts";
import { saveSalesOrder, cancelSalesOrder } from "../src/server/sales/orders";
import { closeProformaInvoice, createProformaInvoice } from "../src/server/sales/proformas";
import { createOpeningLot } from "../src/server/inventory/lots";
import { approvePurchaseOrder, savePurchaseOrder, submitPurchaseOrder } from "../src/server/purchase/orders";
import { recordSupplierPayment } from "../src/server/purchase/payments";
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

async function piFor(amountSqm = "10") {
  const owner = await ctxFor("owner");
  const sales = await ctxFor("sales");
  const product = await makeProduct("TILE");
  const lot = await createOpeningLot(owner, { productId: product.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: "100" });
  const bucket = await prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
  const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `PDC customer ${uid()}` } });
  const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, lines: [{ balanceId: bucket.id, sqm: amountSqm, unitPrice: "100" }] });
  const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: NOW });
  return { sales, cust, so, pi };
}

const cheque = (extra: Record<string, unknown>) => ({ chequeNo: `CHQ-${uid()}`, bankName: "ADCB", amount: "400", issueDate: NOW, dueDate: plus(10), ...extra });

describe("received PDC (R5)", () => {
  it("record → deposit → clear: GL at each step, PI counts it only when cleared, history kept, register = GL", async () => {
    const acct = await ctxFor("accountant");
    const { sales, cust, pi } = await piFor();
    const advBefore = await customerAdvanceBalance(cust.id);
    const pdcBefore = await accountBalance(prisma, "PDC_RECEIVABLE");

    const c = await recordReceivedCheque(sales, cheque({ proformaInvoiceId: pi.id }));
    expect(c.number).toMatch(/^PDC-26\d{4}$/);
    expect(c.status).toBe("RECEIVED");
    expect((await accountBalance(prisma, "PDC_RECEIVABLE")).minus(pdcBefore).toString()).toBe("400");
    expect((await customerAdvanceBalance(cust.id)).minus(advBefore).toString()).toBe("400");
    expect((await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } })).receivedAmount.toString()).toBe("0");

    // Sales may record cheques but not move them on.
    await expectError(changeChequeStatus(sales, c.id, { action: "deposit", date: NOW }), "FORBIDDEN");
    await expectError(changeChequeStatus(acct, c.id, { action: "clear", date: plus(10) }), "VALIDATION", /cannot be cleared/);
    await changeChequeStatus(acct, c.id, { action: "deposit", date: NOW });
    await expectError(changeChequeStatus(acct, c.id, { action: "clear", date: plus(9) }), "VALIDATION", /cannot clear before/);
    const bankBefore = await accountBalance(prisma, "BANK_MAIN");
    const cleared = await changeChequeStatus(acct, c.id, { action: "clear", date: plus(10) });
    expect(cleared.status).toBe("CLEARED");
    expect((await accountBalance(prisma, "BANK_MAIN")).minus(bankBefore).toString()).toBe("400");
    expect((await accountBalance(prisma, "PDC_RECEIVABLE")).minus(pdcBefore).toString()).toBe("0");
    expect((await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } })).receivedAmount.toString()).toBe("400");

    const hist = await prisma.chequeStatusEvent.findMany({ where: { chequeId: c.id }, orderBy: { createdAt: "asc" } });
    expect(hist.map((h) => h.toStatus)).toEqual(["RECEIVED", "DEPOSITED", "CLEARED"]);
    expect(hist[1].userId).toBe(acct.userId);
    expect((await pdcReconciliation()).ok).toBe(true);
  });

  it("bounce reverses the entry and can book bank charges; a replacement takes over", async () => {
    const acct = await ctxFor("accountant");
    const { sales, cust, pi } = await piFor();
    const c = await recordReceivedCheque(sales, cheque({ proformaInvoiceId: pi.id, amount: "700" }));
    await changeChequeStatus(acct, c.id, { action: "deposit", date: NOW });
    const adv = await customerAdvanceBalance(cust.id);
    const charges = await accountBalance(prisma, "BANK_CHARGES");
    await expectError(changeChequeStatus(acct, c.id, { action: "bounce", date: plus(10) }), "VALIDATION", /reason/);
    const b = await changeChequeStatus(acct, c.id, { action: "bounce", date: plus(10), remarks: "Insufficient funds", bankCharges: "52.50" });
    expect(b.status).toBe("BOUNCED");
    expect(b.bounceReason).toBe("Insufficient funds");
    expect((await customerAdvanceBalance(cust.id)).minus(adv).toString()).toBe("-700");
    expect((await accountBalance(prisma, "BANK_CHARGES")).minus(charges).toString()).toBe("52.5");

    const r = await replaceReceivedCheque(acct, c.id, { chequeNo: `CHQ-${uid()}`, amount: "700", issueDate: plus(11), dueDate: plus(20), date: plus(11) });
    expect(r.replacesId).toBe(c.id);
    expect(r.proformaInvoiceId).toBe(pi.id);
    expect((await prisma.cheque.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("REPLACED");
    expect((await customerAdvanceBalance(cust.id)).minus(adv).toString()).toBe("0");
    expect((await pdcReconciliation()).ok).toBe(true);
  });

  it("caps cheques plus receipts at the PI total; open cheques block closing the PI or cancelling the SO; cancel before deposit", async () => {
    const acct = await ctxFor("accountant");
    const manager = await ctxFor("manager");
    const { sales, so, pi } = await piFor("10"); // AED 1,000
    await recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "300", mode: "CASH" });
    const c = await recordReceivedCheque(sales, cheque({ proformaInvoiceId: pi.id, amount: "600" }));
    await expectError(recordReceivedCheque(sales, cheque({ proformaInvoiceId: pi.id, amount: "100.01" })), "VALIDATION", /100.00 left/);
    await expectError(recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "100.01", mode: "CASH" }), "VALIDATION", /100.00 left/);
    await expectError(closeProformaInvoice(manager, pi.id, "CLOSED", "x"), "VALIDATION");
    await expectError(cancelSalesOrder(manager, so.id, "x"), "VALIDATION");
    await expectError(recordReceivedCheque(sales, cheque({ proformaInvoiceId: pi.id, issueDate: NOW, dueDate: "2026-01-01" })), "VALIDATION", /before the issue date/);

    const cancelled = await changeChequeStatus(acct, c.id, { action: "cancel", date: NOW, remarks: "Customer took it back" });
    expect(cancelled.status).toBe("CANCELLED");
    await expectError(changeChequeStatus(acct, c.id, { action: "deposit", date: NOW }), "VALIDATION");
    expect((await pdcReconciliation()).ok).toBe(true);
  });
});

describe("issued PDC (R5)", () => {
  async function approvedPo() {
    const acct = await ctxFor("accountant");
    const sup = await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `PDC supplier ${uid()}` } });
    const product = await makeProduct("SLAB");
    const sr = await prisma.taxCode.findUniqueOrThrow({ where: { code: "SR" } });
    const po = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: NOW, lines: [{ productId: product.id, sqm: "10", unitPrice: "100" , taxCodeId: sr.id }] }); // AED 1,050
    await submitPurchaseOrder(acct, po.id);
    await approvePurchaseOrder(await ctxFor("owner"), po.id);
    return { acct, po, sup };
  }

  it("the PO counts an issued cheque as paid only when it clears; open cheques reduce what else can be paid", async () => {
    const { acct, po, sup } = await approvedPo();
    const c = await recordIssuedCheque(acct, cheque({ purchaseOrderId: po.id, amount: "1000" }));
    expect(c.status).toBe("ISSUED");
    expect(c.supplierId).toBe(sup.id);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).paidAmount.toString()).toBe("0");
    await expectError(recordSupplierPayment(acct, { purchaseOrderId: po.id, date: NOW, amount: "50.01", mode: "CASH" }), "VALIDATION", /at most AED 50.00/);
    await expectError(recordIssuedCheque(acct, cheque({ purchaseOrderId: po.id, amount: "50.01" })), "VALIDATION", /50.00/);
    await expectError(recordIssuedCheque(await ctxFor("sales"), cheque({ purchaseOrderId: po.id, amount: "1" })), "FORBIDDEN");

    const payable = await accountBalance(prisma, "PDC_PAYABLE");
    const bank = await accountBalance(prisma, "BANK_MAIN");
    const cleared = await changeChequeStatus(acct, c.id, { action: "clear", date: plus(10) });
    expect(cleared.status).toBe("CLEARED");
    const after = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(after.paidAmount.toString()).toBe("1000");
    expect(after.advanceBalance.toString()).toBe("1000");
    expect(after.paymentStatus).toBe("PARTIAL");
    expect((await accountBalance(prisma, "PDC_PAYABLE")).minus(payable).toString()).toBe("1000");
    expect((await accountBalance(prisma, "BANK_MAIN")).minus(bank).toString()).toBe("-1000");
    expect((await pdcReconciliation()).ok).toBe(true);
  });

  it("a bounced issued cheque reverses its entry and frees the PO amount", async () => {
    const { acct, po } = await approvedPo();
    const c = await recordIssuedCheque(acct, cheque({ purchaseOrderId: po.id, amount: "1050" }));
    await changeChequeStatus(acct, c.id, { action: "bounce", date: plus(10), remarks: "Signature mismatch" });
    expect((await pdcReconciliation()).ok).toBe(true);
    const pv = await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: NOW, amount: "1050", mode: "BANK" });
    expect(D(pv.amount).toString()).toBe("1050");
    const due = await chequesDue(today(), 30);
    expect(due.some((d) => d.id === c.id)).toBe(false);
  });
});

describe("issued PDC against a landed cost bill (T6-02 follow-up)", () => {
  it("counts against the bill until it clears; clearing pays the bill and knocks off AP; bounce frees it", async () => {
    const { recordLandedCostExpense } = await import("../src/server/purchase/landed-cost");
    const acct = await ctxFor("accountant");
    const owner = await ctxFor("owner");
    const sup = await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `Freight co ${uid()}`, supplierType: "LOCAL" } });
    const product = await makeProduct("SLAB");
    const sr = await prisma.taxCode.findUniqueOrThrow({ where: { code: "SR" } });
    const po = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: NOW, lines: [{ productId: product.id, sqm: "10", unitPrice: "100", taxCodeId: sr.id }] });
    await submitPurchaseOrder(acct, po.id);
    await approvePurchaseOrder(owner, po.id);
    const cat = await prisma.landedCostCategory.findFirstOrThrow();
    const bill = await recordLandedCostExpense(acct, { purchaseOrderId: po.id, supplierId: sup.id, categoryId: cat.id, billNo: `FR-${uid()}`, date: NOW, amount: "1000", taxCodeId: sr.id }); // AED 1,050 with VAT
    const total = (await prisma.landedCostExpense.findUniqueOrThrow({ where: { id: bill.id } })).total.toString();

    const c = await recordIssuedCheque(acct, cheque({ landedCostExpenseId: bill.id, amount: total }));
    expect(c.landedCostExpenseId).toBe(bill.id);
    await expectError(recordSupplierPayment(acct, { landedCostExpenseId: bill.id, date: NOW, amount: "0.01", mode: "BANK" }), "VALIDATION", /open cheques/);
    await expectError(recordIssuedCheque(acct, cheque({ landedCostExpenseId: bill.id, purchaseOrderId: po.id, amount: "1" })), "VALIDATION", /landed cost bill/);
    expect((await prisma.landedCostExpense.findUniqueOrThrow({ where: { id: bill.id } })).paidAmount.toString()).toBe("0");

    const ap = async () => {
      const a = await prisma.journalLine.aggregate({ where: { account: { systemKey: { in: ["AP", "SUPPLIER_ADVANCES"] } }, partyId: sup.id }, _sum: { debit: true, credit: true } });
      return D(a._sum.credit ?? 0).minus(D(a._sum.debit ?? 0)).toString();
    };
    expect(await ap()).toBe("0"); // AP 1,050 owed, advance 1,050 given by cheque
    await changeChequeStatus(acct, c.id, { action: "clear", date: plus(10) });
    const paid = await prisma.landedCostExpense.findUniqueOrThrow({ where: { id: bill.id } });
    expect(paid.paidAmount.toString()).toBe(total);
    expect(paid.paymentStatus).toBe("PAID");
    const apOnly = await prisma.journalLine.aggregate({ where: { account: { systemKey: "AP" }, partyId: sup.id }, _sum: { debit: true, credit: true } });
    expect(D(apOnly._sum.credit ?? 0).minus(D(apOnly._sum.debit ?? 0)).toString()).toBe("0");
    expect((await pdcReconciliation()).ok).toBe(true);
  });
});

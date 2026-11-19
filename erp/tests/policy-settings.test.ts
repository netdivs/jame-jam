// Phase 1 policy settings (TD-040 … TD-044): each rule is off by default and changes behaviour only when set.
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { approvePurchaseOrder, createShipment, savePurchaseOrder, setShipmentStatus, submitPurchaseOrder, verifyPoPayment } from "../src/server/purchase/orders";
import { recordSupplierPayment } from "../src/server/purchase/payments";
import { createGoodsReceipt } from "../src/server/purchase/receipts";
import { postSupplierInvoice } from "../src/server/purchase/invoices";
import { recordLandedCostExpense } from "../src/server/purchase/landed-cost";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { recordCustomerRefund } from "../src/server/refunds/refunds";
import { saveLandedCostCategory, saveSupplier } from "../src/server/masters";
import { saveSystemSettings } from "../src/server/settings";
import { ctxFor, makeProduct, uid, warehouseId } from "./helpers";

const DATE = "2026-03-10";
const NOW = today().toISOString().slice(0, 10);
const tax = (code: string) => prisma.taxCode.findUniqueOrThrow({ where: { code } });
const slabs = (n: number, tag = uid()) => [{ blockNo: `B-${tag}`, slabs: Array.from({ length: n }, (_, i) => ({ slabNo: `PS-${tag}-${i}`, lengthCm: "200", widthCm: "100" })) }];

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

async function setPolicy(values: Record<string, string>) {
  await saveSystemSettings(await ctxFor("owner"), values);
}

/** Approved PO: 20 SQM at 100 AED (local: SR → total 2,100; import: RC → total 2,000). */
async function approvedPo(type: "LOCAL" | "IMPORT", credit: { creditAllowed?: boolean; creditDays?: number } = {}) {
  const owner = await ctxFor("owner");
  const acct = await ctxFor("accountant");
  const code = `S-${uid()}`;
  const sup = await prisma.supplier.create({ data: { code, name: `Policy supplier ${code}`, supplierType: type, creditAllowed: credit.creditAllowed ?? false, creditDays: credit.creditDays ?? null } });
  const product = await makeProduct("SLAB");
  const t = await tax(type === "IMPORT" ? "RC" : "SR");
  const po = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: DATE, lines: [{ productId: product.id, sqm: "20", unitPrice: "100", taxCodeId: t.id }] });
  await submitPurchaseOrder(acct, po.id);
  await approvePurchaseOrder(owner, po.id);
  const fresh = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
  return { owner, acct, sup, po: fresh, item: fresh.items[0] };
}

const grnInput = async (poId: string, poItemId: string, shipmentId?: string) => ({ purchaseOrderId: poId, shipmentId, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId, blocks: slabs(10) }] });

const partyBalance = async (key: string, partyId: string) => {
  const a = await prisma.journalLine.aggregate({ where: { account: { systemKey: key }, partyId }, _sum: { debit: true, credit: true } });
  return D(a._sum.credit ?? 0).minus(a._sum.debit ?? 0);
};

afterEach(async () => {
  await prisma.systemSetting.deleteMany();
});
afterAll(async () => {
  await prisma.landedCostCategory.updateMany({ data: { defaultBasis: null } });
});

describe("receive before payment — credit suppliers (TD-040)", () => {
  it("default NEVER: even a credit supplier waits for the verified 100% payment", async () => {
    const { po, item } = await approvedPo("LOCAL", { creditAllowed: true, creditDays: 30 });
    await expectError(createGoodsReceipt(await ctxFor("storekeeper"), await grnInput(po.id, item.id)), "VALIDATION", /paid AED 0.00 of AED 2100.00/);
  });

  it("CREDIT_SUPPLIERS: credit supplier receives, is invoiced with a due date from credit days, then paid from AP", async () => {
    await setPolicy({ "purchase.receiveBeforePayment": "CREDIT_SUPPLIERS" });
    const store = await ctxFor("storekeeper");
    const { acct, sup, po, item } = await approvedPo("LOCAL", { creditAllowed: true, creditDays: 30 });
    await createGoodsReceipt(store, await grnInput(po.id, item.id));
    expect((await partyBalance("GRNI", sup.id)).toString()).toBe("2000");

    const inv = await postSupplierInvoice(acct, { purchaseOrderId: po.id, supplierInvoiceNo: `CR-${uid()}`, date: DATE, lines: [{ poItemId: item.id, sqm: "20", unitPrice: "100", taxCodeId: (await tax("SR")).id }] });
    expect(inv.dueDate?.toISOString().slice(0, 10)).toBe("2026-04-09");
    expect(inv.paymentStatus).toBe("UNPAID");
    expect((await partyBalance("GRNI", sup.id)).toString()).toBe("0");
    expect((await partyBalance("AP", sup.id)).toString()).toBe("2100");

    const pv = await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "2100", mode: "BANK" });
    expect(D(pv.toPayable).toString()).toBe("2100");
    expect(D(pv.toAdvance).toString()).toBe("0");
    expect((await partyBalance("AP", sup.id)).toString()).toBe("0");
    expect((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).paymentStatus).toBe("PAID");

    // A supplier without credit is still blocked under the same setting.
    const other = await approvedPo("LOCAL");
    await expectError(createGoodsReceipt(store, await grnInput(other.po.id, other.item.id)), "VALIDATION", /Suppliers are paid 100%/);
  });

  it("CREDIT_SUPPLIERS applies to import collection too; ALWAYS lets every supplier receive first", async () => {
    await setPolicy({ "purchase.receiveBeforePayment": "CREDIT_SUPPLIERS" });
    const imp = await approvedPo("IMPORT", { creditAllowed: true });
    const sh = await createShipment(imp.owner, imp.po.id, { reference: "BL-CR" });
    await setShipmentStatus(imp.owner, sh.id, "IN_TRANSIT");
    await setShipmentStatus(imp.owner, sh.id, "AT_PORT");
    await setShipmentStatus(imp.owner, sh.id, "COLLECTED");
    await createGoodsReceipt(await ctxFor("storekeeper"), await grnInput(imp.po.id, imp.item.id, sh.id));

    await setPolicy({ "purchase.receiveBeforePayment": "ALWAYS" });
    const plain = await approvedPo("LOCAL");
    await createGoodsReceipt(await ctxFor("storekeeper"), await grnInput(plain.po.id, plain.item.id));
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: plain.po.id } })).status).toBe("RECEIVED");
  });

  it("credit terms can be changed only by a user who can approve POs; a form without them keeps them", async () => {
    const acct = await ctxFor("accountant");
    const manager = await ctxFor("manager");
    const s = await saveSupplier(manager, null, { name: `Credit ${uid()}`, supplierType: "LOCAL", creditTerms: "1", creditAllowed: "on", creditDays: "45" });
    expect(s.creditAllowed).toBe(true);
    expect(s.creditDays).toBe(45);
    const base = { name: s.name, supplierType: "LOCAL", active: "true" };
    await expectError(saveSupplier(acct, s.id, { ...base, creditTerms: "1" }), "FORBIDDEN", /credit terms/);
    const kept = await saveSupplier(acct, s.id, { ...base, mobile: "0500000000" });
    expect(kept.creditAllowed).toBe(true);
    expect(kept.creditDays).toBe(45);
    const off = await saveSupplier(manager, s.id, { ...base, creditTerms: "1", creditDays: "" });
    expect(off.creditAllowed).toBe(false);
    expect(off.creditDays).toBeNull();
  });
});

describe("supplier invoice above the PO (TD-041)", () => {
  async function receivedLocalPo() {
    await setPolicy({ "purchase.receiveBeforePayment": "ALWAYS" });
    const r = await approvedPo("LOCAL");
    await createGoodsReceipt(await ctxFor("storekeeper"), await grnInput(r.po.id, r.item.id));
    return r;
  }
  const invoice = async (poId: string, poItemId: string, unitPrice: string, extra: Record<string, string> = {}) => ({
    purchaseOrderId: poId, supplierInvoiceNo: `OV-${uid()}`, date: DATE, lines: [{ poItemId, sqm: "20", unitPrice, taxCodeId: (await tax("SR")).id }], ...extra,
  });

  it("off by default: any price is accepted as before", async () => {
    const { acct, po, item } = await receivedLocalPo();
    await setPolicy({ "purchase.receiveBeforePayment": "ALWAYS" });
    const inv = await postSupplierInvoice(acct, await invoice(po.id, item.id, "150"));
    expect(D(inv.total).toString()).toBe("3150");
  });

  it("5%: within tolerance anyone posts; above it only Owner/Manager with a reason, audited", async () => {
    const { acct, owner, po, item } = await receivedLocalPo();
    await setPolicy({ "purchase.receiveBeforePayment": "ALWAYS", "purchase.invoiceOverPoTolerancePct": "5" });
    // 2,100 PO; 110/SQM → 2,310 > 2,205
    await expectError(postSupplierInvoice(acct, await invoice(po.id, item.id, "110")), "FORBIDDEN", /more than 5% above/);
    await expectError(postSupplierInvoice(owner, await invoice(po.id, item.id, "110")), "VALIDATION", /give a reason/);
    const inv = await postSupplierInvoice(owner, await invoice(po.id, item.id, "110", { overPoReason: "Price increase agreed" }));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: "SupplierInvoice", entityId: inv.id } });
    expect(log.meta).toMatchObject({ overPo: { poTotal: "2100.00", invoicedTotal: "2310.00", tolerancePct: "5", reason: "Price increase agreed" } });

    const ok = await receivedLocalPo();
    await setPolicy({ "purchase.receiveBeforePayment": "ALWAYS", "purchase.invoiceOverPoTolerancePct": "5" });
    expect(D((await postSupplierInvoice(acct, await invoice(ok.po.id, ok.item.id, "104"))).total).toString()).toBe("2184");
  });
});

describe("landed cost basis per category (TD-042)", () => {
  it("a bill without a basis uses its category's basis, else the company default; an explicit basis wins", async () => {
    await setPolicy({ "purchase.receiveBeforePayment": "ALWAYS" });
    const owner = await ctxFor("owner");
    const { acct, po, item } = await approvedPo("LOCAL");
    await createGoodsReceipt(await ctxFor("storekeeper"), await grnInput(po.id, item.id));
    const customs = await prisma.landedCostCategory.findUniqueOrThrow({ where: { name: "Customs Duty" } });
    const freight = await prisma.landedCostCategory.findUniqueOrThrow({ where: { name: "Freight" } });
    await saveLandedCostCategory(owner, customs.id, { name: customs.name, active: "true", defaultBasis: "VALUE" });
    const settings = await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    const sr = (await tax("SR")).id;
    const bill = (categoryId: string, extra: Record<string, string> = {}) =>
      recordLandedCostExpense(acct, { purchaseOrderId: po.id, categoryId, supplierId: po.supplierId, billNo: `LC-${uid()}`, date: DATE, amount: "100", taxCodeId: sr, ...extra });
    expect((await bill(customs.id)).allocationBasis).toBe("VALUE");
    expect((await bill(customs.id, { allocationBasis: "" })).allocationBasis).toBe("VALUE");
    expect((await bill(customs.id, { allocationBasis: "QUANTITY" })).allocationBasis).toBe("QUANTITY");
    expect((await bill(freight.id)).allocationBasis).toBe(settings.landedCostDefaultBasis);
    await saveLandedCostCategory(owner, customs.id, { name: customs.name, active: "true", defaultBasis: "" });
    expect((await prisma.landedCostCategory.findUniqueOrThrow({ where: { id: customs.id } })).defaultBasis).toBeNull();
  });
});

describe("bank charges on supplier payments (TD-043)", () => {
  it("default: charges are refused (they belong on a landed cost bill)", async () => {
    const { acct, po } = await approvedPo("IMPORT");
    await expectError(recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "1000", mode: "BANK", bankCharges: "25" }), "VALIDATION", /landed cost bill/);
  });

  it("EXPENSE: bank pays amount + charges, charges go to Bank Charges, the PO counts only the amount", async () => {
    await setPolicy({ "purchase.bankChargesTreatment": "EXPENSE" });
    const { acct, po } = await approvedPo("IMPORT");
    await expectError(recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "1000", mode: "CASH", bankCharges: "25" }), "VALIDATION", /bank payments/);
    const pv = await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "2000", mode: "BANK", bankCharges: "25.50" });
    expect(D(pv.bankCharges).toString()).toBe("25.5");
    const lines = await prisma.journalLine.findMany({ where: { entry: { sourceType: "SUPPLIER_PAYMENT", sourceId: pv.id } }, include: { account: true } });
    const by = (k: string) => lines.filter((l) => l.account.systemKey === k);
    expect(by("BANK_CHARGES")[0].debit.toString()).toBe("25.5");
    expect(lines.filter((l) => l.account.systemKey !== "BANK_CHARGES" && l.account.systemKey !== "SUPPLIER_ADVANCES" && l.account.systemKey !== "AP").reduce((a, l) => a.plus(l.credit), D(0)).toString()).toBe("2025.5");
    const fresh = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(D(fresh.paidAmount).toString()).toBe("2000");
    await verifyPoPayment(acct, po.id);
  });
});

describe("cash refund limit (TD-044)", () => {
  it("cash above the limit needs refunds.overLimit; bank is not limited; no limit by default", async () => {
    const acct = await ctxFor("accountant");
    const owner = await ctxFor("owner");
    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Limit customer ${uid()}` } });
    await recordCustomerReceipt(await ctxFor("sales"), { customerId: cust.id, date: NOW, amount: "1000", mode: "CASH" });
    const refund = (ctx: typeof acct, amount: string, mode = "CASH") => recordCustomerRefund(ctx, { customerId: cust.id, date: NOW, amount, mode, reason: "Test" });

    await refund(acct, "150"); // no limit set
    await setPolicy({ "refunds.cashLimit": "100" });
    await expectError(refund(acct, "150"), "FORBIDDEN", /above AED 100.00/);
    await refund(acct, "100"); // at the limit is fine
    await refund(acct, "150", "BANK");
    await refund(owner, "150");
  });
});

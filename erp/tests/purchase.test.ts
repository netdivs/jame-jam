// Step 4 — Purchase & import: D5 (PO workflow), R3 (landed cost), R6 (100% payment gate).
import { describe, expect, it } from "vitest";
import { D, prisma } from "../src/server/core";
import { accountBalance } from "../src/server/accounting/gl";
import { inventoryReconciliation } from "../src/server/inventory/queries";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createShipment,
  rejectPurchaseOrder,
  savePurchaseOrder,
  setShipmentStatus,
  submitPurchaseOrder,
  verifyPoPayment,
} from "../src/server/purchase/orders";
import { recordSupplierPayment } from "../src/server/purchase/payments";
import { createGoodsReceipt } from "../src/server/purchase/receipts";
import { postSupplierInvoice } from "../src/server/purchase/invoices";
import { allocateLandedCost, previewAllocation, recordLandedCostExpense } from "../src/server/purchase/landed-cost";
import { splitAmount } from "../src/server/inventory/costing";
import { ctxFor, makeProduct, uid, warehouseId } from "./helpers";

const DATE = "2026-03-10";
const tax = (code: string) => prisma.taxCode.findUniqueOrThrow({ where: { code } });
const category = (name: string) => prisma.landedCostCategory.findUniqueOrThrow({ where: { name } });

async function supplier(type: "LOCAL" | "IMPORT") {
  const code = `S-${uid()}`;
  return prisma.supplier.create({ data: { code, name: `Supplier ${code}`, supplierType: type } });
}

/** 10 slabs ordered at 100 AED/SQM; receives slabs of 200 × 100 cm (2 SQM each). */
async function approvedPo(type: "LOCAL" | "IMPORT" = "IMPORT", opts: { sqm?: string; price?: string } = {}) {
  const owner = await ctxFor("owner");
  const acct = await ctxFor("accountant");
  const sup = await supplier(type);
  const product = await makeProduct("SLAB");
  const t = await tax(type === "IMPORT" ? "RC" : "SR");
  const po = await savePurchaseOrder(acct, null, {
    supplierId: sup.id,
    date: DATE,
    lines: [{ productId: product.id, sqm: opts.sqm ?? "20", unitPrice: opts.price ?? "100", taxCodeId: t.id }],
  });
  await submitPurchaseOrder(acct, po.id);
  await approvePurchaseOrder(owner, po.id);
  const fresh = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
  return { owner, acct, sup, product, po: fresh, item: fresh.items[0] };
}

async function payInFull(acct: Awaited<ReturnType<typeof ctxFor>>, poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  await recordSupplierPayment(acct, { purchaseOrderId: poId, date: DATE, amount: D(po.total).minus(po.paidAmount).toString(), mode: "BANK" });
  await verifyPoPayment(acct, poId);
}

const slabs = (n: number, tag = uid()) => [{ blockNo: `B-${tag}`, slabs: Array.from({ length: n }, (_, i) => ({ slabNo: `GS-${tag}-${i}`, lengthCm: "200", widthCm: "100" })) }];

async function collectedShipment(owner: Awaited<ReturnType<typeof ctxFor>>, poId: string) {
  const sh = await createShipment(owner, poId, { reference: "BL-1", containerNos: "MSKU1234567" });
  await setShipmentStatus(owner, sh.id, "IN_TRANSIT");
  await setShipmentStatus(owner, sh.id, "AT_PORT");
  await setShipmentStatus(owner, sh.id, "COLLECTED");
  return sh;
}

describe("purchase order workflow (D5)", () => {
  it("computes totals; reverse charge VAT is not payable to the supplier", async () => {
    const { po } = await approvedPo("IMPORT");
    expect(D(po.netTotal).toString()).toBe("2000");
    expect(D(po.rcVatTotal).toString()).toBe("100");
    expect(D(po.total).toString()).toBe("2000");
    const local = await approvedPo("LOCAL");
    expect(D(local.po.vatTotal).toString()).toBe("100");
    expect(D(local.po.total).toString()).toBe("2100");
  });

  it("needs Owner/Manager approval; rejection returns it to draft with a reason", async () => {
    const acct = await ctxFor("accountant");
    const manager = await ctxFor("manager");
    const sup = await supplier("LOCAL");
    const product = await makeProduct("TILE");
    const po = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: DATE, lines: [{ productId: product.id, sqm: "5", unitPrice: "40", taxCodeId: (await tax("SR")).id }] });
    expect(po.status).toBe("DRAFT");
    expect(po.number).toMatch(/^PO-26\d{4}$/);
    expect((await submitPurchaseOrder(acct, po.id)).status).toBe("PENDING_APPROVAL");
    await expect(approvePurchaseOrder(acct, po.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(rejectPurchaseOrder(manager, po.id, " ")).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await rejectPurchaseOrder(manager, po.id, "Price too high")).status).toBe("DRAFT");
    await submitPurchaseOrder(acct, po.id);
    expect((await approvePurchaseOrder(manager, po.id)).status).toBe("APPROVED");
    // approved POs are locked for editing
    await expect(
      savePurchaseOrder(acct, po.id, { supplierId: sup.id, date: DATE, lines: [{ productId: product.id, sqm: "6", unitPrice: "40", taxCodeId: (await tax("SR")).id }] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("sales staff and storekeepers cannot create POs", async () => {
    const sup = await supplier("LOCAL");
    const product = await makeProduct("TILE");
    const raw = { supplierId: sup.id, date: DATE, lines: [{ productId: product.id, sqm: "5", unitPrice: "40", taxCodeId: (await tax("SR")).id }] };
    await expect(savePurchaseOrder(await ctxFor("sales"), null, raw)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(savePurchaseOrder(await ctxFor("storekeeper"), null, raw)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks paying beyond the PO total", async () => {
    const { acct, po } = await approvedPo("IMPORT");
    await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "1500", mode: "BANK" });
    await expect(recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "500.01", mode: "BANK" })).rejects.toMatchObject({ code: "VALIDATION" });
    const p = await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "500", mode: "CASH" });
    expect(D(p.toAdvance).toString()).toBe("500");
    const fresh = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(fresh.paymentStatus).toBe("PAID");
    expect(D(fresh.advanceBalance).toString()).toBe("2000");
  });

  it("cannot cancel a PO that has payments", async () => {
    const { owner, acct, po } = await approvedPo("LOCAL");
    await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "10", mode: "CASH" });
    await expect(cancelPurchaseOrder(owner, po.id, "No longer needed")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("100% payment before collection and GRN (R6)", () => {
  it("partial payment blocks collection and GRN; 100% verified allows them", async () => {
    const { owner, acct, po, item } = await approvedPo("IMPORT");
    const store = await ctxFor("storekeeper");
    const sh = await createShipment(owner, po.id, { reference: "BL-R6" });
    await setShipmentStatus(owner, sh.id, "AT_PORT");
    await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "1999.99", mode: "BANK" });

    await expect(setShipmentStatus(owner, sh.id, "COLLECTED")).rejects.toThrow(/paid AED 1999.99 of AED 2000.00/);
    await expect(verifyPoPayment(acct, po.id)).rejects.toMatchObject({ code: "VALIDATION" });
    const grn = { purchaseOrderId: po.id, shipmentId: sh.id, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId: item.id, blocks: slabs(2) }] };
    await expect(createGoodsReceipt(store, grn)).rejects.toMatchObject({ code: "VALIDATION" });

    await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "0.01", mode: "BANK" });
    // paid in full but not yet verified → still blocked
    await expect(setShipmentStatus(owner, sh.id, "COLLECTED")).rejects.toThrow(/not been verified/);
    await verifyPoPayment(acct, po.id);
    await setShipmentStatus(store, sh.id, "COLLECTED");
    const r = await createGoodsReceipt(store, grn);
    expect(r.number).toMatch(/^GRN-26\d{4}$/);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: sh.id } })).status).toBe("RECEIVED");
  });

  it("import goods need a collected shipment; local goods do not", async () => {
    const imp = await approvedPo("IMPORT");
    await payInFull(imp.acct, imp.po.id);
    const store = await ctxFor("storekeeper");
    await expect(
      createGoodsReceipt(store, { purchaseOrderId: imp.po.id, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId: imp.item.id, blocks: slabs(1) }] }),
    ).rejects.toThrow(/collected shipment/);

    const loc = await approvedPo("LOCAL");
    await payInFull(loc.acct, loc.po.id);
    const r = await createGoodsReceipt(store, { purchaseOrderId: loc.po.id, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId: loc.item.id, blocks: slabs(1) }] });
    expect(D(r.totalSqm).toString()).toBe("2");
  });
});

describe("GRN → supplier invoice (D5)", () => {
  it("creates lots/blocks/slabs at PO price, blocks over-receipt, tracks PO status", async () => {
    const { owner, acct, po, item } = await approvedPo("IMPORT");
    const store = await ctxFor("storekeeper");
    await payInFull(acct, po.id);
    const sh = await collectedShipment(owner, po.id);
    const wh = await warehouseId();

    // 11 slabs × 2 SQM = 22 > 20 ordered
    await expect(
      createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh.id, warehouseId: wh, date: DATE, lines: [{ poItemId: item.id, blocks: slabs(11) }] }),
    ).rejects.toThrow(/only 20.0000 SQM is still open/);

    const g1 = await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh.id, warehouseId: wh, date: DATE, lines: [{ poItemId: item.id, blocks: slabs(6) }] });
    const lot = await prisma.lot.findFirstOrThrow({ where: { goodsReceiptId: g1.id }, include: { slabs: true, blocks: true } });
    expect(lot.source).toBe("GRN");
    expect(lot.purchaseOrderId).toBe(po.id);
    expect(lot.slabs).toHaveLength(6);
    expect(D(lot.costPerSqm).toString()).toBe("100");
    expect(D(g1.totalValue).toString()).toBe("1200");
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");

    const sh2 = await collectedShipment(owner, po.id);
    await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh2.id, warehouseId: wh, date: DATE, lines: [{ poItemId: item.id, blocks: slabs(4) }] });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
    const grni = await prisma.journalLine.aggregate({ where: { account: { systemKey: "GRNI" }, partyId: po.supplierId }, _sum: { credit: true } });
    expect(D(grni._sum.credit ?? 0).toString()).toBe("2000");
  });

  it("invoice: unique number per supplier, no more than received, advance knock-off, RC VAT, closes the PO", async () => {
    const { owner, acct, po, item, sup } = await approvedPo("IMPORT");
    const store = await ctxFor("storekeeper");
    await payInFull(acct, po.id);
    const sh = await collectedShipment(owner, po.id);
    await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh.id, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId: item.id, blocks: slabs(10) }] });
    const rc = await tax("RC");
    const inv = { purchaseOrderId: po.id, supplierInvoiceNo: "INV-77", date: DATE, lines: [{ poItemId: item.id, sqm: "20.0001", unitPrice: "100", taxCodeId: rc.id }] };
    await expect(postSupplierInvoice(acct, inv)).rejects.toThrow(/only 20.0000 SQM has been received/);

    const posted = await postSupplierInvoice(acct, { ...inv, lines: [{ ...inv.lines[0], sqm: "20" }] });
    expect(posted.number).toMatch(/^PUR-26\d{4}$/);
    expect(D(posted.total).toString()).toBe("2000");
    expect(D(posted.rcVatTotal).toString()).toBe("100");
    expect(posted.paymentStatus).toBe("PAID"); // advance knocked off
    const fresh = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(D(fresh.advanceBalance).toString()).toBe("0");
    expect(fresh.status).toBe("CLOSED");

    await expect(postSupplierInvoice(acct, { ...inv, lines: [{ ...inv.lines[0], sqm: "1" }] })).rejects.toMatchObject({ code: "CONFLICT" });

    // Supplier's AP and advances are both zero; GRNI is cleared.
    const sum = async (key: string) => {
      const a = await prisma.journalLine.aggregate({ where: { account: { systemKey: key }, partyId: sup.id }, _sum: { debit: true, credit: true } });
      return D(a._sum.debit ?? 0).minus(D(a._sum.credit ?? 0)).toString();
    };
    expect(await sum("AP")).toBe("0");
    expect(await sum("SUPPLIER_ADVANCES")).toBe("0");
    expect(await sum("GRNI")).toBe("0");
  });

  it("invoice price difference goes to the lot (remaining stock) and COGS (sold part)", async () => {
    const { owner, acct, po, item } = await approvedPo("IMPORT");
    const store = await ctxFor("storekeeper");
    await payInFull(acct, po.id);
    const sh = await collectedShipment(owner, po.id);
    await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh.id, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId: item.id, blocks: slabs(10) }] });
    // Invoice 110/SQM instead of 100 → +200 variance on 20 SQM.
    // Pay the extra first (cap is the larger of PO and invoiced total).
    await postSupplierInvoice(acct, { purchaseOrderId: po.id, supplierInvoiceNo: `V-${uid()}`, date: DATE, lines: [{ poItemId: item.id, sqm: "20", unitPrice: "110", taxCodeId: (await tax("RC")).id }] });
    const lot = await prisma.lot.findFirstOrThrow({ where: { poItemId: item.id } });
    expect(D(lot.costPerSqm).toString()).toBe("110");
    expect(D(lot.landedCostTotal).toString()).toBe("2200");
    const inv = await prisma.supplierInvoice.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    expect(D(inv.settledAmount).toString()).toBe("2000");
    expect(inv.paymentStatus).toBe("PARTIAL");
    // remaining 200 can now be paid and settles the invoice directly
    const pv = await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "200", mode: "BANK" });
    expect(D(pv.toPayable).toString()).toBe("200");
    expect((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).paymentStatus).toBe("PAID");
  });
});

describe("landed cost (R3)", () => {
  it("splits amounts exactly (largest remainder)", () => {
    const parts = splitAmount(D("100"), [D(1), D(1), D(1)]);
    expect(parts.map(String)).toEqual(["33.34", "33.33", "33.33"]);
    expect(splitAmount(D("-10"), [D(1), D(3)]).map(String)).toEqual(["-2.5", "-7.5"]);
  });

  it("records expenses separately and allocates by SQM to the PO's lots", async () => {
    const { owner, acct, po, item } = await approvedPo("IMPORT", { sqm: "30" });
    const store = await ctxFor("storekeeper");
    await payInFull(acct, po.id);
    const sh = await collectedShipment(owner, po.id);
    const forwarder = await supplier("LOCAL");
    const wh = await warehouseId();
    // Lot A: 10 slabs (20 SQM), lot B: 5 slabs (10 SQM) in one GRN
    await createGoodsReceipt(store, {
      purchaseOrderId: po.id,
      shipmentId: sh.id,
      warehouseId: wh,
      date: DATE,
      lines: [
        { poItemId: item.id, blocks: slabs(10) },
        { poItemId: item.id, blocks: slabs(5) },
      ],
    });
    const freight = await recordLandedCostExpense(acct, {
      purchaseOrderId: po.id,
      shipmentId: sh.id,
      categoryId: (await category("Freight")).id,
      supplierId: forwarder.id,
      billNo: "FRT-1",
      date: DATE,
      amount: "900",
      taxCodeId: (await tax("SR")).id,
    });
    expect(D(freight.vatAmount).toString()).toBe("45");
    expect(D(freight.total).toString()).toBe("945");
    await expect(
      recordLandedCostExpense(acct, { purchaseOrderId: po.id, categoryId: (await category("Freight")).id, supplierId: forwarder.id, billNo: "FRT-1", date: DATE, amount: "1", taxCodeId: (await tax("SR")).id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const preview = await previewAllocation(prisma, freight.id);
    expect(preview.rows.map((r) => r.amount.toString())).toEqual(["600", "300"]);
    await expect(allocateLandedCost(await ctxFor("sales"), freight.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await allocateLandedCost(acct, freight.id);
    await expect(allocateLandedCost(acct, freight.id)).rejects.toThrow(/already allocated/);

    const lots = await prisma.lot.findMany({ where: { purchaseOrderId: po.id }, orderBy: { createdAt: "asc" }, include: { allocations: true } });
    expect(lots.map((l) => D(l.costPerSqm).toString())).toEqual(["130", "130"]); // 100 + 900/30
    expect(lots.map((l) => D(l.allocations[0].allocatedAmount).toString())).toEqual(["600", "300"]);
    expect(await accountBalance(prisma, "LANDED_COST_CLEARING")).toEqual(D(0));
  });

  it("manual override needs permission, a reason, and must add up", async () => {
    const { owner, acct, po, item } = await approvedPo("IMPORT");
    const manager = await ctxFor("manager");
    const store = await ctxFor("storekeeper");
    await payInFull(acct, po.id);
    const sh = await collectedShipment(owner, po.id);
    await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh.id, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId: item.id, blocks: slabs(5) }, { poItemId: item.id, blocks: slabs(5) }] });
    const exp = await recordLandedCostExpense(acct, { purchaseOrderId: po.id, categoryId: (await category("Customs Duty")).id, supplierId: (await supplier("LOCAL")).id, billNo: `CD-${uid()}`, date: DATE, amount: "100", taxCodeId: (await tax("OS")).id });
    const lots = await prisma.lot.findMany({ where: { purchaseOrderId: po.id }, orderBy: { createdAt: "asc" } });
    const overrides = [{ lotId: lots[0].id, amount: "70" }, { lotId: lots[1].id, amount: "30" }];
    await expect(allocateLandedCost(acct, exp.id, { overrides, reason: "Heavier slabs" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(allocateLandedCost(manager, exp.id, { overrides })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(allocateLandedCost(manager, exp.id, { overrides: [{ ...overrides[0], amount: "69" }, overrides[1]], reason: "x" })).rejects.toThrow(/must equal/);
    await allocateLandedCost(manager, exp.id, { overrides, reason: "Heavier slabs" });
    const allocs = await prisma.landedCostAllocation.findMany({ where: { expenseId: exp.id } });
    expect(allocs.every((a) => a.isManualOverride && a.overrideReason === "Heavier slabs")).toBe(true);
  });

  it("a late expense goes to COGS for the part already sold", async () => {
    const { owner, acct, po, item } = await approvedPo("IMPORT");
    const store = await ctxFor("storekeeper");
    await payInFull(acct, po.id);
    const sh = await collectedShipment(owner, po.id);
    await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh.id, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId: item.id, blocks: slabs(10) }] });
    const lot = await prisma.lot.findFirstOrThrow({ where: { poItemId: item.id }, include: { balances: true } });
    // Simulate that 5 SQM have left the lot (damaged) before the bill arrives.
    const { adjustStock } = await import("../src/server/inventory/stock");
    const { inTx, today } = await import("../src/server/core");
    for (const b of lot.balances.slice(0, 2)) await inTx((tx) => adjustStock(tx, owner, { balanceId: b.id, sqm: "-2", reason: "Broken in transit", date: today() }));
    await inTx((tx) => adjustStock(tx, owner, { balanceId: lot.balances[2].id, sqm: "-1", reason: "Chipped", date: today() }));

    const exp = await recordLandedCostExpense(acct, { purchaseOrderId: po.id, categoryId: (await category("Port Charges")).id, supplierId: (await supplier("LOCAL")).id, billNo: `PC-${uid()}`, date: DATE, amount: "400", taxCodeId: (await tax("SR")).id });
    await allocateLandedCost(acct, exp.id);
    const a = await prisma.landedCostAllocation.findFirstOrThrow({ where: { expenseId: exp.id } });
    expect(D(a.inventoryAmount).toString()).toBe("300"); // 15 of 20 SQM remain
    expect(D(a.cogsAmount).toString()).toBe("100");
    const after = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(D(after.costPerSqm).toString()).toBe("120"); // (1500 + 300) / 15
  });
});

describe("step 4 completion: shipment-scoped allocation, bill payments, guards", () => {
  it("a shipment-linked expense is allocated only to the lots received on that shipment (TD-010)", async () => {
    const { owner, acct, po, item } = await approvedPo("IMPORT", { sqm: "30" });
    const store = await ctxFor("storekeeper");
    const wh = await warehouseId();
    const clearing0 = await accountBalance(prisma, "LANDED_COST_CLEARING");
    await payInFull(acct, po.id);
    const sh1 = await collectedShipment(owner, po.id);
    await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh1.id, warehouseId: wh, date: DATE, lines: [{ poItemId: item.id, blocks: slabs(10) }] });
    const sh2 = await collectedShipment(owner, po.id);
    const forwarder = await supplier("LOCAL");
    const sr = (await tax("SR")).id;
    const freight = (await category("Freight")).id;
    const exp2 = await recordLandedCostExpense(acct, { purchaseOrderId: po.id, shipmentId: sh2.id, categoryId: freight, supplierId: forwarder.id, billNo: `F2-${uid()}`, date: DATE, amount: "50", taxCodeId: sr });
    await expect(allocateLandedCost(acct, exp2.id)).rejects.toThrow(/shipment yet/);
    await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh2.id, warehouseId: wh, date: DATE, lines: [{ poItemId: item.id, blocks: slabs(5) }] });

    const exp1 = await recordLandedCostExpense(acct, { purchaseOrderId: po.id, shipmentId: sh1.id, categoryId: freight, supplierId: forwarder.id, billNo: `F1-${uid()}`, date: DATE, amount: "900", taxCodeId: sr });
    const preview = await previewAllocation(prisma, exp1.id);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].amount.toString()).toBe("900");
    await allocateLandedCost(acct, exp1.id);
    await allocateLandedCost(acct, exp2.id);
    const lots = await prisma.lot.findMany({ where: { purchaseOrderId: po.id }, orderBy: { createdAt: "asc" } });
    expect(lots.map((l) => D(l.costPerSqm).toString())).toEqual(["145", "105"]); // 100 + 900/20, 100 + 50/10
    // A PO-level expense (no shipment) still spreads over every lot of the PO.
    const exp3 = await recordLandedCostExpense(acct, { purchaseOrderId: po.id, categoryId: (await category("Insurance")).id, supplierId: forwarder.id, billNo: `I-${uid()}`, date: DATE, amount: "300", taxCodeId: sr });
    expect((await previewAllocation(prisma, exp3.id)).rows.map((r) => r.amount.toString())).toEqual(["200", "100"]);
    expect((await accountBalance(prisma, "LANDED_COST_CLEARING")).minus(clearing0).toString()).toBe("300"); // exp3 not yet allocated
    await allocateLandedCost(acct, exp3.id);
    expect((await accountBalance(prisma, "LANDED_COST_CLEARING")).minus(clearing0).toString()).toBe("0");
  });

  it("landed cost bill payment needs payments.supplier, is capped at the bill total and clears the supplier's AP", async () => {
    const { acct, po } = await approvedPo("IMPORT");
    const forwarder = await supplier("LOCAL");
    const exp = await recordLandedCostExpense(acct, { purchaseOrderId: po.id, categoryId: (await category("Clearing Charges")).id, supplierId: forwarder.id, billNo: `CL-${uid()}`, date: DATE, amount: "200", taxCodeId: (await tax("SR")).id });
    expect(D(exp.total).toString()).toBe("210");
    const pay = (amount: string) => ({ landedCostExpenseId: exp.id, date: DATE, amount, mode: "BANK" });
    await expect(recordSupplierPayment(await ctxFor("manager"), pay("10"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordSupplierPayment(await ctxFor("sales"), pay("10"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordSupplierPayment(acct, pay("210.01"))).rejects.toMatchObject({ code: "VALIDATION" });
    await recordSupplierPayment(acct, pay("110"));
    expect((await prisma.landedCostExpense.findUniqueOrThrow({ where: { id: exp.id } })).paymentStatus).toBe("PARTIAL");
    const pv = await recordSupplierPayment(acct, { ...pay("100"), mode: "CASH" });
    expect(pv.number).toMatch(/^PV-26\d{4}$/);
    expect((await prisma.landedCostExpense.findUniqueOrThrow({ where: { id: exp.id } })).paymentStatus).toBe("PAID");
    const ap = await prisma.journalLine.aggregate({ where: { account: { systemKey: "AP" }, partyId: forwarder.id }, _sum: { debit: true, credit: true } });
    expect(D(ap._sum.debit ?? 0).minus(D(ap._sum.credit ?? 0)).toString()).toBe("0");
    // A payment is for one PO or one bill, never both.
    await expect(recordSupplierPayment(acct, { ...pay("1"), purchaseOrderId: po.id })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("only permitted roles can record or allocate landed cost, post invoices or verify payments", async () => {
    const { acct, po } = await approvedPo("LOCAL");
    const store = await ctxFor("storekeeper");
    const sales = await ctxFor("sales");
    const raw = { purchaseOrderId: po.id, categoryId: (await category("Transportation")).id, supplierId: (await supplier("LOCAL")).id, billNo: `T-${uid()}`, date: DATE, amount: "10", taxCodeId: (await tax("SR")).id };
    await expect(recordLandedCostExpense(store, raw)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordLandedCostExpense(sales, raw)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const exp = await recordLandedCostExpense(acct, raw);
    await expect(allocateLandedCost(store, exp.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(verifyPoPayment(store, po.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(verifyPoPayment(sales, po.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(postSupplierInvoice(store, { purchaseOrderId: po.id, supplierInvoiceNo: "X", date: DATE, lines: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createGoodsReceipt(acct, { purchaseOrderId: po.id, warehouseId: await warehouseId(), date: DATE, lines: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cancels an unpaid PO with a reason; a cancelled PO cannot be paid, approved or shipped", async () => {
    const { owner, acct, po } = await approvedPo("IMPORT");
    await expect(cancelPurchaseOrder(acct, po.id, "  ")).rejects.toMatchObject({ code: "VALIDATION" });
    const c = await cancelPurchaseOrder(acct, po.id, "Supplier out of stock");
    expect(c.status).toBe("CANCELLED");
    await expect(recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "1", mode: "BANK" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(approvePurchaseOrder(owner, po.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createShipment(owner, po.id, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(cancelPurchaseOrder(acct, po.id, "again")).rejects.toMatchObject({ code: "VALIDATION" });
    const log = await prisma.auditLog.findFirst({ where: { entity: "PurchaseOrder", entityId: po.id, action: "cancel" } });
    expect(log?.userId).toBe(acct.userId);
  });

  it("shipment status only moves forward and never to Received by hand", async () => {
    const { owner, po } = await approvedPo("IMPORT");
    const sh = await createShipment(owner, po.id, { reference: "BL-FWD" });
    expect(sh.number).toMatch(/^SHP-\d{6}$/);
    await setShipmentStatus(owner, sh.id, "AT_PORT");
    await expect(setShipmentStatus(owner, sh.id, "IN_TRANSIT")).rejects.toThrow(/already at port/);
    await expect(setShipmentStatus(owner, sh.id, "RECEIVED")).rejects.toThrow(/only through a goods receipt/);
    await expect(setShipmentStatus(await ctxFor("sales"), sh.id, "COLLECTED")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("audits approval, payment verification and manual allocation with the acting user", async () => {
    const { owner, acct, po, item } = await approvedPo("LOCAL");
    const manager = await ctxFor("manager");
    await payInFull(acct, po.id);
    await createGoodsReceipt(await ctxFor("storekeeper"), { purchaseOrderId: po.id, warehouseId: await warehouseId(), date: DATE, lines: [{ poItemId: item.id, blocks: slabs(4) }] });
    const exp = await recordLandedCostExpense(acct, { purchaseOrderId: po.id, categoryId: (await category("Inspection Charges")).id, supplierId: (await supplier("LOCAL")).id, billNo: `IN-${uid()}`, date: DATE, amount: "40", taxCodeId: (await tax("SR")).id });
    const [lot] = await prisma.lot.findMany({ where: { purchaseOrderId: po.id } });
    await allocateLandedCost(manager, exp.id, { overrides: [{ lotId: lot.id, amount: "40" }], reason: "Single lot" });
    const actions = async (entity: string, entityId: string) => (await prisma.auditLog.findMany({ where: { entity, entityId } })).map((a) => `${a.action}:${a.userId}`);
    expect(await actions("PurchaseOrder", po.id)).toEqual(expect.arrayContaining([`approve:${owner.userId}`, `verifyPayment:${acct.userId}`]));
    expect(await actions("LandedCostExpense", exp.id)).toEqual(expect.arrayContaining([`create:${acct.userId}`, `allocateOverride:${manager.userId}`]));
  });
});

describe("integration check (step 4)", () => {
  it("stock valuation still equals the Inventory GL balance", async () => {
    const r = await inventoryReconciliation();
    expect(r.difference.toString()).toBe("0");
  });
});

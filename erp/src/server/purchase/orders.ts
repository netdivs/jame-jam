// Purchase orders and shipments (spec §3.2.2–3.2.3, open items C1 and C6 as proposed).
//  - Status: Draft → Pending Approval → Approved → Partially Received → Received → Closed / Cancelled.
//  - Approval rule comes from company settings (default: every PO, by Owner/Manager).
//  - Goods may be collected / received only after the PO is 100% paid AND the payment is verified.
import type { PoStatus, Prisma, ShipmentStatus } from "@prisma/client";
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, inTx, nextDocNumber, round2, round4, sum, toDateOnly } from "../core";
import { dateStr, decimal, optText, parse, reqText } from "../validation";
import { isStandardPurchaseCode, requireTaxReason } from "../tax-rules";

// ───────────────────────────── Shared helpers ─────────────────────────────

export const EDITABLE: PoStatus[] = ["DRAFT"];
export const RECEIVABLE: PoStatus[] = ["APPROVED", "PARTIALLY_RECEIVED"];
export const LIVE: PoStatus[] = ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"];

/** Lock the PO row for the rest of the transaction and return it. */
export async function lockPo(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Purchase order not found");
  return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true, supplier: true } });
}

/** Line amounts. Purchase prices are VAT-exclusive; reverse-charge VAT is not payable to the supplier. */
export function lineAmounts(sqm: Dec, unitPrice: Dec, tax: { type: string; rate: Prisma.Decimal }) {
  const net = round2(sqm.times(unitPrice));
  const vat = round2(net.times(tax.rate).div(100));
  return tax.type === "RC" ? { net, vat: ZERO, rcVat: vat } : { net, vat, rcVat: ZERO };
}

export const paymentStatusOf = (paid: Dec, total: Dec) =>
  paid.lte(0) ? "UNPAID" : paid.gte(total) ? "PAID" : "PARTIAL";

/** Fully paid and the payment verified: the gate for collection and GRN (R6). */
export function isPaidAndVerified(po: { paidAmount: Prisma.Decimal; total: Prisma.Decimal; paymentVerifiedAt: Date | null }) {
  return po.paymentVerifiedAt !== null && D(po.paidAmount).gte(po.total);
}

export function assertPaidAndVerified(po: { number: string; paidAmount: Prisma.Decimal; total: Prisma.Decimal; paymentVerifiedAt: Date | null }, what: string) {
  if (D(po.paidAmount).lt(po.total)) {
    throw new AppError(
      "VALIDATION",
      `${what} is blocked: PO ${po.number} is paid AED ${D(po.paidAmount).toFixed(2)} of AED ${D(po.total).toFixed(2)}. Suppliers are paid 100% before goods are collected.`,
    );
  }
  if (!po.paymentVerifiedAt) {
    throw new AppError("VALIDATION", `${what} is blocked: the 100% payment on PO ${po.number} has not been verified yet.`);
  }
}

/** Recompute the goods status from line quantities (and close when fully invoiced). */
export async function refreshPoStatus(tx: Tx, poId: string): Promise<PoStatus> {
  const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
  if (!LIVE.includes(po.status)) return po.status;
  const anyReceived = po.items.some((i) => D(i.receivedSqm).gt(0));
  const allReceived = po.items.every((i) => D(i.receivedSqm).gte(i.sqm));
  const allInvoiced = po.items.every((i) => D(i.invoicedSqm).gte(i.receivedSqm));
  let status: PoStatus = anyReceived ? (allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED") : "APPROVED";
  if (status === "RECEIVED" && allInvoiced) status = "CLOSED";
  if (status !== po.status) await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });
  return status;
}

// ───────────────────────────── Create / edit ─────────────────────────────

const lineSchema = z.object({
  productId: reqText("Product"),
  description: optText(200),
  sqm: decimal({ gt: 0, dp: 4, label: "SQM" }),
  unitPrice: decimal({ min: 0, dp: 4, label: "Unit price" }),
  taxCodeId: reqText("Tax code"),
  /** Needed when the tax code is not the standard one (spec §3.3.5). */
  taxReason: optText(500),
});

export const poSchema = z.object({
  supplierId: reqText("Supplier"),
  date: dateStr,
  expectedDate: z.union([dateStr, z.literal("")]).optional().transform((v) => v || undefined),
  terms: optText(2000),
  notes: optText(2000),
  refCurrency: optText(10),
  refRate: z.union([decimal({ gt: 0, dp: 6, label: "Reference rate" }), z.literal("").transform(() => undefined)]).optional(),
  lines: z.array(lineSchema).min(1, "Add at least one line"),
});
export type PoInput = z.input<typeof poSchema>;

async function buildLines(tx: Tx, ctx: Ctx, supplierType: string, lines: z.output<typeof lineSchema>[]) {
  const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } });
  const taxes = await tx.taxCode.findMany({ where: { id: { in: lines.map((l) => l.taxCodeId) } } });
  const pById = new Map(products.map((p) => [p.id, p]));
  const tById = new Map(taxes.map((t) => [t.id, t]));
  return lines.map((l, i) => {
    const p = pById.get(l.productId);
    if (!p || !p.active) throw new AppError("VALIDATION", `Line ${i + 1}: select an active product`);
    const t = tById.get(l.taxCodeId);
    if (!t || !t.active) throw new AppError("VALIDATION", `Line ${i + 1}: select an active tax code`);
    const taxReason = isStandardPurchaseCode(t.type, supplierType) ? null : requireTaxReason(ctx, { line: i + 1, code: t.code, reason: l.taxReason, field: `lines.${i}.taxReason` });
    const sqm = round4(l.sqm);
    const unitPrice = round4(l.unitPrice);
    const a = lineAmounts(sqm, unitPrice, t);
    return {
      lineNo: i + 1,
      productId: p.id,
      description: l.description,
      sqm,
      unitPrice,
      taxCodeId: t.id,
      taxReason,
      netAmount: a.net,
      vatAmount: a.vat.plus(a.rcVat),
      _vat: a.vat,
      _rc: a.rcVat,
    };
  });
}

/** Create a draft PO, or replace a draft PO's header and lines. */
export async function savePurchaseOrder(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "purchase.edit");
  const input = parse(poSchema, raw);
  const date = toDateOnly(input.date);
  return inTx(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || !supplier.active) throw new AppError("VALIDATION", "Select an active supplier");
    const lines = await buildLines(tx, ctx, supplier.supplierType, input.lines);
    const totals = {
      netTotal: sum(lines.map((l) => l.netAmount)),
      vatTotal: sum(lines.map((l) => l._vat)),
      rcVatTotal: sum(lines.map((l) => l._rc)),
    };
    const header = {
      supplierId: supplier.id,
      date,
      expectedDate: input.expectedDate ? toDateOnly(input.expectedDate) : null,
      terms: input.terms ?? null,
      notes: input.notes ?? null,
      refCurrency: input.refCurrency ?? null,
      refRate: input.refRate ?? null,
      ...totals,
      total: totals.netTotal.plus(totals.vatTotal),
    };
    const items = lines.map(({ _vat, _rc, ...l }) => l);

    if (id) {
      const before = await lockPo(tx, id);
      if (!EDITABLE.includes(before.status)) throw new AppError("VALIDATION", `PO ${before.number} is ${before.status.toLowerCase().replace(/_/g, " ")} and can no longer be edited`);
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      const after = await tx.purchaseOrder.update({ where: { id }, data: { ...header, items: { create: items } }, include: { items: true } });
      await audit(tx, ctx, { action: "update", entity: "PurchaseOrder", entityId: id, before, after });
      return after;
    }
    const number = await nextDocNumber(tx, "PO", date);
    const after = await tx.purchaseOrder.create({
      data: { ...header, number, createdById: ctx.userId, items: { create: items } },
      include: { items: true },
    });
    await audit(tx, ctx, { action: "create", entity: "PurchaseOrder", entityId: after.id, after });
    return after;
  });
}

// ───────────────────────────── Approval workflow ─────────────────────────────

/** Submit a draft. Goes to Pending Approval, or straight to Approved when the rule says no approval is needed. */
export async function submitPurchaseOrder(ctx: Ctx, id: string) {
  assertCan(ctx, "purchase.edit");
  return inTx(async (tx) => {
    const po = await lockPo(tx, id);
    if (po.status !== "DRAFT") throw new AppError("VALIDATION", `Only a draft PO can be submitted (PO ${po.number} is ${po.status.toLowerCase().replace(/_/g, " ")})`);
    if (po.items.length === 0) throw new AppError("VALIDATION", "The PO has no lines");
    const s = await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    const needs = s.poApprovalMode === "ALL" || (s.poApprovalMode === "ABOVE_THRESHOLD" && D(po.total).gt(s.poApprovalThreshold));
    const status: PoStatus = needs ? "PENDING_APPROVAL" : "APPROVED";
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: { status, submittedAt: new Date(), rejectionNote: null, ...(needs ? {} : { approvedAt: new Date(), approvedById: ctx.userId }) },
    });
    await audit(tx, ctx, { action: "submit", entity: "PurchaseOrder", entityId: id, before: { status: po.status }, after: { status, approvalRequired: needs } });
    return after;
  });
}

export async function approvePurchaseOrder(ctx: Ctx, id: string) {
  assertCan(ctx, "purchase.approve");
  return inTx(async (tx) => {
    const po = await lockPo(tx, id);
    if (po.status !== "PENDING_APPROVAL") throw new AppError("VALIDATION", `PO ${po.number} is not waiting for approval`);
    const after = await tx.purchaseOrder.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.userId } });
    await audit(tx, ctx, { action: "approve", entity: "PurchaseOrder", entityId: id, before: { status: po.status }, after: { status: after.status } });
    return after;
  });
}

export async function rejectPurchaseOrder(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "purchase.approve");
  const reason = note.trim();
  if (!reason) throw new AppError("VALIDATION", "Give a reason for rejecting", { fields: { note: "Reason is required" } });
  return inTx(async (tx) => {
    const po = await lockPo(tx, id);
    if (po.status !== "PENDING_APPROVAL") throw new AppError("VALIDATION", `PO ${po.number} is not waiting for approval`);
    const after = await tx.purchaseOrder.update({ where: { id }, data: { status: "DRAFT", rejectionNote: reason } });
    await audit(tx, ctx, { action: "reject", entity: "PurchaseOrder", entityId: id, before: { status: po.status }, after: { status: "DRAFT", reason } });
    return after;
  });
}

/** Cancel a PO that has no receipts, payments or landed cost bills. */
export async function cancelPurchaseOrder(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "purchase.edit");
  const why = reason.trim();
  if (!why) throw new AppError("VALIDATION", "Give a reason for cancelling", { fields: { reason: "Reason is required" } });
  return inTx(async (tx) => {
    const po = await lockPo(tx, id);
    if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(po.status)) {
      throw new AppError("VALIDATION", `PO ${po.number} is ${po.status.toLowerCase().replace(/_/g, " ")} and cannot be cancelled`);
    }
    if (D(po.paidAmount).gt(0)) throw new AppError("VALIDATION", `PO ${po.number} has payments of AED ${D(po.paidAmount).toFixed(2)}; it cannot be cancelled`);
    if ((await tx.landedCostExpense.count({ where: { purchaseOrderId: id } })) > 0) {
      throw new AppError("VALIDATION", `PO ${po.number} has landed cost bills; it cannot be cancelled`);
    }
    const after = await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED", cancelReason: why } });
    await audit(tx, ctx, { action: "cancel", entity: "PurchaseOrder", entityId: id, before: { status: po.status }, after: { status: "CANCELLED", reason: why } });
    return after;
  });
}

/** Confirm the supplier has been paid 100%. Unblocks collection and GRN. */
export async function verifyPoPayment(ctx: Ctx, id: string) {
  assertCan(ctx, "purchase.verifyPayment");
  return inTx(async (tx) => {
    const po = await lockPo(tx, id);
    if (!LIVE.includes(po.status)) throw new AppError("VALIDATION", `PO ${po.number} is not approved`);
    if (po.paymentVerifiedAt) throw new AppError("VALIDATION", `Payment on PO ${po.number} is already verified`);
    if (D(po.paidAmount).lt(po.total)) {
      throw new AppError("VALIDATION", `PO ${po.number} is paid AED ${D(po.paidAmount).toFixed(2)} of AED ${D(po.total).toFixed(2)}; only a 100% payment can be verified`);
    }
    const after = await tx.purchaseOrder.update({ where: { id }, data: { paymentVerifiedAt: new Date(), paymentVerifiedById: ctx.userId } });
    await audit(tx, ctx, { action: "verifyPayment", entity: "PurchaseOrder", entityId: id, after: { paidAmount: po.paidAmount, total: po.total } });
    return after;
  });
}

// ───────────────────────────── Shipments ─────────────────────────────

export const SHIPMENT_FLOW: ShipmentStatus[] = ["ORDERED", "IN_TRANSIT", "AT_PORT", "COLLECTED", "RECEIVED"];

export const shipmentSchema = z.object({
  reference: optText(80),
  billOfEntryNo: optText(80),
  containerNos: optText(500),
  eta: z.union([dateStr, z.literal("")]).optional().transform((v) => v || undefined),
  notes: optText(1000),
});

export async function createShipment(ctx: Ctx, poId: string, raw: unknown) {
  assertCan(ctx, "purchase.edit");
  const input = parse(shipmentSchema, raw);
  return inTx(async (tx) => {
    const po = await lockPo(tx, poId);
    if (!RECEIVABLE.includes(po.status)) throw new AppError("VALIDATION", `PO ${po.number} must be approved and not fully received to add a shipment`);
    const number = await nextDocNumber(tx, "SHP", new Date());
    const after = await tx.shipment.create({
      data: { ...input, eta: input.eta ? toDateOnly(input.eta) : null, number, purchaseOrderId: po.id },
    });
    await audit(tx, ctx, { action: "create", entity: "Shipment", entityId: after.id, after });
    return after;
  });
}

/** Move a shipment forward. Collected needs the PO 100% paid and verified; Received is set only by a GRN. */
export async function setShipmentStatus(ctx: Ctx, shipmentId: string, status: ShipmentStatus) {
  if (!["IN_TRANSIT", "AT_PORT", "COLLECTED"].includes(status)) {
    throw new AppError("VALIDATION", "A shipment becomes Received only through a goods receipt (GRN)");
  }
  if (status === "COLLECTED") {
    if (!(ctx.isSystem || ctx.permissions.has("purchase.edit") || ctx.permissions.has("purchase.receive"))) {
      throw new AppError("FORBIDDEN", "You do not have permission: purchase.edit or purchase.receive");
    }
  } else assertCan(ctx, "purchase.edit");

  return inTx(async (tx) => {
    const head = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { purchaseOrderId: true } });
    if (!head) throw new AppError("NOT_FOUND", "Shipment not found");
    // Lock the PO first, then read the shipment, so two concurrent moves cannot both pass the forward-only check.
    const po = await lockPo(tx, head.purchaseOrderId);
    const sh = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    if (SHIPMENT_FLOW.indexOf(status) <= SHIPMENT_FLOW.indexOf(sh.status)) {
      throw new AppError("VALIDATION", `Shipment ${sh.number} is already ${sh.status.toLowerCase().replace(/_/g, " ")}`);
    }
    if (status === "COLLECTED") assertPaidAndVerified(po, "Goods collection");
    const after = await tx.shipment.update({
      where: { id: shipmentId },
      data: { status, ...(status === "COLLECTED" ? { collectedAt: new Date() } : {}) },
    });
    await audit(tx, ctx, { action: "status", entity: "Shipment", entityId: shipmentId, before: { status: sh.status }, after: { status } });
    return after;
  });
}

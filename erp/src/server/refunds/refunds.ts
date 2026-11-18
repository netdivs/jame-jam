// Refund vouchers (spec §3.3.6 "refunds are manual", §3.4.3; T8-06) and supplier advance transfers (T4-15, audit F5).
// Rules (TD-027):
//  - Customer refund (RF): pays back an unapplied customer advance. Dr Customer Advances (party), Cr Cash/Bank.
//    With a proforma: at most the money received on that PI (its received amount goes down, so the PI can then be
//    closed and its SO cancelled). Without a proforma: at most the customer's free advance =
//    advance balance − cheques not yet cleared − money held on proformas.
//  - Supplier refund (RF): the supplier pays back the advance left on a CLOSED PO (all goods received and invoiced,
//    invoice lower than the amount paid). Dr Cash/Bank, Cr Supplier Advances (party). At most the PO's advance.
//  - Advance transfer (AT): the advance left on a CLOSED PO is applied to another approved PO of the same supplier.
//    It counts as paid on the target PO and settles its posted invoices first (Dr AP, Cr Supplier Advances).
//  - Nothing is edited. A wrong refund is cancelled with a reason (reverse entry); a transfer can be cancelled only
//    while the target PO still holds the moved amount as an advance and its payment has not been verified.
//  - Lock order: PI → customer → refund / receipt, and PO (lower id first) → refund / transfer.
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, assertCan, audit, inTx, nextDocNumber, prisma, round2, toDateOnly, today } from "../core";
import { postJournal } from "../accounting/gl";
import { cashAccountFor } from "../accounting/banks";
import { LIVE, lockPo, paymentStatusOf } from "../purchase/orders";
import { settlePoInvoices } from "../purchase/payments";
import { OPEN_RECEIVED } from "../receipts/cheques";
import { dateStr, decimal, optText, parse, reqText } from "../validation";

const base = {
  date: dateStr,
  amount: decimal({ gt: 0, dp: 2, label: "Amount" }),
  mode: z.enum(["CASH", "BANK"], { errorMap: () => ({ message: "Choose cash or bank" }) }),
  bankAccountId: optText(40),
  reference: optText(80),
  reason: reqText("Reason", 500),
};
export const customerRefundSchema = z.object({ ...base, customerId: optText(40), proformaInvoiceId: optText(40) });
export const supplierRefundSchema = z.object({ ...base, purchaseOrderId: reqText("Purchase order") });
export const transferSchema = z.object({
  fromPurchaseOrderId: reqText("From PO"),
  toPurchaseOrderId: reqText("To PO"),
  date: dateStr,
  amount: decimal({ gt: 0, dp: 2, label: "Amount" }),
  reason: reqText("Reason", 500),
});

const cancelSchema = z.object({ reason: reqText("Reason", 500), date: z.union([dateStr, z.literal("")]).optional() });

// ───────────────────────────── Customer side ─────────────────────────────

export async function lockCustomer(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Customer" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Customer not found");
  return tx.customer.findUniqueOrThrow({ where: { id } });
}

async function lockPi(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ProformaInvoice" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Proforma invoice not found");
  return tx.proformaInvoice.findUniqueOrThrow({ where: { id } });
}

export type CustomerAdvancePosition = { balance: Dec; pendingCheques: Dec; onProformas: Dec; free: Dec };

/** What a customer's advance is made of. "free" is what can be refunded without naming a proforma. */
export async function customerAdvancePosition(customerId: string, db: Tx | typeof prisma = prisma): Promise<CustomerAdvancePosition> {
  const [gl, cheques, pis] = await Promise.all([
    db.journalLine.aggregate({
      where: { account: { systemKey: "CUSTOMER_ADVANCES" }, partyType: "CUSTOMER", partyId: customerId },
      _sum: { debit: true, credit: true },
    }),
    db.cheque.aggregate({ where: { direction: "RECEIVED", customerId, status: { in: OPEN_RECEIVED } }, _sum: { amount: true } }),
    db.proformaInvoice.aggregate({ where: { customerId }, _sum: { receivedAmount: true } }),
  ]);
  const balance = D(gl._sum.credit ?? 0).minus(D(gl._sum.debit ?? 0));
  const pendingCheques = D(cheques._sum.amount ?? 0);
  const onProformas = D(pis._sum.receivedAmount ?? 0);
  return { balance, pendingCheques, onProformas, free: balance.minus(pendingCheques).minus(onProformas) };
}

export async function recordCustomerRefund(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "refunds.create");
  const input = parse(customerRefundSchema, raw);
  const date = toDateOnly(input.date);
  const amount = round2(input.amount);
  if (date > today()) throw new AppError("VALIDATION", "A refund cannot be dated in the future", { fields: { date: "Not after today" } });

  return inTx(async (tx) => {
    let customerId = input.customerId;
    let pi: Awaited<ReturnType<typeof lockPi>> | null = null;
    if (input.proformaInvoiceId) {
      pi = await lockPi(tx, input.proformaInvoiceId);
      if (customerId && customerId !== pi.customerId) throw new AppError("VALIDATION", `Proforma ${pi.number} is for another customer`);
      customerId = pi.customerId;
    }
    if (!customerId) throw new AppError("VALIDATION", "Select the customer", { fields: { customerId: "Customer is required" } });
    const customer = await lockCustomer(tx, customerId);
    const pos = await customerAdvancePosition(customer.id, tx);

    if (pi) {
      if (date < pi.date) throw new AppError("VALIDATION", `The refund cannot be dated before proforma ${pi.number}`);
      // Money on a PI is part of the advance balance; never refund more than the customer actually holds.
      const cap = Dec.min(D(pi.receivedAmount), pos.balance.minus(pos.pendingCheques));
      if (amount.gt(cap)) {
        throw new AppError("VALIDATION", `Proforma ${pi.number} has AED ${Dec.max(cap, 0).toFixed(2)} received that can be refunded`, { fields: { amount: `At most ${Dec.max(cap, 0).toFixed(2)}` } });
      }
      await tx.proformaInvoice.update({ where: { id: pi.id }, data: { receivedAmount: D(pi.receivedAmount).minus(amount) } });
    } else if (amount.gt(pos.free)) {
      const free = Dec.max(pos.free, 0);
      throw new AppError(
        "VALIDATION",
        `${customer.name} has AED ${free.toFixed(2)} of free advance to refund (advance AED ${pos.balance.toFixed(2)}, cheques not yet cleared AED ${pos.pendingCheques.toFixed(2)}, held on proformas AED ${pos.onProformas.toFixed(2)} — refund those from the proforma)`,
        { fields: { amount: `At most ${free.toFixed(2)}` } },
      );
    }

    const cash = await cashAccountFor(tx, input.mode, input.bankAccountId);
    const number = await nextDocNumber(tx, "RF", date);
    const refund = await tx.refund.create({
      data: {
        number,
        partyType: "CUSTOMER",
        customerId: customer.id,
        proformaInvoiceId: pi?.id ?? null,
        date,
        amount,
        mode: input.mode,
        bankAccountId: cash.bankAccountId,
        reference: input.reference,
        reason: input.reason,
        createdById: ctx.userId,
      },
    });
    await postJournal(tx, ctx, {
      date,
      sourceType: "REFUND",
      sourceId: refund.id,
      memo: `${number} — refund to ${customer.name}${pi ? ` — ${pi.number}` : ""}: ${input.reason}`,
      lines: [
        { account: "CUSTOMER_ADVANCES", debit: amount, partyType: "CUSTOMER", partyId: customer.id },
        { account: cash.account, credit: amount },
      ],
    });
    await audit(tx, ctx, { action: "create", entity: "Refund", entityId: refund.id, after: { number, party: "CUSTOMER", customer: customer.name, proforma: pi?.number, amount, mode: input.mode, reason: input.reason } });
    return refund;
  });
}

// ───────────────────────────── Supplier side ─────────────────────────────

function assertAdvanceReleasable(po: { number: string; status: string }) {
  if (po.status !== "CLOSED") {
    throw new AppError("VALIDATION", `PO ${po.number} is not closed yet. Its advance is still needed for the goods and invoices to come; only the advance left on a closed PO can be refunded or moved.`);
  }
}

export async function recordSupplierRefund(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "refunds.create");
  const input = parse(supplierRefundSchema, raw);
  const date = toDateOnly(input.date);
  const amount = round2(input.amount);
  if (date > today()) throw new AppError("VALIDATION", "A refund cannot be dated in the future", { fields: { date: "Not after today" } });

  return inTx(async (tx) => {
    const po = await lockPo(tx, input.purchaseOrderId);
    assertAdvanceReleasable(po);
    if (amount.gt(po.advanceBalance)) {
      throw new AppError("VALIDATION", `PO ${po.number} has AED ${D(po.advanceBalance).toFixed(2)} of advance left`, { fields: { amount: `At most ${D(po.advanceBalance).toFixed(2)}` } });
    }
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { advanceBalance: D(po.advanceBalance).minus(amount) } });
    const cash = await cashAccountFor(tx, input.mode, input.bankAccountId);
    const number = await nextDocNumber(tx, "RF", date);
    const refund = await tx.refund.create({
      data: {
        number,
        partyType: "SUPPLIER",
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        date,
        amount,
        mode: input.mode,
        bankAccountId: cash.bankAccountId,
        reference: input.reference,
        reason: input.reason,
        createdById: ctx.userId,
      },
    });
    await postJournal(tx, ctx, {
      date,
      sourceType: "REFUND",
      sourceId: refund.id,
      memo: `${number} — refund from ${po.supplier.name} — PO ${po.number}: ${input.reason}`,
      lines: [
        { account: cash.account, debit: amount },
        { account: "SUPPLIER_ADVANCES", credit: amount, partyType: "SUPPLIER", partyId: po.supplierId },
      ],
    });
    await audit(tx, ctx, { action: "create", entity: "Refund", entityId: refund.id, after: { number, party: "SUPPLIER", supplier: po.supplier.name, po: po.number, amount, mode: input.mode, reason: input.reason } });
    return refund;
  });
}

/** Cancel a refund: reverse entry, and the PI / PO gets its amount back. */
export async function cancelRefund(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "refunds.cancel");
  const input = parse(cancelSchema, raw);
  const date = input.date ? toDateOnly(input.date) : today();
  return inTx(async (tx) => {
    const r0 = await tx.refund.findUnique({ where: { id } });
    if (!r0) throw new AppError("NOT_FOUND", "Refund not found");
    // Same lock order as recording.
    if (r0.proformaInvoiceId) await lockPi(tx, r0.proformaInvoiceId);
    if (r0.customerId) await lockCustomer(tx, r0.customerId);
    if (r0.purchaseOrderId) await lockPo(tx, r0.purchaseOrderId);
    await tx.$queryRaw`SELECT "id" FROM "Refund" WHERE "id" = ${id} FOR UPDATE`;
    const r = await tx.refund.findUniqueOrThrow({ where: { id }, include: { customer: true, supplier: true } });
    if (r.status !== "POSTED") throw new AppError("VALIDATION", `Refund ${r.number} is already cancelled`);
    if (date < r.date) throw new AppError("VALIDATION", "The cancellation cannot be dated before the refund");

    if (r.partyType === "SUPPLIER" && r.purchaseOrderId) {
      // Undoing a supplier refund puts the advance back on the PO.
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: r.purchaseOrderId } });
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { advanceBalance: D(po.advanceBalance).plus(r.amount) } });
    }
    if (r.proformaInvoiceId) {
      const pi = await tx.proformaInvoice.findUniqueOrThrow({ where: { id: r.proformaInvoiceId } });
      if (pi.status === "CLOSED" || pi.status === "CANCELLED") {
        throw new AppError("VALIDATION", `Proforma ${pi.number} is ${pi.status.toLowerCase()}; the refund cannot be put back on it`);
      }
      await tx.proformaInvoice.update({ where: { id: pi.id }, data: { receivedAmount: D(pi.receivedAmount).plus(r.amount) } });
    }

    const original = await tx.journalEntry.findFirstOrThrow({ where: { sourceType: "REFUND", sourceId: r.id }, include: { lines: true } });
    const party = r.customer?.name ?? r.supplier?.name ?? "";
    await postJournal(tx, ctx, {
      date,
      sourceType: "REFUND_CANCEL",
      sourceId: r.id,
      memo: `Cancel ${r.number} — ${party}: ${input.reason}`,
      lines: original.lines.map((l) => ({
        accountId: l.accountId,
        debit: D(l.credit),
        credit: D(l.debit),
        partyType: (l.partyType as "CUSTOMER" | "SUPPLIER" | null) ?? undefined,
        partyId: l.partyId ?? undefined,
      })),
    });
    const after = await tx.refund.update({ where: { id }, data: { status: "CANCELLED", cancelReason: input.reason, cancelledAt: new Date(), cancelledById: ctx.userId } });
    await audit(tx, ctx, { action: "cancel", entity: "Refund", entityId: id, before: { status: r.status }, after: { status: after.status, reason: input.reason } });
    return after;
  });
}

// ───────────────────────────── Advance transfer (T4-15) ─────────────────────────────

/** Lock two POs in a fixed order (lower id first) so two transfers between the same POs cannot deadlock. */
async function lockPair(tx: Tx, a: string, b: string) {
  const [first, second] = a < b ? [a, b] : [b, a];
  const p1 = await lockPo(tx, first);
  const p2 = await lockPo(tx, second);
  return a < b ? [p1, p2] : [p2, p1];
}

export async function transferSupplierAdvance(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "payments.supplier");
  const input = parse(transferSchema, raw);
  const date = toDateOnly(input.date);
  const amount = round2(input.amount);
  if (input.fromPurchaseOrderId === input.toPurchaseOrderId) throw new AppError("VALIDATION", "Choose a different PO to move the advance to", { fields: { toPurchaseOrderId: "Must be another PO" } });
  if (date > today()) throw new AppError("VALIDATION", "A transfer cannot be dated in the future");

  return inTx(async (tx) => {
    const [from, to] = await lockPair(tx, input.fromPurchaseOrderId, input.toPurchaseOrderId);
    assertAdvanceReleasable(from);
    if (to.supplierId !== from.supplierId) throw new AppError("VALIDATION", `PO ${to.number} is for another supplier`, { fields: { toPurchaseOrderId: "Same supplier only" } });
    if (!LIVE.includes(to.status) || to.status === "CLOSED") throw new AppError("VALIDATION", `PO ${to.number} must be approved and not closed to take an advance`);
    if (amount.gt(from.advanceBalance)) {
      throw new AppError("VALIDATION", `PO ${from.number} has AED ${D(from.advanceBalance).toFixed(2)} of advance left`, { fields: { amount: `At most ${D(from.advanceBalance).toFixed(2)}` } });
    }
    // Same cap as a payment on the target PO (TD-011): never paid beyond its total.
    const invoiced = D((await tx.supplierInvoice.aggregate({ where: { purchaseOrderId: to.id }, _sum: { total: true } }))._sum.total ?? 0);
    const cap = Dec.max(D(to.total), invoiced);
    const pending = D((await tx.cheque.aggregate({ where: { purchaseOrderId: to.id, status: "ISSUED" }, _sum: { amount: true } }))._sum.amount ?? 0);
    const open = cap.minus(to.paidAmount).minus(pending);
    if (amount.gt(open)) {
      throw new AppError("VALIDATION", `PO ${to.number} can take at most AED ${Dec.max(open, 0).toFixed(2)} more`, { fields: { amount: `At most ${Dec.max(open, 0).toFixed(2)}` } });
    }

    const toPayable = await settlePoInvoices(tx, to.id, amount);
    const toAdvance = amount.minus(toPayable);
    const paid = D(to.paidAmount).plus(amount);
    await tx.purchaseOrder.update({ where: { id: from.id }, data: { advanceBalance: D(from.advanceBalance).minus(amount) } });
    await tx.purchaseOrder.update({
      where: { id: to.id },
      data: { paidAmount: paid, advanceBalance: D(to.advanceBalance).plus(toAdvance), paymentStatus: paymentStatusOf(paid, D(to.total)) },
    });
    const number = await nextDocNumber(tx, "AT", date);
    const t = await tx.supplierAdvanceTransfer.create({
      data: { number, supplierId: from.supplierId, fromPurchaseOrderId: from.id, toPurchaseOrderId: to.id, date, amount, toPayable, toAdvance, reason: input.reason, createdById: ctx.userId },
    });
    if (toPayable.gt(0)) {
      const party = { partyType: "SUPPLIER" as const, partyId: from.supplierId };
      await postJournal(tx, ctx, {
        date,
        sourceType: "ADVANCE_TRANSFER",
        sourceId: t.id,
        memo: `${number} — ${from.supplier.name} — advance from PO ${from.number} applied to PO ${to.number}`,
        lines: [
          { account: "AP", debit: toPayable, ...party },
          { account: "SUPPLIER_ADVANCES", credit: toPayable, ...party },
        ],
      });
    }
    await audit(tx, ctx, { action: "create", entity: "SupplierAdvanceTransfer", entityId: t.id, after: { number, from: from.number, to: to.number, amount, toPayable, toAdvance, reason: input.reason } });
    return t;
  });
}

/** Undo a transfer that is still only an advance on the target PO (nothing settled, payment not verified). */
export async function cancelAdvanceTransfer(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "payments.supplier");
  const input = parse(cancelSchema, raw);
  return inTx(async (tx) => {
    const t0 = await tx.supplierAdvanceTransfer.findUnique({ where: { id } });
    if (!t0) throw new AppError("NOT_FOUND", "Transfer not found");
    const [from, to] = await lockPair(tx, t0.fromPurchaseOrderId, t0.toPurchaseOrderId);
    await tx.$queryRaw`SELECT "id" FROM "SupplierAdvanceTransfer" WHERE "id" = ${id} FOR UPDATE`;
    const t = await tx.supplierAdvanceTransfer.findUniqueOrThrow({ where: { id } });
    if (t.status !== "POSTED") throw new AppError("VALIDATION", `Transfer ${t.number} is already cancelled`);
    if (D(t.toPayable).gt(0)) throw new AppError("VALIDATION", `Transfer ${t.number} already settled invoices of PO ${to.number}; it cannot be cancelled`);
    if (to.paymentVerifiedAt) throw new AppError("VALIDATION", `PO ${to.number}'s payment is verified; the transfer cannot be cancelled`);
    if (D(to.advanceBalance).lt(t.amount)) throw new AppError("VALIDATION", `PO ${to.number} no longer holds AED ${D(t.amount).toFixed(2)} as an advance; it has been used`);
    const paid = D(to.paidAmount).minus(t.amount);
    await tx.purchaseOrder.update({ where: { id: to.id }, data: { paidAmount: paid, advanceBalance: D(to.advanceBalance).minus(t.amount), paymentStatus: paymentStatusOf(paid, D(to.total)) } });
    await tx.purchaseOrder.update({ where: { id: from.id }, data: { advanceBalance: D(from.advanceBalance).plus(t.amount) } });
    const after = await tx.supplierAdvanceTransfer.update({ where: { id }, data: { status: "CANCELLED", cancelReason: input.reason, cancelledAt: new Date(), cancelledById: ctx.userId } });
    await audit(tx, ctx, { action: "cancel", entity: "SupplierAdvanceTransfer", entityId: id, before: { status: t.status }, after: { status: after.status, reason: input.reason } });
    return after;
  });
}

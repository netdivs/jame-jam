// Tax credit notes (spec §3.3.8, T7-02, R2). Behind features.salesInvoicing (TD-045, TD-049).
//  - RETURN: from a received return; credits the accepted SQM (GOOD / DAMAGED) at the invoice line's amounts,
//    in proportion. Posted at once (the return was already approved by Owner/Manager).
//  - ADJUSTMENT: price / discount / billing correction with a reason; never moves stock. Waits for Owner/Manager
//    approval (creditNotes.approve); one created by an approver is approved by them at once.
//  - Per invoice line, credit notes never exceed the line total (incl. VAT).
//  - Posting (numbered then, gap-free): Dr Sales Returns (net) + Dr VAT Output (VAT) / Cr AR up to what is still
//    owed on the invoice, the rest Cr Customer Advances (C7 proposal; setting creditNotes.paidInvoiceTreatment
//    decides whether the screen then asks for a refund voucher).
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, can, inTx, nextDocNumber, round2, sum, toDateOnly, today } from "../core";
import { postJournal } from "../accounting/gl";
import { dateStr, decimal, parse, reqText } from "../validation";
import { assertSalesInvoicing, tiOpenAmount, tiPaymentStatus } from "./invoices";
import { salesRate } from "./vat";

type Line = { taxInvoiceItemId: string; sqm: Dec; net: Dec; vat: Dec; gross: Dec };

async function lockTi(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "TaxInvoice" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Tax invoice not found");
  return tx.taxInvoice.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { lineNo: "asc" }, include: { taxCode: true } }, customer: true } });
}
type TiFull = Awaited<ReturnType<typeof lockTi>>;

function checkCaps(ti: TiFull, lines: Line[]) {
  for (const l of lines) {
    const it = ti.items.find((i) => i.id === l.taxInvoiceItemId);
    if (!it) throw new AppError("VALIDATION", "A line does not belong to this tax invoice");
    const left = D(it.grossAmount).minus(it.creditedAmount);
    if (l.gross.gt(left)) throw new AppError("VALIDATION", `Invoice line ${it.lineNo}: at most AED ${left.toFixed(2)} can still be credited`);
  }
}

/** Number and post a credit note; the invoice is locked by the caller. */
async function post(tx: Tx, ctx: Ctx, ti: TiFull, cnId: string, date: Date, lines: Line[]) {
  checkCaps(ti, lines);
  const net = sum(lines.map((l) => l.net));
  const vat = sum(lines.map((l) => l.vat));
  const total = net.plus(vat);
  const toReceivable = Dec.max(Dec.min(total, tiOpenAmount(ti)), ZERO);
  const toAdvance = total.minus(toReceivable);
  const number = await nextDocNumber(tx, "CN", date);
  for (const l of lines) {
    const it = ti.items.find((i) => i.id === l.taxInvoiceItemId)!;
    await tx.taxInvoiceItem.update({ where: { id: it.id }, data: { creditedAmount: D(it.creditedAmount).plus(l.gross) } });
  }
  const credited = D(ti.creditedAmount).plus(toReceivable);
  await tx.taxInvoice.update({ where: { id: ti.id }, data: { creditedAmount: credited, paymentStatus: tiPaymentStatus({ ...ti, creditedAmount: credited }) } });
  const cn = await tx.creditNote.update({ where: { id: cnId }, data: { number, status: "POSTED", toReceivable, toAdvance } });
  const party = { partyType: "CUSTOMER" as const, partyId: ti.customerId };
  await postJournal(tx, ctx, {
    date,
    sourceType: "CREDIT_NOTE",
    sourceId: cnId,
    memo: `${number} — ${ti.customerName} — on ${ti.number}`,
    lines: [
      { account: "SALES_RETURNS", debit: net },
      { account: "VAT_OUTPUT", debit: vat },
      { account: "AR", credit: toReceivable, ...party },
      { account: "CUSTOMER_ADVANCES", credit: toAdvance, ...party },
    ],
  });
  return cn;
}

// ───────────────────────────── Return-based ─────────────────────────────

const dateOnly = z.object({ date: dateStr });

export async function createReturnCreditNote(ctx: Ctx, returnRequestId: string, raw: unknown) {
  assertCan(ctx, "creditNotes.create");
  const date = toDateOnly(parse(dateOnly, raw).date);
  if (date > today()) throw new AppError("VALIDATION", "Cannot be dated in the future", { fields: { date: "Not after today" } });
  return inTx(async (tx) => {
    await assertSalesInvoicing(tx);
    const head = await tx.returnRequest.findUnique({ where: { id: returnRequestId }, select: { taxInvoiceId: true } });
    if (!head) throw new AppError("NOT_FOUND", "Return request not found");
    const ti = await lockTi(tx, head.taxInvoiceId); // invoice, then return (same order everywhere)
    await tx.$queryRaw`SELECT "id" FROM "ReturnRequest" WHERE "id" = ${returnRequestId} FOR UPDATE`;
    const rr = await tx.returnRequest.findUniqueOrThrow({ where: { id: returnRequestId }, include: { items: { orderBy: { lineNo: "asc" } } } });
    if (rr.status !== "RECEIVED") throw new AppError("VALIDATION", `Return ${rr.number} is ${rr.status.toLowerCase()}; a credit note is made once the goods are received`);
    if (date < rr.date) throw new AppError("VALIDATION", "Cannot be dated before the return");
    const lines: Line[] = rr.items
      .filter((i) => i.condition !== "REJECTED" && D(i.receivedSqm).gt(0))
      .map((i) => {
        const it = ti.items.find((x) => x.id === i.taxInvoiceItemId)!;
        const share = D(i.receivedSqm).div(it.sqm);
        const full = D(i.receivedSqm).eq(it.sqm);
        const netA = full ? D(it.netAmount) : round2(D(it.netAmount).times(share));
        const vatA = full ? D(it.vatAmount) : round2(D(it.vatAmount).times(share));
        return { taxInvoiceItemId: it.id, sqm: D(i.receivedSqm), net: netA, vat: vatA, gross: netA.plus(vatA) };
      });
    if (lines.length === 0) throw new AppError("VALIDATION", `Nothing was accepted back on ${rr.number}; there is nothing to credit`);
    const cn = await tx.creditNote.create({
      data: {
        kind: "RETURN",
        status: "PENDING_APPROVAL",
        taxInvoiceId: ti.id,
        returnRequestId: rr.id,
        customerId: ti.customerId,
        customerName: ti.customerName,
        customerTrn: ti.customerTrn,
        date,
        reason: `Goods returned (${rr.number}): ${rr.reason}`,
        netTotal: sum(lines.map((l) => l.net)),
        vatTotal: sum(lines.map((l) => l.vat)),
        total: sum(lines.map((l) => l.gross)),
        decidedById: rr.decidedById,
        decidedAt: rr.decidedAt,
        createdById: ctx.userId,
        items: { create: lines.map((l, i) => ({ lineNo: i + 1, taxInvoiceItemId: l.taxInvoiceItemId, sqm: l.sqm, netAmount: l.net, vatAmount: l.vat, grossAmount: l.gross })) },
      },
    });
    const posted = await post(tx, ctx, ti, cn.id, date, lines);
    await tx.returnRequest.update({ where: { id: rr.id }, data: { status: "CREDITED" } });
    await audit(tx, ctx, { action: "create", entity: "CreditNote", entityId: cn.id, after: { number: posted.number, kind: "RETURN", invoice: ti.number, return: rr.number, total: posted.total, toReceivable: posted.toReceivable, toAdvance: posted.toAdvance } });
    return posted;
  });
}

// ───────────────────────────── Adjustment ─────────────────────────────

export const adjustmentSchema = z.object({
  taxInvoiceId: reqText("Tax invoice"),
  date: dateStr,
  reason: reqText("Reason", 1000),
  /** Per invoice line, the amount to credit in the invoice's price mode (incl. VAT for a VAT-inclusive invoice). */
  lines: z.array(z.object({ taxInvoiceItemId: z.string().min(1), amount: decimal({ min: 0, dp: 2, label: "Amount" }) })).min(1),
});

export async function createAdjustmentCreditNote(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "creditNotes.create");
  const input = parse(adjustmentSchema, raw);
  const date = toDateOnly(input.date);
  if (date > today()) throw new AppError("VALIDATION", "Cannot be dated in the future", { fields: { date: "Not after today" } });
  return inTx(async (tx) => {
    await assertSalesInvoicing(tx);
    const ti = await lockTi(tx, input.taxInvoiceId);
    if (date < ti.date) throw new AppError("VALIDATION", "Cannot be dated before the invoice");
    const seen = new Set<string>();
    const lines: Line[] = input.lines
      .filter((l) => l.amount.gt(0))
      .map((l) => {
        const it = ti.items.find((i) => i.id === l.taxInvoiceItemId);
        if (!it) throw new AppError("VALIDATION", "A line does not belong to this tax invoice");
        if (seen.has(it.id)) throw new AppError("VALIDATION", `Invoice line ${it.lineNo} appears twice`);
        seen.add(it.id);
        const rate = salesRate(it.taxCode);
        const amount = round2(l.amount);
        const vat = ti.priceMode === "INCLUSIVE" ? round2(amount.times(rate).div(D(100).plus(rate))) : round2(amount.times(rate).div(100));
        const net = ti.priceMode === "INCLUSIVE" ? amount.minus(vat) : amount;
        return { taxInvoiceItemId: it.id, sqm: ZERO, net, vat, gross: net.plus(vat) };
      });
    if (lines.length === 0) throw new AppError("VALIDATION", "Enter an amount on at least one line");
    checkCaps(ti, lines);
    const selfApproved = can(ctx, "creditNotes.approve");
    const cn = await tx.creditNote.create({
      data: {
        kind: "ADJUSTMENT",
        status: "PENDING_APPROVAL",
        taxInvoiceId: ti.id,
        customerId: ti.customerId,
        customerName: ti.customerName,
        customerTrn: ti.customerTrn,
        date,
        reason: input.reason,
        netTotal: sum(lines.map((l) => l.net)),
        vatTotal: sum(lines.map((l) => l.vat)),
        total: sum(lines.map((l) => l.gross)),
        createdById: ctx.userId,
        ...(selfApproved ? { decidedById: ctx.userId, decidedAt: new Date(), decisionNote: "Created by an approver" } : {}),
        items: { create: lines.map((l, i) => ({ lineNo: i + 1, taxInvoiceItemId: l.taxInvoiceItemId, sqm: ZERO, netAmount: l.net, vatAmount: l.vat, grossAmount: l.gross })) },
      },
    });
    const result = selfApproved ? await post(tx, ctx, ti, cn.id, date, lines) : cn;
    await audit(tx, ctx, { action: "create", entity: "CreditNote", entityId: cn.id, after: { kind: "ADJUSTMENT", invoice: ti.number, reason: input.reason, total: cn.total, status: result.status, number: result.number } });
    return result;
  });
}

export async function decideCreditNote(ctx: Ctx, id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  assertCan(ctx, "creditNotes.approve");
  const why = note?.trim() || null;
  if (decision === "REJECTED" && !why) throw new AppError("VALIDATION", "Give a reason for rejecting", { fields: { note: "Reason is required" } });
  return inTx(async (tx) => {
    await assertSalesInvoicing(tx);
    const head = await tx.creditNote.findUnique({ where: { id }, select: { taxInvoiceId: true } });
    if (!head) throw new AppError("NOT_FOUND", "Credit note not found");
    const ti = await lockTi(tx, head.taxInvoiceId);
    await tx.$queryRaw`SELECT "id" FROM "CreditNote" WHERE "id" = ${id} FOR UPDATE`;
    const cn = await tx.creditNote.findUniqueOrThrow({ where: { id }, include: { items: true } });
    if (cn.status !== "PENDING_APPROVAL") throw new AppError("VALIDATION", `This credit note is already ${cn.status.toLowerCase().replace("_", " ")}`);
    await tx.creditNote.update({ where: { id }, data: { decidedById: ctx.userId, decidedAt: new Date(), decisionNote: why, ...(decision === "REJECTED" ? { status: "REJECTED" } : {}) } });
    const result =
      decision === "APPROVED"
        ? await post(tx, ctx, ti, id, cn.date, cn.items.map((i) => ({ taxInvoiceItemId: i.taxInvoiceItemId, sqm: D(i.sqm), net: D(i.netAmount), vat: D(i.vatAmount), gross: D(i.grossAmount) })))
        : await tx.creditNote.findUniqueOrThrow({ where: { id } });
    await audit(tx, ctx, { action: decision === "APPROVED" ? "approve" : "reject", entity: "CreditNote", entityId: id, before: { status: "PENDING_APPROVAL" }, after: { status: result.status, number: result.number, note: why } });
    return result;
  });
}

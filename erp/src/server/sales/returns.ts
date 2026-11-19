// Sales returns (spec §3.3.8, T7-01, BD-07, BD-09, acceptance R4). Behind features.salesInvoicing (TD-045, TD-049).
//   Request (returns.create) → Owner/Manager approve or reject (returns.approve, nobody else) → store records what
//   physically came back and its condition (returns.receive) → stock in → return credit note (credit-notes.ts).
//  - Only delivered goods can come back: per invoice line, requested ≤ delivered − already returned / requested.
//  - Stock goes up ONLY by approved AND received SQM in condition GOOD or DAMAGED, into the bucket it left from,
//    at the cost it left at (Dr Inventory / Cr COGS). REJECTED: not taken back, not credited.
//  - DAMAGED slabs are marked DAMAGED (not sellable); damaged tiles go back to their bucket for a write-off.
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, inTx, nextDocNumber, round2, round4, sum, toDateOnly, today } from "../core";
import { lockBalance, postInventoryChange, refreshSlabStatus, writeMovement } from "../inventory/stock";
import { dateStr, decimal, optText, parse, reqText } from "../validation";
import { assertSalesInvoicing } from "./invoices";

const LIVE_RR = ["PENDING", "APPROVED", "RECEIVED", "CREDITED"] as const;

async function lockRr(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ReturnRequest" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Return request not found");
  return tx.returnRequest.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { lineNo: "asc" }, include: { taxInvoiceItem: { include: { salesOrderItem: true } } } } } });
}

/** SQM per invoice line that can still be asked back: delivered − on live requests (received ones count what was accepted). */
export async function returnableByLine(tx: Tx, taxInvoiceId: string) {
  const ti = await tx.taxInvoice.findUniqueOrThrow({ where: { id: taxInvoiceId }, include: { items: true } });
  const rr = await tx.returnRequestItem.findMany({ where: { returnRequest: { taxInvoiceId, status: { in: [...LIVE_RR] } } }, include: { returnRequest: { select: { status: true } } } });
  const used = new Map<string, Dec>();
  for (const i of rr) {
    const received = ["RECEIVED", "CREDITED"].includes(i.returnRequest.status);
    const q = received ? (i.condition === "REJECTED" ? ZERO : D(i.receivedSqm)) : D(i.sqm);
    used.set(i.taxInvoiceItemId, (used.get(i.taxInvoiceItemId) ?? ZERO).plus(q));
  }
  return new Map(ti.items.map((i) => [i.id, D(i.deliveredSqm).minus(used.get(i.id) ?? ZERO)]));
}

// ───────────────────────────── Request ─────────────────────────────

export const rrSchema = z.object({
  taxInvoiceId: reqText("Tax invoice"),
  date: dateStr,
  reason: reqText("Reason", 1000),
  lines: z.array(z.object({ taxInvoiceItemId: z.string().min(1), sqm: decimal({ min: 0, dp: 4, label: "SQM" }) })).min(1, "Add at least one line"),
});

export async function createReturnRequest(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "returns.create");
  const input = parse(rrSchema, raw);
  const date = toDateOnly(input.date);
  if (date > today()) throw new AppError("VALIDATION", "A return cannot be dated in the future", { fields: { date: "Not after today" } });
  return inTx(async (tx) => {
    await assertSalesInvoicing(tx);
    await tx.$queryRaw`SELECT "id" FROM "TaxInvoice" WHERE "id" = ${input.taxInvoiceId} FOR UPDATE`;
    const ti = await tx.taxInvoice.findUnique({ where: { id: input.taxInvoiceId }, include: { items: true } });
    if (!ti) throw new AppError("NOT_FOUND", "Tax invoice not found");
    if (date < ti.date) throw new AppError("VALIDATION", "A return cannot be dated before the invoice");
    const open = await returnableByLine(tx, ti.id);
    const seen = new Set<string>();
    const lines = input.lines
      .map((l) => ({ ...l, sqm: round4(l.sqm) }))
      .filter((l) => l.sqm.gt(0))
      .map((l) => {
        const it = ti.items.find((i) => i.id === l.taxInvoiceItemId);
        if (!it) throw new AppError("VALIDATION", "A line does not belong to this tax invoice");
        if (seen.has(it.id)) throw new AppError("VALIDATION", `Invoice line ${it.lineNo} appears twice`);
        seen.add(it.id);
        const left = open.get(it.id) ?? ZERO;
        if (l.sqm.gt(left)) throw new AppError("VALIDATION", `Invoice line ${it.lineNo}: only ${left.toFixed(4).replace(/\.?0+$/, "") || "0"} SQM delivered and not already returned`);
        return { it, sqm: l.sqm };
      });
    if (lines.length === 0) throw new AppError("VALIDATION", "Enter the SQM to return on at least one line");
    const number = await nextDocNumber(tx, "RR", date);
    const rr = await tx.returnRequest.create({
      data: {
        number,
        taxInvoiceId: ti.id,
        customerId: ti.customerId,
        customerName: ti.customerName,
        date,
        reason: input.reason,
        createdById: ctx.userId,
        items: { create: lines.map((l, i) => ({ lineNo: i + 1, taxInvoiceItemId: l.it.id, sqm: l.sqm })) },
      },
      include: { items: true },
    });
    await audit(tx, ctx, { action: "create", entity: "ReturnRequest", entityId: rr.id, after: { number, invoice: ti.number, reason: input.reason, lines: lines.map((l) => ({ line: l.it.lineNo, sqm: l.sqm })) } });
    return rr;
  });
}

// ───────────────────────────── Approval (BD-09: Owner / Manager only) ─────────────────────────────

export async function decideReturnRequest(ctx: Ctx, id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  assertCan(ctx, "returns.approve");
  const why = note?.trim() || null;
  if (decision === "REJECTED" && !why) throw new AppError("VALIDATION", "Give a reason for rejecting", { fields: { note: "Reason is required" } });
  return inTx(async (tx) => {
    await assertSalesInvoicing(tx);
    const rr = await lockRr(tx, id);
    if (rr.status !== "PENDING") throw new AppError("VALIDATION", `Return ${rr.number} is already ${rr.status.toLowerCase()}`);
    const after = await tx.returnRequest.update({ where: { id }, data: { status: decision, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: why } });
    await audit(tx, ctx, { action: decision === "APPROVED" ? "approve" : "reject", entity: "ReturnRequest", entityId: id, before: { status: "PENDING" }, after: { status: decision, note: why } });
    return after;
  });
}

// ───────────────────────────── Physical receipt ─────────────────────────────

export const receiveSchema = z.object({
  date: dateStr,
  lines: z
    .array(
      z.object({
        returnRequestItemId: z.string().min(1),
        receivedSqm: decimal({ min: 0, dp: 4, label: "SQM received" }),
        condition: z.enum(["GOOD", "DAMAGED", "REJECTED"], { error: "Choose the condition" }),
      }),
    )
    .min(1),
  notes: optText(1000),
});

/** Delivered cost per SQM of an invoice line (what the goods left at). */
async function deliveredUnitCost(tx: Tx, taxInvoiceItemId: string): Promise<Dec> {
  const a = await tx.deliveryNoteItem.aggregate({ where: { taxInvoiceItemId }, _sum: { sqm: true, cost: true } });
  const sqm = D(a._sum.sqm ?? 0);
  return sqm.isZero() ? ZERO : D(a._sum.cost ?? 0).div(sqm);
}

export async function receiveReturn(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "returns.receive");
  const input = parse(receiveSchema, raw);
  const date = toDateOnly(input.date);
  if (date > today()) throw new AppError("VALIDATION", "Cannot be dated in the future", { fields: { date: "Not after today" } });
  return inTx(async (tx) => {
    await assertSalesInvoicing(tx);
    const rr = await lockRr(tx, id);
    if (rr.status !== "APPROVED") throw new AppError("VALIDATION", `Return ${rr.number} is ${rr.status.toLowerCase()}; only an approved return can be received`);
    if (date < rr.date) throw new AppError("VALIDATION", "Cannot be dated before the return request");
    const byId = new Map(input.lines.map((l) => [l.returnRequestItemId, l]));
    if (input.lines.some((l) => !rr.items.some((i) => i.id === l.returnRequestItemId))) throw new AppError("VALIDATION", "A line does not belong to this return");

    const values: Dec[] = [];
    const log: unknown[] = [];
    for (const it of rr.items) {
      const l = byId.get(it.id);
      if (!l) throw new AppError("VALIDATION", `Return line ${it.lineNo}: enter what was received`);
      const qty = round4(l.receivedSqm);
      if (qty.gt(it.sqm)) throw new AppError("VALIDATION", `Return line ${it.lineNo}: at most the approved ${D(it.sqm).toFixed(4).replace(/\.?0+$/, "")} SQM`);
      let value = ZERO;
      if (qty.gt(0) && l.condition !== "REJECTED") {
        const b = await lockBalance(tx, it.taxInvoiceItem.salesOrderItem.balanceId);
        value = round2(qty.times(await deliveredUnitCost(tx, it.taxInvoiceItemId)));
        await writeMovement(tx, ctx, b, { type: "RETURN_IN", sqm: qty, value, date, refType: "RETURN_REQUEST", refId: rr.id, reason: `${rr.number}: ${l.condition.toLowerCase()}` });
        if (b.slabId) {
          await tx.slabOperation.create({ data: { type: "RETURN", slabId: b.slabId, refType: "RETURN_REQUEST", refId: rr.id, sqm: qty, notes: l.condition, userId: ctx.userId } });
          if (l.condition === "DAMAGED") await tx.slab.update({ where: { id: b.slabId }, data: { status: "DAMAGED" } });
          else await refreshSlabStatus(tx, b.slabId);
        }
        values.push(value);
      }
      await tx.returnRequestItem.update({ where: { id: it.id }, data: { receivedSqm: qty, condition: l.condition, value } });
      log.push({ line: it.lineNo, approved: it.sqm, received: qty, condition: l.condition, value });
    }
    await postInventoryChange(tx, ctx, { date, sourceType: "RETURN_REQUEST", sourceId: rr.id, memo: `${rr.number} — goods back from ${rr.customerName}`, values: [sum(values)], offsetAccount: "COGS" });
    const after = await tx.returnRequest.update({ where: { id }, data: { status: "RECEIVED", receivedById: ctx.userId, receivedAt: new Date() } });
    await audit(tx, ctx, { action: "receive", entity: "ReturnRequest", entityId: id, before: { status: "APPROVED" }, after: { status: "RECEIVED", lines: log, notes: input.notes } });
    return after;
  });
}

// Proforma invoices (spec §3.3.3, BD-06, acceptance R1).
//  - Created only from a sales order (BD-01); the backend refuses anything else.
//  - Expiry date = PI date + piValidityDays (company setting, default 15). Valid up to and including that date.
//  - The daily job (TJ-01, not built yet) calls expireProformaInvoices; until then a PI past its expiry date is
//    also treated as expired wherever it is used (assertPiUsable).
//  - An expired PI cannot be paid or converted until renewed by a user with sales.renewPi; renewals are audited.
//  - A PI posts no accounting or VAT entries.
import type { PiStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError, Ctx, D, Tx, ZERO, assertCan, audit, inTx, nextDocNumber, round2, round4, sum, systemCtx, toDateOnly, today } from "../core";
import { dateStr, decimal, optText, parse, reqText } from "../validation";
import { SO_LIVE, customerSnapshot, lockSo, soStatusLabel } from "./orders";
import { computeDocument, salesRate } from "./vat";

/** PIs that still quote their SO (count against its open quantity). */
export const PI_OPEN: PiStatus[] = ["ACTIVE", "EXPIRED"];

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/**
 * ACTIVE but past its expiry date counts as expired, even before the daily job has run.
 * Only unpaid PIs expire (spec §3.3.3): once money is received against a PI it stays usable.
 */
export function effectivePiStatus(pi: { status: PiStatus; expiryDate: Date; receivedAmount?: Prisma.Decimal | null }, asOf: Date = today()): PiStatus {
  const paid = pi.receivedAmount ? D(pi.receivedAmount).gt(0) : false;
  return pi.status === "ACTIVE" && !paid && pi.expiryDate < asOf ? "EXPIRED" : pi.status;
}

/** Gate for paying against or converting a PI (Step 6 receipts, T5-06 tax invoices). */
export function assertPiUsable(pi: { number: string; status: PiStatus; expiryDate: Date; receivedAmount?: Prisma.Decimal | null }, what: string, asOf: Date = today()) {
  const s = effectivePiStatus(pi, asOf);
  if (s === "EXPIRED") throw new AppError("VALIDATION", `${what} is blocked: proforma ${pi.number} expired on ${pi.expiryDate.toISOString().slice(0, 10)}. Renew it first.`);
  if (s !== "ACTIVE") throw new AppError("VALIDATION", `${what} is blocked: proforma ${pi.number} is ${s.toLowerCase()}`);
}

async function lockPi(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ProformaInvoice" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Proforma invoice not found");
  return tx.proformaInvoice.findUniqueOrThrow({ where: { id } });
}

// ───────────────────────────── Create ─────────────────────────────

export const piSchema = z.object({
  salesOrderId: reqText("Sales order"),
  date: dateStr,
  terms: optText(4000),
  notes: optText(2000),
  /** Quote part of the SO. Omitted: every SO line for its whole open quantity. */
  lines: z
    .array(z.object({ salesOrderItemId: reqText("Sales order line"), sqm: decimal({ min: 0, dp: 4, label: "SQM" }) }))
    .optional(),
});
export type PiInput = z.input<typeof piSchema>;

/** SQM of an SO line not yet invoiced and not quoted by another open PI. */
async function openSqmByLine(tx: Tx, soId: string) {
  const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: soId }, include: { items: true } });
  const quoted = await tx.proformaInvoiceItem.groupBy({
    by: ["salesOrderItemId"],
    where: { proformaInvoice: { salesOrderId: soId, status: { in: PI_OPEN } } },
    _sum: { sqm: true },
  });
  const q = new Map(quoted.map((r) => [r.salesOrderItemId, D(r._sum.sqm ?? 0)]));
  return new Map(so.items.map((i) => [i.id, D(i.sqm).minus(i.invoicedSqm).minus(q.get(i.id) ?? ZERO)]));
}

export async function createProformaInvoice(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "sales.edit");
  const input = parse(piSchema, raw);
  const date = toDateOnly(input.date);

  return inTx(async (tx) => {
    const so = await lockSo(tx, input.salesOrderId);
    if (!SO_LIVE.includes(so.status) || so.status === "INVOICED") {
      throw new AppError("VALIDATION", `SO ${so.number} is ${soStatusLabel(so.status)}; a proforma can only quote an open or partly invoiced order`);
    }
    if (date < so.date) throw new AppError("VALIDATION", "The proforma date cannot be before the sales order date");
    const open = await openSqmByLine(tx, so.id);

    const wanted = input.lines
      ? input.lines.map((l) => ({ salesOrderItemId: l.salesOrderItemId, sqm: round4(l.sqm) }))
      : so.items.map((i) => ({ salesOrderItemId: i.id, sqm: open.get(i.id) ?? ZERO }));
    const picked = wanted.filter((w) => w.sqm.gt(0));
    if (picked.length === 0) throw new AppError("VALIDATION", `Nothing left to quote on SO ${so.number}: every line is invoiced or on another open proforma`);

    const seen = new Set<string>();
    const lines = picked.map((w) => {
      const it = so.items.find((i) => i.id === w.salesOrderItemId);
      if (!it) throw new AppError("VALIDATION", "A line does not belong to this sales order");
      if (seen.has(it.id)) throw new AppError("VALIDATION", `SO line ${it.lineNo} appears twice`);
      seen.add(it.id);
      const avail = open.get(it.id) ?? ZERO;
      if (w.sqm.gt(avail)) {
        throw new AppError("VALIDATION", `SO line ${it.lineNo}: only ${avail.toFixed(4).replace(/\.?0+$/, "")} SQM is left to quote (not invoiced and not on another open proforma)`);
      }
      // A partial quantity takes the same share of the line discount.
      const discount = w.sqm.eq(it.sqm) ? D(it.discount) : round2(D(it.discount).times(w.sqm).div(it.sqm));
      return { it, sqm: w.sqm, discount };
    });

    const taxes = await tx.taxCode.findMany({ where: { id: { in: lines.map((l) => l.it.taxCodeId) } } });
    const tById = new Map(taxes.map((t) => [t.id, t]));
    // The SO's invoice-level discount follows in proportion to the quoted amount after line discounts.
    const soAfter = sum(so.items.map((i) => round2(D(i.sqm).times(i.unitPrice)).minus(i.discount)));
    const piAfter = sum(lines.map((l) => round2(l.sqm.times(l.it.unitPrice)).minus(l.discount)));
    const headerDiscount = D(so.discount).isZero() || soAfter.isZero() ? ZERO : piAfter.eq(soAfter) ? D(so.discount) : round2(D(so.discount).times(piAfter).div(soAfter));

    const doc = computeDocument(
      so.priceMode,
      lines.map((l) => ({ sqm: l.sqm, unitPrice: D(l.it.unitPrice), discount: l.discount, rate: salesRate(tById.get(l.it.taxCodeId)!) })),
      headerDiscount,
    );
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: so.customerId } });
    const settings = await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    const validityDays = settings.piValidityDays;
    const number = await nextDocNumber(tx, "PI", date);

    const pi = await tx.proformaInvoice.create({
      data: {
        number,
        salesOrderId: so.id,
        customerId: customer.id,
        ...customerSnapshot(customer),
        date,
        validityDays,
        expiryDate: addDays(date, validityDays),
        priceMode: so.priceMode,
        discount: doc.discount,
        netTotal: doc.net,
        vatTotal: doc.vat,
        total: doc.total,
        terms: input.terms ?? null,
        notes: input.notes ?? null,
        createdById: ctx.userId,
        items: {
          create: lines.map((l, i) => ({
            lineNo: i + 1,
            salesOrderItemId: l.it.id,
            productId: l.it.productId,
            description: l.it.description,
            sqm: l.sqm,
            unitPrice: l.it.unitPrice,
            discount: doc.lines[i].discount,
            headerDiscount: doc.lines[i].headerDiscount,
            taxCodeId: l.it.taxCodeId,
            netAmount: doc.lines[i].net,
            vatAmount: doc.lines[i].vat,
            grossAmount: doc.lines[i].gross,
          })),
        },
      },
      include: { items: true },
    });
    await audit(tx, ctx, { action: "create", entity: "ProformaInvoice", entityId: pi.id, after: pi, meta: { salesOrder: so.number } });
    return pi;
  });
}

// ───────────────────────────── Expiry and renewal ─────────────────────────────

/** Mark unpaid ACTIVE proformas past their expiry date as EXPIRED. Idempotent; run by the daily job (TJ-01). */
export async function expireProformaInvoices(asOf: Date = today(), ctx: Ctx = systemCtx): Promise<number> {
  return inTx(async (tx) => {
    const due = await tx.$queryRaw<{ id: string; number: string; expiryDate: Date }[]>`
      SELECT "id", "number", "expiryDate" FROM "ProformaInvoice"
      WHERE "status" = 'ACTIVE' AND "expiryDate" < ${asOf} AND "receivedAmount" = 0
      ORDER BY "id" FOR UPDATE SKIP LOCKED`;
    for (const pi of due) {
      await tx.proformaInvoice.update({ where: { id: pi.id }, data: { status: "EXPIRED" } });
      await audit(tx, ctx, { action: "expire", entity: "ProformaInvoice", entityId: pi.id, before: { status: "ACTIVE" }, after: { status: "EXPIRED" }, meta: { expiryDate: pi.expiryDate, asOf } });
    }
    return due.length;
  });
}

/** Renew an expired proforma: a new validity period starts today. */
export async function renewProformaInvoice(ctx: Ctx, id: string, reason?: string) {
  assertCan(ctx, "sales.renewPi");
  return inTx(async (tx) => {
    const pi0 = await tx.proformaInvoice.findUnique({ where: { id }, select: { salesOrderId: true } });
    if (!pi0) throw new AppError("NOT_FOUND", "Proforma invoice not found");
    const so = await lockSo(tx, pi0.salesOrderId);
    const pi = await lockPi(tx, id);
    const now = today();
    if (effectivePiStatus(pi, now) !== "EXPIRED") throw new AppError("VALIDATION", `Proforma ${pi.number} has not expired; only an expired proforma can be renewed`);
    if (!SO_LIVE.includes(so.status)) throw new AppError("VALIDATION", `SO ${so.number} is ${soStatusLabel(so.status)}; its proforma cannot be renewed`);
    const settings = await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    const after = await tx.proformaInvoice.update({
      where: { id },
      data: {
        status: "ACTIVE",
        validityDays: settings.piValidityDays,
        expiryDate: addDays(now, settings.piValidityDays),
        renewedAt: new Date(),
        renewedById: ctx.userId,
        renewCount: { increment: 1 },
      },
    });
    await audit(tx, ctx, {
      action: "renew",
      entity: "ProformaInvoice",
      entityId: id,
      before: { status: pi.status, expiryDate: pi.expiryDate },
      after: { status: after.status, expiryDate: after.expiryDate },
      meta: { reason: reason?.trim() || undefined, renewCount: after.renewCount },
    });
    return after;
  });
}

// ───────────────────────────── Close / cancel ─────────────────────────────

/** Close (customer will not proceed) or cancel (issued in error) a proforma. Frees its quoted quantity. */
export async function closeProformaInvoice(ctx: Ctx, id: string, kind: "CLOSED" | "CANCELLED", reason: string) {
  assertCan(ctx, "sales.cancel");
  const why = reason.trim();
  if (!why) throw new AppError("VALIDATION", "Give a reason", { fields: { reason: "Reason is required" } });
  return inTx(async (tx) => {
    const pi = await lockPi(tx, id);
    if (!PI_OPEN.includes(pi.status)) throw new AppError("VALIDATION", `Proforma ${pi.number} is already ${pi.status.toLowerCase()}`);
    if (D(pi.receivedAmount).gt(0)) {
      throw new AppError("VALIDATION", `Proforma ${pi.number} has AED ${D(pi.receivedAmount).toFixed(2)} received. Cancel or refund those receipts first (TD-025).`);
    }
    const after = await tx.proformaInvoice.update({ where: { id }, data: { status: kind, closeReason: why } });
    await audit(tx, ctx, { action: kind === "CLOSED" ? "close" : "cancel", entity: "ProformaInvoice", entityId: id, before: { status: pi.status }, after: { status: kind, reason: why } });
    return after;
  });
}


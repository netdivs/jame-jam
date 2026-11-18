// Sales orders (spec §3.3.1, BD-01, acceptance D1).
//  - Stock is reserved when the SO is saved; there is no draft state.
//  - Editing adjusts the reservations; cancelling releases them.
//  - Status: Open → Partially Invoiced → Invoiced → Delivered → Closed / Cancelled / Expired.
//  - Reservation expiry and extension wait for client decision C2 (T5-03); reservationExpiresAt stays empty.
// Lock order: sales order → stock buckets (sorted by id) → reservations, so concurrent orders cannot deadlock
// or reserve the same SQM twice.
import type { PriceMode, Prisma, SoStatus } from "@prisma/client";
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, can, inTx, nextDocNumber, round4, toDateOnly } from "../core";
import { lockBalance, releaseReservation, reserveStock } from "../inventory/stock";
import { dateStr, decimal, optText, parse, reqText } from "../validation";
import { computeDocument, salesRate } from "./vat";

/** An SO can be edited only while nothing has been invoiced or delivered. */
export const SO_EDITABLE: SoStatus[] = ["OPEN"];
/** Statuses in which an SO still holds stock. */
export const SO_LIVE: SoStatus[] = ["OPEN", "PARTIALLY_INVOICED", "INVOICED"];

export const soStatusLabel = (s: SoStatus) => s.toLowerCase().replace(/_/g, " ");

export async function lockSo(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "SalesOrder" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Sales order not found");
  return tx.salesOrder.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { lineNo: "asc" } } } });
}

/** Lock buckets in a fixed order so two transactions never wait on each other in a cycle. */
async function lockBuckets(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await lockBalance(tx, id);
}

/** Snapshot of the customer's details as printed on documents (spec §3.3.2). */
export const customerSnapshot = (c: { name: string; address: string | null; trn: string | null; mobile: string | null }) => ({
  customerName: c.name,
  customerAddress: c.address,
  customerTrn: c.trn,
  customerMobile: c.mobile,
});

// ───────────────────────────── Create / edit ─────────────────────────────

const lineSchema = z.object({
  /** Existing line id when editing; omitted for a new line. */
  id: optText(40),
  balanceId: reqText("Stock"),
  description: optText(200),
  sqm: decimal({ gt: 0, dp: 4, label: "SQM" }),
  unitPrice: decimal({ min: 0, dp: 4, label: "Unit price" }),
  discount: z.union([decimal({ min: 0, dp: 2, label: "Discount" }), z.literal("").transform(() => undefined)]).optional(),
  taxCodeId: optText(40),
  taxReason: optText(500),
});

export const soSchema = z.object({
  customerId: reqText("Customer"),
  date: dateStr,
  priceMode: z.enum(["INCLUSIVE", "EXCLUSIVE"]).optional(),
  discount: z.union([decimal({ min: 0, dp: 2, label: "Invoice discount" }), z.literal("").transform(() => undefined)]).optional(),
  notes: optText(2000),
  lines: z.array(lineSchema).min(1, "Add at least one line"),
});
export type SoInput = z.input<typeof soSchema>;

type Line = z.output<typeof lineSchema>;

/** Resolve products, buckets and tax codes; enforce the tax code rule (spec §3.3.5). */
async function resolveLines(tx: Tx, ctx: Ctx, lines: Line[], previous: Map<string, { taxCodeId: string; taxReason: string | null }>) {
  const balances = await tx.stockBalance.findMany({
    where: { id: { in: lines.map((l) => l.balanceId) } },
    include: { product: { include: { defaultTaxCode: true } }, slab: true, lot: true, block: true },
  });
  const taxes = await tx.taxCode.findMany({ where: { active: true } });
  const sr = taxes.find((t) => t.type === "SR");
  if (!sr) throw new AppError("VALIDATION", "No active standard-rated (SR) tax code is set up");
  const bById = new Map(balances.map((b) => [b.id, b]));
  const tById = new Map(taxes.map((t) => [t.id, t]));
  const seen = new Set<string>();

  return lines.map((l, i) => {
    const n = i + 1;
    const b = bById.get(l.balanceId);
    if (!b) throw new AppError("VALIDATION", `Line ${n}: stock not found`);
    if (!b.product.active) throw new AppError("VALIDATION", `Line ${n}: product ${b.product.name} is inactive`);
    if (seen.has(b.id)) throw new AppError("VALIDATION", `Line ${n}: the same stock is already on line ${[...seen].indexOf(b.id) + 1}; change that line's SQM instead`);
    seen.add(b.id);
    if (b.slab && round4(l.sqm).gt(b.slab.totalSqm)) {
      throw new AppError("VALIDATION", `Line ${n}: slab ${b.slab.slabNo} has only ${D(b.slab.totalSqm).toFixed(2)} SQM`);
    }

    const taxId = l.taxCodeId ?? (b.product.defaultTaxCode?.active ? b.product.defaultTaxCode.id : sr.id);
    const tax = tById.get(taxId);
    if (!tax) throw new AppError("VALIDATION", `Line ${n}: select an active tax code`);
    const rate = salesRate(tax);
    const prev = l.id ? previous.get(l.id) : undefined;
    let taxReason: string | null = null;
    if (tax.type !== "SR") {
      const unchanged = prev && prev.taxCodeId === tax.id;
      if (!unchanged) {
        if (!can(ctx, "taxCode.change")) {
          throw new AppError("FORBIDDEN", `Line ${n}: only users with "Change tax code" may use ${tax.code}`);
        }
        if (!l.taxReason) throw new AppError("VALIDATION", `Line ${n}: give a reason for using tax code ${tax.code}`, { fields: { [`lines.${i}.taxReason`]: "Reason is required" } });
      }
      taxReason = l.taxReason ?? prev?.taxReason ?? null;
    }
    return { input: l, balance: b, tax, rate, taxReason, sqm: round4(l.sqm), unitPrice: l.unitPrice };
  });
}

function priceLines(mode: PriceMode, resolved: Awaited<ReturnType<typeof resolveLines>>, discount: Dec) {
  const doc = computeDocument(
    mode,
    resolved.map((r) => ({ sqm: r.sqm, unitPrice: r.unitPrice, discount: r.input.discount ?? ZERO, rate: r.rate })),
    discount,
  );
  const items = resolved.map((r, i) => ({
    lineNo: i + 1,
    productId: r.balance.productId,
    balanceId: r.balance.id,
    description: r.input.description ?? null,
    sqm: r.sqm,
    unitPrice: r.unitPrice,
    discount: doc.lines[i].discount,
    headerDiscount: doc.lines[i].headerDiscount,
    taxCodeId: r.tax.id,
    taxReason: r.taxReason,
    netAmount: doc.lines[i].net,
    vatAmount: doc.lines[i].vat,
    grossAmount: doc.lines[i].gross,
  }));
  return { doc, items };
}

/**
 * Create an SO (reserving its stock) or edit an open SO (adjusting its reservations).
 * Editing is blocked while a live proforma invoice quotes the SO, so a PI sent to the customer never
 * silently changes (TD-018).
 */
export async function saveSalesOrder(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "sales.edit");
  const input = parse(soSchema, raw);
  const date = toDateOnly(input.date);

  return inTx(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || !customer.active) throw new AppError("VALIDATION", "Select an active customer");
    const settings = await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    const mode: PriceMode = input.priceMode ?? settings.defaultPriceMode;

    const before = id ? await lockSo(tx, id) : null;
    if (before) {
      if (!SO_EDITABLE.includes(before.status)) {
        throw new AppError("VALIDATION", `SO ${before.number} is ${soStatusLabel(before.status)} and can no longer be edited`);
      }
      const livePi = await tx.proformaInvoice.findFirst({ where: { salesOrderId: before.id, status: { in: ["ACTIVE", "EXPIRED"] } } });
      if (livePi) throw new AppError("VALIDATION", `Proforma ${livePi.number} quotes this SO. Cancel or close it before editing the SO.`);
      for (const l of input.lines) {
        if (l.id && !before.items.some((it) => it.id === l.id)) throw new AppError("VALIDATION", "A line does not belong to this sales order");
      }
    }
    const prevTax = new Map((before?.items ?? []).map((it) => [it.id, { taxCodeId: it.taxCodeId, taxReason: it.taxReason }]));
    const resolved = await resolveLines(tx, ctx, input.lines, prevTax);
    const { doc, items } = priceLines(mode, resolved, input.discount ?? ZERO);

    await lockBuckets(tx, [...items.map((i) => i.balanceId), ...(before?.items ?? []).map((i) => i.balanceId)]);

    const header = {
      customerId: customer.id,
      ...customerSnapshot(customer),
      date,
      priceMode: mode,
      discount: doc.discount,
      netTotal: doc.net,
      vatTotal: doc.vat,
      total: doc.total,
      notes: input.notes ?? null,
    };

    if (!before) {
      const number = await nextDocNumber(tx, "SO", date);
      const so = await tx.salesOrder.create({ data: { ...header, number, createdById: ctx.userId } });
      for (const it of items) {
        const line = await tx.salesOrderItem.create({ data: { ...it, salesOrderId: so.id } });
        const r = await reserveStock(tx, ctx, { balanceId: it.balanceId, sqm: it.sqm, refType: "SALES_ORDER", refId: so.id, refLineId: line.id });
        await tx.salesOrderItem.update({ where: { id: line.id }, data: { reservationId: r.id } });
      }
      const after = await tx.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
      await audit(tx, ctx, { action: "create", entity: "SalesOrder", entityId: so.id, after, meta: { priceMode: mode, defaultPriceMode: settings.defaultPriceMode } });
      return after;
    }

    // Edit: release what changed or was removed first, then reserve; the buckets are already locked.
    const keep = new Map(input.lines.flatMap((l, i) => (l.id ? [[l.id, items[i]] as const] : [])));
    for (const old of before.items) {
      const next = keep.get(old.id);
      const changed = !next || next.balanceId !== old.balanceId || !D(next.sqm).eq(old.sqm);
      if (changed && old.reservationId) {
        await releaseReservation(tx, ctx, { reservationId: old.reservationId, reason: `SO ${before.number} edited` });
      }
      if (!next) {
        const quoted = await tx.proformaInvoiceItem.count({ where: { salesOrderItemId: old.id } });
        if (quoted > 0) throw new AppError("VALIDATION", `Line ${old.lineNo} was quoted on a proforma invoice and cannot be removed; set its SQM instead`);
        await tx.salesOrderItem.delete({ where: { id: old.id } });
      }
    }
    // Free line numbers first so renumbering cannot collide with the unique (order, lineNo) index.
    await tx.salesOrderItem.updateMany({ where: { salesOrderId: before.id }, data: { lineNo: { increment: 10_000 } } });
    for (const [i, it] of items.entries()) {
      const lineId = input.lines[i].id;
      const old = lineId ? before.items.find((o) => o.id === lineId) : undefined;
      const changed = !old || old.balanceId !== it.balanceId || !D(old.sqm).eq(it.sqm);
      const line = old
        ? await tx.salesOrderItem.update({ where: { id: old.id }, data: it })
        : await tx.salesOrderItem.create({ data: { ...it, salesOrderId: before.id } });
      if (changed) {
        const r = await reserveStock(tx, ctx, { balanceId: it.balanceId, sqm: it.sqm, refType: "SALES_ORDER", refId: before.id, refLineId: line.id });
        await tx.salesOrderItem.update({ where: { id: line.id }, data: { reservationId: r.id } });
      }
    }
    await tx.salesOrder.update({ where: { id: before.id }, data: header });
    const after = await tx.salesOrder.findUniqueOrThrow({ where: { id: before.id }, include: { items: { orderBy: { lineNo: "asc" } } } });
    await audit(tx, ctx, { action: "update", entity: "SalesOrder", entityId: before.id, before, after });
    return after;
  });
}

// ───────────────────────────── Cancel ─────────────────────────────

/** Cancel an SO that has nothing invoiced: releases every reservation and cancels its live proformas. */
export async function cancelSalesOrder(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "sales.cancel");
  const why = reason.trim();
  if (!why) throw new AppError("VALIDATION", "Give a reason for cancelling", { fields: { reason: "Reason is required" } });
  return inTx(async (tx) => {
    const so = await lockSo(tx, id);
    if (so.status !== "OPEN") {
      throw new AppError("VALIDATION", `SO ${so.number} is ${soStatusLabel(so.status)}; only an open SO with nothing invoiced can be cancelled`);
    }
    await lockBuckets(tx, so.items.map((i) => i.balanceId));
    for (const it of so.items) {
      if (!it.reservationId) continue;
      const r = await tx.stockReservation.findUniqueOrThrow({ where: { id: it.reservationId } });
      if (r.status === "ACTIVE") await releaseReservation(tx, ctx, { reservationId: r.id, reason: `SO ${so.number} cancelled: ${why}` });
    }
    const pis = await tx.proformaInvoice.findMany({ where: { salesOrderId: id, status: { in: ["ACTIVE", "EXPIRED"] } } });
    for (const pi of pis) {
      await tx.proformaInvoice.update({ where: { id: pi.id }, data: { status: "CANCELLED", closeReason: `SO ${so.number} cancelled: ${why}` } });
      await audit(tx, ctx, { action: "cancel", entity: "ProformaInvoice", entityId: pi.id, before: { status: pi.status }, after: { status: "CANCELLED" }, meta: { reason: why, viaSalesOrder: so.number } });
    }
    const after = await tx.salesOrder.update({ where: { id }, data: { status: "CANCELLED", cancelReason: why } });
    await audit(tx, ctx, { action: "cancel", entity: "SalesOrder", entityId: id, before: { status: so.status }, after: { status: after.status, reason: why } });
    return after;
  });
}

// ───────────────────────────── Status ─────────────────────────────

/** Recompute the SO status from invoiced / delivered quantities (used by TI and DN in later steps). */
export async function refreshSoStatus(tx: Tx, soId: string): Promise<SoStatus> {
  const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: soId }, include: { items: true } });
  if (!SO_LIVE.includes(so.status) && so.status !== "DELIVERED") return so.status;
  const anyInvoiced = so.items.some((i) => D(i.invoicedSqm).gt(0));
  const allInvoiced = so.items.every((i) => D(i.invoicedSqm).gte(i.sqm));
  const allDelivered = so.items.every((i) => D(i.deliveredSqm).gte(i.sqm));
  const status: SoStatus = allDelivered ? "DELIVERED" : allInvoiced ? "INVOICED" : anyInvoiced ? "PARTIALLY_INVOICED" : "OPEN";
  if (status !== so.status) await tx.salesOrder.update({ where: { id: soId }, data: { status } });
  return status;
}

export type SoWithItems = Prisma.SalesOrderGetPayload<{ include: { items: true } }>;

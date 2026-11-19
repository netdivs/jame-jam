// Delivery notes (spec §3.1.8, §3.3.7, BD-15, acceptance R10; T6-03). Behind features.salesInvoicing (TD-045).
//  - Only for a tax invoice paid in full (settled = total). No override, no permission bypasses it.
//    Uncleared cheques never count: they cannot be applied to an invoice (they are not free advance).
//  - Partial dispatch: one TI → many DNs; per TI line never more than invoiced − delivered.
//  - Each line consumes the SO line's reservation (stock out, DN movement, slab sale operation) and the cost
//    goes Dr COGS / Cr Inventory at lot cost in one entry for the DN.
//  - Issued and confirmed in one step and never cancelled; goods coming back are a return (Step 7).
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, inTx, nextDocNumber, round2, round4, sum, toDateOnly, today } from "../core";
import { consumeReservation, postInventoryChange } from "../inventory/stock";
import { dateStr, decimal, optText, parse } from "../validation";
import { refreshSoStatus } from "./orders";
import { assertSalesInvoicing, tiOpenAmount } from "./invoices";

export const dnSchema = z.object({
  taxInvoiceId: z.string().min(1, "Select the tax invoice"),
  date: dateStr,
  vehicleNo: optText(40),
  driverName: optText(100),
  receivedBy: optText(120),
  remarks: optText(1000),
  /** Dispatch part of the invoice. Omitted: everything not yet delivered. */
  lines: z.array(z.object({ taxInvoiceItemId: z.string().min(1), sqm: decimal({ min: 0, dp: 4, label: "SQM" }) })).optional(),
});
export type DnInput = z.input<typeof dnSchema>;

/** Why goods cannot be released for this invoice, or null when they can (shown on the TI page). */
export function deliveryBlock(ti: Parameters<typeof tiOpenAmount>[0]): string | null {
  const open = tiOpenAmount(ti);
  return open.gt(0) ? `AED ${open.toFixed(2)} is still unpaid. Goods are released only when the tax invoice is paid in full.` : null;
}

export async function createDeliveryNote(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "delivery.create");
  const input = parse(dnSchema, raw);
  const date = toDateOnly(input.date);
  if (date > today()) throw new AppError("VALIDATION", "A delivery note cannot be dated in the future", { fields: { date: "Not after today" } });

  return inTx(async (tx: Tx) => {
    await assertSalesInvoicing(tx);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "TaxInvoice" WHERE "id" = ${input.taxInvoiceId} FOR UPDATE`;
    if (rows.length === 0) throw new AppError("NOT_FOUND", "Tax invoice not found");
    const ti = await tx.taxInvoice.findUniqueOrThrow({ where: { id: input.taxInvoiceId }, include: { items: { orderBy: { lineNo: "asc" }, include: { salesOrderItem: true } }, salesOrder: true } });
    const block = deliveryBlock(ti);
    if (block) throw new AppError("VALIDATION", `Delivery of ${ti.number} is blocked: ${block}`);
    if (date < ti.date) throw new AppError("VALIDATION", "The delivery note cannot be dated before the tax invoice");

    const open = new Map(ti.items.map((i) => [i.id, D(i.sqm).minus(i.deliveredSqm)]));
    const wanted = input.lines ? input.lines.map((l) => ({ id: l.taxInvoiceItemId, sqm: round4(l.sqm) })) : ti.items.map((i) => ({ id: i.id, sqm: open.get(i.id)! }));
    const picked = wanted.filter((w) => w.sqm.gt(0));
    if (picked.length === 0) throw new AppError("VALIDATION", `Nothing left to deliver on ${ti.number}`);
    const seen = new Set<string>();
    const lines = picked.map((w) => {
      const it = ti.items.find((i) => i.id === w.id);
      if (!it) throw new AppError("VALIDATION", "A line does not belong to this tax invoice");
      if (seen.has(it.id)) throw new AppError("VALIDATION", `Invoice line ${it.lineNo} appears twice`);
      seen.add(it.id);
      const left = open.get(it.id)!;
      if (w.sqm.gt(left)) throw new AppError("VALIDATION", `Invoice line ${it.lineNo}: only ${left.toFixed(4).replace(/\.?0+$/, "") || "0"} SQM is left to deliver`);
      if (!it.salesOrderItem.reservationId) throw new AppError("VALIDATION", `Invoice line ${it.lineNo}: the sales order line holds no reservation`);
      return { it, sqm: w.sqm };
    });

    const number = await nextDocNumber(tx, "DN", date);
    const dn = await tx.deliveryNote.create({
      data: {
        number,
        taxInvoiceId: ti.id,
        salesOrderId: ti.salesOrderId,
        customerId: ti.customerId,
        customerName: ti.customerName,
        date,
        vehicleNo: input.vehicleNo ?? null,
        driverName: input.driverName ?? null,
        receivedBy: input.receivedBy ?? null,
        remarks: input.remarks ?? null,
        costTotal: ZERO,
        createdById: ctx.userId,
      },
    });

    const costs: Dec[] = [];
    for (const [i, l] of lines.entries()) {
      const { cost } = await consumeReservation(tx, ctx, { reservationId: l.it.salesOrderItem.reservationId!, sqm: l.sqm, date, refType: "DELIVERY_NOTE", refId: dn.id });
      const c = round2(cost);
      costs.push(c);
      await tx.deliveryNoteItem.create({ data: { deliveryNoteId: dn.id, lineNo: i + 1, taxInvoiceItemId: l.it.id, productId: l.it.productId, balanceId: l.it.salesOrderItem.balanceId, sqm: l.sqm, cost: c } });
      await tx.taxInvoiceItem.update({ where: { id: l.it.id }, data: { deliveredSqm: round4(D(l.it.deliveredSqm).plus(l.sqm)) } });
      await tx.salesOrderItem.update({ where: { id: l.it.salesOrderItemId }, data: { deliveredSqm: round4(D(l.it.salesOrderItem.deliveredSqm).plus(l.sqm)) } });
    }
    const costTotal = sum(costs);
    await tx.deliveryNote.update({ where: { id: dn.id }, data: { costTotal } });
    await postInventoryChange(tx, ctx, { date, sourceType: "DELIVERY_NOTE", sourceId: dn.id, memo: `${number} — ${ti.customerName} — ${ti.number}`, values: [costTotal.negated()], offsetAccount: "COGS" });
    const soStatus = await refreshSoStatus(tx, ti.salesOrderId);
    await audit(tx, ctx, {
      action: "create",
      entity: "DeliveryNote",
      entityId: dn.id,
      after: { number, invoice: ti.number, lines: lines.map((l) => ({ line: l.it.lineNo, sqm: l.sqm })), costTotal, soStatus, vehicleNo: input.vehicleNo, receivedBy: input.receivedBy },
    });
    return tx.deliveryNote.findUniqueOrThrow({ where: { id: dn.id }, include: { items: true } });
  });
}

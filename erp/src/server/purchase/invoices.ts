// Supplier invoices (PUR), spec §3.2.2.
//  - Invoice number unique per supplier; invoiced SQM can never exceed received SQM.
//  - Clears GRNI at the PO price; any price difference (variance) goes to the lots of that PO line
//    (remaining stock → Inventory, already-sold part → COGS).
//  - Reverse charge (imports): VAT is self-assessed (Dr VAT Input / Cr VAT Output) and not owed to the supplier.
//  - Supplier advances on the PO are knocked off automatically.
import { z } from "zod";
import { AppError, Ctx, D, Dec, ZERO, assertCan, audit, inTx, nextDocNumber, rethrowUnique, round2, round4, sum, toDateOnly } from "../core";
import { postJournal } from "../accounting/gl";
import { revalueLot, revaluationLines, splitAmount } from "../inventory/costing";
import { dateStr, decimal, optText, parse, reqText } from "../validation";
import { LIVE, lineAmounts, lockPo, paymentStatusOf, refreshPoStatus } from "./orders";

const optDec = (o: Parameters<typeof decimal>[0]) => z.union([decimal(o), z.literal("").transform(() => undefined)]).optional();

export const invoiceSchema = z.object({
  purchaseOrderId: reqText("Purchase order"),
  supplierInvoiceNo: reqText("Supplier invoice number", 60),
  date: dateStr,
  dueDate: z.union([dateStr, z.literal("")]).optional().transform((v) => v || undefined),
  notes: optText(1000),
  refCurrency: optText(10),
  refAmount: optDec({ gt: 0, dp: 2, label: "Reference amount" }),
  refRate: optDec({ gt: 0, dp: 6, label: "Reference rate" }),
  lines: z
    .array(
      z.object({
        poItemId: reqText("PO line"),
        sqm: decimal({ gt: 0, dp: 4, label: "SQM" }),
        unitPrice: decimal({ min: 0, dp: 4, label: "Unit price" }),
        taxCodeId: reqText("Tax code"),
      }),
    )
    .min(1, "Add at least one line"),
});
export type InvoiceInput = z.input<typeof invoiceSchema>;

export async function postSupplierInvoice(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "purchase.invoice");
  const input = parse(invoiceSchema, raw);
  const date = toDateOnly(input.date);
  const supplierInvoiceNo = input.supplierInvoiceNo.trim();

  try {
    return await inTx(async (tx) => {
      const po = await lockPo(tx, input.purchaseOrderId);
      if (!LIVE.includes(po.status)) throw new AppError("VALIDATION", `PO ${po.number} is not approved`);
      const dup = await tx.supplierInvoice.findUnique({ where: { supplierId_supplierInvoiceNo: { supplierId: po.supplierId, supplierInvoiceNo } } });
      if (dup) {
        throw new AppError("CONFLICT", `Invoice ${supplierInvoiceNo} from ${po.supplier.name} is already posted (${dup.number})`, {
          fields: { supplierInvoiceNo: "Already posted for this supplier" },
        });
      }

      const itemById = new Map(po.items.map((i) => [i.id, i]));
      const taxes = await tx.taxCode.findMany({ where: { id: { in: input.lines.map((l) => l.taxCodeId) } } });
      const taxById = new Map(taxes.map((t) => [t.id, t]));
      const pending = new Map<string, Dec>();

      const lines = input.lines.map((l, i) => {
        const item = itemById.get(l.poItemId);
        if (!item) throw new AppError("VALIDATION", `Line ${i + 1} does not belong to PO ${po.number}`);
        const tax = taxById.get(l.taxCodeId);
        if (!tax || !tax.active) throw new AppError("VALIDATION", `Line ${i + 1}: select an active tax code`);
        const sqm = round4(l.sqm);
        const already = pending.get(item.id) ?? ZERO;
        const open = D(item.receivedSqm).minus(item.invoicedSqm).minus(already);
        if (sqm.gt(open)) {
          throw new AppError(
            "VALIDATION",
            `PO line ${item.lineNo}: invoicing ${sqm.toFixed(4)} SQM but only ${open.toFixed(4)} SQM has been received and not yet invoiced`,
          );
        }
        pending.set(item.id, already.plus(sqm));
        const unitPrice = round4(l.unitPrice);
        return { item, tax, sqm, unitPrice, ...lineAmounts(sqm, unitPrice, tax) };
      });

      // GRNI to clear per line: at PO price; the last part of a line clears the exact residual.
      const invoicedSoFar = new Map<string, { sqm: Dec; value: Dec }>();
      const withGrni = lines.map((l) => {
        const prev = invoicedSoFar.get(l.item.id) ?? { sqm: D(l.item.invoicedSqm), value: D(l.item.invoicedValue) };
        const sqmAfter = prev.sqm.plus(l.sqm);
        const remainingGrni = D(l.item.receivedValue).minus(prev.value);
        const grni = sqmAfter.gte(l.item.receivedSqm) ? remainingGrni : Dec.min(round2(l.sqm.times(l.item.unitPrice)), remainingGrni);
        invoicedSoFar.set(l.item.id, { sqm: sqmAfter, value: prev.value.plus(grni) });
        return { ...l, grni, variance: l.net.minus(grni) };
      });

      const netTotal = sum(withGrni.map((l) => l.net));
      const vatTotal = sum(withGrni.map((l) => l.vat));
      const rcVatTotal = sum(withGrni.map((l) => l.rcVat));
      const total = netTotal.plus(vatTotal);
      const number = await nextDocNumber(tx, "PUR", date);

      const inv = await tx.supplierInvoice.create({
        data: {
          number,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          supplierInvoiceNo,
          date,
          dueDate: input.dueDate ? toDateOnly(input.dueDate) : null,
          netTotal,
          vatTotal,
          rcVatTotal,
          total,
          refCurrency: input.refCurrency,
          refAmount: input.refAmount,
          refRate: input.refRate,
          notes: input.notes,
          createdById: ctx.userId,
          items: {
            create: withGrni.map((l) => ({
              poItemId: l.item.id,
              sqm: l.sqm,
              unitPrice: l.unitPrice,
              taxCodeId: l.tax.id,
              netAmount: l.net,
              vatAmount: l.vat.plus(l.rcVat),
              grniAmount: l.grni,
              variance: l.variance,
            })),
          },
        },
      });

      for (const [itemId, v] of invoicedSoFar) {
        await tx.purchaseOrderItem.update({ where: { id: itemId }, data: { invoicedSqm: v.sqm, invoicedValue: v.value } });
      }

      // Price variance → the lots of the PO line, by lot SQM.
      const reval: { inventory: Dec; cogs: Dec }[] = [];
      for (const l of withGrni) {
        if (l.variance.isZero()) continue;
        const lots = await tx.lot.findMany({ where: { poItemId: l.item.id }, orderBy: { createdAt: "asc" } });
        if (lots.length === 0) throw new AppError("VALIDATION", `PO line ${l.item.lineNo} has no received lots`);
        const parts = splitAmount(l.variance, lots.map((x) => D(x.totalSqm)));
        for (let i = 0; i < lots.length; i++) {
          reval.push(
            await revalueLot(tx, ctx, lots[i].id, parts[i], {
              date,
              refType: "SUPPLIER_INVOICE",
              refId: inv.id,
              source: "INVOICE",
              reason: `Invoice ${supplierInvoiceNo} price difference`,
            }),
          );
        }
      }

      const party = { partyType: "SUPPLIER" as const, partyId: po.supplierId };
      await postJournal(tx, ctx, {
        date,
        sourceType: "SUPPLIER_INVOICE",
        sourceId: inv.id,
        memo: `${number} — ${po.supplier.name} inv ${supplierInvoiceNo} — PO ${po.number}`,
        lines: [
          { account: "GRNI", debit: sum(withGrni.map((l) => l.grni)), ...party },
          ...(reval.length ? revaluationLines(reval, "Invoice price difference") : []),
          { account: "VAT_INPUT", debit: vatTotal.plus(rcVatTotal) },
          { account: "VAT_OUTPUT", credit: rcVatTotal, memo: "Reverse charge" },
          { account: "AP", credit: total, ...party },
        ],
      });

      // Knock off supplier advances held on this PO.
      const knock = Dec.min(D(po.advanceBalance), total);
      if (knock.gt(0)) {
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { advanceBalance: D(po.advanceBalance).minus(knock) } });
        await tx.supplierInvoice.update({ where: { id: inv.id }, data: { settledAmount: knock, paymentStatus: paymentStatusOf(knock, total) } });
        await postJournal(tx, ctx, {
          date,
          sourceType: "ADVANCE_KNOCKOFF",
          sourceId: inv.id,
          memo: `Advance knock-off — ${number} — PO ${po.number}`,
          lines: [
            { account: "AP", debit: knock, ...party },
            { account: "SUPPLIER_ADVANCES", credit: knock, ...party },
          ],
        });
      }

      const status = await refreshPoStatus(tx, po.id);
      await audit(tx, ctx, {
        action: "create",
        entity: "SupplierInvoice",
        entityId: inv.id,
        after: { number, supplierInvoiceNo, po: po.number, netTotal, vatTotal, rcVatTotal, total, advanceKnockedOff: knock, poStatus: status },
      });
      return tx.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    });
  } catch (e) {
    rethrowUnique(e, `Invoice ${supplierInvoiceNo} is already posted for this supplier`);
  }
}

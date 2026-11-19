// Goods receipt (GRN): stock in, lots → blocks → slabs created from a PO (spec §3.1.3, §3.2.3, C1).
//  - Blocked until the PO is 100% paid and the payment verified (R6).
//  - Import POs receive against a shipment that has been collected.
//  - Received SQM can never exceed the PO line's open SQM.
//  - Stock is valued at the PO unit price: Dr Inventory / Cr Goods Received Not Invoiced (GRNI).
import { z } from "zod";
import { AppError, Ctx, D, Dec, ZERO, assertCan, audit, inTx, nextDocNumber, sum, toDateOnly } from "../core";
import { postJournal } from "../accounting/gl";
import { createLotStock, lotBodySchema } from "../inventory/lots";
import { dateStr, optText, parse, reqText } from "../validation";
import { RECEIVABLE, assertPaidAndVerified, lockPo, refreshPoStatus } from "./orders";

export const grnSchema = z.object({
  purchaseOrderId: reqText("Purchase order"),
  shipmentId: optText(),
  warehouseId: reqText("Warehouse"),
  date: dateStr,
  notes: optText(1000),
  lines: z
    .array(lotBodySchema.extend({ poItemId: reqText("PO line") }))
    .min(1, "Receive at least one line"),
});
export type GrnInput = z.input<typeof grnSchema>;

export async function createGoodsReceipt(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "purchase.receive");
  const input = parse(grnSchema, raw);
  const date = toDateOnly(input.date);

  return inTx(async (tx) => {
    const po = await lockPo(tx, input.purchaseOrderId);
    if (!RECEIVABLE.includes(po.status)) {
      throw new AppError("VALIDATION", `PO ${po.number} is ${po.status.toLowerCase().replace(/_/g, " ")}; goods can be received only on an approved, open PO`);
    }
    assertPaidAndVerified(po, "Goods receipt");

    let shipment = null;
    if (input.shipmentId) {
      shipment = await tx.shipment.findUnique({ where: { id: input.shipmentId } });
      if (!shipment || shipment.purchaseOrderId !== po.id) throw new AppError("VALIDATION", "The shipment does not belong to this PO");
      if (shipment.status !== "COLLECTED") {
        throw new AppError("VALIDATION", `Shipment ${shipment.number} is ${shipment.status.toLowerCase().replace(/_/g, " ")}; only a collected shipment can be received`);
      }
    } else if (po.supplier.supplierType === "IMPORT") {
      throw new AppError("VALIDATION", "Import goods are received against a collected shipment — select the shipment", { fields: { shipmentId: "Select the shipment" } });
    }

    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!warehouse || !warehouse.active) throw new AppError("VALIDATION", "Select an active warehouse");

    const itemById = new Map(po.items.map((i) => [i.id, i]));
    for (const l of input.lines) {
      if (!itemById.has(l.poItemId)) throw new AppError("VALIDATION", "A GRN line does not belong to this PO");
    }

    const number = await nextDocNumber(tx, "GRN", date);
    const grn = await tx.goodsReceipt.create({
      data: {
        number,
        purchaseOrderId: po.id,
        shipmentId: shipment?.id,
        warehouseId: warehouse.id,
        date,
        notes: input.notes,
        totalSqm: ZERO,
        totalValue: ZERO,
        createdById: ctx.userId,
      },
    });

    const products = await tx.product.findMany({ where: { id: { in: po.items.map((i) => i.productId) } } });
    const productById = new Map(products.map((p) => [p.id, p]));
    const receivedNow = new Map<string, { sqm: Dec; value: Dec }>();
    const allValues: Dec[] = [];

    for (const [idx, l] of input.lines.entries()) {
      const item = itemById.get(l.poItemId)!;
      const { lotNo, remarks, tileSqm, blocks } = l;
      const { lot, values, totalSqm, totalValue } = await createLotStock(tx, ctx, {
        product: productById.get(item.productId)!,
        warehouseId: warehouse.id,
        supplierId: po.supplierId,
        date,
        costPerSqm: D(item.unitPrice),
        body: { lotNo, remarks, tileSqm, blocks },
        source: "GRN",
        movementType: "GRN",
        refType: "GRN",
        refId: grn.id,
        purchaseOrderId: po.id,
        poItemId: item.id,
        goodsReceiptId: grn.id,
        label: `Line ${idx + 1} (PO line ${item.lineNo})`,
      });
      await tx.goodsReceiptItem.create({ data: { goodsReceiptId: grn.id, poItemId: item.id, lotId: lot.id, sqm: totalSqm, value: totalValue } });
      const acc = receivedNow.get(item.id) ?? { sqm: ZERO, value: ZERO };
      receivedNow.set(item.id, { sqm: acc.sqm.plus(totalSqm), value: acc.value.plus(totalValue) });
      allValues.push(...values);
    }

    // Over-receipt check per PO line (after slab SQM is known).
    for (const [itemId, got] of receivedNow) {
      const item = itemById.get(itemId)!;
      const open = D(item.sqm).minus(item.receivedSqm);
      if (got.sqm.gt(open)) {
        throw new AppError(
          "VALIDATION",
          `PO line ${item.lineNo}: receiving ${got.sqm.toFixed(4)} SQM but only ${open.toFixed(4)} SQM is still open on the PO`,
        );
      }
      await tx.purchaseOrderItem.update({
        where: { id: itemId },
        data: { receivedSqm: D(item.receivedSqm).plus(got.sqm), receivedValue: D(item.receivedValue).plus(got.value) },
      });
    }

    const totalSqm = sum([...receivedNow.values()].map((v) => v.sqm));
    const totalValue = sum(allValues);
    const saved = await tx.goodsReceipt.update({ where: { id: grn.id }, data: { totalSqm, totalValue } });
    if (shipment) await tx.shipment.update({ where: { id: shipment.id }, data: { status: "RECEIVED" } });

    if (totalValue.gt(0)) await postJournal(tx, ctx, {
      date,
      sourceType: "GRN",
      sourceId: grn.id,
      memo: `${number} — PO ${po.number} — ${po.supplier.name}`,
      lines: [
        { account: "INVENTORY", debit: totalValue },
        { account: "GRNI", credit: totalValue, partyType: "SUPPLIER", partyId: po.supplierId },
      ],
    });
    const status = await refreshPoStatus(tx, po.id);
    await audit(tx, ctx, {
      action: "create",
      entity: "GoodsReceipt",
      entityId: grn.id,
      after: { number, po: po.number, shipment: shipment?.number, totalSqm, totalValue, lots: input.lines.length, poStatus: status },
    });
    return saved;
  });
}

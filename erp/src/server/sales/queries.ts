// Read-side helpers for the sales screens.
import { AppError, Ctx, D, assertCan, can, prisma } from "../core";
import { availableSqm } from "../inventory/stock";

export type StockOption = { value: string; label: string; available: string; kind: "SLAB" | "BUCKET" };

/**
 * Stock buckets of a product that can go on a sales order line. When editing, `soId` adds back what
 * that SO already reserves, so its own lines can keep or change their quantity.
 */
export async function stockOptions(ctx: Ctx, productId: string, soId?: string | null): Promise<StockOption[]> {
  if (!can(ctx, "sales.edit")) assertCan(ctx, "sales.edit");
  if (!productId) throw new AppError("VALIDATION", "Select a product");
  const own = soId
    ? await prisma.stockReservation.findMany({ where: { refType: "SALES_ORDER", refId: soId, status: "ACTIVE" } })
    : [];
  const ownBy = new Map<string, ReturnType<typeof D>>();
  for (const r of own) ownBy.set(r.balanceId, (ownBy.get(r.balanceId) ?? D(0)).plus(D(r.sqm).minus(r.consumedSqm).minus(r.releasedSqm)));

  const rows = await prisma.stockBalance.findMany({
    where: { productId, onHandSqm: { gt: 0 }, OR: [{ slabId: null }, { slab: { status: { in: ["AVAILABLE", "RESERVED", "PARTIALLY_SOLD"] } } }] },
    include: { lot: true, block: true, slab: true, warehouse: true },
    orderBy: [{ lot: { lotNo: "asc" } }, { bucketKey: "asc" }],
    take: 2000,
  });
  return rows
    .map((b) => ({ b, avail: availableSqm(b).plus(ownBy.get(b.id) ?? 0) }))
    .filter(({ avail }) => avail.gt(0))
    .map(({ b, avail }) => {
      const where = [`Lot ${b.lot.lotNo}`, b.block ? `Block ${b.block.blockNo}` : null, b.warehouse.code].filter(Boolean).join(" · ");
      const a = avail.toFixed(2);
      return {
        value: b.id,
        label: b.slab ? `Slab ${b.slab.slabNo} — ${a} SQM (${where})` : `${where} — ${a} SQM available`,
        available: avail.toString(),
        kind: b.slab ? ("SLAB" as const) : ("BUCKET" as const),
      };
    });
}

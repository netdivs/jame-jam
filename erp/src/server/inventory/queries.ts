// Read models for inventory screens and reports.
import type { Prisma, ProductType, SlabStatus } from "@prisma/client";
import { D, Dec, ZERO, prisma, sum } from "../core";

export type StockFigures = { onHand: Dec; reserved: Dec; available: Dec; value: Dec };

const fig = (onHand: Dec, reserved: Dec, value: Dec): StockFigures => ({
  onHand,
  reserved,
  available: onHand.minus(reserved),
  value,
});

/** Inventory value per balance = Σ movement.value (always equals the Inventory GL account). */
async function valueByBalance(where: Prisma.StockMovementWhereInput): Promise<Map<string, Dec>> {
  const rows = await prisma.stockMovement.groupBy({ by: ["balanceId"], where, _sum: { value: true } });
  return new Map(rows.map((r) => [r.balanceId, D(r._sum.value ?? 0)]));
}

/** SQM-wise inventory by product (physical / reserved / available / value). */
export async function stockByProduct(filter: { type?: ProductType; q?: string } = {}) {
  const products = await prisma.product.findMany({
    where: {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { itemCode: { contains: filter.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { itemCode: "asc" },
  });
  const balances = await prisma.stockBalance.groupBy({
    by: ["productId"],
    _sum: { onHandSqm: true, reservedSqm: true },
  });
  const values = await prisma.stockMovement.groupBy({ by: ["productId"], _sum: { value: true } });
  const slabCounts = await prisma.slab.groupBy({
    by: ["productId"],
    where: { status: { in: ["AVAILABLE", "RESERVED", "PARTIALLY_SOLD"] } },
    _count: { _all: true },
  });
  const bMap = new Map(balances.map((b) => [b.productId, b._sum]));
  const vMap = new Map(values.map((v) => [v.productId, D(v._sum.value ?? 0)]));
  const cMap = new Map(slabCounts.map((c) => [c.productId, c._count._all]));
  return products.map((p) => {
    const s = bMap.get(p.id);
    return {
      product: p,
      slabsInStock: cMap.get(p.id) ?? 0,
      ...fig(D(s?.onHandSqm ?? 0), D(s?.reservedSqm ?? 0), vMap.get(p.id) ?? ZERO),
    };
  });
}

export async function listLots(filter: { q?: string; productId?: string } = {}) {
  const lots = await prisma.lot.findMany({
    where: {
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.q
        ? {
            OR: [
              { lotNo: { contains: filter.q, mode: "insensitive" } },
              { product: { name: { contains: filter.q, mode: "insensitive" } } },
              { blocks: { some: { blockNo: { contains: filter.q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: { product: true, supplier: true, warehouse: true, _count: { select: { blocks: true, slabs: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const ids = lots.map((l) => l.id);
  const sums = await prisma.stockBalance.groupBy({
    by: ["lotId"],
    where: { lotId: { in: ids } },
    _sum: { onHandSqm: true, reservedSqm: true },
  });
  const values = await prisma.stockMovement.groupBy({ by: ["lotId"], where: { lotId: { in: ids } }, _sum: { value: true } });
  const sMap = new Map(sums.map((s) => [s.lotId, s._sum]));
  const vMap = new Map(values.map((v) => [v.lotId, D(v._sum.value ?? 0)]));
  return lots.map((l) => {
    const s = sMap.get(l.id);
    return { lot: l, ...fig(D(s?.onHandSqm ?? 0), D(s?.reservedSqm ?? 0), vMap.get(l.id) ?? ZERO) };
  });
}

/** Lot → blocks → slabs, with stock figures at every level. */
export async function getLotTree(lotId: string) {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: {
      product: true,
      supplier: true,
      warehouse: true,
      costHistory: { orderBy: { createdAt: "asc" } },
      blocks: {
        orderBy: { blockNo: "asc" },
        include: { slabs: { orderBy: { slabNo: "asc" }, include: { balance: true } } },
      },
      balances: true,
    },
  });
  if (!lot) return null;
  const values = await valueByBalance({ lotId });
  const balFig = (b: { id: string; onHandSqm: Prisma.Decimal; reservedSqm: Prisma.Decimal } | null) =>
    b ? fig(D(b.onHandSqm), D(b.reservedSqm), values.get(b.id) ?? ZERO) : fig(ZERO, ZERO, ZERO);

  const blocks = lot.blocks.map((blk) => {
    const blockBalances = lot.balances.filter((b) => b.blockId === blk.id);
    const slabs = blk.slabs.map((s) => ({ slab: s, ...balFig(s.balance) }));
    const f = blockBalances.map((b) => balFig(b));
    return {
      block: blk,
      slabs,
      ...fig(sum(f.map((x) => x.onHand)), sum(f.map((x) => x.reserved)), sum(f.map((x) => x.value))),
    };
  });
  const lotLevel = lot.balances.filter((b) => !b.blockId).map((b) => ({ balance: b, ...balFig(b) }));
  const all = lot.balances.map((b) => balFig(b));
  return {
    lot,
    blocks,
    lotLevel,
    totals: fig(sum(all.map((x) => x.onHand)), sum(all.map((x) => x.reserved)), sum(all.map((x) => x.value))),
  };
}

export async function listSlabs(filter: { q?: string; status?: SlabStatus; productId?: string; inStockOnly?: boolean } = {}) {
  return prisma.slab.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.inStockOnly ? { status: { in: ["AVAILABLE", "RESERVED", "PARTIALLY_SOLD"] } } : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.q
        ? {
            OR: [
              { slabNo: { contains: filter.q, mode: "insensitive" } },
              { barcode: { contains: filter.q, mode: "insensitive" } },
              { block: { blockNo: { contains: filter.q, mode: "insensitive" } } },
              { lot: { lotNo: { contains: filter.q, mode: "insensitive" } } },
              { shade: { contains: filter.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { product: true, block: true, lot: true, balance: true },
    orderBy: { slabNo: "asc" },
    take: 300,
  });
}

/** Full slab history: movements, operations, reservations, parent/children. */
export async function getSlabDetail(slabId: string) {
  const slab = await prisma.slab.findUnique({
    where: { id: slabId },
    include: {
      product: true,
      block: true,
      lot: true,
      warehouse: true,
      balance: { include: { reservations: { orderBy: { createdAt: "desc" } } } },
      parent: true,
      children: { include: { balance: true }, orderBy: { slabNo: "asc" } },
      operations: { orderBy: { createdAt: "desc" } },
      movements: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!slab) return null;
  const value = sum(slab.movements.map((m) => D(m.value)));
  const b = slab.balance;
  return { slab, ...fig(D(b?.onHandSqm ?? 0), D(b?.reservedSqm ?? 0), value) };
}

export async function listMovements(filter: { lotId?: string; type?: string; take?: number } = {}) {
  return prisma.stockMovement.findMany({
    where: {
      ...(filter.lotId ? { lotId: filter.lotId } : {}),
      ...(filter.type ? { type: filter.type as never } : {}),
    },
    include: { lot: { include: { product: true } }, block: true, slab: true },
    orderBy: { createdAt: "desc" },
    take: filter.take ?? 300,
  });
}

/** Integration check (spec §11.3): stock valuation must equal the Inventory GL balance. */
export async function inventoryReconciliation() {
  const stock = await prisma.stockMovement.aggregate({ _sum: { value: true } });
  const gl = await prisma.journalLine.aggregate({
    where: { account: { systemKey: "INVENTORY" } },
    _sum: { debit: true, credit: true },
  });
  const stockValue = D(stock._sum.value ?? 0);
  const glValue = D(gl._sum.debit ?? 0).minus(D(gl._sum.credit ?? 0));
  return { stockValue, glValue, difference: stockValue.minus(glValue) };
}

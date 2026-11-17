// Lot revaluation: landed cost allocation and supplier invoice price variance (spec §3.2.5).
//  - The part for SQM still in stock is added to the lot's buckets as value-only movements
//    (COST_ADJUSTMENT, sqm = 0) and the lot cost per SQM is recomputed over the remaining SQM.
//  - The part for SQM already sold / consumed goes to COGS.
// Stock valuation keeps equal to the Inventory GL because every value movement is posted.
import { AppError, Ctx, D, Dec, Tx, ZERO, round2, round4, sum } from "../core";
import type { JournalLineInput } from "../accounting/gl";

/**
 * Split `amount` (2 dp) over weights so the parts add up exactly (largest remainder, in cents).
 * Weights must be ≥ 0 with a positive total.
 */
export function splitAmount(amount: Dec, weights: Dec[]): Dec[] {
  const total = sum(weights);
  if (!total.gt(0)) throw new AppError("VALIDATION", "Nothing to allocate against (total basis is 0)");
  const cents = round2(amount).times(100);
  const neg = cents.isNegative();
  const abs = cents.abs();
  const raw = weights.map((w) => abs.times(w).div(total));
  const floors = raw.map((r) => r.floor());
  let left = abs.minus(sum(floors)).toNumber();
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(r.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const parts = [...floors];
  for (const o of order) {
    if (left <= 0) break;
    if (weights[o.i].gt(0)) {
      parts[o.i] = parts[o.i].plus(1);
      left--;
    }
  }
  return parts.map((p) => (neg ? p.negated() : p).div(100));
}

/**
 * Part of a lot cost change that stays in inventory: amount × (remaining SQM / received SQM), capped at the
 * whole amount. The rest belongs to SQM already sold or consumed and goes to COGS. Pure, so the allocation
 * preview shows exactly what revalueLot will post.
 */
export function inventoryShare(amount: Dec, remainingSqm: Dec, receivedSqm: Dec): { inventory: Dec; cogs: Dec } {
  const total = round2(amount);
  let inventory = ZERO;
  if (remainingSqm.gt(0) && receivedSqm.gt(0)) {
    inventory = remainingSqm.gte(receivedSqm) ? total : round2(total.times(remainingSqm.div(receivedSqm)));
  }
  return { inventory, cogs: total.minus(inventory) };
}

/**
 * Add (or remove, when negative) `amount` of cost to a lot. Must run inside the caller's
 * transaction. Returns the inventory part and the COGS part; the caller posts the GL.
 */
export async function revalueLot(
  tx: Tx,
  ctx: Ctx,
  lotId: string,
  amount: Dec,
  meta: { date: Date; refType: string; refId: string; source: "EXPENSE" | "INVOICE" | "OVERRIDE"; reason: string },
): Promise<{ inventory: Dec; cogs: Dec }> {
  amount = round2(amount);
  if (amount.isZero()) return { inventory: ZERO, cogs: ZERO };

  // Lock every bucket of the lot so no sale or cut runs while its value changes.
  await tx.$queryRaw`SELECT "id" FROM "StockBalance" WHERE "lotId" = ${lotId} ORDER BY "id" FOR UPDATE`;
  const lot = await tx.lot.findUniqueOrThrow({ where: { id: lotId } });
  const buckets = await tx.stockBalance.findMany({ where: { lotId, onHandSqm: { gt: 0 } }, orderBy: { id: "asc" } });
  const remaining = sum(buckets.map((b) => D(b.onHandSqm)));
  const { inventory, cogs } = inventoryShare(amount, remaining, D(lot.totalSqm));

  if (!inventory.isZero()) {
    const lotValue = D((await tx.stockMovement.aggregate({ where: { lotId }, _sum: { value: true } }))._sum.value ?? 0);
    if (lotValue.plus(inventory).isNegative()) {
      throw new AppError("VALIDATION", `Lot ${lot.lotNo}: the reduction is larger than the stock value`);
    }
    const parts = splitAmount(inventory, buckets.map((b) => D(b.onHandSqm)));
    for (let i = 0; i < buckets.length; i++) {
      if (parts[i].isZero()) continue;
      const b = buckets[i];
      await tx.stockMovement.create({
        data: {
          date: meta.date,
          type: "COST_ADJUSTMENT",
          refType: meta.refType,
          refId: meta.refId,
          balanceId: b.id,
          productId: b.productId,
          lotId,
          blockId: b.blockId,
          slabId: b.slabId,
          warehouseId: b.warehouseId,
          sqm: ZERO,
          unitCost: ZERO,
          value: parts[i],
          reason: meta.reason,
          createdById: ctx.userId,
        },
      });
    }
  }

  const newValue = D((await tx.stockMovement.aggregate({ where: { lotId }, _sum: { value: true } }))._sum.value ?? 0);
  const costPerSqm = remaining.gt(0) ? round4(newValue.div(remaining)) : D(lot.costPerSqm);
  await tx.lot.update({
    where: { id: lotId },
    data: { costPerSqm, landedCostTotal: D(lot.landedCostTotal).plus(amount) },
  });
  await tx.lotCostHistory.create({
    data: {
      lotId,
      date: meta.date,
      source: meta.source,
      amount,
      costPerSqmAfter: costPerSqm,
      reason: cogs.isZero() ? meta.reason : `${meta.reason} (AED ${cogs.toFixed(2)} to COGS for SQM already sold)`,
      userId: ctx.userId,
    },
  });
  return { inventory, cogs };
}

/** GL lines for a signed revaluation: Dr Inventory / Dr COGS, or the reverse when negative. */
export function revaluationLines(parts: { inventory: Dec; cogs: Dec }[], memo?: string): JournalLineInput[] {
  const inv = sum(parts.map((p) => p.inventory));
  const cogs = sum(parts.map((p) => p.cogs));
  const line = (account: string, v: Dec): JournalLineInput =>
    v.gte(0) ? { account, debit: v, memo } : { account, credit: v.abs(), memo };
  return [line("INVENTORY", inv), line("COGS", cogs)];
}

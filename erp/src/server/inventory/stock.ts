// Stock engine: buckets, movements, reservations, adjustments.
// Rules (spec §3.1.6–3.1.7):
//  - Stock is never edited directly; every change writes a StockMovement.
//  - A bucket row is locked (SELECT … FOR UPDATE) before any change, so two users can never
//    reserve or sell the same SQM.
//  - Available = onHand − reserved, and onHand can never fall below reserved.
//  - Inventory value of a bucket = Σ movement.value; when a bucket reaches 0 SQM its value is
//    cleared exactly, so stock valuation always equals the Inventory GL account.
import type { MovementType, Prisma, StockBalance } from "@prisma/client";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, round2, round4, sum } from "../core";
import { postJournal } from "../accounting/gl";

export type BalanceWithLot = StockBalance & { lot: { costPerSqm: Prisma.Decimal } };

export const availableSqm = (b: { onHandSqm: Prisma.Decimal; reservedSqm: Prisma.Decimal }): Dec =>
  D(b.onHandSqm).minus(b.reservedSqm);

export const bucketKeyForSlab = (slabId: string) => `slab:${slabId}`;
export const bucketKeyForLot = (lotId: string, blockId: string | null, warehouseId: string) =>
  `lot:${lotId}:block:${blockId ?? "-"}:wh:${warehouseId}`;

export function positiveSqm(v: Prisma.Decimal.Value, label = "SQM"): Dec {
  const d = round4(D(v));
  if (!d.gt(0)) throw new AppError("VALIDATION", `${label} must be greater than 0`);
  return d;
}

/** Lock a bucket row for the rest of the transaction and return its fresh state. */
export async function lockBalance(tx: Tx, balanceId: string): Promise<BalanceWithLot> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "StockBalance" WHERE "id" = ${balanceId} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Stock bucket not found");
  return tx.stockBalance.findUniqueOrThrow({
    where: { id: balanceId },
    include: { lot: { select: { costPerSqm: true } } },
  });
}

async function bucketValue(tx: Tx, balanceId: string): Promise<Dec> {
  const agg = await tx.stockMovement.aggregate({ where: { balanceId }, _sum: { value: true } });
  return D(agg._sum.value ?? 0);
}

/**
 * Write one movement on an already-locked bucket and update its quantities.
 * sqm is signed (+ in, − out). reservedDelta lets a sale consume its reservation atomically.
 */
export async function writeMovement(
  tx: Tx,
  ctx: Ctx,
  b: BalanceWithLot,
  m: {
    type: MovementType;
    sqm: Dec;
    date: Date;
    refType: string;
    refId: string;
    reason?: string;
    reservedDelta?: Dec;
    /** Explicit value (signed); default = sqm × lot cost, or the exact residual when the bucket empties. */
    value?: Dec;
  },
): Promise<{ movement: { id: string }; value: Dec; balance: BalanceWithLot }> {
  const sqm = round4(m.sqm);
  if (sqm.isZero()) throw new AppError("VALIDATION", "Movement quantity cannot be zero");
  const onHand = D(b.onHandSqm).plus(sqm);
  const reserved = D(b.reservedSqm).plus(m.reservedDelta ?? ZERO);
  if (onHand.isNegative()) {
    throw new AppError("INSUFFICIENT_STOCK", `Only ${D(b.onHandSqm).toFixed(2)} SQM on hand`, {
      balanceId: b.id,
      onHand: b.onHandSqm.toString(),
      requested: sqm.abs().toString(),
    });
  }
  if (reserved.isNegative() || onHand.lt(reserved)) {
    throw new AppError("INSUFFICIENT_STOCK", `${D(b.reservedSqm).toFixed(2)} SQM of this stock is reserved`, {
      balanceId: b.id,
      reserved: b.reservedSqm.toString(),
    });
  }
  const unitCost = D(b.lot.costPerSqm);
  let value = m.value !== undefined ? round2(m.value) : round2(sqm.times(unitCost));
  if (m.value === undefined && onHand.isZero()) value = (await bucketValue(tx, b.id)).negated();

  const movement = await tx.stockMovement.create({
    data: {
      date: m.date,
      type: m.type,
      refType: m.refType,
      refId: m.refId,
      balanceId: b.id,
      productId: b.productId,
      lotId: b.lotId,
      blockId: b.blockId,
      slabId: b.slabId,
      warehouseId: b.warehouseId,
      sqm,
      unitCost,
      value,
      reason: m.reason,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  const updated = await tx.stockBalance.update({
    where: { id: b.id },
    data: { onHandSqm: onHand, reservedSqm: reserved },
    include: { lot: { select: { costPerSqm: true } } },
  });
  return { movement, value, balance: updated };
}

/** Recompute a slab's status from its bucket. SPLIT / DAMAGED / REJECTED are terminal here. */
export async function refreshSlabStatus(tx: Tx, slabId: string | null): Promise<void> {
  if (!slabId) return;
  const slab = await tx.slab.findUniqueOrThrow({ where: { id: slabId }, include: { balance: true } });
  if (!slab.balance || ["SPLIT", "DAMAGED", "REJECTED"].includes(slab.status)) return;
  const onHand = D(slab.balance.onHandSqm);
  const reserved = D(slab.balance.reservedSqm);
  const sold = (await tx.stockMovement.count({ where: { slabId, type: "DN" } })) > 0;
  const status = onHand.isZero()
    ? sold
      ? "SOLD"
      : "DAMAGED"
    : reserved.gt(0)
      ? "RESERVED"
      : sold && onHand.lt(slab.totalSqm)
        ? "PARTIALLY_SOLD"
        : "AVAILABLE";
  if (status !== slab.status) await tx.slab.update({ where: { id: slabId }, data: { status } });
}

async function assertSellable(tx: Tx, b: StockBalance): Promise<void> {
  if (!b.slabId) return;
  const slab = await tx.slab.findUniqueOrThrow({ where: { id: b.slabId } });
  if (["SPLIT", "DAMAGED", "REJECTED"].includes(slab.status)) {
    throw new AppError("VALIDATION", `Slab ${slab.slabNo} is ${slab.status.toLowerCase()} and cannot be reserved`);
  }
}

// ───────────────────────────── Reservations ─────────────────────────────

export async function reserveStock(
  tx: Tx,
  ctx: Ctx,
  input: { balanceId: string; sqm: Prisma.Decimal.Value; refType: string; refId: string; refLineId?: string; expiresAt?: Date },
) {
  const sqm = positiveSqm(input.sqm);
  const b = await lockBalance(tx, input.balanceId);
  await assertSellable(tx, b);
  const avail = availableSqm(b);
  if (avail.lt(sqm)) {
    throw new AppError("INSUFFICIENT_STOCK", `Only ${avail.toFixed(2)} SQM available`, {
      balanceId: b.id,
      requested: sqm.toString(),
      available: avail.toString(),
    });
  }
  await tx.stockBalance.update({ where: { id: b.id }, data: { reservedSqm: D(b.reservedSqm).plus(sqm) } });
  const r = await tx.stockReservation.create({
    data: {
      balanceId: b.id,
      refType: input.refType,
      refId: input.refId,
      refLineId: input.refLineId,
      sqm,
      expiresAt: input.expiresAt,
      createdById: ctx.userId,
    },
  });
  await refreshSlabStatus(tx, b.slabId);
  await audit(tx, ctx, { action: "reserve", entity: "StockReservation", entityId: r.id, after: r });
  return r;
}

const openSqm = (r: { sqm: Prisma.Decimal; consumedSqm: Prisma.Decimal; releasedSqm: Prisma.Decimal }) =>
  D(r.sqm).minus(r.consumedSqm).minus(r.releasedSqm);

/** Lock order is always bucket → reservation, to avoid deadlocks. */
async function lockReservation(tx: Tx, reservationId: string) {
  const r0 = await tx.stockReservation.findUnique({ where: { id: reservationId } });
  if (!r0) throw new AppError("NOT_FOUND", "Reservation not found");
  const b = await lockBalance(tx, r0.balanceId);
  const r = await tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
  if (r.status !== "ACTIVE") throw new AppError("CONFLICT", `Reservation is ${r.status.toLowerCase()}`);
  return { r, b };
}

function settledStatus(r: { consumedSqm: Dec }, remaining: Dec, expired: boolean) {
  if (!remaining.isZero()) return "ACTIVE" as const;
  if (expired) return "EXPIRED" as const;
  return D(r.consumedSqm).gt(0) ? ("CONSUMED" as const) : ("RELEASED" as const);
}

/** Release all (default) or part of a reservation — on cancel, edit or expiry. */
export async function releaseReservation(
  tx: Tx,
  ctx: Ctx,
  input: { reservationId: string; sqm?: Prisma.Decimal.Value; reason: string; expired?: boolean },
) {
  const { r, b } = await lockReservation(tx, input.reservationId);
  const open = openSqm(r);
  const qty = input.sqm === undefined ? open : positiveSqm(input.sqm);
  if (qty.gt(open)) throw new AppError("VALIDATION", `Only ${open.toFixed(2)} SQM is still reserved`);
  const releasedSqm = D(r.releasedSqm).plus(qty);
  const remaining = open.minus(qty);
  const updated = await tx.stockReservation.update({
    where: { id: r.id },
    data: { releasedSqm, status: settledStatus({ consumedSqm: D(r.consumedSqm) }, remaining, Boolean(input.expired)) },
  });
  await tx.stockBalance.update({ where: { id: b.id }, data: { reservedSqm: D(b.reservedSqm).minus(qty) } });
  await refreshSlabStatus(tx, b.slabId);
  await audit(tx, ctx, {
    action: input.expired ? "expire" : "release",
    entity: "StockReservation",
    entityId: r.id,
    before: r,
    after: updated,
    meta: { reason: input.reason, sqm: qty },
  });
  return updated;
}

/**
 * Dispatch against a reservation (used by the DN in step 6): reduces reserved and on-hand together,
 * writes the DN movement and records a full/partial slab sale. Returns the cost value (for COGS).
 */
export async function consumeReservation(
  tx: Tx,
  ctx: Ctx,
  input: { reservationId: string; sqm: Prisma.Decimal.Value; date: Date; refType: string; refId: string },
): Promise<{ cost: Dec; movementId: string }> {
  const { r, b } = await lockReservation(tx, input.reservationId);
  const qty = positiveSqm(input.sqm);
  const open = openSqm(r);
  if (qty.gt(open)) throw new AppError("VALIDATION", `Only ${open.toFixed(2)} SQM is reserved on this line`);

  const { movement, value } = await writeMovement(tx, ctx, b, {
    type: "DN",
    sqm: qty.negated(),
    reservedDelta: qty.negated(),
    date: input.date,
    refType: input.refType,
    refId: input.refId,
  });
  const consumedSqm = D(r.consumedSqm).plus(qty);
  await tx.stockReservation.update({
    where: { id: r.id },
    data: { consumedSqm, status: settledStatus({ consumedSqm }, open.minus(qty), false) },
  });
  if (b.slabId) {
    const slab = await tx.slab.findUniqueOrThrow({ where: { id: b.slabId }, include: { balance: true } });
    await tx.slabOperation.create({
      data: {
        type: D(slab.balance!.onHandSqm).isZero() ? "FULL_SALE" : "PARTIAL_SALE",
        slabId: b.slabId,
        refType: input.refType,
        refId: input.refId,
        sqm: qty,
        userId: ctx.userId,
      },
    });
    await refreshSlabStatus(tx, b.slabId);
  }
  return { cost: value.negated(), movementId: movement.id };
}

// ───────────────────────────── Adjustments ─────────────────────────────

/** Manual stock adjustment (breakage, wastage, count correction). Posts to GL. */
export async function adjustStock(
  tx: Tx,
  ctx: Ctx,
  input: { balanceId: string; sqm: Prisma.Decimal.Value; reason: string; date: Date },
) {
  assertCan(ctx, "inventory.adjust");
  const reason = input.reason?.trim();
  if (!reason) throw new AppError("VALIDATION", "A reason is required for stock adjustments");
  const sqm = round4(D(input.sqm));
  if (sqm.isZero()) throw new AppError("VALIDATION", "Adjustment quantity cannot be zero");

  const b = await lockBalance(tx, input.balanceId);
  if (b.slabId) {
    const slab = await tx.slab.findUniqueOrThrow({ where: { id: b.slabId } });
    if (slab.status === "SPLIT") throw new AppError("VALIDATION", "A split slab cannot be adjusted");
    if (sqm.gt(0) && D(b.onHandSqm).plus(sqm).gt(slab.totalSqm)) {
      throw new AppError("VALIDATION", `Slab ${slab.slabNo} cannot hold more than its ${D(slab.totalSqm).toFixed(2)} SQM`);
    }
  }
  const { movement, value } = await writeMovement(tx, ctx, b, {
    type: sqm.gt(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
    sqm,
    date: input.date,
    refType: "STOCK_ADJUSTMENT",
    refId: b.id,
    reason,
  });
  if (!value.isZero()) {
    const amt = value.abs();
    await postJournal(tx, ctx, {
      date: input.date,
      sourceType: "STOCK_ADJUSTMENT",
      sourceId: movement.id,
      memo: reason,
      lines: value.gt(0)
        ? [
            { account: "INVENTORY", debit: amt },
            { account: "STOCK_ADJUSTMENT", credit: amt },
          ]
        : [
            { account: "STOCK_ADJUSTMENT", debit: amt },
            { account: "INVENTORY", credit: amt },
          ],
    });
  }
  if (b.slabId) {
    await tx.slabOperation.create({
      data: { type: "ADJUSTMENT", slabId: b.slabId, refType: "STOCK_ADJUSTMENT", refId: movement.id, sqm, notes: reason, userId: ctx.userId },
    });
    await refreshSlabStatus(tx, b.slabId);
  }
  await audit(tx, ctx, { action: "adjust", entity: "StockBalance", entityId: b.id, meta: { sqm, value, reason } });
  return { movementId: movement.id, value };
}

/** Post the GL effect of a set of movement values against an offset account. */
export async function postInventoryChange(
  tx: Tx,
  ctx: Ctx,
  input: { date: Date; sourceType: string; sourceId: string; memo?: string; values: Dec[]; offsetAccount: string },
) {
  const delta = round2(sum(input.values));
  if (delta.isZero()) return null;
  const amt = delta.abs();
  return postJournal(tx, ctx, {
    date: input.date,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    memo: input.memo,
    lines: delta.gt(0)
      ? [
          { account: "INVENTORY", debit: amt },
          { account: input.offsetAccount, credit: amt },
        ]
      : [
          { account: input.offsetAccount, debit: amt },
          { account: "INVENTORY", credit: amt },
        ],
  });
}
